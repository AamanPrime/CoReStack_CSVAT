import React from 'react';

export default function Methodology() {
    return (
        <div className="methodology-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', color: 'var(--text-primary)', overflowY: 'auto', maxHeight: 'calc(100vh - 60px)' }}>
            <h1 style={{ color: 'var(--accent-teal)', marginBottom: '1.5rem' }}>Methodology & Scientific Transparency</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: '1.6' }}>
                This page details how the CSVAT computes socio-ecological metrics for a village boundary. We prioritize accuracy and scientific rigor by integrating with the CoRE Stack and employing spatial analytics.
            </p>

            <section style={{ marginBottom: '2rem' }}>
                <h2 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem', color: 'var(--accent-green)' }}>1. Data Sources</h2>
                <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
                    <li><strong>CoRE Stack APIs:</strong> We fetch verified spatial and analytical datasets from the CoRE Stack to ensure high-fidelity measurements.</li>
                    <li><strong>Village Boundaries:</strong> Provided via GeoJSON upload or selected from the CoRE Stack registry.</li>
                    <li><strong>Micro-watersheds (MWS):</strong> Hydrological units mapped inside the CoRE Stack, providing detailed local terrain and ecological attributes.</li>
                </ul>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem', color: 'var(--accent-blue)' }}>2. Spatial Processing</h2>
                <p style={{ lineHeight: '1.6', marginBottom: '1rem' }}>
                    When raw high-resolution raster layers (10m) are available, we prioritize <strong>Raw Raster Processing</strong>:
                    <br />
                    <em>Village polygon &rarr; Download local raster layers &rarr; Clip raster to village &rarr; Compute statistics from raw pixels.</em>
                    <br />
                    This is the most accurate method because it perfectly aligns with the exact village boundaries, preventing edge-case errors.
                </p>
                <p style={{ lineHeight: '1.6' }}>
                    If local rasters are not available, we use <strong>MWS Polygons Intersection</strong>:
                    <br />
                    We detect all Micro-watersheds (MWS) that intersect the village geometry. Since MWS boundaries may not align perfectly with village boundaries, we compute the fractional overlap area.
                </p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem', color: 'var(--accent-amber)' }}>3. Aggregation Method</h2>
                <p style={{ lineHeight: '1.6', marginBottom: '1rem' }}>
                    To convert MWS-level data into village-level metrics, we use a <strong>weighted average based on intersection area</strong>.
                </p>
                <div style={{ background: 'var(--glass)', padding: '1rem', borderRadius: '8px', fontFamily: 'monospace', marginBottom: '1rem' }}>
                    Village Metric = &sum;(MWS_value &times; intersection_area) / &sum;intersection_area
                </div>
                <p style={{ lineHeight: '1.6' }}>
                    For extensive properties (like total hectares of single-cropped land), we simply sum the overlap areas:
                    <br />
                    <em>&sum;(MWS_area_value &times; overlap_fraction)</em>
                </p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem', color: 'var(--accent-red)' }}>4. Limitations & Fallback</h2>
                <ul style={{ paddingLeft: '1.5rem', lineHeight: '1.8' }}>
                    <li>
                        <strong>Precomputed Attributes Error:</strong> When raw raster data is not used, averaging MWS precomputed attributes can introduce slight errors due to boundary misalignment.
                    </li>
                    <li>
                        <strong>GEE Fallback Dataset:</strong> When a tehsil is not active on CoRE Stack, we fall back to Google Earth Engine (MODIS 500m data).
                        Measurements are <em>approximate</em> due to lower resolution. We also limit these fallback metrics to annual statistics rather than seasonal.
                    </li>
                </ul>
            </section>
        </div>
    );
}
