/**
 * CSVAT — Client-Side WASM Analytics Engine.
 *
 * Runs the analytics pipeline entirely in the browser.
 * Architecture (WASM-First / Mode B per ADD):
 *   1. Boundary resolution via backend API (to protect tokens)
 *   2. Raw satellite data fetched from backend GEE proxy
 *   3. Computation in-browser via Pyodide (Python WASM + numpy)
 *   4. Render results directly in React
 */

// Note: pyodideEngine is dynamically imported in runGEEFallbackPipeline()
// to avoid loading Pyodide until the user confirms GEE fallback.

// Backend API base URL
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8006';

// ─── Custom Error for MWS Unavailable ───

export class MWSUnavailableError extends Error {
  constructor(message, boundary) {
    super(message);
    this.name = 'MWSUnavailableError';
    this.boundary = boundary;
  }
}

// ─── MWS Analytics (Client-Side via Pyodide WASM) ───

async function fetchMWSGeometries(state, district, tehsil) {
  const resp = await fetch(
    `${API_BASE}/api/v1/corestack/mws-geometries?state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}&tehsil=${encodeURIComponent(tehsil)}`
  );
  if (!resp.ok) throw new Error(`MWS geometries fetch failed: ${resp.status}`);
  const json = await resp.json();
  return json.data;
}

async function fetchTehsilData(state, district, tehsil) {
  const resp = await fetch(
    `${API_BASE}/api/v1/corestack/tehsil-data?state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}&tehsil=${encodeURIComponent(tehsil)}`
  );
  if (!resp.ok) throw new Error(`Tehsil data fetch failed: ${resp.status}`);
  const json = await resp.json();
  return json.data;
}

async function tryMWSAnalytics(boundary, selectedLayers, selectedYears, onProgress) {
  const state = boundary.state || '';
  const district = boundary.district || '';
  const tehsil = boundary.tehsil || '';
  const villageName = boundary.name || 'Unknown';

  if (!state || !district || !tehsil ||
      state === 'Unknown' || district === 'Unknown' || tehsil === 'Unknown') {
    return { status: 'mws_unavailable', message: 'Admin details not available for MWS lookup.' };
  }

  // 1. Fetch raw MWS geometries and tehsil data in parallel
  onProgress?.('Fetching CoRE Stack MWS data…');
  let mwsGeoJSON, tehsilData;
  try {
    [mwsGeoJSON, tehsilData] = await Promise.all([
      fetchMWSGeometries(state, district, tehsil),
      fetchTehsilData(state, district, tehsil),
    ]);
  } catch (err) {
    return { status: 'mws_unavailable', message: `CoRE Stack data fetch failed: ${err.message}` };
  }

  // Extract features list from GeoJSON
  let mwsFeatures = [];
  if (mwsGeoJSON?.type === 'FeatureCollection') {
    mwsFeatures = mwsGeoJSON.features || [];
  } else if (Array.isArray(mwsGeoJSON)) {
    mwsFeatures = mwsGeoJSON;
  }

  if (!mwsFeatures.length) {
    return { status: 'mws_unavailable', message: 'No MWS geometries found for this tehsil.' };
  }

  // Pass the ENTIRE tehsil data dict to Python (it's organized by vector type)
  // Vectors: croppingIntensity_annual, surfaceWaterBodies_annual, etc.
  if (!tehsilData || typeof tehsilData !== 'object') {
    return { status: 'mws_unavailable', message: 'No MWS analytics data found for this tehsil.' };
  }

  // 2. Load Pyodide and run intersection + aggregation client-side
  onProgress?.('Loading Python WASM for spatial analytics…');
  const { loadPyodide } = await import('./pyodideEngine');
  const pyodide = await loadPyodide(onProgress);

  // Install shapely in Pyodide (for spatial intersection)
  onProgress?.('Installing spatial analysis library…');
  try {
    await pyodide.runPythonAsync(`
import micropip
await micropip.install('shapely')
    `);
  } catch (e) {
    console.warn('Shapely install via micropip failed, trying loadPackage:', e.message);
    try {
      await pyodide.loadPackage('shapely');
    } catch {
      // shapely may not be available in Pyodide — fall back to bbox intersection
      console.warn('Shapely not available, using bounding-box intersection fallback');
    }
  }

  // 3. Register the MWS analytics Python code
  onProgress?.('Running spatial intersection & aggregation (Python WASM)…');
  await pyodide.runPythonAsync(MWS_ANALYTICS_PYTHON_CODE);

  // 4. Pass data to Python and run
  pyodide.globals.set('village_geojson', pyodide.toPy(boundary.geojson));
  pyodide.globals.set('mws_features', pyodide.toPy(mwsFeatures));
  pyodide.globals.set('tehsil_data_raw', pyodide.toPy(tehsilData));
  pyodide.globals.set('selected_layers', pyodide.toPy(selectedLayers));
  pyodide.globals.set('selected_years', pyodide.toPy(selectedYears));
  pyodide.globals.set('village_name', villageName);

  const rawResult = await pyodide.runPythonAsync(`
run_mws_village_analytics(
    village_geojson, mws_features, tehsil_data_raw,
    selected_layers, selected_years, village_name
)
  `);

  // Deep-convert Pyodide Maps to plain JS objects
  const { deepConvertPyodide } = await import('./pyodideEngine');
  let result;
  if (typeof deepConvertPyodide === 'function') {
    result = deepConvertPyodide(rawResult);
  } else {
    // Inline deep conversion
    result = rawResult;
    if (typeof result?.toJs === 'function') {
      result = result.toJs({ dict_converter: Object.fromEntries });
    }
  }
  // Recursively convert any remaining Maps
  result = JSON.parse(JSON.stringify(result, (key, val) =>
    val instanceof Map ? Object.fromEntries(val) : val
  ));

  if (!result || result.status === 'mws_unavailable') {
    return { status: 'mws_unavailable', message: result?.message || 'MWS analytics returned no data.' };
  }

  return {
    status: 'success',
    data: {
      village_name: villageName,
      state, district, tehsil,
      ...result,
    },
    data_source: 'corestack_mws',
    mws_count: result.mws_count || 0,
  };
}

