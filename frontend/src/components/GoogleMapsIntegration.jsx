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

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';

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
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places,geometry&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      mapsLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
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
  activeFiscalYear = null,
  wmsConfig = null,
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
  const wmsOverlayRef = useRef(null);
  const prevFiscalYearRef = useRef(null);
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

      // Add vertex marker
      const marker = new window.google.maps.Marker({
        position: latLng,
        map,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: '#f59e0b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        clickable: false,
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
          fillColor: '#22c55e',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });
    }
  }, [center, zoom, isMapReady]);

  // ─── WMS Fiscal Year Overlay Management (canvas-clipped to polygon) ───
  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps || !isMapReady) return;
    if (!wmsConfig || !activeFiscalYear) {
      // Remove existing WMS overlay if present
      if (wmsOverlayRef.current) {
        const overlayTypes = mapInstance.current.overlayMapTypes;
        for (let i = overlayTypes.getLength() - 1; i >= 0; i--) {
          const ov = overlayTypes.getAt(i);
          if (ov && ov.name === '__wms_lulc') {
            overlayTypes.removeAt(i);
            break;
          }
        }
        wmsOverlayRef.current = null;
        prevFiscalYearRef.current = null;
      }
      return;
    }

    // Skip if same year
    if (prevFiscalYearRef.current === activeFiscalYear) return;
    prevFiscalYearRef.current = activeFiscalYear;

    // Convert fiscal year "2020-21" → "20_21" for the API
    const fyParts = activeFiscalYear.replace(/^20/, '').split('-');
    const fyParam = fyParts.length === 2 ? `${fyParts[0]}_${fyParts[1]}` : activeFiscalYear;

    const { apiBase, district, tehsil } = wmsConfig;
    const tileUrl = `${apiBase}/raster/wms-tile?district=${encodeURIComponent(district)}&tehsil=${encodeURIComponent(tehsil)}&fy=${fyParam}`;

    // Extract polygon coordinates for canvas clipping
    const polyRings = [];
    if (geojson?.coordinates) {
      const rings = geojson.type === 'MultiPolygon'
        ? geojson.coordinates.map(poly => poly[0])
        : [geojson.coordinates[0]];
      rings.forEach(ring => {
        polyRings.push(ring.map(([lng, lat]) => ({ lat, lng })));
      });
    }

    // Remove old overlay
    const overlayTypes = mapInstance.current.overlayMapTypes;
    for (let i = overlayTypes.getLength() - 1; i >= 0; i--) {
      const ov = overlayTypes.getAt(i);
      if (ov && ov.name === '__wms_lulc') {
        overlayTypes.removeAt(i);
        break;
      }
    }

    // Create canvas-clipped WMS tile overlay
    // This clips tiles to the polygon boundary so LULC only shows inside the village
    const clippedMapType = {
      tileSize: new window.google.maps.Size(256, 256),
      name: '__wms_lulc',
      getTile: function(coord, z, ownerDocument) {
        const canvas = ownerDocument.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        canvas.style.width = '256px';
        canvas.style.height = '256px';

        const numTiles = 1 << z;
        // Tile bounds in lat/lng (EPSG:4326)
        const swLng = (coord.x / numTiles) * 360 - 180;
        const neLng = ((coord.x + 1) / numTiles) * 360 - 180;
        const swy = Math.PI - (2 * Math.PI * (coord.y + 1)) / numTiles;
        const ney = Math.PI - (2 * Math.PI * coord.y) / numTiles;
        const swLat = (180 / Math.PI) * Math.atan(Math.sinh(swy));
        const neLat = (180 / Math.PI) * Math.atan(Math.sinh(ney));

        // Quick bounds check: does this tile intersect the polygon at all?
        if (polyRings.length > 0) {
          const polyBounds = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
          polyRings.forEach(ring => {
            ring.forEach(({ lat, lng }) => {
              if (lat < polyBounds.minLat) polyBounds.minLat = lat;
              if (lat > polyBounds.maxLat) polyBounds.maxLat = lat;
              if (lng < polyBounds.minLng) polyBounds.minLng = lng;
              if (lng > polyBounds.maxLng) polyBounds.maxLng = lng;
            });
          });
          // No intersection → return empty canvas
          if (neLng < polyBounds.minLng || swLng > polyBounds.maxLng ||
              neLat < polyBounds.minLat || swLat > polyBounds.maxLat) {
            return canvas;
          }
        }

        const bbox = `${swLng},${swLat},${neLng},${neLat}`;
        const imgUrl = `${tileUrl}&bbox=${bbox}&width=256&height=256`;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const ctx = canvas.getContext('2d');

          // Set up polygon clipping path
          if (polyRings.length > 0) {
            ctx.beginPath();
            polyRings.forEach(ring => {
              ring.forEach(({ lat, lng }, idx) => {
                // Convert lat/lng to pixel within this tile
                const px = ((lng - swLng) / (neLng - swLng)) * 256;
                const py = ((neLat - lat) / (neLat - swLat)) * 256;
                if (idx === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
              });
              ctx.closePath();
            });
            ctx.clip();
          }

          // Draw the WMS tile clipped to the polygon
          ctx.globalAlpha = 0.75;
          ctx.drawImage(img, 0, 0, 256, 256);
        };
        img.onerror = () => {
          // Silently fail — empty canvas is fine
        };
        img.src = imgUrl;

        return canvas;
      },
      releaseTile: function(canvas) {
        // Clean up canvas
        canvas.width = 0;
        canvas.height = 0;
      },
    };

    overlayTypes.push(clippedMapType);
    wmsOverlayRef.current = clippedMapType;
  }, [activeFiscalYear, wmsConfig, geojson, isMapReady]);

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
        componentRestrictions: { country: 'in' }, // India only
        types: ['locality', 'sublocality', 'administrative_area_level_3'], // Villages/towns
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
              secondary_text: r.structured_formatting?.secondary_text || '',
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
