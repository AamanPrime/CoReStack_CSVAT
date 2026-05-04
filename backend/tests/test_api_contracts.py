"""API Contract Tests — Layer 3.

What contract tests are and why they differ from integration tests:
    - Integration tests (Layer 2) verify that state transitions and persistence
      work correctly end-to-end through the ORM.
    - Contract tests (Layer 3) verify that the *exact JSON schema* returned by
      each public endpoint never changes unexpectedly.

The frontend's `api.js` reads specific JSON keys by name:
    - `access_token`, `token_type`       ← auth
    - `results`, `count`                 ← autocomplete
    - `id`, `name`, `state`, `district`, `tehsil`, `level`  ← each result item
    - `layers`, each with `id`, `name`, `available_years`, `unit`
    - `status`, `database`               ← health

If any of these keys are renamed, the frontend silently breaks.
These tests lock every public response schema permanently.

Coverage:
    GET  /                               → root shape
    GET  /health                         → { status, database }
    GET  /docs                           → HTTP 200 (Swagger UI alive)
    POST /api/v1/auth/token              → { access_token, token_type }
    POST /api/v1/auth/token (bad)        → HTTP 401
    POST /api/v1/auth/token (empty body) → HTTP 422
    GET  /api/v1/boundaries/autocomplete → { results: [...], count }
    GET  /api/v1/boundaries/autocomplete (q<2) → HTTP 422
    GET  /api/v1/boundaries/autocomplete (no match) → { results: [], count: 0 }
    GET  /api/v1/boundaries/village/{id}  → full shape with geojson
    GET  /api/v1/boundaries/village/nonexistent → HTTP 404
    GET  /api/v1/layers                  → { layers: [...] } with full item shape
    GET  /api/v1/raster/check (safe URL)        → { available: bool }
    GET  /api/v1/raster/check (blocked URL)     → HTTP 403
    GET  /api/v1/raster/download (blocked URL)  → HTTP 403
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def test_engine():
    """Shared in-memory SQLite engine for the whole module.

    Module-scoped because contract tests are read-only — they don't mutate
    state, so one DB is safe to reuse across all tests in this file.
    """
    from sqlalchemy import create_engine as _ce
    from app.models import Job, CachedBoundary, VillageStory, CustomSlide  # noqa: F401
    engine = _ce("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="module")
def client(test_engine):
    """TestClient with in-memory DB. Auth is NOT bypassed here (except where
    explicitly needed) so that auth contract tests are realistic."""
    import app.database as db_module
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

    # Patch module-level engine so lifespan and get_db both see test DB
    original_engine = db_module.engine
    original_session = db_module.SessionLocal
    db_module.engine = test_engine
    db_module.SessionLocal = TestingSession

    def _override_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_db

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
    db_module.engine = original_engine
    db_module.SessionLocal = original_session


# ─── Helper ───────────────────────────────────────────────────────────────────

def get_token(client) -> str:
    """Obtain a real JWT for use in auth-protected contract checks."""
    resp = client.post("/api/v1/auth/token", json={"api_key": "test-key-for-contracts"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


# ─── Root & Health ────────────────────────────────────────────────────────────

class TestSystemEndpointContracts:
    """Root, health, and docs must always be reachable and return stable schemas."""

    def test_root_returns_200(self, client):
        resp = client.get("/")
        assert resp.status_code == 200

    def test_root_schema(self, client):
        """Root must return { app, version, status, docs }.

        Why: The frontend checks `status == 'running'` to confirm the API is up.
        A renamed key causes a false 'API unreachable' error.
        """
        body = client.get("/").json()
        assert "app" in body
        assert "version" in body
        assert body["status"] == "running"
        assert "docs" in body

    def test_health_returns_200(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_schema_has_status_field(self, client):
        """health.status must be 'healthy' or 'degraded' — never a raw exception."""
        body = client.get("/health").json()
        assert "status" in body
        assert body["status"] in ("healthy", "degraded"), (
            f"health.status must be 'healthy' or 'degraded', got {body['status']!r}"
        )

    def test_health_schema_has_database_field(self, client):
        """health.database describes DB connectivity — used in ops dashboards."""
        body = client.get("/health").json()
        assert "database" in body
        assert isinstance(body["database"], str)

    def test_health_is_healthy_with_valid_db(self, client):
        """With in-memory SQLite wired up, health should report 'healthy'."""
        body = client.get("/health").json()
        assert body["status"] == "healthy", (
            f"Expected 'healthy' with in-memory DB, got: {body}"
        )

    def test_docs_returns_200(self, client):
        """FastAPI Swagger UI must be reachable — used by developers and CI."""
        resp = client.get("/docs")
        assert resp.status_code == 200


# ─── Auth Contracts ───────────────────────────────────────────────────────────

class TestAuthContractSchema:
    """POST /api/v1/auth/token response schema must be stable.

    The frontend stores `data.access_token` in localStorage on login.
    A rename to `token` or `jwt` silently breaks every authenticated request.
    """

    def test_valid_key_returns_200(self, client):
        resp = client.post("/api/v1/auth/token", json={"api_key": "any-non-empty-key"})
        assert resp.status_code == 200

    def test_response_has_access_token_key(self, client):
        body = client.post("/api/v1/auth/token", json={"api_key": "test"}).json()
        assert "access_token" in body, (
            "Key 'access_token' missing — api.js reads this exact key on login"
        )

    def test_access_token_is_non_empty_string(self, client):
        body = client.post("/api/v1/auth/token", json={"api_key": "test"}).json()
        assert isinstance(body["access_token"], str)
        assert len(body["access_token"]) > 20, "JWT should be at least 20 chars"

    def test_response_has_token_type_bearer(self, client):
        """token_type must be 'bearer' — Axios interceptor uses it to set header."""
        body = client.post("/api/v1/auth/token", json={"api_key": "test"}).json()
        assert "token_type" in body
        assert body["token_type"].lower() == "bearer"

    def test_response_has_no_extra_sensitive_fields(self, client):
        """Token response must NOT expose api_key or full payload in plaintext."""
        body = client.post("/api/v1/auth/token", json={"api_key": "secret-key-123"}).json()
        assert "api_key" not in body
        assert "secret-key-123" not in str(body), (
            "Full API key must not be echoed back in the response"
        )

    def test_empty_api_key_returns_401(self, client):
        """Empty string api_key must be rejected, not accepted.

        Why: The frontend would store an empty JWT and every subsequent request
        would fail with 401, breaking the session silently.
        """
        resp = client.post("/api/v1/auth/token", json={"api_key": ""})
        assert resp.status_code == 401

    def test_missing_api_key_field_returns_422(self, client):
        """Missing api_key field → Pydantic 422, not 500."""
        resp = client.post("/api/v1/auth/token", json={})
        assert resp.status_code == 422

    def test_wrong_content_type_is_handled(self, client):
        """Sending form data instead of JSON must not crash the server (422, not 500)."""
        resp = client.post(
            "/api/v1/auth/token",
            data={"api_key": "test"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert resp.status_code in (422, 415), (
            "Wrong content type must be rejected cleanly, not cause a 500"
        )


# ─── Boundary Autocomplete Contracts ─────────────────────────────────────────

class TestBoundaryAutocompleteContract:
    """GET /api/v1/boundaries/autocomplete schema contract.

    The frontend BoundarySelector.jsx reads: results[].id, .name, .state,
    .district, .tehsil, .level — and the top-level `count`.
    """

    def test_query_returns_200(self, client):
        resp = client.get("/api/v1/boundaries/autocomplete?q=Hampi")
        assert resp.status_code == 200

    def test_top_level_has_results_and_count(self, client):
        body = client.get("/api/v1/boundaries/autocomplete?q=Hampi").json()
        assert "results" in body, "Key 'results' missing from autocomplete response"
        assert "count" in body, "Key 'count' missing from autocomplete response"

    def test_count_matches_results_length(self, client):
        body = client.get("/api/v1/boundaries/autocomplete?q=Hampi").json()
        assert body["count"] == len(body["results"])

    def test_results_is_a_list(self, client):
        body = client.get("/api/v1/boundaries/autocomplete?q=Hampi").json()
        assert isinstance(body["results"], list)

    def test_each_result_has_required_keys(self, client):
        """Every result object must have id, name, state, district, tehsil, level.

        These are the exact keys the frontend reads to populate the dropdown
        and to set boundary state. Any missing key causes a silent undefined.
        """
        body = client.get("/api/v1/boundaries/autocomplete?q=Hampi").json()
        assert len(body["results"]) > 0, "Expected at least one result for 'Hampi'"
        required = {"id", "name", "state", "district", "tehsil", "level"}
        for item in body["results"]:
            missing = required - set(item.keys())
            assert not missing, f"Result item missing keys: {missing}\nGot: {item}"

    def test_result_values_are_strings(self, client):
        """All six fields must be strings (not None or int)."""
        body = client.get("/api/v1/boundaries/autocomplete?q=Hampi").json()
        for item in body["results"]:
            for key in ("id", "name", "state", "district", "tehsil", "level"):
                assert isinstance(item[key], str), (
                    f"Field '{key}' must be a string, got {type(item[key]).__name__}: {item[key]!r}"
                )

    def test_level_is_valid_value(self, client):
        """level must be one of 'village', 'tehsil', 'district' — not a free string."""
        body = client.get("/api/v1/boundaries/autocomplete?q=Hampi").json()
        valid_levels = {"village", "tehsil", "district"}
        for item in body["results"]:
            assert item["level"] in valid_levels, (
                f"Invalid level {item['level']!r}, must be one of {valid_levels}"
            )

    def test_no_match_returns_empty_results_not_404(self, client):
        """No match must return { results: [], count: 0 } — not 404.

        Why: A 404 would cause the frontend to show 'search failed' instead of
        'no results found', confusing users.
        """
        body = client.get("/api/v1/boundaries/autocomplete?q=XxZzNonexistentVillage").json()
        assert body["results"] == []
        assert body["count"] == 0

    def test_query_too_short_returns_422(self, client):
        """Single character query must be rejected (min_length=2 is the contract)."""
        resp = client.get("/api/v1/boundaries/autocomplete?q=X")
        assert resp.status_code == 422

    def test_missing_query_param_returns_422(self, client):
        resp = client.get("/api/v1/boundaries/autocomplete")
        assert resp.status_code == 422

    def test_case_insensitive_matching(self, client):
        """Search must be case-insensitive — 'hampi' and 'HAMPI' both return results."""
        lower = client.get("/api/v1/boundaries/autocomplete?q=hampi").json()
        upper = client.get("/api/v1/boundaries/autocomplete?q=HAMPI").json()
        assert lower["count"] > 0
        assert upper["count"] > 0
        assert lower["count"] == upper["count"]


# ─── Village Boundary Endpoint Contract ───────────────────────────────────────

class TestVillageBoundaryContract:
    """GET /api/v1/boundaries/village/{id} schema contract."""

    def test_known_village_returns_200(self, client):
        resp = client.get("/api/v1/boundaries/village/vg-ka-01")  # Hampi
        assert resp.status_code == 200

    def test_known_village_has_required_fields(self, client):
        """Village boundary response must include geojson for map rendering.

        The frontend uses `data.geojson` to draw the boundary polygon and
        `data.state/district/tehsil` for MWS analytics lookup.
        """
        body = client.get("/api/v1/boundaries/village/vg-ka-01").json()
        required = {"id", "name", "state", "district", "tehsil", "geojson"}
        missing = required - set(body.keys())
        assert not missing, f"Village boundary response missing keys: {missing}"

    def test_geojson_is_a_polygon(self, client):
        """geojson must be a GeoJSON Polygon — not a FeatureCollection or raw coordinates."""
        body = client.get("/api/v1/boundaries/village/vg-ka-01").json()
        geojson = body["geojson"]
        assert geojson["type"] == "Polygon", (
            f"Expected Polygon type, got {geojson['type']!r}"
        )
        assert "coordinates" in geojson

    def test_nonexistent_village_returns_404(self, client):
        """Unknown village ID must return 404, not 500.

        Why: The frontend resolves boundaries by ID from autocomplete results.
        If a stale/invalid ID is used, a 500 would crash the analytics flow
        instead of showing a clean 'not found' error.
        """
        resp = client.get("/api/v1/boundaries/village/nonexistent-id-12345")
        assert resp.status_code == 404

    def test_404_response_has_detail_key(self, client):
        """FastAPI 404 must include a 'detail' field — the frontend shows this message."""
        body = client.get("/api/v1/boundaries/village/nonexistent-id-12345").json()
        assert "detail" in body


# ─── Layers Endpoint Contract ──────────────────────────────────────────────────

class TestLayersContract:
    """GET /api/v1/layers schema contract.

    LayerSelector.jsx reads layers[].id, .name, .available_years, .unit.
    """

    def test_layers_returns_200(self, client):
        resp = client.get("/api/v1/layers")
        assert resp.status_code == 200

    def test_top_level_has_layers_key(self, client):
        body = client.get("/api/v1/layers").json()
        assert "layers" in body, "Key 'layers' missing — LayerSelector.jsx reads this key"

    def test_layers_is_a_list(self, client):
        body = client.get("/api/v1/layers").json()
        assert isinstance(body["layers"], list)

    def test_at_least_three_layers_exist(self, client):
        """At minimum: cropping_intensity, surface_water, vegetation must be present."""
        body = client.get("/api/v1/layers").json()
        assert len(body["layers"]) >= 3

    def test_each_layer_has_required_keys(self, client):
        """Every layer item must have: id, name, description, available_years, unit."""
        body = client.get("/api/v1/layers").json()
        required = {"id", "name", "description", "available_years", "unit"}
        for layer in body["layers"]:
            missing = required - set(layer.keys())
            assert not missing, f"Layer missing keys: {missing}\nGot: {layer}"

    def test_layer_ids_are_known_values(self, client):
        """Layer IDs must match what the frontend passes as 'selectedLayers' payload.

        If an ID changes (e.g., 'cropping_intensity' → 'crop_intensity'), the
        analytics endpoint receives an unrecognised layer and silently skips it.
        """
        body = client.get("/api/v1/layers").json()
        known_ids = {"cropping_intensity", "surface_water", "vegetation", "waterbodies"}
        layer_ids = {layer["id"] for layer in body["layers"]}
        unrecognised = layer_ids - known_ids
        assert not unrecognised, (
            f"Unknown layer IDs returned: {unrecognised} — "
            f"frontend selectedLayers must match exactly"
        )

    def test_available_years_is_list_of_ints(self, client):
        """available_years must be a list of integers — not strings or floats."""
        body = client.get("/api/v1/layers").json()
        for layer in body["layers"]:
            years = layer["available_years"]
            assert isinstance(years, list), f"available_years must be a list, got {type(years)}"
            for y in years:
                assert isinstance(y, int), (
                    f"Year {y!r} in layer '{layer['id']}' must be int, got {type(y).__name__}"
                )

    def test_all_layers_cover_2022_and_2023(self, client):
        """Every layer must include 2022 and 2023 in available_years.

        Why: The default selectedYears in the frontend includes these years.
        A layer missing them would return 0 results silently.
        """
        body = client.get("/api/v1/layers").json()
        for layer in body["layers"]:
            assert 2022 in layer["available_years"], (
                f"Layer '{layer['id']}' missing year 2022"
            )
            assert 2023 in layer["available_years"], (
                f"Layer '{layer['id']}' missing year 2023"
            )

    def test_unit_is_non_empty_string(self, client):
        body = client.get("/api/v1/layers").json()
        for layer in body["layers"]:
            assert isinstance(layer["unit"], str) and layer["unit"].strip(), (
                f"Layer '{layer['id']}' has empty or non-string unit"
            )


# ─── Raster Proxy Security Contract ───────────────────────────────────────────

class TestRasterProxySecurityContract:
    """GET /api/v1/raster/check and /download — domain allowlist contract.

    The download and check endpoints proxy external URLs. Without domain
    checking, they become open SSRF proxies. The 403 response for non-whitelisted
    domains is a hard security contract that must never be weakened.
    """

    GEOSERVER_URL = (
        "https://geoserver.core-stack.org/geoserver/wcs"
        "?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
        "&COVERAGEID=telangana_nalgonda_test_cropping_intensity_2022-23"
        "&FORMAT=image/geotiff&SUBSET=Lat(17.0,18.0)&SUBSET=Long(78.0,79.0)"
    )
    EVIL_URL = "https://evil.com/steal-credentials.tiff"
    LOCALHOST_URL = "http://localhost:9999/internal"
    METADATA_URL = "http://169.254.169.254/latest/meta-data/"

    def test_check_endpoint_blocks_non_geoserver_url(self, client):
        """Non-whitelisted domain → HTTP 403.

        This is the primary SSRF guard. Any relaxation here is a security regression.
        """
        resp = client.get(f"/api/v1/raster/check?url={self.EVIL_URL}")
        assert resp.status_code == 403, (
            f"Expected 403 for non-whitelisted URL, got {resp.status_code}. "
            "SSRF protection may be broken."
        )

    def test_check_endpoint_blocks_localhost(self, client):
        """Localhost URLs must be blocked — internal service scanning prevention."""
        resp = client.get(f"/api/v1/raster/check?url={self.LOCALHOST_URL}")
        assert resp.status_code == 403

    def test_check_endpoint_blocks_aws_metadata(self, client):
        """AWS EC2 metadata endpoint must be blocked."""
        resp = client.get(f"/api/v1/raster/check?url={self.METADATA_URL}")
        assert resp.status_code == 403

    def test_download_endpoint_blocks_non_geoserver_url(self, client):
        """Download endpoint must also enforce domain allowlist."""
        resp = client.get(f"/api/v1/raster/download?url={self.EVIL_URL}")
        assert resp.status_code == 403, (
            f"Expected 403 for non-whitelisted download URL, got {resp.status_code}"
        )

    def test_403_response_has_detail_field(self, client):
        """The 403 must include a 'detail' field explaining the rejection."""
        body = client.get(f"/api/v1/raster/check?url={self.EVIL_URL}").json()
        assert "detail" in body, "403 response must include 'detail' for frontend error display"

    def test_check_missing_url_param_returns_422(self, client):
        """Missing url param → Pydantic 422, not 500."""
        resp = client.get("/api/v1/raster/check")
        assert resp.status_code == 422

    def test_download_missing_url_param_returns_422(self, client):
        resp = client.get("/api/v1/raster/download")
        assert resp.status_code == 422
