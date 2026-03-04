import {
    PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

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
        }}>
            <p style={{ color: '#f1f5f9', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                {d.category}
            </p>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                <strong>{d.area_percent.toFixed(1)}%</strong> of total area
            </p>
        </div>
    );
};

export default function TerrainChart({ data }) {
    if (!data || data.length === 0) return null;

    const filtered = data.filter(d => d.area_percent > 0);

    return (
        <div className="chart-container animate-fade-in-up delay-3">
            <div className="section-header">
                <div className="icon" style={{ background: 'var(--accent-purple-dim)' }}>⛰️</div>
                <div>
                    <h2>Terrain Composition</h2>
                    <p>Distribution of terrain types across the analysis area</p>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                    <Pie
                        data={filtered}
                        dataKey="area_percent"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        outerRadius={110}
                        innerRadius={60}
                        paddingAngle={2}
                        stroke="rgba(0,0,0,0.3)"
                        strokeWidth={1}
                    >
                        {filtered.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.9} />
                        ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                        wrapperStyle={{ fontSize: '0.75rem', color: '#94a3b8' }}
                        formatter={(value) => <span style={{ color: '#94a3b8' }}>{value}</span>}
                    />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
}
