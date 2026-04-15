/**
 * CSVAT — StoryMapView Component (Terraso-inspired Scrollytelling).
 *
 * Three-phase scroll-driven analytics presentation:
 *   Phase 1: Hero title page with India map silhouette background
 *   Phase 2: Split view — sticky map left, scrollable analytics right
 *
 * MAP SYNC: As the user scrolls through per-year cards in each analytics
 * section, the sticky map on the left switches its LULC raster overlay
 * to show the corresponding fiscal year's land use classification.
 *
 * All analytics content from ReportViewer is preserved in story format.
 */
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { MapView } from './GoogleMapsIntegration';
import ExportManager from './ExportManager';
import { getVillageStory } from '../services/api';
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

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
);

// ─── LULC Class Legend for Map Overlay ───
const LULC_CLASSES = [
  { id: 1, label: 'Built Up', color: '#9ca3af' },
  { id: 6, label: 'Forest', color: '#166534' },
  { id: 8, label: 'Single Crop (K)', color: '#86efac' },
  { id: 9, label: 'Single Crop (NK)', color: '#bbf7d0' },
  { id: 10, label: 'Double Crop', color: '#22c55e' },
  { id: 11, label: 'Triple Crop', color: '#eab308' },
  { id: 7, label: 'Barren', color: '#a16207' },
  { id: 12, label: 'Scrub Land', color: '#d4a76a' },
  { id: 2, label: 'Water (Kharif)', color: '#7dd3fc' },
  { id: 4, label: 'Water (Perennial)', color: '#2563eb' },
];

// Section theme colors for the map HUD
const SECTION_THEMES = {
  cropping: { color: '#22c55e', icon: '🌱', label: 'Cropping Intensity' },
  water: { color: '#14b8a6', icon: '💧', label: 'Surface Water' },
  vegetation: { color: '#16a34a', icon: '🌳', label: 'Vegetation' },
  overview: { color: '#8b5cf6', icon: '📊', label: 'Overview' },
};

// ─── MAP ACTION LABELS ───
const MAP_ACTION_LABELS = {
  zoom_to_village: { icon: '', label: 'Viewing Village' },
  show_overview: { icon: '🗺️', label: 'Regional Overview' },
  show_lulc_latest: { icon: '🛰️', label: 'Latest Land Use' },
  show_lulc_oldest: { icon: '🛰️', label: 'Historical Land Use' },
  show_water: { icon: '💧', label: 'Water Bodies' },
};

// ─── HARDCODED VILLAGE STORY (used for all villages until DB is populated) ───
const HARDCODED_STORY = {
  name: 'Amadagur',
  population_2011: 6818,
  households_2011: 1700,
  literacy_rate: 72.4,
  languages: ['Telugu', 'Urdu'],
  economy: 'Agricultural — groundnut, sunflower, and dryland crops',
  temples: ['Sri Chowdeshwari Temple', 'Sri Anjaneya Swamy Temple'],
  story_chapters: [
    {
      title: 'The Heart of the Village',
      narrative: 'Perched in the arid heart of Rayalaseema, this village bears the legacy of the Vijayanagara Empire, whose rulers built the \'cheruvu\' tank systems that still define the region\'s relationship with water. The mandal is home to nearly 30,000 people, their lives woven into the fabric of this ancient landscape.',
      map_action: 'zoom_to_village',
      image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Indian_village_scene.jpg/1280px-Indian_village_scene.jpg',
      image_caption: 'A typical village in rural India',
    },
    {
      title: 'A Land of Faith and Tradition',
      narrative: 'Temples stand as the spiritual anchors of the community, drawing devotees from across the mandal. The ancient temples dotting the landscape reflect a culture deeply rooted in devotion, where festivals follow the rhythm of the monsoon and the harvest. Telugu and Urdu echo through the streets — a syncretic culture where temple bells and azaan calls are part of the same daily rhythm.',
      map_action: 'show_overview',
      image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Hindu_temple_in_Andhra_Pradesh.jpg/1280px-Hindu_temple_in_Andhra_Pradesh.jpg',
      image_caption: 'Temple architecture in Andhra Pradesh',
    },
    {
      title: 'Farming in the Rain Shadow',
      narrative: 'The village sits in one of India\'s driest corridors — the rain shadow of the Western Ghats. With barely 550mm of annual rainfall, farmers here are some of the most resilient in the country. Groundnut has been the lifeline crop, but erratic monsoons and depleting borewells have pushed many to explore sunflower, maize, and drought-resistant varieties. Satellite imagery reveals how the agricultural landscape has shifted over the past decade.',
      map_action: 'show_lulc_latest',
      image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Groundnut_plantation.jpg/1280px-Groundnut_plantation.jpg',
      image_caption: 'Groundnut fields in the Deccan plateau',
    },
    {
      title: 'The Water Challenge',
      narrative: 'Every summer, the red sandy loam soil dries up, and borewells run deeper. The ancient cheruvu tanks that once sustained the region are silting up. Conservation efforts aim to revive these water bodies — desilting tanks and planting native trees along their banks. The surface water data shows the seasonal ebb and flow of this precious resource.',
      map_action: 'show_water',
      image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Water_tank_in_Indian_village.jpg/1280px-Water_tank_in_Indian_village.jpg',
      image_caption: 'Traditional water tank (cheruvu)',
    },
  ],
};

// ─── India SVG Outline (simplified path for hero background) ───
const IndiaSVG = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 800 900"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M340 50 L380 45 L420 55 L460 48 L500 60 L530 52 L560 65 L590 58 L620 70 L640 62
         L660 75 L670 95 L680 120 L690 140 L695 165 L700 190 L710 215 L715 240 L720 260
         L710 285 L705 310 L690 340 L680 365 L670 390 L660 410 L650 430 L635 455
         L620 475 L600 500 L585 520 L570 540 L555 560 L540 575 L520 590 L500 610
         L485 630 L475 650 L470 670 L465 690 L460 710 L450 730 L440 745 L425 760
         L410 770 L390 778 L370 780 L350 775 L335 765 L320 750 L310 730 L300 710
         L290 690 L280 670 L265 650 L250 635 L235 620 L220 610 L200 600 L185 585
         L170 565 L160 540 L150 515 L145 490 L140 465 L138 440 L140 415 L145 390
         L150 365 L160 340 L170 315 L180 290 L195 265 L210 240 L225 218 L240 195
         L255 175 L270 155 L285 135 L300 115 L315 95 L325 75 L340 50Z"
      fill="rgba(255,255,255,0.5)"
      stroke="rgba(255,255,255,0.15)"
      strokeWidth="1.5"
    />
    <path
      d="M280 60 L300 50 L320 45 L340 50 L325 75 L315 95 L300 85 L285 75 L280 60Z"
      fill="rgba(255,255,255,0.4)"
      stroke="rgba(255,255,255,0.1)"
      strokeWidth="1"
    />
    <path
      d="M660 75 L680 80 L700 95 L720 110 L730 130 L725 150 L715 165
         L700 170 L695 165 L700 190 L690 180 L675 165 L665 145 L660 120 L660 95 L660 75Z"
      fill="rgba(255,255,255,0.35)"
      stroke="rgba(255,255,255,0.1)"
      strokeWidth="1"
    />
  </svg>
);

