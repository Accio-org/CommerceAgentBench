#!/usr/bin/env python3
"""Verifier for cli-xfer-customs-procurement-control-tower.

Reads three final mock states:
  - gws      : MOCK_SITE_URL_GOOGLE_WORKSPACE_CLI/api/state
  - box_cli  : MOCK_SITE_URL_BOX_CLI/api/state
  - jira_cli : MOCK_SITE_URL_JIRA_CLI/api/state

Source CSV files are agent-visible inputs. The verifier checks that they are
still present/parseable, but scoring is based on the final state the agent
produced in the three CLI systems.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm(v: Any) -> str:
    return " ".join(str(v or "").strip().casefold().split())


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


# ---------------------------------------------------------------------------
# GWS state helpers
# ---------------------------------------------------------------------------

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
    """Check that *label* and *count* appear together in *text*.

    Uses word-boundary matching for count (prevents '2' matching '2026')
    and a proximity constraint (label and count within 80 chars).
    """
    folded = _norm(text)
    lab = _norm(label)
    if lab not in folded:
        return False
    count_pat = rf"\b{count}\b"
    for m_lab in re.finditer(re.escape(lab), folded):
        for m_cnt in re.finditer(count_pat, folded):
            if abs(m_lab.start() - m_cnt.start()) <= 80:
                return True
    return False


def _amount_match(got: Any, want: float) -> bool:
    """Lenient numeric comparison for USD amounts."""
    try:
        g = float(str(got).replace(",", "").replace("$", "").strip())
        return abs(g - want) < 1.0
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# Box state helpers
# ---------------------------------------------------------------------------

def _box_folders(state: dict[str, Any]) -> list[dict[str, Any]]:
    return state.get("folders", [])


def _box_files(state: dict[str, Any]) -> list[dict[str, Any]]:
    return state.get("files", [])


def _box_comments(state: dict[str, Any]) -> list[dict[str, Any]]:
    return state.get("comments", [])


def _box_tasks(state: dict[str, Any]) -> list[dict[str, Any]]:
    return state.get("tasks", [])


def _box_collaborations(state: dict[str, Any]) -> list[dict[str, Any]]:
    return state.get("collaborations", [])


def _find_folder_by_name(
    folders: list[dict[str, Any]], name: str, parent_id: str | None = None,
) -> dict[str, Any] | None:
    for f in folders:
        if _norm(f.get("name")) == _norm(name):
            if parent_id is None or str(f.get("parent_id", "")) == str(parent_id):
                return f
    return None


def _find_subfolders(folders: list[dict[str, Any]], parent_id: str) -> list[dict[str, Any]]:
    return [f for f in folders if str(f.get("parent_id", "")) == str(parent_id)]


def _find_files_in_folder(files: list[dict[str, Any]], folder_id: str) -> list[dict[str, Any]]:
    return [f for f in files if str(f.get("parent_id", "")) == str(folder_id)]


# ---------------------------------------------------------------------------
# Main evaluation
# ---------------------------------------------------------------------------

def evaluate(
    exp: dict[str, Any],
    gws: dict[str, Any],
    box: dict[str, Any],
    jira: dict[str, Any],
    gws_err: str,
    box_err: str,
    jira_err: str,
    source_ok: bool,
    source_reason: str,
) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    in_scope = exp["in_scope"]
    expected_suppliers = {s["supplier"] for s in in_scope}

    # -------------------------------------------------------------------
    # setup_gate
    # -------------------------------------------------------------------
    setup_reasons: list[str] = []
    if gws_err:
        setup_reasons.append(f"gws: {gws_err}")
    if box_err:
        setup_reasons.append(f"box: {box_err}")
    if jira_err:
        setup_reasons.append(f"jira: {jira_err}")

    gdb = _gws_db(gws)
    spreadsheet = (gdb.get("spreadsheets") or {}).get(exp["spreadsheet_id"]) if not gws_err else None
    presentation = (gdb.get("presentations") or {}).get(exp["presentation_id"]) if not gws_err else None

    if not gws_err and not spreadsheet:
        setup_reasons.append(f"spreadsheet {exp['spreadsheet_id']} missing")
    if not gws_err and not presentation:
        setup_reasons.append(f"presentation {exp['presentation_id']} missing")

    jira_project_ok = any(
        p.get("key") == exp["jira_project"] for p in jira.get("projects", [])
    ) if not jira_err else False
    if not jira_err and not jira_project_ok:
        setup_reasons.append(f"jira project {exp['jira_project']} missing")

    box_folders_list = _box_folders(box) if not box_err else []
    box_root = _find_folder_by_name(box_folders_list, exp["box_root_folder_name"])
    if not box_err and not box_root:
        setup_reasons.append(f"box root folder '{exp['box_root_folder_name']}' missing")
    # Duplicate-root honesty: count ALL folders carrying the expected root name.
    # With >1 the structure is ambiguous; first-match would silently pick one.
    box_root_dupes = [
        f for f in box_folders_list
        if _norm(f.get("name")) == _norm(exp["box_root_folder_name"])
    ]

    setup_ok = not setup_reasons
    checks.append(chk("setup_gate", setup_ok, "ok" if setup_ok else "; ".join(setup_reasons)))
    checks.append(chk("source_data_present", source_ok, source_reason))

    if not setup_ok:
        for cid in (
            "sheet_rows_correct", "slides_briefing_correct",
            "box_folder_structure", "box_operations_correct",
            "jira_epic_correct", "jira_fields_correct",
        ):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    # -------------------------------------------------------------------
    # Resolve dynamic IDs for cross-system checks
    # -------------------------------------------------------------------

    # Box: find supplier subfolders
    assert box_root is not None
    box_root_id = str(box_root.get("id", ""))
    supplier_folders: dict[str, dict[str, Any]] = {}
    for spec in in_scope:
        folder = _find_folder_by_name(box_folders_list, spec["supplier"], parent_id=box_root_id)
        if folder:
            supplier_folders[spec["supplier"]] = folder

    # Jira: find supplier issues
    issues = jira.get("issues", [])
    comments = jira.get("comments", [])
    recall_issues = [
        i for i in issues
        if i.get("project_key") == exp["jira_project"]
        and i.get("type_name") == "Task"
        and exp["fixed_label"] in (i.get("labels") or [])
    ]
    issue_by_supplier: dict[str, list[dict[str, Any]]] = {}
    for issue in recall_issues:
        summary = str(issue.get("summary") or "")
        matched = [s for s in expected_suppliers if s in summary]
        if len(matched) == 1:
            issue_by_supplier.setdefault(matched[0], []).append(issue)

    # -------------------------------------------------------------------
    # sheet_rows_correct — Sourcing Dashboard
    # -------------------------------------------------------------------
    sheet = _find_sheet(spreadsheet or {}, exp["sheet_title"]) if spreadsheet else None
    comp_sheet = _find_sheet(spreadsheet or {}, exp["comparison_sheet_title"]) if spreadsheet else None
    if not sheet:
        checks.append(chk("sheet_rows_correct", False, f"sheet {exp['sheet_title']!r} missing"))
    else:
        cells = sheet.get("cells", {})
        headers = [_cell(cells, col, 1) for col in "ABCDEFGHI"]
        header_ok = [_norm(h) for h in headers] == [_norm(h) for h in exp["sheet_headers"]]
        row_fail: list[str] = []
        for idx, spec in enumerate(in_scope, start=2):
            issue = (issue_by_supplier.get(spec["supplier"]) or [None])[0]
            folder = supplier_folders.get(spec["supplier"])
            expected_row = [
                spec["supplier"],
                spec["category"],
                spec["tier"],
                spec["amount_usd"],
                spec["shipment_count"],
                spec["hs_codes"],
                spec["owner"],
                issue.get("key") if issue else "",
                str(folder.get("id", "")) if folder else "",
            ]
            got = [_cell(cells, col, idx) for col in "ABCDEFGHI"]
            for j, (g, w) in enumerate(zip(got, expected_row, strict=True)):
                if isinstance(w, int):
                    ok = str(g) == str(w) or (isinstance(g, (int, float)) and int(g) == w)
                elif isinstance(w, float):
                    ok = _amount_match(g, w)
                else:
                    ok = _norm(str(g)) == _norm(str(w))
                if not ok:
                    row_fail.append(f"row {idx} col {'ABCDEFGHI'[j]} got {g!r}, want {w!r}")
                    break
        # Check no extra rows
        extras: list[str] = []
        for row in range(2 + len(in_scope), 30):
            supplier_val = _cell(cells, "A", row)
            if supplier_val:
                extras.append(str(supplier_val))
        # Check Category Comparison sheet
        comp_fail: list[str] = []
        if not comp_sheet:
            comp_fail.append(f"sheet {exp['comparison_sheet_title']!r} missing")
        else:
            comp_cells = comp_sheet.get("cells", {})
            comp_headers = [_cell(comp_cells, col, 1) for col in "ABCDE"]
            if [_norm(h) for h in comp_headers] != [_norm(h) for h in exp["comparison_headers"]]:
                comp_fail.append(f"comparison headers {comp_headers!r}")
            for cidx, cat_spec in enumerate(exp["category_comparison"], start=2):
                got_row = [_cell(comp_cells, col, cidx) for col in "ABCDE"]
                expected_comp = [
                    cat_spec["category"],
                    cat_spec["qualified_count"],
                    cat_spec["total_amount"],
                    cat_spec["total_shipments"],
                    cat_spec["top_supplier"],
                ]
                for cj, (cg, cw) in enumerate(zip(got_row, expected_comp, strict=True)):
                    if isinstance(cw, int):
                        c_ok = str(cg) == str(cw) or (isinstance(cg, (int, float)) and int(cg) == cw)
                    elif isinstance(cw, float):
                        c_ok = _amount_match(cg, cw)
                    else:
                        c_ok = _norm(str(cg)) == _norm(str(cw))
                    if not c_ok:
                        comp_fail.append(f"comp row {cidx} col {'ABCDE'[cj]} got {cg!r}, want {cw!r}")
                        break

        sheet_ok = header_ok and not row_fail and not extras and not comp_fail
        reason = "ok" if sheet_ok else (
            f"header_ok={header_ok} row_fail={row_fail[:4]} extras={extras[:3]} comp_fail={comp_fail[:3]}"
        )
        checks.append(chk("sheet_rows_correct", sheet_ok, reason))

    # -------------------------------------------------------------------
    # slides_briefing_correct
    # -------------------------------------------------------------------
    brief_text = _presentation_text(presentation or {})
    slide_fail: list[str] = []
    if _norm((presentation or {}).get("title")) != _norm(exp["presentation_title"]):
        slide_fail.append(f"presentation title {(presentation or {}).get('title')!r}")
    if len((presentation or {}).get("slides", [])) < 4:
        slide_fail.append("too few slides")
    for required in [exp["jira_epic_summary"]]:
        if required and required not in brief_text:
            slide_fail.append(f"briefing missing {required!r}")
    tier_counts = {
        "Strategic": sum(1 for s in in_scope if s["tier"] == "Strategic"),
        "Preferred": sum(1 for s in in_scope if s["tier"] == "Preferred"),
        "Approved": sum(1 for s in in_scope if s["tier"] == "Approved"),
    }
    for label, count in [("Total", len(in_scope)), ("Strategic", tier_counts["Strategic"]),
                          ("Preferred", tier_counts["Preferred"]), ("Approved", tier_counts["Approved"])]:
        if not _has_labeled_count(brief_text, label, count):
            slide_fail.append(f"briefing missing labeled count {label}={count}")
    checks.append(chk("slides_briefing_correct", not slide_fail,
                       "ok" if not slide_fail else "; ".join(slide_fail[:6])))

    # -------------------------------------------------------------------
    # box_folder_structure
    # -------------------------------------------------------------------
    subfolders = _find_subfolders(box_folders_list, box_root_id)
    subfolder_names = {_norm(f.get("name")) for f in subfolders}
    expected_folder_names = {_norm(s["supplier"]) for s in in_scope}
    missing_folders = sorted(expected_folder_names - subfolder_names)
    extra_folders = sorted(subfolder_names - expected_folder_names)
    if len(box_root_dupes) > 1:
        checks.append(chk(
            "box_folder_structure", False,
            f"duplicate root folders named '{exp['box_root_folder_name']}': "
            f"{len(box_root_dupes)} found (ids {[str(f.get('id')) for f in box_root_dupes][:4]})"))
    else:
        folder_struct_ok = not missing_folders and not extra_folders and len(subfolders) == len(in_scope)
        checks.append(chk("box_folder_structure", folder_struct_ok,
                           "ok" if folder_struct_ok else
                           f"missing={missing_folders[:4]} extra={extra_folders[:4]} total={len(subfolders)}"))

    # -------------------------------------------------------------------
    # box_operations_correct
    # -------------------------------------------------------------------
    box_files_list = _box_files(box)
    box_comments_list = _box_comments(box)
    box_tasks_list = _box_tasks(box)
    box_collabs_list = _box_collaborations(box)

    # Count files in supplier folders
    files_per_supplier: dict[str, int] = {}
    for spec in in_scope:
        folder = supplier_folders.get(spec["supplier"])
        if folder:
            folder_id = str(folder.get("id", ""))
            file_count = len(_find_files_in_folder(box_files_list, folder_id))
            files_per_supplier[spec["supplier"]] = file_count

    suppliers_with_files = sum(1 for v in files_per_supplier.values() if v > 0)
    ops_fail: list[str] = []
    if suppliers_with_files < len(in_scope) * 2 // 3:
        ops_fail.append(f"only {suppliers_with_files}/{len(in_scope)} suppliers have files")
    if len(box_collabs_list) < 2:
        ops_fail.append(f"only {len(box_collabs_list)} collaborations (need >=2)")
    if len(box_tasks_list) < 2:
        ops_fail.append(f"only {len(box_tasks_list)} review tasks (need >=2)")
    if len(box_comments_list) < 2:
        ops_fail.append(f"only {len(box_comments_list)} comments (need >=2)")
    ops_ok = not ops_fail
    checks.append(chk("box_operations_correct", ops_ok,
                       "ok" if ops_ok else "; ".join(ops_fail[:4])))

    # -------------------------------------------------------------------
    # jira_epic_correct
    # -------------------------------------------------------------------
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
                       "ok" if epic_ok else
                       f"expected one canonical epic, got {len(epics)}; extra_epics={extra_epics[:3]}"))

    # -------------------------------------------------------------------
    # jira_fields_correct
    # -------------------------------------------------------------------
    extras_issues: list[str] = []
    for issue in recall_issues:
        summary = str(issue.get("summary") or "")
        matched = [s for s in expected_suppliers if s in summary]
        if len(matched) != 1:
            extras_issues.append(summary[:90])

    missing_suppliers = sorted(expected_suppliers - set(issue_by_supplier))
    dup_suppliers = sorted(s for s, vals in issue_by_supplier.items() if len(vals) != 1)
    # Allow one clone: total can be len(in_scope) or len(in_scope)+1
    count_ok = len(recall_issues) in (len(in_scope), len(in_scope) + 1)

    jira_fail: list[str] = []
    if missing_suppliers:
        jira_fail.append(f"missing suppliers: {missing_suppliers}")
    if dup_suppliers:
        jira_fail.append(f"duplicate suppliers: {dup_suppliers}")
    if not count_ok:
        jira_fail.append(f"issue count {len(recall_issues)}, expected {len(in_scope)}")

    for spec in in_scope:
        issue = (issue_by_supplier.get(spec["supplier"]) or [None])[0]
        if not issue:
            jira_fail.append(f"{spec['supplier'][:40]}: no issue")
            continue
        summary = str(issue.get("summary") or "")

        # Check summary contains key parts
        expected_parts = [
            f"[{spec['tier']}]",
            spec["supplier"],
            spec["category"],
        ]
        missing_parts = [part for part in expected_parts if part not in summary]
        if missing_parts:
            jira_fail.append(f"{spec['supplier'][:30]}: summary missing {missing_parts}")

        # Priority
        if _norm(issue.get("priority_name")) != _norm(spec["jira_priority"]):
            jira_fail.append(f"{spec['supplier'][:30]}: priority {issue.get('priority_name')!r}")

        # Labels
        labels = set(issue.get("labels") or [])
        want_labels = {exp["fixed_label"], spec["jira_label"]}
        if labels != want_labels:
            jira_fail.append(f"{spec['supplier'][:30]}: labels {sorted(labels)} want {sorted(want_labels)}")

        # Status
        if _norm(issue.get("status_name")) != _norm(exp["jira_target_state"]):
            jira_fail.append(f"{spec['supplier'][:30]}: status {issue.get('status_name')!r}")

        # Assignee
        if _norm(issue.get("assignee")) != _norm(spec["jira_username"]):
            jira_fail.append(f"{spec['supplier'][:30]}: assignee {issue.get('assignee')!r} want {spec['jira_username']!r}")

        # Epic link
        linked = any(
            l.get("inward_key") == issue.get("key")
            and l.get("outward_key") == epic_key
            and _norm(l.get("link_type")) == _norm(exp.get("jira_link_type", "relates to"))
            for l in jira.get("issue_links", [])
        )
        if not linked:
            jira_fail.append(f"{spec['supplier'][:30]}: missing link to epic {epic_key}")

        # Cross-system trace comment
        row_number = 2 + in_scope.index(spec)
        folder = supplier_folders.get(spec["supplier"])
        box_folder_id = str(folder.get("id", "")) if folder else ""
        trace_body = f"Trace: GWS row {row_number}; Box folder {box_folder_id}."
        trace_comments = [
            c for c in comments
            if c.get("issue_key") == issue.get("key")
            and _norm(c.get("body")) == _norm(trace_body)
        ]
        if not trace_comments:
            jira_fail.append(f"{spec['supplier'][:30]}: missing trace comment {trace_body!r}")

    checks.append(chk("jira_fields_correct", not jira_fail,
                       "ok" if not jira_fail else "; ".join(jira_fail[:8])))

    return checks


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

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

    # Source CSV integrity check
    source_csv_files = exp.get("source_csv_files", {})
    source_fail: list[str] = []
    for csv_name, expected_rows in source_csv_files.items():
        csv_path = task_dir / "workspace" / "customs_data" / csv_name
        if not csv_path.exists():
            source_fail.append(f"{csv_name} missing")
            continue
        try:
            with csv_path.open(newline="", encoding="utf-8-sig") as f:
                actual_rows = sum(1 for _ in csv.DictReader(f))
            if actual_rows < expected_rows:
                source_fail.append(f"{csv_name}: {actual_rows} rows < {expected_rows}")
        except Exception as exc:  # noqa: BLE001
            source_fail.append(f"{csv_name}: parse error {exc}")
    source_ok = not source_fail
    source_reason = "ok" if source_ok else "; ".join(source_fail)

    gws, gws_err = _read_state(("MOCK_SITE_URL_GOOGLE_WORKSPACE_CLI", "MOCK_SITE_URL"), token)
    box, box_err = _read_state(("MOCK_SITE_URL_BOX_CLI",), token, "/__bench/state")
    jira, jira_err = _read_state(("MOCK_SITE_URL_JIRA_CLI",), token, "/__bench/state")

    checks = evaluate(exp, gws, box, jira, gws_err, box_err, jira_err, source_ok, source_reason)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "gws_final_state.json").write_text(
        json.dumps(gws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "box_final_state.json").write_text(
        json.dumps(box, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "jira_final_state.json").write_text(
        json.dumps(jira, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

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
