#!/bin/bash
# ============================================================
# CSVAT — Database seed script for Docker.
# Runs on FIRST boot only (when pgdata volume is empty).
#
# 01-schema.sql runs first (creates tables).
# This script (02-seed.sh) runs after to seed village stories.
# ============================================================

set -e

SEED_FILE="/docker-entrypoint-initdb.d/village_stories_batch_1_output.json"

if [ ! -f "$SEED_FILE" ]; then
    echo "[CSVAT] No seed file found — skipping village stories seed."
    exit 0
fi

echo "[CSVAT] Seeding village stories from batch_1 JSON..."

# Load JSON file directly into a temp table and insert into village_stories.
# All done in a single psql session so the temp table persists.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL

-- Create staging table (not TEMP, so it persists within this script)
CREATE TABLE IF NOT EXISTS _seed_staging (doc JSONB);
TRUNCATE _seed_staging;

-- Insert each JSON array element as a row
-- We read the file content via psql's backtick expansion
\set seed_json \`cat $SEED_FILE\`

INSERT INTO _seed_staging (doc)
SELECT jsonb_array_elements(:'seed_json'::jsonb);

-- Insert into village_stories from staging
INSERT INTO village_stories (
    id, village_id, name, state, district, tehsil,
    population_2011, households_2011, males_2011, females_2011,
    literacy_rate, languages, temples, economy,
    historical_context, cultural_notes, story_chapters
)
SELECT
    gen_random_uuid()::text,
    (doc->>'village_id')::integer,
    COALESCE(doc->>'name', ''),
    COALESCE(doc->>'state', ''),
    COALESCE(doc->>'district', ''),
    COALESCE(doc->>'tehsil', ''),
    (doc->>'population_2011')::integer,
    (doc->>'households_2011')::integer,
    (doc->>'males_2011')::integer,
    (doc->>'females_2011')::integer,
    (doc->>'literacy_rate')::real,
    COALESCE(doc->'languages', '[]'::jsonb)::json,
    COALESCE(doc->'temples', '[]'::jsonb)::json,
    COALESCE(doc->>'economy', ''),
    COALESCE(doc->>'historical_context', ''),
    COALESCE(doc->>'cultural_notes', ''),
    COALESCE(doc->'story_chapters', '[]'::jsonb)::json
FROM _seed_staging
ON CONFLICT (village_id) DO NOTHING;

-- Cleanup
DROP TABLE _seed_staging;

-- Report
DO \$\$
DECLARE cnt INTEGER;
BEGIN
    SELECT COUNT(*) INTO cnt FROM village_stories;
    RAISE NOTICE '[CSVAT] Seeded % village stories!', cnt;
END \$\$;

EOSQL

echo "[CSVAT] Village stories seed complete!"
