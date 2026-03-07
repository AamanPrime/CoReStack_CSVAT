"""CSVAT — Pydantic schemas for request/response validation."""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


# ───────────────────────── Auth ─────────────────────────
class TokenRequest(BaseModel):
    api_key: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ───────────────────────── Boundaries ─────────────────────────
class BoundarySearchResult(BaseModel):
    id: str
    name: str
    state: str
    district: str
    tehsil: str
    level: str  # "village" | "tehsil" | "district"


class BoundarySearchResponse(BaseModel):
    results: list[BoundarySearchResult]
    count: int


class BoundaryValidateRequest(BaseModel):
    geojson: dict = Field(..., description="GeoJSON polygon or multipolygon")


class BoundaryValidateResponse(BaseModel):
    valid: bool
    message: str
    state: Optional[str] = None
    district: Optional[str] = None
    tehsil: Optional[str] = None
    village_name: Optional[str] = None
    area_hectares: Optional[float] = None


# ───────────────────────── Layers ─────────────────────────
class LayerInfo(BaseModel):
    id: str
    name: str
    description: str
    available_years: list[int]
    unit: str
    url: Optional[str] = None


class LayersResponse(BaseModel):
    layers: list[LayerInfo]


# ───────────────────────── Jobs ─────────────────────────
class JobCreate(BaseModel):
    boundary_id: Optional[str] = None
    boundary_geojson: Optional[dict] = None
    village_name: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    tehsil: Optional[str] = None
    layers: list[str] = Field(default_factory=lambda: ["cropping_intensity", "surface_water", "vegetation"])
    years: list[int] = Field(default_factory=lambda: [2019, 2020, 2021, 2022, 2023])
    mode: str = "SERVER"


class JobResponse(BaseModel):
    id: UUID
    status: str
    village_name: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    tehsil: Optional[str] = None
    layers: list[str]
    years: list[int]
    mode: str
    result_json: Optional[dict] = None
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ───────────────────────── Analytics Results ─────────────────────────
class CroppingIntensityYear(BaseModel):
    year: int
    single_crop_ha: float
    double_crop_ha: float
    triple_crop_ha: float
    total_cropped_ha: float


class CroppingIntensityResult(BaseModel):
    village_name: str
    data: list[CroppingIntensityYear]


class SurfaceWaterYear(BaseModel):
    year: int
    perennial_ha: float
    seasonal_monsoon_ha: float
    seasonal_winter_ha: float
    total_water_ha: float


class SurfaceWaterResult(BaseModel):
    village_name: str
    data: list[SurfaceWaterYear]


class VegetationChangeResult(BaseModel):
    village_name: str
    start_year: int
    end_year: int
    tree_cover_start_ha: float
    tree_cover_end_ha: float
    tree_cover_loss_ha: float
    tree_cover_gain_ha: float
    net_change_ha: float
    degraded_land_ha: float
    yearly_data: list[dict]


class AnalyticsResultBundle(BaseModel):
    village_name: str
    state: str
    district: str
    tehsil: str
    cropping_intensity: Optional[CroppingIntensityResult] = None
    surface_water: Optional[SurfaceWaterResult] = None
    vegetation: Optional[VegetationChangeResult] = None
