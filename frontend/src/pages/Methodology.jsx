import React from 'react';

export default function Methodology() {
  return (
    <div className="methodology-container" style={{ padding: '2rem 2.5rem', maxWidth: '900px', margin: '0 auto', color: 'var(--text-primary)', overflowY: 'auto', maxHeight: 'calc(100vh - 60px)' }}>
      <h1 style={{ color: 'var(--accent-teal)', marginBottom: '0.5rem', fontSize: '1.8rem' }}>Methodology &amp; Scientific Transparency</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: '1.7', fontSize: '0.95rem' }}>
        This page details how CSVAT computes socio-ecological metrics for a village boundary.
        Every number in the report is either directly measured from classified satellite imagery
        or derived through documented spatial analytics — no AI-generated estimates.
      </p>

      {/* ─── 1. Data Sources ─── */}
      <Section num="1" title="Data Sources" color="var(--accent-green)">
        <p style={pStyle}>CSVAT uses IndiaSAT LULC v3 classified satellite imagery as its primary data source, accessed directly from Google Earth Engine:</p>

        <ComparisonTable />

        <SubSection title="IndiaSAT LULC v3 via GEE (Primary — 10m Resolution)">
          <ul style={ulStyle}>
            <li><strong>Provider:</strong> Foundation for Ecological Security (FES) / CoRE Stack, published as GEE assets.</li>
            <li><strong>Satellite Source:</strong> Multi-temporal Sentinel-2 imagery, classified using IndiaSAT algorithms.</li>
            <li><strong>GEE Assets:</strong> <code>projects/corestack-datasets/assets/datasets/LULC_v3_river_basin/</code></li>
            <li><strong>Coverage:</strong> Any Indian village — requires a boundary GeoJSON polygon (from CoRE Stack registry or user upload).</li>
            <li><strong>Classes:</strong> 13 land cover classes (0–12): Built-up, Water (Class 2/3/4), Crops (Single/Double/Triple), Trees, Barren, Scrub, etc.</li>
            <li><strong>CRS:</strong> Downloaded in <strong>EPSG:4326</strong> at 10m scale — same coordinate system as the village boundary GeoJSON, eliminating any CRS reprojection.</li>
            <li><strong>Processing:</strong> 100% client-side. Village boundary is split into ~1 km² spatial tiles. Each tile's GeoTIFF is downloaded via a signed GEE URL, parsed with <code>geotiff.js</code>, and masked using <code>turf.booleanPointInPolygon</code>.</li>
            <li><strong>Storage:</strong> Raw TIFF tiles are cached in browser <strong>IndexedDB</strong> for instant re-analysis. Auto-cleanup purges tiles from the 6th oldest village onward.</li>
            <li><strong>Temporal Range:</strong> agricultural years 2017-18 through 2024-25.</li>
          </ul>
        </SubSection>

        <SubSection title="CoRE Stack Vector API (MWS Path &amp; Server Path)">
          <ul style={ulStyle}>
            <li><strong>Provider:</strong> CoRE Stack REST APIs — pre-computed analytics per Micro-Watershed (MWS).</li>
            <li><strong>Data Products:</strong> <code>croppingIntensity_annual</code>, <code>surfaceWaterBodies_annual</code> (with <code>kharif_area_in_ha</code>, <code>rabi_area_in_ha</code>, <code>zaid_area_in_ha</code> per agricultural year), change detection layers.</li>
            <li><strong>Coverage:</strong> Active tehsils only — requires CoRE Stack boundary selection (not available for uploaded GeoJSON boundaries).</li>
            <li><strong>Village-level aggregation:</strong> MWS polygons are intersected with the village boundary using Shapely (Pyodide WASM client-side, or Python server-side). Values are weighted by overlap fraction.</li>
          </ul>
        </SubSection>

        <SubSection title="MODIS/JRC GEE Fallback (500m — Low Resolution)">
          <ul style={ulStyle}>
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
        <p style={pStyle}>Villages are identified through two methods:</p>
        <ul style={ulStyle}>
          <li><strong>CoRE Stack Registry:</strong> State → District → Tehsil → Village hierarchy. Village polygons are fetched as GeoJSON from the CoRE Stack API with verified administrative boundaries. Supports all three execution modes (High Accuracy Raster, MWS Vector, Server).</li>
          <li><strong>GeoJSON Upload (Pan-India):</strong> Users can upload any village boundary GeoJSON file. This mode bypasses CoRE Stack location selection and routes directly to the High Accuracy Raster path, enabling analysis for <em>any</em> Indian village — no tehsil registration required.</li>
        </ul>
        <p style={pStyle}>
          For CoRE Stack boundaries, either pixel-level raster analysis or MWS vector aggregation can be used.
          For uploaded boundaries, analytics are computed entirely from raster pixel data via GEE — no MWS intersection is available.
        </p>
      </Section>

      {/* ─── 3. Spatial Processing (MWS Path) ─── */}
      <Section num="3" title="Spatial Processing (MWS &amp; Server Path Only)" color="var(--accent-amber)">
        <p style={pStyle}>
          This section applies only to the <strong>MWS Vector</strong> and <strong>Server</strong> paths.
          The High Accuracy Raster path skips this step — it works directly with individual pixels inside the village boundary.
        </p>
        <p style={pStyle}>
          Village boundaries rarely align with MWS boundaries. CSVAT handles this geometric mismatch
          through polygon intersection and fractional overlap computation.
        </p>

        <SubSection title="Step 1: Polygon Intersection">
          <p style={pStyle}>For each MWS polygon M<sub>i</sub> overlapping the village polygon V:</p>
          <FormulaBox>
            f<sub>i</sub> = Area(V ∩ M<sub>i</sub>) / Area(M<sub>i</sub>)
          </FormulaBox>
          <p style={pStyle}>
            Where f<sub>i</sub> is the <strong>overlap fraction</strong> — the proportion of MWS <em>i</em> that
            falls within the village. Computed using Shapely (Python WASM via Pyodide client-side, or Python on the server).
          </p>
        </SubSection>

        <SubSection title="Step 2: Weighted Aggregation">
          <p style={pStyle}>
            MWS-level values are aggregated to village-level using overlap fractions as weights.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', margin: '1rem 0' }}>
            <div style={formulaCardStyle}>
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

            <div style={formulaCardStyle}>
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
          <p style={pStyle}>
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
          <p style={pStyle}>Measures how many crop cycles occur per year on agricultural land.</p>
          
          <SubSection title="LULC Crop Classes (IndiaSAT v3)">
            <p style={pStyle}>
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
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
              The Gross Cropped Area (GCA) counts each crop cycle separately.
              The Net Sown Area (NSA) is the total physical area.
              An intensity of 2.0 means on average every hectare is cropped twice per year.
              Both Raster (pixel-level) and MWS paths use this identical formula.
            </p>
          </SubSection>
        </SubSection>

        <SubSection title="4.2 Surface Water Bodies">
          <p style={pStyle}>
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
            <p style={pStyle}>
              Water classes are <strong>cumulative</strong> — a higher class includes all lower seasons.
              This means Kharif water includes all water present during the monsoon period (Classes 2+3+4):
            </p>
            <FormulaBox>
              Kharif water area  = (Class 2 pixels + Class 3 pixels + Class 4 pixels) × pixel_area_ha{"\n"}
              Rabi water area    = (Class 3 pixels + Class 4 pixels) × pixel_area_ha{"\n"}
              Zaid water area    = (Class 4 pixels) × pixel_area_ha{"\n"}
              Total unique water = (Class 2 + Class 3 + Class 4 pixels) × pixel_area_ha
            </FormulaBox>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
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
          <p style={pStyle}>Tree cover change detection between the analysis start and end years.</p>
          <MetricsTable rows={[
            ['Tree Cover Loss', 'Total tree cover lost over analysis period', 'ha', 'Pixel count / Weighted sum'],
            ['Tree Cover Gain', 'Total tree cover gained over analysis period', 'ha', 'Pixel count / Weighted sum'],
            ['Net Change', 'Tree Cover Gain − Tree Cover Loss', 'ha', 'Derived'],
            ['Degraded Land', 'Tree Cover → Barren + Tree Cover → Scrub', 'ha', 'Derived'],
          ]} />
          <p style={{ ...pStyle, fontSize: '0.82rem' }}>
            <strong>Transition classes tracked:</strong> Tree Cover → Tree Cover (stable), Tree Cover → Barren,
            Tree Cover → Built Up, Tree Cover → Farm, Tree Cover → Scrub Land.
          </p>
        </SubSection>

        <SubSection title="4.4 Crop Intensity Change Detection">
          <p style={pStyle}>
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
        <ul style={ulStyle}>
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
            <ul style={{ ...ulStyle, marginTop: '0.3rem' }}>
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
        <p style={pStyle}>CSVAT supports three execution paths. Uploaded GeoJSON boundaries are restricted to the High Accuracy Raster path. CoRE Stack boundaries support all three:</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', margin: '1rem 0' }}>
          <div style={{ ...formulaCardStyle, borderColor: '#10b981' }}>
            <div style={{ fontWeight: 700, color: '#10b981', marginBottom: '0.5rem', fontSize: '0.9rem' }}>⚡ High Accuracy Raster</div>
            <ul style={{ ...ulStyle, fontSize: '0.78rem' }}>
              <li><strong>100% browser-side</strong> — server never stores TIFF data</li>
              <li>Village bbox split into ~1 km² tiles</li>
              <li>Backend signs GEE download URLs only</li>
              <li>Browser downloads GeoTIFFs in EPSG:4326 at 10m</li>
              <li>Parsed with <code>geotiff.js</code>, masked with <code>turf.booleanPointInPolygon</code></li>
              <li>Tiles cached in IndexedDB</li>
              <li>Analytics in Pyodide (Python WASM)</li>
              <li>Surface water: <strong>pixel-level only</strong> — Classes 2+3+4 (no MWS fallback)</li>
              <li><strong>Pan-India</strong> — works for any boundary (upload or CoRE Stack)</li>
              <li><strong>Privacy:</strong> all geospatial data stays in your browser</li>
            </ul>
          </div>
          <div style={formulaCardStyle}>
            <div style={{ fontWeight: 700, color: '#8b5cf6', marginBottom: '0.5rem', fontSize: '0.9rem' }}>⚡ MWS Vector</div>
            <ul style={{ ...ulStyle, fontSize: '0.78rem' }}>
              <li>Fetches pre-aggregated MWS data from CoRE Stack API</li>
              <li>Village-MWS polygon intersection + weighted aggregation</li>
              <li>Pyodide (Python WASM) computes intersection client-side</li>
              <li>Faster — no raster tile downloads</li>
              <li>Surface water comes from <code>surfaceWaterBodies_annual</code> layer (CoRE Stack pre-computed)</li>
              <li>CoRE Stack boundaries only (active tehsils)</li>
            </ul>
          </div>
          <div style={formulaCardStyle}>
            <div style={{ fontWeight: 700, color: '#3b82f6', marginBottom: '0.5rem', fontSize: '0.9rem' }}>🖥️ Server</div>
            <ul style={{ ...ulStyle, fontSize: '0.78rem' }}>
              <li>Same computation logic as MWS Vector</li>
              <li>Dispatched to backend Celery workers</li>
              <li>Pipeline: MWS intersection → GEE fallback (if MWS unavailable)</li>
              <li>Good for batch/low-power clients</li>
              <li>CoRE Stack boundaries only (active tehsils)</li>
              <li>No local TIFF processing — server holds no raster data</li>
            </ul>
          </div>
        </div>

        <SubSection title="High Accuracy Tiled Pipeline — Step by Step">
          <ol style={{ ...ulStyle, fontSize: '0.82rem' }}>
            <li><strong>Tile Grid:</strong> The village bounding box is split into a grid of ~1 km² tiles using <code>@turf/turf</code>. Small villages (&lt;1 km²) get a single tile.</li>
            <li><strong>URL Signing:</strong> For each tile × agricultural year, the backend calls <code>image.getDownloadURL()</code> with the tile's bbox, <code>EPSG:4326</code>, and <code>scale=10</code>. It returns a signed GEE URL — no TIFF data touches the server.</li>
            <li><strong>Download:</strong> The browser downloads up to 4 tiles concurrently. Raw <code>ArrayBuffer</code>s are stored in IndexedDB for caching.</li>
            <li><strong>Parse:</strong> Each tile is parsed with <code>geotiff.js</code>. The affine transform is computed from the tile bbox + image dimensions.</li>
            <li><strong>Mask:</strong> For every pixel, the center coordinate (lng, lat) is tested against the village polygon using <code>turf.booleanPointInPolygon</code>. Only pixels inside the boundary are counted.</li>
            <li><strong>Merge:</strong> Pixel histograms from all tiles are combined into a single year result.</li>
            <li><strong>Analytics:</strong> The merged histogram feeds into the Pyodide analytics engine — cropping intensity (Classes 8/9/10/11), water (Classes 2/3/4 cumulative), vegetation (Class 6 transitions).</li>
          </ol>
        </SubSection>

        <SubSection title="Server Pipeline — Strategy Flow">
          <ol style={{ ...ulStyle, fontSize: '0.82rem' }}>
            <li><strong>Strategy A — MWS Intersection:</strong> Fetch CoRE Stack tehsil data + MWS geometries. Run polygon intersection and weighted aggregation. If successful, return results. <em>(Primary path)</em></li>
            <li><strong>Strategy B — GEE Fallback:</strong> Only triggered if CoRE Stack returns no data for the tehsil, or user explicitly selects GEE. Uses MODIS/JRC at lower resolution. <em>(Fallback only)</em></li>
          </ol>
          
        </SubSection>

        <p style={{ ...pStyle, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          All modes use the same GCA/NSA intensity formula and cumulative water class aggregation.
          The report's data source label (e.g., "IndiaSAT LULC v3" vs "CoRE Stack MWS Vector") indicates which source was used for each section.
        </p>
      </Section>

      {/* ─── 7. Village Storyboard ─── */}
      <Section num="7" title="Village Storyboard" color="var(--accent-teal)">
        <p style={pStyle}>
          The <strong>Village Storyboard</strong> is a narrative-driven, scroll-based map experience that appears below
          the analytics report for villages that have an associated story in the CSVAT database.
          It is inspired by the Terraso Story Map format.
        </p>

        <SubSection title="How It Works">
          <ul style={ulStyle}>
            <li><strong>Story Data Source:</strong> Village narratives are stored in the CSVAT PostgreSQL database (<code>village_stories</code> table), seeded from structured story objects covering demographics, economy, cultural context, and environmental chapters.</li>
            <li><strong>Chapter Structure:</strong> The storyboard merges database content with live analytics:
              <ul style={{ ...ulStyle, marginTop: '0.3rem', marginBottom: '0.3rem' }}>
                <li><strong>Dynamic LLM Chapters:</strong> The first several chapters are generated by an LLM (Qwen 2.5 14B) running on the backend. This AI processes structured census and location data to create vivid, village-specific narratives and selects appropriate map actions.</li>
                <li><strong>Static Analytics Slides:</strong> The final 4 sequence slides (e.g. Cropping, Water, Vegetation) are strictly deterministic. They are generated directly from the live spatial analytics calculated for that village, ensuring no AI hallucinations occur regarding core data.</li>
              </ul>
            </li>
            <li><strong>Scroll-Driven Map:</strong> A sticky map panel shows the village satellite view. An IntersectionObserver tracks which chapter panel is in the viewport and triggers map transitions (zoom, tilt, layer toggle) accordingly.</li>

          </ul>
        </SubSection>

        <SubSection title="Sticky TOC Navigation">
          <p style={pStyle}>
            A floating table-of-contents (TOC) navigation bar tracks active chapter progress.
            Clicking a TOC dot scrolls directly to that chapter. The TOC appears only when
            the storyboard section is visible in the viewport.
          </p>
        </SubSection>

        <SubSection title="Data Fallback">
          <p style={pStyle}>
            If no village story exists in the database for the selected village, the storyboard
            section is not rendered. The analytics report sections (cropping, water, vegetation) are
            always shown regardless of storyboard availability.
          </p>
        </SubSection>
      </Section>



      <div style={{ textAlign: 'center', padding: '2rem 0 1rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
        CSVAT — CoRE Stack Village Analytics Tool · Last updated April 2026
      </div>
    </div>
  );
}

// ─── Reusable Sub-Components ───

const pStyle = { lineHeight: '1.7', marginBottom: '0.75rem', fontSize: '0.9rem' };
const ulStyle = { paddingLeft: '1.5rem', lineHeight: '1.8', marginBottom: '0.75rem', fontSize: '0.9rem' };
const formulaCardStyle = {
  background: 'var(--glass, rgba(255,255,255,0.03))',
  border: '1px solid var(--border, #334155)',
  borderRadius: '10px',
  padding: '1rem',
};

function Section({ num, title, color, children }) {
  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <h2 style={{
        borderBottom: `2px solid ${color}`,
        paddingBottom: '0.5rem',
        marginBottom: '1rem',
        color: color,
        fontSize: '1.2rem',
      }}>
        {num}. {title}
      </h2>
      {children}
    </section>
  );
}

function SubSection({ title, children }) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function FormulaBox({ children, small }) {
  return (
    <div style={{
      background: 'var(--glass, rgba(255,255,255,0.03))',
      border: '1px solid var(--border, #334155)',
      padding: small ? '0.6rem' : '0.85rem 1rem',
      borderRadius: '8px',
      fontFamily: '"Fira Code", "JetBrains Mono", monospace',
      fontSize: small ? '0.82rem' : '0.9rem',
      color: 'var(--text-primary)',
      textAlign: 'center',
      letterSpacing: '0.02em',
      whiteSpace: 'pre-line',
    }}>
      {children}
    </div>
  );
}

function WarningBox({ children }) {
  return (
    <div style={{
      background: 'rgba(245, 158, 11, 0.06)',
      border: '1px solid rgba(245, 158, 11, 0.2)',
      borderRadius: '8px',
      padding: '0.75rem 1rem',
      marginTop: '0.75rem',
      fontSize: '0.82rem',
      lineHeight: '1.6',
      color: 'var(--text-secondary)',
    }}>
      <span style={{ fontWeight: 600, color: '#f59e0b' }}>⚠️ Important: </span>
      {children}
    </div>
  );
}

function ComparisonTable() {
  const cellStyle = { padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border, #334155)', fontSize: '0.82rem' };
  const headerStyle = { ...cellStyle, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--glass, rgba(255,255,255,0.03))' };

  return (
    <div style={{ overflowX: 'auto', margin: '1rem 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--border, #334155)', borderRadius: '8px' }}>
        <thead>
          <tr>
            <th style={headerStyle}>Attribute</th>
            <th style={{ ...headerStyle, color: '#10b981' }}>⚡ High Accuracy Raster</th>
            <th style={{ ...headerStyle, color: '#8b5cf6' }}>⚡ MWS Vector / 🖥️ Server</th>
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
            ['Processing location', 'Browser (Pyodide WASM + geotiff.js)', 'Browser (Pyodide) or Server (Python/Celery)'],
          ].map(([attr, raster, mws], i) => (
            <tr key={i}>
              <td style={{ ...cellStyle, fontWeight: 500 }}>{attr}</td>
              <td style={cellStyle}>{raster}</td>
              <td style={cellStyle}>{mws}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricsTable({ rows }) {
  const cellStyle = { padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border, #334155)', fontSize: '0.82rem' };
  const headerStyle = { ...cellStyle, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--glass, rgba(255,255,255,0.03))', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.03em' };

  return (
    <div style={{ overflowX: 'auto', margin: '0.75rem 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--border, #334155)' }}>
        <thead>
          <tr>
            <th style={headerStyle}>Metric</th>
            <th style={headerStyle}>Description</th>
            <th style={headerStyle}>Unit</th>
            <th style={headerStyle}>Method</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([metric, desc, unit, agg], i) => (
            <tr key={i}>
              <td style={{ ...cellStyle, fontWeight: 500 }}>{metric}</td>
              <td style={cellStyle}>{desc}</td>
              <td style={{ ...cellStyle, textAlign: 'center' }}>{unit}</td>
              <td style={cellStyle}>{agg}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
