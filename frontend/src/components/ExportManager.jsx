/**
 * CSVAT — ExportManager Component (Client-Side).
 * All exports generated in-browser from the results object — no backend needed.
 */
import React from 'react';
import { generateCSV, generateHTMLReport } from '../services/wasmEngine';

export default function ExportManager({ results }) {
  if (!results) return null;

  const downloadBlob = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleHTMLExport = () => {
    const html = generateHTMLReport(results);
    const safeName = (results.village_name || 'report').replace(/\s+/g, '_');
    downloadBlob(html, `CSVAT_${safeName}_Report.html`, 'text/html');
  };

  const handleCSVExport = () => {
    const csv = generateCSV(results);
    const safeName = (results.village_name || 'report').replace(/\s+/g, '_');
    downloadBlob(csv, `CSVAT_${safeName}_Data.csv`, 'text/csv');
  };

  const handleJSONExport = () => {
    const json = JSON.stringify(results, null, 2);
    const safeName = (results.village_name || 'report').replace(/\s+/g, '_');
    downloadBlob(json, `CSVAT_${safeName}_Raw.json`, 'application/json');
  };

  return (
    <div className="export-bar animate-fade-in">
      <button className="btn btn-secondary" onClick={handleHTMLExport} id="export-html-btn">
        📊 Interactive HTML Report
      </button>
      <button className="btn btn-secondary" onClick={handleCSVExport} id="export-csv-btn">
        📋 Download CSV
      </button>
      <button className="btn btn-secondary" onClick={handleJSONExport} id="export-json-btn">
        🗂️ Download JSON
      </button>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', alignSelf: 'center' }}>
        All exports generated client-side
      </span>
    </div>
  );
}
