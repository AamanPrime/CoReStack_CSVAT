"""CSVAT — Report generation service.

Generates interactive HTML reports and PDF/CSV exports from analytics results.
"""

import json
import csv
import io
from datetime import datetime
from jinja2 import Template


HTML_REPORT_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSVAT Report — {{ village_name }}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-primary: #0f172a;
            --bg-card: rgba(30, 41, 59, 0.8);
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --accent-green: #22c55e;
            --accent-blue: #3b82f6;
            --accent-amber: #f59e0b;
            --accent-red: #ef4444;
            --accent-teal: #14b8a6;
            --border: rgba(148, 163, 184, 0.15);
            --glass: rgba(255, 255, 255, 0.05);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
            color: var(--text-primary);
            min-height: 100vh;
            padding: 2rem;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
            text-align: center;
            padding: 3rem 2rem;
            background: var(--bg-card);
            border-radius: 20px;
            border: 1px solid var(--border);
            backdrop-filter: blur(20px);
            margin-bottom: 2rem;
        }
        .header h1 {
            font-size: 2.2rem;
            font-weight: 700;
            background: linear-gradient(135deg, var(--accent-green), var(--accent-teal));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .header .subtitle {
            color: var(--text-secondary);
            margin-top: 0.5rem;
            font-size: 1rem;
        }
        .meta-row {
            display: flex;
            justify-content: center;
            gap: 2rem;
            margin-top: 1.5rem;
            flex-wrap: wrap;
        }
        .meta-item {
            background: var(--glass);
            padding: 0.75rem 1.5rem;
            border-radius: 12px;
            border: 1px solid var(--border);
        }
        .meta-item label { color: var(--text-secondary); font-size: 0.8rem; text-transform: uppercase; }
        .meta-item span { display: block; color: var(--text-primary); font-weight: 600; }
        .section {
            background: var(--bg-card);
            border-radius: 16px;
            border: 1px solid var(--border);
            backdrop-filter: blur(20px);
            margin-bottom: 2rem;
            padding: 2rem;
        }
        .section h2 {
            font-size: 1.4rem;
            margin-bottom: 1rem;
            padding-bottom: 0.75rem;
            border-bottom: 1px solid var(--border);
        }
        .chart-container { position: relative; height: 350px; margin: 1.5rem 0; }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }
        .stat-card {
            background: var(--glass);
            padding: 1.25rem;
            border-radius: 14px;
            border: 1px solid var(--border);
            text-align: center;
        }
        .stat-card .value {
            font-size: 1.8rem;
            font-weight: 700;
        }
        .stat-card .label {
            color: var(--text-secondary);
            font-size: 0.85rem;
            margin-top: 0.25rem;
        }
        .positive { color: var(--accent-green); }
        .negative { color: var(--accent-red); }
        .neutral { color: var(--accent-blue); }
        .warning { color: var(--accent-amber); }
        .narrative {
            color: var(--text-secondary);
            line-height: 1.7;
            font-size: 0.95rem;
            margin-top: 1rem;
        }
        .footer {
            text-align: center;
            padding: 2rem;
            color: var(--text-secondary);
            font-size: 0.85rem;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        th, td {
            padding: 0.75rem 1rem;
            text-align: right;
            border-bottom: 1px solid var(--border);
        }
        th { color: var(--text-secondary); font-weight: 500; font-size: 0.85rem; text-transform: uppercase; }
        th:first-child, td:first-child { text-align: left; }
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>🌾 Village Analytics Report</h1>
        <p class="subtitle">{{ village_name }} — Socio-Ecological Analysis</p>
        <div class="meta-row">
            <div class="meta-item"><label>State</label><span>{{ state }}</span></div>
            <div class="meta-item"><label>District</label><span>{{ district }}</span></div>
            <div class="meta-item"><label>Tehsil</label><span>{{ tehsil }}</span></div>
            <div class="meta-item"><label>Generated</label><span>{{ generated_at }}</span></div>
        </div>
    </div>

    {% if cropping_intensity %}
    <div class="section">
        <h2>🌱 Cropping Intensity Trends</h2>
        <div class="chart-container">
            <canvas id="croppingChart"></canvas>
        </div>
        <div class="narrative">
            <p>This chart shows how cropping intensity has changed within the village boundary over the selected years.
            Single-crop areas are shown in green, double-crop in blue, and triple-crop in amber.</p>
        </div>
        <table>
            <thead>
                <tr><th>Year</th><th>Single Crop (ha)</th><th>Double Crop (ha)</th><th>Triple Crop (ha)</th><th>Total (ha)</th></tr>
            </thead>
            <tbody>
            {% for row in cropping_intensity.data %}
                <tr>
                    <td>{{ row.year }}</td>
                    <td>{{ row.single_crop_ha }}</td>
                    <td>{{ row.double_crop_ha }}</td>
                    <td>{{ row.triple_crop_ha }}</td>
                    <td>{{ row.total_cropped_ha }}</td>
                </tr>
            {% endfor %}
            </tbody>
        </table>
    </div>
    {% endif %}

    {% if surface_water %}
    <div class="section">
        <h2>💧 Seasonal Surface Water Availability</h2>
        <div class="chart-container">
            <canvas id="waterChart"></canvas>
        </div>
        <div class="narrative">
            <p>Surface water availability categorized as perennial (year-round), monsoon seasonal, and winter seasonal.
            Trends indicate changes in water resource distribution across the village.</p>
        </div>
        <table>
            <thead>
                <tr><th>Year</th><th>Perennial (ha)</th><th>Monsoon (ha)</th><th>Winter (ha)</th><th>Total (ha)</th></tr>
            </thead>
            <tbody>
            {% for row in surface_water.data %}
                <tr>
                    <td>{{ row.year }}</td>
                    <td>{{ row.perennial_ha }}</td>
                    <td>{{ row.seasonal_monsoon_ha }}</td>
                    <td>{{ row.seasonal_winter_ha }}</td>
                    <td>{{ row.total_water_ha }}</td>
                </tr>
            {% endfor %}
            </tbody>
        </table>
    </div>
    {% endif %}

    {% if vegetation %}
    <div class="section">
        <h2>🌳 Vegetation & Degradation Analysis</h2>
        <div class="summary-grid">
            <div class="stat-card">
                <div class="value neutral">{{ vegetation.tree_cover_start_ha }}</div>
                <div class="label">Tree Cover {{ vegetation.start_year }} (ha)</div>
            </div>
            <div class="stat-card">
                <div class="value neutral">{{ vegetation.tree_cover_end_ha }}</div>
                <div class="label">Tree Cover {{ vegetation.end_year }} (ha)</div>
            </div>
            <div class="stat-card">
                <div class="value {% if vegetation.net_change_ha >= 0 %}positive{% else %}negative{% endif %}">
                    {{ vegetation.net_change_ha }}
                </div>
                <div class="label">Net Change (ha)</div>
            </div>
            <div class="stat-card">
                <div class="value warning">{{ vegetation.degraded_land_ha }}</div>
                <div class="label">Degraded Land (ha)</div>
            </div>
        </div>
        <div class="chart-container">
            <canvas id="vegChart"></canvas>
        </div>
        <div class="narrative">
            <p>Vegetation tracking compares tree cover across years to identify areas of loss and degradation.
            Between {{ vegetation.start_year }} and {{ vegetation.end_year }}, the village experienced
            {% if vegetation.net_change_ha < 0 %}a net loss{% else %}a net gain{% endif %}
            of {{ vegetation.net_change_ha|abs }} hectares of tree cover.
            An estimated {{ vegetation.degraded_land_ha }} hectares are classified as degraded land.</p>
        </div>
    </div>
    {% endif %}

    <div class="footer">
        <p>Generated by CSVAT — CoRE Stack Village Analytics Tool</p>
        <p>{{ generated_at }}</p>
    </div>
</div>

<script>
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148,163,184,0.15)';

