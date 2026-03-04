import { useState } from 'react';
import {
    BarChart, Bar,
    LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend,
    ReferenceLine,
} from 'recharts';

/* ── Colours exactly matching the KYL / MWS reference ─ */
const COLORS = {
    single: '#4ade80',  // green
    double: '#fb923c',  // orange
    triple: '#92400e',  // dark brown-red
    uncropped: '#9ca3af',  // grey
};

/* ── Dark tooltip ─────────────────────────────────────── */
const DarkTooltip = ({ active, payload, label, suffix = '' }) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: 'rgba(15,23,42,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding: '12px 16px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            minWidth: 190,
        }}>
            <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: 8 }}>{label}</p>
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.color || p.fill, fontSize: '0.82rem', fontWeight: 500, margin: '3px 0' }}>
                    {p.name}: <strong>{(+p.value).toFixed(1)}{suffix}</strong>
                </p>
            ))}
        </div>
    );
};

/* ── CSV download ─────────────────────────────────────── */
function downloadCSV(data) {
    const headers = ['Year', 'Single Crop (ha)', 'Double Crop (ha)', 'Triple Crop (ha)', 'Cropping Intensity Index', 'Double Crop (%)'];
    const rows = data.map(d => {
        const s = d.single_crop_area_ha ?? 0;
        const db = d.double_crop_area_ha ?? 0;
        const t = d.triple_crop_area_ha ?? 0;
        const total = s + db + t;
        const doublePct = total > 0 ? ((db / total) * 100).toFixed(2) : 0;
        return [d.year, s, db, t, d.cropping_intensity ?? 0, doublePct];
    });
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cropping_intensity.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/* ── Main component ───────────────────────────────────── */
export default function CroppingIntensityChart({ data }) {
    const [showDoubleLine, setShowDoubleLine] = useState(true);

    if (!data || data.length === 0) return null;

    /* Percentage stacked bar data */
    const barData = data.map(d => {
        const s = d.single_crop_area_ha ?? 0;
        const db = d.double_crop_area_ha ?? 0;
        const t = d.triple_crop_area_ha ?? 0;
        const total = s + db + t;
        // "Uncropped" is whatever's left vs total MWS area (we don't have it, so skip or estimate)
        const singlePct = total > 0 ? (s / total) * 100 : 0;
        const doublePct = total > 0 ? (db / total) * 100 : 0;
        const triplePct = total > 0 ? (t / total) * 100 : 0;
        return {
            year: d.year,
            'Single Cropping': +singlePct.toFixed(2),
            'Double Cropping': +doublePct.toFixed(2),
            'Triple Cropping': +triplePct.toFixed(2),
        };
    });

    /* Double-crop % line data */
    const lineData = data.map(d => {
        const s = d.single_crop_area_ha ?? 0;
        const db = d.double_crop_area_ha ?? 0;
        const t = d.triple_crop_area_ha ?? 0;
        const total = s + db + t;
        return {
            year: d.year,
            'Double Cropped (%)': total > 0 ? +((db / total) * 100).toFixed(2) : 0,
        };
    });

    // Average double-crop % for reference line
    const avgDouble = lineData.length
        ? lineData.reduce((s, d) => s + d['Double Cropped (%)'], 0) / lineData.length
        : 0;

    const chartH = 270;

    return (
        <div className="chart-container animate-fade-in-up delay-2">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div className="section-header" style={{ marginBottom: 0 }}>
                    <div className="icon" style={{ background: 'var(--accent-green-dim)' }}>🌾</div>
                    <div>
                        <h2>Cropping Intensity</h2>
                        <p>Single / Double / Triple cropping by year</p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        <input
                            type="checkbox"
                            checked={showDoubleLine}
                            onChange={e => setShowDoubleLine(e.target.checked)}
                            style={{ accentColor: '#4ade80' }}
                        />
                        Show double-crop trend
                    </label>
                    <button
                        className="btn btn-secondary"
                        onClick={() => downloadCSV(data)}
                        style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                    >
                        📥 CSV
                    </button>
                </div>
            </div>

            {/* ── Stacked Bar Chart — % composition ── */}
            <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Percentage of total cropland
            </p>
            <ResponsiveContainer width="100%" height={chartH}>
                <BarChart data={barData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }} barCategoryGap="28%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                        dataKey="year"
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        tickLine={false}
                    />
                    <YAxis
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        tickLine={false}
                        domain={[0, 100]}
                        tickFormatter={v => `${v}%`}
                    />
                    <Tooltip content={<DarkTooltip suffix="%" />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: '0.8rem', color: '#94a3b8', paddingTop: 8 }} />
                    <Bar stackId="a" dataKey="Single Cropping" fill={COLORS.single} fillOpacity={0.9} />
                    <Bar stackId="a" dataKey="Double Cropping" fill={COLORS.double} fillOpacity={0.9} />
                    <Bar stackId="a" dataKey="Triple Cropping" fill={COLORS.triple} fillOpacity={0.9} radius={[3, 3, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>

            {/* ── Line Chart — Double-crop % trend ── */}
            {showDoubleLine && (
                <div style={{ marginTop: 24 }}>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Average % of double-cropped area
                    </p>
                    <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={lineData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis
                                dataKey="year"
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                tickLine={false}
                            />
                            <YAxis
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                tickLine={false}
                                tickFormatter={v => `${v}%`}
                            />
                            <Tooltip content={<DarkTooltip suffix="%" />} />
                            <Legend wrapperStyle={{ fontSize: '0.8rem', color: '#94a3b8' }} />
                            {/* Average reference line */}
                            <ReferenceLine
                                y={avgDouble}
                                stroke="rgba(74,222,128,0.35)"
                                strokeDasharray="6 3"
                                label={{ value: `Avg ${avgDouble.toFixed(1)}%`, position: 'insideTopRight', fill: '#4ade80', fontSize: 10 }}
                            />
                            <Line
                                type="monotone"
                                dataKey="Double Cropped (%)"
                                stroke={COLORS.single}
                                strokeWidth={2}
                                strokeDasharray="5 4"
                                dot={{ r: 5, fill: COLORS.single, stroke: 'rgba(15,23,42,0.9)', strokeWidth: 2 }}
                                activeDot={{ r: 7 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
