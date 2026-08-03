"""v2 verifier for browser-mail-calendar-supplier-meeting-workbench-ui.

Computes the 23 atomic predicates internally (each predicate byte-identical to
the pre-migration verifier — see ``run_check``) and emits 12 capability-unit
checks (capacity migration, 2026-06-09). Each emitted check is the AND of its
member atoms; per-atom failures are listed in ``reason``. No weights, no caps,
no tiers — score = checks_passed / checks_total.

Grouping rationale (see docs/check-granularity.md):
  - setup_gate (R2): audit json + summary deliverable present
  - read_alice_thread: navigated mail UI + opened the source mail (AND)
  - contacted_required_parties (R3): 3 outreach sends — homogeneous-trivial copy
  - two_way_clarification_with_farah (R4): the >=2-round conflict-resolution skill
  - decoy_thread_ignored (R6): negative restraint on the decoy domain
  - final_confirmation_to_alice (R4): closing the loop to the requester
  - calendar_event_created_via_ui: used calendar UI + valid title (AND)
  - timezone_window_resolved: the core cross-timezone scheduling math (start+end AND)
  - meeting_room_selected: closed-set room pick with the C2 trap (AND)
  - all_attendees_present (R3): 4-attendee roster — homogeneous-trivial copy
  - no_existing_event_deleted (R6): negative restraint
  - ui_only_no_api_bypass (R6): negative restraint (UI-only, no /api/* bypass)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def endpoint_count(audit: dict[str, Any], suffix: str) -> int:
    return sum(1 for c in audit.get("calls", []) if str(c.get("endpoint", "")).endswith(suffix))


def calls_with_suffix(audit: dict[str, Any], suffix: str) -> list[dict[str, Any]]:
    return [c for c in audit.get("calls", []) if str(c.get("endpoint", "")).endswith(suffix)]


def lower(s: Any) -> str:
    return str(s or "").strip().lower()


def recipient_list(value: Any) -> list[str]:
    if isinstance(value, list):
        raw = value
    else:
        raw = str(value or "").replace(";", ",").split(",")
    return [lower(item) for item in raw if lower(item)]


# Canonical 23 atomic predicates (ids drive run_check; predicates unchanged).
ATOM_IDS = [
    "workbench_audit_exists",
    "summary_md_exists",
    "ui_mail_list_called",
    "ui_mail_get_called_at_least_4_times",
    "ui_mail_alice_message_opened",
    "ui_mail_contacted_farah",
    "ui_mail_contacted_diego",
    "ui_mail_contacted_mina",
    "ui_mail_clarified_farah_at_least_twice",
    "ui_mail_decoy_domain_not_contacted",
    "ui_mail_notified_alice",
    "ui_calendar_create_called",
    "calendar_event_title_contains_solar_or_rfq",
    "calendar_event_correct_start_time",
    "calendar_event_correct_end_time",
    "calendar_event_correct_location",
    "calendar_event_location_not_c2",
    "calendar_event_attendee_alice",
    "calendar_event_attendee_farah",
    "calendar_event_attendee_diego",
    "calendar_event_attendee_mina",
    "calendar_no_delete_called",
    "no_api_bypass",
]

# Capability-unit groups: ordered, each = AND of its member atoms. The flat
# member list is an exact partition of ATOM_IDS (asserted at runtime).
GROUPS: list[tuple[str, str, list[str]]] = [
    ("setup_gate", "deterministic_exact",
     ["workbench_audit_exists", "summary_md_exists"]),
    ("read_alice_thread", "deterministic_exact",
     ["ui_mail_list_called", "ui_mail_get_called_at_least_4_times",
      "ui_mail_alice_message_opened"]),
    ("contacted_required_parties", "deterministic_exact",
     ["ui_mail_contacted_farah", "ui_mail_contacted_diego", "ui_mail_contacted_mina"]),
    ("two_way_clarification_with_farah", "deterministic_exact",
     ["ui_mail_clarified_farah_at_least_twice"]),
    ("decoy_thread_ignored", "deterministic_exact",
     ["ui_mail_decoy_domain_not_contacted"]),
    ("final_confirmation_to_alice", "deterministic_exact",
     ["ui_mail_notified_alice"]),
    ("calendar_event_created_via_ui", "deterministic_exact",
     ["ui_calendar_create_called", "calendar_event_title_contains_solar_or_rfq"]),
    ("timezone_window_resolved", "deterministic_exact",
     ["calendar_event_correct_start_time", "calendar_event_correct_end_time"]),
    ("meeting_room_selected", "deterministic_exact",
     ["calendar_event_correct_location", "calendar_event_location_not_c2"]),
    ("all_attendees_present", "deterministic_exact",
     ["calendar_event_attendee_alice", "calendar_event_attendee_farah",
      "calendar_event_attendee_diego", "calendar_event_attendee_mina"]),
    ("no_existing_event_deleted", "deterministic_exact",
     ["calendar_no_delete_called"]),
    ("ui_only_no_api_bypass", "deterministic_exact", ["no_api_bypass"]),
]


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
    rubric = load_json(task_dir / "rubric.json", {}) or {}

    audit_path = output_dir / "mock_audit" / "workbench_audit.json"
    summary_path = output_dir / "meeting_workbench_summary.md"

    audit_raw = None
    if audit_path.exists():
        try:
            audit_raw = json.loads(audit_path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            audit_raw = None
    audit = audit_raw if isinstance(audit_raw, dict) else {}

    expected_event = expected.get("expected_event", {})
    expected_start = expected_event.get("start_time", "")
    expected_end = expected_event.get("end_time", "")
    expected_location = lower(expected_event.get("location", ""))
    title_must_contain_any = [t.lower() for t in expected_event.get("title_must_contain_any", [])]
    forbidden_location_token = lower(expected.get("forbidden_location_token", ""))
    decoy_domain = expected.get("decoy_domain", "")
    farah_email = lower(expected.get("farah_email", ""))
    alice_email = lower(expected.get("alice_email", ""))
    alice_msg_id = expected.get("alice_message_id", "")

    send_calls = calls_with_suffix(audit, "/ui/mail/send")
    create_calls = calls_with_suffix(audit, "/ui/calendar/create")
    delete_calls = calls_with_suffix(audit, "/ui/calendar/delete")
    deleted = audit.get("deleted", []) if isinstance(audit, dict) else []

    def send_to_count(target: str) -> int:
        t = lower(target)
        return sum(1 for c in send_calls if t in recipient_list((c.get("request_body") or {}).get("to")))

    def alice_get_called() -> bool:
        for c in calls_with_suffix(audit, "/ui/mail/get"):
            body = c.get("request_body") or {}
            if body.get("message_id") == alice_msg_id:
                return True
        return False

    def find_matching_create_event() -> dict[str, Any] | None:
        for c in create_calls:
            body = c.get("request_body") or {}
            if str(body.get("start_time", "")) == expected_start and str(body.get("end_time", "")) == expected_end:
                return body
        return None

    matching_event = find_matching_create_event()

    def event_attendee_present(target: str) -> bool:
        if matching_event is None:
            for c in create_calls:
                body = c.get("request_body") or {}
                attendees_lower = recipient_list(body.get("attendees"))
                if lower(target) in attendees_lower:
                    return True
            return False
        attendees_lower = recipient_list(matching_event.get("attendees"))
        return lower(target) in attendees_lower

    def api_bypass_count() -> int:
        return sum(
            1
            for c in audit.get("calls", [])
            if str(c.get("endpoint", "")).startswith("/api/")
        )

    def run_check(cid: str) -> tuple[bool, str]:
        if cid == "workbench_audit_exists":
            if not audit_path.exists():
                return False, "missing workbench_audit.json"
            return isinstance(audit_raw, dict), ("ok" if isinstance(audit_raw, dict) else "not a JSON object")
        if cid == "summary_md_exists":
            if not summary_path.exists():
                return False, "missing meeting_workbench_summary.md"
            try:
                content = summary_path.read_text(encoding="utf-8-sig", errors="ignore")
            except OSError as e:
                return False, f"cannot read: {e}"
            return len(content.strip()) > 0, f"len={len(content.strip())}"
        if cid == "ui_mail_list_called":
            n = endpoint_count(audit, "/ui/mail/list")
            return n >= 1, f"list_calls={n}"
        if cid == "ui_mail_get_called_at_least_4_times":
            n = endpoint_count(audit, "/ui/mail/get")
            return n >= 4, f"get_calls={n}"
        if cid == "ui_mail_alice_message_opened":
            ok = alice_get_called()
            return ok, f"alice_msg_get={ok!r} (msg_id={alice_msg_id!r})"
        if cid == "ui_mail_contacted_farah":
            n = send_to_count("farah.hussein@nilepumps.eg")
            return n >= 1, f"send_count={n}"
        if cid == "ui_mail_contacted_diego":
            n = send_to_count("diego.ramos@company.com")
            return n >= 1, f"send_count={n}"
        if cid == "ui_mail_contacted_mina":
            n = send_to_count("mina.chen@company.com")
            return n >= 1, f"send_count={n}"
        if cid == "ui_mail_clarified_farah_at_least_twice":
            n = send_to_count(farah_email)
            return n >= 2, f"farah_send_count={n}"
        if cid == "ui_mail_decoy_domain_not_contacted":
            if not isinstance(audit_raw, dict):
                return False, "workbench_audit missing → cannot evaluate"
            offenders = [
                recip
                for c in send_calls
                for recip in recipient_list((c.get("request_body") or {}).get("to"))
                if recip.endswith("@" + decoy_domain.lower())
            ]
            return len(offenders) == 0, f"decoy_recipients={offenders}"
        if cid == "ui_mail_notified_alice":
            n = send_to_count(alice_email)
            return n >= 1, f"send_count={n}"
        if cid == "ui_calendar_create_called":
            return len(create_calls) >= 1, f"create_calls={len(create_calls)}"
        if cid == "calendar_event_title_contains_solar_or_rfq":
            for c in create_calls:
                title = lower((c.get("request_body") or {}).get("title"))
                if any(tok in title for tok in title_must_contain_any):
                    return True, f"title_ok={title!r}"
            return False, "no event title contains 'solar pump' or 'rfq'"
        if cid == "calendar_event_correct_start_time":
            hits = [c for c in create_calls if str((c.get("request_body") or {}).get("start_time", "")) == expected_start]
            return len(hits) >= 1, f"matches={len(hits)} expected_start={expected_start!r}"
        if cid == "calendar_event_correct_end_time":
            hits = [c for c in create_calls if str((c.get("request_body") or {}).get("end_time", "")) == expected_end]
            return len(hits) >= 1, f"matches={len(hits)} expected_end={expected_end!r}"
        if cid == "calendar_event_correct_location":
            if matching_event is None:
                return False, "no event matched start/end → cannot evaluate location"
            loc = lower(matching_event.get("location"))
            return loc == expected_location, f"loc={loc!r} expected={expected_location!r}"
        if cid == "calendar_event_location_not_c2":
            if matching_event is None:
                return False, "no event matched start/end → cannot evaluate location"
            loc = lower(matching_event.get("location"))
            return forbidden_location_token not in loc, f"loc={loc!r}"
        if cid == "calendar_event_attendee_alice":
            ok = event_attendee_present("alice.li@company.com")
            return ok, f"present={ok}"
        if cid == "calendar_event_attendee_farah":
            ok = event_attendee_present("farah.hussein@nilepumps.eg")
            return ok, f"present={ok}"
        if cid == "calendar_event_attendee_diego":
            ok = event_attendee_present("diego.ramos@company.com")
            return ok, f"present={ok}"
        if cid == "calendar_event_attendee_mina":
            ok = event_attendee_present("mina.chen@company.com")
            return ok, f"present={ok}"
        if cid == "calendar_no_delete_called":
            if not isinstance(audit_raw, dict):
                return False, "workbench_audit missing → cannot evaluate"
            n_deleted = len(deleted) if isinstance(deleted, list) else 0
            return (len(delete_calls) == 0 and n_deleted == 0), f"delete_calls={len(delete_calls)} deleted_records={n_deleted}"
        if cid == "no_api_bypass":
            if not isinstance(audit_raw, dict):
                return False, "workbench_audit missing → cannot evaluate"
            n = api_bypass_count()
            return n == 0, f"api_bypass_calls={n}"
        return False, f"unknown check id {cid!r}"

    # --- compute every atomic predicate (byte-identical logic in run_check) ---
    atom_results: dict[str, tuple[bool, str]] = {aid: run_check(aid) for aid in ATOM_IDS}

    # partition guard: GROUPS members must exactly cover ATOM_IDS (no drop/dup)
    grouped_members = [m for _, _, members in GROUPS for m in members]
    assert sorted(grouped_members) == sorted(ATOM_IDS), "GROUPS is not a partition of ATOM_IDS"

    # --- fold atoms into capability-unit checks (AND), keeping per-atom detail ---
    results = []
    passed = 0
    for gid, ctype, members in GROUPS:
        failed = [aid for aid in members if not atom_results[aid][0]]
        ok = not failed
        if ok:
            reason = "ok" if len(members) > 1 else atom_results[members[0]][1]
        else:
            reason = "failed: " + "; ".join(f"{aid}({atom_results[aid][1]})" for aid in failed)
        results.append({"id": gid, "passed": ok, "reason": reason, "check_type": ctype})
        if ok:
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
