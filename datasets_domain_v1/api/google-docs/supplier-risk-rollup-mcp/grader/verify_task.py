#!/usr/bin/env python3
"""Verifier for google-docs-supplier-risk-rollup-mcp.

Capability units (see docs/check-granularity.md). Internally every supplier,
header line, and source document is still validated atomically (the per-item
detail lives in the ``reason`` strings); the emit layer aggregates those atoms
into one capability check each:

  1. setup_gate                 — env ready: state readable + a workspace write
                                  tool was actually used (plumbing, R2).
  2. summary_doc_created        — exactly one summary doc with the required title
                                  and both required header lines (R1).
  3. supplier_reported::<name>  — for each qualifying supplier, the rubric was
                                  applied correctly: qualify decision + exact
                                  High+Open count + a semantically-correct top
                                  finding. Per-supplier (R3a): correctly
                                  identifying/quantifying every qualifying
                                  supplier IS the hard competency.
  4. excluded_suppliers_filtered — none of the 8 non-qualifying suppliers (the
                                  resolution / threshold / re-assessment traps)
                                  appears in the roll-up (R6 negative).
  5. source_docs_unchanged      — all 15 audit docs + the distractor doc are
                                  present, not trashed, and byte-identical to
                                  the seed (read-only restraint, R6).
  6. document_count_correct     — exactly one new doc was created; no workspace
                                  pollution (R6 negative).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fetch_state(mock_url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{mock_url.rstrip('/')}/api/state",
        headers={"X-Mock-Verifier-Token": token},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def check(check_id: str, passed: bool, reason: str = "") -> dict[str, Any]:
    return {
        "id": check_id,
        "passed": bool(passed),
        "reason": reason[:500],
        "check_type": "deterministic_state",
    }


def find_file(state: dict[str, Any], file_id: str) -> dict[str, Any]:
    for f in state.get("files") or []:
        if f.get("id") == file_id:
            return f
    return {}


def find_docs_by_name(state: dict[str, Any], name: str) -> list[dict[str, Any]]:
    return [
        f for f in state.get("files") or []
        if f.get("type") == "document"
        and not f.get("trashed")
        and f.get("name") == name
    ]


def doc_full_text(doc: dict[str, Any]) -> str:
    """Concatenate all block texts (stripped) into one searchable string."""
    parts: list[str] = []
    for blk in (doc.get("content") or {}).get("blocks") or []:
        t = blk.get("text") or ""
        if t:
            parts.append(t)
    return "\n".join(parts)


def block_texts_snapshot(doc: dict[str, Any]) -> dict[str, str]:
    """Return {block_id: text} for integrity checks."""
    result: dict[str, str] = {}
    for blk in (doc.get("content") or {}).get("blocks") or []:
        result[blk["id"]] = blk.get("text") or ""
    return result


_COMMON_WORDS = {
    "about", "above", "after", "again", "also", "been", "being", "both",
    "cannot", "confirmed", "corrective", "finding", "from", "have", "high",
    "into", "open", "provided", "required", "supplier", "that", "their",
    "there", "this", "with", "without",
}


def keywords(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9][a-z0-9-]{4,}", text.casefold())
    return {word for word in words if word not in _COMMON_WORDS}


def top_finding_semantically_present(line: str, expected_text: str) -> tuple[bool, str]:
    marker = "Top finding:"
    if marker not in line:
        return False, "missing 'Top finding:' marker"
    actual = line.split(marker, 1)[1].strip()
    if len(actual) < 24:
        return False, "top finding text is too short"
    expected_keywords = keywords(expected_text)
    actual_keywords = keywords(actual)
    overlap = expected_keywords & actual_keywords
    threshold = min(8, max(4, len(expected_keywords) // 5))
    if len(overlap) < threshold:
        return False, f"top finding keyword overlap too low: {sorted(overlap)}"
    return True, f"top finding overlap {len(overlap)}/{len(expected_keywords)}"


# ---------------------------------------------------------------------------
# Evaluate
# ---------------------------------------------------------------------------

def evaluate(
    expected: dict[str, Any],
    state: dict[str, Any],
    state_err: str = "",
    seed_state: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    summary_title: str = expected["summary_title"]
    qualifying: list[dict[str, Any]] = expected["qualifying_suppliers"]
    excluded: list[dict[str, Any]] = expected["excluded_suppliers"]
    audit_ids: list[str] = expected["audit_doc_ids"]
    distractor_ids: list[str] = expected["distractor_doc_ids"]
    expected_doc_count: int = expected["expected_doc_count_after"]
    required_header_lines: list[str] = expected["required_header_lines"]

    # ------------------------------------------------------------------
    # setup_gate (R2): plumbing — state readable + a workspace write tool was
    # actually exercised. If the state is unreadable we cannot evaluate any
    # capability, so emit setup_gate alone (a harness/mock failure, not an
    # agent failure).
    # ------------------------------------------------------------------
    if state_err:
        return [check("setup_gate", False, f"mock state unreadable: {state_err}")]

    events = state.get("events") or []
    workspace_write_events = [
        event for event in events
        if event.get("type") == "workspace_tool_called"
        and event.get("toolName") in {
            "docs.documents.create",
            "create_doc",
            "drive.files.create",
            "create_drive_file",
            "docs.documents.batchUpdate",
        }
    ]
    write_used = len(workspace_write_events) >= 1
    checks.append(check(
        "setup_gate",
        write_used,
        (
            f"state fetched OK; workspace write tool events: {len(workspace_write_events)}"
            if write_used
            else f"no workspace write tool was used (events: {len(workspace_write_events)})"
        ),
    ))

    summary_matches = find_docs_by_name(state, summary_title)
    summary = summary_matches[0] if len(summary_matches) == 1 else {}
    summary_text = doc_full_text(summary) if summary else ""

    # ------------------------------------------------------------------
    # summary_doc_created (R1): one capability = a correctly-authored summary
    # doc shell. Internally validates: exactly one doc with the required title
    # AND every required header line present.
    # ------------------------------------------------------------------
    unique_ok = len(summary_matches) == 1
    missing_headers = [line for line in required_header_lines if line not in summary_text]
    summary_ok = unique_ok and not missing_headers
    if not unique_ok:
        summary_reason = (
            f"expected exactly 1 doc titled {summary_title!r}, found {len(summary_matches)}"
        )
    elif missing_headers:
        summary_reason = f"summary doc missing required header line(s): {missing_headers}"
    else:
        summary_reason = "summary doc unique with all required header lines present"
    checks.append(check("summary_doc_created", summary_ok, summary_reason))

    # ------------------------------------------------------------------
    # supplier_reported::<name> (R3a): per qualifying supplier, the hard
    # competency = apply the severity/status rubric correctly. One check per
    # supplier because correctly identifying *and* quantifying every qualifying
    # supplier (qualify decision + exact High+Open count + a semantically
    # correct top finding) is the measured skill. Each per-supplier check is
    # AND(line-with-correct-count, top-finding-semantically-present).
    #
    # Only the objective, format-specified prefix "<name> | High+Open: <count>"
    # is matched verbatim; the brief asks the agent for its OWN "concise
    # description" as the top finding, so the finding text is matched
    # semantically (keyword overlap) rather than verbatim, to avoid unfairly
    # failing a correct paraphrase.
    # ------------------------------------------------------------------
    for supplier in qualifying:
        sup_name = supplier["name"]
        required_line = supplier["required_line"]
        required_prefix = required_line.split(" | Top finding:")[0].strip()
        matching_lines = [
            line.strip()
            for line in summary_text.splitlines()
            if sup_name in line and f"High+Open: {supplier['high_open_count']}" in line
        ]
        line_ok = bool(matching_lines)
        top_ok, top_reason = top_finding_semantically_present(
            matching_lines[0] if matching_lines else "",
            supplier["top_finding_text"],
        )
        if not line_ok:
            reason = f"MISSING required prefix for {sup_name!r}: {required_prefix!r}"
        elif not top_ok:
            reason = f"line present but top finding wrong: {top_reason}"
        else:
            reason = f"qualify decision + count + top finding correct ({top_reason})"
        checks.append(check(
            f"supplier_reported::{sup_name}",
            line_ok and top_ok,
            reason,
        ))

    # ------------------------------------------------------------------
    # excluded_suppliers_filtered (R6 negative): none of the 8 non-qualifying
    # suppliers (resolution / threshold / re-assessment traps) leaked into the
    # roll-up. Internally checks every excluded supplier name is absent.
    # ------------------------------------------------------------------
    leaked = [s["name"] for s in excluded if s["name"] in summary_text]
    checks.append(check(
        "excluded_suppliers_filtered",
        not leaked,
        (
            f"all {len(excluded)} non-qualifying suppliers correctly excluded"
            if not leaked
            else f"INCORRECTLY included excluded supplier(s): {leaked}"
        ),
    ))

    # ------------------------------------------------------------------
    # source_docs_unchanged (R6 restraint): all source audit docs and the
    # distractor doc are present, not trashed, and byte-identical to the seed.
    # Internally validates each doc on three dimensions (exists / not-trashed /
    # body-unchanged); per-doc failures are surfaced in the reason.
    # ------------------------------------------------------------------
    integrity_failures: list[str] = []
    for label, doc_ids in (("audit", audit_ids), ("distractor", distractor_ids)):
        for doc_id in doc_ids:
            f = find_file(state, doc_id)
            if not f:
                integrity_failures.append(f"{doc_id}(missing)")
                continue
            if bool(f.get("trashed")):
                integrity_failures.append(f"{doc_id}(trashed)")
            if seed_state is not None:
                seed_doc = find_file(seed_state, doc_id)
                if not (seed_doc and block_texts_snapshot(f) == block_texts_snapshot(seed_doc)):
                    integrity_failures.append(f"{doc_id}(body-changed)")
    checks.append(check(
        "source_docs_unchanged",
        not integrity_failures,
        (
            f"all {len(audit_ids) + len(distractor_ids)} source/distractor docs unchanged"
            if not integrity_failures
            else f"source integrity violations: {integrity_failures}"
        ),
    ))

    # ------------------------------------------------------------------
    # document_count_correct (R6 negative): exactly one new doc created; no
    # workspace pollution.
    # ------------------------------------------------------------------
    all_docs = [
        f for f in state.get("files") or []
        if f.get("type") == "document" and not f.get("trashed")
    ]
    checks.append(check(
        "document_count_correct",
        len(all_docs) == expected_doc_count,
        f"expected {expected_doc_count} docs (seed 16 + 1 summary), got {len(all_docs)}",
    ))

    return checks


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    parser.add_argument(
        "--mock-url",
        default=os.environ.get("MOCK_SITE_URL", "http://127.0.0.1:3081"),
    )
    parser.add_argument(
        "--verifier-token",
        default=os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier"),
    )
    args = parser.parse_args()

    task_dir = Path(args.task_dir)
    expected: dict[str, Any] = json.loads(
        (task_dir / "private" / "expected_answer.json").read_text()
    )
    seed_state_path = task_dir / "private" / "mock_runtime" / "google_docs_mock" / "data" / "seed_state.json"
    seed_state: dict[str, Any] | None = None
    if seed_state_path.exists():
        seed_state = json.loads(seed_state_path.read_text())

    state: dict[str, Any] = {}
    state_err = ""
    try:
        state = fetch_state(args.mock_url, args.verifier_token)
    except Exception as exc:  # pragma: no cover
        state_err = str(exc)

    all_checks = evaluate(expected, state, state_err, seed_state)
    n_pass = sum(1 for item in all_checks if item["passed"])
    n_total = len(all_checks)
    passed = n_total > 0 and n_pass == n_total
    result = {
        "schema_version": "2.0",
        "score": 1.0 if passed else 0.0,
        "reward": 1.0 if passed else 0.0,
        "raw_score": 1.0 if passed else 0.0,
        "checks_passed": n_pass,
        "checks_total": n_total,
        "checks_breakdown": all_checks,
        "passed": passed,
    }
    Path(args.reward_json).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
