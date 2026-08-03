#!/usr/bin/env python3
"""Regenerate the synthetic PDF references for file-commerce-ops-multilang-rfq-contradiction-extract.

Run from the task root:
    python3 private/generate_data.py

Re-emits files/references/incoterms_2020_quick_reference.pdf and
files/references/ocean_transit_times_reference.pdf via reportlab.
Each PDF carries a 'BENCHMARK USE — NOT AN OFFICIAL PUBLICATION'
watermark on every page so the document cannot be mistaken for an
authoritative real-world reference (e.g. an official ICC publication
or a carrier's published transit-time table).

The .eml inbox files and the markdown reference / inbox notes under
files/ are written by hand and are not regenerated here.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
REF_DIR = ROOT / "workspace" / "references"


WATERMARK_TEXT = "FOR REALREPLICABENCH BENCHMARK USE ONLY — NOT AN OFFICIAL PUBLICATION"


def _draw_watermark_and_footer(canvas: Canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica-Oblique", 36)
    canvas.setFillColor(colors.lightgrey)
    canvas.translate(A4[0] / 2.0, A4[1] / 2.0)
    canvas.rotate(30)
    canvas.drawCentredString(0, 0, "BENCHMARK USE ONLY")
    canvas.restoreState()

    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(colors.grey)
    canvas.drawString(15 * mm, 10 * mm, WATERMARK_TEXT)
    canvas.drawRightString(A4[0] - 15 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def _build_doc(path: Path) -> tuple[BaseDocTemplate, list]:
    doc = BaseDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=18 * mm,
        title=path.stem.replace("_", " ").title(),
        author="RealReplicaBench Sourcing Desk (synthetic)",
        subject="Internal sourcing reference — benchmark use only",
    )
    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        id="normal",
    )
    doc.addPageTemplates([
        PageTemplate(id="watermarked", frames=frame, onPage=_draw_watermark_and_footer)
    ])
    return doc, []


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    s = {
        "title": ParagraphStyle("title", parent=base["Title"], fontSize=18, leading=22, spaceAfter=8),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontSize=13, leading=16, spaceBefore=10, spaceAfter=4),
        "h3": ParagraphStyle("h3", parent=base["Heading3"], fontSize=11, leading=14, spaceBefore=6, spaceAfter=3),
        "body": ParagraphStyle("body", parent=base["BodyText"], fontSize=9.5, leading=13, spaceAfter=4),
        "note": ParagraphStyle("note", parent=base["BodyText"], fontSize=8.5, leading=11, textColor=colors.darkgrey, spaceAfter=4),
    }
    return s


def build_incoterms_pdf() -> None:
    path = REF_DIR / "incoterms_2020_quick_reference.pdf"
    doc, story = _build_doc(path)
    st = _styles()

    story.append(Paragraph("Incoterms 2020 Quick Reference", st["title"]))
    story.append(Paragraph(
        "Internal sourcing-desk edition — synthetic summary prepared for the RealReplicaBench dataset. "
        "Not an ICC publication. See the official ICC Incoterms 2020 rules for binding text.",
        st["note"],
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("1. The eleven Incoterms 2020 rules", st["h2"]))
    story.append(Paragraph(
        "Incoterms 2020 (International Commercial Terms) is the eighth ICC revision, in force since 1 January 2020. "
        "Each rule defines, between seller and buyer, the division of three things: (a) physical delivery and the "
        "point at which risk of loss / damage passes, (b) the allocation of transport, insurance, export and import "
        "clearance costs, and (c) which side must arrange and pay for the main carriage. The eleven rules split into "
        "two groups: seven that work for any mode of transport, and four that are reserved for sea / inland waterway "
        "shipments only.",
        st["body"],
    ))

    story.append(Paragraph("Any mode of transport", st["h3"]))
    table_data_any = [
        ["Rule", "Seller's obligation ends at", "Risk passes at", "Main carriage paid by"],
        ["EXW", "Seller's premises", "Seller's premises", "Buyer"],
        ["FCA", "Named place (loaded / handed to carrier)", "Named place", "Buyer"],
        ["CPT", "Goods handed to carrier", "First carrier", "Seller (to named destination)"],
        ["CIP", "Goods handed to carrier (with insurance)", "First carrier", "Seller (with min insurance at ICC(A) level)"],
        ["DAP", "Named place of destination, ready for unloading", "Destination", "Seller"],
        ["DPU", "Named place, unloaded by seller", "Destination", "Seller"],
        ["DDP", "Named place of destination, duties cleared", "Destination", "Seller (incl. import duties / taxes)"],
    ]
    tbl_any = Table(table_data_any, colWidths=[18 * mm, 56 * mm, 32 * mm, 56 * mm], repeatRows=1)
    tbl_any.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl_any)

    story.append(Paragraph("Sea / inland waterway only", st["h3"]))
    table_data_sea = [
        ["Rule", "Seller's obligation ends at", "Risk passes at", "Main carriage paid by"],
        ["FAS", "Alongside vessel at named loading port", "Alongside (loading port)", "Buyer"],
        ["FOB", "Goods loaded on vessel at named loading port", "Loading port (on board)", "Buyer (from loading port onwards)"],
        ["CFR", "Goods loaded on vessel", "Loading port (on board)", "Seller pays sea freight; risk on buyer from loading"],
        ["CIF", "Goods loaded on vessel", "Loading port (on board)", "Seller pays sea freight + min insurance"],
    ]
    tbl_sea = Table(table_data_sea, colWidths=[18 * mm, 56 * mm, 32 * mm, 56 * mm], repeatRows=1)
    tbl_sea.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl_sea)

    story.append(Paragraph("2. Mutually exclusive choices — a common buyer-side confusion", st["h2"]))
    story.append(Paragraph(
        "A single shipment cannot operate under two Incoterms simultaneously. Each rule defines a complete, "
        "self-consistent allocation of risk, cost and obligations between seller and buyer. If a buyer asks the "
        "seller to quote 'FOB Shanghai' but also expects the seller to bear sea freight, insurance, import "
        "clearance and inland delivery to the destination warehouse, that is a contradictory request: under FOB "
        "the seller's risk and cost obligations end at the loading port; the obligations the buyer is describing "
        "correspond to DAP (or DDP, if the seller is also to clear import duties).",
        st["body"],
    ))
    story.append(Paragraph(
        "The correct response is to restate the Incoterm. Two clean options:",
        st["body"],
    ))
    story.append(Paragraph(
        "(a) quote DAP / DDP at the named destination warehouse, in which case the unit price legitimately "
        "absorbs all freight, insurance, import clearance and inland delivery to that point;",
        st["body"],
    ))
    story.append(Paragraph(
        "(b) quote FOB Shanghai and have the buyer arrange and pay for the onward freight, insurance and "
        "delivery — this matches the FOB risk allocation but means the buyer (not the seller) is the consignee "
        "on the bill of lading and bears post-loading risk.",
        st["body"],
    ))
    story.append(Paragraph(
        "If the buyer asks for FOB pricing 'side-by-side' with DAP pricing purely for internal-accounting "
        "comparison and is willing to receive two separate quotations, that is a valid sourcing-team request "
        "and not a contradiction — supply both prices, each correctly labelled.",
        st["body"],
    ))

    story.append(Paragraph("3. Standard ancillary obligations (selected highlights)", st["h2"]))
    story.append(Paragraph(
        "Under CIF and CIP, the seller is obliged to procure cargo insurance on behalf of the buyer. The "
        "minimum cover level differs by rule: CIF requires only ICC(C) cover, the narrowest London-market clause; "
        "CIP requires ICC(A) all-risks cover. Buyers wanting wider cover under CIF must agree this explicitly.",
        st["body"],
    ))
    story.append(Paragraph(
        "Under DDP, the seller is responsible for paying any import duties, VAT, and other import-related "
        "charges in the buyer's country. This is rarely practical when the seller has no local presence in the "
        "import country; many sellers refuse DDP as a matter of policy and offer DAP instead.",
        st["body"],
    ))
    story.append(Paragraph(
        "Under EXW, the seller's obligation ends at making the goods available at its own premises; the buyer is "
        "responsible for loading, export clearance, and all transport. EXW is convenient for the seller but "
        "rarely realistic for buyers who cannot file an export declaration in the seller's country.",
        st["body"],
    ))

    story.append(Paragraph("4. Named place / port — always required", st["h2"]))
    story.append(Paragraph(
        "Every Incoterm must be paired with a named place or port. 'FOB Shanghai' and 'CIF Hamburg' are well-formed; "
        "'FOB' alone is ambiguous. For port-mode terms (FAS, FOB, CFR, CIF) the named location is always a port; for "
        "any-mode terms (EXW, FCA, CPT, CIP, DAP, DPU, DDP) the named place can be a port, an inland location, an "
        "address, or a defined facility.",
        st["body"],
    ))

    doc.build(story)


def build_transit_times_pdf() -> None:
    path = REF_DIR / "ocean_transit_times_reference.pdf"
    doc, story = _build_doc(path)
    st = _styles()

    story.append(Paragraph("Ocean Freight Typical Transit Times — Selected Major Lanes", st["title"]))
    story.append(Paragraph(
        "Internal sourcing-desk reference. Synthetic estimates prepared for the RealReplicaBench dataset; "
        "not a carrier-published timetable. Use carrier-specific quotes for booked vessels.",
        st["note"],
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("1. How to read these numbers", st["h2"]))
    story.append(Paragraph(
        "Each row gives a typical port-to-port (gate-to-gate) transit window for full ocean freight on the named "
        "lane. The range reflects the typical band across major carriers, seasons, and routings; actual "
        "vessel-specific transit can be 1–4 days longer than the upper bound when transhipment ports are "
        "congested or when a vessel is held for berthing windows. Numbers do not include inland transit "
        "from origin factory to loading port, customs clearance at destination, or final delivery to the "
        "consignee's warehouse.",
        st["body"],
    ))
    story.append(Paragraph(
        "Transit estimates substantially shorter than the lane's typical band usually indicate the buyer is "
        "confusing sea freight with air, mis-remembering an earlier quote, or thinking of one expedited LCL "
        "consolidator's service. Verify directly with the buyer before basing a delivery commitment on an "
        "outlier-fast ocean estimate.",
        st["body"],
    ))

    story.append(Paragraph("2. Major lanes — origin China to North America", st["h2"]))
    data_na = [
        ["Origin", "Destination", "Typical transit (days)", "Notes"],
        ["Shanghai (CNSHA)", "Long Beach (USLAX)", "14–18", "TPEB Pacific eastbound, no transhipment"],
        ["Shanghai (CNSHA)", "Los Angeles (USLAX)", "14–18", "Same lane group"],
        ["Shanghai (CNSHA)", "Oakland (USOAK)", "14–18", "TPEB Pacific eastbound"],
        ["Shanghai (CNSHA)", "Seattle / Tacoma (USSEA / USTAC)", "13–17", "Slightly faster than LA / LB"],
        ["Shanghai (CNSHA)", "New York / Newark (USNYC)", "28–35", "Via Panama Canal"],
        ["Shanghai (CNSHA)", "Savannah (USSAV)", "28–34", "Via Panama Canal"],
        ["Shanghai (CNSHA)", "Manzanillo / Lázaro Cárdenas (MX, Pacific)", "18–25", "TPEB Pacific eastbound"],
        ["Shanghai (CNSHA)", "Veracruz (MXVER)", "30–38", "Atlantic Mexico via Panama Canal"],
        ["Yantian (CNYTN)", "Long Beach (USLAX)", "13–17", "Slightly faster than Shanghai origin"],
        ["Ningbo (CNNGB)", "Long Beach (USLAX)", "14–18", "Same lane group as Shanghai origin"],
    ]
    tbl_na = Table(data_na, colWidths=[40 * mm, 56 * mm, 28 * mm, 50 * mm], repeatRows=1)
    tbl_na.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl_na)

    story.append(Paragraph("3. Major lanes — origin China to Europe", st["h2"]))
    data_eu = [
        ["Origin", "Destination", "Typical transit (days)", "Notes"],
        ["Shanghai (CNSHA)", "Hamburg (DEHAM)", "30–38", "Via Suez Canal"],
        ["Shanghai (CNSHA)", "Felixstowe (GBFXT)", "30–38", "Same lane group"],
        ["Shanghai (CNSHA)", "Rotterdam (NLRTM)", "30–37", "Via Suez Canal"],
        ["Shanghai (CNSHA)", "Antwerp (BEANR)", "30–38", "Via Suez Canal"],
        ["Shanghai (CNSHA)", "Le Havre (FRLEH)", "30–37", "Via Suez Canal"],
        ["Shanghai (CNSHA)", "Genoa (ITGOA)", "26–32", "Mediterranean — shorter via Suez"],
        ["Shanghai (CNSHA)", "Piraeus (GRPIR)", "24–30", "Mediterranean transhipment hub"],
        ["Ningbo (CNNGB)", "Hamburg (DEHAM)", "30–38", "Same lane group as Shanghai origin"],
    ]
    tbl_eu = Table(data_eu, colWidths=[40 * mm, 56 * mm, 28 * mm, 50 * mm], repeatRows=1)
    tbl_eu.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl_eu)

    story.append(Paragraph("4. Major lanes — origin China to rest of world", st["h2"]))
    data_row = [
        ["Origin", "Destination", "Typical transit (days)", "Notes"],
        ["Shanghai (CNSHA)", "Santos (BRSSZ)", "30–40", "South America Atlantic; may transship at a Caribbean hub"],
        ["Shanghai (CNSHA)", "Buenos Aires (ARBUE)", "32–42", "South America Atlantic via Cape of Good Hope or Panama"],
        ["Shanghai (CNSHA)", "Valparaíso (CLVAP)", "28–36", "South America Pacific"],
        ["Shanghai (CNSHA)", "Jebel Ali (AEJEA)", "18–25", "Via Singapore transhipment"],
        ["Shanghai (CNSHA)", "Sydney (AUSYD)", "18–22", "Direct or via Singapore"],
        ["Shanghai (CNSHA)", "Melbourne (AUMEL)", "18–22", "Same lane group as Sydney"],
        ["Shanghai (CNSHA)", "Durban (ZADUR)", "28–35", "South Africa east coast"],
        ["Shanghai (CNSHA)", "Cape Town (ZACPT)", "30–38", "South Africa west coast"],
        ["Shanghai (CNSHA)", "Tokyo (JPTYO)", "3–5", "Short-haul intra-Asia"],
        ["Shanghai (CNSHA)", "Yokohama (JPYOK)", "3–5", "Intra-Asia"],
        ["Shanghai (CNSHA)", "Ho Chi Minh City (VNSGN)", "5–9", "Intra-Asia, often via Hong Kong"],
    ]
    tbl_row = Table(data_row, colWidths=[40 * mm, 56 * mm, 28 * mm, 50 * mm], repeatRows=1)
    tbl_row.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl_row)

    story.append(Paragraph("5. Air freight (for comparison)", st["h2"]))
    story.append(Paragraph(
        "Direct-flight air freight from Shanghai PVG to any major hub (DXB / FRA / JFK / LAX / SYD / GRU) is "
        "typically 3–7 days door-to-door including customs clearance. Air freight is the only realistic option "
        "for transit times shorter than the lower bound of the ocean lane. Air costs roughly 7–12× the ocean "
        "rate per kilogram of cargo and is therefore reserved for high-value, urgent or perishable shipments.",
        st["body"],
    ))

    doc.build(story)


def main() -> int:
    REF_DIR.mkdir(parents=True, exist_ok=True)
    build_incoterms_pdf()
    build_transit_times_pdf()
    print(f"wrote 2 PDFs to {REF_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
