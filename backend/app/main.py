"""
CSVAT — CoRE Stack Village Analytics Tool
FastAPI Backend Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import analytics, boundary

app = FastAPI(
    title="CSVAT API",
    description="CoRE Stack Village Analytics Tool — Backend API",
    version="0.1.0",
)

# CORS — allow the React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(analytics.router)
app.include_router(boundary.router)


@app.get("/")
def root():
    return {
        "name": "CSVAT API",
        "version": "0.1.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"status": "ok"}
