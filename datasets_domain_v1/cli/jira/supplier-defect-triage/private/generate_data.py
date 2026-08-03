#!/usr/bin/env python3
"""Deterministic data generator for cli-jira-supplier-defect-triage (SEMANTIC rebuild).

The load-bearing difficulty is GENUINE SEMANTIC JUDGMENT over differently-worded
free text, scaled to ~20+ independent hard calls so a near-perfect-on-structured
model (e.g. gemini-3-flash-preview) reliably trips at least one binary check:

  1. SEMANTIC duplicate recognition (NOT verbatim).  Each true duplicate pair is
     the SAME underlying defect described in genuinely different words, units,
     symptoms, customer phrasing, and (often) a different SKU. The two reports do
     NOT share a copy-pasted root-cause string; equivalence must be read by
     MEANING.  A naive token-overlap matcher MISSES them (low surface overlap).

  2. DISTRACTOR rejection.  Several reports share strong surface cues (same SKU,
     same supplier, the same symptom word) but are DIFFERENT defects. A naive
     token/supplier matcher WRONGLY MERGES them; a semantic reader keeps them
     apart.  Both false-negatives (missing a true dup) and false-positives
     (merging a distractor) are scored.

  3. COMPONENT from the symptom NARRATIVE, with NO editorialising keyword tell.
     The report states only the physical symptom; the defect class (and thus the
     component) must be inferred from consequence — e.g. "reaches ~70 C, scorches
     a desk" => a harm defect, but "around 41 C, within rating, works fine" =>
     a function defect; a hairline crack that still works => appearance, but a
     crack that leaves a finger-cutting edge => a harm defect. Descriptions never
     name the defect type, component, priority, or duplicate status.

Structured levers (priority matrix non-monotone + boundaries + regulatory
override, the Cycle-7 knapsack with skip-and-continue + a near-tie + a blocker
with no back-fill) are kept FAIR and deterministic; they are not the difficulty,
but they add a few more independent checks.

Emits:
  workspace/triage_policy.md          agent-visible policy (rules only, no answers)
  workspace/component_owners.csv      agent-visible component -> owner map
  private/mock_runtime/jira_seed.sql  jira_cli DB seed (PROJ + untriaged backlog;
                                      all inputs encoded in descriptions)
  private/expected_answer.json        ground truth (NEVER shipped to the container)
  private/gold_annotations.json       per-issue semantic truth (defect + dup
                                      family) for the offline gold/single-slip
                                      solvers (NEVER shipped; scratch use only)
"""
import csv
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASK = HERE.parent
WORKSPACE = TASK / "workspace"
MOCK_RUNTIME = HERE / "mock_runtime"

# --- Configuration constants (single source of truth for policy + seed) -----
PROJECT_KEY = "PROJ"
PROJECT_NAME = "Supplier Quality"
PROJECT_ID = "10000"
BOARD_ID = "100"
BOARD_NAME = "Supplier Quality Board"
SPRINT_ID = "1"
SPRINT_NAME = "Cycle 6"
SERVER = "https://northbridge.atlassian.net"
PM_LOGIN = "pm@northbridge.example.com"
AUTH_TOKEN = "mock-jira-token-bench"
BASE_TS = "2026-05-25T09:00:00.000Z"

VOLUME_HIGH_THRESHOLD = 500   # affected units >= this        => "High" volume band
VOLUME_MED_THRESHOLD = 100    # this <= affected units < High => "Medium" band; else "Low"
CYCLE_CAPACITY = 32           # Cycle 7 story-point capacity (tuned; see jira_knapsack_scan)
CYCLE_LABEL = "cycle-7"

PRIORITY_LEVELS = ["Lowest", "Low", "Medium", "High", "Highest"]  # ascending
PRIORITY_RANK = {n: i for i, n in enumerate(reversed(PRIORITY_LEVELS))}

# severity x volume_band -> priority. The Critical row is intentionally
# NON-MONOTONE in volume: Low volume maps back up to Highest.
PRIORITY_MATRIX = {
    "Critical": {"High": "Highest", "Medium": "High",   "Low": "Highest"},
    "Major":    {"High": "High",    "Medium": "Medium", "Low": "Low"},
    "Minor":    {"High": "Medium",  "Medium": "Low",    "Low": "Lowest"},
}
# Regulatory-reportable override (keyed on severity only; volume is ignored).
REG_OVERRIDE = {"Critical": "Highest", "Major": "Highest", "Minor": "High"}

# defect type -> component (jira component name)
DEFECT_COMPONENT = {
    "cosmetic":   "Packaging",
    "functional": "Engineering",
    "safety":     "Compliance",
}
# component -> owner email (the remediation owner)
COMPONENT_OWNER = {
    "Packaging":   "mara.okafor@northbridge.example.com",
    "Engineering": "derek.tan@northbridge.example.com",
    "Compliance":  "priya.nair@northbridge.example.com",
}
COMPONENT_TEAM = {
    "Packaging":   "Packaging & Finish",
    "Engineering": "Product Engineering",
    "Compliance":  "Safety & Compliance",
}

