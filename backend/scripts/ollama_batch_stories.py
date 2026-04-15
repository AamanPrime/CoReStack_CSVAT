#!/usr/bin/env python3
"""
CSVAT — Batch Village Story Extraction via Ollama (Qwen 2.5 14B).

Run on Google Colab with T4 GPU:
  1. Install Ollama:  !curl -fsSL https://ollama.com/install.sh | sh
  2. Start Ollama:    !ollama serve &
  3. Pull model:      !ollama pull qwen2.5:14b
  4. Upload batch:    Upload village_batch_X.json
  5. Run this script: !python ollama_batch_stories.py --batch village_batch_1.json

Outputs:
  - village_stories_batch_1_output.json  (final merged output)
  - checkpoints/batch_1_chunk_NNN.json   (incremental saves)
"""

import argparse
import json
import os
import re
import sys
import time
import logging
from pathlib import Path

try:
    import requests
except ImportError:
    os.system("pip install requests -q")
    import requests

# ─── Configuration ───
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:14b")
CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE", "10"))  # 10 = sweet spot for T4 (amortizes prompt overhead)
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds
TIMEOUT = 600  # 10 min safety net — T4 typically finishes in 3-5 min per chunk

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ollama_batch")

# ─── Prompt Template ───
SYSTEM_PROMPT = """You generate Indian village data as JSON. For each village, output: population_2011 (int/null), households_2011 (int/null), males_2011 (int/null), females_2011 (int/null), literacy_rate (float/null), languages (array), temples (array), economy (1 sentence), historical_context (2 sentences, use regional context if unknown), cultural_notes (1 sentence), story_chapters (exactly 3: [{title, narrative (2-3 vivid sentences), map_action}]). map_action must be: zoom_to_village (ch1), show_lulc_latest (ch2), show_water (ch3). Use null for unknown numbers. Return ONLY valid JSON array, no markdown."""

USER_PROMPT_TEMPLATE = """Return JSON array. Each object: {{"village_id":<from input>,"name":"...","state":"...","district":"...","tehsil":"...","population_2011":int/null,"households_2011":int/null,"males_2011":int/null,"females_2011":int/null,"literacy_rate":float/null,"languages":[],"temples":[],"economy":"...","historical_context":"...","cultural_notes":"...","story_chapters":[{{"title":"...","narrative":"...","map_action":"zoom_to_village"}},{{"title":"...","narrative":"...","map_action":"show_lulc_latest"}},{{"title":"...","narrative":"...","map_action":"show_water"}}]}}

{villages_json}"""


def check_ollama():
    """Verify Ollama is running and model is available."""
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=10)
        r.raise_for_status()
        models = [m["name"] for m in r.json().get("models", [])]
        log.info(f"Ollama running. Available models: {models}")
        model_base = MODEL.split(":")[0]
        if not any(model_base in m for m in models):
            log.warning(f"Model '{MODEL}' not found. Pulling...")
            pull_r = requests.post(
                f"{OLLAMA_URL}/api/pull",
                json={"name": MODEL},
                timeout=600,
                stream=True,
            )
            for line in pull_r.iter_lines():
                if line:
                    status = json.loads(line).get("status", "")
                    if "pulling" in status or "success" in status:
                        log.info(f"  {status}")
        return True
    except Exception as e:
        log.error(f"Ollama not reachable at {OLLAMA_URL}: {e}")
        return False


def call_ollama(villages_chunk):
    """Send a chunk of villages to Ollama and parse the JSON response (streaming)."""
    villages_json = json.dumps(villages_chunk, indent=2, ensure_ascii=False)
    prompt = USER_PROMPT_TEMPLATE.format(
        count=len(villages_chunk),
        villages_json=villages_json,
    )

    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "stream": True,
        "options": {
            "temperature": 0,    # greedy = fastest
            "num_predict": min(600 * len(villages_chunk), 8192),  # ~500 tokens per village
            "num_ctx": 4096 if len(villages_chunk) <= 5 else 8192,  # smaller context = faster
        },
    }

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            log.info(f"  Attempt {attempt}/{MAX_RETRIES}...")
            t0 = time.time()
            token_count = 0
            content_parts = []

            r = requests.post(
                f"{OLLAMA_URL}/api/chat",
                json=payload,
                timeout=TIMEOUT,
                stream=True,
            )
            r.raise_for_status()

            for line in r.iter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # Accumulate content
                delta = chunk.get("message", {}).get("content", "")
                if delta:
                    content_parts.append(delta)
                    token_count += 1

                    # Print progress every 100 tokens
                    if token_count % 100 == 0:
                        elapsed = time.time() - t0
                        tps = token_count / elapsed if elapsed > 0 else 0
                        print(f"\r    ⏳ {token_count} tokens ({tps:.1f} tok/s)...", end="", flush=True)

                # Check if done
                if chunk.get("done", False):
                    break

            elapsed = time.time() - t0
            tps = token_count / elapsed if elapsed > 0 else 0
            print()  # newline after progress
            log.info(f"  Generated {token_count} tokens in {elapsed:.1f}s ({tps:.1f} tok/s)")

            content = "".join(content_parts).strip()

            # Extract JSON from response (handle markdown fences)
            parsed = extract_json_array(content)
            if parsed is None:
                log.warning(f"  Failed to parse JSON from response (attempt {attempt})")
                log.debug(f"  Raw response (first 500 chars): {content[:500]}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY)
                continue

            log.info(f"  ✓ Got {len(parsed)} villages in {elapsed:.1f}s")
            return parsed

        except requests.exceptions.Timeout:
            log.warning(f"  Timeout after {TIMEOUT}s (attempt {attempt})")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
        except requests.exceptions.RequestException as e:
            log.error(f"  Request error: {e} (attempt {attempt})")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
        except Exception as e:
            log.error(f"  Unexpected error: {e} (attempt {attempt})")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)

    return None


