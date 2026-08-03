#!/usr/bin/env python3
"""Deterministic data generator for cli-todoist-sourcing-schedule (CAPABILITY-COVERAGE edition).

Why this rebuild exists
-----------------------
Four earlier todoist rebuilds (back-scheduling arithmetic, prose-dependency triage,
multi-signal entity resolution, commonsense workstream classification + dedup) were
all ACED by gemini-3-flash-preview: each leaned on a gemini-STRONG judgement
(arithmetic / commonsense category / surface dedup), directly graded though they
were. The one axis we have proven gemini-WEAK *and* directly-graded-at-scale is
SCOPE / CAPABILITY COVERAGE: "does X's stated scope/capability COVER Y's
requirement?" — the exact discriminator that made box-supplier-docroom-audit
reliable (gemini 59/99 & 82/99). This rebuild ports box's coverage-judgment AXIS
into the todoist medium with a DIFFERENT scenario (vendor-capability triage, not a
compliance doc-room) and a DIFFERENT front-end (Todoist sections + a label, not Box
tasks/links).

The build — vendor-capability-coverage triage (directly graded)
---------------------------------------------------------------
NorthBridge has a backlog of ~20 component sourcing items in one Todoist project,
each card carrying a specific **manufacturing requirement** (process + material +
tolerance/spec + size) and a candidate **vendor** with a free-text **capability
statement** (certified processes, materials, size envelope, tolerances). The agent
judges, PER ITEM, whether the candidate vendor's capability COVERS the item's
requirement and routes it:

  COVERED      -> move the card to section `Ready to PO`         (no gap label)
  NOT COVERED  -> move the card to section `Re-source` + add label `capability-gap`

The routing (section + gap label per item) is the DIRECTLY-GRADED output — there is
no schedule, no dedup, no agent-written file. ~20 items x 2 checks. Mis-judge a
coverage call -> wrong section AND wrong gap label -> that item's two checks fail.
The gemini-weak coverage judgement IS the graded state, at scale (~20 independent
calls, >=half genuinely hard), so a structured-strong model reliably trips >=1.

The 2x2 (lexical overlap x true coverage) is fully populated so NO keyword rule
works (mirrors box's scope design):

  plain covered            capability plainly names the required process+material
   (covered, x7)           (high overlap, covered). Control: a lexical matcher gets
                           these RIGHT (so the gate is not "reject everything").
  broader-capability       capability names a BROADER family the requirement clearly
   (covered, x3)           falls within, with NO shared distinctive word (e.g. "all
                           common thermoplastics and thermoplastic elastomers" covers
                           "TPU"; "full protective-packaging supplier" covers a
                           printed carton + foam insert). Defeats keyword-overlap
                           (false NEGATIVE).
  sounds-covered-but-NOT   capability shares process/material words but a real gap:
   (not covered, x10)      wrong part form (extrusions vs a 3-D machined bracket),
                           wrong material/grade (aluminium vs zinc die-casting; GP
                           ABS vs FR UL94 V-0 ABS; mild steel vs stainless 301
                           spring), wrong class (Type II vs Type III anodise),
                           a tolerance too loose to hold, the part exceeding the
                           stated size envelope, or a missing process step (no
                           press-brake bending). Defeats keyword-overlap (false
                           POSITIVE) and a capability-ignored reader.

FAIRNESS / DETERMINISM
======================
Coverage cannot be re-derived by any mechanical rule (that is the whole point), so
each coverage judgement carries an AUTHORED ground-truth label (`covered`) plus the
decisive domain reasoning. The label is the source of truth; it is baked ONLY into
the private ground truth (this file -> expected_answer.json / gold_annotations.json)
and the fairness doc (scratch/scripts/todoist_fairness.json), NEVER into anything
the agent sees. The agent-visible surface carries only the neutral requirement text
and the neutral vendor capability statement; it must JUDGE coverage. Each call has a
UNIQUE defensible answer determinable by a careful reader from the requirement +
capability (process / material+grade / tolerance / size / class all stated);
confounders are genuinely resolvable, never ambiguous. The offline gold solver
reproduces expected_answer, the naive keyword-overlap and capability-ignored solvers
fail, and the single-slip probe proves each call independently load-bearing (see
scratch/scripts/todoist_gold_solver.py / todoist_naive_solvers.py /
todoist_single_slip.py).

Emits:
  workspace/vendor_triage_policy.md     agent-visible policy (RULES only, no answers)
  private/mock_runtime/todoist_seed.sql todoist_cli DB seed (project + Backlog +
                                        Ready to PO + Re-source sections + a
                                        capability-gap label + ~20 untriaged cards,
                                        each card's note = requirement + vendor
                                        capability; NO answers)
  private/expected_answer.json          ground truth (NEVER shipped to the container)
  private/gold_annotations.json         per-card coverage truth + confounder family +
                                        decisive reasoning (scratch solver use)
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASK = HERE.parent
WORKSPACE = TASK / "workspace"
MOCK_RUNTIME = HERE / "mock_runtime"

# --- Configuration constants (single source of truth for policy + seed) -----
PRODUCT = "Smart Desk Charging Station"
PROJECT_NAME = f"Sourcing: {PRODUCT}"
PROJECT_ID = "2200000050"
INBOX_ID = "2200000001"
AUTH_TOKEN = "mock-todoist-token-bench"
USER_EMAIL = "sourcing@northbridge.example.com"
TS = "2026-05-22T09:00:00Z"
SEED_PRIORITY_API = 1  # API 1 == display p4 == normal; priority is NOT scored.

# The holding pen every untriaged card starts in (NOT a routing target).
BACKLOG_SECTION = "Backlog (to triage)"
READY_SECTION = "Ready to PO"        # COVERED -> here
RESOURCE_SECTION = "Re-source"       # NOT COVERED -> here (+ gap label)
SECTIONS = [BACKLOG_SECTION, READY_SECTION, RESOURCE_SECTION]
SECTION_IDS = {name: f"24000000{idx + 1:02d}" for idx, name in enumerate(SECTIONS)}

GAP_LABEL = "capability-gap"          # added to every NOT-COVERED card
REASON_LABELS = [
    "process-gap",
    "material-gap",
    "tolerance-gap",
    "size-gap",
    "spec-gap",
]
LABELS = [GAP_LABEL] + REASON_LABELS
LABEL_IDS = {name: f"23000000{idx + 1:02d}" for idx, name in enumerate(LABELS)}


# --------------------------------------------------------------------------- #
# The sourcing roster (INTERNAL source of truth). Each row is ONE coverage call.
#
# Fields:
#   n           -> card id 25000000<NN>
#   component   -> the part (-> card title, with the vendor)
#   vendor      -> the candidate vendor (-> card title + note)
#   requirement -> the manufacturing requirement: process + material(+grade/form)
#                  + tolerance/spec + size (agent-visible, NEUTRAL, in the note)
#   capability  -> the vendor's free-text capability statement (agent-visible,
#                  NEUTRAL self-description, in the note)
#   covered     -> AUTHORED ground truth (does the capability cover the requirement?)
#   family      -> confounder family (documentation / fairness)
#   reasoning   -> the decisive domain reasoning (-> fairness, NOT shipped)
#   defeats     -> which surface heuristic this case defeats (-> fairness)
# `covered` is the load-bearing judgement; everything else on the card is neutral.
# --------------------------------------------------------------------------- #
def I(n, component, vendor, requirement, capability, covered, family,
      reasoning, defeats):
    return dict(n=n, component=component, vendor=vendor, requirement=requirement,
                capability=capability, covered=covered, family=family,
                reasoning=reasoning, defeats=defeats)


ITEMS = [
    # ============== PLAIN COVERED CONTROLS (high overlap, covered) =========== #
    I(1, "Aluminium mounting bracket", "Atlas Precision Machining",
      "CNC-machine the bracket from 6061-T6 aluminium to a tolerance of plus/minus 0.05 mm; "
      "the finished part is 120 mm long.",
      "We are a CNC machining shop for 6061 and 6063 aluminium, holding plus/minus 0.02 mm, "
      "on parts up to 400 mm.",
      True, "plain_covered",
      "Required process (CNC machining), material (6061 aluminium) and size (120 mm) are all "
      "within the vendor's stated capability, and the vendor's plus/minus 0.02 mm is tighter "
      "than the required plus/minus 0.05 mm. COVERED.",
      "Positive control; a lexical matcher also accepts (shares 'aluminium')."),
    I(2, "ABS top cover", "BrightMould Plastics",
      "Injection-mould the top cover in ABS to plus/minus 0.10 mm; the part footprint is "
      "180 x 120 mm.",
      "Injection moulding of ABS and PC enclosures to plus/minus 0.05 mm; mould base up to "
      "300 x 250 mm.",
      True, "plain_covered",
      "Process (injection moulding), material (ABS), tolerance (0.05 mm tighter than the "
      "required 0.10 mm) and size (180 x 120 within 300 x 250) are all within the stated "
      "capability. COVERED.",
      "Positive control; lexical matcher accepts (shares 'ABS')."),
    I(3, "Silicone non-slip base pad", "FlexiSil Moulding",
      "Mould the base pad in liquid silicone rubber (LSR), shore A40.",
      "Liquid silicone rubber (LSR) injection moulding for pads, gaskets and seals, shore "
      "A20 to A60.",
      True, "plain_covered",
      "The vendor injection-moulds LSR across shore A20-A60; the pad is LSR shore A40 — "
      "within the stated material and hardness range. COVERED.",
      "Positive control; lexical matcher accepts (shares 'silicone'/'LSR')."),
    I(4, "Zinc die-cast hinge body", "CastWorks Foundry",
      "Pressure die-cast the hinge body in zinc alloy (ZAMAK) to plus/minus 0.08 mm.",
      "High-pressure die-casting of zinc alloy (ZAMAK) parts to plus/minus 0.05 mm, up to "
      "200 g.",
      True, "plain_covered",
      "Process (zinc HPDC), material (ZAMAK) and tolerance (0.05 tighter than 0.08) all "
      "within the stated capability. COVERED.",
      "Positive control; lexical matcher accepts (shares 'zinc'/'ZAMAK')."),
    I(5, "Aluminium base plate (large)", "WideCut CNC",
      "CNC-mill the base plate from 6061 aluminium, 260 mm long, to plus/minus 0.05 mm.",
      "CNC milling of aluminium with a working envelope up to 500 x 400 mm and "
      "plus/minus 0.02 mm.",
      True, "plain_covered",
      "The 260 mm part sits inside the 500 x 400 mm envelope; aluminium milling at "
      "plus/minus 0.02 mm is tighter than required. A within-envelope part IS covered — "
      "the deliberate control for the size confounder. COVERED.",
      "Positive control (within-envelope); lexical matcher accepts (shares 'aluminium')."),
    I(6, "NorthBridge logo on the ABS cover", "MarkRight Decoration",
      "Pad-print a one-colour NorthBridge logo on the moulded ABS cover.",
      "Secondary decoration: pad-printing, silk-screen and laser marking on plastic parts.",
      True, "plain_covered",
      "The vendor explicitly offers pad-printing on plastics; the job is a one-colour "
      "pad-print on a plastic cover. COVERED.",
      "Positive control; lexical matcher accepts (shares 'pad'/'print')."),
    I(7, "Powder-coated steel base", "DuraCoat Finishing",
      "Powder-coat the steel base matte black (RAL 9005).",
      "Electrostatic powder coating in any RAL colour, plus wet spray; substrates: steel "
      "and aluminium.",
      True, "plain_covered",
      "Powder coating, on steel, in any RAL colour (so RAL 9005 included). COVERED.",
      "Positive control; lexical matcher accepts (shares 'powder'/'steel')."),

    # ========== BROADER-CAPABILITY COVERED (no shared word, covered) ========= #
    I(8, "Deburred machined zinc parts", "SurfacePro Finishing",
      "Tumble-deburr the machined zinc parts and break the sharp edges.",
      "Complete mass-finishing line for metal parts: barrelling, drag finishing and shot "
      "peening.",
      True, "broader_covered",
      "Tumble-deburring and edge-breaking ARE mass-finishing operations; barrelling is the "
      "tumbling family and drag finishing rounds edges, so the vendor's mass-finishing line "
      "covers the required deburring even though it names different machines. COVERED — with "
      "no shared distinctive word.",
      "Keyword-overlap (no shared word) wrongly rejects -> FALSE NEGATIVE."),
    I(9, "TPU corner bumper", "PolyAll Moulding",
      "Injection-mould the corner bumper in TPU.",
      "Plastics moulder running all common thermoplastics and thermoplastic elastomers.",
      True, "broader_covered",
      "TPU is a thermoplastic elastomer; the vendor moulds all common thermoplastics and "
      "thermoplastic elastomers, so TPU falls within the stated material family. COVERED — "
      "no shared distinctive word.",
      "Keyword-overlap wrongly rejects -> FALSE NEGATIVE."),
    I(10, "Retail carton and foam insert", "PackHaven Packaging",
      "Source the printed retail carton and the EPE foam insert.",
      "Full protective-packaging supplier for consumer electronics.",
      True, "broader_covered",
      "A printed retail carton and a foam insert are protective packaging for an electronics "
      "product; a full protective-packaging supplier covers them. COVERED — no shared "
      "distinctive word.",
      "Keyword-overlap wrongly rejects -> FALSE NEGATIVE."),

    # ====== SOUNDS-COVERED-BUT-NOT (shared words, real gap, NOT covered) ===== #
    I(11, "Precision aluminium bracket", "ExtrudaLite Aluminium",
      "CNC-machine the bracket from 6061-T6 aluminium to plus/minus 0.02 mm.",
      "CNC machining of aluminium extrusions and profiles to plus/minus 0.1 mm, lengths up "
      "to 1.5 m.",
      False, "sounds_not_form_tol",
      "The vendor machines aluminium EXTRUSIONS and profiles (constant-section stock) and "
      "holds only plus/minus 0.1 mm; the bracket is a 3-D machined part needing plus/minus "
      "0.02 mm. Different part form AND a tolerance five times looser than required. NOT "
      "COVERED, despite sharing 'CNC'/'aluminium'.",
      "Keyword-overlap (shares 'CNC'/'aluminium') wrongly accepts -> FALSE POSITIVE."),
    I(12, "Polycarbonate optical light guide", "MouldenABS Plastics",
      "Injection-mould the light guide in optical-grade polycarbonate (PC).",
      "Injection moulding of ABS and PP housings.",
      False, "material_gap",
      "The vendor moulds ABS and PP only; the part needs optical-grade polycarbonate (PC), a "
      "different material the vendor does not list. NOT COVERED.",
      "Capability-ignored accepts; keyword-overlap has no shared material word and rejects."),
    I(13, "Zinc die-cast hinge bracket", "AluCast HPDC",
      "Pressure die-cast the hinge bracket in zinc alloy.",
      "Aluminium-alloy pressure die-casting (HPDC) for heat sinks and housings.",
      False, "material_gap_sounds",
      "The vendor pressure die-casts ALUMINIUM alloy; the part is ZINC alloy die-casting. "
      "Same broad process name, different metal — aluminium and zinc HPDC are distinct alloy "
      "processes with different tooling and machines. NOT COVERED, despite sharing 'alloy'.",
      "Keyword-overlap (shares 'alloy') wrongly accepts -> FALSE POSITIVE."),
    I(14, "Hard-anodised brackets", "AnoColor Anodising",
      "Anodise the brackets Type III (hard-coat), 50 micron.",
      "Type II decorative anodising and colour dyeing.",
      False, "class_gap",
      "The vendor offers Type II (thin decorative) anodising; the part needs Type III "
      "hard-coat (a thick wear coating run on different chemistry and rectifiers). Type II "
      "does not cover Type III. NOT COVERED, despite sharing 'Type'/'anodising'.",
      "Keyword-overlap (shares 'Type'/'anodising') wrongly accepts -> FALSE POSITIVE."),
    I(15, "Stainless spring contact", "StampLine Pressworks",
      "Stamp the spring contact from 0.3 mm stainless 301 spring steel.",
      "Progressive-die metal stamping of cold-rolled mild steel up to 2 mm.",
      False, "grade_gap",
      "The vendor stamps mild steel; the contact needs stainless 301 in spring temper — a "
      "different steel grade whose work-hardening and springback the vendor does not list. "
      "NOT COVERED, despite sharing 'stamping'/'steel'.",
      "Keyword-overlap (shares 'steel') wrongly accepts -> FALSE POSITIVE."),
    I(16, "Aluminium heat sink (long)", "MicroMill CNC",
      "CNC-mill the aluminium heat sink, 220 mm long, fins 1.0 mm thick.",
      "CNC milling of aluminium, maximum part envelope 150 x 150 x 80 mm.",
      False, "size_gap",
      "The part is 220 mm long; the vendor's working envelope tops out at 150 mm. The part "
      "exceeds the stated size envelope, so it cannot be made on the vendor's machines. NOT "
      "COVERED, despite sharing 'CNC'/'aluminium'.",
      "Keyword-overlap (shares 'CNC'/'aluminium') wrongly accepts -> FALSE POSITIVE."),
    I(17, "Precision silicone seal", "CompMould Rubber",
      "Mould the seal in liquid silicone rubber (LSR) to plus/minus 0.05 mm.",
      "Compression moulding of HCR (solid) silicone rubber to plus/minus 0.20 mm.",
      False, "sounds_not_form_tol",
      "The vendor compression-moulds HCR (solid-gum) silicone at plus/minus 0.20 mm; the "
      "seal needs LSR (liquid) injection at plus/minus 0.05 mm — a different silicone "
      "form/process and a tolerance four times tighter than the vendor holds. NOT COVERED, "
      "despite sharing 'silicone'.",
      "Keyword-overlap (shares 'silicone') wrongly accepts -> FALSE POSITIVE."),
    I(18, "Aluminium T-slot rail", "CastMach Aluminium",
      "Extrude the aluminium T-slot rail, 1.2 m long.",
      "Aluminium high-pressure die-casting and CNC machining.",
      False, "near_miss_process",
      "A 1.2 m constant-section T-slot rail is an EXTRUSION; the vendor offers die-casting "
      "(net-shape casting) and machining (subtractive) but no extrusion line, so it cannot "
      "make a metres-long profile. The required process is outside the vendor's processes. "
      "NOT COVERED, despite sharing 'aluminium'.",
      "Keyword-overlap (shares 'aluminium') wrongly accepts -> FALSE POSITIVE."),
    I(19, "Flame-retardant enclosure", "StdPlast Injection",
      "Mould the enclosure in flame-retardant ABS (UL94 V-0).",
      "Injection moulding of general-purpose ABS and HIPS.",
      False, "grade_gap",
      "The vendor moulds general-purpose (non-FR) ABS; the enclosure needs flame-retardant "
      "UL94 V-0 ABS, a different resin grade that general-purpose ABS does not meet. NOT "
      "COVERED, despite sharing 'ABS'.",
      "Keyword-overlap (shares 'ABS') wrongly accepts -> FALSE POSITIVE."),
    I(20, "Mild-steel chassis (formed)", "FlatCut Sheet Metal",
      "Laser-cut and press-brake bend the 1.5 mm mild-steel chassis.",
      "Sheet-metal laser cutting and CNC punching of mild steel and aluminium up to 3 mm.",
      False, "near_miss_process",
      "The chassis needs laser cutting AND press-brake bending (forming); the vendor cuts "
      "and punches flat sheet but lists no bending/forming press, so it cannot deliver the "
      "formed chassis. The forming step is outside the vendor's processes. NOT COVERED, "
      "despite sharing 'laser'/'mild'/'steel'.",
      "Keyword-overlap (shares 'laser'/'steel') wrongly accepts -> FALSE POSITIVE."),
    I(21, "C360 brass threaded spacer", "YellowMetal Turnings",
      "CNC-turn the 18 mm standoff from C360 brass with an M3 internal thread.",
      "Swiss turning of yellow-metal electrical hardware and miniature fasteners.",
      True, "broader_covered",
      "C360 brass is a yellow metal, and a threaded spacer is miniature electrical hardware / "
      "fastener work. The stated Swiss-turning capability covers the part. COVERED.",
      "Keyword-overlap wrongly rejects because the capability uses the yellow-metal family name."),
    I(22, "Ceramic-coated aluminium face trim", "MicroArc Finishers",
      "Apply a plasma-electrolytic-oxidation ceramic coating to the aluminium face trim.",
      "Micro-arc oxidation finishing for lightweight metal consumer parts.",
      True, "synonym_covered",
      "Plasma electrolytic oxidation and micro-arc oxidation are the same coating family, "
      "and aluminium is a lightweight metal. COVERED.",
      "Synonym handling required: PEO vs micro-arc oxidation."),
    I(23, "Phosphor-bronze battery spring clip", "CopperFlex Stampings",
      "Stamp the spring clip from 0.20 mm phosphor bronze and nickel-plate it.",
      "Progressive stamping of beryllium copper and nickel-silver contact parts with tin plating.",
      False, "material_gap",
      "The required alloy is phosphor bronze with nickel plating; the vendor lists different "
      "copper alloys and tin plating. NOT COVERED.",
      "Same broad copper-contact domain but material/plating differ."),
    I(24, "304 stainless cable tray weldment", "SpotSteel Fabrication",
      "Laser-weld the folded cable tray in 304 stainless steel.",
      "Resistance spot welding of mild-steel brackets and clips.",
      False, "process_material_gap",
      "Laser welding and resistance spot welding are different joining processes, and 304 "
      "stainless is not mild steel. NOT COVERED.",
      "Shared welding/steel wording hides both a process and material gap."),
    I(25, "Moulded-pulp protective tray", "EcoTransit Packaging",
      "Produce a moulded-pulp tray that passes ISTA 2A parcel drop testing.",
      "Transport-packaging design for electronics, including fibre cushions and ISTA validation.",
      True, "broader_covered",
      "A moulded-pulp tray is a fibre cushion, and ISTA validation covers the drop-test "
      "requirement. COVERED.",
      "Keyword-overlap may miss the fibre/moulded-pulp category relation."),
    I(26, "Two-shot PC and TPU button", "ClearOne Moulding",
      "Two-shot mould the button with a clear PC window and a TPU grip overmould.",
      "Single-shot injection moulding of clear PC display windows.",
      False, "process_material_gap",
      "The vendor offers only single-shot PC moulding; the part needs two-shot moulding plus "
      "a TPU overmould. NOT COVERED.",
      "PC wording overlaps, but process and second material are absent."),
    I(27, "Heat-staked brass inserts", "InsertPro Assembly",
      "Heat-stake M2 brass threaded inserts into ABS bosses.",
      "Thermal insertion and ultrasonic staking of threaded inserts into thermoplastic housings.",
      True, "broader_covered",
      "ABS is a thermoplastic housing material, and heat staking is a thermal insertion "
      "method for threaded inserts. COVERED.",
      "Broader process/material family covers the requirement."),
    I(28, "Zinc-nickel plated spring clip", "BrightZinc Plating",
      "Plate the steel spring clip with zinc-nickel alloy to Class 2A, 8 micron.",
      "Decorative bright zinc plating on steel hardware.",
      False, "spec_gap",
      "Bright zinc plating is not zinc-nickel alloy plating to the specified Class 2A "
      "coating. NOT COVERED.",
      "Shared zinc/plating wording hides the coating-class gap."),
    I(29, "Graphite heat-spreader laminate", "ThermalConvert Ltd.",
      "Die-cut a graphite heat-spreader sheet laminated with pressure-sensitive adhesive.",
      "Converting of thermal interface materials, graphite films and adhesive laminates.",
      True, "plain_covered",
      "The vendor converts graphite thermal films and adhesive laminates, exactly the "
      "heat-spreader laminate. COVERED.",
      "Positive control."),
    I(30, "Polyimide FPC jumper", "RigidBoard PCB",
      "Build a polyimide flexible printed circuit with 0.075 mm trace and space.",
      "Rigid FR-4 PCB fabrication with 0.15 mm trace and space.",
      False, "material_tolerance_gap",
      "Polyimide FPC and rigid FR-4 PCB are different constructions, and 0.15 mm capability "
      "is looser than the required 0.075 mm trace/space. NOT COVERED.",
      "PCB wording overlaps while material/form and tolerance differ."),
    I(31, "Serialized QR laser mark", "TraceMark Laser",
      "Laser-etch serialized QR codes on anodized aluminium trim.",
      "Fiber and UV laser marking on metals and plastics, including QR serialization.",
      True, "plain_covered",
      "The vendor offers laser marking on metals with QR serialization; anodized aluminium "
      "trim is a metal part. COVERED.",
      "Positive control."),
    I(32, "Optical PC light-pipe polishing", "HousingMould Standard",
      "Injection-mould the clear optical-grade PC light pipe and diamond-polish the gate face.",
      "Injection moulding of opaque ABS and PP housings with standard tumble finishing.",
      False, "material_spec_process_gap",
      "The material is opaque ABS/PP rather than optical PC, and tumble finishing is not "
      "diamond polishing for an optical face. NOT COVERED.",
      "Injection-moulding wording overlaps but material, spec and finishing process differ."),
    I(33, "E-marker USB-C cable assembly", "CrimpWire Harness",
      "Assemble a USB-C cable with an e-marker PCB and 5 A rating.",
      "Crimped wire harnesses and barrel-plug cable assemblies.",
      False, "process_spec_gap",
      "The requirement is a USB-C assembly with e-marker electronics and 5 A rating; generic "
      "crimped harness/barrel-plug assembly does not state that electronics/spec capability. "
      "NOT COVERED.",
      "Cable wording overlaps while the electronics/spec capability is absent."),
    I(34, "17-4PH stainless MIM latch pawl", "MicroMIM Components",
      "Metal-injection-mould the latch pawl in 17-4PH stainless steel; finished mass 4 g.",
      "Metal injection moulding of 17-4PH stainless precision parts from 0.5 g to 20 g.",
      True, "plain_covered",
      "MIM process, 17-4PH stainless material and 4 g mass all sit inside the stated "
      "capability. COVERED.",
      "Positive control."),
    I(35, "17-4PH stainless latch casting", "FineCast Foundry",
      "Metal-injection-mould the latch pawl in 17-4PH stainless steel; finished mass 4 g.",
      "Investment casting of stainless hardware, minimum casting weight 50 g.",
      False, "process_size_gap",
      "Investment casting is not metal injection moulding, and the vendor's minimum casting "
      "weight is far above the 4 g part. NOT COVERED.",
      "Stainless hardware wording overlaps while process and size limits fail."),
    I(36, "Conductive fabric EMI gasket", "FoamDie Converting",
      "Die-cut nickel-plated conductive-fabric-over-foam EMI gaskets.",
      "Die cutting of silicone foam pads and neoprene rubber seals.",
      False, "material_spec_gap",
      "Silicone/neoprene foam pads are not nickel-plated conductive fabric over foam for EMI "
      "gaskets. NOT COVERED.",
      "Foam/die-cut wording overlaps but material and EMI spec differ."),
]
BY_N = {it["n"]: it for it in ITEMS}

GAP_REASON_BY_N = {
    11: ["tolerance-gap"],
    12: ["material-gap"],
    13: ["material-gap"],
    14: ["spec-gap"],
    15: ["material-gap"],
    16: ["size-gap"],
    17: ["process-gap", "material-gap", "tolerance-gap"],
    18: ["process-gap"],
    19: ["material-gap", "spec-gap"],
    20: ["process-gap"],
    23: ["material-gap"],
    24: ["process-gap", "material-gap"],
    26: ["process-gap", "material-gap"],
    28: ["material-gap", "spec-gap"],
    30: ["process-gap", "material-gap", "tolerance-gap"],
    32: ["process-gap", "material-gap", "spec-gap"],
    33: ["process-gap", "spec-gap"],
    35: ["process-gap", "size-gap"],
    36: ["material-gap", "spec-gap"],
}


def expected_labels(it):
    if it["covered"]:
        return []
    return [GAP_LABEL] + GAP_REASON_BY_N[it["n"]]

# Seed/list order: interleave covered + not-covered so neither "first half" nor a
# run pattern gives the answer away.
SEED_ORDER = [11, 1, 16, 8, 12, 2, 18, 9, 14, 5,
              20, 3, 13, 10, 17, 6, 19, 4, 15, 7,
              24, 21, 30, 22, 23, 25, 26, 27,
              28, 29, 32, 31, 33, 34, 35, 36]

# Card titles + notes (the agent-visible surface). The note carries the neutral
# requirement and the neutral vendor capability statement; the agent must JUDGE
# coverage. Nothing here states a verdict.
def card_title(it):
    return f"{it['component']} — candidate vendor: {it['vendor']}"


def card_note(it):
    return (f"Requirement: {it['requirement']}\n\n"
            f"Vendor capability statement (from {it['vendor']}): {it['capability']}")


# --------------------------------------------------------------------------- #
# Naive keyword model (for the build-time trap proof + the offline naive solver).
# A faithful "best-effort lexical matcher": it judges coverage by whether the
# vendor capability shares >=1 salient (material / specific-process / form) word
# with the requirement. STOP holds grammatical glue + the GENERIC manufacturing
# verbs/nouns that appear across many lines (machine/mill/mould/cast/cut/source/
# part/finishing/...). Material names, specific forms and specific processes are
# KEPT — that is what a surface reader keys on, so a card whose words match but
# whose form/grade/tolerance/size/process does NOT is a genuine lexical trap.
# Tokens are letters-only (digits dropped), so numeric tolerances/sizes never
# create lexical overlap — exactly why a word-matcher misses a tolerance gap.
# --------------------------------------------------------------------------- #
STOP = {
    # grammatical glue
    "the", "of", "and", "for", "to", "a", "an", "in", "on", "with", "or", "up",
    "by", "we", "are", "is", "our", "from", "as", "at", "it", "its", "all",
    "any", "plus", "minus", "mm", "micron", "g", "long", "thick", "footprint",
    "lengths", "length", "working", "maximum", "base", "matte", "black", "one",
    "colour", "color", "finished", "moulded", "shore",
    # generic manufacturing verbs / processes (ubiquitous glue, not salient)
    "machine", "machining", "machined", "mill", "milling", "milled", "mould",
    "moulding", "moulded", "moulder", "mold", "molding", "injection", "cast",
    "casting", "cut", "cutting", "source", "stamp", "stamping", "anodise",
    "anodised", "anodize", "coat", "coating", "print", "printing", "marking",
    "moulds", "running", "complete", "full", "secondary", "decoration",
    "progressive", "die", "electrostatic", "pressure", "high",
    # generic nouns (parts / packaging-of-work, not salient)
    "part", "parts", "piece", "pieces", "component", "components", "shop",
    "line", "service", "services", "supplier", "substrates", "envelope",
    "tolerance", "holding", "holds", "job", "set", "sets", "body", "bracket",
    "brackets", "cover", "plate", "hinge", "seal", "rail",
    "chassis", "contact", "guide", "sink", "heat", "sinks", "housings",
    "housing", "enclosure", "enclosures", "gaskets", "seals", "logo", "parts",
    "consumer", "electronics", "metal", "sheet", "grade", "gum",
}


def distinctive(text):
    toks = re.findall(r"[a-z]+", (text or "").lower())
    return {t for t in toks if t not in STOP and len(t) > 1}


def keyword_covers(requirement, capability):
    """Naive lexical reader: covered iff capability shares a salient word with req."""
    return bool(distinctive(requirement) & distinctive(capability))


# --------------------------------------------------------------------------- #
# SQL seed emission (untriaged draft: every card in Backlog, no labels — nothing
# leaks the answer).
# --------------------------------------------------------------------------- #
def sql_str(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def build_seed_sql():
    order_of = {n: i for i, n in enumerate(SEED_ORDER)}
    L = ["-- cli-todoist-sourcing-schedule seed (generated by private/generate_data.py -- do not edit by hand)",
         "-- The procurement backlog as a teammate dumped it into Todoist: every card sits UNTRIAGED",
         "-- in the Backlog section with NO routing and NO label. Each card's note carries a",
         "-- manufacturing REQUIREMENT and a candidate VENDOR's free-text CAPABILITY statement; the",
         "-- agent judges whether the capability covers the requirement and routes the card",
         "-- (Ready to PO, or Re-source + a capability-gap label). Self-wiping => idempotent whether",
         "-- the DB was fresh or pre-seeded. Delete order is child -> parent (FK-safe)."]
    for t in ["audit_log", "items", "sections", "filters", "labels", "auth_session", "projects"]:
        L.append(f"DELETE FROM {t};")
    L.append("")
    L.append("INSERT INTO auth_session (token, user_email, karma, created_at) VALUES")
    L.append(f"  ({sql_str(AUTH_TOKEN)}, {sql_str(USER_EMAIL)}, 245, {sql_str(TS)});")
    L.append("")
    L.append("INSERT INTO projects (id, name, color, item_order, is_archived, is_deleted, created_at) VALUES")
    L.append(f"  ({sql_str(INBOX_ID)}, 'Inbox', '48', 0, 0, 0, {sql_str(TS)}),")
    L.append(f"  ({sql_str(PROJECT_ID)}, {sql_str(PROJECT_NAME)}, '31', 1, 0, 0, {sql_str(TS)});")
    L.append("")
    L.append("INSERT INTO labels (id, name, color, item_order, is_deleted) VALUES")
    lab_rows = [f"  ({sql_str(LABEL_IDS[name])}, {sql_str(name)}, '30', {i}, 0)"
                for i, name in enumerate(LABELS)]
    L.append(",\n".join(lab_rows) + ";")
    L.append("")
    L.append("INSERT INTO sections (id, name, project_id, section_order, is_archived, is_deleted) VALUES")
    sec_rows = [f"  ({sql_str(SECTION_IDS[name])}, {sql_str(name)}, {sql_str(PROJECT_ID)}, {idx}, 0, 0)"
                for idx, name in enumerate(SECTIONS)]
    L.append(",\n".join(sec_rows) + ";")
    L.append("")
    L.append("INSERT INTO items (id, content, description, project_id, section_id, priority, "
             "due_date, due_string, deadline_date, labels_json, is_completed, is_deleted, "
             "item_order, created_at, updated_at) VALUES")
    rows = []
    for it in sorted(ITEMS, key=lambda x: order_of[x["n"]]):
        rows.append(
            f"  ({sql_str('25000000' + str(it['n']).zfill(2))}, {sql_str(card_title(it))}, "
            f"{sql_str(card_note(it))}, {sql_str(PROJECT_ID)}, {sql_str(SECTION_IDS[BACKLOG_SECTION])}, "
            f"{SEED_PRIORITY_API}, '', '', '', '[]', 0, 0, {order_of[it['n']]}, "
            f"{sql_str(TS)}, {sql_str(TS)})")
    L.append(",\n".join(rows) + ";")
    L.append("")
    return "\n".join(L) + "\n"


# --------------------------------------------------------------------------- #
# Workspace policy (rules ONLY — what "covers" means + the routing; NO answers).
# --------------------------------------------------------------------------- #
def write_policy():
    md = f"""# NorthBridge Accessories — Vendor-Capability Sourcing Triage Policy

