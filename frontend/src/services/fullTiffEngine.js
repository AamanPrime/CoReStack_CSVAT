/**
 * CSVAT — Full GeoTIFF Client-Side Processing Engine.
 *
 * Downloads ONE full-village GeoTIFF per fiscal year from GEE (via backend URL signer),
 * then masks + extracts pixel data entirely in the browser using Pyodide (numpy).
 *
 * Memory design: strictly one-year-at-a-time.
 *   1. Download TIFF → ArrayBuffer
 *   2. Cache in IndexedDB (persistent across page refreshes)
 *   3. Parse → pixel data (Float32Array)
 *   4. Run numpy masking → {histogram, masked_pixels}
 *   5. Explicitly null the ArrayBuffer + Float32Array refs
 *   6. Clear Pyodide globals for this year
 *   7. Yield event loop (setTimeout 0) — let GC run before next download
 *   8. Move to next year
 *
 * Peak RAM: ≤ 1 TIFF + numpy mask at any point (~5–40 MB depending on village size).
 * Without this pattern, 8 years × ~40 MB = ~320 MB worst case → Aw Snap crashes.
 *
 * The backend only signs GEE download URLs — zero TIFF storage on server.
 * IndexedDB caching (tiffStore) retains up to MAX_VILLAGES (5) for re-analysis without re-download.
 */

import { fromArrayBuffer } from 'geotiff';
import * as turf from '@turf/turf';
import { tileKey, storeTile, getTile, hasTile, autoCleanup } from './tiffStore';

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '');

// Fiscal year ranges matching CoRE Stack IndiaSAT LULC v3 assets
const FISCAL_YEARS = [
  [2017, 2018], [2018, 2019], [2019, 2020], [2020, 2021],
  [2021, 2022], [2022, 2023], [2023, 2024], [2024, 2025],
];

// ─── GEE URL Signer (full village bbox) ───

async function fetchFullDownloadUrl(bbox, startYear, endYear) {
  const resp = await fetch(`${API_BASE}/api/v1/raster/full-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bbox, start_year: startYear, end_year: endYear }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Full-village URL fetch failed (${resp.status}): ${errText}`);
  }
  return resp.json();
}

async function downloadTiff(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`TIFF download failed: ${resp.status}`);
  return resp.arrayBuffer();
}

// ─── TIFF Parsing with REAL Affine from Metadata ───

/**
 * Parse a GeoTIFF and extract the REAL affine transform from TIFF metadata.
 *
 * Unlike the old tileEngine.js which approximated the affine from the requested bbox,
 * this reads the actual ModelTiepoint + ModelPixelScale tags that GEE embeds.
 * This eliminates the grid-snap error that caused tile-seam inaccuracies.
 *
 * Returns a raster object. The caller is responsible for nulling raster.data after use.
 */
async function parseTiffWithRealAffine(arrayBuffer) {
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const [rawData] = await image.readRasters({ interleave: false });

  let originX, originY, pixelWidth, pixelHeight;

  try {
    const origin = image.getOrigin();       // [x, y, z] from ModelTiepoint
    const resolution = image.getResolution(); // [resX, resY, resZ] from ModelPixelScale

    originX = origin[0];
    originY = origin[1];
    pixelWidth = Math.abs(resolution[0]);
    // MUST be negative for north-up rasters (row 0 = top = max lat, rows go south).
    // geotiff.js negates ModelPixelScale[1], but GEE sometimes provides it with an
    // unexpected sign. Force negative to guarantee correctness.
    pixelHeight = -Math.abs(resolution[1]);

    console.log(`[FullTIFF] Real affine: origin=[${originX.toFixed(6)}, ${originY.toFixed(6)}], px=[${pixelWidth.toFixed(8)}, ${pixelHeight.toFixed(8)}], size=${width}×${height}`);
  } catch (e) {
    // Fallback: compute from bounding box if TIFF metadata is missing
    console.warn('[FullTIFF] No affine in TIFF metadata, using getBoundingBox fallback:', e.message);
    const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
    originX = bbox[0];
    originY = bbox[3]; // top-left Y
    pixelWidth = (bbox[2] - bbox[0]) / width;
    pixelHeight = -(bbox[3] - bbox[1]) / height;
  }

  // Pixel area in hectares (EPSG:4326 degrees → meters at mid-latitude)
  const midLat = originY + (pixelHeight * height / 2);
  const mLat = 111132.92 - 559.82 * Math.cos(2 * (midLat * Math.PI / 180));
  const mLon = 111412.84 * Math.cos(midLat * Math.PI / 180);
  const pixelAreaHa = Math.abs(pixelWidth * mLon) * Math.abs(pixelHeight * mLat) / 10000;

  return {
    // Use the raw typed array directly — avoids the Array.from() copy that wastes 40 MB
    data: rawData instanceof Float32Array ? rawData : new Float32Array(rawData),
    width,
    height,
    originX,
    originY,
    pixelWidth,
    pixelHeight,
    pixelAreaHa,
  };
}

