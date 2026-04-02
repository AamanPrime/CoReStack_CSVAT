"""CSVAT — Raster Proxy API.

Constructs GeoServer WCS URLs for CoRE Stack raster layers and proxies
GeoTIFF downloads through our backend (to handle CORS and API keys).

GeoServer URL pattern (from CoRE Stack's own website):
  https://geoserver.core-stack.org:8443/geoserver/{workspace}/wcs
    ?service=WCS&version=2.0.1&request=GetCoverage
    &CoverageId={workspace}:{layer_prefix}_{YY_YY}_{district}_{tehsil}_{suffix}
    &format=geotiff&compression=LZW&tiling=false

Known workspaces:
  - LULC_level_3       → Cropping intensity (single/double/triple crop classification)

Coverage ID naming convention:
  - LULC: LULC_{start_YY}_{end_YY}_{district}_{tehsil}_level_3

Surface water data comes from the CoRE Stack tehsil vector API
(surfaceWaterBodies_annual), NOT rasters — it only exists as a vector layer.
"""

import logging
from urllib.parse import unquote

import httpx
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse

from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/raster", tags=["Raster Proxy"])

GEOSERVER_BASE = "https://geoserver.core-stack.org:8443/geoserver"

# Known raster layer definitions
# Each entry: workspace, coverage_id_template, description
# In the template: {district}, {tehsil}, {yy_start}, {yy_end} will be replaced
RASTER_LAYER_DEFS = [
    {
        "category": "cropping_intensity",
        "workspace": "LULC_level_3",
        "coverage_template": "LULC_level_3:LULC_{yy_start}_{yy_end}_{district}_{tehsil}_level_3",
        "description": "LULC Classification (Single/Double/Triple Crop)",
    },
    # NOTE: Surface water does NOT exist as raster on GeoServer.
    # It's served as vector layer (workspace: swb). Water data is fetched
    # from the CoRE Stack tehsil API (surfaceWaterBodies_annual) instead.
]

# Fiscal year ranges available on CoRE Stack (YY_YY format)
FISCAL_YEARS = [
    ("17", "18"),
    ("18", "19"),
    ("19", "20"),
    ("20", "21"),
    ("21", "22"),
    ("22", "23"),
    ("23", "24"),
    ("24", "25"),
]


def normalize_name(name: str) -> str:
    """Normalize state/district/tehsil names for GeoServer URL construction.

    CoRE Stack uses lowercase with underscores: 'Andhra Pradesh' → 'andhra_pradesh'
    """
    return name.strip().lower().replace(" ", "_").replace("-", "_")


@router.get("/layers")
async def get_raster_layers(
    state: str = Query(...),
    district: str = Query(...),
    tehsil: str = Query(...),
):
    """Construct GeoServer WCS download URLs for available raster layers.

    Instead of relying on the get_generated_layer_urls API (which only returns
    vector layers), we construct URLs directly using the known GeoServer pattern.
    """
    norm_district = normalize_name(district)
    norm_tehsil = normalize_name(tehsil)

    layers = []
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
            fiscal_label = f"20{yy_start}-{yy_end}"
            layers.append({
                "category": layer_def["category"],
                "layer_name": f"{layer_def['description']} ({fiscal_label})",
                "layer_type": "raster",
                "layer_url": wcs_url,
                "coverage_id": coverage_id,
                "fiscal_year": fiscal_label,
                "workspace": layer_def["workspace"],
            })

    return {"status": "ok", "data": layers, "count": len(layers)}


