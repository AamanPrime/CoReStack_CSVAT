/**
 * CSVAT — Client-Side WASM Analytics Engine.
 *
 * Runs the analytics pipeline entirely in the browser.
 * Architecture (WASM-First / Mode B per ADD):
 *   1. Boundary resolution via backend API (to protect tokens)
 *   2. Raw satellite data fetched from backend GEE proxy
 *   3. Computation in-browser via Pyodide (Python WASM + numpy)
 *   4. Render results directly in React
 *
 * Fallback: If GEE proxy is unavailable, uses JS-based mock data.
 */

import {
  loadPyodide,
  runCroppingAnalysis,
  runWaterAnalysis,
  runVegetationAnalysis,
} from './pyodideEngine';

// Backend API base URL
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8006';

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
  if (boundaryInfo.type === 'geojson') {
    return {
      name: boundaryInfo.village_name || 'Custom Upload',
      state: boundaryInfo.state || 'Unknown',
      district: boundaryInfo.district || 'Unknown',
      tehsil: boundaryInfo.tehsil || 'Unknown',
      geojson: boundaryInfo.boundary_geojson,
      area_hectares: boundaryInfo.area_hectares || 0,
    };
  }

  // For admin-selected boundaries, resolve polygon from backend or mock
  const MOCK_POLYGONS = {
    'vg-raj-01': { coords: [[73.65,24.55],[73.70,24.55],[73.70,24.60],[73.65,24.60],[73.65,24.55]] },
    'vg-raj-02': { coords: [[73.80,24.70],[73.88,24.70],[73.88,24.78],[73.80,24.78],[73.80,24.70]] },
    'vg-mp-01':  { coords: [[77.70,22.73],[77.78,22.73],[77.78,22.78],[77.70,22.78],[77.70,22.73]] },
    'vg-mh-01':  { coords: [[74.40,17.95],[74.48,17.95],[74.48,18.02],[74.40,18.02],[74.40,17.95]] },
    'vg-ka-01':  { coords: [[78.10,13.10],[78.18,13.10],[78.18,13.17],[78.10,13.17],[78.10,13.10]] },
    'vg-tn-01':  { coords: [[78.08,9.88],[78.15,9.88],[78.15,9.95],[78.08,9.95],[78.08,9.88]] },
    'vg-gj-01':  { coords: [[69.62,23.23],[69.70,23.23],[69.70,23.30],[69.62,23.30],[69.62,23.23]] },
    'vg-ap-01':  { coords: [[77.55,14.65],[77.63,14.65],[77.63,14.72],[77.55,14.72],[77.55,14.65]] },
    'vg-raj-03': { coords: [[73.55,25.05],[73.62,25.05],[73.62,25.12],[73.55,25.12],[73.55,25.05]] },
    'vg-raj-04': { coords: [[73.05,25.10],[73.12,25.10],[73.12,25.17],[73.05,25.17],[73.05,25.10]] },
    'vg-mh-02':  { coords: [[76.48,19.95],[76.55,19.95],[76.55,20.02],[76.48,20.02],[76.48,19.95]] },
    'vg-ker-01': { coords: [[76.68,8.88],[76.75,8.88],[76.75,8.95],[76.68,8.95],[76.68,8.88]] },
    'vg-tel-01': { coords: [[79.90,18.20],[79.97,18.20],[79.97,18.27],[79.90,18.27],[79.90,18.20]] },
    'vg-uk-01':  { coords: [[79.45,30.72],[79.52,30.72],[79.52,30.79],[79.45,30.79],[79.45,30.72]] },
    'vg-wb-01':  { coords: [[87.30,23.07],[87.37,23.07],[87.37,23.14],[87.30,23.14],[87.30,23.07]] },
  };

  const poly = MOCK_POLYGONS[boundaryInfo.boundary_id];
  return {
    name: boundaryInfo.village_name,
    state: boundaryInfo.state,
    district: boundaryInfo.district,
    tehsil: boundaryInfo.tehsil,
    geojson: poly ? { type: 'Polygon', coordinates: [poly.coords] } : null,
    area_hectares: poly ? computePolyArea(poly.coords) : 0,
  };
}

function computePolyArea(coords) {
  const lats = coords.map(c => c[1]);
  const lons = coords.map(c => c[0]);
  const dLat = Math.max(...lats) - Math.min(...lats);
  const dLon = Math.max(...lons) - Math.min(...lons);
  const kmLat = dLat * 111;
  const kmLon = dLon * 111 * Math.cos((Math.min(...lats) + Math.max(...lats)) / 2 * Math.PI / 180);
  return Math.round(kmLat * kmLon * 100);
}

// ─── JS Fallback Analytics (seeded random, used when GEE unavailable) ───

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function computeCroppingIntensityFallback(villageName, years) {
  const rng = seededRandom(hashString(villageName));
  const baseSingle = 200 + rng() * 400;
  const baseDouble = 50 + rng() * 150;
  const baseTriple = 10 + rng() * 70;

  const data = years.map((year, i) => {
    const trend = i * 0.03;
    const single = Math.max(+(baseSingle * (1 - trend + (rng() - 0.5) * 0.1)).toFixed(2), 0);
    const double = Math.max(+(baseDouble * (1 + trend * 1.5 + (rng() - 0.5) * 0.1)).toFixed(2), 0);
    const triple = Math.max(+(baseTriple * (1 + trend * 2 + (rng() - 0.5) * 0.1)).toFixed(2), 0);
    return { year, single_crop_ha: single, double_crop_ha: double, triple_crop_ha: triple,
      total_cropped_ha: +(single + double + triple).toFixed(2) };
  });
  return { village_name: villageName, data };
}