// ─── Python code for MWS spatial analytics (runs in Pyodide) ───
// CoRE Stack API returns data under vector keys:
//   croppingIntensity_annual: [{uid, single_cropped_area_in_ha_2017-2018, ...}]
//   surfaceWaterBodies_annual: [{uid, kharif_area_in_ha_2017-2018, ...}]
//   change_detection_deforestation / change_detection_afforestation
const MWS_ANALYTICS_PYTHON_CODE = `
import numpy as np
import json

try:
    from shapely.geometry import shape as shapely_shape
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

def _bbox(coords_list):
    xs, ys = [], []
    for ring in coords_list:
        for c in ring:
            xs.append(c[0])
            ys.append(c[1])
    return [min(xs), min(ys), max(xs), max(ys)]

def _bbox_overlap(b1, b2):
    ix0, iy0 = max(b1[0], b2[0]), max(b1[1], b2[1])
    ix1, iy1 = min(b1[2], b2[2]), min(b1[3], b2[3])
    if ix0 >= ix1 or iy0 >= iy1:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    mws_area = (b2[2] - b2[0]) * (b2[3] - b2[1])
    return inter / mws_area if mws_area > 0 else 0.0

def compute_intersections(village_geojson, mws_features):
    intersections = []
    if HAS_SHAPELY:
        village_shape = shapely_shape(village_geojson)
        if not village_shape.is_valid:
            village_shape = village_shape.buffer(0)
        for feat in mws_features:
            geom = feat.get('geometry')
            props = feat.get('properties', {})
            if not geom:
                continue
            mws_shape = shapely_shape(geom)
            if not mws_shape.is_valid:
                mws_shape = mws_shape.buffer(0)
            if not village_shape.intersects(mws_shape):
                continue
            overlap = village_shape.intersection(mws_shape)
            if overlap.is_empty:
                continue
            frac = overlap.area / mws_shape.area if mws_shape.area > 0 else 0
            uid = str(props.get('uid', '') or props.get('mws_uid', '') or props.get('UID', ''))
            intersections.append({'mws_uid': uid, 'overlap_fraction': round(frac, 6)})
    else:
        vtype = village_geojson.get('type', '')
        v_coords = village_geojson['coordinates'][0] if vtype == 'MultiPolygon' else village_geojson['coordinates']
        v_bbox = _bbox(v_coords)
        for feat in mws_features:
            geom = feat.get('geometry')
            props = feat.get('properties', {})
            if not geom:
                continue
            gtype = geom.get('type', '')
            if gtype == 'MultiPolygon':
                m_coords = geom['coordinates'][0]
            elif gtype == 'Polygon':
                m_coords = geom['coordinates']
            else:
                continue
            frac = _bbox_overlap(v_bbox, _bbox(m_coords))
            if frac <= 0:
                continue
            uid = str(props.get('uid', '') or props.get('mws_uid', '') or props.get('UID', ''))
            intersections.append({'mws_uid': uid, 'overlap_fraction': round(frac, 6)})
    return intersections

def build_uid_lookup(records):
    lookup = {}
    for rec in records:
        uid = str(rec.get('uid', '') or rec.get('mws_uid', '') or rec.get('UID', ''))
        if uid:
            lookup[uid] = dict(rec)
    return lookup

def weighted_aggregate(intersections, data_by_uid, key, mode='sum'):
    total_weight = 0.0
    weighted_sum = 0.0
    for ix in intersections:
        uid = ix['mws_uid']
        frac = ix['overlap_fraction']
        mws_data = data_by_uid.get(uid, {})
        val = mws_data.get(key)
        if val is None:
            continue
        try:
            val = float(val)
        except (ValueError, TypeError):
            continue
        weighted_sum += val * frac
        total_weight += frac
    if total_weight == 0:
        return None
    return round(weighted_sum, 4) if mode == 'sum' else round(weighted_sum / total_weight, 4)

def fiscal_year(y):
    """Convert calendar year 2022 to fiscal year string 2022-2023."""
    return f"{y}-{y+1}"

def aggregate_cropping(intersections, cropping_records, years):
    """Aggregate cropping intensity from croppingIntensity_annual vector.

    CoRE Stack keys: single_cropped_area_in_ha_2022-2023, doubly_cropped_area_in_ha_2022-2023,
    triply_cropped_area_in_ha_2022-2023, cropping_intensity_unit_less_2022-2023
    """
    data_by_uid = build_uid_lookup(cropping_records)
    results = []
    for year in sorted(years):
        fy = fiscal_year(year)
        single = weighted_aggregate(intersections, data_by_uid, f'single_cropped_area_in_ha_{fy}', 'sum')
        double = weighted_aggregate(intersections, data_by_uid, f'doubly_cropped_area_in_ha_{fy}', 'sum')
        triple = weighted_aggregate(intersections, data_by_uid, f'triply_cropped_area_in_ha_{fy}', 'sum')
        intensity = weighted_aggregate(intersections, data_by_uid, f'cropping_intensity_unit_less_{fy}', 'avg')
        results.append({
            'year': year,
            'single_crop_ha': single or 0.0,
            'double_crop_ha': double or 0.0,
            'triple_crop_ha': triple or 0.0,
            'total_cropped_ha': round((single or 0) + (double or 0) + (triple or 0), 4),
            'cropping_intensity': intensity,
        })
    return results

def aggregate_surface_water(intersections, water_records, years):
    """Aggregate surface water from surfaceWaterBodies_annual vector.

    CoRE Stack keys: total_area_in_ha_2022-2023, kharif_area_in_ha_2022-2023,
    rabi_area_in_ha_2022-2023, zaid_area_in_ha_2022-2023
    """
    data_by_uid = build_uid_lookup(water_records)
    results = []
    for year in sorted(years):
        fy = fiscal_year(year)
        total = weighted_aggregate(intersections, data_by_uid, f'total_area_in_ha_{fy}', 'sum')
        kharif = weighted_aggregate(intersections, data_by_uid, f'kharif_area_in_ha_{fy}', 'sum')
        rabi = weighted_aggregate(intersections, data_by_uid, f'rabi_area_in_ha_{fy}', 'sum')
        zaid = weighted_aggregate(intersections, data_by_uid, f'zaid_area_in_ha_{fy}', 'sum')
        results.append({
            'year': year,
            'perennial_ha': total or 0.0,
            'seasonal_monsoon_ha': kharif or 0.0,
            'seasonal_winter_ha': rabi or 0.0,
            'seasonal_summer_ha': zaid or 0.0,
            'total_water_ha': total or 0.0,
        })
    return results

def aggregate_vegetation(intersections, deforest_records, afforest_records, years):
    """Aggregate vegetation from change_detection_deforestation/afforestation."""
    deforest_by_uid = build_uid_lookup(deforest_records)
    afforest_by_uid = build_uid_lookup(afforest_records)

    total_deforest = weighted_aggregate(intersections, deforest_by_uid, 'total_deforestation_area_in_ha', 'sum')
    total_afforest = weighted_aggregate(intersections, afforest_by_uid, 'total_afforestation_area_in_ha', 'sum')
    forest_stable = weighted_aggregate(intersections, deforest_by_uid, 'forest_to_forest_area_in_ha', 'sum')

    sorted_years = sorted(years)
    start_year = sorted_years[0] if sorted_years else 0
    end_year = sorted_years[-1] if sorted_years else 0

    # Estimate start coverage = stable forest + deforestation (lost from original)
    start_ha = round((forest_stable or 0) + (total_deforest or 0), 4)
    # End coverage = stable forest + afforestation (gained)
    end_ha = round((forest_stable or 0) + (total_afforest or 0), 4)
    net = round(end_ha - start_ha, 4)

    return {
        'start_year': start_year,
        'end_year': end_year,
        'tree_cover_start_ha': start_ha,
        'tree_cover_end_ha': end_ha,
        'net_change_ha': net,
        'tree_cover_loss_ha': round(total_deforest or 0, 4),
        'tree_cover_gain_ha': round(total_afforest or 0, 4),
        'degraded_land_ha': 0.0,
        'yearly_data': [{'year': start_year, 'tree_cover_ha': start_ha},
                        {'year': end_year, 'tree_cover_ha': end_ha}],
    }

def run_mws_village_analytics(village_geojson, mws_features, tehsil_data,
                              selected_layers, selected_years, village_name):
    """Full client-side MWS analytics pipeline."""
    # Convert Pyodide proxies
    if hasattr(village_geojson, 'to_py'):
        village_geojson = village_geojson.to_py()
    if hasattr(mws_features, 'to_py'):
        mws_features = mws_features.to_py()
    if hasattr(tehsil_data, 'to_py'):
        tehsil_data = tehsil_data.to_py()
    if hasattr(selected_layers, 'to_py'):
        selected_layers = selected_layers.to_py()
    if hasattr(selected_years, 'to_py'):
        selected_years = selected_years.to_py()

    selected_years = [int(y) for y in selected_years]
    selected_layers = [str(l) for l in selected_layers]

    # 1. Compute spatial intersections
    intersections = compute_intersections(village_geojson, mws_features)
    if not intersections:
        return {'status': 'mws_unavailable', 'message': 'Village does not overlap any MWS in this tehsil.'}

    print(f'[CSVAT MWS] {len(intersections)} overlapping MWS found')
    print(f'[CSVAT MWS] Available vectors: {list(tehsil_data.keys()) if isinstance(tehsil_data, dict) else "not a dict"}')

    # 2. Extract vector-specific data from tehsil_data
    cropping_records = tehsil_data.get('croppingIntensity_annual', []) if isinstance(tehsil_data, dict) else []
    water_records = tehsil_data.get('surfaceWaterBodies_annual', []) if isinstance(tehsil_data, dict) else []
    deforest_records = tehsil_data.get('change_detection_deforestation', []) if isinstance(tehsil_data, dict) else []
    afforest_records = tehsil_data.get('change_detection_afforestation', []) if isinstance(tehsil_data, dict) else []

    # Debug: show keys from first record of each vector
    for vname, vrecs in [('cropping', cropping_records), ('water', water_records)]:
        if vrecs and isinstance(vrecs[0], dict):
            print(f'[CSVAT MWS] {vname} keys: {list(vrecs[0].keys())[:10]}')

    # 3. Aggregate per layer
    result = {'mws_count': len(intersections)}

    if 'cropping_intensity' in selected_layers and cropping_records:
        ci_data = aggregate_cropping(intersections, cropping_records, selected_years)
        result['cropping_intensity'] = {'village_name': village_name, 'data': ci_data}

    if 'surface_water' in selected_layers and water_records:
        sw_data = aggregate_surface_water(intersections, water_records, selected_years)
        result['surface_water'] = {'village_name': village_name, 'data': sw_data}

    if 'vegetation' in selected_layers and (deforest_records or afforest_records):
        veg_data = aggregate_vegetation(intersections, deforest_records, afforest_records, selected_years)
        veg_data['village_name'] = village_name
        result['vegetation'] = veg_data

    result['data_source'] = 'CoRE Stack MWS (10m resolution)'
    return result
`;

