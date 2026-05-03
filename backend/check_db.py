from app.database import engine
from sqlalchemy import text
with engine.connect() as conn:
    res = conn.execute(text("SELECT data_type FROM information_schema.columns WHERE table_name = 'village_storyboard_slides' AND column_name = 'village_id';"))
    print("Column type:", res.scalar())
