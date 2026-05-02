"""CSVAT — Raster Proxy API.

Constructs GeoServer WCS URLs for CoRE Stack raster layers and proxies
GeoTIFF downloads through our backend (to handle CORS and API keys).

GeoServer URL pattern (from CoRE Stack's own website):
  https://geoserver.core-stack.org:8443/geoserver/{workspace}/wcs
    ?service=WCS&version=2.0.1&request=GetCoverage
    &CoverageId={workspace}:{layer_prefix}_{YY_YY}_{district}_{tehsil}_{suffix}
    &format=geotiff&compression=LZW&tiling=false

Known workspaces:
  - LULC_level_3       → Cropping intensity (single/double/triple crop classification)

Coverage ID naming convention:
  - LULC: LULC_{start_YY}_{end_YY}_{district}_{tehsil}_level_3

Surface water data comes from the CoRE Stack tehsil vector API
(surfaceWaterBodies_annual), NOT rasters — it only exists as a vector layer.
"""

import logging
from functools import lru_cache
from urllib.parse import unquote

import httpx
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response, StreamingResponse

from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/raster", tags=["Raster Proxy"])

GEOSERVER_BASE = "https://geoserver.core-stack.org:8443/geoserver"

# Known raster layer definitions
# Each entry: workspace, coverage_id_template, description
# In the template: {district}, {tehsil}, {yy_start}, {yy_end} will be replaced
RASTER_LAYER_DEFS = [
    {
        "category": "cropping_intensity",
        "workspace": "LULC_level_3",
        "coverage_template": "LULC_level_3:LULC_{yy_start}_{yy_end}_{district}_{tehsil}_level_3",
        "description": "LULC Classification (Single/Double/Triple Crop)",
    },
    # NOTE: Surface water does NOT exist as raster on GeoServer.
    # It's served as vector layer (workspace: swb). Water data is fetched
    # from the CoRE Stack tehsil API (surfaceWaterBodies_annual) instead.
]

# Fiscal year ranges available on CoRE Stack (YY_YY format)
FISCAL_YEARS = [
    ("17", "18"),
    ("18", "19"),
    ("19", "20"),
    ("20", "21"),
    ("21", "22"),
    ("22", "23"),
    ("23", "24"),
    ("24", "25"),
]


def normalize_name(name: str) -> str:
    """Normalize state/district/tehsil names for GeoServer URL construction.

    CoRE Stack uses lowercase with underscores: 'Andhra Pradesh' → 'andhra_pradesh'
    """
    return name.strip().lower().replace(" ", "_").replace("-", "_")


@router.get("/layers")
async def get_raster_layers(
    state: str = Query(...),
    district: str = Query(...),
    tehsil: str = Query(...),
):
    """Construct GeoServer WCS download URLs for available raster layers.

    Instead of relying on the get_generated_layer_urls API (which only returns
    vector layers), we construct URLs directly using the known GeoServer pattern.
    """
    norm_district = normalize_name(district)
    norm_tehsil = normalize_name(tehsil)

    layers = []
    for layer_def in RASTER_LAYER_DEFS:
        for yy_start, yy_end in FISCAL_YEARS:
            coverage_id = layer_def["coverage_template"].format(
                district=norm_district,
                tehsil=norm_tehsil,
                yy_start=yy_start,
                yy_end=yy_end,
            )
            wcs_url = (
                f"{GEOSERVER_BASE}/{layer_def['workspace']}/wcs"
                f"?service=WCS&version=2.0.1&request=GetCoverage"
                f"&CoverageId={coverage_id}"
                f"&format=geotiff&compression=LZW&tiling=false"
            )
            fiscal_label = f"20{yy_start}-{yy_end}"
            layers.append({
                "category": layer_def["category"],
                "layer_name": f"{layer_def['description']} ({fiscal_label})",
                "layer_type": "raster",
                "layer_url": wcs_url,
                "coverage_id": coverage_id,
                "fiscal_year": fiscal_label,
                "workspace": layer_def["workspace"],
            })

    return {"status": "ok", "data": layers, "count": len(layers)}