// ─── GEE Data Fetching (via Backend Proxy) ───

async function fetchGEEData(endpoint, geojson, years) {
  const resp = await fetch(`${API_BASE}/api/v1/gee/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geojson, years }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `GEE proxy error: ${resp.status}`);
  }

  const json = await resp.json();
  return json.data;
}

async function fetchAllGEEData(geojson, years) {
  const resp = await fetch(`${API_BASE}/api/v1/gee/all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geojson, years }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `GEE proxy error: ${resp.status}`);
  }

  const json = await resp.json();
  return json.data;
}

// ─── Boundary Resolution ───

export async function resolveBoundary(boundaryInfo) {
  let result;
  if (boundaryInfo.type === 'geojson') {
    result = {
      name: boundaryInfo.village_name || 'Custom Upload',
      state: boundaryInfo.state || 'Unknown',
      district: boundaryInfo.district || 'Unknown',
      tehsil: boundaryInfo.tehsil || 'Unknown',
      geojson: boundaryInfo.boundary_geojson,
      area_hectares: boundaryInfo.area_hectares || 0,
    };
  } else {
    // For admin-selected boundaries, fetch boundary from backend API
    const resp = await fetch(`${API_BASE}/api/v1/boundaries/village/${boundaryInfo.boundary_id}`);
    if (!resp.ok) {
      throw new Error(`Could not resolve boundary for ${boundaryInfo.boundary_id}. Upload a GeoJSON file instead.`);
    }

    const data = await resp.json();
    result = {
      name: data.name || boundaryInfo.village_name,
      state: data.state || boundaryInfo.state,
      district: data.district || boundaryInfo.district,
      tehsil: data.tehsil || boundaryInfo.tehsil,
      geojson: data.geojson || null,
      area_hectares: data.area_hectares || 0,
    };
  }

  // If district or tehsil is Unknown, try CoRE Stack admin-details resolution
  // using village centroid to get canonical CoRE Stack names
  if (
    result.geojson &&
    (result.district === 'Unknown' || result.tehsil === 'Unknown' || !result.district || !result.tehsil)
  ) {
    try {
      const coords = result.geojson.type === 'MultiPolygon'
        ? result.geojson.coordinates[0][0]
        : result.geojson.coordinates[0];
      const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;

      const adminResp = await fetch(`${API_BASE}/api/v1/corestack/admin-details?latitude=${lat}&longitude=${lng}`);
      if (adminResp.ok) {
        const adminData = await adminResp.json();
        const details = adminData.data || adminData;
        if (details) {
          // CoRE Stack returns canonical names — prefer them
          if (details.state) result.state = details.state;
          if (details.district) result.district = details.district;
          if (details.tehsil || details.block) result.tehsil = details.tehsil || details.block;
        }
      }
    } catch (e) {
      console.warn('CoRE Stack admin-details resolution failed:', e.message);
    }
  }

  return result;
}

