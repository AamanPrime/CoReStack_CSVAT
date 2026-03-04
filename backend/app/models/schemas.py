"""
Pydantic schemas for CSVAT API request/response models.
"""
from pydantic import BaseModel
from typing import Optional


class VillageQuery(BaseModel):
    """Query model for village lookup by name."""
    village_name: Optional[str] = None
    tehsil_name: Optional[str] = None
    district_name: Optional[str] = None


class BoundaryUpload(BaseModel):
    """Model for uploaded GeoJSON boundary."""
    type: str  # "Feature" or "FeatureCollection"
    geometry: Optional[dict] = None
    features: Optional[list] = None
    properties: Optional[dict] = None


class AnalyticsRequest(BaseModel):
    """Request model for analytics computation."""
    mws_uids: list[str]
    village_name: Optional[str] = "Nallacheruvu"


class CroppingIntensityRecord(BaseModel):
    year: str
    cropping_intensity: float
    single_crop_area_ha: float
    double_crop_area_ha: float
    triple_crop_area_ha: float


class SurfaceWaterRecord(BaseModel):
    year: str
    total_area_ha: float
    kharif_area_ha: float
    rabi_area_ha: float
    zaid_area_ha: float


class DeforestationRecord(BaseModel):
    category: str
    area_ha: float


class AnalyticsResponse(BaseModel):
    village_name: str
    total_area_ha: float
    mws_count: int
    cropping_intensity: list[dict]
    surface_water: list[dict]
    deforestation: list[dict]
    terrain: list[dict]
    crop_intensity_change: list[dict]
