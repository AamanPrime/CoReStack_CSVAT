"""CSVAT — Village Stories API.

Serves pre-collected village narrative stories for the Terraso-style
scrollytelling storyboard. Stories are stored in the DB and seeded
from the village_stories.json file.
"""

import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.village_story import VillageStory

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/village-stories", tags=["Village Stories"])

# Path to the pre-collected stories JSON
STORIES_JSON = Path(__file__).resolve().parent.parent / "data" / "village_stories.json"


@router.get("/")
def list_village_stories(
    state: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    tehsil: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List available village stories, optionally filtered by location."""
    query = select(VillageStory)
    if state:
        query = query.where(VillageStory.state == state)
    if district:
        query = query.where(VillageStory.district == district)
    if tehsil:
        query = query.where(VillageStory.tehsil == tehsil)

    query = query.order_by(VillageStory.name)
    result = db.execute(query)
    stories = result.scalars().all()

    return [
        {
            "village_id": s.village_id,
            "name": s.name,
            "state": s.state,
            "district": s.district,
            "tehsil": s.tehsil,
            "population_2011": s.population_2011,
            "chapter_count": len(s.story_chapters) if s.story_chapters else 0,
        }
        for s in stories
    ]


@router.get("/by-name")
def get_story_by_name(
    village: str = Query(..., description="Village name"),
    state: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    tehsil: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Get a village story by name (case-insensitive)."""
    query = select(VillageStory).where(
        func.lower(VillageStory.name) == village.lower()
    )
    if state:
        query = query.where(VillageStory.state == state)
    if district:
        query = query.where(VillageStory.district == district)
    if tehsil:
        query = query.where(VillageStory.tehsil == tehsil)

    result = db.execute(query)
    story = result.scalar_one_or_none()

    if not story:
        raise HTTPException(status_code=404, detail=f"No story found for village: {village}")

    return _serialize_story(story)


@router.get("/stats")
def story_stats(db: Session = Depends(get_db)):
    """Get stats about how many village stories are in the DB."""
    total = db.execute(select(func.count(VillageStory.id)))
    by_state = db.execute(
        select(VillageStory.state, func.count(VillageStory.id))
        .group_by(VillageStory.state)
        .order_by(func.count(VillageStory.id).desc())
    )
    return {
        "total_stories": total.scalar(),
        "by_state": [{"state": r[0], "count": r[1]} for r in by_state.all()],
    }


@router.get("/{village_id}")
def get_story(village_id: int, db: Session = Depends(get_db)):
    """Get the full story for a village by its CoRE Stack village ID."""
    result = db.execute(
        select(VillageStory).where(VillageStory.village_id == village_id)
    )
    story = result.scalar_one_or_none()

    if not story:
        raise HTTPException(status_code=404, detail=f"No story found for village ID: {village_id}")

    return _serialize_story(story)


@router.get("/region-context/{state}/{district}")
def get_region_context(state: str, district: str):
    """Get the regional context (climate, crops, rivers) for a state/district."""
    if not STORIES_JSON.exists():
        raise HTTPException(status_code=404, detail="Stories data file not found")

    with open(STORIES_JSON) as f:
        data = json.load(f)

    region = data.get("region_context", {}).get(state, {}).get(district)
    if not region:
        raise HTTPException(
            status_code=404,
            detail=f"No regional context for {state}/{district}"
        )

    return region


@router.post("/seed")
def seed_stories(db: Session = Depends(get_db)):
    """Seed the database from the village_stories.json file."""
    if not STORIES_JSON.exists():
        raise HTTPException(status_code=404, detail="village_stories.json not found")

    with open(STORIES_JSON) as f:
        data = json.load(f)

    villages_data = data.get("villages", {})
    created = 0
    updated = 0

    for vid_str, vdata in villages_data.items():
        vid = int(vid_str)

        result = db.execute(
            select(VillageStory).where(VillageStory.village_id == vid)
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.name = vdata.get("name", existing.name)
            existing.population_2011 = vdata.get("population_2011", existing.population_2011)
            existing.households_2011 = vdata.get("households_2011", existing.households_2011)
            existing.males_2011 = vdata.get("males_2011", existing.males_2011)
            existing.females_2011 = vdata.get("females_2011", existing.females_2011)
            existing.literacy_rate = vdata.get("literacy_rate", existing.literacy_rate)
            existing.languages = vdata.get("languages", existing.languages)
            existing.temples = vdata.get("temples", existing.temples)
            existing.economy = vdata.get("economy", existing.economy)
            existing.historical_context = vdata.get("historical_context", existing.historical_context)
            existing.cultural_notes = vdata.get("cultural_notes", existing.cultural_notes)
            existing.story_chapters = vdata.get("story_chapters", existing.story_chapters)
            updated += 1
        else:
            story = VillageStory(
                village_id=vid,
                name=vdata.get("name", ""),
                state=vdata.get("state", ""),
                district=vdata.get("district", ""),
                tehsil=vdata.get("tehsil", ""),
                population_2011=vdata.get("population_2011"),
                households_2011=vdata.get("households_2011"),
                males_2011=vdata.get("males_2011"),
                females_2011=vdata.get("females_2011"),
                literacy_rate=vdata.get("literacy_rate"),
                languages=vdata.get("languages"),
                temples=vdata.get("temples"),
                economy=vdata.get("economy"),
                historical_context=vdata.get("historical_context"),
                cultural_notes=vdata.get("cultural_notes"),
                story_chapters=vdata.get("story_chapters", []),
            )
            db.add(story)
            created += 1

    db.commit()
    return {"created": created, "updated": updated, "total": created + updated}


@router.post("/bulk")
def bulk_upsert_stories(
    stories: list[dict],
    db: Session = Depends(get_db),
):
    """Bulk insert/update village stories from a JSON array.

    Accepts the exact format output by the Ollama batch script.
    Upserts by village_id — existing records are updated, new ones created.
    """
    created = 0
    updated = 0
    errors = []

    for i, vdata in enumerate(stories):
        vid = vdata.get("village_id")
        if vid is None:
            errors.append(f"Item {i}: missing village_id")
            continue

        try:
            result = db.execute(
                select(VillageStory).where(VillageStory.village_id == vid)
            )
            existing = result.scalar_one_or_none()

            if existing:
                existing.name = vdata.get("name", existing.name)
                existing.state = vdata.get("state", existing.state)
                existing.district = vdata.get("district", existing.district)
                existing.tehsil = vdata.get("tehsil", existing.tehsil)
                existing.population_2011 = vdata.get("population_2011", existing.population_2011)
                existing.households_2011 = vdata.get("households_2011", existing.households_2011)
                existing.males_2011 = vdata.get("males_2011", existing.males_2011)
                existing.females_2011 = vdata.get("females_2011", existing.females_2011)
                existing.literacy_rate = vdata.get("literacy_rate", existing.literacy_rate)
                existing.languages = vdata.get("languages", existing.languages)
                existing.temples = vdata.get("temples", existing.temples)
                existing.economy = vdata.get("economy", existing.economy)
                existing.historical_context = vdata.get("historical_context", existing.historical_context)
                existing.cultural_notes = vdata.get("cultural_notes", existing.cultural_notes)
                existing.story_chapters = vdata.get("story_chapters", existing.story_chapters)
                updated += 1
            else:
                story = VillageStory(
                    village_id=vid,
                    name=vdata.get("name", ""),
                    state=vdata.get("state", ""),
                    district=vdata.get("district", ""),
                    tehsil=vdata.get("tehsil", ""),
                    population_2011=vdata.get("population_2011"),
                    households_2011=vdata.get("households_2011"),
                    males_2011=vdata.get("males_2011"),
                    females_2011=vdata.get("females_2011"),
                    literacy_rate=vdata.get("literacy_rate"),
                    languages=vdata.get("languages"),
                    temples=vdata.get("temples"),
                    economy=vdata.get("economy"),
                    historical_context=vdata.get("historical_context"),
                    cultural_notes=vdata.get("cultural_notes"),
                    story_chapters=vdata.get("story_chapters", []),
                )
                db.add(story)
                created += 1
        except Exception as e:
            errors.append(f"Item {i} (village_id={vid}): {str(e)}")
            continue

    db.commit()
    return {
        "created": created, "updated": updated,
        "total": created + updated, "errors": errors[:20],
    }


def _serialize_story(story: VillageStory) -> dict:
    """Serialize a VillageStory model to a JSON response."""
    return {
        "village_id": story.village_id,
        "name": story.name,
        "state": story.state,
        "district": story.district,
        "tehsil": story.tehsil,
        "population_2011": story.population_2011,
        "households_2011": story.households_2011,
        "males_2011": story.males_2011,
        "females_2011": story.females_2011,
        "literacy_rate": story.literacy_rate,
        "languages": story.languages,
        "temples": story.temples,
        "economy": story.economy,
        "historical_context": story.historical_context,
        "cultural_notes": story.cultural_notes,
        "story_chapters": story.story_chapters or [],
    }
