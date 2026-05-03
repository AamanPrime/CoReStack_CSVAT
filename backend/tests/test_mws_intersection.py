"""Tests for MWS ↔ Village Intersection Service.

Uses synthetic polygon data — no API calls needed.
"""

import pytest
from app.services.mws_intersection_service import MWSIntersectionService


@pytest.fixture
def service():
    return MWSIntersectionService()


# ─── Test Polygons ───
# Village: 1km × 1km square centered at (78.0, 18.0)
VILLAGE_GEOJSON = {
    "type": "Polygon",
    "coordinates": [[
        [77.995, 17.995],
        [78.005, 17.995],
        [78.005, 18.005],
        [77.995, 18.005],
        [77.995, 17.995],
    ]],
}

# MWS fully inside the village (small square)
MWS_INSIDE = {
    "type": "Feature",
    "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [77.998, 17.998],
            [78.002, 17.998],
            [78.002, 18.002],
            [77.998, 18.002],
            [77.998, 17.998],
        ]],
    },
    "properties": {"uid": "MWS_001"},
}

# MWS partially overlapping (half inside, half outside)
MWS_PARTIAL = {
    "type": "Feature",
    "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [78.000, 17.995],
            [78.010, 17.995],
            [78.010, 18.005],
            [78.000, 18.005],
            [78.000, 17.995],
        ]],
    },
    "properties": {"uid": "MWS_002"},
}

# MWS completely outside the village
MWS_OUTSIDE = {
    "type": "Feature",
    "geometry": {
        "type": "Polygon",
        "coordinates": [[
            [79.000, 19.000],
            [79.010, 19.000],
            [79.010, 19.010],
            [79.000, 19.010],
            [79.000, 19.000],
        ]],
    },
    "properties": {"uid": "MWS_003"},
}


class TestComputeIntersections:
    """Test spatial intersection computation."""

    def test_fully_contained_mws(self, service):
        """MWS fully inside village → overlap_fraction = 1.0."""
        result = service.compute_intersections(VILLAGE_GEOJSON, [MWS_INSIDE])
        assert len(result) == 1
        assert result[0]["mws_uid"] == "MWS_001"
        assert result[0]["overlap_fraction"] == pytest.approx(1.0, abs=0.01)

    def test_partial_overlap(self, service):
        """MWS partially overlapping → 0 < overlap_fraction < 1."""
        result = service.compute_intersections(VILLAGE_GEOJSON, [MWS_PARTIAL])
        assert len(result) == 1
        assert result[0]["mws_uid"] == "MWS_002"
        assert 0.0 < result[0]["overlap_fraction"] < 1.0

    def test_no_overlap(self, service):
        """MWS completely outside → excluded from results."""
        result = service.compute_intersections(VILLAGE_GEOJSON, [MWS_OUTSIDE])
        assert len(result) == 0

    def test_mixed_features(self, service):
        """Only overlapping MWS are included."""
        result = service.compute_intersections(
            VILLAGE_GEOJSON, [MWS_INSIDE, MWS_PARTIAL, MWS_OUTSIDE]
        )
        uids = {r["mws_uid"] for r in result}
        assert uids == {"MWS_001", "MWS_002"}
        assert len(result) == 2

    def test_overlap_area_positive(self, service):
        """Overlap areas should be positive for overlapping MWS."""
        result = service.compute_intersections(VILLAGE_GEOJSON, [MWS_INSIDE])
        assert result[0]["overlap_area_ha"] > 0
        assert result[0]["mws_area_ha"] > 0


