"""v2 verifier for file-logistics-dangerous-goods-packaging-audit.

Per-SKU evidence-grounded checks. Cheat-resistant: blob-flatten substring
matching is replaced with structured `evidence_items[]` checks that require
the agent's citations to (a) point at the matching SDS PDF basename and
(b) carry the correct UN number. Documentation-gap codes are a closed enum.
Operations brief must surface specific blocked SKU IDs (not just generic
vocabulary).

Capacity-check granularity (2026-06-09, docs/check-granularity.md): the
verifier still computes every per-SKU / per-evidence atom internally
(predicates and reasons are byte-identical to the pre-fold version), but the
emitted `checks_breakdown` aggregates those atoms into capability units. The
fold is pure AND aggregation over a complete partition of the 17 atoms, so
the binary `passed` result is unchanged; only `checks_total` now reflects
distinct capabilities (R2 plumbing -> setup_gate, R3 same-skill batches
collapsed, R6 coverage/negative kept). Per-atom detail survives in the
folded `reason` strings for diagnosis. Routing and UN-citation are collapsed
(R3, not R3a): empirically no output-producing model got partial routing or
partial UN grounding -- those axes are all-or-nothing here, so per-item
gradation buys no discrimination.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any


# ---------- io helpers ----------


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except OSError:
        return ""


def read_csv(path: Path) -> list[dict[str, str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))
    except OSError:
        return []


def add(checks: list[dict[str, Any]], check_id: str, passed: bool, reason: str, check_type: str) -> None:
    """Record a single per-item / per-evidence ATOM.

    Atoms are not emitted directly; they are folded into capability-unit
    checks by ``fold_atoms`` before emit. Predicate and reason are stored
    verbatim so the fold is pure aggregation (see module docstring).
    """
    checks.append({"id": check_id, "passed": bool(passed), "reason": reason, "check_type": check_type})


# ---------- capability-unit fold ----------

# Complete partition of the 17 atoms into 7 capability units. new_check =
# AND(member atoms). The partition is exhaustive and disjoint, so
# all(groups) == all(atoms) and binary `passed` is identical to the pre-fold
# verifier. Order is the public check order.
FOLD_GROUPS: list[tuple[str, str, str, list[str]]] = [
    (
        "setup_gate",
        "deterministic_exact",
        "Deliverables present and structurally valid: dg_audit.json parses; every "
        "sku_decision carries a documentation_gaps list and a channel_promise_action "
        "from the closed enum.",
        ["dg_audit_json_exists_parseable", "documentation_gaps_and_channel_actions_present"],
    ),
    (
        "all_skus_classified",
        "deterministic_exact",
        "Complete SKU coverage: every packaging-spec SKU appears exactly once in "
        "sku_decisions (no missing/extra) and shipping_matrix.csv has a row for each.",
        ["all_skus_classified_once", "shipping_matrix_complete"],
    ),
    (
        "ship_status_correct",
        "deterministic_exact",
        "Per-SKU routing: every SKU's ship_status is in its allowed set and each "
        "dangerous-goods SKU passes the SDS-evidence gate (cites its matching SDS PDF).",
        [
            "ceramic_mug_air_ok",
            "trail_750_blk_air_ok",
            "clean_tab_oxi_blocked",
            "aroma_spray_ground_or_blocked",
            "perfume_roller_ground_or_blocked",
            "powerbank_ground_or_blocked",
            "led_lantern_blocked_or_ground",
        ],
    ),
    (
        "un_number_grounding",
        "deterministic_semantic",
        "Per-DG-SKU UN grounding: each audited DG SKU cites its matching SDS PDF "
        "basename and the correct UN number (incl. the UN3480-vs-UN3481 distinction).",
        [
            "clean_tab_oxi_cites_correct_sds_and_un",
            "aroma_spray_cites_correct_sds_and_un",
            "perfume_roller_cites_correct_sds_and_un",
            "powerbank_cites_correct_sds_and_un",
            "led_lantern_cites_correct_sds_and_un",
        ],
    ),
    (
        "sds_section_grounding",
        "deterministic_semantic",
        "Multi-section grounding: each dangerous-goods SKU cites >=2 distinct "
        "expected SDS sections (e.g. section 2 hazard id + section 4 transport).",
        ["sds_sections_cited"],
    ),
    (
        "documentation_gaps_correct",
        "deterministic_exact",
        "Documentation-gap competency: every blocked/ground-only SKU lists at least "
        "one valid closed-enum gap code.",
        ["blocked_skus_have_documentation_gaps"],
    ),
    (
        "operations_brief_actionable",
        "deterministic_semantic",
        "Operations brief surfaces >=3 blocked SKU IDs by name with an action verb "
        "and no overclaim of regulatory certainty.",
        ["operations_brief_actionable"],
    ),
]


def fold_atoms(atoms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate the recorded atoms into capability-unit checks (pure AND).

    Each group passes iff all its member atoms passed. The group reason lists
    any failing member atoms (with their own reason) so per-item diagnostic
    signal is preserved. Asserts the partition is complete and disjoint."""
    by_id = {a["id"]: a for a in atoms}
    consumed: set[str] = set()
    folded: list[dict[str, Any]] = []
    for group_id, check_type, desc, members in FOLD_GROUPS:
        present = [by_id[m] for m in members if m in by_id]
        missing_members = [m for m in members if m not in by_id]
        failing = [m for m in present if not m["passed"]]
        consumed.update(m for m in members if m in by_id)
        group_ok = not missing_members and bool(present) and not failing
        if group_ok:
            reason = desc
        else:
            details = "; ".join(
                f"{m['id']}: {m.get('reason', '')}" for m in failing
            )
            if missing_members:
                details = (details + "; " if details else "") + (
                    f"missing_atoms={missing_members}"
                )
            reason = f"{desc} | FAILED: {details}"
        folded.append(
            {"id": group_id, "passed": group_ok, "reason": reason, "check_type": check_type}
        )
    leftover = sorted(set(by_id) - consumed)
    if leftover:  # partition must be exhaustive; guards against future atom drift
        folded.append(
            {
                "id": "atom_partition_complete",
                "passed": False,
                "reason": f"unpartitioned atoms (verifier bug): {leftover}",
                "check_type": "deterministic_exact",
            }
        )
    return folded


