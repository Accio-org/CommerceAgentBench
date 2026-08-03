#!/usr/bin/env python3
"""Deterministic data generator for cli-box-supplier-docroom-audit (scope-coverage edition).

Emits, from a single spec-driven supplier/file table:
  workspace/compliance_policy.md          agent-visible policy (objective criteria,
                                          audit date, filename convention, the
                                          entity-by-USCC + SCOPE-COVERAGE rule, the
                                          required Box actions)
  workspace/supplier_directory.csv        agent-visible folder -> token + city +
                                          PRODUCT LINE (what NorthBridge sources
                                          from each supplier for this program)
  private/mock_runtime/box_seed.sql       box_cli DB seed (users + Suppliers/ tree +
                                          all files w/ planted conditions baked into
                                          file names AND file contents + auth_session)
  private/expected_answer.json            ground truth (NEVER shipped to the container)

The box_cli mock persists to a bun:sqlite DB under $BOX_MOCK_HOME. The seed
mirrors the column shape of mock_services/box_cli/seeds/default.sql exactly, and
begins by wiping every table (box-bench reset re-seeds the default fixture first,
so this seed must clear it) in the same child->parent order box-bench uses.

DESIGN — the GATE IS A GENUINE SEMANTIC SCOPE-COVERAGE JUDGMENT
==============================================================
The supplier's status is recorded ENTIRELY in the Box state the agent produces
(a shared link on a compliant folder; a task + a viewer collaboration on a
non-compliant folder). There is no separate summary file — the Box changes ARE
the deliverable, so the score is discriminated by the JUDGMENT, not by whether
the agent remembers to write an artifact under a tight budget.

The LOAD-BEARING DISCRIMINATOR is SCOPE COVERAGE. Each supplier's ISO 9001
certificate states a **certified scope in free text** (e.g. "Anodizing and
surface finishing of architectural aluminium extrusion profiles"). The supplier's
ACTUAL product line for this program (listed in supplier_directory.csv) must fall
WITHIN that certified scope for the cert to count. Whether a scope COVERS a
product line is a genuine SEMANTIC judgment over free text — there is NO clean
field to extract and no substring rule that decides it; it requires reading the
documents and reasoning about product class, process and value-chain position.

This is the deliberate pivot away from the predecessor (USCC entity-matching)
edition: USCC matching is clean printed-key extraction, which a mid-tier model
systematises at ~99.5%/call and therefore ACES at scale. Scope coverage cannot be
reduced to field extraction, so a model that leans on surface lexical similarity
mis-judges it. We plant **18 independent scope-coverage judgments**, each
load-bearing (mis-judging it flips that supplier's compliance status and so fails
>=1 binary check) and each resolvable ONLY by reading the certificate BODY (its
scope of certification) together with the directory's product line.

The 18 scope judgments are built with CONFOUNDERS that defeat keyword / surface
matching. The 2x2 of (lexical overlap) x (true coverage) is fully populated, so
no overlap threshold separates covered from not-covered:

  plain covered            scope plainly names the product class (high overlap,
   (covered, x4)           covered). Control: a surface matcher gets these RIGHT.
  broader-category         scope names a BROADER category the product clearly
   (covered, x4)           belongs to, with NO shared distinctive words (e.g.
                           "consumer-electronics accessories and desktop
                           peripherals" covers "laptop risers and monitor
                           stands"). Defeats keyword-overlap (false NEGATIVE) and
                           category-phrase presence.
  sounds-related-but-not   scope SOUNDS related (shares material/process words)
   (non-compliant, x5)     but certifies a DIFFERENT product class (architectural
                           profiles / automotive seals / furniture hardware /
                           appliance enclosures / architectural luminaires) ->
                           NOT covered. Defeats keyword-overlap (false POSITIVE).
  near-miss process        same material, the cert's certified PROCESS is not the
   (non-compliant, x2)     one the product needs (extrusion vs die-casting) ->
                           NOT covered. Defeats keyword-overlap (false POSITIVE).
  process/class not-product the cert covers a material/process or upstream product
   (non-compliant, x3)      the supplier's product is not (metal stamping for a
                            plastic part / industrial harnesses / raw feedstock)
                            -> NOT covered. Defeats a scope-ignoring matcher.
                            (raw-feedstock shares 'aluminium' -> also false POSITIVE.)

Kept as SECONDARY present signals (still scored, but no longer the
discriminator — a mid-tier model already aces them): the USCC entity-match family
(renamed entity / clerical typo / sister company / expired-own + current-sister)
and the mechanical/filename-date traps (boundary currency, a two-way ISO 9001
mis-shelve swap + a Factory Audit shelved in the wrong folder, a corporate group
cert that belongs nowhere, a wrong-standard ISO 14001, a lapsed+current pair, a
missing Business License). A supplier is compliant only if: a Business License is
on file AND an ISO 9001 that is (a) current, (b) issued to this supplier's own
entity by USCC, and (c) **whose scope covers the supplier's product line** AND a
Factory Audit Report is on file.

FAIRNESS / DETERMINISM
======================
Coverage cannot be re-derived by any mechanical rule (that is the whole point), so
each scope-coverage judgment carries an AUTHORED ground-truth label (`covered`)
plus the decisive domain reasoning. The label is the source of truth; it is baked
ONLY into the private ground truth (this file -> expected_answer.json) and the
fairness doc (scratch/scripts/box_scope_fairness.json), NEVER into anything the
agent sees. The agent-visible surface carries only the neutral certified-scope
text and the neutral product line; it must JUDGE coverage. Each call has a UNIQUE
defensible answer determinable by a careful domain reader (clearly covers /
clearly does not, once reasoned — never genuinely debatable); the offline gold
solver reproduces expected_answer, the naive keyword-overlap and scope-ignored
solvers fail, and the single-slip probe proves each call independently
load-bearing (see scratch/scripts/box_solver_check.py and box_single_slip.py).

The agent-visible policy states the objective criteria (currency, entity-by-USCC,
scope coverage, keep the room correctly filed) but does NOT enumerate which files
are the traps and does NOT name which suppliers are tricky.
"""
import csv
import json
import hashlib
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASK = HERE.parent
WORKSPACE = TASK / "workspace"
MOCK_RUNTIME = HERE / "mock_runtime"

AUDIT_DATE = date(2026, 5, 30)
QA_LOGIN = "qa-review@northbridge.example.com"
QA_USER_ID = "10009"
TASK_DUE_AT = "2026-06-06T17:00:00Z"
ADMIN_USER_ID = "10001"
ADMIN_LOGIN = "compliance@northbridge.example.com"
SUPPLIERS_ROOT_ID = "20000"
AUTH_TOKEN = "mock-box-token-bench"
TS = "2026-05-20T09:00:00Z"


def cover_scope(product_line: str) -> str:
    """A neutral certified-scope line that plainly covers the given product line.

    Used for every supplier whose discriminator is NOT scope (entity / mechanical
    cases) so that the only thing keeping them off `compliant` is their own
    planted defect, never an accidental scope failure.
    """
    return f"Design and manufacture of {product_line}"


# Region codes used to build plausible 18-char USCCs (real codes embed a 6-digit
# administrative-division code). Per city of registration.
CITY_REGION = {
    "Shenzhen": "440300", "Dongguan": "441900", "Ningbo": "330200",
    "Foshan": "440600", "Quanzhou": "350500", "Xiamen": "350200",
    "Zhongshan": "442000", "Huizhou": "441300", "Shantou": "440500",
    "Jiangmen": "440700", "Guangzhou": "440100", "Zhuhai": "440400",
    "Meizhou": "441400", "Zhangzhou": "350600", "Chaozhou": "445100",
    "Heyuan": "441600", "Qingyuan": "441800", "Shaoguan": "440200",
    "Yangjiang": "441700", "Putian": "350300",
}
# USCC body alphabet (real USCCs use 0-9 and uppercase letters excluding I,O,S,V,Z).
USCC_ALPHABET = "0123456789ABCDEFGHJKLMNPQRTUWXY"  # 31 chars


def make_uscc(region: str, seedkey: str) -> str:
    """Deterministic, plausible 18-char USCC: '91' + region(6) + body(10)."""
    h = int(hashlib.sha1(seedkey.encode("utf-8")).hexdigest(), 16)
    body = []
    for _ in range(10):
        body.append(USCC_ALPHABET[h % len(USCC_ALPHABET)])
        h //= len(USCC_ALPHABET)
    return "91" + region + "".join(body)


