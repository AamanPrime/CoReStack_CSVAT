/**
 * CSVAT — Raster Analytics Engine (TRUE Client-Side Computation).
 *
 * The backend extracts raw pixel data (histograms + masked pixel arrays)
 * using rasterio windowed reading — this is pure DATA ACQUISITION, not
 * computation (like reading bytes from a file).
 *
 * ALL analytics computation runs client-side in Pyodide (Python WASM):
 *   - Cropping intensity (GCA/NSA formula)
 *   - Vegetation change detection (deforestation transitions)
 *   - Crop intensity change detection
 *
 * Surface water comes from the tehsil vector API via MWS intersection,
 * also computed client-side in Pyodide.
 *
 * The LULC level 3 raster contains ALL classes (1-12):
 *   - Cropping: 8=Single Kharif, 9=Single Non-Kharif, 10=Double, 11=Triple
 *   - Water: 2=Kharif, 3=Kharif+Rabi, 4=Perennial
 *   - Vegetation: 6=Trees, 12=Shrubs
 *   - Other: 1=Built Up, 5=Crops, 7=Barren
 */

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '');

// ─── Python analytics code (runs in Pyodide — ALL computation is here) ───
const RASTER_ANALYTICS_PYTHON = `
import numpy as np

def compute_raster_analytics(extracted_data, pixel_area_ha):
    """Compute ALL raster analytics from extracted pixel data.
    
    extracted_data: list of {fiscal_year, histogram: {cls: count}, masked_pixels: [int,...]}
    pixel_area_ha: area per pixel in hectares
    
    This is the ONLY computation — the server just extracted raw pixels.
    """
    if hasattr(extracted_data, 'to_py'):
        extracted_data = extracted_data.to_py()
    pxha = float(pixel_area_ha)
    
    # Transition labels for deforestation (matches server-side exactly)
    TRANSITION_LABELS = {
        1: 'Built Up', 2: 'Kharif Water', 3: 'Kharif+Rabi Water',
        4: 'Perennial Water', 6: 'Forest', 7: 'Barren',
        8: 'Farm', 9: 'Farm', 10: 'Farm', 11: 'Farm',
        12: 'Scrub Land',
    }
    
    cropping_results = []
    surface_water_results = []
    vegetation_data = []
    raw_histograms = {}
    pixel_arrays = {}
    
    for entry in extracted_data:
        fy = entry['fiscal_year']
        histogram = entry.get('histogram', {})
        pixels = entry.get('masked_pixels', [])
        
        # Convert histogram keys to int
        hist = {}
        for k, v in histogram.items():
            hist[int(k)] = int(v)
        
        raw_histograms[fy] = hist
        pixel_arrays[fy] = np.array(pixels, dtype=np.float32) if pixels else np.array([])
        
        # Cropping metrics (same formula as server-side raster_proxy.py)
        single_k = hist.get(8, 0) * pxha
        single_nk = hist.get(9, 0) * pxha
        double = hist.get(10, 0) * pxha
        triple = hist.get(11, 0) * pxha
        single = single_k + single_nk
        total_crop = single + double + triple
        trees = hist.get(6, 0) * pxha
        
        # GCA / NSA intensity (identical to server)
        gca = single + double * 2 + triple * 3
        intensity_idx = round(gca / total_crop, 3) if total_crop > 0 else 0
        
        cropping_results.append({
            'fiscal_year': fy,
            'single_crop_ha': round(single, 2),
            'double_crop_ha': round(double, 2),
            'triple_crop_ha': round(triple, 2),
            'total_cropped_ha': round(total_crop, 2),
            'intensity_index': intensity_idx,
            'trees_ha': round(trees, 2),
        })
        
        # ── Surface water from LULC classes: 2=Kharif, 3=Kharif+Rabi, 4=Perennial ──
        kharif_water = hist.get(2, 0) * pxha
        kharif_rabi_water = hist.get(3, 0) * pxha
        perennial_water = hist.get(4, 0) * pxha
        total_water = kharif_water + kharif_rabi_water + perennial_water
        
        surface_water_results.append({
            'fiscal_year': fy,
            'kharif_ha': round(kharif_water, 2),
            'rabi_ha': round(kharif_rabi_water, 2),
            'zaid_ha': round(perennial_water, 2),
            'total_water_ha': round(total_water, 2),
        })
        
        vegetation_data.append({
            'fiscal_year': fy,
            'tree_cover_ha': round(trees, 2),
        })
    
    # ── Vegetation change analysis (first vs last year) ──
    vegetation_analysis = {}
    sorted_fys = sorted(pixel_arrays.keys())
    if len(sorted_fys) >= 2:
        first_fy, last_fy = sorted_fys[0], sorted_fys[-1]
        a = pixel_arrays[first_fy]
        b = pixel_arrays[last_fy]
        min_len = min(len(a), len(b))
        
        if min_len > 0:
            a, b = a[:min_len], b[:min_len]
            valid = ~np.isnan(a) & ~np.isnan(b)
            
            tree_a = (a == 6) & valid
            tree_b = (b == 6) & valid
            tree_ha_first = round(int(np.sum(tree_a)) * pxha, 2)
            tree_ha_last = round(int(np.sum(tree_b)) * pxha, 2)
            
            # Deforestation: tree -> non-tree
            lost = tree_a & (b != 6)
            lost_vals = b[lost]
            transitions = []
            degraded_total = 0.0
            
            for cls in np.unique(lost_vals):
                if np.isnan(cls):
                    continue
                ci = int(cls)
                area = round(int(np.sum(lost_vals == cls)) * pxha, 2)
                label = TRANSITION_LABELS.get(ci, f'Class {ci}')
                existing = [t for t in transitions if t['to_label'] == label]
                if existing:
                    existing[0]['area_ha'] = round(existing[0]['area_ha'] + area, 2)
                else:
                    transitions.append({
                        'from_class': 'Forest', 'to_label': label,
                        'to_class': ci, 'area_ha': area
                    })
                degraded_total += area
            
            # Afforestation: non-tree -> tree
            gained = ~tree_a & tree_b & valid
            afforestation = round(int(np.sum(gained)) * pxha, 2)
            
            # Retention: tree -> tree
            retained = tree_a & tree_b
            retained_ha = round(int(np.sum(retained)) * pxha, 2)
            transitions.insert(0, {
                'from_class': 'Forest', 'to_label': 'Forest',
                'to_class': 6, 'area_ha': retained_ha
            })
            transitions.sort(key=lambda x: x['area_ha'], reverse=True)
            
            vegetation_analysis = {
                'start_year': first_fy,
                'end_year': last_fy,
                'tree_cover_start_ha': tree_ha_first,
                'tree_cover_end_ha': tree_ha_last,
                'net_change_ha': round(tree_ha_last - tree_ha_first, 2),
                'afforestation_ha': afforestation,
                'deforestation_ha': round(degraded_total, 2),
                'degraded_land_ha': round(degraded_total, 2),
                'transitions': transitions,
            }
    
    # ── Crop intensity change (first vs last year) ──
    crop_intensity_change = []
    if len(sorted_fys) >= 2 and len(pixel_arrays.get(sorted_fys[0], np.array([]))) > 0:
        a = pixel_arrays[sorted_fys[0]]
        b = pixel_arrays[sorted_fys[-1]]
        min_len = min(len(a), len(b))
        if min_len > 0:
            a, b = a[:min_len], b[:min_len]
            valid = ~np.isnan(a) & ~np.isnan(b)
            
            def crop_level(arr):
                out = np.zeros_like(arr, dtype=np.int8)
                out[(arr == 8) | (arr == 9)] = 1
                out[arr == 10] = 2
                out[arr == 11] = 3
                return out
            
            lev_a, lev_b = crop_level(a), crop_level(b)
            NAMES = {0: 'Non-Crop', 1: 'Single', 2: 'Double', 3: 'Triple'}
            total_upgrade = 0
            
            for fl in range(1, 4):
                for tl in range(1, 4):
                    count = int(np.sum((lev_a == fl) & (lev_b == tl) & valid))
                    if count == 0:
                        continue
                    label = f'{NAMES[fl]} To {NAMES[tl]}'
                    area = round(count * pxha, 2)
                    crop_intensity_change.append({'category': label, 'area_ha': area})
                    if tl > fl:
                        total_upgrade += area
            
            crop_intensity_change.sort(key=lambda x: x['area_ha'], reverse=True)
            if total_upgrade > 0:
                crop_intensity_change.insert(0, {
                    'category': 'Total Change CropIntensity',
                    'area_ha': round(total_upgrade, 2)
                })
    
    return {
        'status': 'ok',
        'cropping_intensity': sorted(cropping_results, key=lambda x: x['fiscal_year']),
        'surface_water': sorted(surface_water_results, key=lambda x: x['fiscal_year']),
        'vegetation': sorted(vegetation_data, key=lambda x: x['fiscal_year']),
        'vegetation_analysis': vegetation_analysis,
        'crop_intensity_change': crop_intensity_change,
        'raw_histograms': raw_histograms,
        'data_source': 'CoRE Stack Raster (10m)',
        'processing': 'Client-side computation (Pyodide WASM)',
    }
`;