# ---------- evidence helpers ----------


def evidence_items_for(row: dict[str, Any]) -> list[dict[str, Any]]:
    raw = row.get("evidence_items") if isinstance(row, dict) else None
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def normalize_path(text: str) -> str:
    return (text or "").lower().replace("\\", "/")


def normalize_section(text: str) -> str:
    """Lowercase, replace § with 'section ', collapse whitespace.

    Examples:
      '§14 UN3481' -> 'section 14 un3481'
      'Section 4: Transport' -> 'section 4: transport'
    """
    s = (text or "").lower().replace("§", "section ")
    return re.sub(r"\s+", " ", s).strip()


def evidence_cites_sds(evidence: list[dict[str, Any]], expected_basename: str) -> bool:
    """At least one evidence_item.source_file references the expected SDS file."""
    if not expected_basename:
        return False
    needle = expected_basename.lower()
    for item in evidence:
        sf = normalize_path(str(item.get("source_file") or ""))
        if needle in sf:
            return True
    return False


def evidence_cites_un(
    evidence: list[dict[str, Any]],
    un_number: str,
    expected_basename: str,
) -> bool:
    """An evidence_item that (a) cites the matching SDS file AND
    (b) names the correct UN number in section_or_un_number."""
    if not un_number:
        return False
    digits = re.sub(r"[^0-9]", "", un_number)
    if not digits:
        return False
    pattern = re.compile(r"\bun\s*0*" + digits + r"\b", re.IGNORECASE)
    needle = expected_basename.lower()
    for item in evidence:
        sf = normalize_path(str(item.get("source_file") or ""))
        if needle and needle not in sf:
            continue
        sec = str(item.get("section_or_un_number") or "")
        if pattern.search(sec):
            return True
    return False


