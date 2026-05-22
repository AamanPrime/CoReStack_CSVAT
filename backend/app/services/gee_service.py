"""
CSVAT — Google Earth Engine Service (ee library + Service Account).

Uses the `ee` Python library with a service account JSON key for authentication.
Fetches MODIS LULC, JRC Surface Water, MODIS NDVI for any polygon geometry.
All heavy computation happens on GEE servers; aggregated results are returned.
"""

import os
import json
import logging
import ee
from functools import lru_cache
from app.config import get_settings

logger = logging.getLogger(__name__)

# ─── Global initialisation (once per process) ───

_ee_initialised = False


def _init_ee():
    """Initialize Earth Engine with service account credentials (idempotent)."""
    global _ee_initialised
    if _ee_initialised:
        return

    key_file = get_settings().GEE_KEY_FILE
    service_account = get_settings().GEE_SERVICE_ACCOUNT
    project = get_settings().GEE_PROJECT

    if not key_file or not os.path.exists(key_file):
        raise RuntimeError(
            f"GEE service account key file not found: {key_file}. "
            "Set GEE_KEY_FILE in backend/.env to the path of your "
            "service account JSON key."
        )

    # Disable GCE metadata check (causes hangs outside GCE)
    os.environ.setdefault("GCE_METADATA_HOST", "none")

    try:
        credentials = ee.ServiceAccountCredentials(service_account, key_file)
        ee.Initialize(credentials, project=project)
        _ee_initialised = True
        logger.info("Earth Engine initialized (project=%s, sa=%s)", project, service_account)
    except Exception as exc:
        logger.error("Failed to initialize Earth Engine: %s", exc)
        raise


# ─── MODIS Land-Cover (LULC) ───

LULC_CLASS_NAMES = {
    1: "Evergreen Needleleaf Forests",
    2: "Evergreen Broadleaf Forests",
    3: "Deciduous Needleleaf Forests",
    4: "Deciduous Broadleaf Forests",
    5: "Mixed Forests",
    6: "Closed Shrublands",
    7: "Open Shrublands",
    8: "Woody Savannas",
    9: "Savannas",
    10: "Grasslands",
    11: "Permanent Wetlands",
    12: "Croplands",
    13: "Urban and Built-up Lands",
    14: "Cropland/Natural Vegetation Mosaics",
    15: "Permanent Snow and Ice",
    16: "Barren",
    17: "Water Bodies",
}


def fetch_lulc(geometry: dict, year: int) -> dict:
    """Fetch MODIS MCD12Q1 land-cover histogram for a polygon/year.

    Returns: {
        "histogram": {"Croplands": 46.8, "Urban": 58.3, ...},
        "raw": {"12": 46.8, "13": 58.3, ...},
        "year": 2020,
    }
    """
    _init_ee()

    geom = ee.Geometry(geometry)
    image = (
        ee.ImageCollection("MODIS/061/MCD12Q1")
        .filterDate(f"{year}-01-01", f"{year}-12-31")
        .first()
        .select("LC_Type1")
    )

    result = image.reduceRegion(
        reducer=ee.Reducer.frequencyHistogram(),
        geometry=geom,
        scale=500,
        bestEffort=True,
    ).getInfo()

    raw = result.get("LC_Type1", {})
    histogram = {}
    for class_id, pixel_count in raw.items():
        class_name = LULC_CLASS_NAMES.get(int(class_id), f"Class_{class_id}")
        histogram[class_name] = pixel_count

    return {"histogram": histogram, "raw": raw, "year": year}


def fetch_lulc_multi_year(geometry: dict, start_year: int = 2017, end_year: int = 2023) -> list:
    """Fetch LULC for multiple years."""
    _init_ee()
    results = []
    for year in range(start_year, end_year + 1):
        try:
            data = fetch_lulc(geometry, year)
            results.append(data)
        except Exception as e:
            logger.warning("LULC fetch failed for year %d: %s", year, e)
            results.append({"histogram": {}, "raw": {}, "year": year})
    return results


# ─── JRC Surface Water ───

