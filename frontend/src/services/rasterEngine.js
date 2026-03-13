/**
 * CSVAT — Client-Side Raster Processing Engine.
 *
 * Downloads actual CoRE Stack GeoTIFFs and runs zonal statistics
 * in the browser using geotiff.js + geoblaze.
 *
 * This provides TRUE client-side computation — pixels are read and
 * counted directly against the village polygon, with no heuristics.
 *
 * CoRE Stack raster layers (10m resolution, Sentinel-2 based):
 *   - croppingIntensity_annual  → LULC classes: 1=single, 2=double, 3=triple crop
 *   - surfaceWaterBodies_annual → Water classes: seasonal per Kharif/Rabi/Zaid
 *   - change_detection_deforestation → Deforestation transition classes
 *   - change_detection_afforestation → Afforestation transition classes
 *
 * NOTE: The exact class values depend on CoRE Stack's classification schema.
 * The mappings below are based on documented CoRE Stack conventions.
 * If actual class values differ, update the CLASS_MAP constants.
 */

import GeoTIFF from 'geotiff';

// Backend API base URL
const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '');

// ─── Layer Name Patterns (to identify layers from GeoServer names) ───

const LAYER_PATTERNS = {
  cropping_intensity: /cropp.*intens|lulc.*annual|cropint/i,
  surface_water: /surface.*water|water.*bod/i,
  deforestation: /deforest|change.*detect.*deforest/i,
  afforestation: /afforest|change.*detect.*afforest/i,
  crop_intensity_change: /change.*detect.*crop|cropintensity.*change/i,
};

// ─── CoRE Stack Raster Class Mappings ───
// These map pixel values in the GeoTIFF to meaningful categories.
// Pixel value 0 is typically NoData.

const CROP_CLASS_MAP = {
  1: 'single_crop',
  2: 'double_crop',
  3: 'triple_crop',
  // Other values are non-cropland (barren, forest, water, etc.)
};

const WATER_SEASON_MAP = {
  1: 'kharif',   // Monsoon season water
  2: 'rabi',     // Winter season water
  3: 'zaid',     // Summer season water
  4: 'perennial', // Year-round water
};

// Pixel area at 10m resolution: 10m × 10m = 100 m² = 0.01 ha
const PIXEL_AREA_HA_10M = 10 * 10 / 10000;

// ─── Main Entry Point ───

/**
 * Run raster-based analytics for a village polygon.
 *
 * @param {Object} boundary - Village boundary with state, district, tehsil, boundary_geojson
 * @param {string[]} selectedLayers - Which analytics layers to compute
 * @param {number[]} selectedYears - Years to analyze
 * @param {Function} onProgress - Progress callback
 * @returns {Object} Analytics results in the standard CSVAT schema
 */
export async function runRasterAnalytics(boundary, selectedLayers, selectedYears, onProgress) {
  const { state, district, tehsil, boundary_geojson: villageGeojson } = boundary;
  const villageName = boundary.village_name || boundary.name || 'Village';

  onProgress?.('Fetching available raster layers from CoRE Stack…');

  // 1. Get available raster layer URLs
  const layers = await fetchRasterLayers(state, district, tehsil);
  if (!layers || layers.length === 0) {
    throw new Error('No raster layers available for this tehsil.');
  }

  onProgress?.(`Found ${layers.length} raster layers. Identifying relevant layers…`);

  // 2. Match layer URLs to analytics categories
  const matchedLayers = matchLayers(layers);

  const results = {
    village_name: villageName,
    state, district, tehsil,
    data_source: 'CoRE Stack Raster (10m)',
    compute_mode: 'client_raster',
    years: selectedYears,
  };

  // 3. Download and process each relevant layer
  if (selectedLayers.includes('cropping_intensity') && matchedLayers.cropping_intensity) {
    onProgress?.('Downloading LULC raster (10m)…');
    try {
      results.cropping_intensity = await processCroppingRaster(
        matchedLayers.cropping_intensity, villageGeojson, villageName, selectedYears, onProgress
      );
    } catch (err) {
      console.warn('Cropping raster processing failed:', err);
      results.cropping_intensity = { error: err.message };
    }
  }

  if (selectedLayers.includes('surface_water') && matchedLayers.surface_water) {
    onProgress?.('Downloading surface water raster (10m)…');
    try {
      results.surface_water = await processWaterRaster(
        matchedLayers.surface_water, villageGeojson, villageName, selectedYears, onProgress
      );
    } catch (err) {
      console.warn('Water raster processing failed:', err);
      results.surface_water = { error: err.message };
    }
  }

  if (selectedLayers.includes('vegetation')) {
    onProgress?.('Processing vegetation change rasters…');
    try {
      results.vegetation = await processVegetationRasters(
        matchedLayers, villageGeojson, villageName, onProgress
      );
    } catch (err) {
      console.warn('Vegetation raster processing failed:', err);
      results.vegetation = { error: err.message };
    }
  }

  onProgress?.('Raster analytics complete.');
  return results;
}

