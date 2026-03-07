"""CSVAT — CoRE Stack API Client Service.

Complete client for all CoRE Stack REST APIs as documented at api-doc.core-stack.org.
Endpoints match the Swagger/OpenAPI spec exactly.
"""

import logging
import httpx
from typing import Optional
from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

BASE_URL = settings.CORESTACK_API_BASE_URL  # https://api-doc.core-stack.org/api/v1
HEADERS = {"X-API-Key": settings.CORESTACK_API_KEY}

# Shared httpx client config
_CLIENT_KWARGS = dict(
    headers=HEADERS,
    follow_redirects=True,
)


class CoreStackClient:
    """HTTP client for all CoRE Stack APIs."""

    def __init__(self):
        self.base_url = BASE_URL
        self.headers = HEADERS

    # ─── Dataset APIs ───────────────────────────────────────────────

    async def get_active_locations(self) -> dict:
        """Return activated locations (state → district → tehsil hierarchy).

        Response shape:
        [
            { "label": "State", "state_id": "...",
              "district": [{ "label": "District", "district_id": "...",
                  "blocks": [{ "label": "Tehsil", "block_id": "...", "tehsil_id": "..." }]
              }]
            }
        ]
        """
        async with httpx.AsyncClient(timeout=30, **_CLIENT_KWARGS) as client:
            resp = await client.get(f"{self.base_url}/get_active_locations/")
            resp.raise_for_status()
            return resp.json()

    async def get_admin_details_by_latlon(self, latitude: float, longitude: float) -> dict:
        """Resolve lat/lon to admin details (State, District, Tehsil).

        Response: { "State": "...", "District": "...", "Tehsil": "..." }
        """
        async with httpx.AsyncClient(timeout=30, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_admin_details_by_latlon/",
                params={"latitude": latitude, "longitude": longitude},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_mwsid_by_latlon(self, latitude: float, longitude: float) -> dict:
        """Resolve lat/lon to MWS ID + admin details.

        Response: { "uid": "12_234647", "state": "...", "district": "...", "tehsil": "..." }
        """
        async with httpx.AsyncClient(timeout=30, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_mwsid_by_latlon/",
                params={"latitude": latitude, "longitude": longitude},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_tehsil_data(self, state: str, district: str, tehsil: str) -> dict:
        """Get comprehensive data for all MWS in a tehsil.

        Returns aquifer_vector, Soge_vector, etc. keyed by MWS UID.
        """
        async with httpx.AsyncClient(timeout=60, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_tehsil_data/",
                params={"state": state, "district": district, "tehsil": tehsil},
            )
            if resp.status_code == 404:
                logger.warning(f"CoRE Stack API 404 (No data found) for {tehsil}")
                return {}
            resp.raise_for_status()
            return resp.json()

    async def get_mws_data(
        self, state: str, district: str, tehsil: str, mws_id: str
    ) -> dict:
        """Get MWS time-series data (ET, runoff, precipitation, NDVI).

        Response: { "mws_id": "...", "time_series": [{ "date": "...", "et": ..., ... }] }
        """
        async with httpx.AsyncClient(timeout=60, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_mws_data/",
                params={
                    "state": state, "district": district,
                    "tehsil": tehsil, "mws_id": mws_id,
                },
            )
            if resp.status_code == 404:
                return {}
            resp.raise_for_status()
            return resp.json()

    async def get_mws_geometries(self, state: str, district: str, tehsil: str) -> dict:
        """Fetch MWS polygon geometries for a tehsil (direct API).

        Returns GeoJSON FeatureCollection with MultiPolygon geometries,
        each feature has properties.uid for the MWS UID.
        """
        async with httpx.AsyncClient(timeout=120, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_mws_geometries/",
                params={"state": state, "district": district, "tehsil": tehsil},
            )
            if resp.status_code == 404:
                return {"type": "FeatureCollection", "features": []}
            resp.raise_for_status()
            return resp.json()

    async def get_village_geometries(self, state: str, district: str, tehsil: str) -> dict:
        """Fetch village boundary geometries for a tehsil.

        Returns GeoJSON FeatureCollection with MultiPolygon geometries,
        each feature has properties: { "vill_ID": ..., "vill_name": "..." }
        """
        async with httpx.AsyncClient(timeout=120, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_village_geometries/",
                params={"state": state, "district": district, "tehsil": tehsil},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_generated_layer_urls(self, state: str, district: str, tehsil: str) -> list:
        """Get GeoServer download URLs for raster/vector layers.

        Returns list of dicts:
        [{ "layer_name": "...", "layer_type": "vector/raster",
           "layer_url": "...", "layer_version": "...",
           "style_url": "...", "gee_asset_path": "..." }]
        """
        async with httpx.AsyncClient(timeout=30, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_generated_layer_urls/",
                params={"state": state, "district": district, "tehsil": tehsil},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_mws_kyl_indicators(
        self, state: str, district: str, tehsil: str, mws_id: str
    ) -> list:
        """Get KYL (Know Your Landscape) indicators for a specific MWS.

        Returns list with one dict containing ~20+ indicator fields:
        avg_precipitation, cropping_intensity_trend, avg_runoff, total_nrega_assets, etc.
        """
        async with httpx.AsyncClient(timeout=30, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_mws_kyl_indicators/",
                params={
                    "state": state, "district": district,
                    "tehsil": tehsil, "mws_id": mws_id,
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def get_mws_report(
        self, state: str, district: str, tehsil: str, mws_id: str
    ) -> dict:
        """Get MWS report URL for a specific MWS.

        Returns: { "Mws_report_url": "http://..." }
        """
        async with httpx.AsyncClient(timeout=30, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_mws_report/",
                params={
                    "state": state, "district": district,
                    "tehsil": tehsil, "mws_id": mws_id,
                },
            )
            resp.raise_for_status()
            return resp.json()

    # ─── Waterbodies APIs ───────────────────────────────────────────

    async def get_waterbodies_by_admin(
        self, state: str, district: str, tehsil: str
    ) -> dict:
        """Get all waterbodies in a tehsil.

        Returns dict keyed by waterbody UID → waterbody data including
        seasonal coverage (k_*, kr_*, krz_*), area by year, zoi_properties, etc.
        """
        async with httpx.AsyncClient(timeout=60, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_waterbodies_data_by_admin/",
                params={"state": state, "district": district, "tehsil": tehsil},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_waterbody_data(
        self, state: str, district: str, tehsil: str, uid: str
    ) -> dict:
        """Get detailed data for a specific waterbody by UID.

        Returns full waterbody profile including zoi_properties with
        cropping_intensity, NDVI time-series, etc.
        """
        async with httpx.AsyncClient(timeout=30, **_CLIENT_KWARGS) as client:
            resp = await client.get(
                f"{self.base_url}/get_waterbody_data/",
                params={
                    "state": state, "district": district,
                    "tehsil": tehsil, "uid": uid,
                },
            )
            resp.raise_for_status()
            return resp.json()

    # ─── Convenience methods ────────────────────────────────────────

    async def search_boundaries(self, query: str) -> list[dict]:
        """Search for villages/tehsils/districts by name via active locations."""
        data = await self.get_active_locations()
        results = []
        query_lower = query.lower()

        if isinstance(data, list):
            for state_obj in data:
                state_name = state_obj.get("label", "")
                for dist_obj in state_obj.get("district", []):
                    dist_name = dist_obj.get("label", "")
                    for block_obj in dist_obj.get("blocks", []):
                        block_name = block_obj.get("label", "")
                        # Check if query matches any level
                        text = f"{state_name} {dist_name} {block_name}".lower()
                        if query_lower in text:
                            results.append({
                                "id": block_obj.get("tehsil_id", block_obj.get("block_id", "")),
                                "name": block_name,
                                "state": state_name,
                                "district": dist_name,
                                "tehsil": block_name,
                                "level": "tehsil",
                            })

        return results[:20]

    async def get_mws_features_for_tehsil(
        self, state: str, district: str, tehsil: str
    ) -> list[dict]:
        """Fetch MWS geometries and return as list of Feature dicts.

        Convenience wrapper around get_mws_geometries.
        """
        geojson_data = await self.get_mws_geometries(state, district, tehsil)

        features = []
        if isinstance(geojson_data, dict):
            if geojson_data.get("type") == "FeatureCollection":
                features = geojson_data.get("features", [])
            elif geojson_data.get("type") == "Feature":
                features = [geojson_data]

        logger.info(
            "Fetched %d MWS features for %s/%s/%s",
            len(features), state, district, tehsil,
        )
        return features

    async def get_mws_data_for_tehsil(
        self, state: str, district: str, tehsil: str
    ) -> list[dict]:
        """Fetch and normalize MWS-level analytics data for a tehsil.

        Wraps get_tehsil_data with error handling and normalization.
        """
        raw = await self.get_tehsil_data(state, district, tehsil)

        # Normalize: the API returns data under various keys
        records = []
        if isinstance(raw, list):
            records = raw
        elif isinstance(raw, dict):
            # Try known response shapes
            for key in ("aquifer_vector", "data", "mws_data", "results", "features"):
                val = raw.get(key)
                if isinstance(val, list) and val:
                    records = val
                    break

            # If keyed by MWS UID
            if not records and all(isinstance(v, (dict, list)) for v in raw.values()):
                for uid, data in raw.items():
                    if isinstance(data, dict):
                        data["uid"] = uid
                        records.append(data)
                    elif isinstance(data, list):
                        for item in data:
                            if isinstance(item, dict):
                                item.setdefault("uid", uid)
                                records.append(item)

        if not records:
            raise ValueError(
                f"No MWS data returned for {state}/{district}/{tehsil}. "
                "This tehsil may not have computed data on CoRE Stack."
            )

        logger.info(
            "Fetched %d MWS data records for %s/%s/%s",
            len(records), state, district, tehsil,
        )
        return records


corestack_client = CoreStackClient()