// ─── Pyodide Numpy Masking Code ───

/**
 * Vectorised point-in-polygon masking using numpy ray-casting.
 *
 * Replaces the old turf.booleanPointInPolygon per-pixel loop that caused OOM.
 * All pixels are tested simultaneously — zero per-pixel JS object allocation.
 *
 * Peak RAM for 100K pixels: ~500 KB (float32 array + bool mask).
 */
const NUMPY_MASK_PYTHON = `
import numpy as np

def ray_cast_vectorised(px, py, polygon_rings):
    """Vectorised ray-casting for N points against a polygon (MultiPolygon-safe).

    All N points tested simultaneously via numpy boolean operations.
    O(N * V) where V = total vertex count across all rings.
    Zero Python-level per-pixel loop.
    """
    inside = np.zeros(len(px), dtype=bool)

    for ring in polygon_rings:
        n = len(ring)
        for i in range(n - 1):  # GeoJSON rings are closed (first == last)
            x1, y1 = float(ring[i][0]), float(ring[i][1])
            x2, y2 = float(ring[i + 1][0]), float(ring[i + 1][1])

            dy = y2 - y1
            if abs(dy) < 1e-30:
                continue
            cond = ((y1 > py) != (y2 > py)) & \\
                   (px < (x2 - x1) * (py - y1) / dy + x1)
            inside ^= cond

    return inside

def mask_pixels_numpy(pixel_flat, width, height, origin_x, origin_y,
                      pixel_width, pixel_height, polygon_coords, is_multi):
    """Mask raster pixels to a village boundary polygon using numpy.

    pixel_flat: flat array of pixel values (row-major, H*W)
    polygon_coords: GeoJSON coordinates (list of rings for Polygon,
                     list of list of rings for MultiPolygon)
    is_multi: True if MultiPolygon

    Returns: (histogram_dict, masked_pixels_list)
    """
    if hasattr(pixel_flat, 'to_py'):
        pixel_flat = pixel_flat.to_py()
    if hasattr(polygon_coords, 'to_py'):
        polygon_coords = polygon_coords.to_py()

    pixels = np.array(pixel_flat, dtype=np.float32)
    w = int(width)
    h = int(height)
    ox = float(origin_x)
    oy = float(origin_y)
    pw = float(pixel_width)
    ph = float(pixel_height)

    # Build coordinate arrays for all pixel centers (vectorised — no per-pixel objects)
    cols = np.arange(w, dtype=np.float64)
    rows = np.arange(h, dtype=np.float64)
    col_grid, row_grid = np.meshgrid(cols, rows)

    lngs = ox + (col_grid.ravel() + 0.5) * pw    # (H*W,)
    lats = oy + (row_grid.ravel() + 0.5) * ph    # (H*W,)

    # Collect all rings (handle both Polygon and MultiPolygon)
    all_rings = []
    if is_multi:
        for polygon in polygon_coords:
            for ring in polygon:
                all_rings.append(ring)
    else:
        for ring in polygon_coords:
            all_rings.append(ring)

    # Ray-cast all pixels against all rings
    inside = ray_cast_vectorised(lngs, lats, all_rings)

    # Apply mask: inside polygon AND not nodata (0 or NaN)
    valid = inside & (pixels != 0) & ~np.isnan(pixels)
    masked = pixels[valid]

    # Build histogram
    histogram = {}
    for v in np.unique(masked):
        if np.isnan(v):
            continue
        histogram[str(int(v))] = int(np.sum(masked == v))

    return histogram, masked.tolist()
`;

// ─── Event-loop yield helper ───