// ─── Full Analytics Pipeline (MWS-First, Client-Side Pyodide WASM) ───

export async function runAnalyticsPipeline(boundaryInfo, selectedLayers, selectedYears, onProgress) {
  // Step 1: Resolve boundary
  onProgress?.('Resolving village boundary…');
  const boundary = await resolveBoundary(boundaryInfo);

  if (!boundary.geojson && !boundaryInfo.boundary_geojson) {
    throw new Error('Could not resolve village boundary. Please upload a GeoJSON file.');
  }

  const geojson = boundary.geojson || boundaryInfo.boundary_geojson;
  boundary.geojson = geojson;
  const sortedYears = [...selectedYears].sort((a, b) => a - b);

  // Step 2: Try MWS intersection (client-side via Pyodide WASM)
  onProgress?.('Checking CoRE Stack data availability…');
  try {
    const mwsResponse = await tryMWSAnalytics(boundary, selectedLayers, sortedYears, onProgress);

    if (mwsResponse.status === 'success' && mwsResponse.data) {
      onProgress?.('CoRE Stack analytics complete!');
      const results = mwsResponse.data;
      results.data_source = results.data_source || 'CoRE Stack MWS (10m resolution)';
      results.mws_count = mwsResponse.mws_count;

      // Log discovered keys for debugging zero-output issues
      if (results.discovered_keys) {
        console.log('[CSVAT] CoRE Stack data keys:', results.discovered_keys);
      }
      return results;
    }

    // MWS not available — throw special error so Dashboard can prompt user
    throw new MWSUnavailableError(
      mwsResponse.message || 'Village not available on CoRE Stack.',
      boundary,
    );
  } catch (err) {
    if (err instanceof MWSUnavailableError) {
      throw err; // Re-throw so Dashboard catches it
    }
    // Network/server error trying MWS — also prompt for GEE
    console.error('[CSVAT] MWS pipeline error:', err);
    throw new MWSUnavailableError(
      `CoRE Stack unavailable: ${err.message}. Would you like to use GEE instead?`,
      boundary,
    );
  }
}