// ─── Year Card Component (per-year scroll trigger) ───
function YearCard({ year, data, fields, isActive, sectionType, refCallback, onClick }) {
  const theme = SECTION_THEMES[sectionType] || SECTION_THEMES.overview;
  return (
    <div
      className={`story-year-card ${isActive ? 'active' : ''}`}
      ref={refCallback}
      data-fiscal-year={year}
      data-section-type={sectionType}
      onClick={() => onClick && onClick(year, sectionType)}
      style={{
        '--theme-color': theme.color,
        borderColor: isActive ? theme.color : 'rgba(255,255,255,0.08)',
        cursor: 'pointer',
      }}
    >
      <div className="year-card-header">
        <span className="year-card-icon">{theme.icon}</span>
        <span className="year-card-year">{year}</span>
        {isActive && <span className="year-card-live-dot" />}
      </div>
      <div className="year-card-stats">
        {fields.map(({ label, value, unit }) => (
          <div className="year-card-stat" key={label}>
            <span className="year-card-stat-val">{value}</span>
            <span className="year-card-stat-label">{label}{unit ? ` (${unit})` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LULC Legend Component ───
function LulcLegend({ visible }) {
  if (!visible) return null;
  return (
    <div className="lulc-legend">
      <div className="lulc-legend-title">LULC Legend</div>
      {LULC_CLASSES.map(cls => (
        <div className="lulc-legend-item" key={cls.id}>
          <span className="lulc-legend-swatch" style={{ background: cls.color }} />
          <span className="lulc-legend-label">{cls.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function StoryMapView({ 
  results, 
  boundary, 
  onReset,
  layerUrls = [],
  activeLayerNames = [],
}) {
  const containerRef = useRef(null);
  const heroRef = useRef(null);
  const sectionRefs = useRef([]);
  const [heroScrolled, setHeroScrolled] = useState(false);
  const [visibleSections, setVisibleSections] = useState(new Set());
  const [activePhase, setActivePhase] = useState(1);
  const [activeFiscalYear, setActiveFiscalYear] = useState(null);
  const [activeSection, setActiveSection] = useState('overview');
  const [villageStory, setVillageStory] = useState(null);

  // Terraso storyboard state
  const [activeChapterIdx, setActiveChapterIdx] = useState(-1);
  const [storyboardVisible, setStoryboardVisible] = useState(false);
  const [visibleChapters, setVisibleChapters] = useState(new Set());
  const chapterPanelRefs = useRef(new Map());
  const storyboardRef = useRef(null);

  // ─── Extract results data ───
  const {
    cropping_intensity, surface_water, vegetation, waterbodies,
    village_name, state, district, tehsil, data_source,
    mws_count, terrain, crop_intensity_change, area_hectares,
    data_warning,
  } = results || {};

  const totalAreaHa = area_hectares || terrain?.total_area_ha || 0;

  // ─── Fetch village story from backend (fall back to hardcoded) ───
  useEffect(() => {
    if (!village_name) return;
    let cancelled = false;
    getVillageStory(village_name, state, district, tehsil)
      .then((data) => { if (!cancelled) setVillageStory(data); })
      .catch(() => {
        // Fallback: use hardcoded story with the actual village name
        if (!cancelled) {
          setVillageStory({
            ...HARDCODED_STORY,
            name: village_name,
          });
        }
      });
    return () => { cancelled = true; };
  }, [village_name, state, district, tehsil]);

  // ─── Story chapters for Terraso storyboard ───
  const storyChapters = useMemo(() => {
    if (villageStory?.story_chapters?.length > 0) return villageStory.story_chapters;
    return HARDCODED_STORY.story_chapters;
  }, [villageStory]);

  const storyData = useMemo(() => {
    return villageStory || { ...HARDCODED_STORY, name: village_name };
  }, [villageStory, village_name]);

  const ciData = useMemo(() => {
    if (Array.isArray(cropping_intensity?.data)) return cropping_intensity.data;
    if (Array.isArray(cropping_intensity)) return cropping_intensity;
    return null;
  }, [cropping_intensity]);

  const swData = useMemo(() => {
    if (Array.isArray(surface_water?.data)) return surface_water.data;
    if (Array.isArray(surface_water)) return surface_water;
    return null;
  }, [surface_water]);

  const narrative = useMemo(() => generateNarrative(results, ciData, swData), [results, ciData, swData]);

  // ─── WMS config for the MapView ───
  const wmsConfig = useMemo(() => {
    const apiHost = (import.meta.env.VITE_API_BASE || 'https://csvat-backend.onrender.com').replace(/\/$/, '');
    const b = boundary || {};
    const d = b.district || district || '';
    const t = b.tehsil || tehsil || '';
    if (!d || !t || d === '-' || t === '-') return null;
    if (b.source === 'upload') return null;
    return { apiBase: `${apiHost}/api/v1`, district: d, tehsil: t };
  }, [boundary, district, tehsil]);

  // ─── Terraso chapter IntersectionObserver ───
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !storyChapters.length) return;

    const chapterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = parseInt(entry.target.dataset.chapterIdx, 10);
          if (entry.isIntersecting) {
            setVisibleChapters((prev) => new Set([...prev, idx]));
            if (entry.intersectionRatio > 0.3) {
              setActiveChapterIdx(idx);
              setStoryboardVisible(true);
            }
          }
        });
      },
      { root: container, threshold: [0.1, 0.3, 0.5], rootMargin: '-5% 0px -30% 0px' }
    );

    const timer = setTimeout(() => {
      chapterPanelRefs.current.forEach((node) => {
        chapterObserver.observe(node);
      });
    }, 500);

    return () => {
      clearTimeout(timer);
      chapterObserver.disconnect();
    };
  }, [storyChapters, results]);

  // ─── Map action handler (Terraso chapter → map transitions) ───
  const handleMapAction = useCallback((action) => {
    // These map actions currently signal the UI; GoogleMapsIntegration
    // handles zoom/layer state through the wmsConfig + activeFiscalYear props.
    // For now, we update the active section to change the Year HUD theme.
    switch (action) {
      case 'zoom_to_village':
        setActiveSection('overview');
        break;
      case 'show_overview':
        setActiveSection('overview');
        break;
      case 'show_lulc_latest':
      case 'show_lulc_oldest':
        setActiveSection('cropping');
        if (ciData?.length > 0) {
          setActiveFiscalYear(action === 'show_lulc_latest'
            ? ciData[ciData.length - 1].year
            : ciData[0].year
          );
        }
        break;
      case 'show_water':
        setActiveSection('water');
        break;
    }
  }, [ciData]);

  // Trigger map action when active chapter changes
  useEffect(() => {
    if (activeChapterIdx >= 0 && storyChapters[activeChapterIdx]) {
      handleMapAction(storyChapters[activeChapterIdx].map_action);
    }
  }, [activeChapterIdx, storyChapters, handleMapAction]);

  const chapterRefCallback = useCallback((node) => {
    if (node) {
      const idx = node.dataset.chapterIdx;
      if (idx != null) chapterPanelRefs.current.set(idx, node);
    }
  }, []);

  // Scroll to chapter (sticky TOC click)
  const scrollToChapter = useCallback((idx) => {
    const node = chapterPanelRefs.current.get(String(idx));
    if (node && containerRef.current) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // (ciData, swData, narrative, wmsConfig moved above handleMapAction)

  // Set initial fiscal year
  useEffect(() => {
    if (ciData && ciData.length > 0 && !activeFiscalYear) {
      setActiveFiscalYear(ciData[ciData.length - 1].year);
    }
  }, [ciData]);

  // ─── Map data ───
  const mapGeojson = boundary?.boundary_geojson || boundary?.geojson || null;
  const mapCenter = useMemo(() => {
    if (!mapGeojson?.coordinates?.[0]) return { lat: 22.5, lng: 78.5 };
    try {
      const coords = mapGeojson.type === 'MultiPolygon'
        ? mapGeojson.coordinates[0][0]
        : mapGeojson.coordinates[0];
      const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      const avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      return { lat: avgLat, lng: avgLng };
    } catch {
      return { lat: 22.5, lng: 78.5 };
    }
  }, [mapGeojson]);

  // ─── IntersectionObserver for scroll phases ───
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Observer for hero section
    const heroObserver = new IntersectionObserver(
      ([entry]) => {
        setHeroScrolled(!entry.isIntersecting);
        if (entry.isIntersecting) setActivePhase(1);
      },
      { root: container, threshold: 0.3 }
    );

    // Observer for story sections
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        let anyVisible = false;
        entries.forEach((entry) => {
          const id = entry.target.dataset.sectionId;
          if (entry.isIntersecting) {
            anyVisible = true;
            setVisibleSections((prev) => new Set([...prev, id]));
          }
        });
        if (anyVisible) setActivePhase(2);
      },
      { root: container, threshold: 0.15, rootMargin: '0px 0px -10% 0px' }
    );

    if (heroRef.current) heroObserver.observe(heroRef.current);
    sectionRefs.current.forEach((ref) => {
      if (ref) sectionObserver.observe(ref);
    });

    return () => {
      heroObserver.disconnect();
      sectionObserver.disconnect();
    };
  }, [results]);

  // ─── IntersectionObserver for year cards (map sync) ───
  const yearCardRefsMap = useRef(new Map());
  
  const yearCardRefCallback = useCallback((node) => {
    if (node) {
      const fy = node.dataset.fiscalYear;
      if (fy) yearCardRefsMap.current.set(fy, node);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const yearObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
            const fy = entry.target.dataset.fiscalYear;
            const section = entry.target.dataset.sectionType;
            if (fy) setActiveFiscalYear(fy);
            if (section) setActiveSection(section);
          }
        });
      },
      { root: container, threshold: [0.3, 0.5, 0.8], rootMargin: '-15% 0px -35% 0px' }
    );

    // Observe after a tick to ensure DOM is populated
    const timer = setTimeout(() => {
      yearCardRefsMap.current.forEach((node) => {
        yearObserver.observe(node);
      });
    }, 800);

    return () => {
      clearTimeout(timer);
      yearObserver.disconnect();
    };
  }, [results, ciData, swData, vegetation]);

  // Assign section ref
  const setSectionRef = (idx) => (el) => {
    sectionRefs.current[idx] = el;
  };

  // Click handler for year cards (fallback for scroll sync)
  const handleYearCardClick = useCallback((year, section) => {
    setActiveFiscalYear(year);
    setActiveSection(section);
  }, []);

  const sectionClass = (id) =>
    `story-section ${visibleSections.has(id) ? 'visible' : ''}`;

  if (!results) return null;

  // ─── Compute summary data for hero ───
  const yearRange = ciData && ciData.length > 0
    ? `${ciData[0].year} — ${ciData[ciData.length - 1].year}`
    : '';

  // ─── Active section theme ───
  const activeTheme = SECTION_THEMES[activeSection] || SECTION_THEMES.overview;

  // ─── Get mini stats for current year (shown on map HUD) ───
  const currentYearStats = useMemo(() => {
    if (!activeFiscalYear) return null;
    const ci = ciData?.find(d => d.year === activeFiscalYear);
    const sw = swData?.find(d => d.year === activeFiscalYear);
    return { ci, sw };
  }, [activeFiscalYear, ciData, swData]);

  return (
    <div className="story-map" ref={containerRef}>
      {/* Close Button */}
      <button className="story-close-btn" onClick={onReset} title="Close & New Analysis">
        ✕
      </button>

      {/* ═══ PHASE 1: HERO ═══ */}
      <section className="story-hero" ref={heroRef}>
        <div className="story-hero-bg">
          <IndiaSVG className={`india-map-svg ${heroScrolled ? 'zooming' : ''}`} />
        </div>

        <div className="story-hero-content">
          <div className="story-hero-badge">
            <span>📊</span> CSVAT Analytics Report
          </div>

          <h1 className="story-hero-title">
            Village Analytics for
            <span className="place-name">
              {village_name || 'Selected Region'}
            </span>
          </h1>

          <p className="story-hero-subtitle">
            {(district || state)
              ? `A comprehensive land-use, water, and vegetation analysis of ${village_name || 'the selected area'} in ${[district, state].filter(Boolean).join(', ')}.`
              : `A comprehensive environmental analytics report for the selected boundary.`
            }
          </p>

          <div className="story-hero-meta">
            {data_source && (
              <div className="story-hero-meta-item">
                <span className="meta-label">Data Source</span>
                <span className="meta-value">{data_source}</span>
              </div>
            )}
            {yearRange && (
              <div className="story-hero-meta-item">
                <span className="meta-label">Period</span>
                <span className="meta-value">{yearRange}</span>
              </div>
            )}
            {totalAreaHa > 0 && (
              <div className="story-hero-meta-item">
                <span className="meta-label">Area</span>
                <span className="meta-value">{totalAreaHa.toFixed(2)} ha</span>
              </div>
            )}
            {mws_count != null && (
              <div className="story-hero-meta-item">
                <span className="meta-label">Micro-Watersheds</span>
                <span className="meta-value">{mws_count}</span>
              </div>
            )}
          </div>
        </div>

        <div className="story-scroll-cue">
          <span>Scroll to explore</span>
          <div className="scroll-arrow" />
        </div>
      </section>

      {/* ═══ PHASE 2: SPLIT SCROLL (Foreground Blocks over Sticky Map) ═══ */}
      <section className="story-split">
        {/* Sticky Map Background */}
        <div className="story-split-map">
          <MapView
            geojson={mapGeojson}
            center={mapCenter}
            zoom={13}
            height="100%"
            interactive={false}
            maskOutside={true}
            layerUrls={layerUrls}
            activeLayerNames={activeLayerNames}
            activeFiscalYear={wmsConfig ? activeFiscalYear : null}
            wmsConfig={wmsConfig}
          />

          {/* Year HUD on map */}
          {activeFiscalYear && (
            <div className="map-year-hud keyframe-fade-in" style={{ '--theme-color': activeTheme.color }}>
              <div className="hud-header">
                <span>{activeTheme.icon}</span>
                <span>{activeTheme.label}</span>
              </div>
              <div className="hud-year-pill">{activeFiscalYear}</div>
              {currentYearStats?.ci && (
                <div className="hud-mini-stats">
                  <div className="hud-stat">
                    <span className="hud-stat-val">{currentYearStats.ci.total_cropped_ha?.toFixed(1)}</span>
                    <span className="hud-stat-label">Crop ha</span>
                  </div>
                  <div className="hud-stat">
                    <span className="hud-stat-val">{currentYearStats.ci.cropping_intensity?.toFixed(2) ?? '—'}</span>
                    <span className="hud-stat-label">Intensity</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* LULC Legend */}
          <LulcLegend visible={!!wmsConfig && !!activeFiscalYear} />

          <div className="map-overlay-info">
            <div className="village-label">
              {village_name || 'Selected Region'}
            </div>
            <div className="location-detail">
              {[tehsil, district, state].filter(Boolean).join(', ') || 'Pan-India (Upload)'}
            </div>
            {data_source && (
              <div className={`data-badge ${data_source.includes('GEE') ? 'gee' : 'corestack'}`}>
                📡 {data_source}
              </div>
            )}
          </div>
        </div>

        {/* Right: Scrollable Analytics Foreground */}
        <div className="story-split-content">

          {/* Data Warning Banner */}
          {data_warning && (
            <div className="story-warning-banner story-section visible">
              <span className="warning-icon">⚠️</span>
              <div>
                <div className="warning-title">Lower Resolution Data</div>
                <div className="warning-text">{data_warning}</div>
              </div>
            </div>
          )}

          {/* Old inline narrative chapters removed — now in Terraso storyboard below */}

          {/* ── Section 0: Summary Stats ── */}
          <div
            className={sectionClass('summary-stats')}
            data-section-id="summary-stats"
            ref={setSectionRef(0)}
          >
            <div className="story-section-label summary">
              <span>📊</span> Overview
            </div>
            <h2 className="story-section-title">At a Glance</h2>
            <p className="story-section-desc">
              Key metrics summarizing the analytical assessment of {village_name || 'the selected area'}.
            </p>

            <div className="story-stats-row">
              {mws_count != null && (
                <div className="story-stat">
                  <div className="stat-number blue">{mws_count}</div>
                  <div className="stat-label">Micro-Watersheds</div>
                </div>
              )}
              {ciData && (
                <div className="story-stat">
                  <div className="stat-number green">{ciData.length}</div>
                  <div className="stat-label">Years of Data</div>
                </div>
              )}
              {totalAreaHa > 0 && (
                <div className="story-stat">
                  <div className="stat-number amber">{totalAreaHa.toFixed(2)}</div>
                  <div className="stat-label">Total Area (ha)</div>
                </div>
              )}
              {vegetation && (
                <div className="story-stat">
                  <div className="stat-number red">
                    {vegetation.transitions?.filter(t => t.to !== 'Forest' && t.area_ha > 0).length || 0}
                  </div>
                  <div className="stat-label">Deforestation Types</div>
                </div>
              )}
            </div>
          </div>

          <div className="story-divider"><span className="divider-icon">🌾</span></div>

          {/* ── Section 1: Cropping Intensity ── */}
          {ciData && ciData.length > 0 && (
            <>
              <div
                className={sectionClass('cropping')}
                data-section-id="cropping"
                ref={setSectionRef(1)}
              >
                <div className="story-section-label crops">
                  <span>🌱</span> Cropping
                </div>
                <h2 className="story-section-title">Cropping Intensity Trends</h2>
                <p className="story-section-desc">
                  How agricultural land use patterns have evolved within the village boundary
                  across {ciData.length} fiscal years. {wmsConfig ? 'Scroll through individual years to see the LULC map change.' : ''}
                </p>

                <div className="story-chart-card">
                  <div className="chart-header">
                    <div className="chart-icon" style={{ background: 'rgba(34,197,94,0.1)' }}>📊</div>
                    <h4>Stacked Crop Area by Year</h4>
                  </div>
                  <div className="story-chart-wrapper">
                    <Bar
                      data={{
                        labels: ciData.map(d => d.year),
                        datasets: [
                          {
                            label: 'Single Crop (ha)',
                            data: ciData.map(d => d.single_crop_ha),
                            backgroundColor: 'rgba(34, 197, 94, 0.7)',
                            borderRadius: 6,
                          },
                          {
                            label: 'Double Crop (ha)',
                            data: ciData.map(d => d.double_crop_ha),
                            backgroundColor: 'rgba(59, 130, 246, 0.7)',
                            borderRadius: 6,
                          },
                          {
                            label: 'Triple Crop (ha)',
                            data: ciData.map(d => d.triple_crop_ha),
                            backgroundColor: 'rgba(245, 158, 11, 0.7)',
                            borderRadius: 6,
                          },
                        ],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                          x: { stacked: true },
                          y: { stacked: true, title: { display: true, text: 'Area (Hectares)' } },
                        },
                        plugins: { legend: { position: 'top' } },
                      }}
                    />
                  </div>
                </div>

                {/* Per-Year Scroll Cards — CROPPING */}
                <div className="year-cards-label">
                  🗓 Scroll through years to see map changes
                </div>
                <div className="year-cards-container">
                  {ciData.map((d) => (
                    <YearCard
                      key={`ci-${d.year}`}
                      year={d.year}
                      data={d}
                      isActive={activeFiscalYear === d.year}
                      sectionType="cropping"
                      refCallback={yearCardRefCallback}
                      onClick={handleYearCardClick}
                      fields={[
                        { label: 'Single', value: d.single_crop_ha?.toFixed(1), unit: 'ha' },
                        { label: 'Double', value: d.double_crop_ha?.toFixed(1), unit: 'ha' },
                        { label: 'Triple', value: d.triple_crop_ha?.toFixed(1), unit: 'ha' },
                        { label: 'Intensity', value: d.cropping_intensity?.toFixed(3) ?? '—' },
                      ]}
                    />
                  ))}
                </div>

                <table className="story-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Single (ha)</th>
                      <th>Double (ha)</th>
                      <th>Triple (ha)</th>
                      <th>Total (ha)</th>
                      <th>Intensity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ciData.map(d => (
                      <tr key={d.year} className={activeFiscalYear === d.year ? 'active-year-row' : ''}>
                        <td>{d.year}</td>
                        <td>{d.single_crop_ha?.toFixed(2)}</td>
                        <td>{d.double_crop_ha?.toFixed(2)}</td>
                        <td>{d.triple_crop_ha?.toFixed(2)}</td>
                        <td>{d.total_cropped_ha?.toFixed(2)}</td>
                        <td>{d.cropping_intensity?.toFixed(3) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="story-insight">
                  <strong>Insight:</strong> Cropping intensity analysis shows how agricultural land use patterns
                  have changed within the village boundary. The intensity index represents the average number
                  of crop cycles per year across the analyzed area.
                </div>
              </div>

              <div className="story-divider"><span className="divider-icon">💧</span></div>
            </>
          )}

          {/* ── Section 2: Surface Water ── */}
          {swData && swData.length > 0 && (
            <>
              <div
                className={sectionClass('water')}
                data-section-id="water"
                ref={setSectionRef(2)}
              >
                <div className="story-section-label water">
                  <span>💧</span> Hydrology
                </div>
                <h2 className="story-section-title">Seasonal Surface Water</h2>
                <p className="story-section-desc">
                  Tracking waterbody availability across Kharif (monsoon), Rabi (winter),
                  and Zaid (summer) agricultural seasons.
                </p>

                <div className="story-chart-card">
                  <div className="chart-header">
                    <div className="chart-icon" style={{ background: 'rgba(20,184,166,0.1)' }}>💧</div>
                    <h4>Seasonal Water Coverage</h4>
                  </div>
                  <div className="story-chart-wrapper">
                    <Bar
                      data={{
                        labels: swData.map(d => d.year),
                        datasets: [
                          {
                            label: 'Kharif (ha)',
                            data: swData.map(d => d.kharif_ha ?? d.seasonal_monsoon_ha ?? 0),
                            backgroundColor: 'rgba(20, 184, 166, 0.8)',
                            borderRadius: 6,
                          },
                          {
                            label: 'Rabi (ha)',
                            data: swData.map(d => d.rabi_ha ?? d.seasonal_winter_ha ?? 0),
                            backgroundColor: 'rgba(59, 130, 246, 0.7)',
                            borderRadius: 6,
                          },
                          {
                            label: 'Zaid (ha)',
                            data: swData.map(d => d.zaid_ha ?? d.perennial_ha ?? 0),
                            backgroundColor: 'rgba(147, 197, 253, 0.6)',
                            borderRadius: 6,
                          },
                        ],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                          y: { title: { display: true, text: 'Area (Hectares)' } },
                        },
                        plugins: { legend: { position: 'top' } },
                      }}
                    />
                  </div>
                </div>

                {/* Per-Year Scroll Cards — WATER */}
                <div className="year-cards-label">
                  🗓 Scroll through years to see map changes
                </div>
                <div className="year-cards-container">
                  {swData.map((d) => (
                    <YearCard
                      key={`sw-${d.year}`}
                      year={d.year}
                      data={d}
                      isActive={activeFiscalYear === d.year}
                      sectionType="water"
                      refCallback={yearCardRefCallback}
                      onClick={handleYearCardClick}
                      fields={[
                        { label: 'Kharif', value: (d.kharif_ha ?? d.seasonal_monsoon_ha ?? 0).toFixed(1), unit: 'ha' },
                        { label: 'Rabi', value: (d.rabi_ha ?? d.seasonal_winter_ha ?? 0).toFixed(1), unit: 'ha' },
                        { label: 'Zaid', value: (d.zaid_ha ?? d.perennial_ha ?? 0).toFixed(1), unit: 'ha' },
                        { label: 'Total', value: (d.total_water_ha ?? 0).toFixed(1), unit: 'ha' },
                      ]}
                    />
                  ))}
                </div>

                <table className="story-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Kharif (ha)</th>
                      <th>Rabi (ha)</th>
                      <th>Zaid (ha)</th>
                      <th>Total (ha)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {swData.map(d => (
                      <tr key={d.year} className={activeFiscalYear === d.year ? 'active-year-row' : ''}>
                        <td>{d.year}</td>
                        <td>{(d.kharif_ha ?? d.seasonal_monsoon_ha ?? 0).toFixed(2)}</td>
                        <td>{(d.rabi_ha ?? d.seasonal_winter_ha ?? 0).toFixed(2)}</td>
                        <td>{(d.zaid_ha ?? d.perennial_ha ?? 0).toFixed(2)}</td>
                        <td>{(d.total_water_ha ?? 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="story-insight">
                  <strong>Insight:</strong> Surface water analysis tracks waterbody availability across
                  agricultural seasons. Kharif covers the monsoon period (Jun–Sep), Rabi covers winter
                  (Oct–Feb), and Zaid covers the summer period (Mar–May).
                </div>
              </div>

              <div className="story-divider"><span className="divider-icon">🌳</span></div>
            </>
          )}

          {/* ── Section 3: Vegetation & Deforestation ── */}
          {vegetation && (
            <>
              <div
                className={sectionClass('vegetation')}
                data-section-id="vegetation"
                ref={setSectionRef(3)}
              >
                <div className="story-section-label vegetation">
                  <span>🌳</span> Vegetation
                </div>
                <h2 className="story-section-title">Vegetation & Deforestation</h2>
                <p className="story-section-desc">
                  Tracking forest cover changes and deforestation patterns within the
                  study area over the analysis period.
                </p>

                <div className="story-stats-row">
                  <div className="story-stat">
                    <div className="stat-number green">
                      {vegetation.tree_cover_gain_ha?.toFixed(2) ?? '—'}
                    </div>
                    <div className="stat-label">Afforestation (ha)</div>
                  </div>
                  <div className="story-stat">
                    <div className="stat-number red">
                      {vegetation.tree_cover_loss_ha?.toFixed(2) ?? '—'}
                    </div>
                    <div className="stat-label">Deforestation (ha)</div>
                  </div>
                  <div className="story-stat">
                    <div className={`stat-number ${(vegetation.net_change_ha ?? 0) >= 0 ? 'green' : 'red'}`}>
                      {vegetation.net_change_ha?.toFixed(2) ?? '—'}
                    </div>
                    <div className="stat-label">Net Change (ha)</div>
                  </div>
                  <div className="story-stat">
                    <div className="stat-number amber">
                      {vegetation.degraded_land_ha?.toFixed(2) ?? '—'}
                    </div>
                    <div className="stat-label">Degraded Land (ha)</div>
                  </div>
                </div>

                {/* Per-Year Scroll Cards — VEGETATION */}
                {vegetation.yearly_data && vegetation.yearly_data.length > 0 && (
                  <>
                    <div className="year-cards-label">
                      🗓 Scroll through years to see tree cover on map
                    </div>
                    <div className="year-cards-container">
                      {vegetation.yearly_data.map((d) => (
                        <YearCard
                          key={`veg-${d.year}`}
                          year={d.year}
                          data={d}
                          isActive={activeFiscalYear === d.year}
                          sectionType="vegetation"
                          refCallback={yearCardRefCallback}
                          onClick={handleYearCardClick}
                          fields={[
                            { label: 'Tree Cover', value: d.tree_cover_ha?.toFixed(1), unit: 'ha' },
                          ]}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Vegetation Transitions Chart */}
                {vegetation.transitions && vegetation.transitions.length > 0 && (
                  <div className="story-chart-card">
                    <div className="chart-header">
                      <div className="chart-icon" style={{ background: 'rgba(239,68,68,0.1)' }}>🔥</div>
                      <h4>Deforestation Transitions</h4>
                    </div>
                    <div className="story-chart-wrapper" style={{ height: '280px' }}>
                      <Bar
                        data={{
                          labels: vegetation.transitions
                            .filter(t => (t.to_label || t.to) !== 'Forest')
                            .map(t => `${t.from_class || t.from} → ${t.to_label || t.to}`),
                          datasets: [{
                            label: 'Area (ha)',
                            data: vegetation.transitions
                              .filter(t => (t.to_label || t.to) !== 'Forest')
                              .map(t => t.area_ha),
                            backgroundColor: [
                              'rgba(239, 68, 68, 0.7)',
                              'rgba(245, 158, 11, 0.7)',
                              'rgba(234, 179, 8, 0.7)',
                              'rgba(156, 163, 175, 0.7)',
                            ],
                            borderRadius: 6,
                          }],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          indexAxis: 'y',
                          scales: {
                            x: { title: { display: true, text: 'Area (Hectares)' } },
                          },
                          plugins: { legend: { display: false } },
                        }}
                      />
                    </div>

                    <table className="story-table">
                      <thead>
                        <tr>
                          <th>From</th>
                          <th>To</th>
                          <th>Area (ha)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vegetation.transitions.map((t, idx) => (
                          <tr key={idx}>
                            <td>{t.from_class || t.from}</td>
                            <td>{t.to_label || t.to}</td>
                            <td>{t.area_ha?.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Yearly Tree Cover Trend */}
                {vegetation.yearly_data && vegetation.yearly_data.length > 0 && (
                  <div className="story-chart-card">
                    <div className="chart-header">
                      <div className="chart-icon" style={{ background: 'rgba(34,197,94,0.1)' }}>📈</div>
                      <h4>Tree Cover Over Time</h4>
                    </div>
                    <div className="story-chart-wrapper">
                      <Line
                        data={{
                          labels: vegetation.yearly_data.map(d => d.year),
                          datasets: [{
                            label: 'Tree Cover (ha)',
                            data: vegetation.yearly_data.map(d => d.tree_cover_ha),
                            borderColor: '#22c55e',
                            backgroundColor: 'rgba(34, 197, 94, 0.12)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 6,
                            pointBackgroundColor: '#22c55e',
                            pointBorderColor: '#0f172a',
                            pointBorderWidth: 2,
                          }],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          scales: {
                            y: { title: { display: true, text: 'Area (Hectares)' } },
                          },
                          plugins: { legend: { position: 'top' } },
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="story-insight">
                  <strong>Insight:</strong> Vegetation analysis compares land cover between the study period,
                  tracking how forest land transitions to other use types.
                  {vegetation.net_change_ha < 0 && ` The village experienced a net loss of ${Math.abs(vegetation.net_change_ha).toFixed(2)} ha of forest cover.`}
                  {vegetation.net_change_ha >= 0 && ` The village shows a net gain of ${vegetation.net_change_ha?.toFixed(2)} ha of forest cover.`}
                </div>
              </div>

              <div className="story-divider"><span className="divider-icon">🔄</span></div>
            </>
          )}

          {/* ── Section 4: Cropping Intensity Change Transitions ── */}
          {crop_intensity_change && crop_intensity_change.length > 0 && (
            <>
              <div
                className={sectionClass('transitions')}
                data-section-id="transitions"
                ref={setSectionRef(4)}
              >
                <div className="story-section-label transition">
                  <span>🔄</span> Change Detection
                </div>
                <h2 className="story-section-title">Cropping Intensity Changes</h2>
                <p className="story-section-desc">
                  How agricultural practices have shifted between single, double, and triple
                  cropping patterns over time.
                </p>

                <div className="story-chart-card">
                  <div className="chart-header">
                    <div className="chart-icon" style={{ background: 'rgba(236,72,153,0.1)' }}>📊</div>
                    <h4>Intensity Transitions</h4>
                  </div>
                  <div className="story-chart-wrapper" style={{ height: '320px' }}>
                    <Bar
                      data={{
                        labels: crop_intensity_change
                          .filter(t => !(t.category || t.label || '').includes('Total'))
                          .map(t => t.category || t.label),
                        datasets: [{
                          label: 'Area (ha)',
                          data: crop_intensity_change
                            .filter(t => !(t.category || t.label || '').includes('Total'))
                            .map(t => t.area_ha),
                          backgroundColor: crop_intensity_change
                            .filter(t => !(t.category || t.label || '').includes('Total'))
                            .map(t => {
                              const lbl = t.category || t.label || '';
                              if (lbl.includes('Single To Double') || lbl.includes('Double To Triple') || lbl.includes('Single To Triple'))
                                return 'rgba(34, 197, 94, 0.7)';
                              if (lbl.includes('Double To Single') || lbl.includes('Triple To Double') || lbl.includes('Triple To Single'))
                                return 'rgba(239, 68, 68, 0.7)';
                              return 'rgba(59, 130, 246, 0.7)';
                            }),
                          borderRadius: 6,
                        }],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'y',
                        scales: {
                          x: { title: { display: true, text: 'Area (Hectares)' } },
                        },
                        plugins: { legend: { display: false } },
                      }}
                    />
                  </div>

                  <table className="story-table">
                    <thead>
                      <tr>
                        <th>Transition</th>
                        <th>Area (ha)</th>
                        <th>Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crop_intensity_change.map((t, idx) => {
                        const lbl = t.category || t.label || '';
                        return (
                          <tr key={idx}>
                            <td>{lbl}</td>
                            <td>{t.area_ha?.toFixed(2)}</td>
                            <td>
                              {lbl.includes('Total') ? '—' :
                                (lbl.includes('Single To Double') || lbl.includes('Double To Triple') || lbl.includes('Single To Triple'))
                                  ? '↑ Improvement'
                                  : (lbl.includes('Double To Single') || lbl.includes('Triple To Double') || lbl.includes('Triple To Single'))
                                    ? '↓ Decline'
                                    : '→ Stable'
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="story-insight">
                  <strong>Insight:</strong> Green bars indicate improvement (single→double, double→triple),
                  while red bars indicate decline. Blue represents stable transitions.
                </div>
              </div>

              <div className="story-divider"><span className="divider-icon">⛰️</span></div>
            </>
          )}

          {/* ── Section 5: Terrain Composition ── */}
          {terrain && terrain.total_area_ha > 0 && (
            <>
              <div
                className={sectionClass('terrain')}
                data-section-id="terrain"
                ref={setSectionRef(5)}
              >
                <div className="story-section-label terrain">
                  <span>⛰️</span> Terrain
                </div>
                <h2 className="story-section-title">Terrain Composition</h2>
                <p className="story-section-desc">
                  Topographical distribution of the village area — essential for watershed
                  planning and land management.
                </p>

                <div className="story-chart-card">
                  <div className="chart-header">
                    <div className="chart-icon" style={{ background: 'rgba(245,158,11,0.1)' }}>🗺️</div>
                    <h4>Land Classification</h4>
                  </div>
                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.5rem' }}>
                    <div style={{ width: '240px', height: '240px' }}>
                      <Doughnut
                        data={{
                          labels: Object.entries(terrain)
                            .filter(([k]) => k !== 'total_area_ha')
                            .filter(([, v]) => v > 0)
                            .map(([k]) => k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())),
                          datasets: [{
                            data: Object.entries(terrain)
                              .filter(([k]) => k !== 'total_area_ha')
                              .filter(([, v]) => v > 0)
                              .map(([, v]) => v),
                            backgroundColor: [
                              'rgba(245, 158, 11, 0.7)',
                              'rgba(34, 197, 94, 0.7)',
                              'rgba(156, 163, 175, 0.7)',
                              'rgba(239, 68, 68, 0.7)',
                              'rgba(59, 130, 246, 0.7)',
                            ],
                            borderWidth: 2,
                            borderColor: '#ffffff',
                          }],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: true,
                          plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } },
                        }}
                      />
                    </div>
                  </div>

                  <table className="story-table">
                    <thead>
                      <tr>
                        <th>Terrain Type</th>
                        <th>Area (ha)</th>
                        <th>Percentage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(terrain)
                        .filter(([k]) => k !== 'total_area_ha')
                        .map(([k, v]) => (
                          <tr key={k}>
                            <td>{k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</td>
                            <td>{v.toFixed(2)}</td>
                            <td>{((v / terrain.total_area_ha) * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      <tr style={{ fontWeight: 700 }}>
                        <td>Total</td>
                        <td>{terrain.total_area_ha.toFixed(2)}</td>
                        <td>100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="story-insight">
                  <strong>Insight:</strong> Terrain composition analysis classifies the village area into
                  five terrain types: hill slope, plain, ridge, slopy, and valley terrain. This data helps
                  understand the topographical distribution for watershed planning.
                </div>
              </div>

              <div className="story-divider"><span className="divider-icon">🏞️</span></div>
            </>
          )}

          {/* ── Section 6: Waterbodies ── */}
          {waterbodies && waterbodies.count > 0 && (
            <>
              <div
                className={sectionClass('waterbodies')}
                data-section-id="waterbodies"
                ref={setSectionRef(6)}
              >
                <div className="story-section-label waterbodies">
                  <span>🏞️</span> Waterbodies
                </div>
                <h2 className="story-section-title">Waterbodies Analysis</h2>
                <p className="story-section-desc">
                  Identified waterbodies within the tehsil, including seasonal coverage
                  and zone of influence analytics.
                </p>

                <div className="story-stats-row">
                  <div className="story-stat">
                    <div className="stat-number blue">{waterbodies.count}</div>
                    <div className="stat-label">Total Waterbodies</div>
                  </div>
                  <div className="story-stat">
                    <div className="stat-number teal">
                      {waterbodies.waterbodies?.reduce((sum, wb) => sum + (wb.area_ha || 0), 0).toFixed(2)}
                    </div>
                    <div className="stat-label">Total Area (ha)</div>
                  </div>
                </div>

                <div className="story-chart-card">
                  <div className="chart-header">
                    <div className="chart-icon" style={{ background: 'rgba(59,130,246,0.1)' }}>💧</div>
                    <h4>Waterbody Inventory</h4>
                  </div>
                  <table className="story-table">
                    <thead>
                      <tr>
                        <th>UID</th>
                        <th>Name</th>
                        <th>Area (ha)</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waterbodies.waterbodies?.slice(0, 20).map((wb, idx) => (
                        <tr key={wb.uid || idx}>
                          <td style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{wb.uid}</td>
                          <td>{wb.name}</td>
                          <td>{wb.area_ha}</td>
                          <td>{wb.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {waterbodies.waterbodies?.length > 20 && (
                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem', marginTop: '0.5rem' }}>
                      Showing 20 of {waterbodies.waterbodies.length} waterbodies
                    </div>
                  )}
                </div>

                <div className="story-insight">
                  <strong>Insight:</strong> The tehsil contains {waterbodies.count} identified waterbodies.
                  Waterbody data is sourced from CoRE Stack and includes seasonal coverage and zone
                  of influence analytics.
                </div>
              </div>

              <div className="story-divider"><span className="divider-icon">📖</span></div>
            </>
          )}

          {/* Section 7 removed — replaced by Terraso storyboard below */}

          {/* ── Export Section ── */}
          <div
            className={sectionClass('exports')}
            data-section-id="exports"
            ref={setSectionRef(8)}
          >
            <div className="story-export-section">
              <h3>Export Your Report</h3>
              <p>Download the analytics data in your preferred format.</p>
              <ExportManager results={results} />
            </div>

            <div className="story-new-analysis">
              <button className="story-new-analysis-btn" onClick={onReset} id="story-new-analysis-btn">
                🔄 Start New Analysis
              </button>
            </div>
          </div>

        </div>
      </section>

      {/* ═══ TERRASO STORYBOARD (below analytics) ═══ */}
      {storyChapters.length > 0 && (
        <>
          {/* Transition divider */}
          <div className="storyboard-transition">
            <h2 className="storyboard-transition-title">
              📖 The Story of {village_name || 'This Village'}
            </h2>
            <p className="storyboard-transition-subtitle">
              Scroll through the narrative chapters below — the map will guide you through the village's story
            </p>
          </div>

          {/* Sticky Chapter TOC */}
          <nav className={`terraso-chapter-toc ${storyboardVisible ? '' : 'hidden'}`}>
            {/* Intro dot */}
            <div
              className={`terraso-toc-dot ${activeChapterIdx === -1 ? 'active' : ''}`}
              onClick={() => scrollToChapter('intro')}
            >
              <span className="terraso-toc-label">Intro</span>
              <span className="terraso-toc-circle" />
            </div>
            {storyChapters.map((ch, idx) => (
              <div
                key={idx}
                className={`terraso-toc-dot ${activeChapterIdx === idx ? 'active' : ''}`}
                onClick={() => scrollToChapter(idx)}
              >
                <span className="terraso-toc-label">{ch.title}</span>
                <span className="terraso-toc-circle" />
              </div>
            ))}
          </nav>

          {/* Storyboard: Fixed Map + Scrolling Panels */}
          <section className="terraso-storyboard" ref={storyboardRef}>
            {/* Sticky Map Background */}
            <div className="terraso-storyboard-map">
              <MapView
                geojson={mapGeojson}
                center={mapCenter}
                zoom={13}
                height="100%"
                interactive={true}
                maskOutside={true}
                layerUrls={layerUrls}
                activeLayerNames={activeLayerNames}
                activeFiscalYear={wmsConfig ? activeFiscalYear : null}
                wmsConfig={wmsConfig}
              />

              {/* Chapter HUD on Map */}
              {activeChapterIdx >= 0 && storyChapters[activeChapterIdx] && (
                <div className="terraso-map-chapter-hud">
                  <span className="terraso-map-chapter-hud-icon">
                    {MAP_ACTION_LABELS[storyChapters[activeChapterIdx].map_action]?.icon || ''}
                  </span>
                  <span className="terraso-map-chapter-hud-label">
                    {MAP_ACTION_LABELS[storyChapters[activeChapterIdx].map_action]?.label || 'Viewing'}
                  </span>
                </div>
              )}

              {/* Map Info Overlay */}
              <div className="terraso-map-info">
                <div className="terraso-map-village-name">
                  {village_name || 'Selected Region'}
                </div>
                <div className="terraso-map-location">
                  {[tehsil, district, state].filter(Boolean).join(', ')}
                </div>
              </div>

              {/* LULC Legend */}
              <LulcLegend visible={!!wmsConfig && !!activeFiscalYear} />
            </div>

            {/* Scrolling Chapter Panels */}
            <div className="terraso-storyboard-chapters">
              {/* Intro Panel */}
              <div
                className={`terraso-intro-panel ${visibleChapters.has(-1) || activeChapterIdx === -1 ? 'visible' : ''}`}
                ref={(node) => {
                  if (node) chapterPanelRefs.current.set('intro', node);
                  // Also set as chapter -1 for observer
                  if (node) {
                    node.dataset.chapterIdx = '-1';
                    // Observe it
                  }
                }}
              >
                <div className="terraso-intro-label">
                  <span>📖</span> Village Story
                </div>
                <h2 className="terraso-intro-title">
                  The Story of {storyData.name || village_name}
                </h2>
                <div className="terraso-intro-location">
                  {[tehsil, district, state].filter(Boolean).join(', ')}
                </div>

                <div className="terraso-intro-demographics">
                  <div className="terraso-demo-item">
                    <span className="terraso-demo-value">
                      {(storyData.population_2011 || 0).toLocaleString()}
                    </span>
                    <span className="terraso-demo-label">Population</span>
                  </div>
                  <div className="terraso-demo-item">
                    <span className="terraso-demo-value">
                      {(storyData.households_2011 || 0).toLocaleString()}
                    </span>
                    <span className="terraso-demo-label">Households</span>
                  </div>
                  <div className="terraso-demo-item">
                    <span className="terraso-demo-value">
                      {storyData.literacy_rate || '—'}%
                    </span>
                    <span className="terraso-demo-label">Literacy</span>
                  </div>
                </div>

                {storyData.economy && (
                  <div className="terraso-intro-detail">💼 {storyData.economy}</div>
                )}

                {storyData.temples?.length > 0 && (
                  <div className="terraso-intro-detail">
                    🛕 {storyData.temples.join(' • ')}
                  </div>
                )}

                {storyData.languages?.length > 0 && (
                  <div className="terraso-intro-tags">
                    {storyData.languages.map((lang, i) => (
                      <span key={i} className="terraso-intro-tag">🗣️ {lang}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Story Chapter Panels */}
              {storyChapters.map((chapter, idx) => (
                <div
                  key={idx}
                  className={`terraso-chapter-panel ${visibleChapters.has(idx) ? 'visible' : ''}`}
                  data-chapter-idx={idx}
                  ref={chapterRefCallback}
                >
                  <div className="terraso-chapter-number">
                    Chapter {idx + 1}
                  </div>
                  <h3 className="terraso-chapter-title">{chapter.title}</h3>
                  <p className="terraso-chapter-narrative">{chapter.narrative}</p>

                  {chapter.image_url && (
                    <>
                      <img
                        className="terraso-chapter-image"
                        src={chapter.image_url}
                        alt={chapter.image_caption || chapter.title}
                        loading="lazy"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                      {chapter.image_caption && (
                        <div className="terraso-chapter-image-caption">
                          {chapter.image_caption}
                        </div>
                      )}
                    </>
                  )}

                  {chapter.map_action && (
                    <div className="terraso-map-action-badge">
                      {MAP_ACTION_LABELS[chapter.map_action]?.icon || '🗺️'}{' '}
                      {MAP_ACTION_LABELS[chapter.map_action]?.label || chapter.map_action}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// generateNarrative kept for internal use but no longer displayed as a standalone section
function generateNarrative(results, ciData, swData) {
  if (!results) return '';
  const parts = [];
  const { vegetation, terrain, crop_intensity_change, village_name } = results;
  parts.push(`${village_name || 'The village'} analytics report provides a comprehensive assessment of land use, water resources, and vegetation cover.`);
  if (ciData && ciData.length > 0) {
    const latest = ciData[ciData.length - 1];
    const earliest = ciData[0];
    parts.push(`Over ${ciData.length} fiscal years (${earliest.year} to ${latest.year}), the total cropped area has ${latest.total_cropped_ha > earliest.total_cropped_ha ? 'increased' : 'decreased'} from ${earliest.total_cropped_ha?.toFixed(2)} ha to ${latest.total_cropped_ha?.toFixed(2)} ha.`);
  }
  if (swData && swData.length > 0) {
    const latest = swData[swData.length - 1];
    parts.push(`In the most recent year (${latest.year}), total surface water coverage was ${(latest.total_water_ha ?? 0).toFixed(2)} ha.`);
  }
  if (vegetation) {
    if (vegetation.net_change_ha < 0) {
      parts.push(`The area experienced a net deforestation of ${Math.abs(vegetation.net_change_ha).toFixed(2)} ha.`);
    } else if (vegetation.net_change_ha > 0) {
      parts.push(`The area shows positive reforestation with a net gain of ${vegetation.net_change_ha?.toFixed(2)} ha of forest cover.`);
    }
  }
  return parts.join(' ');
}
