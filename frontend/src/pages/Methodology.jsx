import React from 'react';
import './Methodology.css';


export default function Methodology() {
  return (
    <div className="methodology-container">
      <h1 className="meth-title">Methodology &amp; Scientific Transparency</h1>
      <p className="meth-subtitle">
        This page details how CSVAT computes socio-ecological metrics for a village boundary.
        Every number in the report is either directly measured from classified satellite imagery
        or derived through documented spatial analytics.
      </p>

      {/* ─── 1. Data Sources ─── */}
      <Section num="1" title="Data Sources" color="var(--accent-green)">
        <p className="meth-p">CSVAT uses IndiaSAT LULC v3 classified satellite imagery as its primary data source, accessed directly from Google Earth Engine:</p>

        <ComparisonTable />

        <SubSection title="IndiaSAT LULC v3 via GEE (Primary — 10m Resolution)">
          <ul className="meth-ul">
            <li><strong>Provider:</strong> Foundation for Ecological Security (FES) / CoRE Stack, published as GEE assets.</li>
            <li><strong>Satellite Source:</strong> Multi-temporal Sentinel-2 imagery, classified using IndiaSAT algorithms.</li>
            <li><strong>GEE Assets:</strong> <code>projects/corestack-datasets/assets/datasets/LULC_v3_river_basin/</code></li>
            <li><strong>Coverage:</strong> Any Indian village — requires a boundary GeoJSON polygon (from CoRE Stack registry, Places Search, or user upload).</li>
            <li><strong>Classes:</strong> 13 land cover classes (0–12): Built-up, Water (Class 2/3/4), Crops (Single/Double/Triple), Trees, Barren, Scrub, etc.</li>
            <li><strong>CRS:</strong> Downloaded in <strong>EPSG:4326</strong> — same coordinate system as the village boundary GeoJSON, eliminating CRS reprojection errors.</li>
            <li><strong>Processing:</strong> 100% client-side. The backend generates a single signed GEE download URL for the full village bbox per fiscal year. The browser downloads one contiguous GeoTIFF, parses it with <code>geotiff.js</code>, and masks pixels using <code>turf.booleanPointInPolygon</code>.</li>
            <li><strong>Memory Safety:</strong> Years are processed <strong>one at a time</strong> — each GeoTIFF ArrayBuffer is explicitly freed after analytics are extracted, preventing browser OOM crashes.</li>
            <li><strong>Adaptive Resolution:</strong> The backend auto-selects scale (10m → 20m → 30m…) based on the bounding box size to stay under GEE's 48 MB per-request limit. Resolution used is logged in the browser console.</li>
            <li><strong>Storage:</strong> No caching — each GeoTIFF is downloaded, processed, and discarded in sequence.</li>
            <li><strong>Temporal Range:</strong> Agricultural years 2017-18 through 2024-25.</li>
          </ul>
        </SubSection>

        <SubSection title="CoRE Stack Vector API (MWS Path &amp; Server Path)">
          <ul className="meth-ul">
            <li><strong>Provider:</strong> CoRE Stack REST APIs — pre-computed analytics per Micro-Watershed (MWS).</li>
            <li><strong>Data Products:</strong> <code>croppingIntensity_annual</code>, <code>surfaceWaterBodies_annual</code> (with <code>kharif_area_in_ha</code>, <code>rabi_area_in_ha</code>, <code>zaid_area_in_ha</code> per agricultural year), change detection layers.</li>
            <li><strong>Coverage:</strong> Active tehsils only — requires CoRE Stack boundary selection (not available for uploaded GeoJSON boundaries).</li>
            <li><strong>Village-level aggregation:</strong> MWS polygons are intersected with the village boundary using Shapely (Pyodide WASM client-side, or Python server-side). Values are weighted by overlap fraction.</li>
          </ul>
        </SubSection>

        <SubSection title="MODIS/JRC GEE Fallback (500m — Low Resolution)">
          <ul className="meth-ul">
            <li><strong>Triggered when:</strong> User explicitly selects "🌐 Use GEE" in the fallback dialog — only when CoRE Stack has no data for the selected tehsil.</li>
            <li><strong>LULC:</strong> MODIS MCD12Q1 (500m, IGBP classification — 17 land cover classes).</li>
            <li><strong>Water:</strong> JRC Global Surface Water v1.4 (30m — permanent vs. seasonal classification).</li>
            <li><strong>Vegetation:</strong> MODIS MOD13A2 NDVI (500m, 16-day composite).</li>
          </ul>
          <WarningBox>
            MODIS/JRC fallback has fundamentally different classification schemas.
            Cropping intensity and seasonal water breakdowns are estimated via heuristic approximations.
            See Section 5 (Limitations) for details.
          </WarningBox>
        </SubSection>
      </Section>

      {/* ─── 2. Boundary Selection ─── */}
      <Section num="2" title="Boundary Selection &amp; Village Identification" color="var(--accent-blue)">
        <p className="meth-p">Villages are identified through three methods:</p>
        <ul className="meth-ul">
          <li><strong>CoRE Stack Registry:</strong> State → District → Tehsil → Village hierarchy. Village polygons are fetched as GeoJSON from the CoRE Stack API with verified administrative boundaries. Supports all three execution modes (High Accuracy Raster, MWS Vector, Server).</li>
          <li><strong>Places Search (Google Maps):</strong> Search any location in India by name. The polygon for the selected place is confirmed and optionally edited before analysis. Administrative metadata (State, District, Tehsil) is resolved automatically via GEE — see Section 2a below.</li>
          <li><strong>GeoJSON Upload (Pan-India):</strong> Upload any village boundary as a <code>.geojson</code> or <code>.json</code> file. Enables analysis for <em>any</em> Indian village — no CoRE Stack tehsil registration required. Admin metadata is resolved automatically.</li>
        </ul>
        <p className="meth-p">
          For CoRE Stack boundaries, all three execution modes are available.
          For custom boundaries (Places Search or upload), analytics are computed exclusively via the High Accuracy Raster path.
        </p>

        <SubSection title="2a. Automatic Admin Hierarchy Resolution (Custom Boundaries)">
          <p className="meth-p">
            Custom boundaries do not carry State / District / Tehsil metadata. CSVAT resolves these
            automatically using CoRE Stack's own pan-India administrative boundary assets on GEE:
          </p>
          <MetricsTable rows={[
            ['State', 'projects/ext-datasets/assets/datasets/State_pan_india', 'GEE FeatureCollection', 'KML-export format, Name property'],
            ['District', 'projects/ext-datasets/assets/datasets/District_pan_india', 'GEE FeatureCollection', 'KML-export format, Name property'],
            ['Tehsil', 'projects/ext-datasets/assets/datasets/SOI_tehsil', 'GEE FeatureCollection', 'SOI format, TEHSIL property'],
          ]} />
          <p className="meth-p"><strong>Algorithm (3-round bbox drill-down):</strong></p>
          <ol className="meth-ol">
            <li>The browser computes the bounding box of the custom polygon using <code>turf.bbox()</code>.</li>
            <li>For each level (State, District, Tehsil): backend calls <code>FeatureCollection.filterBounds(bbox)</code> on GEE — returns only the ~1-5 overlapping admin features as a tiny GeoJSON (<strong>few KB</strong>, not the full 315 MB dataset).</li>
            <li>Browser runs <code>turf.intersect(customPolygon, candidateFeature)</code> for each candidate and computes <code>turf.area()</code> of the intersection.</li>
            <li>The admin unit with the <strong>maximum intersection area</strong> is selected — correct even when the custom boundary straddles two tehsils.</li>
          </ol>
          <p className="meth-p" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Total browser download: ~70-260 KB across all 3 rounds. All intersection math is client-side (turf.js).
            If any round fails (non-India polygon, network error), that field defaults to blank — the report still renders correctly.
          </p>
        </SubSection>
      </Section>

      {/* ─── 3. Spatial Processing (MWS Path) ─── */}
      <Section num="3" title="Spatial Processing (MWS &amp; Server Path Only)" color="var(--accent-amber)">
        <p className="meth-p">
          This section applies only to the <strong>MWS Vector</strong> and <strong>Server</strong> paths.
          The High Accuracy Raster path skips this step — it works directly with individual pixels inside the village boundary.
        </p>
        <p className="meth-p">
          Village boundaries rarely align with MWS boundaries. CSVAT handles this geometric mismatch
          through polygon intersection and fractional overlap computation.
        </p>

        <SubSection title="Step 1: Polygon Intersection">
          <p className="meth-p">For each MWS polygon M<sub>i</sub> overlapping the village polygon V:</p>
          <FormulaBox>
            f<sub>i</sub> = Area(V ∩ M<sub>i</sub>) / Area(M<sub>i</sub>)
          </FormulaBox>
          <p className="meth-p">
            Where f<sub>i</sub> is the <strong>overlap fraction</strong> — the proportion of MWS <em>i</em> that
            falls within the village. Computed using Shapely (Python WASM via Pyodide client-side, or Python on the server).
          </p>
        </SubSection>

        <SubSection title="Step 2: Weighted Aggregation">
          <p className="meth-p">
            MWS-level values are aggregated to village-level using overlap fractions as weights.
          </p>
          <div className="meth-formula-grid">
            <div className="meth-card">
              <div style={{ fontWeight: 700, color: 'var(--accent-green)', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                Area Metrics (Extensive)
              </div>
              <FormulaBox small>
                X<sub>village</sub> = Σ (x<sub>i</sub> × f<sub>i</sub>)
              </FormulaBox>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                Used for: cropped area (ha), water body area (ha), tree cover area (ha).
              </p>
            </div>

            <div className="meth-card">
              <div style={{ fontWeight: 700, color: 'var(--accent-blue)', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                Index Metrics (Intensive)
              </div>
              <FormulaBox small>
                X<sub>village</sub> = Σ(x<sub>i</sub> × f<sub>i</sub>) / Σ(f<sub>i</sub>)
              </FormulaBox>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                Used for: NDVI mean and similar ratio metrics.
              </p>
            </div>
          </div>
        </SubSection>

        <SubSection title="Example">
          <p className="meth-p">
            A village overlaps 3 MWS polygons with overlap fractions 0.8, 0.3, and 0.15.
            If single-crop areas are 50 ha, 40 ha, and 60 ha respectively:
          </p>
          <FormulaBox>
            Village single-crop = (50 × 0.8) + (40 × 0.3) + (60 × 0.15) = 40 + 12 + 9 = 61 ha
          </FormulaBox>
        </SubSection>
      </Section>

      {/* ─── 4. Analytics Metrics ─── */}
      <Section num="4" title="Analytics Metrics" color="var(--accent-teal)">

        <SubSection title="4.1 Cropping Intensity">
          <p className="meth-p">Measures how many crop cycles occur per year on agricultural land.</p>
          
          <SubSection title="LULC Crop Classes (IndiaSAT v3)">
            <p className="meth-p">
              Crop intensity is classified using specific raster pixel classes from the IndiaSAT LULC dataset:
            </p>
            <MetricsTable rows={[
              ['Class 8', 'Single Crop (Kharif) — cultivated only during monsoon', '—', '—'],
              ['Class 9', 'Single Crop (Non-Kharif) — cultivated only in dry seasons', '—', '—'],
              ['Class 10', 'Double Crop — cultivated twice a year', '—', '—'],
              ['Class 11', 'Triple Crop — cultivated thrice a year', '—', '—'],
            ]} />
          </SubSection>
          
          <MetricsTable rows={[
            ['Single Crop Area', 'Classes 8 and 9 combined', 'ha', 'Pixel count / Weighted sum'],
            ['Double Crop Area', 'Class 10', 'ha', 'Pixel count / Weighted sum'],
            ['Triple Crop Area', 'Class 11', 'ha', 'Pixel count / Weighted sum'],
            ['Total Cropped Area (NSA)', 'Sum of all crop areas', 'ha', 'Derived'],
            ['Intensity Index', 'GCA / NSA (avg crop cycles per unit area)', '—', 'Derived'],
          ]} />
          <SubSection title="Intensity Index Formula (GCA / NSA)">
            <FormulaBox>
              GCA = Single×1 + Double×2 + Triple×3{"\n"}
              NSA = Single + Double + Triple{"\n"}
              Intensity Index = GCA / NSA
            </FormulaBox>
            <p className="meth-p" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
              The Gross Cropped Area (GCA) counts each crop cycle separately.
              The Net Sown Area (NSA) is the total physical area.
              An intensity of 2.0 means on average every hectare is cropped twice per year.
              Both Raster (pixel-level) and MWS paths use this identical formula.
            </p>
          </SubSection>
        </SubSection>

        <SubSection title="4.2 Surface Water Bodies">
          <p className="meth-p">
            Seasonal water body coverage aligned with Indian agricultural seasons.
            CSVAT uses exclusively <strong>pixel-level calculation from the IndiaSAT LULC v3 raster</strong>
            in the High Accuracy path — no MWS vector fallback is applied.
          </p>

          <SubSection title="LULC Water Classes (IndiaSAT v3)">
            <MetricsTable rows={[
              ['Class 2', 'Kharif-only water — present during monsoon, dry in Rabi/Zaid', '—', '—'],
              ['Class 3', 'Kharif + Rabi water — present seasonally, dry in Zaid', '—', '—'],
              ['Class 4', 'Perennial water — present year-round (Kharif + Rabi + Zaid)', '—', '—'],
            ]} />
          </SubSection>

          <SubSection title="Cumulative Seasonal Aggregation Formula">
            <p className="meth-p">
              Water classes are <strong>cumulative</strong> — a higher class includes all lower seasons.
              This means Kharif water includes all water present during the monsoon period (Classes 2+3+4):
            </p>
            <FormulaBox>
              Kharif water area  = (Class 2 pixels + Class 3 pixels + Class 4 pixels) × pixel_area_ha{"\n"}
              Rabi water area    = (Class 3 pixels + Class 4 pixels) × pixel_area_ha{"\n"}
              Zaid water area    = (Class 4 pixels) × pixel_area_ha{"\n"}
              Total unique water = (Class 2 + Class 3 + Class 4 pixels) × pixel_area_ha
            </FormulaBox>
            <p className="meth-p" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
              Total water is the unique area (not summed across seasons — avoids double counting).
              This matches how CoRE Stack MWS API provides <code>kharif_area_in_ha</code>,
              <code>rabi_area_in_ha</code>, and <code>zaid_area_in_ha</code> separately.
            </p>
          </SubSection>

          <MetricsTable rows={[
            ['Kharif Water Area', 'All water during monsoon (Jun–Sep) — Classes 2+3+4', 'ha', 'Pixel count (cumulative)'],
            ['Rabi Water Area', 'Water persisting into winter (Oct–Feb) — Classes 3+4', 'ha', 'Pixel count (cumulative)'],
            ['Zaid / Perennial', 'Perennial water year-round (Mar–May) — Class 4 only', 'ha', 'Pixel count'],
            ['Total Water Area', 'Unique area with any water class (2+3+4, no double-count)', 'ha', 'Derived'],
          ]} />
          <WarningBox>
            Small waterbodies (narrow streams, village ponds) smaller than 10×10 metres may not register
            as a full pixel and will not be captured by this classification. The LULC raster minimum
            detectable water body is approximately 100 m².
          </WarningBox>
        </SubSection>

        <SubSection title="4.3 Vegetation &amp; Tree Cover Change">
          <p className="meth-p">Tree cover change detection between the analysis start and end years.</p>
          <MetricsTable rows={[
            ['Tree Cover Loss', 'Total tree cover lost over analysis period', 'ha', 'Pixel count / Weighted sum'],
            ['Tree Cover Gain', 'Total tree cover gained over analysis period', 'ha', 'Pixel count / Weighted sum'],
            ['Net Change', 'Tree Cover Gain − Tree Cover Loss', 'ha', 'Derived'],
            ['Degraded Land', 'Tree Cover → Barren + Tree Cover → Scrub', 'ha', 'Derived'],
          ]} />
          <p className="meth-p" style={{ fontSize: '0.82rem' }}>
            <strong>Transition classes tracked:</strong> Tree Cover → Tree Cover (stable), Tree Cover → Barren,
            Tree Cover → Built Up, Tree Cover → Farm, Tree Cover → Scrub Land.
          </p>
        </SubSection>

        <SubSection title="4.4 Crop Intensity Change Detection">
          <p className="meth-p">
            Tracks how land transitions between cropping intensity classes over time:
          </p>
          <MetricsTable rows={[
            ['Single → Double', 'Intensification', 'ha', 'Pixel count / Weighted sum'],
            ['Double → Triple', 'Further intensification', 'ha', 'Pixel count / Weighted sum'],
            ['Double → Single', 'De-intensification', 'ha', 'Pixel count / Weighted sum'],
            ['Triple → Single / Double', 'Major de-intensification', 'ha', 'Pixel count / Weighted sum'],
          ]} />
        </SubSection>
      </Section>

      {/* ─── 5. Limitations ─── */}
      <Section num="5" title="Limitations &amp; Known Constraints" color="var(--accent-red)">
        <ul className="meth-ul">
          <li>
            <strong>10m Minimum Pixel Size:</strong> Water bodies or crop patches smaller than
            100 m² (one 10m pixel) will not be captured in the raster path. No sub-pixel correction is applied.
          </li>
          <li>
            <strong>MWS Boundary Misalignment (MWS &amp; Server path):</strong> Village boundaries don't align perfectly
            with MWS polygons. The weighted aggregation introduces small errors at boundary edges —
            typically &lt;5% for compact villages, potentially higher for irregular shapes.
          </li>
          <li>
            <strong>MODIS/JRC GEE Fallback (significant):</strong> When user explicitly selects the
            low-resolution GEE path, MODIS (500m) and JRC (30m) data cannot directly measure:
            <ul className="meth-ul" style={{ marginTop: '0.3rem' }}>
              <li>Single/double/triple cropping — estimated from pixel class ratios</li>
              <li>Kharif/Rabi/Zaid water split — estimated from JRC permanent/seasonal classes</li>
              <li>Tree cover transition types — only net NDVI change, not transition matrices</li>
            </ul>
          </li>
          <li>
            <strong>Temporal Resolution:</strong> CoRE Stack data is aggregated per agricultural year.
            Sub-seasonal events (e.g., mid-season crop failure) may not be captured.
          </li>
          <li>
            <strong>Classification Accuracy:</strong> All remote sensing classification has inherent
            error margins. CoRE Stack's IndiaSAT classification targets &gt;85% accuracy at 10m resolution.
          </li>
        </ul>
      </Section>

      {/* ─── 6. Execution Modes ─── */}
      <Section num="6" title="Execution Modes" color="var(--accent-purple, #8b5cf6)">
        <p className="meth-p">CSVAT supports three execution paths. Uploaded GeoJSON boundaries are restricted to the High Accuracy Raster path. CoRE Stack boundaries support all three:</p>

        <div className="meth-mode-grid">
          <div className="meth-card" style={{ borderColor: '#10b981' }}>
            <div style={{ fontWeight: 700, color: '#10b981', marginBottom: '0.5rem', fontSize: '0.9rem' }}>⚡ High Accuracy Raster</div>
            <ul className="meth-ul" style={{ fontSize: '0.78rem' }}>
              <li><strong>100% browser-side</strong> — server signs GEE URLs only, zero raster data on server</li>
              <li>One <strong>full-village GeoTIFF</strong> per fiscal year</li>
              <li>Years processed <strong>one at a time</strong> — ArrayBuffer freed after each year</li>
              <li><strong>Adaptive resolution</strong>: 10m default</li>
              <li>Parsed with <code>geotiff.js</code>, masked with <code>turf.booleanPointInPolygon</code></li>
              <li>Analytics via <strong>Pyodide (NumPy)</strong> — fast pixel histogram in Python WASM</li>
              <li>Surface water: <strong>pixel-level only</strong> — Classes 2+3+4</li>
              <li><strong>Pan-India</strong> — works for any boundary (upload, Places Search, or CoRE Stack)</li>
              
            </ul>
          </div>
          <div className="meth-card">
            <div style={{ fontWeight: 700, color: '#8b5cf6', marginBottom: '0.5rem', fontSize: '0.9rem' }}>⚡ MWS Vector</div>
            <ul className="meth-ul" style={{ fontSize: '0.78rem' }}>
              <li>Fetches pre-aggregated MWS data from CoRE Stack API</li>
              <li>Village-MWS polygon intersection + weighted aggregation</li>
              <li>Pyodide (Python WASM) computes intersection client-side</li>
              <li>Faster — no GeoTIFF downloads or pixel processing</li>
              <li>Surface water comes from <code>surfaceWaterBodies_annual</code> layer (CoRE Stack pre-computed)</li>
              <li>CoRE Stack boundaries only (active tehsils)</li>
            </ul>
          </div>
          <div className="meth-card">
            <div style={{ fontWeight: 700, color: '#3b82f6', marginBottom: '0.5rem', fontSize: '0.9rem' }}>🖥️ Server</div>
            <ul className="meth-ul" style={{ fontSize: '0.78rem' }}>
              <li>Same computation logic as MWS Vector</li>
              <li>Dispatched to backend Celery workers</li>
              <li>Pipeline: MWS intersection → GEE fallback (if MWS unavailable)</li>
              <li>Good for batch/low-power clients</li>
              <li>CoRE Stack boundaries only (active tehsils)</li>
              <li>No local TIFF processing — server holds no raster data</li>
            </ul>
          </div>
        </div>

        <SubSection title="High Accuracy Full-Village Pipeline — Step by Step">
          <ol className="meth-ol" style={{ fontSize: '0.82rem' }}>
            <li><strong>Bbox Computation:</strong> <code>turf.bbox(villagePolygon)</code> gives the bounding box. The backend uses this to request a single contiguous GeoTIFF covering the full village extent.</li>
            <li><strong>Adaptive Scale Selection:</strong> The backend computes the approximate download size at 10m. If it exceeds GEE's 48 MB hard limit, it steps up to 20m, 30m, etc. until within budget. The chosen resolution is logged to the browser console.</li>
            <li><strong>URL Signing:</strong> Backend calls <code>image.getDownloadURL()</code> for the full bbox at the selected scale in <code>EPSG:4326</code>. Returns a signed GEE URL — no TIFF data touches the server.</li>
            <li><strong>Sequential Year Loop:</strong> For each fiscal year (2017-18 … 2024-25), the browser downloads one GeoTIFF, processes it fully, then <strong>nulls the ArrayBuffer</strong> before the next year begins — preventing accumulation of large buffers in RAM.</li>
            <li><strong>Parse:</strong> <code>geotiff.js</code> decodes the TIFF. The affine transform is derived from the bbox + image dimensions to map pixel indices to geographic coordinates.</li>
            <li><strong>Mask:</strong> For every pixel, the center <code>(lng, lat)</code> is tested with <code>turf.booleanPointInPolygon</code>. Only pixels inside the village boundary are retained.</li>
            <li><strong>Analytics (Pyodide NumPy):</strong> Masked pixel array is passed to a Python WASM environment. <code>numpy.bincount</code> produces the class histogram instantly. Cropping intensity, water areas, and vegetation metrics are computed from the histogram.</li>
            <li><strong>Memory Release:</strong> After each year, the TIFF ArrayBuffer and Pyodide globals are explicitly cleared (<code>pyodide.runPython("del pixels")</code> + <code>buffer = null</code>) before moving to the next year.</li>
          </ol>
        </SubSection>

        <SubSection title="Server Pipeline — Strategy Flow">
          <ol className="meth-ol" style={{ fontSize: '0.82rem' }}>
            <li><strong>Strategy A — MWS Intersection:</strong> Fetch CoRE Stack tehsil data + MWS geometries. Run polygon intersection and weighted aggregation. If successful, return results. <em>(Primary path)</em></li>
            <li><strong>Strategy B — GEE Fallback:</strong> Only triggered if CoRE Stack returns no data for the tehsil, or user explicitly selects GEE. Uses MODIS/JRC at lower resolution. <em>(Fallback only)</em></li>
          </ol>
          
        </SubSection>

        <p className="meth-p" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          All modes use the same GCA/NSA intensity formula and cumulative water class aggregation.
          The report's data source label (e.g., "IndiaSAT LULC v3" vs "CoRE Stack MWS Vector") indicates which source was used for each section.
        </p>
      </Section>

      {/* ─── 7. Village Storyboard ─── */}
      <Section num="7" title="Village Storyboard" color="var(--accent-teal)">
        <p className="meth-p">
          The <strong>Village Storyboard</strong> is a narrative-driven, scroll-based map experience that appears below
          the analytics report for villages that have an associated story in the CSVAT database.
          It is inspired by the Terraso Story Map format.
        </p>

        <SubSection title="How It Works">
          <ul className="meth-ul">
            <li><strong>Story Data Source:</strong> Village narratives are stored in the CSVAT PostgreSQL database (<code>village_stories</code> table), seeded from structured story objects covering demographics, economy, cultural context, and environmental chapters.</li>
            <li><strong>Chapter Structure:</strong> The storyboard merges database content with live analytics:
              <ul className="meth-ul" style={{ marginTop: '0.3rem', marginBottom: '0.3rem' }}>
                <li><strong>Dynamic LLM Chapters:</strong> The first several chapters are generated by an LLM (Qwen 2.5 14B) running on the backend. This AI processes structured census and location data to create vivid, village-specific narratives and selects appropriate map actions.</li>
                <li><strong>Static Analytics Slides:</strong> The final 4 sequence slides (e.g. Cropping, Water, Vegetation) are strictly deterministic. They are generated directly from the live spatial analytics calculated for that village, ensuring no AI hallucinations occur regarding core data.</li>
              </ul>
            </li>
            <li><strong>Scroll-Driven Map:</strong> A sticky map panel shows the village satellite view. An IntersectionObserver tracks which chapter panel is in the viewport and triggers map transitions (zoom, tilt, layer toggle) accordingly.</li>

          </ul>
        </SubSection>

        <SubSection title="Sticky TOC Navigation">
          <p className="meth-p">
            A floating table-of-contents (TOC) navigation bar tracks active chapter progress.
            Clicking a TOC dot scrolls directly to that chapter. The TOC appears only when
            the storyboard section is visible in the viewport.
          </p>
        </SubSection>

        <SubSection title="Data Fallback">
          <p className="meth-p">
            If no village story exists in the database for the selected village, the storyboard
            section is not rendered. The analytics report sections (cropping, water, vegetation) are
            always shown regardless of storyboard availability.
          </p>
        </SubSection>
      </Section>



      <div className="meth-footer">
        CSVAT — CoRE Stack Village Analytics Tool · Last updated April 2026
      </div>
    </div>
  );
}

// ─── Reusable Sub-Components ───

function Section({ num, title, color, children }) {
  return (
    <section className="meth-section">
      <h2 className="meth-section-title" style={{ color, borderBottomColor: color }}>
        {num}. {title}
      </h2>
      {children}
    </section>
  );
}

function SubSection({ title, children }) {
  return (
    <div className="meth-subsection">
      <h3 className="meth-subsection-title">{title}</h3>
      {children}
    </div>
  );
}

function FormulaBox({ children, small }) {
  return (
    <div className={`meth-formula-box${small ? ' small' : ''}`}>
      {children}
    </div>
  );
}

function WarningBox({ children }) {
  return (
    <div className="meth-warning">
      <span style={{ fontWeight: 600, color: '#f59e0b' }}>⚠️ Important: </span>
      {children}
    </div>
  );
}

function ComparisonTable() {
  return (
    <div className="meth-table-wrap">
      <table className="meth-table">
        <thead>
          <tr>
            <th>Attribute</th>
            <th style={{ color: '#10b981' }}>⚡ High Accuracy Raster</th>
            <th style={{ color: '#8b5cf6' }}>⚡ MWS Vector / 🖥️ Server</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Source', 'GEE IndiaSAT LULC v3 (raw pixels)', 'CoRE Stack REST API (pre-aggregated)'],
            ['Resolution', '10m (Sentinel-2 based)', 'MWS-level aggregates (from same 10m source)'],
            ['Spatial unit', 'Individual 10m pixels inside village', 'MWS polygon → weighted fraction to village'],
            ['Crop Classification', 'Classes 8/9 = single, 10 = double, 11 = triple', 'Pre-computed per MWS agricultural year'],
            ['Water Seasons', 'Cumulative Class 2+3+4 → Kharif/Rabi/Zaid', 'kharif/rabi/zaid_area_in_ha per MWS'],
            ['Surface Water Source', 'Pixel-level only (no MWS fallback)', 'surfaceWaterBodies_annual layer'],
            ['Tree Cover', 'Full pixel transition matrix (Class 6)', 'Weighted aggregation'],
            ['Coverage', 'Any village with boundary GeoJSON (pan-India)', 'Active tehsils only'],
            ['Processing location', 'Browser (Pyodide NumPy + geotiff.js) — sequential year-by-year', 'Browser (Pyodide) or Server (Python/Celery)'],
          ].map(([attr, raster, mws], i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{attr}</td>
              <td>{raster}</td>
              <td>{mws}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricsTable({ rows }) {
  return (
    <div className="meth-table-wrap">
      <table className="meth-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Description</th>
            <th>Unit</th>
            <th>Method</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([metric, desc, unit, agg], i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{metric}</td>
              <td>{desc}</td>
              <td style={{ textAlign: 'center' }}>{unit}</td>
              <td>{agg}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
