#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any


def _norm(v: Any) -> str:
    return " ".join(str(v or "").strip().casefold().split())


def _num(v: Any) -> float | None:
    try:
        return round(float(str(v).replace(",", "").replace("$", "")), 2)
    except Exception:
        return None


def _amount_in_text(text: Any, want: Any) -> bool:
    """True if the USD amount *want* appears in *text* in any semantically
    equivalent rendering: $/commas stripped, with or without trailing .0
    (e.g. 654820, 654820.0, $654,820.00 all match want=654820.0)."""
    w = _num(want)
    if w is None:
        return bool(want) and str(want) in str(text or "")
    cleaned = str(text or "").replace("$", "").replace(",", "")
    for m in re.finditer(r"\d+(?:\.\d+)?", cleaned):
        if _num(m.group(0)) == w:
            return True
    return False


def _has_labeled_count(text: str, label: str, count: int) -> bool:
    """True iff *label* is **adjacent-paired** with *count* in *text*.

    Adjacency rule: for at least one occurrence of *label*, the integer
    immediately on its left or right — with at most a tiny separator (whitespace,
    `:`, `=`, `-`, `,`, `(`, `)`) between them — equals *count*. Anything else
    breaks the adjacency: another label, a non-trivial word, or another integer.

    This rejects:
      - 'Critical: 3 High: 5 Elevated: 4' paired with ('Critical', 5).
      - 'included suppliers: 12 critical: 3 ...' paired with ('Critical', 12)
        (the '12' is bound to 'suppliers', not to 'critical').
      - 'In 2025, Critical issues totalled 3' paired with ('Critical', 2025)
        ('2025' is bound to 'In', and 'issues totalled' words sit between
        'Critical' and the next integer 3).

    And accepts both '3 Critical' and 'Critical: 3'. Also accepts a small
    set of count-noun bridges between label and number, e.g. 'Critical
    Count: 14', 'Supplier Count = 19', 'Critical Total: 14' (allow-listed
    nouns only; arbitrary words still break adjacency).

    Label match is word-boundaried (so 'High' does not match 'Highlights').
    """
    folded = " ".join(str(text or "").strip().casefold().split())
    lab = " ".join(str(label or "").strip().casefold().split())
    if not lab:
        return False
    # Word-bounded match, with optional trailing 's' for natural pluralisation
    # ('Supplier' also matches 'Suppliers'; 'High' still does NOT match
    # 'Highlights' because the 's?' sits at a word boundary).
    label_pat = rf"\b{re.escape(lab)}s?\b"
    if not re.search(label_pat, folded):
        return False
    # Tight separator only: whitespace, ':', '=', a single '-', or a single
    # paren on one side. Commas and '/' are list separators and must NOT
    # bridge a label to a number that belongs to a different list item.
    # Known residual ambiguity: 'A: 12 B: 3 ...' with label=B count=12 — the
    # '12' adjacent to 'B' will be (incorrectly) accepted. Acceptable here
    # because the slide-brief texts we grade always write the bucket label
    # immediately next to its own count.
    sep = r"[\s:=()]*-?[\s:=()]*"
    # Allow up to two count-noun bridges between label and number, so
    # 'Critical Count: 14' and 'Supplier Count Total = 19' still pair. Only
    # this fixed allow-list — any other intervening word breaks adjacency.
    bridge = r"(?:\s+(?:count|counts|total|totals|number|tally)){0,2}"
    try:
        c = int(count)
    except (TypeError, ValueError):
        return False
    cnum = re.escape(str(c))
    # number-then-label  OR  label-then-(optional count-noun bridge)-then-number.
    pair_left = re.compile(rf"\b{cnum}\b{sep}{label_pat}")
    pair_right = re.compile(rf"{label_pat}{bridge}{sep}\b{cnum}\b")
    return bool(pair_left.search(folded) or pair_right.search(folded))


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
        try:
            return _fetch(f"{base}{state_path}", token), ""
        except Exception as exc:
            return {}, f"{env}: {exc}"
    return {}, f"none of {', '.join(env_names)} set"


