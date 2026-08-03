"""v2 verifier for api-slack-supplier-quote-thread-consolidation.

Computes the 22 atomic predicates (run_check), then aggregates them into 7
capability checks via AND (see ATOM_GROUPS / docs/check-granularity.md R2/R4):
plumbing + protocol-compliance fold into `setup_gate`; each real sourcing
competence is one capability check. Pure aggregation — binary `passed`
(all atoms == all groups) is unchanged. No weights, no caps, no tiers —
score = passed / total.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def endpoint_count(audit: dict[str, Any], suffix: str) -> int:
    return sum(1 for c in audit.get("calls", []) if str(c.get("endpoint", "")).endswith(suffix))


def lower(s: Any) -> str:
    return str(s or "").strip().lower()


def approx_eq(a: Any, b: Any, abs_tol: float = 0.0) -> bool:
    if a is None or b is None:
        return False
    try:
        af = float(a)
        bf = float(b)
    except (TypeError, ValueError):
        return False
    return math.isclose(af, bf, abs_tol=abs_tol)


def nullable_approx_eq(a: Any, b: Any, abs_tol: float = 0.0) -> bool:
    if b is None:
        return a is None
    return approx_eq(a, b, abs_tol=abs_tol)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", default="")
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir).resolve()
    reward_path = Path(args.reward_json)
    reward_path.parent.mkdir(parents=True, exist_ok=True)

    output_dir = Path(args.output_dir) if args.output_dir else task_dir / "outputs"
    expected = load_json(task_dir / "private" / "expected_answer.json", {}) or {}
    schema = load_json(task_dir / "private" / "answer.schema.json", {}) or {}
    rubric = load_json(task_dir / "rubric.json", {}) or {}

    audit_path = output_dir / "mock_audit" / "slack_audit.json"
    report_path = output_dir / "quote_consolidation.md"
    answer_path = output_dir / "answer.json"

    audit_raw = None
    if audit_path.exists():
        try:
            audit_raw = json.loads(audit_path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            audit_raw = None
    audit = audit_raw if isinstance(audit_raw, dict) else {}

    agent_answer: dict | None = None
    schema_ok = False
    schema_reason = ""
    if not answer_path.exists():
        schema_reason = f"missing file: {answer_path}"
    else:
        try:
            agent_answer_raw = json.loads(answer_path.read_text(encoding="utf-8-sig"))
            if not isinstance(agent_answer_raw, dict):
                schema_reason = f"answer.json is not a JSON object (got {type(agent_answer_raw).__name__})"
            else:
                agent_answer = agent_answer_raw
                missing = [k for k in schema.get("required", []) if k not in agent_answer]
                extra = (
                    [k for k in agent_answer.keys() if k not in schema.get("properties", {})]
                    if not schema.get("additionalProperties", True)
                    else []
                )
                if missing or extra:
                    schema_reason = f"schema mismatch: missing={missing}, extra={extra}"
                else:
                    schema_ok = True
        except json.JSONDecodeError as e:
            schema_reason = f"answer.json not parseable: {e}"

    def get(field: str) -> Any:
        return (agent_answer or {}).get(field)

    def run_check(cid: str) -> tuple[bool, str]:
        if cid == "slack_audit_exists":
            if not audit_path.exists():
                return False, "missing slack_audit.json"
            return isinstance(audit_raw, dict), ("ok" if isinstance(audit_raw, dict) else "not a JSON object")
        if cid == "quote_consolidation_md_exists":
            if not report_path.exists():
                return False, "missing quote_consolidation.md"
            try:
                content = report_path.read_text(encoding="utf-8-sig", errors="ignore")
            except OSError as e:
                return False, f"cannot read: {e}"
            return len(content.strip()) > 0, f"len={len(content.strip())}"
        if cid == "answer_json_valid_schema":
            return schema_ok, ("ok" if schema_ok else schema_reason)
        if cid == "slack_messages_list_called":
            return endpoint_count(audit, "/slack/messages") >= 1, f"list_calls={endpoint_count(audit, '/slack/messages')}"
        if cid == "slack_messages_get_called_at_least_19_times":
            n_min = int(expected.get("deep_read_min_get_calls", 19))
            n = endpoint_count(audit, "/slack/messages/get")
            return n >= n_min, f"get_calls={n} required>={n_min}"
        if cid == "no_slack_send_called":
            if not isinstance(audit_raw, dict):
                return False, "slack_audit missing → cannot evaluate"
            return endpoint_count(audit, "/slack/send") == 0, f"send_calls={endpoint_count(audit, '/slack/send')}"
        if cid == "no_slack_drafts_save_called":
            if not isinstance(audit_raw, dict):
                return False, "slack_audit missing → cannot evaluate"
            return endpoint_count(audit, "/slack/drafts/save") == 0, f"drafts_save_calls={endpoint_count(audit, '/slack/drafts/save')}"

        # Per-field answer checks below — all require schema_ok
        if not schema_ok:
            return False, f"answer.json schema prerequisite failed: {schema_reason}"

        if cid == "primary_supplier_is_expected":
            return lower(get("primary_supplier_name")) == lower(expected["primary_supplier_name"]), f"got={get('primary_supplier_name')!r}"
        if cid == "primary_supplier_landed_cost_correct":
            return approx_eq(get("primary_supplier_landed_cost_usd"), expected["primary_supplier_landed_cost_usd"], abs_tol=expected.get("primary_supplier_landed_cost_tol", 0.02)), f"got={get('primary_supplier_landed_cost_usd')!r} expected={expected['primary_supplier_landed_cost_usd']!r}"
        if cid == "primary_supplier_fx_rate_correct":
            return nullable_approx_eq(get("primary_supplier_fx_rate_rmb_per_usd"), expected["primary_supplier_fx_rate_rmb_per_usd"], abs_tol=0.001), f"got={get('primary_supplier_fx_rate_rmb_per_usd')!r}"
        if cid == "primary_supplier_fx_handling_pct_correct":
            return nullable_approx_eq(get("primary_supplier_fx_handling_load_pct"), expected["primary_supplier_fx_handling_load_pct"], abs_tol=0.01), f"got={get('primary_supplier_fx_handling_load_pct')!r}"
        if cid == "primary_supplier_extra_logistics_correct":
            return approx_eq(get("primary_supplier_extra_logistics_usd_per_pc"), expected["primary_supplier_extra_logistics_usd_per_pc"], abs_tol=0.001), f"got={get('primary_supplier_extra_logistics_usd_per_pc')!r}"
        if cid == "primary_supplier_cert_authorization_letter_expected":
            return bool(get("primary_supplier_cert_authorization_letter_required")) is bool(expected["primary_supplier_cert_authorization_letter_required"]), f"got={get('primary_supplier_cert_authorization_letter_required')!r}"
        if cid == "backup_supplier_is_expected":
            return lower(get("backup_supplier_name")) == lower(expected["backup_supplier_name"]), f"got={get('backup_supplier_name')!r}"
        if cid == "backup_supplier_landed_cost_correct":
            return approx_eq(get("backup_supplier_landed_cost_usd"), expected["backup_supplier_landed_cost_usd"], abs_tol=expected.get("backup_supplier_landed_cost_tol", 0.02)), f"got={get('backup_supplier_landed_cost_usd')!r}"
        if cid == "rejected_late_arrival_is_cupwell":
            return lower(get("rejected_late_arrival_supplier_name")) == lower(expected["rejected_late_arrival_supplier_name"]), f"got={get('rejected_late_arrival_supplier_name')!r}"
        if cid == "rejected_quality_risk_is_metromug":
            return lower(get("rejected_quality_risk_supplier_name")) == lower(expected["rejected_quality_risk_supplier_name"]), f"got={get('rejected_quality_risk_supplier_name')!r}"
        if cid == "cost_adjustment_note_identifies_northpeak":
            supplier = lower(expected["cost_adjustment_note_supplier"])
            return supplier in lower(get("cost_adjustment_note")), f"got={get('cost_adjustment_note')!r}"
        if cid == "cost_adjusted_landed_cost_correct":
            return approx_eq(get("cost_adjusted_landed_cost_usd"), expected["cost_adjusted_landed_cost_usd"], abs_tol=expected.get("cost_adjusted_landed_cost_tol", 0.02)), f"got={get('cost_adjusted_landed_cost_usd')!r}"
        if cid == "steelpro_latest_unit_price_correct":
            return approx_eq(get("steelpro_latest_unit_price_usd"), expected["steelpro_latest_unit_price_usd"], abs_tol=expected.get("steelpro_latest_unit_price_tol", 0.01)), f"got={get('steelpro_latest_unit_price_usd')!r}"
        if cid == "steelpro_lfgb_certificate_does_not_cover_750ml":
            return bool(get("steelpro_lfgb_certificate_covers_target_750ml")) is False, f"got={get('steelpro_lfgb_certificate_covers_target_750ml')!r}"
        if cid == "landed_cost_budget_correct":
            return approx_eq(get("landed_cost_budget_usd"), expected["landed_cost_budget_usd"], abs_tol=0.001), f"got={get('landed_cost_budget_usd')!r}"
        return False, f"unknown check id {cid!r}"

    # ------------------------------------------------------------------ #
    # Capacity check-granularity fold (docs/check-granularity.md R2/R4).  #
    #                                                                     #
    # The 22 atomic predicates below are computed UNCHANGED by run_check  #
    # (same predicate, same tolerances). They are then aggregated into 7  #
    # capability checks: one capability unit = AND(its atoms). Plumbing / #
    # protocol-compliance atoms fold into `setup_gate` (R2); each real    #
    # sourcing competence is its own group (R4). This is pure aggregation #
    # — binary `passed` (all atoms == all groups) is unchanged; the       #
    # per-atom detail is preserved in each group's `reason`.              #
    # ------------------------------------------------------------------ #
    ATOM_GROUPS: list[tuple[str, str, list[str]]] = [
        (
            "setup_gate",
            "Environment + protocol ready: both deliverables present/parseable, "
            "thread deep-read via the API (list + >=19 /get), and no send/draft "
            "calls (analysis-only restraint).",
            [
                "slack_audit_exists",
                "quote_consolidation_md_exists",
                "answer_json_valid_schema",
                "slack_messages_list_called",
                "slack_messages_get_called_at_least_19_times",
                "no_slack_send_called",
                "no_slack_drafts_save_called",
            ],
        ),
        (
            "primary_supplier_decision",
            "Pick EverTherm as primary under the buyer's lowest-landed-cost rule, "
            "price its revised DDP LA offer correctly, and leave RMB-specific "
            "primary FX fields null with no AtlasWare authorization condition.",
            [
                "primary_supplier_is_expected",
                "primary_supplier_landed_cost_correct",
                "primary_supplier_fx_rate_correct",
                "primary_supplier_fx_handling_pct_correct",
                "primary_supplier_extra_logistics_correct",
                "primary_supplier_cert_authorization_letter_expected",
            ],
        ),
        (
            "backup_supplier_decision",
            "Pick AtlasWare as backup with its RMB conversion, FX handling load, "
            "and LA appointment/tailgate landed cost reflected in the backup cost.",
            [
                "backup_supplier_is_expected",
                "backup_supplier_landed_cost_correct",
            ],
        ),
        (
            "rejections_correct",
            "Eliminate the disqualified suppliers for the right reason: CupWell "
            "(late arrival past June 15) and MetroMug (QA leak risk).",
            [
                "rejected_late_arrival_is_cupwell",
                "rejected_quality_risk_is_metromug",
            ],
        ),
        (
            "false_lead_cost_adjustment",
            "Identify NorthPeak as the false lead whose low headline quote exceeds "
            "budget after accessorial charges, and compute its adjusted landed cost.",
            [
                "cost_adjustment_note_identifies_northpeak",
                "cost_adjusted_landed_cost_correct",
            ],
        ),
        (
            "steelpro_disqualification",
            "Apply the SteelPro MOQ price correction (3.36 for 20k, not the 50k "
            "3.18) and recognize its LFGB report covers 500ml only, not 750ml.",
            [
                "steelpro_latest_unit_price_correct",
                "steelpro_lfgb_certificate_does_not_cover_750ml",
            ],
        ),
        (
            "budget_ceiling",
            "Read Finance's hard landed-cost ceiling (USD 3.40).",
            [
                "landed_cost_budget_correct",
            ],
        ),
    ]

    # Compute every atomic predicate once, unchanged.
    atom_results: dict[str, tuple[bool, str]] = {}
    for _gid, _gdesc, _members in ATOM_GROUPS:
        for aid in _members:
            atom_results[aid] = run_check(aid)

    results = []
    passed = 0
    for gid, gdesc, members in ATOM_GROUPS:
        member_eval = [(aid, atom_results[aid][0], atom_results[aid][1]) for aid in members]
        ok = all(p for _aid, p, _r in member_eval)
        if ok:
            reason = "ok"
        else:
            fails = [f"{aid}: {r}" for aid, p, r in member_eval if not p]
            reason = "failed atoms -> " + "; ".join(fails)
        results.append(
            {
                "id": gid,
                "passed": ok,
                "reason": reason,
                "check_type": "deterministic_exact",
                "description": gdesc,
                "atoms": [
                    {"id": aid, "passed": p, "reason": r} for aid, p, r in member_eval
                ],
            }
        )
        if ok:
            passed += 1

    total = len(ATOM_GROUPS)
    score = passed / total if total > 0 else 0.0

    reward = {
        "schema_version": "2.0",
        "task_id": rubric.get("task_id"),
        "score": round(score, 4),
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": results,
        "reward": round(score, 4),
        "passed": passed == total,
        "source": "v2_checks_runner",
    }
    reward_path.write_text(json.dumps(reward, ensure_ascii=False, indent=2))
    print(json.dumps({k: reward[k] for k in ("score", "checks_passed", "checks_total")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
