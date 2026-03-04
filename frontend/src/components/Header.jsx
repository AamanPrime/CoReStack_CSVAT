import './Header.css';

export default function Header({ villageName, onExportCSV }) {
    return (
        <header className="app-header">
            <div className="header-inner">
                <div className="header-brand">
                    <div className="logo-mark">
                        <span className="logo-icon">◈</span>
                    </div>
                    <div className="brand-text">
                        <h1>CSVAT</h1>
                        <p className="brand-sub">CoRE Stack Village Analytics Tool</p>
                    </div>
                </div>

                <div className="header-center">
                    <div className="village-badge">
                        <span className="badge-dot"></span>
                        <span className="badge-text">{villageName || 'Loading...'}</span>
                    </div>
                </div>

                <div className="header-actions">
                    <button className="btn btn-secondary" onClick={onExportCSV}>
                        📥 Export CSV
                    </button>
                </div>
            </div>
        </header>
    );
}
