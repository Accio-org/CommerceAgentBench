#!/usr/bin/env python3
"""Regenerate the synthetic PDF documents for file-logistics-cargo-insurance-multiparty-allocation.

Run from the task root:
    python3 private/generate_data.py

Re-emits:
  - files/policies/<customer>_<insurer>_policy.pdf  (5 PDFs)
  - files/icc_clauses_reference.pdf
  - files/surveyor_report.pdf

Every PDF carries a 'BENCHMARK USE — NOT A REAL POLICY' watermark on
every page so the synthetic documents cannot be mistaken for real
insurance contracts or surveyor findings. Textual content matches the
policy substance used by the verifier ground truth (see
private/expected_answer.json).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

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
FILES = ROOT / "workspace"
POLICIES_DIR = FILES / "policies"


WATERMARK_TEXT = "FOR COMMERCE AGENT BENCH USE ONLY - NOT A REAL POLICY / NOT AN OFFICIAL PUBLICATION"


def _watermark(canvas: Canvas, doc) -> None:
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


def _build_doc(path: Path, title: str) -> BaseDocTemplate:
    doc = BaseDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=22 * mm, bottomMargin=18 * mm,
        title=title,
        author="Commerce Agent Bench Insurance Desk (synthetic)",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height)
    doc.addPageTemplates([PageTemplate(id="wm", frames=frame, onPage=_watermark)])
    return doc


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "hc": ParagraphStyle("hc", parent=base["Title"], fontSize=14, leading=18, alignment=0),
        "hd": ParagraphStyle("hd", parent=base["Heading2"], fontSize=11, leading=14, spaceAfter=2, textColor=colors.darkgrey, alignment=0),
        "title": ParagraphStyle("title", parent=base["Title"], fontSize=16, leading=20, spaceAfter=10),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontSize=12, leading=15, spaceBefore=10, spaceAfter=4),
        "body": ParagraphStyle("body", parent=base["BodyText"], fontSize=9.5, leading=13, spaceAfter=5),
        "callout": ParagraphStyle("callout", parent=base["BodyText"], fontSize=9.5, leading=13, spaceAfter=5, leftIndent=8, borderLeftColor=colors.darkred, borderLeftWidth=2, borderPadding=4),
        "small": ParagraphStyle("small", parent=base["BodyText"], fontSize=8, leading=10, textColor=colors.darkgrey),
        "table_head": ParagraphStyle("table_head", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=7.5, leading=9),
        "table_cell": ParagraphStyle("table_cell", parent=base["BodyText"], fontSize=7.5, leading=9),
    }


def _wrap_table(rows: list[list[str]], st: dict[str, ParagraphStyle]) -> list[list[Paragraph]]:
    return [
        [Paragraph(str(cell), st["table_head" if row_index == 0 else "table_cell"]) for cell in row]
        for row_index, row in enumerate(rows)
    ]


def _header_table(insurer: str, addr: str, contact: str, st: dict) -> Table:
    data = [
        [Paragraph(f"<b>{insurer}</b>", st["hc"])],
        [Paragraph(f"<i>{addr}</i>", st["small"])],
        [Paragraph(contact, st["small"])],
    ]
    t = Table(data, colWidths=[170 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, -1), (-1, -1), 0.8, colors.darkblue)]))
    return t


def _info_box(rows: list[tuple[str, str]], st: dict) -> Table:
    body = st["body"]
    data = [[Paragraph(f"<b>{k}</b>", body), Paragraph(v, body)] for k, v in rows]
    t = Table(data, colWidths=[55 * mm, 115 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.grey),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.lightgrey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _build_policy(spec: dict[str, Any]) -> None:
    path = POLICIES_DIR / spec["filename"]
    doc = _build_doc(path, spec["title"])
    st = _styles()
    story: list = []
    story.append(_header_table(spec["insurer"], spec["insurer_addr"], spec["insurer_contact"], st))
    story.append(Spacer(1, 8))
    story.append(Paragraph("MARINE CARGO INSURANCE POLICY (SCHEDULE)", st["hd"]))
    story.append(Spacer(1, 4))
    story.append(_info_box(spec["info_rows"], st))
    for h, kind, txt in spec["sections"]:
        story.append(Paragraph(h, st["h2"]))
        style_key = "callout" if kind == "callout" else "body"
        if isinstance(txt, list):
            for para in txt:
                story.append(Paragraph(para, st[style_key]))
        else:
            story.append(Paragraph(txt, st[style_key]))
    doc.build(story)


POLICY_LINNEA = {
    "filename": "linnea_pingan_policy.pdf",
    "title": "Cargo Insurance Policy — Linnea Furniture AB",
    "insurer": "PingAn Property &amp; Casualty Insurance Company of China, Ltd.",
    "insurer_addr": "Shanghai Branch — Marine Cargo Underwriting Division",
    "insurer_contact": "marine.claims.shanghai@pingan.com.cn  •  +86 21 5840 7777",
    "info_rows": [
        ("Policy number", "PA-MAR-CN-2026-04217"),
        ("Policyholder", "Linnea Furniture AB, Stockholm, Sweden"),
        ("Trade Incoterm", "CIF Hamburg — seller-arranged cargo cover"),
        ("Coverage period", "From on-board at Shanghai (CNSHA) to discharge at Hamburg (DEHAM)"),
        ("Subject matter insured", "12 cartons of teak coffee tables"),
        ("Master invoice value", "USD 24,000"),
        ("Vessel / voyage", "MV PIONEER WAVE / PW-PVG-HAM-2026-V04"),
        ("Container", "OCEAN-2026-04-V552 (40HQ)"),
    ],
    "sections": [
        ("1. Coverage scope", "body",
         "<b>Institute Cargo Clauses (A) 1/1/2009 — ICC(A) all-risks basis.</b> Covers all risks of loss or damage "
         "to the subject matter insured, subject only to the specific exclusions stated in the policy."),
        ("2. Sum insured", "body",
         "<b>110% of the master invoice value = USD 26,400</b>, in accordance with standard Chinese marine cargo "
         "market practice (cost + 10% freight)."),
        ("3. Deductible", "body",
         "<b>USD 500 absolute per claim event.</b> The deductible is a fixed dollar amount applied once per "
         "insurable event, regardless of the size of the loss."),
        ("4. Extensions and exclusions", "body", [
            "<b>Theft, Pilferage and Non-Delivery (TPND):</b> included. Loss arising from theft, pilferage from the "
            "container, or non-delivery of an entire carton at the discharge port is covered subject to the same deductible.",
            "<b>General exclusions:</b> standard ICC(A) exclusions only — wilful misconduct of the assured, ordinary "
            "leakage / loss in weight / wear and tear, insufficiency of packing prepared by the assured, inherent vice, "
            "delay, insolvency of carriers, war (unless War Clauses extension), strikes (unless Strikes Clauses extension).",
            "<b>No specific commodity exclusions</b> apply to this policy. Teak furniture water damage is fully within "
            "ICC(A) coverage scope.",
        ]),
        ("5. Notice of claim", "body",
         "Must be filed within 14 days of discharge at destination port. Linnea is within the window."),
        ("6. Surveyor and settlement contact", "body",
         "Surveyor of record: Lloyd's Register Marine Surveyors (Singapore), case #LR-SIN-2026-04-V552-A. "
         "For claim settlement co-ordination contact marine.claims.shanghai@pingan.com.cn quoting policy "
         "PA-MAR-CN-2026-04217 + container OCEAN-2026-04-V552."),
    ],
}


POLICY_JONAS = {
    "filename": "jonas_allianz_policy.pdf",
    "title": "Cargo Insurance Policy — Jonas Auto Parts GmbH",
    "insurer": "Allianz Global Corporate &amp; Specialty SE",
    "insurer_addr": "Munich Branch — Marine Underwriting",
    "insurer_contact": "marine.claims.de@allianz.com  •  +49 89 3800 0",
    "info_rows": [
        ("Policy number", "AL-DE-MAR-2026-008842"),
        ("Policyholder", "Jonas Auto Parts GmbH, Stuttgart, Germany"),
        ("Trade Incoterm", "FOB Shanghai — buyer-arranged cargo cover"),
        ("Coverage period", "From on-board at Shanghai (CNSHA) to discharge at Hamburg (DEHAM), via Singapore transhipment"),
        ("Subject matter insured", "8 cartons of automotive rubber gaskets"),
        ("Master invoice value", "USD 9,600"),
        ("Vessel / voyage", "MV PIONEER WAVE / PW-PVG-HAM-2026-V04"),
        ("Container", "OCEAN-2026-04-V552 (40HQ co-load)"),
    ],
    "sections": [
        ("1. Coverage scope", "body",
         "<b>Institute Cargo Clauses (B) 1/1/2009 — ICC(B).</b> The mid-tier 'named perils' clause: narrower than "
         "ICC(A) all-risks but wider than ICC(C). Covers loss or damage attributable to fire / explosion; vessel "
         "grounded, sunk or capsized; overturning or derailment of land conveyance; collision; discharge of cargo "
         "at port of distress; general average sacrifice; jettison; washing overboard; <b>entry of sea, lake or river "
         "water into vessel, container or place of storage</b>; total loss of any package lost overboard or dropped "
         "whilst loading or discharging."),
        ("2. Sum insured", "body",
         "<b>100% of master invoice value + 10% freight allowance = USD 10,560</b> (rounded). Allianz standard "
         "cost-plus-10%-freight basis."),
        ("3. Deductible", "body",
         "<b>5% of the claim amount</b>, no minimum. Applied as a percentage of each settled claim."),
        ("4. Extensions and exclusions", "body", [
            "<b>Theft, Pilferage and Non-Delivery (TPND) extension: NOT included.</b> Theft, pilferage and non-delivery "
            "losses are excluded. (Buyer chose to omit the TPND extension to keep the premium low; their rubber-gasket "
            "cargo is not theft-attractive.)",
            "<b>Specific exclusion:</b> ordinary leakage and ordinary wear and tear (standard ICC(B) exclusion).",
        ]),
        ("5. Notice of claim", "body",
         "Must be filed within 30 days of discharge. Within window."),
        ("6. Surveyor and settlement contact", "body",
         "Destination survey: Hanseatic Marine Survey (Hamburg). Claims: marine.claims.de@allianz.com quoting "
         "AL-DE-MAR-2026-008842."),
    ],
}


POLICY_MAHMOUD = {
    "filename": "mahmoud_sinosure_policy.pdf",
    "title": "Cargo Insurance Policy — Mahmoud Trading Co.",
    "insurer": "China Export &amp; Credit Insurance Corporation (Sinosure)",
    "insurer_addr": "Marine Cargo Division — Shanghai",
    "insurer_contact": "marine.cargo.claims@sinosure.com.cn  •  +86 21 5810 0900",
    "info_rows": [
        ("Policy number", "SC-EX-2026-IN-04419"),
        ("Policyholder", "Mahmoud Trading Co., Cairo, Egypt"),
        ("Trade Incoterm", "CIF Alexandria — seller-arranged cargo cover; coverage extends to final discharge"),
        ("Coverage period", "From on-board at Shanghai to discharge at Alexandria, including transhipment legs"),
        ("Subject matter insured", "15 cartons of cotton-linen blend garments"),
        ("Master invoice value", "USD 45,000"),
        ("Vessel / voyage", "MV PIONEER WAVE / PW-PVG-HAM-2026-V04 (co-load via Hamburg)"),
        ("Container", "OCEAN-2026-04-V552 (40HQ)"),
    ],
    "sections": [
        ("1. Coverage scope", "body",
         "<b>Institute Cargo Clauses (A) — ICC(A) all-risks basis</b>, subject to the special commodity exclusion in §5 below."),
        ("2. Sum insured", "body", "<b>110% of master invoice value = USD 49,500.</b>"),
        ("3. Deductible", "body",
         "<b>2% of the settled claim amount, with a USD 1,000 minimum deductible per claim event</b> (i.e., the "
         "deductible is the higher of 2% of claim or USD 1,000)."),
        ("4. TPND extension", "body", "TPND extension <b>included</b>."),
        ("5. SPECIAL COMMODITY EXCLUSION — Natural-Fibre Textile Moisture Damage (Clause SC-NFT-2024-Rev3)", "body", [
            "<b>Clause SC-NFT-2024-Rev3</b> (incorporated by reference into this policy on issuance):",
        ]),
        ("", "callout",
         "<i>Notwithstanding the all-risks coverage of ICC(A), moisture damage, water damage, condensation damage, "
         "mildew, mould and any related deterioration affecting natural-fibre textile cargo (including but not "
         "limited to cotton, linen, wool, silk, hemp, jute, and blends in which a natural fibre is the predominant "
         "component by mass) is <b>excluded from this policy</b> unless the assured establishes, via a survey report "
         "from an independent surveyor of standing acceptable to the insurer, that the moisture damage was caused "
         "by <b>gross negligence of the carrier or master</b>. The surveyor's report must specifically address and "
         "finding-of-fact establish gross negligence; a finding of 'ordinary water damage in transit' is <b>not</b> "
         "sufficient to override this exclusion.</i>"),
        ("Application to the present loss", "body",
         "The loss involves cotton-linen blend garments (natural-fibre predominant by mass) and the surveyor's "
         "finding-of-fact was 'ordinary water damage in transit' with explicit 'no gross negligence determined'. The "
         "exclusion's gross-negligence override condition is therefore not satisfied on the present record. This clause "
         "is a Sinosure standard rider attached to all natural-fibre textile cargo policies issued since 2024, following "
         "an industry-wide claims experience review. It <b>overrides</b> the general ICC(A) coverage as it applies to "
         "natural-fibre textiles."),
        ("6. Notice of claim", "body",
         "Must be filed within 14 days of discharge at the final destination port. Within window."),
        ("7. Surveyor and settlement contact", "body",
         "Lloyd's Register Marine Surveyors (Singapore), case #LR-SIN-2026-04-V552-A. "
         "Claims: marine.cargo.claims@sinosure.com.cn quoting SC-EX-2026-IN-04419."),
    ],
}


POLICY_OCEANTECH = {
    "filename": "oceantech_baoviet_policy.pdf",
    "title": "Cargo Insurance Policy — OceanTech Marine JSC",
    "insurer": "Bao Viet Insurance Corporation (BaoViet)",
    "insurer_addr": "Vietnam — Marine Division, Ho Chi Minh City",
    "insurer_contact": "marine.claims.vn@baoviet.com.vn  •  +84 28 3823 0011",
    "info_rows": [
        ("Policy number", "BV-MAR-2026-VN-117344"),
        ("Policyholder", "OceanTech Marine JSC, Ho Chi Minh City, Vietnam"),
        ("Trade Incoterm", "FOB Shanghai — buyer-arranged cargo cover"),
        ("Coverage period", "From on-board at Shanghai to discharge at Ho Chi Minh City (VNSGN), via Singapore transhipment"),
        ("Subject matter insured", "6 cartons of SS316 stainless-steel boat fittings"),
        ("Master invoice value", "USD 18,000"),
        ("Vessel / voyage", "MV PIONEER WAVE / PW-PVG-HAM-2026-V04 (routed via Hamburg)"),
        ("Container", "OCEAN-2026-04-V552 (40HQ co-load)"),
    ],
    "sections": [
        ("1. Coverage scope", "body", [
            "<b>Institute Cargo Clauses (C) 1/1/2009 — ICC(C).</b> The narrowest of the three ICC clauses. Covers only "
            "the following <b>named perils</b>: fire or explosion; vessel or craft being stranded, grounded, sunk or "
            "capsized; overturning or derailment of land conveyance; collision or contact of vessel/craft/conveyance "
            "with any external object other than water; discharge of cargo at port of distress; general average sacrifice; "
            "jettison.",
            "<b>NOT covered under ICC(C):</b> washing overboard; entry of sea, lake or river water into vessel, craft, "
            "hold, conveyance, container or place of storage; total loss of any package overboard; <b>ordinary water "
            "damage in transit</b>; theft; pilferage; non-delivery; ordinary leakage; wear and tear.",
        ]),
        ("2. Sum insured", "body", "<b>100% of master invoice value = USD 18,000.</b>"),
        ("3. Deductible and sub-limits", "body", [
            "<b>USD 750 absolute per claim event</b> — applied only if a named peril is the cause of loss.",
            "<b>Per-carton sub-limit: USD 200 maximum recovery per carton</b> — applied only if a named peril is the cause of loss.",
        ]),
        ("4. TPND extension", "body",
         "TPND extension <b>NOT included</b> — OceanTech declined the TPND extension at policy inception."),
        ("5. Notice of claim", "body",
         "Within 30 days of discharge at the cargo's first port of distress or final destination, whichever comes first."),
        ("6. Important — coverage analysis for the present loss", "callout",
         "The present loss is documented in the surveyor's report as 'ordinary water damage in transit' caused by a "
         "container door seal failure during a Force 8 squall, with the cause classified as "
         "<b>ordinary_water_damage_in_transit</b> and <b>no_gross_negligence_determined</b>. Ordinary water damage "
         "in transit is <b>not</b> within the named-perils list of ICC(C). It would have been covered under ICC(B) "
         "(which explicitly includes 'entry of sea, lake or river water into vessel...') or ICC(A) (all risks). "
         "OceanTech chose ICC(C) at policy inception to obtain a lower premium and accepted the narrower coverage. "
         "There is no allegation in the surveyor's report that the vessel was grounded, sunk, capsized, or in "
         "collision; nor was the cargo jettisoned or sacrificed in general average. <b>None of the ICC(C) named "
         "perils is engaged on the present record.</b>"),
        ("7. Surveyor and settlement contact", "body",
         "Lloyd's Register Marine Surveyors (Singapore), case #LR-SIN-2026-04-V552-A. "
         "Claims: marine.claims.vn@baoviet.com.vn quoting BV-MAR-2026-VN-117344."),
    ],
}


POLICY_VERDE = {
    "filename": "verde_mapfre_policy.pdf",
    "title": "Cargo Insurance Policy — Verde Importadora SpA",
    "insurer": "Mapfre Compañía de Seguros Chile S.A.",
    "insurer_addr": "Santiago — Marine Cargo Underwriting",
    "insurer_contact": "siniestros.maritimos@mapfre.cl  •  +56 2 2381 0000",
    "info_rows": [
        ("Policy number", "MF-CL-MAR-2026-09812"),
        ("Policyholder", "Verde Importadora SpA, Santiago, Chile"),
        ("Trade Incoterm", "CIF Valparaíso — seller-arranged cargo cover (fronted by Mapfre)"),
        ("Coverage period", "From on-board at Shanghai (CNSHA) to discharge at Valparaíso (CLVAP), via routing"),
        ("Subject matter insured", "9 cartons of LED garden path lights (12-pack each)"),
        ("Master invoice value", "USD 13,500"),
        ("Vessel / voyage", "MV PIONEER WAVE / PW-PVG-HAM-2026-V04 (routed via Hamburg per 'any reasonable routing' clause)"),
        ("Container", "OCEAN-2026-04-V552 (40HQ co-load)"),
    ],
    "sections": [
        ("1. Coverage scope", "body",
         "<b>Institute Cargo Clauses (A) 1/1/2009 — ICC(A) all risks.</b> No commodity exclusions."),
        ("2. Sum insured", "body", "<b>110% of master invoice value = USD 14,850.</b>"),
        ("3. Deductible — none (primer-comprador programme)", "body",
         "<b>No deductible applies.</b> Mapfre's 'primer-comprador' first-time-importer programme waives deductibles "
         "for the first three shipments under the policy as a customer-acquisition incentive; this is shipment number 2 "
         "under the programme."),
        ("4. TPND extension", "body", "TPND extension <b>included</b>."),
        ("5. SPECIAL CLAUSE — Per-event sub-limit USD 2,000 (Clause MF-SUB-2025-08)", "body",
         "<b>Clause MF-SUB-2025-08</b> (incorporated by reference):"),
        ("", "callout",
         "<i>Notwithstanding the sum insured stated above, the maximum total payable by the insurer in respect of any "
         "single insurable event — defined as any one occurrence or series of occurrences arising from a common cause "
         "— shall be limited to <b>USD 2,000 per event</b>. For the avoidance of doubt, multiple cartons damaged in the "
         "same insurable event (e.g. a single water-ingress occurrence affecting the same container) constitute one "
         "event and are subject to the aggregate USD 2,000 cap.</i>"),
        ("Application to the present loss", "body",
         "This per-event sub-limit was included as a trade-off against the waived deductible. The current loss — a single "
         "water-ingress event in the Malacca Strait affecting multiple cartons of Verde cargo — is <b>one insurable "
         "event</b> and is therefore subject to the USD 2,000 cap on aggregate payable."),
        ("6. Notice of claim", "body", "14 days from discharge at destination."),
        ("7. Surveyor and settlement contact", "body",
         "Lloyd's Register Marine Surveyors (Singapore), case #LR-SIN-2026-04-V552-A. "
         "Claims: siniestros.maritimos@mapfre.cl quoting MF-CL-MAR-2026-09812."),
    ],
}


def build_icc_clauses_pdf() -> None:
    path = FILES / "icc_clauses_reference.pdf"
    doc = _build_doc(path, "Institute Cargo Clauses — Reference Card")
    st = _styles()
    story: list = []
    story.append(Paragraph("Institute Cargo Clauses — Reference Card", st["title"]))
    story.append(Paragraph(
        "Synthetic internal-edition reference card prepared for the Commerce Agent Bench dataset. Substance summarises "
        "the London-market Institute Cargo Clauses (1/1/2009 revision). Not an official Lloyd's market or LMA "
        "publication; consult the official Joint Cargo Committee text for binding wording.",
        st["small"],
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("1. Quick reference", st["h2"]))
    qr_data = [
        ["Tier", "Common name", "Scope"],
        ["ICC(A)", "All risks", "Covers all risks of loss or damage to the subject matter insured, subject only to the specific exclusions stated in the clause itself. Broadest coverage."],
        ["ICC(B)", "Named perils — wide", "Covers loss or damage attributable to a defined list of perils (see §2). Mid-tier coverage."],
        ["ICC(C)", "Named perils — narrow", "Covers loss or damage attributable to a shorter list of major maritime catastrophes (see §3). Narrowest coverage."],
    ]
    t = Table(_wrap_table(qr_data, st), colWidths=[18 * mm, 36 * mm, 116 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)

    story.append(Paragraph("2. ICC(B) covered perils (named)", st["h2"]))
    story.append(Paragraph("Loss or damage to the subject matter insured reasonably attributable to:", st["body"]))
    for line in [
        "Fire or explosion",
        "Vessel or craft being stranded, grounded, sunk or capsized",
        "Overturning or derailment of land conveyance",
        "Collision or contact of vessel/craft/conveyance with any external object other than water",
        "Discharge of cargo at port of distress",
        "General average sacrifice",
        "Jettison",
        "<b>Washing overboard</b>",
        "<b>Entry of sea, lake or river water into vessel, craft, hold, conveyance, container or place of storage</b>",
        "Total loss of any package lost overboard or dropped whilst loading on to, or unloading from, vessel or craft",
    ]:
        story.append(Paragraph("&bull;&nbsp;&nbsp;" + line, st["body"]))

    story.append(Paragraph("3. ICC(C) covered perils (named — narrower than B)", st["h2"]))
    story.append(Paragraph("Loss or damage to the subject matter insured reasonably attributable to:", st["body"]))
    for line in [
        "Fire or explosion",
        "Vessel or craft being stranded, grounded, sunk or capsized",
        "Overturning or derailment of land conveyance",
        "Collision or contact of vessel/craft/conveyance with any external object other than water",
        "Discharge of cargo at port of distress",
        "General average sacrifice",
        "Jettison",
    ]:
        story.append(Paragraph("&bull;&nbsp;&nbsp;" + line, st["body"]))
    story.append(Paragraph(
        "<b>Note:</b> ICC(C) does <b>not</b> include 'washing overboard' or 'entry of water into vessel / container'. "
        "So an ordinary container-seal-failure water ingress in transit is <b>NOT</b> covered by ICC(C) (even though it "
        "is covered by ICC(B) and by ICC(A)). The vessel must be grounded / sunk / capsized, or the cargo jettisoned in "
        "general average, for ICC(C) to engage on a water-related loss.",
        st["callout"],
    ))

    story.append(Paragraph("4. Standard exclusions (apply to all three tiers unless explicitly extended)", st["h2"]))
    for line in [
        "Wilful misconduct of the assured",
        "Ordinary leakage / ordinary loss in weight / ordinary wear and tear",
        "Insufficiency of packing prepared by the assured",
        "Inherent vice or nature of the cargo",
        "Delay (even if proximately caused by a covered peril)",
        "Insolvency of carriers",
        "War (unless War Clauses extension)",
        "Strikes (unless Strikes Clauses extension)",
    ]:
        story.append(Paragraph("&bull;&nbsp;&nbsp;" + line, st["body"]))

    story.append(Paragraph("5. Theft, Pilferage and Non-Delivery (TPND)", st["h2"]))
    story.append(Paragraph(
        "TPND is an optional extension that may be added to any of A / B / C. Without the TPND extension, theft / "
        "pilferage / non-delivery of cargo is excluded even under ICC(A).",
        st["body"],
    ))

    story.append(Paragraph("6. Sum insured convention", st["h2"]))
    for line in [
        "'Cost + 10% freight' (= 110% of invoice): standard Chinese marine market convention, also accepted in many emerging-market policies.",
        "'Cost + 10%' (= 110% of invoice): the UCP 600 minimum for documentary credits.",
        "'Cost only' (= 100% of invoice): bare-bones option, leaves the insured without recovery of freight or other allowable charges.",
    ]:
        story.append(Paragraph("&bull;&nbsp;&nbsp;" + line, st["body"]))

    doc.build(story)


def build_surveyor_report_pdf() -> None:
    """Narrative surveyor report — companion to the structured damage_report.json.

    Generated FROM damage_report.json + shipments.csv so the per-carton table
    can never drift from the structured finding the verifier ground truth uses.
    The per-carton damage_pct remains authoritative in damage_report.json; this
    PDF is the human-readable surveyor narrative + the same finding rendered as
    a table.
    """
    import csv
    import json

    report = json.loads((FILES / "damage_report.json").read_text(encoding="utf-8"))
    cust_by_carton: dict[str, str] = {}
    with (FILES / "shipments.csv").open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            cust_by_carton[row["carton_id"]] = row["customer_id"]

    path = FILES / "surveyor_report.pdf"
    doc = _build_doc(path, "Marine Cargo Survey Report — Container OCEAN-2026-04-V552")
    st = _styles()
    story: list = []
    story.append(_header_table(
        "Lloyd's Register Marine Surveyors (Singapore)",
        "Independent Marine Cargo Survey — Case file #LR-SIN-2026-04-V552-A",
        "Re-survey at destination: Hanseatic Marine Survey (Hamburg)  •  surveyor of record: Mr. Karthikeyan",
        st,
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("MARINE CARGO DAMAGE SURVEY REPORT", st["hd"]))
    story.append(Spacer(1, 4))
    story.append(_info_box([
        ("Container", f"{report['container_id']} ({report['container_type']})"),
        ("Vessel / voyage", f"{report['vessel']} / {report['voyage']}"),
        ("Loading port", report["loading_port"]),
        ("Discharge port", report["discharge_port"]),
        ("Incident location", report["incident_location"]),
        ("Incident date", report["incident_date"]),
    ], st))

    story.append(Paragraph("1. Incident summary", st["h2"]))
    story.append(Paragraph(report["incident_summary"], st["body"]))

    story.append(Paragraph("2. Cause classification — finding of fact", st["h2"]))
    story.append(Paragraph(
        f"<b>Cause classification:</b> {report['cause_classification']}<br/>"
        f"<b>Carrier negligence finding:</b> {report['carrier_negligence_finding']}",
        st["callout"],
    ))
    story.append(Paragraph(
        "The proximate cause is recorded as ordinary water damage in transit arising from a container door-seal failure "
        "during heavy weather. On the evidence available the surveyors did <b>not</b> find gross negligence on the part "
        "of the carrier or master. This finding is a finding of fact for the present record; it does not by itself "
        "determine coverage, which is governed by each cargo owner's own policy wording.",
        st["body"],
    ))

    story.append(Paragraph("3. Damage-percentage methodology", st["h2"]))
    story.append(Paragraph(report["_doc"], st["body"]))

    story.append(Paragraph("4. Per-carton findings", st["h2"]))
    table_data = [["Carton", "Customer", "Damage %", "Surveyor note"]]
    for c in report["cartons"]:
        cid = c["carton_id"]
        table_data.append([
            cid,
            cust_by_carton.get(cid, "—"),
            f"{c['damage_pct'] * 100:.0f}%",
            c.get("notes", ""),
        ])
    t = Table(table_data, colWidths=[16 * mm, 24 * mm, 18 * mm, 112 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 7.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(t)

    story.append(Paragraph("5. Statement", st["h2"]))
    story.append(Paragraph(
        "The damage percentages above represent the surveyors' considered estimate of the proportion of each carton's "
        "contents affected by water ingress, after joint inspection at Singapore (transhipment) and re-inspection at "
        "Hamburg. Both surveys concur on the figures stated. This report is issued for the cargo interests and their "
        "insurers without prejudice.",
        st["body"],
    ))

    doc.build(story)


POLICIES = [POLICY_LINNEA, POLICY_JONAS, POLICY_MAHMOUD, POLICY_OCEANTECH, POLICY_VERDE]


def main() -> int:
    POLICIES_DIR.mkdir(parents=True, exist_ok=True)
    for spec in POLICIES:
        _build_policy(spec)
        print(f"wrote {POLICIES_DIR / spec['filename']}")
    build_icc_clauses_pdf()
    print(f"wrote {FILES / 'icc_clauses_reference.pdf'}")
    build_surveyor_report_pdf()
    print(f"wrote {FILES / 'surveyor_report.pdf'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
