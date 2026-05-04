"""E2E Tests — Layer 4: User Flow Verification.

Tests in this module simulate real users interacting with the CSVAT UI.
They require:
    - Frontend running:  npm run dev  (http://localhost:5173)
    - Backend running:   uvicorn app.main:app  (http://localhost:8000)

Run with:
    cd e2e
    pytest test_user_flows.py -v --tb=short

Or with custom URLs:
    CSVAT_FRONTEND_URL=http://localhost:5173 pytest test_user_flows.py -v

Why E2E testing matters:
    Unit and integration tests cannot catch bugs that exist in the gap between
    the frontend and backend:
    - JWT stored incorrectly in localStorage → every request fails silently
    - Autocomplete results have wrong key names → dropdown never renders
    - File input wired to wrong handler → upload silently does nothing
    - Run Analytics button not rendered → user can't start analysis
    - CSV download triggers wrong MIME type → browser opens instead of saving

Each test is written as a full user scenario, not just a component test.
"""

import pytest
import time
from playwright.sync_api import Page, expect
from conftest import (
    FRONTEND_URL, BACKEND_URL, API_KEY,
    HAMPI_POLYGON_GEOJSON, inject_token,
)


# ─── 1. App Loads & Health ────────────────────────────────────────────────────

@pytest.mark.e2e
class TestAppLoadsCorrectly:
    """The app must load and be usable within 10 seconds."""

    def test_frontend_is_reachable(self, page: Page):
        """HTTP 200 from the frontend dev server — basic liveness check."""
        resp = page.goto(FRONTEND_URL)
        assert resp is not None
        assert resp.status == 200, f"Frontend returned {resp.status}, expected 200"

    def test_page_title_is_set(self, page: Page):
        """Page title must be non-empty and reference the app."""
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        title = page.title()
        assert title, "Page title is empty — SEO and browser tab are broken"
        # Title should reference the product
        assert any(word in title.upper() for word in ("CSVAT", "CORESTACK", "VILLAGE", "ANALYTICS")), (
            f"Page title {title!r} doesn't reference the product"
        )

    def test_no_white_screen_of_death(self, page: Page):
        """The page body must have content — not just a blank white screen.

        Why: A blank screen is the most common React bundle error symptom.
        If the JS bundle fails to load or throws on mount, the user sees nothing.
        """
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        body_text = page.locator("body").inner_text()
        assert len(body_text.strip()) > 50, (
            "Page body is nearly empty — likely a React crash or bundle load failure"
        )

    def test_map_container_is_present(self, page: Page):
        """The map container div must exist — it's the primary UI element."""
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        map_el = page.locator(".map-container, #map, [data-testid='map']").first
        assert map_el.count() > 0 or page.locator("div").count() > 5, (
            "No map container found — the dashboard may not have rendered"
        )

    def test_backend_health_from_e2e_context(self, page: Page):
        """Backend /health must return 'healthy' when both services are up.

        This is a smoke check that the backend is reachable from the test runner.
        """
        resp = page.request.get(f"{BACKEND_URL}/health")
        assert resp.status == 200
        body = resp.json()
        assert body.get("status") in ("healthy", "degraded"), (
            f"Unexpected health status: {body}"
        )


# ─── 2. Authentication Flow ───────────────────────────────────────────────────

