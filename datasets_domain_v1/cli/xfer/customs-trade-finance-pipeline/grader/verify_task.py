#!/usr/bin/env python3
"""Verifier for cli-xfer-customs-trade-finance-pipeline.

Reads three final mock states:
  - dws_doc_cli  : MOCK_SITE_URL_DWS_DOC_CLI/api/state       (DWS has its own HTTP server)
  - stripe_cli   : MOCK_SITE_URL_STRIPE_CLI/__bench/state     (daemon_cli via bench_bridge)
  - todoist_cli  : MOCK_SITE_URL_TODOIST_CLI/__bench/state     (daemon_cli via bench_bridge)

Scoring is based on the final state the agent produced in the three CLI
systems, compared against pre-computed ground truth from the customs CSVs.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import urllib.request
from pathlib import Path
from typing import Any


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


# ---------- DWS helpers ----------
# DWS dumpFullState() returns entities.documents (dict keyed by nodeId,
# containing ALL nodes incl. folders distinguished by type="folder"),
# entities.blocks, entities.comments, and entities.permissions.
# There are no separate folders/files/exports collections.

def _dws_all_docs(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Return all document/folder nodes from DWS state."""
    raw = (state.get("entities") or {}).get("documents") or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _dws_docs(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Return only file-type documents (excluding folders)."""
    return [d for d in _dws_all_docs(state) if d.get("type") != "folder"]


def _dws_folders(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Return only folder-type documents."""
    return [d for d in _dws_all_docs(state) if d.get("type") == "folder"]


def _dws_comments(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Return all comments from DWS state."""
    raw = (state.get("entities") or {}).get("comments") or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _dws_permissions(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Return all permissions from DWS state."""
    raw = (state.get("entities") or {}).get("permissions") or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _dws_find(items: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    for item in items:
        if _norm(item.get("name") or item.get("title")) == _norm(name):
            return item
    return None


def _dws_content_text(doc: dict[str, Any]) -> str:
    parts: list[str] = []
    parts.append(str(doc.get("content") or ""))
    for block in doc.get("blocks") or []:
        parts.append(str(block.get("text") or block.get("content") or ""))
    return "\n".join(parts)


# ---------- Stripe helpers ----------

def _stripe_objects(state: dict[str, Any], resource: str) -> list[dict[str, Any]]:
    return [o.get("data") or o for o in state.get("objects", []) if o.get("resource") == resource]


# ---------- Todoist helpers ----------

def _user_to_api_priority(priority: int) -> int:
    return 5 - int(priority)


# ---------- Main evaluation ----------

def evaluate(exp: dict[str, Any],
             dws: dict[str, Any], stripe: dict[str, Any], todoist: dict[str, Any],
             dws_err: str, stripe_err: str, todoist_err: str,
             source_ok: bool, source_reason: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    qualified = exp["qualified_suppliers"]
    expected_suppliers = {s["supplier"] for s in qualified}

    # -- Setup gate --
    dws_docs = _dws_docs(dws)
    dws_folders = _dws_folders(dws)
    todo_project = None
    if not todoist_err:
        for p in todoist.get("projects", []):
            if _norm(p.get("name")) == _norm(exp["todoist_project_name"]):
                todo_project = p
                break
    stripe_customers = _stripe_objects(stripe, "customers")

    # Seeded personal Todoist tasks (todoist_cli seeds 2500000001-2500000006)
    # must survive; destructive cleanup of pre-existing user data fails the gate.
    seed_missing: list[str] = []
    if not todoist_err:
        _live_ids = {str(i.get("id")) for i in todoist.get("items", []) if not i.get("is_deleted")}
        seed_missing = [str(s) for s in range(2500000001, 2500000007) if str(s) not in _live_ids]

    setup_ok = (
        (not dws_err) and (not stripe_err) and (not todoist_err)
        and bool(todo_project)
        and not seed_missing
    )
    setup_reason = (
        dws_err or stripe_err or todoist_err
        or ("" if todo_project else f"todoist project {exp['todoist_project_name']!r} missing")
        or ("" if not seed_missing else f"seeded personal tasks deleted: {seed_missing}")
        or "ok"
    )
    checks.append(chk("setup_gate", setup_ok, setup_reason))
    checks.append(chk("source_data_present", source_ok, source_reason))

    if not setup_ok:
        for cid in ("dws_report_structure", "dws_content_correct",
                     "stripe_customers_correct", "stripe_products_and_pricing",
                     "stripe_invoices_correct", "todoist_queue_correct",
                     "cross_system_trace"):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    # -- DWS report structure --
    dws_fail: list[str] = []
    folder = _dws_find(dws_folders, exp["dws_folder_name"])
    if not folder:
        dws_fail.append(f"folder {exp['dws_folder_name']!r} missing")
    main_doc = _dws_find(dws_docs, exp["dws_main_doc_name"])
    if not main_doc:
        dws_fail.append(f"main doc {exp['dws_main_doc_name']!r} missing")

    for sub_name in exp["dws_regional_sub_reports"]:
        sub = _dws_find(dws_docs, sub_name)
        if not sub:
            dws_fail.append(f"sub-report {sub_name!r} missing")
        elif folder and str(sub.get("parentId") or "") != str(folder.get("nodeId") or folder.get("id") or ""):
            dws_fail.append(f"sub-report {sub_name!r} not in folder")

    # Check comments (entities.comments is a flat map keyed by commentKey)
    comments = _dws_comments(dws)
    if main_doc:
        doc_id = str(main_doc.get("nodeId") or main_doc.get("id") or "")
        doc_comments = [c for c in comments if str(c.get("nodeId") or "") == doc_id]
        expected_comment = _norm(exp["dws_comment_content"])
        has_comment = any(_norm(c.get("content") or c.get("text")) == expected_comment for c in doc_comments)
        if not has_comment:
            dws_fail.append("review comment missing on main doc")

    # Check permissions (entities.permissions keyed by "nodeId:userId")
    permissions = _dws_permissions(dws)
    if main_doc:
        doc_id = str(main_doc.get("nodeId") or main_doc.get("id") or "")
        doc_perms = [p for p in permissions if str(p.get("nodeId") or "") == doc_id]
        perm_users = {_norm(p.get("userId") or "") for p in doc_perms}
        missing_users = [u for u in exp["dws_permission_users"] if _norm(u) not in perm_users]
        if missing_users:
            dws_fail.append(f"permissions missing for {missing_users[:3]}")

    # Check uploaded files (all in entities.documents with type="file")
    all_docs = _dws_all_docs(dws)
    csv_uploads = [d for d in all_docs
                   if str(d.get("extension") or "").lower() == "csv"
                   or str(d.get("name") or "").endswith(".csv")]
    if len(csv_uploads) < 3:
        dws_fail.append(f"expected 3+ CSV uploads, got {len(csv_uploads)}")

    checks.append(chk("dws_report_structure", not dws_fail,
                       "ok" if not dws_fail else "; ".join(dws_fail[:6])))

    # -- DWS content correctness --
    content_fail: list[str] = []
    if main_doc:
        doc_text = _dws_content_text(main_doc)
        for spec in qualified:
            supplier = spec["supplier"]
            if supplier not in doc_text:
                content_fail.append(f"{supplier}: not in report")
                continue
            if str(spec["total_shipments"]) not in doc_text:
                content_fail.append(f"{supplier}: shipment count {spec['total_shipments']} missing")
            # Check that priority is mentioned near supplier
            if f"Priority {spec['priority']}" not in doc_text and spec["priority"] not in doc_text:
                content_fail.append(f"{supplier}: priority {spec['priority']} missing")
    else:
        content_fail.append("main doc missing, cannot check content")

    checks.append(chk("dws_content_correct", not content_fail,
                       "ok" if not content_fail else "; ".join(content_fail[:6])))

    # -- Stripe customers --
    cust_fail: list[str] = []
    cust_by_supplier: dict[str, dict[str, Any]] = {}
    for cust in stripe_customers:
        name = str(cust.get("name") or "")
        if name in expected_suppliers:
            cust_by_supplier[name] = cust

    missing_custs = sorted(expected_suppliers - set(cust_by_supplier))
    if missing_custs:
        cust_fail.append(f"missing customers: {missing_custs[:4]}")

    for spec in qualified:
        cust = cust_by_supplier.get(spec["supplier"])
        if not cust:
            continue
        meta = cust.get("metadata") or {}
        if _norm(meta.get("priority")) != _norm(spec["priority"]):
            cust_fail.append(f"{spec['supplier']}: priority metadata {meta.get('priority')!r} want {spec['priority']!r}")
        if _norm(meta.get("region")) not in [_norm(r) for r in spec["regions"]]:
            cust_fail.append(f"{spec['supplier']}: region metadata {meta.get('region')!r} want {spec['regions']!r}")

    extra_custs = len(stripe_customers) - len(cust_by_supplier)
    cust_ok = not cust_fail and not missing_custs and len(cust_by_supplier) == len(qualified)
    checks.append(chk("stripe_customers_correct", cust_ok,
                       "ok" if cust_ok else f"fail={cust_fail[:4]} missing={missing_custs[:3]} extra={extra_custs}"))

    # -- Stripe products & pricing --
    prod_fail: list[str] = []
    products = _stripe_objects(stripe, "products")
    prices = _stripe_objects(stripe, "prices")
    tax_rates = _stripe_objects(stripe, "tax_rates")
    coupons = _stripe_objects(stripe, "coupons")

    expected_chapters = exp["all_hs_chapters"]
    # Check products exist for HS chapters
    prod_names = [str(p.get("name") or "") for p in products]
    chapters_found = []
    for ch in expected_chapters:
        if any(ch in name for name in prod_names):
            chapters_found.append(ch)
    missing_chapters = [ch for ch in expected_chapters if ch not in chapters_found]
    if missing_chapters:
        prod_fail.append(f"missing HS chapter products: {missing_chapters[:6]}")

    # Check prices exist
    if len(prices) < len(chapters_found):
        prod_fail.append(f"expected {len(chapters_found)}+ prices, got {len(prices)}")

    # Check tax rates
    expected_tax_count = len(exp["stripe_tax_rates"])
    if len(tax_rates) < expected_tax_count:
        prod_fail.append(f"expected {expected_tax_count} tax rates, got {len(tax_rates)}")
    else:
        for exp_tax in exp["stripe_tax_rates"]:
            found = any(
                _norm(t.get("display_name")) == _norm(exp_tax["display_name"])
                and abs(float(t.get("percentage") or 0) - exp_tax["percentage"]) < 0.01
                for t in tax_rates
            )
            if not found:
                prod_fail.append(f"tax rate {exp_tax['display_name']!r} missing or wrong percentage")

    # Check coupon
    coupon_found = any(
        (str(c.get("id") or "").upper() == exp["stripe_coupon_id"]
         or _norm(c.get("name")) == _norm(exp["stripe_coupon_id"]))
        and int(c.get("percent_off") or 0) == exp["stripe_coupon_percent_off"]
        for c in coupons
    )
    if not coupon_found:
        prod_fail.append(f"coupon {exp['stripe_coupon_id']!r} with {exp['stripe_coupon_percent_off']}% off missing")

    checks.append(chk("stripe_products_and_pricing", not prod_fail,
                       "ok" if not prod_fail else "; ".join(prod_fail[:6])))

    # -- Stripe invoices --
    inv_fail: list[str] = []
    invoices = _stripe_objects(stripe, "invoices")
    invoice_items = _stripe_objects(stripe, "invoiceitems")

    inv_by_supplier: dict[str, dict[str, Any]] = {}
    for inv in invoices:
        cust_id = str(inv.get("customer") or "")
        cust = cust_by_supplier.get(next(
            (s for s, c in cust_by_supplier.items() if str(c.get("id")) == cust_id), ""), {})
        supplier_name = str(cust.get("name") or "")
        if supplier_name in expected_suppliers:
            inv_by_supplier[supplier_name] = inv

    missing_invs = sorted(expected_suppliers - set(inv_by_supplier))
    if missing_invs:
        inv_fail.append(f"missing invoices for: {missing_invs[:4]}")

    for spec in qualified:
        inv = inv_by_supplier.get(spec["supplier"])
        if not inv:
            continue
        desc = str(inv.get("description") or inv.get("memo") or "")
        if spec["supplier"] not in desc and _norm(spec["supplier"]) not in _norm(desc):
            inv_fail.append(f"{spec['supplier']}: description missing supplier name")
        if spec["priority"] not in desc:
            inv_fail.append(f"{spec['supplier']}: description missing priority")

        # Check line items exist for this invoice
        inv_id = str(inv.get("id") or "")
        line_items = [li for li in invoice_items if str(li.get("invoice") or "") == inv_id]
        expected_items = len(spec["unique_hs_chapters"])
        if len(line_items) < expected_items:
            inv_fail.append(f"{spec['supplier']}: expected {expected_items} line items, got {len(line_items)}")

    inv_ok = not inv_fail and len(inv_by_supplier) == len(qualified)
    checks.append(chk("stripe_invoices_correct", inv_ok,
                       "ok" if inv_ok else "; ".join(inv_fail[:6])))

    # -- Todoist queue --
    todo_fail: list[str] = []
    todo_project_id = todo_project.get("id") if todo_project else None

    sections = [
        s for s in todoist.get("sections", [])
        if s.get("project_id") == todo_project_id
        and not s.get("is_deleted") and not s.get("is_archived")
    ]
    section_by_name: dict[str, dict[str, Any]] = {}
    for s in sections:
        section_by_name[_norm(s.get("name"))] = s

    # Check sections exist (accept both with and without count suffix)
    expected_sections = exp["todoist_sections"]
    for _, sec_name in expected_sections.items():
        base_name = _norm(sec_name)
        found = any(base_name in _norm(sn) for sn in section_by_name)
        if not found:
            todo_fail.append(f"section {sec_name!r} missing")

    items = [i for i in todoist.get("items", []) if not i.get("is_deleted")]
    project_items = [i for i in items if i.get("project_id") == todo_project_id]
    active_items = [i for i in project_items if not i.get("is_completed")]
    completed_items = [i for i in project_items if i.get("is_completed")]

    # Check supplier tasks
    item_by_supplier: dict[str, dict[str, Any]] = {}
    for item in active_items:
        content = str(item.get("content") or "")
        for supplier in expected_suppliers:
            if supplier in content:
                item_by_supplier[supplier] = item
                break

    missing_tasks = sorted(expected_suppliers - set(item_by_supplier))
    if missing_tasks:
        todo_fail.append(f"missing supplier tasks: {missing_tasks[:3]}")

    for spec in qualified:
        item = item_by_supplier.get(spec["supplier"])
        if not item:
            continue
        # Check priority
        want_api_priority = _user_to_api_priority(spec["todoist_priority"])
        if item.get("priority") != want_api_priority:
            todo_fail.append(f"{spec['supplier']}: priority {item.get('priority')} want {want_api_priority}")

        # Check labels
        labels = set(item.get("labels") or [])
        want_labels = {exp["todoist_fixed_label"], spec["todoist_label"]}
        if not want_labels.issubset(labels):
            todo_fail.append(f"{spec['supplier']}: labels {sorted(labels)} missing {sorted(want_labels - labels)}")

        # Check section placement
        item_section = item.get("section_id")
        want_section_name = _norm(expected_sections[spec["priority"]])
        placed_ok = any(
            item_section == s.get("id") and want_section_name in _norm(s.get("name"))
            for s in sections
        )
        if not placed_ok:
            todo_fail.append(f"{spec['supplier']}: wrong section (id={item_section})")

    # Check completed setup task
    setup_found = any(
        _norm(exp["todoist_setup_task_content_prefix"]) in _norm(i.get("content"))
        for i in completed_items
    )
    if not setup_found:
        todo_fail.append("completed setup task missing")

    todo_ok = not todo_fail and len(item_by_supplier) == len(qualified)
    checks.append(chk("todoist_queue_correct", todo_ok,
                       "ok" if not todo_fail else "; ".join(todo_fail[:8])))

    # -- Cross-system trace --
    trace_fail: list[str] = []
    for spec in qualified:
        item = item_by_supplier.get(spec["supplier"])
        cust = cust_by_supplier.get(spec["supplier"])
        if not item or not cust:
            trace_fail.append(f"{spec['supplier']}: missing item or customer for trace")
            continue
        content = str(item.get("content") or "")
        cust_id = str(cust.get("id") or "")
        if cust_id and cust_id not in content:
            trace_fail.append(f"{spec['supplier']}: Stripe customer ID {cust_id!r} not in Todoist task")

    checks.append(chk("cross_system_trace", not trace_fail,
                       "ok" if not trace_fail else "; ".join(trace_fail[:6])))

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

    # Check source CSV integrity
    try:
        csv_dir = task_dir / exp.get("source_csv_dir", "workspace/customs_data")
        csv_files = list(csv_dir.glob("*.csv"))
        total_rows = 0
        for csv_path in csv_files:
            with csv_path.open(newline="", encoding="utf-8-sig") as f:
                total_rows += sum(1 for _ in csv.DictReader(f))
        source_min = int(exp.get("source_min_rows", 8000))
        source_ok = len(csv_files) >= 3 and total_rows >= source_min
        source_reason = f"csv_files={len(csv_files)}, total_rows={total_rows}, min={source_min}"
    except Exception as exc:  # noqa: BLE001
        source_ok = False
        source_reason = f"source parse failed: {exc}"

    dws, dws_err = _read_state(("MOCK_SITE_URL_DWS_DOC_CLI",), token, "/api/state")
    stripe, stripe_err = _read_state(("MOCK_SITE_URL_STRIPE_CLI",), token, "/__bench/state")
    todoist, todoist_err = _read_state(("MOCK_SITE_URL_TODOIST_CLI",), token, "/__bench/state")

    checks = evaluate(exp, dws, stripe, todoist, dws_err, stripe_err, todoist_err,
                       source_ok, source_reason)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "dws_final_state.json").write_text(
        json.dumps(dws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "stripe_final_state.json").write_text(
        json.dumps(stripe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "todoist_final_state.json").write_text(
        json.dumps(todoist, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

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