{% if cropping_intensity %}
new Chart(document.getElementById('croppingChart'), {
    type: 'bar',
    data: {
        labels: {{ cropping_years | tojson }},
        datasets: [
            {label: 'Single Crop', data: {{ cropping_single | tojson }}, backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6},
            {label: 'Double Crop', data: {{ cropping_double | tojson }}, backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 6},
            {label: 'Triple Crop', data: {{ cropping_triple | tojson }}, backgroundColor: 'rgba(245,158,11,0.7)', borderRadius: 6},
        ]
    },
    options: {
        responsive: true, maintainAspectRatio: false,
        scales: {x: {stacked: true}, y: {stacked: true, title: {display: true, text: 'Area (Hectares)'}}},
        plugins: {legend: {position: 'top'}}
    }
});
{% endif %}

{% if surface_water %}
new Chart(document.getElementById('waterChart'), {
    type: 'bar',
    data: {
        labels: {{ water_years | tojson }},
        datasets: [
            {label: 'Perennial', data: {{ water_perennial | tojson }}, backgroundColor: 'rgba(59,130,246,0.8)', borderRadius: 6},
            {label: 'Monsoon', data: {{ water_monsoon | tojson }}, backgroundColor: 'rgba(20,184,166,0.7)', borderRadius: 6},
            {label: 'Winter', data: {{ water_winter | tojson }}, backgroundColor: 'rgba(147,197,253,0.6)', borderRadius: 6},
        ]
    },
    options: {
        responsive: true, maintainAspectRatio: false,
        scales: {y: {title: {display: true, text: 'Area (Hectares)'}}},
        plugins: {legend: {position: 'top'}}
    }
});
{% endif %}

