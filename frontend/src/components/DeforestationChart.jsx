import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell
} from 'recharts';

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899'];

const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload[0]) return null;
    const d = payload[0].payload;
    return (
        <div style={{
            background: 'rgba(17, 24, 39, 0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px',
            padding: '14px 18px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            maxWidth: 250,
        }}>
            <p style={{ color: '#f1f5f9', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                {d.category}
            </p>
            <p style={{ color: '#ef4444', fontSize: '0.9rem' }}>
                <strong>{d.area_ha.toLocaleString()}</strong> hectares
            </p>
        </div>
    );
};

export default function DeforestationChart({ data }) {
    if (!data || data.length === 0) return null;

    // Sort by area descending and take top entries
    const sorted = [...data]
        .filter(d => d.area_ha > 0)
        .sort((a, b) => b.area_ha - a.area_ha)
        .slice(0, 8);

    return (
        <div className="chart-container animate-fade-in-up delay-4">
            <div className="section-header">
                <div className="icon" style={{ background: 'var(--accent-red-dim)' }}>🌳</div>
                <div>
                    <h2>Vegetation Change & Degradation</h2>
                    <p>Land cover transition areas (2017–2022)</p>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={360}>
                <BarChart
                    data={sorted}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis
                        type="number"
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        tickLine={false}
                    />
                    <YAxis
                        type="category"
                        dataKey="category"
                        tick={{ fill: '#94a3b8', fontSize: 10 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        tickLine={false}
                        width={160}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="area_ha" radius={[0, 6, 6, 0]} barSize={20}>
                        {sorted.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