def make_address(seedkey: str, city: str) -> str:
    h = int(hashlib.sha1(("addr:" + seedkey).encode("utf-8")).hexdigest(), 16)
    num = 1 + (h % 800)
    streets = ["Jinsha", "Huaqiang", "Binhai", "Gongye", "Keji", "Changjiang",
               "Renmin", "Xinghe", "Yuanqu", "Chuangye"]
    street = streets[(h // 800) % len(streets)]
    block = 1 + ((h // 8000) % 12)
    return f"No. {num} {street} Road, Block {block}, {city}"


def future_exp(i: int) -> date:
    """Deterministic, clearly-current ISO expiry (always >> audit date)."""
    year = 2027 + (i % 2)              # 2027 or 2028
    month = 1 + (i * 5) % 12
    day = 1 + (i * 11) % 27
    return date(year, month, day)


def past_exp(i: int) -> date:
    """Deterministic, clearly-lapsed ISO expiry (well before the audit date)."""
    month = 1 + (i * 3) % 12
    day = 1 + (i * 7) % 27
    return date(2025, month, day)


def rename_note(former: str, current: str) -> str:
    return (f"Issued under the organization's former registered name ({former}). "
            f"The organization has since been renamed {current}; the Unified "
            f"Social Credit Code is unchanged.")


# --------------------------------------------------------------------------- #
# Supplier spec — one row per supplier folder.
#
#   group : "scope" | "entity" | "mech"  (documentation / which validators care)
#   case  : selects how its documents are generated (see build_world()).
#   For scope rows:
#     product_line : the agent-visible product line (-> directory)
#     scope        : the agent-visible certified scope text (-> cert body)
#     covered      : AUTHORED ground truth (does the scope cover the product line?)
#     confounder   : which confounder family
#     reasoning    : the decisive domain reasoning (-> fairness doc, NOT shipped)
#     wrong        : the surface heuristic this case defeats (-> fairness doc)
#   `expected` is cross-checked against the computed status so any drift fails the
#   build loudly.
# --------------------------------------------------------------------------- #
SPEC = [
    # ===================== SCOPE-COVERAGE JUDGMENTS (18) ===================== #
    # ---- plain covered (high lexical overlap, covered) — surface-matcher OK. ----
    {"group": "scope", "case": "scope_call", "token": "ShenzhenClipStand",
     "folder": "Shenzhen ClipStand", "city": "Shenzhen",
     "legal": "Shenzhen ClipStand Electronics Co., Ltd.",
     "product_line": "aluminium phone stands and tablet mounts",
     "scope": "Design and manufacture of aluminium mobile-phone stands, tablet mounts and laptop risers",
     "covered": True, "expected": "compliant", "confounder": "plain covered",
     "reasoning": ("The certified scope explicitly names mobile-phone stands and tablet mounts — exactly "
                   "the supplier's product line. The scope plainly covers the products. COVERED."),
     "wrong": "A surface matcher gets this right; it is a positive control proving the gate is not 'reject everything'."},
    {"group": "scope", "case": "scope_call", "token": "DongguanSoftShell",
     "folder": "Dongguan SoftShell", "city": "Dongguan",
     "legal": "Dongguan SoftShell Electronics Co., Ltd.",
     "product_line": "silicone phone cases and earbud grips",
     "scope": "Manufacture of silicone protective cases, grips and sleeves for smartphones and wireless earbuds",
     "covered": True, "expected": "compliant", "confounder": "plain covered",
     "reasoning": ("The scope names silicone protective cases and grips for smartphones and earbuds — the "
                   "supplier's exact products. COVERED."),
     "wrong": "Positive control (high overlap, covered)."},
    {"group": "scope", "case": "scope_call", "token": "HuizhouGlassGuard",
     "folder": "Huizhou GlassGuard", "city": "Huizhou",
     "legal": "Huizhou GlassGuard Electronics Co., Ltd.",
     "product_line": "tempered-glass screen protectors",
     "scope": "Manufacture of tempered-glass screen protectors and camera-lens films for smartphones",
     "covered": True, "expected": "compliant", "confounder": "plain covered",
     "reasoning": ("The scope names tempered-glass screen protectors for smartphones — the supplier's exact "
                   "product. COVERED."),
     "wrong": "Positive control (high overlap, covered)."},
    {"group": "scope", "case": "scope_call", "token": "XiamenBrightFin",
     "folder": "Xiamen BrightFin", "city": "Xiamen",
     "legal": "Xiamen BrightFin Electronics Co., Ltd.",
     "product_line": "anodized aluminium phone stands",
     "scope": "Design and manufacture of anodized aluminium stands and holders for smartphones and tablets",
     "covered": True, "expected": "compliant", "confounder": "plain covered (finish control)",
     "reasoning": ("The scope is the manufacture of anodized aluminium stands FOR SMARTPHONES — the finished "
                   "consumer product the supplier makes. COVERED. (Deliberate control paired with the "
                   "'architectural anodizing' false-friend below: same material+finish words, but here the "
                   "certified product class is consumer phone stands, so it covers.)"),
     "wrong": "Positive control that shares material/finish words with the architectural false-friend case."},

    # ---- broader-category covered (NO shared distinctive words, covered) ----
    {"group": "scope", "case": "scope_call", "token": "NingboDeskNest",
     "folder": "Ningbo DeskNest", "city": "Ningbo",
     "legal": "Ningbo DeskNest Electronics Co., Ltd.",
     "product_line": "aluminium laptop risers and monitor stands",
     "scope": "Design and manufacture of consumer-electronics accessories and desktop peripherals",
     "covered": True, "expected": "compliant", "confounder": "broader category",
     "reasoning": ("Laptop risers and monitor stands are consumer-electronics desktop accessories/peripherals; "
                   "the certified scope's category explicitly includes consumer-electronics accessories and "
                   "desktop peripherals, so the product line is a clear member of it. COVERED — even though the "
                   "scope shares no distinctive words with 'laptop risers' / 'monitor stands'."),
     "wrong": "Keyword-overlap (no shared words) wrongly rejects -> FALSE NEGATIVE."},
    {"group": "scope", "case": "scope_call", "token": "FoshanHoldFast",
     "folder": "Foshan HoldFast", "city": "Foshan",
     "legal": "Foshan HoldFast Electronics Co., Ltd.",
     "product_line": "magnetic phone car holders and dashboard cradles",
     "scope": "Manufacture of mobile-device mounting hardware and supports",
     "covered": True, "expected": "compliant", "confounder": "broader category",
     "reasoning": ("Phone car holders and dashboard cradles ARE mobile-device mounting hardware/supports — a "
                   "direct member of the certified category. COVERED, with no shared distinctive words."),
     "wrong": "Keyword-overlap wrongly rejects -> FALSE NEGATIVE."},
    {"group": "scope", "case": "scope_call", "token": "QuanzhouWireWeave",
     "folder": "Quanzhou WireWeave", "city": "Quanzhou",
     "legal": "Quanzhou WireWeave Electronics Co., Ltd.",
     "product_line": "USB-C charging leads and desk cable tidies",
     "scope": "Manufacture of consumer-electronics connectivity products and wire-management accessories",
     "covered": True, "expected": "compliant", "confounder": "broader category",
     "reasoning": ("USB-C charging leads are consumer-electronics connectivity products; desk cable tidies are "
                   "wire-management accessories. Both product lines are members of the certified categories. "
                   "COVERED, with no shared distinctive words."),
     "wrong": "Keyword-overlap wrongly rejects -> FALSE NEGATIVE."},
    {"group": "scope", "case": "scope_call", "token": "ZhongshanPodCharge",
     "folder": "Zhongshan PodCharge", "city": "Zhongshan",
     "legal": "Zhongshan PodCharge Electronics Co., Ltd.",
     "product_line": "wireless earbud charging cases",
     "scope": "Manufacture of consumer-electronics accessories and portable power products",
     "covered": True, "expected": "compliant", "confounder": "broader category",
     "reasoning": ("A wireless earbud charging case is both a consumer-electronics accessory and a portable "
                   "power product — a clear member of the certified categories. COVERED, no shared distinctive "
                   "words."),
     "wrong": "Keyword-overlap wrongly rejects -> FALSE NEGATIVE."},

    # ---- sounds-related-but-not (shared material/process words, NOT covered) ----
    {"group": "scope", "case": "scope_call", "token": "ShantouAnoTech",
     "folder": "Shantou AnoTech", "city": "Shantou",
     "legal": "Shantou AnoTech Electronics Co., Ltd.",
     "product_line": "anodized aluminium laptop risers",
     "scope": "Anodizing and surface finishing of architectural aluminium extrusion profiles and curtain-wall sections",
     "covered": False, "expected": "non_compliant", "confounder": "sounds-related (architectural)",
     "reasoning": ("The certificate certifies an anodizing / surface-finishing activity applied to ARCHITECTURAL "
                   "aluminium profiles and curtain-wall sections — a building-materials product class and a "
                   "finishing service, not the manufacture of finished consumer-electronics accessories. Despite "
                   "the shared words 'anodized'/'aluminium', the certified product class (architectural profiles) "
                   "and value-chain position (surface-finishing service) differ from finished laptop risers. "
                   "NOT COVERED."),
     "wrong": "Keyword-overlap ('anodized','aluminium') wrongly accepts -> FALSE POSITIVE."},
    {"group": "scope", "case": "scope_call", "token": "JiangmenSealRite",
     "folder": "Jiangmen SealRite", "city": "Jiangmen",
     "legal": "Jiangmen SealRite Electronics Co., Ltd.",
     "product_line": "silicone phone grips and earbud sleeves",
     "scope": "Manufacture of silicone gaskets, seals and vibration-damping components for automotive powertrain assemblies",
     "covered": False, "expected": "non_compliant", "confounder": "sounds-related (automotive)",
     "reasoning": ("The certificate certifies silicone AUTOMOTIVE sealing and damping COMPONENTS (gaskets, seals) "
                   "for powertrain assemblies — an automotive-parts product class, not consumer-electronics "
                   "accessories. Shared word 'silicone' only. NOT COVERED."),
     "wrong": "Keyword-overlap ('silicone') wrongly accepts -> FALSE POSITIVE."},
    {"group": "scope", "case": "scope_call", "token": "ZhuhaiCastWell",
     "folder": "Zhuhai CastWell", "city": "Zhuhai",
     "legal": "Zhuhai CastWell Electronics Co., Ltd.",
     "product_line": "die-cast zinc alloy phone stands",
     "scope": "Die-casting of zinc alloy fittings and components for furniture and cabinet hardware",
     "covered": False, "expected": "non_compliant", "confounder": "sounds-related (furniture hardware)",
     "reasoning": ("The certificate certifies zinc-alloy die-casting for FURNITURE and cabinet hardware — a "
                   "furniture-hardware product class, not consumer-electronics accessories. Shared words "
                   "'die-cast','zinc','alloy'. Different product class. NOT COVERED."),
     "wrong": "Keyword-overlap ('die-cast','zinc','alloy') wrongly accepts -> FALSE POSITIVE."},
    {"group": "scope", "case": "scope_call", "token": "GuangzhouMouldPro",
     "folder": "Guangzhou MouldPro", "city": "Guangzhou",
     "legal": "Guangzhou MouldPro Electronics Co., Ltd.",
     "product_line": "injection-moulded ABS charging docks",
     "scope": "Manufacture of injection-moulded ABS enclosures for kitchen and bathroom electrical appliances",
     "covered": False, "expected": "non_compliant", "confounder": "sounds-related (appliances)",
     "reasoning": ("The certificate certifies injection-moulded enclosures for KITCHEN and BATHROOM electrical "
                   "appliances (a domestic-appliance product class) — not consumer-electronics accessories such "
                   "as charging docks. Shared words 'injection-moulded','ABS'. Different product class. "
                   "NOT COVERED."),
     "wrong": "Keyword-overlap ('injection-moulded','ABS') wrongly accepts -> FALSE POSITIVE."},
    {"group": "scope", "case": "scope_call", "token": "ShaoguanLumaFix",
     "folder": "Shaoguan LumaFix", "city": "Shaoguan",
     "legal": "Shaoguan LumaFix Electronics Co., Ltd.",
     "product_line": "LED ring lights and clip-on phone fill lights",
     "scope": "Design and manufacture of LED luminaires and fixtures for commercial architectural lighting",
     "covered": False, "expected": "non_compliant", "confounder": "sounds-related (architectural lighting)",
     "reasoning": ("The certificate certifies commercial ARCHITECTURAL lighting luminaires and fixtures (a "
                   "building-lighting product class) — not portable consumer ring-lights / clip-on phone fill "
                   "lights. Shared word 'LED'. Different product class. NOT COVERED."),
     "wrong": "Keyword-overlap ('LED') wrongly accepts -> FALSE POSITIVE."},

    # ---- near-miss process (same material, wrong certified process, NOT covered) ----
    {"group": "scope", "case": "scope_call", "token": "ZhangzhouFormAlu",
     "folder": "Zhangzhou FormAlu", "city": "Zhangzhou",
     "legal": "Zhangzhou FormAlu Electronics Co., Ltd.",
     "product_line": "die-cast aluminium phone stands with integral hinge",
     "scope": "Manufacture of aluminium components by extrusion and profile drawing",
     "covered": False, "expected": "non_compliant", "confounder": "near-miss process",
     "reasoning": ("The product is DIE-CAST (a net-shape casting process producing the hinged 3-D body); the "
                   "certificate's scope is explicitly limited to EXTRUSION and profile drawing, which produces "
                   "constant-cross-section profiles and cannot make a die-cast hinged part. An ISO 9001 scope "
                   "bounds the certified processes; die-casting is outside it. NOT COVERED."),
     "wrong": "Keyword-overlap ('aluminium') wrongly accepts -> FALSE POSITIVE."},
    {"group": "scope", "case": "scope_call", "token": "ChaozhouCoolEdge",
     "folder": "Chaozhou CoolEdge", "city": "Chaozhou",
     "legal": "Chaozhou CoolEdge Electronics Co., Ltd.",
     "product_line": "extruded aluminium laptop cooling stands with finned profiles",
     "scope": "Manufacture of aluminium parts by high-pressure die-casting and CNC machining",
     "covered": False, "expected": "non_compliant", "confounder": "near-miss process",
     "reasoning": ("The product is an EXTRUDED finned profile (finned heat-sink cooling stands are an extrusion "
                   "product); the certificate's scope is limited to high-pressure DIE-CASTING and machining, "
                   "which does not include extrusion. The certified process does not cover the manufacture of "
                   "the product. NOT COVERED."),
     "wrong": "Keyword-overlap ('aluminium') wrongly accepts -> FALSE POSITIVE."},

    # ---- process / class not the product (defeats scope-ignored matcher) ----
    {"group": "scope", "case": "scope_call", "token": "HeyuanStampLine",
     "folder": "Heyuan StampLine", "city": "Heyuan",
     "legal": "Heyuan StampLine Electronics Co., Ltd.",
     "product_line": "injection-moulded TPU phone bumper cases",
     "scope": "Precision metal stamping and progressive-die fabrication of sheet-metal components",
     "covered": False, "expected": "non_compliant", "confounder": "process not product",
     "reasoning": ("The product is injection-moulded TPU (a plastics process); the certificate covers METAL "
                   "STAMPING of sheet-metal components — a different material and process that does not cover "
                   "plastic injection moulding of phone cases. NOT COVERED."),
     "wrong": "Scope-ignored (USCC+date only) wrongly accepts; keyword-overlap has no shared words and rejects."},
    {"group": "scope", "case": "scope_call", "token": "QingyuanHarnessCo",
     "folder": "Qingyuan HarnessCo", "city": "Qingyuan",
     "legal": "Qingyuan HarnessCo Electronics Co., Ltd.",
     "product_line": "USB-C charging cables and adapters",
     "scope": "Manufacture of industrial wiring harnesses and terminal blocks for machinery control panels",
     "covered": False, "expected": "non_compliant", "confounder": "different class (industrial)",
     "reasoning": ("The certificate covers INDUSTRIAL wiring harnesses and terminal blocks for machinery control "
                   "panels — an industrial-electrical product class, not consumer USB-C charging cables and "
                   "adapters. NOT COVERED."),
     "wrong": "Scope-ignored wrongly accepts; keyword-overlap has no shared words and rejects."},
    {"group": "scope", "case": "scope_call", "token": "YangjiangAluCast",
     "folder": "Yangjiang AluCast", "city": "Yangjiang",
     "legal": "Yangjiang AluCast Electronics Co., Ltd.",
     "product_line": "aluminium phone stands",
     "scope": "Manufacture of aluminium ingots, billets and extrusion feedstock",
     "covered": False, "expected": "non_compliant", "confounder": "value-chain (raw feedstock)",
     "reasoning": ("The certificate covers raw aluminium FEEDSTOCK (ingots, billets, extrusion feedstock) — an "
                   "upstream raw-material product, not the manufacture of finished phone stands. Shared word "
                   "'aluminium'. Different value-chain position. NOT COVERED."),
     "wrong": "Keyword-overlap ('aluminium') wrongly accepts -> FALSE POSITIVE; scope-ignored also wrongly accepts."},

    # ===================== ENTITY-BY-USCC (secondary, 4) ===================== #
    # scope plainly covers; the variable is the issuing legal entity / dates.
    {"group": "entity", "case": "renamed", "token": "PutianNorthArc",
     "folder": "Putian NorthArc", "city": "Putian",
     "legal": "Putian NorthArc Electronics Co., Ltd.", "expected": "compliant",
     "product_line": "aluminium phone stands and tablet mounts",
     "former": "Putian Jinhai Electronics Co., Ltd."},
    {"group": "entity", "case": "typo", "token": "ShenzhenTruGrip",
     "folder": "Shenzhen TruGrip", "city": "Shenzhen",
     "legal": "Shenzhen TruGrip Accessories Co., Ltd.", "expected": "compliant",
     "product_line": "silicone phone grips and stands",
     "typo_legal": "Shenzhen TruGrpi Accessories Co., Ltd."},
    {"group": "entity", "case": "sister", "token": "DongguanClearWave",
     "folder": "Dongguan ClearWave", "city": "Dongguan",
     "legal": "Dongguan ClearWave Electronics Co., Ltd.", "expected": "non_compliant",
     "product_line": "USB-C charging cables and adapters",
     "sister_entity": "ClearWave Electronics (Huizhou) Co., Ltd.", "sister_city": "Huizhou"},
    {"group": "entity", "case": "expired_own_current_sister", "token": "NingboEchoCell",
     "folder": "Ningbo EchoCell", "city": "Ningbo",
     "legal": "Ningbo EchoCell Acoustics Co., Ltd.", "expected": "non_compliant",
     "product_line": "wireless earbud charging cases",
     "sister_entity": "EchoCell Acoustics (Foshan) Co., Ltd.", "sister_city": "Foshan"},

    # ===================== MECHANICAL / FILENAME-DATE (secondary, 9) ========= #
    {"group": "mech", "case": "clean", "token": "FoshanPackRight",
     "folder": "Foshan PackRight", "city": "Foshan",
     "legal": "Foshan PackRight Electronics Co., Ltd.", "expected": "compliant",
     "product_line": "tempered-glass screen protectors and camera films",
     "iso_exp": date(2026, 6, 1)},  # boundary: current by +2 days
    {"group": "mech", "case": "expired_minus", "token": "NingboPowerCell",
     "folder": "Ningbo PowerCell", "city": "Ningbo",
     "legal": "Ningbo PowerCell Electronics Co., Ltd.", "expected": "non_compliant",
     "product_line": "aluminium laptop risers",
     "iso_exp": date(2026, 5, 28)},  # boundary: lapsed by -2 days
    {"group": "mech", "case": "swap", "token": "QuanzhouToolWorks",
     "folder": "Quanzhou ToolWorks", "city": "Quanzhou",
     "legal": "Quanzhou ToolWorks Electronics Co., Ltd.", "expected": "compliant",
     "product_line": "power banks and charging cables", "swap_partner": "QuanzhouCoreCell"},
    {"group": "mech", "case": "swap", "token": "QuanzhouCoreCell",
     "folder": "Quanzhou CoreCell", "city": "Quanzhou",
     "legal": "Quanzhou CoreCell Electronics Co., Ltd.", "expected": "compliant",
     "product_line": "phone stands and grips", "swap_partner": "QuanzhouToolWorks"},
    {"group": "mech", "case": "iso14001", "token": "ZhongshanLumaWare",
     "folder": "Zhongshan LumaWare", "city": "Zhongshan",
     "legal": "Zhongshan LumaWare Electronics Co., Ltd.", "expected": "non_compliant",
     "product_line": "LED ring lights"},
    {"group": "mech", "case": "missing_bl", "token": "MeizhouCableTek",
     "folder": "Meizhou CableTek", "city": "Meizhou",
     "legal": "Meizhou CableTek Electronics Co., Ltd.", "expected": "non_compliant",
     "product_line": "cable organizers and ties"},
    {"group": "mech", "case": "lapsed_plus_current_host_group", "token": "NingboPureWave",
     "folder": "Ningbo PureWave", "city": "Ningbo",
     "legal": "Ningbo PureWave Electronics Co., Ltd.", "expected": "compliant",
     "product_line": "wireless earbud charging cases",
     "group_entity": "Huanan Group Holdings Co., Ltd.", "group_city": "Guangzhou", "group_token": "HuananGroup"},
    {"group": "mech", "case": "audit_misfile_missing", "token": "DongguanPrintEdge",
     "folder": "Dongguan PrintEdge", "city": "Dongguan",
     "legal": "Dongguan PrintEdge Electronics Co., Ltd.", "expected": "non_compliant",
     "product_line": "moulded packaging trays and inserts", "audit_recipient": "DongguanHavenPack"},
    {"group": "mech", "case": "audit_misfile_recipient", "token": "DongguanHavenPack",
     "folder": "Dongguan HavenPack", "city": "Dongguan",
     "legal": "Dongguan HavenPack Electronics Co., Ltd.", "expected": "compliant",
     "product_line": "cable organizers and ties", "audit_holder": "DongguanPrintEdge"},
]

# Assign folder ids (21001..) and a per-supplier file-id base (40000 + idx*10).
for _idx, _sp in enumerate(SPEC, start=1):
    _sp["idx"] = _idx
    _sp["fid"] = str(21000 + _idx)
    _sp["base"] = 40000 + _idx * 10

SUPPLIERS = [
    {"key": f"S{sp['idx']}", "fid": sp["fid"], "folder": sp["folder"], "token": sp["token"],
     "city": sp["city"], "legal": sp["legal"], "product_line": sp["product_line"],
     "group": sp["group"], "case": sp["case"], "covered": sp.get("covered"),
     "expected": sp["expected"]}
    for sp in SPEC
]
for _s in SUPPLIERS:
    _s["uscc"] = make_uscc(CITY_REGION[_s["city"]], _s["token"])
    _s["address"] = make_address(_s["token"], _s["city"])

TOKEN_TO_FID = {s["token"]: s["fid"] for s in SUPPLIERS}
TOKEN_TO_SUP = {s["token"]: s for s in SUPPLIERS}
FID_TO_SUP = {s["fid"]: s for s in SUPPLIERS}
USCC_TO_SUP = {s["uscc"]: s for s in SUPPLIERS}
SPEC_BY_TOKEN = {sp["token"]: sp for sp in SPEC}

# Authored coverage truth for each supplier's OWN cert (scope rows carry the
# planted value; everything else has a plainly-covering own cert). Consumed by the
# offline GOLD solver (which legitimately reads ground truth) — coverage cannot be
# re-derived mechanically, so this is the source of truth.
OWN_COVERED_BY_TOKEN = {sp["token"]: bool(sp.get("covered", True)) for sp in SPEC}

# --------------------------------------------------------------------------- #
# Build the file table + per-file content overrides from the spec.
#   FILES     : (file_id, name, physical_parent_fid)
#   FILE_META : per-file body overrides (entity/uscc/scope/covered/note).
# Every ISO 9001 file gets a FILE_META entry carrying its scope text + authored
# `covered` flag (and, for foreign/renamed/typo certs, entity/USCC overrides).
# --------------------------------------------------------------------------- #
FILES = []
FILE_META = {}


def _foreign_uscc(entity: str, city: str) -> str:
    return make_uscc(CITY_REGION[city], f"FOREIGN:{entity}")


def _iso_name(token, exp):
    return f"ISO9001_{token}_exp{exp.isoformat()}.pdf"


def build_world():
    scope_judgments = []   # rich rows for the SCOPE confounders (fairness doc)
    entity_judgments = []  # rich rows for the ENTITY cases (fairness doc)

    def add(fid, name, parent):
        FILES.append((str(fid), name, str(parent)))

    def add_iso(fid, token, exp, parent, *, scope, covered, entity=None, uscc=None,
                address=None, uscc_of_token=None, address_of_token=None, note=None):
        add(fid, _iso_name(token, exp), parent)
        meta = {"scope": scope, "covered": bool(covered)}
        if entity is not None:
            meta["entity"] = entity
        if uscc is not None:
            meta["uscc"] = uscc
        if address is not None:
            meta["address"] = address
        if uscc_of_token is not None:
            meta["uscc_of_token"] = uscc_of_token
        if address_of_token is not None:
            meta["address_of_token"] = address_of_token
        if note is not None:
            meta["note"] = note
        FILE_META[str(fid)] = meta

    for sp in SPEC:
        i = sp["idx"]
        base = sp["base"]
        tok = sp["token"]
        fid = sp["fid"]
        case = sp["case"]
        sup = TOKEN_TO_SUP[tok]
        pl = sp["product_line"]
        bl = f"BusinessLicense_{tok}.pdf"
        audit = f"FactoryAudit_{tok}_2026.pdf"

        if case == "scope_call":
            exp = future_exp(i)
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, exp, fid, scope=sp["scope"], covered=sp["covered"])
            add(base + 5, audit, fid)
            scope_judgments.append({
                "supplier_folder": sp["folder"], "verdict": sp["expected"],
                "covers": bool(sp["covered"]), "confounder": sp["confounder"],
                "product_line": pl, "certified_scope": sp["scope"],
                "documents": {
                    "business_license": {"file": bl, "legal_name": sp["legal"]},
                    "iso9001_cert": {"file": _iso_name(tok, exp),
                                     "uscc": "matches the Business License",
                                     "expiry": exp.isoformat() + " (current)",
                                     "scope_of_certification": sp["scope"]},
                },
                "reasoning": sp["reasoning"], "defeats": sp["wrong"],
            })

        elif case == "clean":
            exp = sp.get("iso_exp", future_exp(i))
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, exp, fid, scope=cover_scope(pl), covered=True)
            add(base + 5, audit, fid)

        elif case == "expired_minus":
            exp = sp["iso_exp"]  # before audit -> not current
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, exp, fid, scope=cover_scope(pl), covered=True)
            add(base + 5, audit, fid)

        elif case == "renamed":
            exp = future_exp(i)
            iso = _iso_name(tok, exp)
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, exp, fid, scope=cover_scope(pl), covered=True,
                    entity=sp["former"], uscc_of_token=tok, address_of_token=tok,
                    note=rename_note(sp["former"], sp["legal"]))
            add(base + 5, audit, fid)
            entity_judgments.append({
                "supplier_folder": sp["folder"], "verdict": "compliant",
                "kind": "renamed entity (positive — the cert IS the supplier's own)",
                "documents": {"business_license": {"file": bl, "legal_name": sp["legal"]},
                              "iso9001_cert": {"file": iso, "printed_legal_name": sp["former"] + " (former name)",
                                               "uscc": "IDENTICAL to the Business License",
                                               "scope": "covers the product line"}},
                "reasoning": (f"ISO 9001 printed under the former registered name '{sp['former']}' differs from the "
                              f"current legal name '{sp['legal']}', BUT its USCC is IDENTICAL to the Business "
                              "License and the body carries a rename remark. A USCC persists across a rename -> "
                              "the cert was issued to this very entity, the scope covers, and it is current -> "
                              "COMPLIANT."),
                "defeats": "Name-overlap/exact-name over-rejection -> wrongly non_compliant."})

        elif case == "typo":
            exp = future_exp(i)
            iso = _iso_name(tok, exp)
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, exp, fid, scope=cover_scope(pl), covered=True,
                    entity=sp["typo_legal"], uscc_of_token=tok, address_of_token=tok)
            add(base + 5, audit, fid)
            entity_judgments.append({
                "supplier_folder": sp["folder"], "verdict": "compliant",
                "kind": "transposed/typo legal name (positive)",
                "documents": {"business_license": {"file": bl, "legal_name": sp["legal"]},
                              "iso9001_cert": {"file": iso, "printed_legal_name": sp["typo_legal"] + " (clerical transposition)",
                                               "uscc": "IDENTICAL to the Business License",
                                               "address": "IDENTICAL to the Business License"}},
                "reasoning": (f"ISO 9001 printed name '{sp['typo_legal']}' is a one-character clerical transposition "
                              f"of '{sp['legal']}', BUT its USCC AND registered address are IDENTICAL to the "
                              "Business License; the scope covers and it is current. Same entity -> COMPLIANT."),
                "defeats": "Exact-name rejection -> wrongly non_compliant."})

        elif case == "sister":
            exp = future_exp(i)
            iso = _iso_name(tok, exp)
            su = _foreign_uscc(sp["sister_entity"], sp["sister_city"])
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, exp, fid, scope=cover_scope(pl), covered=True,
                    entity=sp["sister_entity"], uscc=su,
                    address=make_address(sp["sister_entity"], sp["sister_city"]))
            add(base + 5, audit, fid)
            entity_judgments.append({
                "supplier_folder": sp["folder"], "verdict": "non_compliant",
                "kind": "sister company (negative)",
                "documents": {"business_license": {"file": bl, "legal_name": sp["legal"], "city": sp["city"]},
                              "iso9001_cert": {"file": iso, "printed_legal_name": sp["sister_entity"], "city": sp["sister_city"]}},
                "reasoning": (f"The only ISO 9001 is printed to '{sp['sister_entity']}' and is current with a "
                              f"covering scope, so a name/filename reading marks {sp['legal']} compliant. BUT that "
                              f"cert's USCC is a {sp['sister_city']} entity, which does NOT match this supplier's "
                              f"Business License USCC (a {sp['city']} entity) -> issued to a same-brand sister "
                              "company -> NON_COMPLIANT."),
                "defeats": "Filename/brand trust -> wrongly compliant."})

        elif case == "expired_own_current_sister":
            exp_own = past_exp(i)                  # own cert (USCC match) but lapsed
            iso_own = _iso_name(tok, exp_own)
            exp_sis = future_exp(i)                # sister cert current
            iso_sis = _iso_name(tok, exp_sis)
            su = _foreign_uscc(sp["sister_entity"], sp["sister_city"])
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, exp_own, fid, scope=cover_scope(pl), covered=True)  # own, expired
            add_iso(base + 3, tok, exp_sis, fid, scope=cover_scope(pl), covered=True,  # sister, current
                    entity=sp["sister_entity"], uscc=su,
                    address=make_address(sp["sister_entity"], sp["sister_city"]))
            add(base + 5, audit, fid)
            entity_judgments.append({
                "supplier_folder": sp["folder"], "verdict": "non_compliant",
                "kind": "expired-own + current-sister (negative — date AND entity both matter)",
                "documents": {"business_license": {"file": bl, "legal_name": sp["legal"], "city": sp["city"]},
                              "iso9001_own_expired": {"file": iso_own, "uscc": "matches the Business License",
                                                      "expiry": exp_own.isoformat() + " (before the audit date)"},
                              "iso9001_sister_current": {"file": iso_sis, "printed_legal_name": sp["sister_entity"],
                                                         "city": sp["sister_city"], "uscc": "a different, foreign USCC",
                                                         "expiry": exp_sis.isoformat() + " (current)"}},
                "reasoning": ("Two ISO 9001 certs are on file. The one carrying the supplier's OWN USCC expired "
                              f"{exp_own.isoformat()} (before the audit date). The current one was issued to a "
                              f"sister entity in {sp['sister_city']} (USCC mismatch). Neither is BOTH current AND "
                              "this supplier's own entity -> NON_COMPLIANT."),
                "defeats": "Date-only accepts the current sister; USCC-only accepts the expired own cert."})

        elif case == "swap":
            exp = future_exp(i)
            partner_fid = TOKEN_TO_FID[sp["swap_partner"]]
            add(base + 1, bl, fid)
            add(base + 5, audit, fid)
            # this supplier's OWN ISO is mis-shelved into the partner's folder.
            add_iso(base + 2, tok, exp, partner_fid, scope=cover_scope(pl), covered=True)

        elif case == "audit_misfile_missing":
            exp = future_exp(i)
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, exp, fid, scope=cover_scope(pl), covered=True)  # own ISO present + current
            # holds the RECIPIENT's Factory Audit (mis-shelved here); own audit absent.
            add(base + 5, f"FactoryAudit_{sp['audit_recipient']}_2026.pdf", fid)

        elif case == "audit_misfile_recipient":
            exp = future_exp(i)
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, exp, fid, scope=cover_scope(pl), covered=True)  # own ISO present + current
            # its own Factory Audit is mis-shelved into the holder's folder.

        elif case == "iso14001":
            exp = future_exp(i)
            add(base + 1, bl, fid)
            # wrong standard (environmental, not quality) -> no ISO 9001 on file.
            add(base + 2, f"ISO14001_{tok}_exp{exp.isoformat()}.pdf", fid)
            FILE_META[str(base + 2)] = {"scope": cover_scope(pl), "covered": True}
            add(base + 5, audit, fid)

        elif case == "missing_bl":
            exp = future_exp(i)
            add_iso(base + 2, tok, exp, fid, scope=cover_scope(pl), covered=True)  # ISO + audit, no BL
            add(base + 5, audit, fid)

        elif case == "lapsed_plus_current_host_group":
            add(base + 1, bl, fid)
            add_iso(base + 2, tok, past_exp(i), fid, scope=cover_scope(pl), covered=True)    # lapsed own (distractor)
            add_iso(base + 3, tok, future_exp(i), fid, scope=cover_scope(pl), covered=True)  # current own
            add(base + 5, audit, fid)
            # corporate GROUP cert: token is no supplier -> belongs nowhere -> stays.
            gtok = sp["group_token"]
            gexp = future_exp(i + 4)
            add(base + 6, f"ISO9001_{gtok}_exp{gexp.isoformat()}.pdf", fid)
            FILE_META[str(base + 6)] = {
                "scope": "Group quality-management-system certification (corporate holding)",
                "covered": True,
                "entity": sp["group_entity"],
                "uscc": make_uscc(CITY_REGION[sp["group_city"]], f"GROUP:{sp['group_entity']}"),
                "address": make_address(sp["group_entity"], sp["group_city"]),
            }
        else:
            raise ValueError(f"unknown case {case!r} for {tok}")

    return scope_judgments, entity_judgments