{% if vegetation %}
new Chart(document.getElementById('vegChart'), {
    type: 'line',
    data: {
        labels: {{ veg_years | tojson }},
        datasets: [{
            label: 'Tree Cover (ha)',
            data: {{ veg_cover | tojson }},
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.15)',
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            pointBackgroundColor: '#22c55e',
        }]
    },
    options: {
        responsive: true, maintainAspectRatio: false,
        scales: {y: {title: {display: true, text: 'Area (Hectares)'}}},
        plugins: {legend: {position: 'top'}}
    }
});
{% endif %}
</script>
</body>
</html>
"""


class ReportService:
    """Generates interactive HTML reports and export formats from analytics results."""

    def __init__(self):
        self.template = Template(HTML_REPORT_TEMPLATE)

    def generate_html_report(self, results: dict) -> str:
        """Generate a full interactive HTML report from analytics result bundle."""

        # Helper: data can be {data: [...]}, a plain list, or a dict
        def _ensure_list(val):
            if val is None:
                return None
            if isinstance(val, dict):
                return val.get("data") if val.get("data") else None
            if isinstance(val, list):
                return val
            return None

        ci_list = _ensure_list(results.get("cropping_intensity"))
        sw_list = _ensure_list(results.get("surface_water"))
        veg = results.get("vegetation")
        if isinstance(veg, list):
            veg = None  # vegetation should be a dict, not a list

        context = {
            "village_name": results.get("village_name", "Unknown Village"),
            "state": results.get("state", "—"),
            "district": results.get("district", "—"),
            "tehsil": results.get("tehsil", "—"),
            "generated_at": datetime.utcnow().strftime("%B %d, %Y at %H:%M UTC"),
            # Wrap lists back into {data: [...]} for template compatibility
            "cropping_intensity": {"data": ci_list} if ci_list else None,
            "surface_water": {"data": sw_list} if sw_list else None,
            "vegetation": veg if isinstance(veg, dict) else None,
            # Default chart data to prevent tojson Undefined errors
            "cropping_years": [],
            "cropping_single": [],
            "cropping_double": [],
            "cropping_triple": [],
            "water_years": [],
            "water_perennial": [],
            "water_monsoon": [],
            "water_winter": [],
            "veg_years": [],
            "veg_cover": [],
        }

        # Prepare chart data
        if ci_list:
            context["cropping_years"] = [d.get("year", "") for d in ci_list]
            context["cropping_single"] = [d.get("single_crop_ha", 0) for d in ci_list]
            context["cropping_double"] = [d.get("double_crop_ha", 0) for d in ci_list]
            context["cropping_triple"] = [d.get("triple_crop_ha", 0) for d in ci_list]

        if sw_list:
            context["water_years"] = [d.get("year", "") for d in sw_list]
            context["water_perennial"] = [d.get("perennial_ha", 0) for d in sw_list]
            context["water_monsoon"] = [d.get("seasonal_monsoon_ha", 0) for d in sw_list]
            context["water_winter"] = [d.get("seasonal_winter_ha", 0) for d in sw_list]

        if veg and isinstance(veg, dict) and veg.get("yearly_data"):
            context["veg_years"] = [d.get("year", "") for d in veg["yearly_data"]]
            context["veg_cover"] = [d.get("tree_cover_ha", 0) for d in veg["yearly_data"]]

        return self.template.render(**context)

    def generate_csv(self, results: dict) -> str:
        """Generate CSV string from analytics results."""
        output = io.StringIO()
        writer = csv.writer(output)

        def _ensure_list(val):
            if val is None:
                return None
            if isinstance(val, dict):
                return val.get("data") if val.get("data") else None
            if isinstance(val, list):
                return val
            return None

        # Cropping intensity
        ci_list = _ensure_list(results.get("cropping_intensity"))
        if ci_list:
            writer.writerow(["=== Cropping Intensity ==="])
            writer.writerow(["Year", "Single Crop (ha)", "Double Crop (ha)",
                           "Triple Crop (ha)", "Total (ha)"])
            for row in ci_list:
                writer.writerow([row.get("year", ""), row.get("single_crop_ha", 0),
                               row.get("double_crop_ha", 0), row.get("triple_crop_ha", 0),
                               row.get("total_cropped_ha", 0)])
            writer.writerow([])

        # Surface water
        sw_list = _ensure_list(results.get("surface_water"))
        if sw_list:
            writer.writerow(["=== Surface Water ==="])
            writer.writerow(["Year", "Perennial (ha)", "Monsoon (ha)",
                           "Winter (ha)", "Total (ha)"])
            for row in sw_list:
                writer.writerow([row.get("year", ""), row.get("perennial_ha", 0),
                               row.get("seasonal_monsoon_ha", 0), row.get("seasonal_winter_ha", 0),
                               row.get("total_water_ha", 0)])
            writer.writerow([])

        # Vegetation
        vg = results.get("vegetation")
        if isinstance(vg, dict) and vg.get("yearly_data"):
            writer.writerow(["=== Vegetation ==="])
            writer.writerow(["Year", "Tree Cover (ha)"])
            for row in vg["yearly_data"]:
                writer.writerow([row.get("year", ""), row.get("tree_cover_ha", 0)])
            writer.writerow([])
            writer.writerow(["Net Change (ha)", vg.get("net_change_ha", 0)])
            writer.writerow(["Degraded Land (ha)", vg.get("degraded_land_ha", 0)])

        return output.getvalue()


report_service = ReportService()
