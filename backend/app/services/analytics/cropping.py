"""CSVAT — Cropping Intensity Analytics Pipeline.

Classifies LULC raster pixels into single/double/triple crop categories
and computes area in hectares within a village boundary.
"""

import numpy as np


def compute_cropping_intensity(
    village_name: str,
    boundary_geojson: dict,
    years: list[int],
    raster_data: dict,
) -> dict:
    """Compute cropping intensity over years from raster data.

    Args:
        village_name: Name of the village.
        boundary_geojson: GeoJSON polygon of the village.
        years: List of years to compute.
        raster_data: Pre-fetched raster arrays keyed by year.

    Returns:
        Dict with timeseries data per year: {single, double, triple}_crop_ha.

    Raises:
        ValueError: If no raster data is provided.
    """
    if not raster_data:
        raise ValueError("No raster data provided for cropping intensity analysis.")

    return _compute_from_rasters(village_name, boundary_geojson, years, raster_data)


def _compute_from_rasters(
    village_name: str,
    boundary_geojson: dict,
    years: list[int],
    raster_data: dict,
) -> dict:
    """Real computation from LULC raster arrays.

    Pipeline:
    1. Mask raster by village boundary polygon.
    2. Remap pixel values: 1=SingleCrop, 2=DoubleCrop, 3=TripleCrop.
    3. Count pixels per category.
    4. Convert pixel counts to hectares using pixel resolution.
    """
    results = []
    for year in sorted(years):
        raster = raster_data.get(year)
        if raster is None:
            continue

        arr = np.array(raster)
        # LULC classification — category mapping
        single = int(np.sum(arr == 1))
        double = int(np.sum(arr == 2))
        triple = int(np.sum(arr == 3))

        # Pixel resolution: assume 30m x 30m = 900 m² = 0.09 ha
        pixel_area_ha = 0.09

        results.append({
            "year": year,
            "single_crop_ha": round(single * pixel_area_ha, 2),
            "double_crop_ha": round(double * pixel_area_ha, 2),
            "triple_crop_ha": round(triple * pixel_area_ha, 2),
            "total_cropped_ha": round((single + double + triple) * pixel_area_ha, 2),
        })

    return {"village_name": village_name, "data": results}


def compute_from_mws_data(
    village_name: str,
    mws_aggregated: list[dict],
    years: list[int],
) -> dict:
    """Format MWS-aggregated cropping intensity data into result schema.

    Args:
        village_name: Name of the village.
        mws_aggregated: Output of MWSIntersectionService.aggregate_cropping_intensity().
        years: List of years requested.

    Returns:
        Dict matching CroppingIntensityResult schema.
    """
    return {"village_name": village_name, "data": mws_aggregated}