SCOPE_JUDGMENTS, ENTITY_JUDGMENTS = build_world()

KIND_SIZE = {"BL": 184320, "ISO9001": 256000, "ISO14001": 256000, "AUDIT": 512000, "OTHER": 40960}
DOC_LABEL = {
    "BL": "Business License",
    "ISO9001": "ISO 9001 certificate",
    "ISO14001": "ISO 14001 certificate",
    "AUDIT": "Factory Audit Report",
}


# --------------------------------------------------------------------------- #
# Filename parsing
# --------------------------------------------------------------------------- #
def parse_name(name: str):
    """Return (kind, token, expiry_or_None, year_or_None)."""
    stem = name.rsplit(".", 1)[0]
    if name.startswith("BusinessLicense_"):
        return "BL", stem[len("BusinessLicense_"):], None, None
    if name.startswith("ISO9001_"):
        token, _, exp = stem[len("ISO9001_"):].partition("_exp")
        return "ISO9001", token, _parse_date(exp), None
    if name.startswith("ISO14001_"):
        token, _, exp = stem[len("ISO14001_"):].partition("_exp")
        return "ISO14001", token, _parse_date(exp), None
    if name.startswith("FactoryAudit_"):
        rest = stem[len("FactoryAudit_"):]
        token, _, year = rest.rpartition("_")
        return "AUDIT", token, None, year or None
    return "OTHER", None, None, None


