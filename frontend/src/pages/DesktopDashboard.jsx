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
  const [progressPct, setProgressPct] = useState(0);

  // Maps progress messages to a coarse 0–100 percent so users see a real bar.
  // Watches for the "[n/N]" fiscal-year pattern emitted by fullTiffEngine,
  // and falls back to milestone phrases for the surrounding phases.
  const updateProgress = useCallback((msg) => {
    setProgress(msg);
    if (typeof msg !== 'string') return;
    const m = msg.match(/\[(\d+)\/(\d+)\]/);
    if (m) {
      const cur = parseInt(m[1], 10);
      const total = parseInt(m[2], 10);
      if (total > 0) {
        // 15% pre, 70% during years, 15% post
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
    setProgressPct(0);

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
    setProgressPct(0);
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
            {/* 0–100 progress bar — big bold percent label */}
            <div style={{ width: 420, maxWidth: '80vw', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                fontSize: '3rem',
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
                height: 14,
                background: 'rgba(0,0,0,0.08)',
                borderRadius: 8,
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
              <span></span>
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

          {/* Get Analysis Report — dual-path: Satellite Raster vs MWS Vector */}
          {boundary && (
            <div className="analytics-section">
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                Run the analysis
              </div>

              {/* Satellite Raster button — always available */}
              <button
                className="btn btn-primary btn-lg"
                onClick={() => handleSubmit('raster_tiled')}
                disabled={isRunning}
                id="run-analytics-tiled-btn"
                title="Download village GeoTIFFs from IndiaSAT LULC v3 and compute LULC analytics client-side (most accurate)"
                style={{ width: '100%', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', borderColor: '#059669', marginBottom: '0.5rem' }}
              >
                {isRunning ? (
                  <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span> Working…</>
                ) : 'Get Report (Slow, Most Accurate)'}
              </button>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.6rem', lineHeight: 1.4 }}>
                IndiaSAT LULC v3 · 10 m 
              </div>

              {/* MWS Vector button — disabled for uploads/places */}
              {boundary.source === 'upload' || boundary.source === 'places' ? (
                <div style={{
                  padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1.5px dashed #c4b5fd',
                  fontSize: '0.72rem', color: '#a78bfa', textAlign: 'center', lineHeight: 1.5,
                  background: 'rgba(139,92,246,0.04)',
                }}>
                   MWS Vector path requires a village selected via CoRE Stack browser
                </div>
              ) : (
                <>
                  <button
                    className="btn btn-secondary btn-lg"
                    onClick={() => handleSubmit('mws_vector')}
                    disabled={isRunning || !boundary.mwsAvailable}
                    id="run-analytics-mws-btn"
                    title={
                      !boundary.mwsAvailable
                        ? 'No MWS watershed data for this village — use Satellite Raster instead'
                        : 'Use CoRE Stack MWS vector data — faster but lower resolution than satellite raster'
                    }
                    style={{
                      width: '100%',
                      background: (!boundary.mwsAvailable || isRunning)
                        ? 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)'
                        : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      color: '#fff', border: 'none',
                      borderRadius: '8px', padding: '0.6rem 1rem',
                      fontSize: '0.88rem', fontWeight: 600,
                      cursor: (!boundary.mwsAvailable || isRunning) ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s', letterSpacing: '0.01em',
                      opacity: !boundary.mwsAvailable ? 0.65 : 1,
                    }}
                  >
                    {isRunning ? (
                      <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span> Working…</>
                    ) : 'Get Report(Fast, Less Accurate'}
                  </button>
                  <div style={{ fontSize: '0.68rem', color: boundary.mwsAvailable ? 'var(--text-muted)' : '#f87171', marginTop: '0.35rem', lineHeight: 1.4 }}>
                    {boundary.mwsAvailable
                      ? 'CoRE Stack MWS · watershed-level · Faster — works offline.'
                      : ' No MWS data for this village — use Satellite Raster.'}
                  </div>
                </>
              )}
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
