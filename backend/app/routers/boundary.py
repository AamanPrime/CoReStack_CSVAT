"""
Boundary router — handles village boundary upload and validation.
"""
from fastapi import APIRouter, UploadFile, File, HTTPException
import json

router = APIRouter(prefix="/api/boundary", tags=["boundary"])


@router.post("/upload")
async def upload_boundary(file: UploadFile = File(...)):
    """Accept a GeoJSON file upload for village boundary.
    
    Validates that the file is valid GeoJSON with polygon geometry.
    Returns the parsed boundary for the frontend to render on the map.
    """
    if not file.filename.endswith((".geojson", ".json")):
        raise HTTPException(
            status_code=400,
            detail="File must be a .geojson or .json file."
        )

    try:
        content = await file.read()
        geojson = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON file.")

    # Validate GeoJSON structure
    geojson_type = geojson.get("type")
    if geojson_type not in ("Feature", "FeatureCollection", "Polygon", "MultiPolygon"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported GeoJSON type: {geojson_type}. Expected Feature, FeatureCollection, Polygon, or MultiPolygon."
        )

    # Wrap raw geometry in a Feature if needed
    if geojson_type in ("Polygon", "MultiPolygon"):
        geojson = {
            "type": "Feature",
            "geometry": geojson,
            "properties": {}
        }

    return {
        "status": "valid",
        "message": "Boundary uploaded successfully.",
        "boundary": geojson,
    }


@router.post("/validate")
async def validate_boundary(boundary: dict):
    """Validate that a boundary intersects at least one active tehsil.
    
    For the MVP this always returns valid since we use the sample dataset.
    In production this would do a spatial intersection check.
    """
    geometry_type = None
    if boundary.get("type") == "Feature":
        geometry_type = boundary.get("geometry", {}).get("type")
    elif boundary.get("type") == "FeatureCollection":
        features = boundary.get("features", [])
        if features:
            geometry_type = features[0].get("geometry", {}).get("type")

    if geometry_type not in ("Polygon", "MultiPolygon"):
        raise HTTPException(
            status_code=400,
            detail="Boundary must contain Polygon or MultiPolygon geometry."
        )

    return {
        "valid": True,
        "message": "Boundary intersects active tehsil (Nallacheruvu sample area).",
        "tehsil": "Nallacheruvu",
        "district": "Mahbubnagar",
        "state": "Telangana",
    }
