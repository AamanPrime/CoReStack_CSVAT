/**
 * CSVAT — Client-Side Tiled TIFF Processing Engine.
 *
 * 100% browser-side pipeline:
 *   1. Split village boundary into spatial tiles (~1 km²)
 *   2. Download GeoTIFF per tile via backend URL signer (GEE auth only)
 *   3. Store raw TIFF bytes in IndexedDB (persistent cache)
 *   4. Parse TIFF with geotiff.js, mask to village boundary
 *   5. Merge histograms + pixel arrays across all tiles
 *   6. Feed into existing Pyodide analytics (unchanged)
 *
 * The backend NEVER touches TIFF data — it only signs GEE download URLs.
 *
 * KEY DESIGN: TIFF is downloaded in EPSG:4326 (same CRS as village boundary
 * GeoJSON). This eliminates all CRS reprojection in the browser. The affine
 * transform is computed from the KNOWN bbox + image dimensions.
 */

import { fromArrayBuffer } from 'geotiff';
import * as turf from '@turf/turf';
import {
  tileKey, storeTile, getTile, hasTile, clearVillageTiles,
} from './tiffStore';

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '');

// Fiscal year ranges matching CoRE Stack IndiaSAT LULC v3 assets
const FISCAL_YEARS = [
  [2017, 2018], [2018, 2019], [2019, 2020], [2020, 2021],
  [2021, 2022], [2022, 2023], [2023, 2024], [2024, 2025],
];

// Max concurrent tile downloads
const MAX_CONCURRENT = 4;

// ─── Tile Grid Generation ───

/**
 * Split a village boundary bbox into a grid of tiles.
 * Returns array of { bbox: [minLng, minLat, maxLng, maxLat], idx }.
 *
 * tileSizeKm ≈ 1 km gives ~4-16 tiles for typical Indian villages (100-2000 ha).
 * Small villages (< 1 km²) get exactly 1 tile — no overhead.
 */
function generateTileGrid(boundaryGeojson, tileSizeKm = 1.0) {
  const feature = turf.feature(boundaryGeojson);
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(feature);

  // Convert km to approximate degrees at this latitude
  const latMid = (minLat + maxLat) / 2;
  const degPerKmLat = 1 / 111.0;
  const degPerKmLng = 1 / (111.0 * Math.cos((latMid * Math.PI) / 180));

  const stepLat = tileSizeKm * degPerKmLat;
  const stepLng = tileSizeKm * degPerKmLng;

  const tiles = [];
  let idx = 0;

  for (let lat = minLat; lat < maxLat; lat += stepLat) {
    for (let lng = minLng; lng < maxLng; lng += stepLng) {
      tiles.push({
        bbox: [
          lng,
          lat,
          Math.min(lng + stepLng, maxLng),
          Math.min(lat + stepLat, maxLat),
        ],
        idx: idx++,
      });
    }
  }

  // Ensure at least 1 tile for very small villages
  if (tiles.length === 0) {
    tiles.push({ bbox: [minLng, minLat, maxLng, maxLat], idx: 0 });
  }

  return tiles;
}

// ─── TIFF Download (via backend GEE URL signer) ───

/**
 * Get a signed GEE download URL for a specific tile bbox + fiscal year.
 * Backend only does GEE auth — no rasterio, no file storage.
 * Returns { url, bbox, fiscal_year }.
 */
async function fetchTileDownloadUrl(tileBbox, startYear, endYear) {
  const resp = await fetch(`${API_BASE}/api/v1/raster/tile-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bbox: tileBbox,
      start_year: startYear,
      end_year: endYear,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Tile URL fetch failed (${resp.status}): ${errText}`);
  }

  return await resp.json();
}

/**
 * Download a GeoTIFF from a signed URL → ArrayBuffer.
 */
async function downloadTiff(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`TIFF download failed: ${resp.status}`);
  return await resp.arrayBuffer();
}

// ─── Client-Side TIFF Parsing ───

/**
 * Parse a GeoTIFF ArrayBuffer using the KNOWN bbox to compute the affine.
 *
 * Since we request EPSG:4326 from GEE, coordinates are in degrees (lng/lat).
 * We KNOW the bbox we requested, so we compute the transform from:
 *   originX = minLng,  originY = maxLat (top-left)
 *   pixelWidth = (maxLng - minLng) / width
 *   pixelHeight = -(maxLat - minLat) / height  (negative = north-up)
 *
 * This is MORE RELIABLE than parsing GeoTIFF metadata tags, which can
 * vary between GEE export formats.
 */