def fetch_water(geometry: dict, year: int) -> dict:
    """Fetch JRC Global Surface Water statistics for a polygon/year.

    Returns: {
        "occurrence_mean": 45.2,   // % of time water present (0-100)
        "water_class_hist": {"0": ..., "1": ..., "2": ..., "3": ...},
        "year": 2020,
    }
    JRC YearlyHistory classes: 0=nodata, 1=not water, 2=seasonal, 3=permanent
    """
    _init_ee()
    geom = ee.Geometry(geometry)

    # Global occurrence (time-aggregated)
    occurrence = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence")
    occ_stats = occurrence.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geom,
        scale=30,
        bestEffort=True,
    ).getInfo()

    # Yearly water classification
    yearly = (
        ee.ImageCollection("JRC/GSW1_4/YearlyHistory")
        .filterDate(f"{year}-01-01", f"{year}-12-31")
        .first()
    )

    water_hist = {}
    if yearly:
        hist_result = yearly.reduceRegion(
            reducer=ee.Reducer.frequencyHistogram(),
            geometry=geom,
            scale=30,
            bestEffort=True,
        ).getInfo()
        water_hist = hist_result.get("waterClass", {})

    return {
        "occurrence_mean": occ_stats.get("occurrence", 0) or 0,
        "water_class_hist": water_hist,
        "year": year,
    }


def fetch_water_multi_year(geometry: dict, start_year: int = 2017, end_year: int = 2023) -> list:
    """Fetch water data for multiple years."""
    _init_ee()
    results = []
    for year in range(start_year, end_year + 1):
        try:
            data = fetch_water(geometry, year)
            results.append(data)
        except Exception as e:
            logger.warning("Water fetch failed for year %d: %s", year, e)
            results.append({"occurrence_mean": 0, "water_class_hist": {}, "year": year})
    return results


# ─── MODIS NDVI ───

def fetch_ndvi(geometry: dict, year: int) -> dict:
    """Fetch MODIS NDVI annual mean for a polygon/year.

    MODIS NDVI scale factor: 0.0001 (raw values are *10000)
    Returns: {"ndvi_mean": 0.456, "ndvi_max": 0.78, "year": 2020}
    """
    _init_ee()
    geom = ee.Geometry(geometry)

    ndvi = (
        ee.ImageCollection("MODIS/061/MOD13A2")
        .filterDate(f"{year}-01-01", f"{year}-12-31")
        .select("NDVI")
    )

    # Annual mean NDVI
    mean_img = ndvi.mean()
    mean_stats = mean_img.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geom,
        scale=500,
        bestEffort=True,
    ).getInfo()

    # Annual max NDVI
    max_img = ndvi.max()
    max_stats = max_img.reduceRegion(
        reducer=ee.Reducer.mean(),  # Mean of the max composite
        geometry=geom,
        scale=500,
        bestEffort=True,
    ).getInfo()

    # Apply MODIS NDVI scale factor (0.0001)
    ndvi_mean_raw = mean_stats.get("NDVI", 0) or 0
    ndvi_max_raw = max_stats.get("NDVI", 0) or 0

    return {
        "ndvi_mean": round(ndvi_mean_raw * 0.0001, 4),
        "ndvi_max": round(ndvi_max_raw * 0.0001, 4),
        "ndvi_mean_raw": ndvi_mean_raw,
        "year": year,
    }


def fetch_ndvi_multi_year(geometry: dict, start_year: int = 2017, end_year: int = 2023) -> list:
    """Fetch NDVI for multiple years."""
    _init_ee()
    results = []
    for year in range(start_year, end_year + 1):
        try:
            data = fetch_ndvi(geometry, year)
            results.append(data)
        except Exception as e:
            logger.warning("NDVI fetch failed for year %d: %s", year, e)
            results.append({"ndvi_mean": 0, "ndvi_max": 0, "year": year})
    return results


# ─── All-in-one fetch ───

def fetch_all(geometry: dict, start_year: int = 2017, end_year: int = 2023) -> dict:
    """Fetch LULC, Water, and NDVI data for a polygon across multiple years.

    This is the main entry point for the GEE API router.
    """
    _init_ee()

    return {
        "lulc": fetch_lulc_multi_year(geometry, start_year, end_year),
        "water": fetch_water_multi_year(geometry, start_year, end_year),
        "ndvi": fetch_ndvi_multi_year(geometry, start_year, end_year),
    }


