"""
raster_service.py
─────────────────
Real raster clipping and analytics from CoRE Stack LULC GeoTIFF.

Workflow:
  1.  Receive a GeoJSON geometry (Polygon / MultiPolygon).
  2.  Open the pan-India LULC TIFF with rasterio.
  3.  Clip the raster to the geometry using rasterio.mask.mask().
  4.  Count pixels per LULC class.
  5.  Convert pixel counts → hectares using pixel area at the centroid latitude.
  6.  Return structured dicts matching the same schema that data_service.py
      produces, so the frontend never needs to change.

LULC Class Legend (IndiaSAT v3):
  0  Background
  1  Built Up
  2  Kharif Water           (Surface water — monsoon only)
  3  Kharif + Rabi Water    (Surface water — monsoon + winter)
  4  Kharif+Rabi+Zaid Water (Perennial water)
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

import numpy as np
import rasterio
from rasterio.mask import mask as rasterio_mask
from shapely.geometry import shape, mapping

logger = logging.getLogger(__name__)

# ── Paths ────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Also search the project root (X:\CoreStack) where large TIFFs may live
# Resolve: backend/app/services/ -> backend/app/ -> backend/ -> project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent

# Single year TIFF available — future: dict of {year: path}
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
            if key not in LULC_TIFFS:  # don't override data/ with project root
                LULC_TIFFS[key] = p
                logger.info(f"Registered LULC TIFF: {key} → {p}")

# Search bundled data dir first, then project root
_register_tiffs_from(DATA_DIR)
_register_tiffs_from(PROJECT_ROOT)

# ── Class mappings ───────────────────────────────────────────────────
CROP_CLASSES = {
    8:  "single_kharif",
    9:  "single_non_kharif",
    10: "double_cropping",
    11: "triple_cropping",
}

WATER_CLASSES = {
    2: "kharif_water",
    3: "kharif_rabi_water",
    4: "perennial_water",
}

VEGETATION_CLASSES = {
    6:  "trees",
    7:  "barren",
    12: "shrubs_scrubs",
}

# ── Pixel area helper ────────────────────────────────────────────────
def _pixel_area_ha(res_deg: float, centroid_lat_deg: float) -> float:
    """
    Convert a square pixel of side `res_deg` (degrees) to hectares.
    Uses WGS-84 approximation at the given latitude.
    """
    lat_rad = math.radians(centroid_lat_deg)
    # metres per degree
    m_per_deg_lat = 111_132.92 - 559.82 * math.cos(2 * lat_rad) + 1.175 * math.cos(4 * lat_rad)
    m_per_deg_lon = 111_412.84 * math.cos(lat_rad) - 93.5 * math.cos(3 * lat_rad)
    pixel_area_m2 = (res_deg * m_per_deg_lat) * (res_deg * m_per_deg_lon)
    return pixel_area_m2 / 10_000  # m² → ha


# ── Core clip + count function ───────────────────────────────────────
def clip_and_count(geojson_geometry: dict, tiff_path: Path) -> tuple[dict[int, int], float, float]:
    """
    Clip `tiff_path` to `geojson_geometry` and return:
      - class_counts  : {class_int: pixel_count}
      - pixel_ha      : hectares per pixel
      - total_ha      : total non-NaN area in hectares
    """
    geom = shape(geojson_geometry)

    with rasterio.open(tiff_path) as src:
        # Centroid latitude for pixel area calculation
        centroid_lat = geom.centroid.y
        res = src.res[0]  # degrees (square pixels)
        pixel_ha = _pixel_area_ha(res, centroid_lat)

        try:
            out_image, _ = rasterio_mask(
                src,
                [mapping(geom)],
                crop=True,
                nodata=np.nan,
                all_touched=True,
            )
        except Exception as exc:
            raise ValueError(f"Raster clip failed: {exc}") from exc

        data = out_image[0]

        # Flatten and remove NaN / background
        flat = data.flatten()
        valid = flat[~np.isnan(flat)]

        class_counts: dict[int, int] = {}
        for cls in np.unique(valid):
            cls_int = int(cls)
            class_counts[cls_int] = int(np.sum(valid == cls))

        total_pixels = len(valid)
        total_ha = total_pixels * pixel_ha

    return class_counts, pixel_ha, total_ha


# ── Public API ───────────────────────────────────────────────────────

def available_years() -> list[str]:
    """Return list of years for which we have LULC TIFFs."""
    return sorted(LULC_TIFFS.keys())


def get_cropping_intensity(geojson_geometry: dict) -> list[dict]:
    """
    Compute cropping intensity stats from all available year TIFFs.
    Returns list of year records matching the data_service schema.
    """
    records = []
    for year, tiff_path in sorted(LULC_TIFFS.items()):
        try:
            counts, pixel_ha, total_ha = clip_and_count(geojson_geometry, tiff_path)

            single_kharif_ha   = counts.get(8,  0) * pixel_ha
            single_nkharif_ha  = counts.get(9,  0) * pixel_ha
            double_ha          = counts.get(10, 0) * pixel_ha
            triple_ha          = counts.get(11, 0) * pixel_ha
            single_ha          = single_kharif_ha + single_nkharif_ha

            # Cropping intensity = (single + 2*double + 3*triple) / total_crop_area
            crop_area = single_ha + double_ha + triple_ha
            if crop_area > 0:
                ci = (single_ha + 2 * double_ha + 3 * triple_ha) / crop_area
            else:
                ci = 0.0

            records.append({
                "year":                  year,
                "cropping_intensity":    round(ci, 3),
                "single_crop_area_ha":  round(single_ha, 2),
                "double_crop_area_ha":  round(double_ha, 2),
                "triple_crop_area_ha":  round(triple_ha, 2),
            })
        except Exception as exc:
            logger.warning(f"Skipping TIFF {year}: {exc}")

    return records


def get_surface_water(geojson_geometry: dict) -> list[dict]:
    """
    Compute surface water stats from all available year TIFFs.
    Returns list of year records matching the data_service schema.
    """
    records = []
    for year, tiff_path in sorted(LULC_TIFFS.items()):
        try:
            counts, pixel_ha, total_ha = clip_and_count(geojson_geometry, tiff_path)

            kharif_ha   = counts.get(2, 0) * pixel_ha   # monsoon water
            rabi_ha     = counts.get(3, 0) * pixel_ha   # winter water
            zaid_ha     = counts.get(4, 0) * pixel_ha   # perennial water
            total_w_ha  = kharif_ha + rabi_ha + zaid_ha

            records.append({
                "year":          year,
                "total_area_ha": round(total_w_ha, 2),
                "kharif_area_ha": round(kharif_ha, 2),
                "rabi_area_ha":   round(rabi_ha, 2),
                "zaid_area_ha":   round(zaid_ha, 2),
            })
        except Exception as exc:
            logger.warning(f"Skipping TIFF {year}: {exc}")

    return records


def get_vegetation(geojson_geometry: dict) -> list[dict]:
    """
    Compute vegetation / degradation stats from ALL available TIFFs.
    Returns per-year records so the frontend can show trends.
    """
    if not LULC_TIFFS:
        return []

    label_map = {
        6:  "Trees",
        7:  "Barren Land",
        12: "Shrubs And Scrubs",
        1:  "Built Up",
    }

    records = []
    for year, tiff_path in sorted(LULC_TIFFS.items()):
        try:
            counts, pixel_ha, _ = clip_and_count(geojson_geometry, tiff_path)
            entry = {"year": year}
            for cls, label in label_map.items():
                entry[label.lower().replace(" ", "_") + "_ha"] = round(
                    counts.get(cls, 0) * pixel_ha, 2
                )
            records.append(entry)
        except Exception as exc:
            logger.warning(f"Vegetation skip {year}: {exc}")

    return records


def get_vegetation_snapshot(geojson_geometry: dict) -> list[dict]:
    """
    Single-year vegetation breakdown for bar/pie charts.
    Uses latest TIFF.
    """
    if not LULC_TIFFS:
        return []

    latest_year = sorted(LULC_TIFFS.keys())[-1]
    counts, pixel_ha, _ = clip_and_count(geojson_geometry, LULC_TIFFS[latest_year])

    label_map = {
        6:  "Trees",
        7:  "Barren Land",
        12: "Shrubs And Scrubs",
        1:  "Built Up",
    }

    return [
        {"category": label, "area_ha": round(counts.get(cls, 0) * pixel_ha, 2)}
        for cls, label in label_map.items()
    ]


def get_tree_cover_change(geojson_geometry: dict) -> dict:
    """
    Compute tree-cover transitions between the EARLIEST and LATEST
    available TIFF years by doing pixel-level comparison.

    For each pixel that was Trees (class 6) in year_A, classify what
    it became in year_B.  Returns:
      - year_from / year_to
      - tree_area_from_ha / tree_area_to_ha
      - net_change_ha  (negative = loss)
      - transitions: list of {from_class, to_label, area_ha}
      - degraded_ha: total hectares lost from tree class

    If only 1 TIFF is available, returns a snapshot with no transitions.
    """
    years_sorted = sorted(LULC_TIFFS.keys())

    if not years_sorted:
        return {"error": "No LULC TIFFs available."}

    if len(years_sorted) == 1:
        # Single year — just return the current tree area
        year = years_sorted[0]
        counts, pixel_ha, _ = clip_and_count(geojson_geometry, LULC_TIFFS[year])
        tree_ha = round(counts.get(6, 0) * pixel_ha, 2)
        return {
            "year_from":        year,
            "year_to":          year,
            "tree_area_from_ha": tree_ha,
            "tree_area_to_ha":  tree_ha,
            "net_change_ha":    0.0,
            "degraded_ha":      0.0,
            "transitions":      [],
            "note": "Only 1 TIFF year available. Add more years for transition analysis.",
        }

    year_a, year_b = years_sorted[0], years_sorted[-1]
    geom = shape(geojson_geometry)

    # Clip both years to the same geometry
    with rasterio.open(LULC_TIFFS[year_a]) as src_a:
        centroid_lat = geom.centroid.y
        pixel_ha = _pixel_area_ha(src_a.res[0], centroid_lat)
        img_a, transform_a = rasterio_mask(
            src_a, [mapping(geom)], crop=True, nodata=np.nan, all_touched=True
        )

    with rasterio.open(LULC_TIFFS[year_b]) as src_b:
        img_b, _ = rasterio_mask(
            src_b, [mapping(geom)], crop=True, nodata=np.nan, all_touched=True
        )

    data_a = img_a[0]
    data_b = img_b[0]

    # Align shapes (they should match since same geometry, but safety check)
    min_rows = min(data_a.shape[0], data_b.shape[0])
    min_cols = min(data_a.shape[1], data_b.shape[1])
    data_a = data_a[:min_rows, :min_cols]
    data_b = data_b[:min_rows, :min_cols]

    # Mask valid pixels (non-NaN in both)
    valid_mask = ~np.isnan(data_a) & ~np.isnan(data_b)

    # Tree in year A
    tree_mask_a = (data_a == 6) & valid_mask
    tree_mask_b = (data_b == 6) & valid_mask

    tree_pixels_a = int(np.sum(tree_mask_a))
    tree_pixels_b = int(np.sum(tree_mask_b))
    tree_ha_a = round(tree_pixels_a * pixel_ha, 2)
    tree_ha_b = round(tree_pixels_b * pixel_ha, 2)
    net_change = round(tree_ha_b - tree_ha_a, 2)

    # Where trees were lost: pixels that were 6 in A but NOT 6 in B
    lost_mask = tree_mask_a & (data_b != 6)
    lost_vals = data_b[lost_mask]

    CLASS_LABELS = {
        0: "Background", 1: "Built Up", 2: "Kharif Water",
        3: "Kharif+Rabi Water", 4: "Perennial Water",
        5: "Crops", 7: "Barren Land",
        8: "Single Kharif Crop", 9: "Single Non-Kharif Crop",
        10: "Double Cropping", 11: "Triple Cropping",
        12: "Shrubs And Scrubs",
    }

    transitions = []
    degraded_total = 0.0
    for cls in np.unique(lost_vals):
        cls_int = int(cls)
        if np.isnan(cls) or cls_int == 6:
            continue
        count = int(np.sum(lost_vals == cls))
        area = round(count * pixel_ha, 2)
        degraded_total += area
        transitions.append({
            "from_class": "Trees",
            "to_label": CLASS_LABELS.get(cls_int, f"Class {cls_int}"),
            "to_class": cls_int,
            "area_ha": area,
        })

    # Sort by area descending
    transitions.sort(key=lambda x: x["area_ha"], reverse=True)

    return {
        "year_from":         year_a,
        "year_to":           year_b,
        "tree_area_from_ha": tree_ha_a,
        "tree_area_to_ha":   tree_ha_b,
        "net_change_ha":     net_change,
        "degraded_ha":       round(degraded_total, 2),
        "transitions":       transitions,
    }


def get_crop_intensity_change(geojson_geometry: dict) -> list[dict]:
    """
    Compute cropping-intensity transitions between the earliest and latest
    TIFF years using pixel-level comparison of crop classes (8,9,10,11).

    Returns a list like:
      [{"category": "Single To Double", "area_ha": 123.45}, ...]
    """
    years_sorted = sorted(LULC_TIFFS.keys())

    if len(years_sorted) < 2:
        return []

    year_a, year_b = years_sorted[0], years_sorted[-1]
    geom = shape(geojson_geometry)

    with rasterio.open(LULC_TIFFS[year_a]) as src_a:
        centroid_lat = geom.centroid.y
        pixel_ha = _pixel_area_ha(src_a.res[0], centroid_lat)
        img_a, _ = rasterio_mask(
            src_a, [mapping(geom)], crop=True, nodata=np.nan, all_touched=True
        )

    with rasterio.open(LULC_TIFFS[year_b]) as src_b:
        img_b, _ = rasterio_mask(
            src_b, [mapping(geom)], crop=True, nodata=np.nan, all_touched=True
        )

    data_a = img_a[0]
    data_b = img_b[0]

    # Align shapes
    min_rows = min(data_a.shape[0], data_b.shape[0])
    min_cols = min(data_a.shape[1], data_b.shape[1])
    data_a = data_a[:min_rows, :min_cols]
    data_b = data_b[:min_rows, :min_cols]

    valid_mask = ~np.isnan(data_a) & ~np.isnan(data_b)

    # Reclassify: 8,9->single  10->double  11->triple
    def _crop_level(arr):
        out = np.full_like(arr, 0, dtype=np.int8)
        out[(arr == 8) | (arr == 9)] = 1   # single
        out[arr == 10] = 2                  # double
        out[arr == 11] = 3                  # triple
        return out

    level_a = _crop_level(data_a)
    level_b = _crop_level(data_b)

    LEVEL_NAMES = {0: "Non-Crop", 1: "Single", 2: "Double", 3: "Triple"}

    transitions = {}
    for from_lev in range(0, 4):
        for to_lev in range(0, 4):
            if from_lev == to_lev:
                continue
            mask = (level_a == from_lev) & (level_b == to_lev) & valid_mask
            count = int(np.sum(mask))
            if count == 0:
                continue
            area = round(count * pixel_ha, 2)
            from_name = LEVEL_NAMES[from_lev]
            to_name = LEVEL_NAMES[to_lev]
            label = f"{from_name} To {to_name}"
            transitions[label] = transitions.get(label, 0) + area

    # Also add a "Total Change Crop Intensity" summary
    # = total area that moved to a HIGHER cropping level
    upgrade_mask = (level_b > level_a) & (level_a > 0) & valid_mask
    total_upgrade = round(int(np.sum(upgrade_mask)) * pixel_ha, 2)

    result = [{"category": k, "area_ha": round(v, 2)} for k, v in transitions.items()]
    result.sort(key=lambda x: x["area_ha"], reverse=True)

    # Prepend total intensity change
    result.insert(0, {"category": "Total Change Crop Intensity", "area_ha": total_upgrade})

    return result


def get_summary(geojson_geometry: dict) -> dict:
    """
    Return total non-background area and pixel ha for a geometry.
    Uses the latest available TIFF.
    """
    if not LULC_TIFFS:
        return {"total_area_ha": 0.0, "mws_count": 0}

    latest_year = sorted(LULC_TIFFS.keys())[-1]
    counts, pixel_ha, total_ha = clip_and_count(geojson_geometry, LULC_TIFFS[latest_year])

    # Exclude background (class 0) from total
    bg_pixels = counts.get(0, 0)
    non_bg_ha = total_ha - (bg_pixels * pixel_ha)

    return {
        "total_area_ha": round(max(non_bg_ha, total_ha), 2),
        "mws_count":     1,  # a single uploaded boundary = 1 unit
    }
