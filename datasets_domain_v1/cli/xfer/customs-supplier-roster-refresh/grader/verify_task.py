#!/usr/bin/env python3
"""Verifier for cli-xfer-customs-supplier-roster-refresh.

Reads three final mock states:
  - jira_cli   : MOCK_SITE_URL_JIRA_CLI/api/state
  - notion_cli : MOCK_SITE_URL_NOTION_CLI/api/state
  - box_cli    : MOCK_SITE_URL_BOX_CLI/api/state

Scoring checks whether the agent correctly performed an incremental merge
of an old supplier roster with new customs CSV data, classifying suppliers
as overlap/new-only/old-only and applying per-field source rules.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
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
# Jira helpers
# ---------------------------------------------------------------------------

def _jira_issues(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract all issues from Jira mock state."""
    issues: list[dict[str, Any]] = []
    for proj in state.get("projects", []):
        for issue in proj.get("issues", []):
            issues.append(issue)
    # Also check top-level issues key
    if isinstance(state.get("issues"), list):
        issues.extend(state["issues"])
    elif isinstance(state.get("issues"), dict):
        issues.extend(state["issues"].values())
    return issues


def _jira_comments_for_issue(all_comments: list[dict[str, Any]], issue_key: str) -> list[dict[str, Any]]:
    """Get comments for a specific issue from the top-level comments list."""
    return [c for c in all_comments if c.get("issue_key") == issue_key]


