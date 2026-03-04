"""CSVAT — Analytics API router.

Provides the MWS intersection analytics endpoint.
The frontend calls this first; if unavailable, prompts the user before GEE fallback.
"""

import logging
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional
from app.services.mws_intersection_service import mws_service
from app.services.analytics.cropping import compute_from_mws_data as cropping_from_mws
from app.services.analytics.water import compute_from_mws_data as water_from_mws
from app.services.analytics.vegetation import compute_from_mws_data as vegetation_from_mws

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/analytics", tags=["Analytics"])


# ─── Request / Response schemas ───

class MWSAnalyticsRequest(BaseModel):
    boundary_geojson: dict = Field(..., description="GeoJSON Polygon or MultiPolygon")
    state: str = ""
    district: str = ""
    tehsil: str = ""
    village_name: str = "Unknown"
    layers: list[str] = Field(
        default_factory=lambda: ["cropping_intensity", "surface_water", "vegetation"]
    )
    years: list[int] = Field(
        default_factory=lambda: [2019, 2020, 2021, 2022, 2023]
    )


class MWSAnalyticsResponse(BaseModel):
    status: str  # "success" | "mws_unavailable"
    message: str = ""
    data: Optional[dict] = None
    data_source: Optional[str] = None
    mws_count: Optional[int] = None


# ─── Endpoint ───

@router.post("/mws", response_model=MWSAnalyticsResponse)
async def run_mws_analytics(request: MWSAnalyticsRequest):
    """Try MWS intersection analytics for a village.

    Returns status="success" with data if available,
    or status="mws_unavailable" with a message if the tehsil
    is not active on CoRE Stack.

    This is NOT an error — the frontend uses this to prompt the user
    before falling back to GEE.
    """
    try:
        logger.info(
            "MWS analytics requested for %s (%s/%s/%s)",
            request.village_name, request.state, request.district, request.tehsil,
        )

        # Run the MWS intersection pipeline
        mws_results = await mws_service.compute_village_analytics(
            village_geojson=request.boundary_geojson,
            state=request.state,
            district=request.district,
            tehsil=request.tehsil,
            layers=request.layers,
            years=request.years,
        )

        # Format results into schema
        data = {
            "village_name": request.village_name,
            "state": request.state,
            "district": request.district,
            "tehsil": request.tehsil,
        }

        if "cropping_intensity" in request.layers and mws_results.get("cropping_intensity"):
            data["cropping_intensity"] = cropping_from_mws(
                request.village_name, mws_results["cropping_intensity"], request.years,
            )

        if "surface_water" in request.layers and mws_results.get("surface_water"):
            data["surface_water"] = water_from_mws(
                request.village_name, mws_results["surface_water"], request.years,
            )

        if "vegetation" in request.layers and mws_results.get("vegetation"):
            data["vegetation"] = vegetation_from_mws(
                request.village_name, mws_results["vegetation"], request.years,
            )

        return MWSAnalyticsResponse(
            status="success",
            message="Analytics computed from CoRE Stack MWS data (10m resolution).",
            data=data,
            data_source="corestack_mws",
            mws_count=mws_results.get("mws_count", 0),
        )

    except ValueError as e:
        # MWS not available — NOT an error, just a signal to the frontend
        logger.info("MWS unavailable for %s: %s", request.village_name, str(e))
        return MWSAnalyticsResponse(
            status="mws_unavailable",
            message=(
                "This area is not yet available on CoRE Stack. "
                "Would you like to use Google Earth Engine instead? "
                "(Lower resolution — MODIS 500m vs CoRE Stack 10m)"
            ),
        )

    except Exception as e:
        logger.error("MWS analytics error: %s", str(e))
        return MWSAnalyticsResponse(
            status="mws_unavailable",
            message=(
                f"Could not fetch CoRE Stack data: {str(e)}. "
                "Would you like to use Google Earth Engine instead?"
            ),
        )
