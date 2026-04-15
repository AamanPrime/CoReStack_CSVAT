import React, { useState, useCallback, useRef, useEffect } from 'react';
import { computeAreaHectares, usePlacesAutocomplete } from './GoogleMapsIntegration';
import { getActiveLocations, getVillageGeometries } from '../services/api';

export default function BoundarySelector({ onBoundarySelect, onMapUpdate }) {
  const [activeTab, setActiveTab] = useState('corestack');

  // Reset everything when switching tabs
  const handleTabChange = (tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    // Clear boundary so dashboard hides stale analytics buttons
    onBoundarySelect(null);
    // Clear map edit state
    onMapUpdate(null, null, null);
    // Reset search state
    setSelectedPlace(null);
    setEditMode(null);
    setEditedGeojson(null);
    setSearchQuery('');
    clearPredictions();
    // Reset corestack village selection
    setSelectedVillageName('');
  };
  const [csLocations, setCsLocations] = useState(null);
  const [csSelectedState, setCsSelectedState] = useState('');
  const [csSelectedDistrict, setCsSelectedDistrict] = useState('');
  const [csSelectedTehsil, setCsSelectedTehsil] = useState('');
  const [csVillages, setCsVillages] = useState([]);
  const [selectedVillageName, setSelectedVillageName] = useState('');

  // ─── Places Search State ───
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [editMode, setEditMode] = useState(null); // null | 'edit' | 'draw'
  const [editedGeojson, setEditedGeojson] = useState(null);
  const { predictions, isLoading: placesLoading, search: searchPlaces, getPlaceDetails, clearPredictions } = usePlacesAutocomplete();
  const debounceRef = useRef(null);

  useEffect(() => {
    if (activeTab === 'corestack' && !csLocations) {
      getActiveLocations().then((resp) => setCsLocations(resp || [])).catch(() => setCsLocations([]));
    }
  }, [activeTab, csLocations]);

  const csStates = csLocations || [];
  const csDistricts = csStates.find((s) => s.label === csSelectedState)?.district || [];
  const csTehsils = csDistricts.find((d) => d.label === csSelectedDistrict)?.blocks || [];

  const handleCsTehsilChange = async (val) => {
    setCsSelectedTehsil(val);
    setCsVillages([]);
    if (!val) return;
    try {
      const data = await getVillageGeometries(csSelectedState, csSelectedDistrict, val);
      let features = data?.type === 'FeatureCollection' ? data.features : Array.isArray(data) ? data : [];
      // Group features by village name, merging geometries into a MultiPolygon
      const grouped = {};
      for (const f of features) {
        const name = f?.properties?.vill_name || f?.properties?.name || '';
        if (!name) continue;
        
        if (!grouped[name]) {
          grouped[name] = { ...f, geometry: JSON.parse(JSON.stringify(f.geometry)) };
        } else {
          // Merge geometry into existing entry as MultiPolygon
          const existing = grouped[name].geometry;
          const incoming = f.geometry;
          if (existing && incoming) {
            const existCoords = existing.type === 'MultiPolygon' 
              ? existing.coordinates 
              : [existing.coordinates];
            const newCoords = incoming.type === 'MultiPolygon' 
              ? incoming.coordinates 
              : [incoming.coordinates];
            
            grouped[name].geometry = {
              type: 'MultiPolygon',
              coordinates: [...existCoords, ...newCoords],
            };
          }
        }
      }
      setCsVillages(Object.values(grouped));
    } catch { setCsVillages([]); }
  };

  const selectCsVillage = useCallback((feature) => {
    const geojson = feature.geometry;
    if (!geojson) return;
    const name = feature.properties?.vill_name || feature.properties?.name || 'Village';
    const area = computeAreaHectares(geojson);
    try {
      const coords = geojson.type === 'MultiPolygon' ? geojson.coordinates[0][0] : geojson.coordinates[0];
      const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      const avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      if (onMapUpdate) onMapUpdate({ lat: avgLat, lng: avgLng }, geojson);
    } catch {}
    setSelectedVillageName(name);
    onBoundarySelect({ type: 'geojson', boundary_geojson: geojson, village_name: name, state: csSelectedState, district: csSelectedDistrict, tehsil: csSelectedTehsil, area_hectares: area, source: 'corestack' });
  }, [csSelectedState, csSelectedDistrict, csSelectedTehsil, onBoundarySelect, onMapUpdate]);

  // ─── Places Search Handlers ───
  const handleSearchInput = (val) => {
    setSearchQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 2) {
      clearPredictions();
      return;
    }
    debounceRef.current = setTimeout(() => searchPlaces(val), 300);
  };

  const handleSelectPlace = async (prediction) => {
    setSearchQuery(prediction.main_text);
    clearPredictions();
    const details = await getPlaceDetails(prediction.place_id);
    if (!details) return;

    setSelectedPlace(details);
    setEditMode(null);
    setEditedGeojson(null);

    const area = computeAreaHectares(details.geojson);
    if (onMapUpdate) onMapUpdate({ lat: details.lat, lng: details.lng }, details.geojson);

    // Don't call onBoundarySelect yet — wait for user to confirm/edit
  };

  const handleConfirmBoundary = () => {
    const geojson = editedGeojson || selectedPlace?.geojson;
    if (!geojson) return;

    const area = computeAreaHectares(geojson);
    const name = selectedPlace?.name || 'Custom Area';

    onBoundarySelect({
      type: 'geojson',
      boundary_geojson: geojson,
      village_name: name,
      state: '',
      district: '',
      tehsil: '',
      area_hectares: area,
      source: 'places',
      editMode,
      editable: editMode === 'edit',
      drawMode: editMode === 'draw',
    });
  };

  const handleGeojsonEdit = useCallback((updatedGeojson) => {
    setEditedGeojson(updatedGeojson);
  }, []);

  // Notify parent when edit/draw mode or geometry changes so MapView can update
  useEffect(() => {
    if (activeTab !== 'search' || !selectedPlace) return;
    // Pass edit state to parent for MapView props
    const geojson = editedGeojson || selectedPlace?.geojson;
    if (geojson && onMapUpdate) {
      onMapUpdate(
        { lat: selectedPlace.lat, lng: selectedPlace.lng },
        geojson,
        { editable: editMode === 'edit', drawMode: editMode === 'draw', onGeojsonEdit: handleGeojsonEdit }
      );
    }
  }, [editMode, activeTab]);

  const currentArea = computeAreaHectares(editedGeojson || selectedPlace?.geojson);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
      {/* Tab toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.2rem' }}>
        <button onClick={() => handleTabChange('corestack')} style={{ background: 'none', border: 'none', color: activeTab === 'corestack' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>CORESTACK</button>
        <button onClick={() => handleTabChange('search')} style={{ background: 'none', border: 'none', color: activeTab === 'search' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>SEARCH</button>
        <button onClick={() => handleTabChange('upload')} style={{ background: 'none', border: 'none', color: activeTab === 'upload' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>UPLOAD</button>
      </div>

      {/* ═══ CoRE Stack Tab ═══ */}
      {activeTab === 'corestack' && (
        <>
          <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.9rem', color: '#475569', minWidth: '70px', fontWeight: 500 }}>State</span>
            <div className="select-wrapper" style={{ flex: 1 }}>
              <select value={csSelectedState} onChange={(e) => { setCsSelectedState(e.target.value); setCsSelectedDistrict(''); setCsSelectedTehsil(''); setCsVillages([]); }} style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b' }}>
                <option value="">Select State</option>
                {csStates.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.9rem', color: '#475569', minWidth: '70px', fontWeight: 500 }}>District</span>
            <div className="select-wrapper" style={{ flex: 1 }}>
              <select value={csSelectedDistrict} onChange={(e) => { setCsSelectedDistrict(e.target.value); setCsSelectedTehsil(''); setCsVillages([]); }} disabled={!csSelectedState} style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b' }}>
                <option value="">Select District</option>
                {csDistricts.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.9rem', color: '#475569', minWidth: '70px', fontWeight: 500 }}>Tehsil</span>
            <div className="select-wrapper" style={{ flex: 1 }}>
              <select value={csSelectedTehsil} onChange={(e) => handleCsTehsilChange(e.target.value)} disabled={!csSelectedDistrict} style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b' }}>
                <option value="">Select Tehsil</option>
                {csTehsils.map((t) => <option key={t.label} value={t.label}>{t.label}</option>)}
              </select>
            </div>
          </div>
          
          {csVillages.length > 0 && (
            <div style={{ marginTop: '0.75rem', maxHeight: '240px', overflowY: 'auto', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.4rem' }}>
              {csVillages.map((feat, idx) => {
                const name = feat.properties?.vill_name || feat.properties?.name || 'Village';
                const isSelected = selectedVillageName === name;
                return (
                  <button key={idx} onClick={() => selectCsVillage(feat)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 0.75rem', background: isSelected ? '#ede9fe' : 'transparent', border: 'none', borderRadius: '4px', fontSize: '0.95rem', color: isSelected ? '#6d28d9' : '#0f172a', fontWeight: isSelected ? 600 : 400, borderBottom: '1px solid #f1f5f9', cursor: 'pointer', marginBottom: '2px' }}>
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══ Places Search Tab ═══ */}
      {activeTab === 'search' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {/* Search Input */}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.9rem', color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="Search village, town, or city..."
                style={{
                  width: '100%', padding: '0.6rem 0.6rem 0.6rem 2rem',
                  borderRadius: '8px', border: '1.5px solid #e2e8f0',
                  fontSize: '0.9rem', color: '#1e293b', background: '#fff',
                  outline: 'none', transition: 'border-color 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => e.target.style.borderColor = '#8b5cf6'}
                onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                id="places-search-input"
              />
              {placesLoading && (
                <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }}>
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></span>
                </span>
              )}
            </div>

            {/* Predictions Dropdown */}
            {predictions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0 0 8px 8px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: '200px', overflowY: 'auto',
              }}>
                {predictions.map((p) => (
                  <button
                    key={p.place_id}
                    onClick={() => handleSelectPlace(p)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '0.55rem 0.75rem', background: 'transparent',
                      border: 'none', borderBottom: '1px solid #f1f5f9',
                      cursor: 'pointer', fontSize: '0.85rem', color: '#1e293b',
                    }}
                    onMouseEnter={(e) => e.target.style.background = '#f8fafc'}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    <div style={{ fontWeight: 500 }}>{p.main_text}</div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '1px' }}>{p.secondary_text}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected Place Info */}
          {selectedPlace && (
            <div style={{
              background: 'linear-gradient(135deg, #faf5ff 0%, #f0f4ff 100%)',
              border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.1rem' }}></span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>{selectedPlace.name}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    {selectedPlace.formatted_address}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{currentArea}</span> ha (approx)
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  {selectedPlace.lat.toFixed(4)}°N, {selectedPlace.lng.toFixed(4)}°E
                </div>
              </div>

              {/* Edit/Draw Mode Buttons */}
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem' }}>
                <button
                  onClick={() => setEditMode(editMode === 'edit' ? null : 'edit')}
                  style={{
                    flex: 1, padding: '0.45rem', borderRadius: '6px', fontSize: '0.75rem',
                    fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                    background: editMode === 'edit' ? '#f59e0b' : '#fff',
                    color: editMode === 'edit' ? '#fff' : '#f59e0b',
                    border: `1.5px solid ${editMode === 'edit' ? '#f59e0b' : '#fcd34d'}`,
                  }}
                >
                  ✏️ {editMode === 'edit' ? 'Editing...' : 'Edit Boundary'}
                </button>
                <button
                  onClick={() => {
                    setEditMode(editMode === 'draw' ? null : 'draw');
                    setEditedGeojson(null);
                  }}
                  style={{
                    flex: 1, padding: '0.45rem', borderRadius: '6px', fontSize: '0.75rem',
                    fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                    background: editMode === 'draw' ? '#8b5cf6' : '#fff',
                    color: editMode === 'draw' ? '#fff' : '#8b5cf6',
                    border: `1.5px solid ${editMode === 'draw' ? '#8b5cf6' : '#c4b5fd'}`,
                  }}
                >
                  ✍️ {editMode === 'draw' ? 'Drawing...' : 'Draw Custom'}
                </button>
              </div>

              {/* Edit mode hint */}
              {editMode && (
                <div style={{
                  marginTop: '0.4rem', padding: '0.4rem 0.6rem', borderRadius: '6px',
                  background: editMode === 'draw' ? 'rgba(139, 92, 246, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                  fontSize: '0.7rem', color: editMode === 'draw' ? '#7c3aed' : '#d97706',
                  lineHeight: 1.5,
                }}>
                  {editMode === 'edit'
                    ? '💡 Drag the yellow vertices to reshape the boundary. Drag the polygon to move it.'
                    : '💡 Click on the map to place vertices. Need ≥3 points to form a polygon.'}
                </div>
              )}

              {/* Confirm Button */}
              <button
                onClick={handleConfirmBoundary}
                disabled={editMode === 'draw' && !editedGeojson}
                style={{
                  width: '100%', marginTop: '0.6rem', padding: '0.55rem',
                  borderRadius: '8px', border: 'none', fontSize: '0.8rem',
                  fontWeight: 600, cursor: 'pointer',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#fff', opacity: (editMode === 'draw' && !editedGeojson) ? 0.5 : 1,
                  transition: 'opacity 0.2s',
                }}
              >
                 Confirm Boundary & Analyze
              </button>
            </div>
          )}

          {/* Help text when no place selected */}
          {!selectedPlace && (
            <div style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.5, padding: '0.5rem', background: '#f8fafc', borderRadius: '6px', border: '1px dashed #e2e8f0' }}>
              Search for any village, town, or city in India. Once selected, you can edit the boundary or draw a custom polygon before running analytics.
            </div>
          )}
        </div>
      )}


      {/* ═══ Upload Tab ═══ */}
      {activeTab === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ padding: '1rem', border: '2px dashed #8b5cf6', borderRadius: '8px', textAlign: 'center', background: '#faf5ff' }}>
            <div style={{ fontSize: '0.85rem', color: '#6d28d9', fontWeight: 600, marginBottom: '0.3rem' }}>
               Upload Village Boundary
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.6rem', lineHeight: 1.5 }}>
              Upload a GeoJSON/JSON polygon for any Indian village.
              IndiaSAT LULC v3 (10m) covers all of India — no location selection needed.
            </div>
            <input type="file" accept=".json,.geojson" onChange={(e) => {
              const file = e.target.files[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = ev => {
                  try {
                    const geojson = JSON.parse(ev.target.result);
                    const polygon = geojson.type === 'FeatureCollection'
                      ? geojson.features[0].geometry
                      : geojson.geometry || geojson;
                    const area = computeAreaHectares(polygon);
                    const name = geojson.features?.[0]?.properties?.name
                      || geojson.features?.[0]?.properties?.vill_name
                      || geojson.properties?.name
                      || file.name.replace(/\.(geo)?json$/i, '')
                      || 'Custom Polygon';
                    // Center map on uploaded polygon
                    try {
                      const coords = polygon.type === 'MultiPolygon' ? polygon.coordinates[0][0] : polygon.coordinates[0];
                      const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
                      const avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
                      if (onMapUpdate) onMapUpdate({ lat: avgLat, lng: avgLng }, polygon);
                    } catch {}
                    setSelectedVillageName(name);
                    onBoundarySelect({
                      type: 'geojson',
                      boundary_geojson: polygon,
                      village_name: name,
                      state: '',
                      district: '',
                      tehsil: '',
                      area_hectares: area,
                      source: 'upload',
                    });
                  } catch (err) {
                    alert('Invalid GeoJSON file: ' + err.message);
                  }
                };
                reader.readAsText(file);
              }
            }} style={{ display: 'block', margin: '0 auto', fontSize: '0.8rem' }}/>
          </div>
        </div>
      )}
    </div>
  );
}
