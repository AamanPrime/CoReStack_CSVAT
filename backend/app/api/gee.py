"""CSVAT — GEE Data Proxy API router.

Exposes endpoints that fetch raw satellite data from Google Earth Engine
and return it as JSON for client-side (Pyodide WASM) computation.
The backend acts purely as a data proxy — no analytics computation here.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.gee_service import (
    fetch_lulc_multi_year,
    fetch_water_multi_year,
    fetch_ndvi_multi_year,
    fetch_all,
)

router = APIRouter(prefix="/api/v1/gee", tags=["GEE Data Proxy"])


class GEEDataRequest(BaseModel):
    """Request body for GEE data endpoints."""
    geojson: dict  # GeoJSON Polygon geometry
    years: list[int] = [2017, 2018, 2019, 2020, 2021, 2022, 2023]


def _extract_geometry(geojson: dict) -> dict:
    """Extract Polygon geometry from various GeoJSON formats."""
    t = geojson.get("type", "")
    if t == "FeatureCollection":
        return geojson["features"][0]["geometry"]
    if t == "Feature":
        return geojson["geometry"]
    if t in ("Polygon", "MultiPolygon"):
        return geojson
    raise ValueError(f"Unsupported GeoJSON type: {t}")


@router.post("/lulc")
async def api_fetch_lulc(request: GEEDataRequest):
    """Fetch MODIS LULC histograms for a polygon across years."""
    try:
        geometry = _extract_geometry(request.geojson)
        data = fetch_lulc_multi_year(geometry, min(request.years), max(request.years))
        return {"status": "ok", "data": data, "source": "GEE/MODIS/MCD12Q1"}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {str(e)}")


@router.post("/water")
async def api_fetch_water(request: GEEDataRequest):
    """Fetch JRC Surface Water stats for a polygon across years."""
    try:
        geometry = _extract_geometry(request.geojson)
        data = fetch_water_multi_year(geometry, min(request.years), max(request.years))
        return {"status": "ok", "data": data, "source": "GEE/JRC/GSW1_4"}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {str(e)}")


@router.post("/ndvi")
async def api_fetch_ndvi(request: GEEDataRequest):
    """Fetch MODIS NDVI means for a polygon across years."""
    try:
        geometry = _extract_geometry(request.geojson)
        data = fetch_ndvi_multi_year(geometry, min(request.years), max(request.years))
        return {"status": "ok", "data": data, "source": "GEE/MODIS/MOD13A2"}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {str(e)}")


@router.post("/all")
async def api_fetch_all(request: GEEDataRequest):
    """Fetch all GEE datasets (LULC + Water + NDVI) in one call."""
    errors = []
    geometry = _extract_geometry(request.geojson)

    lulc = water = ndvi = None
    try:
        lulc = fetch_lulc_multi_year(geometry, min(request.years), max(request.years))
    except Exception as e:
        errors.append(f"LULC: {e}")

    try:
        water = fetch_water_multi_year(geometry, min(request.years), max(request.years))
    except Exception as e:
        errors.append(f"Water: {e}")

    try:
        ndvi = fetch_ndvi_multi_year(geometry, min(request.years), max(request.years))
    except Exception as e:
        errors.append(f"NDVI: {e}")

    return {
        "status": "ok" if not errors else "partial",
        "data": {"lulc": lulc, "water": water, "ndvi": ndvi},
        "errors": errors or None,
    }
