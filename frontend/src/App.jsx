/**
 * CSVAT — Main App Component.
 * Root component with Navbar, routing, and footer.
 */
import React from 'react';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    <div className="app-container">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-brand">
          <span className="logo">🌍</span>
          <div>
            <h1>CSVAT</h1>
            <div className="subtitle">CoRE Stack Village Analytics Tool</div>
          </div>
        </div>
        <div className="navbar-status">
          <span className="status-dot"></span>
          <span>System Online</span>
        </div>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        <Dashboard />
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>CSVAT v1.0 — CoRE Stack Village Analytics Tool</p>
        <p style={{ marginTop: '0.25rem' }}>
          Built with FastAPI, React, Chart.js & Leaflet
        </p>
      </footer>
    </div>
  );
}