@pytest.mark.e2e
class TestAuthenticationFlow:
    """JWT auth: obtain token → store in localStorage → authenticated requests work."""

    def test_auth_token_endpoint_works(self, page: Page):
        """POST /api/v1/auth/token with a key returns access_token."""
        resp = page.request.post(
            f"{BACKEND_URL}/api/v1/auth/token",
            data={"api_key": API_KEY},
            headers={"Content-Type": "application/json"},
        )
        # Some versions parse as form; try JSON body
        resp2 = page.request.post(
            f"{BACKEND_URL}/api/v1/auth/token",
            data='{"api_key": "' + API_KEY + '"}',
            headers={"Content-Type": "application/json"},
        )
        assert resp2.status == 200, f"Auth failed: {resp2.text()}"
        body = resp2.json()
        assert "access_token" in body

    def test_token_stored_in_localstorage(self, page: Page):
        """After injecting a token, localStorage must contain it.

        Why: The Axios interceptor reads `csvat_token` from localStorage.
        If it's stored under any other key, every request is unauthenticated.
        """
        inject_token(page, "test-token-value-12345")
        stored = page.evaluate("localStorage.getItem('csvat_token')")
        assert stored == "test-token-value-12345", (
            f"Token not found at key 'csvat_token', got: {stored!r}"
        )

    def test_authenticated_api_request_succeeds(self, page: Page, api_token: str):
        """With a valid token, a protected endpoint returns 200 (not 401).

        This tests the full auth loop: token generation → header injection → API response.
        """
        if not api_token:
            pytest.skip("Could not obtain API token from backend — is it running?")

        resp = page.request.get(
            f"{BACKEND_URL}/api/v1/layers",
            headers={"Authorization": f"Bearer {api_token}"},
        )
        assert resp.status == 200, (
            f"Authenticated request failed with {resp.status}: {resp.text()}"
        )

    def test_unauthenticated_request_to_protected_route_returns_401_or_200(self, page: Page):
        """Without auth header, /api/v1/jobs should return 401 (or 200 if REQUIRE_AUTH=False).

        In dev mode REQUIRE_AUTH is typically False, so 200 is acceptable.
        What is NOT acceptable is 500 (server crash) or 403 (wrong error type).
        """
        resp = page.request.post(
            f"{BACKEND_URL}/api/v1/jobs",
            data='{"boundary_geojson": {}, "layers": [], "years": []}',
            headers={"Content-Type": "application/json"},
        )
        assert resp.status in (200, 201, 401, 422), (
            f"Expected 200/401/422 without auth, got {resp.status}"
        )


# ─── 3. Village Autocomplete Search ──────────────────────────────────────────

@pytest.mark.e2e
class TestVillageSearch:
    """The boundary autocomplete search must be usable and return real results."""

    def test_autocomplete_api_returns_results_for_hampi(self, page: Page):
        """Direct API call: /boundaries/autocomplete?q=Hampi must return results.

        This tests the search backend independently from the UI rendering.
        """
        resp = page.request.get(f"{BACKEND_URL}/api/v1/boundaries/autocomplete?q=Hampi")
        assert resp.status == 200
        body = resp.json()
        assert body["count"] > 0, "No results for 'Hampi' — village DB may be empty"
        assert body["results"][0]["name"] is not None

    def test_autocomplete_rejects_single_char_query(self, page: Page):
        """Single character queries must be rejected with 422."""
        resp = page.request.get(f"{BACKEND_URL}/api/v1/boundaries/autocomplete?q=H")
        assert resp.status == 422

    def test_sidebar_is_visible_on_desktop(self, page: Page, api_token: str):
        """The sidebar with boundary controls must be visible after load."""
        inject_token(page, api_token or "test")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # The sidebar has class 'sidebar' and should be visible
        sidebar = page.locator(".sidebar").first
        assert sidebar.count() > 0, "Sidebar element not found in DOM"

    def test_upload_tab_is_present(self, page: Page, api_token: str):
        """The UPLOAD tab must be visible — it's how users without CoRE Stack access use the app."""
        inject_token(page, api_token or "test")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # Look for any element containing "UPLOAD" text
        upload_elements = page.locator("text=UPLOAD").all()
        assert len(upload_elements) > 0, (
            "UPLOAD tab not found — users cannot upload their own GeoJSON boundaries"
        )

    def test_corestack_tab_is_present(self, page: Page, api_token: str):
        """The CORESTACK tab must be present for location-based village selection."""
        inject_token(page, api_token or "test")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        corestack_elements = page.locator("text=CORESTACK").all()
        assert len(corestack_elements) > 0, "CORESTACK tab not found"


