/**
 * CSVAT — Dashboard Page (Landscape Explorer Layout).
 *
 * Full-screen map with collapsible right sidebar "Filters & Data".
 * Location selectors, category tabs, layer toggles, analytics.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import BoundarySelector from '../components/BoundarySelector';
import ReportViewer from '../components/ReportViewer';
import { MapView } from '../components/GoogleMapsIntegration';
import {
  runAnalyticsPipeline,
  generateCSV,
} from '../services/wasmEngine';
import { createJob, pollJob, getLayers } from '../services/api';

export default function MobileDashboard() {
  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false); // Start collapsed on mobile


  // Boundary & map state
  const [boundary, setBoundary] = useState(null);
  const [mapCenter, setMapCenter] = useState(null);
  const [mapGeojson, setMapGeojson] = useState(null);
  const [mapEditState, setMapEditState] = useState({ editable: false, drawMode: false, onGeojsonEdit: null });

  // Layer & analytics state
  const availableLayers = [];
  const selectedLayers = ['cropping_intensity', 'surface_water', 'vegetation'];
  const selectedYears = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');
  const [progressPct, setProgressPct] = useState(0);

  // 0–100 progress derived from message text. See DesktopDashboard for rationale.
  const updateProgress = useCallback((msg) => {
    setProgress(msg);
    if (typeof msg !== 'string') return;
    const m = msg.match(/\[(\d+)\/(\d+)\]/);
    if (m) {
      const cur = parseInt(m[1], 10);
      const total = parseInt(m[2], 10);
      if (total > 0) {
        setProgressPct(Math.min(85, Math.round(15 + (cur / total) * 70)));
        return;
      }
    }
    const lower = msg.toLowerCase();
    if (lower.includes('starting analysis')) setProgressPct(1);
    else if (lower.includes('resolving')) setProgressPct(3);
    else if (lower.includes('loading python') || lower.includes('loading pyodide')) setProgressPct(6);
    else if (lower.includes('installing')) setProgressPct(10);
    else if (lower.includes('starting') && lower.includes('client-side')) setProgressPct(12);
    else if (lower.includes('extracted') && lower.includes('years')) setProgressPct(82);
    else if (lower.includes('running raster analytics')) setProgressPct(88);
    else if (lower.includes('building report')) setProgressPct(92);
    else if (lower.includes('building your report')) setProgressPct(95);
    else if (lower.includes('complete')) setProgressPct(99);
  }, []);

  // Polling ref
  const stopPollingRef = useRef(null);

  // Handle boundary selection (from sidebar)
  const handleBoundarySelect = (b) => {
    setBoundary(b);
    if (b?.boundary_geojson) {
      setMapGeojson(b.boundary_geojson);
      // Compute center
      try {
        const geojson = b.boundary_geojson;
        const coords = geojson.type === 'MultiPolygon'
          ? geojson.coordinates[0][0]
          : geojson.coordinates[0];
        const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        const avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        setMapCenter({ lat: avgLat, lng: avgLng });
      } catch { /* ignore */ }
    }
  };

  // ─── WASM Mode Submit ───
  const handleWASMSubmit = async (computePath = 'raster_tiled') => {
    setIsRunning(true);
    setError(null);
    setResults(null);
    setProgressPct(0);

    try {
      updateProgress('Starting analysis…');
      const result = await runAnalyticsPipeline(
        boundary, selectedLayers, selectedYears,
        updateProgress,
        computePath
      );
      updateProgress('Building your report…');
      setProgressPct(100);
      await delay(200);
      setResults(result);
    } catch (err) {
      setError(err.message || 'Client-side analytics pipeline failed.');
    }
    setIsRunning(false);
    setProgress('');
    setProgressPct(0);
  };

  const handleSubmit = (path) => {
    if (!boundary) return;
    if (boundary.source === 'upload' || boundary.source === 'places') {
      handleWASMSubmit('raster_tiled');
      return;
    }
    handleWASMSubmit(path);
  };

  const handleReset = () => {
    if (stopPollingRef.current) {
      stopPollingRef.current();
      stopPollingRef.current = null;
    }
    setResults(null);
    setError(null);
    setProgress('');
  };

  const handleDownloadExcel = () => {
    if (!results) {
      alert("No data to download. Please run analytics first.");
      return;
    }
    const csv = generateCSV(results);
    const safeName = (results.village_name || 'data').replace(/\s+/g, '_');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CSVAT_${safeName}_Data.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-layout mobile-app-layout">
      {/* ─── Full-Screen Map ─── */}
      <div className="map-container mobile-map-container">
        <MapView
          geojson={mapGeojson}
          center={mapCenter || { lat: 22.5, lng: 72.5 }}
          zoom={mapCenter ? 13 : 7}
          height="100%"
          layerUrls={availableLayers}
          activeLayerNames={selectedLayers}
          editable={mapEditState.editable}
          drawMode={mapEditState.drawMode}
          onGeojsonEdit={mapEditState.onGeojsonEdit}
        />



        {/* Loading Overlay */}
        {isRunning && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 55, flexDirection: 'column', gap: '0.75rem',
          }}>
            <div className="spinner"></div>
            <div className="loading-text">{progress}</div>
            <div style={{ width: 320, maxWidth: '85vw', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                fontSize: '2.5rem',
                fontWeight: 800,
                lineHeight: 1,
                color: '#059669',
                letterSpacing: '-0.02em',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {Math.round(progressPct)}%
              </div>
              <div style={{
                width: '100%',
                height: 12,
                background: 'rgba(0,0,0,0.08)',
                borderRadius: 7,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${Math.max(0, Math.min(100, progressPct))}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                  transition: 'width 0.25s ease-out',
                }} />
              </div>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Crunching the numbers — runs in your browser, data stays on your device.
            </div>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div style={{
            position: 'absolute', bottom: '1rem', left: '1rem', right: sidebarOpen ? 'calc(var(--sidebar-width) + 1rem)' : '1rem',
            zIndex: 55,
          }}>
            <div className="error-box">
              <span>⚠️</span>
              <div style={{ flex: 1 }}>
                <strong>Error:</strong> {error}
                <br />
                <button className="btn btn-sm btn-secondary" onClick={() => setError(null)} style={{ marginTop: '0.4rem' }}>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Story Map Results View */}
        {results && (
          <ReportViewer
            results={results}
            boundary={boundary}
            onReset={handleReset}
            layerUrls={availableLayers}
            activeLayerNames={selectedLayers}
          />
        )}
      </div>

      {/* ─── Bottom Sheet (Mobile) ─── */}
      <aside className={`mobile-bottom-sheet ${!sidebarOpen ? 'collapsed' : ''}`}>
        <div
          className="mobile-bottom-sheet-header"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <div className="drag-handle"></div>
          <div className="header-title-row">
            <h2>⠿ Filters & Data</h2>
            <button className="sidebar-toggle" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} title="Collapse">
              ↓
            </button>
          </div>
        </div>

        <div className="sidebar-content">
          {/* Location Selectors */}
          <BoundarySelector
            onBoundarySelect={handleBoundarySelect}
            onMapUpdate={(center, geojson, editProps) => {
              if (center) setMapCenter(center);
              if (geojson) setMapGeojson(geojson);
              if (editProps) setMapEditState(editProps);
              else setMapEditState({ editable: false, drawMode: false, onGeojsonEdit: null });
            }}
          />



          {/* Get Analysis Report — single action (was: Execution Mode + MWS) */}
          {boundary && (
            <div className="analytics-section">
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                Run the analysis
              </div>
              <button
                className="btn btn-primary btn-lg"
                onClick={() => handleSubmit('raster_tiled')}
                disabled={isRunning}
                id="run-analytics-tiled-btn"
                style={{ width: '100%', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', borderColor: '#059669' }}
              >
                {isRunning ? (
                  <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span> Working…</>
                ) : 'Get Analysis Report'}
              </button>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                More accurate — takes a little longer.
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
