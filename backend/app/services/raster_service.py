"""CSVAT — Raster Analytics Service.

Pixel-level LULC analytics from IndiaSAT v3 GeoTIFF files.
Ported from the old project with improvements for the current architecture.

Pipeline:
  1. Open pan-India LULC TIFF with rasterio
  2. Clip to village boundary via rasterio.mask.mask()
  3. Count pixels per LULC class
  4. Convert pixel counts → hectares using WGS-84 pixel area at centroid latitude
  5. Return structured dicts matching the analytics schema

LULC Class Legend (IndiaSAT v3):
  0  Background
  1  Built Up
  2  Kharif Water           (monsoon surface water)
  3  Kharif + Rabi Water    (monsoon + winter)
  4  Kharif+Rabi+Zaid Water (perennial water)
  5  Crops (general)
  6  Trees
  7  Barren Land
  8  Single Kharif Cropping
  9  Single Non-Kharif Cropping
 10  Double Cropping
 11  Triple / Annual / Perennial Cropping
 12  Shrubs and Scrubs
"""

import math
import logging
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Paths ────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent

# Registry of available TIFF files keyed by fiscal year string (e.g. "2018-2019")
LULC_TIFFS: dict[str, Path] = {}


def _register_tiffs_from(search_dir: Path) -> None:
    """Scan a directory for lulc*.tif files and register them."""
    if not search_dir.exists():
        return
    for p in search_dir.glob("lulc*.tif"):
        parts = p.stem.split("_")
        year_parts = [x for x in parts if x.isdigit() and len(x) == 4]
        if len(year_parts) >= 2:
            key = f"{year_parts[-2]}-{year_parts[-1]}"
            if key not in LULC_TIFFS:
                LULC_TIFFS[key] = p
                logger.info("Registered LULC TIFF: %s → %s", key, p)


# Search bundled data dir first, then project root
_register_tiffs_from(DATA_DIR)
_register_tiffs_from(PROJECT_ROOT)

# ── Class mappings ───────────────────────────────────────────────────
CLASS_LABELS = {
    0: "Background", 1: "Built Up", 2: "Kharif Water",
    3: "Kharif+Rabi Water", 4: "Perennial Water",
    5: "Crops", 6: "Trees", 7: "Barren Land",
    8: "Single Kharif Crop", 9: "Single Non-Kharif Crop",
    10: "Double Cropping", 11: "Triple Cropping",
    12: "Shrubs And Scrubs",
}


# ── Pixel area helper ────────────────────────────────────────────────
def _pixel_area_ha(res_deg: float, centroid_lat_deg: float) -> float:
    """Convert a square pixel of side `res_deg` (degrees) to hectares.

    Uses WGS-84 ellipsoid approximation at the given latitude.
    """
    lat_rad = math.radians(centroid_lat_deg)
    m_per_deg_lat = 111_132.92 - 559.82 * math.cos(2 * lat_rad) + 1.175 * math.cos(4 * lat_rad)
    m_per_deg_lon = 111_412.84 * math.cos(lat_rad) - 93.5 * math.cos(3 * lat_rad)
    pixel_area_m2 = (res_deg * m_per_deg_lat) * (res_deg * m_per_deg_lon)
    return pixel_area_m2 / 10_000


# ── Core clip + count ────────────────────────────────────────────────
def clip_and_count(geojson_geometry: dict, tiff_path: Path) -> tuple[dict[int, int], float, float]:
    """Clip TIFF to geometry and return (class_counts, pixel_ha, total_ha)."""
    try:
        import rasterio
        from rasterio.mask import mask as rasterio_mask
        from shapely.geometry import shape, mapping
    except ImportError:
        raise ImportError("rasterio and shapely are required for raster analytics")

    geom = shape(geojson_geometry)

    with rasterio.open(tiff_path) as src:
        centroid_lat = geom.centroid.y
        res = src.res[0]
        pixel_ha = _pixel_area_ha(res, centroid_lat)

        out_image, _ = rasterio_mask(
            src, [mapping(geom)], crop=True, nodata=np.nan, all_touched=True,
        )

        data = out_image[0]
        flat = data.flatten()
        valid = flat[~np.isnan(flat)]

        class_counts: dict[int, int] = {}
        for cls in np.unique(valid):
            cls_int = int(cls)
            class_counts[cls_int] = int(np.sum(valid == cls))

        total_ha = len(valid) * pixel_ha

    return class_counts, pixel_ha, total_ha


# ── Public API ───────────────────────────────────────────────────────