@router.get("/download")
async def download_raster(
    url: str = Query(..., description="GeoServer WCS URL to proxy"),
):
    """Proxy a GeoTIFF download from CoRE Stack GeoServer.

    Streams the binary response back to the frontend.
    Returns Content-Type: image/tiff for GeoTIFF files.
    """
    settings = get_settings()
    decoded_url = unquote(url)

    # Security: only proxy URLs from known CoRE Stack GeoServer
    if "geoserver.core-stack.org" not in decoded_url:
        raise HTTPException(
            status_code=403,
            detail="Only CoRE Stack GeoServer URLs can be proxied.",
        )

    try:
        async with httpx.AsyncClient(timeout=120.0) as http:
            resp = await http.get(
                decoded_url,
                headers={"X-API-Key": settings.CORESTACK_API_KEY},
                follow_redirects=True,
            )

            # GeoServer returns XML error pages with 200 status for missing coverages
            content_type = resp.headers.get("content-type", "")
            if "xml" in content_type.lower() or resp.status_code >= 400:
                # This coverage doesn't exist — not an error, just not available
                if resp.status_code == 404 or "xml" in content_type.lower():
                    raise HTTPException(
                        status_code=404,
                        detail="Coverage not found on GeoServer. This layer may not exist for this area/year.",
                    )
                resp.raise_for_status()

        return StreamingResponse(
            iter([resp.content]),
            media_type="image/tiff",
            headers={
                "Content-Disposition": "attachment; filename=layer.tiff",
                "Access-Control-Allow-Origin": "*",
            },
        )
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        logger.error("GeoServer download failed (%s): %s", e.response.status_code, e)
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"GeoServer returned {e.response.status_code}",
        )
    except Exception as e:
        logger.error("Raster download error: %s", e)
        raise HTTPException(status_code=502, detail=f"Failed to download raster: {e}")


@router.get("/check")
async def check_raster_availability(
    url: str = Query(..., description="GeoServer WCS URL to check"),
):
    """Check if a raster layer exists on GeoServer.

    Uses a GET request with a small byte range to verify availability
    without downloading the full raster.
    """
    decoded_url = unquote(url)

    if "geoserver.core-stack.org" not in decoded_url:
        raise HTTPException(status_code=403, detail="Only CoRE Stack URLs allowed.")

    try:
        async with httpx.AsyncClient(timeout=20.0) as http:
            resp = await http.get(
                decoded_url,
                headers={"Range": "bytes=0-100"},
                follow_redirects=True,
            )
            content_type = resp.headers.get("content-type", "")
            # GeoServer returns XML for errors, geotiff/octet-stream for success
            is_xml = "xml" in content_type.lower()
            is_tiff = "tiff" in content_type.lower() or "octet" in content_type.lower()
            available = resp.status_code in (200, 206) and (is_tiff or not is_xml)
            return {"available": available, "status_code": resp.status_code, "content_type": content_type}
    except Exception as e:
        logger.warning("Raster check failed: %s", e)
        return {"available": False, "status_code": 0}


@router.post("/tile-url")
async def get_tile_download_url(request_body: dict):
    """Return a GEE download URL for a tile bbox + fiscal year.

    The browser downloads and processes the TIFF itself using geotiff.js.
    No rasterio/GDAL needed — just GEE authentication forwarding.

    Request body:
        bbox: [minLng, minLat, maxLng, maxLat]
        fiscal_year: "2022-23"

    Response:
        { url, native_crs, pixel_size_m }
    """
    import asyncio

    bbox = request_body.get("bbox")
    fiscal_year = request_body.get("fiscal_year")

    if not bbox or not fiscal_year:
        raise HTTPException(status_code=400, detail="bbox and fiscal_year required")

    if len(bbox) != 4:
        raise HTTPException(status_code=400, detail="bbox must be [minLng, minLat, maxLng, maxLat]")

    # Parse fiscal year "2022-23" → (2022, 2023)
    parts = fiscal_year.replace("20", "").split("-")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail=f"Invalid fiscal_year format: {fiscal_year}")

    try:
        start_year = int("20" + parts[0])
        end_year = int("20" + parts[1])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid fiscal_year: {fiscal_year}")

    def _get_url():
        """Generate GEE download URL (runs in thread — ee library is synchronous)."""
        from app.services.gee_service import _init_ee, CORESTACK_LULC_ASSET
        _init_ee()

        import ee as _ee

        asset_path = CORESTACK_LULC_ASSET.format(start=start_year, end=end_year)
        image = _ee.Image(asset_path).select("predicted_label")

        # Create region geometry from bbox
        region = _ee.Geometry.Rectangle(bbox)

        # Get native CRS + transform
        proj_info = image.projection().getInfo()
        native_crs = proj_info.get("crs", "EPSG:4326")
        native_transform = proj_info.get("transform")

        # Build download params in native CRS (no reprojection = no resampling)
        download_params = {
            "region": region,
            "format": "GEO_TIFF",
        }
        if native_transform and native_crs != "EPSG:4326":
            download_params["crs"] = native_crs
            download_params["crsTransform"] = native_transform
        else:
            download_params["crs"] = native_crs
            download_params["scale"] = 10

        url = image.getDownloadURL(download_params)

        # Extract pixel size in meters from transform
        pixel_size_m = 10.0  # default IndiaSAT
        if native_transform:
            pixel_size_m = abs(native_transform[0])

        return url, native_crs, pixel_size_m

    try:
        url, native_crs, pixel_size_m = await asyncio.to_thread(_get_url)
        logger.info("Tile URL generated for %s bbox=%s CRS=%s", fiscal_year, bbox, native_crs)
        return {
            "url": url,
            "native_crs": native_crs,
            "pixel_size_m": pixel_size_m,
        }
    except Exception as e:
        logger.error("Tile URL generation failed for %s: %s", fiscal_year, e)
        raise HTTPException(status_code=502, detail=f"GEE tile URL generation failed: {e}")


