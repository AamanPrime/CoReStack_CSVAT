/**
 * CSVAT — Slide Editor Component.
 *
 * Modal for creating/editing custom data story slides.
 * Features:
 *   - Slide list sidebar (add, delete, reorder)
 *   - Editor form (title, image URL, description)
 *   - Interactive map picker with Places search for background
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getCustomSlides, createCustomSlide, updateCustomSlide, deleteCustomSlide } from '../services/api';
import { loadGoogleMaps } from './GoogleMapsIntegration';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

function getStaticMapUrl(lat, lng, zoom = 14) {
  if (lat == null || lng == null) return null;
  return `${API_BASE}/api/v1/maps/static?center=${lat},${lng}&zoom=${zoom}&size=1280x900&maptype=satellite`;
}

/**
 * MapPicker — Interactive satellite map for selecting background area.
 */
function MapPicker({ lat, lng, zoom, onChange }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(() => {
      if (cancelled || !mapRef.current) return;
      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: lat || 20.5937, lng: lng || 78.9629 },
        zoom: zoom || 14,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
      });
      mapInstanceRef.current = map;

      // Places search
      if (searchRef.current) {
        const autocomplete = new window.google.maps.places.Autocomplete(searchRef.current, {
          types: ['geocode', 'establishment'],
        });
        autocomplete.bindTo('bounds', map);
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (place.geometry?.location) {
            map.setCenter(place.geometry.location);
            map.setZoom(15);
          }
        });
      }

      // Capture center+zoom on idle
      map.addListener('idle', () => {
        const c = map.getCenter();
        const z = map.getZoom();
        if (c && onChange) {
          onChange({ lat: c.lat(), lng: c.lng(), zoom: z });
        }
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Update map if props change externally
  useEffect(() => {
    if (mapInstanceRef.current && lat != null && lng != null) {
      const currentCenter = mapInstanceRef.current.getCenter();
      if (Math.abs(currentCenter.lat() - lat) > 0.001 || Math.abs(currentCenter.lng() - lng) > 0.001) {
        mapInstanceRef.current.setCenter({ lat, lng });
        mapInstanceRef.current.setZoom(zoom || 14);
      }
    }
  }, [lat, lng, zoom]);

  return (
    <div className="se-map-picker">
      <input
        ref={searchRef}
        type="text"
        className="se-map-search"
        placeholder="🔍 Search location..."
      />
      <div ref={mapRef} className="se-map-canvas" />
    </div>
  );
}

/**
 * SlideEditor — Main modal component.
 */
export default function SlideEditor({ villageName, onClose, onSave }) {
  const [slides, setSlides] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load slides from DB
  useEffect(() => {
    if (!villageName) return;
    setLoading(true);
    getCustomSlides(villageName)
      .then((data) => {
        setSlides(data);
        setActiveIdx(data.length > 0 ? 0 : -1);
      })
      .catch((err) => {
        console.error('Failed to load custom slides:', err);
        setSlides([]);
        setActiveIdx(-1);
      })
      .finally(() => setLoading(false));
  }, [villageName]);

  const activeSlide = activeIdx >= 0 && activeIdx < slides.length ? slides[activeIdx] : null;

  // ─── Handlers ───

  const handleAdd = async () => {
    try {
      const newSlide = await createCustomSlide({
        village_name: villageName,
        title: 'New Chapter',
        description: '',
        image_url: '',
        slide_order: slides.length,
        map_center_lat: 20.5937,
        map_center_lng: 78.9629,
        map_zoom: 14,
      });
      setSlides((prev) => [...prev, newSlide]);
      setActiveIdx(slides.length);
    } catch (err) {
      console.error('Failed to create slide:', err);
    }
  };

  const handleDelete = async (idx) => {
    const slide = slides[idx];
    if (!slide?.id) return;
    try {
      await deleteCustomSlide(slide.id);
      setSlides((prev) => prev.filter((_, i) => i !== idx));
      setActiveIdx((prev) => Math.max(0, Math.min(prev, slides.length - 2)));
    } catch (err) {
      console.error('Failed to delete slide:', err);
    }
  };

  const handleFieldChange = (field, value) => {
    setSlides((prev) =>
      prev.map((s, i) => (i === activeIdx ? { ...s, [field]: value } : s))
    );
  };

  const handleMapChange = ({ lat, lng, zoom }) => {
    setSlides((prev) =>
      prev.map((s, i) =>
        i === activeIdx
          ? { ...s, map_center_lat: lat, map_center_lng: lng, map_zoom: zoom }
          : s
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = [];
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const result = await updateCustomSlide(s.id, {
          title: s.title,
          description: s.description,
          image_url: s.image_url || '',
          slide_order: i,
          map_center_lat: s.map_center_lat,
          map_center_lng: s.map_center_lng,
          map_zoom: s.map_zoom,
        });
        updated.push(result);
      }
      setSlides(updated);
      if (onSave) onSave(updated);
      if (onClose) onClose();
    } catch (err) {
      console.error('Failed to save slides:', err);
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const previewUrl = activeSlide
    ? getStaticMapUrl(activeSlide.map_center_lat, activeSlide.map_center_lng, activeSlide.map_zoom)
    : null;

  return (
    <div className="se-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="se-modal">
        {/* Header */}
        <div className="se-header">
          <h2>✏️ Story Editor</h2>
          <span className="se-header-village">{villageName}</span>
          <button className="se-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="se-body">
          {/* Sidebar — slide list */}
          <div className="se-sidebar">
            <div className="se-sidebar-label">Slides</div>
            {loading ? (
              <div className="se-loading">Loading...</div>
            ) : (
              slides.map((slide, idx) => (
                <div
                  key={slide.id || idx}
                  className={`se-slide-thumb ${idx === activeIdx ? 'se-slide-thumb--active' : ''}`}
                  onClick={() => setActiveIdx(idx)}
                >
                  <span className="se-slide-num">{idx + 1}</span>
                  <span className="se-slide-title">{slide.title || 'Untitled'}</span>
                  <button
                    className="se-slide-delete"
                    onClick={(e) => { e.stopPropagation(); handleDelete(idx); }}
                    title="Delete slide"
                  >✕</button>
                </div>
              ))
            )}
            <button className="se-add-btn" onClick={handleAdd}>
              ➕ Add Slide
            </button>
          </div>

          {/* Editor form */}
          <div className="se-form">
            {activeSlide ? (
              <>
                <div className="se-field">
                  <label className="se-label">Title</label>
                  <input
                    type="text"
                    className="se-input"
                    value={activeSlide.title || ''}
                    onChange={(e) => handleFieldChange('title', e.target.value)}
                    placeholder="Chapter title..."
                  />
                </div>

                <div className="se-field">
                  <label className="se-label">Image URL <span className="se-optional">(optional)</span></label>
                  <input
                    type="text"
                    className="se-input"
                    value={activeSlide.image_url || ''}
                    onChange={(e) => handleFieldChange('image_url', e.target.value)}
                    placeholder="https://example.com/image.jpg"
                  />
                  {activeSlide.image_url && (
                    <img
                      className="se-image-preview"
                      src={activeSlide.image_url}
                      alt="Preview"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                </div>

                <div className="se-field">
                  <label className="se-label">Description</label>
                  <textarea
                    className="se-textarea"
                    value={activeSlide.description || ''}
                    onChange={(e) => handleFieldChange('description', e.target.value)}
                    placeholder="Write the narrative for this chapter..."
                    rows={5}
                  />
                </div>

                <div className="se-field">
                  <label className="se-label">Background Map</label>
                  <p className="se-hint">Search a location or pan/zoom the map to select the satellite background for this slide.</p>
                  <MapPicker
                    lat={activeSlide.map_center_lat}
                    lng={activeSlide.map_center_lng}
                    zoom={activeSlide.map_zoom}
                    onChange={handleMapChange}
                  />
                  {previewUrl && (
                    <div className="se-map-preview">
                      <div className="se-map-preview-label">Background Preview</div>
                      <img src={previewUrl} alt="Map preview" className="se-map-preview-img" />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="se-empty">
                <p>No slides yet. Click <strong>➕ Add Slide</strong> to create your first chapter.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer / actions */}
        <div className="se-footer">
          <button className="se-btn se-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className="se-btn se-btn-save"
            onClick={handleSave}
            disabled={saving || slides.length === 0}
          >
            {saving ? 'Saving...' : `Save ${slides.length} Slide${slides.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
