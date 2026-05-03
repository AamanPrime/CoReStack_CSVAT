"""CSVAT — Main FastAPI Application.

CoRE Stack Village Analytics Tool — Backend Server.
# Build version: 1.0.1
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import auth, boundaries, layers, jobs, gee, analytics, corestack, raster_proxy, village_stories, custom_slides, maps_proxy, overpass_proxy, storyboard
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create database tables on startup."""
    try:
        from app.database import engine, Base
        from app.models import Job, CachedBoundary, VillageStory, CustomSlide, VillageStoryboardSlide  # noqa: F401 — register models

        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created/verified.")
    except Exception as e:
        logger.warning("DB table creation skipped (DB may not be available): %s", e)
    yield


app = FastAPI(
    title="CSVAT — CoRE Stack Village Analytics Tool",
    description=(
        "Web-based geospatial analytics platform for generating village-level "
        "socio-ecological insights from CoRE Stack datasets."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS — allow React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(auth.router)
app.include_router(boundaries.router)
app.include_router(layers.router)
app.include_router(jobs.router)
app.include_router(gee.router)
app.include_router(analytics.router)
app.include_router(corestack.router)
app.include_router(raster_proxy.router)
app.include_router(village_stories.router)
app.include_router(custom_slides.router)
app.include_router(maps_proxy.router)
app.include_router(overpass_proxy.router)
app.include_router(overpass_proxy.legacy_router)
app.include_router(storyboard.router)


@app.get("/", tags=["Health"])
async def root():
    return {
        "app": settings.APP_NAME,
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
    }


from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Global crash: %s", str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "error": str(exc)},
    )

@app.get("/health", tags=["Health"])
async def health():
    db_status = "unknown"
    try:
        from app.database import SessionLocal
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        db_status = "connected"
    except Exception as e:
        db_status = f"failed: {str(e)}"
    
    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status
    }