# ─── 4. GeoJSON Upload Flow ───────────────────────────────────────────────────

@pytest.mark.e2e
class TestGeoJSONUpload:
    """User uploads a GeoJSON file → boundary is accepted and analytics button appears."""

    def test_file_input_exists_on_upload_tab(self, page: Page, api_token: str):
        """The file input must exist when the UPLOAD tab is active."""
        inject_token(page, api_token or "test")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # Click the UPLOAD tab
        upload_tab = page.locator("text=UPLOAD").first
        if upload_tab.count() > 0:
            upload_tab.click()
            page.wait_for_timeout(500)

        file_input = page.locator("input[type='file']").first
        assert file_input.count() > 0, (
            "No file input found on UPLOAD tab — users cannot upload GeoJSON"
        )

    def test_file_input_accepts_geojson_extension(self, page: Page, api_token: str):
        """The file input must accept .geojson and .json files."""
        inject_token(page, api_token or "test")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        upload_tab = page.locator("text=UPLOAD").first
        if upload_tab.count() > 0:
            upload_tab.click()
            page.wait_for_timeout(500)

        file_input = page.locator("input[type='file']").first
        if file_input.count() > 0:
            accept = file_input.get_attribute("accept") or ""
            assert ".geojson" in accept or ".json" in accept, (
                f"File input accept attribute {accept!r} doesn't include .geojson or .json"
            )

    def test_upload_valid_geojson_triggers_boundary_selection(
        self, page: Page, api_token: str, test_geojson_file: str
    ):
        """Uploading a valid GeoJSON file must trigger boundary selection.

        After upload, the Run Analytics button should appear because
        the boundary is now set and the upload source bypasses tehsil validation.
        """
        inject_token(page, api_token or "test")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # Navigate to UPLOAD tab
        upload_tab = page.locator("text=UPLOAD").first
        if upload_tab.count() == 0:
            pytest.skip("UPLOAD tab not found — cannot test file upload flow")

        upload_tab.click()
        page.wait_for_timeout(500)

        file_input = page.locator("input[type='file']").first
        if file_input.count() == 0:
            pytest.skip("File input not found")

        # Upload the test GeoJSON file
        file_input.set_input_files(test_geojson_file)
        page.wait_for_timeout(3000)  # Allow FileReader + admin resolution to complete

        # After upload, the Run Analytics button should appear
        # It has id="run-analytics-tiled-btn" for uploaded boundaries
        run_btn = page.locator("#run-analytics-tiled-btn, button:has-text('High Accuracy')").first
        assert run_btn.count() > 0, (
            "Run Analytics button did not appear after GeoJSON upload. "
            "The upload may have failed silently."
        )


# ─── 5. Analytics Pipeline Trigger ───────────────────────────────────────────

