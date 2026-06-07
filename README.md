# CoRE Stack Village Analytics Tool (CSVAT)

A full-stack geospatial analytics platform that generates village-level socio-ecological insights from [CoRE Stack](https://core-stack.org/) satellite datasets. Built with **FastAPI**, **React (Vite)**, **PostgreSQL/PostGIS**, and **Pyodide (Python WASM)**.

---

## Prerequisites

| Tool               | Version | Install Guide                                      |
| ------------------ | ------- | -------------------------------------------------- |
| **Docker**         | ≥ 24.x  | https://docs.docker.com/engine/install/             |
| **Docker Compose** | ≥ 2.x   | Included with Docker Desktop                       |
| **Node.js**        | ≥ 18.x  | https://nodejs.org/                                |
| **npm**            | ≥ 9.x   | Comes with Node.js                                 |
| **Git**            | ≥ 2.x   | https://git-scm.com/                               |

---

## Project Structure

```
CSVAT_CoReStack/
├── backend/                    # FastAPI backend
│   ├── app/                    # Application source code
│   │   ├── api/                # API route handlers
│   │   ├── data/               # Village stories JSON seed data
│   │   ├── models/             # SQLAlchemy ORM models
│   │   ├── services/           # Core business logic
│   │   ├── tasks/              # Background tasks (FastAPI BackgroundTasks)
│   │   ├── config.py           # Pydantic settings (env-based)
│   │   ├── database.py         # SQLAlchemy engine & sessions
│   │   └── main.py             # FastAPI app entry point
│   ├── docker/                 # Docker initialization scripts
│   │   └── init-db.sh          # Auto-seeds DB on first boot
│   ├── scripts/                # Utility scripts
│   ├── schema.sql              # Database schema (tables, indexes)
│   ├── Dockerfile              # Backend Docker image
│   ├── requirements.txt        # Python dependencies
│   ├── .env                    # Backend env vars (gitignored)
│   └── .env.example            # Template for backend env vars
├── frontend/                   # React + Vite frontend
│   ├── src/
│   │   ├── components/         # React UI components
│   │   ├── pages/              # Page-level components
│   │   └── services/           # API clients, analytics engines
│   ├── package.json            # Node dependencies
│   ├── vite.config.js          # Vite configuration
│   ├── .env                    # Frontend env vars (gitignored)
│   └── .env.example            # Template for frontend env vars
├── docker-compose.yml          # Orchestrates all backend services
└── README.md
```

---

## Installation Guide

### Step 1 — Clone the Repository

```bash
git clone <repo-url>
cd CSVAT_CoReStack
```

### Step 2 — Configure Backend Environment

Copy the example and fill in your API keys:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
# Database (auto-configured for Docker — change only for external DB)
DATABASE_URL=postgresql://csvat:csvat_pass@db:5432/csvat_db

# CoRE Stack API (required — get from https://core-stack.org/)
CORESTACK_API_BASE_URL=https://api.core-stack.org
CORESTACK_API_KEY=your-corestack-api-key

# JWT Authentication
JWT_SECRET_KEY=change-me-to-a-random-secret
JWT_ALGORITHM=HS256
JWT_EXPIRY_MINUTES=60

# Google Earth Engine (required for raster extraction)
GEE_API_KEY=your-gee-api-key
GEE_PROJECT=your-gcp-project-id
GEE_SERVICE_ACCOUNT=your-sa@project.iam.gserviceaccount.com
GEE_KEY_FILE=path/to/gee-key.json
```

> **Important**: The `DATABASE_URL` value above uses Docker service names (`db`) — this resolves automatically inside Docker Compose. Do not change it unless you are running without Docker.

### Step 3 — Configure Frontend Environment

```bash
cp frontend/.env.example frontend/.env
```

Edit `frontend/.env`:

```env
VITE_API_BASE=http://localhost:8000
VITE_GOOGLE_MAPS_KEY=your-google-maps-api-key
```

### Step 4 — Start Backend Services (Docker)

```bash
docker compose up -d --build
```

This starts **2 containers**:

| Container      | Service              | Port          | Description                           |
| -------------- | -------------------- | ------------- | ------------------------------------- |
| `csvat_db`     | PostgreSQL + PostGIS | `5435 → 5432` | Spatial database with auto-init       |
| `csvat_api`    | FastAPI backend      | `8000 → 8000` | REST API server (hot-reload enabled)  |

**On first boot**, the database automatically:
1. Creates all tables from `schema.sql`
2. Seeds **312 village stories** from `village_stories_batch_1_output.json`

> To re-initialize the database from scratch, remove the volume and restart:
> ```bash
> docker compose down -v && docker compose up -d --build
> ```

### Step 5 — Start Frontend Dev Server

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at **http://localhost:5173**.

---

## Accessing the Application

| Service                | URL                         |
| ---------------------- | --------------------------- |
| **Frontend**           | http://localhost:5173        |
| **Backend API**        | http://localhost:8000        |
| **API Docs (Swagger)** | http://localhost:8000/docs   |
| **API Docs (ReDoc)**   | http://localhost:8000/redoc  |
| **Health Check**       | http://localhost:8000/health |

---

## API Keys Required

| Key                    | Provider                      | Used For                                 |
| ---------------------- | ----------------------------- | ---------------------------------------- |
| `CORESTACK_API_KEY`    | [CoRE Stack](https://core-stack.org/) | MWS data, village geometries, raster layers |
| `GEE_SERVICE_ACCOUNT`  | [Google Earth Engine](https://earthengine.google.com/) | IndiaSAT LULC raster extraction, GEE fallback |
| `VITE_GOOGLE_MAPS_KEY` | [Google Cloud Console](https://console.cloud.google.com/) | Maps display, Places autocomplete |

---

## Useful Commands

### View logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f db
```

### Stop all services

```bash
docker compose down
```

### Reset database ( deletes all data)

```bash
docker compose down -v
docker compose up -d --build
```

### Rebuild after code/dependency changes

```bash
docker compose up -d --build
```

### Check service status

```bash
docker compose ps
```

### Manually seed village stories (if DB already exists)

```bash
# Via API endpoint
curl -X POST http://localhost:8000/api/v1/village-stories/seed

# Via script (from host machine)
cd backend && python scripts/seed_stories.py app/data/village_stories_batch_1_output.json
```

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    React Frontend (Vite)                  │
│  ┌─────────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │ Dashboard    │  │ Storyboard │  │ Report Viewer     │  │
│  └──────┬──────┘  └─────┬──────┘  └────────┬──────────┘  │
│         │               │                  │              │
│  ┌──────┴───────────────┴──────────────────┴──────────┐  │
│  │  wasmEngine.js  │  rasterEngine.js  │  tileEngine   │  │
│  │  (Pyodide WASM) │  (Client Raster)  │  (geotiff.js) │  │
│  └──────────────────────┬─────────────────────────────┘  │
└─────────────────────────┼────────────────────────────────┘
                          │ HTTP API
┌─────────────────────────┼────────────────────────────────┐
│                  FastAPI Backend                          │
│  ┌──────────┐  ┌───────┴──────┐  ┌─────────────────────┐ │
│  │ CoRE     │  │ GEE Proxy    │  │ Raster Proxy        │ │
│  │ Stack    │  │ (LULC/Water/ │  │ (GeoServer/GEE      │ │
│  │ Proxy    │  │  NDVI)       │  │  tile URLs)         │ │
│  └────┬─────┘  └──────┬───────┘  └──────┬──────────────┘ │
│       │               │                 │                 │
│  ┌────┴───────────────┴─────────────────┴──────────────┐ │
│  │  PostgreSQL/PostGIS                                 │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Computation Paths

| Path             | Resolution | Where           | When                                     |
| ---------------- | ---------- | --------------- | ---------------------------------------- |
| **Raster Tiled** | 10m        | 100% Browser    | Default — downloads GeoTIFF tiles client-side |
| **MWS Vector**   | 10m        | Browser (WASM)  | Fallback — spatial intersection of MWS polygons |
| **GEE Fallback** | 500m       | Browser (WASM)  | When CoRE Stack data unavailable         |

---

## Development Notes

- The **frontend** runs independently via Vite dev server — no need to rebuild Docker for frontend changes.
- The **FastAPI backend** uses hot-reload (`--reload` flag) — code changes in `backend/app/` are reflected immediately.
- **PostGIS** is enabled for geospatial queries (village boundary storage, spatial indexing).
- **Pyodide** (Python WASM) runs in the browser — all analytics computation is client-side by default.

---

## Troubleshooting

| Issue                              | Solution                                                                |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Containers won't start             | Run `docker compose logs` to check errors                               |
| Port conflict on 5435              | Change the DB port mapping in `docker-compose.yml`                      |
| Port conflict on 8000              | Change the API port mapping in `docker-compose.yml`                     |
| Database connection refused        | Wait for `csvat_db` health check: `docker compose ps`                   |
| Frontend can't reach API           | Ensure `VITE_API_BASE=http://localhost:8000` in `frontend/.env`         |
| Village stories not loaded         | Run `curl -X POST http://localhost:8000/api/v1/village-stories/seed`    |
| GEE raster extraction fails        | Verify `GEE_SERVICE_ACCOUNT` and `GEE_KEY_FILE` in `backend/.env`      |
| Docker builds are slow             | Use `docker compose up -d --build` (builds only changed layers)         |
| DB needs full reset                | `docker compose down -v && docker compose up -d --build`                |