def available_years() -> list[str]:
    """Return list of fiscal years we have LULC TIFFs for."""
    return sorted(LULC_TIFFS.keys())


def has_raster_data() -> bool:
    """Check if any LULC TIFFs are registered."""
    return bool(LULC_TIFFS)


def get_cropping_intensity(geojson_geometry: dict) -> dict:
    """Compute cropping intensity from all available year TIFFs.

    Returns dict matching CroppingIntensityResult schema.
    """
    records = []
    for year, tiff_path in sorted(LULC_TIFFS.items()):
        try:
            counts, pixel_ha, _ = clip_and_count(geojson_geometry, tiff_path)

            single_kharif_ha = counts.get(8, 0) * pixel_ha
            single_nkharif_ha = counts.get(9, 0) * pixel_ha
            double_ha = counts.get(10, 0) * pixel_ha
            triple_ha = counts.get(11, 0) * pixel_ha
            single_ha = single_kharif_ha + single_nkharif_ha

            records.append({
                "year": year,
                "single_crop_ha": round(single_ha, 2),
                "double_crop_ha": round(double_ha, 2),
                "triple_crop_ha": round(triple_ha, 2),
                "total_cropped_ha": round(single_ha + double_ha + triple_ha, 2),
            })
        except Exception as exc:
            logger.warning("Skipping TIFF %s: %s", year, exc)

    return {"village_name": "raster_analysis", "data": records}


def get_surface_water(geojson_geometry: dict) -> dict:
    """Compute surface water from all available year TIFFs.

    Returns dict matching SurfaceWaterResult schema.
    """
    records = []
    for year, tiff_path in sorted(LULC_TIFFS.items()):
        try:
            counts, pixel_ha, _ = clip_and_count(geojson_geometry, tiff_path)

            monsoon_ha = counts.get(2, 0) * pixel_ha
            winter_ha = counts.get(3, 0) * pixel_ha
            perennial_ha = counts.get(4, 0) * pixel_ha

            records.append({
                "year": year,
                "perennial_ha": round(perennial_ha, 2),
                "seasonal_monsoon_ha": round(monsoon_ha, 2),
                "seasonal_winter_ha": round(winter_ha, 2),
                "total_water_ha": round(monsoon_ha + winter_ha + perennial_ha, 2),
            })
        except Exception as exc:
            logger.warning("Skipping TIFF %s: %s", year, exc)

    return {"village_name": "raster_analysis", "data": records}


def get_tree_cover_change(geojson_geometry: dict) -> dict:
    """Compute pixel-level tree cover transitions between earliest and latest TIFF.

    Returns dict matching VegetationChangeResult schema with pixel-level
    transition matrix (Trees → Built Up, Trees → Barren, etc.).
    """
    try:
        import rasterio
        from rasterio.mask import mask as rasterio_mask
        from shapely.geometry import shape, mapping
    except ImportError:
        return {"error": "rasterio/shapely required"}

    years_sorted = sorted(LULC_TIFFS.keys())
    if not years_sorted:
        return {"error": "No LULC TIFFs available."}

    if len(years_sorted) == 1:
        year = years_sorted[0]
        counts, pixel_ha, _ = clip_and_count(geojson_geometry, LULC_TIFFS[year])
        tree_ha = round(counts.get(6, 0) * pixel_ha, 2)
        return {
            "start_year": year, "end_year": year,
            "tree_cover_start_ha": tree_ha, "tree_cover_end_ha": tree_ha,
            "net_change_ha": 0.0, "tree_cover_loss_ha": 0.0,
            "tree_cover_gain_ha": 0.0, "degraded_land_ha": 0.0,
            "transitions": [], "yearly_data": [{"year": year, "tree_cover_ha": tree_ha}],
        }

    year_a, year_b = years_sorted[0], years_sorted[-1]
    geom = shape(geojson_geometry)

    with rasterio.open(LULC_TIFFS[year_a]) as src_a:
        pixel_ha = _pixel_area_ha(src_a.res[0], geom.centroid.y)
        img_a, _ = rasterio_mask(src_a, [mapping(geom)], crop=True, nodata=np.nan, all_touched=True)

    with rasterio.open(LULC_TIFFS[year_b]) as src_b:
        img_b, _ = rasterio_mask(src_b, [mapping(geom)], crop=True, nodata=np.nan, all_touched=True)

    data_a, data_b = img_a[0], img_b[0]
    min_r, min_c = min(data_a.shape[0], data_b.shape[0]), min(data_a.shape[1], data_b.shape[1])
    data_a, data_b = data_a[:min_r, :min_c], data_b[:min_r, :min_c]
    valid = ~np.isnan(data_a) & ~np.isnan(data_b)

    tree_a = (data_a == 6) & valid
    tree_b = (data_b == 6) & valid
    tree_ha_a = round(int(np.sum(tree_a)) * pixel_ha, 2)
    tree_ha_b = round(int(np.sum(tree_b)) * pixel_ha, 2)

    # Pixel-level transitions from Trees
    lost = tree_a & (data_b != 6)
    lost_vals = data_b[lost]

    transitions = []
    degraded_total = 0.0
    for cls in np.unique(lost_vals):
        cls_int = int(cls)
        if np.isnan(cls) or cls_int == 6:
            continue
        area = round(int(np.sum(lost_vals == cls)) * pixel_ha, 2)
        degraded_total += area
        transitions.append({
            "from_class": "Trees", "to_label": CLASS_LABELS.get(cls_int, f"Class {cls_int}"),
            "to_class": cls_int, "area_ha": area,
        })
    transitions.sort(key=lambda x: x["area_ha"], reverse=True)

    return {
        "village_name": "raster_analysis",
        "start_year": year_a, "end_year": year_b,
        "tree_cover_start_ha": tree_ha_a, "tree_cover_end_ha": tree_ha_b,
        "net_change_ha": round(tree_ha_b - tree_ha_a, 2),
        "tree_cover_loss_ha": round(max(tree_ha_a - tree_ha_b, 0), 2),
        "tree_cover_gain_ha": round(max(tree_ha_b - tree_ha_a, 0), 2),
        "degraded_land_ha": round(degraded_total, 2),
        "transitions": transitions,
        "yearly_data": [
            {"year": year_a, "tree_cover_ha": tree_ha_a},
            {"year": year_b, "tree_cover_ha": tree_ha_b},
        ],
    }


