# CSVAT — CoRE Stack Village Analytics Tool: Complete Technical Deep Dive

> **Purpose of this document:** A comprehensive, detailed documentation of the entire CSVAT application — architecture, data flow, every API method, all mathematical formulas, and output generation.

---

## Table of Contents

1. [What is CSVAT?](#1-what-is-csvat)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Infrastructure & Deployment (Docker Compose)](#4-infrastructure--deployment-docker-compose)
5. [End-to-End Request Flow](#5-end-to-end-request-flow)
6. [Boundary Selection (3 Input Methods)](#6-boundary-selection-3-input-methods)
7. [Execution Modes (100% Client-Side)](#7-execution-modes-100-client-side)
8. [High Accuracy Raster & MWS Vector Pipelines](#8-high-accuracy-raster--mws-vector-pipelines)
   - 8.1 [Data Fetching from CoRE Stack API](#81-data-fetching-from-core-stack-api)
   - 8.2 [Spatial Intersection Mathematics (Shapely)](#82-spatial-intersection-mathematics-shapely)
   - 8.3 [Weighted Aggregation Formulas](#83-weighted-aggregation-formulas)
   - 8.4 [Cropping Intensity Aggregation](#84-cropping-intensity-aggregation)
   - 8.5 [Surface Water Aggregation](#85-surface-water-aggregation)
   - 8.6 [Vegetation & Deforestation Aggregation](#86-vegetation--deforestation-aggregation)
   - 8.7 [Terrain Composition](#87-terrain-composition)
   - 8.8 [Crop Intensity Change Detection](#88-crop-intensity-change-detection)
   - 8.9 [Waterbodies](#89-waterbodies)
10. [All Backend API Endpoints](#10-all-backend-api-endpoints)
11. [All CoRE Stack API Methods Used](#11-all-core-stack-api-methods-used)
12. [Output Generation & Visualization](#12-output-generation--visualization)
13. [Export Formats](#13-export-formats)
14. [Authentication System](#14-authentication-system)
15. [Database Models](#15-database-models)
16. [Complete Mathematical Formula Reference](#16-complete-mathematical-formula-reference)
---

## 1. What is CSVAT?

**CSVAT (CoRE Stack Village Analytics Tool)** is a full-stack geospatial analytics platform that generates village-level socio-ecological reports for any village in India. It combines:

- **CoRE Stack** satellite data (10m resolution, Micro-Watershed indexed)
- **Client-side Python WASM** (Pyodide) for in-browser computation

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
│  └──────┬───────┘  └──────┬───────┘  │  Client-Side execution:   │  │
│         │                 │           │   wasmEngine/rasterEngine │  │
│         │                 │           │                           │  │
│         └────────┬────────┘           └───────────┬───────────────┘  │
│                  │                                │                   │
│     ┌────────────┴────────────────────────────────┘                  │
│     │                                                                │
│  ┌──┴──────────────────────────────────────────────────────────┐    │
│  │  Client-Side Computation Engines                            │    │
│  │   ├─ rasterEngine.js (Primary: High Accuracy Raster)        │    │
│  │   │   └─ Pyodide (WASM) + geotiff.js (Pixel Histogram)      │    │
│  │   ├─ wasmEngine.js (Secondary: MWS Vector)                  │    │
│  │       └─ Pyodide (WASM) + Shapely (Spatial Intersection)    │    │
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
│  │   /api/v1/gee/*           → GEE GeoTIFF URL signing          │   │
│  │   /api/v1/corestack/*     → CoRE Stack API proxy             │   │
│  │   /api/v1/boundaries/*    → Boundary resolution & search     │   │
│  │   /api/v1/storyboard/*    → Village Stories LLM Generation   │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
│                 │                                                    │
│  ┌──────────────┴───────────────────────────────────────────────┐   │
│  │  Services:                                                    │   │
│  │   GEEService              — ee.Image().getDownloadURL()       │   │
│  │   CoreStackClient         — httpx HTTP client (X-API-Key)     │   │
│  │   BoundaryService         — GeoJSON validation                │   │
│  │   VillageStoryService     — LLM generation with Meta Llama 4  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌────────────────┐                                                 │
│  │ PostgreSQL/     │                                                 │
│  │ PostGIS         │                                                 │
│  └────────────────┘                                                 │
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
| **Raster Parsing** | geotiff.js + turf.js                  | In-browser GeoTIFF parsing & masking  |
| **Backend**        | FastAPI (Python 3.11)                 | Async REST API server                 |
| **HTTP Client**    | httpx (async)                         | CoRE Stack API calls                  |
| **Earth Engine**   | ee (Python library) + Service Account | GEE URL signing for raster extraction |
| **Database**       | PostgreSQL 15 + PostGIS 3.3           | Village Stories & cached boundaries   |
| **ORM**            | SQLAlchemy 2.0                        | Database models                       |
| **Auth**           | python-jose (JWT)                     | Token-based authentication            |
| **LLM Inference**  | Groq API (Meta Llama 4 Scout)         | Narrative storyboard generation       |
| **Container**      | Docker Compose                        | 2-service orchestration               |

---

## 4. Infrastructure & Deployment (Docker Compose)

The application runs as **2 Docker containers** orchestrated by Docker Compose:

```yaml
services:
  db: # PostgreSQL 15 + PostGIS 3.3 (port 5435 → 5432)
  api: # FastAPI backend (port 8006 → 8000)
```

| Container      | Image                    | Role                                              | Port |
| -------------- | ------------------------ | ------------------------------------------------- | ---- |
| `csvat_db`     | `postgis/postgis:15-3.3` | Persistent storage for cached boundaries          | 5435 |
| `csvat_api`    | Custom (Dockerfile)      | FastAPI server                                    | 8006 |

**Health checks** ensure proper startup order: `api` waits for `db` to be healthy.

---

## 5. End-to-End Request Flow

### Complete User Journey (Client-Side Pipeline)

```
User Action                           System Response
───────────                           ───────────────
1. Select boundary                    → BoundarySelector resolves admin hierarchy
   (CoRE Stack / Google / GeoJSON)       + fetches GeoJSON geometry

2. Select layers                      → LayerSelector: cropping_intensity,
   (checkboxes)                          surface_water, vegetation

3. Select years                       → Year range picker (2019-2023)

4. Click "Run Analysis"               → Dashboard.handleWASMSubmit()

5. [WASM] Pipeline Selection          → Determines Primary (Raster) or Secondary (MWS)
   
6. [Primary: Raster]                  → rasterEngine.js
   ├─ Fetch Signed GEE URL            → GET /api/v1/gee/signed-url (bbox)
   ├─ Load Pyodide + NumPy            → CDN load
   ├─ Sequential Year Loop            → For each selected fiscal year:
   │  ├─ Download GeoTIFF             → Fetches full TIFF from GEE
   │  ├─ Parse & Mask                 → geotiff.js + turf.booleanPointInPolygon
   │  ├─ Compute Pixel Histogram      → Python WASM: numpy.bincount
   │  └─ Free Memory                  → Clear ArrayBuffer + Pyodide namespace
   └─ Return village-level results    → { cropping_intensity, surface_water, ... }

7. [Secondary: MWS Vector]            → wasmEngine.tryMWSAnalytics()
   ├─ Fetch MWS geometries            → GET /api/v1/corestack/mws-geometries
   ├─ Fetch tehsil analytics data     → GET /api/v1/corestack/tehsil-data
   ├─ Load Pyodide + Shapely          → CDN load + micropip install
   ├─ Run spatial intersection        → Python WASM: compute_intersections()
   ├─ Run weighted aggregation        → Python WASM: aggregate_cropping(), etc.
   └─ Return village-level results    → { cropping_intensity, surface_water, ... }

8. Render results                     → ReportViewer.jsx
   ├─ Summary statistics cards
   ├─ Chart.js stacked bar charts
   ├─ Data tables
   ├─ Deforestation transitions
   ├─ Auto-generated narrative        → LLM generation (Village Stories)
   └─ Export buttons                  → Client-side HTML/CSV/JSON/PDF
```

---

## 6. Boundary Selection (3 Input Methods)

The `BoundarySelector.jsx` component (857 lines) supports three boundary input methods:

### Method 1: Cascading Selector (GEE + CoRE Stack)

```
State → District → Tehsil → Village
```

- Fetches the pan-India administrative hierarchy (States, Districts, Tehsils) dynamically from GEE proxy routes.
- Checks MWS availability for the selected tehsil by validating against CoRE Stack's `GET /api/v1/corestack/active-locations`.
- Each dropdown populates the next level. If a district or tehsil has no data, the selector intelligently skips it.
- Village selection fetches GeoJSON geometry from the GEE `Village_pan_india` dataset. If no villages exist, it gracefully falls back to the tehsil or district boundary.
- Returns: `{ state, district, tehsil, village_name, boundary_geojson, boundary_id, mwsAvailable }`

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

## 7. Execution Modes (100% Client-Side)

### High Accuracy Raster & MWS Vector Pipelines

| Step                    | Where                        | What Happens                             |
| ----------------------- | ---------------------------- | ---------------------------------------- |
| Boundary resolution     | Backend API                  | Protects API tokens from exposure        |
| Raw data fetch          | Backend API → CoRE Stack/GEE | Backend proxies external APIs            |
| **Spatial computation** | **Browser (Pyodide WASM)**   | Shapely intersection + numpy aggregation |
| Visualization           | Browser (React + Chart.js)   | Direct rendering                         |

**Why WASM?** Zero server compute cost. The browser runs Python via WebAssembly. Multiple users can run analytics simultaneously without loading the server.

---

## 8. Analytics Pipelines

The application features a dual-tier execution architecture to ensure maximum accuracy when possible, with robust fallbacks.

### 8.1 Primary Pipeline: High Accuracy Raster (IndiaSAT LULC)

The **primary and preferred** data path uses the **10m IndiaSAT LULC v3** dataset directly from Google Earth Engine. The browser fetches a signed GeoTIFF URL, downloads the full-resolution raster, and processes the pixels natively in WebAssembly.

#### A. Pixel Extraction & Masking
1. The backend proxy generates a signed GEE download URL for a bounding box covering the village polygon.
2. The browser downloads the GeoTIFF using `geotiff.js`.
3. The browser generates a mask: for every pixel in the bounding box, it calculates the geographic coordinates and uses `turf.booleanPointInPolygon` to determine if the pixel falls exactly within the village boundary.
4. Masked pixels are fed into a NumPy array (via Pyodide) to generate a histogram of LULC classes.

#### B. Pixel Area Calculation
Unlike vector data which provides pre-calculated areas, the raster path calculates physical area by multiplying the count of pixels by the physical area of a single pixel. 
The area of a pixel (in hectares) varies slightly by latitude and is calculated as:

$$\text{pixel\_area\_ha} = \text{width}_{km} \times \text{height}_{km} \times 100 / \text{total\_pixels\_in\_bbox}$$

#### C. LULC Class Mappings
Metrics are derived by grouping specific pixel classes from the IndiaSAT classification:

**Cropping Intensity**
- **Single Crop Area:** Class 8 (Kharif) + Class 9 (Non-Kharif)
- **Double Crop Area:** Class 10
- **Triple Crop Area:** Class 11
- **Total Cropped Area (NSA):** Single + Double + Triple
- **Intensity Index:** `(Single*1 + Double*2 + Triple*3) / NSA`

**Surface Water (Cumulative Seasons)**
- **Kharif Water:** Classes 2 + 3 + 4
- **Rabi Water:** Classes 3 + 4
- **Zaid Water:** Class 4
- **Total Water:** Classes 2 + 3 + 4 (unique pixels)

#### D. Raster Change Detection
Because the raster pipeline processes raw pixels year-by-year, change detection is computed dynamically in Pyodide by comparing the pixel arrays of the *first available year* against the *last available year*.

**Crop Intensity Change**
Pixels are grouped by cropping intensity level (Single=Classes 8 & 9, Double=Class 10, Triple=Class 11). For each pixel, the starting level is compared against the ending level. Any pixel where the ending level is higher than the starting level (e.g., Single → Double) is summed into the **Total Change CropIntensity**.

**Vegetation & Tree Cover Change**
Calculates pixel-by-pixel transitions involving Class 6 (Tree Cover):
- **Afforestation (Gain):** Pixels that were *not* Class 6 in the start year, but *are* Class 6 in the end year.
- **Deforestation (Loss):** Pixels that *were* Class 6 in the start year, but transitioned to a different class in the end year. The new class determines the transition label (e.g., Tree Cover → Built Up).
- **Net Change:** Total Tree Cover (end year) - Total Tree Cover (start year).

---

### 8.2 Secondary Pipeline: MWS Vector (CoRE Stack API)

When raw raster computation fails or is unavailable, the system falls back to the **MWS Vector pipeline**, utilizing pre-aggregated CoRE Stack API data indexed by Micro-Watersheds.

#### A. Spatial Intersection Mathematics (Shapely)
A village boundary can overlap multiple MWS polygons. To determine the village's metrics, we compute the geometric intersection using Pyodide (WASM) and Shapely.

For village polygon $V$ and MWS polygon $M_i$:

$$f_i = \frac{A(V \cap M_i)}{A(M_i)}$$

Where:
- $f_i$ = overlap fraction for MWS $i$ (dimensionless, 0 to 1)
- $V \cap M_i$ = geometric intersection polygon
- $A(\cdot)$ = area function

#### B. Weighted Aggregation Formulas
Once we have overlap fractions, we aggregate MWS-level metrics to the village level using two methods:

**Weighted Sum** (for extensive properties like hectares):
$$\text{village\_value} = \sum_{i} \text{mws\_value}_i \times f_i$$
*Used for: cropped area, water area, forest area, etc.*

**Weighted Average** (for intensive properties like indices):
$$\text{village\_value} = \frac{\sum_{i} \text{mws\_value}_i \times f_i}{\sum_{i} f_i}$$
*Used for: cropping intensity index, density percentages.*

### 8.3 Cropping Intensity Aggregation

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

### 8.4 Surface Water Aggregation

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

### 8.5 Vegetation & Deforestation Aggregation

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


### 8.6 Crop Intensity Change Detection

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

### 8.7 Waterbodies

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


## 9. All Backend API Endpoints

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

## 10. All CoRE Stack API Methods Used

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

## 11. Output Generation & Visualization

### ReportViewer.jsx (711 lines)

The report viewer renders results into these sections:

#### 1. Header & Summary Stats

- Village name, state, district, tehsil
- Data source badge (CoRE Stack MWS Vector or IndiaSAT LULC Raster)
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


#### 6. Waterbodies

- **Table:** Individual waterbody names, types, and areas

#### 7. Auto-Generated Narrative (`generateNarrative()`)

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

## 12. Export Formats

### Client-Side Exports (ExportManager.jsx)

| Format   | Generation Method                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------- |
| **HTML** | `wasmEngine.generateHTMLReport()` — full standalone HTML with inline Chart.js, CSS, and data tables |
| **CSV**  | `wasmEngine.generateCSV()` — comma-separated values for all metrics                                 |
| **JSON** | `JSON.stringify(results)` — raw JSON data                                                           |
| **PDF**  | Client-side generation (html2pdf)                                                                   |


---

## 13. Authentication System

### JWT Token Flow

```python
# app/utils/auth_middleware.py
async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False)),
) -> dict | None:
    if not settings.REQUIRE_AUTH:
        return None  # Auth disabled — allow all requests

    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        token = credentials.credentials
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
```

- **REQUIRE_AUTH** setting controls whether authentication is enforced
- JWT tokens signed with HS256 algorithm
- Tokens include `sub`, `exp`, and `api_key` claims
- API endpoints use `Depends(verify_token)` to enforce auth only when configured


### Token Generation

```
POST /api/v1/auth/token
Body: { "username": "...", "password": "..." }
Response: { "access_token": "eyJ...", "token_type": "bearer" }
```

---

## 14. Database Models

### Village Story Models (`models/village_story.py`, `models/custom_slide.py`)

The database now primarily stores LLM-generated narrative content and cached slide configurations for the Village Storyboard.

```python
class VillageStory(Base):
    __tablename__ = "village_stories"

    id          = Column(UUID, primary_key=True)
    village_name= Column(String, index=True)
    state       = Column(String)
    osm_data    = Column(JSONB)       # Contextual map data for LLM
    narrative   = Column(Text)        # Generated text
```

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

---

## 15. AI Storyboard Generation

The CSVAT platform includes an automated AI Storyboard generator that synthesizes the complex raster/vector analytics into a 14-slide narrative presentation.

### Data Preparation (Frontend)
Before calling the AI, the frontend (`sc.py` or equivalent via `llmEngine.js`) orchestrates data collection:
1. **Satellite Analytics**: Extracts the computed LULC metrics, crop intensity changes, and vegetation transitions.
2. **OSM Overpass**: Queries OpenStreetMap via the Overpass API to fetch local infrastructure (road types, building counts, amenities) and **named landmarks** (rivers, forests, heritage sites).
3. **Data Structuring**: Aggregates this raw data into a dense JSON payload (`insights`, `osm_summary`, `landmarks`).

### LLM Prompting (Backend)
The frontend sends the structured JSON to the backend proxy (`POST /api/v1/storyboard/generate`). The backend injects this data into a highly constrained system prompt instructing the model to act as a GIS analyst.
- **Model Used**: `meta-llama/llama-4-scout-17b-16e-instruct` (via Groq).
- **Constraints**: Strict JSON output, no filler text, mandatory 14-slide structure.
- **Security**: The `GROQ_API_KEY` remains securely on the server; the frontend only passes data.

### Storage & Retrieval
Once Groq returns the JSON slides, the frontend sends them to `POST /api/v1/storyboard/{village_id}` to be cached in the PostgreSQL database. Subsequent requests for the same village fetch the cached slides via `GET /api/v1/storyboard/{village_id}`.

---

## 16. Complete Mathematical Formula Reference

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

### Area (Bounding Box Approximation)

$$\text{width}_{km} = \Delta\text{lng} \times 111.32 \times \cos\left(\frac{\text{lat}_{avg} \times \pi}{180}\right)$$

$$\text{height}_{km} = \Delta\text{lat} \times 110.574$$

$$\text{area}_{ha} = \text{width}_{km} \times \text{height}_{km} \times 100$$

### Fiscal Year Mapping

$$\text{fiscal\_year}(Y) = \text{"}(Y-1)\text{-}Y\text{"}$$

Example: $\text{fiscal\_year}(2023) = \text{"2022-2023"}$

---



### Engineering Highlights

9. **Pyodide enables zero-cost scaling.** By running Python (Shapely + numpy) in the browser, the server handles zero compute. Only data proxying costs bandwidth.

10. **Docker Compose for reproducibility.** Two containers (PostGIS, FastAPI) with health checks.

11. **GeoAlchemy2 for spatial persistence.** Job boundaries are stored as PostGIS `MULTIPOLYGON` geometries, enabling future spatial queries.

12. **Three boundary input methods** ensure any village in India can be analyzed: CoRE Stack hierarchy (structured), Google Places (fuzzy search), or GeoJSON upload (custom).

### Key Technical Decisions

13. **Why proxy GEE through backend?** GEE requires a service account key (credentials). Embedding this in the frontend would be a security risk. The backend handles authentication and returns only signed download URLs for the client to safely download the GeoTIFF.

14. **Why fiscal years for CoRE Stack?** India's agricultural year runs April–March. CoRE Stack stores data by fiscal year (e.g., "2022-2023" for crops harvested in that period). The conversion `year Y → "${Y-1}-${Y}"` aligns calendar year inputs with CoRE Stack keys.


---

## Appendix A: File-by-File Reference

| File                                                | Lines | Role                                                  |
| --------------------------------------------------- | ----- | ----------------------------------------------------- |
| `frontend/src/pages/Dashboard.jsx`                  | 487   | Main orchestration — mode switching, state management |
| `frontend/src/services/wasmEngine.js`               | 815   | Raster & MWS pipelines + CSV/HTML generation          |
| `frontend/src/services/pyodideEngine.js`            | 372   | Pyodide loader + raster analytics Python code         |
| `frontend/src/components/BoundarySelector.jsx`      | 857   | 3-mode boundary input component                       |
| `frontend/src/components/ReportViewer.jsx`          | 711   | Results visualization + narrative generation          |
| `frontend/src/components/ExportManager.jsx`         | ~120  | Export buttons + blob generation                      |
| `frontend/src/components/GoogleMapsIntegration.jsx` | 470   | Google Maps + Places + area computation               |
| `frontend/src/components/LayerSelector.jsx`         | —     | Checkbox layer selection                              |
| `frontend/src/services/api.js`                      | —     | HTTP helper (axios/fetch wrapper)                     |
| `backend/app/main.py`                               | —     | FastAPI app + CORS + router mounting                  |
| `backend/app/config.py`                             | —     | Pydantic settings (env-based config)                  |
| `backend/app/database.py`                           | —     | SQLAlchemy engine + session factory                   |
| `backend/app/api/corestack.py`                      | —     | CoRE Stack proxy routes                               |
| `backend/app/api/gee.py`                            | ~105  | GEE raster download URL proxy routes                  |
| `backend/app/api/storyboard.py`                     | —     | LLM narrative generation controller                   |
| `backend/app/api/village_stories.py`                | —     | Story caching / retrieval                             |
| `backend/app/api/custom_slides.py`                  | —     | Custom slide configuration                            |
| `backend/app/api/boundaries.py`                     | —     | Boundary resolution routes                            |
| `backend/app/api/auth.py`                           | —     | JWT token endpoint                                    |
| `backend/app/api/layers.py`                         | —     | Layer metadata endpoint                               |
| `backend/app/services/corestack_client.py`          | 325   | httpx client for all CoRE Stack APIs                  |
| `backend/app/services/gee_service.py`               | ~285  | ee library GEE URL signing                            |
| `backend/app/services/boundary_service.py`          | ~140  | GeoJSON validation + admin resolution                 |
| `backend/app/services/village_search.py`            | —     | Village name search utility                           |
| `backend/app/models/boundary.py`                    | —     | SQLAlchemy CachedBoundary model                       |
| `backend/app/models/village_story.py`               | —     | SQLAlchemy VillageStory model                         |
| `backend/app/schemas/__init__.py`                   | —     | Pydantic request/response schemas                     |
| `backend/app/utils/auth_middleware.py`              | —     | JWT verification dependency                           |
| `docker-compose.yml`                                | 78    | 2-service Docker orchestration                        |

---

## Appendix B: Environment Variables

| Variable                        | Purpose                                                             |
| ------------------------------- | ------------------------------------------------------------------- |
| `CORESTACK_API_BASE_URL`        | CoRE Stack API base (e.g., `https://api-doc.core-stack.org/api/v1`) |
| `CORESTACK_API_KEY`             | X-API-Key for CoRE Stack authentication                             |
| `GEE_API_KEY`                   | Google Earth Engine API Key                                         |
| `GEE_SERVICE_ACCOUNT`           | Google service account email                                        |
| `GEE_KEY_JSON` / `GEE_KEY_FILE` | Service account credentials                                         |
| `GEE_PROJECT`                   | Google Cloud project ID                                             |
| `GOOGLE_MAPS_KEY`               | Google Maps API key (for backend static map proxy)                  |
| `DATABASE_URL`                  | PostgreSQL connection string                                        |
| `JWT_SECRET_KEY`                | Secret for JWT signing                                              |
| `REQUIRE_AUTH`                  | Enable/disable authentication                                       |
| `VITE_API_BASE`                 | Frontend API URL (e.g., `http://localhost:8000`)                    |
| `VITE_GOOGLE_MAPS_KEY`          | Google Maps JavaScript API key (for frontend MapView / search)      |
| `GROQ_API_KEY`                  | Groq API key for LLM                                                |


---