// ─── GEE Fallback Pipeline (called after user confirms) ───

export async function runGEEFallbackPipeline(boundary, selectedLayers, selectedYears, onProgress) {
  const geojson = boundary.geojson;
  const villageName = boundary.name || 'Unknown';
  const sortedYears = [...selectedYears].sort((a, b) => a - b);

  const results = {
    village_name: villageName,
    state: boundary.state,
    district: boundary.district,
    tehsil: boundary.tehsil,
  };

  // Fetch real data from GEE proxy + Pyodide compute
  onProgress?.('Fetching satellite data from Google Earth Engine…');
  const geeData = await fetchAllGEEData(geojson, sortedYears);

  const hasAnyData = geeData && (geeData.lulc || geeData.water || geeData.ndvi);
  if (!hasAnyData) {
    throw new Error('GEE returned no usable data. Please check your boundary and try again.');
  }

  onProgress?.('GEE data received. Loading Pyodide (Python WASM)…');

  // Run analytics via Pyodide
  const { runCroppingAnalysis, runWaterAnalysis, runVegetationAnalysis } =
    await import('./pyodideEngine');

  if (selectedLayers.includes('cropping_intensity') && geeData.lulc) {
    results.cropping_intensity = await runCroppingAnalysis(
      geeData.lulc, villageName, sortedYears, onProgress
    );
  }
  if (selectedLayers.includes('surface_water') && geeData.water) {
    results.surface_water = await runWaterAnalysis(
      geeData.water, villageName, sortedYears, onProgress
    );
  }
  if (selectedLayers.includes('vegetation') && geeData.ndvi) {
    results.vegetation = await runVegetationAnalysis(
      geeData.ndvi, villageName, sortedYears, onProgress
    );
  }

  results.data_source = 'GEE + Pyodide WASM (500m resolution)';
  results.data_warning =
    'This area is not yet available on CoRE Stack. ' +
    'Results are computed from lower-resolution satellite data (MODIS 500m).';
  return results;
}

