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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places,geometry&v=weekly`;
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
  activeLayerNames = [],
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  const markerRef = useRef(null);
  const overlaysRef = useRef({});

  // Initialize map
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps().then(() => {
      if (cancelled || !mapRef.current) return;

      const defaultCenter = center || { lat: 22.5, lng: 78.5 }; // Center of India

      mapInstance.current = new window.google.maps.Map(mapRef.current, {
        center: defaultCenter,
        zoom: center ? zoom : 5,
        mapTypeId: "hybrid",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: false,
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

  // Draw polygon when geojson changes — using native GeoJSON Data Layer
  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;
    const map = mapInstance.current;

    // Clear previous GeoJSON features
    map.data.forEach((feature) => map.data.remove(feature));

    if (!geojson?.coordinates?.[0]) return;

    // Wrap raw geometry in a GeoJSON Feature for map.data.addGeoJson
    const featureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: geojson, properties: {} }],
    };

    map.data.addGeoJson(featureCollection);

    // Style the rendered polygon
    map.data.setStyle({
      strokeColor: "#22c55e",
      strokeOpacity: 0.9,
      strokeWeight: 3,
      fillColor: "#22c55e",
      fillOpacity: 0.15,
    });

    // Fit bounds to the rendered geometry
    const bounds = new window.google.maps.LatLngBounds();
    map.data.forEach((feature) => {
      feature.getGeometry().forEachLatLng((latLng) => {
        bounds.extend(latLng);
      });
    });
    map.fitBounds(bounds, 60);
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
  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;

    // Add new layers
    activeLayerNames.forEach((layerName) => {
      if (!overlaysRef.current[layerName]) {
        const layerInfo = layerUrls.find((l) => l.name === layerName);
        if (layerInfo?.url) {
          const overlay = new window.google.maps.ImageMapType({
            getTileUrl: (coord, zoom) => {
              const tileSize = 256;
              const proj = mapInstance.current.getProjection();
              const numTiles = 1 << zoom;
              const sw = proj.fromPointToLatLng(
                new window.google.maps.Point((coord.x * tileSize) / numTiles, ((coord.y + 1) * tileSize) / numTiles)
              );
              const ne = proj.fromPointToLatLng(
                new window.google.maps.Point(((coord.x + 1) * tileSize) / numTiles, (coord.y * tileSize) / numTiles)
              );
              const bbox = `${sw.lng()},${sw.lat()},${ne.lng()},${ne.lat()}`;
              return `${layerInfo.url}&BBOX=${bbox}&WIDTH=${tileSize}&HEIGHT=${tileSize}`;
            },
            tileSize: new window.google.maps.Size(256, 256),
            opacity: 0.6,
            name: layerName,
          });
          mapInstance.current.overlayMapTypes.push(overlay);
          overlaysRef.current[layerName] = overlay;
        }
      }
    });

    // Remove inactive layers
    const overlayTypes = mapInstance.current.overlayMapTypes;
    Object.keys(overlaysRef.current).forEach((layerName) => {
      if (!activeLayerNames.includes(layerName)) {
        for (let i = overlayTypes.getLength() - 1; i >= 0; i--) {
          const ov = overlayTypes.getAt(i);
          if (ov && ov.name === layerName) {
            overlayTypes.removeAt(i);
            break;
          }
        }
        delete overlaysRef.current[layerName];
      }
    });
  }, [activeLayerNames, layerUrls]);

  const isFullScreen = height === "100%";

  return (
    <div style={{ position: "relative", width: "100%", height: isFullScreen ? "100%" : "auto" }}>
      <div
        ref={mapRef}
        style={{
          width: "100%",
          height,
          borderRadius: isFullScreen ? 0 : "12px",
          border: isFullScreen ? "none" : "1px solid var(--border-light)",
          overflow: "hidden",
        }}
      />
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
  // Collect all outer rings
  const rings = geojson.type === "MultiPolygon"
    ? geojson.coordinates.map((poly) => poly[0])
    : [geojson.coordinates[0]];

  // Try Google Maps geodesic computeArea (most accurate — accounts for Earth's curvature)
  if (window.google?.maps?.geometry?.spherical?.computeArea) {
    let totalM2 = 0;
    for (const coords of rings) {
      if (!coords || !Array.isArray(coords[0])) continue;
      const path = coords.map(([lng, lat]) => new window.google.maps.LatLng(lat, lng));
      totalM2 += window.google.maps.geometry.spherical.computeArea(path);
    }
    return Math.round(totalM2 / 10000); // m² → hectares
  }

  // Fallback: Shoelace formula (for when Google Maps isn't loaded yet)
  let totalKm2 = 0;
  for (const coords of rings) {
    if (!coords || !Array.isArray(coords[0])) continue;
    const n = coords.length;
    let areaDeg2 = 0;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[(i + 1) % n];
      areaDeg2 += x1 * y2 - x2 * y1;
    }
    areaDeg2 = Math.abs(areaDeg2) / 2;
    const lats = coords.map((c) => c[1]);
    const avgLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    totalKm2 += areaDeg2 * 111.0 * 111.0 * Math.cos((avgLat * Math.PI) / 180);
  }
  return Math.round(totalKm2 * 100);
}
