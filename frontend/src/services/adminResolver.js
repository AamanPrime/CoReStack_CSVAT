/**
 * adminResolver.js — Hierarchical admin boundary resolution (client-side)
 *
 * Resolves state → district → tehsil for any custom GeoJSON polygon by:
 *   1. Fetching a tiny set of bbox-filtered candidates from the backend (GEE assets)
 *   2. Computing intersection area with turf.js in the browser for all candidates
 *   3. Picking the admin unit with maximum overlap — correct even when the custom
 *      boundary straddles multiple tehsils / districts
 *
 * Each round downloads only ~3-20 small GeoJSON features (~few KB).
 * Total browser download across all 3 rounds: ~70-260 KB.
 * No large files are ever downloaded; all intersection math is client-side.
 */

import * as turf from '@turf/turf';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

// ── Name property candidates for each admin level ──────────────────────────
// The exact property name differs between GEE datasets:
//   - SOI (tehsil): uses ALL-CAPS → 'TEHSIL', 'DISTRICT', 'STATE'
//   - SHRUG (state/district): uses lowercase → 'state_name', 'dist_name'
// We try all known variants; watch browser console for '[AdminResolver] ... properties:' to see actuals.
const NAME_PROPS = {
  state: [
    // KML-export style (confirmed from CoRE Stack State_pan_india asset)
    'Name',
    // ALL-CAPS variants (SOI-style)
    'STATE', 'STATE_NAME', 'ST_NAME', 'ST_NM',
    // lowercase variants (SHRUG-style)
    'state_name', 'st_name', 'st_nm', 'statename',
    // Generic
    'NAME', 'name', 'State',
  ],
  district: [
    // KML-export style (confirmed from CoRE Stack District_pan_india asset)
    'Name',
    // ALL-CAPS variants
    'DISTRICT', 'DIST_NAME', 'DT_NAME', 'DT_NM', 'DIST',
    // lowercase variants
    'dist_name', 'district', 'dt_name', 'dt_nm', 'distname',
    // Generic
    'NAME', 'name', 'District',
  ],
  tehsil: [
    // ALL-CAPS variants (SOI confirmed working)
    'TEHSIL', 'TEH_NAME', 'TEH_NM',
    // KML-export style (fallback)
    'Name',
    // lowercase variants
    'tehsil', 'teh_name', 'tehsil_name',
    // Generic
    'NAME', 'name', 'Tehsil',
  ],
};


/**
 * Extract the name for a given admin level from a GeoJSON feature's properties.
 * Tries multiple property name candidates until one returns a non-empty value.
 * Logs raw properties on first call per level for debugging.
 */
function extractName(properties, level) {
  if (!properties) return null;
  // Debug: log all property keys so we can extend NAME_PROPS if needed
  console.debug(`[AdminResolver] ${level} raw properties:`, Object.keys(properties));
  for (const prop of NAME_PROPS[level]) {
    const val = properties[prop];
    if (val && String(val).trim()) return String(val).trim();
  }
  // Fallback: if nothing matched, log the full properties object
  console.warn(`[AdminResolver] ${level}: none of ${NAME_PROPS[level].join(', ')} matched. Full props:`, properties);
  return null;
}

/**
 * Pick the feature with the maximum intersection area with the custom polygon.
 *
 * Handles the case where the custom boundary straddles multiple admin units —
 * picks whichever unit contains the MOST of the custom polygon (by area).
 *
 * @param {turf.Feature} customFeature - The custom polygon as a turf Feature
 * @param {turf.Feature[]} candidates - Array of admin boundary Features to compare
 * @returns {{ best: turf.Feature|null, bestArea: number }}
 */
function pickMaxIntersection(customFeature, candidates) {
  let best = null;
  let bestArea = -1;

  for (const candidate of candidates) {
    try {
      // turf.intersect returns null if there's no overlap — skip those
      const intersection = turf.intersect(
        turf.featureCollection([customFeature, candidate])
      );
      if (!intersection) continue;

      const area = turf.area(intersection); // m²
      if (area > bestArea) {
        bestArea = area;
        best = candidate;
      }
    } catch {
      // Skip malformed geometries (e.g. self-intersecting polygons)
    }
  }

  return { best, bestArea };
}

