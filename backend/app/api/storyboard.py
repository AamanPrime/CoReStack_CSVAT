"""CSVAT — Storyboard API.

Endpoints:
  GET  /api/v1/storyboard/{village_id}     — Fetch cached slides (404 if not generated)
  POST /api/v1/storyboard/{village_id}     — Store / upsert slides for a village
  DELETE /api/v1/storyboard/               — Clear ALL cached storyboard slides
  POST /api/v1/storyboard/generate         — Groq proxy: build 13 slides from insights + OSM data

The generate endpoint keeps the GROQ_API_KEY server-side. The frontend
handles Overpass fetching + insights transformation, then sends only the
ready-to-prompt payload here. Slides are saved to DB by the frontend after
receiving the generated result.
"""

import json
import logging
import re
import time
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.storyboard_slide import VillageStoryboardSlide

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/v1/storyboard", tags=["Storyboard"])


# ─── Schemas ────────────────────────────────────────────────────────────────

class SlideObj(BaseModel):
    slide_number: Any = 0
    emoji: Any = None
    title: Any = None
    content: Any = None
    insight: Any = None
    image_url: Any = None


class StoryboardSavePayload(BaseModel):
    village_name: str
    state: Any = None
    district: Any = None
    tehsil: Any = None
    total_area: Any = None
    slides: List[SlideObj]


class StoryboardUpdateSlidePayload(BaseModel):
    """Payload to update a single slide (content + insight + title)."""
    slide_number: int
    emoji: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    insight: Optional[str] = None


class StoryboardUpdatePayload(BaseModel):
    slides: List[StoryboardUpdateSlidePayload]


class GeneratePayload(BaseModel):
    """Payload sent by the frontend to generate slides via Groq."""
    village_name: str
    state: Optional[str] = None
    district: Optional[str] = None
    tehsil: Optional[str] = None
    area_hectares: Optional[float] = None
    # Already-transformed insights (from sc.py transform_insights, done client-side)
    insights: Dict[str, Any]
    # Raw results for crop intensity change breakdown
    crop_intensity_change: Optional[List[Any]] = None
    # Vegetation transitions
    vegetation_transitions: Optional[List[Any]] = None
    # OSM tag groups from Overpass (done client-side)
    osm_summary: Optional[Dict[str, int]] = {}
    top_osm_tags: Optional[List[str]] = []
    # Named rivers / forests / heritage spots extracted from OSM (client-side)
    landmarks: Optional[Dict[str, Any]] = None


# ─── Helpers ────────────────────────────────────────────────────────────────

SLIDE_DEFINITIONS = """
Required slides (generate ALL 14):
1.  Overview              — Village name, area, state/district/tehsil context
2.  Location Context      — Geographic position, nearby features, connectivity
3.  Settlement Pattern    — Type and distribution of habitation
4.  Road Infrastructure   — Road types, density, connectivity quality
5.  Land Use              — Dominant land-use classes from OSM/LULC
6.  Agricultural Profile  — Cropping pattern, intensity level
7.  Agricultural Trends   — Year-on-year cropping intensity change with data
8.  Water Availability    — Surface water extent, variability, stress level
9.  Vegetation Change     — Tree cover gain/loss/net, trend interpretation
10. Land Transition       — Key LULC transitions (from transitions[] data)
11. Infrastructure Gaps   — Missing or limited amenities from OSM
12. Rivers, Forests & Landmarks
                          — Named rivers/streams, forest patches, temples,
                            heritage and other notable spots from the
                            NAMED LANDMARKS block. If that block is empty,
                            say so plainly. Otherwise name specific items.
13. Opportunities         — Actionable interventions based on data
14. Conclusion            — Summary and forward-looking statement
"""

SLIDE_SCHEMA = """
{
  "village": "<village name>",
  "total_area": "<area in hectares>",
  "slides": [
    {
      "slide_number": 1,
      "emoji": "🌍",
      "title": "<slide title>",
      "content": "<2-3 sentence factual description>",
      "insight": "<one-line key takeaway>"
    }
  ]
}
"""


def _clean_json(text: str) -> str:
    text = re.sub(r"^```json\s*", "", text.strip())
    text = re.sub(r"^```\s*", "", text.strip())
    text = re.sub(r"```\s*$", "", text.strip())
    return text.strip()


