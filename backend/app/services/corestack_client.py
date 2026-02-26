"""CSVAT — CoRE Stack API Client Service.

Wraps the CoRE Stack REST APIs for boundary resolution, raster retrieval, etc.
"""

import httpx
from typing import Optional
from app.config import get_settings

settings = get_settings()

BASE_URL = settings.CORESTACK_API_BASE_URL
HEADERS = {"X-API-KEY": settings.CORESTACK_API_KEY}


class CoreStackClient:
    """HTTP client for CoRE Stack APIs."""

    def __init__(self):
        self.base_url = BASE_URL
        self.headers = HEADERS

    async def get_active_locations(self) -> dict:
        """Return list of active state/district/tehsil locations."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.base_url}/get_active_locations",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_admin_details(self, lat: float, lon: float) -> dict:
        """Resolve a lat/lon to admin details (state, district, block)."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.base_url}/get_admin_details",
                params={"lat": lat, "lon": lon},
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_tehsil_data(self, state: str, district: str, tehsil: str) -> dict:
        """Get comprehensive data for all MWS intersecting a tehsil."""
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(
                f"{self.base_url}/get_tehsil_data",
                params={"state": state, "district": district, "tehsil": tehsil},
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_generated_layers_url(self, state: str, district: str, tehsil: str) -> dict:
        """Get GeoServer download URLs for raster/vector layers."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.base_url}/get_generated_layers_url",
                params={"state": state, "district": district, "tehsil": tehsil},
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def search_boundaries(self, query: str) -> list[dict]:
        """Search for villages/tehsils/districts by name.

        Falls back to mock data if the real API is not configured.
        """
        if not settings.CORESTACK_API_KEY or settings.CORESTACK_API_KEY == "your-api-key-here":
            return self._mock_search(query)

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{self.base_url}/get_active_locations",
                    headers=self.headers,
                )
                resp.raise_for_status()
                data = resp.json()
                results = []
                for item in data.get("locations", []):
                    if query.lower() in str(item).lower():
                        results.append(item)
                return results[:20]
        except Exception:
            return self._mock_search(query)

    def _mock_search(self, query: str) -> list[dict]:
        """Mock boundary search for development."""
        mock_villages = [
            {"id": "vg-raj-01", "name": "Barna", "state": "Rajasthan",
             "district": "Udaipur", "tehsil": "Girwa", "level": "village"},
            {"id": "vg-raj-02", "name": "Kanore", "state": "Rajasthan",
             "district": "Udaipur", "tehsil": "Kanore", "level": "village"},
            {"id": "vg-mp-01", "name": "Hoshangabad", "state": "Madhya Pradesh",
             "district": "Hoshangabad", "tehsil": "Hoshangabad", "level": "village"},
            {"id": "vg-mh-01", "name": "Phaltan", "state": "Maharashtra",
             "district": "Satara", "tehsil": "Phaltan", "level": "village"},
            {"id": "vg-ka-01", "name": "Kolar", "state": "Karnataka",
             "district": "Kolar", "tehsil": "Kolar", "level": "village"},
            {"id": "vg-tn-01", "name": "Madurai South", "state": "Tamil Nadu",
             "district": "Madurai", "tehsil": "Madurai South", "level": "village"},
            {"id": "vg-gj-01", "name": "Bhuj", "state": "Gujarat",
             "district": "Kutch", "tehsil": "Bhuj", "level": "village"},
            {"id": "vg-ap-01", "name": "Anantapur", "state": "Andhra Pradesh",
             "district": "Anantapur", "tehsil": "Anantapur", "level": "village"},
        ]
        q = query.lower()
        return [v for v in mock_villages if q in v["name"].lower()
                or q in v["state"].lower()
                or q in v["district"].lower()
                or q in v["tehsil"].lower()][:20]


corestack_client = CoreStackClient()