/**
 * Fetch bbox-filtered admin candidates for one level from the backend.
 * Backend queries GEE's FeatureCollection on Google's servers (indexed, fast).
 * Response is a tiny GeoJSON FeatureCollection (~1-5 features, few KB).
 *
 * All 3 levels use bbox-only filtering — CoRE Stack GEE assets (KML-export format)
 * store no parent admin references, and the tight village bbox is sufficient.
 *
 * @param {string} level - 'state' | 'district' | 'tehsil'
 * @param {number[]} bbox - [minLng, minLat, maxLng, maxLat]
 * @returns {Promise<turf.Feature[]>} Array of candidate GeoJSON features
 */
async function fetchCandidates(level, bbox) {
  const bboxStr = bbox.join(',');
  const url = `${API_BASE}/api/v1/raster/admin-candidates?level=${level}&bbox=${bboxStr}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`admin-candidates ${level} failed: HTTP ${resp.status}`);
  const fc = await resp.json();
  return fc?.features || [];
}

/**
 * Resolve state / district / tehsil for a custom GeoJSON polygon.
 *
 * 3 sequential rounds, each fetching only bbox-filtered candidates (few KB each).
 * turf.js picks the admin unit with maximum intersection area — correct even when
 * the custom boundary straddles multiple admin units.
 *
 * If any round fails (network error, non-India polygon, etc.), silently falls
 * back to an empty string for that level. The report still works fine — just
 * without that admin label.
 *
 * @param {Object} geojson - GeoJSON Geometry (Polygon or MultiPolygon)
 * @returns {Promise<{ state: string, district: string, tehsil: string }>}
 */
export async function resolveAdminHierarchy(geojson) {
  const customFeature = turf.feature(geojson);
  const bbox = turf.bbox(customFeature); // [minLng, minLat, maxLng, maxLat]

  let state = '';
  let district = '';
  let tehsil = '';

  // ── Round 1: State ────────────────────────────────────────────────────────
  try {
    const stateCandidates = await fetchCandidates('state', bbox);
    console.log(`[AdminResolver] State: ${stateCandidates.length} candidates`);

    const { best } = pickMaxIntersection(customFeature, stateCandidates);
    if (best) {
      state = extractName(best.properties, 'state') || '';
      console.log(`[AdminResolver] State resolved: "${state}"`);
    }
  } catch (e) {
    console.warn('[AdminResolver] State round failed:', e.message);
  }

  // ── Round 2: District (bbox-only — District_pan_india has no state property) ───
  // The KML-format asset only stores 'Name' (district name), no parent state reference.
  // The village bbox is tight enough (~0.1°×0.1°) to return only 1-3 district candidates.
  try {
    const distCandidates = await fetchCandidates('district', bbox);
    console.log(`[AdminResolver] District: ${distCandidates.length} candidates`);

    const { best } = pickMaxIntersection(customFeature, distCandidates);
    if (best) {
      district = extractName(best.properties, 'district') || '';
      console.log(`[AdminResolver] District resolved: "${district}"`);
    }
  } catch (e) {
    console.warn('[AdminResolver] District round failed:', e.message);
  }

  // ── Round 3: Tehsil (bbox-only — SOI_tehsil has no queryable district parent property) ──
  // Same pattern as district: the bbox is tight enough to return only 1-5 tehsil candidates.
  try {
    const tehsilCandidates = await fetchCandidates('tehsil', bbox);
    console.log(`[AdminResolver] Tehsil: ${tehsilCandidates.length} candidates`);

    const { best } = pickMaxIntersection(customFeature, tehsilCandidates);
    if (best) {
      tehsil = extractName(best.properties, 'tehsil') || '';
      console.log(`[AdminResolver] Tehsil resolved: "${tehsil}"`);
    }
  } catch (e) {
    console.warn('[AdminResolver] Tehsil round failed:', e.message);
  }

  return { state, district, tehsil };
}
