---
description: Deploy CSVAT to Vercel and Render for 24/7 Free Hosting
---

# 🚀 Deployment Workflow (Free & 24/7)

Follow these steps to put CSVAT online without using Docker, Redis, or Celery.

## 1. Prepare GitHub Repository

1. Create a new repository on GitHub.
2. Push your project:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for deployment"
   git branch -M main
   git remote add origin https://github.com/yourusername/csvat.git
   git push -u origin main
   ```

## 2. Deploy Backend & Database (Render)

1. Sign up at [Render.com](https://render.com).
2. **Create Database**:
   - Dashboard -> New -> **PostgreSQL**.
   - Name: `csvat-db`.
   - Take note of the **Internal Database URL** for later.
3. **Create Web Service**:
   - Dashboard -> New -> **Web Service**.
   - Connect your GitHub repo.
   - Root Directory: `backend`.
   - Runtime: `Python 3`.
   - Build Command: `pip install -r requirements.txt`.
   - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
   - **Environment Variables**:
     - `DATABASE_URL`: (Render might auto-link this if you create them in the same group).
     - `PYTHON_VERSION`: `3.11.0`.
     - `GEE_API_KEY`: (Your Google Earth Engine Key).
4. Copy your backend URL (e.g., `https://csvat-backend.onrender.com`).

## 3. Deploy Frontend (Vercel)

1. Sign up at [Vercel.com](https://vercel.com).
2. **New Project**:
   - Import your GitHub repo.
   - Root Directory: `frontend`.
   - Framework Preset: **Vite**.
   - Build Command: `npm run build`.
   - Output Directory: `dist`.
   - **Environment Variables**:
     - `VITE_API_BASE`: `https://csvat-backend.onrender.com` (Your backend URL).
3. Click **Deploy**.

## 4. Keep it 24/7 (Heartbeat)

1. Go to [cron-job.org](https://cron-job.org).
2. Create a new "Cronjob".
3. Title: `CSVAT Heartbeat`.
4. URL: `https://csvat-backend.onrender.com/health`.
5. Execution schedule: **Every 10 minutes**.
6. This prevents Render's free tier from sleeping.

## 🏁 Verification

1. Visit your Vercel URL.
2. Select a village and click "Run Analytics".
3. If everything loads, you're live!