def extract_json_array(text):
    """Extract a JSON array from LLM response, stripping markdown fences."""
    # Strip markdown code fences
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    # Try direct parse
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            return [result]
    except json.JSONDecodeError:
        pass

    # Try to find array brackets
    match = re.search(r"\[\s*\{.*\}\s*\]", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Last resort: fix common JSON issues and retry
    text_fixed = text
    text_fixed = re.sub(r",\s*([}\]])", r"\1", text_fixed)  # trailing commas
    text_fixed = re.sub(r"'", '"', text_fixed)  # single quotes
    try:
        result = json.loads(text_fixed)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError:
        pass

    return None


def validate_village(village, original):
    """Validate and fix a single village story output."""
    # Ensure required fields from input are preserved
    village["village_id"] = original["village_id"]
    village["name"] = original["name"]
    village["state"] = original["state"]
    village["district"] = original["district"]
    village["tehsil"] = original["tehsil"]

    # Ensure story_chapters exist
    if not village.get("story_chapters") or len(village.get("story_chapters", [])) == 0:
        village["story_chapters"] = [
            {
                "title": f"Welcome to {original['name']}",
                "narrative": f"{original['name']} is a village in {original['tehsil']} tehsil, {original['district']} district of {original['state']}. Like many settlements in this region, it carries the stories of generations who have shaped the land through agriculture and tradition.",
                "map_action": "zoom_to_village",
            },
            {
                "title": "The Land and Its Crops",
                "narrative": f"The agricultural landscape around {original['name']} reflects the region's relationship with the monsoon. Farmers here have adapted their cropping patterns over decades, balancing traditional wisdom with the realities of changing rainfall and water availability.",
                "map_action": "show_lulc_latest",
            },
            {
                "title": "Water: The Eternal Challenge",
                "narrative": f"Water management has always been central to life in {original['district']}. From ancient tank systems to modern borewells, the quest for water security continues to shape decisions about crops, livelihoods, and the future of communities like {original['name']}.",
                "map_action": "show_water",
            },
        ]
        log.warning(f"  ⚠ Generated fallback chapters for {original['name']}")

    # Ensure arrays
    if not isinstance(village.get("languages"), list):
        village["languages"] = []
    if not isinstance(village.get("temples"), list):
        village["temples"] = []

    # Ensure strings
    for field in ("economy", "historical_context", "cultural_notes"):
        if not isinstance(village.get(field), str):
            village[field] = ""

    # Validate story_chapters structure
    valid_actions = {"zoom_to_village", "show_overview", "show_lulc_latest", "show_lulc_oldest", "show_water"}
    for ch in village.get("story_chapters", []):
        if not isinstance(ch.get("title"), str) or not ch["title"]:
            ch["title"] = f"About {original['name']}"
        if not isinstance(ch.get("narrative"), str) or not ch["narrative"]:
            ch["narrative"] = f"A chapter in the story of {original['name']}."
        if ch.get("map_action") not in valid_actions:
            ch["map_action"] = "zoom_to_village"

    return village


def create_fallback(village):
    """Create a minimal fallback entry for a village that failed processing."""
    return {
        "village_id": village["village_id"],
        "name": village["name"],
        "state": village["state"],
        "district": village["district"],
        "tehsil": village["tehsil"],
        "population_2011": None,
        "households_2011": None,
        "males_2011": None,
        "females_2011": None,
        "literacy_rate": None,
        "languages": [],
        "temples": [],
        "economy": f"Agriculture-based economy in {village['district']} district.",
        "historical_context": f"Part of {village['tehsil']} tehsil in {village['district']}, {village['state']}.",
        "cultural_notes": f"Shares the cultural traditions of the {village['district']} region.",
        "story_chapters": [
            {
                "title": f"Welcome to {village['name']}",
                "narrative": f"{village['name']} is a village in {village['tehsil']} tehsil of {village['district']} district, {village['state']}. It is part of a landscape shaped by agriculture, tradition, and the eternal rhythms of the Indian monsoon.",
                "map_action": "zoom_to_village",
            },
            {
                "title": "Land and Livelihood",
                "narrative": f"The communities of {village['district']} district have long depended on the land for their sustenance. Cropping patterns here reflect both ancient wisdom and modern adaptation to changing climate conditions.",
                "map_action": "show_lulc_latest",
            },
            {
                "title": "Water and Resilience",
                "narrative": f"Water availability shapes every aspect of life in {village['state']}'s villages. From seasonal tanks to bore wells, the story of water is the story of survival and ingenuity in communities like {village['name']}.",
                "map_action": "show_water",
            },
        ],
    }


def process_batch(batch_file, start_from=0, output_dir="checkpoints"):
    """Process an entire batch file, saving checkpoints along the way."""
    with open(batch_file) as f:
        batch_data = json.load(f)

    villages = batch_data["villages"]
    batch_num = batch_data.get("batch_number", 1)
    total = len(villages)

    log.info(f"═══ Batch {batch_num}: {total} villages, chunk_size={CHUNK_SIZE} ═══")
    log.info(f"    Model: {MODEL} | Ollama: {OLLAMA_URL}")
    log.info(f"    Starting from index: {start_from}")

    os.makedirs(output_dir, exist_ok=True)

    # Load existing checkpoint data
    all_results = []
    processed_ids = set()

    # Check for existing checkpoints
    existing_checkpoints = sorted(
        Path(output_dir).glob(f"batch_{batch_num}_chunk_*.json"),
        key=lambda p: int(re.search(r"chunk_(\d+)", p.name).group(1)),
    )
    for cp in existing_checkpoints:
        try:
            with open(cp) as f:
                chunk_data = json.load(f)
            for v in chunk_data:
                if v["village_id"] not in processed_ids:
                    all_results.append(v)
                    processed_ids.add(v["village_id"])
            log.info(f"  Loaded checkpoint: {cp.name} ({len(chunk_data)} villages)")
        except Exception as e:
            log.warning(f"  Bad checkpoint {cp.name}: {e}")

    if processed_ids:
        log.info(f"  Resuming: {len(processed_ids)} villages already processed")

    # Process in chunks
    chunks = [villages[i : i + CHUNK_SIZE] for i in range(0, total, CHUNK_SIZE)]
    total_chunks = len(chunks)
    failed_villages = []
    batch_start_time = time.time()

    for chunk_idx, chunk in enumerate(chunks):
        # Skip already-processed chunks
        chunk_ids = {v["village_id"] for v in chunk}
        if chunk_ids.issubset(processed_ids):
            continue

        # Filter out already-processed villages from this chunk
        remaining = [v for v in chunk if v["village_id"] not in processed_ids]
        if not remaining:
            continue

        chunk_start = chunk_idx * CHUNK_SIZE
        log.info(
            f"  ─── Chunk {chunk_idx + 1}/{total_chunks} "
            f"(villages {chunk_start}-{chunk_start + len(remaining) - 1}) ───"
        )

        result = call_ollama(remaining)

        if result is not None:
            # Match results to input villages
            result_by_id = {}
            for v in result:
                vid = v.get("village_id")
                if vid is not None:
                    result_by_id[vid] = v

            chunk_results = []
            for orig in remaining:
                if orig["village_id"] in result_by_id:
                    validated = validate_village(result_by_id[orig["village_id"]], orig)
                    chunk_results.append(validated)
                    processed_ids.add(orig["village_id"])
                else:
                    # LLM returned fewer villages — create fallback
                    fb = create_fallback(orig)
                    chunk_results.append(fb)
                    processed_ids.add(orig["village_id"])
                    log.warning(f"    Missing from LLM output: {orig['name']} → fallback")

            all_results.extend(chunk_results)

            # Save checkpoint
            cp_path = os.path.join(output_dir, f"batch_{batch_num}_chunk_{chunk_idx:04d}.json")
            with open(cp_path, "w") as f:
                json.dump(chunk_results, f, indent=2, ensure_ascii=False)

            # Print what we got
            for v in chunk_results:
                chapters = len(v.get("story_chapters", []))
                pop = v.get("population_2011") or "?"
                log.info(f"     {v['name']} ({v['district']}, {v['state']}) — pop:{pop}, chapters:{chapters}")
        else:
            # Complete failure for this chunk — create fallbacks
            log.error(f"  ✗ Chunk {chunk_idx + 1} FAILED after {MAX_RETRIES} retries")
            for orig in remaining:
                fb = create_fallback(orig)
                all_results.append(fb)
                processed_ids.add(orig["village_id"])
                failed_villages.append(orig["name"])
                log.info(f"    ⚠ {orig['name']} → fallback")

        # Save rolling output (updated after every chunk)
        rolling_path = f"village_stories_batch_{batch_num}_output.json"
        with open(rolling_path, "w") as f:
            json.dump(all_results, f, indent=2, ensure_ascii=False)

        # Progress + ETA
        pct = len(processed_ids) / total * 100
        elapsed_total = time.time() - batch_start_time
        rate = len(processed_ids) / elapsed_total if elapsed_total > 0 else 0
        remaining_count = total - len(processed_ids)
        eta_sec = remaining_count / rate if rate > 0 else 0
        eta_hr = eta_sec / 3600
        log.info(f"  Progress: {len(processed_ids)}/{total} ({pct:.1f}%) | ETA: {eta_hr:.1f}h | Output: {rolling_path}")

        # Small delay between chunks to avoid overloading
        time.sleep(1)

    # Save final merged output
    output_file = f"village_stories_batch_{batch_num}_output.json"
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)

    log.info(f"═══ DONE ═══")
    log.info(f"  Total processed: {len(all_results)}")
    log.info(f"  Failed (fallback): {len(failed_villages)}")
    log.info(f"  Output: {output_file}")

    if failed_villages:
        log.info(f"  Failed villages: {failed_villages[:20]}{'...' if len(failed_villages) > 20 else ''}")

    return output_file