# --------------------------------------------------------------------------- #
# Issue source table
# --------------------------------------------------------------------------- #
# Fields: num (-> key PROJ-<num>), sku, product, supplier, severity, units
# (affected), po (production-run size, a red herring; volume uses `units`), reg
# (regulatory-reportable bool), defect (cosmetic/functional/safety — the SEMANTIC
# truth a knowledgeable reader infers from the symptom), rc (hidden family token:
# two issues share it iff they are the SAME underlying defect — the build-time
# source of truth for grouping; the agent never sees it), points, blk (blocked-by
# num) + blk_reason, summary/symptom/cause (agent-visible FREE TEXT — raw inputs
# only, no answer words), and `intended` (a build-time priority cross-check;
# None for the closed duplicates which are never triaged).
#
# Duplicate families (rc shared by exactly the canonical (lower num) + its dup):
#   cell_gas       PROJ-1  ~ PROJ-28  (battery gassing/swelling; power bank ~ speaker, cross-SKU)
#   insul_crack    PROJ-2  ~ PROJ-29  (insulation breakdown; USB-C ~ braided cable, cross-SKU)
#   charge_overheat PROJ-3 ~ PROJ-30  (charge circuit burn-hot; charger ~ pad, cross-SKU)
#   bt_range       PROJ-4  ~ PROJ-31  (BT range regression; earbuds X1, same SKU)
#   ribbon_seat    PROJ-5  ~ PROJ-32  (display flex unseated; smartwatch W6, same SKU)
#   finish_flake   PROJ-6  ~ PROJ-33  (coating won't adhere; case ~ folio, cross-SKU)
#   cold_solder    PROJ-7  ~ PROJ-34  (one port flaky joint; hub ~ dock, cross-SKU)
#   bearing_stall  PROJ-8  ~ PROJ-35  (motor bearing binds; desk fan ~ circulator, cross-SKU)
ISSUES = [
    # ----- canonical halves of the 8 semantic duplicate families -------------
    dict(num=1, sku="NB-PWRBANK-P3", product="20,000 mAh power bank", supplier="Dongguan CellWorks",
         severity="Critical", units=1500, po=4000, reg=0, defect="safety", rc="cell_gas", points=5,
         intended="Highest",
         summary="Power bank pack distends until the shell separates",
         symptom="After about ten quick-charge cycles the internal pack distends until the two halves of the enclosure spring apart at the seam; one returned unit was still noticeably warm the next morning, long after it had been unplugged.",
         cause="the cells in this consignment build up gas inside during quick charging — the cell maker confirmed an out-of-spec internal divider film."),
    dict(num=2, sku="NB-CABLE-L4", product="USB-C charge cable", supplier="Shenzhen BrightCord",
         severity="Critical", units=900, po=6000, reg=0, defect="safety", rc="insul_crack", points=5,
         intended="Highest",
         summary="Cable sheath develops splits and bares the conductor",
         symptom="Within roughly a week of ordinary use the outer sheath develops fine lengthwise splits and the bare copper underneath shows through; one user felt a faint tingle plugging it in with damp hands.",
         cause="the sheath compound from this extrusion run is too brittle and fails the repeated-bend endurance test."),
    dict(num=3, sku="NB-CHARGER-Q5", product="65 W fast charger", supplier="Xiamen VoltPlus",
         severity="Major", units=600, po=5000, reg=0, defect="safety", rc="charge_overheat", points=3,
         intended="High",
         summary="Charger body reaches about 70 C under a sustained load",
         symptom="During a long charging session the body of the unit climbs to roughly 70 C — enough to leave a dull scorch ring on a wooden desk and to sting fingers pressed against it.",
         cause="the quick-charge regulator chip on the board runs far past its rated temperature."),
    dict(num=4, sku="NB-EARBUD-X1", product="wireless earbuds", supplier="Ningbo SoundLab",
         severity="Minor", units=800, po=3000, reg=0, defect="functional", rc="bt_range", points=4,
         intended="Medium",
         summary="Earbuds drop audio past roughly two metres",
         symptom="The sound chops out as soon as the handset is more than about two metres away and returns the moment you step back in close; the pairing itself never lets go.",
         cause="a range regression introduced by the v2.1 wireless firmware."),
    dict(num=5, sku="NB-WATCH-W6", product="smartwatch", supplier="Foshan WearTech",
         severity="Major", units=300, po=2500, reg=0, defect="functional", rc="ribbon_seat", points=3,
         intended="Medium",
         summary="Watch screen goes dark for a few seconds at random",
         symptom="The display goes completely dark for a few seconds at unpredictable moments and then comes back on its own; nothing else about the watch misbehaves.",
         cause="the display ribbon connector is not fully seated in its socket."),
    dict(num=6, sku="NB-CASE-C5", product="protective phone case", supplier="Quanzhou MoldRight",
         severity="Minor", units=250, po=6000, reg=0, defect="cosmetic", rc="finish_flake", points=3,
         intended="Low",
         summary="Soft-touch coating sheds off the back of the case",
         symptom="The soft-touch coating on the back starts shedding in patches within a few weeks, leaving the plain plastic showing through; the case still clips on and protects the phone as intended.",
         cause="the coating is not bonding to the substrate on this batch."),
    dict(num=7, sku="NB-HUB-H7", product="7-port USB hub", supplier="Ningbo PortPlus",
         severity="Minor", units=100, po=3000, reg=0, defect="functional", rc="cold_solder", points=2,
         intended="Low",
         summary="One hub port drops out at the slightest movement",
         symptom="One of the ports drops whatever is plugged in at the smallest nudge of the cable, while the remaining ports stay rock solid; transfers are fine right up until the drop.",
         cause="a cold solder joint on that one port's data pads."),
    dict(num=8, sku="NB-FAN-F2", product="USB desk fan", supplier="Foshan AirFlow",
         severity="Minor", units=99, po=2000, reg=0, defect="functional", rc="bearing_stall", points=2,
         intended="Lowest",
         summary="Desk fan blades stop until you give it a tap",
         symptom="The blades quit turning at random moments and start again only if you tap the housing, after which it runs for a while; it stays cool and makes no unusual noise.",
         cause="a sticky sleeve bearing in a sub-batch of motors."),
    # ----- distractors + standalone levers (PROJ-9 .. PROJ-27) ---------------
    dict(num=9, sku="NB-ADAPTER-A3", product="universal travel adapter", supplier="Xiamen VoltPlus",
         severity="Minor", units=150, po=2500, reg=0, defect="functional", rc="adapter_warm", points=2,
         intended="Low",  # distractor: VoltPlus "runs warm" vs PROJ-3 (burn-hot) and PROJ-19
         summary="Travel adapter feels warm to the touch in use",
         symptom="Several buyers say the adapter feels warmer than they expected in use; a bench check put it at about 41 C, comfortably inside its stated rating, and it keeps working normally.",
         cause="ordinary conversion loss in a slightly undersized internal heat spreader."),
    dict(num=10, sku="NB-ADAPTER-V8", product="AC power adapter", supplier="Xiamen VoltPlus",
         severity="Major", units=250, po=3000, reg=1, defect="safety", rc="surge_arc", points=4,
         intended="Highest",  # regulatory override Major->Highest; distractor vs PROJ-9 (same supplier/adapter)
         summary="Adapter can flash over internally when the mains surges",
         symptom="When the mains supply spikes, the adapter can flash over internally with an audible snap; an inspection found scorch marks across the board around the input stage.",
         cause="the surge-clamping component on the input is undersized for the spikes seen on site."),
    dict(num=11, sku="NB-EARBUD-X1", product="wireless earbuds", supplier="Ningbo SoundLab",
         severity="Minor", units=120, po=3000, reg=0, defect="functional", rc="earbud_charge", points=3,
         intended="Low",  # distractor: same SKU as PROJ-4/31, different defect (charging contact)
         summary="Left earbud often will not charge in its case",
         symptom="The left bud frequently fails to take any charge when it is set in the case, while the right bud charges every time; reseating it sometimes helps for one session.",
         cause="a weak charging-contact spring on the left side of the case."),
    dict(num=12, sku="NB-EARBUD-X1", product="wireless earbuds", supplier="Ningbo SoundLab",
         severity="Minor", units=90, po=3000, reg=0, defect="cosmetic", rc="earbud_crack", points=2,
         intended="Lowest",  # distractor: same SKU, different defect; cosmetic crack (contrast w/ PROJ-14)
         summary="Some earbud shells arrive with a hairline crack",
         symptom="A portion of units arrive with a faint hairline crack running across the outer shell; the buds still pair, charge, and play exactly as they should.",
         cause="a fine crack forming in the shell as it is released from the mould."),
    dict(num=13, sku="NB-CASE-C2", product="protective phone case", supplier="Quanzhou MoldRight",
         severity="Minor", units=800, po=6000, reg=1, defect="cosmetic", rc="miss_mark", points=3,
         intended="High",  # regulatory override Minor->High; cosmetic (Packaging) despite reg; distractor (MoldRight case)
         summary="Required conformity marking missing from the case label",
         symptom="The printed label on the back is missing the conformity marking that regulations require to be shown; the case itself fits and protects exactly as intended.",
         cause="a printing-plate error that dropped the marking from this print run."),
    dict(num=14, sku="NB-CASE-R4", product="rugged phone case", supplier="Quanzhou MoldRight",
         severity="Major", units=200, po=4000, reg=0, defect="safety", rc="case_crack", points=4,
         intended="Medium",  # safety crack (contrast w/ PROJ-12 cosmetic crack); distractor (MoldRight case)
         summary="Case cracks at the corner and leaves a sharp edge",
         symptom="The frame cracks at one corner under a modest knock, and the break leaves a jagged edge that has nicked fingers when the phone is pulled out.",
         cause="the corner wall is moulded too thin and splits along the gate line."),
    dict(num=15, sku="NB-DASHCAM-D4", product="dashboard camera", supplier="Hangzhou RoadEye",
         severity="Critical", units=60, po=2000, reg=0, defect="safety", rc="dashcam_heatsoak", points=5,
         intended="Highest",  # NON-MONOTONE: Critical / Low volume -> Highest
         summary="Dashcam can overheat severely after sitting in a hot car",
         symptom="Left on the windscreen of a car parked in direct sun, the unit can get hot enough inside to char its own housing and scorch the trim it rests on, even with the engine off.",
         cause="the internal cell turns thermally unstable at the temperatures reached during heat-soak in this early batch."),
    dict(num=16, sku="NB-GIMBAL-G2", product="phone gimbal", supplier="Suzhou SteadyShot",
         severity="Critical", units=300, po=2500, reg=0, defect="safety", rc="gimbal_shock", points=4,
         intended="High",  # Critical / Medium volume -> High (contrast with PROJ-15)
         summary="Gimbal grip can deliver a jolt while charging",
         symptom="Charged in a humid room, the metal of the grip can give the user a sharp jolt on contact; one report described a visible spark at the charge port.",
         cause="a missing insulation gasket leaves a charge contact exposed to the shell."),
    dict(num=17, sku="NB-MOUSE-M5", product="wireless mouse", supplier="Dongguan ClickWorks",
         severity="Major", units=500, po=4000, reg=0, defect="functional", rc="scroll_double", points=6,
         intended="High",  # exactly on the 500 boundary -> High
         summary="Mouse scroll wheel registers phantom double-scrolls",
         symptom="The scroll wheel often jumps two steps for one notch of movement, so pages leap further than intended; the rest of the mouse behaves normally.",
         cause="a debounce fault in the scroll-encoder firmware."),
    dict(num=18, sku="NB-KEYBD-K3", product="mechanical keyboard", supplier="Dongguan ClickWorks",
         severity="Major", units=499, po=4000, reg=0, defect="functional", rc="key_chatter", points=2,
         intended="Medium",  # 499 -> Medium (one unit below the 500 boundary)
         summary="Some keys register twice on a single press",
         symptom="On affected boards a handful of keys put in two characters for one deliberate press, which forces constant corrections; the board is otherwise usable.",
         cause="worn key-switch contacts from an out-of-tolerance switch lot."),
    dict(num=19, sku="NB-STRIP-S2", product="6-outlet power strip", supplier="Huizhou PlugMax",
         severity="Minor", units=300, po=3000, reg=0, defect="functional", rc="strip_warm", points=2,
         intended="Low",  # distractor: "runs warm" within spec vs PROJ-3 (burn-hot) and PROJ-9
         summary="Power strip runs warm when fully loaded",
         symptom="With every outlet in use the strip runs warm to the touch; a thermocouple put it at around 42 C, within its rating, and it keeps powering everything correctly.",
         cause="expected resistive warming when the strip is loaded close to its limit."),
    dict(num=20, sku="NB-CABLE-L9", product="USB-C charge cable", supplier="Shenzhen BrightCord",
         severity="Minor", units=200, po=6000, reg=0, defect="functional", rc="plug_loose", points=2,
         intended="Low",  # distractor: BrightCord cable, mechanical plug (NOT the insulation defect of PROJ-2/29)
         summary="USB-C plug sits loose and charging cuts out",
         symptom="The plug does not click firmly into many phones and the charge stops unless the cable is held at just the right angle; the cable itself is intact.",
         cause="the connector overmould is a touch oversized, so the plug seats loosely."),
    dict(num=21, sku="NB-HUB-H9", product="4-port USB hub", supplier="Ningbo PortPlus",
         severity="Minor", units=150, po=3000, reg=0, defect="functional", rc="hub_nopower", points=2,
         intended="Low",  # distractor: PortPlus "port" issue, power budget (NOT the solder joint of PROJ-7/34)
         summary="One hub port cannot power a power-hungry drive",
         symptom="One port fails to run a power-hungry portable drive that works fine on the others, though it handles a keyboard or memory stick without trouble; data on every port is steady.",
         cause="that port's power budget is set too small for demanding devices."),
    dict(num=22, sku="NB-BAND-B5", product="fitness band", supplier="Foshan WearTech",
         severity="Minor", units=200, po=3000, reg=0, defect="functional", rc="band_flicker", points=2,
         intended="Low",  # distractor: WearTech "screen" issue, firmware-fixable flicker (NOT the ribbon of PROJ-5/32)
         summary="Band display flickers until a firmware update is applied",
         symptom="The band's display flickers and stutters during workouts; the stutter goes away for good once the latest firmware is installed, and updated units never show it again.",
         cause="a refresh-timing error in the display firmware, corrected in the newer build."),
    dict(num=23, sku="NB-SPKR-G3", product="bookshelf speaker", supplier="Ningbo SoundLab",
         severity="Minor", units=80, po=4000, reg=0, defect="cosmetic", rc="grille_shade", points=2,
         intended="Lowest",  # straightforward cosmetic; cycle filler
         summary="Speaker grille colour varies from unit to unit",
         symptom="Across a shipment the fabric grille turns up in slightly different shades from one unit to the next; the sound output and the fit are unaffected.",
         cause="a dye-lot variation in the grille fabric supplier's run."),
    dict(num=24, sku="NB-DOORBELL-B9", product="smart doorbell", supplier="Zhongshan BuildRight",
         severity="Major", units=480, po=3000, reg=0, defect="functional", rc="doorbell_leak", points=8,
         intended="Medium",  # blocker X — large, overflows the cycle
         summary="Doorbell motion detection stalls until it is restarted",
         symptom="After some hours the doorbell stops flagging motion events at all until it is power-cycled, after which it works again for a while; nothing else is affected.",
         cause="a memory leak in the motion-detection service that exhausts the device's memory."),
    dict(num=25, sku="NB-DOORBELL-B9C", product="smart doorbell chime unit", supplier="Zhongshan BuildRight",
         severity="Major", units=520, po=3000, reg=0, defect="functional", rc="chime_pair", points=2,
         intended="High",  # blocked Y — small & High, but blocked by PROJ-24
         blk=24, blk_reason="the chime fix can only ship together with the doorbell firmware work in PROJ-24.",
         summary="Chime unit keeps losing its pairing with the doorbell",
         symptom="The chime repeatedly drops its link to the doorbell and has to be paired again by hand to keep working.",
         cause="a pairing-handshake timeout in the chime firmware."),
    dict(num=26, sku="NB-MOUSE-T1", product="gaming mouse", supplier="Dongguan ClickWorks",
         severity="Major", units=510, po=4000, reg=0, defect="functional", rc="side_double", points=4,
         intended="High",  # near-tie LOSER (same High band as PROJ-27, more points, lower key)
         summary="Gaming mouse side buttons fire twice per click",
         symptom="The two thumb buttons frequently send two presses for one click, which misfires in use; the main buttons and the sensor are fine.",
         cause="a debounce gap in the side-button firmware."),
    dict(num=27, sku="NB-WEBCAM-T2", product="1080p webcam", supplier="Suzhou SteadyShot",
         severity="Major", units=700, po=3500, reg=0, defect="functional", rc="af_hunt", points=3,
         intended="High",  # near-tie WINNER (same High band as PROJ-26, fewer points)
         summary="Webcam autofocus hunts continuously in dim light",
         symptom="In a dim room the autofocus keeps racking in and out and never settles, leaving the picture soft; in good light it focuses normally.",
         cause="an autofocus-tuning error in the image-signal firmware."),
    # ----- duplicate halves (higher-numbered; SAME defect as their canonical) -
    dict(num=28, sku="NB-SPKR-S8", product="portable Bluetooth speaker", supplier="Dongguan CellWorks",
         severity="Critical", units=700, po=3000, reg=0, defect="safety", rc="cell_gas", points=5,
         intended=None,  # dup of PROJ-1 (cross-SKU: same CellWorks cell consignment)
         summary="Speaker enclosure bulges and the bonded seam parts",
         symptom="Buyers write that the speaker has slowly puffed out over two or three months until the glued seam parted along one edge; one said theirs grew warm enough on the shelf that they stopped charging it for good.",
         cause="the battery is expanding as gas collects inside the cell, which the supplier traced to a coating deviation on this run."),
    dict(num=29, sku="NB-CABLE-L7", product="braided USB-C cable", supplier="Shenzhen BrightCord",
         severity="Critical", units=400, po=6000, reg=0, defect="safety", rc="insul_crack", points=5,
         intended=None,  # dup of PROJ-2 (cross-SKU: same brittle insulation material batch)
         summary="Braided cable jacket frays and leaves the wire bare",
         symptom="The woven jacket frays apart after only gentle handling and the wiring beneath ends up uncovered; a couple of buyers noticed a brief spark at the connector when it was moved.",
         cause="the wire covering is fracturing prematurely — that material batch never passed its bend-cycle qualification."),
    dict(num=30, sku="NB-WPAD-Q9", product="wireless charging pad", supplier="Xiamen VoltPlus",
         severity="Major", units=350, po=5000, reg=0, defect="safety", rc="charge_overheat", points=3,
         intended=None,  # dup of PROJ-3 (cross-SKU: same charge circuit running burn-hot)
         summary="Charging pad gets too hot to keep a palm on it",
         symptom="While a phone sits on it, the top face of the pad becomes too hot to keep a palm resting there; an inspector's probe read it in the upper sixties of degrees Celsius.",
         cause="the charging electronics overheat badly when current is drawn continuously."),
    dict(num=31, sku="NB-EARBUD-X1", product="wireless earbuds", supplier="Ningbo SoundLab",
         severity="Minor", units=600, po=3000, reg=0, defect="functional", rc="bt_range", points=4,
         intended=None,  # dup of PROJ-4 (same SKU: same wireless range regression)
         summary="Earbuds go silent when you leave the room",
         symptom="Wearers report the buds fall silent the moment they step into the next room and come back to life when they return; otherwise the audio is clean and the pairing holds.",
         cause="the radio's effective reach shrank after the most recent firmware update."),
    dict(num=32, sku="NB-WATCH-W6", product="smartwatch", supplier="Foshan WearTech",
         severity="Major", units=250, po=2500, reg=0, defect="functional", rc="ribbon_seat", points=3,
         intended=None,  # dup of PROJ-5 (same SKU: same unseated display flex)
         summary="Watch face drops to black mid-use then recovers",
         symptom="Owners say the face randomly cuts to black partway through use and lights back up a moment later by itself; it is widespread across the units they bought.",
         cause="the screen's flex cable has worked loose from its connector."),
    dict(num=33, sku="NB-FOLIO-C8", product="tablet folio case", supplier="Quanzhou MoldRight",
         severity="Minor", units=300, po=6000, reg=0, defect="cosmetic", rc="finish_flake", points=3,
         intended=None,  # dup of PROJ-6 (cross-SKU: same finishing line, coating won't adhere)
         summary="Folio finish rubs away in blotches",
         symptom="Customers say the textured finish on the folio wears off in blotches after light handling, exposing the grey material underneath; it still closes and stands as designed.",
         cause="weak adhesion of the surface coating coming off the same finishing line."),
    dict(num=34, sku="NB-DOCK-D7", product="laptop docking station", supplier="Ningbo PortPlus",
         severity="Minor", units=200, po=3000, reg=0, defect="functional", rc="cold_solder", points=2,
         intended=None,  # dup of PROJ-7 (cross-SKU: same one-port flaky joint on movement)
         summary="A dock port disconnects whenever the cable is wiggled",
         symptom="On some docks a single port loses its device any time the lead is wiggled, yet the other ports never let go; otherwise transfers are clean.",
         cause="a poorly made joint on that one port's connections."),
    dict(num=35, sku="NB-CIRC-A6", product="mini air circulator", supplier="Foshan AirFlow",
         severity="Minor", units=150, po=2000, reg=0, defect="functional", rc="bearing_stall", points=2,
         intended=None,  # dup of PROJ-8 (cross-SKU: same motor bearing binding)
         summary="Air circulator keeps seizing mid-use",
         symptom="The circulator's rotor keeps stalling partway through use and only spins up again after a nudge to the blade; this shows up across many units.",
         cause="motor bearings binding on a bad production lot."),
]

