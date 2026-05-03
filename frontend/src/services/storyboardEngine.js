/**
 * CSVAT — Client-side Storyboard Engine
 *
 * Ports sc.py logic to JavaScript:
 *   1. transformInsights(rawResults)   — compute summary stats from analytics results
 *   2. fetchOverpassData(bbox)         — fetch OSM data directly from Overpass API
 *   3. buildOsmSummary(osmData)        — count tag groups from OSM elements
 *   4. generateSlidesViaGroq(payload)  — POST to backend Groq proxy → 13 slides
 *   5. runStoryboardPipeline(...)      — orchestrates steps 1-4
 *
 * For non-CoReStack boundaries (upload / places), use buildTemplateSlides()
 * which returns static content slides without any LLM call.
 */

const API_BASE = (
  import.meta.env.VITE_API_BASE || 'https://csvat-backend.onrender.com'
).replace(/\/$/, '');

// ─── 1. Transform insights (port of sc.py transform_insights) ────────────────

/**
 * Compute summary stats from the raw analytics results object.
 * Mirrors sc.py transform_insights().
 *
 * @param {Object} results - Full analytics results from runAnalyticsPipeline()
 * @returns {{ cropping_intensity, water, vegetation }}
 */
export function transformInsights(results) {
  // ── Cropping intensity ──────────────────────────────────────────────────
  const ciRaw =
    results?.cropping_intensity?.data || results?.cropping_intensity || [];
  const ciValues = ciRaw
    .map((r) => r.cropping_intensity)
    .filter((v) => v != null && !isNaN(v));

  const ciStart = ciValues[0] ?? 0;
  const ciPeak = ciValues.length ? Math.max(...ciValues) : 0;
  let ciTrend = 'stable';
  if (ciValues.length >= 2) {
    if (ciValues[ciValues.length - 1] > ciValues[0]) ciTrend = 'increasing';
    else if (ciValues[ciValues.length - 1] < ciValues[0])
      ciTrend = 'decreasing';
    else ciTrend = 'fluctuating';
  }

  // ── Surface water ───────────────────────────────────────────────────────
  const swRaw = results?.surface_water?.data || results?.surface_water || [];
  const waterValues = swRaw
    .map((r) => r.total_water_ha ?? 0)
    .filter((v) => !isNaN(v));
  const maxWater = waterValues.length ? Math.max(...waterValues) : 0;

  // ── Vegetation ──────────────────────────────────────────────────────────
  const veg = results?.vegetation || {};
  const gain = veg.tree_cover_gain_ha ?? 0;
  const loss = veg.tree_cover_loss_ha ?? 0;
  const net = veg.net_change_ha ?? parseFloat((gain - loss).toFixed(2));

  return {
    cropping_intensity: {
      start: parseFloat(ciStart.toFixed(3)),
      peak: parseFloat(ciPeak.toFixed(3)),
      trend: ciTrend,
    },
    water: {
      surface_water_ha: parseFloat(maxWater.toFixed(2)),
    },
    vegetation: {
      gain: parseFloat(gain.toFixed(2)),
      loss: parseFloat(loss.toFixed(2)),
      net: parseFloat(net.toFixed(2)),
    },
  };
}

// ─── 2. Overpass OSM fetch ────────────────────────────────────────────────────

/**
 * Compute bounding box from a GeoJSON geometry.
 * @param {Object} geometry - GeoJSON geometry (MultiPolygon or Polygon)
 * @returns {[minLat, minLng, maxLat, maxLng]}
 */
export function computeBbox(geometry) {
  const allCoords = [];

  function collectCoords(coords) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      allCoords.push(coords);
    } else {
      coords.forEach(collectCoords);
    }
  }

  collectCoords(geometry?.coordinates || []);

  if (!allCoords.length) return [20, 72, 22, 74]; // Fallback to Maharashtra
  const lngs = allCoords.map((c) => c[0]);
  const lats = allCoords.map((c) => c[1]);
  return [
    Math.min(...lats),
    Math.min(...lngs),
    Math.max(...lats),
    Math.max(...lngs),
  ];
}

