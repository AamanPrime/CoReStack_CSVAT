"""CSVAT — Raster Proxy API.

Proxies GeoTIFF downloads from CoRE Stack GeoServer through our backend
to protect API keys and handle CORS.

Also provides an endpoint to list available raster layers for a tehsil.
"""

import logging
from urllib.parse import unquote

import httpx
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.services.corestack_client import CoreStackClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/raster", tags=["Raster Proxy"])


@router.get("/layers")
async def get_raster_layers(
    state: str = Query(...),
    district: str = Query(...),
    tehsil: str = Query(...),
    layer_type: str = Query("raster", description="Filter by layer type: raster, vector, or all"),
):
    """Fetch available GeoServer layer URLs for a tehsil, optionally filtered by type."""
    settings = get_settings()
    client = CoreStackClient(
        base_url=settings.CORESTACK_API_URL,
        api_key=settings.CORESTACK_API_KEY,
    )
    try:
        layers = await client.get_generated_layer_urls(state, district, tehsil)
    except Exception as e:
        logger.error("Failed to fetch layer URLs: %s", e)
        raise HTTPException(status_code=502, detail=f"CoRE Stack layer URL fetch failed: {e}")

    if not layers:
        return {"status": "ok", "data": [], "message": "No layers found for this tehsil."}

    # Filter by type if requested
    if layer_type != "all":
        layers = [l for l in layers if l.get("layer_type", "").lower() == layer_type.lower()]

    return {"status": "ok", "data": layers}


@router.get("/download")
async def download_raster(
    url: str = Query(..., description="GeoServer layer URL to proxy"),
):
    """Proxy a GeoTIFF download from GeoServer.

    Adds the CoRE Stack API key header and streams the binary response back.
    Returns Content-Type: image/tiff for GeoTIFF files.
    """
    settings = get_settings()
    decoded_url = unquote(url)

    # Security: only proxy URLs from known CoRE Stack domains
    allowed_domains = [
        "core-stack.org",
        "geoserver.core-stack.org",
        "api.core-stack.org",
    ]
    if not any(domain in decoded_url for domain in allowed_domains):
        raise HTTPException(
            status_code=403,
            detail="Only CoRE Stack GeoServer URLs can be proxied.",
        )

    # Build WCS GetCoverage request if the URL is a WMS/layer URL
    # If it already has format=image/tiff, use as-is
    download_url = decoded_url
    if "format=image/tiff" not in decoded_url.lower() and "request=getcoverage" not in decoded_url.lower():
        # Append WCS parameters for GeoTIFF download
        separator = "&" if "?" in decoded_url else "?"
        download_url = f"{decoded_url}{separator}service=WCS&version=2.0.1&request=GetCoverage&format=image/tiff"

    try:
        async with httpx.AsyncClient(timeout=120.0) as http:
            resp = await http.get(
                download_url,
                headers={"X-API-Key": settings.CORESTACK_API_KEY},
                follow_redirects=True,
            )
            resp.raise_for_status()

        content_type = resp.headers.get("content-type", "application/octet-stream")

        return StreamingResponse(
            iter([resp.content]),
            media_type=content_type,
            headers={
                "Content-Disposition": "attachment; filename=layer.tiff",
                "Access-Control-Allow-Origin": "*",
            },
        )
    except httpx.HTTPStatusError as e:
        logger.error("GeoServer download failed (%s): %s", e.response.status_code, e)
        raise HTTPException(status_code=e.response.status_code, detail=f"GeoServer returned {e.response.status_code}")
    except Exception as e:
        logger.error("Raster download error: %s", e)
        raise HTTPException(status_code=502, detail=f"Failed to download raster: {e}")