def _parse_date(s: str):
    try:
        y, m, d = (int(x) for x in s.split("-"))
        return date(y, m, d)
    except ValueError:
        return None


def eff_record(fid: str, name: str):
    """What the document records INSIDE: (entity, uscc, address, note, scope).

    Overrides win; otherwise derive entity/USCC/address from the supplier whose
    token the file name carries (so name and content agree). The scope is always
    taken from FILE_META for an ISO file (set by add_iso); OTHER files have none.
    """
    ov = FILE_META.get(fid, {})
    note = ov.get("note")
    scope = ov.get("scope")
    if "uscc_of_token" in ov or "address_of_token" in ov or "entity" in ov:
        entity = ov.get("entity")
        if "uscc_of_token" in ov:
            uscc = TOKEN_TO_SUP[ov["uscc_of_token"]]["uscc"]
        else:
            uscc = ov.get("uscc")
        if "address_of_token" in ov:
            address = TOKEN_TO_SUP[ov["address_of_token"]]["address"]
        else:
            address = ov.get("address")
        return entity, uscc, address, note, scope
    kind, token, _exp, _yr = parse_name(name)
    sup = TOKEN_TO_SUP.get(token)
    if sup is None:
        return None, None, None, None, scope
    return sup["legal"], sup["uscc"], sup["address"], None, scope


