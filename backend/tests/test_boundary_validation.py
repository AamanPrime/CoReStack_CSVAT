"""Tests for BoundaryService GeoJSON validation.

Why this matters:
    Users upload GeoJSON from QGIS, GeoJSON.io, Overpass, etc. — they arrive
    in three different top-level structures (Polygon, Feature, FeatureCollection).
    If the unwrapping logic fails, Shapely processes the wrong geometry and
    every downstream area, centroid, and intersection calculation is wrong.

    The latitude-corrected area formula is also subtle:
        area_km2 = area_deg2 * 111.0 * 111.0 * math.cos(radians(lat))
    If someone changes this, tests catch it before production.

No external services required.
"""

import math
import pytest
from app.services.boundary_service import BoundaryService


@pytest.fixture
def svc():
    return BoundaryService()


# ─── Shared test polygons ───────────────────────────────────────────────────

# ~1km x 1km square near Hyderabad (lat ≈ 17.4°)
SIMPLE_POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [78.400, 17.400],
        [78.410, 17.400],
        [78.410, 17.410],
        [78.400, 17.410],
        [78.400, 17.400],
    ]],
}

FEATURE_WRAPPED = {
    "type": "Feature",
    "geometry": SIMPLE_POLYGON,
    "properties": {"name": "Test Village"},
}

FEATURE_COLLECTION_WRAPPED = {
    "type": "FeatureCollection",
    "features": [FEATURE_WRAPPED],
}

# Self-intersecting bowtie — Shapely should repair with buffer(0)
BOWTIE_POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [78.400, 17.400],
        [78.410, 17.410],
        [78.410, 17.400],
        [78.400, 17.410],
        [78.400, 17.400],
    ]],
}


# ─── Tests ──────────────────────────────────────────────────────────────────

class TestGeoJSONUnwrapping:
    """All three GeoJSON envelope types must be accepted."""

    def test_plain_polygon(self, svc):
        """A raw Polygon geometry is accepted and returns expected keys."""
        result = svc._validate_geojson(SIMPLE_POLYGON)
        assert result["geojson"]["type"] == "Polygon"
        assert "area_hectares" in result

    def test_feature_wrapped_polygon(self, svc):
        """A GeoJSON Feature containing a Polygon is correctly unwrapped."""
        result = svc._validate_geojson(FEATURE_WRAPPED)
        assert result["geojson"]["type"] == "Polygon"
        assert result["area_hectares"] > 0

    def test_feature_collection_unwrapped(self, svc):
        """FeatureCollection with one feature is unwrapped to its geometry."""
        result = svc._validate_geojson(FEATURE_COLLECTION_WRAPPED)
        assert result["geojson"]["type"] == "Polygon"

    def test_empty_feature_collection_raises(self, svc):
        """FeatureCollection with no features must raise ValueError."""
        empty_fc = {"type": "FeatureCollection", "features": []}
        with pytest.raises(ValueError, match="no features"):
            svc._validate_geojson(empty_fc)


class TestAreaCalculation:
    """Area computation must be latitude-corrected and within plausible bounds."""

    def test_area_is_positive(self, svc):
        result = svc._validate_geojson(SIMPLE_POLYGON)
        assert result["area_hectares"] > 0

    def test_area_plausible_for_1km_square(self, svc):
        """A ~0.01° × 0.01° box near 17° lat should be roughly 100–150 ha."""
        result = svc._validate_geojson(SIMPLE_POLYGON)
        # At lat 17.4°: 0.01deg ≈ 1.06km lon × 1.11km lat ≈ 117 ha
        assert 80 <= result["area_hectares"] <= 200, (
            f"Area {result['area_hectares']} ha outside expected range for ~1km² box"
        )

    def test_area_latitude_correction_applied(self, svc):
        """Polygon at high latitude should have smaller area than at equator."""
        equator_polygon = {
            "type": "Polygon",
            "coordinates": [[
                [78.400, 0.000],
                [78.410, 0.000],
                [78.410, 0.010],
                [78.400, 0.010],
                [78.400, 0.000],
            ]],
        }
        india_polygon = {
            "type": "Polygon",
            "coordinates": [[
                [78.400, 30.000],
                [78.410, 30.000],
                [78.410, 30.010],
                [78.400, 30.010],
                [78.400, 30.000],
            ]],
        }
        equator_result = svc._validate_geojson(equator_polygon)
        india_result = svc._validate_geojson(india_polygon)
        # At lat 30° cos(30°) ≈ 0.866, so area should be smaller
        assert india_result["area_hectares"] < equator_result["area_hectares"], (
            "Latitude correction not applied — higher latitude should give smaller area"
        )


class TestGeometryRepair:
    """Degenerate geometries should either be repaired or raise a clear error."""

    def test_bowtie_polygon_does_not_crash(self, svc):
        """Self-intersecting polygons are either repaired (buffer(0)) or raise ValueError."""
        try:
            result = svc._validate_geojson(BOWTIE_POLYGON)
            # If repaired: result must have area
            assert result["area_hectares"] >= 0
        except ValueError:
            pass  # Raising ValueError is also acceptable


class TestResolveByGeoJSON:
    """resolve_boundary() with geojson= kwarg must delegate to _validate_geojson."""

    def test_resolve_with_geojson(self, svc):
        result = svc.resolve_boundary(geojson=SIMPLE_POLYGON)
        assert result["state"] == "Unknown"
        assert result["district"] == "Unknown"
        assert result["area_hectares"] > 0

    def test_resolve_without_args_raises(self, svc):
        with pytest.raises(ValueError):
            svc.resolve_boundary()
