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
            <li><strong>Classes:</strong> 13 land cover classes (0–12): Built-up, Water (Kharif/Rabi/Zaid), Crops (Single/Double/Triple), Trees, Barren, Scrub, etc.</li>
            <li><strong>CRS:</strong> Downloaded in the image's <strong>native CRS</strong> (no reprojection/resampling).</li>
            <li><strong>Processing:</strong> Village geometry reprojected to raster CRS via <code>rasterio.warp.transform_geom</code>, then clipped with <code>geometry_mask</code>.</li>
            <li><strong>Temporal Range:</strong> Fiscal years 2017-18 through 2024-25.</li>
          </ul>
        </SubSection>

        <SubSection title="CoRE Stack Vector API (MWS Path)">
          <ul style={ulStyle}>
            <li><strong>Provider:</strong> CoRE Stack REST APIs (pre-aggregated per Micro-Watershed).</li>
            <li><strong>Data Products:</strong> Surface water bodies, cropping summaries, vegetation indices — already computed at MWS level.</li>
            <li><strong>Coverage:</strong> Active tehsils only.</li>
          </ul>
        </SubSection>

        <SubSection title="MODIS/JRC GEE Fallback (500m — Low Resolution)">
          <ul style={ulStyle}>
            <li><strong>Triggered when:</strong> User explicitly selects "🌐 Use GEE" in the fallback dialog (when CoRE Stack has no data for the tehsil).</li>
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
      <Section num="2" title="Boundary Selection & Village Identification" color="var(--accent-blue)">
        <p style={pStyle}>Villages are identified through two methods:</p>
        <ul style={ulStyle}>
          <li><strong>CoRE Stack Registry:</strong> State → District → Tehsil → Village hierarchy. Village polygons are fetched as GeoJSON from the CoRE Stack API with verified administrative boundaries. Supports all three execution modes (Raster, MWS, Server).</li>
          <li><strong>GeoJSON Upload (Pan-India):</strong> Users can upload any village boundary GeoJSON file. This mode bypasses CoRE Stack location selection and routes directly to the ⚡ Raster path, enabling analysis for <em>any</em> Indian village — no tehsil registration required.</li>
        </ul>
        <p style={pStyle}>
          For CoRE Stack boundaries, the system identifies overlapping Micro-Watersheds (MWS) for vector analytics.
          For uploaded boundaries, analytics are computed entirely from raster pixel data via GEE — no MWS intersection is needed.
        </p>
      </Section>

      {/* ─── 3. Spatial Processing ─── */}
      <Section num="3" title="Spatial Processing" color="var(--accent-amber)">
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
            falls within the village. This is computed using Shapely (Python) for exact polygon-polygon intersection.
          </p>
        </SubSection>

        <SubSection title="Step 2: Weighted Aggregation">
          <p style={pStyle}>
            MWS-level values are aggregated to village-level using overlap fractions as weights.
            Two aggregation methods are used depending on the metric type:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', margin: '1rem 0' }}>
            <div style={formulaCardStyle}>
              <div style={{ fontWeight: 700, color: 'var(--accent-green)', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                Extensive Properties (Areas)
              </div>
              <FormulaBox small>
                X<sub>village</sub> = Σ (x<sub>i</sub> × f<sub>i</sub>)
              </FormulaBox>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                Used for: cropped area (ha), water body area (ha), deforestation area (ha).
                Sum of overlap-weighted values.
              </p>
            </div>

            <div style={formulaCardStyle}>
              <div style={{ fontWeight: 700, color: 'var(--accent-blue)', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                Intensive Properties (Indices)
              </div>
              <FormulaBox small>
                X<sub>village</sub> = Σ(x<sub>i</sub> × f<sub>i</sub>) / Σ(f<sub>i</sub>)
              </FormulaBox>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                Used for: NDVI mean and similar ratio metrics.
                Weighted average prevents bias from partial overlaps.
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
          <MetricsTable rows={[
            ['Single Crop Area', 'Land cropped once per year', 'ha', 'Weighted sum'],
            ['Double Crop Area', 'Land cropped twice per year', 'ha', 'Weighted sum'],
            ['Triple Crop Area', 'Land cropped thrice per year', 'ha', 'Weighted sum'],
            ['Total Cropped Area', 'Sum of all crop areas', 'ha', 'Derived'],
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
              Both Raster and MWS paths use this identical formula.
            </p>
          </SubSection>
          <p style={{ ...pStyle, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Source: CoRE Stack LULC classification from Sentinel-2 multi-temporal analysis.
            Each pixel is classified by how many distinct crop cycles are detected across
            Kharif (June–Sep), Rabi (Oct–Feb), and Zaid (Mar–May) seasons.
          </p>
        </SubSection>

        <SubSection title="4.2 Surface Water Bodies">
          <p style={pStyle}>
            Seasonal water body coverage aligned with Indian agricultural seasons.
            CSVAT uses a <strong>dual-source approach</strong> for maximum coverage:
          </p>
          <ul style={ulStyle}>
            <li><strong>Primary — LULC Raster (10m):</strong> Water classes from IndiaSAT LULC v3: Class 2 = Kharif Water, Class 3 = Kharif+Rabi Water, Class 4 = Perennial Water. Pixel-level extraction from the same raster used for cropping intensity.</li>
            <li><strong>Fallback — MWS Vector:</strong> If the LULC raster has no water pixels (e.g., forest areas with small waterbodies below pixel resolution), the system falls back to <code>surfaceWaterBodies_annual</code> vector records from the CoRE Stack tehsil API, aggregated via MWS weighted intersection.</li>
          </ul>
          <MetricsTable rows={[
            ['Kharif Water Area', 'Water during monsoon (Jun–Sep)', 'ha', 'Pixel count / Weighted sum'],
            ['Rabi Water Area', 'Water during winter (Oct–Feb)', 'ha', 'Pixel count / Weighted sum'],
            ['Zaid/Perennial Area', 'Water during summer (Mar–May) / perennial', 'ha', 'Pixel count / Weighted sum'],
            ['Total Water Area', 'Sum of all seasonal water', 'ha', 'Derived'],
          ]} />
          <WarningBox>
            Small waterbodies (ponds, streams) may not be captured by the 10m LULC classification.
            The MWS vector fallback uses a dedicated surface water layer that detects smaller features.
            The data source label in the report indicates which source was used.
          </WarningBox>
        </SubSection>

        <SubSection title="4.3 Vegetation & Deforestation">
          <p style={pStyle}>Forest cover change detection between the analysis start and end years.</p>
          <MetricsTable rows={[
            ['Deforestation', 'Total tree cover lost', 'ha', 'Weighted sum'],
            ['Afforestation', 'Total tree cover gained', 'ha', 'Weighted sum'],
            ['Net Change', 'Afforestation − Deforestation', 'ha', 'Derived'],
            ['Degraded Land', 'Forest → Barren + Forest → Scrub', 'ha', 'Derived'],
          ]} />
          <p style={{ ...pStyle, fontSize: '0.82rem', }}>
            <strong>Transition classes tracked:</strong> Forest → Forest (stable), Forest → Barren,
            Forest → Built Up, Forest → Farm, Forest → Scrub Land.
          </p>
        </SubSection>

        <SubSection title="4.4 Crop Intensity Change Detection">
          <p style={pStyle}>
            Tracks how land transitions between cropping intensity classes over time:
          </p>
          <MetricsTable rows={[
            ['Single → Double', 'Intensification', 'ha', 'Weighted sum'],
            ['Double → Triple', 'Further intensification', 'ha', 'Weighted sum'],
            ['Double → Single', 'De-intensification', 'ha', 'Weighted sum'],
            ['Triple → Single', 'Major de-intensification', 'ha', 'Weighted sum'],
          ]} />
        </SubSection>
      </Section>

      {/* ─── 5. Limitations ─── */}
      <Section num="5" title="Limitations & Known Constraints" color="var(--accent-red)">
        <ul style={ulStyle}>
          <li>
            <strong>MWS Boundary Misalignment:</strong> Village boundaries don't align perfectly
            with MWS polygons. The weighted aggregation introduces small errors at boundary edges —
            typically &lt;5% for compact villages, potentially higher for irregular shapes.
          </li>
          <li>
            <strong>GEE IndiaSAT Fallback (minor):</strong> The automatic GEE fallback uses the same
            IndiaSAT LULC v3 dataset at 10m resolution. Pixel counts may differ by &lt;1% due to
            floating-point grid alignment at village boundaries. Analytical conclusions are unaffected.
          </li>
          <li>
            <strong>MODIS/JRC GEE Fallback (significant):</strong> When user explicitly selects the
            low-resolution GEE path, MODIS (500m) and JRC (30m) data cannot directly measure:
            <ul style={{ ...ulStyle, marginTop: '0.3rem' }}>
              <li>Single/double/triple cropping — estimated from pixel class ratios</li>
              <li>Kharif/Rabi/Zaid water split — estimated from JRC permanent/seasonal classes</li>
              <li>Forest transition types — only net NDVI change, not transition matrices</li>
            </ul>
          </li>
          <li>
            <strong>Temporal Resolution:</strong> CoRE Stack data is aggregated per fiscal year.
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
        <p style={pStyle}>CSVAT supports three execution paths. Uploaded GeoJSON boundaries are restricted to the Raster path (pan-India). CoRE Stack boundaries support all three:</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', margin: '1rem 0' }}>
          <div style={{ ...formulaCardStyle, borderColor: '#10b981' }}>
            <div style={{ fontWeight: 700, color: '#10b981', marginBottom: '0.5rem', fontSize: '0.9rem' }}>⚡ Raster (High Accuracy)</div>
            <ul style={{ ...ulStyle, fontSize: '0.78rem' }}>
              <li>Backend downloads GeoTIFFs from GEE IndiaSAT LULC v3 assets</li>
              <li>Native CRS — zero reprojection, zero resampling</li>
              <li>Clipped to village boundary via rasterio geometry_mask (10m)</li>
              <li>All analytics computed client-side in Pyodide (Python WASM)</li>
              <li>Non-blocking: runs in asyncio thread pool</li>
              <li><strong>Cropping, vegetation, and surface water</strong> all derived from LULC pixel classes</li>
              <li>Water fallback to MWS vector if raster has no water pixels</li>
              <li><strong>Pan-India</strong> — works for any boundary (upload or CoRE Stack)</li>
            </ul>
          </div>
          <div style={formulaCardStyle}>
            <div style={{ fontWeight: 700, color: '#8b5cf6', marginBottom: '0.5rem', fontSize: '0.9rem' }}>⚡ MWS Vector</div>
            <ul style={{ ...ulStyle, fontSize: '0.78rem' }}>
              <li>Pre-aggregated MWS-level data from CoRE Stack API</li>
              <li>Village-MWS polygon intersection + weighted aggregation</li>
              <li>Faster — no raster downloads needed</li>
              <li>Small area approximation from overlap fractions</li>
              <li>CoRE Stack boundaries only (active tehsils)</li>
            </ul>
          </div>
          <div style={formulaCardStyle}>
            <div style={{ fontWeight: 700, color: '#3b82f6', marginBottom: '0.5rem', fontSize: '0.9rem' }}>🖥️ Server</div>
            <ul style={{ ...ulStyle, fontSize: '0.78rem' }}>
              <li>Same logic as MWS Vector, dispatched to backend workers</li>
              <li>Celery async processing</li>
              <li>Good for batch or low-power clients</li>
              <li>CoRE Stack boundaries only (active tehsils)</li>
            </ul>
          </div>
        </div>
        <p style={{ ...pStyle, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          All modes use the same GCA/NSA intensity formula.
          The Raster path provides the highest accuracy by counting individual 10m pixels.
          Surface water in the Raster path comes from LULC classes 2/3/4 (with MWS vector fallback for small waterbodies).
          The report's data source label (e.g., "IndiaSAT LULC v3 Raster" vs "CoRE Stack MWS Vector") indicates which source was used for each section.
        </p>
      </Section>

      {/* ─── 7. Report Narrative ─── */}
      <Section num="7" title="Report Narrative Generation" color="var(--accent-amber)">
        <p style={pStyle}>
          The "Data Story" narrative in each report is generated using <strong>deterministic string templating</strong>,
          not AI or LLMs. Computed values (e.g., total area = 500 ha, net sown area = 45%) are injected into
          pre-written text templates.
        </p>
        <p style={pStyle}>
          Simple logic gates control phrasing:
        </p>
        <FormulaBox>
          IF trend &gt; 0 → "increased by X%" ELSE "decreased by X%"
        </FormulaBox>
        <p style={{ ...pStyle, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          This ensures reproducibility — the same input data always produces the same narrative text.
        </p>
      </Section>

      <div style={{ textAlign: 'center', padding: '2rem 0 1rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
        CSVAT — CoRE Stack Village Analytics Tool
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
            <th style={{ ...headerStyle, color: '#10b981' }}>⚡ Raster Path</th>
            <th style={{ ...headerStyle, color: '#8b5cf6' }}>⚡ MWS Vector Path</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Source', 'GEE IndiaSAT LULC v3', 'CoRE Stack REST API'],
            ['Resolution', '10m (Sentinel-2)', 'MWS-level aggregates'],
            ['Crop Classification', '13 classes incl. Single/Double/Triple', 'Pre-computed per MWS'],
            ['Water Seasons', 'Kharif / Rabi / Zaid (pixel-level)', 'Kharif / Rabi / Zaid (MWS-level)'],
            ['Forest Transitions', 'Full transition matrix (pixel-level)', 'Weighted aggregation'],
            ['Coverage', 'Any village with boundary GeoJSON', 'Active tehsils only'],
          ].map(([attr, core, gee], i) => (
            <tr key={i}>
              <td style={{ ...cellStyle, fontWeight: 500 }}>{attr}</td>
              <td style={cellStyle}>{core}</td>
              <td style={cellStyle}>{gee}</td>
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
            <th style={headerStyle}>Aggregation</th>
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