def cert_covered(fid: str) -> bool:
    """Authored coverage truth for a certificate (default True)."""
    return bool(FILE_META.get(fid, {}).get("covered", True))


# --------------------------------------------------------------------------- #
# Compliance computation
# --------------------------------------------------------------------------- #
def compute_status():
    """Compliance per supplier, AFTER reconciliation (location-independent).

    BL / Factory Audit count by the supplier TOKEN in the file name (a mis-shelved
    doc counts toward the supplier its name references, i.e. once moved to where it
    belongs). An ISO 9001 cert counts for a supplier only if it is current AND it
    was issued to that supplier's legal entity (the USCC recorded inside the cert
    matches the supplier's own USCC) AND its scope of certification covers that
    supplier's product line (the authored `covered` label).
    """
    have = {s["token"]: {"BL": False, "ISO_valid": False, "AUDIT": False} for s in SUPPLIERS}
    for fid, name, _parent in FILES:
        kind, token, exp, _yr = parse_name(name)
        if kind == "BL" and token in have:
            have[token]["BL"] = True
        elif kind == "AUDIT" and token in have:
            have[token]["AUDIT"] = True
        elif kind == "ISO9001" and exp is not None and exp >= AUDIT_DATE:
            _e, cert_uscc, _a, _n, _scope = eff_record(fid, name)
            owner = USCC_TO_SUP.get(cert_uscc)
            if owner is not None and cert_covered(fid):
                have[owner["token"]]["ISO_valid"] = True
        # ISO14001 intentionally ignored for compliance.
    status = {}
    for s in SUPPLIERS:
        h = have[s["token"]]
        status[s["token"]] = "compliant" if (h["BL"] and h["ISO_valid"] and h["AUDIT"]) else "non_compliant"
    return status, have


