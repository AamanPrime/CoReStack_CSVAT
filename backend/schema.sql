-- ============================================================
-- CSVAT Database Schema — PostgreSQL (Neon compatible)
-- Run this to initialize a fresh database
-- ============================================================

-- 1. Enum types
DO $$ BEGIN
    CREATE TYPE jobstatus AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE executionmode AS ENUM ('SERVER', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id              VARCHAR(36) PRIMARY KEY,
    boundary_id     VARCHAR(255),
    boundary_geojson JSON,
    village_name    VARCHAR(255),
    state           VARCHAR(255),
    district        VARCHAR(255),
    tehsil          VARCHAR(255),
    layers          JSON NOT NULL DEFAULT '[]',
    years           JSON NOT NULL DEFAULT '[]',
    mode            executionmode DEFAULT 'SERVER',
    status          jobstatus DEFAULT 'PENDING',
    result_json     JSON,
    error_message   TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);

-- 3. Cached Boundaries table
CREATE TABLE IF NOT EXISTS cached_boundaries (
    id              VARCHAR(36) PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    state           VARCHAR(255),
    district        VARCHAR(255),
    tehsil          VARCHAR(255),
    village_code    VARCHAR(50) UNIQUE,
    geom            JSON,
    area_hectares   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_boundaries_name ON cached_boundaries (name);
CREATE INDEX IF NOT EXISTS idx_boundaries_state ON cached_boundaries (state);
CREATE INDEX IF NOT EXISTS idx_boundaries_district ON cached_boundaries (district);
CREATE INDEX IF NOT EXISTS idx_boundaries_tehsil ON cached_boundaries (tehsil);

-- 4. Village Stories table
CREATE TABLE IF NOT EXISTS village_stories (
    id              VARCHAR(36) PRIMARY KEY,
    village_id      INTEGER NOT NULL UNIQUE,
    name            VARCHAR(255) NOT NULL,
    state           VARCHAR(255) NOT NULL,
    district        VARCHAR(255) NOT NULL,
    tehsil          VARCHAR(255) NOT NULL,
    population_2011 INTEGER,
    households_2011 INTEGER,
    males_2011      INTEGER,
    females_2011    INTEGER,
    literacy_rate   REAL,
    languages       JSON,
    temples         JSON,
    economy         TEXT,
    historical_context TEXT,
    cultural_notes  TEXT,
    story_chapters  JSON NOT NULL DEFAULT '[]',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stories_village_id ON village_stories (village_id);
CREATE INDEX IF NOT EXISTS idx_stories_name ON village_stories (name);
CREATE INDEX IF NOT EXISTS idx_stories_state ON village_stories (state);
CREATE INDEX IF NOT EXISTS idx_stories_district ON village_stories (district);
CREATE INDEX IF NOT EXISTS idx_stories_tehsil ON village_stories (tehsil);

-- 5. Custom Slides table
CREATE TABLE IF NOT EXISTS custom_slides (
    id              VARCHAR(36) PRIMARY KEY,
    village_name    VARCHAR(255) NOT NULL,
    slide_order     INTEGER NOT NULL DEFAULT 0,
    title           VARCHAR(500) NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    image_url       VARCHAR(1000) DEFAULT '',
    map_center_lat  REAL,
    map_center_lng  REAL,
    map_zoom        INTEGER DEFAULT 14,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slides_village ON custom_slides (village_name);

-- 6. Village Storyboard Slides table (AI-generated, on-demand, cached by village_id)
CREATE TABLE IF NOT EXISTS village_storyboard_slides (
    id              VARCHAR(36) PRIMARY KEY,
    village_id      VARCHAR(128) NOT NULL UNIQUE,
    village_name    VARCHAR(255) NOT NULL,
    state           VARCHAR(255),
    district        VARCHAR(255),
    tehsil          VARCHAR(255),
    total_area      VARCHAR(100),
    slides          JSON NOT NULL DEFAULT '[]',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storyboard_village_id ON village_storyboard_slides (village_id);
CREATE INDEX IF NOT EXISTS idx_storyboard_village_name ON village_storyboard_slides (village_name);

