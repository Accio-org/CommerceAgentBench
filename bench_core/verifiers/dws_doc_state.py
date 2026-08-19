"""Deterministic state verifier for DWS Doc CLI runtime-mock dev tasks.

Checks the final DWS mock state (documents, blocks, comments) against
expected_answer.json. Reuses the same check format as notion_cli_state.py:

  {
    "checks": [
      {
        "id": "unique_check_name",
        "entity": "documents",
        "match": {"name": "Some Doc Title"},
        "expect": {
          "equals": {"type": "file"},
          "contains": {"content": ["substring1", "substring2"]},
          "count": 5
        }
      }
    ]
  }

Entity types: "documents" (matched by nodeId/name/type).
Check operators: equals, contains, count, absent, min, max.
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.request
from pathlib import Path
from typing import Any


def _norm(value: Any) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _fetch_json(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={"X-Mock-Verifier-Token": token},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _entity_items(state: dict[str, Any], entity: str) -> list[dict[str, Any]]:
    raw = (state.get("entities") or {}).get(entity) or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _field(item: dict[str, Any], key: str) -> Any:
    if key in item:
        return item[key]
    # nested lookup: "comments.count" → len(item["comments"])
    if "." in key:
        parts = key.split(".", 1)
        sub = item.get(parts[0])
        if parts[1] == "count" and isinstance(sub, (list, dict)):
            return len(sub)
        if isinstance(sub, dict):
            return sub.get(parts[1])
    return None


def _match_item(item: dict[str, Any], match: dict[str, Any]) -> bool:
    for key, want in match.items():
        got = _field(item, key)
        if isinstance(want, str):
            if _norm(got) != _norm(want):
                return False
        elif got != want:
            return False
    return True


def _check_expected(
    item: dict[str, Any] | None, expect: dict[str, Any]
) -> tuple[bool, str]:
    if expect.get("absent"):
        return (item is None, "expected absent" if item else "absent as expected")
    if item is None:
        return False, "no matching entity found"

    for key, want in (expect.get("equals") or {}).items():
        got = _field(item, key)
        if isinstance(want, str):
            if _norm(got) != _norm(want):
                return False, f"{key}: expected {want!r}, got {got!r}"
        elif isinstance(want, bool):
            if bool(got) != want:
                return False, f"{key}: expected {want!r}, got {got!r}"
        elif got != want:
            return False, f"{key}: expected {want!r}, got {got!r}"

    for key, terms in (expect.get("contains") or {}).items():
        got = str(_field(item, key) or "")
        required = terms if isinstance(terms, list) else [terms]
        missing = [term for term in required if str(term) not in got]
        if missing:
            return False, f"{key}: missing terms {missing}"

    for key, want in (expect.get("not_contains") or {}).items():
        got = str(_field(item, key) or "")
        forbidden = want if isinstance(want, list) else [want]
        found = [term for term in forbidden if str(term) in got]
        if found:
            return False, f"{key}: should not contain {found}"

    for key, want in (expect.get("min") or {}).items():
        got = _field(item, key)
        try:
            if float(got) < float(want):
                return False, f"{key}: expected >= {want}, got {got}"
        except (TypeError, ValueError):
            return False, f"{key}: expected numeric >= {want}, got {got!r}"

    for key, want in (expect.get("max") or {}).items():
        got = _field(item, key)
        try:
            if float(got) > float(want):
                return False, f"{key}: expected <= {want}, got {got}"
        except (TypeError, ValueError):
            return False, f"{key}: expected numeric <= {want}, got {got!r}"

    return True, "matched"


def _run_check(
    check: dict[str, Any], state: dict[str, Any]
) -> dict[str, Any]:
    entity = str(check.get("entity") or "documents")
    match = check.get("match") or {}
    items = _entity_items(state, entity)
    matches = [item for item in items if _match_item(item, match)]
    expect = check.get("expect") or {}

    if "count" in expect:
        got = len(matches)
        want = int(expect["count"])
        passed = got == want
        reason = f"expected count {want}, got {got}"
    else:
        item = matches[0] if len(matches) == 1 else None
        if len(matches) > 1 and not expect.get("absent"):
            passed = False
            reason = f"expected one match, got {len(matches)}"
        else:
            passed, reason = _check_expected(item, expect)

    return {
        "id": str(check.get("id") or f"{entity}:{match}"),
        "passed": bool(passed),
        "reason": reason[:500],
        "check_type": "deterministic_exact",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    parser.add_argument("--mock-url", default=os.environ.get("MOCK_SITE_URL", ""))
    args = parser.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    reward_json = Path(args.reward_json)
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "")
    mock_url = args.mock_url.rstrip("/")
    expected = json.loads(
        (task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig")
    )

    checks: list[dict[str, Any]] = []
    state: dict[str, Any] = {}
    if not mock_url:
        checks.append(
            {"id": "mock_url_present", "passed": False, "reason": "MOCK_SITE_URL missing"}
        )
    elif not token:
        checks.append(
            {"id": "verifier_token_present", "passed": False, "reason": "MOCK_VERIFIER_TOKEN missing"}
        )
    else:
        try:
            state = _fetch_json(f"{mock_url}/api/state", token)
            checks.append({"id": "mock_state_readable", "passed": True, "reason": "state fetched"})
        except Exception as exc:
            checks.append(
                {"id": "mock_state_readable", "passed": False, "reason": str(exc)[:500]}
            )

    if state:
        checks.extend(
            _run_check(check, state) for check in expected.get("checks", [])
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "dws_final_state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    passed = sum(1 for check in checks if check.get("passed"))
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
    reward_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {"score": score, "checks_passed": passed, "checks_total": total, "passed": payload["passed"]}
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
