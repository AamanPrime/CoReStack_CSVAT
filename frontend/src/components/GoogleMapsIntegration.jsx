/**
 * CSVAT — Google Maps Integration.
 *
 * Provides:
 *   1. Dynamic Google Maps script loader
 *   2. MapView React component (shows polygon + satellite view)
 *   3. Places Autocomplete hook (live village search)
 *   4. Geometry helpers (place → bounding box for GEE)
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';

// ─── Script Loader (new functional API — @googlemaps/js-api-loader v2+) ───
// setOptions() configures the key; importLibrary() injects the Maps script
// and returns the named library. All must use the loader's importLibrary,
// not window.google.maps.importLibrary, until the script is injected.

let mapsLoaded = false;
let mapsLoadPromise = null;

// Configure the loader once (idempotent — must be called before importLibrary)
setOptions({
  key: MAPS_KEY,
  v: 'weekly',
});

export function loadGoogleMaps() {
  if (mapsLoaded && window.google?.maps) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;

  // Use the loader's importLibrary() — this injects the Maps script on first call.
  // Do NOT call window.google.maps.importLibrary() here; google doesn't exist yet.
  mapsLoadPromise = Promise.all([
    importLibrary('maps'),
    importLibrary('places'),
    importLibrary('geometry'),
    importLibrary('marker'),
  ]).then(() => {
    mapsLoaded = true;
  }).catch(err => {
    mapsLoadPromise = null; // Allow retry on failure
    throw err;
  });

  return mapsLoadPromise;
}

// ─── MapView Component ───

export function MapView({
  geojson,
  center,
  zoom = 13,
  height = '350px',
  onMapClick,
  layerUrls = [],
  activeLayerNames = [],
  interactive = true,
  maskOutside = false,
  outlineColor = "#22c55e",
  editable = false,
  drawMode = false,
  onGeojsonEdit = null,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const polygonRef = useRef(null);
  const [isMapReady, setIsMapReady] = useState(false);

  const markerRef = useRef(null);
  const overlaysRef = useRef({});
  const drawingRef = useRef({ polygon: null, clickListener: null, markers: [] });

  // Initialize map
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps().then(() => {
      if (cancelled || !mapRef.current) return;

      const defaultCenter = center || { lat: 22.5, lng: 78.5 }; // Center of India

      mapInstance.current = new window.google.maps.Map(mapRef.current, {
        center: defaultCenter,
        zoom: center ? zoom : 5,
        mapTypeId: 'hybrid',
        mapId: 'DEMO_MAP_ID', // Required for AdvancedMarkerElement
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
        gestureHandling: interactive ? 'auto' : 'cooperative',
        keyboardShortcuts: interactive,
        disableDefaultUI: false,
      });

      // Click handler for placing markers
      if (onMapClick) {
        mapInstance.current.addListener('click', (e) => {
          const latLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          onMapClick(latLng);
        });
      }

      setIsMapReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Draw polygon when geojson changes
  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;
    const map = mapInstance.current;

    // Clear previous: manual polygons (mask mode) and GeoJSON data layer (standard mode)
    if (polygonRef.current) {
      if (Array.isArray(polygonRef.current)) {
        polygonRef.current.forEach((p) => p.setMap(null));
      } else {
        polygonRef.current.setMap(null);
      }
      polygonRef.current = null;
    }
    map.data.forEach((feature) => map.data.remove(feature));

    if (!geojson?.coordinates?.[0]) return;

    const bounds = new window.google.maps.LatLngBounds();

    if (maskOutside) {
      // ── Mask mode: manual Polygons (world-rect with hole) ──
      const rings =
        geojson.type === "MultiPolygon"
          ? geojson.coordinates.map((poly) => poly[0])
          : [geojson.coordinates[0]];

      const worldCoords = [
        { lat: -85, lng: -180 },
        { lat: 85, lng: -180 },
        { lat: 85, lng: 180 },
        { lat: -85, lng: 180 },
        { lat: -85, lng: 0 },
      ];

      const holePaths = rings.map((ring) => {
        const path = ring.map(([lng, lat]) => {
          bounds.extend({ lat, lng });
          return { lat, lng };
        });
        return path.reverse();
      });

      const maskPolygon = new window.google.maps.Polygon({
        paths: [worldCoords, ...holePaths],
        strokeWeight: 0,
        fillColor: "#111827",
        fillOpacity: 1.0,
        map,
      });

      const outlinePolygons = holePaths.map((path) => new window.google.maps.Polygon({
        paths: path,
        strokeColor: outlineColor,
        strokeOpacity: 1,
        strokeWeight: 3,
        fillOpacity: 0,
        map,
      }));

      polygonRef.current = [maskPolygon, ...outlinePolygons];
      map.fitBounds(bounds, 10);
    } else if (editable && onGeojsonEdit) {
      // ── Editable mode: manual Polygon with draggable vertices ──
      const rings =
        geojson.type === "MultiPolygon"
          ? geojson.coordinates.map((poly) => poly[0])
          : [geojson.coordinates[0]];

      const paths = rings.map((ring) =>
        ring.map(([lng, lat]) => {
          bounds.extend({ lat, lng });
          return { lat, lng };
        })
      );

      const editablePoly = new window.google.maps.Polygon({
        paths: paths[0], // Use first ring for editable
        strokeColor: '#f59e0b',
        strokeOpacity: 1,
        strokeWeight: 2.5,
        fillColor: '#f59e0b',
        fillOpacity: 0.12,
        editable: true,
        draggable: true,
        map,
      });

      // Listen for vertex changes
      const emitEdit = () => {
        const updatedGeojson = _extractGeojsonFromPolygon(editablePoly);
        if (updatedGeojson) onGeojsonEdit(updatedGeojson);
      };
      const path = editablePoly.getPath();
      window.google.maps.event.addListener(path, 'set_at', emitEdit);
      window.google.maps.event.addListener(path, 'insert_at', emitEdit);
      window.google.maps.event.addListener(path, 'remove_at', emitEdit);
      window.google.maps.event.addListener(editablePoly, 'dragend', emitEdit);

      polygonRef.current = editablePoly;
      map.fitBounds(bounds, 60);
    } else {
      // ── Standard mode: native GeoJSON Data Layer ──
      const featureCollection = {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: geojson, properties: {} }],
      };

      map.data.addGeoJson(featureCollection);

      map.data.setStyle({
        strokeColor: "#22c55e",
        strokeOpacity: 0.9,
        strokeWeight: 3,
        fillColor: "#22c55e",
        fillOpacity: 0.15,
      });

      map.data.forEach((feature) => {
        feature.getGeometry().forEachLatLng((latLng) => {
          bounds.extend(latLng);
        });
      });
      map.fitBounds(bounds, 60);
    }
  }, [geojson, isMapReady, editable]);

  // ── Draw Polygon Mode ──
  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps || !isMapReady) return;
    const map = mapInstance.current;
    const dr = drawingRef.current;

    // Clean up previous drawing state
    if (dr.clickListener) {
      window.google.maps.event.removeListener(dr.clickListener);
      dr.clickListener = null;
    }
    if (dr.polygon) {
      dr.polygon.setMap(null);
      dr.polygon = null;
    }
    dr.markers.forEach(m => m.setMap(null));
    dr.markers = [];

    if (!drawMode || !onGeojsonEdit) return;

    // Clear any existing geojson rendering
    if (polygonRef.current) {
      if (Array.isArray(polygonRef.current)) {
        polygonRef.current.forEach((p) => p.setMap(null));
      } else {
        polygonRef.current.setMap(null);
      }
      polygonRef.current = null;
    }
    map.data.forEach((feature) => map.data.remove(feature));

    // Change cursor to crosshair
    map.setOptions({ draggableCursor: 'crosshair' });

    const vertices = [];
    let previewPoly = null;

    const updatePreview = () => {
      if (previewPoly) previewPoly.setMap(null);
      if (vertices.length < 2) return;

      previewPoly = new window.google.maps.Polygon({
        paths: vertices,
        strokeColor: '#f59e0b',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        strokeDashArray: [8, 4],
        fillColor: '#f59e0b',
        fillOpacity: 0.08,
        editable: false,
        map,
      });
    };

    dr.clickListener = map.addListener('click', (e) => {
      const latLng = e.latLng;
      vertices.push({ lat: latLng.lat(), lng: latLng.lng() });

      // Add vertex marker using AdvancedMarkerElement
      const markerDiv = document.createElement('div');
      markerDiv.style.width = '12px';
      markerDiv.style.height = '12px';
      markerDiv.style.borderRadius = '50%';
      markerDiv.style.backgroundColor = '#f59e0b';
      markerDiv.style.border = '2px solid #ffffff';
      markerDiv.style.boxSizing = 'border-box';

      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        position: latLng,
        map,
        content: markerDiv,
        gmpClickable: false,
      });
      dr.markers.push(marker);

      updatePreview();

      // Emit partial GeoJSON (at least 3 points to make a polygon)
      if (vertices.length >= 3) {
        const coords = vertices.map(v => [v.lng, v.lat]);
        coords.push(coords[0]); // Close ring
        onGeojsonEdit({
          type: 'Polygon',
          coordinates: [coords],
        });
      }
    });

    dr.polygon = previewPoly;

    return () => {
      map.setOptions({ draggableCursor: null });
      if (dr.clickListener) {
        window.google.maps.event.removeListener(dr.clickListener);
        dr.clickListener = null;
      }
      if (previewPoly) previewPoly.setMap(null);
      // Don't clear markers on cleanup — they stay until drawMode changes
    };
  }, [drawMode, isMapReady]);

  // Update stroke and fill color dynamically when outlineColor changes
  useEffect(() => {
    if (!polygonRef.current) return;
    const polygons = Array.isArray(polygonRef.current) 
      ? polygonRef.current 
      : [polygonRef.current];

    polygons.forEach((poly, index) => {
      // If maskOutside is true, the first polygon is the dark mask — skip it.
      if (maskOutside && index === 0) return;
      
      poly.setOptions({
        strokeColor: outlineColor,
        ...(maskOutside ? {} : { fillColor: outlineColor })
      });
    });
  }, [outlineColor, maskOutside]);

  // Update center when it changes
  useEffect(() => {
    if (!mapInstance.current || !center) return;
    mapInstance.current.panTo(center);
    mapInstance.current.setZoom(zoom);

    // Update/create marker using AdvancedMarkerElement
    if (markerRef.current) {
      markerRef.current.position = center;
    } else if (window.google?.maps?.marker) {
      const centerMarkerDiv = document.createElement('div');
      centerMarkerDiv.style.width = '16px';
      centerMarkerDiv.style.height = '16px';
      centerMarkerDiv.style.borderRadius = '50%';
      centerMarkerDiv.style.backgroundColor = '#22c55e';
      centerMarkerDiv.style.border = '2px solid #ffffff';
      centerMarkerDiv.style.boxSizing = 'border-box';

      markerRef.current = new window.google.maps.marker.AdvancedMarkerElement({
        position: center,
        map: mapInstance.current,
        content: centerMarkerDiv,
      });
    }
  }, [center, zoom, isMapReady]);

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

              // Earth Engine tile format ({z}/{x}/{y})
              if (layerInfo.isGEE || layerInfo.url.includes('{z}')) {
                return layerInfo.url
                  .replace('{x}', coord.x)
                  .replace('{y}', coord.y)
                  .replace('{z}', zoom);
              }

              // WMS layer: Google Tile coordinates to EPSG:3857 Web Mercator
              const originShift = 20037508.342789244;
              const res = (originShift * 2) / tileSize / Math.pow(2, zoom);
              const minX = (coord.x * tileSize) * res - originShift;
              const maxY = originShift - (coord.y * tileSize) * res;
              const maxX = ((coord.x + 1) * tileSize) * res - originShift;
              const minY = originShift - ((coord.y + 1) * tileSize) * res;
              const bbox = `${minX},${minY},${maxX},${maxY}`;
              const separator = layerInfo.url.includes('?') ? '&' : '?';
              return `${layerInfo.url}${separator}BBOX=${bbox}&WIDTH=${tileSize}&HEIGHT=${tileSize}`;
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
  }, [activeLayerNames, layerUrls, isMapReady]);

  const isFullScreen = height === '100%';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: isFullScreen ? '100%' : 'auto',
      }}
    >
      <div
        ref={mapRef}
        style={{
          width: '100%',
          height,
          borderRadius: isFullScreen ? 0 : '12px',
          border: isFullScreen ? 'none' : '1px solid var(--border-light)',
          overflow: 'hidden',
        }}
      />
    </div>
  );
}

// ─── Places Autocomplete Hook ───

export function usePlacesAutocomplete() {
  const [predictions, setPredictions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const sessionTokenRef = useRef(null);
  const geocoderRef = useRef(null);
  const placesLibRef = useRef(null);

  useEffect(() => {
    loadGoogleMaps().then(() => {
      if (window.google?.maps?.places) {
        placesLibRef.current = window.google.maps.places;
        geocoderRef.current = new window.google.maps.Geocoder();
        sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
      }
    });
  }, []);

  const search = useCallback(async (query) => {
    if (!query || query.length < 2 || !placesLibRef.current?.AutocompleteSuggestion) {
      setPredictions([]);
      return;
    }

    setIsLoading(true);

    try {
      const request = {
        input: query,
        includedRegionCodes: ['in'], // India only
        includedPrimaryTypes: ['locality', 'sublocality', 'administrative_area_level_3'],
        sessionToken: sessionTokenRef.current,
      };

      const response = await placesLibRef.current.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

      if (response && response.suggestions) {
        setPredictions(
          response.suggestions.map((s) => {
            const placePrediction = s.placePrediction;
            return {
              place_id: placePrediction.placeId,
              description: placePrediction.text.text,
              main_text: placePrediction.text.text,
              // Fallback to empty string for secondary text as text.text usually contains the full formatted address
              secondary_text: '',
            };
          })
        );
      } else {
        setPredictions([]);
      }
    } catch (error) {
      console.warn("Places search error (new API):", error);
      setPredictions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getPlaceDetails = useCallback(async (placeId) => {
    if (!geocoderRef.current) return null;

    return new Promise((resolve) => {
      geocoderRef.current.geocode({ placeId }, (results, status) => {
        if (status === 'OK' && results?.[0]) {
          const result = results[0];
          const loc = result.geometry.location;
          const viewport = result.geometry.viewport;

          // Extract address components
          const components = result.address_components || [];
          const getComponent = (type) =>
            components.find((c) => c.types.includes(type))?.long_name || '';

          const lat = loc.lat();
          const lng = loc.lng();

          // Generate bounding box from viewport or fixed size
          let geojson;
          if (viewport) {
            const ne = viewport.getNorthEast();
            const sw = viewport.getSouthWest();
            geojson = {
              type: 'Polygon',
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
              type: 'Polygon',
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
              getComponent('locality') ||
              getComponent('sublocality') ||
              result.formatted_address.split(',')[0],
            state: getComponent('administrative_area_level_1'),
            district: getComponent('administrative_area_level_2'),
            tehsil:
              getComponent('administrative_area_level_3') ||
              getComponent('sublocality_level_1'),
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

// ─── Polygon → GeoJSON Helper ───

function _extractGeojsonFromPolygon(polygon) {
  const path = polygon.getPath();
  if (!path || path.getLength() < 3) return null;
  const coords = [];
  for (let i = 0; i < path.getLength(); i++) {
    const pt = path.getAt(i);
    coords.push([pt.lng(), pt.lat()]);
  }
  coords.push(coords[0]); // Close ring
  return { type: 'Polygon', coordinates: [coords] };
}

// ─── Geometry Helpers ───

export function computeAreaHectares(geojson) {
  if (!geojson?.coordinates?.[0]) return 0;
  // Collect all outer rings
  const rings =
    geojson.type === 'MultiPolygon'
      ? geojson.coordinates.map((poly) => poly[0])
      : [geojson.coordinates[0]];

  // Try Google Maps geodesic computeArea (most accurate — accounts for Earth's curvature)
  if (window.google?.maps?.geometry?.spherical?.computeArea) {
    let totalM2 = 0;
    for (const coords of rings) {
      if (!coords || !Array.isArray(coords[0])) continue;
      const path = coords.map(
        ([lng, lat]) => new window.google.maps.LatLng(lat, lng),
      );
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