class TestAggregation:
    """Test weighted aggregation of MWS metrics."""

    def test_weighted_average_single_mws(self, service):
        """Single MWS with fraction=1.0 → value unchanged.

        aggregate_mws_metric() uses overlap_area_ha as the weight for
        weighted_average (area-weighted mean).  overlap_fraction is used
        only by weighted_sum.
        """
        intersections = [{"mws_uid": "MWS_001", "overlap_fraction": 1.0, "overlap_area_ha": 50.0}]
        mws_data = {"MWS_001": {"metric_a": 42.5}}

        result = service.aggregate_mws_metric(
            intersections, mws_data, "metric_a", "weighted_average"
        )
        assert result == pytest.approx(42.5, abs=0.01)

    def test_weighted_average_two_mws(self, service):
        """Two MWS with equal overlap areas → simple average."""
        intersections = [
            {"mws_uid": "A", "overlap_fraction": 0.5, "overlap_area_ha": 25.0},
            {"mws_uid": "B", "overlap_fraction": 0.5, "overlap_area_ha": 25.0},
        ]
        mws_data = {"A": {"val": 10.0}, "B": {"val": 20.0}}

        result = service.aggregate_mws_metric(
            intersections, mws_data, "val", "weighted_average"
        )
        # (10*25 + 20*25) / (25+25) = 15.0
        assert result == pytest.approx(15.0, abs=0.01)

    def test_weighted_average_unequal_fractions(self, service):
        """Unequal overlap areas → properly area-weighted."""
        intersections = [
            {"mws_uid": "A", "overlap_fraction": 0.8, "overlap_area_ha": 80.0},
            {"mws_uid": "B", "overlap_fraction": 0.2, "overlap_area_ha": 20.0},
        ]
        mws_data = {"A": {"val": 100.0}, "B": {"val": 0.0}}

        result = service.aggregate_mws_metric(
            intersections, mws_data, "val", "weighted_average"
        )
        # (100*80 + 0*20) / (80+20) = 80.0
        assert result == pytest.approx(80.0, abs=0.01)

    def test_weighted_sum(self, service):
        """Weighted sum for area metrics uses overlap_fraction (not area)."""
        intersections = [
            {"mws_uid": "A", "overlap_fraction": 0.6, "overlap_area_ha": 60.0},
            {"mws_uid": "B", "overlap_fraction": 0.4, "overlap_area_ha": 40.0},
        ]
        mws_data = {"A": {"area": 100.0}, "B": {"area": 50.0}}

        result = service.aggregate_mws_metric(
            intersections, mws_data, "area", "weighted_sum"
        )
        # 100*0.6 + 50*0.4 = 80.0
        assert result == pytest.approx(80.0, abs=0.01)

    def test_missing_data_returns_none(self, service):
        """If no MWS have the metric → return None."""
        intersections = [{"mws_uid": "A", "overlap_fraction": 1.0, "overlap_area_ha": 10.0}]
        mws_data = {"A": {"other_metric": 42}}

        result = service.aggregate_mws_metric(
            intersections, mws_data, "nonexistent", "weighted_average"
        )
        assert result is None


class TestCroppingIntensityAggregation:
    """Test cropping intensity specific aggregation."""

    def test_cropping_intensity_format(self, service):
        """Output matches expected schema with year, areas, and intensity."""
        intersections = [
            {"mws_uid": "MWS_001", "overlap_fraction": 1.0, "overlap_area_ha": 100.0},
        ]
        mws_data = {
            "MWS_001": {
                "single_cropped_area_2022": 50.0,
                "doubly_cropped_area_2022": 30.0,
                "triply_cropped_area_2022": 10.0,
                "cropping_intensity_2022": 165.0,
            }
        }

        result = service.aggregate_cropping_intensity(
            intersections, mws_data, [2022]
        )
        assert len(result) == 1
        assert result[0]["year"] == 2022
        assert result[0]["single_crop_ha"] == pytest.approx(50.0, abs=0.01)
        assert result[0]["double_crop_ha"] == pytest.approx(30.0, abs=0.01)
        assert result[0]["triple_crop_ha"] == pytest.approx(10.0, abs=0.01)
        assert result[0]["total_cropped_ha"] == pytest.approx(90.0, abs=0.01)
        assert result[0]["cropping_intensity"] == pytest.approx(165.0, abs=0.01)


class TestSurfaceWaterAggregation:
    """Test surface water specific aggregation."""

    def test_surface_water_format(self, service):
        """Output matches expected schema."""
        intersections = [
            {"mws_uid": "MWS_001", "overlap_fraction": 0.5, "overlap_area_ha": 50.0},
        ]
        mws_data = {
            "MWS_001": {
                "perennial_area_2022": 20.0,
                "water_kharif_area_2022": 40.0,
                "water_rabi_area_2022": 15.0,
            }
        }

        result = service.aggregate_surface_water(
            intersections, mws_data, [2022]
        )
        assert len(result) == 1
        assert result[0]["year"] == 2022
        # Weighted sum with 0.5 fraction
        assert result[0]["perennial_ha"] == pytest.approx(10.0, abs=0.01)
        assert result[0]["seasonal_monsoon_ha"] == pytest.approx(20.0, abs=0.01)
        assert result[0]["seasonal_winter_ha"] == pytest.approx(7.5, abs=0.01)


class TestVegetationAggregation:
    """Test vegetation change aggregation."""

    def test_vegetation_net_change(self, service):
        """Net change calculated correctly."""
        intersections = [
            {"mws_uid": "MWS_001", "overlap_fraction": 1.0, "overlap_area_ha": 100.0},
        ]
        mws_data = {
            "MWS_001": {
                "tree_cover_area_2019": 100.0,
                "tree_cover_area_2023": 80.0,
            }
        }

        result = service.aggregate_vegetation(
            intersections, mws_data, [2019, 2023]
        )
        assert result["start_year"] == 2019
        assert result["end_year"] == 2023
        assert result["tree_cover_start_ha"] == pytest.approx(100.0, abs=0.01)
        assert result["tree_cover_end_ha"] == pytest.approx(80.0, abs=0.01)
        assert result["net_change_ha"] == pytest.approx(-20.0, abs=0.01)
        assert result["tree_cover_loss_ha"] == pytest.approx(20.0, abs=0.01)
        assert result["tree_cover_gain_ha"] == pytest.approx(0.0, abs=0.01)
