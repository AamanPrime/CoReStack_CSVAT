"""CSVAT — Jobs API router.

Handles job submission, status polling, and asset delivery.
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from app.schemas import JobCreate, JobResponse
from app.services.boundary_service import boundary_service
from app.services.analytics.cropping import compute_cropping_intensity
from app.services.analytics.water import compute_surface_water
from app.services.analytics.vegetation import compute_vegetation_change
from app.services.report_service import report_service

router = APIRouter(prefix="/api/v1/jobs", tags=["Jobs"])

# In-memory job store (MVP — replaces PostGIS when DB is not available)
_jobs: dict[str, dict] = {}


@router.post("", response_model=JobResponse)
async def create_job(request: JobCreate):
    """Submit a new analytics job.

    The job runs the analytics pipeline synchronously in MVP mode.
    In production, this would dispatch to Celery workers.
    """
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # Resolve boundary
    try:
        boundary = boundary_service.resolve_boundary(
            boundary_id=request.boundary_id,
            geojson=request.boundary_geojson,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    village_name = request.village_name or boundary["name"]
    state = request.state or boundary["state"]
    district = request.district or boundary["district"]
    tehsil = request.tehsil or boundary["tehsil"]
    geojson = boundary["geojson"]

    # Validate tehsil intersection (FR-BA-03, FR-BA-04)
    if not boundary_service.validate_tehsil_intersection(state, district, tehsil):
        raise HTTPException(
            status_code=422,
            detail=f"Village {village_name} does not intersect an active tehsil."
        )

    # Run analytics synchronously (MVP — no Celery needed)
    results = {
        "village_name": village_name,
        "state": state,
        "district": district,
        "tehsil": tehsil,
    }

    layers = request.layers
    years = request.years or [2019, 2020, 2021, 2022, 2023]

    try:
        if "cropping_intensity" in layers:
            results["cropping_intensity"] = compute_cropping_intensity(
                village_name, geojson, years
            )

        if "surface_water" in layers:
            results["surface_water"] = compute_surface_water(
                village_name, geojson, years
            )

        if "vegetation" in layers:
            results["vegetation"] = compute_vegetation_change(
                village_name, geojson, years
            )

        # Generate reports
        html_report = report_service.generate_html_report(results)
        csv_data = report_service.generate_csv(results)
        results["html_report"] = html_report
        results["csv_data"] = csv_data

        status = "SUCCESS"
        error_message = None
    except Exception as e:
        status = "FAILED"
        error_message = str(e)

    # Store job
    job_data = {
        "id": job_id,
        "boundary_id": request.boundary_id,
        "village_name": village_name,
        "state": state,
        "district": district,
        "tehsil": tehsil,
        "layers": layers,
        "years": years,
        "mode": request.mode,
        "status": status,
        "result_json": results,
        "error_message": error_message,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    _jobs[job_id] = job_data

    return JobResponse(
        id=uuid.UUID(job_id),
        status=status,
        village_name=village_name,
        state=state,
        district=district,
        tehsil=tehsil,
        layers=layers,
        years=years,
        mode=request.mode,
        result_json={k: v for k, v in results.items() if k not in ("html_report", "csv_data")},
        error_message=error_message,
        created_at=now,
        updated_at=now,
    )


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    """Get status and results of a job.

    Maps to polling connector for async job monitoring.
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    results = job.get("result_json", {})
    return JobResponse(
        id=uuid.UUID(job["id"]),
        status=job["status"],
        village_name=job.get("village_name"),
        state=job.get("state"),
        district=job.get("district"),
        tehsil=job.get("tehsil"),
        layers=job.get("layers", []),
        years=job.get("years", []),
        mode=job.get("mode", "SERVER"),
        result_json={k: v for k, v in results.items() if k not in ("html_report", "csv_data")},
        error_message=job.get("error_message"),
        created_at=datetime.fromisoformat(job["created_at"]) if job.get("created_at") else None,
        updated_at=datetime.fromisoformat(job["updated_at"]) if job.get("updated_at") else None,
    )


@router.get("/{job_id}/assets/{asset_type}")
async def get_job_asset(job_id: str, asset_type: str):
    """Download a job asset (HTML report, CSV, or PDF).

    Asset types: html, csv, pdf.
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] != "SUCCESS":
        raise HTTPException(status_code=400, detail="Job has not completed successfully")

    results = job.get("result_json", {})

    if asset_type == "html":
        html = results.get("html_report", "<p>No report generated</p>")
        return HTMLResponse(content=html)

    elif asset_type == "csv":
        csv_data = results.get("csv_data", "")
        return PlainTextResponse(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="csvat_report_{job_id[:8]}.csv"'}
        )

    elif asset_type == "pdf":
        # For MVP, return HTML as PDF is complex without wkhtmltopdf/weasyprint
        html = results.get("html_report", "<p>No report generated</p>")
        return HTMLResponse(
            content=html,
            headers={"Content-Disposition": f'attachment; filename="csvat_report_{job_id[:8]}.html"'}
        )

    else:
        raise HTTPException(status_code=400, detail=f"Unknown asset type: {asset_type}")
