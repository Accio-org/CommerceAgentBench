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
        return round(float(str(v).replace(",", "")), 2)
    except Exception:
        return None


def _amount_in_text(text: Any, want: Any) -> bool:
    """True if the USD amount *want* appears in *text* in any semantically
    equivalent rendering: $/commas stripped, with or without trailing .0
    (e.g. 15345262.68, $15,345,262.68 both match want=15345262.68)."""
    w = _num(str(want).replace("$", ""))
    if w is None:
        return bool(want) and str(want) in str(text or "")
    cleaned = str(text or "").replace("$", "").replace(",", "")
    for m in re.finditer(r"\d+(?:\.\d+)?", cleaned):
        if _num(m.group(0)) == w:
            return True
    return False


def _has_labeled_count(text: str, label: str, count: int) -> bool:
    """True iff *label* is **adjacent-paired** with *count* in *text*.

    Adjacency: for at least one occurrence of *label*, the integer
    immediately on its left or right — with at most a tiny separator
    (whitespace, ':', '=', '-', or '(' / ')') between them — equals *count*.
    Anything else (another label, a word, another integer, a list separator
    like ',' or '/') breaks the adjacency.

    This rejects 'Critical: 3 High: 5 Elevated: 4' paired with ('Critical', 5)
    that the previous 80-char-window impl mistakenly accepted; it accepts both
    'Critical: 14' and '14 Critical', and a small allow-list of count-noun
    bridges (e.g. 'Critical Count: 14', 'Supplier Count = 19').

    Label match is word-boundaried (so 'High' does not match 'Highlights').

    Known residual ambiguity: 'A: 12 B: 3 ...' with label=B count=12 will
    accept (B,12). Acceptable because the dossier texts always render the
    bucket label adjacent to its own count.
    """
    folded = _norm(text)
    lab = _norm(label)
    if not lab:
        return False
    # Word-bounded match, with optional trailing 's' for natural pluralisation
    # ('Supplier' also matches 'Suppliers', 'High' still does NOT match
    # 'Highlights' because the 's?' must sit at a word boundary).
    label_pat = rf"\b{re.escape(lab)}s?\b"
    if not re.search(label_pat, folded):
        return False
    try:
        c = int(count)
    except (TypeError, ValueError):
        return False
    cnum = re.escape(str(c))
    sep = r"[\s:=()]*-?[\s:=()]*"
    bridge = r"(?:\s+(?:count|counts|total|totals|number|tally)){0,2}"
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


def _dws_exports(state: dict[str, Any]) -> list[dict[str, Any]]:
    # Prefer the dedicated exports list written by handleExport (new mock behavior).
    if isinstance(state.get("exports"), list):
        return state["exports"]
    # Fallback: legacy heuristic — documents whose type or name contain "export".
    return [d for d in _dws_all_docs(state)
            if "export" in _norm(d.get("type") or "")
            or "export" in _norm(d.get("name") or d.get("title") or "")]


def _entity_id(obj: dict[str, Any]) -> str:
    return str(obj.get("id") or obj.get("nodeId") or obj.get("node_id") or "")


def _dws_text(doc: dict[str, Any], blocks: list[dict[str, Any]]) -> str:
    doc_id = _entity_id(doc)
    parts = [str(doc.get("content") or "")]
    for b in blocks:
        if str(b.get("nodeId") or b.get("node_id") or b.get("documentId")) == doc_id:
            parts.append(str(b.get("text") or b.get("content") or ""))
    for b in doc.get("blocks") or []:
        parts.append(str(b.get("text") or b.get("content") or ""))
    return "\n".join(parts)


def _issue_key(issue: dict[str, Any]) -> str:
    return str(issue.get("key") or "")


def _comments_for(comments: list[dict[str, Any]], issue_key: str) -> list[str]:
    vals = []
    for c in comments:
        if str(c.get("issue_key") or c.get("issueKey") or c.get("key")) == issue_key:
            vals.append(str(c.get("body") or c.get("content") or c.get("text") or ""))
    return vals