async function parseTiff(arrayBuffer, tileBbox) {
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const [data] = await image.readRasters({ interleave: false });

  // Compute affine transform from KNOWN bbox + image dimensions
  const [minLng, minLat, maxLng, maxLat] = tileBbox;
  const originX = minLng;
  const originY = maxLat;  // top-left corner
  const pixelWidth = (maxLng - minLng) / width;
  const pixelHeight = -(maxLat - minLat) / height;  // negative = north-up

  // Pixel area in hectares (EPSG:4326 → degrees, convert to meters)
  const midLat = (minLat + maxLat) / 2;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * (midLat * Math.PI / 180));
  const mLon = 111412.84 * Math.cos(midLat * Math.PI / 180);
  const pixelAreaHa = Math.abs(pixelWidth * mLon) * Math.abs(pixelHeight * mLat) / 10000;

  console.log(`[TileEngine] TIFF ${width}×${height}, bbox=[${minLng.toFixed(4)},${minLat.toFixed(4)},${maxLng.toFixed(4)},${maxLat.toFixed(4)}], pxArea=${pixelAreaHa.toFixed(6)} ha`);

  return {
    data: new Float32Array(data),
    width, height,
    originX, originY,
    pixelWidth, pixelHeight,
    pixelAreaHa,
  };
}

// ─── Client-Side Masking ───

/**
 * Mask raster pixels to a village boundary polygon.
 * Returns { histogram: {cls: count}, maskedPixels: number[] }.
 *
 * Since both the raster (EPSG:4326) and the village boundary (GeoJSON)
 * are in the same coordinate system, point-in-polygon works directly.
 *
 * This is equivalent to what rasterio's geometry_mask() does,
 * but in the browser using turf.booleanPointInPolygon.
 */
function maskToPolygon(raster, boundaryGeojson) {
  const { data, width, height, originX, originY, pixelWidth, pixelHeight } = raster;

  const polygon = turf.feature(boundaryGeojson);

  const histogram = {};
  const maskedPixels = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const pixelVal = data[row * width + col];

      // Skip nodata (0 or NaN)
      if (pixelVal === 0 || isNaN(pixelVal)) continue;

      // Pixel center in EPSG:4326 (lng, lat)
      const lng = originX + (col + 0.5) * pixelWidth;
      const lat = originY + (row + 0.5) * pixelHeight;

      const point = turf.point([lng, lat]);

      if (turf.booleanPointInPolygon(point, polygon)) {
        const cls = Math.round(pixelVal);
        histogram[cls] = (histogram[cls] || 0) + 1;
        maskedPixels.push(cls);
      }
    }
  }

  return { histogram, maskedPixels };
}

// ─── Concurrent Download Helper ───

async function downloadConcurrently(tasks, concurrency = MAX_CONCURRENT) {
  const results = [];
  let running = 0;
  let taskIdx = 0;

  return new Promise((resolve) => {
    function startNext() {
      while (running < concurrency && taskIdx < tasks.length) {
        const idx = taskIdx++;
        running++;
        tasks[idx]()
          .then((result) => { results[idx] = result; })
          .catch((err) => { results[idx] = { error: err.message }; })
          .finally(() => {
            running--;
            if (taskIdx >= tasks.length && running === 0) resolve(results);
            else startNext();
          });
      }
    }
    if (tasks.length === 0) resolve([]);
    else startNext();
  });
}

// ─── Main Orchestrator ───

/**
 * Run the full tiled TIFF extraction pipeline.
 *
 * Returns the SAME format as the existing /api/v1/raster/extract endpoint:
 *   { status: 'ok', data: [{fiscal_year, histogram, masked_pixels, pixel_count, pixel_area_ha}...],
 *     pixel_area_ha, years_extracted }
 *
 * This is a drop-in replacement — the Pyodide analytics code works identically.
 */
