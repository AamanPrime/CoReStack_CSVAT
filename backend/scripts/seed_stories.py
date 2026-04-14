#!/usr/bin/env python3
"""Seed village stories into the CSVAT PostgreSQL database."""
import psycopg2, json, uuid, sys

DB_HOST = "localhost"
DB_PORT = 5435
DB_NAME = "csvat_db"
DB_USER = "csvat"
DB_PASS = "csvat_pass"

JSON_FILE = sys.argv[1] if len(sys.argv) > 1 else "/home/aamanprime/Projects/CSVAT_CoReStack/backend/app/data/village_stories_batch_1_output.json"

print(f"Connecting to {DB_HOST}:{DB_PORT}/{DB_NAME}...")
conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS)
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM village_stories")
print(f"Existing stories in DB: {cur.fetchone()[0]}")

with open(JSON_FILE) as f:
    stories = json.load(f)
print(f"Loaded {len(stories)} stories from {JSON_FILE}")

created = updated = 0
for i, s in enumerate(stories):
    vid = s["village_id"]
    cur.execute("SELECT id FROM village_stories WHERE village_id = %s", (vid,))
    row = cur.fetchone()
    vals = (
        s["name"], s["state"], s["district"], s["tehsil"],
        s.get("population_2011"), s.get("households_2011"),
        s.get("males_2011"), s.get("females_2011"),
        s.get("literacy_rate"),
        json.dumps(s.get("languages", [])),
        json.dumps(s.get("temples", [])),
        s.get("economy", ""),
        s.get("historical_context", ""),
        s.get("cultural_notes", ""),
        json.dumps(s.get("story_chapters", [])),
    )
    if row:
        cur.execute("""UPDATE village_stories SET
            name=%s, state=%s, district=%s, tehsil=%s,
            population_2011=%s, households_2011=%s, males_2011=%s, females_2011=%s,
            literacy_rate=%s, languages=%s, temples=%s, economy=%s,
            historical_context=%s, cultural_notes=%s, story_chapters=%s,
            updated_at=NOW() WHERE village_id=%s""", vals + (vid,))
        updated += 1
    else:
        cur.execute("""INSERT INTO village_stories
            (id, village_id, name, state, district, tehsil,
             population_2011, households_2011, males_2011, females_2011,
             literacy_rate, languages, temples, economy,
             historical_context, cultural_notes, story_chapters)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (str(uuid.uuid4()), vid) + vals)
        created += 1

    if (i + 1) % 50 == 0:
        print(f"  Processed {i+1}/{len(stories)}...")

conn.commit()
print(f"\nDone! Created: {created}, Updated: {updated}, Total: {created+updated}")

cur.execute("SELECT COUNT(*) FROM village_stories")
print(f"\nTotal stories in DB: {cur.fetchone()[0]}")
cur.execute("SELECT state, COUNT(*) FROM village_stories GROUP BY state ORDER BY COUNT(*) DESC")
for state, count in cur.fetchall():
    print(f"  {state}: {count}")

cur.close()
conn.close()
