"""CSVAT — Boundary resolution and validation service.

Uses CoRE Stack APIs for admin details resolution and active location validation.
"""

import logging
import math
from typing import Optional
from shapely.geometry import shape, mapping
import json

from app.services.corestack_client import corestack_client

logger = logging.getLogger(__name__)

# Cache for active locations (refreshed per request is fine for now)
_active_locations_cache: Optional[list] = None


class BoundaryService:
    """Handles boundary resolution, GeoJSON validation, and tehsil intersection checks."""

    def resolve_boundary(self, boundary_id: Optional[str] = None,
                         geojson: Optional[dict] = None) -> dict:
        """Resolve a village polygon from an uploaded GeoJSON.

        Returns dict with keys: name, state, district, tehsil, geojson, area_hectares.
        Raises ValueError on failure.
        """
        if geojson:
            return self._validate_geojson(geojson)

        raise ValueError("No GeoJSON provided. Upload a GeoJSON polygon to proceed.")

    async def resolve_boundary_with_latlon(self, latitude: float, longitude: float) -> dict:
        """Resolve admin details from lat/lon via CoRE Stack API.

        Calls get_admin_details_by_latlon to get state, district, tehsil.
        """
        try:
            admin = await corestack_client.get_admin_details_by_latlon(latitude, longitude)
            return {
                "state": admin.get("State", admin.get("state", "Unknown")),
                "district": admin.get("District", admin.get("district", "Unknown")),
                "tehsil": admin.get("Tehsil", admin.get("tehsil", "Unknown")),
            }
        except Exception as e:
            logger.warning("CoRE Stack admin resolution failed: %s", e)
            return {"state": "Unknown", "district": "Unknown", "tehsil": "Unknown"}

    def _validate_geojson(self, geojson: dict) -> dict:
        """Validate an uploaded GeoJSON polygon."""
        try:
            geom_type = geojson.get("type", "")
            if geom_type == "FeatureCollection":
                features = geojson.get("features", [])
                if not features:
                    raise ValueError("FeatureCollection has no features")
                geojson = features[0].get("geometry", {})
            elif geom_type == "Feature":
                geojson = geojson.get("geometry", {})

            geom = shape(geojson)
            if not geom.is_valid:
                geom = geom.buffer(0)
            if geom.is_empty:
                raise ValueError("Geometry is empty")

            area_deg2 = geom.area
            # Latitude-corrected area (matches client-side computeAreaHectares)
            avg_lat = geom.centroid.y
            area_km2 = area_deg2 * 111.0 * 111.0 * math.cos(math.radians(avg_lat))
            area_ha = round(area_km2 * 100)

            return {
                "name": "Custom Upload",
                "state": "Unknown",
                "district": "Unknown",
                "tehsil": "Unknown",
                "geojson": json.loads(json.dumps(mapping(geom))),
                "area_hectares": round(area_ha, 2),
            }
        except Exception as e:
            raise ValueError(f"Invalid GeoJSON: {str(e)}")

    async def validate_tehsil_intersection(self, state: str, district: str, tehsil: str) -> bool:
        """Check if the resolved boundary intersects an active tehsil.

        Validates against real CoRE Stack active locations data.
        """
        try:
            locations = await corestack_client.get_active_locations()
            if not isinstance(locations, list):
                logger.warning("Unexpected active_locations format, allowing by default")
                return True

            state_lower = state.lower().strip()
            district_lower = district.lower().strip()
            tehsil_lower = tehsil.lower().strip()

            for state_obj in locations:
                if state_obj.get("label", "").lower().strip() != state_lower:
                    continue
                for dist_obj in state_obj.get("district", []):
                    if dist_obj.get("label", "").lower().strip() != district_lower:
                        continue
                    for block_obj in dist_obj.get("blocks", []):
                        if block_obj.get("label", "").lower().strip() == tehsil_lower:
                            return True

            logger.info(
                "Tehsil %s/%s/%s not found in active locations",
                state, district, tehsil,
            )
            return False

        except Exception as e:
            logger.warning("Active location check failed: %s — allowing by default", e)
            return True

    async def get_active_tehsils(self) -> list[dict]:
        """Return flat list of active tehsils with state/district context."""
        try:
            locations = await corestack_client.get_active_locations()
            tehsils = []
            if isinstance(locations, list):
                for state_obj in locations:
                    state_name = state_obj.get("label", "")
                    for dist_obj in state_obj.get("district", []):
                        dist_name = dist_obj.get("label", "")
                        for block_obj in dist_obj.get("blocks", []):
                            tehsils.append({
                                "state": state_name,
                                "district": dist_name,
                                "tehsil": block_obj.get("label", ""),
                                "tehsil_id": block_obj.get("tehsil_id", block_obj.get("block_id", "")),
                            })
            return tehsils
        except Exception as e:
            logger.error("Failed to get active tehsils: %s", e)
            return []


boundary_service = BoundaryService()
