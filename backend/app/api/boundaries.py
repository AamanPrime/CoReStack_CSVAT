"""CSVAT — Boundaries API router."""

from fastapi import APIRouter, HTTPException, Query
from app.schemas import BoundarySearchResponse, BoundarySearchResult, BoundaryValidateRequest, BoundaryValidateResponse
from app.services.corestack_client import corestack_client
from app.services.boundary_service import boundary_service
from app.services.village_search import search_villages, get_village_boundary

router = APIRouter(prefix="/api/v1/boundaries", tags=["Boundaries"])


@router.get("/autocomplete")
async def autocomplete_villages(q: str = Query(..., min_length=2, description="Search query")):
    """Live autocomplete for village search.

    Returns matching villages ranked by relevance (name > district > state).
    Searches the built-in Indian village database.
    """
    results = search_villages(q, limit=10)
    return {
        "results": [
            {
                "id": v["id"],
                "name": v["name"],
                "state": v["state"],
                "district": v["district"],
                "tehsil": v["tehsil"],
                "level": v.get("level", "village"),
            }
            for v in results
        ],
        "count": len(results),
    }


@router.get("/village/{village_id}")
async def get_village(village_id: str):
    """Get full village data including bounding box polygon for GEE queries."""
    data = get_village_boundary(village_id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Village {village_id} not found")
    return data


@router.get("/search", response_model=BoundarySearchResponse)
async def search_boundaries(q: str = Query(..., min_length=2, description="Search query")):
    """Search for administrative boundaries by name.

    Searches villages, tehsils, and districts matching the query string.
    Maps to FR-BA-02.
    """
    # First try the local village database
    local_results = search_villages(q, limit=15)
    if local_results:
        items = [
            BoundarySearchResult(
                id=r["id"],
                name=r["name"],
                state=r["state"],
                district=r["district"],
                tehsil=r["tehsil"],
                level=r.get("level", "village"),
            )
            for r in local_results
        ]
        return BoundarySearchResponse(results=items, count=len(items))

    # Fallback to CoRE Stack API
    results = await corestack_client.search_boundaries(q)
    items = [
        BoundarySearchResult(
            id=r.get("id", ""),
            name=r.get("name", ""),
            state=r.get("state", ""),
            district=r.get("district", ""),
            tehsil=r.get("tehsil", ""),
            level=r.get("level", "village"),
        )
        for r in results
    ]
    return BoundarySearchResponse(results=items, count=len(items))


@router.post("/validate", response_model=BoundaryValidateResponse)
async def validate_boundary(request: BoundaryValidateRequest):
    """Validate a GeoJSON boundary polygon.

    Checks that the uploaded polygon is valid and intersects at least one active tehsil.
    Maps to FR-BA-01, FR-BA-03, FR-BA-04.
    """
    try:
        resolved = boundary_service.resolve_boundary(geojson=request.geojson)
        is_valid = boundary_service.validate_tehsil_intersection(
            resolved["state"], resolved["district"], resolved["tehsil"]
        )
        if not is_valid:
            return BoundaryValidateResponse(
                valid=False,
                message="Boundary does not intersect any active tehsil. Analytics cannot be computed.",
            )
        return BoundaryValidateResponse(
            valid=True,
            message="Boundary is valid and intersects an active tehsil.",
            state=resolved["state"],
            district=resolved["district"],
            tehsil=resolved["tehsil"],
            village_name=resolved["name"],
            area_hectares=resolved["area_hectares"],
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
