#!/usr/bin/env python3
"""Verifier for google-docs-feed-qa-brief."""
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


def document_text(file: dict[str, Any]) -> str:
    blocks = ((file.get("content") or {}).get("blocks") or [])
    return "\n".join(str(block.get("text") or "") for block in blocks)


def expected_source_text(item: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"Product Feed QA Report — {item['sku']}",
            f"Title: {item['title']}",
            f"Market: {item['market']}",
            f"Channel: {item['channel']}",
            f"Issue Code: {item['issue_code']}",
            f"Severity: {item['severity']}",
            f"Domain: {item['domain']}",
            f"Owner: {item['owner']}",
            f"Expected Action: {item['expected_action']}",
        ]
    )


def image_blocks(file: dict[str, Any]) -> list[dict[str, Any]]:
    blocks = ((file.get("content") or {}).get("blocks") or [])
    return [block for block in blocks if block.get("type") == "image"]


def is_uploaded_status_image(block: dict[str, Any]) -> bool:
    fmt = block.get("format") or {}
    src = str(fmt.get("src") or "")
    label = " ".join([str(block.get("text") or ""), str(fmt.get("alt") or "")])
    return (
        src.startswith("data:image/svg+xml;base64,")
        and "feed_status_badge" in label
    )


def comments_text(file: dict[str, Any]) -> str:
    parts: list[str] = []
    for comment in file.get("comments") or []:
        parts.append(str(comment.get("text") or ""))
        for reply in comment.get("replies") or []:
            parts.append(str(reply.get("text") or ""))
    return "\n".join(parts)


def matching_comments(file: dict[str, Any], required_text: str) -> list[dict[str, Any]]:
    return [
        comment
        for comment in file.get("comments") or []
        if str(comment.get("text") or "") == required_text
    ]


def find_docs(state: dict[str, Any], name: str) -> list[dict[str, Any]]:
    return [
        file
        for file in state.get("files") or []
        if file.get("type") == "document"
        and not file.get("trashed")
        and norm(file.get("name")) == norm(name)
    ]


def evaluate(expected: dict[str, Any], state: dict[str, Any], state_err: str = "") -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    if state_err:
        return [check("mock_state_readable", False, state_err)]
    checks.append(check("mock_state_readable", True, "state fetched"))

    files = [f for f in state.get("files") or [] if f.get("type") == "document" and not f.get("trashed")]
    title = expected["summary_title"]
    summary_matches = find_docs(state, title)
    checks.append(
        check(
            "summary_doc_unique",
            len(summary_matches) == 1,
            f"expected one summary doc, got {len(summary_matches)}",
        )
    )
    summary = summary_matches[0] if len(summary_matches) == 1 else {}
    summary_text = document_text(summary)

    required_terms = [
        "# Feed QA Weekly Summary 2026-W22",
        "Total qualifying issues: 4",
        "BAD_LANDING_PAGE: 2",
        "MISSING_MAIN_IMAGE: 2",
        "Next step: remediation before the next feed submission.",
    ]
    for term in required_terms:
        present = term in summary_text
        checks.append(
            check(
                f"summary_contains:{term[:36]}",
                present,
                "present" if present else f"missing {term!r}",
            )
        )

    for item in expected.get("qualifying", []):
        line_terms = [
            item["sku"],
            f"{item['market']} / {item['channel']}",
            item["issue_code"],
            item["expected_action"],
        ]
        missing = [term for term in line_terms if term not in summary_text]
        checks.append(
            check(
                f"summary_has_qualifying:{item['sku']}",
                not missing,
                "all terms present" if not missing else f"missing terms {missing}",
            )
        )

    for item in expected.get("excluded", []):
        checks.append(
            check(
                f"summary_excludes:{item['sku']}",
                item["sku"] not in summary_text,
                "excluded SKU should not appear in summary",
            )
        )

    imgs = image_blocks(summary)
    checks.append(check("summary_has_uploaded_image_block", len(imgs) >= 1, f"image blocks: {len(imgs)}"))
    checks.append(
        check(
            "summary_uploaded_image_is_svg_upload",
            any(is_uploaded_status_image(block) for block in imgs),
            "status image uploaded as SVG data URL",
        )
    )

    required_comment = expected["required_comment"]
    for item in expected.get("qualifying", []):
        docs = find_docs(state, f"QA: {item['sku']}")
        matched = matching_comments(docs[0], required_comment) if len(docs) == 1 else []
        ok = bool(matched)
        checks.append(
            check(
                f"qualifying_comment:{item['sku']}",
                ok,
                "required comment present" if ok else "required comment missing",
            )
        )
        expected_block_id = item.get("comment_block_id")
        anchor_ok = any(
            comment.get("blockId") == expected_block_id
            and isinstance(comment.get("anchorTop"), (int, float))
            for comment in matched
        )
        checks.append(
            check(
                f"qualifying_comment_anchor:{item['sku']}",
                anchor_ok,
                f"comment should be anchored to {expected_block_id}",
            )
        )
        source_text = document_text(docs[0]) if len(docs) == 1 else ""
        checks.append(
            check(
                f"qualifying_source_body_unchanged:{item['sku']}",
                source_text == expected_source_text(item),
                "source body should remain unchanged",
            )
        )

    for item in expected.get("excluded", []):
        docs = find_docs(state, f"QA: {item['sku']}")
        comment_count = len(docs[0].get("comments") or []) if len(docs) == 1 else -1
        checks.append(
            check(
                f"excluded_uncommented:{item['sku']}",
                comment_count == 0,
                f"comment count {comment_count}",
            )
        )
        source_text = document_text(docs[0]) if len(docs) == 1 else ""
        checks.append(
            check(
                f"excluded_source_body_unchanged:{item['sku']}",
                source_text == expected_source_text(item),
                "excluded source body should remain unchanged",
            )
        )

    expected_count = expected.get("expected_file_count_after_completion")
    if expected_count is not None:
        checks.append(
            check(
                "no_extra_documents_created",
                len(files) == int(expected_count),
                f"expected {expected_count} active documents, got {len(files)}",
            )
        )

    return checks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    parser.add_argument("--mock-url", default=os.environ.get("MOCK_SITE_URL", ""))
    parser.add_argument("--verifier-token", default=os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier"))
    args = parser.parse_args()

    task_dir = Path(args.task_dir)
    reward_json = Path(args.reward_json)
    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    token = args.verifier_token
    mock_url = args.mock_url.rstrip("/")

    state_err = ""
    state: dict[str, Any] = {}
    if not mock_url:
        state_err = "MOCK_SITE_URL not set"
    elif not token:
        state_err = "MOCK_VERIFIER_TOKEN not set"
    else:
        try:
            state = fetch_state(mock_url, token)
        except Exception as exc:  # noqa: BLE001
            state_err = f"failed to fetch mock state: {exc}"

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
        "passed": passed,
    }
    reward_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