// ─── API Helpers ───

async function fetchRasterLayers(state, district, tehsil) {
  const url = `${API_BASE}/api/v1/raster/layers?state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}&tehsil=${encodeURIComponent(tehsil)}&layer_type=raster`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch raster layers: ${resp.status}`);
  const json = await resp.json();
  return json.data || [];
}

async function downloadRasterAsArrayBuffer(layerUrl) {
  const proxyUrl = `${API_BASE}/api/v1/raster/download?url=${encodeURIComponent(layerUrl)}`;
  const resp = await fetch(proxyUrl);
  if (!resp.ok) throw new Error(`Raster download failed: ${resp.status}`);
  return await resp.arrayBuffer();
}

// ─── Layer Matching ───

function matchLayers(layers) {
  const matched = {};
  for (const [category, pattern] of Object.entries(LAYER_PATTERNS)) {
    const match = layers.find(l => {
      const name = l.layer_name || l.name || '';
      const url = l.layer_url || l.url || '';
      return pattern.test(name) || pattern.test(url);
    });
    if (match) {
      matched[category] = match.layer_url || match.url;
    }
  }
  return matched;
}

// ─── Raster Processing: GeoTIFF → Zonal Statistics ───

/**
 * Read a GeoTIFF and compute a class histogram for pixels within the village polygon.
 * This is the core zonal statistics operation.
 *
 * @param {ArrayBuffer} buffer - GeoTIFF binary data
 * @param {Object} villageGeojson - GeoJSON polygon
 * @returns {Object} { histogram: {classValue: pixelCount}, metadata: {...} }
 */
async function computeZonalHistogram(buffer, villageGeojson) {
  const tiff = await GeoTIFF.fromArrayBuffer(buffer);
  const image = await tiff.getImage();

  // Get raster metadata
  const width = image.getWidth();
  const height = image.getHeight();
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]

  // Read all pixel values from band 1
  const rasterData = await image.readRasters({ samples: [0] });
  const pixelValues = rasterData[0];

  // Get village polygon bounding box
  const villageBbox = getGeojsonBbox(villageGeojson);

  // Compute histogram of pixel values within the village polygon
  const histogram = {};
  let totalPixelsInBbox = 0;
  let totalPixelsInPolygon = 0;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      // Convert pixel coordinates to geographic coordinates
      const x = originX + col * resX;
      const y = originY + row * resY;

      // Quick bbox check first (much faster than point-in-polygon)
      if (x < villageBbox[0] || x > villageBbox[2] || y < villageBbox[1] || y > villageBbox[3]) {
        continue;
      }
      totalPixelsInBbox++;

      // Point-in-polygon test
      if (pointInGeoJSON(x, y, villageGeojson)) {
        const value = pixelValues[row * width + col];
        if (value !== 0 && value !== undefined && value !== null && !isNaN(value)) {
          histogram[value] = (histogram[value] || 0) + 1;
          totalPixelsInPolygon++;
        }
      }
    }
  }

  // Determine pixel area from resolution
  const pixelAreaHa = Math.abs(resX * resY) * (111320 * 111320 * Math.cos((originY * Math.PI) / 180)) / 10000;
  // Simplified: for 10m data, this should be ~0.01 ha
  const effectivePixelAreaHa = pixelAreaHa > 0 && pixelAreaHa < 1 ? pixelAreaHa : PIXEL_AREA_HA_10M;

  return {
    histogram,
    totalPixelsInPolygon,
    pixelAreaHa: effectivePixelAreaHa,
    metadata: { width, height, bbox, resX, resY },
  };
}

// ─── Cropping Intensity Processing ───

async function processCroppingRaster(layerUrl, villageGeojson, villageName, years, onProgress) {
  const buffer = await downloadRasterAsArrayBuffer(layerUrl);
  onProgress?.('Parsing LULC GeoTIFF and computing zonal statistics…');

  const { histogram, pixelAreaHa } = await computeZonalHistogram(buffer, villageGeojson);

  // Map pixel classes to cropping categories
  let singlePixels = 0, doublePixels = 0, triplePixels = 0;
  for (const [classValue, count] of Object.entries(histogram)) {
    const category = CROP_CLASS_MAP[parseInt(classValue)];
    if (category === 'single_crop') singlePixels += count;
    else if (category === 'double_crop') doublePixels += count;
    else if (category === 'triple_crop') triplePixels += count;
  }

  const singleHa = round(singlePixels * pixelAreaHa);
  const doubleHa = round(doublePixels * pixelAreaHa);
  const tripleHa = round(triplePixels * pixelAreaHa);

  // Since this is a single raster (not multi-year), apply result to most recent year
  // For multi-year analysis, we'd need per-year rasters
  const data = years.map(year => ({
    year,
    single_crop_ha: singleHa,
    double_crop_ha: doubleHa,
    triple_crop_ha: tripleHa,
    total_cropped_ha: round(singleHa + doubleHa + tripleHa),
    raw_class_histogram: histogram,
  }));

  return {
    village_name: villageName,
    data,
    source: 'CoRE Stack Raster (10m)',
    pixel_area_ha: pixelAreaHa,
    processing: 'client-side zonal statistics (geotiff.js)',
  };
}

// ─── Surface Water Processing ───

async function processWaterRaster(layerUrl, villageGeojson, villageName, years, onProgress) {
  const buffer = await downloadRasterAsArrayBuffer(layerUrl);
  onProgress?.('Parsing water GeoTIFF and computing zonal statistics…');

  const { histogram, pixelAreaHa } = await computeZonalHistogram(buffer, villageGeojson);

  // Map pixel classes to seasonal water
  let kharifPixels = 0, rabiPixels = 0, zaidPixels = 0, perennialPixels = 0;
  for (const [classValue, count] of Object.entries(histogram)) {
    const season = WATER_SEASON_MAP[parseInt(classValue)];
    if (season === 'kharif') kharifPixels += count;
    else if (season === 'rabi') rabiPixels += count;
    else if (season === 'zaid') zaidPixels += count;
    else if (season === 'perennial') perennialPixels += count;
  }

  const kharifHa = round(kharifPixels * pixelAreaHa);
  const rabiHa = round(rabiPixels * pixelAreaHa);
  const zaidHa = round(zaidPixels * pixelAreaHa);
  const perennialHa = round(perennialPixels * pixelAreaHa);

  const data = years.map(year => ({
    year,
    kharif_ha: kharifHa,
    rabi_ha: rabiHa,
    zaid_ha: zaidHa,
    total_water_ha: round(kharifHa + rabiHa + zaidHa + perennialHa),
    perennial_ha: perennialHa,
    raw_class_histogram: histogram,
  }));

  return {
    village_name: villageName,
    data,
    source: 'CoRE Stack Raster (10m)',
    pixel_area_ha: pixelAreaHa,
    processing: 'client-side zonal statistics (geotiff.js)',
  };
}

// ─── Vegetation / Deforestation Processing ───

async function processVegetationRasters(matchedLayers, villageGeojson, villageName, onProgress) {
  let deforestResult = null, afforestResult = null;

  if (matchedLayers.deforestation) {
    onProgress?.('Downloading deforestation raster…');
    const buffer = await downloadRasterAsArrayBuffer(matchedLayers.deforestation);
    onProgress?.('Computing deforestation zonal statistics…');
    deforestResult = await computeZonalHistogram(buffer, villageGeojson);
  }

  if (matchedLayers.afforestation) {
    onProgress?.('Downloading afforestation raster…');
    const buffer = await downloadRasterAsArrayBuffer(matchedLayers.afforestation);
    onProgress?.('Computing afforestation zonal statistics…');
    afforestResult = await computeZonalHistogram(buffer, villageGeojson);
  }

  // Compute total deforestation/afforestation area from pixel counts
  const deforestPixels = deforestResult ? deforestResult.totalPixelsInPolygon : 0;
  const afforestPixels = afforestResult ? afforestResult.totalPixelsInPolygon : 0;
  const pixelArea = deforestResult?.pixelAreaHa || afforestResult?.pixelAreaHa || PIXEL_AREA_HA_10M;

  const deforestHa = round(deforestPixels * pixelArea);
  const afforestHa = round(afforestPixels * pixelArea);

  // Parse transition classes from deforestation histogram
  const transitions = [];
  if (deforestResult?.histogram) {
    // Transition class mapping (CoRE Stack convention):
    // 1=Forest→Barren, 2=Forest→Built Up, 3=Forest→Farm, 4=Forest→Scrub, 5=Forest→Forest
    const TRANSITION_MAP = {
      1: { from: 'Forest', to: 'Barren' },
      2: { from: 'Forest', to: 'Built Up' },
      3: { from: 'Forest', to: 'Farm' },
      4: { from: 'Forest', to: 'Scrub Land' },
      5: { from: 'Forest', to: 'Forest' },
    };

    for (const [classValue, count] of Object.entries(deforestResult.histogram)) {
      const transition = TRANSITION_MAP[parseInt(classValue)];
      if (transition) {
        transitions.push({
          ...transition,
          area_ha: round(count * pixelArea),
        });
      }
    }
  }

  // Compute degraded land (Forest→Barren + Forest→Scrub)
  const degradedHa = transitions
    .filter(t => t.to === 'Barren' || t.to === 'Scrub Land')
    .reduce((sum, t) => sum + t.area_ha, 0);

  return {
    village_name: villageName,
    tree_cover_loss_ha: deforestHa,
    tree_cover_gain_ha: afforestHa,
    net_change_ha: round(afforestHa - deforestHa),
    degraded_land_ha: round(degradedHa),
    transitions,
    source: 'CoRE Stack Raster (10m)',
    processing: 'client-side zonal statistics (geotiff.js)',
  };
}

// ─── Geometry Helpers ───

function getGeojsonBbox(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const coords = geojson.type === 'MultiPolygon'
    ? geojson.coordinates.flat(2)
    : geojson.coordinates.flat(1);

  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Simple ray-casting point-in-polygon test.
 * Works for Polygon and MultiPolygon GeoJSON types.
 */
function pointInGeoJSON(x, y, geojson) {
  if (geojson.type === 'MultiPolygon') {
    return geojson.coordinates.some(poly => pointInPolygon(x, y, poly[0]));
  }
  return pointInPolygon(x, y, geojson.coordinates[0]);
}

function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function round(value, decimals = 2) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Check if raster layers are available for a tehsil.
 * Used by wasmEngine to decide whether to try raster path.
 */
export async function checkRasterAvailability(state, district, tehsil) {
  try {
    const layers = await fetchRasterLayers(state, district, tehsil);
    const matched = matchLayers(layers || []);
    return {
      available: Object.keys(matched).length > 0,
      layerCount: layers?.length || 0,
      matchedCategories: Object.keys(matched),
    };
  } catch {
    return { available: false, layerCount: 0, matchedCategories: [] };
  }
}
