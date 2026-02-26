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
