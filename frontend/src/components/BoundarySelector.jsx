import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePlacesAutocomplete, computeAreaHectares } from './GoogleMapsIntegration';
import { getActiveLocations, getVillageGeometries } from '../services/api';

export default function BoundarySelector({ onBoundarySelect, onMapUpdate }) {
  const [activeTab, setActiveTab] = useState('corestack');
  const [csLocations, setCsLocations] = useState(null);
  const [csSelectedState, setCsSelectedState] = useState('');
  const [csSelectedDistrict, setCsSelectedDistrict] = useState('');
  const [csSelectedTehsil, setCsSelectedTehsil] = useState('');
  const [csVillages, setCsVillages] = useState([]);
  const [selectedVillageName, setSelectedVillageName] = useState('');

  const { predictions, search: searchGoogle, getPlaceDetails } = usePlacesAutocomplete();

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
      const seen = new Set();
      setCsVillages(features.filter((f) => {
        const name = f?.properties?.vill_name || f?.properties?.name || '';
        if (!name || seen.has(name)) return false;
        seen.add(name); return true;
      }));
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
      {/* Subtle feature toggle keeping all 3 search modes */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.2rem' }}>
        <button onClick={() => setActiveTab('corestack')} style={{ background: 'none', border: 'none', color: activeTab === 'corestack' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>CORESTACK</button>
        <button onClick={() => setActiveTab('google')} style={{ background: 'none', border: 'none', color: activeTab === 'google' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>SEARCH</button>
        <button onClick={() => setActiveTab('upload')} style={{ background: 'none', border: 'none', color: activeTab === 'upload' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>UPLOAD</button>
      </div>

      {activeTab === 'corestack' && (
        <>
          <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: '#475569', minWidth: '60px' }}>State</span>
            <div className="select-wrapper" style={{ flex: 1 }}>
              <select value={csSelectedState} onChange={(e) => { setCsSelectedState(e.target.value); setCsSelectedDistrict(''); setCsSelectedTehsil(''); setCsVillages([]); }} style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.75rem', color: '#1e293b' }}>
                <option value="">Select State</option>
                {csStates.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: '#475569', minWidth: '60px' }}>District</span>
            <div className="select-wrapper" style={{ flex: 1 }}>
              <select value={csSelectedDistrict} onChange={(e) => { setCsSelectedDistrict(e.target.value); setCsSelectedTehsil(''); setCsVillages([]); }} disabled={!csSelectedState} style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.75rem', color: '#1e293b' }}>
                <option value="">Select District</option>
                {csDistricts.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: '#475569', minWidth: '60px' }}>Tehsil</span>
            <div className="select-wrapper" style={{ flex: 1 }}>
              <select value={csSelectedTehsil} onChange={(e) => handleCsTehsilChange(e.target.value)} disabled={!csSelectedDistrict} style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.75rem', color: '#1e293b' }}>
                <option value="">Select Tehsil</option>
                {csTehsils.map((t) => <option key={t.label} value={t.label}>{t.label}</option>)}
              </select>
            </div>
          </div>
          
          {csVillages.length > 0 && (
            <div style={{ marginTop: '0.5rem', maxHeight: '180px', overflowY: 'auto', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '0.2rem' }}>
              {csVillages.map((feat, idx) => {
                const name = feat.properties?.vill_name || feat.properties?.name || 'Village';
                const isSelected = selectedVillageName === name;
                return (
                  <button key={idx} onClick={() => selectCsVillage(feat)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.4rem 0.5rem', background: isSelected ? '#ede9fe' : 'none', border: 'none', fontSize: '0.75rem', color: isSelected ? '#6d28d9' : '#0f172a', fontWeight: isSelected ? 600 : 400, borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {activeTab === 'google' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <input type="text" placeholder="Search places..." onChange={(e) => { if(e.target.value.length > 2) searchGoogle(e.target.value); }} style={{ width: '100%', padding: '0.4rem', fontSize: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '4px' }}/>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {predictions.map(p => (
              <button key={p.place_id} onClick={async () => { const details = await getPlaceDetails(p.place_id); if (details) { onMapUpdate({ lat: details.lat, lng: details.lng }, details.geojson); onBoundarySelect({ type: 'geojson', boundary_geojson: details.geojson, village_name: details.name, state: details.state, district: details.district, tehsil: details.tehsil, source: 'google' }); } }} style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #f1f5f9', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem' }}>{p.description}</button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'upload' && (
        <div style={{ padding: '1rem', border: '1px dashed #cbd5e1', borderRadius: '4px', textAlign: 'center', fontSize: '0.75rem', color: '#64748b' }}>
          Upload GeoJSON file
          <input type="file" accept=".json,.geojson" onChange={(e) => {
            const file = e.target.files[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = ev => {
                const geojson = JSON.parse(ev.target.result);
                const polygon = geojson.type === 'FeatureCollection' ? geojson.features[0].geometry : geojson.geometry || geojson;
                onMapUpdate(null, polygon);
                onBoundarySelect({ type: 'geojson', boundary_geojson: polygon, village_name: 'Custom', state: '-', district: '-', tehsil: '-', source: 'upload' });
              };
              reader.readAsText(file);
            }
          }} style={{ display: 'block', margin: '0.5rem auto' }}/>
        </div>
      )}
    </div>
  );
}
