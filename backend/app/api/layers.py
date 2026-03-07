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
        url="https://sedac.ciesin.columbia.edu/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=han_1990-2000-2010_cropping-intensity",
    ),
    LayerInfo(
        id="surface_water",
        name="Seasonal Surface Water",
        description="Classifies water pixels into perennial (>9 months) and seasonal categories across seasons.",
        available_years=[2017, 2018, 2019, 2020, 2021, 2022, 2023],
        unit="hectares",
        url="https://spatial.jrc.ec.europa.eu/geofence/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=surface_water_seasonality&STYLES=&CRS=EPSG:3857",
    ),
    LayerInfo(
        id="vegetation",
        name="Vegetation & Degradation",
        description="Tracks tree cover loss/gain and estimates degraded land area across time periods.",
        available_years=[2017, 2018, 2019, 2020, 2021, 2022, 2023],
        unit="hectares",
        url="https://ies-ows.jrc.ec.europa.eu/efdac/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=fcover_2015_0&STYLES=&CRS=EPSG:3857",
    ),
    LayerInfo(
        id="waterbodies",
        name="Waterbodies",
        description="Waterbody data including seasonal coverage, area trends, and zone of influence analytics.",
        available_years=[2017, 2018, 2019, 2020, 2021, 2022, 2023],
        unit="hectares",
        url="https://spatial.jrc.ec.europa.eu/geofence/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=surface_water_occurrence&STYLES=&CRS=EPSG:3857",
    ),
]


@router.get("", response_model=LayersResponse)
async def list_layers():
    """List available analytics layers and their year ranges.

    Maps to FR-CI-01.
    """
    return LayersResponse(layers=AVAILABLE_LAYERS)