# ─── CoRE Stack IndiaSAT LULC v3 (via GEE assets) ───

# GEE asset path template for IndiaSAT v3 LULC (10m resolution)
# Classes: 0=Background, 1=Built Up, 2=Kharif Water, 3=Kharif+Rabi Water,
#          4=Perennial Water, 5=Crops, 6=Trees, 7=Barren,
#          8=Single Kharif, 9=Single Non-Kharif, 10=Double, 11=Triple, 12=Shrubs
CORESTACK_LULC_ASSET = (
    "projects/corestack-datasets/assets/datasets/"
    "LULC_v3_river_basin/pan_india_lulc_v3_{start}_{end}"
)

# Fiscal year ranges (start_year, end_year) matching CoRE Stack naming
CORESTACK_FISCAL_YEARS = [
    (2017, 2018), (2018, 2019), (2019, 2020), (2020, 2021),
    (2021, 2022), (2022, 2023), (2023, 2024), (2024, 2025),
]


def fetch_corestack_lulc_pixels(geometry: dict, start_year: int, end_year: int) -> dict | None:
    """Extract IndiaSAT LULC v3 pixel array for a village polygon via GEE.

    Downloads a village-clipped GeoTIFF from GEE using getDownloadURL()
    in the image's NATIVE CRS (no reprojection = no resampling artifacts).
    Then reprojects the village geometry to match, and applies rasterio
    geometry_mask for precise clipping.

    This produces pixel-identical results to GeoServer WCS downloads.

    Returns same format as GeoServer /extract:
        {histogram, masked_pixels, fiscal_year, pixel_count, pixel_area_ha}
    Returns None if the asset doesn't exist or extraction fails.
    """
    _init_ee()

    import math
    import tempfile
    import httpx
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.warp import transform_geom
    from shapely.geometry import shape, mapping

    asset_path = CORESTACK_LULC_ASSET.format(start=start_year, end=end_year)
    fy_label = f"20{str(start_year)[-2:]}-{str(end_year)[-2:]}"

    try:
        image = ee.Image(asset_path).select("predicted_label")
        geom = ee.Geometry(geometry)

        # ── Get native CRS + transform from the image (matches GeoServer) ──
        proj_info = image.projection().getInfo()
        native_crs = proj_info.get("crs", "EPSG:4326")
        native_transform = proj_info.get("transform")  # [scaleX, shearX, translateX, shearY, scaleY, translateY]

        logger.info("GEE LULC %s: native CRS=%s, transform=%s", fy_label, native_crs, native_transform)

        # Build download params using native CRS (NO reprojection)
        download_params = {
            "region": geom,
            "format": "GEO_TIFF",
        }
        if native_transform and native_crs != "EPSG:4326":
            download_params["crs"] = native_crs
            download_params["crsTransform"] = native_transform
        else:
            # Fallback: use native CRS with scale=10
            download_params["crs"] = native_crs
            download_params["scale"] = 10

        url = image.getDownloadURL(download_params)

        logger.info("Downloading GEE GeoTIFF for %s (CRS=%s) …", fy_label, native_crs)
        resp = httpx.get(url, timeout=120.0, follow_redirects=True)
        if resp.status_code != 200:
            logger.warning("GEE download failed for %s: HTTP %s", fy_label, resp.status_code)
            return None

        content_type = resp.headers.get("content-type", "")
        if "json" in content_type or "html" in content_type:
            logger.warning("GEE returned error for %s: %s", fy_label, resp.text[:200])
            return None

        # ── Process with rasterio (native CRS) ──
        geom_shape = shape(geometry)  # Village geometry in EPSG:4326

        with tempfile.NamedTemporaryFile(suffix=".tiff", delete=True) as tmp:
            tmp.write(resp.content)
            tmp.flush()
            with rasterio.open(tmp.name) as src:
                raster_crs = str(src.crs)
                data = src.read(1)

                # Reproject village geometry from EPSG:4326 → raster's native CRS
                if raster_crs and raster_crs != "EPSG:4326":
                    geom_reprojected = transform_geom(
                        "EPSG:4326", raster_crs, mapping(geom_shape)
                    )
                    geom_native = shape(geom_reprojected)
                else:
                    geom_native = geom_shape

                # Precise village boundary mask in native CRS
                pmask = geometry_mask(
                    [mapping(geom_native)], out_shape=data.shape,
                    transform=src.transform, invert=True,
                )
                masked = np.where(pmask & (data != 0), data.astype(float), np.nan)
                valid = masked[~np.isnan(masked)]

                if len(valid) == 0:
                    logger.warning("No valid pixels for %s", fy_label)
                    return None

                # Compute pixel area from actual raster resolution
                res_x, res_y = abs(src.res[0]), abs(src.res[1])
                if raster_crs and "4326" not in raster_crs:
                    # Native CRS is in meters → pixel area = res_x * res_y m²
                    pixel_area_ha = (res_x * res_y) / 10_000
                else:
                    # CRS is in degrees → convert to meters
                    center_lat = (src.bounds.bottom + src.bounds.top) / 2
                    m_lat = 111_132.92 - 559.82 * math.cos(2 * math.radians(center_lat))
                    m_lon = 111_412.84 * math.cos(math.radians(center_lat))
                    pixel_area_ha = (res_x * m_lon) * (res_y * m_lat) / 10_000

                # Histogram: {class_id: count}
                histogram = {}
                for v in np.unique(valid):
                    histogram[str(int(v))] = int(np.sum(valid == v))

                # Spatially-ordered pixel values (row-major, preserves position)
                pixel_list = [int(v) for v in valid]

                logger.info("GEE LULC %s: %d pixels, pxha=%.6f, CRS=%s, histogram=%s",
                            fy_label, len(pixel_list), pixel_area_ha, raster_crs, histogram)

                return {
                    "fiscal_year": fy_label,
                    "histogram": histogram,
                    "masked_pixels": pixel_list,
                    "pixel_count": len(pixel_list),
                    "pixel_area_ha": round(pixel_area_ha, 8),
                }

    except Exception as e:
        logger.warning("GEE pixel extraction failed for %s: %s", asset_path, e)
        return None