// ─── CSV Export (Client-Side) ───
export function generateCSV(results) {
  const lines = [];
  const add = (...cols) => lines.push(cols.join(','));

  add('CSVAT Village Analytics Report');
  add('Village', results.village_name);
  add('State', results.state);
  add('District', results.district);
  add('Tehsil', results.tehsil);
  add('Data Source', results.data_source || 'Unknown');
  add('');

  if (results.cropping_intensity?.data) {
    add('=== Cropping Intensity ===');
    add('Year', 'Single Crop (ha)', 'Double Crop (ha)', 'Triple Crop (ha)', 'Total (ha)');
    for (const r of results.cropping_intensity.data) {
      add(r.year, r.single_crop_ha, r.double_crop_ha, r.triple_crop_ha, r.total_cropped_ha);
    }
    add('');
  }

  if (results.surface_water?.data) {
    add('=== Surface Water ===');
    add('Year', 'Perennial (ha)', 'Monsoon (ha)', 'Winter (ha)', 'Total (ha)');
    for (const r of results.surface_water.data) {
      add(r.year, r.perennial_ha, r.seasonal_monsoon_ha, r.seasonal_winter_ha, r.total_water_ha);
    }
    add('');
  }

  if (results.vegetation) {
    add('=== Vegetation ===');
    add('Year', 'Tree Cover (ha)');
    for (const r of results.vegetation.yearly_data) {
      add(r.year, r.tree_cover_ha);
    }
    add('Net Change (ha)', results.vegetation.net_change_ha);
    add('Degraded Land (ha)', results.vegetation.degraded_land_ha);
  }

  return lines.join('\n');
}

