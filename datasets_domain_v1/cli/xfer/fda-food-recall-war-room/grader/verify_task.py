#!/usr/bin/env python3
"""Verifier for cli-xfer-fda-food-recall-war-room.

Reads three final mock states:
  - gws                  : MOCK_SITE_URL_GOOGLE_WORKSPACE_CLI/api/state
  - jira_cli             : MOCK_SITE_URL_JIRA_CLI/api/state
  - todoist_cli          : MOCK_SITE_URL_TODOIST_CLI/api/state

The real FDA JSON snapshot is an agent-visible input file. The verifier checks
that it is still present/parseable, but scoring is based on the final state the
agent produced in the three CLI systems.
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import urllib.request
from pathlib import Path
from typing import Any


def _norm(v: Any) -> str:
    return " ".join(str(v or "").strip().casefold().split())


def firm_in(text: str, firm: str) -> bool:
    return firm in str(text or "")


def _fetch(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _read_state(env_names: tuple[str, ...], token: str,
                 state_path: str = "/api/state") -> tuple[dict[str, Any], str]:
    for env in env_names:
        base = os.environ.get(env, "").rstrip("/")
        if not base:
            continue
        if not token:
            return {}, "MOCK_VERIFIER_TOKEN not set"
        try:
            return _fetch(f"{base}{state_path}", token), ""
        except Exception as exc:  # noqa: BLE001
            return {}, f"{env}: {exc}"
    return {}, f"none of {', '.join(env_names)} set"


def chk(cid: str, ok: bool, reason: str = "") -> dict[str, Any]:
    return {"id": cid, "passed": bool(ok), "reason": str(reason)[:700], "check_type": "deterministic_exact"}


def _gws_db(state: dict[str, Any]) -> dict[str, Any]:
    return state.get("db", {}) if isinstance(state.get("db"), dict) else {}


def _find_sheet(spreadsheet: dict[str, Any], title: str) -> dict[str, Any] | None:
    for sheet in spreadsheet.get("sheets", []):
        if sheet.get("properties", {}).get("title") == title:
            return sheet
    return None


def _cell(cells: dict[str, Any], col: str, row: int) -> Any:
    raw = cells.get(f"{col}{row}")
    return raw.get("value") if isinstance(raw, dict) else None


def _presentation_text(presentation: dict[str, Any]) -> str:
    parts: list[str] = [str(presentation.get("title") or "")]
    for slide in presentation.get("slides", []):
        for el in slide.get("pageElements", []):
            text = ((el.get("shape") or {}).get("text") or {}).get("paragraphs") or []
            for para in text:
                for run in para.get("runs", []):
                    parts.append(str(run.get("content") or ""))
    return "\n".join(parts)


def _has_labeled_count(text: str, label: str, count: int) -> bool:
    folded = _norm(text)
    return _norm(label) in folded and str(count) in folded


def _user_to_api_priority(priority: int) -> int:
    return 5 - int(priority)


def evaluate(exp: dict[str, Any], gws: dict[str, Any], jira: dict[str, Any], todoist: dict[str, Any],
             gws_err: str, jira_err: str, todoist_err: str, source_ok: bool, source_reason: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    gdb = _gws_db(gws)
    spreadsheet = (gdb.get("spreadsheets") or {}).get(exp["spreadsheet_id"]) if not gws_err else None
    sheet = _find_sheet(spreadsheet or {}, exp["sheet_title"]) if spreadsheet else None
    trace_sheet = _find_sheet(spreadsheet or {}, exp.get("trace_sheet_title", "")) if spreadsheet else None
    presentation = (gdb.get("presentations") or {}).get(exp.get("presentation_id", "")) if not gws_err else None
    jira_project_ok = any(p.get("key") == exp["jira_project"] for p in jira.get("projects", [])) if not jira_err else False
    todo_project = None
    if not todoist_err:
        for p in todoist.get("projects", []):
            if _norm(p.get("name")) == _norm(exp["todoist_project"]):
                todo_project = p
                break

    # Seeded personal Todoist tasks (todoist_cli seeds 2500000001-2500000006)
    # must survive; destructive cleanup of pre-existing user data fails the gate.
    seed_missing: list[str] = []
    if not todoist_err:
        _live_ids = {str(i.get("id")) for i in todoist.get("items", []) if not i.get("is_deleted")}
        seed_missing = [str(s) for s in range(2500000001, 2500000007) if str(s) not in _live_ids]

    setup_ok = (
        (not gws_err) and (not jira_err) and (not todoist_err)
        and bool(spreadsheet) and bool(presentation) and jira_project_ok and bool(todo_project)
        and not seed_missing
    )
    setup_reason = (
        gws_err or jira_err or todoist_err
        or ("" if spreadsheet else f"spreadsheet {exp['spreadsheet_id']} missing")
        or ("" if presentation else f"presentation {exp.get('presentation_id')} missing")
        or ("" if jira_project_ok else f"jira project {exp['jira_project']} missing")
        or ("" if todo_project else f"todoist project {exp['todoist_project']!r} missing")
        or ("" if not seed_missing else f"seeded personal tasks deleted: {seed_missing}")
        or "ok"
    )
    checks.append(chk("setup_gate", setup_ok, setup_reason))
    checks.append(chk("source_file_present", source_ok, source_reason))
    if not setup_ok:
        for cid in ("sheet_rows_correct", "jira_epic_correct", "jira_inclusion_set_correct",
                    "jira_fields_correct", "todoist_queue_correct", "control_center_trace_correct"):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    in_scope = exp["in_scope"]
    expected_firms = {s["firm"] for s in in_scope}
    todo_expected = [s for s in in_scope if s["todoist_required"]]
    todo_expected_firms = {s["firm"] for s in todo_expected}

    issues = jira.get("issues", [])
    comments = jira.get("comments", [])
    recall_issues_for_trace = [
        i for i in issues
        if i.get("project_key") == exp["jira_project"]
        and i.get("type_name") == "Task"
        and exp["fixed_label"] in (i.get("labels") or [])
    ]
    issue_by_firm_for_trace: dict[str, list[dict[str, Any]]] = {}
    for issue in recall_issues_for_trace:
        summary = str(issue.get("summary") or "")
        matched = [firm for firm in expected_firms if firm in summary]
        if len(matched) == 1:
            issue_by_firm_for_trace.setdefault(matched[0], []).append(issue)

    todo_project_id = todo_project.get("id") if todo_project else None
    items = [i for i in todoist.get("items", []) if not i.get("is_deleted")]
    project_items = [i for i in items if i.get("project_id") == todo_project_id]
    item_by_firm_for_trace: dict[str, list[dict[str, Any]]] = {}
    ack_by_firm_for_trace: dict[str, list[dict[str, Any]]] = {}
    for item in project_items:
        content = str(item.get("content") or "")
        if item.get("is_completed"):
            matched = [s["firm"] for s in in_scope if s["critical_comment_required"] and firm_in(content, s["firm"])]
            if len(matched) == 1:
                ack_by_firm_for_trace.setdefault(matched[0], []).append(item)
        else:
            matched = [firm for firm in todo_expected_firms if firm_in(content, firm)]
            if len(matched) == 1:
                item_by_firm_for_trace.setdefault(matched[0], []).append(item)

    # Google Workspace sheet.
    if not sheet:
        checks.append(chk("sheet_rows_correct", False, f"sheet {exp['sheet_title']!r} missing"))
    else:
        cells = sheet.get("cells", {})
        headers = [_cell(cells, col, 1) for col in "ABCDEFGHI"]
        header_ok = [_norm(h) for h in headers] == [_norm(h) for h in exp["sheet_headers"]]
        row_fail: list[str] = []
        for idx, spec in enumerate(in_scope, start=2):
            issue = (issue_by_firm_for_trace.get(spec["firm"]) or [None])[0]
            item = (item_by_firm_for_trace.get(spec["firm"]) or [None])[0]
            expected = [
                spec["firm"],
                spec["severity"],
                spec["recall_count"],
                spec["recall_numbers"],
                spec["exposure_usd"],
                spec["owner"],
                spec["action"],
                issue.get("key") if issue else "",
                item.get("id") if item else "N/A",
            ]
            got = [_cell(cells, col, idx) for col in "ABCDEFGHI"]
            for j, (g, w) in enumerate(zip(got, expected, strict=True)):
                if isinstance(w, int):
                    ok = str(g) == str(w) or (isinstance(g, (int, float)) and int(g) == w)
                else:
                    ok = _norm(g) == _norm(w)
                if not ok:
                    row_fail.append(f"row {idx} col {'ABCDEFGHI'[j]} got {g!r}, want {w!r}")
                    break
        extras = []
        for row in range(2 + len(in_scope), 30):
            firm = _cell(cells, "A", row)
            if firm:
                extras.append(str(firm))
        sheet_ok = header_ok and not row_fail and not extras
        reason = "ok" if sheet_ok else f"header_ok={header_ok} row_fail={row_fail[:4]} extras={extras[:4]}"
        checks.append(chk("sheet_rows_correct", sheet_ok, reason))

    # Jira epic + tasks.
    allowed_epic_summaries = {_norm(exp["jira_epic_summary"])}
    allowed_epic_summaries.update(_norm(s) for s in exp.get("allowed_existing_epic_summaries", []))
    project_epics = [
        i for i in issues
        if i.get("project_key") == exp["jira_project"]
        and i.get("type_name") == "Epic"
    ]
    epics = [
        i for i in issues
        if _norm(i.get("summary")) == _norm(exp["jira_epic_summary"])
        and i.get("project_key") == exp["jira_project"]
        and i.get("type_name") == "Epic"
    ]
    extra_epics = [
        str(i.get("summary") or "")[:90]
        for i in project_epics
        if _norm(i.get("summary")) not in allowed_epic_summaries
    ]
    epic_ok = len(epics) == 1 and not extra_epics
    epic_key = epics[0].get("key") if epic_ok else ""
    checks.append(chk("jira_epic_correct", epic_ok,
                      "ok" if epic_ok else f"expected one canonical epic, got {len(epics)}; extra_epics={extra_epics[:3]}"))

    recall_issues = [
        i for i in issues
        if i.get("project_key") == exp["jira_project"]
        and i.get("type_name") == "Task"
        and exp["fixed_label"] in (i.get("labels") or [])
    ]
    issue_by_firm: dict[str, list[dict[str, Any]]] = {}
    extras: list[str] = []
    for issue in recall_issues:
        summary = str(issue.get("summary") or "")
        matched = [firm for firm in expected_firms if firm in summary]
        if len(matched) == 1:
            issue_by_firm.setdefault(matched[0], []).append(issue)
        else:
            extras.append(summary[:90])
    missing = sorted(expected_firms - set(issue_by_firm))
    dups = sorted(f for f, vals in issue_by_firm.items() if len(vals) != 1)
    inclusion_ok = not missing and not dups and not extras and len(recall_issues) == len(in_scope)
    checks.append(chk("jira_inclusion_set_correct", inclusion_ok,
                      "ok" if inclusion_ok else f"missing={missing} dups={dups} extras={extras[:3]} total={len(recall_issues)}"))

    jira_fail: list[str] = []
    for spec in in_scope:
        issue = (issue_by_firm.get(spec["firm"]) or [None])[0]
        if not issue:
            jira_fail.append(f"{spec['firm']}: no issue")
            continue
        summary = str(issue.get("summary") or "")
        expected_parts = [
            f"[{spec['severity']}]",
            spec["firm"],
            f"{spec['recall_count']} recall(s)",
            f"exposure ${spec['exposure_usd']}",
            f"owner: {spec['owner']}",
        ]
        missing_parts = [part for part in expected_parts if part not in summary]
        if missing_parts:
            jira_fail.append(f"{spec['firm']}: summary missing {missing_parts}")
        if _norm(issue.get("priority_name")) != _norm(spec["jira_priority"]):
            jira_fail.append(f"{spec['firm']}: priority {issue.get('priority_name')!r}")
        labels = set(issue.get("labels") or [])
        want_labels = {exp["fixed_label"], spec["jira_label"]}
        if labels != want_labels:
            jira_fail.append(f"{spec['firm']}: labels {sorted(labels)} want {sorted(want_labels)}")
        if _norm(issue.get("status_name")) != _norm(exp["jira_target_state"]):
            jira_fail.append(f"{spec['firm']}: status {issue.get('status_name')!r}")
        firm_comments = [
            c for c in comments
            if c.get("issue_key") == issue.get("key")
            and _norm(c.get("body")) == _norm(exp["jira_critical_comment"])
        ]
        if spec["critical_comment_required"] and not firm_comments:
            jira_fail.append(f"{spec['firm']}: missing critical comment")
        if not spec["critical_comment_required"] and firm_comments:
            jira_fail.append(f"{spec['firm']}: unexpected critical comment")
        row_number = 2 + in_scope.index(spec)
        item = (item_by_firm_for_trace.get(spec["firm"]) or [None])[0]
        todoist_ref = item.get("id") if item else "N/A"
        trace_body = f"Trace: GWS row {row_number}; Todoist task {todoist_ref}."
        trace_comments = [
            c for c in comments
            if c.get("issue_key") == issue.get("key")
            and _norm(c.get("body")) == _norm(trace_body)
        ]
        if not trace_comments:
            jira_fail.append(f"{spec['firm']}: missing trace comment {trace_body!r}")
        linked = any(
            l.get("inward_key") == issue.get("key")
            and l.get("outward_key") == epic_key
            and _norm(l.get("link_type")) == _norm(exp.get("jira_link_type", "relates to"))
            for l in jira.get("issue_links", [])
        )
        if not linked:
            jira_fail.append(f"{spec['firm']}: missing Jira link to epic {epic_key}")
    checks.append(chk("jira_fields_correct", not jira_fail, "ok" if not jira_fail else "; ".join(jira_fail[:8])))

    # Todoist queue.
    item_by_firm: dict[str, list[dict[str, Any]]] = {}
    ack_by_firm: dict[str, list[dict[str, Any]]] = {}
    todo_extras: list[str] = []
    sections = [
        s for s in todoist.get("sections", [])
        if s.get("project_id") == todo_project_id and not s.get("is_deleted") and not s.get("is_archived")
    ]
    section_by_name = {_norm(s.get("name")): s for s in sections}
    expected_sections = {"critical callbacks", "high callbacks", _norm(exp.get("todoist_ack_section", "Completed acknowledgements"))}
    section_names = set(section_by_name)
    section_ok = section_names == expected_sections
    for item in project_items:
        content = str(item.get("content") or "")
        if item.get("is_completed"):
            matched = [s["firm"] for s in in_scope if s["critical_comment_required"] and firm_in(content, s["firm"])]
            if len(matched) == 1:
                ack_by_firm.setdefault(matched[0], []).append(item)
            else:
                todo_extras.append(content[:90])
        else:
            matched = [firm for firm in todo_expected_firms if firm_in(content, firm)]
            if len(matched) == 1:
                item_by_firm.setdefault(matched[0], []).append(item)
            else:
                todo_extras.append(content[:90])
    todo_fail: list[str] = []
    for spec in todo_expected:
        item = (item_by_firm.get(spec["firm"]) or [None])[0]
        if not item:
            todo_fail.append(f"{spec['firm']}: no item")
            continue
        content = str(item.get("content") or "")
        expected_parts = [
            f"[{spec['severity']}]",
            spec["firm"],
            f"Jira {(issue_by_firm_for_trace.get(spec['firm']) or [{}])[0].get('key')}",
            f"recall numbers: {spec['recall_numbers']}",
            f"owner: {spec['owner']}",
        ]
        missing_parts = [part for part in expected_parts if part not in content]
        if missing_parts:
            todo_fail.append(f"{spec['firm']}: content missing {missing_parts}")
        want_priority = _user_to_api_priority(spec["todoist_priority"])
        if item.get("priority") != want_priority:
            todo_fail.append(f"{spec['firm']}: api priority {item.get('priority')} want {want_priority}")
        labels = set(item.get("labels") or [])
        want_labels = {exp["fixed_label"], spec["jira_label"]}
        if labels != want_labels:
            todo_fail.append(f"{spec['firm']}: labels {sorted(labels)} want {sorted(want_labels)}")
        want_section = section_by_name.get(_norm(f"{spec['severity']} callbacks"))
        if not want_section or item.get("section_id") != want_section.get("id"):
            todo_fail.append(f"{spec['firm']}: section_id {item.get('section_id')!r} want {want_section.get('id') if want_section else None!r}")
    critical_specs = [s for s in in_scope if s["critical_comment_required"]]
    ack_section = section_by_name.get(_norm(exp.get("todoist_ack_section", "Completed acknowledgements")))
    for spec in critical_specs:
        ack = (ack_by_firm.get(spec["firm"]) or [None])[0]
        issue_key = (issue_by_firm_for_trace.get(spec["firm"]) or [{}])[0].get("key")
        row_number = 2 + in_scope.index(spec)
        if not ack:
            todo_fail.append(f"{spec['firm']}: no completed ack")
            continue
        ack_content = str(ack.get("content") or "")
        expected_parts = [
            "ACK [Critical]",
            spec["firm"],
            f"Jira {issue_key}",
            f"GWS row {row_number}",
            "freeze confirmed",
        ]
        missing_parts = [part for part in expected_parts if part not in ack_content]
        if missing_parts:
            todo_fail.append(f"{spec['firm']}: ack content missing {missing_parts}")
        if not ack.get("is_completed"):
            todo_fail.append(f"{spec['firm']}: ack not completed")
        if not ack_section or ack.get("section_id") != ack_section.get("id"):
            todo_fail.append(f"{spec['firm']}: ack section {ack.get('section_id')!r} want {ack_section.get('id') if ack_section else None!r}")
        labels = set(ack.get("labels") or [])
        want_labels = {exp["fixed_label"], "severity-critical"}
        if labels != want_labels:
            todo_fail.append(f"{spec['firm']}: ack labels {sorted(labels)} want {sorted(want_labels)}")
    todo_missing = sorted(todo_expected_firms - set(item_by_firm))
    todo_dups = sorted(f for f, vals in item_by_firm.items() if len(vals) != 1)
    ack_missing = sorted(s["firm"] for s in critical_specs if s["firm"] not in ack_by_firm)
    ack_dups = sorted(f for f, vals in ack_by_firm.items() if len(vals) != 1)
    leaked = []
    for item in items:
        if item.get("project_id") == todo_project_id:
            continue
        content = str(item.get("content") or "")
        for firm in todo_expected_firms:
            if firm in content:
                leaked.append(f"{firm} outside callback project")
                break
    todo_ok = (
        section_ok and not todo_fail and not todo_missing and not todo_dups
        and not ack_missing and not ack_dups and not todo_extras and not leaked
        and len(project_items) == len(todo_expected) + len(critical_specs)
    )
    checks.append(chk("todoist_queue_correct", todo_ok,
                      "ok" if todo_ok else f"section_ok={section_ok} sections={sorted(section_names)} fail={todo_fail[:6]} missing={todo_missing} dups={todo_dups} ack_missing={ack_missing} ack_dups={ack_dups} extras={todo_extras[:3]} leaked={leaked[:3]} total={len(project_items)}"))

    # GWS trace map + briefing deck.
    control_fail: list[str] = []
    if _norm((spreadsheet or {}).get("properties", {}).get("title")) != _norm(exp.get("spreadsheet_title", "")):
        control_fail.append(f"spreadsheet title {((spreadsheet or {}).get('properties') or {}).get('title')!r}")
    if not trace_sheet:
        control_fail.append(f"trace sheet {exp.get('trace_sheet_title')!r} missing")
    else:
        cells = trace_sheet.get("cells", {})
        headers = [_cell(cells, col, 1) for col in "ABCDEFG"]
        if [_norm(h) for h in headers] != [_norm(h) for h in exp["trace_sheet_headers"]]:
            control_fail.append(f"trace headers {headers!r}")
        for idx, spec in enumerate(in_scope, start=2):
            issue = (issue_by_firm_for_trace.get(spec["firm"]) or [None])[0]
            item = (item_by_firm_for_trace.get(spec["firm"]) or [None])[0]
            ack = (ack_by_firm_for_trace.get(spec["firm"]) or [None])[0]
            expected = [
                spec["firm"],
                idx,
                epic_key,
                issue.get("key") if issue else "",
                exp.get("jira_link_type", "relates to"),
                item.get("id") if item else "N/A",
                ack.get("id") if ack else "N/A",
            ]
            got = [_cell(cells, col, idx) for col in "ABCDEFG"]
            for j, (g, w) in enumerate(zip(got, expected, strict=True)):
                ok = str(g) == str(w) if isinstance(w, int) else _norm(g) == _norm(w)
                if not ok:
                    control_fail.append(f"trace row {idx} col {'ABCDEFG'[j]} got {g!r}, want {w!r}")
                    break
        for row in range(2 + len(in_scope), 30):
            firm = _cell(cells, "A", row)
            if firm:
                control_fail.append(f"extra trace row {row}: {firm!r}")
                break
    brief_text = _presentation_text(presentation or {})
    counts = {
        "Critical": sum(1 for s in in_scope if s["severity"] == "Critical"),
        "High": sum(1 for s in in_scope if s["severity"] == "High"),
        "Elevated": sum(1 for s in in_scope if s["severity"] == "Elevated"),
    }
    if _norm((presentation or {}).get("title")) != _norm(exp.get("presentation_title", "")):
        control_fail.append(f"presentation title {(presentation or {}).get('title')!r}")
    if len((presentation or {}).get("slides", [])) < 5:
        control_fail.append("briefing slide missing")
    for required in [exp["jira_epic_summary"], epic_key]:
        if required and required not in brief_text:
            control_fail.append(f"briefing missing {required!r}")
    for label, count in [("Total", len(in_scope)), ("Critical", counts["Critical"]), ("High", counts["High"]), ("Elevated", counts["Elevated"])]:
        if not _has_labeled_count(brief_text, label, count):
            control_fail.append(f"briefing missing labeled count {label}={count}")
    checks.append(chk("control_center_trace_correct", not control_fail, "ok" if not control_fail else "; ".join(control_fail[:8])))

    return checks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    reward_json = Path(args.reward_json)
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    exp = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    packet_dir = task_dir / exp.get("source_packet_dir", "")
    manifest_path = task_dir / exp.get("source_manifest", "")
    cards_path = task_dir / exp.get("source_cards_file", "")
    try:
        manifest_rows = list(csv.DictReader(manifest_path.open(encoding="utf-8-sig"), delimiter="\t"))
        manifest = {row.get("key"): row.get("value") for row in manifest_rows}
        manifest_count = int(manifest.get("record_count") or 0)
        csv_paths = [Path(p) for p in glob.glob(str(task_dir / exp.get("source_csv_glob", "")))]
        csv_count = 0
        for csv_path in csv_paths:
            with csv_path.open(newline="", encoding="utf-8-sig") as f:
                csv_count += sum(1 for _ in csv.DictReader(f))
        cards_text = cards_path.read_text(encoding="utf-8-sig")
        card_count = cards_text.count("--- CASE CARD ")
        source_min = int(exp.get("source_min_records", 1))
        min_pages = int(exp.get("source_min_csv_pages", 1))
        json_shortcuts = list(packet_dir.glob("*.json")) if packet_dir.exists() else []
        source_ok = (
            packet_dir.exists()
            and manifest_count >= source_min
            and csv_count >= source_min
            and card_count >= source_min
            and len(csv_paths) >= min_pages
            and not json_shortcuts
        )
        source_reason = (
            f"manifest={manifest_count}, csv_rows={csv_count}, case_cards={card_count}, "
            f"csv_pages={len(csv_paths)}/{min_pages}, json_shortcuts={len(json_shortcuts)}"
        )
    except Exception as exc:  # noqa: BLE001
        source_ok = False
        source_reason = f"source parse failed: {exc}"

    gws, gws_err = _read_state(("MOCK_SITE_URL_GOOGLE_WORKSPACE_CLI", "MOCK_SITE_URL"), token)
    jira, jira_err = _read_state(("MOCK_SITE_URL_JIRA_CLI",), token, "/__bench/state")
    todoist, todoist_err = _read_state(("MOCK_SITE_URL_TODOIST_CLI",), token, "/__bench/state")

    checks = evaluate(exp, gws, jira, todoist, gws_err, jira_err, todoist_err, source_ok, source_reason)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "gws_final_state.json").write_text(json.dumps(gws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "jira_final_state.json").write_text(json.dumps(jira, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "todoist_final_state.json").write_text(json.dumps(todoist, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_dir.name,
        "score": score,
        "reward": score,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "validation_checks": checks,
        "passed": total > 0 and passed == total,
    }
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": score, "checks_passed": passed, "checks_total": total, "passed": payload["passed"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
