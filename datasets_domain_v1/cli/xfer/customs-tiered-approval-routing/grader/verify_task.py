#!/usr/bin/env python3
"""Verifier for cli-xfer-customs-tiered-approval-routing.

Reads three final mock states:
  - google_workspace_cli : MOCK_SITE_URL_GOOGLE_WORKSPACE_CLI / MOCK_SITE_URL
  - stripe_cli           : MOCK_SITE_URL_STRIPE_CLI
  - box_cli              : MOCK_SITE_URL_BOX_CLI

Checks that tier-based conditional branching was applied correctly:
  - Tier 1 (Executive): full workflow across all 3 CLIs
  - Tier 2 (Standard): GWS + Stripe + Box (reduced)
  - Tier 3 (Fast-track): GWS only
Over-provisioning and under-provisioning are both failures.
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


# ---------- GWS helpers ----------

def _gws_entities(state: dict[str, Any], entity: str) -> list[dict[str, Any]]:
    raw = (state.get("entities") or {}).get(entity) or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _gws_all_text(items: list[dict[str, Any]]) -> str:
    """Gather all textual content from GWS entities."""
    parts: list[str] = []
    for item in items:
        for key in ("content", "text", "name", "title", "value"):
            val = item.get(key)
            if val:
                parts.append(str(val))
        for block in item.get("blocks") or []:
            parts.append(str(block.get("text") or block.get("content") or ""))
        for cell in item.get("cells") or []:
            parts.append(str(cell.get("value") or ""))
    return "\n".join(parts)


def _gws_extract_sheet_rows(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract per-row data from GWS spreadsheet cells.

    Returns list of {"row_num": int, "text": str} sorted by row number.
    Navigates both ``{db: {spreadsheets: ...}}`` and ``{entities: ...}`` shapes.
    """
    rows_by_num: dict[int, list[str]] = {}

    spreadsheets = (state.get("db") or {}).get("spreadsheets") or state.get("spreadsheets") or {}
    if isinstance(spreadsheets, dict):
        for ss_data in spreadsheets.values():
            if not isinstance(ss_data, dict):
                continue
            for sheet in ss_data.get("sheets") or []:
                cells = sheet.get("cells") or {}
                if not isinstance(cells, dict):
                    continue
                for a1, cell in cells.items():
                    m = re.match(r'^[A-Z]+(\d+)$', a1)
                    if not m:
                        continue
                    rn = int(m.group(1))
                    v = str((cell.get("value") if isinstance(cell, dict) else cell) or "")
                    if v:
                        rows_by_num.setdefault(rn, []).append(v)

    return [{"row_num": rn, "text": " ".join(vals)} for rn, vals in sorted(rows_by_num.items())]


def _gws_sheet_full_text(state: dict[str, Any]) -> str:
    """Build full text from spreadsheet cells (fallback when _gws_entities yields nothing)."""
    rows = _gws_extract_sheet_rows(state)
    return "\n".join(r["text"] for r in rows)


def _gws_slides_full_text(state: dict[str, Any]) -> str:
    """Build full text from presentations (fallback when _gws_entities yields nothing).

    Mirrors the ``{db: {presentations: ...}}`` shape the gws mock actually serves:
    presentations[*] -> {title, slides[*].pageElements[*].shape.text.paragraphs[*].runs[*].content}.
    """
    parts: list[str] = []
    presentations = (state.get("db") or {}).get("presentations") or state.get("presentations") or {}
    pres_iter = presentations.values() if isinstance(presentations, dict) else presentations
    for pres in pres_iter:
        if not isinstance(pres, dict):
            continue
        title = pres.get("title")
        if title:
            parts.append(str(title))
        for slide in pres.get("slides") or []:
            if not isinstance(slide, dict):
                continue
            for el in slide.get("pageElements") or []:
                if not isinstance(el, dict):
                    continue
                text = ((el.get("shape") or {}).get("text") or {})
                for para in text.get("paragraphs") or []:
                    if not isinstance(para, dict):
                        continue
                    for run in para.get("runs") or []:
                        content = run.get("content") if isinstance(run, dict) else None
                        if content:
                            parts.append(str(content))
    return "\n".join(parts)


def _amount_variants(amount: float) -> list[str]:
    """Return multiple string representations of *amount* for flexible matching.

    Covers plain int, two-decimal, and comma-separated forms so that
    "$14,278,683.61" matches as well as "14278683".
    """
    iv = int(amount)
    return [
        str(iv),            # 14278683
        f"{amount:.2f}",    # 14278683.61
        f"{iv:,}",          # 14,278,683
        f"{amount:,.2f}",   # 14,278,683.61
    ]


