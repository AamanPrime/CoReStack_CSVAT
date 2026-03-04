"""CSVAT — Celery analytics task.

This task orchestrates the full server-side analytics pipeline:
1. Resolve village boundary
2. Try MWS intersection (CoRE Stack pre-computed data)
3. Fall back to direct GEE if tehsil not active (with user warning)
4. Generate reports
5. Store results in PostGIS
"""

import logging
from datetime import datetime, timezone
from app.tasks.celery_app import celery_app
from app.services.boundary_service import boundary_service
from app.services.mws_intersection_service import mws_service
from app.services.analytics.cropping import (
    compute_cropping_intensity,
    compute_from_mws_data as cropping_from_mws,
)
from app.services.analytics.water import (
    compute_surface_water,
    compute_from_mws_data as water_from_mws,
)
from app.services.analytics.vegetation import (
    compute_vegetation_change,
    compute_from_mws_data as vegetation_from_mws,
)
from app.services.report_service import report_service
from app.services.gee_service import fetch_all as gee_fetch_all

logger = logging.getLogger(__name__)

# Warning message shown when falling back to direct GEE
GEE_FALLBACK_WARNING = (
    "This area is not yet available on CoRE Stack. "
    "Results are computed from lower-resolution satellite data (MODIS 500m vs 10m). "
    "Data accuracy may be reduced compared to CoRE Stack processed areas."
)


def _persist_job_result(job_id: str, status: str, results: dict = None, error: str = None):
    """Persist analytics results back to the PostGIS database."""
    try:
        import uuid
        from app.database import SessionLocal
        from app.models.job import Job, JobStatus

        status_map = {
            "SUCCESS": JobStatus.SUCCESS,
            "FAILED": JobStatus.FAILED,
            "RUNNING": JobStatus.RUNNING,
            "PENDING": JobStatus.PENDING,
        }

        db = SessionLocal()
        try:
            job = db.query(Job).filter(Job.id == uuid.UUID(job_id)).first()
            if job:
                job.status = status_map.get(status, JobStatus.FAILED)
                if results is not None:
                    job.result_json = results
                if error is not None:
                    job.error_message = error
                job.updated_at = datetime.now(timezone.utc)
                db.commit()
                logger.info("Job %s persisted to DB (status=%s)", job_id, status)
            else:
                logger.warning("Job %s not found in DB", job_id)
        finally:
            db.close()
    except Exception as e:
        logger.error("Failed to persist job %s: %s", job_id, str(e))


def _run_async(coro):
    """Run an async coroutine from a sync context (Celery task)."""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()