def evidence_distinct_sections(
    evidence: list[dict[str, Any]],
    expected_sections: list[str],
) -> int:
    """Count distinct expected-section tokens that appear as substrings of any
    evidence_item.section_or_un_number (after § -> 'section ' normalization)."""
    expected_norm = [normalize_section(s) for s in expected_sections if s]
    found: set[str] = set()
    for item in evidence:
        sec = normalize_section(str(item.get("section_or_un_number") or ""))
        if not sec:
            continue
        for token in expected_norm:
            if token and token in sec:
                found.add(token)
    return len(found)


# ---------- output helpers ----------


def emit(reward_path: Path, task_id: str, checks: list[dict[str, Any]]) -> int:
    passed = sum(1 for c in checks if c.get("passed"))
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_id,
        "reward": score,
        "score": score,
        "passed": total > 0 and passed == total,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "source": "v2_direct_verifier",
    }
    reward_path.parent.mkdir(parents=True, exist_ok=True)
    reward_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": score, "checks_passed": passed, "checks_total": total}, ensure_ascii=False))
    return 0


# ---------- main ----------


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", default="")
    parser.add_argument("--reward-json", required=True)
    args = parser.parse_args()

    task_dir = Path(args.task_dir).resolve()
    output_dir = Path(args.output_dir) if args.output_dir else task_dir / "outputs"
    reward_path = Path(args.reward_json)
    rubric = load_json(task_dir / "rubric.json") or {}
    task_id = rubric.get("task_id") or task_dir.name
    expected = load_json(task_dir / "private" / "expected_answer.json") or {}

    audit_path = output_dir / "dg_audit.json"
    matrix_path = output_dir / "shipping_matrix.csv"
    brief_path = output_dir / "operations_brief.md"

    result = load_json(audit_path)
    decisions = result.get("sku_decisions", []) if isinstance(result, dict) else []
    by_sku: dict[str, dict[str, Any]] = {
        str(row.get("sku", "")).strip(): row
        for row in decisions
        if isinstance(row, dict) and row.get("sku")
    }
    expected_skus = {
        row.get("sku", "").strip()
        for row in read_csv(task_dir / "workspace" / "products" / "sku_packaging_specs.csv")
        if row.get("sku")
    }
    matrix_rows = read_csv(matrix_path)
    hazard_profile: dict[str, dict[str, Any]] = expected.get("hazard_profile_by_sku") or {}
    blocked_sku_ids: list[str] = list(expected.get("blocked_sku_ids") or [])
    valid_gap_codes = {str(c).strip().lower() for c in (expected.get("valid_documentation_gap_codes") or [])}
    valid_actions = {
        str(a).strip().lower()
        for a in (
            expected.get("valid_channel_promise_actions")
            or ["keep_air", "disable_air", "keep_ground_only", "block_until_docs"]
        )
    }

    checks: list[dict[str, Any]] = []

    add(
        checks,
        "dg_audit_json_exists_parseable",
        isinstance(result, dict),
        "dg_audit.json parsed" if isinstance(result, dict) else "dg_audit.json missing or invalid",
        "deterministic_exact",
    )

    missing = sorted(expected_skus - set(by_sku))
    extra = sorted(set(by_sku) - expected_skus)
    add(
        checks,
        "all_skus_classified_once",
        not missing and not extra and len(by_sku) == len(expected_skus),
        f"missing={missing} extra={extra}",
        "deterministic_exact",
    )

    # --- per-SKU ship_status helpers ---
    def status(sku: str) -> str:
        row = by_sku.get(sku) or {}
        return str(row.get("ship_status") or "").strip().lower()

    def allowed_statuses(sku: str, fallback: set[str]) -> set[str]:
        configured = (expected.get("ship_status_by_sku") or {}).get(sku)
        if isinstance(configured, list) and configured:
            return {str(item).strip().lower() for item in configured if str(item).strip()}
        return fallback

    def passes_sds_evidence_gate(sku: str) -> bool:
        """Anti-cheat gate: dangerous-goods SKUs must cite their matching SDS
        PDF in evidence_items[]. Non-DG SKUs are not gated (their classification
        is straightforward and citation requirement would over-strict honest
        agents). This forces SKU-name-only classifiers to fail every DG status
        check even when the inferred hazard category happens to be correct."""
        profile = hazard_profile.get(sku) or {}
        if not profile.get("is_dangerous_goods"):
            return True
        row = by_sku.get(sku) or {}
        evidence = evidence_items_for(row)
        expected_path = str((profile.get("required_evidence") or {}).get("source_file") or "").strip()
        expected_basename = Path(expected_path).name if expected_path else ""
        if not expected_basename:
            return True
        return evidence_cites_sds(evidence, expected_basename)

    def ship_status_check(check_id: str, sku: str, fallback: set[str]) -> None:
        allowed = allowed_statuses(sku, fallback)
        got = status(sku)
        status_ok = got in allowed
        evidence_ok = passes_sds_evidence_gate(sku)
        add(
            checks,
            check_id,
            status_ok and evidence_ok,
            f"got={got!r} expected={sorted(allowed)} sds_evidence_gate={evidence_ok}",
            "deterministic_exact",
        )

    ship_status_check("ceramic_mug_air_ok", "CERAMIC-MUG", {"air_ok"})
    ship_status_check("trail_750_blk_air_ok", "TRAIL-750-BLK", {"air_ok"})
    ship_status_check("clean_tab_oxi_blocked", "CLEAN-TAB-OXI", {"block_pending_docs", "block_not_allowed"})
    ship_status_check("aroma_spray_ground_or_blocked", "AROMA-SPRAY-100", {"ground_only", "block_pending_docs"})
    ship_status_check("perfume_roller_ground_or_blocked", "PERFUME-ROLLER-30", {"ground_only", "block_pending_docs"})
    ship_status_check("powerbank_ground_or_blocked", "POWERBANK-20K", {"ground_only", "block_pending_docs"})
    ship_status_check(
        "led_lantern_blocked_or_ground",
        "LED-LANTERN-BATT",
        {"block_pending_docs", "ground_only"},
    )

    # --- per-SKU evidence checks (must cite matching SDS file + correct UN number) ---
    def cites_correct_sds_and_un(sku: str) -> tuple[bool, str]:
        row = by_sku.get(sku) or {}
        evidence = evidence_items_for(row)
        profile = hazard_profile.get(sku) or {}
        req = profile.get("required_evidence") or {}
        expected_path = str(req.get("source_file") or "").strip()
        expected_basename = Path(expected_path).name if expected_path else ""
        un = str(profile.get("un_number") or "").strip()
        if not expected_basename or not un:
            return False, f"expected_answer missing required_evidence/un_number for {sku}"
        sds_ok = evidence_cites_sds(evidence, expected_basename)
        un_ok = evidence_cites_un(evidence, un, expected_basename)
        sample = [
            (
                Path(normalize_path(str(e.get("source_file") or ""))).name,
                str(e.get("section_or_un_number") or "")[:40],
            )
            for e in evidence
        ][:6]
        return sds_ok and un_ok, (
            f"cite_sds={sds_ok} cite_un={un_ok} expected_sds={expected_basename!r} "
            f"expected_un={un!r} evidence_sample={sample}"
        )

    for sku, slug in (
        ("CLEAN-TAB-OXI", "clean_tab_oxi"),
        ("AROMA-SPRAY-100", "aroma_spray"),
        ("PERFUME-ROLLER-30", "perfume_roller"),
        ("POWERBANK-20K", "powerbank"),
        ("LED-LANTERN-BATT", "led_lantern"),
    ):
        ok, reason = cites_correct_sds_and_un(sku)
        add(checks, f"{slug}_cites_correct_sds_and_un", ok, reason, "deterministic_semantic")

    # --- sds_sections_cited: per-DG-SKU >=2 distinct expected sections ---
    dg_skus = sorted(s for s, p in hazard_profile.items() if p.get("is_dangerous_goods"))
    section_failures: list[str] = []
    for sku in dg_skus:
        row = by_sku.get(sku)
        if not isinstance(row, dict):
            section_failures.append(f"{sku}:absent")
            continue
        evidence = evidence_items_for(row)
        expected_sections = (
            ((hazard_profile.get(sku) or {}).get("required_evidence") or {}).get("sections") or []
        )
        n = evidence_distinct_sections(evidence, expected_sections)
        if n < 2:
            section_failures.append(f"{sku}:{n}")
    add(
        checks,
        "sds_sections_cited",
        not section_failures and len(dg_skus) >= 3,
        (
            f"per_dg_sku_distinct_sections_below_threshold={section_failures}"
            if section_failures
            else f"all {len(dg_skus)} DG SKUs cite >=2 distinct expected sections"
        ),
        "deterministic_semantic",
    )

    # --- structural: gaps list + valid channel_promise_action ---
    docs_and_channel = bool(by_sku) and all(
        isinstance(row.get("documentation_gaps"), list) and row.get("channel_promise_action")
        for row in by_sku.values()
    )
    invalid_actions = sorted(
        sku
        for sku, row in by_sku.items()
        if str(row.get("channel_promise_action") or "").strip().lower() not in valid_actions
    )
    add(
        checks,
        "documentation_gaps_and_channel_actions_present",
        docs_and_channel and not invalid_actions,
        f"docs_and_channel={docs_and_channel} invalid_actions={invalid_actions}",
        "deterministic_exact",
    )

    # --- blocked_skus_have_documentation_gaps: closed enum codes ---
    blocked_failures: list[str] = []
    for sku in blocked_sku_ids:
        row = by_sku.get(sku)
        if not isinstance(row, dict):
            blocked_failures.append(f"{sku}:not_classified")
            continue
        gaps = row.get("documentation_gaps") or []
        if not isinstance(gaps, list) or not gaps:
            blocked_failures.append(f"{sku}:empty_gaps")
            continue
        valid_entries = [str(g).strip().lower() for g in gaps if str(g).strip().lower() in valid_gap_codes]
        if not valid_entries:
            blocked_failures.append(f"{sku}:no_valid_enum_gap")
    add(
        checks,
        "blocked_skus_have_documentation_gaps",
        not blocked_failures and len(blocked_sku_ids) >= 3,
        f"blocked_failures={blocked_failures} valid_enum_size={len(valid_gap_codes)}",
        "deterministic_exact",
    )

    # --- shipping_matrix_complete: all expected SKUs present in matrix ---
    matrix_skus: set[str] = set()
    for row in matrix_rows:
        if not isinstance(row, dict):
            continue
        for k, v in row.items():
            if str(k).strip().lower() == "sku" and str(v or "").strip():
                matrix_skus.add(str(v).strip())
                break
    matrix_missing = sorted(expected_skus - matrix_skus)
    add(
        checks,
        "shipping_matrix_complete",
        len(matrix_rows) >= len(expected_skus) and not matrix_missing,
        f"matrix_rows={len(matrix_rows)} expected_skus={len(expected_skus)} missing_in_matrix={matrix_missing}",
        "deterministic_exact",
    )

    # --- operations_brief_actionable: blocked SKU IDs + action verb + no overclaim ---
    brief_text_raw = read_text(brief_path)
    brief_lower = brief_text_raw.lower()
    unsafe_overclaim = ("guaranteed compliant" in brief_lower) or ("safe for all air" in brief_lower)
    sku_mentions = sorted(sku for sku in blocked_sku_ids if sku.lower() in brief_lower)
    action_verbs = [
        "disable",
        "block",
        "hold",
        "remove",
        "stop ",
        "pause",
        "ground-only",
        "ground only",
        "pending docs",
        "pending documentation",
    ]
    action_hits = sorted({v.strip() for v in action_verbs if v in brief_lower})
    actionable = (
        bool(brief_text_raw.strip())
        and len(sku_mentions) >= 3
        and len(action_hits) >= 1
        and not unsafe_overclaim
    )
    add(
        checks,
        "operations_brief_actionable",
        actionable,
        (
            f"sku_mentions={sku_mentions} action_hits={action_hits} "
            f"unsafe_overclaim={unsafe_overclaim} brief_present={bool(brief_text_raw.strip())}"
        ),
        "deterministic_semantic",
    )

    # `checks` holds the 17 per-item atoms; fold into capability units (pure
    # AND over a complete partition) before emit. binary `passed` is unchanged.
    return emit(reward_path, task_id, fold_atoms(checks))


if __name__ == "__main__":
    raise SystemExit(main())
