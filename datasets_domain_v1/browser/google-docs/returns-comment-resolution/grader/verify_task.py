#!/usr/bin/env python3
"""Verifier for google-docs-returns-comment-resolution."""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any


def norm(value: Any) -> str:
    return " ".join(str(value or "").strip().casefold().split())


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


def blocks(file: dict[str, Any]) -> list[dict[str, Any]]:
    return ((file.get("content") or {}).get("blocks") or [])


def document_text(file: dict[str, Any]) -> str:
    rows: list[str] = []
    for block in blocks(file):
        if block.get("type") == "table":
            for row in ((block.get("format") or {}).get("rows") or []):
                rows.append(" | ".join(str(cell) for cell in row))
        else:
            rows.append(str(block.get("text") or ""))
    return "\n".join(rows)


def find_docs(state: dict[str, Any], name: str) -> list[dict[str, Any]]:
    return [
        file
        for file in state.get("files") or []
        if file.get("type") == "document"
        and not file.get("trashed")
        and norm(file.get("name")) == norm(name)
    ]


def comment_by_id(file: dict[str, Any], comment_id: str) -> dict[str, Any]:
    for comment in file.get("comments") or []:
        if comment.get("id") == comment_id:
            return comment
    return {}


def has_required_reply(comment: dict[str, Any], text: str) -> bool:
    return any(str(reply.get("text") or "") == text for reply in comment.get("replies") or [])


def has_event(state: dict[str, Any], event_type: str, file_id: str, comment_id: str) -> bool:
    return any(
        event.get("type") == event_type
        and event.get("fileId") == file_id
        and event.get("commentId") == comment_id
        for event in state.get("events") or []
    )


