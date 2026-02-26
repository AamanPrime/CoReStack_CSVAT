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

    # Database
    DATABASE_URL: str = "postgresql://csvat:csvat_pass@localhost:5432/csvat_db"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # CoRE Stack
    CORESTACK_API_BASE_URL: str = "https://api.core-stack.org"
    CORESTACK_API_KEY: str = ""

    # JWT
    JWT_SECRET_KEY: str = "change-me-to-a-random-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_MINUTES: int = 60

    # GEE REST API
    GEE_API_KEY: str = ""
    GEE_PROJECT: str = "earthengine-public"
    GEE_SERVICE_ACCOUNT: str = ""
    GEE_KEY_FILE: str = ""

    class Config:
        env_file = str(ENV_FILE)
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
