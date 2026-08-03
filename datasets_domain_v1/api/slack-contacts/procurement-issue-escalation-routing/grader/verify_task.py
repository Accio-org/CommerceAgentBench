"""v2 verifier for api-slack-contacts-procurement-issue-escalation-routing.

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

    slack_path = output_dir / "mock_audit" / "slack_audit.json"
    contacts_path = output_dir / "mock_audit" / "contacts_audit.json"
    plan_path = output_dir / "escalation_plan.md"
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

    def sent_to_count(target: str) -> int:
        t = lower(target)
        return sum(1 for m in sent if lower(m.get("to")) == t)

    def run_check(cid: str) -> tuple[bool, str]:
        if cid == "slack_audit_exists":
            if not slack_path.exists():
                return False, "missing slack_audit.json"
            return isinstance(slack_raw, dict), ("ok" if isinstance(slack_raw, dict) else "not a JSON object")
        if cid == "contacts_audit_exists":
            if not contacts_path.exists():
                return False, "missing contacts_audit.json"
            return isinstance(contacts_raw, dict), ("ok" if isinstance(contacts_raw, dict) else "not a JSON object")
        if cid == "escalation_plan_md_exists":
            if not plan_path.exists():
                return False, "missing escalation_plan.md"
            try:
                content = plan_path.read_text(encoding="utf-8-sig", errors="ignore")
            except OSError as e:
                return False, f"cannot read: {e}"
            return len(content.strip()) > 0, f"len={len(content.strip())}"
        if cid == "answer_json_valid_schema":
            return schema_ok, ("ok" if schema_ok else schema_reason)
        if cid == "slack_messages_list_called":
            return endpoint_count(slack, "/slack/messages") >= 1, f"list_calls={endpoint_count(slack, '/slack/messages')}"
        if cid == "slack_messages_get_called_at_least_7_times":
            n_min = int(expected.get("deep_read_min_messages_get", 7))
            n = endpoint_count(slack, "/slack/messages/get")
            return n >= n_min, f"get_calls={n} required>={n_min}"
        if cid == "contacts_search_called":
            n = endpoint_count(contacts, "/contacts/search")
            return n >= 1, f"contacts_search_calls={n}"

        contact_checks = {
            "internal_owner_linda_contacted": "@linda-finance",
            "internal_owner_maria_contacted": "@maria-compliance",
            "internal_owner_jake_contacted": "@jake-sun",
            "internal_owner_nina_contacted": "@nina-logistics",
            "internal_owner_owen_contacted": "@risk-owen",
            "internal_owner_ivy_contacted": "@ap-ivy",
            "internal_owner_ethan_contacted": "@legal-ethan",
        }
        if cid in contact_checks:
            target = contact_checks[cid]
            return sent_to_count(target) >= 1, f"sent_count={sent_to_count(target)}"

        if cid == "drafts_save_called_at_least_4_times":
            n_min = int(expected.get("min_drafts_saved", 4))
            n = endpoint_count(slack, "/slack/drafts/save")
            return n >= n_min, f"drafts_save_calls={n} required>={n_min}"

        external_checks = {
            "no_external_send_buyer_nova": "@buyer-nova",
            "no_external_send_buyer_helio": "@buyer-helio",
            "no_external_send_buyer_kappa": "@buyer-kappa",
            "no_external_send_buyer_orion": "@buyer-orion",
        }
        if cid in external_checks:
            if not isinstance(slack_raw, dict):
                return False, "slack_audit missing → cannot evaluate"
            target = external_checks[cid]
            return sent_to_count(target) == 0, f"sent_count={sent_to_count(target)}"

        # Per-field answer checks below — all require schema_ok
        if not schema_ok:
            return False, f"answer.json schema prerequisite failed: {schema_reason}"

        if cid == "real_issue_message_ids_complete":
            ids = set(str(x).strip() for x in (get("real_issue_message_ids") or []))
            required = set(expected.get("real_issue_message_ids_required", []))
            missing = required - ids
            return len(missing) == 0, f"missing={sorted(missing)} got={sorted(ids)}"
        if cid == "real_issue_message_ids_excludes_noise":
            ids = set(str(x).strip() for x in (get("real_issue_message_ids") or []))
            forbidden = set(expected.get("noise_message_ids_forbidden", []))
            overlap = ids & forbidden
            return len(overlap) == 0, f"contained_forbidden={sorted(overlap)}"
        if cid == "nova_customer_facing_amount_correct":
            return approx_eq(get("nova_customer_facing_amount_usd"), expected["nova_customer_facing_amount_usd"], abs_tol=expected.get("nova_customer_facing_amount_tol", 0.5)), f"got={get('nova_customer_facing_amount_usd')!r}"
        if cid == "nova_invoice_id_correct":
            return lower(get("nova_invoice_id")) == lower(expected["nova_invoice_id"]), f"got={get('nova_invoice_id')!r}"
        if cid == "nova_credit_memo_id_correct":
            return lower(get("nova_credit_memo_id")) == lower(expected["nova_credit_memo_id"]), f"got={get('nova_credit_memo_id')!r}"
        if cid == "helio_priority_is_p0":
            return str(get("helio_priority")).strip().upper() == "P0", f"got={get('helio_priority')!r}"
        if cid == "helio_batch_id_correct":
            return lower(get("helio_batch_id")) == lower(expected["helio_batch_id"]), f"got={get('helio_batch_id')!r}"
        if cid == "helio_defective_component_correct":
            return expected["helio_defective_component_substring"].lower() in lower(get("helio_defective_component")), f"got={get('helio_defective_component')!r}"
        if cid == "helio_draft_must_route_to_legal_true":
            return bool(get("helio_draft_must_route_to_legal_before_send")) is True, f"got={get('helio_draft_must_route_to_legal_before_send')!r}"
        if cid == "kappa_correct_contact_email_correct":
            return lower(get("kappa_correct_contact_email")) == lower(expected["kappa_correct_contact_email"]), f"got={get('kappa_correct_contact_email')!r}"
        if cid == "kappa_obsolete_contact_email_correct":
            return lower(get("kappa_obsolete_contact_email")) == lower(expected["kappa_obsolete_contact_email"]), f"got={get('kappa_obsolete_contact_email')!r}"
        if cid == "po9015_recovery_method_correct":
            return str(get("po9015_recovery_method")).strip().lower() == expected["po9015_recovery_method"], f"got={get('po9015_recovery_method')!r}"
        if cid == "po9015_surcharge_usd_correct":
            return approx_eq(get("po9015_surcharge_usd"), expected["po9015_surcharge_usd"], abs_tol=expected.get("po9015_surcharge_usd_tol", 50)), f"got={get('po9015_surcharge_usd')!r}"
        if cid == "po9015_surcharge_split_correct":
            return lower(get("po9015_surcharge_split")) == lower(expected["po9015_surcharge_split"]), f"got={get('po9015_surcharge_split')!r}"
        if cid == "orion_action_hold_wire":
            return str(get("orion_action")).strip().lower() == expected["orion_action"], f"got={get('orion_action')!r}"
        if cid == "orion_last_verified_beneficiary_ref_correct":
            return lower(get("orion_last_verified_beneficiary_ref")) == lower(expected["orion_last_verified_beneficiary_ref"]), f"got={get('orion_last_verified_beneficiary_ref')!r}"
        if cid == "orion_payment_safety_p0_true":
            return bool(get("orion_payment_safety_p0")) is True, f"got={get('orion_payment_safety_p0')!r}"
        return False, f"unknown check id {cid!r}"

    # --- Capacity-migration fold layer (pure aggregation; 2026-06-09) ---
    # Every atomic predicate in run_check() is preserved byte-for-byte; the only
    # change is that we AND-fold the 36 atoms into 10 distinct capability units
    # (see docs/check-granularity.md, R1/R2/R3/R4/R6) before emitting. Each group
    # passes iff all its member atoms pass; failing members are surfaced in the
    # `reason` string so per-item diagnostic signal is retained.
    #
    # GROUPS maps each new capability check -> (rule, ordered list of atomic ids).
    GROUPS: list[tuple[str, str, list[str]]] = [
        # R2: all plumbing (reachability / file presence / schema / API-was-called) -> one gate.
        ("setup_gate", "R2", [
            "slack_audit_exists",
            "contacts_audit_exists",
            "escalation_plan_md_exists",
            "answer_json_valid_schema",
            "slack_messages_list_called",
            "slack_messages_get_called_at_least_7_times",
            "contacts_search_called",
        ]),
        # R3: route every escalation to the correct internal owner (homogeneous
        # "look up the right slack handle via Contacts + DM them" skill across 7 owners).
        ("internal_owners_routed", "R3", [
            "internal_owner_linda_contacted",
            "internal_owner_maria_contacted",
            "internal_owner_jake_contacted",
            "internal_owner_nina_contacted",
            "internal_owner_owen_contacted",
            "internal_owner_ivy_contacted",
            "internal_owner_ethan_contacted",
        ]),
        # Distinct capability: produced the required customer-reply drafts.
        ("customer_drafts_saved", "R1", [
            "drafts_save_called_at_least_4_times",
        ]),
        # R6: restraint — no message was sent to any external @buyer-* recipient.
        ("no_external_buyer_sends", "R6", [
            "no_external_send_buyer_nova",
            "no_external_send_buyer_helio",
            "no_external_send_buyer_kappa",
            "no_external_send_buyer_orion",
        ]),
        # R1: identify the actionable set (completeness + noise exclusion = one triage skill).
        ("real_issue_triage", "R1", [
            "real_issue_message_ids_complete",
            "real_issue_message_ids_excludes_noise",
        ]),
        # R4: per-escalation reasoning — five genuinely independent cases.
        ("nova_invoice_resolved", "R4", [
            "nova_customer_facing_amount_correct",
            "nova_invoice_id_correct",
            "nova_credit_memo_id_correct",
        ]),
        ("helio_compliance_resolved", "R4", [
            "helio_priority_is_p0",
            "helio_batch_id_correct",
            "helio_defective_component_correct",
            "helio_draft_must_route_to_legal_true",
        ]),
        ("kappa_contact_rotation", "R4", [
            "kappa_correct_contact_email_correct",
            "kappa_obsolete_contact_email_correct",
        ]),
        ("po9015_logistics_recovery", "R4", [
            "po9015_recovery_method_correct",
            "po9015_surcharge_usd_correct",
            "po9015_surcharge_split_correct",
        ]),
        ("orion_payment_safety", "R4", [
            "orion_action_hold_wire",
            "orion_last_verified_beneficiary_ref_correct",
            "orion_payment_safety_p0_true",
        ]),
    ]

    # Compute every atomic predicate exactly as before (unchanged logic). The
    # canonical atom set is the union of GROUPS members (rubric.json now lists the
    # folded group ids, so it can no longer drive atom evaluation).
    atoms: dict[str, tuple[bool, str]] = {}
    for _gid, _rule, members in GROUPS:
        for mid in members:
            if mid not in atoms:
                atoms[mid] = run_check(mid)

    results = []
    passed = 0
    for gid, rule, members in GROUPS:
        evaluated = [(mid, atoms.get(mid, (False, f"missing atom {mid!r}"))) for mid in members]
        failed = [mid for mid, (ok, _r) in evaluated if not ok]
        group_ok = not failed
        if group_ok:
            reason = f"ok ({len(members)} atom(s))"
        else:
            detail = "; ".join(f"{mid}: {atoms.get(mid, (False, ''))[1]}" for mid in failed)
            reason = f"failed [{rule}] {len(failed)}/{len(members)}: {detail}"
        results.append({
            "id": gid,
            "passed": group_ok,
            "reason": reason,
            "check_type": "deterministic_exact",
        })
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
