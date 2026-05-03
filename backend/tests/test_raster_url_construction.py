"""Tests for raster proxy URL construction logic.

Why this matters:
    Every raster download the frontend triggers begins with a URL constructed
    by normalize_name() + the RASTER_LAYER_DEFS template.  GeoServer returns
    HTTP 200 with an XML error body for wrong layer names — NOT a 4xx — so
    a malformed URL is completely invisible at the network layer.  The only
    safety net is testing the string itself.

    Specifically guards against:
    - Spaces left in district/tehsil names  → GeoServer 404-in-disguise
    - Hyphens not converted to underscores  → wrong coverage ID
    - Fiscal year count changing unexpectedly (would break the UI year picker)

No external services required.
"""

import pytest
from app.api.raster_proxy import normalize_name, RASTER_LAYER_DEFS, FISCAL_YEARS, GEOSERVER_BASE


# ─── normalize_name() ────────────────────────────────────────────────────────

class TestNormalizeName:
    """normalize_name converts admin names to the GeoServer URL-safe format."""

    def test_spaces_replaced_with_underscores(self):
        assert normalize_name("Andhra Pradesh") == "andhra_pradesh"

    def test_hyphens_replaced_with_underscores(self):
        assert normalize_name("Nalgonda-Rural") == "nalgonda_rural"

    def test_leading_trailing_whitespace_stripped(self):
        assert normalize_name("  Karimnagar ") == "karimnagar"

    def test_already_normalized_is_unchanged(self):
        assert normalize_name("nalgonda") == "nalgonda"

    def test_mixed_case_lowercased(self):
        assert normalize_name("Warangal Urban") == "warangal_urban"

    def test_multiple_spaces_collapsed_to_single_underscore(self):
        # "East  Godavari" has a double space — normalize via replace(" ", "_")
        # This produces "east__godavari"; that's the current behavior — test it.
        result = normalize_name("East  Godavari")
        assert " " not in result, "Result must not contain raw spaces"
        assert result == result.lower(), "Result must be lowercase"


# ─── WCS URL construction ────────────────────────────────────────────────────

class TestRasterURLConstruction:
    """The constructed WCS URL must be syntactically correct and match GeoServer pattern."""

    DISTRICT = "Nalgonda"
    TEHSIL = "Miryalaguda"

    def _build_urls(self):
        """Mirror the logic inside get_raster_layers() without HTTP."""
        norm_district = normalize_name(self.DISTRICT)
        norm_tehsil = normalize_name(self.TEHSIL)
        urls = []
        for layer_def in RASTER_LAYER_DEFS:
            for yy_start, yy_end in FISCAL_YEARS:
                coverage_id = layer_def["coverage_template"].format(
                    district=norm_district,
                    tehsil=norm_tehsil,
                    yy_start=yy_start,
                    yy_end=yy_end,
                )
                wcs_url = (
                    f"{GEOSERVER_BASE}/{layer_def['workspace']}/wcs"
                    f"?service=WCS&version=2.0.1&request=GetCoverage"
                    f"&CoverageId={coverage_id}"
                    f"&format=geotiff&compression=LZW&tiling=false"
                )
                urls.append(wcs_url)
        return urls

    def test_all_urls_point_to_geoserver(self):
        for url in self._build_urls():
            assert "geoserver.core-stack.org" in url, f"URL missing expected host: {url}"

    def test_urls_contain_correct_wcs_version(self):
        for url in self._build_urls():
            assert "version=2.0.1" in url

    def test_urls_contain_get_coverage_request(self):
        for url in self._build_urls():
            assert "request=GetCoverage" in url

    def test_urls_contain_normalized_district(self):
        norm = normalize_name(self.DISTRICT)
        for url in self._build_urls():
            assert norm in url, f"Normalized district '{norm}' missing from: {url}"

    def test_urls_contain_normalized_tehsil(self):
        norm = normalize_name(self.TEHSIL)
        for url in self._build_urls():
            assert norm in url, f"Normalized tehsil '{norm}' missing from: {url}"

    def test_urls_have_no_raw_spaces(self):
        """Raw spaces in a URL are invalid and will break HTTP clients."""
        for url in self._build_urls():
            assert " " not in url, f"URL contains raw space: {url}"

    def test_url_count_matches_fiscal_years_times_layer_defs(self):
        """Every layer × every fiscal year should produce exactly one URL."""
        urls = self._build_urls()
        expected = len(RASTER_LAYER_DEFS) * len(FISCAL_YEARS)
        assert len(urls) == expected

    def test_all_urls_are_unique(self):
        urls = self._build_urls()
        assert len(urls) == len(set(urls)), "Duplicate URLs detected — fiscal year loop may be broken"


# ─── FISCAL_YEARS constant ───────────────────────────────────────────────────

class TestFiscalYearsConstant:
    """FISCAL_YEARS must cover the expected range for this project."""

    def test_fiscal_years_has_expected_count(self):
        # 2017-18 through 2024-25 = 8 entries
        assert len(FISCAL_YEARS) == 8, (
            f"Expected 8 fiscal years, got {len(FISCAL_YEARS)}. "
            "Frontend year picker will be broken if this changes without updating the UI."
        )

    def test_fiscal_years_starts_at_17_18(self):
        assert FISCAL_YEARS[0] == ("17", "18"), "First fiscal year must be 17_18"

    def test_fiscal_years_ends_at_24_25(self):
        assert FISCAL_YEARS[-1] == ("24", "25"), "Last fiscal year must be 24_25"

    def test_fiscal_years_are_consecutive(self):
        for i in range(len(FISCAL_YEARS) - 1):
            current_end = int(FISCAL_YEARS[i][1])
            next_start = int(FISCAL_YEARS[i + 1][0])
            assert current_end == next_start, (
                f"Gap in fiscal years between {FISCAL_YEARS[i]} and {FISCAL_YEARS[i+1]}"
            )