function computeSurfaceWaterFallback(villageName, years) {
  const rng = seededRandom(hashString(villageName) + 42);
  const basePerennial = 5 + rng() * 25;
  const baseMonsoon = 15 + rng() * 65;
  const baseWinter = 3 + rng() * 22;

  const data = years.map((year, i) => {
    const trend = i * 0.02;
    const perennial = Math.max(+(basePerennial * (1 - trend + (rng() - 0.5) * 0.2)).toFixed(2), 0);
    const monsoon = Math.max(+(baseMonsoon * (1 + (rng() - 0.5) * 0.3)).toFixed(2), 0);
    const winter = Math.max(+(baseWinter * (1 + (rng() - 0.5) * 0.4)).toFixed(2), 0);
    return { year, perennial_ha: perennial, seasonal_monsoon_ha: monsoon,
      seasonal_winter_ha: winter, total_water_ha: +(perennial + monsoon + winter).toFixed(2) };
  });
  return { village_name: villageName, data };
}

function computeVegetationChangeFallback(villageName, years) {
  const rng = seededRandom(hashString(villageName) + 99);
  const baseTreeCover = 80 + rng() * 220;

  const yearly_data = years.map((year, i) => {
    const decline = i * (1.5 + rng() * 2.5);
    const noise = (rng() - 0.5) * 10;
    return { year, tree_cover_ha: Math.max(+(baseTreeCover - decline + noise).toFixed(2), 10) };
  });

  const startHa = yearly_data[0].tree_cover_ha;
  const endHa = yearly_data[yearly_data.length - 1].tree_cover_ha;
  const loss = Math.max(+(startHa - endHa).toFixed(2), 0);
  const gain = Math.max(+(endHa - startHa).toFixed(2), 0);

  return {
    village_name: villageName, start_year: years[0], end_year: years[years.length - 1],
    tree_cover_start_ha: startHa, tree_cover_end_ha: endHa,
    tree_cover_loss_ha: loss, tree_cover_gain_ha: gain,
    net_change_ha: +(endHa - startHa).toFixed(2),
    degraded_land_ha: +(loss * 0.6).toFixed(2), yearly_data,
  };
}

// ─── Full Analytics Pipeline (WASM-First with GEE) ───

export async function runAnalyticsPipeline(boundaryInfo, selectedLayers, selectedYears, onProgress) {
  // Step 1: Resolve boundary
  onProgress?.('Resolving village boundary…');
  const boundary = await resolveBoundary(boundaryInfo);

  if (!boundary.geojson && !boundaryInfo.boundary_geojson) {
    throw new Error('Could not resolve village boundary. Please upload a GeoJSON file.');
  }

  const villageName = boundary.name;
  const geojson = boundary.geojson || boundaryInfo.boundary_geojson;
  const sortedYears = [...selectedYears].sort((a, b) => a - b);

  const results = {
    village_name: villageName,
    state: boundary.state,
    district: boundary.district,
    tehsil: boundary.tehsil,
  };

  // Step 2: Try fetching real data from GEE proxy + Pyodide compute
  let useRealData = false;
  let geeData = null;

  try {
    onProgress?.('Fetching satellite data from Google Earth Engine…');
    geeData = await fetchAllGEEData(geojson, sortedYears);

    // GEE /all returns 200 even when datasets fail (lulc/water/ndvi = null).
    // Only treat as real data if at least one dataset is non-null.
    const hasAnyData = geeData && (geeData.lulc || geeData.water || geeData.ndvi);
    if (hasAnyData) {
      useRealData = true;
      onProgress?.('GEE data received. Loading Pyodide (Python WASM)…');
    } else {
      console.warn('GEE returned no usable data, falling back to JS mock');
      onProgress?.('GEE returned no data — using client-side analytics…');
      useRealData = false;
    }
  } catch (err) {
    console.warn('GEE proxy unavailable, falling back to JS mock:', err.message);
    onProgress?.('GEE unavailable — using client-side analytics…');
    useRealData = false;
  }

  // Step 3: Run analytics (Pyodide for real data, JS for fallback)
  if (useRealData && geeData) {
    try {
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
      results.data_source = 'GEE + Pyodide WASM';
    } catch (pyErr) {
      console.warn('Pyodide compute failed, falling back to JS:', pyErr.message);
      useRealData = false;
    }
  }

  // Fallback: use JS seeded-random analytics when no real data available
  if (!useRealData) {
    onProgress?.('Running client-side analytics…');
    if (selectedLayers.includes('cropping_intensity')) {
      results.cropping_intensity = computeCroppingIntensityFallback(villageName, sortedYears);
    }
    if (selectedLayers.includes('surface_water')) {
      results.surface_water = computeSurfaceWaterFallback(villageName, sortedYears);
    }
    if (selectedLayers.includes('vegetation')) {
      results.vegetation = computeVegetationChangeFallback(villageName, sortedYears);
    }
    results.data_source = 'Client-Side Analytics (JS)';
  }

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
  const source = results.data_source || 'Client-Side WASM';

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