// ─── HTML Report Generation (Client-Side) ───
export function generateHTMLReport(results) {
  const ci = results.cropping_intensity;
  const sw = results.surface_water;
  const vg = results.vegetation;
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const source = results.data_source || 'GEE + Pyodide WASM';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>CSVAT Report — ${results.village_name}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0f172a;--card:rgba(30,41,59,.8);--text:#f1f5f9;--muted:#94a3b8;--green:#22c55e;--blue:#3b82f6;--amber:#f59e0b;--red:#ef4444;--teal:#14b8a6;--border:rgba(148,163,184,.15)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#0f172a,#1e293b,#0f172a);color:var(--text);min-height:100vh;padding:2rem}
.c{max-width:1200px;margin:0 auto}.hdr{text-align:center;padding:3rem 2rem;background:var(--card);border-radius:20px;border:1px solid var(--border);backdrop-filter:blur(20px);margin-bottom:2rem}
.hdr h1{font-size:2.2rem;background:linear-gradient(135deg,var(--green),var(--teal));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.meta{display:flex;justify-content:center;gap:2rem;margin-top:1.5rem;flex-wrap:wrap}
.mi{background:rgba(255,255,255,.05);padding:.75rem 1.5rem;border-radius:12px;border:1px solid var(--border)}
.mi label{color:var(--muted);font-size:.8rem;text-transform:uppercase}.mi span{display:block;font-weight:600}
.sec{background:var(--card);border-radius:16px;border:1px solid var(--border);backdrop-filter:blur(20px);margin-bottom:2rem;padding:2rem}
.sec h2{font-size:1.4rem;margin-bottom:1rem;padding-bottom:.75rem;border-bottom:1px solid var(--border)}
.cc{position:relative;height:350px;margin:1.5rem 0}
.sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-top:1rem}
.sc{background:rgba(255,255,255,.05);padding:1.25rem;border-radius:14px;border:1px solid var(--border);text-align:center}
.sc .v{font-size:1.8rem;font-weight:700}.sc .l{color:var(--muted);font-size:.85rem;margin-top:.25rem}
.pos{color:var(--green)}.neg{color:var(--red)}.neu{color:var(--blue)}.warn{color:var(--amber)}
.nar{color:var(--muted);line-height:1.7;font-size:.95rem;margin-top:1rem}
table{width:100%;border-collapse:collapse;margin-top:1rem}
th,td{padding:.75rem 1rem;text-align:right;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:500;font-size:.85rem;text-transform:uppercase}
th:first-child,td:first-child{text-align:left}
.ft{text-align:center;padding:2rem;color:var(--muted);font-size:.85rem}
.src{background:rgba(34,197,94,.1);color:var(--green);padding:.5rem 1rem;border-radius:8px;display:inline-block;font-size:.8rem;font-weight:500;margin-top:.75rem}
</style></head><body><div class="c">
<div class="hdr"><h1>🌾 Village Analytics Report</h1>
<p style="color:var(--muted);margin-top:.5rem">${results.village_name} — Socio-Ecological Analysis</p>
<div class="src">📡 Data: ${source}</div>
<div class="meta">
<div class="mi"><label>State</label><span>${results.state}</span></div>
<div class="mi"><label>District</label><span>${results.district}</span></div>
<div class="mi"><label>Tehsil</label><span>${results.tehsil}</span></div>
<div class="mi"><label>Generated</label><span>${now}</span></div>
<div class="mi"><label>Engine</label><span>Pyodide WASM</span></div>
</div></div>
${ci ? `<div class="sec"><h2>🌱 Cropping Intensity Trends</h2>
<div class="cc"><canvas id="ciChart"></canvas></div>
<table><thead><tr><th>Year</th><th>Single (ha)</th><th>Double (ha)</th><th>Triple (ha)</th><th>Total (ha)</th></tr></thead>
<tbody>${ci.data.map(d=>`<tr><td>${d.year}</td><td>${d.single_crop_ha}</td><td>${d.double_crop_ha}</td><td>${d.triple_crop_ha}</td><td>${d.total_cropped_ha}</td></tr>`).join('')}</tbody></table>
<p class="nar">Cropping intensity computed from MODIS LULC (MCD12Q1) via Pyodide WASM.</p></div>` : ''}
${sw ? `<div class="sec"><h2>💧 Surface Water Availability</h2>
<div class="cc"><canvas id="swChart"></canvas></div>
<table><thead><tr><th>Year</th><th>Perennial (ha)</th><th>Monsoon (ha)</th><th>Winter (ha)</th><th>Total (ha)</th></tr></thead>
<tbody>${sw.data.map(d=>`<tr><td>${d.year}</td><td>${d.perennial_ha}</td><td>${d.seasonal_monsoon_ha}</td><td>${d.seasonal_winter_ha}</td><td>${d.total_water_ha}</td></tr>`).join('')}</tbody></table>
<p class="nar">Surface water analysis from JRC Global Surface Water via Pyodide WASM.</p></div>` : ''}
${vg ? `<div class="sec"><h2>🌳 Vegetation & Degradation</h2>
<div class="sg">
<div class="sc"><div class="v neu">${vg.tree_cover_start_ha}</div><div class="l">Tree Cover ${vg.start_year} (ha)</div></div>
<div class="sc"><div class="v neu">${vg.tree_cover_end_ha}</div><div class="l">Tree Cover ${vg.end_year} (ha)</div></div>
<div class="sc"><div class="v ${vg.net_change_ha>=0?'pos':'neg'}">${vg.net_change_ha}</div><div class="l">Net Change (ha)</div></div>
<div class="sc"><div class="v warn">${vg.degraded_land_ha}</div><div class="l">Degraded (ha)</div></div>
</div>
<div class="cc"><canvas id="vgChart"></canvas></div>
<p class="nar">Between ${vg.start_year} and ${vg.end_year}, ${vg.net_change_ha<0?'net loss':'net gain'} of ${Math.abs(vg.net_change_ha)} ha of tree cover. Estimated ${vg.degraded_land_ha} ha degraded. Source: MODIS NDVI.</p></div>` : ''}
<div class="ft"><p>Generated by CSVAT — ${source}</p><p>${now}</p></div>
</div>
<script>
Chart.defaults.color='#94a3b8';Chart.defaults.borderColor='rgba(148,163,184,.15)';
${ci ? `new Chart(document.getElementById('ciChart'),{type:'bar',data:{labels:${JSON.stringify(ci.data.map(d=>d.year))},datasets:[{label:'Single Crop',data:${JSON.stringify(ci.data.map(d=>d.single_crop_ha))},backgroundColor:'rgba(34,197,94,.7)',borderRadius:6},{label:'Double Crop',data:${JSON.stringify(ci.data.map(d=>d.double_crop_ha))},backgroundColor:'rgba(59,130,246,.7)',borderRadius:6},{label:'Triple Crop',data:${JSON.stringify(ci.data.map(d=>d.triple_crop_ha))},backgroundColor:'rgba(245,158,11,.7)',borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true,title:{display:true,text:'Area (Hectares)'}}}}});` : ''}
${sw ? `new Chart(document.getElementById('swChart'),{type:'bar',data:{labels:${JSON.stringify(sw.data.map(d=>d.year))},datasets:[{label:'Perennial',data:${JSON.stringify(sw.data.map(d=>d.perennial_ha))},backgroundColor:'rgba(59,130,246,.8)',borderRadius:6},{label:'Monsoon',data:${JSON.stringify(sw.data.map(d=>d.seasonal_monsoon_ha))},backgroundColor:'rgba(20,184,166,.7)',borderRadius:6},{label:'Winter',data:${JSON.stringify(sw.data.map(d=>d.seasonal_winter_ha))},backgroundColor:'rgba(147,197,253,.6)',borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{title:{display:true,text:'Area (Hectares)'}}}}});` : ''}
${vg ? `new Chart(document.getElementById('vgChart'),{type:'line',data:{labels:${JSON.stringify(vg.yearly_data.map(d=>d.year))},datasets:[{label:'Tree Cover (ha)',data:${JSON.stringify(vg.yearly_data.map(d=>d.tree_cover_ha))},borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.15)',fill:true,tension:.3,pointRadius:5,pointBackgroundColor:'#22c55e'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{title:{display:true,text:'Area (Hectares)'}}}}});` : ''}
</script></body></html>`;
}