def fetch_corestack_lulc_all_years(geometry: dict) -> tuple[list, float]:
    """Extract IndiaSAT LULC pixel arrays for ALL fiscal years via GEE.

    Downloads clipped GeoTIFFs and processes with rasterio for each year.
    Returns: (extracted_list, pixel_area_ha) matching raster_proxy /extract format.
    """
    _init_ee()

    extracted = []
    pixel_area_ha = 0.01  # 10m resolution

    for start_yr, end_yr in CORESTACK_FISCAL_YEARS:
        result = fetch_corestack_lulc_pixels(geometry, start_yr, end_yr)
        if result:
            extracted.append(result)
            pixel_area_ha = result["pixel_area_ha"]

    return extracted, pixel_area_ha


# ─── Admin Boundary Candidates (for client-side reverse geocoding) ───

# CoRE Stack pan-India admin FeatureCollections on GEE
ADMIN_ASSETS = {
    "state":    "projects/ext-datasets/assets/datasets/State_pan_india",
    "district": "projects/ext-datasets/assets/datasets/District_pan_india",
    "tehsil":   "projects/ext-datasets/assets/datasets/SOI_tehsil",
}

# Parent-level property name candidates (used to narrow district/tehsil by parent name).
# We try each property in order and use the first one found on the actual features.
PARENT_FILTER_PROPS = {
    # When filtering districts by state name, try these property names on the district FC:
    "district": ["state_name", "STATE_NAME", "st_nm", "st_name", "State", "STATE"],
    # When filtering tehsils by district name, try these on the tehsil FC:
    "tehsil":   ["dist_name", "DISTRICT", "dt_name", "district_name", "District", "DIST_NM"],
}


