"""Deterministic state verifier for gws-supplier-quote-consolidation.

Checks:
  1. "Award Decisions" sheet exists with correct structure and data
  2. Per-SKU award correctness (supplier, price, rationale) from expected_answer.json
  3. Presentation pres-sourcing-review-303 has a 7th slide with award summary
  4. Audit Trail has a new row logging the award finalization
"""
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any


def fetch_state(mock_url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{mock_url}/api/state",
        headers={"X-Mock-Verifier-Token": token},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def get_cell(cells: dict, col: str, row: int) -> Any:
    a1 = f"{col}{row}"
    cell = cells.get(a1)
    if cell is None:
        return None
    return cell.get("value")


def find_sheet(ss: dict, title: str) -> dict | None:
    for sh in ss.get("sheets", []):
        if sh.get("properties", {}).get("title") == title:
            return sh
    return None


def norm(v: Any) -> str:
    return " ".join(str(v or "").strip().lower().split())


def flatten_slide_text(slide: dict) -> str:
    parts = []
    for el in slide.get("pageElements", []):
        shape = el.get("shape")
        if shape and shape.get("text"):
            for p in shape["text"].get("paragraphs", []):
                for r in p.get("runs", []):
                    parts.append(r.get("content", ""))
    return "\n".join(parts)


def load_expected_awards(task_dir: str) -> list[dict] | None:
    """Load expected awards from private/expected_answer.json if available."""
    ea_path = Path(task_dir) / "private" / "expected_answer.json"
    if not ea_path.exists():
        return None
    try:
        data = json.loads(ea_path.read_text())
        awards = data.get("awards")
        if awards and isinstance(awards, list):
            return awards
        return None
    except (json.JSONDecodeError, KeyError, OSError):
        return None


def run_checks(state: dict, expected_awards: list[dict] | None = None) -> list[dict]:
    checks = []
    db = state.get("db", {})
    ss = db.get("spreadsheets", {}).get("sheet-supplier-eval-003")
    pres = db.get("presentations", {}).get("pres-sourcing-review-303")

    if not ss:
        return [{"name": "supplier_spreadsheet_exists", "passed": False, "reason": "sheet-supplier-eval-003 not found"}]
    checks.append({"name": "supplier_spreadsheet_exists", "passed": True, "reason": "found"})

    # --- Check 1: Award Decisions sheet ---
    ad = find_sheet(ss, "Award Decisions")
    ad_cells: dict = ad.get("cells", {}) if ad else {}
    checks.append({
        "name": "award_decisions_sheet_exists",
        "passed": ad is not None,
        "reason": "sheet found" if ad else "'Award Decisions' sheet not found",
    })

    if ad:

        expected_headers = ["SKU", "Product", "Award Supplier", "Award Price (USD)",
                            "Runner-Up Supplier", "Runner-Up Price (USD)",
                            "Savings vs Runner-Up (USD)", "Decision Rationale"]
        headers_ok = True
        col_letters = "ABCDEFGH"
        mismatch_col = mismatch_got = mismatch_exp = ""
        for i, h in enumerate(expected_headers):
            got = get_cell(ad_cells, col_letters[i], 1)
            if norm(got) != norm(h):
                headers_ok = False
                mismatch_col, mismatch_got, mismatch_exp = col_letters[i], str(got), h
                break
        checks.append({
            "name": "award_headers_correct",
            "passed": headers_ok,
            "reason": "all 8 headers match" if headers_ok else f"header mismatch at col {mismatch_col}: '{mismatch_got}' vs '{mismatch_exp}'",
        })

        data_rows = 0
        for r in range(2, 100):
            if get_cell(ad_cells, "A", r):
                data_rows += 1

        expected_row_count = len(expected_awards) if expected_awards else 10
        checks.append({
            "name": "award_has_data_rows",
            "passed": data_rows >= expected_row_count,
            "reason": f"{data_rows} award rows (need >={expected_row_count})",
        })

        # --- Per-SKU award correctness checks ---
        if expected_awards:
            # Build lookup of agent's Award Decisions rows by SKU
            agent_awards: dict[str, dict] = {}
            for r in range(2, 100):
                sku = get_cell(ad_cells, "A", r)
                if not sku:
                    continue
                agent_awards[norm(sku)] = {
                    "row": r,
                    "sku": sku,
                    "product": get_cell(ad_cells, "B", r),
                    "award_supplier": get_cell(ad_cells, "C", r),
                    "award_price": get_cell(ad_cells, "D", r),
                    "runner_up_supplier": get_cell(ad_cells, "E", r),
                    "runner_up_price": get_cell(ad_cells, "F", r),
                    "savings": get_cell(ad_cells, "G", r),
                    "rationale": get_cell(ad_cells, "H", r),
                }

            for ea in expected_awards:
                sku = ea["sku"]
                sku_key = norm(sku)
                check_name = f"award_correct::{sku}"

                agent_row = agent_awards.get(sku_key)
                if not agent_row:
                    checks.append({
                        "name": check_name,
                        "passed": False,
                        "reason": f"SKU {sku} not found in Award Decisions sheet",
                    })
                    continue

                errors: list[str] = []

                # Check award supplier
                if norm(agent_row["award_supplier"]) != norm(ea["award_supplier"]):
                    errors.append(
                        f"supplier: got '{agent_row['award_supplier']}', "
                        f"expected '{ea['award_supplier']}'"
                    )

                # Check award price (within 0.01 tolerance). Tolerate natural
                # sheet-cell formats: $/¥/commas/USD/CNY/%.
                def _money(v) -> float | None:
                    if v is None:
                        return None
                    s = str(v).strip()
                    if not s:
                        return None
                    cleaned = s.replace("$", "").replace("¥", "").replace(",", "").strip()
                    for suffix in ("USD", "CNY", "%"):
                        if cleaned.upper().endswith(suffix):
                            cleaned = cleaned[: -len(suffix)].strip()
                    try:
                        return float(cleaned)
                    except (TypeError, ValueError):
                        return None

                agent_price = _money(agent_row["award_price"])
                expected_price = _money(ea["award_price"])
                if expected_price is None:
                    errors.append(f"price: expected_answer has unparseable {ea['award_price']!r}")
                elif agent_price is None or abs(agent_price - expected_price) > 0.01:
                    errors.append(
                        f"price: got '{agent_row['award_price']}', expected {expected_price}"
                    )

                # Check rationale
                if norm(agent_row["rationale"]) != norm(ea["rationale"]):
                    errors.append(
                        f"rationale: got '{agent_row['rationale']}', "
                        f"expected '{ea['rationale']}'"
                    )

                if errors:
                    checks.append({
                        "name": check_name,
                        "passed": False,
                        "reason": "; ".join(errors),
                    })
                else:
                    checks.append({
                        "name": check_name,
                        "passed": True,
                        "reason": f"{ea['award_supplier']} at ${float(ea['award_price']):.2f}",
                    })

    # --- Award suppliers must come from Supplier Overview (all rows) ---
    if ad:
        so = find_sheet(ss, "Supplier Overview")
        if so:
            so_cells = so.get("cells", {})
            known_suppliers = set()
            for r in range(2, 100):
                name = get_cell(so_cells, "A", r)
                if name:
                    known_suppliers.add(norm(name))

            award_from_overview = True
            bad_supplier = ""
            for r in range(2, 100):
                supplier = get_cell(ad_cells, "C", r)
                if not supplier:
                    continue
                if norm(supplier) not in known_suppliers:
                    award_from_overview = False
                    bad_supplier = str(supplier)
                    break
            checks.append({
                "name": "award_suppliers_from_overview",
                "passed": award_from_overview,
                "reason": "all award suppliers found in Supplier Overview" if award_from_overview else f"'{bad_supplier}' not in Supplier Overview",
            })

            # Cross-check: disqualified suppliers (rating < 3.5) must NOT appear as winners
            disqualified = set()
            for r in range(2, 100):
                name = get_cell(so_cells, "A", r)
                rating = get_cell(so_cells, "I", r)
                if name and rating is not None:
                    try:
                        if float(rating) < 3.5:
                            disqualified.add(norm(name))
                    except (ValueError, TypeError):
                        pass

            no_disqualified_winner = True
            dq_winner = ""
            for r in range(2, 100):
                supplier = get_cell(ad_cells, "C", r)
                if not supplier:
                    continue
                if norm(supplier) in disqualified:
                    no_disqualified_winner = False
                    dq_winner = str(supplier)
                    break
            checks.append({
                "name": "no_disqualified_supplier_awarded",
                "passed": no_disqualified_winner,
                "reason": "no disqualified suppliers awarded" if no_disqualified_winner else f"'{dq_winner}' has rating < 3.5 but was awarded",
            })

    # --- Check 2: Presentation updated with award slide ---
    if pres:
        slides = pres.get("slides", [])
        checks.append({
            "name": "presentation_has_7_slides",
            "passed": len(slides) >= 7,
            "reason": f"{len(slides)} slides (need ≥7)" ,
        })

        if len(slides) >= 7:
            award_slide_found = False
            award_slide_text = ""
            for s in slides:
                t = flatten_slide_text(s)
                if "award" in t.lower() and "summary" in t.lower():
                    award_slide_found = True
                    award_slide_text = t
                    break
            checks.append({
                "name": "award_summary_slide_exists",
                "passed": award_slide_found,
                "reason": "slide with 'Award Summary' found" if award_slide_found else "no slide contains 'Award Summary'",
            })

            if award_slide_found:
                has_sku_lines = bool(re.search(r"[A-Z]+-[A-Z]+-", award_slide_text))
                checks.append({
                    "name": "award_slide_has_sku_lines",
                    "passed": has_sku_lines,
                    "reason": "SKU entries found in slide body" if has_sku_lines else "no SKU patterns in slide text",
                })
    else:
        checks.append({"name": "presentation_exists", "passed": False, "reason": "pres-sourcing-review-303 not found"})

    # --- Check 3: Audit trail entry ---
    at = find_sheet(ss, "Audit Trail")
    if at:
        at_cells = at.get("cells", {})
        audit_found = False
        audit_row = 0
        for r in range(2, 100):
            user = get_cell(at_cells, "B", r)
            change = get_cell(at_cells, "C", r)
            if user and "sourcing-bot" in str(user).lower() and change and "award" in str(change).lower():
                audit_found = True
                audit_row = r
                break
        checks.append({
            "name": "audit_trail_entry",
            "passed": audit_found,
            "reason": "sourcing-bot award finalization logged" if audit_found else "no audit entry from sourcing-bot@ about awards",
        })

        if audit_found:
            new_val = str(get_cell(at_cells, "E", audit_row) or "")
            has_correct_savings = "10.77" in new_val
            checks.append({
                "name": "audit_has_savings_total",
                "passed": has_correct_savings,
                "reason": f"new value contains $10.77: {new_val}" if has_correct_savings else f"expected '10.77' in new value, got: {new_val}",
            })
    else:
        checks.append({"name": "audit_trail_exists", "passed": False, "reason": "Audit Trail sheet not found"})

    return checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    parser.add_argument("--mock-url", default="")
    args = parser.parse_args()

    mock_url = args.mock_url or os.environ.get("MOCK_SITE_URL", "")
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier")

    if not mock_url:
        reward = {
            "schema_version": "2.0",
            "passed": False,
            "checks_passed": 0,
            "checks_total": 1,
            "checks_breakdown": [{"name": "mock_url_missing", "passed": False, "reason": "MOCK_SITE_URL not provided"}],
        }
        Path(args.reward_json).write_text(json.dumps(reward, indent=2))
        return

    try:
        state = fetch_state(mock_url, token)
    except Exception as e:
        reward = {
            "schema_version": "2.0",
            "passed": False,
            "checks_passed": 0,
            "checks_total": 1,
            "checks_breakdown": [{"name": "fetch_state_failed", "passed": False, "reason": str(e)}],
        }
        Path(args.reward_json).write_text(json.dumps(reward, indent=2))
        return

    expected_awards = load_expected_awards(args.task_dir)
    checks = run_checks(state, expected_awards)
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)

    reward = {
        "schema_version": "2.0",
        "passed": passed == total,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
    }

    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    Path(args.reward_json).write_text(json.dumps(reward, indent=2))
    print(f"Checks: {passed}/{total} passed")
    for c in checks:
        mark = "PASS" if c["passed"] else "FAIL"
        print(f"  {mark} {c['name']}: {c['reason']}")


if __name__ == "__main__":
    main()
