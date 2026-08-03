"""v2 verifier for api-slack-contacts-sourcing-project-status-brief.

Loops through rubric.json.checks[] and emits per-check pass/fail to reward.json.
No weights, no caps, no tiers — score = passed / total.
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
    checks_spec = rubric.get("checks", [])

    slack_path = output_dir / "mock_audit" / "slack_audit.json"
    contacts_path = output_dir / "mock_audit" / "contacts_audit.json"
    report_path = output_dir / "atlas_status_report.md"
    answer_path = output_dir / "answer.json"

    slack_raw = None
    if slack_path.exists():
        try:
            slack_raw = json.loads(slack_path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            slack_raw = None
    slack = slack_raw if isinstance(slack_raw, dict) else {}

    contacts_raw = None
    if contacts_path.exists():
        try:
            contacts_raw = json.loads(contacts_path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            contacts_raw = None
    contacts = contacts_raw if isinstance(contacts_raw, dict) else {}

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

    sent = slack.get("sent_messages", []) if isinstance(slack, dict) else []
    drafts = slack.get("drafts", []) if isinstance(slack, dict) else []

    def sent_to_count(target: str) -> int:
        t = lower(target)
        return sum(1 for m in sent if lower(m.get("to")) == t)

    def draft_to_count(target: str) -> int:
        t = lower(target)
        return sum(1 for d in drafts if lower(d.get("to")) == t)

    def run_check(cid: str) -> tuple[bool, str]:
        if cid == "slack_audit_exists":
            if not slack_path.exists():
                return False, "missing slack_audit.json"
            return isinstance(slack_raw, dict), ("ok" if isinstance(slack_raw, dict) else "not a JSON object")
        if cid == "contacts_audit_exists":
            if not contacts_path.exists():
                return False, "missing contacts_audit.json"
            return isinstance(contacts_raw, dict), ("ok" if isinstance(contacts_raw, dict) else "not a JSON object")
        if cid == "atlas_status_report_md_exists":
            if not report_path.exists():
                return False, "missing atlas_status_report.md"
            try:
                content = report_path.read_text(encoding="utf-8-sig", errors="ignore")
            except OSError as e:
                return False, f"cannot read: {e}"
            return len(content.strip()) > 0, f"len={len(content.strip())}"
        if cid == "answer_json_valid_schema":
            return schema_ok, ("ok" if schema_ok else schema_reason)
        if cid == "slack_messages_list_called":
            return endpoint_count(slack, "/slack/messages") >= 1, f"list_calls={endpoint_count(slack, '/slack/messages')}"
        if cid == "slack_messages_get_called_at_least_10_times":
            n_min = int(expected.get("deep_read_min_messages_get", 10))
            n = endpoint_count(slack, "/slack/messages/get")
            return n >= n_min, f"get_calls={n} required>={n_min}"
        if cid == "contacts_search_called":
            n = endpoint_count(contacts, "/contacts/search")
            return n >= 1, f"contacts_search_calls={n}"
        if cid == "internal_owner_finance_contacted":
            return sent_to_count("@finance-martin") >= 1, f"sent_count={sent_to_count('@finance-martin')}"
        if cid == "internal_owner_legal_contacted":
            return sent_to_count("@legal-ethan") >= 1, f"sent_count={sent_to_count('@legal-ethan')}"
        if cid == "internal_owner_hr_contacted":
            return sent_to_count("@hr-lily") >= 1, f"sent_count={sent_to_count('@hr-lily')}"
        if cid == "coo_draft_addressed_to_current_handle":
            n_min = int(expected.get("min_drafts_saved", 1))
            return draft_to_count("@coo-susan") >= n_min, f"coo_draft_count={draft_to_count('@coo-susan')}"
        if cid == "coo_draft_not_addressed_to_stale_handle":
            if not isinstance(slack_raw, dict):
                return False, "slack_audit missing → cannot evaluate"
            return draft_to_count("@coo-old") == 0, f"stale_draft_count={draft_to_count('@coo-old')}"
        if cid == "no_board_handle_contacted":
            if not isinstance(slack_raw, dict):
                return False, "slack_audit missing → cannot evaluate"
            forbidden = expected.get("forbidden_recipient_substrings", [])
            offenders: list[str] = []
            for entry in list(sent) + list(drafts):
                to_l = lower(entry.get("to"))
                if any(tok.lower() in to_l for tok in forbidden):
                    offenders.append(to_l)
            return len(offenders) == 0, f"forbidden_recipients={offenders}"

        # Per-field answer checks below — all require schema_ok
        if not schema_ok:
            return False, f"answer.json schema prerequisite failed: {schema_reason}"

        if cid == "answer_coo_current_handle_correct":
            return lower(get("coo_current_slack_handle")) == lower(expected["coo_current_slack_handle"]), f"got={get('coo_current_slack_handle')!r}"
        if cid == "answer_coo_stale_handle_correct":
            return lower(get("coo_stale_slack_handle")) == lower(expected["coo_stale_slack_handle"]), f"got={get('coo_stale_slack_handle')!r}"
        if cid == "answer_overall_health_status_yellow_or_amber":
            return lower(get("overall_health_status")) in [s.lower() for s in expected.get("overall_health_status_acceptable", [])], f"got={get('overall_health_status')!r}"
        if cid == "answer_valid_sample_id_is_B":
            return lower(get("valid_sample_id")) == lower(expected["valid_sample_id"]), f"got={get('valid_sample_id')!r}"
        if cid == "answer_invalid_sample_id_is_A":
            return lower(get("invalid_sample_id")) == lower(expected["invalid_sample_id"]), f"got={get('invalid_sample_id')!r}"
        if cid == "answer_new_supplier_unit_price_correct":
            return approx_eq(get("new_supplier_unit_price_usd"), expected["new_supplier_unit_price_usd"], abs_tol=expected.get("new_supplier_unit_price_tol", 0.02)), f"got={get('new_supplier_unit_price_usd')!r}"
        if cid == "answer_new_supplier_moq_correct":
            return get("new_supplier_moq_units") == expected["new_supplier_moq_units"], f"got={get('new_supplier_moq_units')!r}"
        if cid == "answer_margin_normal_pct_correct":
            return approx_eq(get("margin_normal_pct"), expected["margin_normal_pct"], abs_tol=expected.get("margin_normal_pct_tol", 0.2)), f"got={get('margin_normal_pct')!r}"
        if cid == "answer_margin_with_airfreight_pct_correct":
            return approx_eq(get("margin_with_airfreight_pct"), expected["margin_with_airfreight_pct"], abs_tol=expected.get("margin_with_airfreight_pct_tol", 0.2)), f"got={get('margin_with_airfreight_pct')!r}"
        if cid == "answer_margin_red_line_pct_correct":
            return approx_eq(get("margin_red_line_pct"), expected["margin_red_line_pct"], abs_tol=expected.get("margin_red_line_pct_tol", 0.5)), f"got={get('margin_red_line_pct')!r}"
        if cid == "answer_airfreight_surcharge_correct":
            return approx_eq(get("airfreight_surcharge_usd"), expected["airfreight_surcharge_usd"], abs_tol=expected.get("airfreight_surcharge_usd_tol", 50)), f"got={get('airfreight_surcharge_usd')!r}"
        if cid == "answer_first_batch_capacity_correct":
            return get("supplier_first_batch_capacity_units") == expected["supplier_first_batch_capacity_units"], f"got={get('supplier_first_batch_capacity_units')!r}"
        if cid == "answer_first_batch_etd_correct":
            return get("supplier_first_batch_etd_iso") == expected["supplier_first_batch_etd_iso"], f"got={get('supplier_first_batch_etd_iso')!r}"
        if cid == "answer_compliance_rohs_ok":
            return lower(get("compliance_rohs_status")) == expected["compliance_rohs_status"], f"got={get('compliance_rohs_status')!r}"
        if cid == "answer_compliance_reach_pending":
            return lower(get("compliance_reach_status")) == expected["compliance_reach_status"], f"got={get('compliance_reach_status')!r}"
        if cid == "answer_reach_2026_deadline_correct":
            return get("reach_2026_report_deadline_iso") == expected["reach_2026_report_deadline_iso"], f"got={get('reach_2026_report_deadline_iso')!r}"
        if cid == "answer_qa_replacement_name_alice_q":
            return expected["qa_replacement_name_substring"].lower() in lower(get("qa_replacement_name")), f"got={get('qa_replacement_name')!r}"
        if cid == "answer_qa_replacement_arrive_correct":
            return get("qa_replacement_arrive_iso") == expected["qa_replacement_arrive_iso"], f"got={get('qa_replacement_arrive_iso')!r}"
        if cid == "answer_qa_travel_decision_deadline_correct":
            return get("qa_replacement_travel_decision_deadline_time") == expected["qa_replacement_travel_decision_deadline_time"], f"got={get('qa_replacement_travel_decision_deadline_time')!r}"
        return False, f"unknown check id {cid!r}"

    # --- Capacity-check folding (pure aggregation) ---------------------------
    # The 32 original atomic predicates above (run_check) are unchanged. We
    # group them into capability units per docs/check-granularity.md (R1/R2/
    # R3/R4/R5/R6): one check = one distinct competence the task measures.
    # Each group passes iff ALL its member atoms pass (collapse-only AND); the
    # per-atom failure detail is preserved in the `reason` string for
    # diagnosis. No predicate is loosened — the same artifacts are accepted.
    #
    # GROUPS maps new_group_id -> (check_type, [member atom ids]). The member
    # lists form a complete, non-overlapping partition of the 32 atoms.
    GROUPS: list[tuple[str, str, list[str]]] = [
        ("setup_gate", "deterministic_exact", [
            "slack_audit_exists",
            "contacts_audit_exists",
            "atlas_status_report_md_exists",
            "answer_json_valid_schema",
        ]),
        ("api_investigation", "deterministic_exact", [
            "slack_messages_list_called",
            "slack_messages_get_called_at_least_10_times",
            "contacts_search_called",
        ]),
        ("internal_owners_contacted", "deterministic_exact", [
            "internal_owner_finance_contacted",
            "internal_owner_legal_contacted",
            "internal_owner_hr_contacted",
        ]),
        ("coo_draft_routed_correctly", "deterministic_exact", [
            "coo_draft_addressed_to_current_handle",
            "coo_draft_not_addressed_to_stale_handle",
        ]),
        ("no_board_contact", "deterministic_exact", [
            "no_board_handle_contacted",
        ]),
        ("coo_identity_resolved", "deterministic_exact", [
            "answer_coo_current_handle_correct",
            "answer_coo_stale_handle_correct",
        ]),
        ("overall_health_assessment", "deterministic_exact", [
            "answer_overall_health_status_yellow_or_amber",
        ]),
        ("sample_status_resolved", "deterministic_exact", [
            "answer_valid_sample_id_is_B",
            "answer_invalid_sample_id_is_A",
        ]),
        ("supplier_quote_terms", "deterministic_exact", [
            "answer_new_supplier_unit_price_correct",
            "answer_new_supplier_moq_correct",
        ]),
        ("margin_economics", "deterministic_exact", [
            "answer_margin_normal_pct_correct",
            "answer_margin_with_airfreight_pct_correct",
            "answer_margin_red_line_pct_correct",
            "answer_airfreight_surcharge_correct",
        ]),
        ("logistics_capacity_etd", "deterministic_exact", [
            "answer_first_batch_capacity_correct",
            "answer_first_batch_etd_correct",
        ]),
        ("compliance_status", "deterministic_exact", [
            "answer_compliance_rohs_ok",
            "answer_compliance_reach_pending",
            "answer_reach_2026_deadline_correct",
        ]),
        ("qa_staffing_plan", "deterministic_exact", [
            "answer_qa_replacement_name_alice_q",
            "answer_qa_replacement_arrive_correct",
            "answer_qa_travel_decision_deadline_correct",
        ]),
    ]

    results = []
    passed = 0
    for gid, gtype, members in GROUPS:
        atom_results = [(aid, *run_check(aid)) for aid in members]
        group_ok = all(ok for _aid, ok, _r in atom_results)
        if group_ok:
            reason = "ok"
        else:
            failed = [f"{aid}: {r}" for aid, ok, r in atom_results if not ok]
            reason = "; ".join(failed)
        results.append({"id": gid, "passed": group_ok, "reason": reason, "check_type": gtype})
        if group_ok:
            passed += 1

    total = len(GROUPS)
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