def chk(cid: str, ok: bool, reason: str = "") -> dict[str, Any]:
    return {"id": cid, "passed": bool(ok), "reason": str(reason)[:900], "check_type": "deterministic_exact"}


def _gws_db(state: dict[str, Any]) -> dict[str, Any]:
    return state.get("db", {}) if isinstance(state.get("db"), dict) else {}


def _find_sheet(spreadsheet: dict[str, Any], title: str) -> dict[str, Any] | None:
    for sheet in spreadsheet.get("sheets", []):
        if _norm((sheet.get("properties") or {}).get("title")) == _norm(title):
            return sheet
    return None


def _cell(cells: dict[str, Any], col: str, row: int) -> Any:
    raw = cells.get(f"{col}{row}")
    return raw.get("value") if isinstance(raw, dict) else None


def _row_numbers(cells: dict[str, Any], start_row: int = 2) -> list[int]:
    rows: set[int] = set()
    for key in cells:
        match = re.fullmatch(r"[A-Z]+([0-9]+)", str(key))
        if match:
            row = int(match.group(1))
            if row >= start_row:
                rows.add(row)
    return sorted(rows)


def _rows_by_key(cells: dict[str, Any], cols: str, key_col: str) -> tuple[dict[str, tuple[int, list[Any]]], list[str]]:
    rows: dict[str, tuple[int, list[Any]]] = {}
    failures: list[str] = []
    for row in _row_numbers(cells):
        key = str(_cell(cells, key_col, row) or "").strip()
        if not key:
            continue
        norm_key = _norm(key)
        if norm_key in rows:
            failures.append(f"duplicate row for {key!r}")
        rows[norm_key] = (row, [_cell(cells, col, row) for col in cols])
    return rows, failures


def _presentation_text(presentation: dict[str, Any]) -> str:
    parts = [str(presentation.get("title") or "")]
    for slide in presentation.get("slides", []):
        for el in slide.get("pageElements", []):
            text = ((el.get("shape") or {}).get("text") or {}).get("paragraphs") or []
            for para in text:
                for run in para.get("runs", []):
                    parts.append(str(run.get("content") or ""))
    return "\n".join(parts)


def _dws_entities(state: dict[str, Any], entity: str) -> list[dict[str, Any]]:
    raw = (state.get("entities") or {}).get(entity) or {}
    return list(raw.values()) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])


def _dws_all_docs(state: dict[str, Any]) -> list[dict[str, Any]]:
    return _dws_entities(state, "documents")


def _dws_docs(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in _dws_all_docs(state) if d.get("type") != "folder"]


def _dws_folders(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in _dws_all_docs(state) if d.get("type") == "folder"]


def _dws_comments(state: dict[str, Any]) -> list[dict[str, Any]]:
    return _dws_entities(state, "comments")


def _dws_permissions(state: dict[str, Any]) -> list[dict[str, Any]]:
    return _dws_entities(state, "permissions")


def _entity_id(obj: dict[str, Any]) -> str:
    return str(obj.get("id") or obj.get("nodeId") or obj.get("node_id") or "")


def _dws_text(doc: dict[str, Any], blocks: list[dict[str, Any]]) -> str:
    doc_id = _entity_id(doc)
    parts = [str(doc.get("content") or "")]
    for block in blocks:
        if str(block.get("nodeId") or block.get("node_id") or block.get("documentId")) == doc_id:
            parts.append(str(block.get("text") or block.get("content") or ""))
    for block in doc.get("blocks") or []:
        parts.append(str(block.get("text") or block.get("content") or ""))
    return "\n".join(parts)


def _box_folder(folders: list[dict[str, Any]], name: str, parent_id: str | None = None) -> dict[str, Any] | None:
    for folder in folders:
        if _norm(folder.get("name")) != _norm(name):
            continue
        if parent_id is None or str(folder.get("parent_id") or "") == str(parent_id):
            return folder
    return None


