/**
 * CSVAT — LayerSelector Component.
 * Lets users choose which analytics layers and year range to run.
 */
import React from 'react';

const AVAILABLE_LAYERS = [
  { id: 'cropping_intensity', name: 'Cropping Intensity', icon: '🌱', color: 'var(--accent-green)' },
  { id: 'surface_water', name: 'Surface Water', icon: '💧', color: 'var(--accent-blue)' },
  { id: 'vegetation', name: 'Vegetation & Degradation', icon: '🌳', color: 'var(--accent-teal)' },
];

const YEAR_OPTIONS = [2017, 2018, 2019, 2020, 2021, 2022, 2023];

export default function LayerSelector({ selectedLayers, onLayersChange, selectedYears, onYearsChange }) {
  const toggleLayer = (layerId) => {
    if (selectedLayers.includes(layerId)) {
      onLayersChange(selectedLayers.filter(l => l !== layerId));
    } else {
      onLayersChange([...selectedLayers, layerId]);
    }
  };

  const toggleYear = (year) => {
    if (selectedYears.includes(year)) {
      onYearsChange(selectedYears.filter(y => y !== year));
    } else {
      onYearsChange([...selectedYears, year].sort());
    }
  };

  return (
    <div className="card animate-slide-up">
      <div className="card-header">
        <span className="icon">⚙️</span>
        <h3>Analytics Configuration</h3>
      </div>

      {/* Layer selection */}
      <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'block' }}>
        Select Analytics Layers
      </label>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {AVAILABLE_LAYERS.map(layer => (
          <button
            key={layer.id}
            className={`btn ${selectedLayers.includes(layer.id) ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => toggleLayer(layer.id)}
            style={selectedLayers.includes(layer.id) ? { background: layer.color } : {}}
            id={`layer-toggle-${layer.id}`}
          >
            {layer.icon} {layer.name}
          </button>
        ))}
      </div>

      {/* Year selection */}
      <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'block' }}>
        Select Years
      </label>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {YEAR_OPTIONS.map(year => (
          <button
            key={year}
            className={`btn btn-sm ${selectedYears.includes(year) ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => toggleYear(year)}
            id={`year-toggle-${year}`}
          >
            {year}
          </button>
        ))}
      </div>
    </div>
  );
}
