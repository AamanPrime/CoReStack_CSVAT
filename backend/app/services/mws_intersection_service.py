"""CSVAT — MWS ↔ Village Intersection Service.

Bridges CoRE Stack's MWS-indexed data with CSVAT's village-level analytics.

Pipeline:
1. Fetch MWS polygon geometries overlapping the village (from GeoServer)
2. Compute spatial intersection areas using Shapely
3. Fetch MWS-level analytics data from CoRE Stack API
4. Aggregate to village level via area-weighted averaging
"""

import logging
from typing import Optional
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

logger = logging.getLogger(__name__)


class MWSIntersectionService:
    """Spatial intersection of MWS polygons with village boundaries."""

    def compute_intersections(
        self,
        village_geojson: dict,
        mws_features: list[dict],
    ) -> list[dict]:
        """Compute overlap fractions between village and each MWS polygon.

        Args:
            village_geojson: GeoJSON geometry (Polygon/MultiPolygon) of the village.
            mws_features: List of GeoJSON Feature dicts, each with a 'geometry'
                         and 'properties' containing at minimum 'uid' (MWS UID).

        Returns:
            List of dicts: {
                mws_uid, overlap_fraction, overlap_area_ha,
                mws_area_ha, mws_properties
            }
            Only includes MWS with non-zero overlap.
        """
        village_shape = shape(village_geojson)
        if not village_shape.is_valid:
            village_shape = village_shape.buffer(0)

        village_area = village_shape.area  # in degrees²

        intersections = []
        for feat in mws_features:
            geom = feat.get("geometry")
            props = feat.get("properties", {})
            if not geom:
                continue

            mws_shape = shape(geom)
            if not mws_shape.is_valid:
                mws_shape = mws_shape.buffer(0)

            if not village_shape.intersects(mws_shape):
                continue

            overlap = village_shape.intersection(mws_shape)
            if overlap.is_empty:
                continue

            overlap_area_deg2 = overlap.area
            mws_area_deg2 = mws_shape.area

            # Fraction of this MWS that falls within the village
            overlap_fraction = (
                overlap_area_deg2 / mws_area_deg2 if mws_area_deg2 > 0 else 0
            )

            # Convert to hectares (approximate: 1 deg ≈ 111 km at equator)
            overlap_area_ha = overlap_area_deg2 * (111**2) * 100
            mws_area_ha = mws_area_deg2 * (111**2) * 100

            # Extract MWS UID from properties
            mws_uid = props.get("uid") or props.get("mws_uid") or props.get("UID", "")

            intersections.append({
                "mws_uid": str(mws_uid),
                "overlap_fraction": round(overlap_fraction, 6),
                "overlap_area_ha": round(overlap_area_ha, 4),
                "mws_area_ha": round(mws_area_ha, 4),
                "mws_properties": props,
            })

        logger.info(
            "MWS intersection: %d of %d MWS polygons overlap the village",
            len(intersections),
            len(mws_features),
        )
        return intersections

    def aggregate_mws_metric(
        self,
        intersections: list[dict],
        mws_data_by_uid: dict,
        metric_key: str,
        aggregation: str = "weighted_average",
    ) -> Optional[float]:
        """Aggregate a single MWS-level metric to the village level.

        Args:
            intersections: Output of compute_intersections().
            mws_data_by_uid: Dict keyed by MWS UID → dict of metric values.
            metric_key: The key to extract from each MWS data dict.
            aggregation: 'weighted_average' or 'weighted_sum'.
                - weighted_average: Σ(value × fraction) / Σ(fraction)
                  Use for intensive properties (density, intensity, %).
                - weighted_sum: Σ(value × fraction)
                  Use for extensive properties (area in hectares).

        Returns:
            Aggregated value, or None if no data.
        """
        total_weight = 0.0
        weighted_sum = 0.0

        for ix in intersections:
            uid = ix["mws_uid"]
            fraction = ix["overlap_fraction"]
            mws_data = mws_data_by_uid.get(uid, {})
            value = mws_data.get(metric_key)

            if value is None:
                continue

            try:
                value = float(value)
            except (ValueError, TypeError):
                continue

            weighted_sum += value * fraction
            total_weight += fraction

        if total_weight == 0:
            return None

        if aggregation == "weighted_sum":
            return round(weighted_sum, 4)
        else:  # weighted_average
            return round(weighted_sum / total_weight, 4)

    def aggregate_cropping_intensity(
        self,
        intersections: list[dict],
        mws_data_by_uid: dict,
        years: list[int],
    ) -> list[dict]:
        """Aggregate cropping intensity data across MWS to village level.

        Upstream CoRE Stack stores per-MWS:
          - single_kharif_cropped_area_{year}
          - single_non_kharif_cropped_area_{year}
          - single_cropped_area_{year}
          - doubly_cropped_area_{year}
          - triply_cropped_area_{year}
          - cropping_intensity_{year}

        For area metrics → weighted_sum (scale by overlap fraction).
        For intensity metric → weighted_average.
        """
        results = []
        for year in sorted(years):
            single_ha = self.aggregate_mws_metric(
                intersections, mws_data_by_uid,
                f"single_cropped_area_{year}", "weighted_sum",
            )
            double_ha = self.aggregate_mws_metric(
                intersections, mws_data_by_uid,
                f"doubly_cropped_area_{year}", "weighted_sum",
            )
            triple_ha = self.aggregate_mws_metric(
                intersections, mws_data_by_uid,
                f"triply_cropped_area_{year}", "weighted_sum",
            )
            intensity = self.aggregate_mws_metric(
                intersections, mws_data_by_uid,
                f"cropping_intensity_{year}", "weighted_average",
            )

            results.append({
                "year": year,
                "single_crop_ha": single_ha or 0.0,
                "double_crop_ha": double_ha or 0.0,
                "triple_crop_ha": triple_ha or 0.0,
                "total_cropped_ha": round(
                    (single_ha or 0) + (double_ha or 0) + (triple_ha or 0), 4
                ),
                "cropping_intensity": intensity,
            })
        return results

    def aggregate_surface_water(
        self,
        intersections: list[dict],
        mws_data_by_uid: dict,
        years: list[int],
    ) -> list[dict]:
        """Aggregate surface water body data across MWS to village level.

        Upstream keys (from SWB layer):
          - water_kharif_area_{year}
          - water_rabi_area_{year}
          - water_zaid_area_{year}
          - perennial_area_{year}
        """
        results = []
        for year in sorted(years):
            perennial = self.aggregate_mws_metric(
                intersections, mws_data_by_uid,
                f"perennial_area_{year}", "weighted_sum",
            )
            monsoon = self.aggregate_mws_metric(
                intersections, mws_data_by_uid,
                f"water_kharif_area_{year}", "weighted_sum",
            )
            winter = self.aggregate_mws_metric(
                intersections, mws_data_by_uid,
                f"water_rabi_area_{year}", "weighted_sum",
            )

            results.append({
                "year": year,
                "perennial_ha": perennial or 0.0,
                "seasonal_monsoon_ha": monsoon or 0.0,
                "seasonal_winter_ha": winter or 0.0,
                "total_water_ha": round(
                    (perennial or 0) + (monsoon or 0) + (winter or 0), 4
                ),
            })
        return results

    def aggregate_vegetation(
        self,
        intersections: list[dict],
        mws_data_by_uid: dict,
        years: list[int],
    ) -> dict:
        """Aggregate tree cover / vegetation data across MWS to village level.

        Upstream keys (from tree_health layers):
          - tree_cover_area_{year}   (or canopy_cover_density_{year})
          - tree_cover_change_{start}_{end}
        """
        if len(years) < 2:
            return {}

        start_year = min(years)
        end_year = max(years)

        tree_start = self.aggregate_mws_metric(
            intersections, mws_data_by_uid,
            f"tree_cover_area_{start_year}", "weighted_sum",
        )
        tree_end = self.aggregate_mws_metric(
            intersections, mws_data_by_uid,
            f"tree_cover_area_{end_year}", "weighted_sum",
        )

        yearly_data = []
        for year in sorted(years):
            cover = self.aggregate_mws_metric(
                intersections, mws_data_by_uid,
                f"tree_cover_area_{year}", "weighted_sum",
            )
            yearly_data.append({"year": year, "tree_cover_ha": cover or 0.0})

        tree_start = tree_start or 0.0
        tree_end = tree_end or 0.0
        net = tree_end - tree_start

        return {
            "start_year": start_year,
            "end_year": end_year,
            "tree_cover_start_ha": round(tree_start, 4),
            "tree_cover_end_ha": round(tree_end, 4),
            "net_change_ha": round(net, 4),
            "tree_cover_loss_ha": round(abs(net) if net < 0 else 0, 4),
            "tree_cover_gain_ha": round(net if net > 0 else 0, 4),
            "degraded_land_ha": 0.0,  # Requires separate degradation layer
            "yearly_data": yearly_data,
        }

    async def compute_village_analytics(
        self,
        village_geojson: dict,
        state: str,
        district: str,
        tehsil: str,
        layers: list[str],
        years: list[int],
    ) -> dict:
        """Full pipeline: fetch MWS data → intersect → aggregate → return village results.

        Raises:
            ValueError: If tehsil is not active or no MWS data available.
        """
        from app.services.corestack_client import corestack_client

        # 1. Fetch MWS geometries from GeoServer
        logger.info("Fetching MWS geometries for %s/%s/%s", state, district, tehsil)
        mws_features = await corestack_client.get_mws_geometries(
            state, district, tehsil
        )
        if not mws_features:
            raise ValueError(
                f"No MWS geometries found for {state}/{district}/{tehsil}. "
                "This tehsil may not be active on CoRE Stack."
            )

        # 2. Compute spatial intersections
        intersections = self.compute_intersections(village_geojson, mws_features)
        if not intersections:
            raise ValueError(
                "Village boundary does not overlap any micro-watersheds in this tehsil."
            )

        logger.info(
            "Found %d overlapping MWS, fetching tehsil data...",
            len(intersections),
        )

        # 3. Fetch MWS-level analytics data
        tehsil_data = await corestack_client.get_mws_data_for_tehsil(
            state, district, tehsil
        )

        # Build lookup: MWS UID → properties dict
        mws_data_by_uid = {}
        for mws_record in tehsil_data:
            uid = str(
                mws_record.get("uid")
                or mws_record.get("mws_uid")
                or mws_record.get("UID", "")
            )
            if uid:
                mws_data_by_uid[uid] = mws_record

        # 4. Aggregate to village level
        results = {}

        if "cropping_intensity" in layers:
            results["cropping_intensity"] = self.aggregate_cropping_intensity(
                intersections, mws_data_by_uid, years,
            )

        if "surface_water" in layers:
            results["surface_water"] = self.aggregate_surface_water(
                intersections, mws_data_by_uid, years,
            )

        if "vegetation" in layers:
            results["vegetation"] = self.aggregate_vegetation(
                intersections, mws_data_by_uid, years,
            )

        results["mws_count"] = len(intersections)
        results["data_source"] = "corestack_mws"

        return results


mws_service = MWSIntersectionService()
