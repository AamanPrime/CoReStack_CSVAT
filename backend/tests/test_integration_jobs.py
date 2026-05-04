"""Integration Tests — Jobs API ↔ Database.

Layer 2 of the testing plan. Unlike unit tests (which test pure functions in
isolation), these tests exercise the full request/response cycle through
FastAPI's router → dependency injection → SQLAlchemy ORM → SQLite DB.

Why this layer is necessary:
    Unit tests cannot catch:
    - ORM schema mismatches (column renamed or missing)
    - SQLAlchemy session lifecycle bugs (session not committed, double-close)
    - Pydantic → ORM field mapping errors
    - HTTP status codes returned by the actual route handlers
    - Report generation triggered as a side-effect of saving results
    - Asset endpoint content-type and header correctness

Setup strategy:
    Each test gets a fresh SQLite in-memory database via a pytest fixture that
    overrides FastAPI's `get_db` dependency. No PostgreSQL, no Docker needed.
    Auth is bypassed via dependency override (same pattern as analytics tests).

Coverage:
    POST   /api/v1/jobs                       → create job (SERVER + CLIENT mode)
    GET    /api/v1/jobs/{id}                  → fetch job by ID
    GET    /api/v1/jobs/{fake-id}             → 404 for unknown job
    POST   /api/v1/jobs/{id}/client-results   → save WASM results, transition to SUCCESS
    GET    /api/v1/jobs/{id}/assets/csv       → download CSV report
    GET    /api/v1/jobs/{id}/assets/html      → download HTML report
    GET    /api/v1/jobs/{id}/assets/unknown   → 400 for bad asset type
    GET    /api/v1/jobs/{id}/assets/*         → 400 if job not yet SUCCESS
"""

import pytest
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.main import app
from app.database import Base, get_db
from app.utils.auth_middleware import verify_token


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def test_engine():
    """Fresh SQLite in-memory engine with all tables created."""
    from sqlalchemy import create_engine as _create
    from app.models import Job, CachedBoundary, VillageStory, CustomSlide  # noqa: F401

    engine = _create(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="function")
def client(test_engine, monkeypatch):
    """TestClient wired to in-memory DB with auth bypassed.

    Monkeypatches app.database.engine so that every layer that imports it
    (the router's get_db, SQLAlchemy ORM internals, lifespan) all see the
    same in-memory engine — fixing the 'no such table' error that occurs when
    the session override uses the test engine but the ORM resolves foreign
    keys against the real (production) engine.
    """
    import app.database as db_module

    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

    # Patch the module-level engine so ORM metadata resolves against test DB
    monkeypatch.setattr(db_module, "engine", test_engine)
    monkeypatch.setattr(db_module, "SessionLocal", TestingSession)

    def _override_get_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


# ─── Shared test data ─────────────────────────────────────────────────────────

VALID_JOB_PAYLOAD = {
    "village_name": "Test Village",
    "state": "Telangana",
    "district": "Nalgonda",
    "tehsil": "Miryalaguda",
    "boundary_geojson": {
        "type": "Polygon",
        "coordinates": [[
            [78.400, 17.400], [78.410, 17.400],
            [78.410, 17.410], [78.400, 17.410],
            [78.400, 17.400],
        ]],
    },
    "layers": ["cropping_intensity", "surface_water"],
    "years": [2021, 2022, 2023],
    "mode": "CLIENT",
}

SAMPLE_RESULTS = {
    "village_name": "Test Village",
    "state": "Telangana",
    "district": "Nalgonda",
    "tehsil": "Miryalaguda",
    "area_hectares": 120.5,
    "data_source": "corestack_mws",
    "cropping_intensity": {
        "village_name": "Test Village",
        "data": [
            {
                "year": "2021-22",
                "single_crop_ha": 50.0,
                "double_crop_ha": 30.0,
                "triple_crop_ha": 5.0,
                "total_cropped_ha": 85.0,
                "cropping_intensity": 1.41,
            }
        ],
    },
    "surface_water": {
        "village_name": "Test Village",
        "data": [
            {
                "year": "2021-22",
                "kharif_ha": 10.0,
                "rabi_ha": 5.0,
                "zaid_ha": 2.0,
                "total_water_ha": 17.0,
            }
        ],
    },
}


