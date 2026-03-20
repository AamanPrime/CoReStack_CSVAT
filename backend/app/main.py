"""CSVAT — Main FastAPI Application.

CoRE Stack Village Analytics Tool — Backend Server.
# Build version: 1.0.1
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import auth, boundaries, layers, jobs, gee, analytics, corestack, raster_proxy
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create database tables on startup."""
    try:
        from app.database import engine, Base
        from app.models import Job, CachedBoundary  # noqa: F401 — register models

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


@app.get("/", tags=["Health"])
async def root():
    return {
        "app": settings.APP_NAME,
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "healthy"}
