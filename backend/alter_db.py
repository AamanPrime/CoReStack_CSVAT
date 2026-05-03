from app.database import engine
from sqlalchemy import text

with engine.begin() as conn:
    conn.execute(text('ALTER TABLE village_storyboard_slides ALTER COLUMN village_id TYPE VARCHAR(128);'))
    print("Successfully altered village_storyboard_slides on remote DB!")
