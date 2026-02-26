"""CSVAT — Celery analytics task.

This task orchestrates the full server-side analytics pipeline:
1. Resolve village boundary
2. Fetch raster data from CoRE Stack
3. Run analytics pipelines
4. Generate reports
5. Store results
"""

import logging
from datetime import datetime, timezone
from app.tasks.celery_app import celery_app
from app.services.boundary_service import boundary_service
from app.services.analytics.cropping import compute_cropping_intensity
from app.services.analytics.water import compute_surface_water
from app.services.analytics.vegetation import compute_vegetation_change
from app.services.report_service import report_service

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="csvat.run_analytics")
def run_analytics_task(self, job_params: dict) -> dict:
    """Execute the full analytics pipeline for a job.

    Args:
        job_params: Dict with keys: boundary_id, boundary_geojson, layers, years,
                   village_name, state, district, tehsil.

    Returns:
        Dict with analytics results and generated reports.
    """
    try:
        self.update_state(state="RUNNING")

        # 1. Resolve boundary
        boundary_id = job_params.get("boundary_id")
        boundary_geojson = job_params.get("boundary_geojson")
        boundary = boundary_service.resolve_boundary(boundary_id, boundary_geojson)

        village_name = job_params.get("village_name") or boundary["name"]
        state = job_params.get("state") or boundary["state"]
        district = job_params.get("district") or boundary["district"]
        tehsil = job_params.get("tehsil") or boundary["tehsil"]
        geojson = boundary["geojson"]
        layers = job_params.get("layers", [])
        years = job_params.get("years", [2019, 2020, 2021, 2022, 2023])

        logger.info(f"Running analytics for {village_name} ({state}/{district}/{tehsil})")

        # 2. Validate tehsil intersection
        if not boundary_service.validate_tehsil_intersection(state, district, tehsil):
            raise ValueError(
                f"Village {village_name} does not intersect an active tehsil. "
                "Analytics cannot be computed."
            )

        # 3. Run analytics pipelines
        results = {
            "village_name": village_name,
            "state": state,
            "district": district,
            "tehsil": tehsil,
        }

        if "cropping_intensity" in layers:
            results["cropping_intensity"] = compute_cropping_intensity(
                village_name, geojson, years
            )

        if "surface_water" in layers:
            results["surface_water"] = compute_surface_water(
                village_name, geojson, years
            )

        if "vegetation" in layers:
            results["vegetation"] = compute_vegetation_change(
                village_name, geojson, years
            )

        # 4. Generate reports
        html_report = report_service.generate_html_report(results)
        csv_data = report_service.generate_csv(results)

        results["html_report"] = html_report
        results["csv_data"] = csv_data
        results["completed_at"] = datetime.now(timezone.utc).isoformat()

        logger.info(f"Analytics completed for {village_name}")
        return results

    except Exception as e:
        logger.error(f"Analytics task failed: {str(e)}")
        raise


@celery_app.task(name="csvat.run_analytics_sync")
def run_analytics_sync(job_params: dict) -> dict:
    """Synchronous version for when Celery is not available (development mode).

    Runs the same pipeline as the Celery task but without async infrastructure.
    """
    try:
        boundary_id = job_params.get("boundary_id")
        boundary_geojson = job_params.get("boundary_geojson")
        boundary = boundary_service.resolve_boundary(boundary_id, boundary_geojson)

        village_name = job_params.get("village_name") or boundary["name"]
        state = job_params.get("state") or boundary["state"]
        district = job_params.get("district") or boundary["district"]
        tehsil = job_params.get("tehsil") or boundary["tehsil"]
        geojson = boundary["geojson"]
        layers = job_params.get("layers", [])
        years = job_params.get("years", [2019, 2020, 2021, 2022, 2023])

        if not boundary_service.validate_tehsil_intersection(state, district, tehsil):
            raise ValueError(
                f"Village {village_name} does not intersect an active tehsil."
            )

        results = {
            "village_name": village_name,
            "state": state,
            "district": district,
            "tehsil": tehsil,
        }

        if "cropping_intensity" in layers:
            results["cropping_intensity"] = compute_cropping_intensity(
                village_name, geojson, years
            )

        if "surface_water" in layers:
            results["surface_water"] = compute_surface_water(
                village_name, geojson, years
            )

        if "vegetation" in layers:
            results["vegetation"] = compute_vegetation_change(
                village_name, geojson, years
            )

        html_report = report_service.generate_html_report(results)
        csv_data = report_service.generate_csv(results)

        results["html_report"] = html_report
        results["csv_data"] = csv_data
        results["completed_at"] = datetime.now(timezone.utc).isoformat()

        return results

    except Exception as e:
        raise ValueError(f"Analytics failed: {str(e)}")
