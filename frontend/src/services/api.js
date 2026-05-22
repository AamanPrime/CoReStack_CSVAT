/**
 * CSVAT — API Client Service.
 * Axios-based client for communicating with the FastAPI backend.
 */
import axios from 'axios';

const API_HOST = (import.meta.env.VITE_API_BASE || 'https://csvat-backend.onrender.com').replace(/\/$/, '');
const API_BASE = `${API_HOST}/api/v1`;

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('csvat_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Auth ───
export async function getToken(apiKey) {
  const { data } = await api.post('/auth/token', { api_key: apiKey });
  localStorage.setItem('csvat_token', data.access_token);
  return data;
}

// ─── Boundaries ───
export async function searchBoundaries(query) {
  const { data } = await api.get('/boundaries/search', { params: { q: query } });
  return data;
}

export async function validateBoundary(geojson) {
  const { data } = await api.post('/boundaries/validate', { geojson });
  return data;
}

// ─── Layers ───
export async function getLayers() {
  const { data } = await api.get('/layers');
  return data;
}

// ─── Jobs ───
export async function createJob(params) {
  const { data } = await api.post('/jobs', params);
  return data;
}

export async function saveClientResults(jobId, results) {
  const { data } = await api.post(`/jobs/${jobId}/client-results`, { results });
  return data;
}

export async function getJob(jobId) {
  const { data } = await api.get(`/jobs/${jobId}`);
  return data;
}

export async function getJobAssetUrl(jobId, assetType) {
  return `${API_BASE}/jobs/${jobId}/assets/${assetType}`;
}

// ─── Polling ───
export function pollJob(jobId, onUpdate, intervalMs = 2000) {
  const timer = setInterval(async () => {
    try {
      const job = await getJob(jobId);
      onUpdate(job);
      if (job.status === 'SUCCESS' || job.status === 'FAILED') {
        clearInterval(timer);
      }
    } catch (err) {
      console.error('Polling error:', err);
      clearInterval(timer);
      onUpdate({ status: 'FAILED', error_message: err.message });
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

// ─── CoRE Stack Proxy ───
export async function getActiveLocations() {
  const { data } = await api.get('/corestack/locations');
  return data.data || data; // Backend wraps in { status: "ok", data: [...] }
}

export async function getVillageGeometries(state, district, tehsil) {
  const { data } = await api.get('/corestack/village-geometries', {
    params: { state, district, tehsil },
  });
  return data.data || data;
}

// ─── GEE Pan-India Admin Hierarchy ───

/** All pan-India states/UTs from GEE State_pan_india (string[]) */
export async function getGEEStates() {
  const { data } = await api.get('/gee/states');
  return data.data || data;
}

/** All district names in a state from GEE (via SOI_tehsil) (string[]) */
export async function getGEEDistricts(state) {
  const { data } = await api.get('/gee/districts', { params: { state } });
  return data.data || data;
}

/** All tehsil names in a district from GEE SOI_tehsil (string[]) */
export async function getGEETehsils(state, district) {
  const { data } = await api.get('/gee/tehsils', { params: { state, district } });
  return data.data || data;
}

/** Fallback: all tehsils in a state when state has no districts (string[]) */
export async function getGEETehsilsByState(state) {
  const { data } = await api.get('/gee/tehsils-by-state', { params: { state } });
  return data.data || data;
}

/** All village geometries in a tehsil from GEE (GeoJSON FeatureCollection) */
export async function getGEEVillageGeometries(state, district, tehsil) {
  const { data } = await api.get('/gee/village-geometries', {
    params: { state, district, tehsil },
  });
  return data.data || data;
}

/** Fallback: all villages in a district when district has no tehsils (GeoJSON FeatureCollection) */
export async function getGEEVillagesByDistrict(state, district) {
  const { data } = await api.get('/gee/villages-by-district', { params: { state, district } });
  return data.data || data;
}

/** Tehsil boundary as GeoJSON Feature from SOI_tehsil (fallback when tehsil has no villages) */
export async function getGEETehsilGeometry(state, district, tehsil) {
  const { data } = await api.get('/gee/tehsil-geometry', { params: { state, district, tehsil } });
  return data.data || data;
}

/** District boundary as GeoJSON Feature (fallback when district has no tehsils/villages) */
export async function getGEEDistrictGeometry(state, district) {
  const { data } = await api.get('/gee/district-geometry', { params: { state, district } });
  return data.data || data;
}

/** State boundary as GeoJSON Feature (last-resort fallback for states with no sub-divisions) */
export async function getGEEStateGeometry(state) {
  const { data } = await api.get('/gee/state-geometry', { params: { state } });
  return data.data || data;
}

/** Resolve lat/lon to MWS uid via CoReStack API. Returns {} if no MWS data exists. */
export async function getMWSIdByLatLon(latitude, longitude) {
  const { data } = await api.get('/corestack/mws-id', {
    params: { latitude, longitude },
  });
  return data.data || data;
}

export async function getMWSGeometries(state, district, tehsil) {
  const { data } = await api.get('/corestack/mws-geometries', {
    params: { state, district, tehsil },
  });
  return data.data || data;
}

export async function getWaterbodies(state, district, tehsil) {
  const { data } = await api.get('/corestack/waterbodies', {
    params: { state, district, tehsil },
  });
  return data.data || data;
}

export async function getWaterbodyDetail(state, district, tehsil, uid) {
  const { data } = await api.get('/corestack/waterbody', {
    params: { state, district, tehsil, uid },
  });
  return data.data || data;
}

export async function getMWSReport(state, district, tehsil, mwsId) {
  const { data } = await api.get('/corestack/mws-report', {
    params: { state, district, tehsil, mws_id: mwsId },
  });
  return data.data || data;
}

export async function getAdminDetails(latitude, longitude) {
  const { data } = await api.get('/corestack/admin-details', {
    params: { latitude, longitude },
  });
  return data.data || data;
}

// ─── Village Stories ───
export async function getVillageStory(villageName, state, district, tehsil) {
  const { data } = await api.get('/village-stories/by-name', {
    params: { village: villageName, state, district, tehsil },
  });
  return data;
}

export async function getVillageStoryById(villageId) {
  const { data } = await api.get(`/village-stories/${villageId}`);
  return data;
}

export async function getRegionContext(state, district) {
  const { data } = await api.get(`/village-stories/region-context/${state}/${district}`);
  return data;
}

// ─── Custom Slides ───
export async function getCustomSlides(villageName) {
  const { data } = await api.get('/custom-slides', { params: { village: villageName } });
  return data;
}

export async function createCustomSlide(slide) {
  const { data } = await api.post('/custom-slides', slide);
  return data;
}

export async function updateCustomSlide(slideId, updates) {
  const { data } = await api.put(`/custom-slides/${slideId}`, updates);
  return data;
}

export async function deleteCustomSlide(slideId) {
  const { data } = await api.delete(`/custom-slides/${slideId}`);
  return data;
}

// ─── Storyboard (AI-generated cached slides) ─────────────────────────────────

/**
 * Fetch cached storyboard slides for a CoReStack village.
 * Returns null (not throws) on 404.
 */
export async function getStoryboardSlides(villageId) {
  try {
    const { data } = await api.get(`/storyboard/${villageId}`);
    return data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

/**
 * Save (upsert) storyboard slides for a village.
 */
export async function saveStoryboardSlides(villageId, payload) {
  const { data } = await api.post(`/storyboard/${villageId}`, payload);
  return data;
}

/**
 * Patch specific slides in the cached storyboard (for the slide editor).
 */
export async function patchStoryboardSlides(villageId, slideUpdates) {
  const { data } = await api.patch(`/storyboard/${villageId}/slides`, { slides: slideUpdates });
  return data;
}

/**
 * Delete ALL storyboard slides from DB (full reset).
 */
export async function clearStoryboardDb() {
  const { data } = await api.delete('/storyboard/');
  return data;
}

export default api;

