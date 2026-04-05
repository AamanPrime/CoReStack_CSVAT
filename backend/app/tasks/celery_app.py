"""CSVAT — Celery application configured with Redis broker."""

import os
from celery import Celery

# Use REDIS_URL from env, default to redis://redis:6379/0 (Docker service name)
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

celery_app = Celery(
    "csvat",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_hijack_root_logger=False,
)

# Register the analytics task
@celery_app.task(name="csvat.run_analytics", bind=True, max_retries=1)
def run_analytics_celery(self, job_params: dict) -> dict:
    """Celery wrapper around the analytics pipeline."""
    from app.tasks.analytics_task import run_analytics_task
    return run_analytics_task(job_params)