def comment_event_diagnostics(expected: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for item in expected.get("qualifying", []):
        docs = find_docs(state, item["source_doc"])
        doc = docs[0] if len(docs) == 1 else {}
        file_id = doc.get("id", "")
        comment_id = item["comment_id"]
        reply_events = [
            event
            for event in state.get("events") or []
            if event.get("type") == "comment_replied"
            and event.get("fileId") == file_id
            and event.get("commentId") == comment_id
        ]
        resolve_events = [
            event
            for event in state.get("events") or []
            if event.get("type") == "comment_resolved"
            and event.get("fileId") == file_id
            and event.get("commentId") == comment_id
        ]
        rows.append(
            {
                "case_id": item["case_id"],
                "comment_id": comment_id,
                "reply_events": len(reply_events),
                "resolve_events": len(resolve_events),
            }
        )
    return {"qualifying_comments": rows}


def summary_has_ticket_count(summary_text: str, count: int) -> bool:
    folded = norm(summary_text)
    variants = [
        f"tickets: {count}",
        f"tickets {count}",
        f"ticket count: {count}",
        f"ticket count {count}",
        f"{count} tickets",
    ]
    return any(variant in folded for variant in variants)


def source_body_preserved(item: dict[str, Any], source_text: str, summary_title: str) -> bool:
    required_terms = [
        f"Case ID: {item['case_id']}",
        f"SKU: {item['sku']}",
        f"Market: {item['market']}",
        f"Channel: {item['channel']}",
        f"Status: {item['status']}",
        f"Reason: {item['reason']}",
        f"Tickets: {item['ticket_count']}",
    ]
    return all(term in source_text for term in required_terms) and summary_title not in source_text


def evaluate(expected: dict[str, Any], state: dict[str, Any], state_err: str = "") -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    if state_err:
        return [check("mock_state_readable", False, state_err)]
    checks.append(check("mock_state_readable", True, "state fetched"))

    files = [f for f in state.get("files") or [] if f.get("type") == "document" and not f.get("trashed")]
    summary_matches = find_docs(state, expected["summary_title"])
    checks.append(
        check(
            "summary_doc_unique",
            len(summary_matches) == 1,
            f"expected one summary doc, got {len(summary_matches)}",
        )
    )
    summary = summary_matches[0] if len(summary_matches) == 1 else {}
    summary_text = document_text(summary)

    for line in expected.get("required_lines", []):
        checks.append(
            check(
                f"summary_required_line:{line[:40]}",
                line in summary_text,
                "present" if line in summary_text else f"missing {line!r}",
            )
        )

    for item in expected.get("qualifying", []):
        terms = [
            item["case_id"],
            item["sku"],
            item["channel"],
            item["reason"],
        ]
        missing = [term for term in terms if term not in summary_text]
        if not summary_has_ticket_count(summary_text, int(item["ticket_count"])):
            missing.append(f"ticket count {item['ticket_count']}")
        checks.append(
            check(
                f"summary_has_resolved_case:{item['case_id']}",
                not missing,
                "all case terms present" if not missing else f"missing terms {missing}",
            )
        )

    for item in expected.get("excluded", []):
        checks.append(
            check(
                f"summary_excludes:{item['case_id']}",
                item["case_id"] not in summary_text,
                "excluded case should not appear in summary",
            )
        )

    required_reply = expected["required_reply"]
    for item in expected.get("qualifying", []):
        docs = find_docs(state, item["source_doc"])
        doc = docs[0] if len(docs) == 1 else {}
        comment = comment_by_id(doc, item["comment_id"])
        checks.append(
            check(
                f"source_doc_present:{item['case_id']}",
                len(docs) == 1,
                f"expected source doc {item['source_doc']}, got {len(docs)}",
            )
        )
        checks.append(
            check(
                f"comment_present:{item['case_id']}",
                bool(comment),
                f"expected comment {item['comment_id']}",
            )
        )
        checks.append(
            check(
                f"comment_anchor_preserved:{item['case_id']}",
                comment.get("blockId") == item["comment_block_id"] and isinstance(comment.get("anchorTop"), (int, float)),
                f"expected anchor {item['comment_block_id']}",
            )
        )
        checks.append(
            check(
                f"comment_has_required_reply:{item['case_id']}",
                has_required_reply(comment, required_reply),
                "required reply present",
            )
        )
        checks.append(
            check(
                f"comment_resolved:{item['case_id']}",
                bool(comment.get("resolved")),
                "comment should be resolved",
            )
        )
        source_text = document_text(doc)
        checks.append(
            check(
                f"source_body_unchanged:{item['case_id']}",
                source_body_preserved(item, source_text, expected["summary_title"]),
                "source retains case fields and does not contain summary title",
            )
        )

    for item in expected.get("excluded", []):
        docs = find_docs(state, item["source_doc"])
        doc = docs[0] if len(docs) == 1 else {}
        comment = comment_by_id(doc, item["comment_id"])
        checks.append(
            check(
                f"excluded_source_doc_present:{item['case_id']}",
                len(docs) == 1,
                f"expected source doc {item['source_doc']}, got {len(docs)}",
            )
        )
        checks.append(
            check(
                f"excluded_comment_left_open:{item['case_id']}",
                bool(comment) and not comment.get("resolved"),
                "excluded comment should remain open",
            )
        )
        checks.append(
            check(
                f"excluded_comment_no_reply:{item['case_id']}",
                bool(comment) and len(comment.get("replies") or []) == 0,
                f"excluded replies: {len(comment.get('replies') or []) if comment else -1}",
            )
        )
        source_text = document_text(doc)
        checks.append(
            check(
                f"excluded_source_body_unchanged:{item['case_id']}",
                source_body_preserved(item, source_text, expected["summary_title"]),
                "excluded source retains case fields and does not contain summary title",
            )
        )

    expected_count = expected.get("expected_file_count_after_completion")
    if expected_count is not None:
        checks.append(
            check(
                "document_count_after_completion",
                len(files) == expected_count,
                f"expected {expected_count} documents, got {len(files)}",
            )
        )

    return checks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    parser.add_argument("--mock-url", default=os.environ.get("MOCK_SITE_URL", "http://127.0.0.1:3081"))
    parser.add_argument("--verifier-token", default=os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier"))
    args = parser.parse_args()

    task_dir = Path(args.task_dir)
    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text())
    state: dict[str, Any] = {}
    state_err = ""
    try:
        state = fetch_state(args.mock_url, args.verifier_token)
    except Exception as exc:  # pragma: no cover - diagnostic path
        state_err = str(exc)

    checks = evaluate(expected, state, state_err)
    n_pass = sum(1 for item in checks if item["passed"])
    n_total = len(checks)
    passed = n_total > 0 and n_pass == n_total
    result = {
        "schema_version": "2.0",
        "score": 1.0 if passed else 0.0,
        "reward": 1.0 if passed else 0.0,
        "raw_score": 1.0 if passed else 0.0,
        "checks_passed": n_pass,
        "checks_total": n_total,
        "checks_breakdown": checks,
        "diagnostics": {
            "comment_events": comment_event_diagnostics(expected, state) if state and not state_err else {},
        },
        "passed": passed,
    }
    Path(args.reward_json).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
