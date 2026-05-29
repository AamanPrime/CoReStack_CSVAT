/**
 * CSVAT — ReportViewer Component.
 * Renders analytics cards (charts, stats, tables) followed by Terraso-style
 * fullscreen slides for the Data Story.
 *
 * Sections:
 *  1. Report Header (Village info + data source)
 *  2. Summary Stats Cards (MWS count, data source, year range)
 *  3. Cropping Intensity Trends (stacked bar + table)
 *  4. Surface Water — Kharif / Rabi / Zaid (bar + table)
 *  5. Vegetation & Tree Cover Change (stats + transitions horizontal bar)
 *  6. Cropping Intensity Change Transitions (horizontal bar)
 *  7. Terrain Composition (doughnut/bar)
 *  8. Waterbodies
 *  9. Download & Export
 * 10. Terraso Fullscreen Slide Storyboard
 */
import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import '../styles/StoryMap.css';
import { generateCSV } from '../services/wasmEngine';
import SlideEditor from './SlideEditor';
import { getCustomSlides, getVillageStory } from '../services/api';
import {
  runStoryboardPipeline,
  buildTemplateSlides,
  fetchCachedStoryboard,
  saveStoryboardToDb,
} from '../services/storyboardEngine';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
);

// Chart.js defaults for light theme
ChartJS.defaults.color = '#475569';
ChartJS.defaults.borderColor = 'rgba(226,232,240,0.6)';

// Backend proxy base for static map images (key stays server-side)
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

/**
 * Generate a proxied static satellite map image URL for a slide.
 * The backend /api/v1/maps/static endpoint appends the API key server-side,
 * so the key is never exposed in client code or exported HTML.
 */
function getStaticMapUrl(center, zoom = 14, size = '1280x900', heading = 0) {
  if (!center?.lat || !center?.lng) return null;
  return `${API_BASE}/api/v1/maps/static?center=${center.lat},${center.lng}&zoom=${zoom}&size=${size}&maptype=satellite&heading=${heading}`;
}

/**
 * StorySlides — Terraso-style storyboard component.
 * Shows ONE chapter at a time. Scroll-snap within the panel.
 * Background image changes per chapter with cross-fade transition.
 */
