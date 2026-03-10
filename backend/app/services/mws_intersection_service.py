"""CSVAT — MWS ↔ Village Intersection Service.

Bridges CoRE Stack's MWS-indexed data with CSVAT's village-level analytics.

Pipeline:
1. Fetch MWS polygon geometries overlapping the village (via CoRE Stack API)
2. Compute spatial intersection areas using Shapely
3. Fetch MWS-level analytics data from CoRE Stack API
4. Aggregate to village level via area-weighted averaging
5. Optionally fetch waterbody data for the tehsil
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
            area_ha = ix["overlap_area_ha"]
            mws_data = mws_data_by_uid.get(uid, {})
            value = mws_data.get(metric_key)

            if value is None:
                continue

            try:
                value = float(value)
            except (ValueError, TypeError):
                continue

            if aggregation == "weighted_sum":
                weighted_sum += value * fraction
            else:  # weighted_average
                weighted_sum += value * area_ha
                total_weight += area_ha

        if aggregation == "weighted_sum":
            return round(weighted_sum, 4)
        else:  # weighted_average
            if total_weight == 0:
                return None
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

    async def aggregate_waterbodies(
        self,
        state: str,
        district: str,
        tehsil: str,
    ) -> dict:
        """Fetch waterbody data for the tehsil from CoRE Stack.

        Returns summary with waterbody count, total area, and seasonal coverage.
        """
        from app.services.corestack_client import corestack_client

        try:
            wb_data = await corestack_client.get_waterbodies_by_admin(
                state, district, tehsil
            )
        except Exception as e:
            logger.warning("Waterbody fetch failed: %s", e)
            return {"count": 0, "waterbodies": [], "error": str(e)}

        waterbodies = []
        if isinstance(wb_data, dict):
            for uid, wb in wb_data.items():
                if isinstance(wb, dict):
                    waterbodies.append({
                        "uid": uid,
                        "name": wb.get("name", uid),
                        "area_ha": wb.get("area_ha", wb.get("area", 0)),
                        "type": wb.get("type", "unknown"),
                        "seasonal_data": {
                            k: v for k, v in wb.items()
                            if k.startswith(("k_", "kr_", "krz_"))
                        },
                        "zoi_properties": wb.get("zoi_properties", {}),
                    })
        elif isinstance(wb_data, list):
            for wb in wb_data:
                if isinstance(wb, dict):
                    waterbodies.append({
                        "uid": wb.get("uid", ""),
                        "name": wb.get("name", ""),
                        "area_ha": wb.get("area_ha", wb.get("area", 0)),
                        "type": wb.get("type", "unknown"),
                        "seasonal_data": {
                            k: v for k, v in wb.items()
                            if k.startswith(("k_", "kr_", "krz_"))
                        },
                        "zoi_properties": wb.get("zoi_properties", {}),
                    })

        return {
            "count": len(waterbodies),
            "waterbodies": waterbodies,
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

        CoRE Stack tehsil-data response structure:
        {
          "data": {
            "croppingIntensity_annual": [{uid, area_in_ha, single_cropped_area_in_ha_2017-2018, ...}],
            "surfaceWaterBodies_annual": [{uid, total_area_in_ha_2017-2018, ...}],
            "change_detection_deforestation": [{uid, ...}],
            ...
          },
          "status": "ok"
        }

        Raises:
            ValueError: If tehsil is not active or no MWS data available.
        """
        from app.services.corestack_client import corestack_client

        # 0. Resolve Unknown admin fields via CoRE Stack reverse geocoding
        if not state or state == "Unknown" or not district or district == "Unknown" or not tehsil or tehsil == "Unknown":
            try:
                village_shape = shape(village_geojson)
                centroid = village_shape.centroid
                admin_info = await corestack_client.get_admin_details_by_latlon(
                    centroid.y, centroid.x
                )
                if isinstance(admin_info, dict):
                    if admin_info.get("state") and (not state or state == "Unknown"):
                        state = admin_info["state"]
                    if admin_info.get("district") and (not district or district == "Unknown"):
                        district = admin_info["district"]
                    if (admin_info.get("tehsil") or admin_info.get("block")) and (not tehsil or tehsil == "Unknown"):
                        tehsil = admin_info.get("tehsil") or admin_info.get("block", tehsil)
                    logger.info("Resolved admin via centroid: state=%s, district=%s, tehsil=%s", state, district, tehsil)
            except Exception as e:
                logger.warning("Admin details resolution failed: %s", e)

        # 1. Fetch MWS geometries from CoRE Stack API
        logger.info("Fetching MWS geometries for %s/%s/%s", state, district, tehsil)
        mws_features = await corestack_client.get_mws_features_for_tehsil(
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

        # 3. Fetch raw tehsil data (layer-keyed dict)
        raw_tehsil = await corestack_client.get_tehsil_data(state, district, tehsil)

        # The API returns {"data": {layer_key: [mws_records]}, "status": "ok"}
        layer_data = raw_tehsil
        if isinstance(raw_tehsil, dict):
            layer_data = raw_tehsil.get("data", raw_tehsil)

        # Helper: build UID→record lookup from a layer's MWS list
        def _build_uid_lookup(layer_key: str) -> dict:
            records = layer_data.get(layer_key, []) if isinstance(layer_data, dict) else []
            if not isinstance(records, list):
                return {}
            lookup = {}
            for rec in records:
                if isinstance(rec, dict):
                    uid = str(rec.get("uid") or rec.get("mws_uid") or rec.get("UID", ""))
                    if uid:
                        lookup[uid] = rec
            return lookup

        # Convert calendar years to fiscal year strings: 2019 → "2018-2019"
        def _fiscal(year: int) -> str:
            return f"{year - 1}-{year}"

        # 4. Aggregate to village level
        results = {}

        if "cropping_intensity" in layers:
            crop_by_uid = _build_uid_lookup("croppingIntensity_annual")
            logger.info("Cropping intensity: %d MWS records found", len(crop_by_uid))
            crop_results = []
            for year in sorted(years):
                fy = _fiscal(year)
                single = self.aggregate_mws_metric(
                    intersections, crop_by_uid,
                    f"single_cropped_area_in_ha_{fy}", "weighted_sum",
                )
                double = self.aggregate_mws_metric(
                    intersections, crop_by_uid,
                    f"doubly_cropped_area_in_ha_{fy}", "weighted_sum",
                )
                triple = self.aggregate_mws_metric(
                    intersections, crop_by_uid,
                    f"triply_cropped_area_in_ha_{fy}", "weighted_sum",
                )
                intensity = self.aggregate_mws_metric(
                    intersections, crop_by_uid,
                    f"cropping_intensity_unit_less_{fy}", "weighted_average",
                )
                crop_results.append({
                    "year": fy,
                    "single_crop_ha": single or 0.0,
                    "double_crop_ha": double or 0.0,
                    "triple_crop_ha": triple or 0.0,
                    "total_cropped_ha": round(
                        (single or 0) + (double or 0) + (triple or 0), 4
                    ),
                    "cropping_intensity": intensity,
                })
            results["cropping_intensity"] = crop_results

        if "surface_water" in layers:
            water_by_uid = _build_uid_lookup("surfaceWaterBodies_annual")
            logger.info("Surface water: %d MWS records found", len(water_by_uid))
            water_results = []
            for year in sorted(years):
                fy = _fiscal(year)
                kharif = self.aggregate_mws_metric(
                    intersections, water_by_uid,
                    f"kharif_area_in_ha_{fy}", "weighted_sum",
                )
                rabi = self.aggregate_mws_metric(
                    intersections, water_by_uid,
                    f"rabi_area_in_ha_{fy}", "weighted_sum",
                )
                zaid = self.aggregate_mws_metric(
                    intersections, water_by_uid,
                    f"zaid_area_in_ha_{fy}", "weighted_sum",
                )
                total = self.aggregate_mws_metric(
                    intersections, water_by_uid,
                    f"total_area_in_ha_{fy}", "weighted_sum",
                )
                water_results.append({
                    "year": fy,
                    "kharif_ha": kharif or 0.0,
                    "rabi_ha": rabi or 0.0,
                    "zaid_ha": zaid or 0.0,
                    "total_water_ha": total or round(
                        (kharif or 0) + (rabi or 0) + (zaid or 0), 4
                    ),
                })
            results["surface_water"] = water_results

        if "vegetation" in layers:
            deforest_by_uid = _build_uid_lookup("change_detection_deforestation")
            logger.info("Vegetation/deforestation: %d MWS records found", len(deforest_by_uid))

            forest_to_barren = self.aggregate_mws_metric(
                intersections, deforest_by_uid,
                "forest_to_barren_area_in_ha", "weighted_sum",
            )
            forest_to_built = self.aggregate_mws_metric(
                intersections, deforest_by_uid,
                "forest_to_built_up_area_in_ha", "weighted_sum",
            )
            forest_to_farm = self.aggregate_mws_metric(
                intersections, deforest_by_uid,
                "forest_to_farm_area_in_ha", "weighted_sum",
            )
            forest_to_scrub = self.aggregate_mws_metric(
                intersections, deforest_by_uid,
                "forest_to_scrub_land_area_in_ha", "weighted_sum",
            )
            forest_to_forest = self.aggregate_mws_metric(
                intersections, deforest_by_uid,
                "forest_to_forest_area_in_ha", "weighted_sum",
            )
            total_deforestation = self.aggregate_mws_metric(
                intersections, deforest_by_uid,
                "total_deforestation_area_in_ha", "weighted_sum",
            )

            # Also try afforestation data
            afforest_by_uid = _build_uid_lookup("change_detection_afforestation")
            total_afforestation = self.aggregate_mws_metric(
                intersections, afforest_by_uid,
                "total_afforestation_area_in_ha", "weighted_sum",
            )

            loss = total_deforestation or 0.0
            gain = total_afforestation or 0.0

            results["vegetation"] = {
                "start_year": min(years) if years else 0,
                "end_year": max(years) if years else 0,
                "tree_cover_loss_ha": round(loss, 2),
                "tree_cover_gain_ha": round(gain, 2),
                "net_change_ha": round(gain - loss, 2),
                "degraded_land_ha": round(loss, 2),
                "transitions": [
                    {"from": "Forest", "to": "Barren", "area_ha": round(forest_to_barren or 0, 2)},
                    {"from": "Forest", "to": "Built Up", "area_ha": round(forest_to_built or 0, 2)},
                    {"from": "Forest", "to": "Farm", "area_ha": round(forest_to_farm or 0, 2)},
                    {"from": "Forest", "to": "Scrub Land", "area_ha": round(forest_to_scrub or 0, 2)},
                    {"from": "Forest", "to": "Forest", "area_ha": round(forest_to_forest or 0, 2)},
                ],
                "yearly_data": [],
            }

        # 5. Waterbodies (fetched separately)
        if "waterbodies" in layers:
            results["waterbodies"] = await self.aggregate_waterbodies(
                state, district, tehsil,
            )

        # 6. Terrain composition
        terrain_by_uid = _build_uid_lookup("terrain")
        if terrain_by_uid:
            logger.info("Terrain: %d MWS records found", len(terrain_by_uid))
            terrain_types = ["hill_slope", "plain", "ridge", "slopy", "valley"]
            terrain_result = {}
            for t in terrain_types:
                val = self.aggregate_mws_metric(
                    intersections, terrain_by_uid,
                    f"{t}_area_in_ha", "weighted_sum",
                )
                terrain_result[t] = round(val or 0, 2)
            terrain_result["total_area_ha"] = round(sum(terrain_result.values()), 2)
            results["terrain"] = terrain_result

        # 7. Cropping intensity change transitions
        crop_change_by_uid = _build_uid_lookup("change_detection_cropintensity")
        if crop_change_by_uid:
            logger.info("Crop intensity change: %d MWS records found", len(crop_change_by_uid))
            transition_keys = [
                ("total_change_cropintensity_area_in_ha", "Total Change CropIntensity"),
                ("single_to_double_area_in_ha", "Single To Double"),
                ("double_to_double_area_in_ha", "Double To Double"),
                ("single_to_single_area_in_ha", "Single To Single"),
                ("double_to_triple_area_in_ha", "Double To Triple"),
                ("single_to_triple_area_in_ha", "Single To Triple"),
                ("double_to_single_area_in_ha", "Double To Single"),
                ("triple_to_double_area_in_ha", "Triple To Double"),
                ("triple_to_triple_area_in_ha", "Triple To Triple"),
                ("triple_to_single_area_in_ha", "Triple To Single"),
            ]
            transitions = []
            for key, label in transition_keys:
                val = self.aggregate_mws_metric(
                    intersections, crop_change_by_uid, key, "weighted_sum",
                )
                transitions.append({"label": label, "area_ha": round(val or 0, 2)})
            results["crop_intensity_change"] = transitions

        results["mws_count"] = len(intersections)
        results["data_source"] = "corestack_mws"

        return results


mws_service = MWSIntersectionService()