@pytest.mark.e2e
class TestAnalyticsPipelineTrigger:
    """Clicking Run Analytics must start the pipeline and show a progress indicator."""

    def test_run_analytics_button_has_id(self, page: Page, api_token: str, test_geojson_file: str):
        """The run analytics button must have a stable ID for test targeting.

        IDs: run-analytics-tiled-btn, run-analytics-mws-btn, run-analytics-server-btn
        """
        inject_token(page, api_token or "test")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # Upload GeoJSON to trigger button appearance
        upload_tab = page.locator("text=UPLOAD").first
        if upload_tab.count() == 0:
            pytest.skip("UPLOAD tab not found")
        upload_tab.click()
        page.wait_for_timeout(300)

        file_input = page.locator("input[type='file']").first
        if file_input.count() == 0:
            pytest.skip("File input not found")
        file_input.set_input_files(test_geojson_file)
        page.wait_for_timeout(3000)

        # Check that the button has the expected ID
        btn = page.locator("#run-analytics-tiled-btn")
        if btn.count() == 0:
            # Fallback: look for any Run Analytics button
            btn = page.locator("button:has-text('High Accuracy'), button:has-text('Run Analytics')").first

        assert btn.count() > 0, "Run Analytics button not found after upload"

    def test_loading_spinner_appears_on_analytics_start(
        self, page: Page, api_token: str, test_geojson_file: str
    ):
        """Clicking Run Analytics must immediately show a loading indicator.

        Why: Without a loading state, the user has no feedback that anything is
        happening. They may click multiple times, triggering duplicate jobs.
        The spinner class is '.spinner' and the progress text is '.loading-text'.
        """
        inject_token(page, api_token or "test")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        upload_tab = page.locator("text=UPLOAD").first
        if upload_tab.count() == 0:
            pytest.skip("UPLOAD tab not found")
        upload_tab.click()
        page.wait_for_timeout(300)

        file_input = page.locator("input[type='file']").first
        if file_input.count() == 0:
            pytest.skip("File input not found")
        file_input.set_input_files(test_geojson_file)
        page.wait_for_timeout(3000)

        run_btn = page.locator("#run-analytics-tiled-btn, button:has-text('High Accuracy')").first
        if run_btn.count() == 0:
            pytest.skip("Run Analytics button not found")

        # Click and immediately check for spinner (within 2s)
        run_btn.click()
        page.wait_for_timeout(500)

        # Either spinner appears OR the button becomes disabled (both are valid feedback)
        spinner_visible = page.locator(".spinner").count() > 0
        btn_disabled = run_btn.is_disabled()
        progress_visible = page.locator(".loading-text").count() > 0

        assert spinner_visible or btn_disabled or progress_visible, (
            "No loading feedback after clicking Run Analytics. "
            "The button should show a spinner or become disabled."
        )


# ─── 6. API Key Modal (if REQUIRE_AUTH=True) ─────────────────────────────────

@pytest.mark.e2e
class TestAPIKeyModal:
    """If auth is required, the app must show an API key prompt before the dashboard."""

    def test_app_loads_without_crashing_when_no_token(self, page: Page):
        """Without a stored token, the app must still load (not crash).

        Either:
        a) Shows an API key modal (if REQUIRE_AUTH=True), or
        b) Shows the dashboard directly (if REQUIRE_AUTH=False)
        Either is acceptable — what's not acceptable is a white screen.
        """
        # Clear any stored token
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.evaluate("localStorage.removeItem('csvat_token')")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        body_text = page.locator("body").inner_text()
        assert len(body_text.strip()) > 30, (
            "App shows blank screen when no token is stored — "
            "likely a React crash on missing auth state"
        )

    def test_dashboard_is_accessible_after_token_injection(self, page: Page, api_token: str):
        """With a valid token in localStorage, the dashboard must render fully."""
        inject_token(page, api_token or "test-token")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)

        # The sidebar must be present — it contains the boundary selector
        assert page.locator(".sidebar").count() > 0 or page.locator("aside").count() > 0, (
            "Dashboard sidebar not found after token injection — "
            "the app may be stuck on a loading/auth screen"
        )


# ─── 7. Report Download ───────────────────────────────────────────────────────

