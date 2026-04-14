"""CSVAT — Custom Story Slide database model."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, DateTime, Text


from app.database import Base


class CustomSlide(Base):
    __tablename__ = "custom_slides"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    village_name = Column(String(255), nullable=False, index=True)

    slide_order = Column(Integer, nullable=False, default=0)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=False, default="")
    image_url = Column(String(1000), nullable=True, default="")

    # Map background coordinates
    map_center_lat = Column(Float, nullable=True)
    map_center_lng = Column(Float, nullable=True)
    map_zoom = Column(Integer, nullable=True, default=14)

    # Metadata
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))
