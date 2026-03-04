/**
 * CSVAT — Dashboard Page.
 *
 * Dual Execution Mode (per SRS / ADD):
 * - WASM (default / primary): Client-side analytics via wasmEngine → Pyodide
 * - SERVER (optional): Backend Celery workers via Jobs API → polling
 *
 * Flow (both modes):
 * 1. User selects boundary + layers + years
 * 2. User chooses execution mode (WASM is default)
 * 3. User clicks "Run Analytics"
 *    - WASM: runs MWS-first pipeline in browser, GEE fallback if needed
 *    - SERVER: creates job via REST API, polls until complete
 * 4. Results displayed in ReportViewer + ExportManager
 */
import React, { useState, useRef } from 'react';
import BoundarySelector from '../components/BoundarySelector';
import LayerSelector from '../components/LayerSelector';
import ReportViewer from '../components/ReportViewer';
import ExportManager from '../components/ExportManager';
import {
  runAnalyticsPipeline,
  runGEEFallbackPipeline,
  MWSUnavailableError,
} from '../services/wasmEngine';
import { createJob, pollJob } from '../services/api';

export default function Dashboard() {
  const [boundary, setBoundary] = useState(null);
  const [selectedLayers, setSelectedLayers] = useState(['cropping_intensity', 'surface_water', 'vegetation']);
  const [selectedYears, setSelectedYears] = useState([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  const [executionMode, setExecutionMode] = useState('WASM'); // 'WASM' | 'SERVER'
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');

  // GEE confirmation state (WASM mode only)
  const [showGEEPrompt, setShowGEEPrompt] = useState(false);
  const [geePromptMessage, setGeePromptMessage] = useState('');
  const [pendingBoundary, setPendingBoundary] = useState(null);

  // Server-side polling cleanup ref
  const stopPollingRef = useRef(null);

  // ─── WASM Mode Submit ───
  const handleWASMSubmit = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);
    setShowGEEPrompt(false);

    try {
      setProgress('Starting client-side analytics pipeline…');
      const result = await runAnalyticsPipeline(
        boundary, selectedLayers, selectedYears,
        (msg) => setProgress(msg),
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
        // Completed synchronously (sync fallback)
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

      // Job is PENDING → start polling
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

  // ─── Main Submit Handler ───
  const handleSubmit = () => {
    if (!boundary) return;
    if (executionMode === 'SERVER') {
      handleServerSubmit();
    } else {
      handleWASMSubmit();
    }
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
    setBoundary(null);
    setResults(null);
    setError(null);
    setProgress('');
    setShowGEEPrompt(false);
    setPendingBoundary(null);
  };

  return (
    <div>
      {/* Hero */}
      <div className="hero">
        <h2>Village-Level Socio‑Ecological Analytics</h2>
        <p>
          Select a village boundary, choose your analytics layers, and generate comprehensive
          insights — powered by CoRE Stack MWS data.
        </p>
        <div style={{
          marginTop: '0.75rem', fontSize: '0.8rem',
          color: 'var(--accent-teal)', fontWeight: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: executionMode === 'WASM' ? 'var(--accent-teal)' : 'var(--accent-purple)',
            display: 'inline-block',
          }}></span>
          {executionMode === 'WASM'
            ? 'Client-Side WASM (Primary) | GEE Fallback Available'
            : 'Server-Side Processing | Celery Workers'}
        </div>
      </div>

      {/* Step 1: Boundary + Mode Selection */}
      {!results && (
        <>
          <BoundarySelector onBoundarySelect={setBoundary} />

          {/* Step 2: Layer & Year Config + Mode Toggle */}
          {boundary && (
            <div style={{ marginTop: '1.5rem' }}>
              <LayerSelector
                selectedLayers={selectedLayers}
                onLayersChange={setSelectedLayers}
                selectedYears={selectedYears}
                onYearsChange={setSelectedYears}
              />

              {/* ─── Execution Mode Toggle ─── */}
              <div className="glass-card" style={{
                marginTop: '1rem', padding: '1rem 1.5rem',
                borderRadius: '14px',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  flexWrap: 'wrap', gap: '0.75rem',
                }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Execution Mode
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      {executionMode === 'WASM'
                        ? 'Analytics run in your browser via WebAssembly — no server load'
                        : 'Analytics dispatched to backend Celery workers — higher precision'}
                    </div>
                  </div>

                  <div style={{
                    display: 'flex', borderRadius: '10px', overflow: 'hidden',
                    border: '1px solid var(--border)',
                  }}>
                    <button
                      type="button"
                      onClick={() => setExecutionMode('WASM')}
                      id="mode-wasm-btn"
                      style={{
                        padding: '0.5rem 1rem',
                        fontSize: '0.8rem', fontWeight: 500,
                        border: 'none', cursor: 'pointer',
                        background: executionMode === 'WASM'
                          ? 'linear-gradient(135deg, var(--accent-green), var(--accent-teal))'
                          : 'transparent',
                        color: executionMode === 'WASM' ? '#fff' : 'var(--text-secondary)',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      ⚡ Client (WASM)
                    </button>
                    <button
                      type="button"
                      onClick={() => setExecutionMode('SERVER')}
                      id="mode-server-btn"
                      style={{
                        padding: '0.5rem 1rem',
                        fontSize: '0.8rem', fontWeight: 500,
                        border: 'none', cursor: 'pointer',
                        background: executionMode === 'SERVER'
                          ? 'linear-gradient(135deg, var(--accent-purple), #7c3aed)'
                          : 'transparent',
                        color: executionMode === 'SERVER' ? '#fff' : 'var(--text-secondary)',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      🖥️ Server
                    </button>
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={handleSubmit}
                  disabled={isRunning || selectedLayers.length === 0 || selectedYears.length === 0}
                  id="run-analytics-btn"
                >
                  {isRunning ? (
                    <>
                      <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }}></span>
                      Processing…
                    </>
                  ) : (
                    executionMode === 'WASM' ? '⚡ Run Analytics (WASM)' : '🖥️ Run Analytics (Server)'
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Loading */}
      {isRunning && (
        <div className="loading-container">
          <div className="spinner"></div>
          <div className="loading-text">{progress}</div>
          <div style={{
            fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem',
          }}>
            {executionMode === 'WASM'
              ? 'Running analytics in your browser — please wait'
              : 'Server is processing — polling for results'}
          </div>
        </div>
      )}

      {/* GEE Confirmation Modal (WASM mode only) */}
      {showGEEPrompt && (
        <div className="gee-prompt-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, animation: 'fadeIn 0.3s ease',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
            borderRadius: '20px', padding: '2rem 2.5rem',
            maxWidth: '520px', width: '90%',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.5)',
          }}>
            {/* Warning Icon */}
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.15)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.8rem',
              }}>
                ⚠️
              </div>
            </div>

            <h3 style={{
              textAlign: 'center', fontSize: '1.2rem', fontWeight: 600,
              color: '#f59e0b', marginBottom: '0.75rem',
            }}>
              Village Not Available on CoRE Stack
            </h3>

            <p style={{
              color: '#94a3b8', textAlign: 'center', lineHeight: 1.6,
              fontSize: '0.9rem', marginBottom: '1.25rem',
            }}>
              {geePromptMessage}
            </p>

            {/* Resolution comparison */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem',
              marginBottom: '1.5rem',
            }}>
              <div style={{
                background: 'rgba(34, 197, 94, 0.1)', borderRadius: '12px',
                padding: '0.75rem', textAlign: 'center',
                border: '1px solid rgba(34, 197, 94, 0.2)',
              }}>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  CoRE Stack
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#22c55e' }}>10m</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Not Available</div>
              </div>
              <div style={{
                background: 'rgba(59, 130, 246, 0.1)', borderRadius: '12px',
                padding: '0.75rem', textAlign: 'center',
                border: '1px solid rgba(59, 130, 246, 0.2)',
              }}>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  Google Earth Engine
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#3b82f6' }}>500m</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Available</div>
              </div>
            </div>

            {/* Buttons */}
            <div style={{
              display: 'flex', gap: '0.75rem', justifyContent: 'center',
            }}>
              <button
                className="btn btn-secondary"
                onClick={handleGEEDecline}
                style={{ flex: 1, padding: '0.7rem' }}
                id="gee-decline-btn"
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleGEEConfirm}
                style={{
                  flex: 1, padding: '0.7rem',
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                }}
                id="gee-confirm-btn"
              >
                🌐 Use GEE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="error-box" style={{ marginTop: '1.5rem' }}>
          <span>⚠️</span>
          <div>
            <strong>Error:</strong> {error}
            <br />
            <button className="btn btn-sm btn-secondary" onClick={handleReset} style={{ marginTop: '0.5rem' }}>
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <>
          <div className="section-divider">
            <span>Analytics Results — {results.data_source || 'Computed'}
              {executionMode === 'SERVER' && ' (Server Mode)'}
            </span>
          </div>

          {/* Data Warning Banner (shown for GEE fallback) */}
          {results.data_warning && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '12px', padding: '1rem 1.25rem',
              marginBottom: '1.5rem',
              display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            }}>
              <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 600, color: '#f59e0b', marginBottom: '0.25rem' }}>
                  Lower Resolution Data
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.5 }}>
                  {results.data_warning}
                </div>
              </div>
            </div>
          )}

          <ReportViewer results={results} />
          <ExportManager results={results} />

          <div style={{ textAlign: 'center', marginTop: '2rem' }}>
            <button className="btn btn-secondary" onClick={handleReset} id="new-analysis-btn">
              🔄 New Analysis
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
