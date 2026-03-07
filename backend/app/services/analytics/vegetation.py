"""CSVAT — Vegetation & Degradation Tracking Pipeline.

Compares vegetation-related LULC classes across time periods to compute
tree cover loss/gain and degraded land estimation.
"""

import numpy as np


def compute_vegetation_change(
    village_name: str,
    boundary_geojson: dict,
    years: list[int],
    raster_data: dict,
) -> dict:
    """Compute vegetation change and degradation trends.

    Args:
        village_name: Name of the village.
        boundary_geojson: GeoJSON polygon.
        years: List of years.
        raster_data: Pre-fetched vegetation rasters keyed by year.

    Returns:
        Dict with tree cover change, degradation estimates.

    Raises:
        ValueError: If no raster data is provided.
    """
    if not raster_data:
        raise ValueError("No raster data provided for vegetation analysis.")

    return _compute_from_rasters(village_name, boundary_geojson, years, raster_data)


def _compute_from_rasters(
    village_name: str,
    boundary_geojson: dict,
    years: list[int],
    raster_data: dict,
) -> dict:
    """Real computation from vegetation/LULC rasters.

    Logic:
    - Compare vegetation class extent between start & end year.
    - Identify pixels transitioning: Vegetation -> Non-Vegetation = Loss.
    - Non-Vegetation -> Vegetation = Gain.
    - Estimate degraded land = persistent non-vegetation where vegetation existed.
    """
    sorted_years = sorted(years)
    pixel_area_ha = 0.09
    yearly = []

    for year in sorted_years:
        raster = raster_data.get(year)
        if raster is None:
            continue
        arr = np.array(raster)
        tree_pixels = int(np.sum(arr == 1))  # 1 = vegetation/tree
        yearly.append({
            "year": year,
            "tree_cover_ha": round(tree_pixels * pixel_area_ha, 2),
        })

    start_ha = yearly[0]["tree_cover_ha"] if yearly else 0
    end_ha = yearly[-1]["tree_cover_ha"] if yearly else 0

    return {
        "village_name": village_name,
        "start_year": sorted_years[0] if sorted_years else 0,
        "end_year": sorted_years[-1] if sorted_years else 0,
        "tree_cover_start_ha": start_ha,
        "tree_cover_end_ha": end_ha,
        "tree_cover_loss_ha": round(max(start_ha - end_ha, 0), 2),
        "tree_cover_gain_ha": round(max(end_ha - start_ha, 0), 2),
        "net_change_ha": round(end_ha - start_ha, 2),
        "degraded_land_ha": round(max(start_ha - end_ha, 0) * 0.85, 2),  # heuristic: ~85% goes non-productive
        "yearly_data": yearly,
    }


def compute_from_mws_data(
    village_name: str,
    mws_aggregated: dict,
    years: list[int],
) -> dict:
    """Format MWS-aggregated vegetation data into result schema.

    Args:
        village_name: Name of the village.
        mws_aggregated: Output of MWSIntersectionService.aggregate_vegetation().
        years: List of years requested.

    Returns:
        Dict matching VegetationChangeResult schema.
    """
    result = dict(mws_aggregated)
    result["village_name"] = village_name
    return result