def deficiency_codes_for_supplier(s, have):
    """Expected task codes for a non-compliant supplier.

    Codes are deliberately coarse and policy-facing: they identify the failed
    compliance dimension without exposing the hidden answer. The verifier checks
    only that the agent's Box task names the relevant code(s).
    """
    h = have[s["token"]]
    codes = []
    if not h["BL"]:
        codes.append("BL-MISSING")
    if not h["AUDIT"]:
        codes.append("AUDIT-MISSING")
    if not h["ISO_valid"]:
        case = s["case"]
        if case == "scope_call" and not s.get("covered", True):
            codes.append("ISO-SCOPE")
        elif case == "expired_minus":
            codes.append("ISO-EXPIRED")
        elif case == "sister":
            codes.append("ISO-WRONG-ENTITY")
        elif case == "expired_own_current_sister":
            codes.extend(["ISO-EXPIRED", "ISO-WRONG-ENTITY"])
        elif case == "iso14001":
            codes.append("ISO-MISSING")
        else:
            codes.append("ISO-INVALID")
    return codes


def derive_misfiles_and_blankets():
    """Auto-derive the move set and the no-supplier-token set from FILES.

    A document is MIS-SHELVED when its name token maps to a real supplier folder
    that is NOT its physical parent. A document whose token is no supplier (a
    group/corporate cert) belongs to no supplier folder: it stays put and counts
    for nobody. Distractors (OTHER) are ignored.
    """
    misfiled, blanket = [], []
    for fid, name, parent in FILES:
        kind, token, _exp, _yr = parse_name(name)
        if kind == "OTHER":
            continue
        owner_fid = TOKEN_TO_FID.get(token)
        if owner_fid is None:
            blanket.append({"name": name, "file_id": fid, "home_folder_id": parent})
        elif owner_fid != parent:
            misfiled.append({"name": name, "file_id": fid, "from_folder_id": parent, "to_folder_id": owner_fid})
    return misfiled, blanket


# --------------------------------------------------------------------------- #
# Document body (agent-readable via `box files:download`)
# --------------------------------------------------------------------------- #
def build_file_content(fid, name):
    kind, token, exp, year = parse_name(name)
    entity, uscc, address, note, scope = eff_record(fid, name)
    head = "NORTHBRIDGE SUPPLIER DOCUMENT (mock — generated for benchmarking)"
    if kind == "BL":
        return "\n".join([
            head,
            "Document type: Business License",
            f"Registered entity: {entity}",
            f"Unified Social Credit Code (USCC): {uscc}",
            f"Registered address: {address}",
            "Business term: 2015-01-01 to 2035-01-01",
        ]) + "\n"
    if kind in ("ISO9001", "ISO14001"):
        std = "ISO 9001:2015 Quality Management System" if kind == "ISO9001" \
            else "ISO 14001:2015 Environmental Management System"
        issue = f"{exp.year - 3:04d}-{exp.month:02d}-{exp.day:02d}" if exp else "n/a"
        lines = [
            head,
            f"Document type: {std} certificate",
            f"Certified organization: {entity}",
            f"Unified Social Credit Code (USCC): {uscc}",
            f"Registered address: {address}",
            f"Scope of certification: {scope}",
            f"Date of issue: {issue}",
            f"Date of expiry: {exp.isoformat() if exp else 'n/a'}",
        ]
        if note:
            lines.append(f"Remark: {note}")
        return "\n".join(lines) + "\n"
    if kind == "AUDIT":
        return "\n".join([
            head,
            "Document type: Factory Audit Report",
            f"Audited entity: {entity}",
            f"Unified Social Credit Code (USCC): {uscc}",
            f"Audit year: {year}",
            "Summary: on-site quality-management-system review conducted at the registered address.",
        ]) + "\n"
    sup = FID_TO_SUP.get(_physical_parent(fid), {})
    return "\n".join([
        head,
        "Document type: Supporting document",
        f"Supplier folder: {sup.get('folder', '')}",
    ]) + "\n"


def _physical_parent(fid):
    for f, _n, p in FILES:
        if f == fid:
            return p
    return None


