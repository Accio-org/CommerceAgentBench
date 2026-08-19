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
    "contact_updated",
    "settings_saved",
    "ui_command",
    "reset",
    "workspace_tool_call",
}

PATH_DIAGNOSTIC_CHECKS = {
    "no_workspace_or_mcp_tool_calls",
    "workspace_tool_evidence_present",
    "no_ui_mutation_events",
    "no_direct_api_mutation_events",
    "ui_action_evidence_present",
}

# Plumbing / anti-cheat atomic ids that always emit a no-op True (setup-state
# fetch + the PATH_DIAGNOSTIC_CHECKS diagnostics). They fold into a single
# ``setup_gate`` capability check (check-granularity R2). They are *not* a
# distinct competence the task measures, so they must not inflate checks_total.
SETUP_ATOM_IDS = {"mock_state_readable", "mock_events_readable"} | PATH_DIAGNOSTIC_CHECKS

# Atomic check id -> capability bucket (check-granularity R1/R3/R4/R6). One map
# covers the whole 8-task gmail_ui_state cluster (R7: a shared verifier carries
# its own check budget — collapse-only, pure aggregation). The mapping is a
# complete partition of every atomic id any of the 8 rubrics drives; new/unknown
# ids fall back to ``other_actions`` so a future task stays scorable before the
# map is extended (mirrors alibaba_publish_v2.group_for).
#
#   setup_gate              all plumbing + diagnostics (R2)
#   labeling_correct        create the right label + apply to the case threads +
#                           restrain from decoy threads — one inclusion/exclusion
#                           judgement with positive+negative faces (R1)
#   marked_read_correct     process (mark read) the case threads — distinct mock
#                           action (R4)
#   starring_correct        flag the true blockers + restrain on decoys — one
#                           prioritisation judgement with positive+negative
#                           faces (R1/R6)
#   message_routing_correct move messages to the right destination (archive /
#                           spam / snooze) — same "place message" skill (R3)
#   filters_correct         build the future-alert filter rule(s) (R4)
#   subscriptions_correct   unsubscribe the promos + preserve the operational
#                           alert — one restraint judgement (R1/R6)
#   drafts_correct          compose the required draft(s) with the right facts (R4)
#   scheduled_send_correct  compose + schedule the status-update send (R4)
#   tasks_correct           create the follow-up task(s) (R4)
#   calendar_event_correct  construct the calendar event(s) (R4)
#   notes_correct           build the Keep note(s) (R4)
#   contacts_correct        create the contact(s) (R4)
#   no_messages_sent        negative restraint: nothing was actually sent (R6)
CAPABILITY_GROUPS: dict[str, str] = {
    # setup / anti-cheat plumbing
    "mock_state_readable": "setup_gate",
    "mock_events_readable": "setup_gate",
    "no_workspace_or_mcp_tool_calls": "setup_gate",
    "workspace_tool_evidence_present": "setup_gate",
    "no_ui_mutation_events": "setup_gate",
    "no_direct_api_mutation_events": "setup_gate",
    "ui_action_evidence_present": "setup_gate",
    # labeling (create + apply + restraint)
    "nested_label_created": "labeling_correct",
    "nested_labels_created": "labeling_correct",
    "required_messages_labeled": "labeling_correct",
    "messages_labeled": "labeling_correct",
    "forbidden_messages_not_labeled": "labeling_correct",
    "messages_not_labeled": "labeling_correct",
    # read processing
    "required_messages_marked_read": "marked_read_correct",
    "messages_marked_read": "marked_read_correct",
    # prioritisation (star + restraint)
    "blockers_starred": "starring_correct",
    "messages_starred": "starring_correct",
    "decoys_not_starred": "starring_correct",
    "messages_not_starred": "starring_correct",
    # message routing / placement
    "messages_archived": "message_routing_correct",
    "messages_in_spam": "message_routing_correct",
    "messages_in_trash": "message_routing_correct",
    "messages_snoozed": "message_routing_correct",
    "messages_not_snoozed": "message_routing_correct",
    # filters
    "filters_created": "filters_correct",
    # subscriptions (unsubscribe + preserve)
    "subscriptions_unsubscribed": "subscriptions_correct",
    "subscriptions_preserved": "subscriptions_correct",
    # synthesis artefacts (distinct construction skills)
    "required_drafts_saved": "drafts_correct",
    "scheduled_messages_created": "scheduled_send_correct",
    "required_tasks_created": "tasks_correct",
    "calendar_event_created": "calendar_event_correct",
    "calendar_events_created": "calendar_event_correct",
    "required_notes_created": "notes_correct",
    "required_contacts_created": "contacts_correct",
    # negative restraint
    "no_messages_sent": "no_messages_sent",
}

