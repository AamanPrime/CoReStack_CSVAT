import './App.css';
import { useState } from 'react';
import { useAnalytics } from './hooks/useAnalytics';
import { exportAllCSV } from './utils/api';
import Header from './components/Header';
import StatCards from './components/StatCards';
import BoundaryUpload from './components/BoundaryUpload';
import CroppingIntensityChart from './components/CroppingIntensityChart';
import SurfaceWaterChart from './components/SurfaceWaterChart';
import DeforestationChart from './components/DeforestationChart';
import TerrainChart from './components/TerrainChart';
import CropIntensityChangeChart from './components/CropIntensityChangeChart';
import TreeCoverChangeChart from './components/TreeCoverChangeChart';

function App() {
  // Sample (xlsx) data — always loaded on startup
  const { data: sampleData, loading, error } = useAnalytics();

  // Real raster data — populated when user uploads a GeoJSON
  const [rasterData, setRasterData] = useState(null);

  // Active data = raster result if available, otherwise sample
  const data = rasterData || sampleData;
  const isRasterMode = !!rasterData;

  const handleAnalyticsReady = ({ analytics }) => {
    setRasterData(analytics);
  };

  if (loading) {
    return (
      <div className="app-wrapper">
        <Header villageName="Loading..." onExportCSV={() => { }} />
        <main className="main-content">
          <div className="loading-overlay">
            <div className="spinner"></div>
            <p>Loading analytics data…</p>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-wrapper">
        <Header villageName="Error" onExportCSV={() => { }} />
        <main className="main-content">
          <div className="error-banner">
            <span>⚠️</span>
            <div>
              <strong>Failed to load data</strong>
              <p>{error}</p>
              <p style={{ fontSize: '0.8rem', marginTop: 8, color: 'var(--text-dim)' }}>
                Make sure the backend is running:{' '}
                <code>uvicorn app.main:app --reload</code> in the backend/ directory
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      <div className="bg-glow bg-glow-1"></div>
      <div className="bg-glow bg-glow-2"></div>

      <Header
        villageName={data?.village_name}
        onExportCSV={exportAllCSV}
      />

      <main className="main-content">
        <div className="content-container">
          {/* Hero */}
          <section className="hero-section animate-fade-in-up">
            <div className="hero-title-row">
              <h2 className="hero-title">Village Analytics Dashboard</h2>
              {isRasterMode && (
                <span className="live-badge">
                  🛰️ Live Raster Data
                </span>
              )}
              {!isRasterMode && (
                <span className="sample-badge">
                  📊 Sample Dataset
                </span>
              )}
            </div>
            <p className="hero-subtitle">
              {isRasterMode
                ? <>Real analytics computed by clipping <strong>LULC v3 IndiaSAT</strong> raster for <strong>{data?.village_name}</strong></>
                : <>Socio-ecological insights from CoRE Stack datasets for <strong>{data?.village_name}</strong> — upload a boundary for live computation</>
              }
            </p>
          </section>

          {/* Summary Stats */}
          <StatCards data={data} />

          {/* Two-column layout */}
          <div className="dashboard-grid">
            {/* Sidebar: upload + terrain */}
            <div className="dashboard-sidebar">
              <BoundaryUpload onAnalyticsReady={handleAnalyticsReady} />
              <TerrainChart data={data?.terrain} />
            </div>

            {/* Main charts */}
            <div className="dashboard-main">
              <CroppingIntensityChart data={data?.cropping_intensity} />
              <SurfaceWaterChart data={data?.surface_water} />
              <div className="charts-row">
                <DeforestationChart data={data?.deforestation} />
                <CropIntensityChangeChart data={data?.crop_intensity_change} />
              </div>
              <TreeCoverChangeChart data={data?.tree_cover_change} />
            </div>
          </div>

          {/* Data Story */}
          <section className="data-story-footer glass-card animate-fade-in-up delay-4">
            <div className="section-header">
              <div className="icon" style={{ background: 'var(--accent-purple-dim)' }}>📖</div>
              <div>
                <h2>Data Story Summary</h2>
                <p>
                  {isRasterMode
                    ? 'Generated from real LULC raster clipping'
                    : 'Auto-generated narrative from sample analytics pipeline'}
                </p>
              </div>
            </div>
            <div className="story-content">
              {isRasterMode && (
                <p>
                  🛰️ <strong>Real raster analytics</strong> — computed by clipping the{' '}
                  <strong>LULC v3 IndiaSAT ({data?.tiffs_used?.join(', ')})</strong> pan-India raster
                  at 10m resolution using your uploaded boundary.
                </p>
              )}
              <p>
                <strong>{data?.village_name}</strong> covers a total area of{' '}
                <strong>{data?.total_area_ha?.toLocaleString()} hectares</strong>.
              </p>
              {data?.cropping_intensity?.length > 0 && (
                <p>
                  Cropping intensity analysis for{' '}
                  {data.cropping_intensity.map(d => d.year).join(', ')} shows single-cropped area of{' '}
                  <strong>{data.cropping_intensity[0]?.single_crop_area_ha?.toLocaleString()} ha</strong>,
                  double-cropped <strong>{data.cropping_intensity[0]?.double_crop_area_ha?.toLocaleString()} ha</strong>,
                  and triple-cropped <strong>{data.cropping_intensity[0]?.triple_crop_area_ha?.toLocaleString()} ha</strong>.
                </p>
              )}
              {data?.surface_water?.length > 0 && (
                <p>
                  Surface water analysis reveals{' '}
                  <strong>{data.surface_water[0]?.kharif_area_ha?.toLocaleString()} ha</strong> of Kharif
                  (monsoon) water,{' '}
                  <strong>{data.surface_water[0]?.rabi_area_ha?.toLocaleString()} ha</strong> Rabi (winter),
                  and <strong>{data.surface_water[0]?.zaid_area_ha?.toLocaleString()} ha</strong> perennial
                  across the selected area.
                </p>
              )}
              <p>
                This report was generated by CSVAT — the CoRE Stack Village Analytics Tool.
              </p>
            </div>
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <p>CSVAT v0.1.0 — CoRE Stack Village Analytics Tool</p>
        <p>Built on CoRE Stack datasets • CC BY 4.0</p>
      </footer>
    </div>
  );
}

export default App;
