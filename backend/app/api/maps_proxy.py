"""CSVAT — Google Maps Static Map Proxy.

Proxies Static Maps API requests to Google, keeping the API key server-side.
This prevents the key from leaking into client-side code or exported HTML files.
"""

import logging
import httpx
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response
from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/maps", tags=["Maps Proxy"])

# Reusable async HTTP client
_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=15.0)
    return _http_client


@router.get("/static")
async def static_map_proxy(
    center: str = Query(..., description="Lat,lng string e.g. '20.5,78.9'"),
    zoom: int = Query(14, ge=0, le=21),
    size: str = Query("1280x900", regex=r"^\d{1,4}x\d{1,4}$"),
    maptype: str = Query("satellite", regex=r"^(satellite|roadmap|terrain|hybrid)$"),
    heading: int = Query(0, ge=0, le=360),
):
    """Proxy Google Static Maps API, hiding the API key from clients.

    Returns the satellite image as PNG bytes with cache headers.
    """
    settings = get_settings()
    api_key = settings.GOOGLE_MAPS_KEY

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Google Maps API key not configured on server.",
        )

    # Validate center format
    parts = center.split(",")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="center must be 'lat,lng'")
    try:
        lat, lng = float(parts[0]), float(parts[1])
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid lat/lng values")

    # Validate size dimensions
    w, h = size.split("x")
    if int(w) > 2048 or int(h) > 2048:
        raise HTTPException(status_code=400, detail="Max size is 2048x2048")

    google_url = (
        f"https://maps.googleapis.com/maps/api/staticmap"
        f"?center={lat},{lng}"
        f"&zoom={zoom}"
        f"&size={size}"
        f"&maptype={maptype}"
        f"&heading={heading}"
        f"&key={api_key}"
    )

    try:
        client = _get_client()
        resp = await client.get(google_url)

        if resp.status_code != 200:
            logger.warning(
                "Google Static Maps returned %d for center=%s",
                resp.status_code,
                center,
            )
            raise HTTPException(
                status_code=502,
                detail=f"Google Maps API returned {resp.status_code}",
            )

        content_type = resp.headers.get("content-type", "image/png")

        return Response(
            content=resp.content,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=3600",  # 1 hour cache
                "X-Proxy": "csvat-maps",
            },
        )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Google Maps request timed out")
    except httpx.HTTPError as e:
        logger.error("Static map proxy error: %s", e)
        raise HTTPException(status_code=502, detail="Failed to fetch static map")
