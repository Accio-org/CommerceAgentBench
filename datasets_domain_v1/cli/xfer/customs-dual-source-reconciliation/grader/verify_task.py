#!/usr/bin/env python3
"""Verifier for cli-xfer-customs-dual-source-reconciliation.

Reads three final mock states:
  - dws_doc_cli  : MOCK_SITE_URL_DWS_DOC_CLI/api/state
  - jira_cli     : MOCK_SITE_URL_JIRA_CLI/api/state
  - todoist_cli  : MOCK_SITE_URL_TODOIST_CLI/api/state

Scoring verifies that the agent correctly reconciled two customs data
sources using per-field resolution rules (different fields from different
sources) and created proper records across all three CLI systems.
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


# ---------- HS resolution parsing ----------

_RES_DECL_RE = re.compile(
    r"(?:resolved\s*hs|hs\s*resolved|\u6700\u7ec8\s*hs|hs\s*\u88c1\u51b3|\u88c1\u51b3\s*hs)"
    r"[^0-9]{0,20}([0-9][0-9 .,-]{5,15})",
    re.IGNORECASE,
)

_ADOPT_KW_RE = re.compile(r"(?:\u88c1\u51b3|\u6700\u7ec8|\u5b9a\u593a|\u91c7\u7528|resolved|final|adopted)", re.IGNORECASE)


def _nearest_adopt_gap(code: str, text: str) -> int | None:
    """Smallest gap (chars) between a resolution keyword and a later
    occurrence of ``code`` within a 40-char window; None if never adopted."""
    best: int | None = None
    for m in _ADOPT_KW_RE.finditer(text):
        idx = text.find(code, m.end(), m.end() + 40 + len(code))
        if idx >= 0:
            gap = idx - m.end()
            if best is None or gap < best:
                best = gap
    return best


# ---------- Utilities ----------

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


def _dws_find(items: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    target = _norm(name)
    for item in items:
        candidate = _norm(item.get("name") or item.get("title"))
        if candidate == target:
            return item
    return None


def _dws_find_containing(items: list[dict[str, Any]], substring: str) -> list[dict[str, Any]]:
    target = _norm(substring)
    return [item for item in items
            if target in _norm(item.get("name") or item.get("title"))]


def _dws_content_text(doc: dict[str, Any]) -> str:
    parts: list[str] = []
    parts.append(str(doc.get("content") or ""))
    for block in doc.get("blocks") or []:
        parts.append(str(block.get("text") or block.get("content") or ""))
    return "\n".join(parts)


# ---------- Main evaluation ----------

def evaluate(exp: dict[str, Any],
             dws: dict[str, Any], jira: dict[str, Any], todoist: dict[str, Any],
             dws_err: str, jira_err: str, todoist_err: str,
             source_ok: bool, source_reason: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    all_suppliers = exp["all_suppliers"]
    overlap_names = set(exp["overlap_suppliers"])
    loading_only_names = set(exp["loading_only_suppliers"])
    discharge_only_names = set(exp["discharge_only_suppliers"])
    all_supplier_names = overlap_names | loading_only_names | discharge_only_names

    # -- Check 1: Setup gate --
    dws_docs = _dws_docs(dws)
    dws_folders = _dws_folders(dws)

    jira_issues: list[dict[str, Any]] = []
    jira_project = None
    if not jira_err:
        for p in jira.get("projects", []):
            if _norm(exp["jira_project_name"]) in _norm(p.get("key") or p.get("name")):
                jira_project = p
                break
        all_jira_issues = jira.get("issues", [])
        if jira_project is not None:
            # Filter issues to only those belonging to the reconciliation project.
            # The state shape from jira-bench has project_key directly on each issue.
            proj_key = _norm(jira_project.get("key") or jira_project.get("name") or "")
            jira_issues = [
                issue for issue in all_jira_issues
                if _norm(issue.get("project_key") or issue.get("projectKey") or
                         (issue.get("fields") or {}).get("project", {}).get("key") or "") == proj_key
            ]
        else:
            # Project not found — leave jira_issues empty so downstream checks fail clearly.
            jira_issues = []

    todo_project = None
    if not todoist_err:
        for p in todoist.get("projects", []):
            if _norm(exp["todoist_project_name"]) in _norm(p.get("name")):
                todo_project = p
                break

    # Seeded personal Todoist tasks (todoist_cli seeds 2500000001-2500000006)
    # must survive; destructive cleanup of pre-existing user data fails the gate.
    seed_missing: list[str] = []
    if not todoist_err:
        _live_ids = {str(i.get("id")) for i in todoist.get("items", []) if not i.get("is_deleted")}
        seed_missing = [str(s) for s in range(2500000001, 2500000007) if str(s) not in _live_ids]

    setup_ok = (not dws_err) and (not jira_err) and (not todoist_err) and not seed_missing
    setup_reason = dws_err or jira_err or todoist_err or ("" if not seed_missing else f"seeded personal tasks deleted: {seed_missing}") or "ok"
    checks.append(chk("setup_gate", setup_ok, setup_reason))

    # -- Check 2: Source data present --
    checks.append(chk("source_data_present", source_ok, source_reason))

    if not setup_ok:
        for cid in ("dws_reconciliation_reports", "dws_content_correct",
                     "jira_conflict_issues", "jira_fields_correct",
                     "todoist_action_queue", "field_resolution_accuracy"):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    # -- Check 3: DWS reconciliation reports --
    dws_fail: list[str] = []
    folder = _dws_find(dws_folders, exp["dws_folder_name"])
    if not folder:
        # Also try partial match
        folder_candidates = _dws_find_containing(dws_folders, "裁决")
        if folder_candidates:
            folder = folder_candidates[0]
        else:
            dws_fail.append(f"folder '{exp['dws_folder_name']}' missing")

    summary_doc = _dws_find(dws_docs, exp["dws_summary_doc_name"])
    if not summary_doc:
        summary_candidates = _dws_find_containing(dws_docs, "汇总")
        if summary_candidates:
            summary_doc = summary_candidates[0]
        else:
            dws_fail.append(f"summary doc '{exp['dws_summary_doc_name']}' missing")

    # Check per-supplier reports exist
    supplier_docs: dict[str, dict[str, Any]] = {}
    for s_info in all_suppliers:
        s_name = s_info["supplier"]
        doc = _dws_find(dws_docs, s_name)
        if not doc:
            # Try partial match
            candidates = _dws_find_containing(dws_docs, s_name[:20])
            if candidates:
                doc = candidates[0]
        if doc:
            supplier_docs[s_name] = doc
        else:
            dws_fail.append(f"report for '{s_name}' missing")

    found_reports = len(supplier_docs)
    expected_reports = len(all_suppliers)
    if found_reports < expected_reports:
        dws_fail.insert(0, f"only {found_reports}/{expected_reports} supplier reports found")

    checks.append(chk("dws_reconciliation_reports",
                       found_reports == expected_reports and not dws_fail,
                       "ok" if found_reports == expected_reports and not dws_fail else "; ".join(dws_fail[:6])))

    # -- Check 4: DWS content correctness --
    content_fail: list[str] = []
    content_pass_count = 0
    content_total = 0

    for s_info in all_suppliers:
        s_name = s_info["supplier"]
        doc = supplier_docs.get(s_name)
        if not doc:
            continue
        content_total += 1

        doc_text = _dws_content_text(doc)
        # Comma tolerance: also match against a comma-stripped copy so
        # comma-formatted numbers (e.g. 36,976.12) are found.
        searchable = doc_text + " " + doc_text.replace(",", "")
        rec = s_info["reconciled"]

        # Check classification is mentioned
        classification = s_info["classification"]
        classification_keywords = {
            "overlap": ["重叠", "overlap", "双源", "both", "两个数据源"],
            "loading_only": ["仅装货", "loading only", "装货港", "东营"],
            "discharge_only": ["仅卸货", "discharge only", "卸货港", "广州"],
        }
        has_classification = any(kw in doc_text.lower() for kw in classification_keywords.get(classification, []))

        # Check weight value
        weight_ok = str(int(rec["weight_kg"])) in searchable or str(rec["weight_kg"]) in searchable

        # Check amount value
        amt_str = f"{rec['amount_usd']:.2f}"
        amt_int = str(int(rec["amount_usd"]))
        amount_ok = amt_str in searchable or amt_int in searchable

        if classification == "overlap":
            # For overlap: check source attribution
            has_source_note = any(kw in doc_text.lower() for kw in
                                  ["装货港", "卸货港", "loading", "discharge", "fob", "cif", "来源", "source"])
            if not has_source_note:
                content_fail.append(f"{s_name}: no source attribution in report")
            elif weight_ok and amount_ok:
                content_pass_count += 1
            else:
                if not weight_ok:
                    content_fail.append(f"{s_name}: weight {rec['weight_kg']} not found")
                if not amount_ok:
                    content_fail.append(f"{s_name}: amount {rec['amount_usd']} not found")
        else:
            if weight_ok or amount_ok:
                content_pass_count += 1
            else:
                content_fail.append(f"{s_name}: neither weight nor amount found in doc")

    content_ok = content_total > 0 and content_pass_count == content_total
    checks.append(chk("dws_content_correct", content_ok,
                       f"pass={content_pass_count}/{content_total}" + (
                           "; " + "; ".join(content_fail[:4]) if content_fail else "")))

    # -- Check 5: Jira conflict issues --
    jira_fail: list[str] = []

    if jira_project is None and not jira_err:
        jira_fail.append(f"RECONCILIATION project not found in Jira state")

    # Find issues that mention overlap suppliers
    issue_by_supplier: dict[str, dict[str, Any]] = {}
    for issue in jira_issues:
        summary = str(issue.get("summary") or issue.get("fields", {}).get("summary") or "")
        desc = str(issue.get("description") or issue.get("fields", {}).get("description") or "")
        combined = summary + " " + desc
        for s_name in overlap_names:
            if s_name in combined or s_name.lower() in combined.lower():
                issue_by_supplier[s_name] = issue
                break

    missing_issues = sorted(overlap_names - set(issue_by_supplier))
    if missing_issues:
        jira_fail.append(f"missing issues for: {missing_issues[:4]}")

    # Check no issues created for non-overlap suppliers
    non_overlap_issues = []
    for issue in jira_issues:
        summary = str(issue.get("summary") or issue.get("fields", {}).get("summary") or "")
        for s_name in (loading_only_names | discharge_only_names):
            if s_name in summary or s_name.lower() in summary.lower():
                non_overlap_issues.append(s_name)
    # Not a hard fail but note it
    if non_overlap_issues:
        jira_fail.append(f"unexpected issues for non-overlap: {non_overlap_issues[:2]}")

    issue_count_ok = len(issue_by_supplier) == len(overlap_names)
    checks.append(chk("jira_conflict_issues", issue_count_ok and not missing_issues,
                       f"found={len(issue_by_supplier)}/{len(overlap_names)}" + (
                           "; " + "; ".join(jira_fail[:4]) if jira_fail else "")))

    # -- Check 6: Jira fields correct --
    fields_fail: list[str] = []
    fields_pass = 0
    fields_total = 0

    # Build set of valid assignee identifiers from expected_answer
    valid_assignees: set[str] = set()
    for emails in (exp.get("team_roster") or {}).values():
        for e in emails:
            valid_assignees.add(_norm(e))
    for n in exp.get("valid_assignee_names", []):
        valid_assignees.add(_norm(n))
    for e in exp.get("valid_assignee_emails", []):
        valid_assignees.add(_norm(e))

    for s_info in all_suppliers:
        if s_info["classification"] != "overlap":
            continue
        s_name = s_info["supplier"]
        issue = issue_by_supplier.get(s_name)
        if not issue:
            continue
        fields_total += 1

        # Extract fields (handle both flat and nested formats)
        fields = issue.get("fields") or issue
        raw_priority = fields.get("priority") or fields.get("priority_name")
        priority = str(raw_priority or "").strip()
        if isinstance(raw_priority, dict):
            priority = str(raw_priority.get("name") or "")

        labels = set()
        raw_labels = fields.get("labels") or []
        if isinstance(raw_labels, list):
            labels = {_norm(l) for l in raw_labels}

        assignee = str(fields.get("assignee") or "")
        if isinstance(fields.get("assignee"), dict):
            assignee = str(fields["assignee"].get("displayName") or fields["assignee"].get("emailAddress") or "")

        expected_priority = s_info.get("jira_priority", "Medium")
        expected_labels = {_norm(l) for l in s_info.get("jira_labels", ["reconciliation"])}

        this_ok = True

        # Check priority
        if _norm(priority) != _norm(expected_priority):
            fields_fail.append(f"{s_name}: priority={priority!r} want={expected_priority!r}")
            this_ok = False

        # Check labels
        if not expected_labels.issubset(labels):
            missing_labels = expected_labels - labels
            fields_fail.append(f"{s_name}: missing labels {sorted(missing_labels)}")
            this_ok = False

        # Check assignee is a valid team member
        if not assignee or assignee == "None":
            fields_fail.append(f"{s_name}: no assignee")
            this_ok = False
        elif valid_assignees and _norm(assignee) not in valid_assignees:
            fields_fail.append(f"{s_name}: assignee={assignee!r} not in team_roster")
            this_ok = False

        if this_ok:
            fields_pass += 1

    fields_ok = fields_total > 0 and fields_pass == fields_total
    checks.append(chk("jira_fields_correct", fields_ok,
                       f"pass={fields_pass}/{fields_total}" + (
                           "; " + "; ".join(fields_fail[:4]) if fields_fail else "")))

    # -- Check 7: Todoist action queue --
    todo_fail: list[str] = []
    todo_project_id = todo_project.get("id") if todo_project else None
    supplier_mentioned: set[str] = set()

    if not todo_project:
        todo_fail.append(f"project '{exp['todoist_project_name']}' missing")
    else:
        sections = [
            s for s in todoist.get("sections", [])
            if s.get("project_id") == todo_project_id
            and not s.get("is_deleted") and not s.get("is_archived")
        ]
        section_by_name: dict[str, dict[str, Any]] = {}
        for s in sections:
            section_by_name[_norm(s.get("name"))] = s

        # Check sections exist
        expected_sections = exp["todoist_sections"]
        for sec_key, sec_name in expected_sections.items():
            found = any(_norm(sec_name) in _norm(sn) for sn in section_by_name)
            if not found:
                todo_fail.append(f"section '{sec_name}' missing")

        # Check tasks
        items = [i for i in todoist.get("items", []) if not i.get("is_deleted")]
        project_items = [i for i in items if i.get("project_id") == todo_project_id]

        # Count supplier coverage
        supplier_mentioned = set()
        for item in project_items:
            content = str(item.get("content") or "")
            for s_name in overlap_names:
                if s_name in content or s_name.lower() in content.lower():
                    supplier_mentioned.add(s_name)

        missing_suppliers = sorted(overlap_names - supplier_mentioned)
        if missing_suppliers:
            todo_fail.append(f"missing tasks for: {missing_suppliers[:3]}")

        # Check that HS-conflict suppliers have hs-review tasks
        hs_conflict_suppliers = {s["supplier"] for s in all_suppliers
                                  if s.get("has_hs_conflict", False)}
        for s_name in hs_conflict_suppliers:
            hs_tasks = [i for i in project_items
                        if s_name in str(i.get("content") or "")
                        and any(_norm(l) in ["hs-review", "hs_review", "hs review"]
                                for l in (i.get("labels") or []))]
            if not hs_tasks:
                # Also check by section placement
                hs_section = None
                for sn, s_obj in section_by_name.items():
                    if "hs" in sn:
                        hs_section = s_obj
                        break
                if hs_section:
                    hs_tasks = [i for i in project_items
                                if s_name in str(i.get("content") or "")
                                and i.get("section_id") == hs_section.get("id")]
                if not hs_tasks:
                    todo_fail.append(f"{s_name}: no HS review task")

    todo_ok = (todo_project is not None
               and len(supplier_mentioned) == len(overlap_names)
               and not todo_fail)
    checks.append(chk("todoist_action_queue", todo_ok,
                       "ok" if not todo_fail else "; ".join(todo_fail[:6])))

    # -- Check 8: Field resolution accuracy --
    # This is the hardest check: spot-check that specific fields used the correct source
    accuracy_fail: list[str] = []
    accuracy_pass = 0
    accuracy_total = 0

    spot_checks = exp.get("spot_checks", [])
    for sc in spot_checks:
        s_name = sc["supplier"]
        field = sc["field"]
        doc = supplier_docs.get(s_name)
        if not doc:
            continue

        doc_text = _dws_content_text(doc)
        # Comma tolerance: match numbers/HS codes against a comma-stripped
        # copy too, so comma-formatted values (e.g. 36,976.12) are found.
        searchable = doc_text + " " + doc_text.replace(",", "")
        accuracy_total += 1

        if field in ("weight_kg", "amount_usd"):
            expected_val = sc["expected_value"]
            wrong_val = sc["wrong_value"]

            # Check the expected value is present
            expected_strs = [
                str(expected_val),
                f"{expected_val:.2f}",
                f"{expected_val:.1f}",
                str(int(expected_val)),
            ]
            wrong_strs = [
                str(wrong_val),
                f"{wrong_val:.2f}",
                f"{wrong_val:.1f}",
                str(int(wrong_val)),
            ]

            has_expected = any(s in searchable for s in expected_strs)
            has_wrong = any(s in searchable for s in wrong_strs)

            if has_expected and not has_wrong:
                accuracy_pass += 1
            elif has_expected and has_wrong:
                # Both present (agent might list both for comparison) — check source note
                source_note = sc["expected_source"]
                if field == "weight_kg" and any(kw in doc_text.lower() for kw in ["装货港", "loading", "fob", "origin"]):
                    accuracy_pass += 1
                elif field == "amount_usd" and any(kw in doc_text.lower() for kw in ["卸货港", "discharge", "cif"]):
                    accuracy_pass += 1
                else:
                    accuracy_fail.append(f"{s_name}: {field} has both values but no clear source attribution")
            elif not has_expected:
                accuracy_fail.append(f"{s_name}: {field} expected={expected_val} not found (wrong={wrong_val})")

        elif field == "hs_code":
            expected_hs = sc["expected_hs"]
            loading_hs = sc["loading_hs"]
            discharge_hs = sc["discharge_hs"]

            has_expected = expected_hs in searchable
            wrong_hs = discharge_hs if sc["expected_source"] == "loading" else loading_hs
            has_wrong = wrong_hs in searchable

            if has_expected and not has_wrong:
                accuracy_pass += 1
            elif has_expected and has_wrong:
                # Both codes present. Primary signal: the machine-readable
                # resolution line required by the task ("Resolved HS: <code>").
                declared = [
                    re.sub(r"\D", "", m.group(1))
                    for m in _RES_DECL_RE.finditer(searchable)
                ]
                decl_exp = any(d == expected_hs for d in declared)
                decl_wrong = any(d == wrong_hs for d in declared)
                if decl_exp and not decl_wrong:
                    accuracy_pass += 1
                elif decl_wrong:
                    accuracy_fail.append(
                        f"{s_name}: HS wrong={wrong_hs} declared as resolved "
                        f"(expected={expected_hs})")
                else:
                    # Fallback for narrative reports: whichever code sits
                    # nearest after a resolution keyword is the adopted one.
                    exp_gap = _nearest_adopt_gap(expected_hs, searchable)
                    wrong_gap = _nearest_adopt_gap(wrong_hs, searchable)
                    if exp_gap is not None and (wrong_gap is None or exp_gap <= wrong_gap):
                        accuracy_pass += 1
                    elif wrong_gap is not None:
                        accuracy_fail.append(
                            f"{s_name}: HS wrong={wrong_hs} presented as adopted "
                            f"over expected={expected_hs}")
                    else:
                        accuracy_fail.append(
                            f"{s_name}: both HS codes present but no resolution "
                            f"declaration found (need 'Resolved HS: <code>')")
            else:
                accuracy_fail.append(
                    f"{s_name}: HS expected={expected_hs}({sc.get('loading_rate', '?')}%/"
                    f"{sc.get('discharge_rate', '?')}%) not found")

    # Compute accuracy ratio
    if accuracy_total == 0:
        accuracy_ok = False
        accuracy_reason = "no spot checks could be evaluated (no DWS docs found)"
    else:
        accuracy_ok = accuracy_pass == accuracy_total
        accuracy_reason = f"pass={accuracy_pass}/{accuracy_total}"
        if accuracy_fail:
            accuracy_reason += "; " + "; ".join(accuracy_fail[:4])

    checks.append(chk("field_resolution_accuracy", accuracy_ok, accuracy_reason))

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
        source_min = int(exp.get("source_min_rows", 250))
        source_ok = len(csv_files) >= exp.get("source_csv_count", 2) and total_rows >= source_min
        source_reason = f"csv_files={len(csv_files)}, total_rows={total_rows}, min={source_min}"
    except Exception as exc:  # noqa: BLE001
        source_ok = False
        source_reason = f"source parse failed: {exc}"

    dws, dws_err = _read_state(("MOCK_SITE_URL_DWS_DOC_CLI",), token)
    jira, jira_err = _read_state(("MOCK_SITE_URL_JIRA_CLI",), token, "/__bench/state")
    todoist, todoist_err = _read_state(("MOCK_SITE_URL_TODOIST_CLI",), token, "/__bench/state")

    checks = evaluate(exp, dws, jira, todoist, dws_err, jira_err, todoist_err,
                       source_ok, source_reason)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "dws_final_state.json").write_text(
        json.dumps(dws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "jira_final_state.json").write_text(
        json.dumps(jira, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "todoist_final_state.json").write_text(
        json.dumps(todoist, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

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
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": payload["score"], "checks_passed": passed, "checks_total": total, "passed": payload["passed"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
