"""
Analytics router — endpoints for village-level analytics.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from app.services import data_service
from app.services import raster_service
from app.models.schemas import AnalyticsRequest, AnalyticsResponse
import io, csv, json

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/sample")
def get_sample_analytics():
    """Return full analytics for the Nallacheruvu sample dataset."""
    uids = data_service.get_mws_uids_for_village()
    summary = data_service.get_summary(uids)
    return {
        "village_name": "Nallacheruvu (Sample)",
        "total_area_ha": summary["total_area_ha"],
        "mws_count": summary["mws_count"],
        "cropping_intensity": data_service.get_cropping_intensity(uids),
        "surface_water": data_service.get_surface_water(uids),
        "deforestation": data_service.get_deforestation(uids),
        "terrain": data_service.get_terrain(uids),
        "crop_intensity_change": data_service.get_crop_intensity_change(uids),
    }


@router.post("/compute")
def compute_analytics(request: AnalyticsRequest):
    """Compute analytics for a specific set of MWS UIDs."""
    if not request.mws_uids:
        raise HTTPException(status_code=400, detail="mws_uids list is required")

    summary = data_service.get_summary(request.mws_uids)
    if summary["mws_count"] == 0:
        raise HTTPException(
            status_code=404,
            detail="No micro-watershed units found for the given UIDs."
        )

    return AnalyticsResponse(
        village_name=request.village_name or "Unknown",
        total_area_ha=summary["total_area_ha"],
        mws_count=summary["mws_count"],
        cropping_intensity=data_service.get_cropping_intensity(request.mws_uids),
        surface_water=data_service.get_surface_water(request.mws_uids),
        deforestation=data_service.get_deforestation(request.mws_uids),
        terrain=data_service.get_terrain(request.mws_uids),
        crop_intensity_change=data_service.get_crop_intensity_change(request.mws_uids),
    )


@router.get("/export/csv")
def export_csv():
    """Export the sample cropping intensity data as a downloadable CSV."""
    uids = data_service.get_mws_uids_for_village()
    records = data_service.get_cropping_intensity(uids)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=records[0].keys())
    writer.writeheader()
    writer.writerows(records)
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cropping_intensity.csv"},
    )


@router.get("/export/all-csv")
def export_all_csv():
    """Export all analytics as a combined CSV."""
    uids = data_service.get_mws_uids_for_village()

    ci = data_service.get_cropping_intensity(uids)
    sw = data_service.get_surface_water(uids)

    output = io.StringIO()

    # Cropping Intensity section
    output.write("=== Cropping Intensity ===\n")
    if ci:
        writer = csv.DictWriter(output, fieldnames=ci[0].keys())
        writer.writeheader()
        writer.writerows(ci)

    output.write("\n=== Surface Water Bodies ===\n")
    if sw:
        writer = csv.DictWriter(output, fieldnames=sw[0].keys())
        writer.writeheader()
        writer.writerows(sw)

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=csvat_analytics.csv"},
    )

@router.get("/tiff-status")
def tiff_status():
    """Show which LULC TIFFs are registered and available for raster processing."""
    return {
        "tiffs_found": len(raster_service.LULC_TIFFS),
        "years": raster_service.available_years(),
        "paths": {k: str(v) for k, v in raster_service.LULC_TIFFS.items()},
    }


@router.post("/from-geojson")
def analytics_from_geojson(boundary: dict):
    """
    Compute REAL analytics by clipping the LULC GeoTIFF with the
    supplied GeoJSON boundary.

    Accepts a GeoJSON Feature, FeatureCollection, Polygon, or MultiPolygon.
    Returns the same schema as /sample so the frontend is unchanged.
    """
    if not raster_service.LULC_TIFFS:
        raise HTTPException(
            status_code=503,
            detail="No LULC TIFF files found. Place lulc*.tif in backend/app/data/ "
                   "or the project root (X:\\CoreStack\\).",
        )

    # Normalise: extract geometry from Feature / FeatureCollection
    geom = None
    btype = boundary.get("type")
    if btype == "Feature":
        geom = boundary.get("geometry")
    elif btype == "FeatureCollection":
        features = boundary.get("features", [])
        if features:
            geom = features[0].get("geometry")
    elif btype in ("Polygon", "MultiPolygon"):
        geom = boundary

    if not geom:
        raise HTTPException(
            status_code=400,
            detail="Could not extract a Polygon or MultiPolygon geometry from the supplied GeoJSON.",
        )

    village_name = (
        boundary.get("properties", {}) or {}
    ).get("name") or "Uploaded Boundary"

    try:
        summary       = raster_service.get_summary(geom)
        cropping      = raster_service.get_cropping_intensity(geom)
        surface_water = raster_service.get_surface_water(geom)
        veg_trend     = raster_service.get_vegetation(geom)
        veg_snapshot  = raster_service.get_vegetation_snapshot(geom)
        tree_change   = raster_service.get_tree_cover_change(geom)
        crop_change   = raster_service.get_crop_intensity_change(geom)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Raster processing error: {exc}")

    return {
        "village_name":         village_name,
        "total_area_ha":        summary["total_area_ha"],
        "mws_count":            summary["mws_count"],
        "cropping_intensity":   cropping,
        "surface_water":        surface_water,
        "deforestation":        veg_snapshot,       # category bar chart
        "vegetation_trend":     veg_trend,          # per-year vegetation
        "tree_cover_change":    tree_change,        # pixel-level transitions
        "terrain":              [],                 # requires terrain TIFF (future)
        "crop_intensity_change": crop_change,        # pixel-level crop transitions
        "data_source":          "raster",
        "tiffs_used":           raster_service.available_years(),
    }


