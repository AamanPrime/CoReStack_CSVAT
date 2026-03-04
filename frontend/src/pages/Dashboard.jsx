/**
 * CSVAT — Dashboard Page (MWS-First with GEE Fallback).
 *
 * Flow:
 * 1. User clicks "Run Analytics"
 * 2. Frontend tries CoRE Stack MWS intersection
 * 3. If unavailable → prompt "Use GEE?" confirmation modal
 * 4. If user confirms → run GEE + Pyodide WASM pipeline
 */
import React, { useState } from 'react';
import BoundarySelector from '../components/BoundarySelector';
import LayerSelector from '../components/LayerSelector';
import ReportViewer from '../components/ReportViewer';
import ExportManager from '../components/ExportManager';
import {
  runAnalyticsPipeline,
  runGEEFallbackPipeline,
  MWSUnavailableError,
} from '../services/wasmEngine';

export default function Dashboard() {
  const [boundary, setBoundary] = useState(null);
  const [selectedLayers, setSelectedLayers] = useState(['cropping_intensity', 'surface_water', 'vegetation']);
  const [selectedYears, setSelectedYears] = useState([2019, 2020, 2021, 2022, 2023]);
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');

  // GEE confirmation state
  const [showGEEPrompt, setShowGEEPrompt] = useState(false);
  const [geePromptMessage, setGeePromptMessage] = useState('');
  const [pendingBoundary, setPendingBoundary] = useState(null);

  const handleSubmit = async () => {
    if (!boundary) return;
    setIsRunning(true);
    setError(null);
    setResults(null);
    setShowGEEPrompt(false);

    try {
      setProgress('Starting analytics pipeline…');

      const result = await runAnalyticsPipeline(
        boundary,
        selectedLayers,
        selectedYears,
        (msg) => setProgress(msg),
      );

      setProgress('Rendering report…');
      await delay(200);
      setResults(result);
    } catch (err) {
      if (err instanceof MWSUnavailableError) {
        // Show the confirmation prompt instead of an error
        setGeePromptMessage(err.message);
        setPendingBoundary(err.boundary);
        setShowGEEPrompt(true);
      } else {
        setError(err.message || 'Analytics pipeline failed.');
      }
    }
    setIsRunning(false);
    setProgress('');
  };

  const handleGEEConfirm = async () => {
    setShowGEEPrompt(false);
    setIsRunning(true);
    setError(null);

    try {
      setProgress('User confirmed — starting GEE pipeline…');

      const result = await runGEEFallbackPipeline(
        pendingBoundary,
        selectedLayers,
        selectedYears,
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
            backgroundColor: 'var(--accent-teal)', display: 'inline-block',
          }}></span>
          CoRE Stack MWS Primary | GEE Fallback Available
        </div>
      </div>

      {/* Step 1: Boundary Selection */}
      {!results && (
        <>
          <BoundarySelector onBoundarySelect={setBoundary} />

          {/* Step 2: Layer & Year Config */}
          {boundary && (
            <div style={{ marginTop: '1.5rem' }}>
              <LayerSelector
                selectedLayers={selectedLayers}
                onLayersChange={setSelectedLayers}
                selectedYears={selectedYears}
                onYearsChange={setSelectedYears}
              />

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
                    '🚀 Run Analytics'
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
            Processing analytics — please wait
          </div>
        </div>
      )}

      {/* GEE Confirmation Modal */}
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
            <span>Analytics Results — {results.data_source || 'Computed'}</span>
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
