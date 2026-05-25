import React, { useState, useCallback, useRef, useEffect } from 'react';
import { computeAreaHectares, usePlacesAutocomplete } from './GoogleMapsIntegration';
import { getGEEStates, getGEEDistricts, getGEETehsils, getGEETehsilsByState, getGEEVillageGeometries, getGEEVillagesByDistrict, getVillageGeometries, getGEETehsilGeometry, getGEEDistrictGeometry, getGEEStateGeometry } from '../services/api';
import { resolveAdminHierarchy } from '../services/adminResolver';

const MAX_AREA_HA = 20000; // Maximum boundary area allowed for analysis

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
    // Reset corestack / GEE hierarchy selection
    setSelectedVillageName('');
    setCsSelectedState('');
    setCsSelectedDistrict('');
    setCsSelectedTehsil('');
    setCsVillages([]);
    setGeeDistricts([]);
    setGeeTehsils([]);
    setSkipDistrict(false);
    setSkipTehsil(false);
    setMwsStatus('idle');
    setMwsUid(null);
    setAreaFallback(null);
  };
  // ─── CoRE Stack / GEE Hierarchy State ───
  const [geeStates, setGeeStates] = useState([]);        // string[] — all pan-India states
  const [geeDistricts, setGeeDistricts] = useState([]);  // string[] — districts in selected state
  const [geeTehsils, setGeeTehsils] = useState([]);      // string[] — tehsils in selected district

  // Adaptive cascade flags — set when a hierarchy level has no data
  const [skipDistrict, setSkipDistrict] = useState(false); // true → no districts for state
  const [skipTehsil, setSkipTehsil] = useState(false);     // true → no tehsils for district

  const [csSelectedState, setCsSelectedState] = useState('');
  const [csSelectedDistrict, setCsSelectedDistrict] = useState('');
  const [csSelectedTehsil, setCsSelectedTehsil] = useState('');
  const [csVillages, setCsVillages] = useState([]);
  const [csLoading, setCsLoading] = useState(false);
  const [districtLoading, setDistrictLoading] = useState(false);
  const [tehsilLoading, setTehsilLoading] = useState(false);
  const [selectedVillageName, setSelectedVillageName] = useState('');

  // MWS availability check state
  const [mwsStatus, setMwsStatus] = useState('idle'); // 'idle' | 'checking' | 'ok' | 'none'
  const [mwsUid, setMwsUid] = useState(null);

  // CoReStack village lookup: normalised name → { vill_ID, vill_name }
  // Populated when a tehsil is selected; used to gate MWS button availability
  const csCoreLookup = useRef(new Map());

  // Area fallback — GeoJSON Feature for the smallest available admin unit
  // when no villages exist. Level can be 'tehsil' | 'district' | 'state'.
  const [areaFallback, setAreaFallback] = useState(null); // { feature, label, level }

  // ─── Places Search State ───
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [editMode, setEditMode] = useState(null); // null | 'edit' | 'draw'
  const [editedGeojson, setEditedGeojson] = useState(null);
  const { predictions, isLoading: placesLoading, search: searchPlaces, getPlaceDetails, clearPredictions } = usePlacesAutocomplete();
  const debounceRef = useRef(null);
  const [resolvingLocation, setResolvingLocation] = useState(false);
  const [errorDialog, setErrorDialog] = useState(null);

  // Load all states on first CoReStack tab open
  useEffect(() => {
    if (activeTab === 'corestack' && geeStates.length === 0) {
      getGEEStates()
        .then((names) => setGeeStates(Array.isArray(names) ? names : []))
        .catch(() => setGeeStates([]));
    }
  }, [activeTab]);

  // State selected → fetch districts; if none, auto-skip to tehsil level
  const handleCsStateChange = async (val) => {
    setCsSelectedState(val);
    setCsSelectedDistrict('');
    setCsSelectedTehsil('');
    setCsVillages([]);
    setGeeDistricts([]);
    setGeeTehsils([]);
    setSkipDistrict(false);
    setSkipTehsil(false);
    setMwsStatus('idle');
    setSelectedVillageName('');
    if (!val) return;
    setDistrictLoading(true);
    try {
      const names = await getGEEDistricts(val);
      const districts = Array.isArray(names) ? names : [];
      if (districts.length > 0) {
        // Normal path: state → district → tehsil → village
        setGeeDistricts(districts);
        setSkipDistrict(false);
      } else {
        // Skip district: load tehsils directly for the state
        setSkipDistrict(true);
        setTehsilLoading(true);
        try {
          const tehsils = await getGEETehsilsByState(val);
          const tehsilList = Array.isArray(tehsils) ? tehsils : [];
          if (tehsilList.length > 0) {
            setGeeTehsils(tehsilList);
          } else {
            // No districts AND no tehsils — try loading state geometry as boundary
            setGeeTehsils([]);
            setCsLoading(true);
            try {
              const stateFeat = await getGEEStateGeometry(val);
              setAreaFallback({ feature: stateFeat, label: val, level: 'state' });
            } catch {
              setAreaFallback(null);
            } finally {
              setCsLoading(false);
            }
          }
        } catch {
          setGeeTehsils([]);
        } finally {
          setTehsilLoading(false);
        }
      }
    } catch {
      setGeeDistricts([]);
    } finally {
      setDistrictLoading(false);
    }
  };

  // District selected → fetch tehsils; if none, auto-skip to village level
  const handleCsDistrictChange = async (val) => {
    setCsSelectedDistrict(val);
    setCsSelectedTehsil('');
    setCsVillages([]);
    setGeeTehsils([]);
    setSkipTehsil(false);
    setMwsStatus('idle');
    setSelectedVillageName('');
    setAreaFallback(null);
    csCoreLookup.current = new Map(); // reset lookup on district change
    if (!val || !csSelectedState) return;
    setTehsilLoading(true);
    try {
      const names = await getGEETehsils(csSelectedState, val);
      const tehsils = Array.isArray(names) ? names : [];
      if (tehsils.length > 0) {
        // Normal path: district → tehsil → village
        setGeeTehsils(tehsils);
        setSkipTehsil(false);
      } else {
        // Skip tehsil: load villages directly for the district (no CoReStack lookup here — no tehsil to query)
        setSkipTehsil(true);
        setCsLoading(true);
        try {
          const fc = await getGEEVillagesByDistrict(csSelectedState, val);
          const features = fc?.features || [];
          const sorted = features.sort((a, b) => {
            const nameA = a.properties?.vill_name || a.properties?.name || '';
            const nameB = b.properties?.vill_name || b.properties?.name || '';
            return nameA.localeCompare(nameB);
          });
          if (sorted.length > 0) {
            setCsVillages(sorted);
          } else {
            // No tehsils AND no villages — show district boundary as fallback
            setCsVillages([]);
            try {
              const distFeat = await getGEEDistrictGeometry(csSelectedState, val);
              setAreaFallback({ feature: distFeat, label: val, level: 'district' });
            } catch {
              setAreaFallback(null);
            }
          }
        } catch {
          setCsVillages([]);
        } finally {
          setCsLoading(false);
        }
      }
    } catch {
      setGeeTehsils([]);
    } finally {
      setTehsilLoading(false);
    }
  };

  // Tehsil selected → fetch villages from GEE Village_pan_india
  // Also fire CoReStack village-geometries in parallel to build MWS lookup map
  const handleCsTehsilChange = async (val) => {
    setCsSelectedTehsil(val);
    setCsVillages([]);
    setMwsStatus('idle');
    setSelectedVillageName('');
    setAreaFallback(null);
    csCoreLookup.current = new Map(); // reset on every tehsil change
    if (!val) return;

    setCsLoading(true);
    try {
      // Fire GEE + CoReStack requests in parallel
      const [geeData, csData] = await Promise.allSettled([
        getGEEVillageGeometries(csSelectedState, csSelectedDistrict, val),
        getVillageGeometries(csSelectedState, csSelectedDistrict, val),
      ]);

      // Build CoReStack lookup: normalised-name → { vill_ID, vill_name }
      if (csData.status === 'fulfilled') {
        const csFeatures = csData.value?.features || (Array.isArray(csData.value) ? csData.value : []);
        const lookup = new Map();
        for (const f of csFeatures) {
          const n = f?.properties?.vill_name || f?.properties?.name || '';
          if (n) lookup.set(n.toLowerCase().trim(), {
            vill_ID: f?.properties?.vill_ID || f?.properties?.village_id || null,
            vill_name: n,
          });
        }
        csCoreLookup.current = lookup;
      }

      // Process GEE features
      const rawFeatures = geeData.status === 'fulfilled'
        ? (geeData.value?.type === 'FeatureCollection' ? geeData.value.features : Array.isArray(geeData.value) ? geeData.value : [])
        : [];

      // Group GEE features by village name, merging geometries into MultiPolygon
      const grouped = {};
      for (const f of rawFeatures) {
        const name = f?.properties?.vill_name || f?.properties?.name || '';
        if (!name) continue;
        if (!grouped[name]) {
          grouped[name] = { ...f, geometry: JSON.parse(JSON.stringify(f.geometry)) };
        } else {
          const existing = grouped[name].geometry;
          const incoming = f.geometry;
          if (existing && incoming) {
            const existCoords = existing.type === 'MultiPolygon' ? existing.coordinates : [existing.coordinates];
            const newCoords = incoming.type === 'MultiPolygon' ? incoming.coordinates : [incoming.coordinates];
            grouped[name].geometry = { type: 'MultiPolygon', coordinates: [...existCoords, ...newCoords] };
          }
        }
      }
      const sorted = Object.values(grouped).sort((a, b) => {
        const nameA = a.properties?.vill_name || a.properties?.name || '';
        const nameB = b.properties?.vill_name || b.properties?.name || '';
        return nameA.localeCompare(nameB);
      });
      setCsVillages(sorted);

      // If no villages found in GEE, fetch tehsil geometry as fallback
      if (sorted.length === 0) {
        try {
          const tehsilFeat = await getGEETehsilGeometry(csSelectedState, csSelectedDistrict, val);
          setAreaFallback({ feature: tehsilFeat, label: val, level: 'tehsil' });
        } catch {
          setAreaFallback(null);
        }
      } else {
        setAreaFallback(null);
      }
    } catch {
      setCsVillages([]);
    } finally {
      setCsLoading(false);
    }
  };

  const selectCsVillage = useCallback(async (feature) => {
    const geojson = feature.geometry;
    if (!geojson) return;
    const name = feature.properties?.vill_name || feature.properties?.name || 'Village';
    const area = computeAreaHectares(geojson);

    if (area > MAX_AREA_HA) {
      setErrorDialog({
        title: 'Village Boundary Too Large',
        message: `Area: ${area.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ha.\nMaximum allowed is ${MAX_AREA_HA.toLocaleString('en-IN')} ha.\n\nThis village exceeds the maximum allowed size for real-time analytics. Please use the Custom Draw or GeoJSON Upload tools for a smaller sub-region.`
      });
      return;
    }

    let avgLat = null;
    let avgLng = null;
    try {
      const coords = geojson.type === 'MultiPolygon' ? geojson.coordinates[0][0] : geojson.coordinates[0];
      avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      if (onMapUpdate) onMapUpdate({ lat: avgLat, lng: avgLng }, geojson);
    } catch {}

    setSelectedVillageName(name);

    // Check CoReStack lookup: if village name matches a CoReStack-active village, MWS is available
    const csEntry = csCoreLookup.current.get(name.toLowerCase().trim()) || null;
    const villageId = csEntry?.vill_ID || feature.properties?.vill_ID || feature.properties?.village_id || feature.id || null;
    const isMwsAvailable = !!csEntry;
    const mwsUidVal = csEntry?.vill_ID || null;

    // Boundary select with instant MWS status
    onBoundarySelect({
      type: 'geojson', boundary_geojson: geojson, village_name: name,
      village_id: villageId, state: csSelectedState, district: csSelectedDistrict,
      tehsil: csSelectedTehsil, area_hectares: area, source: 'corestack',
      mwsAvailable: isMwsAvailable, mwsUid: mwsUidVal,
    });

    setMwsStatus(isMwsAvailable ? 'ok' : 'none');
    setMwsUid(mwsUidVal);
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

    const area = computeAreaHectares(details.geojson);
    
    if (area > MAX_AREA_HA) {
      setErrorDialog({
        title: 'Search Area Too Large',
        message: `Area: ${area.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ha.\nMaximum allowed is ${MAX_AREA_HA.toLocaleString('en-IN')} ha.\n\nThis region is too large for real-time analytics. Please search for a specific village, town, or neighborhood instead.`
      });
      return;
    }

    setSelectedPlace(details);
    setEditMode(null);
    setEditedGeojson(null);

    if (onMapUpdate) onMapUpdate({ lat: details.lat, lng: details.lng }, details.geojson);

    // Don't call onBoundarySelect yet — wait for user to confirm/edit
  };

  const handleConfirmBoundary = async () => {
    const geojson = editedGeojson || selectedPlace?.geojson;
    if (!geojson) return;

    const area = computeAreaHectares(geojson);
    if (area > MAX_AREA_HA) {
      setErrorDialog({
        title: 'Boundary Too Large',
        message: `Area: ${area.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ha.\nMaximum allowed is ${MAX_AREA_HA.toLocaleString('en-IN')} ha.\n\nPlease select a smaller area.`
      });
      return;
    }

    const name = selectedPlace?.name || 'Custom Area';

    // Resolve admin hierarchy via hierarchical drill-down (client-side turf.js + tiny GEE queries)
    setResolvingLocation(true);
    let adminFields = { state: '', district: '', tehsil: '' };
    try {
      adminFields = await resolveAdminHierarchy(geojson);
    } catch (e) {
      console.warn('[BoundarySelector] Admin resolution failed, using empty fields:', e.message);
    } finally {
      setResolvingLocation(false);
    }

    onBoundarySelect({
      type: 'geojson',
      boundary_geojson: geojson,
      village_name: name,
      state: adminFields.state,
      district: adminFields.district,
      tehsil: adminFields.tehsil,
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
        <button onClick={() => handleTabChange('corestack')} style={{ background: 'none', border: 'none', color: activeTab === 'corestack' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>PICK A VILLAGE</button>
        <button onClick={() => handleTabChange('search')} style={{ background: 'none', border: 'none', color: activeTab === 'search' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>SEARCH MAP</button>
        <button onClick={() => handleTabChange('upload')} style={{ background: 'none', border: 'none', color: activeTab === 'upload' ? '#8b5cf6' : '#94a3b8', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>UPLOAD FILE</button>
      </div>

      {/* ═══ CoRE Stack Tab ═══ */}
      {activeTab === 'corestack' && (
        <>
          {/* State */}
          <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.9rem', color: '#475569', minWidth: '70px', fontWeight: 500 }}>State</span>
            <div className="select-wrapper" style={{ flex: 1 }}>
              <select
                value={csSelectedState}
                onChange={(e) => handleCsStateChange(e.target.value)}
                disabled={geeStates.length === 0}
                style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b' }}
              >
                <option value="">{geeStates.length === 0 ? 'Loading states…' : 'Select State'}</option>
                {geeStates.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* District — hidden when state has no district-level data */}
          {!skipDistrict && csSelectedState && (
            <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.9rem', color: '#475569', minWidth: '70px', fontWeight: 500 }}>District</span>
              <div className="select-wrapper" style={{ flex: 1 }}>
                <select
                  value={csSelectedDistrict}
                  onChange={(e) => handleCsDistrictChange(e.target.value)}
                  disabled={!csSelectedState || districtLoading}
                  style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b' }}
                >
                  <option value="">{districtLoading ? 'Loading districts…' : 'Select District'}</option>
                  {geeDistricts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
          )}
          {skipDistrict && csSelectedState && (
            <div style={{ fontSize: '0.72rem', color: '#64748b', padding: '0.3rem 0.5rem', background: '#f1f5f9', borderRadius: '5px', fontStyle: 'italic' }}>
              ℹ️ {csSelectedState} doesn't have district-level data. Pick a tehsil/taluka instead.
            </div>
          )}

          {/* Tehsil — hidden when district has no tehsil-level data */}
          {!skipTehsil && (csSelectedDistrict || skipDistrict) && (
            <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.9rem', color: '#475569', minWidth: '70px', fontWeight: 500 }}>Tehsil</span>
              <div className="select-wrapper" style={{ flex: 1 }}>
                <select
                  value={csSelectedTehsil}
                  onChange={(e) => handleCsTehsilChange(e.target.value)}
                  disabled={tehsilLoading || geeTehsils.length === 0}
                  style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b' }}
                >
                  <option value="">{tehsilLoading ? 'Loading tehsils…' : 'Select Tehsil'}</option>
                  {geeTehsils.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}
          {skipTehsil && csSelectedDistrict && (
            <div style={{ fontSize: '0.72rem', color: '#64748b', padding: '0.3rem 0.5rem', background: '#f1f5f9', borderRadius: '5px', fontStyle: 'italic' }}>
              ℹ️ {csSelectedDistrict} doesn't have tehsil-level data. Pick a village below.
            </div>
          )}

          {/* Village dropdown (replaces previous button list) */}
          {csLoading && (
            <div style={{ marginTop: '0.5rem', padding: '0.75rem', textAlign: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '6px' }}>
              <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2, borderColor: 'rgba(139, 92, 246, 0.2)', borderTopColor: '#8b5cf6', verticalAlign: 'middle', display: 'inline-block', marginRight: '0.5rem' }}></span>
              <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>Loading villages…</span>
            </div>
          )}
          {!csLoading && csVillages.length > 0 && (
            <div className="selector-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.9rem', color: '#475569', minWidth: '70px', fontWeight: 500 }}>Village</span>
              <div className="select-wrapper" style={{ flex: 1 }}>
                <select
                  value={selectedVillageName}
                  onChange={(e) => {
                    const name = e.target.value;
                    const feat = csVillages.find(f => (f.properties?.vill_name || f.properties?.name) === name);
                    if (feat) selectCsVillage(feat);
                  }}
                  style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b' }}
                >
                  <option value="">Select Village</option>
                  {csVillages.map((feat, idx) => {
                    const name = feat.properties?.vill_name || feat.properties?.name || 'Village';
                    return <option key={idx} value={name}>{name}</option>;
                  })}
                </select>
              </div>
            </div>
          )}

          {/* Area boundary fallback — shown when no villages exist at the selected level */}
          {!csLoading && areaFallback && csVillages.length === 0 && (() => {
            const { feature, label, level } = areaFallback;
            const levelEmoji = level === 'state' ? '🗺️' : level === 'district' ? '🏛️' : '📍';
            const levelName = level.charAt(0).toUpperCase() + level.slice(1);
            const isSelected = selectedVillageName === label;
            return (
              <div style={{ marginTop: '0.75rem', background: '#fefce8', border: '1px solid #fde047', borderRadius: '6px', padding: '0.75rem 1rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#854d0e', fontWeight: 600, marginBottom: '0.4rem' }}>
                  {levelEmoji} No village boundaries found in GEE
                </div>
                <div style={{ fontSize: '0.75rem', color: '#92400e', marginBottom: '0.6rem' }}>
                  You can use the entire <strong>{label}</strong> {levelName} boundary as the analysis area.
                </div>
                <button
                  onClick={() => selectCsVillage({ geometry: feature.geometry, properties: { vill_name: label, ...feature.properties } })}
                  style={{
                    width: '100%', padding: '0.55rem 0.75rem',
                    background: isSelected ? '#ede9fe' : '#ffffff',
                    border: `1.5px solid ${isSelected ? '#7c3aed' : '#f59e0b'}`,
                    borderRadius: '6px', cursor: 'pointer',
                    fontSize: '0.9rem', fontWeight: 600,
                    color: isSelected ? '#6d28d9' : '#b45309',
                  }}
                >
                  {isSelected ? '✓ ' : ''}Select {levelName} Boundary — {label}
                </button>
              </div>
            );
          })()}

          {/* No data at all */}
          {!csLoading && !areaFallback && csVillages.length === 0 && (csSelectedTehsil || (skipTehsil && csSelectedDistrict) || (skipDistrict && csSelectedState && geeTehsils.length === 0)) && (
            <div style={{ marginTop: '0.75rem', padding: '1rem', textAlign: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>No boundary data available for this selection</div>
            </div>
          )}

          {/* Selected-village confirmation */}
          {selectedVillageName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem', fontSize: '0.75rem' }}>
              <span style={{ color: '#16a34a', fontWeight: 500 }}>✓ {selectedVillageName} selected — ready to run analysis</span>
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
                placeholder="Search village"
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
                position: 'relative', marginTop: '0.6rem', zIndex: 100,
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
                boxShadow: '0 4px 15px -3px rgba(0,0,0,0.05)', 
                maxHeight: 'none', overflowY: 'visible', overflowX: 'hidden'
              }}>
                {predictions.map((p, idx) => (
                  <button
                    key={p.place_id}
                    onClick={() => handleSelectPlace(p)}
                    style={{
                      display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left',
                      padding: '0.65rem 0.8rem', background: 'transparent',
                      border: 'none', borderBottom: idx === predictions.length - 1 ? 'none' : '1px solid #f1f5f9',
                      cursor: 'pointer', transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f5f3ff';
                      e.currentTarget.querySelector('.pin-icon').style.color = '#8b5cf6';
                      e.currentTarget.querySelector('.pin-icon').style.transform = 'scale(1.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.querySelector('.pin-icon').style.color = '#94a3b8';
                      e.currentTarget.querySelector('.pin-icon').style.transform = 'scale(1)';
                    }}
                  >
                    <div className="pin-icon" style={{ 
                      marginRight: '12px', color: '#94a3b8', 
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.2s ease'
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.main_text}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.secondary_text}</div>
                    </div>
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
                   {editMode === 'edit' ? 'Editing...' : 'Edit Boundary'}
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
                disabled={(editMode === 'draw' && !editedGeojson) || resolvingLocation}
                style={{
                  width: '100%', marginTop: '0.6rem', padding: '0.55rem',
                  borderRadius: '8px', border: 'none', fontSize: '0.8rem',
                  fontWeight: 600, cursor: resolvingLocation ? 'wait' : 'pointer',
                  background: resolvingLocation
                    ? 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'
                    : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#fff',
                  opacity: ((editMode === 'draw' && !editedGeojson) || resolvingLocation) ? 0.7 : 1,
                  transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                }}
              >
                {resolvingLocation ? (
                  <>
                    <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }}></span>
                    Resolving location…
                  </>
                ) : (
                  ' Confirm Boundary & Analyze'
                )}
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
              Have your own village boundary file? Upload a GeoJSON (.json / .geojson) and we'll analyse the area you drew. Works anywhere in India.
            </div>

            {resolvingLocation ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '1.5rem 0' }}>
                <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3, borderColor: 'rgba(139, 92, 246, 0.2)', borderTopColor: '#8b5cf6' }}></span>
                <span style={{ fontSize: '0.85rem', color: '#6d28d9', fontWeight: 600 }}>Resolving administrative boundaries...</span>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>This may take a few seconds</span>
              </div>
            ) : selectedVillageName ? (
              <div style={{ padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', textAlign: 'left', marginTop: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', fontWeight: 600 }}>Active Custom Boundary</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem' }}>{selectedVillageName}</div>
                <button 
                  onClick={() => {
                    setSelectedVillageName('');
                    onBoundarySelect(null);
                    onMapUpdate(null, null, null);
                  }}
                  style={{ width: '100%', fontSize: '0.8rem', padding: '0.4rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', color: '#475569', cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s' }}
                  onMouseOver={(e) => { e.target.style.background = '#f1f5f9'; e.target.style.color = '#0f172a'; }}
                  onMouseOut={(e) => { e.target.style.background = '#f8fafc'; e.target.style.color = '#475569'; }}
                >
                  Clear & Upload Another
                </button>
              </div>
            ) : (
              <input type="file" accept=".json,.geojson" onChange={async (e) => {
              const file = e.target.files[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = async ev => {
                  try {
                    const geojson = JSON.parse(ev.target.result);
                    const polygon = geojson.type === 'FeatureCollection'
                      ? geojson.features[0].geometry
                      : geojson.geometry || geojson;
                    const area = computeAreaHectares(polygon);
                    if (area > MAX_AREA_HA) {
                      setErrorDialog({
                        title: 'Uploaded Boundary Too Large',
                        message: `Area: ${area.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ha.\nMaximum allowed is ${MAX_AREA_HA.toLocaleString('en-IN')} ha.\n\nPlease upload a smaller boundary.`
                      });
                      e.target.value = ''; // reset file input
                      return;
                    }
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

                    // Resolve admin hierarchy (hierarchical drill-down, client-side max-area)
                    setResolvingLocation(true);
                    let adminFields = { state: '', district: '', tehsil: '' };
                    try {
                      adminFields = await resolveAdminHierarchy(polygon);
                    } catch (err) {
                      console.warn('[BoundarySelector] Admin resolution failed:', err.message);
                    } finally {
                      setResolvingLocation(false);
                    }

                    onBoundarySelect({
                      type: 'geojson',
                      boundary_geojson: polygon,
                      village_name: name,
                      state: adminFields.state,
                      district: adminFields.district,
                      tehsil: adminFields.tehsil,
                      area_hectares: area,
                      source: 'upload',
                    });
                  } catch (err) {
                    setErrorDialog({
                      title: 'Invalid File',
                      message: 'Could not parse the GeoJSON file: ' + err.message
                    });
                  }
                };
                reader.readAsText(file);
              }
            }} style={{ display: 'block', margin: '0 auto', fontSize: '0.8rem' }}/>
            )}
          </div>
        </div>
      )}
      {/* ═══ Error Dialog Modal ═══ */}
      {errorDialog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, animation: 'fadeIn 0.2s ease' }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', width: '90%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', transform: 'translateY(0)', animation: 'slideUp 0.3s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', color: '#dc2626' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>{errorDialog.title}</h3>
            </div>
            <div style={{ color: '#475569', fontSize: '0.85rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: '1.5rem' }}>
              {errorDialog.message}
            </div>
            <button 
              onClick={() => setErrorDialog(null)}
              style={{ width: '100%', padding: '0.6rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseOver={(e) => { e.target.style.background = '#f1f5f9'; e.target.style.borderColor = '#cbd5e1'; }}
              onMouseOut={(e) => { e.target.style.background = '#f8fafc'; e.target.style.borderColor = '#e2e8f0'; }}
            >
              Okay, got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
