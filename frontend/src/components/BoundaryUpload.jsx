import { useState, useRef } from 'react';
import { analyzeFromGeoJSON } from '../utils/api';
import './BoundaryUpload.css';

export default function BoundaryUpload({ onAnalyticsReady }) {
    const [dragActive, setDragActive] = useState(false);
    const [status, setStatus] = useState(null);
    const fileInputRef = useRef(null);

    const handleFile = async (file) => {
        if (!file) return;

        // Parse the GeoJSON file client-side
        let geojson;
        try {
            const text = await file.text();
            geojson = JSON.parse(text);
        } catch {
            setStatus({ type: 'error', message: 'Invalid JSON — could not parse file.' });
            return;
        }

        const validTypes = ['Feature', 'FeatureCollection', 'Polygon', 'MultiPolygon'];
        if (!validTypes.includes(geojson?.type)) {
            setStatus({ type: 'error', message: `Unsupported GeoJSON type: "${geojson?.type}". Need Feature, FeatureCollection, Polygon, or MultiPolygon.` });
            return;
        }

        setStatus({ type: 'loading', message: 'Clipping raster — computing real analytics…' });

        try {
            const result = await analyzeFromGeoJSON(geojson);
            setStatus({
                type: 'success',
                message: `✅ Computed from LULC TIFF (${result.tiffs_used?.join(', ')}) — ${result.total_area_ha?.toLocaleString()} ha`,
            });
            // Pass both the boundary (for map) and computed analytics to parent
            onAnalyticsReady?.({ geojson, analytics: result });
        } catch (err) {
            setStatus({ type: 'error', message: err.message });
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragActive(false);
        handleFile(e.dataTransfer.files[0]);
    };

    return (
        <div className="boundary-upload">
            <div className="section-header">
                <div className="icon" style={{ background: 'rgba(6,182,212,0.15)' }}>📍</div>
                <div>
                    <h2>Village Boundary</h2>
                    <p>Upload GeoJSON → real LULC raster analytics</p>
                </div>
            </div>

            <div
                className={`drop-zone ${dragActive ? 'drop-zone-active' : ''}`}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onClick={() => fileInputRef.current?.click()}
            >
                <div className="drop-icon">📂</div>
                <p className="drop-text">Drop GeoJSON here or click to browse</p>
                <p className="drop-hint">.geojson or .json • Polygon / MultiPolygon</p>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".geojson,.json"
                    onChange={(e) => handleFile(e.target.files[0])}
                    style={{ display: 'none' }}
                />
            </div>

            {status && (
                <div className={`upload-status upload-status-${status.type}`}>
                    {status.type === 'loading' && <span className="spinner-small"></span>}
                    <span>{status.message}</span>
                </div>
            )}

            <div className="sample-data-notice">
                <span className="notice-icon">ℹ️</span>
                <span>
                    Currently showing <strong>Nallacheruvu</strong> sample data.
                    Upload a boundary to compute analytics from the real LULC TIFF.
                </span>
            </div>

            <div className="tiff-badge">
                <span>🛰️</span>
                <span>LULC v3 IndiaSAT 2023–2024 • 10m resolution • Pan-India</span>
            </div>
        </div>
    );
}
