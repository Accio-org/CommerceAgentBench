#!/usr/bin/env python3
"""Final-state verifier for cli-xfer-supplier-pipeline-deal-tracker.

The verifier derives the expected supplier pipeline from the live Notion source
state and the local Q3 workbook, then checks the final Jira state. It does not
inspect command history or audit attempts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
DEFAULT_WORKBOOK = "procurement_pipeline_workbook_2026Q3_v3.xlsx"


def _norm(v: Any) -> str:
    return " ".join(str(v or "").strip().casefold().split())


def _compact(v: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(v or "").casefold())


def _label(v: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(v or "").strip().casefold()).strip("-")


def _number(v: Any, default: int = 0) -> int:
    if v in (None, ""):
        return default
    try:
        return int(float(str(v).replace(",", "").strip()))
    except Exception:
        return default


def _contains(text: Any, needle: Any) -> bool:
    return bool(needle) and _compact(needle) in _compact(text)


def _contains_money(text: Any, total: int) -> bool:
    raw = str(text or "")
    if str(total) in raw or f"{total:,}" in raw:
        return True
    return str(total) in re.sub(r"\D+", "", raw)


def _text_near(text: str, needle: str, context_terms: tuple[str, ...], window: int = 90) -> bool:
    lower = text.casefold()
    needle_lower = needle.casefold()
    if needle_lower not in lower:
        return False
    for segment in re.split(r"[\n;|]+", lower):
        if needle_lower not in segment:
            continue
        segment = segment.replace(needle_lower, " ")
        if any(term.casefold() in segment for term in context_terms):
            return True
    return False


def _fetch(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _read_state(env_name: str, token: str) -> tuple[dict[str, Any], str]:
    base = os.environ.get(env_name, "").rstrip("/")
    if not base:
        return {}, f"{env_name} not set"
    if not token:
        return {}, "MOCK_VERIFIER_TOKEN not set"
    try:
        return _fetch(f"{base}/__bench/state", token), ""
    except Exception as exc:  # noqa: BLE001
        return {}, str(exc)


def chk(cid: str, ok: bool, reason: str = "") -> dict[str, Any]:
    return {
        "id": cid,
        "passed": bool(ok),
        "reason": str(reason or ("ok" if ok else ""))[:800],
        "check_type": "deterministic_semantic",
    }


def _xlsx_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    strings: list[str] = []
    for si in root.findall(f"{NS_MAIN}si"):
        strings.append("".join(t.text or "" for t in si.iter(f"{NS_MAIN}t")))
    return strings


def _xlsx_sheet_path(zf: zipfile.ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels
        if rel.attrib.get("Id") and rel.attrib.get("Target")
    }
    for sheet in workbook.iter(f"{NS_MAIN}sheet"):
        if sheet.attrib.get("name") != sheet_name:
            continue
        rid = sheet.attrib.get(f"{NS_REL}id")
        target = rel_targets.get(rid or "")
        if not target:
            break
        if target.startswith("/"):
            return target.lstrip("/")
        return posixpath.normpath(posixpath.join("xl", target))
    raise KeyError(f"sheet {sheet_name!r} not found")


def _cell_col(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    col = 0
    for ch in letters:
        col = col * 26 + (ord(ch.upper()) - ord("A") + 1)
    return max(0, col - 1)


def _xlsx_value(cell: ET.Element, shared: list[str]) -> Any:
    ctype = cell.attrib.get("t", "")
    if ctype == "inlineStr":
        return "".join(t.text or "" for t in cell.iter(f"{NS_MAIN}t"))
    value = cell.find(f"{NS_MAIN}v")
    if value is None or value.text is None:
        return None
    raw = value.text
    if ctype == "s":
        idx = _number(raw, -1)
        return shared[idx] if 0 <= idx < len(shared) else raw
    if ctype == "b":
        return raw == "1"
    if ctype == "str":
        return raw
    try:
        num = float(raw)
        return int(num) if num.is_integer() else num
    except ValueError:
        return raw


def _xlsx_rows(path: Path, sheet_name: str) -> list[dict[str, Any]]:
    with zipfile.ZipFile(path) as zf:
        shared = _xlsx_shared_strings(zf)
        root = ET.fromstring(zf.read(_xlsx_sheet_path(zf, sheet_name)))
    raw_rows: list[list[Any]] = []
    for row in root.iter(f"{NS_MAIN}row"):
        values: list[Any] = []
        for cell in row.findall(f"{NS_MAIN}c"):
            idx = _cell_col(cell.attrib.get("r", ""))
            while len(values) <= idx:
                values.append(None)
            values[idx] = _xlsx_value(cell, shared)
        raw_rows.append(values)
    if not raw_rows:
        return []
    headers = [str(h or "").strip() for h in raw_rows[0]]
    records = []
    for row in raw_rows[1:]:
        rec = {headers[i]: row[i] if i < len(row) else None for i in range(len(headers)) if headers[i]}
        if any(v not in (None, "") for v in rec.values()):
            records.append(rec)
    return records


def _workbook_path(task_dir: Path) -> Path:
    for rel in (f"workspace/{DEFAULT_WORKBOOK}", f"files/{DEFAULT_WORKBOOK}", DEFAULT_WORKBOOK):
        candidate = task_dir / rel
        if candidate.exists():
            return candidate
    raise FileNotFoundError(DEFAULT_WORKBOOK)


def _load_workbook(task_dir: Path) -> dict[str, Any]:
    path = _workbook_path(task_dir)
    suppliers = {
        str(row.get("supplier_name") or "").strip(): row
        for row in _xlsx_rows(path, "SupplierMaster")
        if row.get("supplier_name")
    }
    owners = {
        str(row.get("employee_id") or "").strip(): row
        for row in _xlsx_rows(path, "ProcurementOwners")
        if row.get("employee_id")
    }
    buckets = []
    for row in _xlsx_rows(path, "DealSizeBuckets"):
        label = str(row.get("deal_size_label") or "").strip()
        if label not in {"Large", "Medium", "Standard"}:
            continue
        buckets.append({
            "deal_size": label,
            "size_label": str(row.get("size_label_jira") or f"size-{_label(label)}").strip(),
            "min_usd": _number(row.get("min_usd")),
            "max_usd": None if row.get("max_usd") in (None, "") else _number(row.get("max_usd")),
            "priority": str(row.get("jira_priority") or "").strip(),
        })
    buckets.sort(key=lambda b: b["min_usd"], reverse=True)
    return {"supplier_master": suppliers, "owners": owners, "buckets": buckets}


def _pages_under(state: dict[str, Any], parent_id: str) -> list[dict[str, Any]]:
    raw = (state.get("entities") or {}).get("pages") or {}
    items = raw.values() if isinstance(raw, dict) else raw
    return [p for p in items if p.get("parentId") == parent_id and not p.get("archived")]


def _datasource_ids(state: dict[str, Any]) -> set[str]:
    raw = (state.get("entities") or {}).get("datasources") or {}
    items = raw.values() if isinstance(raw, dict) else raw
    return {str(ds.get("databaseId") or "") for ds in items if isinstance(ds, dict)}


def _datasource_aliases(state: dict[str, Any], database_id: str) -> set[str]:
    aliases = {database_id}
    raw = (state.get("entities") or {}).get("datasources") or {}
    items = raw.values() if isinstance(raw, dict) else raw
    for ds in items:
        if not isinstance(ds, dict):
            continue
        if ds.get("databaseId") == database_id:
            aliases.add(str(ds.get("id") or ""))
            aliases.add(str(ds.get("databaseId") or ""))
    return {a for a in aliases if a}


def _source_fingerprint(notion: dict[str, Any]) -> str:
    records = []
    for page in _pages_under(notion, "db_commerce_suppliers") + _pages_under(notion, "db_commerce_purchase_orders"):
        props = page.get("properties") or {}
        records.append({
            "id": page.get("id"),
            "parentId": page.get("parentId"),
            "title": page.get("title"),
            "properties": props,
            "archived": page.get("archived", False),
        })
    blob = json.dumps(sorted(records, key=lambda r: str(r["id"])), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _modal_owner(pages: list[dict[str, Any]]) -> str:
    counts = Counter(str((p.get("properties") or {}).get("Owner") or "").strip() for p in pages)
    counts.pop("", None)
    return counts.most_common(1)[0][0] if counts else ""


def _bucket_for(total: int, buckets: list[dict[str, Any]]) -> dict[str, Any] | None:
    for bucket in buckets:
        hi = bucket["max_usd"]
        if total >= bucket["min_usd"] and (hi is None or total <= hi):
            return bucket
    return None


def _category_label(category: str) -> str:
    return "category-" + _label(category)


def _category_label_aliases(category_label: str) -> set[str]:
    normed = _norm(category_label)
    aliases = {normed}
    if normed.startswith("category-"):
        aliases.add("cat-" + normed[len("category-"):])
    return aliases


def _derive_specs(exp: dict[str, Any], notion: dict[str, Any], wb: dict[str, Any]) -> list[dict[str, Any]]:
    supplier_db = exp["source"]["supplier_database_id"]
    po_db = exp["source"]["po_database_id"]
    normal_statuses = {_norm(s) for s in exp["rules"]["normal_po_statuses"]}
    min_total = int(exp["rules"]["material_volume_min_usd"])

    supplier_pages_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for page in _pages_under(notion, supplier_db):
        supplier = str((page.get("properties") or {}).get("Supplier") or "").strip()
        if supplier:
            supplier_pages_by_name[supplier].append(page)

    totals: dict[str, int] = defaultdict(int)
    for page in _pages_under(notion, po_db):
        props = page.get("properties") or {}
        if _norm(props.get("Status")) not in normal_statuses:
            continue
        supplier = str(props.get("Supplier") or "").strip()
        if supplier:
            totals[supplier] += _number(props.get("ValueUSD"))

    specs = []
    for supplier, pages in supplier_pages_by_name.items():
        if any(_norm((p.get("properties") or {}).get("CertificationStatus")) == "hold" for p in pages):
            continue
        total = totals.get(supplier, 0)
        if total < min_total:
            continue
        bucket = _bucket_for(total, wb["buckets"])
        if not bucket:
            continue

        master = wb["supplier_master"].get(supplier) or {}
        owner_id = str(master.get("primary_owner_id") or "").strip()
        owner_row = wb["owners"].get(owner_id) or {}
        owner = str(owner_row.get("full_name") or "").strip() or _modal_owner(pages)
        category = str(master.get("primary_category") or "").strip()
        if not category:
            category = str((pages[0].get("properties") or {}).get("Category") or "supplier").strip()

        specs.append({
            "supplier": supplier,
            "total": total,
            "deal_size": bucket["deal_size"],
            "size_label": bucket["size_label"],
            "priority": bucket["priority"],
            "owner": owner,
            "category_label": _category_label(category),
            "page_ids": sorted(str(p.get("id")) for p in pages if p.get("id")),
            "escalate": bucket["deal_size"] == exp["rules"].get("executive_intro_deal_size", "Large"),
        })
    return sorted(specs, key=lambda s: (-s["total"], s["supplier"]))


def _issue_text(issue: dict[str, Any], comments: list[dict[str, Any]]) -> str:
    issue_comments = " ".join(str(c.get("body") or "") for c in comments if c.get("issue_key") == issue.get("key"))
    return " ".join([
        str(issue.get("summary") or ""),
        str(issue.get("description") or ""),
        " ".join(str(l) for l in issue.get("labels") or []),
        issue_comments,
    ])


def _matches_epic_summary(summary: str, expected: str) -> bool:
    if _norm(summary) == _norm(expected):
        return True
    compact = _compact(summary)
    return all(token in compact for token in ("supplier", "deal", "pipeline", "q3", "onboarding"))


def _linked(jira: dict[str, Any], key_a: str | None, key_b: str | None, link_type: str | None = None) -> bool:
    if not key_a or not key_b:
        return False
    for link in jira.get("issue_links", []) or []:
        if link_type and _norm(link_type) not in _norm(link.get("link_type")):
            continue
        if {link.get("inward_key"), link.get("outward_key")} == {key_a, key_b}:
            return True
    return False


def _associated_with_epic(jira: dict[str, Any], issue: dict[str, Any], epic_key: str | None) -> bool:
    if not epic_key:
        return False
    if issue.get("parent_key") == epic_key or issue.get("epic_key") == epic_key:
        return True
    if _linked(jira, issue.get("key"), epic_key):
        return True
    return epic_key in str(issue.get("description") or "")


def _pipeline_candidates(jira: dict[str, Any], specs: list[dict[str, Any]], epic_key: str | None) -> list[dict[str, Any]]:
    candidates = []
    supplier_names = [s["supplier"] for s in specs]
    comments = jira.get("comments", []) or []
    for issue in jira.get("issues", []) or []:
        if issue.get("type_name") == "Epic":
            continue
        labels = {_norm(l) for l in issue.get("labels") or []}
        text = _issue_text(issue, comments)
        supplier_hit = any(_contains(text, supplier) for supplier in supplier_names)
        if "deal-pipeline" in labels or _associated_with_epic(jira, issue, epic_key) or supplier_hit:
            candidates.append(issue)
    return candidates


def evaluate(exp: dict[str, Any], notion: dict[str, Any], jira: dict[str, Any],
             n_err: str, j_err: str, task_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    checks: list[dict[str, Any]] = []
    specs: list[dict[str, Any]] = []

    wb: dict[str, Any] | None = None
    wb_err = ""
    try:
        wb = _load_workbook(task_dir)
    except Exception as exc:  # noqa: BLE001
        wb_err = str(exc)

    proj = exp["jira_project"]
    proj_ok = any(p.get("key") == proj for p in jira.get("projects", []) or []) if not j_err else False
    ds_ok = {exp["source"]["supplier_database_id"], exp["source"]["po_database_id"]}.issubset(_datasource_ids(notion)) if not n_err else False
    setup_ok = not n_err and not j_err and not wb_err and proj_ok and ds_ok
    setup_reason = n_err or j_err or wb_err or ("" if proj_ok else f"jira project {proj} missing") or ("" if ds_ok else "required Notion datasources missing") or "ok"
    checks.append(chk("setup_gate", setup_ok, setup_reason))
    if not setup_ok or wb is None:
        for cid in exp["check_ids"][1:]:
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks, specs

    specs = _derive_specs(exp, notion, wb)
    expected_suppliers = {s["supplier"] for s in specs}

    src = exp.get("source", {})
    supplier_count = len(_pages_under(notion, src["supplier_database_id"]))
    po_count = len(_pages_under(notion, src["po_database_id"]))
    fingerprint = _source_fingerprint(notion)
    expected_fp = src.get("fingerprint_sha256")
    source_ok = (
        supplier_count == int(src.get("supplier_page_count", supplier_count))
        and po_count == int(src.get("po_page_count", po_count))
        and (not expected_fp or fingerprint == expected_fp)
    )
    checks.append(chk(
        "source_integrity",
        source_ok,
        "ok" if source_ok else f"suppliers={supplier_count}, pos={po_count}, fingerprint={fingerprint[:12]}",
    ))

    issues = jira.get("issues", []) or []
    comments = jira.get("comments", []) or []
    epics = [
        i for i in issues
        if i.get("project_key") == proj and i.get("type_name") == "Epic"
        and _matches_epic_summary(str(i.get("summary") or ""), exp["epic_summary"])
    ]
    epic = epics[0] if len(epics) == 1 else None
    epic_key = epic.get("key") if epic else None
    checks.append(chk("epic_correct", epic is not None,
                      "ok" if epic else f"expected one Q3 supplier pipeline epic in {proj}, got {len(epics)}"))

    candidates = _pipeline_candidates(jira, specs, epic_key)
    issue_by_supplier: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for issue in candidates:
        text = _issue_text(issue, comments)
        matched = [s for s in specs if _contains(text, s["supplier"])]
        if len(matched) == 1:
            issue_by_supplier[matched[0]["supplier"]].append(issue)

    missing = sorted(expected_suppliers - set(issue_by_supplier))
    duplicates = sorted(s for s, vals in issue_by_supplier.items() if len(vals) > 1)
    extras = []
    for issue in candidates:
        text = _issue_text(issue, comments)
        if not any(_contains(text, supplier) for supplier in expected_suppliers):
            extras.append(f"{issue.get('key')}:{str(issue.get('summary') or '')[:80]}")
    checks.append(chk(
        "inclusion_set_correct",
        not missing and not duplicates and not extras,
        "ok" if not missing and not duplicates and not extras else f"missing={missing}; duplicates={duplicates}; extras={extras[:5]}",
    ))

    def issue_for(spec: dict[str, Any]) -> dict[str, Any] | None:
        return (issue_by_supplier.get(spec["supplier"]) or [None])[0]

    structure_fail = []
    for spec in specs:
        issue = issue_for(spec)
        if not issue:
            structure_fail.append(f"{spec['supplier']}: no issue")
            continue
        if issue.get("project_key") != proj:
            structure_fail.append(f"{spec['supplier']}: project={issue.get('project_key')!r}")
        if issue.get("type_name") != "Task":
            structure_fail.append(f"{spec['supplier']}: type={issue.get('type_name')!r}")
        if not _associated_with_epic(jira, issue, epic_key):
            structure_fail.append(f"{spec['supplier']}: not associated with epic {epic_key}")
    checks.append(chk("pipeline_issue_structure_correct", not structure_fail, "; ".join(structure_fail) if structure_fail else "ok"))

    priority_fail = []
    for spec in specs:
        issue = issue_for(spec)
        if not issue:
            priority_fail.append(f"{spec['supplier']}: no issue")
            continue
        if _norm(issue.get("priority_name")) != _norm(spec["priority"]):
            priority_fail.append(f"{spec['supplier']}: got {issue.get('priority_name')!r}, want {spec['priority']!r}")
    checks.append(chk("priority_correct", not priority_fail, "; ".join(priority_fail) if priority_fail else "ok"))

    summary_fail = []
    for spec in specs:
        issue = issue_for(spec)
        if not issue:
            summary_fail.append(f"{spec['supplier']}: no issue")
            continue
        summary = str(issue.get("summary") or "")
        missing_bits = []
        if not _contains(summary, spec["supplier"]):
            missing_bits.append("supplier")
        if not _contains(summary, spec["deal_size"]):
            missing_bits.append("deal_size")
        if not _contains_money(summary, spec["total"]):
            missing_bits.append("normal_po_total")
        if spec["owner"] and not _contains(summary, spec["owner"]):
            missing_bits.append("owner")
        if missing_bits:
            summary_fail.append(f"{spec['supplier']}: missing {missing_bits}")
    checks.append(chk("summary_content_correct", not summary_fail, "; ".join(summary_fail) if summary_fail else "ok"))

    label_fail = []
    category_fail = []
    for spec in specs:
        issue = issue_for(spec)
        if not issue:
            label_fail.append(f"{spec['supplier']}: no issue")
            category_fail.append(f"{spec['supplier']}: no issue")
            continue
        labels = {_norm(l) for l in issue.get("labels") or []}
        if "deal-pipeline" not in labels or _norm(spec["size_label"]) not in labels:
            label_fail.append(f"{spec['supplier']}: labels={sorted(labels)}, want deal-pipeline and {spec['size_label']}")
        wrong_sizes = [l for l in labels if l.startswith("size-") and l != _norm(spec["size_label"])]
        if wrong_sizes:
            label_fail.append(f"{spec['supplier']}: wrong size labels {wrong_sizes}")
        cat_aliases = _category_label_aliases(spec["category_label"])
        if not (cat_aliases & labels):
            category_fail.append(f"{spec['supplier']}: labels={sorted(labels)}, want {spec['category_label']}")
        wrong_categories = [
            l for l in labels
            if (l.startswith("category-") or l.startswith("cat-")) and l not in cat_aliases
        ]
        if wrong_categories:
            category_fail.append(f"{spec['supplier']}: wrong category labels {wrong_categories}")
    checks.append(chk("labels_correct", not label_fail, "; ".join(label_fail) if label_fail else "ok"))
    checks.append(chk("category_labels_correct", not category_fail, "; ".join(category_fail) if category_fail else "ok"))

    trace_fail = []
    escalation_fail = []
    for spec in specs:
        issue = issue_for(spec)
        if not issue:
            trace_fail.append(f"{spec['supplier']}: no issue")
            escalation_fail.append(f"{spec['supplier']}: no issue")
            continue
        issue_comments = [str(c.get("body") or "") for c in comments if c.get("issue_key") == issue.get("key")]
        trace_ok = any(
            _contains(body, spec["supplier"])
            and _contains_money(body, spec["total"])
            and _contains(body, spec["deal_size"])
            and (not spec["owner"] or _contains(body, spec["owner"]))
            and ("po" in body.casefold() or "purchase" in body.casefold())
            for body in issue_comments
        )
        if not trace_ok:
            trace_fail.append(f"{spec['supplier']}: missing semantic source trace comment")
        exec_comments = [
            body for body in issue_comments
            if "executive" in body.casefold() and ("intro" in body.casefold() or "introduction" in body.casefold())
        ]
        if spec["escalate"] and not exec_comments:
            escalation_fail.append(f"{spec['supplier']}: missing executive intro reminder")
        if not spec["escalate"] and exec_comments:
            escalation_fail.append(f"{spec['supplier']}: unexpected executive intro reminder")
    checks.append(chk("trace_comments_correct", not trace_fail, "; ".join(trace_fail) if trace_fail else "ok"))
    checks.append(chk("escalation_comments_correct", not escalation_fail, "; ".join(escalation_fail) if escalation_fail else "ok"))

    state_fail = []
    for spec in specs:
        issue = issue_for(spec)
        if not issue:
            state_fail.append(f"{spec['supplier']}: no issue")
            continue
        if _norm(issue.get("status_name")) != _norm(exp["target_state"]):
            state_fail.append(f"{spec['supplier']}: status={issue.get('status_name')!r}")
    checks.append(chk("transition_state_correct", not state_fail, "; ".join(state_fail) if state_fail else "ok"))

    link_fail = []
    cohorts: dict[str, list[str]] = defaultdict(list)
    for spec in specs:
        issue = issue_for(spec)
        if issue and issue.get("key"):
            cohorts[spec["deal_size"]].append(issue["key"])
    for deal_size, keys in cohorts.items():
        if len(keys) <= 1:
            continue
        seen = {keys[0]}
        changed = True
        while changed:
            changed = False
            for key in keys:
                if key in seen:
                    continue
                if any(_linked(jira, key, other, exp["jira_link_type"]) for other in seen):
                    seen.add(key)
                    changed = True
        if seen != set(keys):
            link_fail.append(f"{deal_size}: cohort not connected ({sorted(seen)} of {sorted(keys)})")
    checks.append(chk("deal_size_links_correct", not link_fail, "; ".join(link_fail) if link_fail else "ok"))

    epic_desc_fail = []
    if not epic:
        epic_desc_fail.append("epic not found")
    else:
        desc = str(epic.get("description") or "")
        for spec in specs:
            if not _contains(desc, spec["supplier"]):
                epic_desc_fail.append(f"missing roster supplier {spec['supplier']}")
        reporter = str(epic.get("reporter") or "")
        if reporter and not _contains(desc, reporter):
            epic_desc_fail.append(f"missing reviewer/reporter {reporter}")
        proj_row = next((p for p in jira.get("projects", []) or [] if p.get("key") == proj), {})
        if proj_row.get("lead") and not _contains(desc, proj_row["lead"]):
            epic_desc_fail.append(f"missing project lead {proj_row['lead']}")
        board_names = [b.get("name") for b in jira.get("boards", []) or [] if b.get("project_key") == proj and b.get("name")]
        if board_names and not any(_contains(desc, name) for name in board_names):
            epic_desc_fail.append("missing PROJ board")
        proj_board_ids = {b.get("id") for b in jira.get("boards", []) or [] if b.get("project_key") == proj}
        sprint_names = [
            s.get("name") for s in jira.get("sprints", []) or []
            if s.get("state") == "active" and (not proj_board_ids or s.get("board_id") in proj_board_ids) and s.get("name")
        ]
        if sprint_names and not any(_contains(desc, name) for name in sprint_names):
            epic_desc_fail.append("missing active PROJ sprint")
        sup_aliases = _datasource_aliases(notion, exp["source"]["supplier_database_id"])
        po_aliases = _datasource_aliases(notion, exp["source"]["po_database_id"])
        if not any(alias in desc and _text_near(desc, alias, ("supplier", "due diligence", "company")) for alias in sup_aliases):
            epic_desc_fail.append(f"missing supplier datasource context {sorted(sup_aliases)}")
        if not any(alias in desc and _text_near(desc, alias, ("po", "purchase", "order")) for alias in po_aliases):
            epic_desc_fail.append(f"missing PO datasource context {sorted(po_aliases)}")
    checks.append(chk("epic_description_context_correct", not epic_desc_fail, "; ".join(epic_desc_fail) if epic_desc_fail else "ok"))

    issue_desc_fail = []
    supplier_ds_aliases = _datasource_aliases(notion, exp["source"]["supplier_database_id"])
    for spec in specs:
        issue = issue_for(spec)
        if not issue:
            issue_desc_fail.append(f"{spec['supplier']}: no issue")
            continue
        desc = str(issue.get("description") or "")
        if issue.get("key") and issue["key"] not in desc:
            issue_desc_fail.append(f"{spec['supplier']}: missing own issue key")
        if not any(pid in desc for pid in spec["page_ids"]):
            issue_desc_fail.append(f"{spec['supplier']}: missing live Notion supplier page id")
        if not _contains(desc, spec["deal_size"]):
            issue_desc_fail.append(f"{spec['supplier']}: missing cohort/deal size")
        if not any(alias in desc for alias in supplier_ds_aliases):
            issue_desc_fail.append(f"{spec['supplier']}: missing supplier datasource id")
    checks.append(chk("issue_description_traceability_correct", not issue_desc_fail, "; ".join(issue_desc_fail) if issue_desc_fail else "ok"))

    return checks, specs


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
    notion, n_err = _read_state("MOCK_SITE_URL_NOTION_CLI", token)
    jira, j_err = _read_state("MOCK_SITE_URL_JIRA_CLI", token)

    checks, specs = evaluate(exp, notion, jira, n_err, j_err, task_dir)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "notion_final_state.json").write_text(
        json.dumps(notion, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "jira_final_state.json").write_text(
        json.dumps(jira, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "derived_expected_pipeline.json").write_text(
        json.dumps(specs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    raw_score = round(passed / total, 4) if total else 0.0
    all_passed = total > 0 and passed == total
    binary = 1.0 if all_passed else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": exp.get("task_id") or "cli-xfer-supplier-pipeline-deal-tracker",
        "score": binary,
        "reward": binary,
        "raw_score": raw_score,
        "raw_reward": raw_score,
        "raw_passed": all_passed,
        "checks_passed": passed,
        "checks_total": total,
        "check_summary": f"{passed}/{total} checks passed",
        "checks_breakdown": checks,
        "validation_checks": checks,
        "passed": all_passed,
    }
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": binary, "raw_score": raw_score, "checks_passed": passed, "checks_total": total, "passed": all_passed}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