def fetch_admin_candidates(
    level: str,
    bbox: list[float],
) -> dict:
    """Return bbox-filtered admin boundary features for one hierarchy level.

    Backend work: one GEE filterBounds call (spatial-indexed, fast).
    Returns a tiny GeoJSON FeatureCollection (~3-20 features, few KB).
    All intersection area math is done client-side in the browser with turf.js.

    CoRE Stack GEE assets use KML-export format — features store only their own
    name in 'Name' property with no parent admin reference. All levels therefore
    use bbox-only filtering; the tight village bbox (~0.05°×0.05°) naturally
    returns only 1-5 candidates per level.

    Args:
        level: 'state' | 'district' | 'tehsil'
        bbox:  [minLng, minLat, maxLng, maxLat] in EPSG:4326

    Returns:
        GeoJSON FeatureCollection dict (geometry + all original properties
        so the browser can discover the name property at runtime).
    """
    _init_ee()

    if level not in ADMIN_ASSETS:
        raise ValueError(f"Unknown admin level: {level!r}. Must be one of {list(ADMIN_ASSETS)}")

    min_lng, min_lat, max_lng, max_lat = bbox
    region = ee.Geometry.Rectangle([min_lng, min_lat, max_lng, max_lat])

    fc = ee.FeatureCollection(ADMIN_ASSETS[level]).filterBounds(region)

    result = fc.getInfo()  # Returns GeoJSON FeatureCollection dict (tiny payload)
    logger.info(
        "admin_candidates level=%s bbox=%s → %d features",
        level, bbox, len((result or {}).get("features", [])),
    )
    return result or {"type": "FeatureCollection", "features": []}


# ─── Pan-India Admin Hierarchy for Dropdown Selectors ───────────────────────
#
# Actual schemas (verified via .first().getInfo() on live GEE assets):
#
#  State_pan_india    → { Name: "Andaman & Nicobar Islands" }
#  District_pan_india → { Name: "NICOBAR" }  ← NO state field — can't filter by state
#  SOI_tehsil         → { TEHSIL, District, STATE, Shape_Area, Shape_Leng }
#  Village_pan_india  → { name, district, state, sub_dist, uid, pc11_village_id, ... }
#
# Strategy:
#  • States    → State_pan_india.Name (aggregate_array)
#  • Districts → SOI_tehsil filtered by STATE, then distinct District values
#                (District_pan_india has no state field)
#  • Tehsils   → SOI_tehsil filtered by District (UPPERCASE match)
#  • Villages  → Village_pan_india filtered by sub_dist + district (lowercase)

_STATE_PROP       = "Name"       # State_pan_india
_TEHSIL_STATE_P   = "STATE"      # SOI_tehsil — UPPERCASE e.g. "ANDAMAN & NICOBAR"
_TEHSIL_DIST_P    = "District"   # SOI_tehsil — UPPERCASE e.g. "NICOBAR"
_TEHSIL_NAME_P    = "TEHSIL"     # SOI_tehsil — UPPERCASE e.g. "CAMPBELL BAY"
_VILL_NAME_P      = "name"       # Village_pan_india
_VILL_DIST_P      = "district"   # Village_pan_india — lowercase
_VILL_SUBDT_P     = "sub_dist"   # Village_pan_india — lowercase


def _find_prop(props: dict, candidates: list[str]) -> str | None:
    """Return the first candidate key present in the properties dict."""
    for c in candidates:
        if c in props:
            return c
    return None


def _get_sample_props(fc) -> dict:
    """Return the properties dict of the first feature in a FeatureCollection."""
    info = fc.first().getInfo()
    return (info or {}).get("properties") or {}


def _apply_filters(fc, filters: list):
    """Apply 0, 1, or multiple ee.Filters safely."""
    if not filters:
        return fc
    if len(filters) == 1:
        return fc.filter(filters[0])
    return fc.filter(ee.Filter.And(*filters))


@lru_cache(maxsize=1)
def fetch_all_states() -> list[str]:
    """Sorted list of all state/UT names from GEE State_pan_india (cached)."""
    _init_ee()
    fc = ee.FeatureCollection(ADMIN_ASSETS["state"])
    names = fc.aggregate_array(_STATE_PROP).distinct().sort().getInfo()
    logger.info("fetch_all_states: %d states", len(names or []))
    return sorted(str(n) for n in (names or []) if n)


