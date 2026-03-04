import {
    BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend, Cell,
} from 'recharts';

const TRANSITION_COLORS = {
    'Built Up': '#ef4444',
    'Barren Land': '#9ca3af',
    'Crops': '#fbbf24',
    'Shrubs And Scrubs': '#a78bfa',
    'Single Kharif Crop': '#22c55e',
    'Double Cropping': '#f97316',
    'Triple Cropping': '#92400e',
    'default': '#64748b',
};

const DarkTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
        <div style={{
            background: 'rgba(15,23,42,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding: '12px 16px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            minWidth: 180,
        }}>
            <p style={{ color: '#f1f5f9', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                Trees → {d?.to_label}
            </p>
            <p style={{ color: '#94a3b8', fontSize: '0.82rem' }}>
                <strong>{d?.area_ha?.toLocaleString()}</strong> hectares lost
            </p>
        </div>
    );
};

export default function TreeCoverChangeChart({ data }) {
    if (!data) return null;

    const hasTransitions = data.transitions && data.transitions.length > 0;
    const isSnapshot = data.year_from === data.year_to;

    return (
        <div className="chart-container animate-fade-in-up delay-3">
            <div className="section-header">
                <div className="icon" style={{ background: 'var(--accent-red-dim)' }}>🌳</div>
                <div>
                    <h2>Tree Cover Change</h2>
                    <p>
                        {isSnapshot
                            ? `Current tree cover snapshot (${data.year_from})`
                            : `Tree cover transitions from ${data.year_from} to ${data.year_to}`
                        }
                    </p>
                </div>
            </div>

            {/* Summary stats */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{
                    background: 'var(--bg-glass)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 18px',
                    flex: '1 1 140px',
                }}>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Tree area ({data.year_from})
                    </p>
                    <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#4ade80', fontFamily: 'var(--font-display)' }}>
                        {data.tree_area_from_ha?.toLocaleString()} ha
                    </p>
                </div>
                <div style={{
                    background: 'var(--bg-glass)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 18px',
                    flex: '1 1 140px',
                }}>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Tree area ({data.year_to})
                    </p>
                    <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#4ade80', fontFamily: 'var(--font-display)' }}>
                        {data.tree_area_to_ha?.toLocaleString()} ha
                    </p>
                </div>
                {!isSnapshot && (
                    <>
                        <div style={{
                            background: 'var(--bg-glass)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '12px 18px',
                            flex: '1 1 140px',
                        }}>
                            <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                Net Change
                            </p>
                            <p style={{
                                fontSize: '1.3rem', fontWeight: 700, fontFamily: 'var(--font-display)',
                                color: data.net_change_ha >= 0 ? '#4ade80' : '#ef4444',
                            }}>
                                {data.net_change_ha >= 0 ? '+' : ''}{data.net_change_ha?.toLocaleString()} ha
                            </p>
                        </div>
                        <div style={{
                            background: 'var(--bg-glass)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '12px 18px',
                            flex: '1 1 140px',
                        }}>
                            <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                Degraded
                            </p>
                            <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#ef4444', fontFamily: 'var(--font-display)' }}>
                                {data.degraded_ha?.toLocaleString()} ha
                            </p>
                        </div>
                    </>
                )}
            </div>

            {/* Transition bar chart */}
            {hasTransitions && (
                <>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Where tree cover was lost (Trees → ...):
                    </p>
                    <ResponsiveContainer width="100%" height={Math.max(150, data.transitions.length * 40)}>
                        <BarChart
                            data={data.transitions}
                            layout="vertical"
                            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                            <XAxis
                                type="number"
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                tickLine={false}
                                tickFormatter={v => `${v} ha`}
                            />
                            <YAxis
                                type="category"
                                dataKey="to_label"
                                width={130}
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                tickLine={false}
                            />
                            <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                            <Bar dataKey="area_ha" radius={[0, 4, 4, 0]}>
                                {data.transitions.map((entry, i) => (
                                    <Cell key={i} fill={TRANSITION_COLORS[entry.to_label] || TRANSITION_COLORS.default} fillOpacity={0.85} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </>
            )}

            {/* Note for single-year */}
            {isSnapshot && data.note && (
                <div style={{
                    marginTop: 12, padding: '10px 14px',
                    background: 'var(--accent-amber-dim)', border: '1px solid rgba(245,158,11,0.2)',
                    borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--accent-amber)',
                }}>
                    ⚠️ {data.note}
                </div>
            )}
        </div>
    );
}