@router.get("/download")
async def download_raster(
    url: str = Query(..., description="GeoServer WCS URL to proxy"),
):
    """Proxy a GeoTIFF download from CoRE Stack GeoServer.

    Streams the binary response back to the frontend.
    Returns Content-Type: image/tiff for GeoTIFF files.
    """
    settings = get_settings()
    decoded_url = unquote(url)

    # Security: only proxy URLs from known CoRE Stack GeoServer
    if "geoserver.core-stack.org" not in decoded_url:
        raise HTTPException(
            status_code=403,
            detail="Only CoRE Stack GeoServer URLs can be proxied.",
        )

    try:
        async with httpx.AsyncClient(timeout=120.0) as http:
            resp = await http.get(
                decoded_url,
                headers={"X-API-Key": settings.CORESTACK_API_KEY},
                follow_redirects=True,
            )

            # GeoServer returns XML error pages with 200 status for missing coverages
            content_type = resp.headers.get("content-type", "")
            if "xml" in content_type.lower() or resp.status_code >= 400:
                # This coverage doesn't exist — not an error, just not available
                if resp.status_code == 404 or "xml" in content_type.lower():
                    raise HTTPException(
                        status_code=404,
                        detail="Coverage not found on GeoServer. This layer may not exist for this area/year.",
                    )
                resp.raise_for_status()

        return StreamingResponse(
            iter([resp.content]),
            media_type="image/tiff",
            headers={
                "Content-Disposition": "attachment; filename=layer.tiff",
                "Access-Control-Allow-Origin": "*",
            },
        )
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        logger.error("GeoServer download failed (%s): %s", e.response.status_code, e)
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"GeoServer returned {e.response.status_code}",
        )
    except Exception as e:
        logger.error("Raster download error: %s", e)
        raise HTTPException(status_code=502, detail=f"Failed to download raster: {e}")


@router.get("/check")
async def check_raster_availability(
    url: str = Query(..., description="GeoServer WCS URL to check"),
):
    """Check if a raster layer exists on GeoServer.

    Uses a GET request with a small byte range to verify availability
    without downloading the full raster.
    """
    decoded_url = unquote(url)

    if "geoserver.core-stack.org" not in decoded_url:
        raise HTTPException(status_code=403, detail="Only CoRE Stack URLs allowed.")

    try:
        async with httpx.AsyncClient(timeout=20.0) as http:
            resp = await http.get(
                decoded_url,
                headers={"Range": "bytes=0-100"},
                follow_redirects=True,
            )
            content_type = resp.headers.get("content-type", "")
            # GeoServer returns XML for errors, geotiff/octet-stream for success
            is_xml = "xml" in content_type.lower()
            is_tiff = "tiff" in content_type.lower() or "octet" in content_type.lower()
            available = resp.status_code in (200, 206) and (is_tiff or not is_xml)
            return {"available": available, "status_code": resp.status_code, "content_type": content_type}
    except Exception as e:
        logger.warning("Raster check failed: %s", e)
        return {"available": False, "status_code": 0}


@router.post("/full-url")
async def get_full_download_url(request_body: dict):
    """Return a signed GEE download URL for the FULL village bbox + fiscal year.

    Unlike /tile-url (used for 1km² tiles), this endpoint serves the entire
    village bounding box in a single GeoTIFF. The browser handles masking
    via Pyodide numpy — no turf.js per-pixel objects.

    Request:  { bbox: [minLng, minLat, maxLng, maxLat], start_year, end_year }
    Response: { url, bbox, fiscal_year, status }
    """
    import asyncio

    bbox = request_body.get("bbox")
    start_year = request_body.get("start_year")
    end_year = request_body.get("end_year")

    if not bbox or len(bbox) != 4:
        raise HTTPException(status_code=400, detail="bbox [minLng, minLat, maxLng, maxLat] required")
    if not start_year or not end_year:
        raise HTTPException(status_code=400, detail="start_year and end_year required")

    def _get_url():
        import ee
        from app.services.gee_service import _init_ee, CORESTACK_LULC_ASSET

        _init_ee()

        asset_path = CORESTACK_LULC_ASSET.format(start=start_year, end=end_year)
        image = ee.Image(asset_path).select("predicted_label")

        min_lng, min_lat, max_lng, max_lat = bbox
        region = ee.Geometry.Rectangle([min_lng, min_lat, max_lng, max_lat])

        url = image.getDownloadURL({
            "region": region,
            "format": "GEO_TIFF",
            "crs": "EPSG:4326",
            "scale": 10,
        })

        logger.info("Full-village URL (EPSG:4326, 10m): bbox=%s", bbox)
        return url

    try:
        url = await asyncio.to_thread(_get_url)
        fy_label = f"20{str(start_year)[-2:]}-{str(end_year)[-2:]}"
        return {
            "status": "ok",
            "url": url,
            "fiscal_year": fy_label,
            "bbox": bbox,
        }
    except Exception as e:
        logger.warning("Full-village URL generation failed: %s", e)
        raise HTTPException(status_code=404, detail=f"Could not generate full-village URL: {e}")






# ═══════════════════════════════════════════════════════════════════
# WMS Tile Proxy — for fiscal year-synced map overlays in storyboard
# ═══════════════════════════════════════════════════════════════════

