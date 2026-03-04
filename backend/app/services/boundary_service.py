"""CSVAT — Boundary resolution and validation service."""

from typing import Optional
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
import json


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
            area_km2 = area_deg2 * (111 ** 2)
            area_ha = area_km2 * 100

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

    def validate_tehsil_intersection(self, state: str, district: str, tehsil: str) -> bool:
        """Check if the resolved boundary intersects an active tehsil.

        TODO: Implement real validation against CoRE Stack active locations.
        """
        return True


boundary_service = BoundaryService()