# --------------------------------------------------------------------------- #
# SQL seed emission
# --------------------------------------------------------------------------- #
def sql_str(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def fake_sha1(name: str) -> str:
    return hashlib.sha1(name.encode("utf-8")).hexdigest()


def build_seed_sql() -> str:
    lines = []
    lines.append("-- cli-box-supplier-docroom-audit seed (generated by private/generate_data.py — do not edit by hand)")
    lines.append("-- Wipe the default fixture re-seeded by `box-bench reset`, then load this task's tree.")
    lines.append("-- Delete order mirrors bin/box-bench reset (child -> parent, FK-safe).")
    for t in ["audit_log", "auth_session", "shared_links", "tasks", "comments", "collaborations", "files", "folders", "users"]:
        lines.append(f"DELETE FROM {t};")
    lines.append("")

    lines.append("-- Auth session: lets `box ...` run authenticated (no `box login` needed).")
    lines.append("INSERT INTO auth_session (env_name, token, created_at) VALUES")
    lines.append(f"  ('default', {sql_str(AUTH_TOKEN)}, {sql_str(TS)});")
    lines.append("")

    lines.append("-- Users (admin row first => default acting user for the agent's box commands).")
    lines.append("INSERT INTO users (id, name, login, created_at, modified_at, status, space_amount, space_used, job_title) VALUES")
    user_rows = [
        (ADMIN_USER_ID, "NorthBridge Compliance", ADMIN_LOGIN, "Compliance Administrator"),
        (QA_USER_ID, "QA Reviewer", QA_LOGIN, "Quality Assurance Reviewer"),
    ]
    parts = []
    for uid, name, login, title in user_rows:
        parts.append(
            f"  ({sql_str(uid)}, {sql_str(name)}, {sql_str(login)}, {sql_str(TS)}, {sql_str(TS)}, "
            f"'active', 10737418240, 0, {sql_str(title)})"
        )
    lines.append(",\n".join(parts) + ";")
    lines.append("")

    lines.append("-- Folders: root (0) -> Suppliers (20000) -> the supplier folders.")
    lines.append("INSERT INTO folders (id, name, description, parent_id, size, etag, created_at, modified_at, created_by, owned_by, item_status) VALUES")
    fparts = []
    fparts.append(
        f"  ('0', 'All Files', '', NULL, 0, '0', {sql_str(TS)}, {sql_str(TS)}, "
        f"{sql_str(ADMIN_USER_ID)}, {sql_str(ADMIN_USER_ID)}, 'active')"
    )
    fparts.append(
        f"  ({sql_str(SUPPLIERS_ROOT_ID)}, 'Suppliers', 'Supplier onboarding document room', '0', 0, '1', "
        f"{sql_str(TS)}, {sql_str(TS)}, {sql_str(ADMIN_USER_ID)}, {sql_str(ADMIN_USER_ID)}, 'active')"
    )
    for s in SUPPLIERS:
        desc = f"{s['folder']} ({s['city']}) onboarding documents"
        fparts.append(
            f"  ({sql_str(s['fid'])}, {sql_str(s['folder'])}, {sql_str(desc)}, {sql_str(SUPPLIERS_ROOT_ID)}, 0, '1', "
            f"{sql_str(TS)}, {sql_str(TS)}, {sql_str(ADMIN_USER_ID)}, {sql_str(ADMIN_USER_ID)}, 'active')"
        )
    lines.append(",\n".join(fparts) + ";")
    lines.append("")

    lines.append("-- Files: supplier onboarding documents. The compliance state is encoded in the")
    lines.append("-- file NAMES (type/token/expiry) and, for the entity + scope judgment, in the")
    lines.append("-- file CONTENTS (legal entity name + USCC + scope of certification). Descriptions")
    lines.append("-- restate the doc type + token only.")
    lines.append("INSERT INTO files (id, name, description, parent_id, size, sha1, etag, created_at, modified_at, content_created_at, content_modified_at, created_by, owned_by, item_status, file_content) VALUES")
    file_parts = []
    for fid, name, parent in FILES:
        kind, token, _exp, _yr = parse_name(name)
        label = DOC_LABEL.get(kind, "Supporting document")
        sup = FID_TO_SUP.get(parent, {})
        desc = f"{label} for {token or sup.get('folder', '')}".strip()
        content = build_file_content(fid, name)
        size = KIND_SIZE.get(kind, KIND_SIZE["OTHER"])
        file_parts.append(
            f"  ({sql_str(fid)}, {sql_str(name)}, {sql_str(desc)}, {sql_str(parent)}, {size}, "
            f"{sql_str(fake_sha1(name))}, '1', {sql_str(TS)}, {sql_str(TS)}, {sql_str(TS)}, {sql_str(TS)}, "
            f"{sql_str(ADMIN_USER_ID)}, {sql_str(ADMIN_USER_ID)}, 'active', {sql_str(content)})"
        )
    lines.append(",\n".join(file_parts) + ";")
    lines.append("")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# Workspace artifacts
# --------------------------------------------------------------------------- #
def write_policy():
    audit = AUDIT_DATE.isoformat()
    md = f"""# NorthBridge Accessories — Supplier Document-Room Compliance Policy

**Audit date:** {audit}

NorthBridge Accessories keeps every supplier's onboarding documents in Box under
the top-level **`Suppliers/`** folder — one sub-folder per supplier. Quality &
Compliance runs a periodic audit of this document room. This policy defines the
standard each supplier must meet and what to record for each.

## 1. What every supplier must have on file

A supplier folder is **compliant** only if it holds, current as of the audit
date, all three of the following, each belonging to that supplier:

1. A **Business License**.
2. An **ISO 9001 (quality-management-system)** certificate that (a) is current,
   (b) was issued to this supplier's own legal entity, and (c) whose **scope of
   certification covers the product line NorthBridge sources from that supplier**
   (see §4).
3. A **Factory Audit Report**.

A supplier that is missing any of the three — or whose ISO 9001 certificate is not
current, was not issued to this supplier, or whose scope does not cover that
supplier's product line — is **non-compliant**.

## 2. Identifying which supplier a document belongs to

Each document's name encodes its type and the supplier it is for, for example
`BusinessLicense_<Token>.pdf`, `ISO9001_<Token>_exp<YYYY-MM-DD>.pdf`,
`FactoryAudit_<Token>_<YYYY>.pdf`. `<Token>` is the supplier's name with the
spaces removed; `workspace/supplier_directory.csv` lists the token, city and the
**product line** for each folder. A document's name and folder location are labels
for convenience — they are not, by themselves, proof of which entity a certificate
was issued to or of what its scope covers (see §4).

Keeping the room correctly filed is part of the audit: every document belongs in
the folder of the supplier it is for. If a document is sitting in a folder it does
not belong to, move it into the folder it belongs to. Assess each supplier on the
documents that belong to it once the room is in order.

## 3. Certificate currency

A certificate is **current** if its expiry date is **on or after** the audit date
({audit}); a certificate whose expiry date is exactly {audit} is still current.
A certificate whose expiry date is before {audit} is not current and does not
count.

## 4. A certificate must be the supplier's own — and cover its product line

A supplier is a registered legal entity. Its identity of record is the legal name
and the **Unified Social Credit Code (USCC)** shown on its Business License. The
**product line** NorthBridge sources from each supplier is listed in
`workspace/supplier_directory.csv`. An ISO 9001 certificate satisfies the
requirement for a supplier only if **both**:

- it was issued to that same legal entity — that is, the **USCC printed on the
  certificate matches the USCC on the supplier's Business License**; and
- its **scope of certification covers that supplier's product line** — i.e. the
  products NorthBridge sources from the supplier fall within the activities the
  certificate certifies.

A certificate states its **scope of certification** in its own words (the
products, materials and/or processes it certifies). Read that scope and judge
whether it covers the supplier's product line: a certificate that certifies a
**different product class, a different manufacturing process, or a different point
in the supply chain** does not cover the product line even if it shares some words
with it; and a certificate written in **broader category terms** covers the
product line when the sourced products clearly fall within that category. The
certificate's printed organization name and its file name/location are not, by
themselves, proof of the entity it was issued to or of what its scope covers —
confirm against the **USCC** and the **scope of certification** recorded inside
the document.

Read the document itself to confirm the issuing entity and the scope: you can save
a document's contents with `box files:download` and then open the saved file. The
legal name, USCC and scope of certification are recorded inside each certificate;
the Business License records the legal name and USCC.

## 5. What to record for each supplier

Once the room is correctly filed, classify each supplier folder under
`Suppliers/`, then record the outcome in Box. **These Box changes are the record
of the audit** — there is no separate write-up to produce.

- **Non-compliant supplier** — do BOTH:
  1. Create a **Box task** on **one of the documents inside that supplier's
     folder**, with `--due-at "{TASK_DUE_AT}"`. The task message must include every
     deficiency code that applies:
     - `BL-MISSING` — no Business License belonging to the supplier is on file.
     - `ISO-MISSING` — no ISO 9001 certificate belonging to the supplier is on file.
     - `ISO-EXPIRED` — the supplier's own ISO 9001 certificate is not current.
     - `ISO-WRONG-ENTITY` — the current ISO 9001 certificate was issued to a
       different legal entity/USCC.
     - `ISO-SCOPE` — the current ISO 9001 certificate's scope does not cover the
       sourced product line.
     - `AUDIT-MISSING` — no Factory Audit Report belonging to the supplier is on file.
     (Box tasks attach to a file, not a folder — pick any document in the folder.)
  2. Add **`{QA_LOGIN}`** as a collaborator on that supplier's **folder** with the
     role **`viewer`**.
- **Compliant supplier** — create a **shared link** on that supplier's **folder**
  (so QA can review it). Do **not** create a task or a collaboration on a
  compliant supplier.

Do not add shared links to non-compliant folders, and do not create tasks or
collaborations on compliant folders. Leave any document that belongs to no
supplier folder where it is.
"""
    (WORKSPACE / "compliance_policy.md").write_text(md, encoding="utf-8")


def write_directory_csv():
    with (WORKSPACE / "supplier_directory.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["folder_name", "supplier_token", "city", "product_line"])
        for s in SUPPLIERS:
            w.writerow([s["folder"], s["token"], s["city"], s["product_line"]])


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    status_by_token, have = compute_status()
    misfiled, blanket = derive_misfiles_and_blankets()

    # Cross-check computed status against the intended design — fail loudly on drift.
    for s in SUPPLIERS:
        got = status_by_token[s["token"]]
        assert got == s["expected"], f"{s['key']} {s['token']}: computed {got} != expected {s['expected']} ({have[s['token']]})"

    # USCCs must be distinct across suppliers (so an ISO cert maps to at most one
    # supplier).
    all_uscc = [s["uscc"] for s in SUPPLIERS]
    assert len(set(all_uscc)) == len(all_uscc), "supplier USCCs are not unique"

    # Every FOREIGN / SISTER / GROUP cert USCC must map to NO supplier; every
    # rename / typo cert USCC must resolve (by USCC) to its intended supplier.
    for fid, meta in FILE_META.items():
        if "uscc" in meta and "uscc_of_token" not in meta:
            assert meta["uscc"] not in USCC_TO_SUP, \
                f"foreign/group cert {fid} ({meta.get('entity')}) USCC must match no supplier"
        if "uscc_of_token" in meta:
            assert meta["uscc_of_token"] in TOKEN_TO_SUP, \
                f"cert {fid} uscc_of_token {meta['uscc_of_token']} is not a supplier"

    # Every current ISO 9001 cert's USCC resolves to AT MOST ONE supplier
    # (uniqueness == fairness: a cert can satisfy at most one folder).
    for fid, name, _parent in FILES:
        kind, _tok, exp, _yr = parse_name(name)
        if kind != "ISO9001" or exp is None or exp < AUDIT_DATE:
            continue
        _e, cu, _a, _n, _sc = eff_record(fid, name)
        owners = [s for s in SUPPLIERS if s["uscc"] == cu]
        assert len(owners) <= 1, f"ISO cert {name} USCC maps to >1 supplier: {[o['folder'] for o in owners]}"

    # Scope-coverage design locks.
    scope_rows = [sp for sp in SPEC if sp["case"] == "scope_call"]
    n_scope = len(scope_rows)
    n_cov = sum(1 for sp in scope_rows if sp["covered"])
    n_notcov = n_scope - n_cov
    assert n_scope == len(SCOPE_JUDGMENTS) == 18, f"expected 18 scope-coverage calls, built {n_scope}"
    assert n_cov >= 6 and n_notcov >= 8, f"scope balance off (covered={n_cov}, not={n_notcov})"
    # Each scope call's authored verdict must equal the supplier's computed status.
    for sp in scope_rows:
        want = "compliant" if sp["covered"] else "non_compliant"
        assert status_by_token[sp["token"]] == want == sp["expected"], \
            f"scope call {sp['folder']} must be {want}, got {status_by_token[sp['token']]}"
    # Each scope call must be ISOLATED: BL + current own-USCC ISO + Audit all
    # present, so the ONLY thing deciding the verdict is scope coverage.
    for sp in scope_rows:
        h = have[sp["token"]]
        assert h["BL"] and h["AUDIT"], f"scope call {sp['folder']} must have BL + Audit present"
        assert h["ISO_valid"] == sp["covered"], \
            f"scope call {sp['folder']} ISO_valid ({h['ISO_valid']}) must equal covered ({sp['covered']})"

    # Lock the move design: a two-way swap (2 legs) + the audit mis-shelve (1) = 3.
    assert len(misfiled) == 3, f"expected exactly 3 mis-shelved docs, derived {len(misfiled)}: {misfiled}"
    # Lock the no-supplier-token design: exactly 1 group cert, left in place.
    assert len(blanket) == 1, f"expected exactly 1 group cert, derived {len(blanket)}: {blanket}"

    WORKSPACE.mkdir(parents=True, exist_ok=True)
    MOCK_RUNTIME.mkdir(parents=True, exist_ok=True)

    (MOCK_RUNTIME / "box_seed.sql").write_text(build_seed_sql(), encoding="utf-8")
    write_policy()
    write_directory_csv()

    compliant_folders = [s["fid"] for s in SUPPLIERS if status_by_token[s["token"]] == "compliant"]
    noncompliant_folders = [s["fid"] for s in SUPPLIERS if status_by_token[s["token"]] == "non_compliant"]
    deficiency_codes_by_folder = {
        s["fid"]: deficiency_codes_for_supplier(s, have)
        for s in SUPPLIERS
        if status_by_token[s["token"]] == "non_compliant"
    }
    for fid, codes in deficiency_codes_by_folder.items():
        assert codes, f"non-compliant folder {fid} has no deficiency code"

    expected = {
        "audit_date": AUDIT_DATE.isoformat(),
        "qa_reviewer_login": QA_LOGIN,
        "qa_reviewer_user_id": QA_USER_ID,
        "task_due_at": TASK_DUE_AT,
        "suppliers_root_id": SUPPLIERS_ROOT_ID,
        "suppliers": [
            {"folder_id": s["fid"], "folder_name": s["folder"], "token": s["token"],
             "uscc": s["uscc"], "product_line": s["product_line"], "group": s["group"],
             "status": status_by_token[s["token"]]}
            for s in SUPPLIERS
        ],
        "compliant_folders": compliant_folders,       # need shared link + no task + no collab
        "noncompliant_folders": noncompliant_folders, # need task + viewer collab + no shared link
        "deficiency_codes_by_folder": deficiency_codes_by_folder,
        "supplier_folder_ids": [s["fid"] for s in SUPPLIERS],
        "misfiled_files": misfiled,                   # each: name, file_id, from_folder_id, to_folder_id
        "blanket_files": blanket,                     # group certs that must NOT move
        # Documentation only (verifier ignores unknown keys): the scope-coverage
        # judgments (the discriminator) and the secondary entity judgments.
        # Full decisive reasoning lives in scratch/scripts/box_scope_fairness.json.
        "scope_judgment_cases": [
            {"folder_name": j["supplier_folder"], "status": j["verdict"], "covers": j["covers"],
             "confounder": j["confounder"], "product_line": j["product_line"],
             "certified_scope": j["certified_scope"], "reasoning": j["reasoning"]}
            for j in SCOPE_JUDGMENTS
        ],
        "entity_judgment_cases": [
            {"folder_name": j["supplier_folder"], "status": j["verdict"], "kind": j["kind"],
             "reasoning": j["reasoning"]}
            for j in ENTITY_JUDGMENTS
        ],
    }
    (HERE / "expected_answer.json").write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")

    # Author-review summary
    print(f"Audit date: {AUDIT_DATE.isoformat()}   files={len(FILES)}   suppliers={len(SUPPLIERS)}   "
          f"scope-calls={n_scope} (covered={n_cov} not-covered={n_notcov})   "
          f"entity-cases={len(ENTITY_JUDGMENTS)}")
    print(f"{'folder':26} {'group':6} {'BL':>3} {'ISOok':>6} {'AUD':>4}  STATUS")
    for s in SUPPLIERS:
        h = have[s["token"]]
        print(f"{s['folder']:26} {s['group']:6} {('Y' if h['BL'] else '-'):>3} "
              f"{('Y' if h['ISO_valid'] else '-'):>6} {('Y' if h['AUDIT'] else '-'):>4}  "
              f"{status_by_token[s['token']]}")
    print(f"\ncompliant    folders ({len(compliant_folders)}) shared-link, no task/collab")
    print(f"noncompliant folders ({len(noncompliant_folders)}) task + viewer collab")
    print("moves (FROM -> TO):")
    for m in misfiled:
        print(f"  {m['name']}  {m['from_folder_id']} -> {m['to_folder_id']}")
    print("no-supplier-token certs (leave in place):")
    for b in blanket:
        print(f"  {b['name']}  stays in {b['home_folder_id']}")

    # Atomic-check accounting (mirrors grader/verify_task.py), for author review.
    n_checks = (
        1                                # mock_reachable
        + 5 * len(noncompliant_folders)  # task + codes + due + collab_viewer + no_shared_link
        + 3 * len(compliant_folders)     # shared_link + no_task + no_collab
        + len(misfiled)                  # each moved doc
        + len(blanket)                   # each group cert left in place
        + 1                              # no_nonviewer_collab
    )
    print(f"\natomic checks (incl. mock_reachable): {n_checks}")
    print(f"load-bearing scope-coverage calls (the discriminator): {n_scope}")


if __name__ == "__main__":
    main()
