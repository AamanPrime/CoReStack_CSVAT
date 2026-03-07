"""CSVAT — Cached boundary database model."""

import uuid
from sqlalchemy import Column, String, Integer
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geometry
from app.database import Base


class CachedBoundary(Base):
    __tablename__ = "cached_boundaries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    state = Column(String(255), nullable=True, index=True)
    district = Column(String(255), nullable=True, index=True)
    tehsil = Column(String(255), nullable=True, index=True)
    village_code = Column(String(50), nullable=True, unique=True)
    geom = Column(Geometry("MULTIPOLYGON", srid=4326), nullable=True)
    area_hectares = Column(Integer, nullable=True)