function StorySlides({ slides, villageName, onSlideEdit, ciData, swData }) {
  const scrollRef = useRef(null);
  const cardRefs = useRef([]);
  const [activeIdx, setActiveIdx] = React.useState(0);
  
  // Inline editing state
  const [editingIdx, setEditingIdx] = useState(-1);
  const [editTitle, setEditTitle] = useState('');
  const [editNarrative, setEditNarrative] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');

  const startEdit = (idx, slide) => {
    setEditingIdx(idx);
    setEditTitle(slide.title.replace(/^[\p{Emoji_Presentation}\s]+/u, '')); // Strip leading emoji for editing
    setEditNarrative(slide.narrative);
    setEditImageUrl(slide.imageUrl || '');
  };

  const saveEdit = (idx, slide) => {
    // Preserve the original emoji icon if it exists
    const iconMatch = slide.title.match(/^([\p{Emoji_Presentation}\s]+)/u);
    const prefix = iconMatch ? iconMatch[1] : '';
    const fullTitle = `${prefix}${editTitle}`.trim();

    if (onSlideEdit) {
      onSlideEdit(idx, { title: fullTitle, narrative: editNarrative, imageUrl: editImageUrl || null });
    }
    setEditingIdx(-1);
  };

  useEffect(() => {
    const scrollRoot = scrollRef.current;
    if (!scrollRoot) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idx = parseInt(entry.target.dataset.idx, 10);
            if (!isNaN(idx)) setActiveIdx(idx);
          }
        });
      },
      { root: scrollRoot, threshold: [0.5, 0.8] }
    );

    cardRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [slides]);

  const setCardRef = useCallback((el, idx) => {
    cardRefs.current[idx] = el;
  }, []);

  const scrollToSlide = useCallback((idx) => {
    const card = cardRefs.current[idx];
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  if (!slides || slides.length === 0) return null;

  const activeBg = slides[activeIdx]?.mapUrl || null;

  return (
    <div className="ts-storyboard">
      {/* Background images — cross-fade via opacity */}
      {slides.map((slide, idx) => (
        <div
          key={idx}
          className={`ts-bg-layer ${idx === activeIdx ? 'ts-bg-layer--active' : ''}`}
          style={{
            backgroundImage: slide.mapUrl ? `url(${slide.mapUrl})` : 'none',
            backgroundColor: slide.mapUrl ? undefined : '#1a1a2e',
          }}
        />
      ))}

      {/* Dark overlay */}
      <div className="ts-map-overlay" />

      {/* Scroll-snap panel — one card per "page" */}
      <div className="ts-scroll-panel" ref={scrollRef}>
        {slides.map((slide, idx) => (
          <div
            key={idx}
            ref={(el) => setCardRef(el, idx)}
            data-idx={idx}
            className={`ts-snap-page`}
            style={{ position: 'relative' }}
          >
            <div className={`ts-card ${idx === activeIdx ? 'ts-card--visible' : ''}`}>
              <div className="ts-card-chapter" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Chapter {idx + 1}</span>
                {idx === activeIdx && editingIdx !== idx && (
                  <button className="ts-inline-edit-btn" onClick={() => startEdit(idx, slide)}> Edit</button>
                )}
              </div>
              
              {editingIdx === idx ? (
                <div className="ts-inline-editor">
                  <input 
                    type="text" 
                    value={editTitle} 
                    onChange={(e) => setEditTitle(e.target.value)} 
                    className="ts-inline-input"
                    placeholder="Slide Title"
                  />
                  <textarea 
                    value={editNarrative} 
                    onChange={(e) => setEditNarrative(e.target.value)} 
                    className="ts-inline-textarea"
                    rows={8}
                    placeholder="Slide narrative..."
                  />
                  <input
                    type="text"
                    value={editImageUrl}
                    onChange={(e) => setEditImageUrl(e.target.value)}
                    className="ts-inline-input"
                    placeholder="Image URL (optional)"
                  />
                  <div className="ts-inline-actions">
                    <button onClick={() => setEditingIdx(-1)}>Cancel</button>
                    <button onClick={() => saveEdit(idx, slide)} style={{ background: '#3b82f6', color: 'white', border: 'none' }}>Save</button>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="ts-card-title">
                    {slide.icon && <span className="ts-card-icon">{slide.icon}</span>} {slide.title.replace(/^[\p{Emoji_Presentation}\s]+/u, '')}
                  </h3>
                  {slide.imageUrl && (
                    <img
                      className="ts-card-image"
                      src={slide.imageUrl}
                      alt={slide.title}
                      loading="lazy"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <p className="ts-card-narrative" style={{ whiteSpace: 'pre-line' }}>{slide.narrative}</p>
                </>
              )}
            </div>

            {/* Right side LULC Bar Chart */}
            {slide.show_lulc_data && ciData && ciData.length > 0 && (
              <div 
                className={`ts-card ${idx === activeIdx ? 'ts-card--visible' : ''}`}
                style={{ 
                  position: 'absolute', 
                  right: '5%', 
                  width: '40%', 
                  maxWidth: '500px',
                  background: 'rgba(0, 0, 0, 0.85)'
                }}
              >
                <h4 style={{ color: '#fff', marginTop: 0, marginBottom: '1rem', fontFamily: 'Inter', fontSize: '1.2rem' }}>
                  LULC: Agricultural Intensity
                </h4>
                <div style={{ height: '300px' }}>
                  <Bar
                    data={{
                      labels: ciData.map(d => d.year),
                      datasets: [
                        { label: 'Triple Crop', data: ciData.map(d => d.triple_crop_ha), backgroundColor: 'rgba(251, 191, 36, 0.8)' },
                        { label: 'Double Crop', data: ciData.map(d => d.double_crop_ha), backgroundColor: 'rgba(96, 165, 250, 0.8)' },
                        { label: 'Single Crop', data: ciData.map(d => d.single_crop_ha), backgroundColor: 'rgba(74, 222, 128, 0.8)' },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { labels: { color: '#fff' } } },
                      scales: {
                        x: { stacked: true, ticks: { color: '#ccc' }, grid: { display: false } },
                        y: { stacked: true, ticks: { color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.1)' } }
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {/* Right side Water Bar Chart */}
            {slide.show_water_data && swData && swData.length > 0 && (
              <div 
                className={`ts-card ${idx === activeIdx ? 'ts-card--visible' : ''}`}
                style={{ 
                  position: 'absolute', 
                  right: '5%', 
                  width: '40%', 
                  maxWidth: '500px',
                  background: 'rgba(0, 0, 0, 0.85)'
                }}
              >
                <h4 style={{ color: '#fff', marginTop: 0, marginBottom: '1rem', fontFamily: 'Inter', fontSize: '1.2rem' }}>
                  Surface Water Footprint
                </h4>
                <div style={{ height: '300px' }}>
                  <Bar
                    data={{
                      labels: swData.map(d => d.year),
                      datasets: [
                        { label: 'Kharif', data: swData.map(d => d.kharif_ha ?? d.seasonal_monsoon_ha ?? 0), backgroundColor: 'rgba(20, 184, 166, 0.8)' },
                        { label: 'Rabi', data: swData.map(d => d.rabi_ha ?? d.seasonal_winter_ha ?? 0), backgroundColor: 'rgba(59, 130, 246, 0.8)' },
                        { label: 'Zaid', data: swData.map(d => d.zaid_ha ?? d.perennial_ha ?? 0), backgroundColor: 'rgba(147, 197, 253, 0.8)' },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { labels: { color: '#fff' } } },
                      scales: {
                        x: { stacked: true, ticks: { color: '#ccc' }, grid: { display: false } },
                        y: { stacked: true, ticks: { color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.1)' } }
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Chapter indicator dots — right side */}
      <div className="ts-dots">
        {slides.map((_, idx) => (
          <button
            key={idx}
            className={`ts-dot ${idx === activeIdx ? 'ts-dot--active' : ''}`}
            onClick={() => scrollToSlide(idx)}
            title={`Chapter ${idx + 1}`}
          />
        ))}
      </div>

      {/* Village info badge */}
      <div className="ts-village-badge">
        <span className="ts-village-badge-label"> {villageName || 'Village'}</span>
      </div>
    </div>
  );
}

/**
 * Generate story slides from analytics results.
 * Each slide gets its own static map URL with different zoom levels.
 */

/**
 * Download the report as PDF using html2pdf.js (loaded from CDN on demand).
 * Excludes the storyboard section from the PDF output.
 */
async function downloadReportAsPDF(contentEl, villageName) {
  const safeName = (villageName || 'report').replace(/\s+/g, '_');
  // Dynamically load html2pdf.js if not already loaded
  if (!window.html2pdf) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Hide the storyboard section before PDF generation
  const storyboardEl = contentEl.parentElement?.querySelector('.ts-storyboard');
  const storyboardParent = storyboardEl?.parentElement;
  const editBtn = contentEl.parentElement?.querySelector('.ts-edit-btn');
  if (storyboardParent) storyboardParent.style.display = 'none';
  if (editBtn) editBtn.style.display = 'none';

  const opt = {
    margin: [10, 5, 10, 5],
    filename: `CSVAT_${safeName}_Report.pdf`,
    image: { type: 'jpeg', quality: 0.92 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0, windowHeight: contentEl.scrollHeight },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  };
  await window.html2pdf().set(opt).from(contentEl).save();

  // Restore the storyboard after PDF generation
  if (storyboardParent) storyboardParent.style.display = '';
  if (editBtn) editBtn.style.display = '';
}

/**
 * Build and download a self-contained offline HTML file that mirrors the ReportViewer page
 * with an interactive storyboard (scroll-snap + cross-fade backgrounds).
 */
async function downloadReportAsHTML(results, storySlides, villageName) {
  const safeName = (villageName || 'report').replace(/\s+/g, '_');

  // 1. Clone the report-viewer-content (analytics cards only, NOT the storyboard)
  const reportContent = document.querySelector('.report-viewer-content');
  if (!reportContent) {
    alert('Report not visible. Please open the report first.');
    return;
  }
  const clone = reportContent.cloneNode(true);

  // 3. Convert all <canvas> charts to inline <img> tags
  const origCanvases = reportContent.querySelectorAll('canvas');
  const clonedCanvases = clone.querySelectorAll('canvas');
  origCanvases.forEach((canvas, i) => {
    try {
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.maxWidth = '100%';
      if (clonedCanvases[i]?.parentNode) {
        clonedCanvases[i].parentNode.replaceChild(img, clonedCanvases[i]);
      }
    } catch (e) {
      console.warn('Canvas export failed:', e);
    }
  });

  // 4. Remove interactive-only elements from clone
  clone.querySelectorAll('.export-bar, .se-overlay').forEach(el => el.remove());

  // 5. Pre-fetch storyboard background images as base64 data-URIs
  //    This ensures the exported HTML is fully self-contained with no API key references.
  const slideMapUrls = (storySlides || []).map(s => s.mapUrl || null);
  const base64Maps = await Promise.all(
    slideMapUrls.map(async (url) => {
      if (!url) return null;
      try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    })
  );

  const slidesHTML = (storySlides || []).map((slide, idx) => {
    const bgDataUri = base64Maps[idx];
    const bgStyle = bgDataUri
      ? `background-image: url(${bgDataUri}); background-size: cover; background-position: center;`
      : slide.mapUrl
        ? `background-image: url(${slide.mapUrl}); background-size: cover; background-position: center;`
        : 'background-color: #1a1a2e;';
    return `
      <div class="ts-bg-layer" data-slide-idx="${idx}" style="${bgStyle}"></div>
    `;
  }).join('');

  // 6. Build HTML for each slide, embedding any rendered chart canvases from the live DOM
  const livePages = document.querySelectorAll('.ts-storyboard .ts-snap-page');

  const cardsHTML = (storySlides || []).map((slide, idx) => {
    let chartHtml = '';
    const livePage = livePages[idx];
    if (livePage) {
      const canvas = livePage.querySelector('canvas');
      if (canvas) {
        try {
          const imgData = canvas.toDataURL('image/png');
          const title = slide.show_lulc_data ? 'LULC: Agricultural Intensity' : 'Surface Water Footprint';
          chartHtml = `
            <div class="ts-card ts-card--visible" style="position: absolute; right: 5%; width: 40%; max-width: 500px; background: rgba(0, 0, 0, 0.85); display: flex; flex-direction: column;">
              <h4 style="color: #fff; margin-top: 0; margin-bottom: 1rem; font-family: Inter, sans-serif; font-size: 1.2rem;">${title}</h4>
              <img src="${imgData}" style="width: 100%; height: auto; object-fit: contain;" alt="${title} Chart"/>
            </div>
          `;
        } catch (e) {
          console.warn('Failed to export storyboard canvas:', e);
        }
      }
    }

    return `
    <div class="ts-snap-page" data-idx="${idx}" style="position: relative;">
      <div class="ts-card ts-card--visible">
        <div class="ts-card-chapter">Chapter ${idx + 1}</div>
        <h3 class="ts-card-title">
          ${slide.icon ? `<span class="ts-card-icon">${slide.icon}</span>` : ''} ${(slide.title || '').replace(/^[\p{Emoji_Presentation}\s]+/u, '')}
        </h3>
        ${slide.imageUrl ? `<img class="ts-card-image" src="${slide.imageUrl}" alt="${slide.title || ''}" loading="lazy" onerror="this.style.display='none'"/>` : ''}
        <p class="ts-card-narrative" style="white-space: pre-line;">${slide.narrative || ''}</p>
      </div>
      ${chartHtml}
    </div>
  `}).join('');

  const dotsHTML = (storySlides || []).map((_, idx) => `
    <button class="ts-dot" data-dot-idx="${idx}" title="Chapter ${idx + 1}"></button>
  `).join('');

  const storyboardSection = storySlides && storySlides.length > 0 ? `
    <div class="ts-storyboard" id="interactive-storyboard">
      ${slidesHTML}
      <div class="ts-map-overlay"></div>
      <div class="ts-scroll-panel" id="ts-scroll-panel">
        ${cardsHTML}
      </div>
      <div class="ts-dots" id="ts-dots">
        ${dotsHTML}
      </div>
      <div class="ts-village-badge">
        <span class="ts-village-badge-label"> ${villageName || 'Village'}</span>
      </div>
    </div>
  ` : '';

  // 6. Build the interactive storyboard JavaScript
  const storyboardJS = storySlides && storySlides.length > 0 ? `
    (function() {
      var scrollPanel = document.getElementById('ts-scroll-panel');
      var pages = scrollPanel.querySelectorAll('.ts-snap-page');
      var bgLayers = document.querySelectorAll('.ts-bg-layer');
      var dots = document.querySelectorAll('.ts-dot');
      var activeIdx = 0;

      function setActive(idx) {
        if (idx === activeIdx) return;
        activeIdx = idx;
        // Cross-fade backgrounds
        bgLayers.forEach(function(layer, i) {
          layer.classList.toggle('ts-bg-layer--active', i === idx);
        });
        // Update dots
        dots.forEach(function(dot, i) {
          dot.classList.toggle('ts-dot--active', i === idx);
        });
        // Animate cards
        pages.forEach(function(page, i) {
          var card = page.querySelector('.ts-card');
          if (card) card.classList.toggle('ts-card--visible', i === idx);
        });
      }

      // IntersectionObserver for scroll-snap detection
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            var idx = parseInt(entry.target.getAttribute('data-idx'), 10);
            if (!isNaN(idx)) setActive(idx);
          }
        });
      }, { root: scrollPanel, threshold: [0.5, 0.8] });

      pages.forEach(function(page) { observer.observe(page); });

      // Dot click navigation
      dots.forEach(function(dot) {
        dot.addEventListener('click', function() {
          var idx = parseInt(dot.getAttribute('data-dot-idx'), 10);
          if (!isNaN(idx) && pages[idx]) {
            pages[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      });

      // Initialize first slide
      setActive(0);
      if (bgLayers[0]) bgLayers[0].classList.add('ts-bg-layer--active');
      if (dots[0]) dots[0].classList.add('ts-dot--active');
      var firstCard = pages[0] && pages[0].querySelector('.ts-card');
      if (firstCard) firstCard.classList.add('ts-card--visible');
    })();
  ` : '';

  // 7. Build the final HTML — fully scrollable with interactive storyboard
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CSVAT Report — ${villageName || 'Village'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --navbar-height: 0px;
      --bg: #f8fafc;
      --card: #ffffff;
      --text: #1e293b;
      --text-secondary: #64748b;
      --text-muted: #94a3b8;
      --heading: #0f172a;
      --border: #e2e8f0;
      --card-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 100vh;
    }

    /* ─── Sticky Navigation ─── */
    .html-nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(255,255,255,0.95);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border);
      padding: 0.6rem 1rem;
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      justify-content: center;
    }
    .html-nav a {
      font-size: 0.78rem;
      font-weight: 600;
      color: #6d28d9;
      text-decoration: none;
      padding: 0.3rem 0.8rem;
      border-radius: 6px;
      transition: background 0.2s;
    }
    .html-nav a:hover { background: rgba(139,92,246,0.1); }

    /* ─── Report Content Section ─── */
    .report-viewer-content {
      max-width: 960px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    /* ─── Cards ─── */
    .card {
      background: var(--card);
      border-radius: 12px;
      border: 1px solid var(--border);
      box-shadow: var(--card-shadow);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    .card-header .icon { font-size: 1.3rem; }
    .card-header h3 { font-size: 1.15rem; font-weight: 700; color: var(--heading); margin: 0; }

    /* ─── Stats Grid ─── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1rem;
    }
    .stat-card {
      background: #f8fafc;
      border-radius: 10px;
      border: 1px solid var(--border);
      padding: 1rem;
      text-align: center;
    }
    .stat-card .value { font-size: 1.5rem; font-weight: 800; }
    .stat-card .label { font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.25rem; }
    .stat-blue .value { color: #2563eb; }
    .stat-green .value { color: #16a34a; }
    .stat-amber .value { color: #d97706; }
    .stat-red .value { color: #dc2626; }

    /* ─── Data Tables ─── */
    .data-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    .data-table th, .data-table td { padding: 0.65rem 0.75rem; text-align: right; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
    .data-table th { color: var(--heading); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; background: #f8fafc; letter-spacing: 0.05em; }
    .data-table th:first-child, .data-table td:first-child { text-align: left; }

    /* ─── Chart Wrapper ─── */
    .chart-wrapper { position: relative; height: 300px; margin: 1rem 0; }
    .chart-wrapper img { width: 100%; height: 100%; object-fit: contain; }

    /* ─── Narrative ─── */
    .narrative { color: var(--text); line-height: 1.7; font-size: 0.9rem; margin-top: 1rem; background: #f1f5f9; padding: 1rem; border-radius: 8px; border-left: 4px solid #3b82f6; }

    /* ─── Boundary Info ─── */
    .boundary-info { display: flex; gap: 1.5rem; flex-wrap: wrap; justify-content: center; }
    .boundary-info-item { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; }
    .boundary-info-item .label { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
    .boundary-info-item .value { font-size: 0.9rem; font-weight: 600; color: var(--heading); }

    /* ─── Export bar: hide in HTML export ─── */
    .export-bar { display: none !important; }

    /* ═══ TERRASO STORYBOARD (fully interactive in HTML export) ═══ */
    .ts-storyboard {
      position: relative;
      width: 90%;
      max-width: 1200px;
      height: 80vh;
      margin: 2rem auto;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05);
    }
    .ts-bg-layer {
      position: absolute;
      inset: 0;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      z-index: 0;
      opacity: 0;
      transition: opacity 0.8s ease-in-out;
    }
    .ts-bg-layer--active { opacity: 1; }
    .ts-map-overlay {
      position: absolute;
      inset: 0;
      z-index: 1;
      background: linear-gradient(to right, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 45%, rgba(0,0,0,0.15) 100%);
      pointer-events: none;
    }
    .ts-scroll-panel {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      z-index: 2;
      scroll-snap-type: y mandatory;
      scroll-behavior: smooth;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .ts-scroll-panel::-webkit-scrollbar { display: none; }
    .ts-snap-page {
      height: 100%;
      min-height: 100%;
      scroll-snap-align: center;
      display: flex;
      align-items: center;
      padding: 2rem 52% 2rem 1.5rem;
      box-sizing: border-box;
    }
    .ts-card {
      background: rgba(0,0,0,0.78);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 2rem;
      color: #ffffff;
      width: 100%;
      opacity: 0;
      transform: translateY(30px) scale(0.97);
      transition: opacity 0.5s cubic-bezier(0.16,1,0.3,1), transform 0.5s cubic-bezier(0.16,1,0.3,1);
    }
    .ts-card--visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .ts-card-chapter {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: rgba(255,255,255,0.4);
      margin-bottom: 0.6rem;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.35s ease-out 0.1s, transform 0.35s ease-out 0.1s;
    }
    .ts-card--visible .ts-card-chapter { opacity: 1; transform: translateY(0); }
    .ts-card-title {
      font-family: 'Playfair Display', serif;
      font-size: 1.35rem;
      font-weight: 700;
      line-height: 1.3;
      color: #ffffff;
      margin: 0 0 1rem 0;
      opacity: 0;
      transform: translateY(14px);
      transition: opacity 0.4s ease-out 0.2s, transform 0.4s ease-out 0.2s;
    }
    .ts-card--visible .ts-card-title { opacity: 1; transform: translateY(0); }
    .ts-card-icon { font-size: 1.2rem; margin-right: 0.2rem; }
    .ts-card-image {
      width: 100%;
      max-height: 180px;
      object-fit: cover;
      border-radius: 8px;
      margin-bottom: 1rem;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.4s ease-out 0.25s, transform 0.4s ease-out 0.25s;
    }
    .ts-card--visible .ts-card-image { opacity: 1; transform: translateY(0); }
    .ts-card-narrative {
      font-size: 0.9rem;
      font-weight: 400;
      line-height: 1.75;
      color: rgba(255,255,255,0.82);
      margin: 0;
      opacity: 0;
      transform: translateY(18px);
      transition: opacity 0.45s ease-out 0.3s, transform 0.45s ease-out 0.3s;
    }
    .ts-card--visible .ts-card-narrative { opacity: 1; transform: translateY(0); }
    .ts-dots {
      position: absolute;
      right: 1.5rem;
      top: 50%;
      transform: translateY(-50%);
      z-index: 5;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ts-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.4);
      background: transparent;
      cursor: pointer;
      padding: 0;
      transition: all 0.3s ease;
    }
    .ts-dot--active {
      background: #ffffff;
      border-color: #ffffff;
      transform: scale(1.3);
      box-shadow: 0 0 8px rgba(255,255,255,0.4);
    }
    .ts-dot:hover:not(.ts-dot--active) {
      border-color: rgba(255,255,255,0.7);
      background: rgba(255,255,255,0.2);
    }
    .ts-village-badge {
      position: absolute;
      top: 1rem;
      right: 1rem;
      z-index: 3;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 0.5rem 1rem;
    }
    .ts-village-badge-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #ffffff;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .ts-storyboard { width: 95%; height: 70vh; }
      .ts-snap-page { padding: 1.5rem 1rem; }
      .ts-card { padding: 1.25rem; }
      .ts-card-title { font-size: 1.15rem; }
      .ts-card-narrative { font-size: 0.85rem; }
      .ts-dots { right: 0.75rem; gap: 8px; }
      .ts-dot { width: 8px; height: 8px; }
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .html-nav { display: none; }
      .ts-storyboard { height: auto; }
      .ts-scroll-panel { position: relative; height: auto; overflow: visible; scroll-snap-type: none; }
      .ts-snap-page { height: auto; min-height: auto; scroll-snap-align: none; padding: 1.5rem; }
      .ts-card { opacity: 1; transform: none; }
      .ts-card-chapter, .ts-card-title, .ts-card-narrative, .ts-card-image { opacity: 1; transform: none; }
      .ts-dots { display: none; }
    }
  </style>
</head>
<body>
  <div style="text-align:center;padding:1.5rem 1.5rem 1.25rem;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;">
    <h1 style="font-family:'Playfair Display',serif;font-size:1.6rem;margin:0;">CSVAT Village Analytics Report</h1>
    <p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin-top:0.35rem;">${villageName || 'Village'} — Generated ${new Date().toLocaleDateString()}</p>
  </div>
  <nav class="html-nav">
    <a href="#report-analytics">📊 Analytics</a>
    <a href="#report-storyboard">📖 Storyboard</a>
    <a href="#report-footer">📄 Footer</a>
  </nav>

  <div id="report-analytics">
    ${clone.outerHTML}
  </div>

  <div id="report-storyboard" style="padding: 0 0 2rem;">
    ${storyboardSection}
  </div>

  <div id="report-footer" style="text-align:center;padding:1.5rem;color:#94a3b8;font-size:0.8rem;border-top:1px solid #e2e8f0;">
    Generated by CSVAT &bull; CoRE Stack Analytics Platform &bull; ${new Date().toISOString().slice(0, 10)}
  </div>

  <script>
    ${storyboardJS}
  </script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CSVAT_${safeName}_Report.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateStorySlides(results, ciData, swData, center) {
  const { vegetation, crop_intensity_change, village_name, state, district, tehsil } = results;
  const slides = [];

  // Slide 1: Village Introduction
  slides.push({
    title: `${village_name || 'This Village'} — An Overview`,
    icon: '🌾',
    narrative: `${village_name || 'This village'}${district ? `, in ${district} district` : ''}${state ? `, ${state}` : ''} has been studied using satellite images taken over several years. This report shows how the village has changed — how much land is being farmed, how water sources have shifted across seasons, and whether the local forests and green cover have grown or reduced. All data comes directly from space-based sensors and is updated yearly.`,
    mapUrl: getStaticMapUrl(center, 13, '1280x900', 0),
    imageUrl: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=600&h=300&fit=crop',
    mapZoom: 13,
  });

  // Slide 2: Cropping Intensity
  if (ciData && ciData.length > 0) {
    const latest = ciData[ciData.length - 1];
    const earliest = ciData[0];
    const trend = latest.total_cropped_ha > earliest.total_cropped_ha ? 'increased' : 'decreased';
    const intensityTrend = latest.cropping_intensity > earliest.cropping_intensity ? 'intensified' : 'weakened';
    slides.push({
      title: 'How Much Land Is Being Farmed?',
      icon: '🌱',
      narrative: `Between ${earliest.year} and ${latest.year}, the total farmed area has ${trend} from ${earliest.total_cropped_ha?.toFixed(0)} hectares to ${latest.total_cropped_ha?.toFixed(0)} hectares. Farmers here are now growing ${intensityTrend === 'intensified' ? 'more crops per year on the same land' : 'fewer crops per year'}. In the latest year, ${latest.triple_crop_ha?.toFixed(0)} ha is harvested three times a year, ${latest.double_crop_ha?.toFixed(0)} ha twice, and ${latest.single_crop_ha?.toFixed(0)} ha just once. Triple-cropping means the land and water are being used very efficiently.`,
      mapUrl: getStaticMapUrl(center, 15, '1280x900', 90),
      imageUrl: 'https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=600&h=300&fit=crop',
      mapZoom: 15,
      show_lulc_data: true,
    });
  }

  // Slide 3: Surface Water
  if (swData && swData.length > 0) {
    const latest = swData[swData.length - 1];
    const earliest = swData[0];
    const kharif = latest.kharif_ha ?? latest.seasonal_monsoon_ha ?? 0;
    const rabi = latest.rabi_ha ?? latest.seasonal_winter_ha ?? 0;
    const zaid = latest.zaid_ha ?? latest.perennial_ha ?? 0;
    slides.push({
      title: 'Water — Where and When?',
      icon: '💧',
      narrative: `In ${latest.year}, the village had water on the land across ${(latest.total_water_ha ?? 0).toFixed(0)} hectares in total. This includes ${kharif.toFixed(0)} ha during the monsoon (Kharif), ${rabi.toFixed(0)} ha in winter (Rabi), and ${zaid.toFixed(0)} ha in summer (Zaid). Looking across ${swData.length} years of data, we can see whether water availability is improving or reducing season by season — which directly affects how much food can be grown and when.`,
      mapUrl: getStaticMapUrl(center, 14, '1280x900', 180),
      imageUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600&h=300&fit=crop',
      mapZoom: 14,
      show_water_data: true,
    });
  }

  // Slide 4: Vegetation & Tree Cover
  if (vegetation) {
    const gain = vegetation.tree_cover_gain_ha?.toFixed(2) ?? '—';
    const loss = vegetation.tree_cover_loss_ha?.toFixed(2) ?? '—';
    const net = vegetation.net_change_ha;
    const netStr = net != null ? `${net >= 0 ? '+' : ''}${net.toFixed(2)}` : '—';
    const direction = net >= 0 ? 'a net gain' : 'a net loss';
    slides.push({
      title: 'Trees and Green Cover',
      icon: '🌳',
      narrative: `The village has seen ${direction} of ${Math.abs(net ?? 0).toFixed(0)} hectares of tree cover. In simple terms: ${gain} ha of new trees grew, while ${loss} ha of existing trees were lost. ${vegetation.degraded_land_ha ? `About ${vegetation.degraded_land_ha.toFixed(0)} ha is showing signs of land degradation and needs attention.` : ''} ${vegetation.transitions?.length > 0 ? `In most cases, the lost tree cover has converted to ${vegetation.transitions.filter(t => (t.to_label || t.to) !== 'Tree Cover').map(t => t.to_label || t.to).slice(0, 3).join(', ')}.` : ''} Keeping tree cover healthy matters for water retention, soil health, and local cooling.`,
      mapUrl: getStaticMapUrl(center, 14, '1280x900', 270),
      imageUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&h=300&fit=crop',
      mapZoom: 14,
    });
  }



  // Slide 6: Cropping Intensity Change (if available)
  if (crop_intensity_change && crop_intensity_change.length > 0) {
    const improvements = crop_intensity_change.filter(t => {
      const lbl = t.category || t.label || '';
      return lbl.includes('Single To Double') || lbl.includes('Double To Triple') || lbl.includes('Single To Triple');
    });
    const declines = crop_intensity_change.filter(t => {
      const lbl = t.category || t.label || '';
      return lbl.includes('Double To Single') || lbl.includes('Triple To Double') || lbl.includes('Triple To Single');
    });
    const totalImprovement = improvements.reduce((sum, t) => sum + (t.area_ha || 0), 0);
    const totalDecline = declines.reduce((sum, t) => sum + (t.area_ha || 0), 0);
    slides.push({
      title: 'Are Farming Practices Improving?',
      icon: '',
      narrative: `Over the study period, ${totalImprovement.toFixed(0)} hectares moved to more intensive farming — farmers shifted from one crop a year to two or three. This is a positive sign, often meaning better water access or improved seeds and practices. At the same time, ${totalDecline.toFixed(0)} hectares moved to lower intensity, which may indicate water shortage, soil issues, or other challenges. Understanding this shift helps target where support is most needed.`,
      mapUrl: getStaticMapUrl(center, 15, '1280x900', 135),
      imageUrl: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=600&h=300&fit=crop',
      mapZoom: 15,
    });
  }

  return slides;
}


export default function ReportViewer({
  results,
  boundary,
  onReset,
  layerUrls = [],
  activeLayerNames = [],
}) {
  if (!results) return null;

  const {
    cropping_intensity, surface_water, vegetation, waterbodies,
    village_name, state, district, tehsil, data_source,
    mws_count, crop_intensity_change, area_hectares,
  } = results;

  const totalAreaHa = area_hectares || 0;

  const ciData = Array.isArray(cropping_intensity?.data)
    ? cropping_intensity.data
    : Array.isArray(cropping_intensity) ? cropping_intensity : null;

  const swData = Array.isArray(surface_water?.data)
    ? surface_water.data
    : Array.isArray(surface_water) ? surface_water : null;

  // Compute village center for static map images
  const mapCenter = useMemo(() => {
    if (boundary?.center) return boundary.center;
    if (boundary?.geojson?.features?.[0]?.geometry?.coordinates) {
      const coords = boundary.geojson.features[0].geometry.coordinates;
      const flat = coords.flat(Infinity);
      const lats = [], lngs = [];
      for (let i = 0; i < flat.length; i += 2) { lngs.push(flat[i]); lats.push(flat[i + 1]); }
      return { lat: lats.reduce((a, b) => a + b, 0) / lats.length, lng: lngs.reduce((a, b) => a + b, 0) / lngs.length };
    }
    return { lat: 20.5937, lng: 78.9629 };
  }, [boundary]);

  // Generate story slides from analytics data
  const storySlides = useMemo(
    () => generateStorySlides(results, ciData, swData, mapCenter),
    [results, ciData, swData, mapCenter]
  );

  const reportContentRef = useRef(null);

  // ─── Village Story from Database (LLM-generated narratives) ───
  const [dbStory, setDbStory] = useState(null);

  useEffect(() => {
    if (!village_name) return;
    //console.log('[CSVAT] Fetching DB story for:', village_name, state, district, tehsil);
    getVillageStory(village_name, state, district, tehsil)
      .then((data) => {
        //console.log('[CSVAT] DB story received:', data?.name, 'chapters:', data?.story_chapters?.length);
        setDbStory(data);
      })
      .catch((err) => {
        //console.log('[CSVAT] No DB story found:', err?.response?.status || err.message);
        setDbStory(null);
      });
  }, [village_name, state, district, tehsil]);

  // Themed images for DB story chapters (by map_action) — rural India
  const DB_CHAPTER_IMAGES = {
    zoom_to_village: 'https://images.unsplash.com/photo-1590767950092-42b8362368da?w=600&h=300&fit=crop',  // Indian rural village huts
    show_overview: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?w=600&h=300&fit=crop',      // Rural Indian landscape
    show_lulc_latest: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=600&h=300&fit=crop', // Green farmland
    show_lulc_oldest: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=600&h=300&fit=crop', // Golden wheat fields
    show_water: 'https://images.unsplash.com/photo-1542332213-31f87348057f?w=600&h=300&fit=crop',       // Water well / river bed
  };

  // Convert DB story chapters to slide format
  const dbSlides = useMemo(() => {
    if (!dbStory?.story_chapters) return [];

    // Build chapter slides (include ALL chapters)
    const chapterSlides = dbStory.story_chapters.map((ch, idx) => ({
      title: ch.title,
      icon: idx === 0 ? '📖' : idx === 1 ? '🌾' : '💧',
      narrative: ch.narrative,
      imageUrl: DB_CHAPTER_IMAGES[ch.map_action] || DB_CHAPTER_IMAGES.zoom_to_village,
      mapUrl: getStaticMapUrl(
        mapCenter,
        ch.map_action === 'zoom_to_village' ? 14 : 15,
        '1280x900',
        idx * 90
      ),
      isDbStory: true,
    }));

    // Build a "Village Heritage" slide from economy/temples/cultural_notes/historical_context
    const heritage = [];
    if (dbStory.historical_context) heritage.push(dbStory.historical_context);
    if (dbStory.economy) heritage.push(`💰 Economy: ${dbStory.economy}`);
    if (dbStory.temples && dbStory.temples.length > 0) heritage.push(`🛕 Temples: ${dbStory.temples.join(', ')}`);
    if (dbStory.cultural_notes) heritage.push(`🎭 ${dbStory.cultural_notes}`);
    if (dbStory.languages && dbStory.languages.length > 0) heritage.push(`🗣️ Languages: ${dbStory.languages.join(', ')}`);

    if (heritage.length > 0) {
      chapterSlides.push({
        title: `Heritage of ${dbStory.name}`,
        icon: '🏛️',
        narrative: heritage.join('\n\n'),
        imageUrl: 'https://images.unsplash.com/photo-1585136917228-5e29f4f8c5f7?w=600&h=300&fit=crop', // Indian temple architecture
        mapUrl: getStaticMapUrl(mapCenter, 13, '1280x900', 270),
        isDbStory: true,
      });
    }

    //console.log('[CSVAT] dbSlides:', chapterSlides.length, chapterSlides.map(s => s.title));
    return chapterSlides;
  }, [dbStory, mapCenter]);

  // ─── Custom Slides from Database ───
  const [customSlidesRaw, setCustomSlidesRaw] = useState([]);
  const [showSlideEditor, setShowSlideEditor] = useState(false);

  useEffect(() => {
    if (!village_name) return;
    getCustomSlides(village_name)
      .then((data) => setCustomSlidesRaw(data || []))
      .catch(() => setCustomSlidesRaw([]));
  }, [village_name]);

  // Convert DB custom slides to the same shape as auto-generated slides
  const customSlides = useMemo(() => {
    return customSlidesRaw.map((s) => ({
      title: s.title,
      narrative: s.description,
      imageUrl: s.image_url || '',
      mapUrl: s.map_center_lat != null && s.map_center_lng != null
        ? getStaticMapUrl(
            { lat: s.map_center_lat, lng: s.map_center_lng },
            s.map_zoom || 14,
            '1280x900',
            0
          )
        : null,
      isCustom: true,
    }));
  }, [customSlidesRaw]);

  // ─── Merge slides: DB stories → Generated analytics → Custom ───
  // Combine DB chapter[0] with generated intro slide[0]
  const allSlides = useMemo(() => {
    const generated = [...storySlides];
    const dbChapters = [...dbSlides];

    //console.log('[CSVAT] Merging — dbChapters:', dbChapters.length, 'generated:', generated.length, 'custom:', customSlides.length);

    // If we have both DB chapter 0 and generated intro slide,
    // merge them into one combined intro slide
    if (dbChapters.length > 0 && generated.length > 0) {
      const dbIntro = dbChapters.shift(); // remove ch0 from DB list
      const genIntro = generated.shift(); // remove slide0 from generated list
      const combined = {
        title: dbIntro.title || genIntro.title,
        icon: '📖',
        narrative: `${dbIntro.narrative}\n\n${genIntro.narrative}`,
        imageUrl: genIntro.imageUrl || dbIntro.imageUrl,
        mapUrl: genIntro.mapUrl || dbIntro.mapUrl,
        mapZoom: genIntro.mapZoom || 13,
      };
      const result = [combined, ...dbChapters, ...generated, ...customSlides];
      //console.log('[CSVAT] allSlides (merged):', result.length, result.map(s => s.title));
      return result;
    }

    // If only DB stories exist (no analytics), show them + custom
    if (dbChapters.length > 0) {
      return [...dbChapters, ...generated, ...customSlides];
    }

    // Default: generated + custom
    return [...generated, ...customSlides];
  }, [storySlides, dbSlides, customSlides]);

  // Track inline session edits to any slide (AI, Custom, or Template)
  const [slideOverrides, setSlideOverrides] = useState({});



  // ─── AI Storyboard Pipeline ───
  // Convert to string to handle IDs like "ananthapur_amadagur.2"
  const villageId = boundary?.village_id != null
    ? String(boundary.village_id)
    : boundary?.id != null ? String(boundary.id) : null;

  // CoReStack = has a villageId AND is not upload/places/search
  const isCoReStack = !!villageId
    && boundary?.source !== 'upload'
    && boundary?.source !== 'places'
    && boundary?.source !== 'search';

  // Storyboard generation state
  const [aiSlides, setAiSlides] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState('');
  const [genError, setGenError] = useState(null);
  const generateRef = useRef(false);

  const handleSlideEdit = useCallback((idx, updatedData) => {
    setSlideOverrides(prev => ({
      ...prev,
      [idx]: { ...prev[idx], ...updatedData }
    }));

    if (aiSlides?.slides && aiSlides.slides[idx]) {
      const newAiSlides = { ...aiSlides };
      newAiSlides.slides = [...aiSlides.slides];
      const baseSlide = newAiSlides.slides[idx];

      let newTitle = updatedData.title || baseSlide.title;
      const emojiMatch = newTitle.match(/^([\p{Emoji_Presentation}\s]+)/u);
      let emoji = baseSlide.emoji;
      if (emojiMatch) {
         emoji = emojiMatch[1].trim();
         newTitle = newTitle.replace(emojiMatch[0], '').trim();
      }

      let newContent = baseSlide.content;
      let newInsight = baseSlide.insight;
      if (updatedData.narrative) {
        const parts = updatedData.narrative.split('\n\n💡 ');
        newContent = parts[0].trim();
        newInsight = parts.length > 1 ? parts[1].trim() : '';
      }

      newAiSlides.slides[idx] = {
        ...baseSlide,
        title: newTitle,
        emoji: emoji,
        content: newContent,
        insight: newInsight,
        image_url: updatedData.imageUrl !== undefined ? updatedData.imageUrl : baseSlide.image_url,
      };

      setAiSlides(newAiSlides);
      
      if (villageId) {
        //console.log('[StoryboardDB] Persisting manual slide edit to DB...');
        saveStoryboardToDb(villageId, newAiSlides, boundary, results).catch(console.error);
      }
    }
  }, [aiSlides, villageId, boundary, results]);

  // Map action → satellite map bg URL (mirrors original slide behavior)
  const SLIDE_MAP_ACTIONS = {
    1: { zoom: 13, heading: 0 },
    2: { zoom: 13, heading: 180 },
    3: { zoom: 14, heading: 0 },
    4: { zoom: 14, heading: 90 },
    5: { zoom: 15, heading: 0 },   // show_lulc_latest
    6: { zoom: 15, heading: 45 },  // show_lulc_latest
    7: { zoom: 15, heading: 90 },  // show_lulc_oldest
    8: { zoom: 14, heading: 270 }, // show_water
    9: { zoom: 15, heading: 135 },
    10: { zoom: 14, heading: 0 },
    11: { zoom: 13, heading: 270 },
    12: { zoom: 14, heading: 180 },
    13: { zoom: 13, heading: 0 },
  };

  const triggerAiStoryboard = useCallback(async (force = false) => {
    if (!results) return;
    if (generateRef.current && !force) {
      //console.log('[Storyboard] Generation already in progress, skipping duplicate call.');
      return;
    }
    generateRef.current = true;
    
    console.group('%c[Storyboard] Pipeline', 'color:#a78bfa;font-weight:bold');
    //console.log('  village_id:', villageId, '| isCoReStack:', isCoReStack, '| source:', boundary?.source, '| force:', force);

    // Non-CoReStack (search / upload / places) — handle fallbacks
    if (!isCoReStack) {
      //console.log(`  [skip] 4-slide classic static template for ${boundary?.source} boundary`); console.groupEnd();
      setAiSlides(null); // Triggers fallback to allSlides (generateStorySlides)
      return;
    }

    setIsGenerating(true);
    setGenError(null);
    setGenProgress('Checking cache…');

    try {
      // 1. Cache check
      if (!force) {
        //console.log('  [1] Checking cache for village_id:', villageId);
        const cached = await fetchCachedStoryboard(villageId);
        //console.log('  [1] cache:', cached ? cached.slides?.length + ' slides' : 'miss');
        if (cached?.slides?.length > 0) {
          //console.log('  ✅ Cache hit'); console.groupEnd();
          setAiSlides(cached);
          setIsGenerating(false); setGenProgress('');
          return;
        }
      }

      // 2. Run Groq LLM pipeline
      //console.log('  [2] Running Groq pipeline…');
      const story = await runStoryboardPipeline({
        results, boundary,
        onProgress: (msg) => { console.log('  [pipeline]', msg); setGenProgress(msg); },
      });
      //console.log('  [2] Got', story?.slides?.length, 'slides');

      // 3. Save to DB
      //console.log('  [3] Saving to DB…');
      await saveStoryboardToDb(villageId, story, boundary, results);
      //console.log('  [3] Saved'); console.groupEnd();

      setAiSlides(story);
    } catch (err) {
      console.error('[Storyboard] ❌', err); console.groupEnd();
      setGenError(err.message);
    } finally {
      setIsGenerating(false); setGenProgress('');
      generateRef.current = false;
    }
  }, [results, boundary, isCoReStack, villageId]);

  // Auto-trigger once when results are ready
  useEffect(() => {
    //console.log('[Storyboard] Auto-trigger — results:', !!results, '| villageId:', villageId, '| source:', boundary?.source);
    if (results) triggerAiStoryboard(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Final slide list: AI slides take priority, apply overrides ───
  const finalSlidesWithOverrides = useMemo(() => {
    let baseSlides = allSlides;

    if (aiSlides?.slides?.length > 0) {
      //console.log('[Storyboard] Using AI slides:', aiSlides.slides.length);
      baseSlides = aiSlides.slides.map(s => {
        const mapCfg = SLIDE_MAP_ACTIONS[s.slide_number] || { zoom: 14, heading: 0 };
        return {
          title: s.emoji ? `${s.emoji} ${s.title}` : s.title,
          icon: s.emoji || '',
          narrative: `${s.content}\n\n💡 ${s.insight}`,
          mapUrl: getStaticMapUrl(mapCenter, mapCfg.zoom, '1280x900', mapCfg.heading),
          imageUrl: s.image_url || null,
          isAiGenerated: true,
          show_lulc_data: [5, 6].includes(s.slide_number),
          show_water_data: [8].includes(s.slide_number),
        };
      });
    } else {
      //console.log('[Storyboard] Falling back to allSlides:', allSlides.length);
    }

    // Apply any inline session edits the user made
    return baseSlides.map((slide, idx) => {
      const override = slideOverrides[idx];
      if (override) {
        return { ...slide, ...override };
      }
      return slide;
    });
  }, [aiSlides, allSlides, mapCenter, slideOverrides]);

  return (
    <div className="report-viewer-overlay">
      {/* Close Button */}
      {onReset && (
        <button className="story-close-btn" onClick={onReset} title="Close & New Analysis">
          ✕
        </button>
      )}

      <div className="report-viewer-scroll" ref={reportContentRef}>
        <div className="report-viewer-content">

      {/* ─── Report Header ─── */}
      <div className="card animate-slide-up" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{
          fontSize: '1.5rem', fontWeight: 700,
          background: 'linear-gradient(135deg, #8B5CF6, #6366f1)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          🌾 Village Analytics Report
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          {village_name}{(district || state) ? ` — ${[district, state].filter(Boolean).join(', ')}` : ' — Pan-India (Upload)'}
        </p>
        {data_source && (
          <div style={{
            marginTop: '0.75rem', display: 'inline-block',
            background: data_source.includes('GEE') ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.12)',
            color: data_source.includes('GEE') ? '#22c55e' : '#3b82f6',
            padding: '0.4rem 1rem', borderRadius: '8px',
            fontSize: '0.8rem', fontWeight: 600,
          }}>
             {data_source}
          </div>
        )}
        <div className="boundary-info" style={{ marginTop: '1rem' }}>
          {state && (
            <div className="boundary-info-item">
              <span className="label">State</span>
              <span className="value">{state}</span>
            </div>
          )}
          {district && (
            <div className="boundary-info-item">
              <span className="label">District</span>
              <span className="value">{district}</span>
            </div>
          )}
          {tehsil && (
            <div className="boundary-info-item">
              <span className="label">Tehsil</span>
              <span className="value">{tehsil}</span>
            </div>
          )}
        </div>
        {mapCenter?.lat && getStaticMapUrl(mapCenter, 14, '800x200') && (
          <img
            src={getStaticMapUrl(mapCenter, 14, '800x200')}
            alt={`Satellite view — ${village_name}`}
            style={{ width: '100%', borderRadius: '8px', marginTop: '1rem', height: '160px', objectFit: 'cover' }}
            onError={e => { e.target.style.display = 'none'; }}
          />
        )}
      </div>

      {/* ─── Village Overview (from storyboard intro) ─── */}
      {storySlides[0] && (
        <div className="card animate-slide-up" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="icon">📖</span>
            <h3>Village Overview</h3>
          </div>
          <div className="narrative" style={{ fontSize: '0.95rem', lineHeight: '1.75' }}>
            {storySlides[0].narrative}
          </div>
        </div>
      )}

      {/* ─── Land Use at a Glance ─── */}
      {(ciData || vegetation) && (
        <div className="card animate-slide-up" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <span className="icon">🗺️</span>
            <h3>Land Use at a Glance</h3>
          </div>
          <div className="narrative" style={{ fontSize: '0.95rem', lineHeight: '1.75' }}>
            {ciData && ciData.length > 0 && (() => {
              const latest = ciData[ciData.length - 1];
              return `As of ${latest.year}, the village has ${latest.total_cropped_ha?.toFixed(0)} ha of farmland. Of this, ${latest.triple_crop_ha?.toFixed(0)} ha is harvested three times a year (triple crop), ${latest.double_crop_ha?.toFixed(0)} ha twice (double crop), and ${latest.single_crop_ha?.toFixed(0)} ha once (single crop). `;
            })()}
            {vegetation && (() => {
              const net = vegetation.net_change_ha;
              const direction = net >= 0 ? 'gained' : 'lost';
              return `The village has ${direction} ${Math.abs(net ?? 0).toFixed(0)} ha of tree cover over the study period${vegetation.degraded_land_ha ? `, and ${vegetation.degraded_land_ha.toFixed(0)} ha shows signs of land degradation` : ''}.`;
            })()}
          </div>
        </div>
      )}

      {/* ─── Summary Stats ─── */}
      <div className="card animate-slide-up" style={{ marginBottom: '1.5rem' }}>
        <div className="stats-grid">
          {mws_count != null && (
            <div className="stat-card stat-blue">
              <div className="value">{mws_count}</div>
              <div className="label">Micro-Watersheds</div>
            </div>
          )}
          {ciData && (
            <div className="stat-card stat-green">
              <div className="value">{ciData.length}</div>
              <div className="label">Years of Data</div>
            </div>
          )}
          <div className="stat-card stat-amber">
            <div className="value">{totalAreaHa.toFixed(2)}</div>
            <div className="label">Total Area (ha)</div>
          </div>
        </div>
      </div>

      {/* ─── Cropping Intensity ─── */}
      {ciData && ciData.length > 0 && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">🌱</span>
            <h3>Cropping Intensity Trends</h3>
          </div>
          <div className="chart-wrapper">
            <Bar
              data={{
                labels: ciData.map(d => d.year),
                datasets: [
                  { label: 'Triple Crop (ha)', data: ciData.map(d => d.triple_crop_ha), backgroundColor: 'rgba(245, 158, 11, 0.7)', borderRadius: 6 },
                  { label: 'Double Crop (ha)', data: ciData.map(d => d.double_crop_ha), backgroundColor: 'rgba(59, 130, 246, 0.7)', borderRadius: 6 },
                  { label: 'Single Crop (ha)', data: ciData.map(d => d.single_crop_ha), backgroundColor: 'rgba(34, 197, 94, 0.7)', borderRadius: 6 },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'Area (Hectares)' } } },
                plugins: { legend: { position: 'top' } },
              }}
            />
          </div>
          <table className="data-table">
            <thead><tr><th>Year</th><th>Single Crop (ha)</th><th>Double Crop (ha)</th><th>Triple Crop (ha)</th><th>Total (ha)</th><th>Intensity Index</th></tr></thead>
            <tbody>
              {ciData.map(d => (
                <tr key={d.year}><td>{d.year}</td><td>{d.single_crop_ha?.toFixed(2)}</td><td>{d.double_crop_ha?.toFixed(2)}</td><td>{d.triple_crop_ha?.toFixed(2)}</td><td>{d.total_cropped_ha?.toFixed(2)}</td><td>{d.cropping_intensity?.toFixed(3) ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="narrative">
            Cropping intensity analysis shows how agricultural land use patterns have changed within the village boundary.
            The intensity index represents the average number of crop cycles per year across the analyzed area.
          </div>
        </div>
      )}

      {/* ─── Surface Water (Kharif / Rabi / Zaid) ─── */}
      {swData && swData.length > 0 && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">💧</span>
            <h3>Seasonal Surface Water Availability</h3>
          </div>
          <div className="chart-wrapper">
            <Bar
              data={{
                labels: swData.map(d => d.year),
                datasets: [
                  { label: 'Kharif (ha)', data: swData.map(d => d.kharif_ha ?? d.seasonal_monsoon_ha ?? 0), backgroundColor: 'rgba(20, 184, 166, 0.8)', borderRadius: 6 },
                  { label: 'Rabi (ha)', data: swData.map(d => d.rabi_ha ?? d.seasonal_winter_ha ?? 0), backgroundColor: 'rgba(59, 130, 246, 0.7)', borderRadius: 6 },
                  { label: 'Zaid (ha)', data: swData.map(d => d.zaid_ha ?? d.perennial_ha ?? 0), backgroundColor: 'rgba(147, 197, 253, 0.6)', borderRadius: 6 },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                scales: { y: { title: { display: true, text: 'Area (Hectares)' } } },
                plugins: { legend: { position: 'top' } },
              }}
            />
          </div>
          <table className="data-table">
            <thead><tr><th>Year</th><th>Kharif (ha)</th><th>Rabi (ha)</th><th>Zaid (ha)</th><th>Total (ha)</th></tr></thead>
            <tbody>
              {swData.map(d => (
                <tr key={d.year}><td>{d.year}</td><td>{(d.kharif_ha ?? d.seasonal_monsoon_ha ?? 0).toFixed(2)}</td><td>{(d.rabi_ha ?? d.seasonal_winter_ha ?? 0).toFixed(2)}</td><td>{(d.zaid_ha ?? d.perennial_ha ?? 0).toFixed(2)}</td><td>{(d.total_water_ha ?? 0).toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="narrative">
            Surface water analysis tracks waterbody availability across agricultural seasons.
            Kharif covers the monsoon period (Jun–Sep), Rabi covers winter (Oct–Feb),
            and Zaid covers the summer period (Mar–May).
          </div>
        </div>
      )}

      {/* ─── Vegetation & Tree Cover Change ─── */}
      {vegetation && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">🌳</span>
            <h3>Vegetation & Tree Cover Change Analysis</h3>
          </div>
          <div className="stats-grid">
            <div className="stat-card stat-green"><div className="value">{vegetation.tree_cover_gain_ha?.toFixed(2) ?? '—'}</div><div className="label">Tree Cover Gain (ha)</div></div>
            <div className="stat-card stat-red"><div className="value">{vegetation.tree_cover_loss_ha?.toFixed(2) ?? '—'}</div><div className="label">Tree Cover Loss (ha)</div></div>
            <div className={`stat-card ${(vegetation.net_change_ha ?? 0) >= 0 ? 'stat-green' : 'stat-red'}`}><div className="value">{vegetation.net_change_ha?.toFixed(2) ?? '—'}</div><div className="label">Net Change (ha)</div></div>
            <div className="stat-card stat-amber"><div className="value">{vegetation.degraded_land_ha?.toFixed(2) ?? '—'}</div><div className="label">Degraded Land (ha)</div></div>
          </div>
          {vegetation.transitions && vegetation.transitions.length > 0 && (
            <>
              <h4 style={{ color: 'var(--text-secondary)', margin: '1.5rem 0 0.75rem', fontSize: '1rem' }}>Tree Cover Loss Transitions</h4>
              <div className="chart-wrapper" style={{ height: '280px' }}>
                <Bar
                  data={{
                    labels: vegetation.transitions.filter(t => (t.to_label || t.to) !== 'Tree Cover' && (t.to_label || t.to) !== 'Forest').map(t => `${t.from_class || t.from} → ${t.to_label || t.to}`),
                    datasets: [{ label: 'Area (ha)', data: vegetation.transitions.filter(t => (t.to_label || t.to) !== 'Tree Cover' && (t.to_label || t.to) !== 'Forest').map(t => t.area_ha), backgroundColor: ['rgba(239,68,68,0.7)', 'rgba(245,158,11,0.7)', 'rgba(234,179,8,0.7)', 'rgba(156,163,175,0.7)'], borderRadius: 6 }],
                  }}
                  options={{ responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { title: { display: true, text: 'Area (Hectares)' } } }, plugins: { legend: { display: false } } }}
                />
              </div>
              <table className="data-table">
                <thead><tr><th>From</th><th>To</th><th>Area (ha)</th></tr></thead>
                <tbody>{vegetation.transitions.map((t, idx) => (<tr key={idx}><td>{t.from_class || t.from}</td><td>{t.to_label || t.to}</td><td>{t.area_ha?.toFixed(2)}</td></tr>))}</tbody>
              </table>
            </>
          )}
          {vegetation.yearly_data && vegetation.yearly_data.length > 0 && (
            <div className="chart-wrapper" style={{ marginTop: '1.5rem' }}>
              <Line
                data={{
                  labels: vegetation.yearly_data.map(d => d.year),
                  datasets: [{ label: 'Tree Cover (ha)', data: vegetation.yearly_data.map(d => d.tree_cover_ha), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)', fill: true, tension: 0.3, pointRadius: 6, pointBackgroundColor: '#22c55e', pointBorderColor: '#fff', pointBorderWidth: 2 }],
                }}
                options={{ responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Area (Hectares)' } } }, plugins: { legend: { position: 'top' } } }}
              />
            </div>
          )}
          <div className="narrative">
            Vegetation analysis compares land cover between the study period, tracking how tree cover transitions to other use types.
            {vegetation.net_change_ha < 0 && ` The village experienced a net loss of ${Math.abs(vegetation.net_change_ha).toFixed(2)} ha of tree cover.`}
            {vegetation.net_change_ha >= 0 && ` The village shows a net gain of ${vegetation.net_change_ha?.toFixed(2)} ha of tree cover.`}
          </div>
        </div>
      )}

      {/* ─── Cropping Intensity Change Transitions ─── */}
      {crop_intensity_change && crop_intensity_change.length > 0 && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon"></span>
            <h3>Cropping Intensity Change Detection</h3>
          </div>
          <div className="chart-wrapper" style={{ height: '320px' }}>
            <Bar
              data={{
                labels: crop_intensity_change.filter(t => !(t.category || t.label || '').includes('Total')).map(t => t.category || t.label),
                datasets: [{
                  label: 'Area (ha)',
                  data: crop_intensity_change.filter(t => !(t.category || t.label || '').includes('Total')).map(t => t.area_ha),
                  backgroundColor: crop_intensity_change.filter(t => !(t.category || t.label || '').includes('Total')).map(t => {
                    const lbl = t.category || t.label || '';
                    if (lbl.includes('Single To Double') || lbl.includes('Double To Triple') || lbl.includes('Single To Triple')) return 'rgba(34,197,94,0.7)';
                    if (lbl.includes('Double To Single') || lbl.includes('Triple To Double') || lbl.includes('Triple To Single')) return 'rgba(239,68,68,0.7)';
                    return 'rgba(59,130,246,0.7)';
                  }),
                  borderRadius: 6,
                }],
              }}
              options={{ responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { title: { display: true, text: 'Area (Hectares)' } } }, plugins: { legend: { display: false } } }}
            />
          </div>
          <table className="data-table">
            <thead><tr><th>Transition</th><th>Area (ha)</th><th>Direction</th></tr></thead>
            <tbody>
              {crop_intensity_change.map((t, idx) => {
                const lbl = t.category || t.label || '';
                return (
                  <tr key={idx}>
                    <td>{lbl}</td>
                    <td>{t.area_ha?.toFixed(2)}</td>
                    <td>{lbl.includes('Total') ? '—' : (lbl.includes('Single To Double') || lbl.includes('Double To Triple') || lbl.includes('Single To Triple')) ? '↑ Improvement' : (lbl.includes('Double To Single') || lbl.includes('Triple To Double') || lbl.includes('Triple To Single')) ? '↓ Decline' : '→ Stable'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="narrative">
            Cropping intensity change detection shows how agricultural practices have shifted between
            single, double, and triple cropping patterns. Green bars indicate improvement (single→double,
            double→triple), while red bars indicate decline.
          </div>
        </div>
      )}


      {/* ─── Waterbodies ─── */}
      {waterbodies && waterbodies.count > 0 && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">🏞️</span>
            <h3>Waterbodies Analysis</h3>
          </div>
          <div className="stats-grid">
            <div className="stat-card stat-blue"><div className="value">{waterbodies.count}</div><div className="label">Total Waterbodies</div></div>
            <div className="stat-card stat-blue"><div className="value">{waterbodies.waterbodies?.reduce((sum, wb) => sum + (wb.area_ha || 0), 0).toFixed(2)}</div><div className="label">Total Area (ha)</div></div>
          </div>
          <table className="data-table">
            <thead><tr><th>UID</th><th>Name</th><th>Area (ha)</th><th>Type</th></tr></thead>
            <tbody>
              {waterbodies.waterbodies?.slice(0, 20).map((wb, idx) => (
                <tr key={wb.uid || idx}><td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{wb.uid}</td><td>{wb.name}</td><td>{wb.area_ha}</td><td>{wb.type}</td></tr>
              ))}
            </tbody>
          </table>
          {waterbodies.waterbodies?.length > 20 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Showing 20 of {waterbodies.waterbodies.length} waterbodies
            </div>
          )}
          <div className="narrative">
            The tehsil contains {waterbodies.count} identified waterbodies.
            Waterbody data is sourced from CoRE Stack and includes seasonal coverage and zone of influence analytics.
          </div>
        </div>
      )}

      {/* ─── Export / Download Section ─── */}
      <div className="card animate-slide-up" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <span className="icon">📥</span>
          <h3>Download & Export</h3>
        </div>
        <div className="export-bar">
          <button
            className="btn btn-primary"
            onClick={() => {
              const csv = generateCSV(results);
              const safeName = (village_name || 'data').replace(/\s+/g, '_');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `CSVAT_${safeName}_Data.csv`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            📊 Download CSV
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              const safeName = (village_name || 'data').replace(/\s+/g, '_');
              const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `CSVAT_${safeName}_FullData.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            📋 Download JSON
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
            onClick={async () => {
              if (!reportContentRef.current) return;
              try {
                await downloadReportAsPDF(reportContentRef.current, village_name);
              } catch (err) {
                console.error('PDF generation failed:', err);
                alert('PDF generation failed.');
              }
            }}
          >
            📄 Download PDF
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}
            onClick={async () => {
              try {
                await downloadReportAsHTML(results, finalSlidesWithOverrides, village_name);
              } catch (err) {
                console.error('HTML export failed:', err);
                alert('HTML export failed.');
              }
            }}
          >
            🌐 Download HTML
          </button>
        </div>
      </div>

        </div>{/* end .report-viewer-content */}

        {/* ─── TERRASO FULLSCREEN SLIDE STORYBOARD ─── */}
        <div style={{ position: 'relative' }}>
          {/* Action bar */}
          <div className="storyboard-action-bar">
            {aiSlides && (
              <button
                className="storyboard-action-btn storyboard-edit-btn"
                onClick={() => setShowSlideEditor(true)}
                title="Edit storyboard slides"
              >
                 Edit Story
              </button>
            )}
            {isCoReStack && (
              <button
                className="storyboard-action-btn storyboard-regen-btn"
                onClick={() => triggerAiStoryboard(true)}
                disabled={isGenerating}
                title="Regenerate storyboard from scratch"
              >
                {isGenerating ? '⏳ Generating…' : ' Regenerate'}
              </button>
            )}
            {!aiSlides && !isGenerating && (
              <button
                className="storyboard-action-btn storyboard-edit-btn"
                onClick={() => setShowSlideEditor(true)}
                title="Edit story slides"
              >
                 Edit Story
              </button>
            )}
          </div>

          {/* Full-screen loading placeholder */}
          {isGenerating ? (
            <div style={{ height: '80vh', width: '100%', background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <div className="storyboard-gen-spinner" style={{ width: '48px', height: '48px', borderTopColor: '#3b82f6', borderRightColor: '#3b82f6', marginBottom: '1.5rem', borderWidth: '4px' }} />
              <h3 style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: '1.5rem', margin: '0 0 0.5rem 0' }}>Loading Storyboard</h3>
              <p style={{ color: '#94a3b8', margin: 0 }}>{genProgress || 'Please wait while we fetch the village narrative...'}</p>
            </div>
          ) : genError ? (
            <div style={{ height: '80vh', width: '100%', background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
              <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</span>
              <h3 style={{ fontFamily: 'Inter', fontWeight: 600, margin: '0 0 0.5rem 0' }}>Storyboard generation failed</h3>
              <p style={{ color: '#fca5a5', margin: 0 }}>{genError}</p>
              <button className="btn btn-primary" style={{ marginTop: '1.5rem' }} onClick={() => triggerAiStoryboard(true)}>Retry Generation</button>
            </div>
          ) : (
            <StorySlides 
              slides={finalSlidesWithOverrides} 
              villageName={village_name} 
              onSlideEdit={handleSlideEdit} 
              ciData={ciData}
              swData={swData}
            />
          )}
        </div>

      </div>{/* end .report-viewer-scroll */}

      {/* ─── Slide Editor Modal ─── */}
      {showSlideEditor && (
        <SlideEditor
          villageName={village_name}
          onClose={() => setShowSlideEditor(false)}
          onSave={(updated) => {
            setCustomSlidesRaw(updated);
            setShowSlideEditor(false);
          }}
        />
      )}
    </div>
  );
}
