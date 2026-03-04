"""CSVAT — CoRE Stack API Client Service.

Wraps the CoRE Stack REST APIs for boundary resolution, raster retrieval, etc.
"""

import logging
import httpx
from typing import Optional
from app.config import get_settings

logger = logging.getLogger(__name__)

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
        """Search for villages/tehsils/districts by name via CoRE Stack API."""
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

    # ─── MWS-specific methods ───

    async def get_mws_geometries(
        self, state: str, district: str, tehsil: str
    ) -> list[dict]:
        """Fetch MWS polygon geometries overlapping a tehsil from GeoServer.

        1. Calls get_generated_layers_url to find the MWS layer URL.
        2. Downloads the GeoJSON from GeoServer.
        3. Returns list of GeoJSON Feature dicts.

        Raises:
            ValueError: If no MWS layer URL is found for the tehsil.
        """
        # Step 1: Get layer URLs
        layers_data = await self.get_generated_layers_url(state, district, tehsil)

        # Find MWS layer URL — look for key containing 'mws'
        mws_url = None
        if isinstance(layers_data, dict):
            for key, value in layers_data.items():
                if "mws" in key.lower() and isinstance(value, str) and value.startswith("http"):
                    mws_url = value
                    break

            # Also check nested structures
            if not mws_url:
                for key, value in layers_data.items():
                    if isinstance(value, dict):
                        for sub_key, sub_val in value.items():
                            if "mws" in sub_key.lower() and isinstance(sub_val, str):
                                mws_url = sub_val
                                break
                    if isinstance(value, list):
                        for item in value:
                            if isinstance(item, dict):
                                name = item.get("name", "") or item.get("layer_name", "")
                                url = item.get("url", "") or item.get("download_url", "")
                                if "mws" in name.lower() and url:
                                    mws_url = url
                                    break

        if not mws_url:
            raise ValueError(
                f"No MWS layer URL found for {state}/{district}/{tehsil}. "
                "This tehsil may not be active on CoRE Stack."
            )

        logger.info("Downloading MWS geometries from: %s", mws_url)

        # Step 2: Download GeoJSON from GeoServer
        # Append outputFormat=application/json if not already specified
        if "outputFormat" not in mws_url:
            separator = "&" if "?" in mws_url else "?"
            mws_url += f"{separator}outputFormat=application/json"

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(mws_url)
            resp.raise_for_status()
            geojson_data = resp.json()

        # Step 3: Extract features
        features = []
        if geojson_data.get("type") == "FeatureCollection":
            features = geojson_data.get("features", [])
        elif geojson_data.get("type") == "Feature":
            features = [geojson_data]

        logger.info("Downloaded %d MWS features for %s/%s/%s",
                     len(features), state, district, tehsil)
        return features

    async def get_mws_data_for_tehsil(
        self, state: str, district: str, tehsil: str
    ) -> list[dict]:
        """Fetch and normalize MWS-level analytics data for a tehsil.

        Wraps get_tehsil_data with error handling and normalization.

        Returns:
            List of dicts, each representing one MWS with its analytics data.

        Raises:
            ValueError: If no data is returned.
        """
        raw = await self.get_tehsil_data(state, district, tehsil)

        # Normalize: the API might return data nested under different keys
        records = []
        if isinstance(raw, list):
            records = raw
        elif isinstance(raw, dict):
            # Try common response shapes
            records = (
                raw.get("data", [])
                or raw.get("mws_data", [])
                or raw.get("results", [])
                or raw.get("features", [])
            )
            # If still a dict, it might be keyed by MWS UID
            if not records and all(isinstance(v, dict) for v in raw.values()):
                for uid, data in raw.items():
                    if isinstance(data, dict):
                        data["uid"] = uid
                        records.append(data)

        if not records:
            raise ValueError(
                f"No MWS data returned for {state}/{district}/{tehsil}. "
                "This tehsil may not have computed data on CoRE Stack."
            )

        logger.info("Fetched %d MWS data records for %s/%s/%s",
                     len(records), state, district, tehsil)
        return records


corestack_client = CoreStackClient()
