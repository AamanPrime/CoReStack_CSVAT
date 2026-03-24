import React, { useState, useCallback, useRef, useEffect } from 'react';
import { computeAreaHectares } from './GoogleMapsIntegration';
import { getActiveLocations, getVillageGeometries } from '../services/api';

export default function BoundarySelector({ onBoundarySelect, onMapUpdate }) {
  const [activeTab, setActiveTab] = useState('corestack');
  const [csLocations, setCsLocations] = useState(null);
  const [csSelectedState, setCsSelectedState] = useState('');
  const [csSelectedDistrict, setCsSelectedDistrict] = useState('');
  const [csSelectedTehsil, setCsSelectedTehsil] = useState('');
  const [csVillages, setCsVillages] = useState([]);
  const [selectedVillageName, setSelectedVillageName] = useState('');



  useEffect(() => {
    if ((activeTab === 'corestack' || activeTab === 'upload') && !csLocations) {
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
        <button onClick={() => setActiveTab('upload')} style={{ background: 'none', border: 'none', color: activeTab === 'upload' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>UPLOAD</button>
      </div>

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


      {activeTab === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {/* Step 1: Select location context (reuses same data as CoReStack tab) */}
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
            1. Select location context
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#475569', minWidth: '55px' }}>State</span>
            <select value={csSelectedState} onChange={(e) => { setCsSelectedState(e.target.value); setCsSelectedDistrict(''); setCsSelectedTehsil(''); }} style={{ flex: 1, padding: '0.4rem', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}>
              <option value="">Select State</option>
              {csStates.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#475569', minWidth: '55px' }}>District</span>
            <select value={csSelectedDistrict} onChange={(e) => { setCsSelectedDistrict(e.target.value); setCsSelectedTehsil(''); }} disabled={!csSelectedState} style={{ flex: 1, padding: '0.4rem', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}>
              <option value="">Select District</option>
              {csDistricts.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#475569', minWidth: '55px' }}>Tehsil</span>
            <select value={csSelectedTehsil} onChange={(e) => setCsSelectedTehsil(e.target.value)} disabled={!csSelectedDistrict} style={{ flex: 1, padding: '0.4rem', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}>
              <option value="">Select Tehsil</option>
              {csTehsils.map((t) => <option key={t.label} value={t.label}>{t.label}</option>)}
            </select>
          </div>

          {/* Step 2: Upload GeoJSON (only after tehsil selected) */}
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginTop: '0.3rem' }}>
            2. Upload custom polygon
          </div>
          {csSelectedTehsil ? (
            <div style={{ padding: '0.8rem', border: '2px dashed #8b5cf6', borderRadius: '8px', textAlign: 'center', background: '#faf5ff' }}>
              <div style={{ fontSize: '0.8rem', color: '#6d28d9', marginBottom: '0.4rem' }}>
                📍 {csSelectedState} › {csSelectedDistrict} › {csSelectedTehsil}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.5rem' }}>
                Upload a GeoJSON/JSON polygon for this tehsil
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
                        state: csSelectedState,
                        district: csSelectedDistrict,
                        tehsil: csSelectedTehsil,
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
          ) : (
            <div style={{ padding: '0.8rem', border: '1px dashed #cbd5e1', borderRadius: '8px', textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem' }}>
              ⚠️ Select State, District & Tehsil first to enable upload
            </div>
          )}
        </div>
      )}
    </div>
  );
}
