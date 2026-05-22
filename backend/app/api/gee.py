"""CSVAT — GEE Data Proxy API router.

Exposes endpoints that fetch raw satellite data from Google Earth Engine
and return it as JSON for client-side (Pyodide WASM) computation.
The backend acts purely as a data proxy — no analytics computation here.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.gee_service import (
    fetch_lulc_multi_year,
    fetch_water_multi_year,
    fetch_ndvi_multi_year,
    fetch_all,
    fetch_all_states,
    fetch_districts_in_state,
    fetch_tehsils_in_district,
    fetch_tehsils_in_state,
    fetch_villages_in_tehsil,
    fetch_villages_in_district,
    fetch_tehsil_geometry,
    fetch_district_geometry,
    fetch_state_geometry,
    debug_asset_properties,
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


# ─── Pan-India Admin Hierarchy Endpoints ────────────────────────────────────


@router.get("/states")
async def api_get_states():
    """Return all pan-India state/UT names from GEE State_pan_india asset.

    Results are cached in-process after the first call.
    """
    try:
        names = fetch_all_states()
        return {"status": "ok", "data": names}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")


@router.get("/districts")
async def api_get_districts(state: str = Query(..., min_length=2)):
    """Return all district names in a state from GEE District_pan_india asset.

    Results are cached per state after the first call.
    """
    try:
        names = fetch_districts_in_state(state)
        return {"status": "ok", "data": names}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")


@router.get("/tehsils")
async def api_get_tehsils(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
):
    """Return all tehsil names in a district from GEE SOI_tehsil asset.

    Results are cached per (state, district) pair after the first call.
    """
    try:
        names = fetch_tehsils_in_district(state, district)
        return {"status": "ok", "data": names}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")


@router.get("/village-geometries")
async def api_get_village_geometries(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
):
    """Return GeoJSON FeatureCollection of all villages in a tehsil.

    Queries GEE Village_pan_india filtered by state, district, and tehsil.
    Only vill_name and vill_ID properties are returned to keep payload small.
    """
    try:
        data = fetch_villages_in_tehsil(state, district, tehsil)
        return {"status": "ok", "data": data}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")


@router.get("/tehsils-by-state")
async def api_tehsils_by_state(state: str = Query(..., min_length=2)):
    """Fallback: return all tehsils in a state (when the state has no sub-districts)."""
    try:
        names = fetch_tehsils_in_state(state)
        return {"status": "ok", "data": names}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")


@router.get("/villages-by-district")
async def api_villages_by_district(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
):
    """Fallback: return all villages in a district (when the district has no tehsils)."""
    try:
        data = fetch_villages_in_district(state, district)
        return {"status": "ok", "data": data}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")


@router.get("/tehsil-geometry")
async def api_get_tehsil_geometry(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
):
    """Return GeoJSON Feature for the merged SOI_tehsil boundary of a tehsil.

    Used as a fallback when a tehsil has no villages in Village_pan_india.
    """
    try:
        feature = fetch_tehsil_geometry(state, district, tehsil)
        return {"status": "ok", "data": feature}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")


@router.get("/district-geometry")
async def api_get_district_geometry(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
):
    """Return GeoJSON Feature for the merged district boundary.

    Fallback when a district has no tehsils and no villages.
    """
    try:
        feature = fetch_district_geometry(state, district)
        return {"status": "ok", "data": feature}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")


@router.get("/state-geometry")
async def api_get_state_geometry(
    state: str = Query(..., min_length=2),
):
    """Return GeoJSON Feature for the state boundary.

    Last-resort fallback when a state has no districts, no tehsils, and no villages.
    """
    try:
        feature = fetch_state_geometry(state)
        return {"status": "ok", "data": feature}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")


@router.get("/debug-props")
async def api_debug_asset_props(asset: str = Query(...)):
    """Return the first feature of any GEE asset to reveal its property schema."""
    try:
        info = debug_asset_properties(asset)
        return {"status": "ok", "data": info}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE error: {e}")
