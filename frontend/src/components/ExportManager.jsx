/**
 * CSVAT — ExportManager Component.
 * Handles HTML, CSV, JSON, and PDF exports.
 *
 * - WASM mode: HTML/CSV/JSON generated client-side, PDF via browser print
 * - SERVER mode: PDF downloaded from backend /api/v1/jobs/{id}/assets/pdf
 */
import React, { useState } from 'react';
import { generateCSV, generateHTMLReport } from '../services/wasmEngine';

export default function ExportManager({ results, jobId }) {
  const [pdfLoading, setPdfLoading] = useState(false);

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

  const safeName = (results.village_name || 'report').replace(/\s+/g, '_');

  const handleHTMLExport = () => {
    const html = generateHTMLReport(results);
    downloadBlob(html, `CSVAT_${safeName}_Report.html`, 'text/html');
  };

  const handleCSVExport = () => {
    const csv = generateCSV(results);
    downloadBlob(csv, `CSVAT_${safeName}_Data.csv`, 'text/csv');
  };

  const handleJSONExport = () => {
    const json = JSON.stringify(results, null, 2);
    downloadBlob(json, `CSVAT_${safeName}_Raw.json`, 'application/json');
  };

  const handlePDFExport = async () => {
    if (jobId) {
      // Server mode: download PDF from backend
      setPdfLoading(true);
      try {
        const url = `/api/v1/jobs/${jobId}/assets/pdf`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('PDF generation failed');
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `CSVAT_${safeName}_Report.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      } catch (err) {
        console.error('PDF download failed:', err);
        // Fallback to browser print
        handlePDFBrowserPrint();
      } finally {
        setPdfLoading(false);
      }
    } else {
      // Client mode: use browser print
      handlePDFBrowserPrint();
    }
  };

  const handlePDFBrowserPrint = () => {
    const html = generateHTMLReport(results);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  return (
    <div className="export-bar animate-fade-in">
      <button className="btn btn-secondary" onClick={handleHTMLExport} id="export-html-btn">
        📊 Interactive HTML
      </button>
      <button className="btn btn-secondary" onClick={handleCSVExport} id="export-csv-btn">
        📋 Download CSV
      </button>
      <button className="btn btn-secondary" onClick={handleJSONExport} id="export-json-btn">
        🗂️ Download JSON
      </button>
      <button
        className="btn btn-secondary"
        onClick={handlePDFExport}
        disabled={pdfLoading}
        id="export-pdf-btn"
      >
        {pdfLoading ? '⏳ Generating…' : '📄 Download PDF'}
      </button>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', alignSelf: 'center' }}>
        {jobId ? 'PDF via server' : 'All exports client-side'}
      </span>
    </div>
  );
}