NorthBridge Accessories is sourcing components for a new **{PRODUCT}**. The whole
component backlog lives in one Todoist project, **`{PROJECT_NAME}`**. A teammate
dumped every open sourcing line into the project's **`{BACKLOG_SECTION}`** section
without triaging it. Your job is to decide, for **every card currently in
`{BACKLOG_SECTION}`**, whether the **candidate vendor** on that card can actually
make the part to the stated **requirement**, and to route the card accordingly.

Each card has a short **title** (the component + the candidate vendor) and a **note**
(`todoist show <id>` shows it) containing two things:

- a **Requirement** — the manufacturing requirement for that component: the
  **process**, the **material** (and its grade/form), the **tolerance** or spec, and
  the **size**; and
- the candidate **Vendor capability statement** — the vendor's own description of
  what they do: their **processes**, the **materials** they run, their **size
  envelope** and the **tolerances** they hold.

## 1. The judgement: does the capability COVER the requirement?

A candidate vendor's capability **covers** a requirement only if **all** of the
following hold, read from the two texts on the card:

1. **Process** — the required manufacturing process is among the vendor's stated
   processes. A *different* process does **not** cover it, even if the material is
   the same.
2. **Material (and grade/form)** — the required material, in the required grade and
   form, is among the materials the vendor runs. A *different* material, grade or
   form does **not** cover it, even if the process is the same.