def get_crop_intensity_change(geojson_geometry: dict) -> list[dict]:
    """Compute crop intensity transitions between earliest and latest TIFF.

    Returns list of {category, area_ha} showing pixel-level crop class transitions.
    """
    try:
        import rasterio
        from rasterio.mask import mask as rasterio_mask
        from shapely.geometry import shape, mapping
    except ImportError:
        return []

    years_sorted = sorted(LULC_TIFFS.keys())
    if len(years_sorted) < 2:
        return []

    year_a, year_b = years_sorted[0], years_sorted[-1]
    geom = shape(geojson_geometry)

    with rasterio.open(LULC_TIFFS[year_a]) as src_a:
        pixel_ha = _pixel_area_ha(src_a.res[0], geom.centroid.y)
        img_a, _ = rasterio_mask(src_a, [mapping(geom)], crop=True, nodata=np.nan, all_touched=True)

    with rasterio.open(LULC_TIFFS[year_b]) as src_b:
        img_b, _ = rasterio_mask(src_b, [mapping(geom)], crop=True, nodata=np.nan, all_touched=True)

    data_a, data_b = img_a[0], img_b[0]
    min_r, min_c = min(data_a.shape[0], data_b.shape[0]), min(data_a.shape[1], data_b.shape[1])
    data_a, data_b = data_a[:min_r, :min_c], data_b[:min_r, :min_c]
    valid = ~np.isnan(data_a) & ~np.isnan(data_b)

    def _crop_level(arr):
        out = np.full_like(arr, 0, dtype=np.int8)
        out[(arr == 8) | (arr == 9)] = 1
        out[arr == 10] = 2
        out[arr == 11] = 3
        return out

    level_a, level_b = _crop_level(data_a), _crop_level(data_b)
    LEVEL_NAMES = {0: "Non-Crop", 1: "Single", 2: "Double", 3: "Triple"}

    transitions = {}
    for fl in range(4):
        for tl in range(4):
            if fl == tl:
                continue
            count = int(np.sum((level_a == fl) & (level_b == tl) & valid))
            if count == 0:
                continue
            label = f"{LEVEL_NAMES[fl]} To {LEVEL_NAMES[tl]}"
            transitions[label] = transitions.get(label, 0) + round(count * pixel_ha, 2)

    result = [{"category": k, "area_ha": round(v, 2)} for k, v in transitions.items()]
    result.sort(key=lambda x: x["area_ha"], reverse=True)

    # Total crop intensity upgrade
    upgrade = int(np.sum((level_b > level_a) & (level_a > 0) & valid))
    result.insert(0, {"category": "Total Intensity Upgrade", "area_ha": round(upgrade * pixel_ha, 2)})

    return result