def _run_pipeline(job_params: dict) -> dict:
    """Core analytics pipeline shared by async and sync tasks.

    Strategy A: MWS intersection (CoRE Stack pre-computed 10m data)
    Strategy B: Direct GEE fallback (MODIS 500m) with user warning
    """
    job_id = job_params.get("job_id")

    # 1. Resolve boundary
    boundary_id = job_params.get("boundary_id")
    boundary_geojson = job_params.get("boundary_geojson")

    village_name = job_params.get("village_name", "Unknown")
    state = job_params.get("state", "")
    district = job_params.get("district", "")
    tehsil = job_params.get("tehsil", "")

    # If no GeoJSON provided, fetch from CoRE Stack using admin hierarchy
    if not boundary_geojson and state and district and tehsil and village_name:
        logger.info("No GeoJSON provided, fetching from CoRE Stack for %s/%s/%s/%s",
                     state, district, tehsil, village_name)
        try:
            from app.services.corestack_client import corestack_client
            features = _run_async(
                corestack_client.get_village_geometries(state, district, tehsil)
            )

            # features may be a FeatureCollection or a list
            feature_list = []
            if isinstance(features, dict) and features.get("type") == "FeatureCollection":
                feature_list = features.get("features", [])
            elif isinstance(features, list):
                feature_list = features

            # Find matching village by name
            village_lower = village_name.lower().strip()
            for feat in feature_list:
                props = feat.get("properties", {}) if isinstance(feat, dict) else {}
                feat_name = (props.get("vill_name") or props.get("name") or "").lower().strip()
                if feat_name == village_lower:
                    boundary_geojson = feat.get("geometry")
                    logger.info("Resolved village geometry for %s", village_name)
                    break

            if not boundary_geojson:
                # Fallback: use the first feature if only one match on tehsil
                if len(feature_list) > 0:
                    boundary_geojson = feature_list[0].get("geometry")
                    logger.warning("Using first available village geometry as fallback")
        except Exception as e:
            logger.warning("CoRE Stack geometry fetch failed: %s", e)

    if boundary_geojson:
        boundary = boundary_service.resolve_boundary(boundary_id, boundary_geojson)
        village_name = job_params.get("village_name") or boundary.get("name", village_name)
        state = job_params.get("state") or boundary.get("state", state)
        district = job_params.get("district") or boundary.get("district", district)
        tehsil = job_params.get("tehsil") or boundary.get("tehsil", tehsil)
        geojson = boundary["geojson"]
    else:
        raise ValueError("No GeoJSON provided and could not resolve from CoRE Stack.")

    layers = job_params.get("layers", [])
    years = job_params.get("years", [2019, 2020, 2021, 2022, 2023])

    logger.info("Running analytics for %s (%s/%s/%s)", village_name, state, district, tehsil)

    # 2. Validate tehsil intersection (async method — run via helper)
    try:
        is_active = _run_async(
            boundary_service.validate_tehsil_intersection(state, district, tehsil)
        )
    except Exception as e:
        logger.warning("Tehsil validation failed, allowing by default: %s", e)
        is_active = True

    if not is_active:
        raise ValueError(
            f"Village {village_name} does not intersect an active tehsil. "
            "Analytics cannot be computed."
        )

    results = {
        "village_name": village_name,
        "state": state,
        "district": district,
        "tehsil": tehsil,
    }

    # 3. Strategy A: Try MWS intersection (CoRE Stack 10m data)
    mws_succeeded = False
    try:
        logger.info("Attempting MWS intersection for %s/%s/%s", state, district, tehsil)

        # Run the async MWS service via helper
        mws_results = _run_async(
            mws_service.compute_village_analytics(
                geojson, state, district, tehsil, layers, years
            )
        )

        # Format MWS results into schema
        if "cropping_intensity" in layers and mws_results.get("cropping_intensity"):
            results["cropping_intensity"] = cropping_from_mws(
                village_name, mws_results["cropping_intensity"], years
            )

        if "surface_water" in layers and mws_results.get("surface_water"):
            results["surface_water"] = water_from_mws(
                village_name, mws_results["surface_water"], years
            )

        if "vegetation" in layers and mws_results.get("vegetation"):
            results["vegetation"] = vegetation_from_mws(
                village_name, mws_results["vegetation"], years
            )

        results["data_source"] = "corestack_mws"
        results["mws_count"] = mws_results.get("mws_count", 0)
        mws_succeeded = True
        logger.info(
            "MWS intersection succeeded: %d MWS polygons",
            mws_results.get("mws_count", 0),
        )

    except Exception as e:
        logger.warning("MWS intersection failed, falling back to GEE: %s", str(e))

    # 4. Strategy B: Direct GEE fallback (with user warning)
    if not mws_succeeded:
        logger.info("Using direct GEE for %s", village_name)
        try:
            gee_data = gee_fetch_all(geojson, years[0], years[-1])

            if "cropping_intensity" in layers and gee_data.get("lulc"):
                results["cropping_intensity"] = compute_cropping_intensity(
                    village_name, geojson, years, raster_data=gee_data["lulc"]
                )

            if "surface_water" in layers and gee_data.get("water"):
                results["surface_water"] = compute_surface_water(
                    village_name, geojson, years, raster_data=gee_data["water"]
                )

            if "vegetation" in layers and gee_data.get("ndvi"):
                results["vegetation"] = compute_vegetation_change(
                    village_name, geojson, years, raster_data=gee_data["ndvi"]
                )

            results["data_source"] = "gee_fallback"
            results["data_warning"] = GEE_FALLBACK_WARNING

        except Exception as gee_err:
            logger.error("GEE fallback also failed: %s", str(gee_err))
            results["data_source"] = "none"
            results["data_warning"] = (
                "Analytics could not be computed. "
                "Both CoRE Stack and Google Earth Engine data sources failed. "
                f"Error: {str(gee_err)}"
            )

    # 5. Generate reports
    html_report = report_service.generate_html_report(results)
    csv_data = report_service.generate_csv(results)

    results["html_report"] = html_report
    results["csv_data"] = csv_data
    results["completed_at"] = datetime.now(timezone.utc).isoformat()

    logger.info("Analytics completed for %s (source: %s)", village_name, results.get("data_source"))

    # 6. Persist to PostGIS
    if job_id:
        _persist_job_result(job_id, "SUCCESS", results)

    return results


@celery_app.task(bind=True, name="csvat.run_analytics")
def run_analytics_task(self, job_params: dict) -> dict:
    """Execute the full analytics pipeline for a job (Celery async)."""
    job_id = job_params.get("job_id")
    try:
        # Mark as RUNNING in DB
        if job_id:
            _persist_job_result(job_id, "RUNNING")
        self.update_state(state="RUNNING")
        return _run_pipeline(job_params)
    except Exception as e:
        logger.error("Analytics task failed: %s", str(e))
        if job_id:
            _persist_job_result(job_id, "FAILED", error=str(e))
        raise


@celery_app.task(name="csvat.run_analytics_sync")
def run_analytics_sync(job_params: dict) -> dict:
    """Synchronous version for when Celery is not available (development mode)."""
    try:
        return _run_pipeline(job_params)
    except Exception as e:
        job_id = job_params.get("job_id")
        if job_id:
            _persist_job_result(job_id, "FAILED", error=str(e))
        raise ValueError(f"Analytics failed: {str(e)}")