def _jira_find_issue(issues: list[dict[str, Any]], supplier: str,
                     all_comments: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    """Find a Jira issue that references this supplier."""
    if all_comments is None:
        all_comments = []
    sn = _norm(supplier)
    for issue in issues:
        text = _norm(str(issue.get("summary", "")) + " " + str(issue.get("description", "")))
        if sn in text:
            return issue
        # Check comments from top-level comments list
        issue_key = issue.get("key", "")
        for c in _jira_comments_for_issue(all_comments, issue_key):
            if sn in _norm(str(c.get("body", ""))):
                return issue
    return None


def _issue_full_text(issue: dict[str, Any],
                     all_comments: list[dict[str, Any]] | None = None) -> str:
    """Combine summary + description + comment bodies."""
    if all_comments is None:
        all_comments = []
    parts = [str(issue.get("summary", "")), str(issue.get("description", ""))]
    issue_key = issue.get("key", "")
    for c in _jira_comments_for_issue(all_comments, issue_key):
        parts.append(str(c.get("body", "")))
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Notion helpers
# ---------------------------------------------------------------------------

def _notion_pages(state: dict[str, Any]) -> list[dict[str, Any]]:
    # Notion mock nests pages under state["entities"]["pages"] as a dict keyed by page ID
    pages = state.get("entities", {}).get("pages", {})
    if not pages:
        # Fallback: check top-level for forward-compat
        pages = state.get("pages", [])
    if isinstance(pages, dict):
        return list(pages.values())
    return list(pages)



def _notion_prop_text(v: Any) -> str:
    """Searchable text of a Notion property value.

    Handles the mock's actual shapes: dict (title/rich_text/value), list of
    rich-text dicts (e.g. the `title` property), and plain scalars (e.g.
    `"Supplier": "ACME CO LTD"`, `"Total Amount USD": 110443.55`).
    """
    if isinstance(v, dict):
        val = v.get("title", v.get("rich_text", v.get("value", "")))
        if isinstance(val, list):
            val = " ".join(
                str(x.get("text", {}).get("content", x.get("plain_text", "")))
                if isinstance(x, dict) else str(x)
                for x in val)
        return str(val)
    if isinstance(v, list):
        return " ".join(
            str(x.get("text", {}).get("content", x.get("plain_text", "")))
            if isinstance(x, dict) else str(x)
            for x in v)
    return str(v)


def _notion_find_pages(pages: list[dict[str, Any]], supplier: str) -> list[dict[str, Any]]:
    """Return ALL pages matching this supplier, strongest matches first.

    Title/properties matches are preferred over content mentions: an index
    page whose content lists every supplier would otherwise shadow the
    per-supplier pages. Callers should accept the check if ANY returned
    page satisfies it.
    """
    sn = _norm(supplier)
    strong: list[dict[str, Any]] = []
    weak: list[dict[str, Any]] = []
    for p in pages:
        # Check title/name
        title = _norm(str(p.get("title", "")) + " " + str(p.get("name", "")))
        if sn in title:
            strong.append(p)
            continue
        # Check properties (any value shape: dict / list / plain scalar)
        prop_match = False
        props = p.get("properties", {})
        if isinstance(props, dict):
            for v in props.values():
                if sn in _norm(_notion_prop_text(v)):
                    prop_match = True
                    break
        if prop_match:
            strong.append(p)
            continue
        # Check content (weak: index pages mentioning many suppliers land here)
        content = _norm(str(p.get("content", "")))
        if sn in content:
            weak.append(p)
    return strong + weak


def _notion_find_page(pages: list[dict[str, Any]], supplier: str) -> dict[str, Any] | None:
    found = _notion_find_pages(pages, supplier)
    return found[0] if found else None


def _notion_page_text(page: dict[str, Any]) -> str:
    """Get all searchable text from a Notion page."""
    parts: list[str] = []
    parts.append(str(page.get("title", "")))
    parts.append(str(page.get("name", "")))
    parts.append(str(page.get("content", "")))
    props = page.get("properties", {})
    if isinstance(props, dict):
        for v in props.values():
            if isinstance(v, dict):
                val = v.get("title", v.get("rich_text", v.get("value", v.get("number", ""))))
                if isinstance(val, list):
                    val = " ".join(str(x.get("text", {}).get("content", x.get("plain_text", ""))) for x in val)
                parts.append(str(val))
            else:
                parts.append(str(v))
    return "\n".join(parts)


def _page_has_value(page: dict[str, Any], value: Any, tolerance: float = 0.0) -> bool:
    """Check if a Notion page contains a specific value anywhere."""
    text = _notion_page_text(page)
    sv = str(value)
    if sv in text:
        return True
    # For numbers, try float comparison
    if isinstance(value, (int, float)):
        # Look for the number in properties
        props = page.get("properties", {})
        if isinstance(props, dict):
            for v in props.values():
                if isinstance(v, dict):
                    num = v.get("number", v.get("value"))
                    if num is not None:
                        try:
                            if abs(float(num) - float(value)) <= max(tolerance, abs(float(value) * 0.01)):
                                return True
                        except (ValueError, TypeError):
                            pass
                elif isinstance(v, (int, float)):
                    try:
                        if abs(float(v) - float(value)) <= max(tolerance, abs(float(value) * 0.01)):
                            return True
                    except (ValueError, TypeError):
                        pass
    return False


# ---------------------------------------------------------------------------
# Box helpers
# ---------------------------------------------------------------------------

def _box_folders(state: dict[str, Any]) -> list[dict[str, Any]]:
    folders = state.get("folders", [])
    if isinstance(folders, dict):
        return list(folders.values())
    return list(folders)


def _box_files(state: dict[str, Any]) -> list[dict[str, Any]]:
    files = state.get("files", [])
    if isinstance(files, dict):
        return list(files.values())
    return list(files)


def _box_find_folder(folders: list[dict[str, Any]], name_fragment: str) -> dict[str, Any] | None:
    nf = _norm(name_fragment)
    for f in folders:
        if nf in _norm(str(f.get("name", ""))):
            return f
    return None



# ---------------------------------------------------------------------------
# Main evaluation
# ---------------------------------------------------------------------------

def evaluate(
    exp: dict[str, Any],
    jira: dict[str, Any], notion: dict[str, Any], box: dict[str, Any],
    jira_err: str, notion_err: str, box_err: str,
    source_ok: bool, source_reason: str,
) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    overlap = exp["overlap_suppliers"]
    new_only = exp["new_only_suppliers"]
    old_only = exp["old_only_suppliers"]
    all_suppliers = overlap + new_only + old_only

    # -- setup_gate --
    issues = _jira_issues(jira) if not jira_err else []
    jira_comments: list[dict[str, Any]] = jira.get("comments", []) if not jira_err else []
    pages = _notion_pages(notion) if not notion_err else []
    folders = _box_folders(box) if not box_err else []

    setup_ok = not jira_err and not notion_err and not box_err
    setup_reason = jira_err or notion_err or box_err or "ok"
    checks.append(chk("setup_gate", setup_ok, setup_reason))

    # -- source_data_present --
    checks.append(chk("source_data_present", source_ok, source_reason))

    if not setup_ok:
        for cid in ("jira_overlap_correct", "jira_new_suppliers_correct",
                     "jira_legacy_correct", "notion_database_correct",
                     "box_folder_structure", "merge_field_accuracy"):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    # -- jira_overlap_correct --
    overlap_fail: list[str] = []
    for spec in overlap:
        supplier = spec["supplier"]
        issue = _jira_find_issue(issues, supplier, jira_comments)
        if not issue:
            overlap_fail.append(f"{supplier}: issue missing")
            continue

        full_text = _issue_full_text(issue, jira_comments)
        labels = {_norm(l) for l in (issue.get("labels") or [])}

        # Check label
        if "updated" not in labels:
            overlap_fail.append(f"{supplier}: missing 'updated' label (has {sorted(labels)})")

        # Check CSV-derived amount is referenced (not old roster amount)
        csv_amt = spec["csv_fields"]["total_amount_usd"]
        csv_amt_str = str(csv_amt)
        # Also accept integer form if it's a round number
        csv_amt_int = str(int(csv_amt)) if csv_amt == int(csv_amt) else ""
        if csv_amt_str not in full_text and csv_amt_int not in full_text:
            # Try with 2 decimal places
            csv_amt_2d = f"{csv_amt:.2f}"
            if csv_amt_2d not in full_text:
                overlap_fail.append(f"{supplier}: CSV amount {csv_amt} not found in issue")

        # Check roster contract_id is preserved
        ctr = spec["roster_fields"]["contract_id"]
        if ctr not in full_text:
            overlap_fail.append(f"{supplier}: roster contract_id {ctr!r} not found")

        # Check CSV shipment count
        csv_ships = spec["csv_fields"]["shipment_count"]
        if str(csv_ships) not in full_text:
            overlap_fail.append(f"{supplier}: CSV shipment_count {csv_ships} not found")

    checks.append(chk("jira_overlap_correct", not overlap_fail,
                       "ok" if not overlap_fail else "; ".join(overlap_fail[:6])))

    # -- jira_new_suppliers_correct --
    new_fail: list[str] = []
    for spec in new_only:
        supplier = spec["supplier"]
        issue = _jira_find_issue(issues, supplier, jira_comments)
        if not issue:
            new_fail.append(f"{supplier}: issue missing")
            continue

        full_text = _issue_full_text(issue, jira_comments)
        labels = {_norm(l) for l in (issue.get("labels") or [])}

        if "new" not in labels:
            new_fail.append(f"{supplier}: missing 'new' label")

        # Check CSV amount
        csv_amt = spec["csv_fields"]["total_amount_usd"]
        csv_amt_str = str(csv_amt)
        csv_amt_int = str(int(csv_amt)) if csv_amt == int(csv_amt) else ""
        csv_amt_2d = f"{csv_amt:.2f}"
        if csv_amt_str not in full_text and csv_amt_int not in full_text and csv_amt_2d not in full_text:
            new_fail.append(f"{supplier}: CSV amount {csv_amt} not found")

        # Check default fields
        defaults = spec["default_fields"]
        if _norm(defaults["quality_rating"]) not in _norm(full_text):
            new_fail.append(f"{supplier}: default quality_rating 'Pending' not found")

        if str(defaults["payment_terms_days"]) not in full_text:
            new_fail.append(f"{supplier}: default payment_terms 30 not found")

    checks.append(chk("jira_new_suppliers_correct", not new_fail,
                       "ok" if not new_fail else "; ".join(new_fail[:6])))

    # -- jira_legacy_correct --
    legacy_fail: list[str] = []
    for spec in old_only:
        supplier = spec["supplier"]
        issue = _jira_find_issue(issues, supplier, jira_comments)
        if not issue:
            legacy_fail.append(f"{supplier}: issue missing")
            continue

        full_text = _issue_full_text(issue, jira_comments)
        labels = {_norm(l) for l in (issue.get("labels") or [])}

        if "legacy-active" not in labels:
            legacy_fail.append(f"{supplier}: missing 'legacy-active' label")

        # Check roster data is preserved
        roster = spec["roster_fields"]
        ctr = roster["contract_id"]
        if ctr not in full_text:
            legacy_fail.append(f"{supplier}: roster contract_id {ctr!r} not found")

        # Check roster amount (not replaced with 0 or new data)
        roster_amt = roster["total_amount_usd"]
        roster_amt_str = str(roster_amt)
        roster_amt_int = str(int(roster_amt)) if roster_amt == int(roster_amt) else ""
        roster_amt_2d = f"{roster_amt:.2f}"
        if roster_amt_str not in full_text and roster_amt_int not in full_text and roster_amt_2d not in full_text:
            legacy_fail.append(f"{supplier}: roster amount {roster_amt} not found")

    checks.append(chk("jira_legacy_correct", not legacy_fail,
                       "ok" if not legacy_fail else "; ".join(legacy_fail[:6])))

    # -- notion_database_correct --
    notion_fail: list[str] = []
    for spec in all_suppliers:
        supplier = spec["supplier"]
        cand_pages = _notion_find_pages(pages, supplier)
        if not cand_pages:
            notion_fail.append(f"{supplier}: page missing")
            continue

        # Expected merge category and amount from the correct source
        cat = spec["merge_category"]
        if cat == "updated":
            amt = spec["csv_fields"]["total_amount_usd"]
        elif cat == "new":
            amt = spec["csv_fields"]["total_amount_usd"]
        else:  # legacy
            amt = spec["roster_fields"]["total_amount_usd"]

        # Accept if ANY matching page satisfies category + amount (an index
        # page mentioning every supplier must not shadow per-supplier pages).
        best_missing: list[str] | None = None
        for page in cand_pages:
            page_text = _notion_page_text(page)
            missing: list[str] = []

            if _norm(cat) not in _norm(page_text):
                missing.append(f"merge_category '{cat}' not found")

            amt_ok = _page_has_value(page, amt)
            if not amt_ok:
                amt_str = str(amt)
                amt_2d = f"{amt:.2f}"
                amt_int = str(int(amt)) if amt == int(amt) else ""
                amt_ok = (amt_str in page_text or amt_2d in page_text
                          or (amt_int and amt_int in page_text))
            if not amt_ok:
                missing.append(f"amount {amt} not found in page")

            if not missing:
                best_missing = None
                break
            if best_missing is None or len(missing) < len(best_missing):
                best_missing = missing

        if best_missing:
            for msg in best_missing:
                notion_fail.append(f"{supplier}: {msg}")

    notion_ok = not notion_fail
    checks.append(chk("notion_database_correct", notion_ok,
                       "ok" if notion_ok else "; ".join(notion_fail[:6])))

    # -- box_folder_structure --
    box_fail: list[str] = []

    # Find root folder
    root = _box_find_folder(folders, "q1-2026") or _box_find_folder(folders, "roster") or _box_find_folder(folders, "refresh")
    if not root:
        box_fail.append("root folder (Q1-2026-Roster-Refresh or similar) missing")
    else:
        root_id = str(root.get("id", ""))

        # Find category subfolders
        updated_folder = None
        new_folder = None
        legacy_folder = None

        for f in folders:
            pid = str(f.get("parent_id", f.get("parent", {}).get("id", "")))
            fname = _norm(str(f.get("name", "")))
            if pid == root_id:
                if "update" in fname:
                    updated_folder = f
                elif "new" in fname:
                    new_folder = f
                elif "legacy" in fname:
                    legacy_folder = f

        if not updated_folder:
            box_fail.append("'Updated' subfolder missing")
        if not new_folder:
            box_fail.append("'New' subfolder missing")
        if not legacy_folder:
            box_fail.append("'Legacy' subfolder missing")

        all_files = _box_files(box)

        # Check that overlap suppliers have content in Updated folder
        if updated_folder:
            upd_id = str(updated_folder.get("id", ""))
            upd_files = [f for f in all_files if str(f.get("parent_id", f.get("parent", {}).get("id", ""))) == upd_id]
            # Also check sub-sub-folders
            upd_subfolders = [f for f in folders if str(f.get("parent_id", f.get("parent", {}).get("id", ""))) == upd_id]
            upd_content_count = len(upd_files) + len(upd_subfolders)
            if upd_content_count < len(overlap):
                box_fail.append(f"Updated folder: expected {len(overlap)}+ items, got {upd_content_count}")

        # Check new folder
        if new_folder:
            new_id = str(new_folder.get("id", ""))
            new_files = [f for f in all_files if str(f.get("parent_id", f.get("parent", {}).get("id", ""))) == new_id]
            new_subfolders = [f for f in folders if str(f.get("parent_id", f.get("parent", {}).get("id", ""))) == new_id]
            new_content_count = len(new_files) + len(new_subfolders)
            if new_content_count < len(new_only):
                box_fail.append(f"New folder: expected {len(new_only)}+ items, got {new_content_count}")

        # Check legacy folder
        if legacy_folder:
            leg_id = str(legacy_folder.get("id", ""))
            leg_files = [f for f in all_files if str(f.get("parent_id", f.get("parent", {}).get("id", ""))) == leg_id]
            leg_subfolders = [f for f in folders if str(f.get("parent_id", f.get("parent", {}).get("id", ""))) == leg_id]
            leg_content_count = len(leg_files) + len(leg_subfolders)
            if leg_content_count < len(old_only):
                box_fail.append(f"Legacy folder: expected {len(old_only)}+ items, got {leg_content_count}")

    checks.append(chk("box_folder_structure", not box_fail,
                       "ok" if not box_fail else "; ".join(box_fail[:6])))

    # -- merge_field_accuracy (spot checks) --
    spot_fail: list[str] = []
    spot_checks = exp.get("merge_field_spot_checks", [])

    for sc in spot_checks:
        supplier = sc["supplier"]
        field = sc["field"]
        expected = sc["expected_value"]
        source = sc["expected_source"]

        # Check across all systems — at least one must have the correct value
        found_correct = False

        # Check Jira
        issue = _jira_find_issue(issues, supplier, jira_comments)
        if issue:
            full_text = _issue_full_text(issue, jira_comments)
            ev_str = str(expected)
            if ev_str in full_text:
                found_correct = True
            elif isinstance(expected, (int, float)):
                ev_2d = f"{float(expected):.2f}"
                ev_int = str(int(expected)) if expected == int(expected) else ""
                if ev_2d in full_text or (ev_int and ev_int in full_text):
                    found_correct = True

        # Check Notion — any matching page may carry the correct value
        # (same shadowing resolution as notion_database_correct)
        if not found_correct:
            for page in _notion_find_pages(pages, supplier):
                page_text = _notion_page_text(page)
                ev_str = str(expected)
                if ev_str in page_text:
                    found_correct = True
                elif isinstance(expected, (int, float)):
                    if _page_has_value(page, expected):
                        found_correct = True
                if found_correct:
                    break

        if not found_correct:
            # Check if the WRONG value is present (from wrong source)
            wrong = sc.get("wrong_value_from_roster")
            wrong_present = False
            if wrong is not None and issue:
                ft = _issue_full_text(issue, jira_comments)
                if str(wrong) in ft:
                    wrong_present = True
            detail = f" (wrong source value {wrong} found instead)" if wrong_present else ""
            spot_fail.append(f"{supplier}.{field}: expected {expected} ({source}){detail}")

    spot_ok = len(spot_fail) <= 1  # Allow 1 miss for tolerance
    checks.append(chk("merge_field_accuracy", spot_ok,
                       "ok" if not spot_fail else "; ".join(spot_fail[:6])))

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

    jira, jira_err = _read_state(("MOCK_SITE_URL_JIRA_CLI",), token, "/__bench/state")
    notion, notion_err = _read_state(("MOCK_SITE_URL_NOTION_CLI",), token)
    box, box_err = _read_state(("MOCK_SITE_URL_BOX_CLI",), token, "/__bench/state")

    checks = evaluate(exp, jira, notion, box, jira_err, notion_err, box_err,
                       source_ok, source_reason)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "jira_final_state.json").write_text(
        json.dumps(jira, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "notion_final_state.json").write_text(
        json.dumps(notion, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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
