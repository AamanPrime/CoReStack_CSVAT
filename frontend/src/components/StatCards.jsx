import './StatCards.css';

export default function StatCards({ data }) {
    if (!data) return null;

    const stats = [
        {
            label: 'Total Area',
            value: data.total_area_ha?.toLocaleString() || '—',
            unit: 'hectares',
            icon: '🌍',
            color: 'green',
        },
        {
            label: 'Micro-Watersheds',
            value: data.mws_count || '—',
            unit: 'units analyzed',
            icon: '💧',
            color: 'blue',
        },
        {
            label: 'Years of Data',
            value: data.cropping_intensity?.length || 0,
            unit: '2017 — 2025',
            icon: '📊',
            color: 'amber',
        },
        {
            label: 'Deforestation Types',
            value: data.deforestation?.length || 0,
            unit: 'categories tracked',
            icon: '🌳',
            color: 'red',
        },
    ];

    return (
        <div className="stat-grid">
            {stats.map((s, i) => (
                <div key={i} className={`stat-card animate-fade-in-up delay-${i + 1}`}>
                    <div className={`stat-icon-wrapper stat-icon-${s.color}`}>
                        <span>{s.icon}</span>
                    </div>
                    <div className="stat-label">{s.label}</div>
                    <div className={`stat-value stat-value-${s.color}`}>{s.value}</div>
                    <div className="stat-unit">{s.unit}</div>
                </div>
            ))}
        </div>
    );
}
