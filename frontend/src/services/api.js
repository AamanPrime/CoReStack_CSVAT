/**
 * CSVAT — API Client Service.
 * Axios-based client for communicating with the FastAPI backend.
 */
import axios from 'axios';

const API_BASE = '/api/v1';

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

export default api;