/**
 * Fetch OSM data for the village BBOX from Overpass API.
 * Retries up to 3 times on failure.
 * @param {[minLat, minLng, maxLat, maxLng]} bbox
 * @returns {Promise<{elements: Array}>}
 */
export async function fetchOverpassData(bbox) {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  //console.log('[Overpass] Fetching bbox:', bbox);
  const query = `[out:json][timeout:25];
(
  node(${minLat},${minLng},${maxLat},${maxLng});
  way(${minLat},${minLng},${maxLat},${maxLng});
  relation(${minLat},${minLng},${maxLat},${maxLng});
);
out body;
>;
out skel qt;`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      //console.log(`[Overpass] Attempt ${attempt + 1}/3…`);
      const resp = await fetch(
        `${API_BASE}/api/v1/overpass/?data=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(30000) },
      );
      if (!resp.ok) {
        console.warn(`[Overpass] Attempt ${attempt + 1}: HTTP ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      if (data?.elements) {
        //console.log(`[Overpass] ✅ Got ${data.elements.length} elements`);
        return data;
      }
    } catch (err) {
      console.warn(`[Overpass] Attempt ${attempt + 1} failed:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn('[Overpass] All retries failed — continuing without OSM data');
  return { elements: [] };
}

// ─── 3. OSM summary builder ────────────────────────────────────────────────────

/**
 * Build tag group counts and top tag list from Overpass OSM elements.
 * Mirrors sc.py OSM summary logic.
 *
 * @param {{elements: Array}} osmData
 * @returns {{ osmSummary: Object, topOsmTags: string[] }}
 */
export function buildOsmSummary(osmData) {
  const tagCounts = {};

  for (const el of osmData?.elements || []) {
    for (const [k, v] of Object.entries(el?.tags || {})) {
      if (['name', 'source', 'created_by'].includes(k)) continue;
      const key = `${k}:${v}`;
      tagCounts[key] = (tagCounts[key] || 0) + 1;
    }
  }

  // Top 50 tags
  const sorted = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  const top50 = Object.fromEntries(sorted);

  // Group by key prefix
  const groups = {};
  for (const [tag, count] of Object.entries(top50)) {
    const prefix = tag.split(':')[0];
    groups[prefix] = (groups[prefix] || 0) + count;
  }

  // Top 20 raw tags as strings "key:val(count)"
  const topOsmTags = sorted.slice(0, 20).map(([t, c]) => `${t}(${c})`);

  return { osmSummary: groups, topOsmTags };
}

// ─── 4. Groq slide generation (via backend proxy) ─────────────────────────────

/**
 * POST to backend /api/v1/storyboard/generate with the prepped payload.
 * Returns { village, total_area, slides[] }.
 *
 * @param {Object} payload - { village_name, state, district, tehsil, area_hectares, insights, osm_summary, top_osm_tags, crop_intensity_change, vegetation_transitions }
 * @returns {Promise<{village: string, total_area: string, slides: Array}>}
 */
export async function generateSlidesViaGroq(payload) {
  const url = `${API_BASE}/api/v1/storyboard/generate`;
  //console.log('[Groq] POST →', url);
  //console.log('[Groq] payload village:', payload.village_name, '| bbox top_osm_tags:', payload.top_osm_tags?.slice(0,3));

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  //console.log('[Groq] response status:', resp.status);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    console.error('[Groq] ❌ Error:', err);
    throw new Error(
      `Storyboard generation failed: ${err.detail || resp.statusText}`,
    );
  }

  const result = await resp.json();
  //console.log('[Groq] ✅ slides received:', result?.slides?.length);
  return result;
}

// ─── 5. Full pipeline ─────────────────────────────────────────────────────────

/**
 * Orchestrates the full client-side storyboard generation pipeline.
 * Equivalent to running sc.py end-to-end.
 *
 * @param {Object} params
 * @param {Object} params.results - Analytics results from runAnalyticsPipeline()
 * @param {Object} params.boundary - The boundary object (contains village_id, geojson, etc.)
 * @param {Function} [params.onProgress] - Optional progress callback (msg: string) => void
 * @returns {Promise<{village: string, total_area: string, slides: Array}>}
 */
export async function runStoryboardPipeline({ results, boundary, onProgress }) {
  const progress = onProgress || (() => {});

  progress('Computing insights…');
  const insights = transformInsights(results);

  progress('Fetching OSM infrastructure data…');
  const geometry = boundary?.boundary_geojson || boundary?.geojson || null;
  const bbox = geometry ? computeBbox(geometry) : [20, 72, 22, 74];
  const osmData = await fetchOverpassData(bbox);

  progress(`Processing ${osmData.elements?.length || 0} OSM elements…`);
  const { osmSummary, topOsmTags } = buildOsmSummary(osmData);

  // Extract vegetation transitions
  const vegTransitions = results?.vegetation?.transitions || [];

  // Extract crop intensity change
  const cropIntensityChange = results?.crop_intensity_change || [];

  progress('Generating storyboard slides with AI…');
  const story = await generateSlidesViaGroq({
    village_name:
      results?.village_name ||
      boundary?.village_name ||
      boundary?.name ||
      'Unknown',
    state: results?.state || boundary?.state || null,
    district: results?.district || boundary?.district || null,
    tehsil: results?.tehsil || boundary?.tehsil || null,
    area_hectares: results?.area_hectares || null,
    insights,
    crop_intensity_change: cropIntensityChange,
    vegetation_transitions: vegTransitions,
    osm_summary: osmSummary,
    top_osm_tags: topOsmTags,
  });

  return story;
}

// ─── 6. Template slides (non-CoReStack boundaries) ───────────────────────────

/**
 * Build static template slides for non-CoReStack boundaries
 * (uploaded GeoJSON, Google Places search).
 * No LLM call — purely static content.
 *
 * @param {Object} results - Analytics results
 * @param {Object} boundary - Boundary object
 * @returns {{ village: string, total_area: string, slides: Array }}
 */
export function buildTemplateSlides(results, boundary) {
  const name = results?.village_name || boundary?.name || 'Selected Area';
  const areaHa = results?.area_hectares?.toFixed(2) || '—';
  const ciData =
    results?.cropping_intensity?.data || results?.cropping_intensity || [];
  const swData = results?.surface_water?.data || results?.surface_water || [];
  const veg = results?.vegetation || {};
  const latestCI = ciData[ciData.length - 1];
  const latestSW = swData[swData.length - 1];

  const slides = [
    {
      slide_number: 1,
      emoji: '🌍',
      title: `Overview — ${name}`,
      content: `${name} is the selected analysis area covering approximately ${areaHa} hectares. This storyboard summarises satellite-derived land use, water, and vegetation analytics.`,
      insight: `${areaHa} ha total area analysed`,
    },
    {
      slide_number: 2,
      emoji: '📍',
      title: 'Location Context',
      content: `The area was delineated via custom boundary. Geographic position and connectivity were assessed through the uploaded GeoJSON extent.`,
      insight: 'Custom boundary analysis',
    },
    {
      slide_number: 3,
      emoji: '🏘️',
      title: 'Settlement Pattern',
      content: `Settlement distribution within the custom boundary was not resolved to a specific administrative village. Habitation analysis is based solely on satellite imagery.`,
      insight: 'Custom boundary — admin unknown',
    },
    {
      slide_number: 4,
      emoji: '🛣️',
      title: 'Road Infrastructure',
      content: `Road network data was not fetched for custom boundaries. Infrastructure connectivity assessment requires an administrative boundary resolution.`,
      insight: 'Road data unavailable',
    },
    {
      slide_number: 5,
      emoji: '🌾',
      title: 'Land Use',
      content: latestCI
        ? `Latest land use data shows ${latestCI.total_cropped_ha?.toFixed(2)} ha cropped area. Single crop: ${latestCI.single_crop_ha?.toFixed(2)} ha, Double crop: ${latestCI.double_crop_ha?.toFixed(2)} ha, Triple crop: ${latestCI.triple_crop_ha?.toFixed(2)} ha.`
        : `Land use classification is derived from IndiaSAT LULC satellite data processed client-side.`,
      insight: latestCI
        ? `${latestCI.total_cropped_ha?.toFixed(1)} ha cropped`
        : 'LULC from satellite',
    },
    {
      slide_number: 6,
      emoji: '🌱',
      title: 'Agricultural Profile',
      content: latestCI
        ? `Cropping intensity index: ${latestCI.cropping_intensity?.toFixed(3)}. The area supports ${latestCI.triple_crop_ha > 0 ? 'triple' : latestCI.double_crop_ha > 0 ? 'double' : 'single'} season cropping.`
        : 'Cropping data could not be extracted for this boundary.',
      insight: latestCI
        ? `Intensity: ${latestCI.cropping_intensity?.toFixed(3)}`
        : 'No CI data',
    },
    {
      slide_number: 7,
      emoji: '📈',
      title: 'Agricultural Trends',
      content:
        ciData.length >= 2
          ? `Cropping intensity moved from ${ciData[0].cropping_intensity?.toFixed(3)} in ${ciData[0].year} to ${ciData[ciData.length - 1].cropping_intensity?.toFixed(3)} in ${ciData[ciData.length - 1].year} — a span of ${ciData.length} years.`
          : 'Insufficient years of data to assess trends.',
      insight:
        ciData.length >= 2
          ? `${ciData.length} years tracked`
          : 'Limited trend data',
    },
    {
      slide_number: 8,
      emoji: '💧',
      title: 'Water Availability',
      content: latestSW
        ? `In ${latestSW.year}, total surface water coverage was ${latestSW.total_water_ha?.toFixed(2)} ha — split across Kharif (${latestSW.kharif_ha?.toFixed(2)} ha), Rabi (${latestSW.rabi_ha?.toFixed(2)} ha), and Zaid seasons.`
        : 'Surface water data is derived from satellite imagery.',
      insight: latestSW
        ? `${latestSW.total_water_ha?.toFixed(1)} ha surface water`
        : 'Water from satellite',
    },
    {
      slide_number: 9,
      emoji: '🌳',
      title: 'Vegetation Change',
      content:
        veg.tree_cover_gain_ha != null
          ? `Tree cover analysis: +${veg.tree_cover_gain_ha?.toFixed(2)} ha gain, -${veg.tree_cover_loss_ha?.toFixed(2)} ha loss, net ${veg.net_change_ha?.toFixed(2)} ha change over the study period.`
          : 'Vegetation change data not available for this boundary.',
      insight:
        veg.net_change_ha != null
          ? `Net ${veg.net_change_ha >= 0 ? '+' : ''}${veg.net_change_ha?.toFixed(2)} ha`
          : 'Veg data unavailable',
    },
    {
      slide_number: 10,
      emoji: '',
      title: 'Land Transition',
      content: veg.transitions?.length
        ? `Key land transitions: ${veg.transitions
            .slice(0, 3)
            .map(
              (t) =>
                `${t.from_class || t.from} → ${t.to_label || t.to} (${t.area_ha?.toFixed(1)} ha)`,
            )
            .join('; ')}.`
        : 'Land transition data not available for custom boundaries.',
      insight: veg.transitions?.length
        ? `${veg.transitions.length} transitions detected`
        : 'No transition data',
    },
    {
      slide_number: 11,
      emoji: '🏗️',
      title: 'Infrastructure Gaps',
      content:
        'Infrastructure gap assessment is not available for custom boundaries as OSM data was not fetched. Administrative boundaries are required for OSM infrastructure analysis.',
      insight: 'OSM data skipped',
    },
    {
      slide_number: 12,
      emoji: '💡',
      title: 'Opportunities',
      content: `Based on the satellite analytics, this area shows potential for ${veg.net_change_ha < 0 ? 'reforestation initiatives' : 'continued vegetation conservation'}. ${latestCI?.cropping_intensity < 1.2 ? 'Cropping intensity improvement is possible.' : 'Cropping patterns appear optimised.'}`,
      insight: 'Data-driven intervention potential',
    },
    {
      slide_number: 13,
      emoji: '🎯',
      title: 'Conclusion',
      content: `This analysis of ${name} (${areaHa} ha) covers ${ciData.length} years of satellite data. Key findings: cropping intensity ${latestCI?.cropping_intensity?.toFixed(3) || '—'}, surface water ${latestSW?.total_water_ha?.toFixed(2) || '—'} ha, vegetation net ${veg.net_change_ha?.toFixed(2) || '—'} ha.`,
      insight: 'Evidence-based planning foundation',
    },
  ];

  return { village: name, total_area: `${areaHa} ha`, slides };
}

// ─── 7. Save / fetch helpers (thin wrappers for cleaner imports) ──────────────

/**
 * Check DB for cached storyboard slides.
 * Returns the storyboard object or null if not cached.
 */
export async function fetchCachedStoryboard(villageId) {
  const url = `${API_BASE}/api/v1/storyboard/${villageId}`;
  //console.log('[StoryboardDB] GET →', url);
  try {
    const resp = await fetch(url);
    //console.log('[StoryboardDB] cache status:', resp.status);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    //console.log('[StoryboardDB] cached slides count:', data?.slides?.length);
    return data;
  } catch (err) {
    console.warn('[StoryboardDB] Cache fetch failed:', err.message);
    return null;
  }
}

/**
 * Save storyboard slides to DB.
 */
export async function saveStoryboardToDb(
  villageId,
  storyData,
  boundary,
  results,
) {
  const url = `${API_BASE}/api/v1/storyboard/${villageId}`;
  const body = {
    village_name:
      storyData.village || results?.village_name || boundary?.name || 'Unknown',
    state: results?.state || boundary?.state || null,
    district: results?.district || boundary?.district || null,
    tehsil: results?.tehsil || boundary?.tehsil || null,
    total_area: storyData.total_area || null,
    slides: storyData.slides || [],
  };

  //console.log('[StoryboardDB] POST →', url, '| slides:', body.slides.length);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  //console.log('[StoryboardDB] save status:', resp.status);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.warn('[StoryboardDB] Save failed:', err.detail || resp.statusText);
  }
  return resp.json().catch(() => null);
}

/**
 * Update specific slides in the cached storyboard (for the slide editor).
 */
export async function updateStoryboardSlides(villageId, slideUpdates) {
  const resp = await fetch(
    `${API_BASE}/api/v1/storyboard/${villageId}/slides`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slides: slideUpdates }),
    },
  );
  if (!resp.ok) throw new Error(`Update failed: ${resp.status}`);
  return resp.json();
}

/**
 * Clear ALL storyboard slides from DB.
 */
export async function clearAllStoryboards() {
  const resp = await fetch(`${API_BASE}/api/v1/storyboard/`, {
    method: 'DELETE',
  });
  if (!resp.ok) throw new Error(`Clear failed: ${resp.status}`);
  return resp.json();
}

/**
 * Convert sc.py slide format to Terraso chapter format for StoryMapView.
 * sc.py → { slide_number, emoji, title, content, insight }
 * Terraso → { title, narrative, map_action, image_url }
 */
export function slidesToChapters(slides) {
  const MAP_ACTIONS = {
    1: 'zoom_to_village',
    2: 'zoom_to_village',
    3: 'show_overview',
    4: 'show_overview',
    5: 'show_lulc_latest',
    6: 'show_lulc_latest',
    7: 'show_lulc_oldest',
    8: 'show_water',
    9: 'show_lulc_latest',
    10: 'show_lulc_latest',
    11: 'show_overview',
    12: 'zoom_to_village',
    13: 'zoom_to_village',
  };

  return (slides || []).map((s) => ({
    slide_number: s.slide_number,
    emoji: s.emoji,
    title: `${s.emoji} ${s.title}`,
    narrative: `${s.content}\n\n💡 ${s.insight}`,
    map_action: MAP_ACTIONS[s.slide_number] || 'zoom_to_village',
    image_url: null,
    // Keep original fields for the editor
    _original: s,
  }));
}
