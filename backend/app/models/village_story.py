"""CSVAT — Village Story database model."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, JSON, DateTime, Text


from app.database import Base


class VillageStory(Base):
    __tablename__ = "village_stories"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    village_id = Column(Integer, nullable=False, index=True, unique=True)
    name = Column(String(255), nullable=False, index=True)
    state = Column(String(255), nullable=False, index=True)
    district = Column(String(255), nullable=False, index=True)
    tehsil = Column(String(255), nullable=False, index=True)

    # Demographics
    population_2011 = Column(Integer, nullable=True)
    households_2011 = Column(Integer, nullable=True)
    males_2011 = Column(Integer, nullable=True)
    females_2011 = Column(Integer, nullable=True)
    literacy_rate = Column(Float, nullable=True)

    # Cultural info
    languages = Column(JSON, nullable=True)
    temples = Column(JSON, nullable=True)
    economy = Column(Text, nullable=True)
    historical_context = Column(Text, nullable=True)
    cultural_notes = Column(Text, nullable=True)

    # Story chapters (array of {title, narrative, map_action})
    story_chapters = Column(JSON, nullable=False, default=list)

    # Metadata
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))
