"""E2E conftest — shared fixtures and helpers for Playwright tests.

Provides:
  - `page` fixture with pre-configured viewport, slow-mo off
  - `api_token` fixture for obtaining a real JWT for API-level setup
  - `frontend_url` / `backend_url` constants read from env
  - `test_geojson_file` fixture: a real GeoJSON polygon on disk for upload tests
"""

import os
import json
import pytest
import tempfile
from playwright.sync_api import sync_playwright, Page, BrowserContext, Browser

# ─── Base URLs ────────────────────────────────────────────────────────────────

FRONTEND_URL = os.environ.get("CSVAT_FRONTEND_URL", "http://localhost:5173")
BACKEND_URL  = os.environ.get("CSVAT_BACKEND_URL",  "http://localhost:8000")
API_KEY      = os.environ.get("CSVAT_TEST_API_KEY", "test-e2e-key")

# ─── Playwright fixtures ───────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def browser_instance():
    """Single browser instance shared across the session (faster startup)."""
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        yield browser
        browser.close()


@pytest.fixture(scope="function")
def context(browser_instance: Browser) -> BrowserContext:
    """Fresh browser context per test — isolated localStorage, cookies, etc."""
    ctx = browser_instance.new_context(
        viewport={"width": 1440, "height": 900},
        # Suppress Google Maps console errors in test output
        java_script_enabled=True,
    )
    yield ctx
    ctx.close()


@pytest.fixture(scope="function")
def page(context: BrowserContext) -> Page:
    """Fresh page per test."""
    p = context.new_page()
    # Suppress console noise in test output (Maps API key warnings etc.)
    p.on("console", lambda msg: None)
    yield p
    p.close()


# ─── Auth helper ──────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def api_token() -> str:
    """Obtain a real JWT once per session for use in API-level setup calls."""
    import urllib.request, urllib.parse
    body = json.dumps({"api_key": API_KEY}).encode()
    req  = urllib.request.Request(
        f"{BACKEND_URL}/api/v1/auth/token",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return data.get("access_token", "")
    except Exception:
        return ""  # Tests that need auth will skip if token is empty


# ─── Authenticated page helper ────────────────────────────────────────────────

def inject_token(page: Page, token: str):
    """Inject a JWT into localStorage so the app starts authenticated.

    Calling this before page.goto() means the React app finds the token on
    mount and skips the API key modal — simulating a returning user.
    """
    # We navigate first (to any URL on the domain) to set localStorage
    page.goto(FRONTEND_URL, wait_until="domcontentloaded")
    if token:
        page.evaluate(f"localStorage.setItem('csvat_token', '{token}')")


# ─── Test GeoJSON file ────────────────────────────────────────────────────────

# A small valid polygon in Telangana (≈120 ha) used for upload tests.
HAMPI_POLYGON_GEOJSON = {
    "type": "Polygon",
    "coordinates": [[
        [78.395, 17.395],
        [78.415, 17.395],
        [78.415, 17.415],
        [78.395, 17.415],
        [78.395, 17.395],
    ]]
}

FEATURE_COLLECTION_GEOJSON = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "properties": {"name": "Test Village E2E"},
        "geometry": HAMPI_POLYGON_GEOJSON,
    }]
}


@pytest.fixture(scope="session")
def test_geojson_file():
    """Write a valid GeoJSON polygon to a temp file for upload tests."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".geojson", delete=False, prefix="csvat_e2e_"
    ) as f:
        json.dump(FEATURE_COLLECTION_GEOJSON, f)
        path = f.name
    yield path
    os.unlink(path)


# ─── Skip marker ─────────────────────────────────────────────────────────────

def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "e2e: marks tests as end-to-end (require running frontend + backend)"
    )