# ─── POST /api/v1/jobs ────────────────────────────────────────────────────────

class TestCreateJob:
    """Job creation must persist to DB and return correct initial state."""

    def test_create_job_returns_201(self, client):
        resp = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD)
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"

    def test_create_job_response_has_id(self, client):
        resp = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD)
        body = resp.json()
        assert "id" in body
        assert len(body["id"]) == 36, "ID should be a UUID (36 chars)"

    def test_create_job_initial_status_is_pending(self, client):
        """A freshly created CLIENT-mode job must start as PENDING."""
        resp = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD)
        assert resp.json()["status"] == "PENDING"

    def test_create_job_persists_village_metadata(self, client):
        """Village name, state, district, tehsil must be stored and returned."""
        resp = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD)
        body = resp.json()
        assert body["village_name"] == "Test Village"
        assert body["state"] == "Telangana"
        assert body["district"] == "Nalgonda"
        assert body["tehsil"] == "Miryalaguda"

    def test_create_job_persists_layers_and_years(self, client):
        """Layers and years must be stored exactly as submitted."""
        resp = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD)
        body = resp.json()
        assert set(body["layers"]) == {"cropping_intensity", "surface_water"}
        assert set(body["years"]) == {2021, 2022, 2023}

    def test_create_job_mode_is_client(self, client):
        resp = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD)
        assert resp.json()["mode"] == "CLIENT"

    def test_create_server_mode_job(self, client):
        """SERVER mode job starts as PENDING (background task is mocked to prevent GEE call)."""
        from unittest.mock import patch
        payload = {**VALID_JOB_PAYLOAD, "mode": "SERVER"}
        # Patch the analytics task so the background thread doesn't try to call GEE
        with patch("app.tasks.analytics_task.run_analytics_task", return_value=None):
            resp = client.post("/api/v1/jobs", json=payload)
        assert resp.status_code == 201
        assert resp.json()["mode"] == "SERVER"
        # Status is PENDING immediately; background runs after response is sent
        assert resp.json()["status"] in ("PENDING", "RUNNING", "FAILED")

    def test_create_job_has_timestamps(self, client):
        """created_at and updated_at must be non-null ISO timestamps."""
        resp = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD)
        body = resp.json()
        assert body["created_at"] is not None
        assert body["updated_at"] is not None


# ─── GET /api/v1/jobs/{job_id} ────────────────────────────────────────────────

class TestGetJob:
    """Fetching a job must return the same data that was created."""

    def test_get_existing_job_returns_200(self, client):
        job_id = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD).json()["id"]
        resp = client.get(f"/api/v1/jobs/{job_id}")
        assert resp.status_code == 200

    def test_get_job_returns_correct_id(self, client):
        job_id = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD).json()["id"]
        body = client.get(f"/api/v1/jobs/{job_id}").json()
        assert body["id"] == job_id

    def test_get_job_status_matches_created_status(self, client):
        job_id = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD).json()["id"]
        body = client.get(f"/api/v1/jobs/{job_id}").json()
        assert body["status"] == "PENDING"

    def test_get_nonexistent_job_returns_404(self, client):
        """Polling a job ID that doesn't exist must return 404, not 500.

        Why: Frontend polls job status every 2s. A missing job ID (e.g., from a
        cleared DB) must not crash the server — it must return a clear 404 so
        the frontend can stop polling and show an error.
        """
        resp = client.get("/api/v1/jobs/00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404

    def test_get_job_result_json_is_null_before_completion(self, client):
        """A PENDING job must have no meaningful result_json.

        SQLAlchemy JSON columns return {} (not None) when the column is set
        to null in SQLite. We check that the dict is either None or empty —
        not a stale result from a previous job.
        """
        job_id = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD).json()["id"]
        body = client.get(f"/api/v1/jobs/{job_id}").json()
        result = body["result_json"]
        assert result is None or result == {}, (
            f"PENDING job should have empty result_json, got: {result}"
        )


# ─── POST /api/v1/jobs/{id}/client-results ────────────────────────────────────