# Distractor issues that MUST stay open + unlinked (scored false-positive guards).
# Each is genuinely a distinct defect that a naive surface matcher is tempted to
# merge with the listed lure(s); a semantic reader keeps them separate.
DISTRACTOR_LURES = {
    9:  [3, 19],   # VoltPlus "warm" vs the burn-hot charger / the within-spec strip
    10: [9],       # VoltPlus adapter surge-arc vs the within-spec warm adapter
    11: [4],       # earbud X1 charging fault vs the X1 range regression
    12: [4, 14],   # earbud X1 cosmetic crack vs the X1 range regression / the safety crack
    13: [6],       # MoldRight case label vs the MoldRight finish flaking
    14: [6, 12],   # MoldRight case safety crack vs the finish flaking / the cosmetic crack
    19: [9],       # power strip within-spec warm vs the within-spec warm adapter
    20: [2],       # BrightCord loose plug vs the BrightCord insulation breakdown
    21: [7],       # PortPlus power-budget port vs the PortPlus cold-solder port
    22: [5],       # WearTech firmware flicker vs the WearTech hardware ribbon blank
}
DISTRACTOR_KEYS = sorted(DISTRACTOR_LURES)

# Atomic checks the verifier scores. Representatives are chosen to exercise every
# difficulty lever; each maps to >=1 binary check so a single mis-judgement fails.
SCORED = {
    # priority: all 5 levels + both boundaries + the non-monotone cell + both reg overrides
    "priority_keys":      [1, 7, 8, 10, 13, 15, 16, 17, 18],
    # component from narrative (no keyword tell): the hard mismatches + the contrasts
    "component_keys":     [1, 3, 6, 9, 11, 12, 13, 14],
    # assignee = component owner (one per owner): Compliance / Engineering / Packaging
    "assignee_keys":      [1, 11, 13],
    # cycle committed reps: reg escalations + non-monotone + skip-continue pickup + near-tie winner
    "committed_keys":     [10, 13, 15, 18, 27],
    # cycle NOT committed reps: no-back-fill guard + High overflow + blocker + blocked drop
    #                          + near-tie loser + a closed duplicate
    "not_committed_keys": [7, 16, 24, 25, 26, 28],
    # distractor false-positive guards (kept open + unlinked)
    "distractor_keys":    DISTRACTOR_KEYS,
}
# Of the component checks, these require GENUINE narrative judgement that a
# keyword classifier gets wrong or a surface reader confuses (documented in
# scratch/scripts/jira_fairness.json):
HARD_COMPONENT_KEYS = [3, 9, 12, 13, 14]

