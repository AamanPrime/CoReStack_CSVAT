"""CSVAT Backend Configuration."""

import os
from pathlib import Path
from pydantic_settings import BaseSettings
from functools import lru_cache

# Load .env from backend directory
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # App
    APP_NAME: str = "CSVAT"
    DEBUG: bool = True

    # Database (SQLite for local dev, PostgreSQL for production)
    DATABASE_URL: str = "sqlite:///./csvat.db"

    # CoRE Stack
    CORESTACK_API_BASE_URL: str = "https://api-doc.core-stack.org/api/v1"
    CORESTACK_API_KEY: str = ""

    # JWT
    JWT_SECRET_KEY: str = "change-me-to-a-random-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_MINUTES: int = 60
    REQUIRE_AUTH: bool = False  # Set True in production to enforce JWT on protected routes

    # GEE REST API
    GEE_API_KEY: str = ""
    GEE_PROJECT: str = "earthengine-public"
    GEE_SERVICE_ACCOUNT: str = ""
    GEE_KEY_FILE: str = ""
    GEE_KEY_JSON: str = ""

    # Google Maps (for static map proxy)
    GOOGLE_MAPS_KEY: str = ""

    # Groq LLM (for storyboard slide generation)
    GROQ_API_KEY: str = ""

    # GeoServer (for MWS geometry downloads)
    GEOSERVER_BASE_URL: str = ""

    class Config:
        env_file = str(ENV_FILE)
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
