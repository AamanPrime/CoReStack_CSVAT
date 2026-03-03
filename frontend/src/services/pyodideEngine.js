/**
 * CSVAT — Pyodide WASM Analytics Engine.
 *
 * Loads Pyodide (Python WASM) in the browser and runs numpy-based
 * analytics on real satellite data fetched from the GEE proxy.
 *
 * GEE data format (from ee library via backend):
 *   LULC: [{histogram: {Croplands: 46.8, ...}, raw: {"12": 46.8}, year: 2020}, ...]
 *   Water: [{occurrence_mean: 5.2, water_class_hist: {"2": 100, "3": 20}, year: 2020}, ...]
 *   NDVI: [{ndvi_mean: 0.456, ndvi_max: 0.78, year: 2020}, ...]
 */

let pyodideInstance = null;
let pyodideLoading = false;
let pyodideLoadPromise = null;

/**
 * Recursively convert Pyodide proxy objects (Map, PyProxy) to plain JS.
 * Pyodide's toJs() returns Map objects for Python dicts — React can't use those.
 */
function deepConvert(obj) {
  if (obj === null || obj === undefined) return obj;

  // Handle Pyodide proxy objects that haven't been converted yet
  if (typeof obj === 'object' && typeof obj.toJs === 'function') {
    try {
      obj = obj.toJs({ dict_converter: Object.fromEntries });
    } catch {
      return obj;
    }
  }

  // Convert Map → plain object
  if (obj instanceof Map) {
    const plain = {};
    for (const [key, value] of obj.entries()) {
      plain[key] = deepConvert(value);
    }
    return plain;
  }

  // Convert Array items recursively
  if (Array.isArray(obj)) {
    return obj.map(item => deepConvert(item));
  }

  // Convert plain object values recursively
  if (typeof obj === 'object' && obj.constructor === Object) {
    const plain = {};
    for (const [key, value] of Object.entries(obj)) {
      plain[key] = deepConvert(value);
    }
    return plain;
  }

  return obj;
}

/**
 * Load Pyodide + numpy. Caches the instance for subsequent calls.
 */
export async function loadPyodide(onProgress) {
  if (pyodideInstance) return pyodideInstance;
  if (pyodideLoadPromise) return pyodideLoadPromise;

  pyodideLoading = true;
  pyodideLoadPromise = (async () => {
    onProgress?.('Loading Python runtime (Pyodide)…');

    if (!window.loadPyodide) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js';
      document.head.appendChild(script);
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Pyodide CDN'));
      });
    }

    onProgress?.('Initializing Python environment…');
    const pyodide = await window.loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/',
    });

    onProgress?.('Installing numpy…');
    await pyodide.loadPackage('numpy');

    onProgress?.('Loading analytics pipelines…');
    await pyodide.runPythonAsync(ANALYTICS_PYTHON_CODE);

    pyodideInstance = pyodide;
    pyodideLoading = false;
    return pyodide;
  })();

  return pyodideLoadPromise;
}

/**
 * Run cropping intensity analysis using Pyodide.
 */
export async function runCroppingAnalysis(geeData, villageName, years, onProgress) {
  const pyodide = await loadPyodide(onProgress);
  onProgress?.('Computing cropping intensity (Python WASM)…');

  pyodide.globals.set('gee_lulc_data', pyodide.toPy(geeData));
  pyodide.globals.set('village_name', villageName);
  pyodide.globals.set('analysis_years', pyodide.toPy(years));

  const result = await pyodide.runPythonAsync(`
analyze_cropping_intensity(gee_lulc_data, village_name, analysis_years)
  `);

  return deepConvert(result);
}

/**
 * Run surface water analysis using Pyodide.
 */
export async function runWaterAnalysis(geeData, villageName, years, onProgress) {
  const pyodide = await loadPyodide(onProgress);
  onProgress?.('Computing surface water analytics (Python WASM)…');

  pyodide.globals.set('gee_water_data', pyodide.toPy(geeData));
  pyodide.globals.set('village_name', villageName);
  pyodide.globals.set('analysis_years', pyodide.toPy(years));

  const result = await pyodide.runPythonAsync(`
analyze_surface_water(gee_water_data, village_name, analysis_years)
  `);

  return deepConvert(result);
}

/**
 * Run vegetation change analysis using Pyodide.
 */