# Seed reference data (mirrors mock_services/jira_cli/seeds/default.sql shapes).
ISSUE_TYPES = [
    ("10001", "Story", "story", 0), ("10002", "Bug", "bug", 0),
    ("10003", "Task", "task", 0), ("10004", "Sub-task", "sub-task", 1),
    ("10005", "Epic", "epic", 0),
]
STATUSES = [("1", "To Do", "To Do"), ("2", "In Progress", "In Progress"),
            ("3", "In Review", "In Progress"), ("4", "Done", "Done")]
PRIORITIES = [("1", "Highest", 1), ("2", "High", 2), ("3", "Medium", 3),
              ("4", "Low", 4), ("5", "Lowest", 5)]
# Workflow: no direct To Do -> Done (closing a duplicate needs the 2-hop path).
TRANSITIONS = [
    ("To Do", "In Progress"), ("In Progress", "In Review"),
    ("In Progress", "Done"), ("In Review", "Done"),
    ("In Review", "In Progress"), ("Done", "To Do"),
]
BUG_TYPE_ID = "10002"
TODO_STATUS_ID = "1"

# Words that must NEVER appear in any agent-visible per-issue free text (summary /
# symptom / root-cause / blocked-by reason) — they would leak the defect class,
# the component, the priority, or the duplicate status. (Severity words live only
# in the structured "Severity:" line, never in prose.)
LEAK_WORDS = [
    # priority labels
    "highest", "priority",
    # component names
    "packaging", "engineering", "compliance",
    # defect-class labels
    "cosmetic", "functional", "safety",
    # severity words (belong only in the structured Severity line, not prose)
    "critical", "major", "minor",
    # duplicate-status tells
    "duplicate", "duplicates", "dedupe", "deduplicate",
    # editorialising tells
    "hazard", "hazardous", "dangerous", "unsafe", "harmless",
]
# Whole-word priority adjectives ("high"/"medium"/"low") are banned in prose too,
# but checked separately so legitimate substrings (e.g. "however") are not hit.
LEAK_WORDS_STRICT = ["high", "medium", "low"]


