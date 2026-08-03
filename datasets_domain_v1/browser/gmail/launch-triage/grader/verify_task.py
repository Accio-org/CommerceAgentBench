from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any


MUTATION_EVENTS = {
    "message_action",
    "draft_saved",
    "draft_deleted",
    "message_sent",
    "message_scheduled",
    "label_created",
    "filter_saved",
    "subscription_unsubscribed",
    "task_created",
    "task_updated",
    "calendar_event_created",
    "note_created",
    "contact_created",
    "settings_saved",
    "ui_command",
    "reset",
    "workspace_tool_call",
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def verifier_headers() -> dict[str, str]:
    return {"X-Mock-Verifier-Token": os.environ.get("MOCK_VERIFIER_TOKEN") or "bench-verifier"}


def fetch_json(url: str, *, headers: dict[str, str] | None = None) -> Any:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def lower(value: Any) -> str:
    return str(value or "").strip().lower()


def compact(value: Any) -> str:
    return re.sub(r"[\s_\-–—]+", "", lower(value))


def contains_token(text: Any, token: Any) -> bool:
    haystack = lower(text)
    needle = lower(token)
    if needle in haystack:
        return True
    return compact(needle) in compact(haystack)


def all_tokens(text: Any, tokens: list[str]) -> tuple[bool, list[str]]:
    missing = [token for token in tokens if not contains_token(text, token)]
    return not missing, missing


def any_token(text: Any, tokens: list[str]) -> bool:
    return any(contains_token(text, token) for token in tokens)


def split_addresses(value: Any) -> set[str]:
    if isinstance(value, list):
        raw = ",".join(str(item) for item in value)
    else:
        raw = str(value or "")
    found = set(re.findall(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", raw))
    if found:
        return {item.lower() for item in found}
    return {part.strip().lower() for part in re.split(r"[,;\s]+", raw) if part.strip()}


def label_path(labels: list[dict[str, Any]], label: dict[str, Any]) -> list[str]:
    by_id = {item.get("id"): item for item in labels}
    path = [str(label.get("name") or "")]
    parent_id = label.get("parentId")
    seen = {label.get("id")}
    while parent_id and parent_id not in seen and parent_id in by_id:
        seen.add(parent_id)
        parent = by_id[parent_id]
        path.insert(0, str(parent.get("name") or ""))
        parent_id = parent.get("parentId")
    return path


def find_expected_label(state: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any] | None:
    target = expected["label"]
    for label in state.get("labels", []):
        if label.get("type") != "user":
            continue
        path = label_path(state.get("labels", []), label)
        if [lower(item) for item in path] == [lower(target["parent_name"]), lower(target["name"])]:
            return label
    return None


def message_map(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(item.get("id")): item for item in state.get("messages", [])}


def event_count(events: list[dict[str, Any]], type_: str, *, source: str | None = None) -> int:
    return sum(
        1
        for event in events
        if event.get("type") == type_ and (source is None or event.get("source") == source)
    )


def find_matching_draft(drafts: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for draft in drafts:
        to = split_addresses(draft.get("to"))
        cc = split_addresses(draft.get("cc"))
        expected_to = {lower(item) for item in spec.get("to", [])}
        if not expected_to.issubset(to):
            reasons.append(f"{spec['id']}: to={sorted(to)}")
            continue
        cc_any = {lower(item) for item in spec.get("cc_any", [])}
        if cc_any and not (cc & cc_any):
            reasons.append(f"{spec['id']}: cc={sorted(cc)}")
            continue
        ok_subject, missing_subject = all_tokens(draft.get("subject", ""), spec.get("subject_all", []))
        if not ok_subject:
            reasons.append(f"{spec['id']}: subject_missing={missing_subject}")
            continue
        ok_body, missing_body = all_tokens(draft.get("body", ""), spec.get("body_all", []))
        if not ok_body:
            reasons.append(f"{spec['id']}: body_missing={missing_body}")
            continue
        return draft, "ok"
    return None, "; ".join(reasons[-3:]) or "no drafts"


def find_matching_task(tasks: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for task in tasks:
        ok_title, missing_title = all_tokens(task.get("title", ""), spec.get("title_all", []))
        ok_details, missing_details = all_tokens(task.get("details", ""), spec.get("details_all", []))
        due_ok = any_token(task.get("due", ""), spec.get("due_any", []))
        if ok_title and ok_details and due_ok and not task.get("completed"):
            return task, "ok"
        reasons.append(
            f"title_missing={missing_title}, details_missing={missing_details}, due={task.get('due')!r}, completed={task.get('completed')!r}"
        )
    return None, "; ".join(reasons[-3:]) or "no tasks"


def find_matching_event(events: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for event in events:
        ok_title, missing_title = all_tokens(event.get("title", ""), spec.get("title_all", []))
        ok_description, missing_description = all_tokens(event.get("description", ""), spec.get("description_all", []))
        guests = split_addresses(event.get("guests"))
        guests_ok = {lower(item) for item in spec.get("guests_all", [])}.issubset(guests)
        fixed_ok = (
            event.get("date") == spec.get("date")
            and event.get("start") == spec.get("start")
            and event.get("end") == spec.get("end")
        )
        if ok_title and ok_description and guests_ok and fixed_ok:
            return event, "ok"
        reasons.append(
            "title_missing=%s description_missing=%s guests=%s date=%r start=%r end=%r"
            % (missing_title, missing_description, sorted(guests), event.get("date"), event.get("start"), event.get("end"))
        )
    return None, "; ".join(reasons[-3:]) or "no calendar events"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    parser.add_argument("--mock-url", default="http://127.0.0.1:3071")
    args = parser.parse_args()

    task_dir = Path(args.task_dir).resolve()
    reward_path = Path(args.reward_json)
    reward_path.parent.mkdir(parents=True, exist_ok=True)
    expected = load_json(task_dir / "private" / "expected_answer.json")
    rubric = load_json(task_dir / "rubric.json")

    state: dict[str, Any] = {}
    events_payload: dict[str, Any] = {}
    state_error = ""
    events_error = ""
    headers = verifier_headers()
    try:
        state = fetch_json(args.mock_url.rstrip("/") + "/api/state", headers=headers)
    except Exception as exc:  # noqa: BLE001 - verifier should report every failure as data
        state_error = str(exc)
    try:
        events_payload = fetch_json(args.mock_url.rstrip("/") + "/api/events", headers=headers)
    except Exception as exc:  # noqa: BLE001
        events_error = str(exc)
    events = events_payload.get("events", []) if isinstance(events_payload, dict) else []
    if not isinstance(events, list):
        events = []
    path_diagnostics = {
        "workspace_or_mcp_tool_events": sum(
            1
            for event in events
            if event.get("type") == "workspace_tool_call" or event.get("source") == "workspace"
        ),
        "direct_api_mutation_events": sum(
            1
            for event in events
            if event.get("source") == "api" and event.get("type") in MUTATION_EVENTS
        ),
        "ui_event_counts": {
            "label_created": event_count(events, "label_created", source="ui"),
            "message_action": event_count(events, "message_action", source="ui"),
            "draft_saved": event_count(events, "draft_saved", source="ui"),
            "task_created": event_count(events, "task_created", source="ui"),
            "calendar_event_created": event_count(events, "calendar_event_created", source="ui"),
        },
    }

    label = find_expected_label(state, expected) if isinstance(state, dict) else None
    label_id = label.get("id") if label else None
    messages = message_map(state) if isinstance(state, dict) else {}

    def run_check(cid: str) -> tuple[bool, str]:
        if cid == "mock_state_readable":
            return bool(state) and not state_error, "ok" if not state_error else state_error
        if cid == "mock_events_readable":
            return isinstance(events_payload, dict) and not events_error, "ok" if not events_error else events_error
        if cid == "no_workspace_or_mcp_tool_calls":
            return True, f"diagnostic_only workspace_events={path_diagnostics['workspace_or_mcp_tool_events']}"
        if cid == "no_direct_api_mutation_events":
            return True, f"diagnostic_only direct_api_mutations={path_diagnostics['direct_api_mutation_events']}"
        if cid == "ui_action_evidence_present":
            return True, "diagnostic_only " + json.dumps(path_diagnostics["ui_event_counts"], ensure_ascii=False, sort_keys=True)
        if cid == "nested_label_created":
            if not label:
                paths = ["/".join(label_path(state.get("labels", []), item)) for item in state.get("labels", []) if item.get("type") == "user"]
                return False, f"user_label_paths={paths}"
            return True, f"label_id={label_id}"
        if cid == "required_messages_labeled":
            missing = [
                msg_id
                for msg_id in expected.get("label_required_message_ids", [])
                if label_id not in (messages.get(msg_id, {}).get("labels") or [])
            ]
            return not missing, f"missing_label={missing}"
        if cid == "forbidden_messages_not_labeled":
            offenders = [
                msg_id
                for msg_id in expected.get("label_forbidden_message_ids", [])
                if label_id in (messages.get(msg_id, {}).get("labels") or [])
            ]
            return not offenders, f"offenders={offenders}"
        if cid == "required_messages_marked_read":
            unread = [msg_id for msg_id in expected.get("mark_read_message_ids", []) if messages.get(msg_id, {}).get("unread")]
            return not unread, f"still_unread={unread}"
        if cid == "blockers_starred":
            missing = [msg_id for msg_id in expected.get("star_required_message_ids", []) if not messages.get(msg_id, {}).get("starred")]
            return not missing, f"not_starred={missing}"
        if cid == "decoys_not_starred":
            offenders = [msg_id for msg_id in expected.get("star_forbidden_message_ids", []) if messages.get(msg_id, {}).get("starred")]
            return not offenders, f"starred_decoys={offenders}"
        if cid == "no_messages_sent":
            sent = [event for event in events if event.get("type") == "message_sent"]
            sent_messages = [msg for msg in state.get("messages", []) if "sent" in (msg.get("labels") or [])]
            return not sent and not sent_messages, f"sent_events={len(sent)} sent_messages={len(sent_messages)}"
        if cid == "required_drafts_saved":
            drafts = state.get("drafts", []) if isinstance(state, dict) else []
            missing = []
            for draft_spec in expected.get("drafts", []):
                _, reason = find_matching_draft(drafts, draft_spec)
                if reason != "ok":
                    missing.append({draft_spec["id"]: reason})
            return not missing, f"missing_or_bad={missing}"
        if cid == "required_tasks_created":
            tasks = state.get("tasks", []) if isinstance(state, dict) else []
            missing = []
            for task_spec in expected.get("tasks", []):
                _, reason = find_matching_task(tasks, task_spec)
                if reason != "ok":
                    missing.append(reason)
            return not missing, f"missing_or_bad={missing}"
        if cid == "calendar_event_created":
            calendar_events = state.get("calendarEvents", []) if isinstance(state, dict) else []
            _, reason = find_matching_event(calendar_events, expected.get("calendar_event", {}))
            return reason == "ok", reason
        return False, f"unknown check id {cid}"

    # --- Capacity-check fold (pure aggregation; binary pass unchanged) ---
    # The per-atom predicates below are byte-identical to the pre-fold checks
    # (run_check, unchanged). The emit layer collapses same-capability atoms
    # into one capability check via AND, per docs/check-granularity.md (R1/R2/R6).
    # No predicate is loosened: a group passes iff every member atom passes;
    # the per-atom detail is preserved in the group reason string.
    ATOM_CHECK_TYPE = {
        "mock_state_readable": "deterministic_exact",
        "mock_events_readable": "deterministic_exact",
        "no_workspace_or_mcp_tool_calls": "deterministic_exact",
        "no_direct_api_mutation_events": "deterministic_exact",
        "ui_action_evidence_present": "deterministic_exact",
        "nested_label_created": "deterministic_exact",
        "required_messages_labeled": "deterministic_exact",
        "forbidden_messages_not_labeled": "deterministic_exact",
        "required_messages_marked_read": "deterministic_exact",
        "blockers_starred": "deterministic_exact",
        "decoys_not_starred": "deterministic_exact",
        "no_messages_sent": "deterministic_exact",
        "required_drafts_saved": "deterministic_semantic",
        "required_tasks_created": "deterministic_semantic",
        "calendar_event_created": "deterministic_semantic",
    }
    # new_check_id -> (check_type, [member atom ids]); group passes iff AND(atoms).
    GROUPS: list[tuple[str, str, list[str]]] = [
        # R2: all plumbing/reachability + diagnostic-only path checks → one gate.
        ("setup_gate", "deterministic_exact", [
            "mock_state_readable",
            "mock_events_readable",
            "no_workspace_or_mcp_tool_calls",
            "no_direct_api_mutation_events",
            "ui_action_evidence_present",
        ]),
        # Anchor capability: nested label hierarchy created.
        ("nested_label_created", "deterministic_exact", ["nested_label_created"]),
        # R1: one selection competency — apply the correct triage state (label +
        # read) to the current ALP-26 action set (same 9 messages).
        ("action_set_triaged", "deterministic_exact", [
            "required_messages_labeled",
            "required_messages_marked_read",
        ]),
        # R6 negative: restraint — stale / ALP-25 / near-domain / noise excluded.
        ("noise_excluded_from_label", "deterministic_exact", ["forbidden_messages_not_labeled"]),
        # R1: one star-selection competency — exactly the 4 blockers, no decoys.
        ("blockers_starred_exactly", "deterministic_exact", [
            "blockers_starred",
            "decoys_not_starred",
        ]),
        # R6 negative: draft-only restraint (nothing sent).
        ("no_messages_sent", "deterministic_exact", ["no_messages_sent"]),
        # Distinct artifact-construction capabilities.
        ("required_drafts_saved", "deterministic_semantic", ["required_drafts_saved"]),
        ("required_tasks_created", "deterministic_semantic", ["required_tasks_created"]),
        ("calendar_event_created", "deterministic_semantic", ["calendar_event_created"]),
    ]

    # Evaluate every atom once (predicate + reason unchanged from run_check).
    atoms: dict[str, tuple[bool, str]] = {}
    for atom_id in ATOM_CHECK_TYPE:
        atoms[atom_id] = run_check(atom_id)

    checks = []
    passed = 0
    for gid, check_type, members in GROUPS:
        member_results = [(m, *atoms[m]) for m in members]
        ok = all(res_ok for _, res_ok, _ in member_results)
        if len(members) == 1:
            reason = member_results[0][2]
        elif ok:
            reason = "ok (" + "; ".join(f"{m}=ok" for m, _, _ in member_results) + ")"
        else:
            reason = "; ".join(
                f"{m}: {r}" for m, res_ok, r in member_results if not res_ok
            )
        checks.append({
            "id": gid,
            "passed": bool(ok),
            "reason": reason,
            "check_type": check_type,
        })
        if ok:
            passed += 1

    total = len(checks)
    score = passed / total if total else 0.0
    reward = {
        "schema_version": "2.0",
        "task_id": expected.get("task_id", rubric.get("task_id")),
        "score": round(score, 4),
        "reward": round(score, 4),
        "passed": passed == total and total > 0,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "diagnostics": {
            "events": path_diagnostics,
        },
        "source": "gmail_launch_triage_state_verifier",
    }
    reward_path.write_text(json.dumps(reward, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": reward["score"], "checks_passed": passed, "checks_total": total}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
