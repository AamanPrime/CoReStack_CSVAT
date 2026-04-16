# CSVAT — CoRE Stack Village Analytics Tool: Complete Technical Deep Dive

> **Purpose of this document:** A comprehensive, interview-ready explanation of the entire CSVAT application — architecture, data flow, every API method, all mathematical formulas, and output generation.

---

## Table of Contents

1. [What is CSVAT?](#1-what-is-csvat)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Infrastructure & Deployment (Docker Compose)](#4-infrastructure--deployment-docker-compose)
5. [End-to-End Request Flow](#5-end-to-end-request-flow)
6. [Boundary Selection (3 Input Methods)](#6-boundary-selection-3-input-methods)
7. [Dual Execution Modes: WASM vs SERVER](#7-dual-execution-modes-wasm-vs-server)
8. [Primary Pipeline: CoRE Stack MWS (10m Resolution)](#8-primary-pipeline-core-stack-mws-10m-resolution)
   - 8.1 [Data Fetching from CoRE Stack API](#81-data-fetching-from-core-stack-api)
   - 8.2 [Spatial Intersection Mathematics (Shapely)](#82-spatial-intersection-mathematics-shapely)
   - 8.3 [Weighted Aggregation Formulas](#83-weighted-aggregation-formulas)
   - 8.4 [Cropping Intensity Aggregation](#84-cropping-intensity-aggregation)
   - 8.5 [Surface Water Aggregation](#85-surface-water-aggregation)
   - 8.6 [Vegetation & Deforestation Aggregation](#86-vegetation--deforestation-aggregation)
   - 8.7 [Terrain Composition](#87-terrain-composition)
   - 8.8 [Crop Intensity Change Detection](#88-crop-intensity-change-detection)
   - 8.9 [Waterbodies](#89-waterbodies)
9. [Fallback Pipeline: Google Earth Engine (500m Resolution)](#9-fallback-pipeline-google-earth-engine-500m-resolution)
   - 9.1 [GEE Data Fetching (ee Library)](#91-gee-data-fetching-ee-library)
   - 9.2 [MODIS LULC → Cropping Intensity Mathematics](#92-modis-lulc--cropping-intensity-mathematics)
   - 9.3 [JRC Global Surface Water → Water Analytics Mathematics](#93-jrc-global-surface-water--water-analytics-mathematics)
   - 9.4 [MODIS NDVI → Vegetation Change Mathematics](#94-modis-ndvi--vegetation-change-mathematics)
10. [All Backend API Endpoints](#10-all-backend-api-endpoints)
11. [All CoRE Stack API Methods Used](#11-all-core-stack-api-methods-used)
12. [Output Generation & Visualization](#12-output-generation--visualization)
13. [Export Formats](#13-export-formats)
14. [Authentication System](#14-authentication-system)
15. [Database Models](#15-database-models)
16. [Celery Task System (Server Mode)](#16-celery-task-system-server-mode)
17. [Complete Mathematical Formula Reference](#17-complete-mathematical-formula-reference)
18. [Interview-Ready Summary Points](#18-interview-ready-summary-points)

---

## 1. What is CSVAT?

**CSVAT (CoRE Stack Village Analytics Tool)** is a full-stack geospatial analytics platform that generates village-level socio-ecological reports for any village in India. It combines:

- **CoRE Stack** satellite data (10m resolution, Micro-Watershed indexed)
- **Google Earth Engine** data (500m MODIS, 30m JRC) as a fallback
- **Client-side Python WASM** (Pyodide) for in-browser computation
- **Server-side Celery workers** as an alternate execution mode

**The core problem it solves:** CoRE Stack stores satellite-derived analytics at the **Micro-Watershed (MWS)** level, but users need data at the **village** level. A village boundary can overlap multiple MWS polygons partially. CSVAT computes the geometric intersection of village boundaries with MWS polygons and produces area-weighted village-level analytics.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + Vite)                      │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Boundary     │  │  Layer       │  │  Dashboard.jsx            │  │
│  │  Selector     │  │  Selector    │  │  (orchestration)          │  │
│  │  (3 modes)    │  │  (checkboxes)│  │                           │  │
│  └──────┬───────┘  └──────┬───────┘  │  WASM Mode: Pyodide +     │  │
│         │                 │           │    wasmEngine.js           │  │
│         │                 │           │  SERVER Mode: POST /jobs   │  │
│         └────────┬────────┘           └───────────┬───────────────┘  │
│                  │                                │                   │
│     ┌────────────┴────────────────────────────────┘                  │
│     │                                                                │
│  ┌──┴──────────────────────────────────────────────────────────┐    │
│  │  wasmEngine.js  (MWS-first pipeline)                        │    │
│  │   ├─ tryMWSAnalytics()  → Pyodide + Shapely (WASM)         │    │
│  │   │   └─ Spatial intersection + weighted aggregation        │    │
│  │   └─ runGEEFallbackPipeline() → Pyodide + numpy (WASM)     │    │
│  └──┬──────────────────────────────────────────────────────────┘    │
│     │                                                                │
└─────┼────────────────────────────────────────────────────────────────┘
      │  HTTP
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    BACKEND (FastAPI, Port 8006)                      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  API Routers:                                                 │   │
│  │   /api/v1/corestack/*     → CoRE Stack API proxy             │   │
│  │   /api/v1/gee/*           → GEE data proxy (ee library)      │   │
│  │   /api/v1/analytics/mws   → Server-side MWS intersection     │   │
│  │   /api/v1/boundaries/*    → Boundary resolution & search     │   │
│  │   /api/v1/jobs/*          → Async job CRUD + assets          │   │
│  │   /api/v1/layers          → Available layer metadata         │   │
│  │   /api/v1/auth/*          → JWT token management             │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
│                 │                                                    │
│  ┌──────────────┴───────────────────────────────────────────────┐   │
│  │  Services:                                                    │   │
│  │   MWSIntersectionService  — Shapely spatial intersection      │   │
│  │   CoreStackClient         — httpx HTTP client (X-API-Key)     │   │
│  │   GEEService              — ee library + service account      │   │
│  │   BoundaryService         — GeoJSON validation                │   │
│  │   ReportService           — Jinja2 HTML + CSV generation      │   │
│  │   PDFService              — Playwright PDF rendering          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │
│  │ PostgreSQL/     │  │ Redis          │  │ Celery Worker  │        │
│  │ PostGIS         │  │ (broker)       │  │ (async tasks)  │        │
│  └────────────────┘  └────────────────┘  └────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
      │
      │  HTTPS (external)
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EXTERNAL APIs                                                      │
│   • CoRE Stack REST API   (api-doc.core-stack.org/api/v1/...)       │
│   • Google Earth Engine   (ee Python library → GEE servers)         │
│   • Google Maps Platform  (Places Autocomplete, Geocoding)          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer              | Technology                            | Purpose                               |
| ------------------ | ------------------------------------- | ------------------------------------- |
| **Frontend**       | React 18 + Vite                       | SPA with hot module replacement       |
| **UI Library**     | Tailwind CSS                          | Utility-first styling                 |
| **Charts**         | Chart.js 4                            | Bar, line, stacked charts             |
| **Maps**           | Google Maps JavaScript API + Leaflet  | Boundary display, Places Autocomplete |
| **Client Compute** | Pyodide (Python 3.11 in WebAssembly)  | In-browser numpy + Shapely            |
| **Backend**        | FastAPI (Python 3.11)                 | Async REST API server                 |
| **HTTP Client**    | httpx (async)                         | CoRE Stack API calls                  |
| **Geospatial**     | Shapely, GeoAlchemy2                  | Polygon intersection, PostGIS         |
| **Earth Engine**   | ee (Python library) + Service Account | MODIS, JRC satellite data             |
| **Task Queue**     | Celery + Redis                        | Async server-side analytics           |
| **Database**       | PostgreSQL 15 + PostGIS 3.3           | Jobs, cached boundaries               |
| **ORM**            | SQLAlchemy 2.0                        | Database models                       |
| **Auth**           | python-jose (JWT)                     | Token-based authentication            |
| **Templating**     | Jinja2                                | Server-side HTML reports              |
| **PDF**            | Playwright (headless Chromium)        | HTML → PDF conversion                 |
| **Container**      | Docker Compose                        | 4-service orchestration               |

---

## 4. Infrastructure & Deployment (Docker Compose)

The application runs as **4 Docker containers** orchestrated by Docker Compose:

```yaml
services:
  db: # PostgreSQL 15 + PostGIS 3.3 (port 5435 → 5432)
  redis: # Redis 7 Alpine (port 6379)
  api: # FastAPI backend (port 8006 → 8000)
  worker: # Celery worker (same image as api, runs celery command)
```

| Container      | Image                    | Role                                              | Port |
| -------------- | ------------------------ | ------------------------------------------------- | ---- |
| `csvat_db`     | `postgis/postgis:15-3.3` | Persistent storage for jobs and cached boundaries | 5435 |
| `csvat_redis`  | `redis:7-alpine`         | Celery message broker + result backend            | 6379 |
| `csvat_api`    | Custom (Dockerfile)      | FastAPI server                                    | 8006 |
| `csvat_worker` | Same image               | Celery worker for async analytics                 | —    |

**Health checks** ensure proper startup order: `api` and `worker` wait for `db` and `redis` to be healthy.

---

## 5. End-to-End Request Flow

### Complete User Journey (WASM Mode — Default)

```
User Action                           System Response
───────────                           ───────────────
1. Select boundary                    → BoundarySelector resolves admin hierarchy
   (CoRE Stack / Google / GeoJSON)       + fetches GeoJSON geometry

2. Select layers                      → LayerSelector: cropping_intensity,
   (checkboxes)                          surface_water, vegetation

3. Select years                       → Year range picker (2019-2023)

4. Click "Run Analysis"               → Dashboard.handleWASMSubmit()

5. [WASM] Resolve boundary            → wasmEngine.resolveBoundary()
   ├─ CoRE Stack villages?            → GET /api/v1/boundaries/village/{id}
   ├─ Google Places?                  → Uses stored GeoJSON
   └─ Custom GeoJSON?                 → Uses uploaded geometry

6. [WASM] Try MWS Analytics           → wasmEngine.tryMWSAnalytics()
   ├─ Fetch MWS geometries            → GET /api/v1/corestack/mws-geometries
   ├─ Fetch tehsil analytics data     → GET /api/v1/corestack/tehsil-data
   ├─ Load Pyodide + Shapely          → CDN load + micropip install
   ├─ Run spatial intersection         → Python WASM: compute_intersections()
   ├─ Run weighted aggregation         → Python WASM: aggregate_cropping(), etc.
   └─ Return village-level results     → { cropping_intensity, surface_water, ... }

7. If MWS unavailable:
   ├─ Show prompt to user             → "Use GEE instead? (lower resolution)"
   └─ User confirms                   → Dashboard.handleGEEConfirm()

8. [GEE Fallback] Fetch + compute     → wasmEngine.runGEEFallbackPipeline()
   ├─ Fetch LULC data                 → POST /api/v1/gee/all
   ├─ Load Pyodide + numpy            → CDN load + loadPackage('numpy')
   ├─ Run cropping analysis           → Python WASM: analyze_cropping_intensity()
   ├─ Run water analysis              → Python WASM: analyze_surface_water()
   └─ Run vegetation analysis         → Python WASM: analyze_vegetation_change()

9. Render results                     → ReportViewer.jsx
   ├─ Summary statistics cards
   ├─ Chart.js stacked bar charts
   ├─ Data tables
   ├─ Deforestation transitions
   ├─ Auto-generated narrative
   └─ Export buttons (HTML/CSV/JSON/PDF)
```

---

## 6. Boundary Selection (3 Input Methods)

The `BoundarySelector.jsx` component (857 lines) supports three boundary input methods:

### Method 1: CoRE Stack Cascading Selector

```
State → District → Tehsil → Village
```

- Fetches hierarchy from `GET /api/v1/corestack/active-locations`
- Each dropdown populates the next level
- Village selection fetches GeoJSON geometry from `GET /api/v1/corestack/village-geometries`
- Returns: `{ state, district, tehsil, village_name, boundary_geojson, boundary_id }`

### Method 2: Google Places Autocomplete

- Uses Google Maps Places API for free-text village search
- User types village name → autocomplete suggestions appear
- On selection → Google Places details (lat/lng) fetched
- Reverse geocoding via CoRE Stack: `GET /api/v1/corestack/admin-details?latitude=...&longitude=...`
- Boundary resolved by searching CoRE Stack villages matching the name

### Method 3: GeoJSON File Upload

- User uploads a `.geojson` or `.json` file
- Frontend validates GeoJSON structure (must be Polygon or MultiPolygon)
- Admin details auto-resolved via centroid → CoRE Stack reverse geocoding
- `computeAreaHectares()` estimates area from bounding box:

```javascript
// GoogleMapsIntegration.jsx
function computeAreaHectares(geojson) {
  // Compute bounding box
  const latCorrection = Math.cos((avgLat * Math.PI) / 180);
  const widthKm = lngSpan * 111.32 * latCorrection;
  const heightKm = latSpan * 110.574;
  const areaHa = widthKm * heightKm * 100; // km² → hectares
  return areaHa;
}
```

---

## 7. Dual Execution Modes: WASM vs SERVER

### WASM Mode (Default — Client-Side)

| Step                    | Where                        | What Happens                             |
| ----------------------- | ---------------------------- | ---------------------------------------- |
| Boundary resolution     | Backend API                  | Protects API tokens from exposure        |
| Raw data fetch          | Backend API → CoRE Stack/GEE | Backend proxies external APIs            |
| **Spatial computation** | **Browser (Pyodide WASM)**   | Shapely intersection + numpy aggregation |
| Visualization           | Browser (React + Chart.js)   | Direct rendering                         |

**Why WASM?** Zero server compute cost. The browser runs Python via WebAssembly. Multiple users can run analytics simultaneously without loading the server.

### SERVER Mode (Alternate — Server-Side)

| Step            | Where                                 | What Happens                   |
| --------------- | ------------------------------------- | ------------------------------ |
| Submit job      | `POST /api/v1/jobs`                   | Creates Job row in PostgreSQL  |
| Task dispatch   | Celery → Redis                        | Task queued for worker         |
| **Analytics**   | **Celery Worker**                     | Same MWS intersection pipeline |
| Results storage | PostgreSQL                            | JSONB column in jobs table     |
| Polling         | `GET /api/v1/jobs/{id}`               | Frontend polls until complete  |
| Assets          | `GET /api/v1/jobs/{id}/assets/{type}` | HTML/CSV/PDF download          |

In SERVER mode, the frontend can also compute results client-side then push them to the server via `POST /api/v1/jobs/{id}/client-results`, which stores WASM-computed results in the job record for later download.

---

## 8. Primary Pipeline: CoRE Stack MWS (10m Resolution)

This is the **preferred** data path. CoRE Stack provides India-specific satellite-derived land analytics at 10m resolution indexed by Micro-Watersheds.

### 8.1 Data Fetching from CoRE Stack API

**Step 1: Fetch MWS Polygon Geometries**

```
GET /api/v1/get_mws_geometries/?state=...&district=...&tehsil=...
```

Returns a GeoJSON `FeatureCollection` where each Feature is an MWS polygon:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "MultiPolygon", "coordinates": [...] },
      "properties": { "uid": "12_234647" }
    }
  ]
}
```

**Step 2: Fetch Tehsil-Level Analytics Data**

```
GET /api/v1/get_tehsil_data/?state=...&district=...&tehsil=...
```

Returns a dict keyed by data vector type:

```json
{
  "data": {
    "croppingIntensity_annual": [
      {
        "uid": "12_234647",
        "single_cropped_area_in_ha_2022-2023": 45.6,
        "doubly_cropped_area_in_ha_2022-2023": 23.1,
        "triply_cropped_area_in_ha_2022-2023": 5.2,
        "cropping_intensity_unit_less_2022-2023": 1.35
      }
    ],
    "surfaceWaterBodies_annual": [
      {
        "uid": "12_234647",
        "kharif_area_in_ha_2022-2023": 12.3,
        "rabi_area_in_ha_2022-2023": 8.7,
        "zaid_area_in_ha_2022-2023": 3.1,
        "total_area_in_ha_2022-2023": 24.1
      }
    ],
    "change_detection_deforestation": [
      {
        "uid": "12_234647",
        "total_deforestation_area_in_ha": 2.5,
        "forest_to_barren_area_in_ha": 0.8,
        "forest_to_built_up_area_in_ha": 0.3,
        "forest_to_farm_area_in_ha": 1.0,
        "forest_to_scrub_land_area_in_ha": 0.4,
        "forest_to_forest_area_in_ha": 120.5
      }
    ],
    "change_detection_afforestation": [...],
    "terrain": [
      {
        "uid": "12_234647",
        "hill_slope_area_in_ha": 15.2,
        "plain_area_in_ha": 80.3,
        "ridge_area_in_ha": 5.0,
        "slopy_area_in_ha": 12.1,
        "valley_area_in_ha": 8.4
      }
    ],
    "change_detection_cropintensity": [
      {
        "uid": "12_234647",
        "single_to_double_area_in_ha": 5.3,
        "double_to_triple_area_in_ha": 2.1,
        ...
      }
    ]
  },
  "status": "ok"
}
```

### 8.2 Spatial Intersection Mathematics (Shapely)

The **core mathematical operation** of CSVAT. A village boundary can overlap multiple MWS polygons. We need to know _what fraction_ of each MWS falls within the village.

**Algorithm (from `compute_intersections()`):**

```python
for each MWS polygon:
    1. Validate geometries (buffer(0) fixes self-intersections)

    2. Check if village.intersects(mws)

    3. Compute intersection polygon:
       overlap = village.intersection(mws)

    4. Compute overlap fraction:
       overlap_fraction = A(overlap) / A(mws)

       where A() = area in degrees²

    5. Convert to hectares (approximate):
       area_ha = area_deg² × 111² × 100

       Derivation: 1° latitude ≈ 111 km
                   area_deg² × (111 km/°)² = area_km²
                   area_km² × 100 ha/km² = area_ha
```

**Mathematical notation:**

For village polygon $V$ and MWS polygon $M_i$:

$$f_i = \frac{A(V \cap M_i)}{A(M_i)}$$

Where:

- $f_i$ = overlap fraction for MWS $i$ (dimensionless, 0 to 1)
- $V \cap M_i$ = geometric intersection of village and MWS polygons
- $A(\cdot)$ = area function (in degrees²)

**Hectare conversion:**

$$A_{ha} = A_{deg^2} \times 111^2 \times 100$$

This is an equatorial approximation ($1° \approx 111$ km). Since CSVAT operates on villages in India (latitudes 8°–35°N), this introduces ~3-15% error, but is acceptable for relative comparisons.

**Fallback (when Shapely is unavailable in Pyodide):**

A bounding-box approximation is used:

```python
def _bbox_overlap(b1, b2):
    # Compute intersection of two axis-aligned bounding boxes
    ix0, iy0 = max(b1[0], b2[0]), max(b1[1], b2[1])
    ix1, iy1 = min(b1[2], b2[2]), min(b1[3], b2[3])
    inter = (ix1 - ix0) * (iy1 - iy0)  # if positive
    mws_area = (b2[2] - b2[0]) * (b2[3] - b2[1])
    return inter / mws_area
```

### 8.3 Weighted Aggregation Formulas

Once we have overlap fractions, we aggregate MWS-level metrics to the village level using two methods:

**Weighted Sum** (for extensive properties — areas in hectares):

$$\text{village\_value} = \sum_{i} \text{mws\_value}_i \times f_i$$

Used for: all area measurements (cropped area, water area, forest area, etc.)

**Weighted Average** (for intensive properties — percentages, indices):

$$\text{village\_value} = \frac{\sum_{i} \text{mws\_value}_i \times f_i}{\sum_{i} f_i}$$

Used for: cropping intensity index, density percentages

**Implementation (from `aggregate_mws_metric()`):**

```python
def aggregate_mws_metric(intersections, mws_data_by_uid, metric_key, aggregation):
    total_weight = 0.0
    weighted_sum = 0.0

    for ix in intersections:
        uid = ix["mws_uid"]
        fraction = ix["overlap_fraction"]
        value = mws_data_by_uid.get(uid, {}).get(metric_key)

        if value is not None:
            weighted_sum += float(value) * fraction
            total_weight += fraction

    if total_weight == 0:
        return None

    if aggregation == "weighted_sum":
        return weighted_sum
    else:  # weighted_average
        return weighted_sum / total_weight
```

### 8.4 Cropping Intensity Aggregation

**Data source:** `croppingIntensity_annual` vector from CoRE Stack

**Fiscal year mapping:** Calendar year $Y$ → fiscal string `"${Y-1}-${Y}"`

Example: year 2023 → `"2022-2023"`

**Metrics aggregated per year:**

| Metric                   | CoRE Stack Key                      | Aggregation Type |
| ------------------------ | ----------------------------------- | ---------------- |
| Single-cropped area      | `single_cropped_area_in_ha_{fy}`    | weighted_sum     |
| Double-cropped area      | `doubly_cropped_area_in_ha_{fy}`    | weighted_sum     |
| Triple-cropped area      | `triply_cropped_area_in_ha_{fy}`    | weighted_sum     |
| Cropping intensity index | `cropping_intensity_unit_less_{fy}` | weighted_average |

**Output:**

```json
{
  "year": "2022-2023",
  "single_crop_ha": 45.6,
  "double_crop_ha": 23.1,
  "triple_crop_ha": 5.2,
  "total_cropped_ha": 73.9,
  "cropping_intensity": 1.35
}
```

**Total cropped area formula:**

$$\text{total\_cropped\_ha} = \text{single\_crop\_ha} + \text{double\_crop\_ha} + \text{triple\_crop\_ha}$$

**Cropping intensity meaning:** A dimensionless index where:

- 1.0 = all land single-cropped
- 2.0 = all land double-cropped
- 3.0 = all land triple-cropped

### 8.5 Surface Water Aggregation

**Data source:** `surfaceWaterBodies_annual` vector from CoRE Stack

**Metrics aggregated per year:**

| Metric                      | CoRE Stack Key           | Aggregation Type |
| --------------------------- | ------------------------ | ---------------- |
| Kharif (monsoon) water area | `kharif_area_in_ha_{fy}` | weighted_sum     |
| Rabi (winter) water area    | `rabi_area_in_ha_{fy}`   | weighted_sum     |
| Zaid (summer) water area    | `zaid_area_in_ha_{fy}`   | weighted_sum     |
| Total water area            | `total_area_in_ha_{fy}`  | weighted_sum     |

**Indian agricultural seasons:**

- **Kharif** (June–September): Monsoon season
- **Rabi** (October–February): Winter season
- **Zaid** (March–May): Summer season

**Output:**

```json
{
  "year": "2022-2023",
  "kharif_ha": 12.3,
  "rabi_ha": 8.7,
  "zaid_ha": 3.1,
  "total_water_ha": 24.1
}
```

### 8.6 Vegetation & Deforestation Aggregation

**Data source:** `change_detection_deforestation` and `change_detection_afforestation` vectors

**Metrics aggregated (lifetime, not per-year):**

| Metric                   | CoRE Stack Key                    | Aggregation Type |
| ------------------------ | --------------------------------- | ---------------- |
| Total deforestation      | `total_deforestation_area_in_ha`  | weighted_sum     |
| Total afforestation      | `total_afforestation_area_in_ha`  | weighted_sum     |
| Forest → Barren          | `forest_to_barren_area_in_ha`     | weighted_sum     |
| Forest → Built Up        | `forest_to_built_up_area_in_ha`   | weighted_sum     |
| Forest → Farm            | `forest_to_farm_area_in_ha`       | weighted_sum     |
| Forest → Scrub Land      | `forest_to_scrub_land_area_in_ha` | weighted_sum     |
| Forest → Forest (stable) | `forest_to_forest_area_in_ha`     | weighted_sum     |

**Derived calculations:**

$$\text{net\_change\_ha} = \text{afforestation} - \text{deforestation}$$

$$\text{degraded\_land\_ha} = \text{forest\_to\_barren} + \text{forest\_to\_scrub}$$

**Output structure:**

```json
{
  "tree_cover_loss_ha": 25.3,
  "tree_cover_gain_ha": 12.1,
  "net_change_ha": -13.2,
  "degraded_land_ha": 8.5,
  "transitions": [
    { "from": "Forest", "to": "Forest", "area_ha": 120.5 },
    { "from": "Forest", "to": "Barren", "area_ha": 5.2 },
    { "from": "Forest", "to": "Built Up", "area_ha": 3.1 },
    { "from": "Forest", "to": "Farm", "area_ha": 12.8 },
    { "from": "Forest", "to": "Scrub Land", "area_ha": 4.2 }
  ]
}
```

### 8.7 Terrain Composition

**Data source:** `terrain` vector from CoRE Stack

**Categories aggregated (all weighted_sum):**

- `hill_slope_area_in_ha`
- `plain_area_in_ha`
- `ridge_area_in_ha`
- `slopy_area_in_ha`
- `valley_area_in_ha`

$$\text{total\_area\_ha} = \text{hill\_slope} + \text{plain} + \text{ridge} + \text{slopy} + \text{valley}$$

### 8.8 Crop Intensity Change Detection

**Data source:** `change_detection_cropintensity` vector from CoRE Stack

Tracks how land transitioned between cropping intensity classes over time:

| Transition Key                          | Label                    |
| --------------------------------------- | ------------------------ |
| `single_to_double_area_in_ha`           | Single → Double          |
| `double_to_triple_area_in_ha`           | Double → Triple          |
| `single_to_triple_area_in_ha`           | Single → Triple          |
| `double_to_single_area_in_ha`           | Double → Single          |
| `triple_to_double_area_in_ha`           | Triple → Double          |
| `triple_to_single_area_in_ha`           | Triple → Single          |
| `single_to_single_area_in_ha`           | Single → Single (stable) |
| `double_to_double_area_in_ha`           | Double → Double (stable) |
| `triple_to_triple_area_in_ha`           | Triple → Triple (stable) |
| `total_change_cropintensity_area_in_ha` | Total Change             |

All aggregated using **weighted_sum**.

### 8.9 Waterbodies

**Data source:** Separate CoRE Stack API endpoint

```
GET /api/v1/get_waterbodies_data_by_admin/?state=...&district=...&tehsil=...
```

Returns individual waterbody records with:

- Waterbody UID, name, type
- Area in hectares
- Seasonal coverage data (prefixed `k_`, `kr_`, `krz_`)
- Zone of Influence (ZOI) properties

Fetched for the tehsil level (not intersection-weighted since waterbodies are point/polygon features).

---

## 9. Fallback Pipeline: Google Earth Engine (500m Resolution)

When CoRE Stack data is unavailable (tehsil not active), the system falls back to GEE. The user is **explicitly prompted** before this happens.

### 9.1 GEE Data Fetching (ee Library)

The backend uses the `ee` Python library with a Google Cloud service account to query GEE servers.

#### LULC: MODIS MCD12Q1 (500m resolution)

```python
# Backend: gee_service.py
image = (
    ee.ImageCollection("MODIS/061/MCD12Q1")
    .filterDate(f"{year}-01-01", f"{year}-12-31")
    .first()
    .select("LC_Type1")
)

result = image.reduceRegion(
    reducer=ee.Reducer.frequencyHistogram(),
    geometry=geom,
    scale=500,
    bestEffort=True,
).getInfo()
```

Returns pixel counts per MODIS LC_Type1 class:

| Class ID | Name                                    |
| -------- | --------------------------------------- |
| 1–5      | Various Forest types                    |
| 6–7      | Shrublands                              |
| 8–9      | Savannas                                |
| 10       | Grasslands                              |
| 11       | Permanent Wetlands                      |
| **12**   | **Croplands**                           |
| 13       | Urban and Built-up Lands                |
| **14**   | **Cropland/Natural Vegetation Mosaics** |
| 15       | Permanent Snow and Ice                  |
| 16       | Barren                                  |
| 17       | Water Bodies                            |

#### Water: JRC Global Surface Water (30m resolution)

```python
# Global occurrence (time-aggregated, 0-100%)
occurrence = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence")
occ_stats = occurrence.reduceRegion(
    reducer=ee.Reducer.mean(),
    geometry=geom,
    scale=30,
    bestEffort=True,
).getInfo()

# Yearly water classification
yearly = (
    ee.ImageCollection("JRC/GSW1_4/YearlyHistory")
    .filterDate(f"{year}-01-01", f"{year}-12-31")
    .first()
)

hist_result = yearly.reduceRegion(
    reducer=ee.Reducer.frequencyHistogram(),
    geometry=geom,
    scale=30,
    bestEffort=True,
).getInfo()
```

JRC `waterClass` values:
| Class | Meaning |
|-------|---------|
| 0 | No data |
| 1 | Not water |
| 2 | Seasonal water |
| 3 | Permanent water |

#### NDVI: MODIS MOD13A2 (500m, 16-day composite)

```python
ndvi = (
    ee.ImageCollection("MODIS/061/MOD13A2")
    .filterDate(f"{year}-01-01", f"{year}-12-31")
    .select("NDVI")
)

# Annual mean
mean_img = ndvi.mean()
mean_stats = mean_img.reduceRegion(
    reducer=ee.Reducer.mean(), geometry=geom, scale=500, bestEffort=True
).getInfo()

# Apply MODIS NDVI scale factor
ndvi_mean = raw_value * 0.0001  # MODIS stores NDVI × 10000
```

### 9.2 MODIS LULC → Cropping Intensity Mathematics

The GEE fallback estimates cropping intensity from MODIS LULC pixel classifications.

**Pixel area:** MODIS at 500m resolution → each pixel = $500 \times 500 = 250{,}000 \text{ m}^2 = 25 \text{ ha}$

**Algorithm (`analyze_cropping_intensity()` in Pyodide):**

```
1. Extract cropland pixel counts:
   - Class 12 (Croplands) → cropland_pixels
   - Class 14 (Cropland/Vegetation Mosaics) → mosaic_pixels
   - total_crop_pixels = cropland_pixels + mosaic_pixels

2. Compute crop ratio:
   crop_ratio = cropland_pixels / total_crop_pixels

3. Estimate intensity fractions:
   single_frac = max(0.3, 0.7 - (1 - crop_ratio) × 0.4)
   double_frac = min(0.5, 0.2 + crop_ratio × 0.3)
   triple_frac = max(0, 1.0 - single_frac - double_frac)

4. Convert to hectares:
   single_ha = total_crop_pixels × 25 × single_frac
   double_ha = total_crop_pixels × 25 × double_frac
   triple_ha = total_crop_pixels × 25 × triple_frac
```

**Interpretation:** Higher pure cropland ratio (class 12 vs. 14) indicates more intensive farming. The fractions are heuristic estimates since MODIS 500m cannot directly detect crop cycling.

### 9.3 JRC Global Surface Water → Water Analytics Mathematics

**Pixel area:** JRC at 30m resolution → each pixel = $30 \times 30 = 900 \text{ m}^2 = 0.09 \text{ ha}$

**Algorithm (`analyze_surface_water()` in Pyodide):**

```
1. Extract pixel counts from JRC water_class_hist:
   - permanent_pixels = hist["3"]  (permanent water)
   - seasonal_pixels  = hist["2"]  (seasonal water)

2. Convert to hectares:
   perennial_ha = permanent_pixels × 0.09

3. Split seasonal into Indian seasons:
   monsoon_ha = seasonal_pixels × 0.09 × 0.7  (70% monsoon)
   winter_ha  = seasonal_pixels × 0.09 × 0.3  (30% winter)

4. If no JRC yearly data, estimate from occurrence mean:
   norm = min(occurrence_mean / 100, 1.0)
   perennial_ha = norm² × 50
   monsoon_ha   = norm × (1-norm) × 120
   winter_ha    = (1-norm)² × 30
```

**The 70/30 monsoon/winter split** is a domain heuristic based on India's monsoon climate where the majority of seasonal water bodies fill during the Kharif (monsoon) season.

### 9.4 MODIS NDVI → Vegetation Change Mathematics

**NDVI (Normalized Difference Vegetation Index)** ranges from -1 to 1:

$$\text{NDVI} = \frac{NIR - Red}{NIR + Red}$$

| NDVI Range | Interpretation                 |
| ---------- | ------------------------------ |
| > 0.6      | Dense vegetation / forest      |
| 0.3–0.6    | Moderate vegetation / cropland |
| 0.2–0.3    | Sparse vegetation              |
| < 0.2      | Barren / urban                 |

**MODIS scale factor:** Raw NDVI values are stored as integers × 10,000. Applied: `ndvi_mean = raw × 0.0001`

**Algorithm (`analyze_vegetation_change()` in Pyodide):**

```python
# Estimate tree cover from NDVI (per year)
village_area_ha = 500  # approximate
veg_fraction = min(ndvi_mean / 0.8, 1.0)
tree_cover_ha = village_area_ha × veg_fraction × 0.4

# Over the time series:
start_ha = tree_cover_ha[first_year]
end_ha   = tree_cover_ha[last_year]
loss = max(start_ha - end_ha, 0)
gain = max(end_ha - start_ha, 0)
net_change = end_ha - start_ha
degraded_land_ha = loss × 0.6  # heuristic: 60% of loss → degradation
```

**The 0.4 multiplier** accounts for the fact that not all vegetation is tree cover. The 0.6 degradation factor assumes most tree loss leads to land degradation.

---

## 10. All Backend API Endpoints

### CoRE Stack Proxy (`/api/v1/corestack/`)

| Method | Endpoint                                       | Purpose                                 |
| ------ | ---------------------------------------------- | --------------------------------------- |
| GET    | `/active-locations`                            | Get State → District → Tehsil hierarchy |
| GET    | `/admin-details?latitude=&longitude=`          | Reverse geocode to admin names          |
| GET    | `/mws-geometries?state=&district=&tehsil=`     | MWS polygon GeoJSON                     |
| GET    | `/tehsil-data?state=&district=&tehsil=`        | All MWS analytics vectors               |
| GET    | `/village-geometries?state=&district=&tehsil=` | Village boundary GeoJSON                |
| GET    | `/mws-data?state=&district=&tehsil=&mws_id=`   | Single MWS time-series                  |
| GET    | `/layer-urls?state=&district=&tehsil=`         | GeoServer layer URLs                    |
| GET    | `/waterbodies?state=&district=&tehsil=`        | Waterbody records                       |
| GET    | `/villages/search?query=`                      | Search villages by name                 |

### GEE Proxy (`/api/v1/gee/`)

| Method | Endpoint | Purpose                            |
| ------ | -------- | ---------------------------------- |
| POST   | `/lulc`  | MODIS MCD12Q1 land-cover histogram |
| POST   | `/water` | JRC surface water statistics       |
| POST   | `/ndvi`  | MODIS MOD13A2 NDVI mean/max        |
| POST   | `/all`   | Fetch LULC + Water + NDVI combined |

Request body for all GEE endpoints:

```json
{
  "geojson": { "type": "Polygon", "coordinates": [...] },
  "years": [2019, 2020, 2021, 2022, 2023]
}
```

### Analytics (`/api/v1/analytics/`)

| Method | Endpoint | Purpose                                |
| ------ | -------- | -------------------------------------- |
| POST   | `/mws`   | Server-side MWS intersection analytics |

### Jobs (`/api/v1/jobs/`)

| Method | Endpoint                   | Purpose                     |
| ------ | -------------------------- | --------------------------- |
| POST   | `/`                        | Create a new analytics job  |
| GET    | `/{job_id}`                | Get job status and results  |
| POST   | `/{job_id}/client-results` | Store WASM-computed results |
| GET    | `/{job_id}/assets/{type}`  | Download HTML/CSV/PDF       |

### Boundaries (`/api/v1/boundaries/`)

| Method | Endpoint         | Purpose                       |
| ------ | ---------------- | ----------------------------- |
| GET    | `/village/{id}`  | Fetch cached village boundary |
| POST   | `/validate`      | Validate GeoJSON geometry     |
| GET    | `/search?query=` | Search CoRE Stack boundaries  |

### Auth (`/api/v1/auth/`)

| Method | Endpoint | Purpose                   |
| ------ | -------- | ------------------------- |
| POST   | `/token` | Generate JWT access token |

### Layers (`/api/v1/`)

| Method | Endpoint  | Purpose                         |
| ------ | --------- | ------------------------------- |
| GET    | `/layers` | List available analytics layers |

---

## 11. All CoRE Stack API Methods Used

The `CoreStackClient` class (`corestack_client.py`) wraps these CoRE Stack REST API endpoints:

| Method                          | CoRE Stack Endpoint                          | Auth      | Timeout |
| ------------------------------- | -------------------------------------------- | --------- | ------- |
| `get_active_locations()`        | `GET /api/v1/get_active_locations/`          | X-API-Key | 30s     |
| `get_admin_details_by_latlon()` | `GET /api/v1/get_admin_details_by_latlon/`   | X-API-Key | 30s     |
| `get_mwsid_by_latlon()`         | `GET /api/v1/get_mwsid_by_latlon/`           | X-API-Key | 30s     |
| `get_tehsil_data()`             | `GET /api/v1/get_tehsil_data/`               | X-API-Key | 60s     |
| `get_mws_data()`                | `GET /api/v1/get_mws_data/`                  | X-API-Key | 60s     |
| `get_mws_geometries()`          | `GET /api/v1/get_mws_geometries/`            | X-API-Key | 120s    |
| `get_village_geometries()`      | `GET /api/v1/get_village_geometries/`        | X-API-Key | 120s    |
| `get_generated_layer_urls()`    | `GET /api/v1/get_generated_layer_urls/`      | X-API-Key | 30s     |
| `get_mws_kyl_indicators()`      | `GET /api/v1/get_mws_kyl_indicators/`        | X-API-Key | 30s     |
| `get_mws_report()`              | `GET /api/v1/get_mws_report/`                | X-API-Key | 30s     |
| `get_waterbodies_by_admin()`    | `GET /api/v1/get_waterbodies_data_by_admin/` | X-API-Key | 60s     |
| `get_waterbody_data()`          | `GET /api/v1/get_waterbody_data/`            | X-API-Key | 30s     |

All requests include:

```
Headers: { "X-API-Key": "<CORESTACK_API_KEY>" }
```

---

## 12. Output Generation & Visualization

### ReportViewer.jsx (711 lines)

The report viewer renders results into these sections:

#### 1. Header & Summary Stats

- Village name, state, district, tehsil
- Data source badge (CoRE Stack 10m or GEE 500m)
- MWS count (how many micro-watersheds were intersected)

#### 2. Cropping Intensity Chart & Table

- **Chart type:** Stacked bar chart (Chart.js)
- **Datasets:** Single crop (green), Double crop (blue), Triple crop (amber)
- **X-axis:** Year (fiscal year format)
- **Y-axis:** Area in hectares
- Table below with all numeric values

#### 3. Surface Water Chart & Table

- **Chart type:** Grouped bar chart
- **Datasets:** Kharif (teal), Rabi (blue), Zaid (light blue)
- **X-axis:** Year
- **Y-axis:** Area in hectares

#### 4. Vegetation & Deforestation

- **Summary cards:** Afforestation, Deforestation, Net Change, Degraded Land
- **Transitions table:** Forest → Barren/Built Up/Farm/Scrub Land (with area in ha)
- **Line chart:** Tree cover trend over years (if yearly data available)

#### 5. Crop Intensity Change Detection

- **Table:** All transition types (Single→Double, Double→Triple, etc.) with area

#### 6. Terrain Composition

- **Table:** Hill Slope, Plain, Ridge, Slopy, Valley with area in hectares

#### 7. Waterbodies

- **Table:** Individual waterbody names, types, and areas

#### 8. Auto-Generated Narrative (`generateNarrative()`)

The `ReportViewer` generates a natural-language "data story" summarizing key findings:

```javascript
function generateNarrative(results) {
  let narrative = `${results.village_name} in ${results.district}, ${results.state}...`;

  // Cropping trends
  if (ciData.length >= 2) {
    const startTotal = ciData[0].total_cropped_ha;
    const endTotal = ciData[ciData.length - 1].total_cropped_ha;
    const changePct = (((endTotal - startTotal) / startTotal) * 100).toFixed(1);
    narrative += `Cropping area changed by ${changePct}% from ...`;
  }

  // Water availability trend
  // Vegetation health narrative
  // Recommendations based on data
}
```

---

## 13. Export Formats

### Client-Side Exports (ExportManager.jsx)

| Format   | Generation Method                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------- |
| **HTML** | `wasmEngine.generateHTMLReport()` — full standalone HTML with inline Chart.js, CSS, and data tables |
| **CSV**  | `wasmEngine.generateCSV()` — comma-separated values for all metrics                                 |
| **JSON** | `JSON.stringify(results)` — raw JSON data                                                           |
| **PDF**  | `GET /api/v1/jobs/{id}/assets/pdf` — server-side Playwright rendering                               |

### Server-Side Report Generation

**HTML Report (`report_service.py`):**

- Jinja2 template rendering
- Inline CSS (dark theme, glassmorphism design)
- Embedded Chart.js scripts
- Self-contained (no external dependencies needed to open)

**PDF Report (`pdf_service.py`):**

- Takes the HTML report
- Renders via Playwright (headless Chromium)
- Produces a pixel-perfect PDF

**CSV Export (server-side):**

- Tabular format with sections for each layer
- Includes all raw numeric data

---

## 14. Authentication System

### JWT Token Flow

```python
# auth_middleware.py
async def verify_token(authorization: Optional[str] = Header(None)):
    settings = get_settings()
    if not settings.REQUIRE_AUTH:
        return {"sub": "anonymous"}  # Auth disabled in dev

    # Decode JWT with python-jose
    payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=["HS256"])
    return payload
```

- **REQUIRE_AUTH** setting controls whether authentication is enforced
- JWT tokens signed with HS256 algorithm
- Tokens include `sub` (subject) and `exp` (expiration) claims
- All API endpoints use `Depends(verify_token)` for consistent auth

### Token Generation

```
POST /api/v1/auth/token
Body: { "username": "...", "password": "..." }
Response: { "access_token": "eyJ...", "token_type": "bearer" }
```

---

## 15. Database Models

### Job Model (`models/job.py`)

```python
class Job(Base):
    __tablename__ = "jobs"

    id          = Column(UUID, primary_key=True, default=uuid4)
    status      = Column(Enum("pending", "running", "completed", "failed"))
    job_type    = Column(String, default="village_analytics")
    parameters  = Column(JSONB)       # Input: boundary, layers, years
    results     = Column(JSONB)       # Output: analytics data
    boundary    = Column(Geometry("MULTIPOLYGON", srid=4326))
    error       = Column(Text)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, onupdate=func.now())
```

### CachedBoundary Model (`models/boundary.py`)

```python
class CachedBoundary(Base):
    __tablename__ = "cached_boundaries"

    id       = Column(UUID, primary_key=True, default=uuid4)
    name     = Column(String, index=True)
    state    = Column(String)
    district = Column(String)
    tehsil   = Column(String)
    geometry = Column(Geometry("MULTIPOLYGON", srid=4326))
    source   = Column(String)  # "corestack" or "upload"
```

---

## 16. Celery Task System (Server Mode)

### Task Definition (`analytics_task.py`)

```python
@celery_app.task(bind=True, name="run_analytics")
def run_analytics_task(self, job_id: str, parameters: dict):
    """Celery task: try MWS first, fallback to GEE."""

    # Update job status to "running"
    update_job_status(job_id, "running")

    try:
        results = _run_pipeline(parameters)
        update_job_results(job_id, results)
        update_job_status(job_id, "completed")
    except Exception as e:
        update_job_error(job_id, str(e))
        update_job_status(job_id, "failed")
```

### Pipeline Strategy (`_run_pipeline()`)

```python
def _run_pipeline(parameters):
    # 1. Try MWS intersection (CoRE Stack 10m)
    try:
        results = mws_service.compute_village_analytics(
            village_geojson=params["boundary_geojson"],
            state=params["state"],
            district=params["district"],
            tehsil=params["tehsil"],
            layers=params["layers"],
            years=params["years"],
        )
        results["data_source"] = "corestack_mws"
        return results
    except ValueError:
        pass  # MWS not available

    # 2. Fallback to GEE
    gee_data = gee_service.fetch_all(params["boundary_geojson"], ...)
    # Process with cropping.py, water.py, vegetation.py
    results["data_source"] = "gee"
    results["data_warning"] = "Lower resolution (MODIS 500m)"
    return results
```

### Celery Configuration

```python
# celery_app.py
celery_app = Celery(
    "csvat",
    broker=settings.REDIS_URL,       # redis://csvat_redis:6379/0
    backend=settings.REDIS_URL,
)
```

---

## 17. Complete Mathematical Formula Reference

### Spatial Intersection

$$f_i = \frac{A(V \cap M_i)}{A(M_i)}$$

$$A_{ha} = A_{deg^2} \times 111^2 \times 100 = A_{deg^2} \times 1{,}232{,}100$$

### Weighted Aggregation

**Weighted Sum (extensive properties — areas):**

$$X_{village} = \sum_{i=1}^{n} x_i \cdot f_i$$

**Weighted Average (intensive properties — indices, %):**

$$X_{village} = \frac{\sum_{i=1}^{n} x_i \cdot f_i}{\sum_{i=1}^{n} f_i}$$

Where:

- $x_i$ = value of metric at MWS $i$
- $f_i$ = overlap fraction of MWS $i$ with village
- $n$ = number of overlapping MWS polygons

### MODIS Pixel Area

$$A_{pixel} = 500 \times 500 \text{ m}^2 = 250{,}000 \text{ m}^2 = 25 \text{ ha}$$

### JRC Pixel Area

$$A_{pixel} = 30 \times 30 \text{ m}^2 = 900 \text{ m}^2 = 0.09 \text{ ha}$$

### NDVI Scale Factor

$$\text{NDVI}_{actual} = \text{NDVI}_{raw} \times 0.0001$$

### GEE Cropping Intensity Estimation

$$\text{crop\_ratio} = \frac{\text{cropland\_pixels}}{\text{cropland\_pixels} + \text{mosaic\_pixels}}$$

$$\text{single\_frac} = \max(0.3, \ 0.7 - (1 - \text{crop\_ratio}) \times 0.4)$$

$$\text{double\_frac} = \min(0.5, \ 0.2 + \text{crop\_ratio} \times 0.3)$$

$$\text{triple\_frac} = \max(0, \ 1.0 - \text{single\_frac} - \text{double\_frac})$$

$$\text{area\_ha} = \text{total\_pixels} \times 25 \times \text{fraction}$$

### GEE Surface Water (JRC)

$$\text{perennial\_ha} = \text{permanent\_pixels} \times 0.09$$

$$\text{monsoon\_ha} = \text{seasonal\_pixels} \times 0.09 \times 0.7$$

$$\text{winter\_ha} = \text{seasonal\_pixels} \times 0.09 \times 0.3$$

**Fallback from occurrence mean:**

$$\text{norm} = \min\left(\frac{\text{occurrence\_mean}}{100}, 1.0\right)$$

$$\text{perennial\_ha} = \text{norm}^2 \times 50$$

$$\text{monsoon\_ha} = \text{norm} \times (1 - \text{norm}) \times 120$$

$$\text{winter\_ha} = (1 - \text{norm})^2 \times 30$$

### GEE Vegetation from NDVI

$$\text{veg\_fraction} = \min\left(\frac{\text{ndvi\_mean}}{0.8}, 1.0\right)$$

$$\text{tree\_cover\_ha} = 500 \times \text{veg\_fraction} \times 0.4$$

$$\text{degraded\_land\_ha} = \text{loss\_ha} \times 0.6$$

### Area (Bounding Box Approximation)

$$\text{width}_{km} = \Delta\text{lng} \times 111.32 \times \cos\left(\frac{\text{lat}_{avg} \times \pi}{180}\right)$$

$$\text{height}_{km} = \Delta\text{lat} \times 110.574$$

$$\text{area}_{ha} = \text{width}_{km} \times \text{height}_{km} \times 100$$

### Fiscal Year Mapping

$$\text{fiscal\_year}(Y) = \text{"}(Y-1)\text{-}Y\text{"}$$

Example: $\text{fiscal\_year}(2023) = \text{"2022-2023"}$

---

## 18. Interview-Ready Summary Points

### Architecture Highlights

1. **CSVAT solves a geometric mismatch problem.** Satellite data is indexed by micro-watersheds; users need village-level reports. The app computes polygon intersections to bridge this gap.

2. **Dual execution model.** WASM mode (default) runs Python in the browser via Pyodide — zero server compute cost. Server mode uses Celery workers for users who prefer traditional cloud processing.

3. **MWS-first strategy with graceful fallback.** CoRE Stack (10m, India-specific) is always tried first. GEE (500m, global) is only used when the user's tehsil isn't active on CoRE Stack, and only after explicit user confirmation.

4. **Backend acts as a smart proxy.** It protects API keys and service account credentials. External APIs are never called directly from the browser.

### Data Science Highlights

5. **Spatial intersection using Shapely.** The Shapely library computes exact polygon-polygon intersections (not approximations). The overlap fraction determines each MWS's contribution to the village-level aggregate.

6. **Weighted aggregation is context-aware.** Area-based metrics (hectares) use weighted sum; ratio/index metrics (cropping intensity) use weighted average. This distinction is mathematically important — you can't average areas, and you can't sum intensities.

7. **Multiple satellite data sources.** CoRE Stack uses IndiaSAT (10m). GEE uses MODIS MCD12Q1 (LULC, 500m), JRC GSW (water, 30m), and MODIS MOD13A2 (NDVI, 500m). Each has different resolution and processing pipelines.

8. **NDVI scale factor.** MODIS stores NDVI as integers × 10,000. The `0.0001` scale factor converts back to the ecological -1 to +1 range.

### Engineering Highlights

9. **Pyodide enables zero-cost scaling.** By running Python (Shapely + numpy) in the browser, the server handles zero compute. Only data proxying costs bandwidth.

10. **Docker Compose for reproducibility.** Four containers (PostGIS, Redis, FastAPI, Celery) with health checks and proper dependency ordering.

11. **GeoAlchemy2 for spatial persistence.** Job boundaries are stored as PostGIS `MULTIPOLYGON` geometries, enabling future spatial queries.

12. **Three boundary input methods** ensure any village in India can be analyzed: CoRE Stack hierarchy (structured), Google Places (fuzzy search), or GeoJSON upload (custom).

### Key Technical Decisions

13. **Why proxy GEE through backend?** GEE requires a service account key (credentials). Embedding this in the frontend would be a security risk. The backend handles authentication and returns only aggregated data.

14. **Why fiscal years for CoRE Stack?** India's agricultural year runs April–March. CoRE Stack stores data by fiscal year (e.g., "2022-2023" for crops harvested in that period). The conversion `year Y → "${Y-1}-${Y}"` aligns calendar year inputs with CoRE Stack keys.

15. **Why is the MWS intersection done on both client and server?** The code is mirrored in `wasmEngine.js` (embedded Python for Pyodide) and `mws_intersection_service.py` (backend). This enables either execution mode to produce identical results.

---

## Appendix A: File-by-File Reference

| File                                                | Lines | Role                                                  |
| --------------------------------------------------- | ----- | ----------------------------------------------------- |
| `frontend/src/pages/Dashboard.jsx`                  | 487   | Main orchestration — mode switching, state management |
| `frontend/src/services/wasmEngine.js`               | 815   | MWS pipeline + GEE fallback + CSV/HTML generation     |
| `frontend/src/services/pyodideEngine.js`            | 372   | Pyodide loader + GEE data analytics Python code       |
| `frontend/src/components/BoundarySelector.jsx`      | 857   | 3-mode boundary input component                       |
| `frontend/src/components/ReportViewer.jsx`          | 711   | Results visualization + narrative generation          |
| `frontend/src/components/ExportManager.jsx`         | ~120  | Export buttons + blob generation                      |
| `frontend/src/components/GoogleMapsIntegration.jsx` | 470   | Google Maps + Places + area computation               |
| `frontend/src/components/LayerSelector.jsx`         | —     | Checkbox layer selection                              |
| `frontend/src/services/api.js`                      | —     | HTTP helper (axios/fetch wrapper)                     |
| `backend/app/main.py`                               | —     | FastAPI app + CORS + router mounting                  |
| `backend/app/config.py`                             | —     | Pydantic settings (env-based config)                  |
| `backend/app/database.py`                           | —     | SQLAlchemy engine + session factory                   |
| `backend/app/api/analytics.py`                      | 152   | POST /api/v1/analytics/mws endpoint                   |
| `backend/app/api/corestack.py`                      | —     | CoRE Stack proxy routes                               |
| `backend/app/api/gee.py`                            | ~105  | GEE proxy routes                                      |
| `backend/app/api/jobs.py`                           | ~250  | Job CRUD + asset delivery                             |
| `backend/app/api/boundaries.py`                     | —     | Boundary resolution routes                            |
| `backend/app/api/auth.py`                           | —     | JWT token endpoint                                    |
| `backend/app/api/layers.py`                         | —     | Layer metadata endpoint                               |
| `backend/app/services/mws_intersection_service.py`  | 615   | **Core engine** — spatial intersection + aggregation  |
| `backend/app/services/corestack_client.py`          | 325   | httpx client for all CoRE Stack APIs                  |
| `backend/app/services/gee_service.py`               | ~285  | ee library GEE data fetching                          |
| `backend/app/services/boundary_service.py`          | ~140  | GeoJSON validation + admin resolution                 |
| `backend/app/services/report_service.py`            | 452   | Jinja2 HTML report + CSV generation                   |
| `backend/app/services/pdf_service.py`               | —     | Playwright HTML → PDF                                 |
| `backend/app/services/village_search.py`            | —     | Village name search utility                           |
| `backend/app/services/analytics/cropping.py`        | ~95   | Server-side cropping from MWS data                    |
| `backend/app/services/analytics/water.py`           | ~90   | Server-side water from MWS data                       |
| `backend/app/services/analytics/vegetation.py`      | ~100  | Server-side vegetation from MWS data                  |
| `backend/app/tasks/analytics_task.py`               | ~270  | Celery task — MWS-first pipeline                      |
| `backend/app/tasks/celery_app.py`                   | —     | Celery app configuration                              |
| `backend/app/models/job.py`                         | —     | SQLAlchemy Job model                                  |
| `backend/app/models/boundary.py`                    | —     | SQLAlchemy CachedBoundary model                       |
| `backend/app/schemas/__init__.py`                   | —     | Pydantic request/response schemas                     |
| `backend/app/utils/auth_middleware.py`              | —     | JWT verification dependency                           |
| `docker-compose.yml`                                | 78    | 4-service Docker orchestration                        |

---

## Appendix B: Environment Variables

| Variable                        | Purpose                                                             |
| ------------------------------- | ------------------------------------------------------------------- |
| `CORESTACK_API_BASE_URL`        | CoRE Stack API base (e.g., `https://api-doc.core-stack.org/api/v1`) |
| `CORESTACK_API_KEY`             | X-API-Key for CoRE Stack authentication                             |
| `GEE_SERVICE_ACCOUNT`           | Google service account email                                        |
| `GEE_KEY_JSON` / `GEE_KEY_FILE` | Service account credentials                                         |
| `GEE_PROJECT`                   | Google Cloud project ID                                             |
| `DATABASE_URL`                  | PostgreSQL connection string                                        |
| `REDIS_URL`                     | Redis connection string                                             |
| `JWT_SECRET_KEY`                | Secret for JWT signing                                              |
| `REQUIRE_AUTH`                  | Enable/disable authentication                                       |
| `VITE_API_BASE`                 | Frontend API URL (e.g., `http://localhost:8000`)                    |
| `VITE_GOOGLE_MAPS_API_KEY`      | Google Maps JavaScript API key                                      |

---

_This document was generated from a complete analysis of the CSVAT codebase. Every formula, endpoint, and data flow described here is traced directly from the source code._
