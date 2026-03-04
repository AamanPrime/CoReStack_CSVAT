"""CSVAT — Jobs API router.

Handles job submission, status polling, and asset delivery.
Uses PostGIS for persistence (replaces in-memory dict from MVP).

Modes:
  - SERVER: dispatches analytics to Celery worker (async), client polls for results
  - CLIENT: client runs WASM analytics, POSTs results for persistence via /save
"""

import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import HTMLResponse, PlainTextResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, ExecutionMode
from app.schemas import JobCreate, JobResponse
from app.services.report_service import report_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/jobs", tags=["Jobs"])


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
@router.post("", response_model=JobResponse)
async def create_job(request: JobCreate, db: Session = Depends(get_db)):
    """Submit a new analytics job.

    - mode=SERVER → dispatches to Celery worker, returns PENDING immediately.
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

    # For SERVER mode, dispatch to Celery worker
    if mode == ExecutionMode.SERVER:
        try:
            from app.tasks.analytics_task import run_analytics_task
            run_analytics_task.delay({
                "job_id": str(job_id),
                "boundary_id": request.boundary_id,
                "boundary_geojson": request.boundary_geojson,
                "village_name": request.village_name,
                "state": request.state,
                "district": request.district,
                "tehsil": request.tehsil,
                "layers": request.layers,
                "years": request.years,
            })
            logger.info("Celery task dispatched for job %s", job_id)
        except Exception as e:
            logger.warning("Celery dispatch failed, running sync: %s", str(e))
            # Fallback: run synchronously if Celery is not available
            try:
                from app.tasks.analytics_task import run_analytics_sync
                results = run_analytics_sync({
                    "job_id": str(job_id),
                    "boundary_id": request.boundary_id,
                    "boundary_geojson": request.boundary_geojson,
                    "village_name": request.village_name,
                    "state": request.state,
                    "district": request.district,
                    "tehsil": request.tehsil,
                    "layers": request.layers,
                    "years": request.years,
                })
                job.status = JobStatus.SUCCESS
                job.result_json = results
                job.updated_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(job)
            except Exception as sync_err:
                job.status = JobStatus.FAILED
                job.error_message = str(sync_err)
                job.updated_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(job)

    return _job_to_response(job)


# ─── POST /api/v1/jobs/save ────────────────────────────────────────
@router.post("/save", response_model=JobResponse)
async def save_client_results(request: dict, db: Session = Depends(get_db)):
    """Save client-side (WASM) analytics results to the database.

    Called after client finishes WASM computation.
    """
    job_id_str = request.get("job_id")
    results = request.get("results", {})

    if job_id_str:
        # Update existing job
        job = db.query(Job).filter(Job.id == uuid.UUID(job_id_str)).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job.result_json = results
        job.status = JobStatus.SUCCESS
        job.updated_at = datetime.now(timezone.utc)
    else:
        # Create new job from client results
        job = Job(
            id=uuid.uuid4(),
            village_name=results.get("village_name", "Unknown"),
            state=results.get("state", ""),
            district=results.get("district", ""),
            tehsil=results.get("tehsil", ""),
            layers=request.get("layers", []),
            years=request.get("years", []),
            mode=ExecutionMode.CLIENT,
            status=JobStatus.SUCCESS,
            result_json=results,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(job)

    # Generate server-side reports for client results too
    try:
        html_report = report_service.generate_html_report(results)
        csv_data = report_service.generate_csv(results)
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
async def get_job(job_id: str, db: Session = Depends(get_db)):
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
async def get_job_asset(job_id: str, asset_type: str, db: Session = Depends(get_db)):
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
