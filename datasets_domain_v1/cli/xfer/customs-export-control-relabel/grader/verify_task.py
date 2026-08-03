#!/usr/bin/env python3
"""Verifier for cli-xfer-customs-export-control-relabel.

Reads three final mock states:
  - jira_cli    : MOCK_SITE_URL_JIRA_CLI/api/state
  - todoist_cli : MOCK_SITE_URL_TODOIST_CLI/api/state
  - notion_cli  : MOCK_SITE_URL_NOTION_CLI/api/state

Scoring checks that the agent correctly classified battery export suppliers
as RESTRICTED or EXEMPT per the export control policy, and created records
in the correct systems only for the correct supplier sets.
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
    """Normalize a value to a lowercase, whitespace-collapsed string."""
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
    return {
        "id": cid,
        "passed": bool(ok),
        "reason": str(reason)[:700],
        "check_type": "deterministic_exact",
    }


# ---------------------------------------------------------------------------
# Jira helpers
# ---------------------------------------------------------------------------

def _jira_issues(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract issues from Jira mock state.

    Jira CLI mock ``/__bench/state`` returns issues at the top level
    (``state["issues"]``), not nested under ``state["entities"]``.
    """
    raw = state.get("issues") or state.get("entities", {}).get("issues") or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _jira_issue_matches_supplier(issue: dict[str, Any], supplier: str) -> bool:
    """Check if a Jira issue is about a specific supplier."""
    summary = str(issue.get("summary") or issue.get("fields", {}).get("summary") or "")
    description = str(issue.get("description") or issue.get("fields", {}).get("description") or "")
    return _norm(supplier) in _norm(summary) or _norm(supplier) in _norm(description)


def _jira_get_priority(issue: dict[str, Any]) -> str:
    """Extract priority from Jira issue.

    Jira CLI mock state uses ``priority_name`` (SQL JOIN alias), not a
    nested ``priority`` dict.  Fall through to ``priority`` for compat.
    """
    fields = issue.get("fields") or issue
    # Prefer the denormalised name the mock actually returns
    pn = fields.get("priority_name")
    if pn:
        return str(pn).strip()
    p = fields.get("priority")
    if isinstance(p, dict):
        return str(p.get("name") or "").strip()
    return str(p or "").strip()


def _jira_get_labels(issue: dict[str, Any]) -> set[str]:
    """Extract labels from Jira issue."""
    fields = issue.get("fields") or issue
    labels = fields.get("labels") or []
    if isinstance(labels, str):
        labels = [labels]
    return {_norm(l) for l in labels}


def _jira_get_assignee(issue: dict[str, Any]) -> str:
    """Extract assignee from Jira issue."""
    fields = issue.get("fields") or issue
    a = fields.get("assignee")
    if isinstance(a, dict):
        return str(a.get("displayName") or a.get("name") or a.get("accountId") or "")
    return str(a or "")


# ---------------------------------------------------------------------------
# Todoist helpers
# ---------------------------------------------------------------------------

def _todoist_user_to_api_priority(priority: int) -> int:
    """Convert user-facing priority (1=highest) to API priority (4=highest)."""
    return 5 - int(priority)


# ---------------------------------------------------------------------------
# Notion helpers
# ---------------------------------------------------------------------------

