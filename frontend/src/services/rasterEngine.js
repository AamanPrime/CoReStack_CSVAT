/**
 * CSVAT — Raster Analytics Engine (Server-Side Processing).
 *
 * Sends village boundary + LULC GeoServer layer URLs to the backend,
 * which downloads the GeoTIFFs concurrently and runs zonal statistics
 * using rasterio/GDAL with windowed reading + geometry_mask.
 *
 * The LULC level 3 raster contains ALL classes (1-12) including:
 *   - Cropping: 8=Single Kharif, 9=Single Non-Kharif, 10=Double, 11=Triple
 *   - Water: 2=Kharif, 3=Kharif+Rabi, 4=Perennial
 *   - Vegetation: 6=Trees, 12=Shrubs
 *   - Other: 1=Built Up, 7=Barren
 *
 * So only LULC downloads are needed — no separate water layer downloads.
 */

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '');

/**
 * Run raster-based analytics for a village polygon via server-side processing.
 */
export async function runRasterAnalytics(boundary, selectedLayers, selectedYears, onProgress) {
  const { state, district, tehsil, boundary_geojson: villageGeojson } = boundary;
  const villageName = boundary.village_name || boundary.name || 'Village';

  onProgress?.('Fetching available raster layer URLs…');

  // 1. Get constructed WCS layer URLs from backend
  const layerResp = await fetch(
    `${API_BASE}/api/v1/raster/layers?state=${enc(state)}&district=${enc(district)}&tehsil=${enc(tehsil)}`
  );
  if (!layerResp.ok) throw new Error(`Failed to fetch raster layer list: ${layerResp.status}`);
  const layerData = await layerResp.json();
  const allLayers = layerData.data || [];

  if (!allLayers.length) {
    throw new Error('No raster layers constructed for this location.');
  }

  // 2. Send ALL layers (LULC + surfaceWaterBodies) — backend separates by category
  const layersToSend = allLayers;

  onProgress?.(`Sending ${layersToSend.length} rasters to server for concurrent processing…`);

  // 3. Send to backend /analyze endpoint for server-side rasterio processing
  const analyzeResp = await fetch(`${API_BASE}/api/v1/raster/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      village_geojson: villageGeojson,
      area_hectares: boundary.area_hectares || 0,
      state,
      district,
      tehsil,
      layers: layersToSend.map(l => ({
        url: l.layer_url,
        category: l.category,
        fiscal_year: l.fiscal_year,
      })),
    }),
  });

  if (!analyzeResp.ok) {
    const errText = await analyzeResp.text();
    throw new Error(`Server raster analysis failed (${analyzeResp.status}): ${errText}`);
  }

  const serverResult = await analyzeResp.json();

  if (serverResult.status !== 'ok') {
    throw new Error(serverResult.detail || 'Server raster analysis failed');
  }

  onProgress?.('Server-side raster analysis complete. Building report…');

  // 4. Transform server response into the standard CSVAT report schema
  const results = {
    village_name: villageName,
    state, district, tehsil,
    data_source: serverResult.data_source || 'CoRE Stack Raster (10m)',
    compute_mode: 'client_raster',
    years: selectedYears,
    area_hectares: boundary.area_hectares || 0,
  };

  // Cropping intensity
  if (serverResult.cropping_intensity?.length > 0) {
    results.cropping_intensity = {
      village_name: villageName,
      data: serverResult.cropping_intensity.map(r => ({
        year: r.fiscal_year,
        fiscal_year: r.fiscal_year,
        single_crop_ha: r.single_crop_ha,
        double_crop_ha: r.double_crop_ha,
        triple_crop_ha: r.triple_crop_ha,
        total_cropped_ha: r.total_cropped_ha,
        cropping_intensity: r.intensity_index,
      })),
      source: serverResult.data_source,
      processing: serverResult.processing,
    };
  }

  // Surface water (extracted from same LULC raster)
  if (serverResult.surface_water?.length > 0) {
    results.surface_water = {
      village_name: villageName,
      data: serverResult.surface_water.map(r => ({
        year: r.fiscal_year,
        fiscal_year: r.fiscal_year,
        kharif_ha: r.kharif_ha,
        rabi_ha: r.rabi_ha,
        zaid_ha: r.zaid_ha,
        total_water_ha: r.total_water_ha,
      })),
      source: serverResult.data_source,
      processing: serverResult.processing,
    };
  }

  // Vegetation / tree cover (yearly data)
  if (serverResult.vegetation?.length > 0) {
    const vegData = serverResult.vegetation;
    const first = vegData[0];
    const last = vegData[vegData.length - 1];
    results.vegetation = {
      village_name: villageName,
      start_year: first.fiscal_year,
      end_year: last.fiscal_year,
      tree_cover_start_ha: first.tree_cover_ha,
      tree_cover_end_ha: last.tree_cover_ha,
      net_change_ha: +(last.tree_cover_ha - first.tree_cover_ha).toFixed(2),
      yearly_data: vegData.map(v => ({
        year: v.fiscal_year,
        tree_cover_ha: v.tree_cover_ha,
      })),
      source: serverResult.data_source,
    };
  }

  // Vegetation analysis (deforestation transitions)
  if (serverResult.vegetation_analysis && Object.keys(serverResult.vegetation_analysis).length > 0) {
    const va = serverResult.vegetation_analysis;
    results.vegetation = {
      ...results.vegetation,
      start_year: va.start_year,
      end_year: va.end_year,
      tree_cover_start_ha: va.tree_cover_start_ha,
      tree_cover_end_ha: va.tree_cover_end_ha,
      net_change_ha: va.net_change_ha,
      afforestation_ha: va.afforestation_ha,
      deforestation_ha: va.deforestation_ha,
      tree_cover_loss_ha: va.deforestation_ha,
      tree_cover_gain_ha: va.afforestation_ha,
      degraded_land_ha: va.degraded_land_ha,
      transitions: va.transitions?.map(t => ({
        from_class: t.from_class,
        to_label: t.to_label,
        to_class: t.to_class,
        area_ha: t.area_ha,
      })) || [],
    };
  }

  // Crop intensity change detection
  if (serverResult.crop_intensity_change?.length > 0) {
    results.crop_intensity_change = serverResult.crop_intensity_change;
  }

  // Raw histograms for debugging
  if (serverResult.raw_histograms) {
    results.raw_histograms = serverResult.raw_histograms;
    console.log('[Raster] Raw histograms:', serverResult.raw_histograms);
    console.log('[Raster] Debug info:', serverResult._debug);
  }

  // Check if we got any actual data
  const hasCropData = results.cropping_intensity?.data?.length > 0;
  const hasWaterData = results.surface_water?.data?.length > 0;
  if (!hasCropData && !hasWaterData) {
    throw new Error('No raster data could be processed. Layers may not exist on GeoServer for this area.');
  }

  onProgress?.('Raster analytics complete!');
  return results;
}

// ─── Helpers ───

function fiscalYearToInt(fy) {
  if (!fy) return 0;
  return parseInt('20' + fy.split('-')[0].slice(-2));
}

function enc(s) { return encodeURIComponent(s); }

/**
 * Check if raster layers might be available for a tehsil.
 */
export async function checkRasterAvailability(state, district, tehsil) {
  try {
    const resp = await fetch(
      `${API_BASE}/api/v1/raster/layers?state=${enc(state)}&district=${enc(district)}&tehsil=${enc(tehsil)}`
    );
    if (!resp.ok) return { available: false, layerCount: 0, matchedCategories: [] };
    const data = await resp.json();
    const layers = data.data || [];
    const categories = [...new Set(layers.map(l => l.category))];
    return {
      available: layers.length > 0,
      layerCount: layers.length,
      matchedCategories: categories,
    };
  } catch {
    return { available: false, layerCount: 0, matchedCategories: [] };
  }
}
