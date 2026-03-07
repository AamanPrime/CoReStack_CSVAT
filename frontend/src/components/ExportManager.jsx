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
    // Inject temporary print-only CSS that hides everything except the results overlay
    const printStyle = document.createElement('style');
    printStyle.id = 'csvat-print-styles';
    printStyle.textContent = `
      @media print {
        /* Reset html/body so content flows across pages */
        html, body {
          height: auto !important;
          overflow: visible !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        /* Hide navbar */
        .navbar { display: none !important; }

        /* Make all parent containers static and auto-height */
        .app-layout,
        .map-container {
          display: block !important;
          position: static !important;
          width: 100% !important;
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
        }

        /* Hide everything inside map-container except report-overlay */
        .map-container > *:not(.report-overlay) { display: none !important; }

        /* The report overlay — make it flow naturally across pages */
        .report-overlay {
          display: block !important;
          position: static !important;
          width: 100% !important;
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
          background: white !important;
          animation: none !important;
        }
        .report-overlay-inner {
          max-height: none !important;
          overflow: visible !important;
          max-width: 100% !important;
          padding: 1rem !important;
        }

        /* Hide sidebar */
        .sidebar { display: none !important; }

        /* Hide interactive elements */
        .export-bar, #new-analysis-btn,
        .report-close-btn,
        .report-overlay-header button,
        .gee-prompt-overlay { display: none !important; }

        /* Print-friendly cards */
        .card {
          break-inside: avoid;
          page-break-inside: avoid;
          box-shadow: none !important;
          border: 1px solid #ddd !important;
          margin-bottom: 1rem !important;
        }
        .chart-wrapper {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        canvas { max-width: 100% !important; }
      }
    `;
    document.head.appendChild(printStyle);

    // Trigger native browser print
    window.print();

    // Clean up the injected style after print dialog closes
    setTimeout(() => {
      const el = document.getElementById('csvat-print-styles');
      if (el) el.remove();
    }, 1000);
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
        {jobId ? '📄 PDF via server' : '💻 All exports client-side'}
      </span>
    </div>
  );
}