3. **Tolerance** — the vendor's stated tolerance is **at least as tight** as the
   requirement. A looser stated tolerance does **not** cover a tighter requirement.
4. **Size** — the part fits **within** the vendor's stated size envelope. A part
   that exceeds the envelope is **not** covered.
5. **Class / spec** — the required class or spec is within what the vendor states.

A capability written in **broader terms** **covers** the requirement when the
required process and material clearly fall **within** that broader family — even
with **no shared wording**.

**Judge by whether the stated capability actually covers the stated requirement —
not by whether the two texts share words.** Two statements can share process or
material words yet **not** cover (a different form, grade, tolerance, size or
missing step); and a capability can cover with **no** shared words (a broader
family that includes the requirement). When in doubt, reason it through from the
process, material/grade, tolerance, size and class stated on the card.

## 2. Routing (the deliverable)

For every card currently in `{BACKLOG_SECTION}`:

- **COVERED** — the candidate vendor's capability covers the requirement → move the
  card to the **`{READY_SECTION}`** section. Do **not** add any label.
  ```
  todoist modify <id> --section-name "{READY_SECTION}"
  ```
- **NOT COVERED** — there is a capability gap → move the card to the
  **`{RESOURCE_SECTION}`** section **and** add labels for the gap:
  - always include **`{GAP_LABEL}`**; and
  - also include every reason label that applies:
    **`process-gap`**, **`material-gap`**, **`tolerance-gap`**, **`size-gap`**,
    and/or **`spec-gap`**.
  ```
  todoist modify <id> --section-name "{RESOURCE_SECTION}" --label-names {GAP_LABEL},process-gap
  ```

