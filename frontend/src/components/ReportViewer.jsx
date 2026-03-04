/**
 * CSVAT — ReportViewer Component.
 * Renders the Data Story: charts, stats, tables, and narrative per SRS/HLD/ADD spec.
 *
 * Sections:
 *  1. Report Header (Village info + data source)
 *  2. Summary Stats Cards (MWS count, data source, year range)
 *  3. Cropping Intensity Trends (stacked bar + table)
 *  4. Surface Water — Kharif / Rabi / Zaid (bar + table)
 *  5. Vegetation & Deforestation (stats + transitions horizontal bar)
 *  6. Cropping Intensity Change Transitions (horizontal bar)
 *  7. Terrain Composition (doughnut/bar)
 *  8. Waterbodies
 *  9. Data Story Narrative
 */
import React from 'react';
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

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
);

// Chart.js defaults for dark theme
ChartJS.defaults.color = '#94a3b8';
ChartJS.defaults.borderColor = 'rgba(148,163,184,0.12)';

export default function ReportViewer({ results }) {
  if (!results) return null;

  const {
    cropping_intensity, surface_water, vegetation, waterbodies,
    village_name, state, district, tehsil, data_source,
    mws_count, terrain, crop_intensity_change,
  } = results;

  // Normalize cropping/water data arrays
  const ciData = Array.isArray(cropping_intensity?.data)
    ? cropping_intensity.data
    : Array.isArray(cropping_intensity) ? cropping_intensity : null;

  const swData = Array.isArray(surface_water?.data)
    ? surface_water.data
    : Array.isArray(surface_water) ? surface_water : null;

  // Generate data story narrative
  const narrative = generateNarrative(results, ciData, swData);

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
            background: data_source.includes('GEE') ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.12)',
            color: data_source.includes('GEE') ? '#22c55e' : '#3b82f6',
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
          {terrain?.total_area_ha != null && (
            <div className="stat-card stat-amber">
              <div className="value">{terrain.total_area_ha.toFixed(2)}</div>
              <div className="label">Total Area (ha)</div>
            </div>
          )}
          {vegetation && (
            <div className="stat-card stat-red">
              <div className="value">{vegetation.transitions?.filter(t => t.to !== 'Forest' && t.area_ha > 0).length || 0}</div>
              <div className="label">Deforestation Types</div>
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
                <th>Intensity Index</th>
              </tr>
            </thead>
            <tbody>
              {ciData.map(d => (
                <tr key={d.year}>
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

          <table className="data-table">
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
                <tr key={d.year}>
                  <td>{d.year}</td>
                  <td>{(d.kharif_ha ?? d.seasonal_monsoon_ha ?? 0).toFixed(2)}</td>
                  <td>{(d.rabi_ha ?? d.seasonal_winter_ha ?? 0).toFixed(2)}</td>
                  <td>{(d.zaid_ha ?? d.perennial_ha ?? 0).toFixed(2)}</td>
                  <td>{(d.total_water_ha ?? 0).toFixed(2)}</td>
                </tr>
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

      {/* ─── Vegetation & Deforestation ─── */}
      {vegetation && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">🌳</span>
            <h3>Vegetation & Deforestation Analysis</h3>
          </div>

          <div className="stats-grid">
            <div className="stat-card stat-green">
              <div className="value">{vegetation.tree_cover_gain_ha?.toFixed(2) ?? '—'}</div>
              <div className="label">Afforestation (ha)</div>
            </div>
            <div className="stat-card stat-red">
              <div className="value">{vegetation.tree_cover_loss_ha?.toFixed(2) ?? '—'}</div>
              <div className="label">Deforestation (ha)</div>
            </div>
            <div className={`stat-card ${(vegetation.net_change_ha ?? 0) >= 0 ? 'stat-green' : 'stat-red'}`}>
              <div className="value">{vegetation.net_change_ha?.toFixed(2) ?? '—'}</div>
              <div className="label">Net Change (ha)</div>
            </div>
            <div className="stat-card stat-amber">
              <div className="value">{vegetation.degraded_land_ha?.toFixed(2) ?? '—'}</div>
              <div className="label">Degraded Land (ha)</div>
            </div>
          </div>

          {/* Vegetation Transitions (SRS: Forest→Farm, Forest→Barren, etc.) */}
          {vegetation.transitions && vegetation.transitions.length > 0 && (
            <>
              <h4 style={{ color: 'var(--text-secondary)', margin: '1.5rem 0 0.75rem', fontSize: '1rem' }}>
                Deforestation Transitions
              </h4>
              <div className="chart-wrapper" style={{ height: '280px' }}>
                <Bar
                  data={{
                    labels: vegetation.transitions
                      .filter(t => t.to !== 'Forest')
                      .map(t => `${t.from} → ${t.to}`),
                    datasets: [{
                      label: 'Area (ha)',
                      data: vegetation.transitions
                        .filter(t => t.to !== 'Forest')
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

              <table className="data-table">
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
                      <td>{t.from}</td>
                      <td>{t.to}</td>
                      <td>{t.area_ha?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {vegetation.yearly_data && vegetation.yearly_data.length > 0 && (
            <div className="chart-wrapper" style={{ marginTop: '1.5rem' }}>
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
            Vegetation analysis compares land cover between the study period,
            tracking how forest land transitions to other use types.
            {vegetation.net_change_ha < 0 && ` The village experienced a net loss of ${Math.abs(vegetation.net_change_ha).toFixed(2)} ha of forest cover.`}
            {vegetation.net_change_ha >= 0 && ` The village shows a net gain of ${vegetation.net_change_ha?.toFixed(2)} ha of forest cover.`}
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
                labels: crop_intensity_change
                  .filter(t => !t.label.includes('Total'))
                  .map(t => t.label),
                datasets: [{
                  label: 'Area (ha)',
                  data: crop_intensity_change
                    .filter(t => !t.label.includes('Total'))
                    .map(t => t.area_ha),
                  backgroundColor: crop_intensity_change
                    .filter(t => !t.label.includes('Total'))
                    .map(t => {
                      if (t.label.includes('Single To Double') || t.label.includes('Double To Triple') || t.label.includes('Single To Triple'))
                        return 'rgba(34, 197, 94, 0.7)'; // improvement
                      if (t.label.includes('Double To Single') || t.label.includes('Triple To Double') || t.label.includes('Triple To Single'))
                        return 'rgba(239, 68, 68, 0.7)'; // decline
                      return 'rgba(59, 130, 246, 0.7)'; // stable
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

          <table className="data-table">
            <thead>
              <tr>
                <th>Transition</th>
                <th>Area (ha)</th>
                <th>Direction</th>
              </tr>
            </thead>
            <tbody>
              {crop_intensity_change.map((t, idx) => (
                <tr key={idx}>
                  <td>{t.label}</td>
                  <td>{t.area_ha?.toFixed(2)}</td>
                  <td>
                    {t.label.includes('Total') ? '—' :
                      (t.label.includes('Single To Double') || t.label.includes('Double To Triple') || t.label.includes('Single To Triple'))
                        ? '↑ Improvement'
                        : (t.label.includes('Double To Single') || t.label.includes('Triple To Double') || t.label.includes('Triple To Single'))
                          ? '↓ Decline'
                          : '→ Stable'
                    }
                  </td>
                </tr>
              ))}
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
      {terrain && terrain.total_area_ha > 0 && (
        <div className="card animate-slide-up">
          <div className="card-header">
            <span className="icon">⛰️</span>
            <h3>Terrain Composition</h3>
          </div>

          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ width: '280px', height: '280px' }}>
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
                    borderColor: '#0f172a',
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: true,
                  plugins: {
                    legend: { position: 'right' },
                  },
                }}
              />
            </div>
            <table className="data-table" style={{ flex: 1 }}>
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

          <div className="narrative">
            Terrain composition analysis classifies the village area into five terrain types:
            hill slope, plain, ridge, slopy, and valley terrain. This data helps understand
            the topographical distribution for watershed planning.
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

      {/* ─── Data Story Narrative ─── */}
      {narrative && (
        <div className="card animate-slide-up" style={{ borderLeft: '4px solid var(--primary)' }}>
          <div className="card-header">
            <span className="icon">📖</span>
            <h3>Data Story Summary</h3>
          </div>
          <div className="narrative" style={{ fontSize: '1rem', lineHeight: '1.8' }}>
            {narrative}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Generate a comprehensive data story narrative from analytics results.
 */
function generateNarrative(results, ciData, swData) {
  const parts = [];
  const { vegetation, terrain, crop_intensity_change, village_name } = results;

  parts.push(`${village_name || 'The village'} analytics report provides a comprehensive assessment of land use, water resources, and vegetation cover.`);

  // Cropping summary
  if (ciData && ciData.length > 0) {
    const latest = ciData[ciData.length - 1];
    const earliest = ciData[0];
    parts.push(
      `Over ${ciData.length} fiscal years (${earliest.year} to ${latest.year}), ` +
      `the total cropped area has ${latest.total_cropped_ha > earliest.total_cropped_ha ? 'increased' : 'decreased'} ` +
      `from ${earliest.total_cropped_ha?.toFixed(2)} ha to ${latest.total_cropped_ha?.toFixed(2)} ha.`
    );
  }

  // Water summary
  if (swData && swData.length > 0) {
    const latest = swData[swData.length - 1];
    parts.push(
      `In the most recent year (${latest.year}), total surface water coverage was ${(latest.total_water_ha ?? 0).toFixed(2)} ha.`
    );
  }

  // Vegetation summary
  if (vegetation) {
    if (vegetation.net_change_ha < 0) {
      parts.push(
        `The area experienced a net deforestation of ${Math.abs(vegetation.net_change_ha).toFixed(2)} ha, ` +
        `with ${vegetation.tree_cover_loss_ha?.toFixed(2)} ha of forest loss and ${vegetation.tree_cover_gain_ha?.toFixed(2)} ha of afforestation.`
      );
    } else if (vegetation.net_change_ha > 0) {
      parts.push(
        `The area shows positive reforestation with a net gain of ${vegetation.net_change_ha?.toFixed(2)} ha of forest cover.`
      );
    }
  }

  // Terrain summary
  if (terrain && terrain.total_area_ha > 0) {
    const dominant = Object.entries(terrain)
      .filter(([k]) => k !== 'total_area_ha')
      .sort(([, a], [, b]) => b - a)[0];
    if (dominant) {
      const pct = ((dominant[1] / terrain.total_area_ha) * 100).toFixed(1);
      parts.push(
        `The terrain is predominantly ${dominant[0].replace(/_/g, ' ')} (${pct}% of ${terrain.total_area_ha.toFixed(2)} ha total area).`
      );
    }
  }

  // Crop intensity change summary
  if (crop_intensity_change && crop_intensity_change.length > 0) {
    const improvements = crop_intensity_change.filter(t =>
      t.label.includes('Single To Double') || t.label.includes('Double To Triple') || t.label.includes('Single To Triple')
    );
    const totalImprovement = improvements.reduce((sum, t) => sum + (t.area_ha || 0), 0);
    if (totalImprovement > 0) {
      parts.push(
        `Cropping intensity improvements (single→double, double→triple, etc.) cover ${totalImprovement.toFixed(2)} ha, ` +
        `indicating agricultural intensification in the region.`
      );
    }
  }

  return parts.join(' ');
}
