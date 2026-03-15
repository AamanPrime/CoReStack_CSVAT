/**
 * CSVAT — Dashboard Page (Landscape Explorer Layout).
 *
 * Full-screen map with collapsible right sidebar "Filters & Data".
 * Location selectors, category tabs, layer toggles, analytics.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import BoundarySelector from '../components/BoundarySelector';
import ReportViewer from '../components/ReportViewer';
import ExportManager from '../components/ExportManager';
import { MapView } from '../components/GoogleMapsIntegration';
import {
  runAnalyticsPipeline,
  runGEEFallbackPipeline,
  MWSUnavailableError,
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

  // Layer & analytics state
  const availableLayers = [];
  const selectedLayers = ['cropping_intensity', 'surface_water', 'vegetation'];
  const selectedYears = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const [executionMode, setExecutionMode] = useState('SERVER');
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');

  // GEE confirmation state
  const [showGEEPrompt, setShowGEEPrompt] = useState(false);
  const [geePromptMessage, setGeePromptMessage] = useState('');
  const [pendingBoundary, setPendingBoundary] = useState(null);

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
  const handleWASMSubmit = async (computePath = 'raster') => {
    setIsRunning(true);
    setError(null);
    setResults(null);
    setShowGEEPrompt(false);

    try {
      setProgress(`Starting client-side analytics pipeline (${computePath.toUpperCase()})…`);
      const result = await runAnalyticsPipeline(
        boundary, selectedLayers, selectedYears,
        (msg) => setProgress(msg),
        computePath
      );
      setProgress('Rendering report…');
      await delay(200);
      setResults(result);
    } catch (err) {
      if (err instanceof MWSUnavailableError) {
        setGeePromptMessage(err.message);
        setPendingBoundary(err.boundary);
        setShowGEEPrompt(true);
      } else {
        setError(err.message || 'Client-side analytics pipeline failed.');
      }
    }
    setIsRunning(false);
    setProgress('');
  };

  // ─── SERVER Mode Submit ───
  const handleServerSubmit = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);

    try {
      setProgress('Submitting job to server…');
      const jobData = {
        boundary_id: boundary.boundary_id || null,
        boundary_geojson: boundary.geojson || boundary.boundary_geojson || null,
        village_name: boundary.village_name || boundary.name || 'Unknown',
        state: boundary.state || '',
        district: boundary.district || '',
        tehsil: boundary.tehsil || '',
        layers: selectedLayers,
        years: selectedYears,
        mode: 'SERVER',
      };
      const job = await createJob(jobData);

      if (job.status === 'SUCCESS') {
        setResults(job.result_json);
        setIsRunning(false);
        setProgress('');
        return;
      }
      if (job.status === 'FAILED') {
        setError(job.error_message || 'Server-side analytics failed.');
        setIsRunning(false);
        setProgress('');
        return;
      }

      setProgress('Job queued — waiting for server to process…');
      const stopPolling = pollJob(job.id, (updatedJob) => {
        if (updatedJob.status === 'RUNNING') {
          setProgress('Server is processing analytics…');
        } else if (updatedJob.status === 'SUCCESS') {
          setResults(updatedJob.result_json);
          setIsRunning(false);
          setProgress('');
        } else if (updatedJob.status === 'FAILED') {
          setError(updatedJob.error_message || 'Server analytics failed.');
          setIsRunning(false);
          setProgress('');
        }
      }, 2000);
      stopPollingRef.current = stopPolling;
    } catch (err) {
      setError(err.message || 'Failed to submit server-side job.');
      setIsRunning(false);
      setProgress('');
    }
  };

  const handleSubmit = (path) => {
    if (!boundary) return;
    if (executionMode === 'SERVER') handleServerSubmit();
    else handleWASMSubmit(path);
  };

  const handleGEEConfirm = async () => {
    setShowGEEPrompt(false);
    setIsRunning(true);
    setError(null);
    try {
      setProgress('User confirmed — starting GEE pipeline…');
      const result = await runGEEFallbackPipeline(
        pendingBoundary, selectedLayers, selectedYears,
        (msg) => setProgress(msg),
      );
      setProgress('Rendering report…');
      await delay(200);
      setResults(result);
    } catch (err) {
      setError(err.message || 'GEE pipeline failed.');
    }
    setIsRunning(false);
    setProgress('');
  };

  const handleGEEDecline = () => {
    setShowGEEPrompt(false);
    setPendingBoundary(null);
  };

  const handleReset = () => {
    if (stopPollingRef.current) {
      stopPollingRef.current();
      stopPollingRef.current = null;
    }
    setResults(null);
    setError(null);
    setProgress('');
    setShowGEEPrompt(false);
    setPendingBoundary(null);
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
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {executionMode === 'WASM'
                ? 'Running analytics in your browser'
                : 'Server is processing — polling for results'}
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

        {/* Results Overlay */}
        {results && (
          <div className="report-overlay">
            <div className="report-overlay-inner">
              <div className="report-overlay-header">
                <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  📊 Analytics Results — {results.data_source || 'Computed'}
                  {executionMode === 'SERVER' && ' (Server Mode)'}
                </h2>
                <button className="report-close-btn" onClick={handleReset} title="Close & New Analysis">
                  ✕
                </button>
              </div>

              {/* Data Warning Banner */}
              {results.data_warning && (
                <div style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.2)',
                  borderRadius: '10px', padding: '0.75rem 1rem',
                  marginBottom: '1.25rem',
                  display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                }}>
                  <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#f59e0b', marginBottom: '0.15rem', fontSize: '0.85rem' }}>
                      Lower Resolution Data
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                      {results.data_warning}
                    </div>
                  </div>
                </div>
              )}

              <ReportViewer results={results} />
              <ExportManager results={results} />

              <div style={{ textAlign: 'center', marginTop: '1.5rem', paddingBottom: '1.5rem' }}>
                <button className="btn btn-primary" onClick={handleReset} id="new-analysis-btn">
                  🔄 New Analysis
                </button>
              </div>
            </div>
          </div>
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
            onMapUpdate={(center, geojson) => {
              if (center) setMapCenter(center);
              if (geojson) setMapGeojson(geojson);
            }}
          />



          {/* Execution Mode & Run */}
          {boundary && boundary.source === 'corestack' && (
            <div className="analytics-section">
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                Execution Mode
              </div>
              <div className="execution-mode-toggle">
                <button
                  className={`execution-mode-btn ${executionMode === 'WASM' ? 'active' : ''}`}
                  onClick={() => setExecutionMode('WASM')}
                  id="mode-wasm-btn"
                >
                  ⚡ Client (WASM)
                </button>
                <button
                  className={`execution-mode-btn ${executionMode === 'SERVER' ? 'active' : ''}`}
                  onClick={() => setExecutionMode('SERVER')}
                  id="mode-server-btn"
                >
                  🖥️ Server
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                {executionMode === 'WASM'
                  ? 'Analytics run in your browser via WebAssembly'
                  : 'Analytics dispatched to backend workers'}
              </div>

              {executionMode === 'WASM' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={() => handleSubmit('raster')}
                    disabled={isRunning}
                    id="run-analytics-raster-btn"
                    style={{ width: '100%', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', borderColor: '#059669' }}
                  >
                    {isRunning ? (
                      <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span> Processing…</>
                    ) : '⚡ Raster Path (High Accuracy)'}
                  </button>
                  <button
                    className="btn btn-secondary btn-lg"
                    onClick={() => handleSubmit('mws')}
                    disabled={isRunning}
                    id="run-analytics-mws-btn"
                    style={{ width: '100%' }}
                  >
                    {isRunning ? (
                      <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span> Processing…</>
                    ) : '⚡ MWS Path (Vector)'}
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => handleSubmit()}
                  disabled={isRunning}
                  id="run-analytics-server-btn"
                  style={{ width: '100%' }}
                >
                  {isRunning ? (
                    <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span> Processing…</>
                  ) : '🖥️ Run Analytics (Server)'}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ─── GEE Confirmation Modal ─── */}
      {showGEEPrompt && (
        <div className="gee-prompt-overlay">
          <div className="gee-modal">
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.1)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.5rem',
              }}>
                ⚠️
              </div>
            </div>

            <h3 style={{
              textAlign: 'center', fontSize: '1.05rem', fontWeight: 600,
              color: '#f59e0b', marginBottom: '0.5rem',
            }}>
              Village Not Available on CoRE Stack
            </h3>

            <p style={{
              color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6,
              fontSize: '0.85rem', marginBottom: '1rem',
            }}>
              {geePromptMessage}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
              <div style={{
                background: 'rgba(34, 197, 94, 0.06)', borderRadius: '10px',
                padding: '0.6rem', textAlign: 'center',
                border: '1px solid rgba(34, 197, 94, 0.15)',
              }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  CoRE Stack
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#22c55e' }}>10m</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Not Available</div>
              </div>
              <div style={{
                background: 'rgba(59, 130, 246, 0.06)', borderRadius: '10px',
                padding: '0.6rem', textAlign: 'center',
                border: '1px solid rgba(59, 130, 246, 0.15)',
              }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Google Earth Engine
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#3b82f6' }}>500m</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Available</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={handleGEEDecline} style={{ flex: 1 }} id="gee-decline-btn">
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleGEEConfirm} style={{ flex: 1 }} id="gee-confirm-btn">
                🌐 Use GEE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