// ─── MWS water aggregation Python code ───
const WATER_MWS_PYTHON = `
try:
    from shapely.geometry import shape as shapely_shape
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

def _bbox(coords_list):
    xs, ys = [], []
    for ring in coords_list:
        for c in ring: xs.append(c[0]); ys.append(c[1])
    return [min(xs), min(ys), max(xs), max(ys)]

def _bbox_overlap(b1, b2):
    ix0, iy0 = max(b1[0], b2[0]), max(b1[1], b2[1])
    ix1, iy1 = min(b1[2], b2[2]), min(b1[3], b2[3])
    if ix0 >= ix1 or iy0 >= iy1: return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    mws_area = (b2[2] - b2[0]) * (b2[3] - b2[1])
    return inter / mws_area if mws_area > 0 else 0.0

def compute_intersections(village_geojson, mws_features):
    intersections = []
    if HAS_SHAPELY:
        village_shape = shapely_shape(village_geojson)
        if not village_shape.is_valid: village_shape = village_shape.buffer(0)
        for feat in mws_features:
            geom = feat.get('geometry')
            props = feat.get('properties', {})
            if not geom: continue
            mws_shape = shapely_shape(geom)
            if not mws_shape.is_valid: mws_shape = mws_shape.buffer(0)
            if not village_shape.intersects(mws_shape): continue
            overlap = village_shape.intersection(mws_shape)
            if overlap.is_empty: continue
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
            if not geom: continue
            gtype = geom.get('type', '')
            m_coords = geom['coordinates'][0] if gtype == 'MultiPolygon' else geom['coordinates']
            frac = _bbox_overlap(v_bbox, _bbox(m_coords))
            if frac <= 0: continue
            uid = str(props.get('uid', '') or props.get('mws_uid', '') or props.get('UID', ''))
            intersections.append({'mws_uid': uid, 'overlap_fraction': round(frac, 6)})
    return intersections

def build_uid_lookup(records):
    lookup = {}
    for rec in records:
        uid = str(rec.get('uid', '') or rec.get('mws_uid', '') or rec.get('UID', ''))
        if uid: lookup[uid] = dict(rec)
    return lookup

def weighted_aggregate(intersections, data_by_uid, key, mode='sum'):
    total_weight = 0.0
    weighted_sum = 0.0
    for ix in intersections:
        uid = ix['mws_uid']
        frac = ix['overlap_fraction']
        val = data_by_uid.get(uid, {}).get(key)
        if val is None: continue
        try: val = float(val)
        except: continue
        weighted_sum += val * frac
        total_weight += frac
    if total_weight == 0: return None
    return round(weighted_sum, 4) if mode == 'sum' else round(weighted_sum / total_weight, 4)

def aggregate_water_mws(village_geojson, mws_features, water_records, years):
    if hasattr(village_geojson, 'to_py'): village_geojson = village_geojson.to_py()
    if hasattr(mws_features, 'to_py'): mws_features = mws_features.to_py()
    if hasattr(water_records, 'to_py'): water_records = water_records.to_py()
    if hasattr(years, 'to_py'): years = years.to_py()
    intersections = compute_intersections(village_geojson, mws_features)
    if not intersections: return []
    data_by_uid = build_uid_lookup(water_records)
    results = []
    for year in sorted(int(y) for y in years):
        fy = f"{year-1}-{year}"
        kharif = weighted_aggregate(intersections, data_by_uid, f'kharif_area_in_ha_{fy}', 'sum')
        rabi = weighted_aggregate(intersections, data_by_uid, f'rabi_area_in_ha_{fy}', 'sum')
        zaid = weighted_aggregate(intersections, data_by_uid, f'zaid_area_in_ha_{fy}', 'sum')
        total = weighted_aggregate(intersections, data_by_uid, f'total_area_in_ha_{fy}', 'sum')
        results.append({
            'fiscal_year': f'20{str(year-1)[-2:]}-{str(year)[-2:]}',
            'kharif_ha': round(kharif or 0.0, 2),
            'rabi_ha': round(rabi or 0.0, 2),
            'zaid_ha': round(zaid or 0.0, 2),
            'total_water_ha': round(total or ((kharif or 0) + (rabi or 0) + (zaid or 0)), 2),
        })
    return results
`;

