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
  MWSUnavailableError,
  generateCSV,
} from '../services/wasmEngine';
import { createJob, pollJob, getLayers, saveClientResults } from '../services/api';
export default function DesktopDashboard() {
  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Sidebar drag state
  const [sidebarPos, setSidebarPos] = useState({ x: null, y: null });
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const sidebarRef = useRef(null);

  const onDragStart = useCallback((e) => {
    // Only activate on primary mouse button
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = sidebarRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragRef.current.isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setSidebarPos({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
    };
    const onMouseUp = () => {
      if (dragRef.current.isDragging) {
        dragRef.current.isDragging = false;
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

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

  // Polling ref
  const stopPollingRef = useRef(null);

  // Handle boundary selection (from sidebar)
  const handleBoundarySelect = (b) => {
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
        const center = { lat: avgLat, lng: avgLng };
        setMapCenter(center);
        // Attach center to boundary so ReportViewer can use it for satellite maps
        b.center = center;
      } catch { /* ignore */ }
    }
    setBoundary(b);
  };

  // ─── WASM Mode Submit ───
  const handleWASMSubmit = async (computePath = 'raster_tiled') => {
    setIsRunning(true);
    setError(null);
    setResults(null);

    try {

      // ── Create CLIENT job record for persistence ──
      let jobId = null;
      try {
        const job = await createJob({
          boundary_geojson: boundary.boundary_geojson || boundary.geojson || null,
          village_name: boundary.village_name || boundary.name || 'Unknown',
          state: boundary.state || '',
          district: boundary.district || '',
          tehsil: boundary.tehsil || '',
          layers: selectedLayers,
          years: selectedYears,
          mode: 'CLIENT',
        });
        jobId = job.id;
      } catch (jobErr) {
        console.warn('[Job persist] Skipping job creation:', jobErr.message);
      }

      setProgress(`Starting client-side analytics pipeline (${computePath.toUpperCase()})…`);
      const result = await runAnalyticsPipeline(
        boundary, selectedLayers, selectedYears,
        (msg) => setProgress(msg),
        computePath
      );
      setProgress('Rendering report…');
      await delay(200);
      setResults(result);

      // ── Save WASM results to PostGIS (non-blocking) ──
      if (jobId) {
        saveClientResults(jobId, result).catch(e =>
          console.warn('[Job persist] Failed to save results:', e.message)
        );
      }
    } catch (err) {
      setError(err.message || 'Client-side analytics pipeline failed.');
    }
    setIsRunning(false);
    setProgress('');
  };

  const handleSubmit = (path) => {
    if (!boundary) return;
    // Uploaded boundaries always use WASM raster path (no tehsil data for server mode)
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
    <div className="app-layout">
      {/* ─── Full-Screen Map ─── */}
      <div className="map-container">
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



        {/* Sidebar expand button when collapsed */}
        {!sidebarOpen && (
          <button className="sidebar-expand-btn" onClick={() => setSidebarOpen(true)} title="Open Filters">
            ‹
          </button>
        )}

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
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Running analytics in your browser
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

      {/* ─── Right Sidebar (Draggable) ─── */}
      <aside
        ref={sidebarRef}
        className={`sidebar ${!sidebarOpen ? 'collapsed' : ''}`}
        style={sidebarPos.x != null ? {
          top: sidebarPos.y,
          right: 'auto',
          left: sidebarPos.x,
          transition: 'none',
        } : undefined}
      >
        <div
          className="sidebar-header"
          onMouseDown={onDragStart}
          style={{ cursor: 'grab' }}
        >
          <h2>⠿ Filters & Data</h2>
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(false)} title="Collapse">
            ›
          </button>
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



          {/* Run Analytics */}
          {boundary && (boundary.source === 'corestack' || boundary.source === 'upload' || boundary.source === 'places') && (() => {
            const mwsAvailable =
              (boundary.source === 'upload' || boundary.source === 'places')
                ? true
                : boundary.mwsAvailable ?? null;
            const mwsChecking = mwsAvailable === null;
            return (
            <div className="analytics-section">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => handleSubmit('raster_tiled')}
                  disabled={isRunning}
                  id="run-analytics-tiled-btn"
                  style={{ width: '100%', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', borderColor: '#059669' }}
                >
                  {isRunning ? (
                    <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span> Processing…</>
                  ) : ' Get Analysis Report'}
                </button>
                {mwsChecking && (
                  <div style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className="spinner" style={{ width: 10, height: 10, borderWidth: 2, borderColor: 'rgba(139,92,246,0.2)', borderTopColor: '#8b5cf6', flexShrink: 0 }}></span>
                    Checking data availability…
                  </div>
                )}
                {mwsAvailable === true && boundary.source === 'corestack' && (
                  <button
                    className="btn btn-secondary btn-lg"
                    onClick={() => handleSubmit('mws')}
                    disabled={isRunning}
                    id="run-analytics-mws-btn"
                    style={{ width: '100%' }}
                  >
                    {isRunning ? (
                      <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span> Processing…</>
                    ) : '🌿 MWS Path (Vector)'}
                  </button>
                )}
              </div>
            </div>
            );
          })()}
        </div>
      </aside>
    </div>
  );
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