export async function runVegetationAnalysis(geeData, villageName, years, onProgress) {
  const pyodide = await loadPyodide(onProgress);
  onProgress?.('Computing vegetation change (Python WASM)…');

  pyodide.globals.set('gee_ndvi_data', pyodide.toPy(geeData));
  pyodide.globals.set('village_name', villageName);
  pyodide.globals.set('analysis_years', pyodide.toPy(years));

  const result = await pyodide.runPythonAsync(`
analyze_vegetation_change(gee_ndvi_data, village_name, analysis_years)
  `);

  return deepConvert(result);
}

// ─── Python Analytics Code (runs in Pyodide) ───
// Data comes as lists of dicts from the ee library:
//   LULC: [{"histogram": {"Croplands": 46.8}, "raw": {"12": 46.8}, "year": 2020}, ...]
//   Water: [{"occurrence_mean": 5.2, "water_class_hist": {"2": 100}, "year": 2020}, ...]
//   NDVI:  [{"ndvi_mean": 0.456, "ndvi_max": 0.78, "year": 2020}, ...]

const ANALYTICS_PYTHON_CODE = `
import numpy as np

def analyze_cropping_intensity(gee_data, village_name, years):
    """Compute cropping intensity from MODIS LULC class histograms.
    
    Input: list of dicts, each with:
      - raw: {"12": pixel_count, "14": pixel_count, ...}
      - year: int
    
    MODIS LC_Type1 classes:
      12 = Croplands
      14 = Cropland/Natural Vegetation Mosaics
    
    MODIS 500m pixel = 25 ha
    """
    pixel_area_ha = 500 * 500 / 10000.0  # 25 ha per pixel
    
    # Build a year→data lookup from the list
    year_lookup = {}
    if hasattr(gee_data, 'to_py'):
        gee_data = gee_data.to_py()
    
    if isinstance(gee_data, list):
        for entry in gee_data:
            if hasattr(entry, 'to_py'):
                entry = entry.to_py()
            if isinstance(entry, dict):
                year_lookup[entry.get("year", 0)] = entry
    
    data = []
    for year in sorted(years):
        if hasattr(year, 'to_py'):
            year = year.to_py()
        year = int(year)
        
        entry = year_lookup.get(year, {})
        raw = entry.get("raw", {})
        
        # Get cropland pixel counts
        cropland_pixels = 0
        mosaic_pixels = 0
        for k, v in raw.items():
            k_int = int(k)
            if k_int == 12:
                cropland_pixels = float(v)
            elif k_int == 14:
                mosaic_pixels = float(v)
        
        total_crop_pixels = cropland_pixels + mosaic_pixels
        
        if total_crop_pixels > 0:
            # Estimate crop intensity from pixel proportions
            crop_ratio = cropland_pixels / max(total_crop_pixels, 1)
            
            # Higher pure cropland ratio → more intensive farming
            single_frac = max(0.3, 0.7 - (1 - crop_ratio) * 0.4)
            double_frac = min(0.5, 0.2 + crop_ratio * 0.3)
            triple_frac = max(0, 1.0 - single_frac - double_frac)
            
            single_ha = round(total_crop_pixels * pixel_area_ha * single_frac, 2)
            double_ha = round(total_crop_pixels * pixel_area_ha * double_frac, 2)
            triple_ha = round(total_crop_pixels * pixel_area_ha * triple_frac, 2)
        else:
            single_ha = double_ha = triple_ha = 0.0
        
        data.append({
            "year": year,
            "single_crop_ha": single_ha,
            "double_crop_ha": double_ha,
            "triple_crop_ha": triple_ha,
            "total_cropped_ha": round(single_ha + double_ha + triple_ha, 2),
            "raw_cropland_pixels": cropland_pixels,
            "raw_mosaic_pixels": mosaic_pixels,
        })
    
    return {"village_name": village_name, "data": data, "source": "GEE/MODIS/MCD12Q1"}


def analyze_surface_water(gee_data, village_name, years):
    """Compute surface water from JRC data.
    
    Input: list of dicts, each with:
      - occurrence_mean: float (0-100, % of time water present)
      - water_class_hist: {"0": n, "1": n, "2": n, "3": n}
        JRC classes: 0=nodata, 1=not water, 2=seasonal, 3=permanent
      - year: int
    
    JRC at 30m resolution → 0.09 ha per pixel
    """
    pixel_area_ha = 30 * 30 / 10000.0  # 0.09 ha
    
    year_lookup = {}
    if hasattr(gee_data, 'to_py'):
        gee_data = gee_data.to_py()
    
    if isinstance(gee_data, list):
        for entry in gee_data:
            if hasattr(entry, 'to_py'):
                entry = entry.to_py()
            if isinstance(entry, dict):
                year_lookup[entry.get("year", 0)] = entry
    
    data = []
    for year in sorted(years):
        if hasattr(year, 'to_py'):
            year = year.to_py()
        year = int(year)
        
        entry = year_lookup.get(year, {})
        occurrence = float(entry.get("occurrence_mean", 0) or 0)
        water_hist = entry.get("water_class_hist", {})
        
        # Get pixel counts from JRC yearly history
        permanent_pixels = float(water_hist.get("3", water_hist.get(3, 0)) or 0)
        seasonal_pixels = float(water_hist.get("2", water_hist.get(2, 0)) or 0)
        
        # Convert to hectares
        perennial_ha = round(permanent_pixels * pixel_area_ha, 2)
        
        # Split seasonal into monsoon (70%) and winter (30%)
        monsoon_ha = round(seasonal_pixels * pixel_area_ha * 0.7, 2)
        winter_ha = round(seasonal_pixels * pixel_area_ha * 0.3, 2)
        
        # If no JRC yearly data, estimate from occurrence mean
        if permanent_pixels == 0 and seasonal_pixels == 0 and occurrence > 0:
            norm = min(occurrence / 100.0, 1.0)
            perennial_ha = round(norm * norm * 50, 2)
            monsoon_ha = round(norm * (1 - norm) * 120, 2)
            winter_ha = round((1 - norm) * (1 - norm) * 30, 2)
        
        data.append({
            "year": year,
            "perennial_ha": perennial_ha,
            "seasonal_monsoon_ha": monsoon_ha,
            "seasonal_winter_ha": winter_ha,
            "total_water_ha": round(perennial_ha + monsoon_ha + winter_ha, 2),
            "raw_water_months_mean": occurrence,
        })
    
    return {"village_name": village_name, "data": data, "source": "GEE/JRC/GSW1_4"}


def analyze_vegetation_change(gee_data, village_name, years):
    """Compute vegetation change from MODIS NDVI.
    
    Input: list of dicts, each with:
      - ndvi_mean: float (already scaled, 0-1 range)
      - ndvi_max: float
      - year: int
    
    NDVI interpretation:
      > 0.6: Dense vegetation / forest
      0.3-0.6: Moderate vegetation / cropland
      0.2-0.3: Sparse vegetation
      < 0.2: Barren / urban
    """
    year_lookup = {}
    if hasattr(gee_data, 'to_py'):
        gee_data = gee_data.to_py()
    
    if isinstance(gee_data, list):
        for entry in gee_data:
            if hasattr(entry, 'to_py'):
                entry = entry.to_py()
            if isinstance(entry, dict):
                year_lookup[entry.get("year", 0)] = entry
    
    sorted_years = sorted(int(y.to_py() if hasattr(y, 'to_py') else y) for y in years)
    village_area_ha = 500  # Approximate village area
    yearly_data = []
    
    for year in sorted_years:
        entry = year_lookup.get(year, {})
        ndvi_mean = float(entry.get("ndvi_mean", 0) or 0)
        
        # Estimate tree cover from NDVI
        if ndvi_mean > 0:
            veg_fraction = min(ndvi_mean / 0.8, 1.0)
            tree_cover_ha = round(village_area_ha * veg_fraction * 0.4, 2)
        else:
            tree_cover_ha = 0.0
        
        yearly_data.append({
            "year": year,
            "tree_cover_ha": tree_cover_ha,
            "ndvi_mean": round(ndvi_mean, 4),
        })
    
    if len(yearly_data) >= 2:
        start_ha = yearly_data[0]["tree_cover_ha"]
        end_ha = yearly_data[-1]["tree_cover_ha"]
        loss = round(max(start_ha - end_ha, 0), 2)
        gain = round(max(end_ha - start_ha, 0), 2)
    else:
        start_ha = end_ha = loss = gain = 0
    
    return {
        "village_name": village_name,
        "start_year": sorted_years[0] if sorted_years else 0,
        "end_year": sorted_years[-1] if sorted_years else 0,
        "tree_cover_start_ha": start_ha,
        "tree_cover_end_ha": end_ha,
        "tree_cover_loss_ha": loss,
        "tree_cover_gain_ha": gain,
        "net_change_ha": round(end_ha - start_ha, 2),
        "degraded_land_ha": round(loss * 0.6, 2),
        "yearly_data": yearly_data,
        "source": "GEE/MODIS/MOD13A2",
    }
`;
