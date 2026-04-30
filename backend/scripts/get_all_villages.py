#!/usr/bin/env python3
"""Script to fetch all activated villages from CoRE Stack API."""

import sys
import os
import asyncio
import json
import logging
from pathlib import Path
from datetime import datetime

# Add backend directory to path to import app modules
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BACKEND_DIR))

# Import corestack_client
# Note: This will load settings from backend/.env via app.config
try:
    from app.services.corestack_client import corestack_client
except ImportError as e:
    print(f"Error: Could not import corestack_client. Ensure you are running this from the backend directory or have dependencies installed. {e}")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(BACKEND_DIR / "scripts" / "get_villages.log")
    ]
)
logger = logging.getLogger(__name__)

async def fetch_villages_for_tehsil(state, district, tehsil, semaphore):
    """Fetch village geometries for a single tehsil and extract names/IDs."""
    async with semaphore:
        try:
            logger.info(f"Processing: {state} > {district} > {tehsil}")
            data = await corestack_client.get_village_geometries(state, district, tehsil)
            
            villages = []
            features = data.get("features", [])
            if not features:
                logger.warning(f"No villages found for {tehsil}")
                return []

            for feature in features:
                props = feature.get("properties", {})
                # CoRE Stack uses various keys for IDs and names
                v_id = props.get("vill_ID") or props.get("village_id") or props.get("id")
                v_name = props.get("vill_name") or props.get("village_name") or props.get("name")
                
                if v_id and v_name:
                    villages.append({
                        "id": v_id,
                        "name": v_name,
                        "state": state,
                        "district": district,
                        "tehsil": tehsil
                    })
            
            logger.info(f"  Found {len(villages)} villages in {tehsil}")
            return villages
        except Exception as e:
            logger.error(f"Error fetching villages for {tehsil}: {e}")
            return []

async def main():
    logger.info("Starting CoRE Stack village extraction...")
    
    # 1. Fetch active locations (State -> District -> Tehsil hierarchy)
    try:
        logger.info("Fetching active locations hierarchy...")
        active_locations = await corestack_client.get_active_locations()
        if not active_locations:
            logger.error("No active locations returned from API.")
            return
    except Exception as e:
        logger.error(f"Failed to fetch active locations: {e}")
        return

    # 2. Build list of tehsils to process
    tehsil_tasks = []
    # Concurrency limit (10 concurrent requests)
    semaphore = asyncio.Semaphore(10)

    for state_obj in active_locations:
        state_name = state_obj.get("label")
        if not state_name: continue
        
        for dist_obj in state_obj.get("district", []):
            dist_name = dist_obj.get("label")
            if not dist_name: continue
            
            for block_obj in dist_obj.get("blocks", []):
                block_name = block_obj.get("label")
                if not block_name: continue
                
                tehsil_tasks.append(
                    fetch_villages_for_tehsil(state_name, dist_name, block_name, semaphore)
                )

    logger.info(f"Found {len(tehsil_tasks)} tehsils across {len(active_locations)} states.")
    
    # 3. Execute fetching tasks
    results = await asyncio.gather(*tehsil_tasks)
    
    # 4. Flatten and save results
    all_villages = [v for sublist in results for v in sublist]
    
    # Sort by State, District, Tehsil, Name
    all_villages.sort(key=lambda x: (x['state'], x['district'], x['tehsil'], x['name']))

    output_path = BACKEND_DIR / "app" / "data" / "all_corestack_villages.json"
    
    output_data = {
        "metadata": {
            "total_villages": len(all_villages),
            "total_tehsils": len(tehsil_tasks),
            "generated_at": datetime.now().isoformat(),
            "source": "CoRE Stack API"
        },
        "villages": all_villages
    }
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    logger.info("=" * 50)
    logger.info(f"Extraction Complete!")
    logger.info(f"Total Villages: {len(all_villages)}")
    logger.info(f"Output saved to: {output_path}")
    logger.info("=" * 50)

if __name__ == "__main__":
    # Check if API key is set
    from app.config import get_settings
    settings = get_settings()
    if not settings.CORESTACK_API_KEY:
        logger.warning("CORESTACK_API_KEY is not set in environment or .env file.")
        logger.warning("The script might fail if the API requires authentication.")
    
    asyncio.run(main())
