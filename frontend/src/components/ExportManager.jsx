/**
 * CSVAT — ExportManager Component.
 * Handles HTML, CSV, JSON, and PDF exports.
 * PDF is generated client-side with jsPDF and downloaded directly (no print dialog).
 */
import React, { useState } from 'react';
import { generateCSV, generateHTMLReport } from '../services/wasmEngine';

export default function ExportManager({ results, jobId }) {
  const [pdfLoading, setPdfLoading] = useState(false);

  if (!results) return null;

  const safeName = (results.village_name || 'report').replace(/\s+/g, '_');

  const downloadBlob = (content, filename, mimeType) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  };

  const handleHTMLExport = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    downloadBlob(generateHTMLReport(results), `CSVAT_${safeName}_Report.html`, 'text/html');
  };

  const handleCSVExport = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    downloadBlob(generateCSV(results), `CSVAT_${safeName}_Data.csv`, 'text/csv');
  };

  const handleJSONExport = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    downloadBlob(JSON.stringify(results, null, 2), `CSVAT_${safeName}_Raw.json`, 'application/json');
  };

  const handlePDFExport = async (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    setPdfLoading(true);
    try {
      // Prefer server-generated PDF if available
      if (jobId) {
        const response = await fetch(`/api/v1/jobs/${jobId}/assets/pdf`);
        if (response.ok) {
          const blob = await response.blob();
          downloadBlob(blob, `CSVAT_${safeName}_Report.pdf`, 'application/pdf');
          return;
        }
      }

      // Client-side PDF via jsPDF — no print dialog, no page navigation
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 14;
      const colW = pageW - margin * 2;
      let y = 20;

      const nl = (extra = 6) => {
        y += extra;
        if (y > 272) { doc.addPage(); y = 20; }
      };

      // Header bar
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 30, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(15); doc.setFont('helvetica', 'bold');
      doc.text('CSVAT Village Analytics Report', margin, 13);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      doc.text(
        `${results.village_name || ''} | ${results.state || ''} | ${results.district || ''} | ${results.tehsil || ''}`,
        margin, 20
      );
      doc.text(
        `Generated: ${new Date().toLocaleDateString()}    Source: ${results.data_source || 'CoRE Stack'}`,
        margin, 26
      );
      y = 38;

      const section = (title) => {
        nl(3);
        doc.setFillColor(241, 245, 249);
        doc.rect(margin, y, colW, 7, 'F');
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.text(title, margin + 2, y + 5);
        nl(10);
      };

      const table = (headers, rows) => {
        const cw = colW / headers.length;
        // Header row
        doc.setFillColor(226, 232, 240);
        doc.rect(margin, y, colW, 6, 'F');
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        headers.forEach((h, i) => doc.text(h, margin + i * cw + 2, y + 4));
        nl(7);
        // Data rows
        doc.setFont('helvetica', 'normal');
        rows.forEach((row, ri) => {
          if (y > 272) { doc.addPage(); y = 20; }
          if (ri % 2 === 0) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, y, colW, 6, 'F');
          }
          doc.setTextColor(30, 41, 59);
          row.forEach((cell, i) => doc.text(String(cell ?? '—'), margin + i * cw + 2, y + 4));
          nl(7);
        });
      };

      // Cropping Intensity
      const ci = results.cropping_intensity;
      if (ci?.data?.length) {
        section('Cropping Intensity');
        table(
          ['Year', 'Single (ha)', 'Double (ha)', 'Triple (ha)', 'Total (ha)', 'Intensity'],
          ci.data.map(d => [
            d.year,
            d.single_crop_ha,
            d.double_crop_ha,
            d.triple_crop_ha,
            d.total_cropped_ha,
            d.cropping_intensity ?? '—',
          ])
        );
      }

      // Surface Water
      const sw = results.surface_water;
      if (sw?.data?.length) {
        section('Seasonal Surface Water');
        table(
          ['Year', 'Kharif (ha)', 'Rabi (ha)', 'Zaid (ha)', 'Total (ha)'],
          sw.data.map(d => [
            d.year,
            d.kharif_ha ?? d.seasonal_monsoon_ha ?? 0,
            d.rabi_ha ?? d.seasonal_winter_ha ?? 0,
            d.zaid_ha ?? d.perennial_ha ?? 0,
            d.total_water_ha,
          ])
        );
      }

      // Vegetation
      const vg = results.vegetation;
      if (vg) {
        section('Vegetation & Deforestation');
        table(
          ['Metric', 'Value (ha)'],
          [
            ['Tree Cover Gain', vg.tree_cover_gain_ha],
            ['Tree Cover Loss', vg.tree_cover_loss_ha],
            ['Net Change', vg.net_change_ha],
            ['Degraded Land', vg.degraded_land_ha],
          ]
        );
      }

      // Footer on every page
      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7); doc.setTextColor(148, 163, 184);
        doc.text(`CSVAT CoRE Stack Analytics  |  Page ${i} of ${totalPages}`, margin, 292);
      }

      // Direct download — no dialog opens
      downloadBlob(doc.output('blob'), `CSVAT_${safeName}_Report.pdf`, 'application/pdf');

    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed. Please try the HTML export instead.');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="export-bar animate-fade-in">
      <button className="btn btn-secondary" type="button" onClick={handleHTMLExport} id="export-html-btn">
        📄 Interactive HTML
      </button>
      <button className="btn btn-secondary" type="button" onClick={handleCSVExport} id="export-csv-btn">
        📋 Download CSV
      </button>
      <button className="btn btn-secondary" type="button" onClick={handleJSONExport} id="export-json-btn">
        🗂️ Download JSON
      </button>
      <button
        className="btn btn-secondary"
        type="button"
        onClick={handlePDFExport}
        disabled={pdfLoading}
        id="export-pdf-btn"
      >
        {pdfLoading ? '⏳ Generating…' : '📄 Download PDF'}
      </button>
    </div>
  );
}