@router.post("/extract")
async def extract_raster_pixels(request_body: dict):
    """Extract raw pixel data from IndiaSAT LULC v3 rasters via GEE.

    Primary: IndiaSAT LULC v3 (10m, native CRS) — same data as GeoServer.
    Fallback: MODIS LULC (500m) + JRC Water (30m) — rough global estimate.

    All statistics computation happens client-side in Pyodide (browser WASM).

    Returns per year:
      - histogram: {class_id: pixel_count}
      - masked_pixels: list of valid pixel values inside village boundary
      - pixel_area_ha: area per pixel in hectares (from native CRS resolution)
      - fiscal_year: year label
    """
    import asyncio

    village_geojson = request_body.get("village_geojson")
    if not village_geojson:
        raise HTTPException(status_code=400, detail="village_geojson required")

    # ── Primary: IndiaSAT LULC v3 (10m, high accuracy) ──
    try:
        from app.services.gee_service import fetch_corestack_lulc_all_years
        extracted, pxha = await asyncio.to_thread(
            fetch_corestack_lulc_all_years, village_geojson
        )
        if extracted:
            logger.info("GEE IndiaSAT extraction succeeded: %d years", len(extracted))
            return {
                "status": "ok",
                "data": extracted,
                "pixel_area_ha": pxha,
                "years_extracted": len(extracted),
                "source": "GEE IndiaSAT LULC v3 (native CRS, 10m)",
                "accuracy": "high",
            }
    except Exception as e:
        logger.warning("IndiaSAT extraction failed: %s", e)

    # ── Fallback: MODIS/JRC (500m/30m, rough estimate) ──
    logger.info("IndiaSAT unavailable — falling back to MODIS/JRC rough estimate")
    try:
        from app.services.gee_service import fetch_all as fetch_modis_all
        modis_data = await asyncio.to_thread(
            fetch_modis_all, village_geojson, 2017, 2024
        )
        if modis_data and modis_data.get("lulc"):
            logger.info("MODIS/JRC fallback succeeded: %d LULC years", len(modis_data["lulc"]))
            return {
                "status": "ok",
                "data": modis_data,
                "pixel_area_ha": 25.0,  # ~500m × 500m
                "years_extracted": len(modis_data.get("lulc", [])),
                "source": "MODIS MCD12Q1 (500m) + JRC Water (30m) — rough estimate",
                "accuracy": "low",
            }
    except Exception as modis_err:
        logger.error("MODIS/JRC fallback also failed: %s", modis_err)

    raise HTTPException(status_code=404, detail="No raster data could be extracted from any source")