def merge_all_outputs(output_dir="."):
    """Merge all batch outputs into one final file."""
    all_stories = {}
    for i in range(1, 7):
        path = os.path.join(output_dir, f"village_stories_batch_{i}_output.json")
        if not os.path.exists(path):
            log.warning(f"  Missing: {path}")
            continue
        with open(path) as f:
            batch = json.load(f)
        for story in batch:
            all_stories[str(story["village_id"])] = story
        log.info(f"  Loaded batch {i}: {len(batch)} villages")

    final = {
        "version": "2.0",
        "generated_at": time.strftime("%Y-%m-%d"),
        "total_villages": len(all_stories),
        "villages": all_stories,
    }

    output = os.path.join(output_dir, "village_stories.json")
    with open(output, "w") as f:
        json.dump(final, f, indent=2, ensure_ascii=False)

    log.info(f"  Merged {len(all_stories)} village stories → {output}")
    return output


# ─── CLI ───

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="CSVAT — Batch village story extraction via Ollama",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process batch 1
  python ollama_batch_stories.py --batch village_batch_1.json

  # Resume from where you left off (auto-resumes from checkpoints)
  python ollama_batch_stories.py --batch village_batch_1.json

  # Use smaller chunks for limited GPU memory
  CHUNK_SIZE=5 python ollama_batch_stories.py --batch village_batch_1.json

  # Use a different model
  OLLAMA_MODEL=qwen2.5:7b python ollama_batch_stories.py --batch village_batch_1.json

  # Merge all batch outputs into one file
  python ollama_batch_stories.py --merge

Colab Setup:
  !curl -fsSL https://ollama.com/install.sh | sh
  !nohup ollama serve > /dev/null 2>&1 &
  !sleep 5
  !ollama pull qwen2.5:14b
  !python ollama_batch_stories.py --batch village_batch_1.json
        """,
    )
    parser.add_argument("--batch", type=str, help="Path to village_batch_X.json")
    parser.add_argument("--merge", action="store_true", help="Merge all batch outputs")
    parser.add_argument("--start", type=int, default=0, help="Start from village index")
    parser.add_argument("--chunk-size", type=int, default=None, help="Villages per LLM call")
    parser.add_argument("--checkpoint-dir", type=str, default="checkpoints", help="Checkpoint directory")

    args = parser.parse_args()

    if args.chunk_size:
        CHUNK_SIZE = args.chunk_size

    if args.merge:
        merge_all_outputs()
    elif args.batch:
        if not check_ollama():
            log.error("Ollama is not running. Start it first:")
            log.error("  ollama serve &")
            log.error("  ollama pull qwen2.5:14b")
            sys.exit(1)
        process_batch(args.batch, start_from=args.start, output_dir=args.checkpoint_dir)
    else:
        parser.print_help()
