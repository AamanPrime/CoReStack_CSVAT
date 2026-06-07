/**
 * CSVAT — Main App Component.
 * CoRE Stack Landscape Explorer style layout.
 * Navbar + full-screen map with right sidebar.
 */
import React from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Methodology from './pages/Methodology';

export default function App() {
  return (
    <Router>
      <div id="app-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* Navbar */}
        <nav className="navbar">
          <Link to="/" className="navbar-brand" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="logo-circles">
              <span className="logo-circle green"></span>
              <span className="logo-circle blue"></span>
              <span className="logo-circle amber"></span>
            </div>
            <h1>CSVAT</h1>
          </Link>
          <div className="navbar-status" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link to="/methodology" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>
              Methodology
            </Link>

          </div>
        </nav>

        {/* Main Content */}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/methodology" element={<Methodology />} />
        </Routes>
      </div>
    </Router>
  );
}