@lru_cache(maxsize=64)
def fetch_districts_in_state(state: str) -> list[str]:
    """Sorted list of district names for a state.

    District_pan_india has no state field, so we use SOI_tehsil (which has STATE)
    and return its distinct District values for the matching state.
    """
    _init_ee()
    fc = ee.FeatureCollection(ADMIN_ASSETS["tehsil"])
    # STATE field is UPPERCASE; state arg comes from State_pan_india (Title Case)
    filtered = fc.filter(ee.Filter.stringContains(_TEHSIL_STATE_P, state.upper()))
    names = filtered.aggregate_array(_TEHSIL_DIST_P).distinct().sort().getInfo()
    logger.info("fetch_districts_in_state(%r): %d districts", state, len(names or []))
    return sorted(str(n) for n in (names or []) if n)


@lru_cache(maxsize=512)
def fetch_tehsils_in_district(state: str, district: str) -> list[str]:
    """Sorted list of tehsil names in a district from GEE SOI_tehsil (cached)."""
    _init_ee()
    fc = ee.FeatureCollection(ADMIN_ASSETS["tehsil"])
    # District field in SOI_tehsil is UPPERCASE
    filtered = fc.filter(ee.Filter.stringContains(_TEHSIL_DIST_P, district.upper()))
    names = filtered.aggregate_array(_TEHSIL_NAME_P).distinct().sort().getInfo()
    logger.info("fetch_tehsils_in_district(%r, %r): %d tehsils", state, district, len(names or []))
    return sorted(str(n) for n in (names or []) if n)


def _get_tehsil_geometry(district: str, tehsil: str) -> "ee.Geometry | None":
    """Return the merged geometry of all SOI_tehsil features matching district+tehsil."""
    fc = ee.FeatureCollection(ADMIN_ASSETS["tehsil"])
    matched = fc.filter(
        ee.Filter.And(
            ee.Filter.stringContains(_TEHSIL_DIST_P, district.upper()),
            ee.Filter.stringContains(_TEHSIL_NAME_P, tehsil.upper()),
        )
    )
    return matched.geometry()


def _get_district_geometry(state: str, district: str) -> "ee.Geometry | None":
    """Return the merged geometry of all SOI_tehsil features for a district."""
    fc = ee.FeatureCollection(ADMIN_ASSETS["tehsil"])
    matched = fc.filter(
        ee.Filter.And(
            ee.Filter.stringContains(_TEHSIL_STATE_P, state.upper()),
            ee.Filter.stringContains(_TEHSIL_DIST_P, district.upper()),
        )
    )
    return matched.geometry()


def _get_state_geometry(state: str) -> "ee.Geometry | None":
    """Return the geometry of the given state from State_pan_india."""
    fc = ee.FeatureCollection(ADMIN_ASSETS["state"])
    matched = fc.filter(ee.Filter.stringContains(_STATE_PROP, state))
    return matched.geometry()


def _villages_within(geometry, limit: int = 600) -> dict:
    """Return Village_pan_india features within the given geometry (spatial filter)."""
    village_fc = ee.FeatureCollection("projects/ext-datasets/assets/datasets/Village_pan_india")
    filtered = village_fc.filterBounds(geometry).limit(limit)
    filtered = filtered.select([_VILL_NAME_P, "uid", "pc11_village_id"])
    result = filtered.getInfo()
    return result or {"type": "FeatureCollection", "features": []}


def fetch_villages_in_tehsil(state: str, district: str, tehsil: str) -> dict:
    """GeoJSON FeatureCollection of villages in a tehsil.

    Uses spatial filterBounds on the SOI_tehsil geometry — avoids relying on
    Village_pan_india numeric property codes which can't be string-filtered.
    """
    _init_ee()
    geom = _get_tehsil_geometry(district, tehsil)
    result = _villages_within(geom)
    count = len((result or {}).get("features", []))
    logger.info("fetch_villages_in_tehsil(%r/%r/%r) → %d features", state, district, tehsil, count)
    return result