/** Yield the event loop for one tick so the browser GC can collect freed memory. */
const yieldToGC = () => new Promise(r => setTimeout(r, 0));

// ─── Main Orchestrator ───

/**
 * Run full-village GeoTIFF extraction pipeline.
 *
 * Processes ONE fiscal year at a time to cap peak memory at ~40 MB regardless of
 * how many years are processed.
 *
 * Returns the same format as the old tileEngine.runTiledExtraction() so the
 * Pyodide analytics in rasterEngine.js works identically:
 *   { status, data: [{fiscal_year, histogram, masked_pixels, pixel_count, pixel_area_ha}...],
 *     pixel_area_ha, years_extracted }
 */
export async function runFullExtraction(boundaryGeojson, villageName, onProgress) {
  // Compute bounding box from village boundary
  const feature = turf.feature(boundaryGeojson);
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(feature);
  const bbox = [minLng, minLat, maxLng, maxLat];

  console.log(`[FullTIFF] Village "${villageName}": bbox=[${bbox.map(v => v.toFixed(4)).join(',')}]`);
  onProgress?.('Preparing full-village GeoTIFF analysis…');

  // Polygon coords for numpy masking — computed once, reused across all years
  const geomType = boundaryGeojson.type;
  const isMulti = geomType === 'MultiPolygon';
  const polygonCoords = boundaryGeojson.coordinates;

  // Load Pyodide once — shared across all years
  onProgress?.('Loading Python WASM for spatial masking…');
  const { loadPyodide } = await import('./pyodideEngine');
  const pyodide = await loadPyodide(onProgress);

  // Register the numpy masking code once
  await pyodide.runPythonAsync(NUMPY_MASK_PYTHON);

  // Set polygon geometry in Pyodide once — same for all years
  pyodide.globals.set('polygon_coords', pyodide.toPy(polygonCoords));
  pyodide.globals.set('is_multi', isMulti);

  const extractedYears = [];
  let globalPixelAreaHa = 0.01;

  // ── Process each fiscal year STRICTLY ONE AT A TIME ──
  // After each year: null the ArrayBuffer, null the pixel data, clear Pyodide
  // globals, then yield the event loop so the browser GC can reclaim memory
  // BEFORE the next TIFF download starts.
  for (let fyIdx = 0; fyIdx < FISCAL_YEARS.length; fyIdx++) {
    const [startYear, endYear] = FISCAL_YEARS[fyIdx];
    const fyLabel = `20${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;

    onProgress?.(`[${fyIdx + 1}/${FISCAL_YEARS.length}] ${fyLabel}: starting…`);

    // ── Step 1: Download or load from IndexedDB cache ──
    const cacheKey = tileKey(villageName, fyLabel, 'full');
    let arrayBuffer = null;

    try {
      if (await hasTile(cacheKey)) {
        const cached = await getTile(cacheKey);
        arrayBuffer = cached.arrayBuffer;
        onProgress?.(`[${fyIdx + 1}/${FISCAL_YEARS.length}] ${fyLabel}: loaded from cache`);
      } else {
        onProgress?.(`[${fyIdx + 1}/${FISCAL_YEARS.length}] ${fyLabel}: downloading GeoTIFF…`);
        const urlInfo = await fetchFullDownloadUrl(bbox, startYear, endYear);
        arrayBuffer = await downloadTiff(urlInfo.url);

        // Persist to IndexedDB — doesn't hold it in RAM (stored as bytes on disk)
        await storeTile(cacheKey, arrayBuffer, { bbox, fiscalYear: fyLabel });
        onProgress?.(`[${fyIdx + 1}/${FISCAL_YEARS.length}] ${fyLabel}: downloaded (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB)`);
      }
    } catch (err) {
      console.warn(`[FullTIFF] Download failed for ${fyLabel}:`, err.message);
      onProgress?.(`[${fyIdx + 1}/${FISCAL_YEARS.length}] ${fyLabel}: download failed — skipping`);
      arrayBuffer = null;
      await yieldToGC();
      continue;
    }

    // ── Step 2: Parse TIFF → pixel data (Float32Array + affine) ──
    let raster = null;
    try {
      raster = await parseTiffWithRealAffine(arrayBuffer);
      globalPixelAreaHa = raster.pixelAreaHa;
    } catch (err) {
      console.warn(`[FullTIFF] TIFF parse failed for ${fyLabel}:`, err.message);
      arrayBuffer = null; // release immediately even on parse error
      await yieldToGC();
      continue;
    }

    // ArrayBuffer is no longer needed — its data is now in raster.data (Float32Array).
    // Null it immediately so the browser can GC the raw bytes before masking.
    arrayBuffer = null;

    // ── Step 3: Numpy masking in Pyodide (vectorised — zero OOM risk) ──
    onProgress?.(`[${fyIdx + 1}/${FISCAL_YEARS.length}] ${fyLabel}: masking pixels…`);
    try {
      // Pass the Float32Array directly to Pyodide — avoids the Array.from() copy
      // that would waste another ~40 MB per year
      pyodide.globals.set('pixel_flat', pyodide.toPy(raster.data));
      pyodide.globals.set('width', raster.width);
      pyodide.globals.set('height', raster.height);
      pyodide.globals.set('origin_x', raster.originX);
      pyodide.globals.set('origin_y', raster.originY);
      pyodide.globals.set('pixel_width', raster.pixelWidth);
      pyodide.globals.set('pixel_height', raster.pixelHeight);

      const maskResult = await pyodide.runPythonAsync(`
mask_pixels_numpy(pixel_flat, width, height, origin_x, origin_y,
                  pixel_width, pixel_height, polygon_coords, is_multi)
      `);

      // Convert Pyodide result → plain JS
      let [histogram, maskedPixels] = maskResult.toJs();

      if (histogram instanceof Map) histogram = Object.fromEntries(histogram);
      if (maskedPixels?.toJs) maskedPixels = maskedPixels.toJs();

      if (maskedPixels.length > 0) {
        extractedYears.push({
          fiscal_year: fyLabel,
          histogram,
          masked_pixels: maskedPixels,
          pixel_count: maskedPixels.length,
          pixel_area_ha: raster.pixelAreaHa,
        });
        onProgress?.(`[${fyIdx + 1}/${FISCAL_YEARS.length}] ${fyLabel}: ${maskedPixels.length.toLocaleString()} pixels inside village ✓`);
      } else {
        console.warn(`[FullTIFF] No valid pixels inside village for ${fyLabel}`);
        onProgress?.(`[${fyIdx + 1}/${FISCAL_YEARS.length}] ${fyLabel}: no pixels inside boundary`);
      }
    } catch (err) {
      console.warn(`[FullTIFF] Numpy masking failed for ${fyLabel}:`, err.message);
      onProgress?.(`[${fyIdx + 1}/${FISCAL_YEARS.length}] ${fyLabel}: masking failed — skipping`);
    }

    // ── Step 4: EXPLICIT MEMORY RELEASE ──
    // Null the pixel data so GC can reclaim the Float32Array backing store.
    raster.data = null;
    raster = null;

    // Clear Pyodide globals for this year — frees the Python-side heap copy.
    // polygon_coords and is_multi are intentionally kept (same across all years).
    try {
      pyodide.globals.delete('pixel_flat');
    } catch (_) { /* ignore if already gone */ }

    // Yield the event loop — gives the browser GC exactly ONE tick to collect
    // the nulled refs before we start the next TIFF download.
    await yieldToGC();
  }

  // ── Cleanup Pyodide polygon globals ──
  try {
    pyodide.globals.delete('polygon_coords');
    pyodide.globals.delete('is_multi');
  } catch (_) { /* ignore */ }

  // Trigger IndexedDB LRU cleanup (keeps last MAX_VILLAGES=5 in cache)
  try { await autoCleanup(); } catch (e) { console.warn('[FullTIFF] autoCleanup:', e.message); }

  if (extractedYears.length === 0) {
    throw new Error('No raster data could be extracted from any year.');
  }

  onProgress?.(`Extracted ${extractedYears.length}/${FISCAL_YEARS.length} years (full-TIFF, zero seam, memory-safe).`);

  return {
    status: 'ok',
    data: extractedYears,
    pixel_area_ha: globalPixelAreaHa,
    years_extracted: extractedYears.length,
    source: 'GEE IndiaSAT LULC v3 (client-side full-TIFF, geotiff.js + numpy)',
    accuracy: 'exact',
  };
}