Reason-label taxonomy:

- `process-gap` — the vendor does not state the required production process,
  joining/finishing step, or part-form route.
- `material-gap` — the vendor does not state the required material, alloy, resin,
  substrate, plating/coating chemistry, or construction family.
- `tolerance-gap` — the vendor states a looser dimensional tolerance or trace/space
  capability than the requirement.
- `size-gap` — the part is outside the vendor's stated size, mass, or machine envelope.
- `spec-gap` — the vendor does not state a required formal class, safety rating,
  functional rating, certification, or performance standard.

Notes on the commands:

- Section names with a space or hyphen (e.g. `{READY_SECTION}`, `{RESOURCE_SECTION}`)
  must stay inside the quotes, exactly as written above.
- `--label-names` **replaces** a card's labels; pass comma-separated label names
  without leading `@`. Covered cards should have no labels. Not-covered cards
  should carry `{GAP_LABEL}` plus all applicable reason labels and no extras.
- Leave nothing in `{BACKLOG_SECTION}`; do not close or delete any card.

## 3. Recording

All of your work is recorded directly in Todoist — each card's section and, where
there is a capability gap, its `{GAP_LABEL}` label. There is no separate report
file to write.
"""
    (WORKSPACE / "vendor_triage_policy.md").write_text(md, encoding="utf-8")


# --------------------------------------------------------------------------- #
# Anti-leak word lists (scanned over every agent-visible card title/note).
# Process/material/spec NOUNS are DELIBERATELY present (they are the inputs to the
# judgement). What must never appear is a card naming its OWN verdict: a coverage
# word, the gap-label / section names, or a trap-mechanism word.
# --------------------------------------------------------------------------- #
LEAK_VERDICT_WORDS = [
    "covered", "covers", "coverage", "uncovered", "capability-gap",
    "within-scope", "within scope", "out-of-scope", "out of scope", "in-scope",
    "mismatch", "suitable", "unsuitable", "qualified", "unqualified",
    "disqualified", "insufficient", "inadequate", "deficient", "shortfall",
    "cannot", "can't", "unable", "doesn't cover", "does not cover", "no gap",
]
LEAK_ROUTING_WORDS = [READY_SECTION.lower(), RESOURCE_SECTION.lower(),
                      "re-source", "ready-to-po", GAP_LABEL.lower(),
                      "move to", "route to", "file under"]
LEAK_TRAP_WORDS = [
    "confounder", "false-friend", "false friend", "sounds-related",
    "near-miss", "decoy", "trap", "broader category", "broader-category",
    "lexical", "keyword",
]


def has_phrase(text, phrase):
    if phrase.endswith(" ") or phrase.endswith("#") or phrase.endswith(":") or " " in phrase or "-" in phrase:
        return phrase.lower() in text.lower()
    return re.search(rf"(?<![a-z]){re.escape(phrase.lower())}(?![a-z])", text.lower()) is not None


def leak_scan():
    problems = []
    bans = LEAK_VERDICT_WORDS + LEAK_ROUTING_WORDS + LEAK_TRAP_WORDS
    for it in ITEMS:
        for field, text in (("title", card_title(it)), ("note", card_note(it))):
            for w in bans:
                if has_phrase(text, w):
                    problems.append((it["n"], field, w))
    return problems


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    # (0) structural sanity ---------------------------------------------------
    assert len(ITEMS) == 36, f"expected 36 cards, got {len(ITEMS)}"
    assert len(SEED_ORDER) == len(ITEMS) and set(SEED_ORDER) == {it["n"] for it in ITEMS}
    titles = [card_title(it) for it in ITEMS]
    assert len(set(map(str.casefold, titles))) == len(ITEMS), "card titles must be unique"
    n_cov = sum(1 for it in ITEMS if it["covered"])
    n_notcov = len(ITEMS) - n_cov
    assert n_cov >= 6 and n_notcov >= 8, f"coverage balance off (covered={n_cov}, not={n_notcov})"
    for it in ITEMS:
        labels = expected_labels(it)
        if it["covered"]:
            assert labels == [], f"covered card {it['n']} must not have expected labels"
        else:
            assert labels[0] == GAP_LABEL and len(labels) >= 2, (
                f"not-covered card {it['n']} must have capability-gap plus reason labels")
            assert len(set(labels)) == len(labels), f"duplicate expected labels on card {it['n']}: {labels}"
            assert all(x in LABELS for x in labels), f"unknown expected labels on card {it['n']}: {labels}"

    # (1) anti-leak: no card names its own verdict / routing / trap ------------
    leaks = leak_scan()
    assert not leaks, f"answer-word leak(s) in agent-visible card text: {leaks}"

    # (2) keyword-trap proof. A faithful lexical matcher (covered iff capability
    #     shares a salient word with the requirement) must be WRONG on enough
    #     scored items that keyword matching cannot pass the binary, and RIGHT on
    #     every plain-covered control (so the gate is not "reject everything").
    kw_wrong, false_pos, false_neg = [], [], []
    for it in ITEMS:
        guess = keyword_covers(it["requirement"], it["capability"])
        it["_kw_guess"] = guess
        if guess != it["covered"]:
            kw_wrong.append(it["n"])
            # every keyword-wrong item must be a documented confounder.
            assert it["family"] != "plain_covered", (
                f"card {it['n']} ({it['component']}): keyword reader wrong on a "
                f"plain control (guess={guess}, covered={it['covered']})")
            (false_neg if it["covered"] else false_pos).append(it["n"])
        else:
            if it["family"] == "plain_covered":
                pass  # control, correctly keyworded — fine
    # plain controls are all keyword-RIGHT (proven via the assert above + this).
    for it in ITEMS:
        if it["family"] == "plain_covered":
            assert it["_kw_guess"] == it["covered"] is True, (
                f"plain control {it['n']} must be keyword-covered")
    assert len(false_pos) >= 6, f"need >=6 keyword FALSE-POSITIVES, got {false_pos}"
    assert len(false_neg) >= 3, f"need >=3 keyword FALSE-NEGATIVES (broader), got {false_neg}"
    # broader/synonym covered cases should provide some false negatives; exact
    # cardinality is not locked because the lexical probe is only a sanity check,
    # not the task oracle.
    broader = [it["n"] for it in ITEMS if it["family"] == "broader_covered"]
    assert set(false_neg).issubset(set(broader)), f"unexpected false-negatives {false_neg} outside broader set {broader}"
    assert len(false_neg) >= 3, f"need >=3 keyword FALSE-NEGATIVES (broader), got {false_neg}"

    # (3) hard-call floor: >= half the cards are genuine confounders ----------
    hard = [it["n"] for it in ITEMS if it["family"] != "plain_covered"]
    assert len(hard) >= len(ITEMS) // 2, f"only {len(hard)} hard calls; need >= {len(ITEMS)//2}"

    # (4) check-count floor ---------------------------------------------------
    n_checks = 1 + 2 * len(ITEMS)            # mock_reachable + (section + gap) per item
    assert n_checks >= 30, f"check count {n_checks} below floor"

    # ----- emit artifacts ----------------------------------------------------
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    MOCK_RUNTIME.mkdir(parents=True, exist_ok=True)
    (MOCK_RUNTIME / "todoist_seed.sql").write_text(build_seed_sql(), encoding="utf-8")
    write_policy()

    def section_for(it):
        return READY_SECTION if it["covered"] else RESOURCE_SECTION

    expected = {
        "project_name": PROJECT_NAME,
        "backlog_section": BACKLOG_SECTION,
        "ready_section": READY_SECTION,
        "resource_section": RESOURCE_SECTION,
        "gap_label": GAP_LABEL,
        "reason_labels": REASON_LABELS,
        "auth_token": AUTH_TOKEN,
        "items": [
            {"title": card_title(it), "component": it["component"], "vendor": it["vendor"],
             "covered": bool(it["covered"]), "section": section_for(it),
             "labels": expected_labels(it), "family": it["family"]}
            for it in ITEMS
        ],
        "scored": {
            "covered_titles": [card_title(it) for it in ITEMS if it["covered"]],
            "not_covered_titles": [card_title(it) for it in ITEMS if not it["covered"]],
        },
        "check_count": n_checks,
        "n_coverage_calls": len(ITEMS),
        "n_hard": len(hard),
        # Documentation only (verifier ignores unknown keys): the coverage
        # judgements (the discriminator). Full decisive reasoning is in
        # scratch/scripts/todoist_fairness.json.
        "coverage_cases": [
            {"title": card_title(it), "covered": bool(it["covered"]), "family": it["family"],
             "requirement": it["requirement"], "capability": it["capability"],
             "reasoning": it["reasoning"]}
            for it in ITEMS
        ],
    }
    (HERE / "expected_answer.json").write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")

    annotations = {
        "cards": {card_title(it): {
            "n": it["n"], "component": it["component"], "vendor": it["vendor"],
            "covered": bool(it["covered"]), "family": it["family"],
            "section": section_for(it),
            "requirement": it["requirement"], "capability": it["capability"],
            "reasoning": it["reasoning"], "defeats": it["defeats"],
            "keyword_guess": bool(it["_kw_guess"]),
        } for it in ITEMS},
        "covered_titles": [card_title(it) for it in ITEMS if it["covered"]],
        "not_covered_titles": [card_title(it) for it in ITEMS if not it["covered"]],
        "hard_titles": [card_title(it) for it in ITEMS if it["family"] != "plain_covered"],
        "keyword_false_positive_titles": [card_title(BY_N[n]) for n in false_pos],
        "keyword_false_negative_titles": [card_title(BY_N[n]) for n in false_neg],
    }
    (HERE / "gold_annotations.json").write_text(json.dumps(annotations, indent=2) + "\n", encoding="utf-8")

    # ----- author-review summary --------------------------------------------
    print(f"project = {PROJECT_NAME}")
    print(f"cards={len(ITEMS)}  covered={n_cov}  not_covered={n_notcov}  hard(confounders)={len(hard)}")
    print(f"checks={n_checks}  (1 reachable + {len(ITEMS)} section + {len(ITEMS)} exact-label-set)")
    print(f"coverage calls (the discriminator) = {len(ITEMS)}  ; >=half hard: {len(hard) >= len(ITEMS)//2}")
    print(f"keyword false-positives (shared words, NOT covered): {false_pos}")
    print(f"keyword false-negatives (broader, covered):          {false_neg}")
    print()
    hdr = f"{'#':>2} {'cov':<4} {'family':<20} {'kw':<4} component"
    print(hdr)
    for it in sorted(ITEMS, key=lambda x: x["n"]):
        kw = "ok" if it["_kw_guess"] == it["covered"] else ("FP" if not it["covered"] else "FN")
        print(f"{it['n']:>2} {('Y' if it['covered'] else '-'):<4} {it['family']:<20} {kw:<4} {it['component']}")


if __name__ == "__main__":
    main()