@router.get("/wms-layers")
async def get_wms_layers(
    district: str = Query(...),
    tehsil: str = Query(...),
):
    """Return available WMS tile layer info for each fiscal year.

    The frontend uses this to know which years have renderable map overlays.
    Each entry includes the fiscal year label and the WMS layer name on GeoServer.
    """
    norm_district = normalize_name(district)
    norm_tehsil = normalize_name(tehsil)

    layers = []
    for yy_start, yy_end in FISCAL_YEARS:
        layer_name = f"LULC_level_3:LULC_{yy_start}_{yy_end}_{norm_district}_{norm_tehsil}_level_3"
        fiscal_label = f"20{yy_start}-{yy_end}"
        layers.append({
            "fiscal_year": fiscal_label,
            "layer_name": layer_name,
            "workspace": "LULC_level_3",
            "yy_range": f"{yy_start}_{yy_end}",
        })

    return {"status": "ok", "data": layers, "count": len(layers)}


@router.get("/wms-tile")
async def wms_tile_proxy(
    district: str = Query(...),
    tehsil: str = Query(...),
    fy: str = Query(..., description="Fiscal year range, e.g. '20_21'"),
    bbox: str = Query(..., description="Bounding box: minLng,minLat,maxLng,maxLat"),
    width: int = Query(256),
    height: int = Query(256),
):
    """Proxy a WMS GetMap tile request from CoRE Stack GeoServer.

    Constructs the WMS URL internally (so the API key never leaks to the browser),
    fetches the PNG tile, and returns it with proper CORS headers.
    """
    settings = get_settings()
    norm_district = normalize_name(district)
    norm_tehsil = normalize_name(tehsil)

    layer_name = f"LULC_level_3:LULC_{fy}_{norm_district}_{norm_tehsil}_level_3"

    wms_url = (
        f"{GEOSERVER_BASE}/LULC_level_3/wms"
        f"?SERVICE=WMS&VERSION=1.1.0&REQUEST=GetMap"
        f"&LAYERS={layer_name}"
        f"&STYLES="
        f"&FORMAT=image/png&TRANSPARENT=true"
        f"&SRS=EPSG:4326"
        f"&BBOX={bbox}"
        f"&WIDTH={width}&HEIGHT={height}"
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            resp = await http.get(
                wms_url,
                headers={"X-API-Key": settings.CORESTACK_API_KEY},
                follow_redirects=True,
            )

            content_type = resp.headers.get("content-type", "")

            # GeoServer returns XML for errors/missing layers
            if "xml" in content_type.lower() or resp.status_code >= 400:
                # Return a transparent 1x1 PNG for missing tiles (graceful fallback)
                TRANSPARENT_PNG = (
                    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
                    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
                    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
                    b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
                )
                return Response(
                    content=TRANSPARENT_PNG,
                    media_type="image/png",
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "public, max-age=86400",
                    },
                )

            return Response(
                content=resp.content,
                media_type="image/png",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "public, max-age=3600",
                },
            )

    except Exception as e:
        logger.warning("WMS tile proxy error: %s", e)
        # Return transparent PNG on any error — don't break the map
        TRANSPARENT_PNG = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
            b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
            b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
            b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        return Response(
            content=TRANSPARENT_PNG,
            media_type="image/png",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=60",
            },
        )


# ─── Admin Boundary Candidates (hierarchical drill-down) ───

@router.get("/admin-candidates")
async def get_admin_candidates(
    level: str = Query(..., description="'state' | 'district' | 'tehsil'"),
    bbox: str = Query(..., description="minLng,minLat,maxLng,maxLat in EPSG:4326"),
):
    """Return bbox-filtered admin boundary features for one hierarchy level.

    CoRE Stack GEE assets use KML-export format with no parent admin references,
    so all 3 levels use bbox-only filtering. A tight village bbox (~0.05°×0.05°)
    returns only 1-5 candidates per level — all intersection math is done
    client-side in the browser via turf.js.
    """
    import asyncio
    from app.services.gee_service import fetch_admin_candidates

    try:
        parts = [float(x.strip()) for x in bbox.split(",")]
        if len(parts) != 4:
            raise ValueError("bbox must have exactly 4 values")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid bbox: {e}")

    if level not in ("state", "district", "tehsil"):
        raise HTTPException(status_code=400, detail="level must be 'state', 'district', or 'tehsil'")

    try:
        result = await asyncio.to_thread(fetch_admin_candidates, level, parts)
        return result
    except Exception as e:
        logger.error("admin_candidates error: %s", e)
        raise HTTPException(status_code=500, detail=f"Admin candidate lookup failed: {e}")

