"""CSVAT — Seasonal Surface Water Analytics Pipeline.

Classifies water pixels into perennial and seasonal categories
and computes area in hectares per season.
"""

import numpy as np


def compute_surface_water(
    village_name: str,
    boundary_geojson: dict,
    years: list[int],
    raster_data: dict,
) -> dict:
    """Compute seasonal surface water availability over years.

    Args:
        village_name: Name of the village.
        boundary_geojson: GeoJSON polygon.
        years: List of years.
        raster_data: Pre-fetched water raster arrays keyed by year.

    Returns:
        Dict with perennial, seasonal_monsoon, seasonal_winter areas per year.

    Raises:
        ValueError: If no raster data is provided.
    """
    if not raster_data:
        raise ValueError("No raster data provided for surface water analysis.")

    return _compute_from_rasters(village_name, boundary_geojson, years, raster_data)


def _compute_from_rasters(
    village_name: str,
    boundary_geojson: dict,
    years: list[int],
    raster_data: dict,
) -> dict:
    """Real computation from surface water rasters.

    Classification:
    - Perennial: water present > 9 months (pixel value encoding)
    - Seasonal Monsoon: water present during Jun-Sep
    - Seasonal Winter: water present during Oct-Feb
    """
    results = []
    pixel_area_ha = 0.09  # 30m resolution

    for year in sorted(years):
        raster = raster_data.get(year)
        if raster is None:
            continue

        arr = np.array(raster)
        perennial = int(np.sum(arr >= 9))          # > 9 months
        monsoon = int(np.sum((arr >= 3) & (arr < 9)))  # 3-8 months
        winter = int(np.sum((arr >= 1) & (arr < 3)))   # 1-2 months

        results.append({
            "year": year,
            "perennial_ha": round(perennial * pixel_area_ha, 2),
            "seasonal_monsoon_ha": round(monsoon * pixel_area_ha, 2),
            "seasonal_winter_ha": round(winter * pixel_area_ha, 2),
            "total_water_ha": round((perennial + monsoon + winter) * pixel_area_ha, 2),
        })

    return {"village_name": village_name, "data": results}


def compute_from_mws_data(
    village_name: str,
    mws_aggregated: list[dict],
    years: list[int],
) -> dict:
    """Format MWS-aggregated surface water data into result schema.

    Args:
        village_name: Name of the village.
        mws_aggregated: Output of MWSIntersectionService.aggregate_surface_water().
        years: List of years requested.

    Returns:
        Dict matching SurfaceWaterResult schema.
    """
    return {"village_name": village_name, "data": mws_aggregated}
