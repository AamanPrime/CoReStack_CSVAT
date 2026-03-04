/**
 * CSVAT — ReportViewer Component.
 * Renders the Data Story: charts, stats, tables, and narrative per HLD spec.
 */
import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
);

// Chart.js defaults for dark theme
ChartJS.defaults.color = '#94a3b8';
ChartJS.defaults.borderColor = 'rgba(148,163,184,0.12)';

export default function ReportViewer({ results }) {
  if (!results) return null;

  const { cropping_intensity, surface_water, vegetation, waterbodies, village_name, state, district, tehsil, data_source } = results;

  return (
    <div className="stagger">
      {/* ─── Report Header ─── */}
      <div className="card animate-slide-up" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{
          fontSize: '1.8rem', fontWeight: 700,
          background: 'linear-gradient(135deg, #22c55e, #14b8a6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          🌾 Village Analytics Report
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          {village_name} — {district}, {state}
        </p>
        {data_source && (
          <div style={{
            marginTop: '0.75rem', display: 'inline-block',
            background: data_source.includes('GEE') ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
            color: data_source.includes('GEE') ? '#22c55e' : '#f59e0b',
            padding: '0.4rem 1rem', borderRadius: '8px',
            fontSize: '0.8rem', fontWeight: 600,
          }}>
            📡 {data_source}
          </div>
        )}
        <div className="boundary-info" style={{ marginTop: '1rem' }}>
          <div className="boundary-info-item">
            <span className="label">State</span>
            <span className="value">{state}</span>
          </div>
          <div className="boundary-info-item">
            <span className="label">District</span>
            <span className="value">{district}</span>
          </div>
          <div className="boundary-info-item">
            <span className="label">Tehsil</span>
            <span className="value">{tehsil}</span>
          </div>
        </div>
      </div>

      {/* ─── Cropping Intensity ─── */}
      {cropping_intensity?.data && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">🌱</span>
            <h3>Cropping Intensity Trends</h3>
          </div>

          <div className="chart-wrapper">
            <Bar
              data={{
                labels: cropping_intensity.data.map(d => d.year),
                datasets: [
                  {
                    label: 'Single Crop (ha)',
                    data: cropping_intensity.data.map(d => d.single_crop_ha),
                    backgroundColor: 'rgba(34, 197, 94, 0.7)',
                    borderRadius: 6,
                  },
                  {
                    label: 'Double Crop (ha)',
                    data: cropping_intensity.data.map(d => d.double_crop_ha),
                    backgroundColor: 'rgba(59, 130, 246, 0.7)',
                    borderRadius: 6,
                  },
                  {
                    label: 'Triple Crop (ha)',
                    data: cropping_intensity.data.map(d => d.triple_crop_ha),
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
                  y: {
                    stacked: true,
                    title: { display: true, text: 'Area (Hectares)' },
                  },
                },
                plugins: { legend: { position: 'top' } },
              }}
            />
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Single Crop (ha)</th>
                <th>Double Crop (ha)</th>
                <th>Triple Crop (ha)</th>
                <th>Total (ha)</th>
              </tr>
            </thead>
            <tbody>
              {cropping_intensity.data.map(d => (
                <tr key={d.year}>
                  <td>{d.year}</td>
                  <td>{d.single_crop_ha}</td>
                  <td>{d.double_crop_ha}</td>
                  <td>{d.triple_crop_ha}</td>
                  <td>{d.total_cropped_ha}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="narrative">
            Cropping intensity analysis shows how agricultural land use patterns have changed within the village boundary.
            Single-crop areas are declining as farmers adopt more intensive cropping practices,
            with double and triple crop areas showing an increasing trend.
          </div>
        </div>
      )}

      {/* ─── Surface Water ─── */}
      {surface_water?.data && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">💧</span>
            <h3>Seasonal Surface Water Availability</h3>
          </div>

          <div className="chart-wrapper">
            <Bar
              data={{
                labels: surface_water.data.map(d => d.year),
                datasets: [
                  {
                    label: 'Perennial (ha)',
                    data: surface_water.data.map(d => d.perennial_ha),
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderRadius: 6,
                  },
                  {
                    label: 'Monsoon (ha)',
                    data: surface_water.data.map(d => d.seasonal_monsoon_ha),
                    backgroundColor: 'rgba(20, 184, 166, 0.7)',
                    borderRadius: 6,
                  },
                  {
                    label: 'Winter (ha)',
                    data: surface_water.data.map(d => d.seasonal_winter_ha),
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

          <table className="data-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Perennial (ha)</th>
                <th>Monsoon (ha)</th>
                <th>Winter (ha)</th>
                <th>Total (ha)</th>
              </tr>
            </thead>
            <tbody>
              {surface_water.data.map(d => (
                <tr key={d.year}>
                  <td>{d.year}</td>
                  <td>{d.perennial_ha}</td>
                  <td>{d.seasonal_monsoon_ha}</td>
                  <td>{d.seasonal_winter_ha}</td>
                  <td>{d.total_water_ha}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="narrative">
            Surface water analysis tracks water body availability across seasons.
            Perennial water sources remain relatively stable, while monsoon and winter
            seasonal water availability shows natural fluctuation patterns.
          </div>
        </div>
      )}

      {/* ─── Vegetation & Degradation ─── */}
      {vegetation && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">🌳</span>
            <h3>Vegetation & Degradation Analysis</h3>
          </div>

          <div className="stats-grid">
            <div className="stat-card stat-blue">
              <div className="value">{vegetation.tree_cover_start_ha}</div>
              <div className="label">Tree Cover {vegetation.start_year} (ha)</div>
            </div>
            <div className="stat-card stat-blue">
              <div className="value">{vegetation.tree_cover_end_ha}</div>
              <div className="label">Tree Cover {vegetation.end_year} (ha)</div>
            </div>
            <div className={`stat-card ${vegetation.net_change_ha >= 0 ? 'stat-green' : 'stat-red'}`}>
              <div className="value">{vegetation.net_change_ha}</div>
              <div className="label">Net Change (ha)</div>
            </div>
            <div className="stat-card stat-amber">
              <div className="value">{vegetation.degraded_land_ha}</div>
              <div className="label">Degraded Land (ha)</div>
            </div>
          </div>

          {vegetation.yearly_data && (
            <div className="chart-wrapper">
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
          )}

          <div className="narrative">
            Between {vegetation.start_year} and {vegetation.end_year}, the village
            experienced a net {vegetation.net_change_ha < 0 ? 'loss' : 'gain'} of{' '}
            {Math.abs(vegetation.net_change_ha)} hectares of tree cover.
            An estimated {vegetation.degraded_land_ha} hectares are classified as
            degraded land based on vegetation transition analysis.
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
            <div className="stat-card stat-blue">
              <div className="value">{waterbodies.count}</div>
              <div className="label">Total Waterbodies</div>
            </div>
            <div className="stat-card stat-blue">
              <div className="value">
                {waterbodies.waterbodies?.reduce((sum, wb) => sum + (wb.area_ha || 0), 0).toFixed(2)}
              </div>
              <div className="label">Total Area (ha)</div>
            </div>
          </div>

          <table className="data-table">
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
                  <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{wb.uid}</td>
                  <td>{wb.name}</td>
                  <td>{wb.area_ha}</td>
                  <td>{wb.type}</td>
                </tr>
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
    </div>
  );
}