# --------------------------------------------------------------------------- #
# Derivations
# --------------------------------------------------------------------------- #
def key_of(num):
    return f"{PROJECT_KEY}-{num}"


def volume_band(units):
    if units >= VOLUME_HIGH_THRESHOLD:
        return "High"
    if units >= VOLUME_MED_THRESHOLD:
        return "Medium"
    return "Low"


def priority_of(issue):
    if issue.get("reg"):
        return REG_OVERRIDE[issue["severity"]]
    return PRIORITY_MATRIX[issue["severity"]][volume_band(issue["units"])]


def component_of(issue):
    return DEFECT_COMPONENT[issue["defect"]]


def owner_of(issue):
    return COMPONENT_OWNER[component_of(issue)]


def fill_skip_continue(ordered, capacity):
    """Greedy fill by the given order; a later smaller issue may still fit."""
    committed, total = [], 0
    for i in ordered:
        if total + i["points"] <= capacity:
            committed.append(i["num"])
            total += i["points"]
    return committed, total


def compute_committed(non_dupes, by_num):
    """Stated Cycle-7 rule: sort (priority desc, points asc, key asc); greedy
    skip-and-continue fill into CYCLE_CAPACITY; THEN drop any selected issue whose
    blocker is not selected (no back-fill)."""
    ordered = sorted(
        non_dupes,
        key=lambda i: (PRIORITY_RANK[priority_of(i)], i["points"], i["num"]),
    )
    pre, _ = fill_skip_continue(ordered, CYCLE_CAPACITY)
    pre_set = set(pre)
    committed = []
    for num in pre:
        blk = by_num[num].get("blk")
        if blk is not None and blk not in pre_set:
            continue  # blocked issue whose blocker did not make the cut -> dropped
        committed.append(num)
    total = sum(by_num[n]["points"] for n in committed)
    return committed, total, ordered, pre


# --------------------------------------------------------------------------- #
# Token-overlap metric (author insight + naive-baseline modelling)
# --------------------------------------------------------------------------- #
_STOP = set("""a an the and or of to in on at for with from into over under by is
are was were be been being it its they them their this that these those as but if
then so not no than up out off only just very more most some any each one two when
where while after before during until per about around roughly within keeps still
otherwise every fine normal normally use used using unit units user users buyer
buyers customer customers report reports reported say says said theirs them you your
""".split())


def content_tokens(issue):
    """The discriminating surface a matcher actually sees: SKU + product + supplier
    + summary + symptom + cause, minus stopwords (the structured Severity/units/
    points line is uniform boilerplate and is excluded). Used for token-overlap
    (Jaccard) — the naive dedup baseline and the author's interleaving check."""
    text = " ".join([issue["summary"], issue["sku"], issue["product"],
                     issue["supplier"], issue["symptom"], issue["cause"]]).lower()
    toks = re.findall(r"[a-z0-9]+", text)
    return {t for t in toks if t not in _STOP and len(t) > 2}