# ---------- Stripe helpers ----------

def _stripe_objects(state: dict[str, Any], resource: str) -> list[dict[str, Any]]:
    return [o.get("data") or o for o in state.get("objects", []) if o.get("resource") == resource]


# ---------- Box helpers ----------

def _box_entities(state: dict[str, Any], entity: str) -> list[dict[str, Any]]:
    raw = state.get(entity) or state.get("entities", {}).get(entity) or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


# ---------- Main evaluation ----------

def evaluate(exp: dict[str, Any],
             gws: dict[str, Any], stripe: dict[str, Any], box: dict[str, Any],
             gws_err: str, stripe_err: str, box_err: str,
             source_ok: bool, source_reason: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    all_suppliers = exp["qualified_suppliers"]
    tier1_names = set(exp["tier_1_suppliers"])
    tier2_names = set(exp["tier_2_suppliers"])
    tier3_names = set(exp["tier_3_suppliers"])
    all_names = tier1_names | tier2_names | tier3_names

    # -- setup_gate --
    setup_ok = not gws_err and not stripe_err and not box_err
    setup_reason = gws_err or stripe_err or box_err or "ok"
    checks.append(chk("setup_gate", setup_ok, setup_reason))

    # -- source_data_present --
    checks.append(chk("source_data_present", source_ok, source_reason))

    if not setup_ok:
        for cid in ("sheet_all_tiers_present", "slides_tier1_only",
                     "stripe_tier1_correct", "stripe_tier2_correct",
                     "stripe_tier3_absent", "box_routing_correct"):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    # ======== GWS Checks ========

    # Gather all spreadsheet cell text
    gws_sheets = _gws_entities(gws, "sheets") or _gws_entities(gws, "spreadsheets")
    gws_cells = _gws_entities(gws, "cells")
    gws_slides = _gws_entities(gws, "slides")
    gws_slide_elements = _gws_entities(gws, "slideElements") or _gws_entities(gws, "slide_elements")
    gws_presentations = _gws_entities(gws, "presentations")

    # Build full text from sheets/cells for supplier name matching
    sheet_text = _gws_all_text(gws_sheets + gws_cells)
    if not sheet_text.strip():
        sheet_text = _gws_sheet_full_text(gws)
    slide_text = _gws_all_text(gws_slides + gws_slide_elements + gws_presentations)
    if not slide_text.strip():
        slide_text = _gws_slides_full_text(gws)

    # Pre-extract per-row data for row-level tier/amount checks
    sheet_rows = _gws_extract_sheet_rows(gws)

    # -- sheet_all_tiers_present --
    sheet_fail: list[str] = []
    tier_labels = {
        1: ["tier 1", "executive"],
        2: ["tier 2", "standard"],
        3: ["tier 3", "fast-track", "fast track", "fasttrack"],
    }
    for spec in all_suppliers:
        supplier = spec["supplier"]
        if supplier not in sheet_text and _norm(supplier) not in _norm(sheet_text):
            sheet_fail.append(f"{supplier}: not in sheet")
            continue

        # Find rows containing this supplier name (for row-level checks)
        supplier_rows = [r for r in sheet_rows
                         if supplier in r["text"] or _norm(supplier) in _norm(r["text"])]

        # --- Tier label check (row-level when possible, global fallback) ---
        tier = spec["tier"]
        labels = tier_labels.get(tier, [])
        if supplier_rows:
            if not any(lbl in _norm(r["text"]) for r in supplier_rows for lbl in labels):
                sheet_fail.append(f"{supplier}: tier label missing in row")
        else:
            # Fallback: global text (no worse than before)
            if not any(lbl in _norm(sheet_text) for lbl in labels):
                sheet_fail.append(f"{supplier}: tier label missing")

        # --- Amount check (with comma-formatted variants) ---
        variants = _amount_variants(spec["total_amount_usd"])
        if supplier_rows:
            if not any(v in r["text"] for r in supplier_rows for v in variants):
                sheet_fail.append(f"{supplier}: amount missing in row")
        else:
            if not any(v in sheet_text for v in variants):
                sheet_fail.append(f"{supplier}: amount missing")

    missing_count = len(sheet_fail)
    sheet_ok = missing_count == 0
    checks.append(chk("sheet_all_tiers_present", sheet_ok,
                       f"{len(all_names) - missing_count}/{len(all_names)} suppliers in sheet"
                       + (f"; missing: {'; '.join(sheet_fail[:4])}" if sheet_fail else "")))

    # -- slides_tier1_only --
    slides_fail: list[str] = []
    # Check that Tier 1 suppliers have slides
    for name in tier1_names:
        if name not in slide_text and _norm(name) not in _norm(slide_text):
            slides_fail.append(f"Tier1 {name}: no slide found")

    # Check that Tier 2 and Tier 3 suppliers do NOT have slides
    for name in (tier2_names | tier3_names):
        if name in slide_text or _norm(name) in _norm(slide_text):
            slides_fail.append(f"Non-Tier1 {name}: has slide (over-provisioned)")

    # Check slide count is reasonable (should be at least len(tier1))
    if len(gws_slides) > 0 and not slides_fail:
        # Verify we have at least as many slides as tier1 suppliers
        # (may have more if there's a title slide etc.)
        pass

    slides_ok = not slides_fail
    checks.append(chk("slides_tier1_only", slides_ok,
                       "ok" if slides_ok else "; ".join(slides_fail[:6])))

    # ======== Stripe Checks ========

    stripe_customers = _stripe_objects(stripe, "customers")
    stripe_products = _stripe_objects(stripe, "products")
    stripe_invoices = _stripe_objects(stripe, "invoices")
    stripe_payment_intents = _stripe_objects(stripe, "payment_intents")

    # Build customer lookup by name
    cust_by_name: dict[str, dict[str, Any]] = {}
    for cust in stripe_customers:
        name = str(cust.get("name") or "")
        cust_by_name[name] = cust

    # -- stripe_tier1_correct --
    t1_fail: list[str] = []
    for name in tier1_names:
        cust = cust_by_name.get(name)
        if not cust:
            # Try normalized match
            cust = next((c for n, c in cust_by_name.items() if _norm(n) == _norm(name)), None)
        if not cust:
            t1_fail.append(f"{name}: no customer")
            continue

        cust_id = str(cust.get("id") or "")
        spec = next(s for s in all_suppliers if s["supplier"] == name)

        # Check products exist (at least one per HS chapter)
        hs_chapters = spec["unique_hs_chapters"]
        # Products should reference HS chapters in name or description
        relevant_products = [
            p for p in stripe_products
            if any(ch in str(p.get("name") or "") or ch in str(p.get("description") or "")
                   for ch in hs_chapters)
        ]
        if len(relevant_products) < len(hs_chapters):
            t1_fail.append(f"{name}: expected {len(hs_chapters)} products for HS chapters {hs_chapters}, found {len(relevant_products)}")

        # Check invoice exists
        cust_invoices = [
            inv for inv in stripe_invoices
            if str(inv.get("customer") or "") == cust_id
        ]
        if not cust_invoices:
            t1_fail.append(f"{name}: no invoice")

        # Check payment_intent exists
        cust_pis = [
            pi for pi in stripe_payment_intents
            if str(pi.get("customer") or "") == cust_id
        ]
        if not cust_pis:
            t1_fail.append(f"{name}: no payment_intent")

    checks.append(chk("stripe_tier1_correct", not t1_fail,
                       "ok" if not t1_fail else "; ".join(t1_fail[:6])))

    # -- stripe_tier2_correct --
    t2_fail: list[str] = []
    for name in tier2_names:
        cust = cust_by_name.get(name)
        if not cust:
            cust = next((c for n, c in cust_by_name.items() if _norm(n) == _norm(name)), None)
        if not cust:
            t2_fail.append(f"{name}: no customer")
            continue

        cust_id = str(cust.get("id") or "")

        # Check invoice exists
        cust_invoices = [
            inv for inv in stripe_invoices
            if str(inv.get("customer") or "") == cust_id
        ]
        if not cust_invoices:
            t2_fail.append(f"{name}: no invoice")

        # Check NO payment_intent (over-provisioning check)
        cust_pis = [
            pi for pi in stripe_payment_intents
            if str(pi.get("customer") or "") == cust_id
        ]
        if cust_pis:
            t2_fail.append(f"{name}: has payment_intent (over-provisioned)")

    checks.append(chk("stripe_tier2_correct", not t2_fail,
                       "ok" if not t2_fail else "; ".join(t2_fail[:6])))

    # -- stripe_tier3_absent --
    t3_fail: list[str] = []
    for name in tier3_names:
        # Check NO customer exists
        cust = cust_by_name.get(name)
        if not cust:
            cust = next((c for n, c in cust_by_name.items() if _norm(n) == _norm(name)), None)
        if cust:
            t3_fail.append(f"{name}: has Stripe customer (should have none)")

    # Also check no invoices/payment_intents reference Tier 3 names
    for name in tier3_names:
        for inv in stripe_invoices:
            desc = str(inv.get("description") or inv.get("memo") or "")
            if name in desc or _norm(name) in _norm(desc):
                t3_fail.append(f"{name}: referenced in invoice description")
                break

    checks.append(chk("stripe_tier3_absent", not t3_fail,
                       "ok" if not t3_fail else "; ".join(t3_fail[:6])))

    # ======== Box Checks ========

    box_folders = _box_entities(box, "folders")
    box_files = _box_entities(box, "files")
    box_tasks = _box_entities(box, "tasks")
    box_collabs = _box_entities(box, "collaborations")

    # Build folder lookup by name
    folder_by_name: dict[str, dict[str, Any]] = {}
    for folder in box_folders:
        fname = str(folder.get("name") or "")
        folder_by_name[fname] = folder

    box_fail: list[str] = []

    # -- Tier 1 Box: folder + contract + task + collaboration --
    for name in tier1_names:
        folder = folder_by_name.get(name)
        if not folder:
            folder = next((f for fn, f in folder_by_name.items() if _norm(fn) == _norm(name)), None)
        if not folder:
            box_fail.append(f"T1 {name}: no folder")
            continue

        folder_id = str(folder.get("id") or "")

        # Check file uploaded in folder (contract)
        folder_files = [
            f for f in box_files
            if str(f.get("parent_id") or "") == folder_id
        ]
        if not folder_files:
            box_fail.append(f"T1 {name}: no files in folder (need contract)")

        # Check review task exists on a file in this folder
        file_ids_in_folder = {str(f.get("id") or "") for f in folder_files}
        folder_tasks = [
            t for t in box_tasks
            if str(t.get("item_id") or "") in file_ids_in_folder
        ]
        if not folder_tasks:
            box_fail.append(f"T1 {name}: no review task on contract")

        # Check collaborations on the folder
        folder_collabs = [
            c for c in box_collabs
            if str(c.get("item_id") or "") == folder_id
        ]
        if not folder_collabs:
            box_fail.append(f"T1 {name}: no collaboration shares")

    # -- Tier 2 Box: folder + file only (NO tasks, NO collaborations) --
    for name in tier2_names:
        folder = folder_by_name.get(name)
        if not folder:
            folder = next((f for fn, f in folder_by_name.items() if _norm(fn) == _norm(name)), None)
        if not folder:
            box_fail.append(f"T2 {name}: no folder")
            continue

        folder_id = str(folder.get("id") or "")

        # Check file uploaded
        folder_files = [
            f for f in box_files
            if str(f.get("parent_id") or "") == folder_id
        ]
        if not folder_files:
            box_fail.append(f"T2 {name}: no files in folder")

        # Check NO tasks (over-provisioning)
        file_ids_in_folder = {str(f.get("id") or "") for f in folder_files}
        folder_tasks = [
            t for t in box_tasks
            if str(t.get("item_id") or "") in file_ids_in_folder
        ]
        if folder_tasks:
            box_fail.append(f"T2 {name}: has review task (over-provisioned)")

        # Check NO collaborations (over-provisioning)
        folder_collabs = [
            c for c in box_collabs
            if str(c.get("item_id") or "") == folder_id
        ]
        if folder_collabs:
            box_fail.append(f"T2 {name}: has collaboration (over-provisioned)")

    # -- Tier 3 Box: NOTHING --
    for name in tier3_names:
        folder = folder_by_name.get(name)
        if not folder:
            folder = next((f for fn, f in folder_by_name.items() if _norm(fn) == _norm(name)), None)
        if folder:
            box_fail.append(f"T3 {name}: has Box folder (should have none)")

    checks.append(chk("box_routing_correct", not box_fail,
                       "ok" if not box_fail else "; ".join(box_fail[:8])))

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
        source_min = int(exp.get("source_min_rows", 5000))
        source_ok = len(csv_files) >= 2 and total_rows >= source_min
        source_reason = f"csv_files={len(csv_files)}, total_rows={total_rows}, min={source_min}"
    except Exception as exc:  # noqa: BLE001
        source_ok = False
        source_reason = f"source parse failed: {exc}"

    gws, gws_err = _read_state(("MOCK_SITE_URL_GOOGLE_WORKSPACE_CLI", "MOCK_SITE_URL"), token)
    stripe, stripe_err = _read_state(("MOCK_SITE_URL_STRIPE_CLI",), token, "/__bench/state")
    box, box_err = _read_state(("MOCK_SITE_URL_BOX_CLI",), token, "/__bench/state")

    checks = evaluate(exp, gws, stripe, box, gws_err, stripe_err, box_err,
                       source_ok, source_reason)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "gws_final_state.json").write_text(
        json.dumps(gws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "stripe_final_state.json").write_text(
        json.dumps(stripe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "box_final_state.json").write_text(
        json.dumps(box, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

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
