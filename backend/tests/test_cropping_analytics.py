"""Tests for the cropping intensity analytics pipeline.

Why this matters:
    compute_cropping_intensity() is the raster-path equivalent of the MWS vector
    aggregation.  Both paths must produce the same schema so the frontend charts
    render identically regardless of which data source was used.

    Key guards:
    1. total_cropped_ha == single + double + triple (invariant against copy-paste bugs)
    2. Pixel area constant: 30m × 30m = 0.09 ha — if someone changes this without
       updating the test, all area outputs will be silently wrong.
    3. The schema keys (single_crop_ha, double_crop_ha, triple_crop_ha, total_cropped_ha,
       year) must not be renamed — the frontend reads these by exact string key.
    4. compute_from_mws_data() is a passthrough — verifies it doesn't mangle the data.

No external services required.
"""

import pytest
from app.services.analytics.cropping import (
    compute_cropping_intensity,
    compute_from_mws_data,
)


# ─── Fixtures ────────────────────────────────────────────────────────────────

VILLAGE_NAME = "Test Village"
BOUNDARY_GEOJSON = {
    "type": "Polygon",
    "coordinates": [[[78.0, 17.0], [78.1, 17.0], [78.1, 17.1], [78.0, 17.1], [78.0, 17.0]]],
}

PIXEL_AREA_HA = 0.09  # 30m × 30m as documented in cropping.py


# ─── compute_cropping_intensity() ───────────────────────────────────────────

class TestCroppingIntensityFromRasters:
    """Tests for the raster pixel → hectare pipeline."""

    def test_all_single_crop_pixels(self):
        """100 single-crop pixels → only single_crop_ha is non-zero."""
        raster_data = {2022: [1] * 100}
        result = compute_cropping_intensity(
            VILLAGE_NAME, BOUNDARY_GEOJSON, [2022], raster_data
        )
        row = result["data"][0]
        assert row["single_crop_ha"] == pytest.approx(100 * PIXEL_AREA_HA, abs=0.001)
        assert row["double_crop_ha"] == 0.0
        assert row["triple_crop_ha"] == 0.0

    def test_all_double_crop_pixels(self):
        """50 double-crop pixels → only double_crop_ha is non-zero."""
        raster_data = {2022: [2] * 50}
        result = compute_cropping_intensity(
            VILLAGE_NAME, BOUNDARY_GEOJSON, [2022], raster_data
        )
        row = result["data"][0]
        assert row["double_crop_ha"] == pytest.approx(50 * PIXEL_AREA_HA, abs=0.001)
        assert row["single_crop_ha"] == 0.0

    def test_mixed_pixels_correct_split(self):
        """Mixed pixels [1,1,2,2,3] → proportional hectares for each class."""
        pixels = [1, 1, 2, 2, 3]
        raster_data = {2022: pixels}
        result = compute_cropping_intensity(
            VILLAGE_NAME, BOUNDARY_GEOJSON, [2022], raster_data
        )
        row = result["data"][0]
        assert row["single_crop_ha"] == pytest.approx(2 * PIXEL_AREA_HA, abs=0.001)
        assert row["double_crop_ha"] == pytest.approx(2 * PIXEL_AREA_HA, abs=0.001)
        assert row["triple_crop_ha"] == pytest.approx(1 * PIXEL_AREA_HA, abs=0.001)

    def test_total_is_sum_of_components(self):
        """INVARIANT: total_cropped_ha must always equal single + double + triple."""
        pixels = [1, 1, 1, 2, 2, 3, 3, 3, 3, 0, 0]  # zeros are non-crop
        raster_data = {2022: pixels}
        result = compute_cropping_intensity(
            VILLAGE_NAME, BOUNDARY_GEOJSON, [2022], raster_data
        )
        row = result["data"][0]
        expected_total = row["single_crop_ha"] + row["double_crop_ha"] + row["triple_crop_ha"]
        assert row["total_cropped_ha"] == pytest.approx(expected_total, abs=0.001), (
            "total_cropped_ha must equal single + double + triple "
            "(guards against copy-paste errors in the summation logic)"
        )

    def test_no_raster_data_raises(self):
        """Empty raster_data dict must raise ValueError, not return garbage."""
        with pytest.raises(ValueError, match="No raster data"):
            compute_cropping_intensity(VILLAGE_NAME, BOUNDARY_GEOJSON, [2022], {})

    def test_year_in_output(self):
        """Output row must include the 'year' key so the frontend can label x-axis."""
        raster_data = {2021: [1] * 10}
        result = compute_cropping_intensity(
            VILLAGE_NAME, BOUNDARY_GEOJSON, [2021], raster_data
        )
        assert result["data"][0]["year"] == 2021

    def test_multi_year_output_order_is_sorted(self):
        """Years in output must be sorted ascending (frontend expects chronological order)."""
        raster_data = {2022: [1] * 5, 2020: [2] * 5, 2021: [3] * 5}
        result = compute_cropping_intensity(
            VILLAGE_NAME, BOUNDARY_GEOJSON, [2020, 2021, 2022], raster_data
        )
        years = [row["year"] for row in result["data"]]
        assert years == sorted(years)

    def test_village_name_in_output(self):
        """Output must carry village_name for downstream chart labelling."""
        raster_data = {2022: [1] * 5}
        result = compute_cropping_intensity(
            VILLAGE_NAME, BOUNDARY_GEOJSON, [2022], raster_data
        )
        assert result["village_name"] == VILLAGE_NAME

    def test_non_crop_pixels_ignored(self):
        """Class 0 pixels (background/non-crop) must not inflate any hectare count."""
        raster_data = {2022: [0] * 100}
        result = compute_cropping_intensity(
            VILLAGE_NAME, BOUNDARY_GEOJSON, [2022], raster_data
        )
        if result["data"]:
            row = result["data"][0]
            assert row["single_crop_ha"] == 0.0
            assert row["double_crop_ha"] == 0.0
            assert row["triple_crop_ha"] == 0.0
            assert row["total_cropped_ha"] == 0.0


# ─── compute_from_mws_data() ─────────────────────────────────────────────────

class TestComputeFromMWSData:
    """compute_from_mws_data() must be a lossless passthrough."""

    MWS_AGGREGATED = [
        {"year": "2018-19", "single_crop_ha": 50.0, "double_crop_ha": 30.0,
         "triple_crop_ha": 5.0, "total_cropped_ha": 85.0, "cropping_intensity": 1.41},
        {"year": "2019-20", "single_crop_ha": 55.0, "double_crop_ha": 28.0,
         "triple_crop_ha": 4.0, "total_cropped_ha": 87.0, "cropping_intensity": 1.37},
    ]

    def test_output_contains_village_name(self):
        result = compute_from_mws_data(VILLAGE_NAME, self.MWS_AGGREGATED, [2019, 2020])
        assert result["village_name"] == VILLAGE_NAME

    def test_output_data_is_unmodified(self):
        result = compute_from_mws_data(VILLAGE_NAME, self.MWS_AGGREGATED, [2019, 2020])
        assert result["data"] == self.MWS_AGGREGATED

    def test_schema_keys_present(self):
        """Required schema keys must all be present so frontend charts don't break."""
        result = compute_from_mws_data(VILLAGE_NAME, self.MWS_AGGREGATED, [2019, 2020])
        assert "village_name" in result
        assert "data" in result
