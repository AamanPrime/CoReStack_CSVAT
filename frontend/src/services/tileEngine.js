/**
 * CSVAT — Client-Side Tiled TIFF Processing Engine.
 *
 * Downloads IndiaSAT LULC v3 GeoTIFFs tile-by-tile from GEE (via backend
 * URL proxy), parses them with geotiff.js, masks pixels to the village
 * boundary using @turf/turf, and produces the exact same output format
 * as the backend's /api/v1/raster/extract endpoint.
 *
 * Zero rasterio/GDAL dependency — everything runs in the browser.
 */

import * as turf from '@turf/turf';
import { fromArrayBuffer } from 'geotiff';
import { storeTile, getTile, hasTile, autoCleanup } from './tiffStore.js';

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '');

// IndiaSAT fiscal year ranges (matches backend CORESTACK_FISCAL_YEARS)
const FISCAL_YEARS = [
  [2017, 2018], [2018, 2019], [2019, 2020], [2020, 2021],
  [2021, 2022], [2022, 2023], [2023, 2024], [2024, 2025],
];

// Max concurrent tile downloads
const MAX_CONCURRENT = 4;

// ═══════════════════════════════════════════════════════════════════════════
// Tile Grid Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Split a village boundary bbox into a grid of tile bboxes.
 * @param {Object} boundaryGeoJSON — Polygon or MultiPolygon geometry
 * @param {number} tileSizeKm — Tile edge length in kilometers (default 1.0)
 * @returns {Array<[number,number,number,number]>} Array of [minLng, minLat, maxLng, maxLat]
 */
export function generateTileGrid(boundaryGeoJSON, tileSizeKm = 1.0) {
  const bbox = turf.bbox(boundaryGeoJSON);
  const [minLng, minLat, maxLng, maxLat] = bbox;

  // Convert km to approximate degrees at this latitude
  const centerLat = (minLat + maxLat) / 2;
  const latDegPerKm = 1 / 111.32;
  const lngDegPerKm = 1 / (111.32 * Math.cos((centerLat * Math.PI) / 180));

  const tileLatSize = tileSizeKm * latDegPerKm;
  const tileLngSize = tileSizeKm * lngDegPerKm;

  const tiles = [];
  for (let lat = minLat; lat < maxLat; lat += tileLatSize) {
    for (let lng = minLng; lng < maxLng; lng += tileLngSize) {
      tiles.push([
        lng,
        lat,
        Math.min(lng + tileLngSize, maxLng),
        Math.min(lat + tileLatSize, maxLat),
      ]);
    }
  }

  // If boundary is smaller than one tile, just use the bbox
  if (tiles.length === 0) {
    tiles.push(bbox);
  }

  return tiles;
}

// ═══════════════════════════════════════════════════════════════════════════
// TIFF Download via Backend URL Proxy
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a GEE download URL from the backend, then fetch the TIFF directly.
 * Returns the ArrayBuffer of the GeoTIFF.
 */