# Stable emission order for buckets present in a given task.
GROUP_ORDER = [
    "setup_gate",
    "labeling_correct",
    "marked_read_correct",
    "starring_correct",
    "message_routing_correct",
    "filters_correct",
    "subscriptions_correct",
    "drafts_correct",
    "scheduled_send_correct",
    "tasks_correct",
    "calendar_event_correct",
    "notes_correct",
    "contacts_correct",
    "no_messages_sent",
]


def group_for(atomic_id: str) -> str:
    """Map an atomic check id to its capability bucket (R7 shared partition).

    Unknown ids fall back to ``other_actions`` so a future task that adds a new
    atomic stays scorable (and surfaces as a distinct bucket) before this map is
    extended.
    """
    return CAPABILITY_GROUPS.get(atomic_id, "other_actions")


def fold_atoms(group_id: str, atoms: list[tuple[str, bool, str]], check_type: str = "deterministic_exact") -> dict[str, Any]:
    """Fold atomic ``(id, passed, reason)`` results into one capability check.

    ``passed = all atoms pass`` — pure aggregation, identical to the AND of the
    old per-atomic rubric checks, so binary pass is unchanged and only capacity
    (passed / total) de-inflates. Every failing member id is listed in
    ``reason`` so diagnosability is preserved (the per-atomic predicate reasons
    are kept verbatim too).
    """
    total = len(atoms)
    failed = [a for a in atoms if not a[1]]
    npass = total - len(failed)
    if not failed:
        reason = f"{npass}/{total} ok"
    else:
        parts = [f"{a[0]}[{a[2]}]" if a[2] else a[0] for a in failed]
        reason = f"{npass}/{total} ok; FAILED: " + "; ".join(parts)
    return {"id": group_id, "passed": not failed, "reason": reason[:500], "check_type": check_type}


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
    return bool(needle and (needle in haystack or compact(needle) in compact(haystack)))


def all_tokens(text: Any, tokens: list[str]) -> tuple[bool, list[str]]:
    missing = [token for token in tokens if not contains_token(text, token)]
    return not missing, missing


def clock_time_matches(actual: Any, expected: Any) -> bool:
    got = str(actual or "")
    want = str(expected or "")
    if got == want:
        return True
    match = re.search(r"(?:^|[T\s])(\d{2}:\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?$", got)
    return bool(match and match.group(1) == want)


