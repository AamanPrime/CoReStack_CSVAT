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

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
);

// Chart.js defaults for light theme
ChartJS.defaults.color = '#475569';
ChartJS.defaults.borderColor = 'rgba(226,232,240,0.6)';

// Google Maps API key for static map images
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';

/**
 * Generate a static satellite map image URL for a slide.
 * Each slide can have different zoom/center/heading for visual variety.
 */
function getStaticMapUrl(center, zoom = 14, size = '1280x900', heading = 0) {
  if (!MAPS_KEY || !center?.lat || !center?.lng) return null;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${center.lat},${center.lng}&zoom=${zoom}&size=${size}&maptype=satellite&heading=${heading}&key=${MAPS_KEY}`;
}

/**
 * StorySlides — Terraso-style storyboard component.
 * Shows ONE chapter at a time. Scroll-snap within the panel.
 * Background image changes per chapter with cross-fade transition.
 */
function StorySlides({ slides, villageName }) {
  const scrollRef = useRef(null);
  const cardRefs = useRef([]);
  const [activeIdx, setActiveIdx] = React.useState(0);

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
          >
            <div className={`ts-card ${idx === activeIdx ? 'ts-card--visible' : ''}`}>
              <div className="ts-card-chapter">Chapter {idx + 1}</div>
              <h3 className="ts-card-title">
                {slide.icon && <span className="ts-card-icon">{slide.icon}</span>} {slide.title}
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
            </div>
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
  const opt = {
    margin: [10, 5, 10, 5],
    filename: `CSVAT_${safeName}_Report.pdf`,
    image: { type: 'jpeg', quality: 0.92 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0, windowHeight: contentEl.scrollHeight },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  };
  await window.html2pdf().set(opt).from(contentEl).save();
}

/**
 * Build and download a self-contained offline HTML file with interactive storyboard.
 */
function downloadReportAsHTML(results, storySlides, villageName) {
  const safeName = (villageName || 'report').replace(/\s+/g, '_');

  // 1. Collect ALL stylesheets from the page
  let allCSS = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules || sheet.rules || []) {
        allCSS += rule.cssText + '\n';
      }
    } catch (e) {
      if (sheet.href) {
        allCSS += `@import url("${sheet.href}");\n`;
      }
    }
  }

  // 2. Clone the entire report overlay
  const overlay = document.querySelector('.report-viewer-overlay');
  if (!overlay) {
    alert('Report not visible. Please open the report first.');
    return;
  }
  const clone = overlay.cloneNode(true);

  // 3. Convert all <canvas> charts to inline <img> tags
  const origCanvases = overlay.querySelectorAll('canvas');
  const clonedCanvases = clone.querySelectorAll('canvas');
  origCanvases.forEach((canvas, i) => {
    try {
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.style.width = canvas.style.width || canvas.getAttribute('width') + 'px' || '100%';
      img.style.height = canvas.style.height || canvas.getAttribute('height') + 'px' || 'auto';
      img.style.maxWidth = '100%';
      if (clonedCanvases[i]?.parentNode) {
        clonedCanvases[i].parentNode.replaceChild(img, clonedCanvases[i]);
      }
    } catch (e) {
      console.warn('Canvas export failed:', e);
    }
  });

  // 4. Remove interactive-only elements from clone
  clone.querySelectorAll('.story-close-btn, .ts-edit-btn, .se-overlay').forEach(el => el.remove());

  // 5. Fix overlay positioning for standalone page
  clone.style.position = 'relative';
  clone.style.top = '0';
  clone.style.height = 'auto';
  clone.style.minHeight = 'auto';

  // 6. Make storyboard slides all visible
  clone.querySelectorAll('.ts-card').forEach(card => {
    card.classList.add('ts-card--visible');
    card.style.opacity = '1';
    card.style.transform = 'none';
  });
  clone.querySelectorAll('.ts-snap-page').forEach(page => {
    page.style.scrollSnapAlign = 'none';
    page.style.height = 'auto';
    page.style.minHeight = 'auto';
    page.style.paddingTop = '2rem';
    page.style.paddingBottom = '2rem';
  });
  const scrollPanel = clone.querySelector('.ts-scroll-panel');
  if (scrollPanel) {
    scrollPanel.style.position = 'relative';
    scrollPanel.style.height = 'auto';
    scrollPanel.style.overflow = 'visible';
    scrollPanel.style.scrollSnapType = 'none';
  }
  const storyboard = clone.querySelector('.ts-storyboard');
  if (storyboard) {
    storyboard.style.height = 'auto';
    storyboard.style.minHeight = 'auto';
  }
  // Show first background layer
  clone.querySelectorAll('.ts-bg-layer').forEach((layer, i) => {
    if (i === 0) {
      layer.classList.add('ts-bg-layer--active');
      layer.style.position = 'absolute';
      layer.style.opacity = '1';
    } else {
      layer.style.display = 'none';
    }
  });

  // Make story sections visible
  clone.querySelectorAll('.story-section').forEach(section => {
    section.classList.add('visible');
    section.style.opacity = '1';
    section.style.transform = 'none';
  });

  // 7. Build the final HTML — scrollable and interactive
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CSVAT Report — ${villageName || 'Village'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
  <style>
    :root {
      --navbar-height: 0px;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0; padding: 0;
      font-family: 'Inter', sans-serif;
      background: #f8fafc;
      overflow-y: auto;
      overflow-x: hidden;
    }

    /* Override fixed/absolute report to flow naturally */
    .report-viewer-overlay {
      position: relative !important;
      top: 0 !important;
      height: auto !important;
      min-height: auto !important;
      overflow: visible !important;
    }
    .report-viewer-scroll {
      height: auto !important;
      overflow: visible !important;
    }

    /* Storyboard: linearize for scrollable page */
    .ts-storyboard {
      height: auto !important;
      min-height: auto !important;
      overflow: visible !important;
    }
    .ts-scroll-panel {
      position: relative !important;
      height: auto !important;
      overflow: visible !important;
      scroll-snap-type: none !important;
    }
    .ts-snap-page {
      height: auto !important;
      min-height: auto !important;
      scroll-snap-align: none !important;
      padding-top: 2rem !important;
      padding-bottom: 2rem !important;
    }
    .ts-card {
      opacity: 1 !important;
      transform: none !important;
    }
    .ts-card-chapter, .ts-card-title, .ts-card-narrative, .ts-card-image {
      opacity: 1 !important;
      transform: none !important;
    }
    .ts-bg-layer { position: absolute; }
    .ts-dots { display: none; }
    .ts-edit-btn, .story-close-btn, .export-bar { display: none; }

    /* Story sections: all visible */
    .story-section {
      opacity: 1 !important;
      transform: none !important;
    }

    /* Tables: keep scrollable on narrow screens */
    .data-table { overflow-x: auto; display: block; }

    /* Smooth scroll-to-section nav */
    .html-nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(255,255,255,0.95);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid #e2e8f0;
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
    .html-nav a:hover {
      background: rgba(139,92,246,0.1);
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .html-nav { display: none; }
    }
    ${allCSS}
  </style>
</head>
<body>
  <div style="text-align:center;padding:1.5rem;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;">
    <h1 style="font-family:'Playfair Display',serif;font-size:1.5rem;margin:0;">CSVAT Village Analytics Report</h1>
    <p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin-top:0.25rem;">${villageName || 'Village'} — Generated ${new Date().toLocaleDateString()}</p>
  </div>
  <nav class="html-nav">
    <a href="#report-analytics">Analytics</a>
    <a href="#report-storyboard">Storyboard</a>
    <a href="#report-footer">Footer</a>
  </nav>
  <div id="report-analytics"></div>
  ${clone.outerHTML}
  <div id="report-storyboard"></div>
  <div id="report-footer" style="text-align:center;padding:1.5rem;color:#94a3b8;font-size:0.8rem;border-top:1px solid #e2e8f0;">
    Generated by CSVAT &bull; CoRE Stack Analytics Platform &bull; ${new Date().toISOString().slice(0, 10)}
  </div>
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
  const { vegetation, terrain, crop_intensity_change, village_name, state, district, tehsil } = results;
  const slides = [];

  // Slide 1: Village Introduction
  slides.push({
    title: `The Story of ${village_name || 'This Village'}`,
    icon: '🌾',
    narrative: `${village_name || 'This village'}${district ? `, nestled in ${district} district` : ''}${state ? ` of ${state}` : ''}, tells a story written in its land, water, and people. This data story draws from satellite imagery and geospatial analytics to paint a picture of how this landscape has evolved — tracking cropping patterns, surface water availability, vegetation health, and terrain composition across multiple years.`,
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
      title: 'Cropping Patterns Over Time',
      icon: '🌱',
      narrative: `Over ${ciData.length} fiscal years (${earliest.year} to ${latest.year}), the total cropped area has ${trend} from ${earliest.total_cropped_ha?.toFixed(2)} ha to ${latest.total_cropped_ha?.toFixed(2)} ha. The cropping intensity index has ${intensityTrend}, moving from ${earliest.cropping_intensity?.toFixed(3) || '—'} to ${latest.cropping_intensity?.toFixed(3) || '—'}. In the most recent year, single crop covers ${latest.single_crop_ha?.toFixed(2)} ha, double crop covers ${latest.double_crop_ha?.toFixed(2)} ha, and triple crop covers ${latest.triple_crop_ha?.toFixed(2)} ha — revealing how farmers have adapted their practices to the changing climate and water availability.`,
      mapUrl: getStaticMapUrl(center, 15, '1280x900', 90),
      imageUrl: 'https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=600&h=300&fit=crop',
      mapZoom: 15,
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
      title: 'Water — The Lifeblood',
      icon: '💧',
      narrative: `In ${latest.year}, the village's surface water footprint measured ${(latest.total_water_ha ?? 0).toFixed(2)} hectares — split across Kharif season (${kharif.toFixed(2)} ha during the monsoon), Rabi season (${rabi.toFixed(2)} ha in winter), and Zaid season (${zaid.toFixed(2)} ha in summer). Tracking ${swData.length} years of data from ${earliest.year} to ${latest.year}, we can see the seasonal rhythm of water availability that dictates what grows, when it grows, and whether the harvest succeeds.`,
      mapUrl: getStaticMapUrl(center, 14, '1280x900', 180),
      imageUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600&h=300&fit=crop',
      mapZoom: 14,
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
      title: 'The Green Canopy',
      icon: '🌳',
      narrative: `The vegetation story reveals ${direction} of ${Math.abs(net ?? 0).toFixed(2)} hectares of tree cover. The analysis detected ${gain} ha of tree cover gain against ${loss} ha of loss. ${vegetation.degraded_land_ha ? `An additional ${vegetation.degraded_land_ha.toFixed(2)} ha is classified as degraded land.` : ''} ${vegetation.transitions?.length > 0 ? `The primary transitions show tree cover converting to ${vegetation.transitions.filter(t => (t.to_label || t.to) !== 'Tree Cover').map(t => t.to_label || t.to).slice(0, 3).join(', ')}.` : ''} These shifts reflect the ongoing balance between agricultural expansion and environmental conservation.`,
      mapUrl: getStaticMapUrl(center, 14, '1280x900', 270),
      imageUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&h=300&fit=crop',
      mapZoom: 14,
    });
  }

  // Slide 5: Terrain & Land
  if (terrain && terrain.total_area_ha > 0) {
    const entries = Object.entries(terrain).filter(([k]) => k !== 'total_area_ha').sort(([, a], [, b]) => b - a);
    const dominant = entries[0];
    const dominantPct = ((dominant[1] / terrain.total_area_ha) * 100).toFixed(1);
    const composition = entries.slice(0, 3).map(([k, v]) =>
      `${k.replace(/_/g, ' ')} (${((v / terrain.total_area_ha) * 100).toFixed(1)}%)`
    ).join(', ');
    slides.push({
      title: 'Reading the Terrain',
      icon: '⛰️',
      narrative: `Spanning ${terrain.total_area_ha.toFixed(2)} hectares, the terrain is predominantly ${dominant[0].replace(/_/g, ' ')} at ${dominantPct}% of the total area. The full composition includes ${composition}. This topographical profile shapes everything from water flow patterns to soil erosion risk, and is fundamental to watershed planning and sustainable land management strategies for the region.`,
      mapUrl: getStaticMapUrl(center, 13, '1280x900', 45),
      imageUrl: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=300&fit=crop',
      mapZoom: 13,
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
      title: 'Shifting Practices',
      icon: '🔄',
      narrative: `The cropping intensity transitions reveal the agricultural dynamism of this region. ${totalImprovement.toFixed(2)} hectares saw improvement — farms moving from single to double or triple cropping — signaling intensification and better water access. Meanwhile, ${totalDecline.toFixed(2)} hectares shifted to lower-intensity patterns, possibly due to water stress or soil degradation. These transitions paint a nuanced picture of agricultural resilience and vulnerability.`,
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
    mws_count, terrain, crop_intensity_change, area_hectares,
  } = results;

  const totalAreaHa = area_hectares || terrain?.total_area_ha || 0;

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
    console.log('[CSVAT] Fetching DB story for:', village_name, state, district, tehsil);
    getVillageStory(village_name, state, district, tehsil)
      .then((data) => {
        console.log('[CSVAT] DB story received:', data?.name, 'chapters:', data?.story_chapters?.length);
        setDbStory(data);
      })
      .catch((err) => {
        console.log('[CSVAT] No DB story found:', err?.response?.status || err.message);
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

    console.log('[CSVAT] dbSlides:', chapterSlides.length, chapterSlides.map(s => s.title));
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

    console.log('[CSVAT] Merging — dbChapters:', dbChapters.length, 'generated:', generated.length, 'custom:', customSlides.length);

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
      console.log('[CSVAT] allSlides (merged):', result.length, result.map(s => s.title));
      return result;
    }

    // If only DB stories exist (no analytics), show them + custom
    if (dbChapters.length > 0) {
      return [...dbChapters, ...generated, ...customSlides];
    }

    // Default: generated + custom
    return [...generated, ...customSlides];
  }, [storySlides, dbSlides, customSlides]);

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
            📡 {data_source}
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
      </div>

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
          {vegetation && (
            <div className="stat-card stat-red">
              <div className="value">{vegetation.transitions?.filter(t => (t.to_label || t.to) !== 'Tree Cover' && (t.to_label || t.to) !== 'Forest' && t.area_ha > 0).length || 0}</div>
              <div className="label">Tree Cover Loss Types</div>
            </div>
          )}
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
                  { label: 'Single Crop (ha)', data: ciData.map(d => d.single_crop_ha), backgroundColor: 'rgba(34, 197, 94, 0.7)', borderRadius: 6 },
                  { label: 'Double Crop (ha)', data: ciData.map(d => d.double_crop_ha), backgroundColor: 'rgba(59, 130, 246, 0.7)', borderRadius: 6 },
                  { label: 'Triple Crop (ha)', data: ciData.map(d => d.triple_crop_ha), backgroundColor: 'rgba(245, 158, 11, 0.7)', borderRadius: 6 },
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
            <span className="icon">🔄</span>
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

      {/* ─── Terrain Composition ─── */}
      {terrain && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">⛰️</span>
            <h3>Terrain Composition</h3>
          </div>
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ width: '280px', height: '280px' }}>
              <Doughnut
                data={{
                  labels: Object.entries(terrain).filter(([k]) => k !== 'total_area_ha').filter(([, v]) => v > 0).map(([k]) => k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())),
                  datasets: [{ data: Object.entries(terrain).filter(([k]) => k !== 'total_area_ha').filter(([, v]) => v > 0).map(([, v]) => v), backgroundColor: ['rgba(245,158,11,0.7)', 'rgba(34,197,94,0.7)', 'rgba(156,163,175,0.7)', 'rgba(239,68,68,0.7)', 'rgba(59,130,246,0.7)'], borderWidth: 2, borderColor: '#ffffff' }],
                }}
                options={{ responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'right' } } }}
              />
            </div>
            <table className="data-table" style={{ flex: 1 }}>
              <thead><tr><th>Terrain Type</th><th>Area (ha)</th><th>Percentage</th></tr></thead>
              <tbody>
                {Object.entries(terrain).filter(([k]) => k !== 'total_area_ha').map(([k, v]) => (
                  <tr key={k}><td>{k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</td><td>{v.toFixed(2)}</td><td>{terrain.total_area_ha > 0 ? ((v / terrain.total_area_ha) * 100).toFixed(1) : '0.0'}%</td></tr>
                ))}
                <tr style={{ fontWeight: 700 }}><td>Total</td><td>{terrain.total_area_ha.toFixed(2)}</td><td>100%</td></tr>
              </tbody>
            </table>
          </div>
          <div className="narrative">
            Terrain composition analysis classifies the village area into terrain types.
            This data helps understand the topographical distribution for watershed planning.
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
            onClick={() => downloadReportAsHTML(results, allSlides, village_name)}
          >
            🌐 Download HTML
          </button>
        </div>
      </div>

        </div>{/* end .report-viewer-content */}

        {/* ─── TERRASO FULLSCREEN SLIDE STORYBOARD ─── */}
        <div style={{ position: 'relative' }}>
          <StorySlides slides={allSlides} villageName={village_name} />
          <button
            className="ts-edit-btn"
            onClick={() => setShowSlideEditor(true)}
          >
            ✏️ Edit Story
          </button>
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