def fetch_tehsil_geometry(state: str, district: str, tehsil: str) -> dict:
    """GeoJSON Feature representing the merged tehsil boundary from SOI_tehsil.

    Used as a fallback when a tehsil has no village-level records in Village_pan_india.
    Returns a GeoJSON Feature dict with a 'geometry' key, or raises ValueError if not found.
    """
    _init_ee()
    fc = ee.FeatureCollection(ADMIN_ASSETS["tehsil"])
    matched = fc.filter(
        ee.Filter.And(
            ee.Filter.stringContains(_TEHSIL_DIST_P, district.upper()),
            ee.Filter.stringContains(_TEHSIL_NAME_P, tehsil.upper()),
        )
    )
    # Dissolve into a single geometry and return as a Feature
    geom = matched.geometry()
    feature_info = ee.Feature(geom, {
        "tehsil": tehsil,
        "district": district,
        "state": state,
        "source": "SOI_tehsil",
    }).getInfo()
    count = matched.size().getInfo()
    logger.info("fetch_tehsil_geometry(%r/%r/%r) → matched %d SOI features", state, district, tehsil, count)
    if not feature_info or not feature_info.get("geometry"):
        raise ValueError(f"No tehsil geometry found for {tehsil} in {district}, {state}")
    return feature_info


def fetch_district_geometry(state: str, district: str) -> dict:
    """GeoJSON Feature representing the merged district boundary from SOI_tehsil.

    Used as a fallback when a district has no tehsils and no villages in GEE.
    Returns a GeoJSON Feature dict, or raises ValueError if not found.
    """
    _init_ee()
    fc = ee.FeatureCollection(ADMIN_ASSETS["tehsil"])
    matched = fc.filter(
        ee.Filter.And(
            ee.Filter.stringContains(_TEHSIL_STATE_P, state.upper()),
            ee.Filter.stringContains(_TEHSIL_DIST_P, district.upper()),
        )
    )
    geom = matched.geometry()
    feature_info = ee.Feature(geom, {
        "district": district,
        "state": state,
        "source": "SOI_tehsil",
        "level": "district",
    }).getInfo()
    count = matched.size().getInfo()
    logger.info("fetch_district_geometry(%r/%r) → matched %d SOI features", state, district, count)
    if not feature_info or not feature_info.get("geometry"):
        raise ValueError(f"No district geometry found for {district} in {state}")
    return feature_info


def fetch_state_geometry(state: str) -> dict:
    """GeoJSON Feature representing the state boundary from State_pan_india.

    Used as a last-resort fallback when a state has no districts, no tehsils, and no villages.
    Returns a GeoJSON Feature dict, or raises ValueError if not found.
    """
    _init_ee()
    fc = ee.FeatureCollection(ADMIN_ASSETS["state"])
    matched = fc.filter(ee.Filter.stringContains(_STATE_PROP, state))
    geom = matched.geometry()
    feature_info = ee.Feature(geom, {
        "state": state,
        "source": "State_pan_india",
        "level": "state",
    }).getInfo()
    count = matched.size().getInfo()
    logger.info("fetch_state_geometry(%r) → matched %d state features", state, count)
    if not feature_info or not feature_info.get("geometry"):
        raise ValueError(f"No state geometry found for {state}")
    return feature_info



@lru_cache(maxsize=64)
def fetch_tehsils_in_state(state: str) -> list[str]:
    """Sorted list of tehsil names for an entire state (fallback when state has no districts).

    Used by the adaptive cascade: State → [skip district] → Tehsil → Village.
    """
    _init_ee()
    fc = ee.FeatureCollection(ADMIN_ASSETS["tehsil"])
    filtered = fc.filter(ee.Filter.stringContains(_TEHSIL_STATE_P, state.upper()))
    names = filtered.aggregate_array(_TEHSIL_NAME_P).distinct().sort().getInfo()
    logger.info("fetch_tehsils_in_state(%r): %d tehsils", state, len(names or []))
    return sorted(str(n) for n in (names or []) if n)


def fetch_villages_in_district(state: str, district: str) -> dict:
    """Villages for an entire district (fallback when district has no tehsils).

    Uses spatial filterBounds on the SOI_tehsil district geometry.
    """
    _init_ee()
    geom = _get_district_geometry(state, district)
    result = _villages_within(geom)
    count = len((result or {}).get("features", []))
    logger.info("fetch_villages_in_district(%r/%r) → %d features", state, district, count)
    return result


def debug_asset_properties(asset_path: str) -> dict:
    """Return the first GEE feature of an asset to inspect its property schema.

    Call via: GET /api/v1/gee/debug-props?asset=projects/ext-datasets/assets/datasets/SOI_tehsil
    """
    _init_ee()
    return ee.FeatureCollection(asset_path).first().getInfo() or {}