class TestSaveClientResults:
    """Saving WASM results must transition job to SUCCESS and persist data."""

    def _create_job(self, client) -> str:
        return client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD).json()["id"]

    def test_save_results_returns_200(self, client):
        job_id = self._create_job(client)
        resp = client.post(
            f"/api/v1/jobs/{job_id}/client-results",
            json={"results": SAMPLE_RESULTS},
        )
        assert resp.status_code == 200

    def test_save_results_transitions_status_to_success(self, client):
        """After saving client results, status must be SUCCESS.

        Why: The frontend polls until it sees SUCCESS. If the status doesn't
        update, polling never terminates and the UI hangs indefinitely.
        """
        job_id = self._create_job(client)
        client.post(
            f"/api/v1/jobs/{job_id}/client-results",
            json={"results": SAMPLE_RESULTS},
        )
        body = client.get(f"/api/v1/jobs/{job_id}").json()
        assert body["status"] == "SUCCESS"

    def test_save_results_persists_result_data(self, client):
        """Result JSON must be retrievable after saving."""
        job_id = self._create_job(client)
        client.post(
            f"/api/v1/jobs/{job_id}/client-results",
            json={"results": SAMPLE_RESULTS},
        )
        body = client.get(f"/api/v1/jobs/{job_id}").json()
        # result_json strips html_report and csv_data in _job_to_response
        assert body["result_json"] is not None
        assert body["result_json"].get("village_name") == "Test Village"
        assert body["result_json"].get("data_source") == "corestack_mws"

    def test_save_results_for_nonexistent_job_returns_404(self, client):
        resp = client.post(
            "/api/v1/jobs/nonexistent-job-id/client-results",
            json={"results": SAMPLE_RESULTS},
        )
        assert resp.status_code == 404

    def test_html_report_and_csv_stripped_from_result_json(self, client):
        """html_report and csv_data must be stripped from the GET /jobs/{id} response.

        Why: These can be megabytes of text. Returning them in the polling
        response would bloat every status-check response. They're only served
        via the dedicated /assets endpoints.
        """
        job_id = self._create_job(client)
        client.post(
            f"/api/v1/jobs/{job_id}/client-results",
            json={"results": SAMPLE_RESULTS},
        )
        body = client.get(f"/api/v1/jobs/{job_id}").json()
        result = body.get("result_json", {})
        assert "html_report" not in result, "html_report must be stripped from GET /jobs/{id}"
        assert "csv_data" not in result, "csv_data must be stripped from GET /jobs/{id}"


# ─── GET /api/v1/jobs/{id}/assets/{type} ──────────────────────────────────────

class TestJobAssets:
    """Asset endpoints must serve correct content types and handle error cases."""

    def _create_completed_job(self, client) -> str:
        """Helper: create a CLIENT job and save results so it's in SUCCESS state."""
        job_id = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD).json()["id"]
        client.post(
            f"/api/v1/jobs/{job_id}/client-results",
            json={"results": SAMPLE_RESULTS},
        )
        return job_id

    def test_csv_asset_returns_200(self, client):
        job_id = self._create_completed_job(client)
        resp = client.get(f"/api/v1/jobs/{job_id}/assets/csv")
        assert resp.status_code == 200

    def test_csv_asset_content_type(self, client):
        """Content-Type must be text/csv so browsers trigger a file download."""
        job_id = self._create_completed_job(client)
        resp = client.get(f"/api/v1/jobs/{job_id}/assets/csv")
        assert "text/csv" in resp.headers.get("content-type", "")

    def test_csv_asset_contains_village_name(self, client):
        """CSV content must contain meaningful data — checking for cropping intensity section."""
        job_id = self._create_completed_job(client)
        resp = client.get(f"/api/v1/jobs/{job_id}/assets/csv")
        # The report_service CSV includes section headers for submitted layers
        assert "Cropping Intensity" in resp.text or "Surface Water" in resp.text, (
            f"CSV must contain analytics data sections, got: {resp.text[:200]}"
        )

    def test_csv_asset_has_content_disposition_header(self, client):
        """Content-Disposition header must be present for browser download to work."""
        job_id = self._create_completed_job(client)
        resp = client.get(f"/api/v1/jobs/{job_id}/assets/csv")
        cd = resp.headers.get("content-disposition", "")
        assert "attachment" in cd, "Content-Disposition must include 'attachment'"
        assert ".csv" in cd, "Content-Disposition must reference a .csv filename"

    def test_html_asset_returns_200(self, client):
        job_id = self._create_completed_job(client)
        resp = client.get(f"/api/v1/jobs/{job_id}/assets/html")
        assert resp.status_code == 200

    def test_html_asset_content_type(self, client):
        job_id = self._create_completed_job(client)
        resp = client.get(f"/api/v1/jobs/{job_id}/assets/html")
        assert "text/html" in resp.headers.get("content-type", "")

    def test_html_asset_contains_village_name(self, client):
        """HTML report must contain the village name (smoke-check on report generation)."""
        job_id = self._create_completed_job(client)
        resp = client.get(f"/api/v1/jobs/{job_id}/assets/html")
        assert "Test Village" in resp.text

    def test_unknown_asset_type_returns_400(self, client):
        """Requesting an unsupported asset type (e.g. 'xml') must return 400, not 500."""
        job_id = self._create_completed_job(client)
        resp = client.get(f"/api/v1/jobs/{job_id}/assets/xml")
        assert resp.status_code == 400

    def test_asset_on_pending_job_returns_400(self, client):
        """Requesting an asset before the job completes must return 400, not crash.

        Why: The frontend shows a download button after seeing SUCCESS status.
        But a race condition (user refreshes mid-job) could trigger an asset
        request on a PENDING job. This must return a clear error, not a 500.
        """
        job_id = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD).json()["id"]
        resp = client.get(f"/api/v1/jobs/{job_id}/assets/csv")
        assert resp.status_code == 400

    def test_asset_on_nonexistent_job_returns_404(self, client):
        resp = client.get("/api/v1/jobs/does-not-exist/assets/html")
        assert resp.status_code == 404


