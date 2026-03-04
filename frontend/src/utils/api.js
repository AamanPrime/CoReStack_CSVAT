const API_BASE = 'http://localhost:8000';

/** Fetch analytics from the sample xlsx dataset (always available). */
export async function fetchSampleAnalytics() {
    const res = await fetch(`${API_BASE}/api/analytics/sample`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

/**
 * Upload a GeoJSON and compute REAL analytics by clipping the LULC TIFF.
 * Called automatically when user drops / selects a .geojson file.
 */
export async function analyzeFromGeoJSON(geojson) {
    const res = await fetch(`${API_BASE}/api/analytics/from-geojson`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geojson),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Raster API error: ${res.status}`);
    }
    return res.json();
}

/** Check which TIFF years are registered on the backend. */
export async function checkTiffStatus() {
    const res = await fetch(`${API_BASE}/api/analytics/tiff-status`);
    if (!res.ok) return { tiffs_found: 0, years: [] };
    return res.json();
}

export async function uploadBoundary(file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/api/boundary/upload`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) throw new Error(`Upload error: ${res.status}`);
    return res.json();
}

export async function exportCSV() {
    const res = await fetch(`${API_BASE}/api/analytics/export/csv`);
    if (!res.ok) throw new Error(`Export error: ${res.status}`);
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cropping_intensity.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

export async function exportAllCSV() {
    const res = await fetch(`${API_BASE}/api/analytics/export/all-csv`);
    if (!res.ok) throw new Error(`Export error: ${res.status}`);
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'csvat_analytics.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}
