"""CSVAT — Boundary resolution and validation service."""

from typing import Optional
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
import json


class BoundaryService:
    """Handles boundary resolution, GeoJSON validation, and tehsil intersection checks."""

    # Mock village polygons for development (small bounding boxes)
    MOCK_BOUNDARIES = {
        "vg-raj-01": {
            "name": "Barna", "state": "Rajasthan", "district": "Udaipur", "tehsil": "Girwa",
            "geojson": {
                "type": "Polygon",
                "coordinates": [[[73.65, 24.55], [73.70, 24.55], [73.70, 24.60],
                                 [73.65, 24.60], [73.65, 24.55]]]
            }
        },
        "vg-raj-02": {
            "name": "Kanore", "state": "Rajasthan", "district": "Udaipur", "tehsil": "Kanore",
            "geojson": {
                "type": "Polygon",
                "coordinates": [[[73.80, 24.70], [73.88, 24.70], [73.88, 24.78],
                                 [73.80, 24.78], [73.80, 24.70]]]
            }
        },
        "vg-mp-01": {
            "name": "Hoshangabad", "state": "Madhya Pradesh",
            "district": "Hoshangabad", "tehsil": "Hoshangabad",
            "geojson": {
                "type": "Polygon",
                "coordinates": [[[77.70, 22.73], [77.78, 22.73], [77.78, 22.78],
                                 [77.70, 22.78], [77.70, 22.73]]]
            }
        },
        "vg-mh-01": {
            "name": "Phaltan", "state": "Maharashtra", "district": "Satara", "tehsil": "Phaltan",
            "geojson": {
                "type": "Polygon",
                "coordinates": [[[74.40, 17.95], [74.48, 17.95], [74.48, 18.02],
                                 [74.40, 18.02], [74.40, 17.95]]]
            }
        },
        "vg-ka-01": {
            "name": "Kolar", "state": "Karnataka", "district": "Kolar", "tehsil": "Kolar",
            "geojson": {
                "type": "Polygon",
                "coordinates": [[[78.10, 13.10], [78.18, 13.10], [78.18, 13.17],
                                 [78.10, 13.17], [78.10, 13.10]]]
            }
        },
        "vg-tn-01": {
            "name": "Madurai South", "state": "Tamil Nadu",
            "district": "Madurai", "tehsil": "Madurai South",
            "geojson": {
                "type": "Polygon",
                "coordinates": [[[78.08, 9.88], [78.15, 9.88], [78.15, 9.95],
                                 [78.08, 9.95], [78.08, 9.88]]]
            }
        },
        "vg-gj-01": {
            "name": "Bhuj", "state": "Gujarat", "district": "Kutch", "tehsil": "Bhuj",
            "geojson": {
                "type": "Polygon",
                "coordinates": [[[69.62, 23.23], [69.70, 23.23], [69.70, 23.30],
                                 [69.62, 23.30], [69.62, 23.23]]]
            }
        },
        "vg-ap-01": {
            "name": "Anantapur", "state": "Andhra Pradesh",
            "district": "Anantapur", "tehsil": "Anantapur",
            "geojson": {
                "type": "Polygon",
                "coordinates": [[[77.55, 14.65], [77.63, 14.65], [77.63, 14.72],
                                 [77.55, 14.72], [77.55, 14.65]]]
            }
        },
    }

    def resolve_boundary(self, boundary_id: Optional[str] = None,
                         geojson: Optional[dict] = None) -> dict:
        """Resolve a village polygon from an ID or uploaded GeoJSON.

        Returns dict with keys: name, state, district, tehsil, geojson, area_hectares.
        Raises ValueError on failure.
        """
        if geojson:
            return self._validate_geojson(geojson)

        if boundary_id and boundary_id in self.MOCK_BOUNDARIES:
            entry = self.MOCK_BOUNDARIES[boundary_id]
            geom = shape(entry["geojson"])
            area_deg2 = geom.area
            # Rough conversion: 1 degree ≈ 111 km at equator → area in km²
            area_km2 = area_deg2 * (111 ** 2)
            area_ha = area_km2 * 100
            return {
                "name": entry["name"],
                "state": entry["state"],
                "district": entry["district"],
                "tehsil": entry["tehsil"],
                "geojson": entry["geojson"],
                "area_hectares": round(area_ha, 2),
            }

        raise ValueError(f"Boundary '{boundary_id}' not found. Upload a GeoJSON polygon instead.")

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

        In MVP with mock data, we always return True.
        """
        return True


boundary_service = BoundaryService()