def _notion_pages(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract pages from Notion mock state."""
    entities = state.get("entities") or {}
    raw = entities.get("pages") or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _notion_databases(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract databases from Notion mock state."""
    entities = state.get("entities") or {}
    raw = entities.get("databases") or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _notion_page_text(page: dict[str, Any]) -> str:
    """Get all text content from a Notion page."""
    parts: list[str] = []
    # Direct content field
    parts.append(str(page.get("content") or ""))
    # Title / name
    title = page.get("title") or ""
    if isinstance(title, list):
        title = " ".join(str(t.get("plain_text") or t.get("text", {}).get("content", "")) for t in title)
    parts.append(str(title))
    # Properties
    props = page.get("properties") or {}
    for prop_name, prop_val in props.items():
        parts.append(str(prop_name))
        if isinstance(prop_val, dict):
            # Handle various Notion property types
            for key in ("title", "rich_text", "select", "multi_select", "number", "url"):
                val = prop_val.get(key)
                if val is not None:
                    if isinstance(val, list):
                        parts.append(" ".join(
                            str(v.get("plain_text") or v.get("text", {}).get("content", "") or v.get("name", ""))
                            for v in val
                        ))
                    elif isinstance(val, dict):
                        parts.append(str(val.get("name") or val.get("plain_text") or ""))
                    else:
                        parts.append(str(val))
        else:
            parts.append(str(prop_val))
    # Blocks / children
    for block in page.get("blocks") or page.get("children") or []:
        parts.append(str(block.get("text") or block.get("content") or ""))
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Main evaluation
# ---------------------------------------------------------------------------

def evaluate(
    exp: dict[str, Any],
    jira: dict[str, Any],
    todoist: dict[str, Any],
    notion: dict[str, Any],
    jira_err: str,
    todoist_err: str,
    notion_err: str,
    source_ok: bool,
    source_reason: str,
) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    suppliers = exp["suppliers"]
    restricted_set = set(exp["restricted_suppliers"])
    exempt_set = set(exp["exempt_suppliers"])
    all_suppliers = restricted_set | exempt_set

    # -----------------------------------------------------------------------
    # 1. setup_gate — 3 CLIs accessible
    # -----------------------------------------------------------------------
    # Seeded personal Todoist tasks (todoist_cli seeds 2500000001-2500000006)
    # must survive; destructive cleanup of pre-existing user data fails the gate.
    seed_missing: list[str] = []
    if not todoist_err:
        _live_ids = {str(i.get("id")) for i in todoist.get("items", []) if not i.get("is_deleted")}
        seed_missing = [str(s) for s in range(2500000001, 2500000007) if str(s) not in _live_ids]

    setup_ok = not jira_err and not todoist_err and not notion_err and not seed_missing
    setup_reason = jira_err or todoist_err or notion_err or ("" if not seed_missing else f"seeded personal tasks deleted: {seed_missing}") or "ok"
    checks.append(chk("setup_gate", setup_ok, setup_reason))

    # -----------------------------------------------------------------------
    # 2. source_data_present — 5 CSV files present
    # -----------------------------------------------------------------------
    checks.append(chk("source_data_present", source_ok, source_reason))

    if not setup_ok:
        for cid in (
            "jira_restricted_set_correct",
            "jira_fields_correct",
            "jira_exempt_absent",
            "notion_knowledge_base",
            "todoist_restricted_queue",
            "scope_boundary_precision",
        ):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    # -----------------------------------------------------------------------
    # 3. jira_restricted_set_correct — Issues for EXACTLY the restricted set
    # -----------------------------------------------------------------------
    issues = _jira_issues(jira)
    issue_by_supplier: dict[str, dict[str, Any]] = {}
    issue_lists_by_supplier: dict[str, list[dict[str, Any]]] = {}
    for issue in issues:
        for supplier in all_suppliers:
            if _jira_issue_matches_supplier(issue, supplier):
                issue_lists_by_supplier.setdefault(supplier, []).append(issue)
                issue_by_supplier.setdefault(supplier, issue)
                break

    found_restricted = set(issue_by_supplier.keys()) & restricted_set
    missing_restricted = sorted(restricted_set - found_restricted)
    duplicate_restricted = sorted(
        supplier for supplier in restricted_set
        if len(issue_lists_by_supplier.get(supplier, [])) > 1
    )
    jira_set_fail: list[str] = []
    if missing_restricted:
        jira_set_fail.append(f"missing issues for {len(missing_restricted)} restricted suppliers: {missing_restricted[:5]}")
    if duplicate_restricted:
        jira_set_fail.append(f"duplicate issues for restricted suppliers: {duplicate_restricted[:5]}")
    jira_set_ok = len(found_restricted) == len(restricted_set) and not duplicate_restricted
    checks.append(chk(
        "jira_restricted_set_correct",
        jira_set_ok,
        "ok" if jira_set_ok else "; ".join(jira_set_fail),
    ))

    # -----------------------------------------------------------------------
    # 4. jira_fields_correct — Priority, labels, assignees
    # -----------------------------------------------------------------------
    field_fail: list[str] = []
    for spec in suppliers:
        if spec["classification"] != "RESTRICTED":
            continue
        issue = issue_by_supplier.get(spec["supplier"])
        if not issue:
            continue

        # Priority check
        got_priority = _jira_get_priority(issue)
        want_priority = spec["priority"]
        if _norm(got_priority) != _norm(want_priority):
            field_fail.append(f"{spec['supplier'][:30]}: priority {got_priority!r} want {want_priority!r}")

        # Label check
        got_labels = _jira_get_labels(issue)
        want_label = _norm(exp["jira_labels"].get(spec["classification_path"], ""))
        if want_label and want_label not in got_labels:
            field_fail.append(f"{spec['supplier'][:30]}: label {want_label!r} missing (got {sorted(got_labels)})")

        # Assignee check
        got_assignee = _jira_get_assignee(issue)
        want_assignee = spec["assigned_analyst"]
        _want = _norm(want_assignee)
        _got = _norm(got_assignee)
        # Accept display name or the email local-part spelling of the SAME
        # analyst (e.g. "Liu Yang" vs "liuyang@example.com").
        _want_ns = _want.replace(" ", "")
        _got_ns = _got.replace(" ", "")
        if not _got:
            field_fail.append(f"{spec['supplier'][:30]}: assignee empty, want {want_assignee!r}")
        elif (_want not in _got and _got not in _want
                and _want_ns not in _got_ns and _got_ns not in _want_ns):
            field_fail.append(f"{spec['supplier'][:30]}: assignee {got_assignee!r} want {want_assignee!r}")

    fields_ok = len(field_fail) == 0
    checks.append(chk(
        "jira_fields_correct",
        fields_ok,
        "ok" if not field_fail else f"{len(field_fail)} errors: " + "; ".join(field_fail[:6]),
    ))

    # -----------------------------------------------------------------------
    # 5. jira_exempt_absent — NO issues for exempt suppliers
    # -----------------------------------------------------------------------
    exempt_in_jira: list[str] = []
    for supplier in exempt_set:
        if supplier in issue_by_supplier:
            exempt_in_jira.append(supplier)
        else:
            # Also check all issues for any mention of exempt suppliers
            for issue in issues:
                if _jira_issue_matches_supplier(issue, supplier):
                    exempt_in_jira.append(supplier)
                    break

    exempt_absent_ok = len(exempt_in_jira) == 0
    checks.append(chk(
        "jira_exempt_absent",
        exempt_absent_ok,
        "ok" if exempt_absent_ok else f"exempt suppliers wrongly flagged in Jira: {exempt_in_jira}",
    ))

    # -----------------------------------------------------------------------
    # 6. notion_knowledge_base — Database with ALL supplier classifications
    # -----------------------------------------------------------------------
    notion_fail: list[str] = []
    databases = _notion_databases(notion)
    pages = _notion_pages(notion)

    # Find the classification database.
    # Notion CLI mock's getState() does NOT include "databases" in the
    # entity dump — only pages are returned.  When databases is empty,
    # infer existence from pages that contain the expected database title
    # or have structured properties (= database entries).
    db_found = False
    if databases:
        db_found = any(
            _norm(exp["notion_database_title"]) in _norm(
                db.get("title") or (
                    " ".join(
                        str(t.get("plain_text") or t.get("text", {}).get("content", ""))
                        for t in db.get("title", [])
                    ) if isinstance(db.get("title"), list) else ""
                )
            )
            for db in databases
        )
    else:
        # Fallback: check pages for evidence of the database
        db_title_norm = _norm(exp["notion_database_title"])
        for page in pages:
            text = _norm(_notion_page_text(page))
            if db_title_norm in text:
                db_found = True
                break
            # Pages with multiple properties are database entries
            if page.get("properties") and len(page.get("properties", {})) >= 2:
                db_found = True
                break
    if not db_found:
        notion_fail.append(f"database {exp['notion_database_title']!r} not found")

    # Check each supplier has a page/record with its own conclusion and basis.
    suppliers_in_notion: set[str] = set()
    supplier_page_texts: dict[str, list[str]] = {supplier: [] for supplier in all_suppliers}
    for page in pages:
        text = _notion_page_text(page)
        for supplier in all_suppliers:
            if _norm(supplier) in _norm(text):
                suppliers_in_notion.add(supplier)
                supplier_page_texts[supplier].append(text)

    missing_in_notion = sorted(all_suppliers - suppliers_in_notion)
    if missing_in_notion:
        notion_fail.append(f"{len(missing_in_notion)} suppliers missing from Notion: {missing_in_notion[:5]}")

    # Check that every supplier page contains the right classification and an
    # input-grounded rationale (HS code/category/keyword evidence).
    rationale_keywords = ["restricted", "exempt", "hs", "8507", "lithium", "conditional"]
    for spec in suppliers:
        supplier = spec["supplier"]
        page_texts = supplier_page_texts.get(supplier, [])
        if not page_texts:
            continue
        want_class = _norm(spec["classification"])
        hs_codes = {str(hs).replace(".", "") for hs in spec.get("hs8_codes", [])}
        has_good_page = False
        for text in page_texts:
            text_norm = _norm(text)
            text_digits = "".join(ch for ch in text if ch.isdigit())
            class_ok = want_class in text_norm
            hs_ok = any(hs and hs in text_digits for hs in hs_codes)
            rationale_ok = hs_ok or sum(1 for kw in rationale_keywords if kw in text_norm) >= 2
            if class_ok and rationale_ok:
                has_good_page = True
                break
        if not has_good_page:
            notion_fail.append(f"{supplier[:30]}: missing correct classification/rationale")

    notion_ok = not notion_fail
    checks.append(chk(
        "notion_knowledge_base",
        notion_ok,
        "ok" if notion_ok else "; ".join(notion_fail[:4]),
    ))

    # -----------------------------------------------------------------------
    # 7. todoist_restricted_queue — Tasks ONLY for restricted suppliers
    # -----------------------------------------------------------------------
    todo_fail: list[str] = []
    todo_project = None
    items: list[dict[str, Any]] = []
    for p in todoist.get("projects", []):
        if _norm(exp["todoist_project"]) in _norm(p.get("name") or ""):
            todo_project = p
            break

    if not todo_project:
        todo_fail.append(f"project {exp['todoist_project']!r} not found")
        checks.append(chk("todoist_restricted_queue", False, todo_fail[0]))
    else:
        todo_project_id = todo_project.get("id")
        items = [
            i for i in todoist.get("items", [])
            if not i.get("is_deleted") and i.get("project_id") == todo_project_id
        ]

        # Map items to suppliers
        item_by_supplier: dict[str, dict[str, Any]] = {}
        item_lists_by_supplier: dict[str, list[dict[str, Any]]] = {}
        todo_extras: list[str] = []
        for item in items:
            content = str(item.get("content") or "")
            matched = False
            for supplier in all_suppliers:
                if _norm(supplier) in _norm(content):
                    item_lists_by_supplier.setdefault(supplier, []).append(item)
                    item_by_supplier.setdefault(supplier, item)
                    matched = True
                    break
            if not matched:
                todo_extras.append(content[:80])

        # Check restricted suppliers have tasks
        missing_tasks = sorted(restricted_set - set(item_by_supplier.keys()))
        if missing_tasks:
            todo_fail.append(f"missing tasks for {len(missing_tasks)} restricted suppliers: {missing_tasks[:4]}")
        duplicate_tasks = sorted(
            supplier for supplier in restricted_set
            if len(item_lists_by_supplier.get(supplier, [])) > 1
        )
        if duplicate_tasks:
            todo_fail.append(f"duplicate tasks for restricted suppliers: {duplicate_tasks[:4]}")

        # Check exempt suppliers do NOT have tasks
        exempt_in_todoist = sorted(exempt_set & set(item_by_supplier.keys()))
        if exempt_in_todoist:
            todo_fail.append(f"exempt suppliers wrongly in Todoist: {exempt_in_todoist}")
        if todo_extras:
            todo_fail.append(f"unexpected Todoist project items: {todo_extras[:3]}")

        # Check priorities for restricted suppliers
        priority_map = {"Highest": 1, "Critical": 1, "High": 2, "Medium": 3}
        priority_errors = 0
        for spec in suppliers:
            if spec["classification"] != "RESTRICTED":
                continue
            item = item_by_supplier.get(spec["supplier"])
            if not item:
                continue
            want_user_p = priority_map.get(spec["priority"], 3)
            want_api_p = _todoist_user_to_api_priority(want_user_p)
            got_api_p = item.get("priority", 1)
            if got_api_p != want_api_p:
                priority_errors += 1

        if priority_errors:
            todo_fail.append(f"{priority_errors} priority mismatches out of {len(restricted_set)}")

        todo_ok = not todo_fail
        checks.append(chk(
            "todoist_restricted_queue",
            todo_ok,
            "ok" if todo_ok else "; ".join(todo_fail[:4]),
        ))

    # -----------------------------------------------------------------------
    # 8. scope_boundary_precision — Conditional exempt correctly classified
    # -----------------------------------------------------------------------
    # This is the hardest check: the 3 exempt suppliers have conditional HS
    # codes but no lithium in descriptions. An over-applying agent flags them.
    boundary_fail: list[str] = []
    conditional_exempt = [
        s for s in suppliers
        if s["classification_path"] == "conditional_no_lithium"
    ]

    for spec in conditional_exempt:
        supplier = spec["supplier"]
        # Check Jira: must NOT have an issue
        if supplier in issue_by_supplier:
            boundary_fail.append(f"{supplier}: wrongly flagged in Jira (over-application)")
        else:
            for issue in issues:
                if _jira_issue_matches_supplier(issue, supplier):
                    boundary_fail.append(f"{supplier}: wrongly flagged in Jira (over-application)")
                    break

        # Check Todoist: must NOT have a task
        if todo_project:
            for item in items:
                content = str(item.get("content") or "")
                if _norm(supplier) in _norm(content):
                    boundary_fail.append(f"{supplier}: wrongly in Todoist (over-application)")
                    break

        # Check Notion: MUST have a page (all suppliers go to Notion)
        if supplier not in suppliers_in_notion:
            boundary_fail.append(f"{supplier}: missing from Notion (all suppliers should be there)")

    boundary_ok = not boundary_fail
    checks.append(chk(
        "scope_boundary_precision",
        boundary_ok,
        "ok" if boundary_ok else "; ".join(boundary_fail[:6]),
    ))

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

    exp = json.loads(
        (task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig")
    )

    # Check source CSV integrity
    try:
        csv_dir = task_dir / exp.get("source_csv_dir", "workspace/customs_data")
        csv_files = list(csv_dir.glob("*.csv"))
        total_rows = 0
        for csv_path in csv_files:
            with csv_path.open(newline="", encoding="utf-8-sig") as f:
                total_rows += sum(1 for _ in csv.DictReader(f))
        source_min = int(exp.get("source_min_rows", 4000))
        source_ok = len(csv_files) >= exp.get("source_csv_count", 5) and total_rows >= source_min
        source_reason = f"csv_files={len(csv_files)}, total_rows={total_rows}, min={source_min}"
    except Exception as exc:  # noqa: BLE001
        source_ok = False
        source_reason = f"source parse failed: {exc}"

    jira, jira_err = _read_state(("MOCK_SITE_URL_JIRA_CLI",), token, "/__bench/state")
    todoist, todoist_err = _read_state(("MOCK_SITE_URL_TODOIST_CLI",), token, "/__bench/state")
    notion, notion_err = _read_state(("MOCK_SITE_URL_NOTION_CLI",), token)

    checks = evaluate(
        exp, jira, todoist, notion,
        jira_err, todoist_err, notion_err,
        source_ok, source_reason,
    )

    # Write final states for debugging
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "jira_final_state.json").write_text(
        json.dumps(jira, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "todoist_final_state.json").write_text(
        json.dumps(todoist, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "notion_final_state.json").write_text(
        json.dumps(notion, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    all_passed = total > 0 and passed == total
    payload = {
        "schema_version": "2.0",
        "task_id": task_dir.name,
        "score": 1.0 if all_passed else 0.0,
        "reward": 1.0 if all_passed else 0.0,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "validation_checks": checks,
        "passed": all_passed,
    }
    reward_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({
        "score": payload["score"],
        "checks_passed": passed,
        "checks_total": total,
        "passed": all_passed,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