def split_addresses(value: Any) -> set[str]:
    raw = ",".join(str(item) for item in value) if isinstance(value, list) else str(value or "")
    found = set(re.findall(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", raw))
    if found:
        return {item.lower() for item in found}
    return {part.strip().lower() for part in re.split(r"[,;\s]+", raw) if part.strip()}


def event_count(events: list[dict[str, Any]], type_: str, *, source: str | None = None) -> int:
    return sum(
        1
        for event in events
        if event.get("type") == type_ and (source is None or event.get("source") == source)
    )


def gmail_event_diagnostics(events: list[dict[str, Any]], expected: dict[str, Any]) -> dict[str, Any]:
    workspace_tool_counts: dict[str, int] = {}
    for event in events:
        if event.get("type") != "workspace_tool_call":
            continue
        tool = str(event.get("tool") or "")
        workspace_tool_counts[tool] = workspace_tool_counts.get(tool, 0) + 1
    required_workspace_tools = expected.get("required_workspace_tools", {})
    required_ui_events = expected.get("required_ui_events", {})
    ui_event_counts = {key: event_count(events, key, source="ui") for key in required_ui_events}
    return {
        "workspace_or_mcp_tool_events": sum(
            1
            for event in events
            if event.get("type") == "workspace_tool_call" or event.get("source") == "workspace"
        ),
        "workspace_tool_counts": workspace_tool_counts,
        "required_workspace_tools": required_workspace_tools,
        "ui_mutation_events": sum(1 for event in events if event.get("source") == "ui" and event.get("type") in MUTATION_EVENTS),
        "direct_api_mutation_events": sum(1 for event in events if event.get("source") == "api" and event.get("type") in MUTATION_EVENTS),
        "ui_event_counts": ui_event_counts,
        "required_ui_events": required_ui_events,
    }


def message_map(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(item.get("id")): item for item in state.get("messages", [])}


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


def expected_labels(expected: dict[str, Any]) -> list[dict[str, Any]]:
    labels = expected.get("labels")
    if isinstance(labels, list):
        return [item for item in labels if isinstance(item, dict)]
    label = expected.get("label")
    return [label] if isinstance(label, dict) else []


def find_expected_label(state: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any] | None:
    target_path = [str(item) for item in spec.get("path", []) if str(item)]
    if not target_path and spec.get("parent_name") and spec.get("name"):
        target_path = [str(spec["parent_name"]), str(spec["name"])]
    elif not target_path and spec.get("name"):
        target_path = [str(spec["name"])]
    for label in state.get("labels", []):
        if label.get("type") != "user":
            continue
        path = label_path(state.get("labels", []), label)
        if [lower(item) for item in path] == [lower(item) for item in target_path]:
            return label
    return None


def first_expected_label_id(state: dict[str, Any], expected: dict[str, Any]) -> str | None:
    for spec in expected_labels(expected):
        label = find_expected_label(state, spec)
        if label:
            return str(label.get("id"))
    return None


def label_ids_by_ref(state: dict[str, Any], expected: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for spec in expected_labels(expected):
        label = find_expected_label(state, spec)
        if label:
            out[str(spec.get("id") or spec.get("name") or label.get("name"))] = str(label.get("id"))
    return out


def _required_addresses_ok(actual: Any, required: list[str]) -> bool:
    return {lower(item) for item in required}.issubset(split_addresses(actual))


def _any_addresses_ok(actual: Any, allowed: list[str]) -> bool:
    return not allowed or bool(split_addresses(actual) & {lower(item) for item in allowed})


def find_matching_draft(drafts: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for draft in drafts:
        if not _required_addresses_ok(draft.get("to"), spec.get("to", [])):
            reasons.append(f"{spec.get('id', 'draft')}: to={sorted(split_addresses(draft.get('to')))}")
            continue
        if not _any_addresses_ok(draft.get("cc"), spec.get("cc_any", [])):
            reasons.append(f"{spec.get('id', 'draft')}: cc={sorted(split_addresses(draft.get('cc')))}")
            continue
        ok_subject, missing_subject = all_tokens(draft.get("subject", ""), spec.get("subject_all", []))
        if not ok_subject:
            reasons.append(f"{spec.get('id', 'draft')}: subject_missing={missing_subject}")
            continue
        ok_body, missing_body = all_tokens(draft.get("body", ""), spec.get("body_all", []))
        if not ok_body:
            reasons.append(f"{spec.get('id', 'draft')}: body_missing={missing_body}")
            continue
        return draft, "ok"
    return None, "; ".join(reasons[-3:]) or "no matching drafts"


def find_matching_scheduled(messages: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for message in messages:
        if "scheduled" not in (message.get("labels") or []):
            continue
        if not _required_addresses_ok(message.get("to"), spec.get("to", [])):
            reasons.append(f"{spec.get('id', 'scheduled')}: to={sorted(split_addresses(message.get('to')))}")
            continue
        ok_subject, missing_subject = all_tokens(message.get("subject", ""), spec.get("subject_all", []))
        ok_body, missing_body = all_tokens(message.get("body", ""), spec.get("body_all", []))
        ok_time, missing_time = all_tokens(
            " ".join(str(message.get(key, "")) for key in ("scheduledAt", "date", "fullDate")),
            spec.get("scheduled_all", []),
        )
        if ok_subject and ok_body and ok_time:
            return message, "ok"
        reasons.append(
            f"{spec.get('id', 'scheduled')}: subject_missing={missing_subject}, body_missing={missing_body}, scheduled_missing={missing_time}"
        )
    return None, "; ".join(reasons[-3:]) or "no matching scheduled messages"


def find_matching_task(tasks: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for task in tasks:
        ok_title, missing_title = all_tokens(task.get("title", ""), spec.get("title_all", []))
        ok_details, missing_details = all_tokens(task.get("details", ""), spec.get("details_all", []))
        due_ok = not spec.get("due_any") or any(contains_token(task.get("due", ""), token) for token in spec.get("due_any", []))
        completed_ok = (
            bool(task.get("completed")) == bool(spec.get("completed"))
            if "completed" in spec
            else not task.get("completed")
        )
        if ok_title and ok_details and due_ok and completed_ok:
            return task, "ok"
        reasons.append(
            f"title_missing={missing_title}, details_missing={missing_details}, due={task.get('due')!r}, completed={task.get('completed')!r}"
        )
    return None, "; ".join(reasons[-3:]) or "no matching tasks"


def find_matching_event(events: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for event in events:
        ok_title, missing_title = all_tokens(event.get("title", ""), spec.get("title_all", []))
        ok_description, missing_description = all_tokens(event.get("description", ""), spec.get("description_all", []))
        guests_ok = {lower(item) for item in spec.get("guests_all", [])}.issubset(split_addresses(event.get("guests")))
        fixed_ok = True
        for key in ("date", "start", "end", "location"):
            if not spec.get(key):
                continue
            if key in {"start", "end"}:
                if clock_time_matches(event.get(key), spec.get(key)):
                    continue
            if str(event.get(key)) != str(spec.get(key)):
                fixed_ok = False
        if ok_title and ok_description and guests_ok and fixed_ok:
            return event, "ok"
        reasons.append(
            "title_missing=%s description_missing=%s guests=%s date=%r start=%r end=%r location=%r"
            % (missing_title, missing_description, sorted(split_addresses(event.get("guests"))), event.get("date"), event.get("start"), event.get("end"), event.get("location"))
        )
    return None, "; ".join(reasons[-3:]) or "no matching calendar events"


def find_matching_note(notes: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for note in notes:
        text = f"{note.get('title', '')}\n{note.get('body', '')}"
        ok, missing = all_tokens(text, spec.get("text_all", []))
        if ok:
            return note, "ok"
        reasons.append(f"{spec.get('id', 'note')}: missing={missing}")
    return None, "; ".join(reasons[-3:]) or "no matching notes"


def find_matching_contact(contacts: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for contact in contacts:
        if lower(contact.get("email")) != lower(spec.get("email")):
            continue
        ok_name, missing_name = all_tokens(contact.get("name", ""), spec.get("name_all", []))
        ok_notes, missing_notes = all_tokens(contact.get("notes", ""), spec.get("notes_all", []))
        phone_ok = not spec.get("phone") or contains_token(contact.get("phone", ""), spec.get("phone"))
        if ok_name and ok_notes and phone_ok:
            return contact, "ok"
        reasons.append(f"{spec.get('email')}: name_missing={missing_name}, notes_missing={missing_notes}, phone={contact.get('phone')!r}")
    return None, "; ".join(reasons[-3:]) or f"no contact {spec.get('email')}"


def find_matching_filter(filters: list[dict[str, Any]], spec: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    reasons: list[str] = []
    for item in filters:
        checks: list[tuple[str, bool]] = []
        for key, field in (("from", "from"), ("to", "to"), ("subject", "subject"), ("has_words", "hasWords"), ("doesnt_have", "doesntHave")):
            if spec.get(key):
                checks.append((key, contains_token(item.get(field, ""), spec[key])))
        if "has_attachment" in spec:
            checks.append(("has_attachment", bool(item.get("hasAttachment")) == bool(spec["has_attachment"])))
        actions = item.get("actions") if isinstance(item.get("actions"), dict) else {}
        for key, value in (spec.get("actions") or {}).items():
            checks.append((f"action.{key}", bool(actions.get(key)) == bool(value)))
        failed = [name for name, ok in checks if not ok]
        if not failed:
            return item, "ok"
        reasons.append(f"{spec.get('id', 'filter')}: failed={failed}")
    return None, "; ".join(reasons[-3:]) or "no matching filters"


def run_check(cid: str, state: dict[str, Any], events: list[dict[str, Any]], expected: dict[str, Any]) -> tuple[bool, str]:
    messages = message_map(state)
    label_id = first_expected_label_id(state, expected)
    labels_by_ref = label_ids_by_ref(state, expected)
    diagnostics = gmail_event_diagnostics(events, expected)

    if cid == "mock_state_readable":
        return bool(state), "ok" if state else "empty state"
    if cid == "mock_events_readable":
        return isinstance(events, list), f"events={len(events)}"
    if cid == "no_workspace_or_mcp_tool_calls":
        return True, f"diagnostic_only workspace_events={diagnostics['workspace_or_mcp_tool_events']}"
    if cid == "workspace_tool_evidence_present":
        return True, "diagnostic_only " + json.dumps(
            {
                "evidence": diagnostics["workspace_tool_counts"],
                "required": diagnostics["required_workspace_tools"],
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    if cid == "no_ui_mutation_events":
        return True, f"diagnostic_only ui_mutations={diagnostics['ui_mutation_events']}"
    if cid == "no_direct_api_mutation_events":
        return True, f"diagnostic_only direct_api_mutations={diagnostics['direct_api_mutation_events']}"
    if cid == "ui_action_evidence_present":
        return True, "diagnostic_only " + json.dumps(
            {
                "evidence": diagnostics["ui_event_counts"],
                "required": diagnostics["required_ui_events"],
            },
            ensure_ascii=False,
            sort_keys=True,
        )

    if cid in {"nested_label_created", "nested_labels_created"}:
        missing = []
        for spec in expected_labels(expected):
            if not find_expected_label(state, spec):
                missing.append(spec)
        return not missing, f"missing={missing} found_refs={labels_by_ref}"

    if cid in {"required_messages_labeled", "messages_labeled"}:
        ids = expected.get("label_required_message_ids", expected.get("messages_labeled", []))
        missing = [msg_id for msg_id in ids if label_id not in (messages.get(msg_id, {}).get("labels") or [])]
        return not missing, f"label_id={label_id} missing={missing}"
    if cid in {"forbidden_messages_not_labeled", "messages_not_labeled"}:
        ids = expected.get("label_forbidden_message_ids", expected.get("messages_not_labeled", []))
        offenders = [msg_id for msg_id in ids if label_id in (messages.get(msg_id, {}).get("labels") or [])]
        return not offenders, f"label_id={label_id} offenders={offenders}"
    if cid in {"required_messages_marked_read", "messages_marked_read"}:
        ids = expected.get("mark_read_message_ids", expected.get("messages_marked_read", []))
        unread = [msg_id for msg_id in ids if messages.get(msg_id, {}).get("unread")]
        return not unread, f"still_unread={unread}"
    if cid in {"blockers_starred", "messages_starred"}:
        ids = expected.get("star_required_message_ids", expected.get("messages_starred", []))
        missing = [msg_id for msg_id in ids if not messages.get(msg_id, {}).get("starred")]
        return not missing, f"not_starred={missing}"
    if cid in {"decoys_not_starred", "messages_not_starred"}:
        ids = expected.get("star_forbidden_message_ids", expected.get("messages_not_starred", []))
        offenders = [msg_id for msg_id in ids if messages.get(msg_id, {}).get("starred")]
        return not offenders, f"starred={offenders}"
    if cid == "messages_archived":
        ids = expected.get("messages_archived", [])
        offenders = [msg_id for msg_id in ids if "inbox" in (messages.get(msg_id, {}).get("labels") or [])]
        return not offenders, f"still_in_inbox={offenders}"
    if cid == "messages_in_spam":
        ids = expected.get("messages_in_spam", [])
        missing = [msg_id for msg_id in ids if "spam" not in (messages.get(msg_id, {}).get("labels") or [])]
        return not missing, f"not_spam={missing}"
    if cid == "messages_in_trash":
        ids = expected.get("messages_in_trash", [])
        missing = [msg_id for msg_id in ids if "trash" not in (messages.get(msg_id, {}).get("labels") or [])]
        return not missing, f"not_trash={missing}"
    if cid == "messages_snoozed":
        ids = expected.get("messages_snoozed", [])
        missing = [msg_id for msg_id in ids if "snoozed" not in (messages.get(msg_id, {}).get("labels") or [])]
        return not missing, f"not_snoozed={missing}"
    if cid == "messages_not_snoozed":
        ids = expected.get("messages_not_snoozed", [])
        offenders = [msg_id for msg_id in ids if "snoozed" in (messages.get(msg_id, {}).get("labels") or [])]
        return not offenders, f"snoozed={offenders}"

    if cid == "no_messages_sent":
        sent = [event for event in events if event.get("type") == "message_sent"]
        sent_messages = [msg for msg in state.get("messages", []) if "sent" in (msg.get("labels") or [])]
        return not sent and not sent_messages, f"sent_events={len(sent)} sent_messages={len(sent_messages)}"
    if cid == "required_drafts_saved":
        missing = []
        for spec in expected.get("drafts", []):
            _, reason = find_matching_draft(state.get("drafts", []), spec)
            if reason != "ok":
                missing.append({spec.get("id", "draft"): reason})
        return not missing, f"missing_or_bad={missing}"
    if cid == "scheduled_messages_created":
        missing = []
        for spec in expected.get("scheduled_messages", []):
            _, reason = find_matching_scheduled(state.get("messages", []), spec)
            if reason != "ok":
                missing.append({spec.get("id", "scheduled"): reason})
        return not missing, f"missing_or_bad={missing}"
    if cid == "required_tasks_created":
        missing = []
        for spec in expected.get("tasks", []):
            _, reason = find_matching_task(state.get("tasks", []), spec)
            if reason != "ok":
                missing.append({spec.get("id", "task"): reason})
        return not missing, f"missing_or_bad={missing}"
    if cid in {"calendar_event_created", "calendar_events_created"}:
        specs = expected.get("calendar_events") or ([expected.get("calendar_event")] if expected.get("calendar_event") else [])
        missing = []
        for spec in specs:
            _, reason = find_matching_event(state.get("calendarEvents", []), spec)
            if reason != "ok":
                missing.append({spec.get("id", "event"): reason})
        return not missing, f"missing_or_bad={missing}"
    if cid == "filters_created":
        missing = []
        for spec in expected.get("filters", []):
            _, reason = find_matching_filter(state.get("filters", []), spec)
            if reason != "ok":
                missing.append({spec.get("id", "filter"): reason})
        return not missing, f"missing_or_bad={missing}"
    if cid == "subscriptions_unsubscribed":
        by_email = {lower(item.get("email")): item for item in state.get("subscriptions", [])}
        missing = [email for email in expected.get("subscriptions_unsubscribed", []) if not by_email.get(lower(email), {}).get("unsubscribed")]
        return not missing, f"not_unsubscribed={missing}"
    if cid == "subscriptions_preserved":
        by_email = {lower(item.get("email")): item for item in state.get("subscriptions", [])}
        offenders = [email for email in expected.get("subscriptions_preserved", []) if by_email.get(lower(email), {}).get("unsubscribed")]
        return not offenders, f"incorrectly_unsubscribed={offenders}"
    if cid == "required_notes_created":
        missing = []
        for spec in expected.get("notes", []):
            _, reason = find_matching_note(state.get("notes", []), spec)
            if reason != "ok":
                missing.append({spec.get("id", "note"): reason})
        return not missing, f"missing_or_bad={missing}"
    if cid == "required_contacts_created":
        missing = []
        for spec in expected.get("contacts", []):
            _, reason = find_matching_contact(state.get("contacts", []), spec)
            if reason != "ok":
                missing.append({spec.get("email", "contact"): reason})
        return not missing, f"missing_or_bad={missing}"

    return False, f"unknown check id {cid}"


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
    except Exception as exc:  # noqa: BLE001
        state_error = str(exc)
    try:
        events_payload = fetch_json(args.mock_url.rstrip("/") + "/api/events", headers=headers)
    except Exception as exc:  # noqa: BLE001
        events_error = str(exc)
    events = events_payload.get("events", []) if isinstance(events_payload, dict) else []
    if not isinstance(events, list):
        events = []

    # Atomic ids the task drives. ``atomic_checks`` is the migrated field that
    # carries the original per-atomic rubric list; ``checks`` (back-compat) is
    # used when ``atomic_checks`` is absent (un-migrated rubric). The atomic
    # predicates (run_check) are evaluated exactly as before — the only change is
    # the emit layer, which folds them into capability buckets (R2/R3/R4/R6/R7).
    atomic_specs = rubric.get("atomic_checks") or rubric.get("checks", [])

    # Evaluate every atomic predicate (byte-identical to the pre-fold behaviour).
    atom_results: list[tuple[str, bool, str, str]] = []  # (id, passed, reason, check_type)
    for check in atomic_specs:
        cid = check["id"]
        if cid == "mock_state_readable" and state_error:
            ok, reason = False, state_error
        elif cid == "mock_events_readable" and events_error:
            ok, reason = False, events_error
        else:
            ok, reason = run_check(cid, state, events, expected)
        atom_results.append((cid, bool(ok), reason, check.get("check_type", "")))

    # Fold atomics into capability buckets. Every bucket = AND of its present
    # member atoms. ``setup_gate`` always carries the ``mock_state_readable``
    # anchor atom (it is in every rubric), so it is never empty; other buckets
    # only emit when >=1 of their member atoms is present in this task.
    bucket_atoms: dict[str, list[tuple[str, bool, str]]] = {}
    bucket_check_type: dict[str, str] = {}
    for cid, ok, reason, ctype in atom_results:
        bucket = group_for(cid)
        bucket_atoms.setdefault(bucket, []).append((cid, ok, reason))
        # Prefer a semantic check_type for the bucket if any member is semantic.
        prev = bucket_check_type.get(bucket, "")
        if ctype == "deterministic_semantic" or not prev:
            bucket_check_type[bucket] = ctype or prev

    checks = []
    extras = sorted(b for b in bucket_atoms if b not in GROUP_ORDER)
    for bucket in GROUP_ORDER + extras:
        atoms = bucket_atoms.get(bucket)
        if not atoms:
            continue
        checks.append(fold_atoms(bucket, atoms, bucket_check_type.get(bucket) or "deterministic_exact"))

    passed = sum(1 for c in checks if c["passed"])
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
            "events": gmail_event_diagnostics(events, expected),
            "path_diagnostic_check_ids": sorted(PATH_DIAGNOSTIC_CHECKS),
            "atomic_breakdown": [
                {"id": cid, "passed": ok, "reason": reason, "group": group_for(cid)}
                for cid, ok, reason, _ in atom_results
            ],
        },
        "source": "gmail_ui_state_verifier",
    }
    reward_path.write_text(json.dumps(reward, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": reward["score"], "checks_passed": passed, "checks_total": total}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
