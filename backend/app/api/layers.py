"""CSVAT — Layers API router."""

from fastapi import APIRouter
from app.schemas import LayersResponse, LayerInfo

router = APIRouter(prefix="/api/v1/layers", tags=["Layers"])

# Available analytics layers
AVAILABLE_LAYERS = [
    LayerInfo(
        id="cropping_intensity",
        name="Cropping Intensity",
        description="Classifies cropped pixels into single, double, and triple crop categories using LULC rasters.",
        available_years=[2017, 2018, 2019, 2020, 2021, 2022, 2023],
        unit="hectares",
    ),
    LayerInfo(
        id="surface_water",
        name="Seasonal Surface Water",
        description="Classifies water pixels into perennial (>9 months) and seasonal categories across seasons.",
        available_years=[2017, 2018, 2019, 2020, 2021, 2022, 2023],
        unit="hectares",
    ),
    LayerInfo(
        id="vegetation",
        name="Vegetation & Degradation",
        description="Tracks tree cover loss/gain and estimates degraded land area across time periods.",
        available_years=[2017, 2018, 2019, 2020, 2021, 2022, 2023],
        unit="hectares",
    ),
]


@router.get("", response_model=LayersResponse)
async def list_layers():
    """List available analytics layers and their year ranges.

    Maps to FR-CI-01.
    """
    return LayersResponse(layers=AVAILABLE_LAYERS)