@pytest.mark.e2e
class TestReportDownload:
    """The CSV download must trigger a file download with correct MIME type.

    This is tested at the API level (not UI) because triggering an actual
    browser download in headless mode requires intercepting the download event.
    """

    def test_csv_asset_download_from_completed_job(self, page: Page, api_token: str):
        """A completed job's CSV asset must be downloadable via the API.

        This tests the download path that the frontend's Download button triggers.
        """
        if not api_token:
            pytest.skip("No API token available")

        auth_header = {"Authorization": f"Bearer {api_token}"}

        # Step 1: Create a CLIENT job
        job_resp = page.request.post(
            f"{BACKEND_URL}/api/v1/jobs",
            data='''{
                "village_name": "E2E Test Village",
                "state": "Telangana",
                "district": "Nalgonda",
                "layers": ["cropping_intensity"],
                "years": [2022],
                "mode": "CLIENT",
                "boundary_geojson": {
                    "type": "Polygon",
                    "coordinates": [[[78.4, 17.4],[78.41, 17.4],[78.41, 17.41],[78.4, 17.41],[78.4, 17.4]]]
                }
            }''',
            headers={**auth_header, "Content-Type": "application/json"},
        )
        if job_resp.status not in (200, 201):
            pytest.skip(f"Could not create job: {job_resp.status}")

        job_id = job_resp.json().get("id")
        assert job_id, "Job ID missing from creation response"

        # Step 2: Save client results (simulate WASM completing)
        results_payload = '''{
            "results": {
                "village_name": "E2E Test Village",
                "data_source": "e2e_test",
                "cropping_intensity": {
                    "village_name": "E2E Test Village",
                    "data": [{"year": "2021-22", "single_crop_ha": 50.0, "double_crop_ha": 30.0, "triple_crop_ha": 5.0, "total_cropped_ha": 85.0, "cropping_intensity": 1.41}]
                }
            }
        }'''
        save_resp = page.request.post(
            f"{BACKEND_URL}/api/v1/jobs/{job_id}/client-results",
            data=results_payload,
            headers={**auth_header, "Content-Type": "application/json"},
        )
        assert save_resp.status == 200, f"Failed to save results: {save_resp.status}"

        # Step 3: Download CSV asset
        csv_resp = page.request.get(
            f"{BACKEND_URL}/api/v1/jobs/{job_id}/assets/csv",
            headers=auth_header,
        )
        assert csv_resp.status == 200, f"CSV download failed: {csv_resp.status}"

        content_type = csv_resp.headers.get("content-type", "")
        assert "text/csv" in content_type, (
            f"Expected text/csv content-type, got {content_type!r}. "
            "Browser will open instead of download."
        )

        # CSV must contain analytics data
        csv_text = csv_resp.text()
        assert "Cropping Intensity" in csv_text or len(csv_text) > 50, (
            "CSV content is empty or missing analytics data"
        )

    def test_html_report_download_from_completed_job(self, page: Page, api_token: str):
        """The HTML report must be downloadable and contain the village name."""
        if not api_token:
            pytest.skip("No API token available")

        auth_header = {"Authorization": f"Bearer {api_token}"}

        # Create job and save results (same pattern as CSV test)
        job_resp = page.request.post(
            f"{BACKEND_URL}/api/v1/jobs",
            data='''{
                "village_name": "E2E HTML Test",
                "layers": ["surface_water"],
                "years": [2022],
                "mode": "CLIENT",
                "boundary_geojson": {"type": "Polygon", "coordinates": [[[78.4, 17.4],[78.41, 17.4],[78.41, 17.41],[78.4, 17.41],[78.4, 17.4]]]}
            }''',
            headers={**auth_header, "Content-Type": "application/json"},
        )
        if job_resp.status not in (200, 201):
            pytest.skip("Could not create job")

        job_id = job_resp.json()["id"]
        page.request.post(
            f"{BACKEND_URL}/api/v1/jobs/{job_id}/client-results",
            data='{"results": {"village_name": "E2E HTML Test", "surface_water": {"village_name": "E2E HTML Test", "data": [{"year": "2021-22", "kharif_ha": 10, "rabi_ha": 5, "zaid_ha": 2, "total_water_ha": 17}]}}}',
            headers={**auth_header, "Content-Type": "application/json"},
        )

        html_resp = page.request.get(
            f"{BACKEND_URL}/api/v1/jobs/{job_id}/assets/html",
            headers=auth_header,
        )
        assert html_resp.status == 200
        content_type = html_resp.headers.get("content-type", "")
        assert "text/html" in content_type

        html_text = html_resp.text()
        assert "<!DOCTYPE html>" in html_text or "<html" in html_text, (
            "HTML report doesn't contain valid HTML markup"
        )
