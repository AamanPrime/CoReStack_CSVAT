/**
 * CSVAT — Main App Component.
 * CoRE Stack Landscape Explorer style layout.
 * Navbar + full-screen map with right sidebar.
 */
import React from 'react';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    <div id="app-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-brand">
          <div className="logo-circles">
            <span className="logo-circle green"></span>
            <span className="logo-circle blue"></span>
            <span className="logo-circle amber"></span>
          </div>
          <h1>CSVAT</h1>
        </div>

      </nav>

      {/* Main Content */}
      <Dashboard />
    </div>
  );
}