def jaccard(a, b):
    sa, sb = content_tokens(a), content_tokens(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


# --------------------------------------------------------------------------- #
# SQL seed emission
# --------------------------------------------------------------------------- #
def sql_str(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def build_description(issue):
    reg = "reportable" if issue.get("reg") else "not reportable"
    lines = [
        f"SKU {issue['sku']} ({issue['product']}); supplier {issue['supplier']}.",
        (f"Severity: {issue['severity']}. "
         f"Affected units: {issue['units']} (out of a {issue['po']}-unit production run). "
         f"Regulatory status: {reg}."),
        f"Symptom: {issue['symptom']}",
        f"Root cause: {issue['cause']}",
    ]
    if issue.get("blk"):
        lines.append(f"Blocked by {key_of(issue['blk'])}: {issue['blk_reason']}")
    lines.append(f"Story points: {issue['points']}.")
    return "\n".join(lines)


def build_seed_sql():
    L = []
    L.append("-- cli-jira-supplier-defect-triage seed (generated by private/generate_data.py — do not edit by hand)")
    L.append("-- Wipe any default fixture (the mock auto-seeds defaults on a fresh DB), then load this task.")
    L.append("-- Delete order mirrors lib/db.js resetDb drop order (child -> parent, FK-safe).")
    for t in ["audit_log", "sprint_issues", "comments", "issue_links", "issues",
              "transitions", "sprints", "boards", "issue_priorities",
              "issue_statuses", "issue_types", "projects", "config"]:
        L.append(f"DELETE FROM {t};")
    L.append("")

    L.append("-- Project")
    L.append("INSERT INTO projects (id, key, name, lead, type, created_at) VALUES")
    L.append(f"  ({sql_str(PROJECT_ID)}, {sql_str(PROJECT_KEY)}, {sql_str(PROJECT_NAME)}, "
             f"{sql_str(PM_LOGIN)}, 'classic', {sql_str(BASE_TS)});")
    L.append("")

    L.append("-- Issue types")
    L.append("INSERT INTO issue_types (id, name, handle, subtask) VALUES")
    L.append(",\n".join(f"  ({sql_str(i)}, {sql_str(n)}, {sql_str(h)}, {s})"
                        for i, n, h, s in ISSUE_TYPES) + ";")
    L.append("")

    L.append("-- Statuses")
    L.append("INSERT INTO issue_statuses (id, name, category) VALUES")
    L.append(",\n".join(f"  ({sql_str(i)}, {sql_str(n)}, {sql_str(c)})"
                        for i, n, c in STATUSES) + ";")
    L.append("")

    L.append("-- Priorities")
    L.append("INSERT INTO issue_priorities (id, name, sort_order) VALUES")
    L.append(",\n".join(f"  ({sql_str(i)}, {sql_str(n)}, {o})"
                        for i, n, o in PRIORITIES) + ";")
    L.append("")

    L.append("-- Workflow transitions (no direct To Do -> Done)")
    L.append("INSERT INTO transitions (from_status, to_status) VALUES")
    L.append(",\n".join(f"  ({sql_str(a)}, {sql_str(b)})" for a, b in TRANSITIONS) + ";")
    L.append("")

    L.append("-- Board + current sprint (context for `jira init` / `jira sprint list`)")
    L.append("INSERT INTO boards (id, name, type, project_key) VALUES")
    L.append(f"  ({sql_str(BOARD_ID)}, {sql_str(BOARD_NAME)}, 'scrum', {sql_str(PROJECT_KEY)});")
    L.append("INSERT INTO sprints (id, name, state, board_id, start_date, end_date) VALUES")
    L.append(f"  ({sql_str(SPRINT_ID)}, {sql_str(SPRINT_NAME)}, 'active', {sql_str(BOARD_ID)}, "
             f"'2026-05-18T00:00:00.000Z', '2026-06-01T00:00:00.000Z');")
    L.append("")

    L.append("-- Config")
    L.append("INSERT INTO config (key, value) VALUES")
    L.append(f"  ('default_project', {sql_str(PROJECT_KEY)}),")
    L.append(f"  ('issue_seq_{PROJECT_KEY}', '{len(ISSUES)}');")
    L.append("")

    # Backlog issues: all Bug, status To Do, priority untriaged (NULL), no
    # assignee/labels/components. All triage data is encoded in the description.
    L.append("-- Incoming supplier-defect backlog (To Do, untriaged). Reporter = PM.")
    L.append("INSERT INTO issues (id, key, project_key, type_id, summary, description, "
             "status_id, priority_id, assignee, reporter, labels_json, components_json, "
             "resolution, created_at, updated_at) VALUES")
    rows = []
    for idx, issue in enumerate(ISSUES):
        ts = f"2026-05-{25 + (idx // 9):02d}T{9 + (idx % 9):02d}:00:00.000Z"
        rows.append(
            f"  ({sql_str('1000' + str(issue['num']).zfill(2))}, {sql_str(key_of(issue['num']))}, "
            f"{sql_str(PROJECT_KEY)}, {sql_str(BUG_TYPE_ID)}, {sql_str(issue['summary'])}, "
            f"{sql_str(build_description(issue))}, {sql_str(TODO_STATUS_ID)}, NULL, '', "
            f"{sql_str(PM_LOGIN)}, '[]', '[]', '', {sql_str(ts)}, {sql_str(ts)})"
        )
    L.append(",\n".join(rows) + ";")
    L.append("")
    return "\n".join(L) + "\n"


# --------------------------------------------------------------------------- #
# Workspace artifacts
# --------------------------------------------------------------------------- #
def write_component_owners_csv():
    with (WORKSPACE / "component_owners.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["component", "owner_email", "team"])
        for comp in ["Packaging", "Engineering", "Compliance"]:
            w.writerow([comp, COMPONENT_OWNER[comp], COMPONENT_TEAM[comp]])


def write_policy():
    md = f"""# NorthBridge Accessories — Supplier-Defect Triage Policy (Project {PROJECT_KEY})

NorthBridge Accessories sources consumer-electronics accessories from contract
manufacturers and tracks every incoming supplier-quality defect report as a Jira
issue in the **{PROJECT_KEY}** ("{PROJECT_NAME}") project. New reports land in the
**To Do** column untriaged. This policy defines exactly how to triage them. Apply
it to **every issue currently in the To Do column** of {PROJECT_KEY}.

Each report's **description** states the product SKU and supplier, the
**Severity** (Critical / Major / Minor), the number of **affected units**, the
**regulatory status**, the defect **symptom**, the **root cause**, and a
**story-point** estimate (and, for a few issues, a "Blocked by" line). The reports
were written by different people at different times, so the **same underlying
defect can be described in very different words** — read each description in full
and judge it on what it actually says, not on matching phrases.
(`jira issue list --raw` returns every description in one shot;
`jira issue view {PROJECT_KEY}-3` shows one.)

## 1. Priority

First read the report's **affected units** and place it in a volume band:

- **High volume** — affected units **{VOLUME_HIGH_THRESHOLD} or more**.
- **Medium volume** — affected units **{VOLUME_MED_THRESHOLD} to {VOLUME_HIGH_THRESHOLD - 1}**.
- **Low volume** — affected units **fewer than {VOLUME_MED_THRESHOLD}**.

(Use the **affected units**, not the production-run size.) Then set the priority
from this matrix of **Severity × volume band**:

| Severity \\ Volume | High (≥ {VOLUME_HIGH_THRESHOLD}) | Medium ({VOLUME_MED_THRESHOLD}–{VOLUME_HIGH_THRESHOLD - 1}) | Low (< {VOLUME_MED_THRESHOLD}) |
|---|---|---|---|
| Critical | Highest | High   | Highest |
| Major    | High    | Medium | Low     |
| Minor    | Medium  | Low    | Lowest  |

**Note the Critical row.** A Critical defect at **Low** volume is **Highest** —
*higher* than the same Critical defect at Medium volume. A critical harm defect
seen on even a handful of units is an early-field-failure signal and is treated as
top priority. Do not assume lower volume always means lower priority.

### Regulatory override

If a report's **Regulatory status is "reportable"**, ignore the matrix above and
set its priority from this override table instead (volume does **not** matter):

| Severity | Priority (if regulatory-reportable) |
|---|---|
| Critical | Highest |
| Major    | Highest |
| Minor    | High    |

A report whose Regulatory status is "not reportable" always uses the §1 matrix.

Set the priority with: `jira issue edit <KEY> --priority <Priority>`

## 2. Component

Classify each report into exactly one defect type **by judging the symptom** — what
actually happens and what its consequence is — and then set the matching component.
Decide from the **symptom**, not from the product, the supplier, or the regulatory
flag, and not from any single word:

- **appearance** — an appearance- or marking-only flaw: the product still works
  as intended and cannot injure anyone (e.g. a scratch or scuff, a colour or
  shade mismatch, a hairline crack that does not affect use, a misprinted or
  missing label or mark, coating that flakes off).
- **function** — the product fails to do its job, but cannot injure the user
  (e.g. won't charge, drops the connection, the screen blanks, keys chatter, a
  port is intermittent, it runs warm but stays within its rating).
- **harm** — a defect that could injure the user or damage property (e.g. a
  surface that gets hot enough to burn or scorch, a battery that swells or vents,
  an exposed live conductor, an electric shock, a jagged edge that can cut).

| Defect type | Component |
|---|---|
| appearance | {DEFECT_COMPONENT['cosmetic']} |
| function | {DEFECT_COMPONENT['functional']} |
| harm | {DEFECT_COMPONENT['safety']} |

Judge by consequence, not vocabulary. The *same* word can fall in different
classes: a crack that still lets the product work normally is **appearance**, but
a crack that leaves an edge able to cut is **harm**; running "warm" within the
rated temperature is **function**, but getting hot enough to burn or scorch is
**harm**. A flaw that is regulatory-reportable is **not** automatically a harm
defect — a missing printed mark on a product that works and is otherwise fine is
an **appearance** flaw (it still uses the regulatory override in §1 for priority).

Set it with: `jira issue edit <KEY> --component <Component>`

## 3. Assignee

Assign each issue to the owner of its component (see also
`workspace/component_owners.csv`):

| Component | Owner |
|---|---|
| {('Packaging')} | {COMPONENT_OWNER['Packaging']} |
| {('Engineering')} | {COMPONENT_OWNER['Engineering']} |
| {('Compliance')} | {COMPONENT_OWNER['Compliance']} |

Assign it with: `jira issue assign <KEY> <owner-email>`

## 4. Duplicates

Some reports describe the **same defect** more than once, in different words. Two
reports are **duplicates only if they are the same underlying defect** — the same
physical failure with the same root cause. Judge this by **meaning**, because the
wording, the symptoms quoted, the affected-unit counts, and even the product can
all differ between two reports of one defect. In particular:

- **The same defect can appear on different SKUs.** A shared component, material
  batch, or production process can fail across several products; if two reports
  are the same failure with the same root cause, they are duplicates **even on
  different SKUs**.
- **Surface similarity does not make a duplicate.** Two reports that share a SKU,
  a supplier, or a symptom word but describe **different** failures with
  **different** root causes are **not** duplicates. (For example, two different
  problems on the same product, or two unrelated products that both merely "run
  warm" or both have "a port" issue, are not duplicates.)

For each duplicate pair, treat the **lower-numbered** issue as the canonical one
to keep, and for the **higher-numbered** issue:

1. Link it to the canonical issue as a **"Duplicates"** link:
   `jira issue link <HIGHER-KEY> <CANONICAL-KEY> "Duplicates"`
2. Close it by transitioning it to the **Done** state with `jira issue move`.
   Follow the project workflow — `jira issue move` rejects any transition the
   workflow does not allow and lists the valid next states, so move through the
   allowed states to reach Done.

Do **not** triage (priority/component/assignee) or commit the closed duplicate;
all triage for that defect stays on the canonical issue, which remains open and
**is** triaged per sections 1–3.

## 5. Commit issues to Cycle 7

The next delivery cycle, **Cycle 7**, has a capacity of **{CYCLE_CAPACITY} story
points**. Tag every issue you commit to Cycle 7 with the label **`{CYCLE_LABEL}`**.
Select the committed issues with this procedure, exactly:

1. Consider only **non-duplicate** issues. An issue you closed as a duplicate is
   never committed.
2. Sort the candidates by **priority, highest first** (Highest → High → Medium →
   Low → Lowest). Within the same priority, order by **story points, fewest
   first**; break any remaining tie by issue number, lowest first.
3. Walk the sorted list keeping a running point total. For each issue: if adding
   its points keeps the total **at or under {CYCLE_CAPACITY}**, commit it and add
   its points to the total; if it would exceed {CYCLE_CAPACITY}, **skip it and keep
   checking** the remaining issues — a later, smaller issue may still fit.
4. **Blocker rule.** Some reports have a **"Blocked by <KEY>"** line. After the
   fill above, remove from the committed set any issue whose blocker is **not**
   itself in the committed set. Removing a blocked issue does **not** free
   capacity for new ones — do not re-run the fill or back-fill the freed points.

Tag a committed issue with: `jira issue edit <KEY> --label {CYCLE_LABEL}`

## 6. Recording

All of your work is recorded directly in Jira (priorities, components, assignees,
duplicate links, transitions, and the `{CYCLE_LABEL}` labels). There is no separate
report file to write.
"""
    (WORKSPACE / "triage_policy.md").write_text(md, encoding="utf-8")


# --------------------------------------------------------------------------- #
# Build-time integrity cross-checks
# --------------------------------------------------------------------------- #
def leak_scan_fields():
    """Assert no answer-word leaks in any agent-visible per-issue free text."""
    problems = []
    for i in ISSUES:
        fields = [("summary", i["summary"]), ("symptom", i["symptom"]),
                  ("cause", i["cause"])]
        if i.get("blk_reason"):
            fields.append(("blk_reason", i["blk_reason"]))
        for fname, text in fields:
            low = text.lower()
            for w in LEAK_WORDS:
                if re.search(rf"\b{re.escape(w)}\b", low):
                    problems.append((key_of(i["num"]), fname, w))
            for w in LEAK_WORDS_STRICT:
                if re.search(rf"\b{re.escape(w)}\b", low):
                    problems.append((key_of(i["num"]), fname, w))
    assert not problems, f"answer-word leak(s) in agent-visible text: {problems}"


def main():
    by_num = {i["num"]: i for i in ISSUES}

    # (1) declared priorities match the matrix/override (catch typos).
    for i in ISSUES:
        if i["intended"] is None:
            continue
        got = priority_of(i)
        assert got == i["intended"], (
            f"{key_of(i['num'])}: rule gives {got} but intended {i['intended']} "
            f"(sev={i['severity']} units={i['units']} reg={i.get('reg')})")

    # (2) duplicate grouping by rc token == exactly the intended pairs; the two
    # halves of every true pair are SEMANTICALLY equal but LEXICALLY DIFFERENT
    # (the whole point of the rebuild — no copy-pasted root-cause string).
    groups = {}
    for i in ISSUES:
        groups.setdefault(i["rc"], []).append(i["num"])
    derived_pairs = []
    for rc, nums in groups.items():
        nums = sorted(nums)
        assert len(nums) <= 2, f"unexpected >2 issues sharing root cause {rc}: {nums}"
        if len(nums) == 2:
            a, b = nums
            assert by_num[a]["cause"] != by_num[b]["cause"], (
                f"paired {key_of(a)}~{key_of(b)} must NOT share a verbatim root cause")
            assert by_num[a]["symptom"] != by_num[b]["symptom"], (
                f"paired {key_of(a)}~{key_of(b)} must NOT share a verbatim symptom")
            derived_pairs.append((b, a))  # (higher=dup, lower=canon)
    derived_pairs.sort()
    DUPLICATE_PAIRS = derived_pairs
    dup_nums, canon_nums = set(), set()
    for dup, canon in DUPLICATE_PAIRS:
        assert canon < dup, f"canonical {key_of(canon)} must be lower than {key_of(dup)}"
        dup_nums.add(dup)
        canon_nums.add(canon)
    assert len(DUPLICATE_PAIRS) == 8, f"expected 8 true pairs, got {len(DUPLICATE_PAIRS)}"

    # (3) distractor issues are real singletons (unique rc), are NOT part of any
    # true pair, and their lures are genuinely different defects (different rc).
    for d in DISTRACTOR_KEYS:
        assert d not in dup_nums and d not in canon_nums, f"distractor {key_of(d)} overlaps a real pair"
        for lure in DISTRACTOR_LURES[d]:
            assert by_num[d]["rc"] != by_num[lure]["rc"], (
                f"distractor {key_of(d)} shares an rc with its lure {key_of(lure)}")
            assert by_num[d]["cause"] != by_num[lure]["cause"]

    # (4) anti-leak: no answer words in agent-visible per-issue text.
    leak_scan_fields()

    # (5) token-overlap is NOT a usable signal: the true-pair and distractor
    # surface-overlap ranges INTERLEAVE, so no single Jaccard threshold separates
    # them. Any threshold low enough to catch the low-overlap (cross-SKU) true
    # pairs also wrongly merges high-overlap distractors, and any threshold high
    # enough to exclude those distractors also misses those true pairs. This is
    # what forces SEMANTIC judgement instead of token matching.
    true_j = {(c, d): jaccard(by_num[c], by_num[d]) for d, c in DUPLICATE_PAIRS}
    lure_j = {}
    for d in DISTRACTOR_KEYS:
        for lure in DISTRACTOR_LURES[d]:
            lure_j[(d, lure)] = jaccard(by_num[d], by_num[lure])
    min_true, max_true = min(true_j.values()), max(true_j.values())
    max_lure = max(lure_j.values())
    assert max_lure > min_true, (
        f"distractor overlap ({max_lure:.3f}) must exceed the lowest true-pair "
        f"overlap ({min_true:.3f}) so no Jaccard threshold separates them")
    # and at least three true pairs must sit BELOW the most-overlapping distractor
    # (a token matcher tuned to avoid that distractor misses all of them).
    n_below = sum(1 for j in true_j.values() if j < max_lure)
    assert n_below >= 3, f"only {n_below} true pairs below the top distractor overlap"

    # (6) cycle levers all fire (skip-continue, near-tie, blocker, naive-diff).
    non_dupes = [i for i in ISSUES if i["num"] not in dup_nums]
    committed, total, ordered, pre = compute_committed(non_dupes, by_num)
    overflow = [i["num"] for i in non_dupes if i["num"] not in committed]
    assert total <= CYCLE_CAPACITY, f"committed total {total} exceeds capacity {CYCLE_CAPACITY}"

    skip_used, seen_skip, run = False, False, 0
    for i in ordered:
        if run + i["points"] <= CYCLE_CAPACITY:
            if seen_skip:
                skip_used = True
            run += i["points"]
        else:
            seen_skip = True
    assert skip_used, "skip-and-continue is not exercised by the data"
    assert 25 in pre and 25 not in committed and 24 not in committed, "blocker rule not exercised"
    assert 27 in committed and 26 not in committed, "near-tie winner/loser wrong"
    alt = (set(committed) - {27}) | {26}
    assert sum(by_num[n]["points"] for n in alt) <= CYCLE_CAPACITY, "near-tie alternative does not fit"
    # no-back-fill is load-bearing: PROJ-7 (Low, 2pts) would fit the spare capacity
    # after the blocker drop, but the rule forbids back-filling it.
    assert 7 not in committed and total + by_num[7]["points"] <= CYCLE_CAPACITY, "no-back-fill guard not exercised"

    naive_keyorder, _ = fill_skip_continue(sorted(non_dupes, key=lambda i: i["num"]), CYCLE_CAPACITY)
    naive_priokey, _ = fill_skip_continue(
        sorted(non_dupes, key=lambda i: (PRIORITY_RANK[priority_of(i)], i["num"])), CYCLE_CAPACITY)
    assert set(naive_keyorder) != set(committed) and set(naive_priokey) != set(committed), \
        "naive strategies coincide with the correct set"

    # (7) scored-set sanity.
    for n in SCORED["committed_keys"]:
        assert n in committed, f"scored committed {key_of(n)} not in GOLD committed"
    for n in SCORED["not_committed_keys"]:
        assert n not in committed, f"scored not-committed {key_of(n)} IS in GOLD committed"
    for n in SCORED["component_keys"] + SCORED["assignee_keys"] + SCORED["priority_keys"]:
        assert n not in dup_nums, f"scored triage key {key_of(n)} is a closed duplicate"
    # component coverage spans all three classes; assignee spans all three owners.
    assert {component_of(by_num[n]) for n in SCORED["component_keys"]} == set(DEFECT_COMPONENT.values())
    assert {component_of(by_num[n]) for n in SCORED["assignee_keys"]} == set(DEFECT_COMPONENT.values())

    # ----- emit artifacts ---------------------------------------------------
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    MOCK_RUNTIME.mkdir(parents=True, exist_ok=True)
    (MOCK_RUNTIME / "jira_seed.sql").write_text(build_seed_sql(), encoding="utf-8")
    write_policy()
    write_component_owners_csv()

    triage = [{
        "key": key_of(i["num"]),
        "priority": priority_of(i),
        "component": component_of(i),
        "assignee": owner_of(i),
    } for i in non_dupes]
    expected = {
        "project_key": PROJECT_KEY,
        "server": SERVER,
        "pm_login": PM_LOGIN,
        "board_id": BOARD_ID,
        "cycle_label": CYCLE_LABEL,
        "cycle_capacity": CYCLE_CAPACITY,
        "closed_state": "Done",
        "duplicate_link_type": "Duplicates",
        "triage": triage,
        "duplicates": [{"duplicate": key_of(d), "canonical": key_of(c)} for d, c in DUPLICATE_PAIRS],
        "canonical_keys": [key_of(c) for c in sorted(canon_nums)],
        "distractor_pairs": [[key_of(d), key_of(lure)] for d in DISTRACTOR_KEYS for lure in DISTRACTOR_LURES[d]],
        "committed_keys": [key_of(n) for n in sorted(committed)],
        "committed_points": total,
        "overflow_keys": [key_of(n) for n in sorted(overflow)],
        "blocked_by": {key_of(i["num"]): key_of(i["blk"]) for i in ISSUES if i.get("blk")},
        "scored": {k: [key_of(n) for n in v] for k, v in SCORED.items()},
    }
    (HERE / "expected_answer.json").write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")

    # gold annotations (semantic truth) for the offline gold/single-slip solvers.
    annotations = {
        "duplicate_pairs": [[key_of(d), key_of(c)] for d, c in DUPLICATE_PAIRS],
        "distractor_lures": {key_of(d): [key_of(x) for x in v] for d, v in DISTRACTOR_LURES.items()},
        "hard_component_keys": [key_of(n) for n in HARD_COMPONENT_KEYS],
        "issues": {key_of(i["num"]): {
            "defect": i["defect"], "rc": i["rc"], "severity": i["severity"],
            "units": i["units"], "reg": int(bool(i.get("reg"))), "points": i["points"],
            "blk": (key_of(i["blk"]) if i.get("blk") else None),
            "is_duplicate": i["num"] in dup_nums, "is_canonical": i["num"] in canon_nums,
        } for i in ISSUES},
    }
    (HERE / "gold_annotations.json").write_text(json.dumps(annotations, indent=2) + "\n", encoding="utf-8")

    # ----- author-review summary -------------------------------------------
    n_checks = (1 + len(SCORED["priority_keys"]) + len(SCORED["component_keys"])
                + len(SCORED["assignee_keys"]) + 2 * len(DUPLICATE_PAIRS) + 1
                + 2 * len(SCORED["distractor_keys"]) + len(SCORED["committed_keys"])
                + len(SCORED["not_committed_keys"]))
    n_semantic = len(DUPLICATE_PAIRS) + len(DISTRACTOR_KEYS) + len(SCORED["component_keys"])
    print(f"project={PROJECT_KEY} issues={len(ISSUES)} non_dupes={len(non_dupes)} "
          f"capacity={CYCLE_CAPACITY} committed_pts={total} checks={n_checks}")
    print(f"independent semantic calls ~ {n_semantic}  "
          f"(8 true-dup merges + {len(DISTRACTOR_KEYS)} distractor rejects + "
          f"{len(SCORED['component_keys'])} component-from-narrative)")
    print(f"{'key':8} {'sev':9} {'units':>5} {'vol':>6} {'reg':>3} {'defect':10} "
          f"{'PRIORITY':8} {'COMPONENT':11} {'pts':>3} role")
    for i in ISSUES:
        if i["num"] in dup_nums:
            role = f"DUP->{key_of(next(c for d, c in DUPLICATE_PAIRS if d == i['num']))}"
            pr = comp = "-"
        else:
            role = "commit" if i["num"] in committed else "overflow"
            if i["num"] in canon_nums:
                role = "canon/" + role
            if i["num"] in DISTRACTOR_KEYS:
                role = "distract/" + role
            pr, comp = priority_of(i), component_of(i)
        print(f"{key_of(i['num']):8} {i['severity']:9} {i['units']:>5} "
              f"{volume_band(i['units']):>6} {('Y' if i.get('reg') else '-'):>3} {i['defect']:10} "
              f"{pr:8} {comp:11} {i['points']:>3} {role}")
    print(f"\ncommitted ({total} pts): {expected['committed_keys']}")
    print(f"overflow:               {expected['overflow_keys']}")
    print(f"duplicates:             {[(key_of(d), key_of(c)) for d, c in DUPLICATE_PAIRS]}")
    print(f"naive key-order set:    {sorted(naive_keyorder)}")
    print(f"naive prio+key set:     {sorted(naive_priokey)}")
    print("\ntoken-overlap (Jaccard) — TRUE pairs (want LOW):")
    for (c, d), j in sorted(true_j.items()):
        print(f"  {key_of(c)}~{key_of(d)}  {j:.3f}")
    print("token-overlap (Jaccard) — DISTRACTOR->lure (want some HIGH):")
    for (d, lure), j in sorted(lure_j.items(), key=lambda kv: -kv[1]):
        print(f"  {key_of(d)}~{key_of(lure)}  {j:.3f}")
    print(f"\nTRUE-pair Jaccard range = [{min_true:.3f}, {max_true:.3f}]; "
          f"max DISTRACTOR Jaccard = {max_lure:.3f}  "
          f"({n_below} true pairs sit below the top distractor -> no threshold separates them)")


if __name__ == "__main__":
    main()
