"""CSVAT — Village Storyboard Slides database model.

Stores AI-generated 13-slide storyboards (from sc.py logic) keyed by
CoRE Stack village_id. Generated once on demand, cached here for fast retrieval.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, JSON, DateTime

from app.database import Base


class VillageStoryboardSlide(Base):
    __tablename__ = "village_storyboard_slides"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    village_id = Column(String(128), nullable=False, unique=True, index=True)
    village_name = Column(String(255), nullable=False)
    state = Column(String(255), nullable=True)
    district = Column(String(255), nullable=True)
    tehsil = Column(String(255), nullable=True)
    total_area = Column(String(100), nullable=True)

    # Array of 13 slide objects: {slide_number, emoji, title, content, insight}
    slides = Column(JSON, nullable=False, default=list)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
