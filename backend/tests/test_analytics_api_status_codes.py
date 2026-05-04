"""Tests for the MWS analytics API endpoint status contract.

Why this matters:
    POST /api/v1/analytics/mws returns HTTP 200 in ALL cases — success, MWS
    unavailable, and tehsil not active.  The JSON body 'status' field drives
    the frontend's decision tree:

        "success"            → render charts
        "tehsil_not_active"  → show "Use GEE instead?" prompt
        "mws_unavailable"    → show "Use GEE instead?" prompt

    If a ValueError leaks to the global 500 handler instead, the frontend
    receives an unexpected 500 and crashes without prompting the user.
    This test locks in that contract permanently.

    All external calls (corestack_client, mws_service) are mocked.
    JWT auth is bypassed via FastAPI dependency override.
"""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.utils.auth_middleware import verify_token


# ─── Bypass authentication for all tests in this module ──────────────────────

@pytest.fixture(autouse=True)
def override_auth():
    """Replace JWT verify_token with a no-op stub."""
    app.dependency_overrides[verify_token] = lambda: {"sub": "test-user"}
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    return TestClient(app)


# ─── Shared request payload ───────────────────────────────────────────────────

BASE_REQUEST = {
    "boundary_geojson": {
        "type": "Polygon",
        "coordinates": [[
            [78.400, 17.400],
            [78.410, 17.400],
            [78.410, 17.410],
            [78.400, 17.410],
            [78.400, 17.400],
        ]],
    },
    "state": "Telangana",
    "district": "Nalgonda",
    "tehsil": "Miryalaguda",
    "village_name": "Test Village",
    "layers": ["cropping_intensity"],
    "years": [2022, 2023],
}


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestMWSAnalyticsStatusContract:
    """The JSON 'status' field must correctly reflect each outcome."""

    def test_tehsil_not_active_returns_200_with_correct_status(self, client):
        """When tehsil is not in active locations → status='tehsil_not_active', HTTP 200."""
        with patch(
            "app.api.analytics.boundary_service.validate_tehsil_intersection",
            new=AsyncMock(return_value=False),
        ):
            resp = client.post("/api/v1/analytics/mws", json=BASE_REQUEST)

        assert resp.status_code == 200, (
            f"Expected HTTP 200 (not 4xx/5xx) even when tehsil is inactive, got {resp.status_code}"
        )
        body = resp.json()
        assert body["status"] == "tehsil_not_active"
        assert "GEE" in body["message"] or "not" in body["message"].lower()

    def test_no_mws_geometries_returns_mws_unavailable(self, client):
        """ValueError from compute_village_analytics → status='mws_unavailable', HTTP 200."""
        with (
            patch(
                "app.api.analytics.boundary_service.validate_tehsil_intersection",
                new=AsyncMock(return_value=True),
            ),
            patch(
                "app.api.analytics.mws_service.compute_village_analytics",
                new=AsyncMock(side_effect=ValueError("No MWS geometries found")),
            ),
        ):
            resp = client.post("/api/v1/analytics/mws", json=BASE_REQUEST)

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "mws_unavailable"

    def test_unexpected_exception_returns_mws_unavailable_not_500(self, client):
        """A crash in compute_village_analytics must NOT produce HTTP 500.

        The global exception handler only sees unhandled exceptions; the analytics
        endpoint must catch everything and return mws_unavailable instead.
        """
        with (
            patch(
                "app.api.analytics.boundary_service.validate_tehsil_intersection",
                new=AsyncMock(return_value=True),
            ),
            patch(
                "app.api.analytics.mws_service.compute_village_analytics",
                new=AsyncMock(side_effect=RuntimeError("Simulated network failure")),
            ),
        ):
            resp = client.post("/api/v1/analytics/mws", json=BASE_REQUEST)

        assert resp.status_code == 200, (
            "Unexpected exception must be caught — HTTP 500 would break the frontend fallback flow"
        )
        assert resp.json()["status"] == "mws_unavailable"

    def test_successful_run_returns_success_status(self, client):
        """Happy path: validate=True, compute returns data → status='success'."""
        mock_results = {
            "cropping_intensity": [
                {
                    "year": "2021-22",
                    "single_crop_ha": 50.0,
                    "double_crop_ha": 30.0,
                    "triple_crop_ha": 5.0,
                    "total_cropped_ha": 85.0,
                    "cropping_intensity": 1.41,
                }
            ],
            "mws_count": 3,
            "data_source": "corestack_mws",
        }
        with (
            patch(
                "app.api.analytics.boundary_service.validate_tehsil_intersection",
                new=AsyncMock(return_value=True),
            ),
            patch(
                "app.api.analytics.mws_service.compute_village_analytics",
                new=AsyncMock(return_value=mock_results),
            ),
        ):
            resp = client.post("/api/v1/analytics/mws", json=BASE_REQUEST)

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "success"
        assert body["mws_count"] == 3
        assert body["data_source"] == "corestack_mws"

    def test_missing_boundary_geojson_returns_422(self, client):
        """Malformed request body (missing required field) → HTTP 422 from Pydantic."""
        bad_request = {k: v for k, v in BASE_REQUEST.items() if k != "boundary_geojson"}
        resp = client.post("/api/v1/analytics/mws", json=bad_request)
        assert resp.status_code == 422

    def test_skip_tehsil_validation_when_admin_unknown(self, client):
        """When state/district/tehsil are empty, skip validation and go straight to MWS."""
        request_no_admin = {**BASE_REQUEST, "state": "", "district": "", "tehsil": ""}
        mock_results = {"mws_count": 1, "data_source": "corestack_mws"}

        with patch(
            "app.api.analytics.mws_service.compute_village_analytics",
            new=AsyncMock(return_value=mock_results),
        ):
            resp = client.post("/api/v1/analytics/mws", json=request_no_admin)

        # Should NOT call validate_tehsil_intersection when admin fields are blank.
        # Any status other than tehsil_not_active is acceptable here.
        assert resp.status_code == 200
        assert resp.json()["status"] != "tehsil_not_active"
