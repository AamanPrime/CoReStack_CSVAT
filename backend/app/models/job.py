"""CSVAT — Job database model."""

import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, Enum, JSON, DateTime, Text
from app.database import Base


class JobStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"


class ExecutionMode(str, enum.Enum):
    SERVER = "SERVER"
    CLIENT = "CLIENT"


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    boundary_id = Column(String(255), nullable=True)
    boundary_geojson = Column(JSON, nullable=True)
    village_name = Column(String(255), nullable=True)
    state = Column(String(255), nullable=True)
    district = Column(String(255), nullable=True)
    tehsil = Column(String(255), nullable=True)
    layers = Column(JSON, nullable=False, default=list)
    years = Column(JSON, nullable=False, default=list)
    mode = Column(Enum(ExecutionMode), default=ExecutionMode.SERVER)
    status = Column(Enum(JobStatus), default=JobStatus.PENDING, index=True)
    result_json = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))