@router.post("/analyze")
async def analyze_raster(request_body: dict):
    """Full village raster analytics — matches MWS vector output.

    Downloads LULC level 3 GeoTIFFs (contain ALL classes 1-12 incl. water+trees),
    uses windowed reading + geometry_mask for fast processing. Downloads are
    concurrent via asyncio.gather.

    Returns cropping intensity, surface water, vegetation, deforestation
    transitions, and cropping intensity change detection.
    """
    import tempfile, math, asyncio, os

    try:
        import rasterio
        from rasterio.windows import from_bounds, Window
        from rasterio.features import geometry_mask
        from shapely.geometry import shape, mapping
        import numpy as np
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Missing dependency: {e}")

    settings = get_settings()
    village_geojson = request_body.get("village_geojson")
    layers = request_body.get("layers", [])

    if not village_geojson or not layers:
        raise HTTPException(status_code=400, detail="village_geojson and layers are required")

    geom = shape(village_geojson)
    centroid_lat = geom.centroid.y

    # Pixel area in hectares
    def pixel_area_ha(res_deg):
        lat_rad = math.radians(centroid_lat)
        m_lat = 111_132.92 - 559.82 * math.cos(2 * lat_rad)
        m_lon = 111_412.84 * math.cos(lat_rad)
        return (res_deg * m_lat) * (res_deg * m_lon) / 10_000

    # Transition labels for deforestation: map specific crop classes → generic
    TRANSITION_LABELS = {
        1: "Built Up", 2: "Kharif Water", 3: "Kharif+Rabi Water",
        4: "Perennial Water", 6: "Forest", 7: "Barren",
        8: "Farm", 9: "Farm", 10: "Farm", 11: "Farm",
        12: "Scrub Land",
    }

    # ── Step 1: Download all rasters concurrently ──
    failed_downloads = []  # Track failed downloads for diagnostics

    async def download_one(layer_info):
        url = layer_info.get("url", "")
        fy = layer_info.get("fiscal_year", "unknown")
        cat = layer_info.get("category", "lulc")
        dl_key = f"{cat}__{fy}"  # Unique key per category+year
        if "geoserver.core-stack.org" not in url:
            return dl_key, cat, fy, None
        try:
            async with httpx.AsyncClient(timeout=120.0) as http:
                resp = await http.get(
                    url,
                    headers={"X-API-Key": settings.CORESTACK_API_KEY},
                    follow_redirects=True,
                )
                ct = resp.headers.get("content-type", "")
                if "xml" in ct.lower() or resp.status_code >= 400:
                    logger.info("Layer %s %s not available (HTTP %s, ct=%s)", cat, fy, resp.status_code, ct)
                    failed_downloads.append({"category": cat, "fiscal_year": fy, "reason": f"HTTP {resp.status_code}, content-type={ct}", "url": url})
                    return dl_key, cat, fy, None
                logger.info("Downloaded %s %s: %d bytes", cat, fy, len(resp.content))
                return dl_key, cat, fy, resp.content
        except Exception as e:
            logger.warning("Download failed for %s %s: %s", cat, fy, e)
            failed_downloads.append({"category": cat, "fiscal_year": fy, "reason": str(e), "url": url})
            return dl_key, cat, fy, None

    logger.info("Starting concurrent download of %d layers...", len(layers))
    results = await asyncio.gather(*[download_one(l) for l in layers])

    # Separate downloads by category (only LULC rasters — water comes from vector API)
    lulc_downloads = {}   # fiscal_year → bytes
    for dl_key, cat, fy, data in results:
        if data is None:
            continue
        if cat != "surface_water":
            lulc_downloads[fy] = data

    logger.info("Downloaded %d LULC layers", len(lulc_downloads))

    if not lulc_downloads:
        raise HTTPException(status_code=404, detail="No raster layers could be downloaded")

    # ── Step 3: Process LULC rasters → cropping + vegetation ──
    cropping_results = []
    vegetation_data = []
    raw_histograms = {}
    masked_arrays = {}  # Store for change detection

    pxha = None  # Will be set from first raster

    def process_raster(raw_bytes, geom_shape):
        """Process a GeoTIFF → histogram + masked array. Returns (histogram, masked, pxha) or None."""
        nonlocal pxha
        with tempfile.NamedTemporaryFile(suffix=".tiff", delete=True) as tmp:
            tmp.write(raw_bytes)
            tmp.flush()
            with rasterio.open(tmp.name) as src:
                if pxha is None:
                    pxha = pixel_area_ha(src.res[0])
                vb = geom_shape.bounds
                try:
                    win = from_bounds(vb[0], vb[1], vb[2], vb[3], src.transform)
                    win = win.intersection(Window(0, 0, src.width, src.height))
                    if win.width <= 0 or win.height <= 0:
                        return None
                except Exception:
                    return None
                data = src.read(1, window=win)
                win_tf = src.window_transform(win)
                pmask = geometry_mask(
                    [mapping(geom_shape)], out_shape=data.shape,
                    transform=win_tf, invert=True,
                )
                masked = np.where(pmask & ~np.isnan(data), data, np.nan)
                valid = masked[~np.isnan(masked)]
                if len(valid) == 0:
                    return None
                histogram = {}
                for v in np.unique(valid):
                    histogram[int(v)] = int(np.sum(valid == v))
                return histogram, masked, pxha

    for fiscal_year in sorted(lulc_downloads.keys()):
        try:
            result = process_raster(lulc_downloads[fiscal_year], geom)
            if result is None:
                continue
            histogram, masked, px = result
            raw_histograms[fiscal_year] = histogram
            masked_arrays[fiscal_year] = masked

            logger.info("  LULC %s: %s", fiscal_year, histogram)

            # Extract cropping metrics
            single_k = histogram.get(8, 0) * px
            single_nk = histogram.get(9, 0) * px
            double = histogram.get(10, 0) * px
            triple = histogram.get(11, 0) * px
            single = single_k + single_nk
            trees = histogram.get(6, 0) * px
            total_crop = single + double + triple

            # Standard Cropping Intensity = GCA / NSA
            # GCA (Gross Cropped Area) = single*1 + double*2 + triple*3
            # NSA (Net Sown Area) = total cropped pixels
            gca = single + double * 2 + triple * 3
            intensity_idx = round(gca / total_crop, 3) if total_crop > 0 else 0

            cropping_results.append({
                "fiscal_year": fiscal_year,
                "single_crop_ha": round(single, 2),
                "double_crop_ha": round(double, 2),
                "triple_crop_ha": round(triple, 2),
                "total_cropped_ha": round(total_crop, 2),
                "intensity_index": intensity_idx,
                "trees_ha": round(trees, 2),
            })

            # Vegetation
            vegetation_data.append({
                "fiscal_year": fiscal_year,
                "tree_cover_ha": round(trees, 2),
            })

        except Exception as e:
            logger.warning("Failed to process LULC %s: %s", fiscal_year, e)
            import traceback
            traceback.print_exc()

    # ── Step 4: Surface water from tehsil vector API ──
    # Surface water does NOT exist as raster on CoRE Stack GeoServer.
    # It's a vector layer (workspace: swb). We fetch from the same tehsil
    # API that the MWS/Server path uses (surfaceWaterBodies_annual).
    water_results = []
    water_source = "none"
    try:
        from app.services.corestack_client import corestack_client
        from app.services.mws_intersection_service import mws_service

        # Extract admin params from request
        state = request_body.get("state", "")
        district_name = request_body.get("district", "")
        tehsil_name = request_body.get("tehsil", "")

        if state and district_name and tehsil_name:
            # Fetch MWS geometries and compute intersections with village
            mws_features = await corestack_client.get_mws_features_for_tehsil(
                state, district_name, tehsil_name
            )
            intersections = mws_service.compute_intersections(village_geojson, mws_features)

            if intersections:
                # Fetch tehsil data containing surfaceWaterBodies_annual
                raw_tehsil = await corestack_client.get_tehsil_data(
                    state, district_name, tehsil_name
                )
                layer_data = raw_tehsil
                if isinstance(raw_tehsil, dict):
                    layer_data = raw_tehsil.get("data", raw_tehsil)

                # Build UID → record lookup for surface water
                water_records = layer_data.get("surfaceWaterBodies_annual", []) if isinstance(layer_data, dict) else []
                water_by_uid = {}
                for rec in (water_records if isinstance(water_records, list) else []):
                    if isinstance(rec, dict):
                        uid = str(rec.get("uid") or rec.get("mws_uid") or rec.get("UID", ""))
                        if uid:
                            water_by_uid[uid] = rec

                logger.info("Surface water (vector): %d MWS records, %d intersections",
                            len(water_by_uid), len(intersections))

                # Aggregate per fiscal year (matching MWS path logic)
                for fy_start, fy_end in FISCAL_YEARS:
                    fy = f"20{fy_start}-20{fy_end}"
                    fiscal_year = f"{fy_start}-{fy_end}"
                    kharif = mws_service.aggregate_mws_metric(
                        intersections, water_by_uid,
                        f"kharif_area_in_ha_{fy}", "weighted_sum",
                    )
                    rabi = mws_service.aggregate_mws_metric(
                        intersections, water_by_uid,
                        f"rabi_area_in_ha_{fy}", "weighted_sum",
                    )
                    zaid = mws_service.aggregate_mws_metric(
                        intersections, water_by_uid,
                        f"zaid_area_in_ha_{fy}", "weighted_sum",
                    )
                    total = mws_service.aggregate_mws_metric(
                        intersections, water_by_uid,
                        f"total_area_in_ha_{fy}", "weighted_sum",
                    )
                    water_results.append({
                        "fiscal_year": fiscal_year,
                        "kharif_ha": round(kharif or 0.0, 2),
                        "rabi_ha": round(rabi or 0.0, 2),
                        "zaid_ha": round(zaid or 0.0, 2),
                        "total_water_ha": round(
                            (total or 0.0) if total else
                            (kharif or 0) + (rabi or 0) + (zaid or 0), 2
                        ),
                    })
                water_source = "tehsil_vector_api"
            else:
                logger.warning("No MWS intersections for water aggregation")
        else:
            logger.warning("Missing admin params for water vector fetch: state=%s, district=%s, tehsil=%s",
                           state, district_name, tehsil_name)
    except Exception as e:
        logger.warning("Surface water vector fetch failed: %s", e)
        import traceback
        traceback.print_exc()

    # ── Step 3: Vegetation & Deforestation Analysis ──
    vegetation_analysis = {}
    if len(masked_arrays) >= 2:
        sorted_years = sorted(masked_arrays.keys())
        year_a, year_b = sorted_years[0], sorted_years[-1]
        arr_a, arr_b = masked_arrays[year_a], masked_arrays[year_b]

        # Align shapes
        min_r = min(arr_a.shape[0], arr_b.shape[0])
        min_c = min(arr_a.shape[1], arr_b.shape[1])
        a, b = arr_a[:min_r, :min_c], arr_b[:min_r, :min_c]
        valid_both = ~np.isnan(a) & ~np.isnan(b)

        tree_a = (a == 6) & valid_both
        tree_b = (b == 6) & valid_both
        tree_ha_a = round(int(np.sum(tree_a)) * pxha, 2)
        tree_ha_b = round(int(np.sum(tree_b)) * pxha, 2)

        # Deforestation transitions: tree → other
        lost = tree_a & (b != 6)
        lost_vals = b[lost]
        transitions = []
        degraded_total = 0.0
        for cls in np.unique(lost_vals):
            if np.isnan(cls):
                continue
            cls_int = int(cls)
            area = round(int(np.sum(lost_vals == cls)) * pxha, 2)
            t_label = TRANSITION_LABELS.get(cls_int, f"Class {cls_int}")
            # Merge duplicate labels (e.g., multiple crop classes → "Farm")
            existing = next((t for t in transitions if t["to_label"] == t_label), None)
            if existing:
                existing["area_ha"] = round(existing["area_ha"] + area, 2)
            else:
                transitions.append({
                    "from_class": "Forest",
                    "to_label": t_label,
                    "to_class": cls_int,
                    "area_ha": area,
                })
            degraded_total += area

        # Afforestation: non-tree → tree
        gained = ~tree_a & tree_b & valid_both
        afforestation = round(int(np.sum(gained)) * pxha, 2)

        # Add the "Forest → Forest" retention row
        retained = tree_a & tree_b
        retained_ha = round(int(np.sum(retained)) * pxha, 2)
        transitions.insert(0, {
            "from_class": "Forest", "to_label": "Forest",
            "to_class": 6, "area_ha": retained_ha,
        })
        transitions.sort(key=lambda x: x["area_ha"], reverse=True)

        vegetation_analysis = {
            "start_year": year_a,
            "end_year": year_b,
            "tree_cover_start_ha": tree_ha_a,
            "tree_cover_end_ha": tree_ha_b,
            "net_change_ha": round(tree_ha_b - tree_ha_a, 2),
            "afforestation_ha": afforestation,
            "deforestation_ha": round(degraded_total, 2),
            "degraded_land_ha": round(degraded_total, 2),
            "transitions": transitions,
        }

    # ── Step 4: Cropping Intensity Change Detection ──
    crop_intensity_change = []
    if len(masked_arrays) >= 2:
        sorted_years = sorted(masked_arrays.keys())
        year_a, year_b = sorted_years[0], sorted_years[-1]
        a, b = masked_arrays[year_a], masked_arrays[year_b]
        min_r = min(a.shape[0], b.shape[0])
        min_c = min(a.shape[1], b.shape[1])
        a, b = a[:min_r, :min_c], b[:min_r, :min_c]
        valid_both = ~np.isnan(a) & ~np.isnan(b)

        def crop_level(arr):
            out = np.full_like(arr, 0, dtype=np.int8)
            out[(arr == 8) | (arr == 9)] = 1  # Single
            out[arr == 10] = 2                 # Double
            out[arr == 11] = 3                 # Triple
            return out

        lev_a, lev_b = crop_level(a), crop_level(b)
        LEVEL_NAMES = {0: "Non-Crop", 1: "Single", 2: "Double", 3: "Triple"}

        total_upgrade = 0
        for fl in range(1, 4):  # Skip Non-Crop (0) rows
            for tl in range(1, 4):
                count = int(np.sum((lev_a == fl) & (lev_b == tl) & valid_both))
                if count == 0:
                    continue
                label = f"{LEVEL_NAMES[fl]} To {LEVEL_NAMES[tl]}"
                area = round(count * pxha, 2)
                crop_intensity_change.append({"category": label, "area_ha": area})
                if tl > fl:
                    total_upgrade += area

        crop_intensity_change.sort(key=lambda x: x["area_ha"], reverse=True)
        crop_intensity_change.insert(0, {
            "category": "Total Change CropIntensity",
            "area_ha": round(total_upgrade, 2),
        })

    return {
        "status": "ok",
        "cropping_intensity": sorted(cropping_results, key=lambda x: x["fiscal_year"]),
        "surface_water": sorted(water_results, key=lambda x: x["fiscal_year"]),
        "vegetation": sorted(vegetation_data, key=lambda x: x["fiscal_year"]),
        "vegetation_analysis": vegetation_analysis,
        "crop_intensity_change": crop_intensity_change,
        "raw_histograms": raw_histograms,
        "data_source": "CoRE Stack Raster (10m)",
        "processing": "Server-side zonal statistics (rasterio/GDAL)",
        "_debug": {
            "lulc_downloads": len(lulc_downloads),
            "water_source": water_source,
            "water_records": len(water_results),
            "failed_downloads": failed_downloads,
        },
    }