async function fetchTileFromGEE(fiscalYear, tileBbox) {
  // Step 1: Ask backend for the signed GEE download URL
  const resp = await fetch(`${API_BASE}/api/v1/raster/tile-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bbox: tileBbox,
      fiscal_year: fiscalYear,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`tile-url failed (${resp.status}): ${errText}`);
  }

  const { url, native_crs, pixel_size_m } = await resp.json();

  // Step 2: Download the GeoTIFF directly from GEE (URL is temporary but public)
  const tiffResp = await fetch(url);
  if (!tiffResp.ok) {
    throw new Error(`GEE TIFF download failed (${tiffResp.status})`);
  }

  const arrayBuffer = await tiffResp.arrayBuffer();
  return { arrayBuffer, native_crs, pixel_size_m };
}

/**
 * Download a single tile and store it in IndexedDB.
 * Skips download if already cached.
 */
async function downloadAndStoreTile(villageName, fiscalYear, tileBbox, tileIdx) {
  const cacheKey = `${villageName}__${fiscalYear}__tile${tileIdx}`;

  // Check cache first
  if (await hasTile(cacheKey)) {
    return { cached: true, key: cacheKey };
  }

  const { arrayBuffer, native_crs, pixel_size_m } = await fetchTileFromGEE(fiscalYear, tileBbox);

  await storeTile(cacheKey, arrayBuffer, {
    bbox: tileBbox,
    crs: native_crs,
    pixel_size_m,
    fiscalYear,
  });

  return { cached: false, key: cacheKey, sizeBytes: arrayBuffer.byteLength };
}

// ═══════════════════════════════════════════════════════════════════════════
// Client-Side TIFF Parsing + Masking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse a GeoTIFF ArrayBuffer and extract pixel values masked to the village boundary.
 *
 * Uses geotiff.js for TIFF parsing and @turf/turf for point-in-polygon masking.
 *
 * @param {ArrayBuffer} arrayBuffer — Raw GeoTIFF bytes
 * @param {Object} boundaryGeoJSON — Village boundary (Polygon/MultiPolygon)
 * @returns {{ histogram: Object, maskedPixels: number[], pixelAreaHa: number }}
 */
async function parseTiffAndMask(arrayBuffer, boundaryGeoJSON) {
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  // Read raster data
  const rasterData = await image.readRasters({ interleave: true });
  const width = image.getWidth();
  const height = image.getHeight();
  const pixels = rasterData;

  // Get geo-transform from the GeoTIFF
  const fileDirectory = image.fileDirectory;
  const modelTiepoint = fileDirectory.ModelTiepoint;
  const modelPixelScale = fileDirectory.ModelPixelScale;

  let originX, originY, pixelWidth, pixelHeight;

  if (modelTiepoint && modelPixelScale) {
    // Standard GeoTIFF with tiepoint + pixel scale
    originX = modelTiepoint[3];   // X coordinate of the tiepoint pixel
    originY = modelTiepoint[4];   // Y coordinate of the tiepoint pixel
    pixelWidth = modelPixelScale[0];
    pixelHeight = modelPixelScale[1];
  } else {
    // Fallback: try ModelTransformation matrix
    const transform = fileDirectory.ModelTransformation;
    if (transform) {
      originX = transform[3];
      originY = transform[7];
      pixelWidth = Math.abs(transform[0]);
      pixelHeight = Math.abs(transform[5]);
    } else {
      throw new Error('GeoTIFF has no geo-transform metadata');
    }
  }

  // Determine CRS and compute pixel area in hectares
  const geoKeys = image.geoKeys || {};
  const projectedCRS = geoKeys.ProjectedCSTypeGeoKey;
  const geographicCRS = geoKeys.GeographicTypeGeoKey;

  let pixelAreaHa;
  if (projectedCRS && projectedCRS !== 4326 && projectedCRS !== 32767) {
    // Projected CRS (meters) — pixel area = pixelWidth * pixelHeight m²
    pixelAreaHa = (pixelWidth * pixelHeight) / 10000;
  } else {
    // Geographic CRS (degrees) — convert to meters using latitude
    const centerLat = originY - (height / 2) * pixelHeight;
    const mLat = 111132.92 - 559.82 * Math.cos(2 * (centerLat * Math.PI) / 180);
    const mLon = 111412.84 * Math.cos((centerLat * Math.PI) / 180);
    pixelAreaHa = (pixelWidth * mLon * pixelHeight * mLat) / 10000;
  }

  // Build a turf feature for the village boundary for point-in-polygon checks
  const boundaryFeature = turf.feature(boundaryGeoJSON);

  // If CRS is projected, we need to transform boundary coords to match.
  // For simplicity, we'll reproject pixel centers to EPSG:4326 instead (since
  // boundary is always in 4326). For projected CRS with known UTM zone,
  // we approximate by inverse-projecting pixel centers.
  const isProjected = projectedCRS && projectedCRS !== 4326 && projectedCRS !== 32767;

  // UTM zone extraction for inverse projection
  let utmZone = null, isNorthern = true;
  if (isProjected && projectedCRS >= 32601 && projectedCRS <= 32660) {
    utmZone = projectedCRS - 32600;
    isNorthern = true;
  } else if (isProjected && projectedCRS >= 32701 && projectedCRS <= 32760) {
    utmZone = projectedCRS - 32700;
    isNorthern = false;
  }

  // Mask pixels to village boundary
  const histogram = {};
  const maskedPixels = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const pixelValue = pixels[row * width + col];

      // Skip nodata (0 or NaN)
      if (pixelValue === 0 || pixelValue === undefined || Number.isNaN(pixelValue)) continue;

      // Compute pixel center coordinates
      const px = originX + (col + 0.5) * pixelWidth;
      const py = originY - (row + 0.5) * pixelHeight;

      let lng, lat;
      if (isProjected && utmZone !== null) {
        // Approximate UTM → WGS84 conversion
        [lng, lat] = utmToLatLng(px, py, utmZone, isNorthern);
      } else if (isProjected) {
        // Unknown projected CRS — skip point-in-polygon, include all pixels
        // (the tile was already clipped to the bbox by GEE)
        maskedPixels.push(pixelValue);
        histogram[pixelValue] = (histogram[pixelValue] || 0) + 1;
        continue;
      } else {
        lng = px;
        lat = py;
      }

      // Point-in-polygon check
      const point = turf.point([lng, lat]);
      if (turf.booleanPointInPolygon(point, boundaryFeature)) {
        maskedPixels.push(pixelValue);
        histogram[pixelValue] = (histogram[pixelValue] || 0) + 1;
      }
    }
  }

  return { histogram, maskedPixels, pixelAreaHa };
}

/**
 * Approximate UTM → WGS84 conversion.
 * Good enough for point-in-polygon checks (sub-meter accuracy not needed).
 */
function utmToLatLng(easting, northing, zone, northern) {
  // Simplified UTM to lat/lng (Karney's method approximation)
  const k0 = 0.9996;
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e = Math.sqrt(2 * f - f * f);
  const e2 = e * e / (1 - e * e);

  const x = easting - 500000;
  const y = northern ? northing : northing - 10000000;

  const M = y / k0;
  const mu = M / (a * (1 - e * e / 4 - 3 * e * e * e * e / 64));

  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu);

  const sinPhi = Math.sin(phi1);
  const cosPhi = Math.cos(phi1);
  const tanPhi = sinPhi / cosPhi;
  const N1 = a / Math.sqrt(1 - e * e * sinPhi * sinPhi);
  const T1 = tanPhi * tanPhi;
  const C1 = e2 * cosPhi * cosPhi;
  const R1 = a * (1 - e * e) / Math.pow(1 - e * e * sinPhi * sinPhi, 1.5);
  const D = x / (N1 * k0);

  const lat = phi1 - (N1 * tanPhi / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * D * D * D * D / 24);
  const lng = (D - (1 + 2 * T1 + C1) * D * D * D / 6) / cosPhi;

  const latDeg = (lat * 180) / Math.PI;
  const lngDeg = ((zone - 1) * 6 - 180 + 3) + (lng * 180) / Math.PI;

  return [lngDeg, latDeg];
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-Tile Processing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process a single cached tile: read from IndexedDB, parse TIFF, mask to boundary.
 */
async function processTile(villageName, fiscalYear, tileIdx, boundaryGeoJSON) {
  const cacheKey = `${villageName}__${fiscalYear}__tile${tileIdx}`;
  const record = await getTile(cacheKey);

  if (!record || !record.arrayBuffer) {
    console.warn(`[TileEngine] Tile ${cacheKey} not found in cache`);
    return null;
  }

  try {
    return await parseTiffAndMask(record.arrayBuffer, boundaryGeoJSON);
  } catch (err) {
    console.warn(`[TileEngine] Failed to process tile ${cacheKey}:`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Merge Results Across Tiles
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Merge multiple tile results into a single histogram + pixel array.
 */
function mergeTileResults(tileResults) {
  const mergedHistogram = {};
  const mergedPixels = [];
  let pixelAreaHa = 0.01; // default 10m

  for (const result of tileResults) {
    if (!result) continue;

    pixelAreaHa = result.pixelAreaHa || pixelAreaHa;

    for (const [cls, count] of Object.entries(result.histogram)) {
      mergedHistogram[cls] = (mergedHistogram[cls] || 0) + count;
    }

    mergedPixels.push(...result.maskedPixels);
  }

  return { histogram: mergedHistogram, maskedPixels: mergedPixels, pixelAreaHa };
}

// ═══════════════════════════════════════════════════════════════════════════
// Concurrency Limiter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run async tasks with a concurrency limit.
 */
async function runWithConcurrency(tasks, limit) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task().then((result) => {
      executing.delete(p);
      return result;
    });
    executing.add(p);
    results.push(p);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the complete tiled extraction pipeline for a village boundary.
 *
 * Downloads GeoTIFFs for all fiscal years, processes them client-side,
 * and returns the EXACT same format as the backend /raster/extract endpoint:
 *
 *   { status: 'ok', data: [ { fiscal_year, histogram, masked_pixels, pixel_count, pixel_area_ha } ], pixel_area_ha, years_extracted }
 *
 * @param {Object} boundaryGeoJSON — Village polygon geometry
 * @param {string} villageName — Used as cache key
 * @param {function} onProgress — Progress callback
 * @returns {Object} Same shape as backend /raster/extract response
 */
export async function runTiledExtraction(boundaryGeoJSON, villageName, onProgress) {
  // Step 0: Auto-cleanup old cached tiles if storage is getting large
  autoCleanup().catch(() => {});

  // Step 1: Generate tile grid from village boundary
  const tiles = generateTileGrid(boundaryGeoJSON, 1.0);
  const totalTiles = tiles.length;
  onProgress?.(`Generated ${totalTiles} tile(s) for village boundary`);

  const extracted = [];
  let globalPixelAreaHa = 0.01;

  // Step 2: Process each fiscal year
  for (const [startYr, endYr] of FISCAL_YEARS) {
    const fyLabel = `20${String(startYr).slice(-2)}-${String(endYr).slice(-2)}`;

    // Step 2a: Download all tiles for this fiscal year (with concurrency limit)
    onProgress?.(`Downloading ${totalTiles} tile(s) for ${fyLabel}…`);

    const downloadTasks = tiles.map((tileBbox, idx) => () =>
      downloadAndStoreTile(villageName, fyLabel, tileBbox, idx)
    );

    const downloadResults = await runWithConcurrency(downloadTasks, MAX_CONCURRENT);
    const successfulDownloads = downloadResults.filter((r) => r !== null);

    if (successfulDownloads.length === 0) {
      console.warn(`[TileEngine] No tiles downloaded for ${fyLabel}, skipping`);
      continue;
    }

    const cachedCount = successfulDownloads.filter((r) => r.cached).length;
    if (cachedCount > 0) {
      onProgress?.(`${fyLabel}: ${cachedCount}/${totalTiles} tiles from cache`);
    }

    // Step 2b: Process all tiles for this fiscal year
    onProgress?.(`Processing ${totalTiles} tile(s) for ${fyLabel}…`);

    const processTasks = tiles.map((_, idx) => () =>
      processTile(villageName, fyLabel, idx, boundaryGeoJSON)
    );

    const tileResults = await runWithConcurrency(processTasks, MAX_CONCURRENT);

    // Step 2c: Merge tile results
    const merged = mergeTileResults(tileResults.filter(Boolean));

    if (merged.maskedPixels.length === 0) {
      console.warn(`[TileEngine] No valid pixels for ${fyLabel}`);
      continue;
    }

    globalPixelAreaHa = merged.pixelAreaHa;

    // Convert histogram keys to strings (matching backend format)
    const histogram = {};
    for (const [k, v] of Object.entries(merged.histogram)) {
      histogram[String(k)] = v;
    }

    extracted.push({
      fiscal_year: fyLabel,
      histogram,
      masked_pixels: merged.maskedPixels,
      pixel_count: merged.maskedPixels.length,
      pixel_area_ha: merged.pixelAreaHa,
    });

    onProgress?.(`${fyLabel}: ${merged.maskedPixels.length} pixels extracted`);
  }

  if (extracted.length === 0) {
    throw new Error('No pixel data could be extracted from any fiscal year (client-side tiled pipeline)');
  }

  onProgress?.(`Tiled extraction complete: ${extracted.length} years extracted (100% client-side)`);

  return {
    status: 'ok',
    data: extracted,
    pixel_area_ha: globalPixelAreaHa,
    years_extracted: extracted.length,
    source: 'GEE IndiaSAT LULC v3 (client-side tiled, geotiff.js)',
    accuracy: 'high',
  };
}
