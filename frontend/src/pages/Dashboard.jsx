/**
 * CSVAT — Dashboard Page (WASM-First).
 * All analytics run client-side via wasmEngine. Backend is data proxy only.
 */
import React, { useState, useRef } from 'react';
import BoundarySelector from '../components/BoundarySelector';
import LayerSelector from '../components/LayerSelector';
import ReportViewer from '../components/ReportViewer';
import ExportManager from '../components/ExportManager';
import { runAnalyticsPipeline } from '../services/wasmEngine';

export default function Dashboard() {
  const [boundary, setBoundary] = useState(null);
  const [selectedLayers, setSelectedLayers] = useState(['cropping_intensity', 'surface_water', 'vegetation']);
  const [selectedYears, setSelectedYears] = useState([2019, 2020, 2021, 2022, 2023]);
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');

  const handleSubmit = async () => {
    if (!boundary) return;
    setIsRunning(true);
    setError(null);
    setResults(null);

    try {
      setProgress('Starting analytics pipeline…');

      const result = await runAnalyticsPipeline(
        boundary,
        selectedLayers,
        selectedYears,
        (msg) => setProgress(msg), // Progress callback
      );

      setProgress('Rendering report…');
      await delay(200);

      setResults(result);
    } catch (err) {
      setError(err.message || 'Analytics pipeline failed.');
    }
    setIsRunning(false);
    setProgress('');
  };

  const handleReset = () => {
    setBoundary(null);
    setResults(null);
    setError(null);
    setProgress('');
  };

  return (
    <div>
      {/* Hero */}
      <div className="hero">
        <h2>Village-Level Socio‑Ecological Analytics</h2>
        <p>
          Select a village boundary, choose your analytics layers, and generate comprehensive
          insights — computed entirely in your browser via WASM.
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
          Client-Side Execution Mode (WASM)
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
                    '🚀 Run Analytics (Client-Side)'
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
            Fetching real satellite data from GEE — computed in-browser via Pyodide WASM
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
            <span>Analytics Results — {results.data_source || 'Computed Client-Side'}</span>
          </div>

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
