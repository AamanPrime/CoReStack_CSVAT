"""
Data service — loads and queries the Nallacheruvu sample dataset.

For the MVP this reads directly from the bundled Excel file.
When real raster processing is added later, this module will be
replaced with rasterio / xarray based clipping logic.
"""
import os
import pandas as pd
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
XLSX_PATH = DATA_DIR / "Nallacheruvu_data.xlsx"


@lru_cache(maxsize=1)
def _load_workbook() -> dict[str, pd.DataFrame]:
    """Load all sheets from the Excel workbook once and cache."""
    return pd.read_excel(XLSX_PATH, sheet_name=None)


def get_sheet(name: str) -> pd.DataFrame:
    return _load_workbook()[name].copy()


# ── Village ↔ MWS mapping ──────────────────────────────────────────
def get_village_mws_mapping() -> pd.DataFrame:
    """Return the mws_intersect_villages lookup table."""
    return get_sheet("mws_intersect_villages")


def get_mws_uids_for_village(village_id: str | None = None) -> list[str]:
    """Return all MWS UIDs that intersect a given village.
    For the demo we simply return all UIDs in the dataset."""
    df = get_sheet("mws")
    return df["UID"].tolist()


# ── Cropping Intensity ──────────────────────────────────────────────
def get_cropping_intensity(uids: list[str] | None = None) -> list[dict]:
    df = get_sheet("croppingIntensity_annual")
    if uids:
        df = df[df["UID"].isin(uids)]

    # Extract year columns dynamically
    ci_cols = [c for c in df.columns if c.startswith("cropping_intensity_unit_less_")]
    single_cols = [c for c in df.columns if c.startswith("single_cropped_area_in_ha_")]
    double_cols = [c for c in df.columns if c.startswith("doubly_cropped_area_in_ha_")]
    triple_cols = [c for c in df.columns if c.startswith("triply_cropped_area_in_ha_")]

    records = []
    for ci_col, s_col, d_col, t_col in zip(ci_cols, single_cols, double_cols, triple_cols):
        year = ci_col.replace("cropping_intensity_unit_less_", "")
        records.append({
            "year": year,
            "cropping_intensity": round(float(df[ci_col].mean()), 2),
            "single_crop_area_ha": round(float(df[s_col].sum()), 2),
            "double_crop_area_ha": round(float(df[d_col].sum()), 2),
            "triple_crop_area_ha": round(float(df[t_col].sum()), 2),
        })
    return records


# ── Surface Water Bodies ────────────────────────────────────────────
def get_surface_water(uids: list[str] | None = None) -> list[dict]:
    df = get_sheet("surfaceWaterBodies_annual")
    if uids:
        df = df[df["UID"].isin(uids)]

    total_cols = [c for c in df.columns if c.startswith("total_area_in_ha_")]
    kharif_cols = [c for c in df.columns if c.startswith("kharif_area_in_ha_")]
    rabi_cols = [c for c in df.columns if c.startswith("rabi_area_in_ha_")]
    zaid_cols = [c for c in df.columns if c.startswith("zaid_area_in_ha_")]

    records = []
    for t_col, k_col, r_col, z_col in zip(total_cols, kharif_cols, rabi_cols, zaid_cols):
        year = t_col.replace("total_area_in_ha_", "")
        records.append({
            "year": year,
            "total_area_ha": round(float(df[t_col].sum()), 2),
            "kharif_area_ha": round(float(df[k_col].sum()), 2),
            "rabi_area_ha": round(float(df[r_col].sum()), 2),
            "zaid_area_ha": round(float(df[z_col].sum()), 2),
        })
    return records


# ── Deforestation / Degradation ─────────────────────────────────────
def get_deforestation(uids: list[str] | None = None) -> list[dict]:
    df = get_sheet("change_detection_deforestation")
    if uids:
        df = df[df["UID"].isin(uids)]

    # Sum across all MWS units
    cols_of_interest = [c for c in df.columns if c.endswith("_area_in_ha") and c != "area_in_ha"]
    records = []
    for col in cols_of_interest:
        label = col.replace("_area_in_ha", "").replace("_", " ").title()
        records.append({
            "category": label,
            "area_ha": round(float(df[col].sum()), 2),
        })
    return records


# ── Crop Intensity Change ───────────────────────────────────────────
def get_crop_intensity_change(uids: list[str] | None = None) -> list[dict]:
    df = get_sheet("change_detection_cropintensity")
    if uids:
        df = df[df["UID"].isin(uids)]

    cols_of_interest = [c for c in df.columns if c.endswith("_area_in_ha") and c != "area_in_ha"]
    records = []
    for col in cols_of_interest:
        label = col.replace("_area_in_ha", "").replace("_", " ").title()
        records.append({
            "category": label,
            "area_ha": round(float(df[col].sum()), 2),
        })
    return records


# ── Terrain ─────────────────────────────────────────────────────────
def get_terrain(uids: list[str] | None = None) -> list[dict]:
    df = get_sheet("terrain")
    if uids:
        df = df[df["UID"].isin(uids)]

    pct_cols = [c for c in df.columns if c.endswith("_area_percent")]
    records = []
    for col in pct_cols:
        label = col.replace("_area_percent", "").replace("_", " ").title()
        records.append({
            "category": label,
            "area_percent": round(float(df[col].mean()), 2),
        })
    return records


# ── Summary stats ───────────────────────────────────────────────────
def get_summary(uids: list[str] | None = None) -> dict:
    df = get_sheet("mws")
    if uids:
        df = df[df["UID"].isin(uids)]
    return {
        "total_area_ha": round(float(df["area_in_ha"].sum()), 2),
        "mws_count": len(df),
    }