def _source_ok(task_dir: Path, exp: dict[str, Any]) -> tuple[bool, str]:
    base = task_dir / "workspace" / "customs_data"
    total = 0
    missing = []
    for name in exp["source_files"]:
        path = base / name
        if not path.exists():
            missing.append(name)
            continue
        with path.open(newline="", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
        if "supplier" not in (rows[0] if rows else {}):
            return False, f"{name}: supplier column missing"
        total += len(rows)
    return (not missing and total >= 5000), f"missing={missing}, rows={total}"


def evaluate(exp: dict[str, Any], task_dir: Path, gws: dict[str, Any], jira: dict[str, Any], dws: dict[str, Any],
             gws_err: str, jira_err: str, dws_err: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    source_ok, source_reason = _source_ok(task_dir, exp)
    gdb = _gws_db(gws)
    spreadsheet = (gdb.get("spreadsheets") or {}).get(exp["spreadsheet_id"]) if not gws_err else None
    presentation = (gdb.get("presentations") or {}).get(exp["presentation_id"]) if not gws_err else None
    sheet = _find_sheet(spreadsheet or {}, exp["sheet_title"]) if spreadsheet else None
    trace = _find_sheet(spreadsheet or {}, exp["trace_sheet_title"]) if spreadsheet else None
    dws_docs = _dws_entities(dws, "documents")
    dws_folders = _dws_folders(dws)

    setup_ok = not (gws_err or jira_err or dws_err) and bool(spreadsheet) and bool(presentation) and bool(sheet) and bool(trace)
    checks.append(chk("setup_gate", setup_ok, gws_err or jira_err or dws_err or ("ok" if setup_ok else "missing spreadsheet or sheets")))
    checks.append(chk("source_data_present", source_ok, source_reason))
    if not setup_ok:
        for cid in ("sheet_rows_correct", "gws_presentation_correct", "jira_graph_correct", "dws_dossiers_correct", "trace_map_correct"):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    in_scope = exp["in_scope"]
    expected_suppliers = {s["supplier"] for s in in_scope}
    issues = jira.get("issues", [])
    comments = jira.get("comments", [])
    tasks = [i for i in issues if i.get("project_key") == exp["jira_project"] and i.get("type_name") == "Task" and exp["fixed_label"] in (i.get("labels") or [])]
    epics = [i for i in issues if i.get("project_key") == exp["jira_project"] and i.get("type_name") == "Epic" and _norm(i.get("summary")) == _norm(exp["jira_epic_summary"])]
    by_supplier: dict[str, list[dict[str, Any]]] = {s: [] for s in expected_suppliers}
    extras = []
    for issue in tasks:
        summary = str(issue.get("summary") or "")
        matched = [s for s in expected_suppliers if s in summary]
        if len(matched) == 1:
            by_supplier[matched[0]].append(issue)
        else:
            extras.append(summary[:90])

    docs_by_supplier: dict[str, list[dict[str, Any]]] = {s: [] for s in expected_suppliers}
    for doc in dws_docs:
        name = str(doc.get("name") or doc.get("title") or "")
        for s in expected_suppliers:
            if s in name:
                docs_by_supplier[s].append(doc)

    # Sheet rows.
    cells = sheet.get("cells", {})
    got_headers = [_cell(cells, col, 1) for col in "ABCDEFGHIJ"]
    header_ok = [_norm(h) for h in got_headers] == [_norm(h) for h in exp["sheet_headers"]]
    row_fail = []
    for idx, spec in enumerate(in_scope, start=2):
        issue = (by_supplier.get(spec["supplier"]) or [None])[0]
        doc = (docs_by_supplier.get(spec["supplier"]) or [None])[0]
        expected = [
            spec["supplier"], spec["severity"], spec["total_shipments"], spec["total_usd"],
            spec["destination_count"], spec["hs_count"], spec["top_market"], spec["owner"],
            _issue_key(issue or {}), _entity_id(doc or {}),
        ]
        got = [_cell(cells, col, idx) for col in "ABCDEFGHIJ"]
        for col, g, w in zip("ABCDEFGHIJ", got, expected, strict=True):
            if isinstance(w, (int, float)):
                ok = _num(g) == round(float(w), 2)
            else:
                ok = _norm(g) == _norm(w)
            if not ok:
                row_fail.append(f"row {idx} col {col} got {g!r} want {w!r}")
                break
    extra_rows = [str(_cell(cells, "A", r)) for r in range(2 + len(in_scope), 80) if _cell(cells, "A", r)]
    checks.append(chk("sheet_rows_correct", header_ok and not row_fail and not extra_rows,
                      "ok" if header_ok and not row_fail and not extra_rows else f"header_ok={header_ok}; rows={row_fail[:4]}; extras={extra_rows[:4]}"))

    pres_text = _presentation_text(presentation or {})
    pres_fail = []
    if _norm((presentation or {}).get("title")) != _norm(exp["presentation_title"]):
        pres_fail.append(f"title {(presentation or {}).get('title')!r}")
    for term in exp["presentation_terms"]:
        if term not in pres_text:
            pres_fail.append(f"missing {term!r}")
    for label, count in exp.get("presentation_labeled_counts", []):
        if not _has_labeled_count(pres_text, str(label), int(count)):
            pres_fail.append(f"missing labeled count {label}={count}")
    checks.append(chk("gws_presentation_correct", not pres_fail, "ok" if not pres_fail else "; ".join(pres_fail[:6])))

    # Jira graph.
    jira_fail = []
    if len(epics) != 1:
        jira_fail.append(f"epic count {len(epics)}")
    epic_key = _issue_key(epics[0]) if len(epics) == 1 else ""
    links = jira.get("issue_links", [])
    for spec in in_scope:
        vals = by_supplier.get(spec["supplier"]) or []
        if len(vals) != 1:
            jira_fail.append(f"{spec['supplier']}: issue count {len(vals)}")
            continue
        issue = vals[0]
        labels = issue.get("labels") or []
        want_sev_label = f"severity-{spec['severity'].lower()}"
        if want_sev_label not in labels:
            jira_fail.append(f"{spec['supplier']}: missing {want_sev_label}")
        want_pri = "Highest" if spec["severity"] == "Critical" else "High"
        if _norm(issue.get("priority_name")) != _norm(want_pri):
            jira_fail.append(f"{spec['supplier']}: priority {issue.get('priority_name')!r}")
        if _norm(issue.get("status_name")) != _norm("In Progress"):
            jira_fail.append(f"{spec['supplier']}: status {issue.get('status_name')!r}")
        if epic_key and not any(_issue_key(issue) in str(l) and epic_key in str(l) for l in links):
            jira_fail.append(f"{spec['supplier']}: epic link missing")
        joined_comments = "\n".join(_comments_for(comments, _issue_key(issue)))
        if not _amount_in_text(joined_comments, spec["total_usd"]):
            jira_fail.append(f"{spec['supplier']}: comment missing total USD {spec['total_usd']}")
        for piece in (spec["supplier"], str(spec["total_shipments"]), str(spec["destination_count"]), str(spec["hs_count"]), spec["top_market"]):
            if piece not in joined_comments:
                jira_fail.append(f"{spec['supplier']}: comment missing {piece}")
                break
        doc_id = _entity_id((docs_by_supplier.get(spec["supplier"]) or [{}])[0])
        if doc_id and doc_id not in joined_comments:
            jira_fail.append(f"{spec['supplier']}: comment missing DWS id")
    checks.append(chk("jira_graph_correct", not jira_fail and not extras and all(len(v) == 1 for v in by_supplier.values()),
                      "ok" if not jira_fail and not extras else f"fail={jira_fail[:6]}; extras={extras[:3]}"))

    # DWS dossiers.
    folder = next((f for f in dws_folders if _norm(f.get("name") or f.get("title")) == _norm(exp["dws_folder_name"])), None)
    blocks = _dws_entities(dws, "blocks")
    dws_comments = _dws_entities(dws, "comments")
    perms = _dws_entities(dws, "permissions")
    files = _dws_docs(dws)
    exports = _dws_exports(dws)
    dws_fail = []
    if not folder:
        dws_fail.append("folder missing")
    uploaded = set()
    for f in files:
        nm = str(f.get("name") or "")
        ext = str(f.get("extension") or "")
        uploaded.add(nm)
        if ext and ext not in ("file", "folder") and not nm.endswith("." + ext):
            uploaded.add(f"{nm}.{ext}")
    missing_uploads = [name for name in exp["source_files"] if name not in uploaded]
    if missing_uploads:
        dws_fail.append(f"uploads missing {missing_uploads}")

    # Determine the target supplier: Critical supplier with max total_usd in expected_answer.
    critical_suppliers = [s for s in in_scope if s.get("severity") == "Critical"]
    target_supplier = max(critical_suppliers, key=lambda s: s["total_usd"])["supplier"] if critical_suppliers else ""

    # Check that at least one export corresponds to that supplier's dossier.
    # Correspondence: export.node_id equals the dossier doc's id, OR normalized export name contains the normalized supplier name.
    target_doc = (docs_by_supplier.get(target_supplier) or [None])[0]
    target_doc_id = _entity_id(target_doc or {})
    if not exports:
        dws_fail.append("no DWS export found")
    else:
        export_for_target = any(
            (target_doc_id and str(e.get("node_id") or e.get("nodeId") or "") == target_doc_id)
            or _norm(target_supplier) in _norm(e.get("name") or e.get("title") or "")
            for e in exports
        )
        if not export_for_target:
            dws_fail.append(
                f"export exists but not for the largest-USD Critical supplier ({target_supplier})"
            )
    for spec in in_scope:
        docs = docs_by_supplier.get(spec["supplier"]) or []
        if len(docs) != 1:
            dws_fail.append(f"{spec['supplier']}: doc count {len(docs)}")
            continue
        doc = docs[0]
        text = _dws_text(doc, blocks)
        issue_key = _issue_key((by_supplier.get(spec["supplier"]) or [{}])[0])
        if not _amount_in_text(text, spec["total_usd"]):
            dws_fail.append(f"{spec['supplier']}: doc missing total USD {spec['total_usd']}")
        for piece in (spec["supplier"], spec["severity"], spec["owner"], str(spec["total_shipments"]), str(spec["destination_count"]), str(spec["hs_count"]), spec["top_market"], spec["top_hs"], issue_key):
            if piece and piece not in text:
                dws_fail.append(f"{spec['supplier']}: doc missing {piece}")
                break
        doc_id = _entity_id(doc)
        doc_blocks = [
            str(b.get("text") or b.get("content") or "")
            for b in blocks
            if str(b.get("nodeId") or b.get("node_id") or b.get("documentId")) == doc_id
        ]
        trace_block = f"Trace Summary: {spec['supplier']} / {issue_key} / {spec['total_usd']}"
        if not any(trace_block in b for b in doc_blocks):
            dws_fail.append(f"{spec['supplier']}: trace block missing")
        ctexts = [str(c.get("content") or c.get("text") or "") for c in dws_comments if str(c.get("nodeId") or c.get("node_id") or c.get("documentId")) == doc_id]
        if not any(f"QA review needed: {spec['supplier']} -> {issue_key}" in c for c in ctexts):
            dws_fail.append(f"{spec['supplier']}: QA comment missing")
        doc_perms = [p for p in perms if str(p.get("nodeId") or p.get("node_id") or p.get("documentId")) == doc_id]
        if not any(_norm(p.get("userId")) == _norm(exp["dws_permission_user"]) for p in doc_perms):
            dws_fail.append(f"{spec['supplier']}: permission missing")
    checks.append(chk("dws_dossiers_correct", not dws_fail, "ok" if not dws_fail else "; ".join(dws_fail[:8])))

    # Trace map.
    tcells = trace.get("cells", {})
    trace_headers = [_cell(tcells, col, 1) for col in "ABCDEF"]
    th_ok = [_norm(h) for h in trace_headers] == [_norm(h) for h in exp["trace_headers"]]
    trace_fail = []
    for idx, spec in enumerate(in_scope, start=2):
        issue = (by_supplier.get(spec["supplier"]) or [{}])[0]
        doc = (docs_by_supplier.get(spec["supplier"]) or [{}])[0]
        expected = [spec["supplier"], _issue_key(issue), _entity_id(doc), spec["severity"], spec["owner"], spec["total_usd"]]
        got = [_cell(tcells, col, idx) for col in "ABCDEF"]
        for col, g, w in zip("ABCDEF", got, expected, strict=True):
            ok = (_num(g) == round(float(w), 2)) if isinstance(w, (int, float)) else (_norm(g) == _norm(w))
            if not ok:
                trace_fail.append(f"row {idx} col {col} got {g!r} want {w!r}")
                break
    checks.append(chk("trace_map_correct", th_ok and not trace_fail,
                      "ok" if th_ok and not trace_fail else f"header_ok={th_ok}; fail={trace_fail[:5]}"))
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
    dws, dws_err = _read_state(("MOCK_SITE_URL_DWS_DOC_CLI",), token)
    checks = evaluate(exp, task_dir, gws, jira, dws, gws_err, jira_err, dws_err)
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
    (output_dir / "dws_final_state.json").write_text(json.dumps(dws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
