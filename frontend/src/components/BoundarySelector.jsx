/**
 * CSVAT — BoundarySelector Component.
 *
 * Three modes for selecting a village boundary:
 *   1. CoRE Stack Locations — cascading state→district→tehsil→village from live API
 *   2. Google Places Autocomplete — search any place in India
 *   3. Upload GeoJSON — custom boundary file
 *
 * Shows an interactive Google Map with the selected boundary polygon.
 */
import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  MapView,
  usePlacesAutocomplete,
  computeAreaHectares,
} from "./GoogleMapsIntegration";
import { getActiveLocations, getVillageGeometries } from "../services/api";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8006";

export default function BoundarySelector({ onBoundarySelect }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [dbResults, setDbResults] = useState([]);
  const [selectedBoundary, setSelectedBoundary] = useState(null);
  const [uploadedGeoJSON, setUploadedGeoJSON] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [activeTab, setActiveTab] = useState("corestack");
  const [dragActive, setDragActive] = useState(false);
  const [isSearchingDB, setIsSearchingDB] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mapCenter, setMapCenter] = useState(null);
  const [mapGeojson, setMapGeojson] = useState(null);
  const [activeSource, setActiveSource] = useState(""); // 'google' | 'upload' | 'corestack'
  const debounceRef = useRef(null);
  const dropdownRef = useRef(null);

  // CoRE Stack cascading state
  const [csLocations, setCsLocations] = useState(null);
  const [csLoadingLocations, setCsLoadingLocations] = useState(false);
  const [csSelectedState, setCsSelectedState] = useState("");
  const [csSelectedDistrict, setCsSelectedDistrict] = useState("");
  const [csSelectedTehsil, setCsSelectedTehsil] = useState("");
  const [csVillages, setCsVillages] = useState([]);
  const [csLoadingVillages, setCsLoadingVillages] = useState(false);

  // Google Places Autocomplete
  const {
    predictions,
    isLoading: isGoogleLoading,
    search: searchGoogle,
    getPlaceDetails,
    clearPredictions,
  } = usePlacesAutocomplete();

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ─── Google Places Search ───
  const handleGoogleInput = useCallback(
    (e) => {
      const value = e.target.value;
      setSearchQuery(value);
      if (value.length >= 2) {
        searchGoogle(value);
        setShowDropdown(true);
      } else {
        clearPredictions();
        setShowDropdown(false);
      }
    },
    [searchGoogle, clearPredictions],
  );

  const selectGooglePlace = useCallback(
    async (prediction) => {
      setSearchQuery(prediction.main_text);
      setShowDropdown(false);
      clearPredictions();

      const details = await getPlaceDetails(prediction.place_id);
      if (!details) return;

      const area = computeAreaHectares(details.geojson);

      setSelectedBoundary({
        name: details.name,
        state: details.state,
        district: details.district,
        tehsil: details.tehsil,
        area_hectares: area,
      });
      setMapCenter({ lat: details.lat, lng: details.lng });
      setMapGeojson(details.geojson);
      setActiveSource("google");

      onBoundarySelect({
        type: "geojson",
        boundary_geojson: details.geojson,
        village_name: details.name,
        state: details.state,
        district: details.district,
        tehsil: details.tehsil || details.district,
        area_hectares: area,
      });
    },
    [getPlaceDetails, onBoundarySelect, clearPredictions],
  );

  // ─── Built-in DB Search ───
  const handleDBInput = useCallback((e) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.length < 2) {
      setDbResults([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearchingDB(true);
      try {
        const resp = await fetch(
          `${API_BASE}/api/v1/boundaries/autocomplete?q=${encodeURIComponent(value)}`,
        );
        if (resp.ok) {
          const data = await resp.json();
          setDbResults(data.results || []);
          setShowDropdown(true);
        }
      } catch {
        setDbResults([]);
        setShowDropdown(true);
      }
      setIsSearchingDB(false);
    }, 250);
  }, []);

  const selectDBVillage = useCallback(
    async (village) => {
      setSearchQuery(village.name);
      setShowDropdown(false);

      try {
        const resp = await fetch(
          `${API_BASE}/api/v1/boundaries/village/${village.id}`,
        );
        if (resp.ok) {
          const data = await resp.json();

          setSelectedBoundary({
            name: data.name,
            state: data.state,
            district: data.district,
            tehsil: data.tehsil,
            area_hectares: computeAreaHectares(data.geojson),
          });
          setMapCenter({ lat: data.lat, lng: data.lon });
          setMapGeojson(data.geojson);
          setActiveSource("db");

          onBoundarySelect({
            type: "geojson",
            boundary_geojson: data.geojson,
            village_name: data.name,
            state: data.state,
            district: data.district,
            tehsil: data.tehsil,
            area_hectares: computeAreaHectares(data.geojson),
          });
          return;
        }
      } catch {
        /* fallback below */
      }

      // Fallback
      setSelectedBoundary(village);
      setActiveSource("db");
      onBoundarySelect({
        type: "admin",
        boundary_id: village.id,
        village_name: village.name,
        state: village.state,
        district: village.district,
        tehsil: village.tehsil,
      });
    },
    [onBoundarySelect],
  );

  // ─── CoRE Stack Location Picker ───
  useEffect(() => {
    if (activeTab === "corestack" && !csLocations && !csLoadingLocations) {
      setCsLoadingLocations(true);
      getActiveLocations()
        .then((resp) => setCsLocations(resp.data || []))
        .catch(() => setCsLocations([]))
        .finally(() => setCsLoadingLocations(false));
    }
  }, [activeTab, csLocations, csLoadingLocations]);

  const csStates = csLocations || [];
  const csDistricts =
    csStates.find((s) => s.label === csSelectedState)?.district || [];
  const csTehsils =
    csDistricts.find((d) => d.label === csSelectedDistrict)?.blocks || [];

  const handleCsStateChange = (val) => {
    setCsSelectedState(val);
    setCsSelectedDistrict("");
    setCsSelectedTehsil("");
    setCsVillages([]);
  };

  const handleCsDistrictChange = (val) => {
    setCsSelectedDistrict(val);
    setCsSelectedTehsil("");
    setCsVillages([]);
  };

  const handleCsTehsilChange = async (val) => {
    setCsSelectedTehsil(val);
    setCsVillages([]);
    if (!val) return;
    setCsLoadingVillages(true);
    try {
      const resp = await getVillageGeometries(
        csSelectedState,
        csSelectedDistrict,
        val,
      );
      const data = resp.data;
      let features = [];
      if (data?.type === "FeatureCollection") {
        features = data.features || [];
      } else if (Array.isArray(data)) {
        features = data;
      }

      // Deduplicate by village name to avoid repeated entries
      const seen = new Set();
      const unique = features.filter((f) => {
        const name = f?.properties?.vill_name || f?.properties?.name || '';
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });

      setCsVillages(unique);
    } catch {
      setCsVillages([]);
    }
    setCsLoadingVillages(false);
  };

  const selectCsVillage = useCallback(
    (feature) => {
      const props = feature.properties || {};
      const name = props.vill_name || props.name || "Village";
      const geojson = feature.geometry;
      if (!geojson) return;
      const area = computeAreaHectares(geojson);

      setSelectedBoundary({
        name,
        state: csSelectedState,
        district: csSelectedDistrict,
        tehsil: csSelectedTehsil,
        area_hectares: area,
      });

      // Center map on village centroid
      try {
        const coords =
          geojson.type === "MultiPolygon"
            ? geojson.coordinates[0][0]
            : geojson.coordinates[0];
        const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        const avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        setMapCenter({ lat: avgLat, lng: avgLng });
      } catch {
        /* ignore */
      }

      setMapGeojson(geojson);
      setActiveSource("corestack");

      onBoundarySelect({
        type: "geojson",
        boundary_geojson: geojson,
        village_name: name,
        state: csSelectedState,
        district: csSelectedDistrict,
        tehsil: csSelectedTehsil,
        area_hectares: area,
      });
    },
    [csSelectedState, csSelectedDistrict, csSelectedTehsil, onBoundarySelect],
  );

  // ─── GeoJSON Upload ───
  const validateGeoJSON = (geojson) => {
    if (!geojson) return { valid: false, message: "No GeoJSON provided." };
    const type = geojson.type;
    let polygon = null;

    if (type === "FeatureCollection") {
      if (!geojson.features?.length)
        return { valid: false, message: "FeatureCollection has no features." };
      polygon = geojson.features[0].geometry;
    } else if (type === "Feature") {
      polygon = geojson.geometry;
    } else if (["Polygon", "MultiPolygon"].includes(type)) {
      polygon = geojson;
    }

    if (!polygon || !["Polygon", "MultiPolygon"].includes(polygon.type)) {
      return {
        valid: false,
        message: "Must contain a Polygon or MultiPolygon geometry.",
      };
    }

    return {
      valid: true,
      area_hectares: computeAreaHectares(polygon),
      geojson: polygon,
    };
  };

  const handleFileDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const geojson = JSON.parse(ev.target.result);
          setUploadedGeoJSON(geojson);
          const result = validateGeoJSON(geojson);
          setValidationResult(result);

          if (result.valid) {
            setMapGeojson(result.geojson);
            setActiveSource("upload");

            // Compute center from polygon (handle both Polygon and MultiPolygon)
            const coords =
              result.geojson.type === "MultiPolygon"
                ? result.geojson.coordinates[0][0]
                : result.geojson.coordinates[0];
            const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
            const avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
            setMapCenter({ lat: avgLat, lng: avgLng });

            setSelectedBoundary({
              name: "Custom Upload",
              state: "From GeoJSON",
              district: "-",
              tehsil: "-",
              area_hectares: result.area_hectares,
            });

            onBoundarySelect({
              type: "geojson",
              boundary_geojson: result.geojson,
              village_name: "Custom Upload",
              state: "Unknown",
              district: "Unknown",
              tehsil: "Unknown",
              area_hectares: result.area_hectares,
            });
          }
        } catch (err) {
          setValidationResult({
            valid: false,
            message: `Invalid JSON: ${err.message}`,
          });
        }
      };
      reader.readAsText(file);
    },
    [onBoundarySelect],
  );

  // Determine which dropdown to show
  const isGoogleTab = activeTab === "google";

  return (
    <div className="card animate-slide-up">
      <div className="card-header">
        <span className="icon">📍</span>
        <h3>Select Village Boundary</h3>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === "corestack" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("corestack");
            setSearchQuery("");
            setShowDropdown(false);
          }}
        >
          🛰️ CoRE Stack
        </button>
        <button
          className={`tab ${activeTab === "google" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("google");
            setSearchQuery("");
            setShowDropdown(false);
          }}
        >
          🌍 Google Search
        </button>
        <button
          className={`tab ${activeTab === "upload" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("upload");
            setSearchQuery("");
            setShowDropdown(false);
          }}
        >
          📤 Upload
        </button>
      </div>

      {/* Google Places Search */}
      {activeTab === "google" && (
        <div className="animate-fade-in">
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <input
              type="text"
              className="input"
              placeholder="Search any village, town, or place in India…"
              value={searchQuery}
              onChange={handleGoogleInput}
              onFocus={() => predictions.length > 0 && setShowDropdown(true)}
              style={{ width: "100%" }}
              id="google-search-input"
              autoComplete="off"
            />

            {showDropdown && predictions.length > 0 && (
              <div style={dropdownStyle}>
                {predictions.map((p) => (
                  <button
                    key={p.place_id}
                    onClick={() => selectGooglePlace(p)}
                    style={dropdownItemStyle}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(148,163,184,0.08)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <span>
                      <strong>{p.main_text}</strong>
                      <span
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "0.8rem",
                          marginLeft: "0.5rem",
                        }}
                      >
                        {p.secondary_text}
                      </span>
                    </span>
                  </button>
                ))}
                <div
                  style={{
                    padding: "0.5rem",
                    textAlign: "right",
                    fontSize: "0.7rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Powered by Google
                </div>
              </div>
            )}

            {isGoogleLoading && (
              <div
                style={{
                  padding: "0.5rem",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "0.85rem",
                }}
              >
                ⏳ Searching…
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: "0.5rem",
            }}
          >
            🌍 Google Places Autocomplete — search any location in India
          </div>
        </div>
      )}

      {/* Upload Tab */}
      {activeTab === "upload" && (
        <div className="animate-fade-in">
          <div
            className={`drop-zone ${dragActive ? "active" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleFileDrop}
            onClick={() =>
              document.getElementById("geojson-file-input").click()
            }
            id="geojson-drop-zone"
          >
            <div className="icon">🗺️</div>
            <div className="text">
              <strong>Drop GeoJSON file here</strong> or click to browse
              <br />
              <span style={{ fontSize: "0.8rem" }}>
                Accepts .geojson and .json — polygon auto-rendered on map
              </span>
            </div>
          </div>
          <input
            type="file"
            id="geojson-file-input"
            accept=".geojson,.json"
            style={{ display: "none" }}
            onChange={handleFileDrop}
          />

          {validationResult && (
            <div
              className={validationResult.valid ? "boundary-info" : "error-box"}
              style={{ marginTop: "1rem" }}
            >
              {validationResult.valid ? (
                <>
                  <div className="boundary-info-item">
                    <span className="label">Status</span>
                    <span className="value">✅ Valid</span>
                  </div>
                  <div className="boundary-info-item">
                    <span className="label">Area</span>
                    <span className="value">
                      {validationResult.area_hectares} ha
                    </span>
                  </div>
                </>
              ) : (
                <span>❌ {validationResult.message}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* CoRE Stack Location Picker */}
      {activeTab === "corestack" && (
        <div className="animate-fade-in">
          {csLoadingLocations ? (
            <div
              style={{
                padding: "1rem",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              ⏳ Loading CoRE Stack locations…
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {/* State */}
              <select
                className="input"
                value={csSelectedState}
                onChange={(e) => handleCsStateChange(e.target.value)}
                id="cs-state-select"
              >
                <option value="">Select State…</option>
                {csStates.map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>

              {/* District */}
              <select
                className="input"
                value={csSelectedDistrict}
                onChange={(e) => handleCsDistrictChange(e.target.value)}
                disabled={!csSelectedState}
                id="cs-district-select"
              >
                <option value="">Select District…</option>
                {csDistricts.map((d) => (
                  <option key={d.label} value={d.label}>
                    {d.label}
                  </option>
                ))}
              </select>

              {/* Tehsil */}
              <select
                className="input"
                value={csSelectedTehsil}
                onChange={(e) => handleCsTehsilChange(e.target.value)}
                disabled={!csSelectedDistrict}
                id="cs-tehsil-select"
              >
                <option value="">Select Tehsil / Block…</option>
                {csTehsils.map((t) => (
                  <option key={t.label} value={t.label}>
                    {t.label}
                  </option>
                ))}
              </select>

              {/* Villages */}
              {csLoadingVillages && (
                <div
                  style={{
                    padding: "0.5rem",
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  ⏳ Loading villages…
                </div>
              )}
              {csVillages.length > 0 && (
                <div
                  style={{
                    maxHeight: "200px",
                    overflowY: "auto",
                    border: "1px solid rgba(148,163,184,0.15)",
                    borderRadius: "8px",
                  }}
                >
                  {csVillages.map((feat, idx) => {
                    const name =
                      feat.properties?.vill_name ||
                      feat.properties?.name ||
                      `Village ${idx + 1}`;
                    return (
                      <button
                        key={`${feat.properties?.vill_ID || "v"}_${idx}`}
                        onClick={() => selectCsVillage(feat)}
                        style={dropdownItemStyle}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background =
                            "rgba(148,163,184,0.08)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <span>
                          <strong>{name}</strong>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {csSelectedTehsil &&
                !csLoadingVillages &&
                csVillages.length === 0 && (
                  <div
                    style={{
                      padding: "1rem",
                      textAlign: "center",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div
                      style={{
                        color: "var(--text-muted)",
                        marginBottom: "0.75rem",
                      }}
                    >
                      No villages found for this tehsil on CoRE Stack.
                    </div>
                    <button
                      onClick={() => {
                        setActiveTab("google");
                        setSearchQuery("");
                      }}
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(66,133,244,0.15), rgba(66,133,244,0.25))",
                        color: "#4285f4",
                        border: "1px solid rgba(66,133,244,0.3)",
                        padding: "0.5rem 1.25rem",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(66,133,244,0.3)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background =
                          "linear-gradient(135deg, rgba(66,133,244,0.15), rgba(66,133,244,0.25))")
                      }
                    >
                      🌍 Try Google Search instead
                    </button>
                  </div>
                )}
            </div>
          )}
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: "0.5rem",
            }}
          >
            🛰️ Real village boundaries from CoRE Stack active locations
          </div>
        </div>
      )}

      {/* ─── Google Map ─── */}
      <div style={{ marginTop: "1rem" }}>
        <MapView
          geojson={mapGeojson}
          center={mapCenter || { lat: 20.5937, lng: 78.9629 }}
          zoom={mapCenter ? 13 : 5}
          height="320px"
        />
      </div>

      {/* Selected Boundary Info */}
      {selectedBoundary && (
        <div className="boundary-info" style={{ marginTop: "1rem" }}>
          <div className="boundary-info-item">
            <span className="label">Village</span>
            <span className="value">{selectedBoundary.name}</span>
          </div>
          <div className="boundary-info-item">
            <span className="label">State</span>
            <span className="value">{selectedBoundary.state}</span>
          </div>
          <div className="boundary-info-item">
            <span className="label">District</span>
            <span className="value">{selectedBoundary.district}</span>
          </div>
          <div className="boundary-info-item">
            <span className="label">Tehsil</span>
            <span className="value">{selectedBoundary.tehsil}</span>
          </div>
          {selectedBoundary.area_hectares > 0 && (
            <div className="boundary-info-item">
              <span className="label">Area</span>
              <span className="value">{selectedBoundary.area_hectares} ha</span>
            </div>
          )}
          <div className="boundary-info-item">
            <span className="label">Source</span>
            <span
              className="value"
              style={{
                background:
                  activeSource === "google"
                    ? "rgba(66,133,244,0.15)"
                    : "rgba(34,197,94,0.15)",
                color: activeSource === "google" ? "#4285f4" : "#22c55e",
                padding: "0.2rem 0.6rem",
                borderRadius: "6px",
                fontSize: "0.8rem",
              }}
            >
              {activeSource === "corestack"
                ? "🛰️ CoRE Stack"
                : activeSource === "google"
                  ? "🌍 Google Places"
                  : "📤 Upload"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared styles ───
const dropdownStyle = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 100,
  background: "var(--card-bg, #1e293b)",
  border: "1px solid rgba(148,163,184,0.2)",
  borderRadius: "0 0 12px 12px",
  maxHeight: "320px",
  overflowY: "auto",
  boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
  backdropFilter: "blur(20px)",
};

const dropdownItemStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  padding: "0.75rem 1rem",
  border: "none",
  borderBottom: "1px solid rgba(148,163,184,0.1)",
  background: "transparent",
  color: "var(--text-primary, #f1f5f9)",
  cursor: "pointer",
  textAlign: "left",
  transition: "background 0.15s ease",
  fontSize: "0.9rem",
};
