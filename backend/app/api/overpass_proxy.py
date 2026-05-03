"""CSVAT — Overpass API Proxy.

Proxies Overpass API requests to bypass CORS issues on the frontend
and set appropriate User-Agent headers to prevent 406 Not Acceptable errors.
"""

import logging
import httpx
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/overpass", tags=["Overpass Proxy"])
legacy_router = APIRouter(prefix="/overpass", tags=["Overpass Proxy"])

_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client


async def _proxy_overpass(
    data: str = Query(..., description="Overpass QL query string"),
):
    try:
        client = _get_client()
        resp = await client.get(
            "https://overpass-api.de/api/interpreter",
            params={"data": data},
            headers={"User-Agent": "CSVAT-CoReStack-App/1.0 (Contact: admin@csvat.org)"}
        )
        
        if resp.status_code != 200:
            logger.warning("Overpass API returned %d: %s", resp.status_code, resp.text[:200])
            raise HTTPException(status_code=502, detail=f"Overpass API error: {resp.status_code}")
            
        return Response(
            content=resp.content,
            media_type="application/json"
        )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Overpass request timed out")
    except Exception as e:
        logger.error("Overpass proxy error: %s", e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch from Overpass: {e}")


@router.get("/")
async def overpass_proxy(
    data: str = Query(..., description="Overpass QL query string"),
):
    return await _proxy_overpass(data=data)


@legacy_router.get("/", include_in_schema=False)
async def overpass_proxy_legacy(
    data: str = Query(..., description="Overpass QL query string"),
):
    return await _proxy_overpass(data=data)