/**
 * Run raster analytics: backend extracts pixels, browser computes ALL stats.
 */
export async function runRasterAnalytics(boundary, selectedLayers, selectedYears, onProgress) {
  const { state, district, tehsil, boundary_geojson: villageGeojson } = boundary;
  const villageName = boundary.village_name || boundary.name || 'Village';

  // Step 1: Backend extracts raw pixel data from GEE IndiaSAT LULC v3 (all years)
  onProgress?.('Extracting pixel data from GEE IndiaSAT LULC v3 (all years)…');
  const extractResp = await fetch(`${API_BASE}/api/v1/raster/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      village_geojson: villageGeojson,
    }),
  });

  if (!extractResp.ok) {
    const errText = await extractResp.text();
    throw new Error(`Pixel extraction failed (${extractResp.status}): ${errText}`);
  }

  const extractResult = await extractResp.json();
  if (extractResult.status !== 'ok' || !extractResult.data?.length) {
    throw new Error('No pixel data could be extracted from rasters.');
  }

  const pixelAreaHa = extractResult.pixel_area_ha;
  onProgress?.(`Extracted ${extractResult.years_extracted} years of data. Loading Python WASM for computation…`);

  // Step 3: Load Pyodide for client-side computation
  const { loadPyodide, deepConvertPyodide } = await import('./pyodideEngine');
  const pyodide = await loadPyodide(onProgress);

  // Step 4: Run ALL analytics computation in Pyodide (browser-side)
  onProgress?.('Running raster analytics computation (Python WASM — 100% client-side)…');
  await pyodide.runPythonAsync(RASTER_ANALYTICS_PYTHON);

  pyodide.globals.set('extracted_data', pyodide.toPy(extractResult.data));
  pyodide.globals.set('pixel_area_ha', pixelAreaHa);

  const rawResult = await pyodide.runPythonAsync(`
compute_raster_analytics(extracted_data, pixel_area_ha)
  `);

  // Convert Pyodide result → plain JS
  let pyResult = typeof deepConvertPyodide === 'function'
    ? deepConvertPyodide(rawResult)
    : (rawResult?.toJs?.({ dict_converter: Object.fromEntries }) ?? rawResult);
  pyResult = JSON.parse(JSON.stringify(pyResult, (_k, v) =>
    v instanceof Map ? Object.fromEntries(v) : v
  ));

  if (pyResult.status !== 'ok') {
    throw new Error('Client-side raster computation failed');
  }

  // Step 5: Surface water via MWS intersection (also client-side via Pyodide)
  let waterData = null;
  if (state && district && tehsil) {
    try {
      onProgress?.('Computing surface water via MWS intersection (Pyodide)…');

      // Install Shapely for polygon intersection
      try {
        await pyodide.runPythonAsync(`import micropip; await micropip.install('shapely')`);
      } catch { try { await pyodide.loadPackage('shapely'); } catch {} }

      await pyodide.runPythonAsync(WATER_MWS_PYTHON);

      const [mwsResp, tehsilResp] = await Promise.all([
        fetch(`${API_BASE}/api/v1/corestack/mws-geometries?state=${enc(state)}&district=${enc(district)}&tehsil=${enc(tehsil)}`),
        fetch(`${API_BASE}/api/v1/corestack/tehsil-data?state=${enc(state)}&district=${enc(district)}&tehsil=${enc(tehsil)}`),
      ]);

      if (mwsResp.ok && tehsilResp.ok) {
        const mwsJson = await mwsResp.json();
        const tehsilJson = await tehsilResp.json();
        let mwsFeatures = [];
        const mwsData = mwsJson.data;
        if (mwsData?.type === 'FeatureCollection') mwsFeatures = mwsData.features || [];
        else if (Array.isArray(mwsData)) mwsFeatures = mwsData;

        const waterRecords = tehsilJson.data?.surfaceWaterBodies_annual || [];

        if (mwsFeatures.length > 0 && waterRecords.length > 0) {
          pyodide.globals.set('w_village', pyodide.toPy(villageGeojson));
          pyodide.globals.set('w_mws', pyodide.toPy(mwsFeatures));
          pyodide.globals.set('w_records', pyodide.toPy(waterRecords));
          pyodide.globals.set('w_years', pyodide.toPy(selectedYears));

          const waterRaw = await pyodide.runPythonAsync(`
aggregate_water_mws(w_village, w_mws, w_records, w_years)
          `);

          let waterResult = typeof deepConvertPyodide === 'function'
            ? deepConvertPyodide(waterRaw)
            : (waterRaw?.toJs?.({ dict_converter: Object.fromEntries }) ?? waterRaw);
          waterResult = JSON.parse(JSON.stringify(waterResult, (_k, v) =>
            v instanceof Map ? Object.fromEntries(v) : v
          ));

          if (Array.isArray(waterResult) && waterResult.length > 0) {
            waterData = waterResult;
          }
        }
      }
    } catch (e) {
      console.warn('[Raster WASM] Water MWS aggregation failed:', e.message);
    }
  }

  onProgress?.('Building report…');

  // Step 6: Transform into standard CSVAT report schema
  const results = {
    village_name: villageName,
    state, district, tehsil,
    data_source: pyResult.data_source || 'CoRE Stack Raster (10m)',
    compute_mode: 'client_raster_wasm',
    years: selectedYears,
    area_hectares: boundary.area_hectares || 0,
  };

  if (pyResult.cropping_intensity?.length > 0) {
    results.cropping_intensity = {
      village_name: villageName,
      data: pyResult.cropping_intensity.map(r => ({
        year: r.fiscal_year, fiscal_year: r.fiscal_year,
        single_crop_ha: r.single_crop_ha, double_crop_ha: r.double_crop_ha,
        triple_crop_ha: r.triple_crop_ha, total_cropped_ha: r.total_cropped_ha,
        cropping_intensity: r.intensity_index,
      })),
      source: pyResult.data_source,
      processing: pyResult.processing,
    };
  }

  // Surface water: use raster-derived if it has actual data, else fall back to MWS vector
  const rasterWaterHasData = pyResult.surface_water?.some(r => r.total_water_ha > 0);

  if (rasterWaterHasData) {
    results.surface_water = {
      village_name: villageName,
      data: pyResult.surface_water.map(r => ({
        year: r.fiscal_year, fiscal_year: r.fiscal_year,
        kharif_ha: r.kharif_ha, rabi_ha: r.rabi_ha,
        zaid_ha: r.zaid_ha, total_water_ha: r.total_water_ha,
      })),
      source: 'IndiaSAT LULC v3 Raster (10m)',
      processing: 'Client-side raster class extraction (Pyodide WASM)',
    };
  } else if (waterData) {
    // LULC raster had no water pixels — use MWS vector water (captures smaller bodies)
    results.surface_water = {
      village_name: villageName,
      data: waterData.map(r => ({
        year: r.fiscal_year, fiscal_year: r.fiscal_year,
        kharif_ha: r.kharif_ha, rabi_ha: r.rabi_ha,
        zaid_ha: r.zaid_ha, total_water_ha: r.total_water_ha,
      })),
      source: 'CoRE Stack MWS Vector (surfaceWaterBodies_annual)',
      processing: 'Client-side MWS intersection (Pyodide/Shapely)',
    };
  }

  if (pyResult.vegetation?.length > 0) {
    const vegData = pyResult.vegetation;
    const first = vegData[0], last = vegData[vegData.length - 1];
    results.vegetation = {
      village_name: villageName,
      start_year: first.fiscal_year, end_year: last.fiscal_year,
      tree_cover_start_ha: first.tree_cover_ha,
      tree_cover_end_ha: last.tree_cover_ha,
      net_change_ha: +(last.tree_cover_ha - first.tree_cover_ha).toFixed(2),
      yearly_data: vegData.map(v => ({ year: v.fiscal_year, tree_cover_ha: v.tree_cover_ha })),
      source: pyResult.data_source,
    };
  }

  if (pyResult.vegetation_analysis && Object.keys(pyResult.vegetation_analysis).length > 0) {
    const va = pyResult.vegetation_analysis;
    results.vegetation = {
      ...results.vegetation,
      start_year: va.start_year, end_year: va.end_year,
      tree_cover_start_ha: va.tree_cover_start_ha,
      tree_cover_end_ha: va.tree_cover_end_ha,
      net_change_ha: va.net_change_ha,
      afforestation_ha: va.afforestation_ha,
      deforestation_ha: va.deforestation_ha,
      tree_cover_loss_ha: va.deforestation_ha,
      tree_cover_gain_ha: va.afforestation_ha,
      degraded_land_ha: va.degraded_land_ha,
      transitions: va.transitions?.map(t => ({
        from_class: t.from_class, to_label: t.to_label,
        to_class: t.to_class, area_ha: t.area_ha,
      })) || [],
    };
  }

  if (pyResult.crop_intensity_change?.length > 0) {
    results.crop_intensity_change = pyResult.crop_intensity_change;
  }

  if (pyResult.raw_histograms) {
    results.raw_histograms = pyResult.raw_histograms;
    console.log('[Raster WASM] Raw histograms:', pyResult.raw_histograms);
  }

  const hasCropData = results.cropping_intensity?.data?.length > 0;
  const hasWaterData = results.surface_water?.data?.length > 0;
  if (!hasCropData && !hasWaterData) {
    throw new Error('No raster data could be processed.');
  }

  onProgress?.('Raster analytics complete! (computation: 100% client-side)');
  return results;
}

// ─── Helpers ───

function enc(s) { return encodeURIComponent(s); }

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
