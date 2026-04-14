"""CSVAT — Custom Story Slides API.

CRUD endpoints for user-created data story slides.
Slides are stored per village_name in the database.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.custom_slide import CustomSlide

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/custom-slides", tags=["Custom Slides"])


# ─── Schemas ───

class SlideCreate(BaseModel):
    village_name: str
    title: str
    description: str = ""
    image_url: str = ""
    slide_order: int = 0
    map_center_lat: Optional[float] = None
    map_center_lng: Optional[float] = None
    map_zoom: Optional[int] = 14


class SlideUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    slide_order: Optional[int] = None
    map_center_lat: Optional[float] = None
    map_center_lng: Optional[float] = None
    map_zoom: Optional[int] = None


# ─── Endpoints ───

@router.get("/")
def list_custom_slides(
    village: str = Query(..., description="Village name"),
    db: Session = Depends(get_db),
):
    """List all custom slides for a village, ordered by slide_order."""
    slides = (
        db.query(CustomSlide)
        .filter(CustomSlide.village_name == village)
        .order_by(CustomSlide.slide_order)
        .all()
    )
    return [_serialize(s) for s in slides]


@router.post("/", status_code=201)
def create_custom_slide(
    payload: SlideCreate,
    db: Session = Depends(get_db),
):
    """Create a new custom slide."""
    slide = CustomSlide(
        village_name=payload.village_name,
        title=payload.title,
        description=payload.description,
        image_url=payload.image_url or "",
        slide_order=payload.slide_order,
        map_center_lat=payload.map_center_lat,
        map_center_lng=payload.map_center_lng,
        map_zoom=payload.map_zoom,
    )
    db.add(slide)
    db.commit()
    db.refresh(slide)
    return _serialize(slide)


@router.put("/{slide_id}")
def update_custom_slide(
    slide_id: str,
    payload: SlideUpdate,
    db: Session = Depends(get_db),
):
    """Update an existing custom slide."""
    slide = db.query(CustomSlide).filter(CustomSlide.id == slide_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail=f"Slide not found: {slide_id}")

    if payload.title is not None:
        slide.title = payload.title
    if payload.description is not None:
        slide.description = payload.description
    if payload.image_url is not None:
        slide.image_url = payload.image_url
    if payload.slide_order is not None:
        slide.slide_order = payload.slide_order
    if payload.map_center_lat is not None:
        slide.map_center_lat = payload.map_center_lat
    if payload.map_center_lng is not None:
        slide.map_center_lng = payload.map_center_lng
    if payload.map_zoom is not None:
        slide.map_zoom = payload.map_zoom

    db.commit()
    db.refresh(slide)
    return _serialize(slide)


@router.delete("/{slide_id}")
def delete_custom_slide(
    slide_id: str,
    db: Session = Depends(get_db),
):
    """Delete a custom slide."""
    slide = db.query(CustomSlide).filter(CustomSlide.id == slide_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail=f"Slide not found: {slide_id}")

    db.delete(slide)
    db.commit()
    return {"deleted": True, "id": slide_id}


def _serialize(slide: CustomSlide) -> dict:
    return {
        "id": slide.id,
        "village_name": slide.village_name,
        "slide_order": slide.slide_order,
        "title": slide.title,
        "description": slide.description,
        "image_url": slide.image_url or "",
        "map_center_lat": slide.map_center_lat,
        "map_center_lng": slide.map_center_lng,
        "map_zoom": slide.map_zoom,
        "created_at": slide.created_at.isoformat() if slide.created_at else None,
        "updated_at": slide.updated_at.isoformat() if slide.updated_at else None,
    }
