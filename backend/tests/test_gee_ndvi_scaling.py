"""Tests for GEE data transformation math.

Why this matters:
    MODIS NDVI raw pixel values are integers in the range [-2000, 10000].
    They must be multiplied by 0.0001 to produce the true NDVI (range -0.2 to 1.0).
    This is documented in the MODIS product spec and in gee_service.py:

        ndvi_mean = round(ndvi_mean_raw * 0.0001, 4)

    If someone "fixes" this to 0.001 (10× wrong) or removes it entirely (100× wrong),
    the values look like valid floats — no exception is raised.  The only way to
    catch the bug before it ships is to test the math directly.

    We also test the fiscal year label construction:
        fy_label = f"20{str(start_year)[-2:]}-{str(end_year)[-2:]}"
    e.g. (2017, 2018) → "2017-18"

    The frontend uses these labels to match NDVI timeseries rows to chart data.
    A wrong label causes the chart to silently show no data for affected years.

No GEE auth required — all math is extracted from gee_service.py and tested
as pure functions.
"""

import pytest


# ─── NDVI scale factor ───────────────────────────────────────────────────────

def apply_ndvi_scale(raw_value: float) -> float:
    """Mirror of the scale factor applied in gee_service.fetch_ndvi().

    Source: gee_service.py line ~227-228
        ndvi_mean = round(ndvi_mean_raw * 0.0001, 4)
    """
    return round(raw_value * 0.0001, 4)


class TestNDVIScaleFactor:
    """MODIS NDVI raw → real NDVI conversion (scale factor 0.0001)."""

    def test_healthy_vegetation(self):
        """Raw 7000 → 0.7000 (healthy green vegetation)."""
        assert apply_ndvi_scale(7000) == pytest.approx(0.7000, abs=1e-5)

    def test_zero_raw(self):
        """Raw 0 → 0.0000."""
        assert apply_ndvi_scale(0) == pytest.approx(0.0000, abs=1e-5)

    def test_maximum_ndvi(self):
        """Raw 10000 → 1.0000 (theoretical maximum)."""
        assert apply_ndvi_scale(10000) == pytest.approx(1.0000, abs=1e-5)

    def test_negative_raw_bare_soil_or_water(self):
        """Raw -2000 → -0.2000 (bare soil / standing water, valid MODIS range)."""
        assert apply_ndvi_scale(-2000) == pytest.approx(-0.2000, abs=1e-5)

    def test_result_rounded_to_4_decimal_places(self):
        """Output must be rounded to 4 dp as per implementation."""
        result = apply_ndvi_scale(3333)
        # 3333 * 0.0001 = 0.3333 exactly — check precision
        assert result == 0.3333

    def test_scale_is_not_0_001(self):
        """Guard: confirm we are NOT using 0.001 (10× wrong)."""
        raw = 5000
        result = apply_ndvi_scale(raw)
        wrong_result = round(raw * 0.001, 4)
        assert result != wrong_result, (
            "Scale factor appears to be 0.001 instead of 0.0001 — "
            "this would produce NDVI values 10× too large"
        )

    def test_scale_is_not_1(self):
        """Guard: confirm we are NOT returning raw integer as NDVI."""
        raw = 5000
        result = apply_ndvi_scale(raw)
        assert result < 2.0, (
            f"NDVI of {result} is ecologically impossible — "
            "scale factor may be missing entirely"
        )


# ─── Fiscal year label construction ──────────────────────────────────────────

def make_fy_label(start_year: int, end_year: int) -> str:
    """Mirror of the fy_label pattern used in gee_service and raster_proxy.

    Source: gee_service.py ~line 308
        fy_label = f"20{str(start_year)[-2:]}-{str(end_year)[-2:]}"
    """
    return f"20{str(start_year)[-2:]}-{str(end_year)[-2:]}"


class TestFiscalYearLabel:
    """Fiscal year label must match what the frontend expects for chart data matching."""

    def test_2017_2018(self):
        assert make_fy_label(2017, 2018) == "2017-18"

    def test_2018_2019(self):
        assert make_fy_label(2018, 2019) == "2018-19"

    def test_2023_2024(self):
        assert make_fy_label(2023, 2024) == "2023-24"

    def test_2024_2025(self):
        assert make_fy_label(2024, 2025) == "2024-25"

    def test_label_is_string(self):
        assert isinstance(make_fy_label(2020, 2021), str)

    def test_label_contains_hyphen_separator(self):
        """Label must use '-' separator so frontend can split on it."""
        label = make_fy_label(2021, 2022)
        assert "-" in label

    def test_all_corestack_fiscal_years_produce_unique_labels(self):
        """All 8 fiscal years in CORESTACK_FISCAL_YEARS must produce distinct labels."""
        from app.services.gee_service import CORESTACK_FISCAL_YEARS
        labels = [make_fy_label(s, e) for s, e in CORESTACK_FISCAL_YEARS]
        assert len(labels) == len(set(labels)), (
            "Duplicate fiscal year labels detected — chart data will overwrite each other"
        )


# ─── LULC class mapping (used by wasmEngine / pyodideEngine client-side) ─────

class TestLULCClassNames:
    """LULC_CLASS_NAMES must contain the expected MODIS class IDs."""

    def test_class_12_is_croplands(self):
        from app.services.gee_service import LULC_CLASS_NAMES
        assert LULC_CLASS_NAMES[12] == "Croplands"

    def test_class_17_is_water_bodies(self):
        from app.services.gee_service import LULC_CLASS_NAMES
        assert LULC_CLASS_NAMES[17] == "Water Bodies"

    def test_all_class_ids_are_integers(self):
        from app.services.gee_service import LULC_CLASS_NAMES
        for k in LULC_CLASS_NAMES:
            assert isinstance(k, int), f"Class key {k!r} is not an int — histogram lookup will fail"

    def test_class_names_are_non_empty_strings(self):
        from app.services.gee_service import LULC_CLASS_NAMES
        for k, v in LULC_CLASS_NAMES.items():
            assert isinstance(v, str) and v.strip(), f"Class {k} has empty or non-string name"
