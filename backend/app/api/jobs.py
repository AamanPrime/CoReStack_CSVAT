"""CSVAT — Jobs API router.

Handles job submission, status polling, and asset delivery.
Uses PostGIS for persistence (replaces in-memory dict from MVP).

Modes:
  - SERVER: dispatches analytics to Celery worker (async), client polls for results
  - CLIENT: client runs WASM analytics, POSTs results for persistence via /save
"""

import uuid
import json
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import HTMLResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, ExecutionMode
from app.utils.auth_middleware import verify_token
from app.schemas import JobCreate, JobResponse
from app.services.report_service import report_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/jobs", tags=["Jobs"])

# Define new Pydantic models based on the instruction's usage
class JobSubmitRequest(JobCreate):
    """Schema for submitting a new job."""
    pass

class ClientResultsRequest(BaseModel):
    """Schema for client-side results."""
    results: dict = Field(..., description="The analytics results from the client-side WASM execution.")
    layers: Optional[list[str]] = Field(None, description="List of layers requested for the job.")
    years: Optional[list[int]] = Field(None, description="List of years requested for the job.")


# ─── Helper: ORM → Pydantic ────────────────────────────────────────
def _job_to_response(job: Job) -> JobResponse:
    """Convert SQLAlchemy Job to Pydantic response."""
    results = job.result_json or {}
    return JobResponse(
        id=job.id,
        status=job.status.value if isinstance(job.status, JobStatus) else job.status,
        village_name=job.village_name,
        state=job.state,
        district=job.district,
        tehsil=job.tehsil,
        layers=job.layers or [],
        years=job.years or [],
        mode=job.mode.value if isinstance(job.mode, ExecutionMode) else (job.mode or "SERVER"),
        result_json={k: v for k, v in results.items() if k not in ("html_report", "csv_data", "pdf_data")},
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


# ─── POST /api/v1/jobs ─────────────────────────────────────────────
@router.post("", status_code=201, response_model=JobResponse)
async def create_job(request: JobSubmitRequest, background_tasks: BackgroundTasks, _auth: dict = Depends(verify_token), db: Session = Depends(get_db)):
    """Submit a new analytics job.

    - mode=SERVER → dispatches native FastAPI background task, returns PENDING immediately.
    - mode=CLIENT → creates a PENDING job record; client runs WASM then calls /save.
    """
    job_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    mode = ExecutionMode.SERVER if request.mode == "SERVER" else ExecutionMode.CLIENT

    # Create the Job row
    job = Job(
        id=job_id,
        boundary_id=request.boundary_id,
        boundary_geojson=request.boundary_geojson,
        village_name=request.village_name or "Unknown",
        state=request.state or "",
        district=request.district or "",
        tehsil=request.tehsil or "",
        layers=request.layers,
        years=request.years,
        mode=mode,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # For SERVER mode, dispatch natively to FastAPI BackgroundTasks
    if mode == ExecutionMode.SERVER:
        try:
            from app.tasks.analytics_task import run_analytics_task
            background_tasks.add_task(
                run_analytics_task,
                {
                    "job_id": str(job_id),
                    "boundary_id": request.boundary_id,
                    "boundary_geojson": request.boundary_geojson,
                    "village_name": request.village_name,
                    "state": request.state,
                    "district": request.district,
                    "tehsil": request.tehsil,
                    "layers": request.layers,
                    "years": request.years,
                }
            )
            logger.info("Background task dispatched for job %s", job_id)
        except Exception as async_err:
            job.status = JobStatus.FAILED
            job.error_message = str(async_err)
            job.updated_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(job)

    return _job_to_response(job)


# ─── POST /api/v1/jobs/{job_id}/client-results ─────────────────────
@router.post("/{job_id}/client-results", response_model=JobResponse)
async def save_client_results(job_id: str, request: ClientResultsRequest, _auth: dict = Depends(verify_token), db: Session = Depends(get_db)):
    """Save client-side (WASM) analytics results to the database.

    Called after client finishes WASM computation.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    job = db.query(Job).filter(Job.id == job_uuid).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job.result_json = request.results
    job.status = JobStatus.SUCCESS
    job.updated_at = datetime.now(timezone.utc)

    # Generate server-side reports for client results too
    try:
        html_report = report_service.generate_html_report(request.results)
        csv_data = report_service.generate_csv(request.results)
        if job.result_json is None:
            job.result_json = {}
        job.result_json["html_report"] = html_report
        job.result_json["csv_data"] = csv_data
    except Exception as e:
        logger.warning("Report generation failed: %s", str(e))

    db.commit()
    db.refresh(job)
    return _job_to_response(job)


# ─── GET /api/v1/jobs/{job_id} ─────────────────────────────────────
@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str, _auth: dict = Depends(verify_token), db: Session = Depends(get_db)):
    """Get status and results of a job.

    Maps to polling connector for async job monitoring.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    job = db.query(Job).filter(Job.id == job_uuid).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return _job_to_response(job)


# ─── GET /api/v1/jobs/{job_id}/assets/{asset_type} ─────────────────
@router.get("/{job_id}/assets/{asset_type}")
async def get_job_asset(job_id: str, asset_type: str, _auth: dict = Depends(verify_token), db: Session = Depends(get_db)):
    """Download a job asset (HTML report, CSV, or PDF).

    Asset types: html, csv, pdf.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    job = db.query(Job).filter(Job.id == job_uuid).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    status_val = job.status.value if isinstance(job.status, JobStatus) else job.status
    if status_val != "SUCCESS":
        raise HTTPException(status_code=400, detail="Job has not completed successfully")

    results = job.result_json or {}
    safe_name = (job.village_name or "report").replace(" ", "_")

    if asset_type == "html":
        html = results.get("html_report")
        if not html:
            html = report_service.generate_html_report(results)
        return HTMLResponse(content=html)

    elif asset_type == "csv":
        csv_data = results.get("csv_data")
        if not csv_data:
            csv_data = report_service.generate_csv(results)
        return PlainTextResponse(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="CSVAT_{safe_name}.csv"'}
        )

    elif asset_type == "pdf":
        try:
            from app.services.pdf_service import pdf_service
            pdf_bytes = pdf_service.generate_pdf(results)
            return StreamingResponse(
                iter([pdf_bytes]),
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="CSVAT_{safe_name}.pdf"'}
            )
        except ImportError:
            # Fallback: return HTML with print header
            html = results.get("html_report") or report_service.generate_html_report(results)
            return HTMLResponse(
                content=html,
                headers={"Content-Disposition": f'attachment; filename="CSVAT_{safe_name}.html"'}
            )

    else:
        raise HTTPException(status_code=400, detail=f"Unknown asset type: {asset_type}")
