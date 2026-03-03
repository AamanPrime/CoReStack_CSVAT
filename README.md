# CoRE Stack Village Analytics Tool (CSVAT)

A full-stack geospatial analytics platform built with **FastAPI**, **React (Vite)**, **PostgreSQL/PostGIS**, **Redis**, and **Celery**.

---

## Prerequisites

| Tool              | Version  | Install Guide                                |
| ----------------- | -------- | -------------------------------------------- |
| **Docker**        | ≥ 24.x   | https://docs.docker.com/engine/install/      |
| **Docker Compose**| ≥ 2.x    | Included with Docker Desktop                 |
| **Node.js**       | ≥ 18.x   | https://nodejs.org/                          |
| **npm**           | ≥ 9.x    | Comes with Node.js                           |

---

## Project Structure

```
CSVAT_CoreStack/
├── backend/               # FastAPI backend
│   ├── app/               # Application source code
│   ├── Dockerfile         # Backend Docker image
│   ├── requirements.txt   # Python dependencies
│   ├── .env               # Backend env vars (gitignored)
│   └── .env.example       # Template for backend env vars
├── frontend/              # React + Vite frontend
│   ├── src/               # Frontend source code
│   ├── package.json       # Node dependencies
│   ├── vite.config.js     # Vite configuration
│   └── .env               # Frontend env vars (gitignored)
├── docker-compose.yml     # Orchestrates all backend services
└── README.md
```

---

## Quick Start

### 1. Clone the repository

```bash
git clone <repo-url>
cd CSVAT_CoreStack
```

### 2. Configure environment variables

**Backend** — copy the example and fill in your values:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set:

| Variable                    | Description                              |
| --------------------------- | ---------------------------------------- |
| `DATABASE_URL`              | PostgreSQL connection string             |
| `REDIS_URL`                 | Redis connection string                  |
| `CORESTACK_API_BASE_URL`    | CoRE Stack API endpoint                  |
| `CORESTACK_API_KEY`         | Your CoRE Stack API key                  |
| `JWT_SECRET_KEY`            | A random secret for JWT signing          |
| `GEE_API_KEY`               | Google Earth Engine API key              |
| `GEE_PROJECT`               | GEE project ID                           |
| `GEE_SERVICE_ACCOUNT`       | GEE service account email                |
| `GEE_KEY_FILE`              | Path to GEE service account key JSON     |

**Frontend** — create `frontend/.env`:

```bash
VITE_API_BASE=http://localhost:8006
VITE_GOOGLE_MAPS_KEY=your-google-maps-api-key
```

### 3. Start backend services (Docker)

```bash
docker compose up -d --build
```

This starts **4 containers**:

| Container      | Service          | Port           |
| -------------- | ---------------- | -------------- |
| `csvat_db`     | PostgreSQL + PostGIS | `5435 → 5432` |
| `csvat_redis`  | Redis            | `6379 → 6379`  |
| `csvat_api`    | FastAPI backend  | `8006 → 8000`  |
| `csvat_worker` | Celery worker    | —              |

### 4. Start frontend dev server

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at **http://localhost:5173**.

---

## Accessing the Application

| Service             | URL                                  |
| ------------------- | ------------------------------------ |
| **Frontend**        | http://localhost:5173                 |
| **Backend API**     | http://localhost:8006                 |
| **API Docs (Swagger)** | http://localhost:8006/docs         |
| **API Docs (ReDoc)**   | http://localhost:8006/redoc        |

---

## Useful Commands

### View logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f db
```

### Stop all services

```bash
docker compose down
```

### Stop and remove volumes (⚠️ deletes database data)

```bash
docker compose down -v
```

### Rebuild after code/dependency changes

```bash
docker compose up -d --build
```

### Check service status

```bash
docker compose ps
```

---

## Development Notes

- The **frontend** proxies `/api` requests to the backend (configured in `vite.config.js`).
- The **backend** uses hot-reload via `--reload` in the Uvicorn command — code changes in `backend/app/` are reflected immediately.
- The **Celery worker** processes background tasks (analytics jobs, report generation).
- **PostGIS** is enabled in the database for geospatial queries.

---

## Troubleshooting

| Issue | Solution |
| ----- | -------- |
| Containers won't start | Run `docker compose logs` to check errors |
| Port conflict | Change ports in `docker-compose.yml` |
| Database connection refused | Wait for `csvat_db` health check to pass |
| Frontend can't reach API | Ensure `VITE_API_BASE` in `frontend/.env` matches the API port |
| Worker crashes | Check `docker compose logs worker` for import errors |
