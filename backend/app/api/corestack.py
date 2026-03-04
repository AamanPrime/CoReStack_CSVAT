"""CSVAT — CoRE Stack Proxy API router.

Proxies all CoRE Stack APIs for frontend consumption.
The frontend calls these endpoints instead of the external API directly,
keeping the API key server-side.
"""

import math
import logging
from fastapi import APIRouter, HTTPException, Query
from app.services.corestack_client import corestack_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/corestack", tags=["CoRE Stack"])


@router.get("/locations")
async def get_locations():
    """Proxy for get_active_locations — returns all active states/districts/tehsils."""
    try:
        data = await corestack_client.get_active_locations()
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_active_locations error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/admin-details")
async def get_admin_details(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
):
    """Resolve lat/lon to admin details (state, district, tehsil)."""
    try:
        data = await corestack_client.get_admin_details_by_latlon(latitude, longitude)
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_admin_details error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/mws-id")
async def get_mws_id(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
):
    """Resolve lat/lon to MWS ID + admin details."""
    try:
        data = await corestack_client.get_mwsid_by_latlon(latitude, longitude)
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_mwsid error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/village-geometries")
async def get_village_geometries(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
):
    """Get village boundary geometries (GeoJSON FeatureCollection) for a tehsil."""
    try:
        data = await corestack_client.get_village_geometries(state, district, tehsil)
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_village_geometries error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/mws-geometries")
async def get_mws_geometries(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
):
    """Get MWS polygon geometries (GeoJSON FeatureCollection) for a tehsil."""
    try:
        data = await corestack_client.get_mws_geometries(state, district, tehsil)
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_mws_geometries error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


def _sanitize_floats(obj):
    """Recursively replace NaN/Infinity with None so JSON serialization works."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_floats(v) for v in obj]
    return obj


@router.get("/tehsil-data")
async def get_tehsil_data(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
):
    """Get comprehensive MWS-level data for a tehsil."""
    try:
        data = await corestack_client.get_tehsil_data(state, district, tehsil)
        data = _sanitize_floats(data)
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_tehsil_data error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/layer-urls")
async def get_layer_urls(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
):
    """Get GeoServer layer download URLs for a tehsil."""
    try:
        data = await corestack_client.get_generated_layer_urls(state, district, tehsil)
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_layer_urls error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/mws-data")
async def get_mws_data(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
    mws_id: str = Query(..., min_length=1),
):
    """Get MWS time-series data (ET, runoff, precipitation, NDVI)."""
    try:
        data = await corestack_client.get_mws_data(state, district, tehsil, mws_id)
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_mws_data error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/kyl-indicators")
async def get_kyl_indicators(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
    mws_id: str = Query(..., min_length=1),
):
    """Get KYL indicators for a specific MWS."""
    try:
        data = await corestack_client.get_mws_kyl_indicators(
            state, district, tehsil, mws_id,
        )
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_kyl_indicators error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/mws-report")
async def get_mws_report(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
    mws_id: str = Query(..., min_length=1),
):
    """Get MWS report URL."""
    try:
        data = await corestack_client.get_mws_report(
            state, district, tehsil, mws_id,
        )
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_mws_report error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/waterbodies")
async def get_waterbodies(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
):
    """Get all waterbodies in a tehsil."""
    try:
        data = await corestack_client.get_waterbodies_by_admin(state, district, tehsil)
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_waterbodies error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")


@router.get("/waterbody")
async def get_waterbody(
    state: str = Query(..., min_length=2),
    district: str = Query(..., min_length=2),
    tehsil: str = Query(..., min_length=2),
    uid: str = Query(..., min_length=1),
):
    """Get detailed data for a specific waterbody."""
    try:
        data = await corestack_client.get_waterbody_data(
            state, district, tehsil, uid,
        )
        return {"status": "ok", "data": data}
    except Exception as e:
        logger.error("get_waterbody error: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack error: {e}")
