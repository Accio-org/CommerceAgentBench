#!/usr/bin/env python3
"""Verifier for replenishment-watchlist (capacity-check folding).

Capacity refactor (2026-06-10): the per-item atomic checks (~50 of them;
the count varies because some branches are conditional) are computed
verbatim into ``atoms`` and then folded by AND into 6 distinct capability
groups (setup gate, priority identification, priority action details,
monitor-only classification, CLI data access, and data access restraint).
The folding is pure emit/grouping: every atomic boolean/threshold/field
comparison below is byte-identical to the pre-refactor verifier -- only the
final emit layer changed.  See ``docs/check-granularity.md`` (R2/R3/R4/R6)
and ``docs/capacity-migration-status.md``.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any


def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300], "check_type": "deterministic"}


def norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def load_json(path: Path) -> tuple[Any | None, str]:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig")), ""
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def fetch_json(url: str, token: str) -> tuple[dict[str, Any], str]:
    try:
        req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8")), ""
    except Exception as exc:  # noqa: BLE001
        return {}, str(exc)


def audit_entries(state_payload: dict[str, Any]) -> list[dict[str, Any]]:
    db = state_payload.get("db", {})
    if isinstance(db, dict) and isinstance(db.get("audit"), list):
        return [x for x in db["audit"] if isinstance(x, dict)]
    return []


def audit_has_tool(audit: list[dict[str, Any]], tool: str) -> bool:
    return any(entry.get("kind") == "cli.tool" and entry.get("tool") == tool for entry in audit)


def range_entries(audit: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        entry for entry in audit
        if entry.get("kind") == "cli.tool" and entry.get("tool") == "sheets.getRange"
    ]


def audit_has_range(audit: list[dict[str, Any]], fragment: str) -> bool:
    fragment_n = norm(fragment)
    for entry in range_entries(audit):
        if fragment_n in norm(entry.get("range")):
            return True
    return False


def forbidden_bulk_sheet_text(audit: list[dict[str, Any]], spreadsheet_ids: list[str]) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for entry in audit:
        if entry.get("kind") != "cli.tool" or entry.get("tool") != "sheets.getText":
            continue
        spreadsheet_id = str(entry.get("spreadsheetId", ""))
        if any(target in spreadsheet_id for target in spreadsheet_ids):
            hits.append(entry)
    return hits


def answer_has_evidence(answer: dict[str, Any], fragment: str) -> bool:
    fragment_n = norm(fragment)
    actions = answer.get("priority_actions")
    if not isinstance(actions, list):
        return False
    for item in actions:
        if not isinstance(item, dict):
            continue
        evidence = item.get("evidence_ranges")
        if isinstance(evidence, list) and any(fragment_n in norm(x) for x in evidence):
            return True
    return False


def as_int(value: Any) -> int | None:
    try:
        return int(round(float(value)))
    except Exception:  # noqa: BLE001
        return None


def row_key(row: dict[str, Any]) -> str:
    return f"{row.get('sku')}|{row.get('warehouse')}"


# --- Capability fold (emit/grouping layer only; atom computations unchanged) ---
# Ordered list of (group_id, capability description, predicate(atom_id)->bool).
# Predicates are evaluated in order; the FIRST matching group claims the atom,
# so the partition is complete and disjoint for every atom id below.
GROUP_SPECS = [
    ("setup_gate", "Environment ready: mock reachable + output JSON parseable",
     lambda i: i in ("mock_reachable", "output_json_readable")),
    ("priority_identification", "Identified correct top-3 priority SKUs and ranked them (R4 distinct)",
     lambda i: i in ("priority_actions_present", "priority_rank_sequence", "priority_action_keys")
               or (i.startswith("action_") and i.endswith("_present"))),
    ("priority_action_details", "All per-action fields correct: lookups, calculations, evidence (R3 batch)",
     lambda i: i.startswith("action_")),
    ("monitor_only_correct", "Low-risk items classified as monitor-only, no overlap with priority (R4 distinct)",
     lambda i: i.startswith("monitor_only")),
    ("cli_data_access", "Used required CLI tools and read correct spreadsheet ranges (R3 batch)",
     lambda i: i in ("audit_present", "minimum_cli_range_calls") or i.startswith("cli_tool_") or i.startswith("cli_range_")),
    ("data_access_restraint", "No bulk getText on source sheets, no direct/write API calls (R6 restraint)",
     lambda i: i in ("no_bulk_sheet_get_text_for_sources", "no_server_direct_or_write_audit")),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    ap.add_argument("--mock-url", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    expected = json.loads((task_dir / "private/expected_answer.json").read_text(encoding="utf-8-sig"))
    answer, output_err = load_json(output_dir / "replenishment_watchlist.json")
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier")
    state, state_err = fetch_json(args.mock_url.rstrip("/") + "/api/state", token)

    try:
        (output_dir / "mock_google_workspace_state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    except OSError:
        pass

    # atoms: ordered dict {atom_id: (passed: bool, reason: str)} computed with
    # the EXACT pre-refactor expressions. add() is a drop-in for the old
    # checks.append(check(...)) so every comparison below stays byte-identical.
    atoms: dict[str, tuple[bool, str]] = {}

    def add(cid: str, passed: bool, detail: str) -> None:
        atoms[cid] = (bool(passed), str(detail)[:300])

    add("mock_reachable", not state_err, state_err or "state endpoint reachable")
    add("output_json_readable", not output_err and isinstance(answer, dict), output_err or "JSON parsed")
    if not isinstance(answer, dict):
        _write_reward(atoms, args.reward_json, task_dir.name)
        return 0

    actions = answer.get("priority_actions")
    add("priority_actions_present", isinstance(actions, list) and len(actions) >= 3,
        f"got {type(actions).__name__} length {len(actions) if isinstance(actions, list) else 'n/a'}")
    if isinstance(actions, list):
        first_three = [item for item in actions[:3] if isinstance(item, dict)]
        rank_values = [as_int(item.get("rank")) for item in first_three]
        ranks = sorted(rank for rank in rank_values if rank is not None)
        add("priority_rank_sequence", ranks == [1, 2, 3], f"got {ranks}")
        by_key = {row_key(item): item for item in first_three}
        expected_keys = {row_key(spec) for spec in expected["priority_actions"]}
        add("priority_action_keys", expected_keys.issubset(set(by_key)),
            f"got {sorted(by_key)}")
        for spec in expected["priority_actions"]:
            key_id = row_key(spec)
            item = by_key.get(key_id)
            check_prefix = re.sub(r"[^A-Za-z0-9]+", "_", key_id).strip("_")
            add(f"action_{check_prefix}_present", item is not None, "present" if item else "missing")
            if not item:
                continue
            for key in ["sku", "warehouse", "supplier", "recommended_action", "po_number", "eta", "deck_risk_level"]:
                add(f"action_{check_prefix}_{key}", norm(item.get(key)) == norm(spec[key]),
                    f"got {item.get(key)!r}, expected {spec[key]!r}")
            for key in ["stockout_days", "current_shortfall_units", "net_after_in_transit_units"]:
                add(f"action_{check_prefix}_{key}", as_int(item.get(key)) == spec[key],
                    f"got {item.get(key)!r}, expected {spec[key]!r}")
            evidence = item.get("evidence_ranges")
            add(f"action_{check_prefix}_evidence", isinstance(evidence, list) and bool(evidence),
                f"got {evidence!r}")

    monitor = answer.get("monitor_only")
    monitor_keys: set[str] = set()
    if isinstance(monitor, list):
        monitor_keys = {row_key(item) for item in monitor if isinstance(item, dict)}
    priority_keys = {row_key(spec) for spec in expected["priority_actions"]}
    if "monitor_only_keys" in expected:
        add("monitor_only_keys", set(expected["monitor_only_keys"]).issubset(monitor_keys),
            f"got {sorted(monitor_keys)}")
    else:
        allowed_monitor = set(expected.get("monitor_only_allowed_keys", []))
        minimum_monitor = int(expected.get("minimum_monitor_only_count", 0))
        valid_monitor_keys = monitor_keys & allowed_monitor
        invalid_monitor_keys = monitor_keys - allowed_monitor
        add("monitor_only_count", len(valid_monitor_keys) >= minimum_monitor,
            f"got {sorted(valid_monitor_keys)}, expected at least {minimum_monitor} valid watch-only rows")
        add("monitor_only_allowed_keys", not invalid_monitor_keys,
            f"invalid {sorted(invalid_monitor_keys)}")
        overlap = monitor_keys & priority_keys
        add("monitor_only_no_priority_overlap", not overlap,
            f"overlap {sorted(overlap)}")

    audit = audit_entries(state)
    add("audit_present", bool(audit), f"{len(audit)} audit entries")
    for tool in expected["required_cli_tools"]:
        add(f"cli_tool_{tool}", audit_has_tool(audit, tool), f"required {tool}")
    min_range_calls = int(expected.get("minimum_cli_range_calls", 0))
    if min_range_calls:
        observed_ranges = range_entries(audit)
        add("minimum_cli_range_calls", len(observed_ranges) >= min_range_calls,
            f"got {len(observed_ranges)}, expected at least {min_range_calls}")
    forbidden_bulk = forbidden_bulk_sheet_text(audit, expected.get("forbid_bulk_sheet_text_spreadsheet_ids", []))
    add("no_bulk_sheet_get_text_for_sources", not forbidden_bulk,
        f"{len(forbidden_bulk)} forbidden sheets.getText calls on source spreadsheets")
    for fragment in expected["required_range_fragments"]:
        add(f"cli_range_{fragment}", audit_has_range(audit, fragment),
            f"required CLI range containing {fragment}")
    forbidden_writes = [e for e in audit if e.get("kind") != "cli.tool" and str(e.get("tool", "")).startswith(("sheets.", "slides."))]
    add("no_server_direct_or_write_audit", not forbidden_writes,
        f"{len(forbidden_writes)} non-cli tool/write audit entries")

    _write_reward(atoms, args.reward_json, task_dir.name)
    return 0


def fold_atoms(atoms):
    """Fold the per-atom results into the GROUP_SPECS capability checks.

    Pure emit/grouping: each group = AND(member atoms); failing members are
    listed in ``reason``.  Complete partition is asserted -- every atom id must
    map to exactly one group (no drop, no None)."""
    members = {gid: [] for gid, _desc, _pred in GROUP_SPECS}
    for aid in atoms:
        claimed = None
        for gid, _desc, pred in GROUP_SPECS:
            if pred(aid):
                claimed = gid
                break
        assert claimed is not None, f"atom '{aid}' maps to no capability group (incomplete partition)"
        members[claimed].append(aid)

    checks = []
    for gid, _desc, _pred in GROUP_SPECS:
        ids = members[gid]
        failing = [aid for aid in ids if not atoms[aid][0]]
        # A group passes iff it has >=1 evaluated atom and none failed.  An empty
        # group means the capability was never exercised (only happens when the
        # mock was unreachable and setup_gate already failed) -> not a pass.
        passed = len(ids) >= 1 and len(failing) == 0
        if failing:
            detail = "; ".join(f"{aid}: {atoms[aid][1]}" for aid in failing)
            reason = f"{len(failing)}/{len(ids)} failed: {detail}"
        elif not ids:
            reason = "no atoms evaluated"
        else:
            reason = f"ok ({len(ids)} atoms)"
        checks.append(chk(gid, passed, reason))
    return checks


def _write_reward(atoms, path, task_id="replenishment-watchlist"):
    checks = fold_atoms(atoms)
    passed_count = sum(1 for c in checks if c["passed"])
    total = len(checks)
    score = passed_count / total if total else 0.0
    result = {
        "schema_version": "2.0",
        "task_id": task_id,
        "checks_passed": passed_count,
        "checks_total": total,
        "checks_breakdown": checks,
        "score": score,
        "reward": score,
        "passed": passed_count == total,
    }
    Path(path).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"replenishment-watchlist: {passed_count}/{total} checks passed")


if __name__ == "__main__":
    raise SystemExit(main())