def _source_ok(task_dir: Path, exp: dict[str, Any]) -> tuple[bool, str]:
    total = 0
    missing = []
    for name in exp["source_files"]:
        path = task_dir / "workspace" / "customs_data" / name
        if not path.exists():
            missing.append(name)
            continue
        with path.open(newline="", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
        if "supplier" not in (rows[0] if rows else {}):
            return False, f"{name}: supplier column missing"
        total += len(rows)
    return (not missing and total >= 3000), f"missing={missing}, rows={total}"


def _issue_comments(comments: list[dict[str, Any]], key: str) -> list[str]:
    return [
        str(c.get("body") or c.get("content") or c.get("text") or "")
        for c in comments
        if str(c.get("issue_key") or c.get("issueKey") or c.get("key")) == key
    ]


def evaluate(exp: dict[str, Any], task_dir: Path, gws: dict[str, Any], jira: dict[str, Any],
             box: dict[str, Any], dws: dict[str, Any], gws_err: str, jira_err: str,
             box_err: str, dws_err: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    source_ok, source_reason = _source_ok(task_dir, exp)
    in_scope = exp["in_scope"]
    expected_suppliers = {s["supplier"] for s in in_scope}

    gdb = _gws_db(gws)
    spreadsheet = (gdb.get("spreadsheets") or {}).get(exp["spreadsheet_id"]) if not gws_err else None
    presentation = (gdb.get("presentations") or {}).get(exp["presentation_id"]) if not gws_err else None
    main_sheet = _find_sheet(spreadsheet or {}, exp["sheet_title"]) if spreadsheet else None
    trace_sheet = _find_sheet(spreadsheet or {}, exp["trace_sheet_title"]) if spreadsheet else None
    summary_sheet = _find_sheet(spreadsheet or {}, exp["summary_sheet_title"]) if spreadsheet else None

    box_folders = box.get("folders", []) if not box_err else []
    box_files = box.get("files", []) if not box_err else []
    box_comments = box.get("comments", []) if not box_err else []
    box_tasks = box.get("tasks", []) if not box_err else []
    box_collabs = box.get("collaborations", []) if not box_err else []
    box_root = _box_folder(box_folders, exp["box_root_folder_name"])

    dws_docs = _dws_entities(dws, "documents") if not dws_err else []
    dws_folders_list = _dws_folders(dws) if not dws_err else []
    dws_folder = next((f for f in dws_folders_list if _norm(f.get("name") or f.get("title")) == _norm(exp["dws_folder_name"])), None)

    setup_ok = not (gws_err or jira_err or box_err or dws_err) and bool(spreadsheet) and bool(presentation) and bool(main_sheet) and bool(trace_sheet) and bool(summary_sheet) and bool(box_root) and bool(dws_folder)
    checks.append(chk("setup_gate", setup_ok, gws_err or jira_err or box_err or dws_err or ("ok" if setup_ok else "missing target containers")))
    checks.append(chk("source_data_present", source_ok, source_reason))
    if not setup_ok:
        for cid in ("gws_control_correct", "jira_graph_correct", "box_evidence_correct", "dws_dossiers_correct", "cross_system_trace_correct"):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    # Resolve dynamic objects.
    root_id = str((box_root or {}).get("id") or "")
    box_folder_by_supplier: dict[str, dict[str, Any]] = {}
    box_file_by_supplier: dict[str, dict[str, Any]] = {}
    for spec in in_scope:
        folder = _box_folder(box_folders, f"{spec['supplier']} - Evidence", parent_id=root_id)
        if folder:
            box_folder_by_supplier[spec["supplier"]] = folder
            folder_id = str(folder.get("id") or "")
            files = [f for f in box_files if str(f.get("parent_id") or "") == folder_id and _norm(f.get("name")) == _norm(spec["box_report_name"])]
            if files:
                box_file_by_supplier[spec["supplier"]] = files[0]

    dws_blocks = _dws_entities(dws, "blocks")
    dws_comments = _dws_entities(dws, "comments")
    dws_permissions = _dws_entities(dws, "permissions")
    dws_doc_by_supplier: dict[str, dict[str, Any]] = {}
    for doc in dws_docs:
        name = str(doc.get("name") or doc.get("title") or "")
        matched = [s for s in expected_suppliers if s in name]
        if len(matched) == 1:
            dws_doc_by_supplier[matched[0]] = doc

    issues = jira.get("issues", []) if not jira_err else []
    comments = jira.get("comments", []) if not jira_err else []
    tasks = [i for i in issues if i.get("project_key") == exp["jira_project"] and i.get("type_name") == "Task" and exp["fixed_label"] in (i.get("labels") or [])]
    epics = [i for i in issues if i.get("project_key") == exp["jira_project"] and i.get("type_name") == "Epic" and _norm(i.get("summary")) == _norm(exp["jira_epic_summary"])]
    issue_by_supplier: dict[str, dict[str, Any]] = {}
    extras = []
    for issue in tasks:
        summary = str(issue.get("summary") or "")
        matched = [s for s in expected_suppliers if s in summary]
        if len(matched) == 1 and matched[0] not in issue_by_supplier:
            issue_by_supplier[matched[0]] = issue
        else:
            extras.append(summary[:90])

    # GWS sheets + slides.
    gws_fail = []
    if _norm((spreadsheet or {}).get("properties", {}).get("title")) != _norm(exp["spreadsheet_title"]):
        gws_fail.append("spreadsheet title")
    cells = (main_sheet or {}).get("cells", {})
    headers = [_cell(cells, col, 1) for col in "ABCDEFGHIJKL"]
    if [_norm(h) for h in headers] != [_norm(h) for h in exp["sheet_headers"]]:
        gws_fail.append("main headers")
    main_rows, row_fail = _rows_by_key(cells, "ABCDEFGHIJKL", "A")
    gws_fail.extend(f"main {reason}" for reason in row_fail)
    expected_main_keys = {_norm(spec["supplier"]) for spec in in_scope}
    extra_main = sorted(k for k in main_rows if k not in expected_main_keys)
    if extra_main:
        gws_fail.append(f"main extra rows {extra_main[:3]}")
    for spec in in_scope:
        issue = issue_by_supplier.get(spec["supplier"]) or {}
        box_folder = box_folder_by_supplier.get(spec["supplier"]) or {}
        dws_doc = dws_doc_by_supplier.get(spec["supplier"]) or {}
        expected = [
            spec["supplier"], spec["category"], spec["severity"], spec["total_shipments"], spec["total_usd"],
            spec["market_count"], spec["hs_count"], spec["top_market"], spec["top_hs"],
            issue.get("key") or "", str(box_folder.get("id") or ""), _entity_id(dws_doc),
        ]
        row_hit = main_rows.get(_norm(spec["supplier"]))
        if not row_hit:
            gws_fail.append(f"main missing {spec['supplier']}")
            continue
        row, got = row_hit
        for col, g, w in zip("ABCDEFGHIJKL", got, expected, strict=True):
            ok = (_num(g) == round(float(w), 2)) if isinstance(w, (int, float)) else (_norm(g) == _norm(w))
            if not ok:
                gws_fail.append(f"main row {row} col {col}")
                break
    scells = (summary_sheet or {}).get("cells", {})
    sheaders = [_cell(scells, col, 1) for col in "ABCDE"]
    if [_norm(h) for h in sheaders] != [_norm(h) for h in exp["summary_headers"]]:
        gws_fail.append("summary headers")
    summary_rows, row_fail = _rows_by_key(scells, "ABCDE", "A")
    gws_fail.extend(f"summary {reason}" for reason in row_fail)
    expected_summary_keys = {_norm(spec["category"]) for spec in exp["category_summary"]}
    extra_summary = sorted(k for k in summary_rows if k not in expected_summary_keys)
    if extra_summary:
        gws_fail.append(f"summary extra rows {extra_summary[:3]}")
    for spec in exp["category_summary"]:
        expected = [spec["category"], spec["supplier_count"], spec["shipments"], spec["total_usd"], spec["distinct_hs_count"]]
        row_hit = summary_rows.get(_norm(spec["category"]))
        if not row_hit:
            gws_fail.append(f"summary missing {spec['category']}")
            continue
        row, got = row_hit
        for col, g, w in zip("ABCDE", got, expected, strict=True):
            ok = (_num(g) == round(float(w), 2)) if isinstance(w, (int, float)) else (_norm(g) == _norm(w))
            if not ok:
                gws_fail.append(f"summary row {row} col {col}")
                break
    pres_text = _presentation_text(presentation or {})
    if _norm((presentation or {}).get("title")) != _norm(exp["presentation_title"]):
        gws_fail.append("presentation title")
    # Bare string presence — covers brief title, total supplier count, epic name.
    for term in exp["presentation_terms"]:
        if term not in pres_text:
            gws_fail.append(f"presentation missing {term}")
    # Severity bucket counts — accept either order ("3 Critical" or "Critical: 3").
    for label, count in exp.get("presentation_labeled_counts", []) or []:
        if not _has_labeled_count(pres_text, str(label), int(count)):
            gws_fail.append(f"presentation missing count {count} for {label}")
    checks.append(chk("gws_control_correct", not gws_fail, "ok" if not gws_fail else "; ".join(gws_fail[:8])))

    # Jira.
    jira_fail = []
    if len(epics) != 1:
        jira_fail.append(f"epic count {len(epics)}")
    epic_key = str((epics[0] if len(epics) == 1 else {}).get("key") or "")
    links = jira.get("issue_links", [])
    if len(issue_by_supplier) != len(in_scope) or extras:
        jira_fail.append(f"issue set {len(issue_by_supplier)}/{len(in_scope)} extras={extras[:3]}")
    for spec in in_scope:
        issue = issue_by_supplier.get(spec["supplier"])
        if not issue:
            continue
        want_priority = {"Critical": "Highest", "High": "High", "Elevated": "Medium"}[spec["severity"]]
        want_label = f"severity-{spec['severity'].lower()}"
        if _norm(issue.get("priority_name")) != _norm(want_priority):
            jira_fail.append(f"{spec['supplier']}: priority")
        if want_label not in (issue.get("labels") or []):
            jira_fail.append(f"{spec['supplier']}: label")
        if _norm(issue.get("status_name")) != _norm("In Progress"):
            jira_fail.append(f"{spec['supplier']}: status")
        if epic_key and not any(str(issue.get("key")) in str(l) and epic_key in str(l) for l in links):
            jira_fail.append(f"{spec['supplier']}: epic link")
        box_folder_id = str((box_folder_by_supplier.get(spec["supplier"]) or {}).get("id") or "")
        box_file_id = str((box_file_by_supplier.get(spec["supplier"]) or {}).get("id") or "")
        dws_id = _entity_id(dws_doc_by_supplier.get(spec["supplier"]) or {})
        joined = "\n".join(_issue_comments(comments, str(issue.get("key") or "")))
        if not _amount_in_text(joined, spec["total_usd"]):
            jira_fail.append(f"{spec['supplier']}: comment missing total USD {spec['total_usd']}")
        for piece in (spec["supplier"], spec["top_hs"], box_folder_id, box_file_id, dws_id):
            if piece and piece not in joined:
                jira_fail.append(f"{spec['supplier']}: comment missing {piece}")
                break
    checks.append(chk("jira_graph_correct", not jira_fail, "ok" if not jira_fail else "; ".join(jira_fail[:8])))

    # Box.
    box_fail = []
    for spec in in_scope:
        folder = box_folder_by_supplier.get(spec["supplier"])
        file = box_file_by_supplier.get(spec["supplier"])
        if not folder:
            box_fail.append(f"{spec['supplier']}: folder")
            continue
        if not file:
            box_fail.append(f"{spec['supplier']}: file")
            continue
        fid = str(file.get("id") or "")
        folder_id = str(folder.get("id") or "")
        issue_key = str((issue_by_supplier.get(spec["supplier"]) or {}).get("key") or "")
        dws_id = _entity_id(dws_doc_by_supplier.get(spec["supplier"]) or {})
        if not any(str(c.get("item_id") or "") == fid and issue_key in str(c) and dws_id in str(c) for c in box_comments):
            box_fail.append(f"{spec['supplier']}: comment")
        if not any(str(c.get("item_id") or "") == folder_id and str(c.get("accessible_by") or "") == exp["box_reviewer_user_id"] for c in box_collabs):
            box_fail.append(f"{spec['supplier']}: collaboration")
        if not any(str(t.get("file_id") or "") == fid for t in box_tasks):
            box_fail.append(f"{spec['supplier']}: task")
    checks.append(chk("box_evidence_correct", not box_fail, "ok" if not box_fail else "; ".join(box_fail[:8])))

    # DWS.
    dws_fail = []
    dws_file_docs = _dws_docs(dws)
    # The dws mock stores uploads as name="zibo_us_exports" + extension="csv";
    # accept both the plain name and the name.extension form.
    uploaded = set()
    for f in dws_file_docs:
        nm = str(f.get("name") or f.get("title") or "")
        ext = str(f.get("extension") or "")
        uploaded.add(nm)
        if ext and ext not in ("file", "folder") and not nm.endswith("." + ext):
            uploaded.add(f"{nm}.{ext}")
    if "zibo_us_exports.csv" not in uploaded:
        dws_fail.append("source upload missing")
    # `dws doc export` records into the state top-level `exports` array (it does
    # not create a document). Policy: export at least one Critical dossier.
    critical_doc_ids = {
        _entity_id(dws_doc_by_supplier.get(spec["supplier"]) or {})
        for spec in in_scope if spec.get("severity") == "Critical"
    }
    critical_doc_ids.discard("")
    dws_exports = dws.get("exports") if isinstance(dws.get("exports"), list) else []
    if not any(str(e.get("node_id") or e.get("nodeId") or "") in critical_doc_ids for e in dws_exports):
        dws_fail.append("export missing (no export of a Critical dossier)")
    for spec in in_scope:
        doc = dws_doc_by_supplier.get(spec["supplier"])
        if not doc:
            dws_fail.append(f"{spec['supplier']}: doc")
            continue
        text = _dws_text(doc, dws_blocks)
        issue_key = str((issue_by_supplier.get(spec["supplier"]) or {}).get("key") or "")
        box_folder_id = str((box_folder_by_supplier.get(spec["supplier"]) or {}).get("id") or "")
        box_file_id = str((box_file_by_supplier.get(spec["supplier"]) or {}).get("id") or "")
        if not _amount_in_text(text, spec["total_usd"]):
            dws_fail.append(f"{spec['supplier']}: text missing total USD {spec['total_usd']}")
        for piece in (spec["supplier"], spec["category"], spec["severity"], spec["owner"], str(spec["total_shipments"]), str(spec["market_count"]), str(spec["hs_count"]), spec["top_market"], spec["top_hs"], issue_key, box_folder_id, box_file_id):
            if piece and piece not in text:
                dws_fail.append(f"{spec['supplier']}: text missing {piece}")
                break
        doc_id = _entity_id(doc)
        trace = f"Trace Summary: {spec['supplier']} / {issue_key} / {box_folder_id} / {spec['total_usd']}"
        if trace not in text:
            dws_fail.append(f"{spec['supplier']}: trace block")
        if not any(str(c.get("nodeId") or c.get("node_id") or c.get("documentId")) == doc_id and f"Compliance review needed: {spec['supplier']} -> {issue_key}" in str(c) for c in dws_comments):
            dws_fail.append(f"{spec['supplier']}: comment")
        if not any(str(p.get("nodeId") or p.get("node_id") or p.get("documentId")) == doc_id and _norm(p.get("userId") or "") == _norm(exp["dws_permission_user"]) for p in dws_permissions):
            dws_fail.append(f"{spec['supplier']}: permission")
    checks.append(chk("dws_dossiers_correct", not dws_fail, "ok" if not dws_fail else "; ".join(dws_fail[:8])))

    # Trace Matrix.
    trace_fail = []
    tcells = (trace_sheet or {}).get("cells", {})
    theaders = [_cell(tcells, col, 1) for col in "ABCDEFG"]
    if [_norm(h) for h in theaders] != [_norm(h) for h in exp["trace_headers"]]:
        trace_fail.append("headers")
    trace_rows, row_fail = _rows_by_key(tcells, "ABCDEFG", "A")
    trace_fail.extend(row_fail)
    expected_trace_keys = {_norm(spec["supplier"]) for spec in in_scope}
    extra_trace = sorted(k for k in trace_rows if k not in expected_trace_keys)
    if extra_trace:
        trace_fail.append(f"extra rows {extra_trace[:3]}")
    for spec in in_scope:
        issue = issue_by_supplier.get(spec["supplier"]) or {}
        folder = box_folder_by_supplier.get(spec["supplier"]) or {}
        file = box_file_by_supplier.get(spec["supplier"]) or {}
        doc = dws_doc_by_supplier.get(spec["supplier"]) or {}
        expected = [spec["supplier"], issue.get("key") or "", str(folder.get("id") or ""), str(file.get("id") or ""), _entity_id(doc), spec["severity"], spec["owner"]]
        row_hit = trace_rows.get(_norm(spec["supplier"]))
        if not row_hit:
            trace_fail.append(f"missing {spec['supplier']}")
            continue
        row, got = row_hit
        for col, g, w in zip("ABCDEFG", got, expected, strict=True):
            if _norm(g) != _norm(w):
                trace_fail.append(f"row {row} col {col}")
                break
    checks.append(chk("cross_system_trace_correct", not trace_fail, "ok" if not trace_fail else "; ".join(trace_fail[:8])))
    return checks


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()
    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    exp = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier")
    gws, gws_err = _read_state(("MOCK_SITE_URL_GOOGLE_WORKSPACE_CLI", "MOCK_SITE_URL"), token)
    jira, jira_err = _read_state(("MOCK_SITE_URL_JIRA_CLI",), token, "/__bench/state")
    box, box_err = _read_state(("MOCK_SITE_URL_BOX_CLI",), token, "/__bench/state")
    dws, dws_err = _read_state(("MOCK_SITE_URL_DWS_DOC_CLI",), token)
    checks = evaluate(exp, task_dir, gws, jira, box, dws, gws_err, jira_err, box_err, dws_err)
    checks_passed = sum(c["passed"] for c in checks)
    checks_total = len(checks)
    passed = checks_total > 0 and checks_passed == checks_total
    result = {
        "reward": 1.0 if passed else 0.0,
        "score": 1.0 if passed else 0.0,
        "passed": passed,
        "checks_passed": checks_passed,
        "checks_total": checks_total,
        "checks_breakdown": checks,
        "validation_checks": checks,
        "check_summary": {"passed": checks_passed, "total": checks_total},
    }
    Path(args.reward_json).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "gws_final_state.json").write_text(json.dumps(gws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "jira_final_state.json").write_text(json.dumps(jira, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "box_final_state.json").write_text(json.dumps(box, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "dws_final_state.json").write_text(json.dumps(dws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