def _serialize(s: VillageStoryboardSlide) -> dict:
    return {
        "id": s.id,
        "village_id": s.village_id,
        "village_name": s.village_name,
        "state": s.state,
        "district": s.district,
        "tehsil": s.tehsil,
        "total_area": s.total_area,
        "slides": s.slides or [],
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


# ─── Endpoints ──────────────────────────────────────────────────────────────

# ⚠️  Static routes MUST be registered before /{village_id} to avoid
#    FastAPI matching 'generate' and '' as a village_id integer.

@router.delete("/")
def clear_all_storyboards(db: Session = Depends(get_db)):
    """Delete ALL cached storyboard slides from the database."""
    result = db.execute(delete(VillageStoryboardSlide))
    db.commit()
    return {"deleted_count": result.rowcount, "message": "All storyboard slides cleared."}


@router.post("/generate")
async def generate_storyboard(payload: GeneratePayload):
    """
    Groq proxy endpoint — accepts prepped insights + OSM summary from the client,
    calls the Groq LLM, and returns 13 structured slides.

    The GROQ_API_KEY stays server-side. The frontend handles:
      - Overpass OSM fetch (no key needed)
      - transform_insights() computation
    Then sends this endpoint the ready payload.
    """
    api_key = settings.GROQ_API_KEY
    if not api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server.")

    logger.info("[Storyboard] Generating slides for village: %s", payload.village_name)

    insights_json = json.dumps(payload.insights, indent=2)
    ci_change_json = json.dumps(payload.crop_intensity_change or [], indent=2)
    veg_transitions_json = json.dumps(payload.vegetation_transitions or [], indent=2)
    osm_summary_json = json.dumps(payload.osm_summary or {}, indent=2)
    top_tags_str = ", ".join(payload.top_osm_tags or [])
    landmarks_json = json.dumps(payload.landmarks or {}, indent=2)

    prompt = f"""You are a GIS data analyst generating a factual village storyboard.

STRICT RULES:
- No storytelling, no imagination, no filler phrases
- Only factual statements directly supported by the data provided
- Use specific numbers from the insights wherever possible
- Keep "content" to 2-3 crisp sentences per slide
- Keep "insight" to a single punchy phrase (max 8 words)
- Return ONLY valid JSON — no markdown, no preamble, no explanation
- Dont inlcude emoji in the slides content.

VILLAGE METADATA:
- Name:     {payload.village_name}
- State:    {payload.state or 'N/A'}
- District: {payload.district or 'N/A'}
- Tehsil:   {payload.tehsil or 'N/A'}
- Area:     {payload.area_hectares or 'N/A'} hectares

SATELLITE INSIGHTS (validated):
{insights_json}

CROP INTENSITY CHANGE BREAKDOWN:
{ci_change_json}

VEGETATION TRANSITIONS (from 2017-18 to 2024-25):
{veg_transitions_json}

OSM TAG GROUPS (infrastructure signal):
{osm_summary_json}

TOP OSM TAGS:
{top_tags_str}

NAMED LANDMARKS (rivers, forests, heritage / amenity spots from OSM — use these
to ground the storyboard in real local features. If non-empty, you MUST mention
at least one item in the relevant slide):
{landmarks_json}

{SLIDE_DEFINITIONS}

OUTPUT FORMAT (return ONLY this JSON, nothing else):
{SLIDE_SCHEMA}
"""

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": 4096,
                },
            )
        resp.raise_for_status()
        groq_data = resp.json()
        raw_text = groq_data["choices"][0]["message"]["content"]
        logger.info("[Storyboard] Groq responded with %d chars", len(raw_text))
    except httpx.HTTPStatusError as e:
        logger.error("Groq API error %s: %s", e.response.status_code, e.response.text)
        raise HTTPException(status_code=502, detail=f"Groq API error: {e.response.status_code}")
    except Exception as e:
        logger.error("Groq call failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Groq call failed: {str(e)}")

    cleaned = _clean_json(raw_text)
    try:
        story = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error("Groq JSON parse failed: %s\nRaw: %s", e, raw_text[:500])
        raise HTTPException(status_code=502, detail=f"Groq returned invalid JSON: {str(e)}")

    slides = story.get("slides", [])
    if not slides or len(slides) < 14:
        logger.warning("Groq returned only %d slides (expected 14)", len(slides))

    logger.info("[Storyboard] Returning %d slides for %s", len(slides), payload.village_name)
    return {
        "village": story.get("village", payload.village_name),
        "total_area": story.get("total_area", str(payload.area_hectares or "")),
        "slides": slides,
    }


@router.get("/{village_id}")
def get_storyboard(village_id: str, db: Session = Depends(get_db)):
    """Return cached storyboard slides for a village, or 404 if not generated."""
    logger.info("[Storyboard] GET village_id=%s", village_id)
    result = db.execute(
        select(VillageStoryboardSlide).where(
            VillageStoryboardSlide.village_id == village_id
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=404,
            detail=f"No storyboard slides found for village_id={village_id}. Generate them first."
        )
    return _serialize(record)


@router.post("/{village_id}", status_code=201)
def save_storyboard(
    village_id: str,
    payload: StoryboardSavePayload,
    db: Session = Depends(get_db),
):
    """Upsert storyboard slides for a village (called by frontend after generation)."""
    logger.info("[Storyboard] POST (save) village_id=%s slides=%d", village_id, len(payload.slides))
    result = db.execute(
        select(VillageStoryboardSlide).where(
            VillageStoryboardSlide.village_id == village_id
        )
    )
    existing = result.scalar_one_or_none()

    slides_data = [s.model_dump() for s in payload.slides]

    if existing:
        existing.village_name = payload.village_name
        existing.state = payload.state
        existing.district = payload.district
        existing.tehsil = payload.tehsil
        existing.total_area = payload.total_area
        existing.slides = slides_data
        db.commit()
        db.refresh(existing)
        return _serialize(existing)
    else:
        record = VillageStoryboardSlide(
            village_id=village_id,
            village_name=payload.village_name,
            state=payload.state,
            district=payload.district,
            tehsil=payload.tehsil,
            total_area=payload.total_area,
            slides=slides_data,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return _serialize(record)


@router.patch("/{village_id}/slides")
def update_storyboard_slides(
    village_id: str,
    payload: StoryboardUpdatePayload,
    db: Session = Depends(get_db),
):
    """Update one or more slides in the cached storyboard (for the slide editor)."""
    result = db.execute(
        select(VillageStoryboardSlide).where(
            VillageStoryboardSlide.village_id == village_id
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail=f"No storyboard for village_id={village_id}")

    current_slides = list(record.slides or [])
    update_map = {u.slide_number: u for u in payload.slides}

    for i, slide in enumerate(current_slides):
        snum = slide.get("slide_number")
        if snum in update_map:
            upd = update_map[snum]
            if upd.title is not None:
                current_slides[i]["title"] = upd.title
            if upd.content is not None:
                current_slides[i]["content"] = upd.content
            if upd.insight is not None:
                current_slides[i]["insight"] = upd.insight
            if upd.emoji is not None:
                current_slides[i]["emoji"] = upd.emoji

    record.slides = current_slides
    db.commit()
    db.refresh(record)
    return _serialize(record)
