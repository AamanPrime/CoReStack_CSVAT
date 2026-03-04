import {
    BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend,
} from 'recharts';

/* ── Blues matching the reference MWS report ────────── */
const COLORS = {
    kharif: '#93c5fd',  // light blue  — Kharif (monsoon only)
    kharif_rabi: '#3b82f6',  // medium blue — Kharif + Rabi
    perennial: '#1e3a8a',  // dark blue   — Kharif + Rabi + Zaid (perennial)
};

const DarkTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: 'rgba(15,23,42,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding: '12px 16px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            minWidth: 200,
        }}>
            <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: 8 }}>{label}</p>
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.fill, fontSize: '0.82rem', fontWeight: 500, margin: '3px 0' }}>
                    {p.name}: <strong>{(+p.value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ha</strong>
                </p>
            ))}
        </div>
    );
};

export default function SurfaceWaterChart({ data }) {
    if (!data || data.length === 0) return null;

    const chartData = data.map(d => ({
        year: d.year,
        'Kharif': d.kharif_area_ha ?? 0,
        'Kharif-Rabi': d.rabi_area_ha ?? 0,
        'Kharif-Rabi-Zaid': d.zaid_area_ha ?? 0,
    }));

    return (
        <div className="chart-container animate-fade-in-up delay-3">
            <div className="section-header">
                <div className="icon" style={{ background: 'var(--accent-blue-dim)' }}>💧</div>
                <div>
                    <h2>Surface Water Availability</h2>
                    <p>Seasonal water area during Kharif, Rabi, and Zaid (hectares)</p>
                </div>
            </div>

            <ResponsiveContainer width="100%" height={280}>
                <BarChart
                    data={chartData}
                    margin={{ top: 5, right: 20, left: 0, bottom: 0 }}
                    barCategoryGap="25%"
                    barGap={2}
                >
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
                        tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
                    />
                    <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: '0.8rem', color: '#94a3b8', paddingTop: 8 }} />
                    <Bar dataKey="Kharif" fill={COLORS.kharif} fillOpacity={0.9} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Kharif-Rabi" fill={COLORS.kharif_rabi} fillOpacity={0.9} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Kharif-Rabi-Zaid" fill={COLORS.perennial} fillOpacity={0.9} radius={[2, 2, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>

            <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 10, textAlign: 'center' }}>
                Note: Surface water classes from LULC v3 IndiaSAT. Kharif = monsoon-only water; Kharif-Rabi = year-round seasonal; Kharif-Rabi-Zaid = perennial.
            </p>
        </div>
    );
}
