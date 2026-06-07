"""CSVAT — PDF Report Generation Service.

Generates static PDF reports from analytics results using ReportLab.
Structure mirrors the HTML report: header, stat cards, charts (as tables), narrative.
"""

import io
import logging
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable,
)

logger = logging.getLogger(__name__)

# ── Colors ──────────────────────────────────────────────────────────
BRAND_GREEN = HexColor("#22c55e")
BRAND_TEAL = HexColor("#14b8a6")
DARK_BG = HexColor("#1e293b")
TEXT_PRIMARY = HexColor("#1e293b")
TEXT_SECONDARY = HexColor("#64748b")
TABLE_HEADER_BG = HexColor("#f1f5f9")
TABLE_BORDER = HexColor("#e2e8f0")


class PDFService:
    """Generate PDF reports from CSVAT analytics results."""

    def __init__(self):
        self.styles = getSampleStyleSheet()
        self._add_custom_styles()

    def _add_custom_styles(self):
        """Add CSVAT-branded styles."""
        self.styles.add(ParagraphStyle(
            name="CSVATTitle",
            parent=self.styles["Heading1"],
            fontSize=22,
            textColor=BRAND_GREEN,
            alignment=TA_CENTER,
            spaceAfter=6 * mm,
        ))
        self.styles.add(ParagraphStyle(
            name="CSVATSubtitle",
            parent=self.styles["Normal"],
            fontSize=11,
            textColor=TEXT_SECONDARY,
            alignment=TA_CENTER,
            spaceAfter=8 * mm,
        ))
        self.styles.add(ParagraphStyle(
            name="SectionHeader",
            parent=self.styles["Heading2"],
            fontSize=14,
            textColor=BRAND_TEAL,
            spaceBefore=10 * mm,
            spaceAfter=4 * mm,
        ))
        self.styles.add(ParagraphStyle(
            name="Narrative",
            parent=self.styles["Normal"],
            fontSize=10,
            textColor=TEXT_PRIMARY,
            spaceAfter=4 * mm,
            leading=14,
        ))

    def generate_pdf(self, results: dict) -> bytes:
        """Generate a PDF report from analytics results. Returns PDF bytes."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=2 * cm,
            rightMargin=2 * cm,
            topMargin=2 * cm,
            bottomMargin=2 * cm,
        )

        elements = []

        # ── Header ──
        village = results.get("village_name", "Unknown Village")
        state = results.get("state", "")
        district = results.get("district", "")
        tehsil = results.get("tehsil", "")

        elements.append(Paragraph(f"{village} Report", self.styles["CSVATTitle"]))
        elements.append(Paragraph(
            f"{village} — Socio-Ecological Analysis",
            self.styles["CSVATSubtitle"],
        ))

        # Meta info
        meta_text = f"State: {state} | District: {district} | Tehsil: {tehsil}"
        elements.append(Paragraph(meta_text, self.styles["CSVATSubtitle"]))

        data_source = results.get("data_source", "unknown")
        source_label = {
            "corestack_mws": "CoRE Stack MWS (10m resolution)",
            "gee_fallback": "Google Earth Engine (MODIS 500m)",
            "raster": "LULC IndiaSAT v3 GeoTIFF",
        }.get(data_source, data_source)
        elements.append(Paragraph(
            f"Data Source: {source_label} | Generated: {datetime.now().strftime('%d %b %Y, %H:%M')}",
            self.styles["CSVATSubtitle"],
        ))

        elements.append(HRFlowable(width="100%", color=TABLE_BORDER))
        elements.append(Spacer(1, 8 * mm))

        # ── Cropping Intensity ──
        ci = results.get("cropping_intensity")
        if ci:
            elements.append(Paragraph(" Cropping Intensity Trends", self.styles["SectionHeader"]))
            ci_data = ci.get("data", ci) if isinstance(ci, dict) else ci
            if isinstance(ci_data, list) and ci_data:
                headers = ["Year", "Single (ha)", "Double (ha)", "Triple (ha)", "Total (ha)"]
                rows = [headers]
                for row in ci_data:
                    rows.append([
                        str(row.get("year", "")),
                        f"{row.get('single_crop_ha', 0):.1f}",
                        f"{row.get('double_crop_ha', 0):.1f}",
                        f"{row.get('triple_crop_ha', 0):.1f}",
                        f"{row.get('total_cropped_ha', 0):.1f}",
                    ])
                table = self._make_table(rows)
                elements.append(table)
                elements.append(Spacer(1, 4 * mm))

        # ── Surface Water ──
        sw = results.get("surface_water")
        if sw:
            elements.append(Paragraph(" Seasonal Surface Water Availability", self.styles["SectionHeader"]))
            sw_data = sw.get("data", sw) if isinstance(sw, dict) else sw
            if isinstance(sw_data, list) and sw_data:
                headers = ["Year", "Perennial (ha)", "Monsoon (ha)", "Winter (ha)", "Total (ha)"]
                rows = [headers]
                for row in sw_data:
                    rows.append([
                        str(row.get("year", "")),
                        f"{row.get('perennial_ha', 0):.1f}",
                        f"{row.get('seasonal_monsoon_ha', 0):.1f}",
                        f"{row.get('seasonal_winter_ha', 0):.1f}",
                        f"{row.get('total_water_ha', 0):.1f}",
                    ])
                table = self._make_table(rows)
                elements.append(table)
                elements.append(Spacer(1, 4 * mm))

        # ── Vegetation ──
        veg = results.get("vegetation")
        if veg:
            elements.append(Paragraph(" Vegetation & Degradation Analysis", self.styles["SectionHeader"]))
            if isinstance(veg, dict):
                veg_rows = [
                    ["Metric", "Value"],
                    ["Start Year", str(veg.get("start_year", ""))],
                    ["End Year", str(veg.get("end_year", ""))],
                    ["Tree Cover Start (ha)", f"{veg.get('tree_cover_start_ha', 0):.1f}"],
                    ["Tree Cover End (ha)", f"{veg.get('tree_cover_end_ha', 0):.1f}"],
                    ["Net Change (ha)", f"{veg.get('net_change_ha', 0):.1f}"],
                    ["Tree Cover Loss (ha)", f"{veg.get('tree_cover_loss_ha', 0):.1f}"],
                    ["Tree Cover Gain (ha)", f"{veg.get('tree_cover_gain_ha', 0):.1f}"],
                    ["Degraded Land (ha)", f"{veg.get('degraded_land_ha', 0):.1f}"],
                ]
                table = self._make_table(veg_rows)
                elements.append(table)

        # ── Footer ──
        elements.append(Spacer(1, 15 * mm))
        elements.append(HRFlowable(width="100%", color=TABLE_BORDER))
        elements.append(Paragraph(
            "Generated by CSVAT — CoRE Stack Village Analytics Tool",
            self.styles["CSVATSubtitle"],
        ))

        # Build PDF
        doc.build(elements)
        return buffer.getvalue()

    def _make_table(self, data: list[list]) -> Table:
        """Create a styled table from a 2D list."""
        col_count = len(data[0]) if data else 0
        col_width = (A4[0] - 4 * cm) / col_count if col_count else 100

        table = Table(data, colWidths=[col_width] * col_count)
        style = TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_SECONDARY),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("ALIGN", (0, 0), (0, -1), "LEFT"),
            ("GRID", (0, 0), (-1, -1), 0.5, TABLE_BORDER),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f8fafc")]),
        ])
        table.setStyle(style)
        return table


# Singleton
pdf_service = PDFService()