export async function runTiledExtraction(boundaryGeojson, villageName, onProgress) {
  onProgress?.('Generating tile grid for village boundary…');

  const tiles = generateTileGrid(boundaryGeojson, 1.0);
  console.log(`[TileEngine] Village ${villageName}: ${tiles.length} tile(s)`);

  onProgress?.(`Split village into ${tiles.length} tile(s). Starting download…`);

  const extractedYears = [];
  let globalPixelAreaHa = 0.01; // Will be set from first parsed TIFF

  // Process each fiscal year
  for (let fyIdx = 0; fyIdx < FISCAL_YEARS.length; fyIdx++) {
    const [startYear, endYear] = FISCAL_YEARS[fyIdx];
    const fyLabel = `20${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;

    onProgress?.(`Processing ${fyLabel} (year ${fyIdx + 1}/${FISCAL_YEARS.length})…`);

    // Download all tiles for this fiscal year (with caching)
    const tileDownloadTasks = tiles.map((tile) => async () => {
      const key = tileKey(villageName, fyLabel, tile.idx);

      // Check IndexedDB cache first
      if (await hasTile(key)) {
        const cached = await getTile(key);
        onProgress?.(`${fyLabel}: tile ${tile.idx + 1}/${tiles.length} (cached)`);
        return { idx: tile.idx, arrayBuffer: cached.arrayBuffer, bbox: tile.bbox };
      }

      // Download via backend URL signer
      onProgress?.(`${fyLabel}: downloading tile ${tile.idx + 1}/${tiles.length}…`);
      try {
        const tileInfo = await fetchTileDownloadUrl(tile.bbox, startYear, endYear);
        const arrayBuffer = await downloadTiff(tileInfo.url);

        // Store in IndexedDB
        await storeTile(key, arrayBuffer, { bbox: tile.bbox, fiscalYear: fyLabel });

        return { idx: tile.idx, arrayBuffer, bbox: tile.bbox };
      } catch (err) {
        console.warn(`[TileEngine] Tile ${tile.idx} download failed for ${fyLabel}:`, err.message);
        return { idx: tile.idx, error: err.message };
      }
    });

    const tileResults = await downloadConcurrently(tileDownloadTasks, MAX_CONCURRENT);

    // Parse + mask each tile, merge into combined histogram + pixel array
    const combinedHistogram = {};
    const combinedPixels = [];
    let yearPixelAreaHa = null;
    let anyTileSucceeded = false;

    for (const tileResult of tileResults) {
      if (!tileResult || tileResult.error) continue;

      try {
        onProgress?.(`${fyLabel}: processing tile ${tileResult.idx + 1}/${tiles.length}…`);

        // Parse using KNOWN bbox — no TIFF metadata parsing needed
        const raster = await parseTiff(tileResult.arrayBuffer, tileResult.bbox);
        if (!yearPixelAreaHa) {
          yearPixelAreaHa = raster.pixelAreaHa;
          globalPixelAreaHa = raster.pixelAreaHa;
        }

        // Both raster and boundary are in EPSG:4326 → direct point-in-polygon
        const { histogram, maskedPixels } = maskToPolygon(raster, boundaryGeojson);

        // Merge histogram
        for (const [cls, count] of Object.entries(histogram)) {
          combinedHistogram[cls] = (combinedHistogram[cls] || 0) + count;
        }

        // Append pixels
        combinedPixels.push(...maskedPixels);
        anyTileSucceeded = true;
      } catch (err) {
        console.warn(`[TileEngine] Tile ${tileResult.idx} parse/mask failed:`, err.message);
      }
    }

    if (anyTileSucceeded && combinedPixels.length > 0) {
      extractedYears.push({
        fiscal_year: fyLabel,
        histogram: combinedHistogram,
        masked_pixels: combinedPixels,
        pixel_count: combinedPixels.length,
        pixel_area_ha: yearPixelAreaHa || globalPixelAreaHa,
      });
    }
  }

  // Clear this village's tiles from IndexedDB after analysis completes.
  // Tiles were only needed during processing — the report is now built.
  try { await clearVillageTiles(villageName); } catch (e) { console.warn('[TileEngine] Cleanup:', e.message); }

  if (extractedYears.length === 0) {
    throw new Error('No raster data could be extracted from any tile/year.');
  }

  onProgress?.(`Extracted ${extractedYears.length} years of data (100% client-side).`);

  return {
    status: 'ok',
    data: extractedYears,
    pixel_area_ha: globalPixelAreaHa,
    years_extracted: extractedYears.length,
    source: 'GEE IndiaSAT LULC v3 (client-side tiled, geotiff.js)',
    accuracy: 'high',
  };
}
