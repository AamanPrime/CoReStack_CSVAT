/**
 * CSVAT — Google Maps Integration.
 *
 * Provides:
 *   1. Dynamic Google Maps script loader
 *   2. MapView React component (shows polygon + satellite view)
 *   3. Places Autocomplete hook (live village search)
 *   4. Geometry helpers (place → bounding box for GEE)
 */
import React, { useEffect, useRef, useState, useCallback } from "react";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || "";

// ─── Script Loader ───

let mapsLoaded = false;
let mapsLoadPromise = null;

function loadGoogleMaps() {
  if (mapsLoaded && window.google?.maps) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) {
      mapsLoaded = true;
      resolve();
      return;
    }

    // Use the new Google Maps JavaScript API loading
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      mapsLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });

  return mapsLoadPromise;
}

// ─── MapView Component ───

export function MapView({
  geojson,
  center,
  zoom = 13,
  height = "350px",
  onMapClick,
  layerUrls = [],
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const polygonRef = useRef(null);
  const markerRef = useRef(null);
  const overlaysRef = useRef({});
  const [visibleLayers, setVisibleLayers] = useState({});

  // Initialize map
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps().then(() => {
      if (cancelled || !mapRef.current) return;

      const defaultCenter = center || { lat: 22.5, lng: 78.5 }; // Center of India

      mapInstance.current = new window.google.maps.Map(mapRef.current, {
        center: defaultCenter,
        zoom: center ? zoom : 5,
        mapTypeId: "hybrid", // Satellite + labels
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: window.google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          mapTypeIds: ["roadmap", "satellite", "hybrid", "terrain"],
        },
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        styles: [
          {
            featureType: "all",
            elementType: "labels.text.fill",
            stylers: [{ color: "#ffffff" }],
          },
          {
            featureType: "all",
            elementType: "labels.text.stroke",
            stylers: [{ color: "#000000" }, { weight: 2 }],
          },
        ],
      });

      // Click handler for placing markers
      if (onMapClick) {
        mapInstance.current.addListener("click", (e) => {
          const latLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          onMapClick(latLng);
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Draw polygon when geojson changes
  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;

    // Clear previous polygon(s)
    if (polygonRef.current) {
      if (Array.isArray(polygonRef.current)) {
        polygonRef.current.forEach((p) => p.setMap(null));
      } else {
        polygonRef.current.setMap(null);
      }
      polygonRef.current = null;
    }

    if (!geojson?.coordinates?.[0]) return;

    // Collect all outer rings: MultiPolygon has multiple polygons, Polygon has one
    const rings =
      geojson.type === "MultiPolygon"
        ? geojson.coordinates.map((poly) => poly[0]) // outer ring of each polygon
        : [geojson.coordinates[0]]; // single outer ring

    const bounds = new window.google.maps.LatLngBounds();
    const polygons = rings.map((ring) => {
      const coords = ring.map(([lng, lat]) => ({ lat, lng }));
      coords.forEach((c) => bounds.extend(c));
      return new window.google.maps.Polygon({
        paths: coords,
        strokeColor: "#22c55e",
        strokeOpacity: 0.9,
        strokeWeight: 3,
        fillColor: "#22c55e",
        fillOpacity: 0.15,
        map: mapInstance.current,
      });
    });

    polygonRef.current = polygons;

    // Fit bounds to all polygons
    mapInstance.current.fitBounds(bounds, 60);
  }, [geojson]);

  // Update center when it changes
  useEffect(() => {
    if (!mapInstance.current || !center) return;
    mapInstance.current.panTo(center);
    mapInstance.current.setZoom(zoom);

    // Update/create marker
    if (markerRef.current) {
      markerRef.current.setPosition(center);
    } else if (window.google?.maps) {
      markerRef.current = new window.google.maps.Marker({
        position: center,
        map: mapInstance.current,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#22c55e",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
    }
  }, [center, zoom]);

  // ─── Layer Overlay Management ───
  const toggleLayer = useCallback((layerName) => {
    setVisibleLayers((prev) => {
      const next = { ...prev, [layerName]: !prev[layerName] };

      if (!mapInstance.current || !window.google?.maps) return next;

      if (next[layerName]) {
        // Add overlay
        const layer = layerUrls.find((l) => l.name === layerName);
        if (layer?.url) {
          const overlay = new window.google.maps.ImageMapType({
            getTileUrl: (coord, zoom) => {
              const tileSize = 256;
              const proj = mapInstance.current.getProjection();
              const numTiles = 1 << zoom;
              const worldCoord = proj.fromPointToLatLng(
                new window.google.maps.Point(
                  (coord.x * tileSize) / numTiles,
                  (coord.y * tileSize) / numTiles
                )
              );
              // Build WMS request
              const sw = proj.fromPointToLatLng(
                new window.google.maps.Point(
                  (coord.x * tileSize) / numTiles,
                  ((coord.y + 1) * tileSize) / numTiles
                )
              );
              const ne = proj.fromPointToLatLng(
                new window.google.maps.Point(
                  ((coord.x + 1) * tileSize) / numTiles,
                  (coord.y * tileSize) / numTiles
                )
              );
              const bbox = `${sw.lng()},${sw.lat()},${ne.lng()},${ne.lat()}`;
              return `${layer.url}&BBOX=${bbox}&WIDTH=${tileSize}&HEIGHT=${tileSize}`;
            },
            tileSize: new window.google.maps.Size(256, 256),
            opacity: 0.6,
            name: layerName,
          });
          mapInstance.current.overlayMapTypes.push(overlay);
          overlaysRef.current[layerName] = overlay;
        }
      } else {
        // Remove overlay
        const overlayTypes = mapInstance.current.overlayMapTypes;
        for (let i = overlayTypes.getLength() - 1; i >= 0; i--) {
          const ov = overlayTypes.getAt(i);
          if (ov && ov.name === layerName) {
            overlayTypes.removeAt(i);
            break;
          }
        }
        delete overlaysRef.current[layerName];
      }

      return next;
    });
  }, [layerUrls]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={mapRef}
        style={{
          width: "100%",
          height,
          borderRadius: "12px",
          border: "1px solid rgba(148,163,184,0.2)",
          overflow: "hidden",
        }}
      />
      {/* ─── Layer Toggle Panel ─── */}
      {layerUrls.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            background: "rgba(15, 23, 42, 0.9)",
            backdropFilter: "blur(12px)",
            borderRadius: "10px",
            padding: "0.6rem 0.8rem",
            border: "1px solid rgba(148,163,184,0.2)",
            zIndex: 10,
            minWidth: "160px",
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.4rem",
            }}
          >
            🗺️ Layers
          </div>
          {layerUrls.map((layer) => (
            <label
              key={layer.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                cursor: "pointer",
                padding: "0.25rem 0",
                fontSize: "0.8rem",
                color: visibleLayers[layer.name] ? "#22c55e" : "#cbd5e1",
                transition: "color 0.2s",
              }}
            >
              <input
                type="checkbox"
                checked={!!visibleLayers[layer.name]}
                onChange={() => toggleLayer(layer.name)}
                style={{ accentColor: "#22c55e", cursor: "pointer" }}
              />
              {layer.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Places Autocomplete Hook ───

export function usePlacesAutocomplete() {
  const [predictions, setPredictions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const serviceRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const geocoderRef = useRef(null);

  useEffect(() => {
    loadGoogleMaps().then(() => {
      if (window.google?.maps?.places) {
        serviceRef.current =
          new window.google.maps.places.AutocompleteService();
        geocoderRef.current = new window.google.maps.Geocoder();
        sessionTokenRef.current =
          new window.google.maps.places.AutocompleteSessionToken();
      }
    });
  }, []);

  const search = useCallback((query) => {
    if (!query || query.length < 2 || !serviceRef.current) {
      setPredictions([]);
      return;
    }

    setIsLoading(true);

    serviceRef.current.getPlacePredictions(
      {
        input: query,
        componentRestrictions: { country: "in" }, // India only
        types: ["locality", "sublocality", "administrative_area_level_3"], // Villages/towns
        sessionToken: sessionTokenRef.current,
      },
      (results, status) => {
        setIsLoading(false);
        if (
          status === window.google.maps.places.PlacesServiceStatus.OK &&
          results
        ) {
          setPredictions(
            results.map((r) => ({
              place_id: r.place_id,
              description: r.description,
              main_text: r.structured_formatting?.main_text || r.description,
              secondary_text: r.structured_formatting?.secondary_text || "",
            })),
          );
        } else {
          setPredictions([]);
        }
      },
    );
  }, []);

  const getPlaceDetails = useCallback(async (placeId) => {
    if (!geocoderRef.current) return null;

    return new Promise((resolve) => {
      geocoderRef.current.geocode({ placeId }, (results, status) => {
        if (status === "OK" && results?.[0]) {
          const result = results[0];
          const loc = result.geometry.location;
          const viewport = result.geometry.viewport;

          // Extract address components
          const components = result.address_components || [];
          const getComponent = (type) =>
            components.find((c) => c.types.includes(type))?.long_name || "";

          const lat = loc.lat();
          const lng = loc.lng();

          // Generate bounding box from viewport or fixed size
          let geojson;
          if (viewport) {
            const ne = viewport.getNorthEast();
            const sw = viewport.getSouthWest();
            geojson = {
              type: "Polygon",
              coordinates: [
                [
                  [sw.lng(), sw.lat()],
                  [ne.lng(), sw.lat()],
                  [ne.lng(), ne.lat()],
                  [sw.lng(), ne.lat()],
                  [sw.lng(), sw.lat()],
                ],
              ],
            };
          } else {
            // Default ~5km bounding box
            const d = 0.025;
            geojson = {
              type: "Polygon",
              coordinates: [
                [
                  [lng - d, lat - d],
                  [lng + d, lat - d],
                  [lng + d, lat + d],
                  [lng - d, lat + d],
                  [lng - d, lat - d],
                ],
              ],
            };
          }

          // Reset session token after place selection
          sessionTokenRef.current =
            new window.google.maps.places.AutocompleteSessionToken();

          resolve({
            name:
              getComponent("locality") ||
              getComponent("sublocality") ||
              result.formatted_address.split(",")[0],
            state: getComponent("administrative_area_level_1"),
            district: getComponent("administrative_area_level_2"),
            tehsil:
              getComponent("administrative_area_level_3") ||
              getComponent("sublocality_level_1"),
            lat,
            lng,
            geojson,
            formatted_address: result.formatted_address,
          });
        } else {
          resolve(null);
        }
      });
    });
  }, []);

  const clearPredictions = useCallback(() => setPredictions([]), []);

  return { predictions, isLoading, search, getPlaceDetails, clearPredictions };
}

// ─── Geometry Helpers ───

export function computeAreaHectares(geojson) {
  if (!geojson?.coordinates?.[0]) return 0;
  // For MultiPolygon, coordinates[0][0] is the outer ring of the first polygon
  const coords =
    geojson.type === "MultiPolygon"
      ? geojson.coordinates[0][0]
      : geojson.coordinates[0];
  if (!coords || !Array.isArray(coords[0])) return 0;
  const lats = coords.map((c) => c[1]);
  const lons = coords.map((c) => c[0]);
  const dLat = Math.max(...lats) - Math.min(...lats);
  const dLon = Math.max(...lons) - Math.min(...lons);
  const kmLat = dLat * 111;
  const avgLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kmLon = dLon * 111 * Math.cos((avgLat * Math.PI) / 180);
  return Math.round(kmLat * kmLon * 100);
}