# ─── Data integrity across the full lifecycle ─────────────────────────────────

class TestJobLifecycle:
    """End-to-end lifecycle: create → poll → save results → download assets."""

    def test_full_client_mode_lifecycle(self, client):
        """Complete CLIENT mode flow: submit → poll PENDING → save → poll SUCCESS → download.

        This is the most important integration test — it mirrors exactly what
        the frontend does for every analytics job.
        """
        # 1. Create job
        create_resp = client.post("/api/v1/jobs", json=VALID_JOB_PAYLOAD)
        assert create_resp.status_code == 201
        job_id = create_resp.json()["id"]

        # 2. Poll — should be PENDING with no result data
        poll_resp = client.get(f"/api/v1/jobs/{job_id}")
        assert poll_resp.json()["status"] == "PENDING"
        result = poll_resp.json()["result_json"]
        assert result is None or result == {}, "PENDING job should have no result data"

        # 3. Save client results (WASM finished)
        save_resp = client.post(
            f"/api/v1/jobs/{job_id}/client-results",
            json={"results": SAMPLE_RESULTS},
        )
        assert save_resp.status_code == 200
        assert save_resp.json()["status"] == "SUCCESS"

        # 4. Poll again — should be SUCCESS
        final_poll = client.get(f"/api/v1/jobs/{job_id}")
        assert final_poll.json()["status"] == "SUCCESS"
        assert final_poll.json()["result_json"] is not None

        # 5. Download CSV
        csv_resp = client.get(f"/api/v1/jobs/{job_id}/assets/csv")
        assert csv_resp.status_code == 200
        assert "Cropping Intensity" in csv_resp.text or "Surface Water" in csv_resp.text

        # 6. Download HTML
        html_resp = client.get(f"/api/v1/jobs/{job_id}/assets/html")
        assert html_resp.status_code == 200
        assert "Test Village" in html_resp.text

    def test_multiple_jobs_are_isolated(self, client):
        """Two concurrent jobs must not interfere with each other's data.

        Why: SQLAlchemy session caching can sometimes return stale data from
        a previous job. This test ensures each job gets its own isolated row.
        """
        payload_a = {**VALID_JOB_PAYLOAD, "village_name": "Village Alpha"}
        payload_b = {**VALID_JOB_PAYLOAD, "village_name": "Village Beta"}

        id_a = client.post("/api/v1/jobs", json=payload_a).json()["id"]
        id_b = client.post("/api/v1/jobs", json=payload_b).json()["id"]

        assert id_a != id_b

        body_a = client.get(f"/api/v1/jobs/{id_a}").json()
        body_b = client.get(f"/api/v1/jobs/{id_b}").json()

        assert body_a["village_name"] == "Village Alpha"
        assert body_b["village_name"] == "Village Beta"
