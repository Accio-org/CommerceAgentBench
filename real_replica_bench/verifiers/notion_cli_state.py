"""Deterministic state verifier for Notion CLI runtime-mock dev tasks."""
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
        headers={"Authorization": f"Bearer {token}", "X-Mock-Verifier-Token": token},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _fetch_text(url: str, token: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "X-Mock-Verifier-Token": token},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _entity_items(state: dict[str, Any], entity: str) -> list[dict[str, Any]]:
    if entity == "events":
        events = state.get("events") or []
        return events if isinstance(events, list) else []
    raw = ((state.get("entities") or {}).get(entity) or {})
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _worker_name_by_id(state: dict[str, Any]) -> dict[str, str]:
    return {str(w.get("id")): str(w.get("name") or "") for w in _entity_items(state, "workers")}


def _field(item: dict[str, Any], key: str, state: dict[str, Any]) -> Any:
    if key == "workerName":
        return _worker_name_by_id(state).get(str(item.get("workerId")), "")
    cur: Any = item
    for part in key.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _match_item(item: dict[str, Any], match: dict[str, Any], state: dict[str, Any]) -> bool:
    for key, want in match.items():
        got = _field(item, key, state)
        if isinstance(want, str):
            if _norm(got) != _norm(want):
                return False
        elif got != want:
            return False
    return True


def _check_expected(
    check: dict[str, Any],
    item: dict[str, Any] | None,
    state: dict[str, Any],
    mock_url: str,
    token: str,
) -> tuple[bool, str]:
    expect = check.get("expect") or {}
    if expect.get("absent"):
        return item is None, "expected no matching item" if item is not None else "absent as expected"
    if item is None:
        return False, "no matching item found"

    for key, want in (expect.get("equals") or {}).items():
        got = _field(item, key, state)
        if isinstance(want, str):
            if _norm(got) != _norm(want):
                return False, f"{key}: expected {want!r}, got {got!r}"
        elif got != want:
            return False, f"{key}: expected {want!r}, got {got!r}"

    for key, terms in (expect.get("contains") or {}).items():
        got = str(_field(item, key, state) or "")
        required = terms if isinstance(terms, list) else [terms]
        missing = [term for term in required if str(term) not in got]
        if missing:
            return False, f"{key}: missing terms {missing}"

    for key, want in (expect.get("min") or {}).items():
        got = _field(item, key, state)
        try:
            if float(got) < float(want):
                return False, f"{key}: expected >= {want}, got {got}"
        except (TypeError, ValueError):
            return False, f"{key}: expected numeric >= {want}, got {got!r}"

    for key, want in (expect.get("max") or {}).items():
        got = _field(item, key, state)
        try:
            if float(got) > float(want):
                return False, f"{key}: expected <= {want}, got {got}"
        except (TypeError, ValueError):
            return False, f"{key}: expected numeric <= {want}, got {got!r}"

    content_terms = expect.get("content_contains") or []
    if content_terms:
        file_id = item.get("id")
        if not file_id:
            return False, "matched file has no id"
        try:
            content = _fetch_text(f"{mock_url}/api/files/{file_id}/content", token)
        except Exception as exc:  # noqa: BLE001
            return False, f"file content unreadable: {exc}"
        missing = [term for term in content_terms if str(term) not in content]
        if missing:
            return False, f"file content missing terms {missing}"

    return True, "matched"


def _run_check(check: dict[str, Any], state: dict[str, Any], mock_url: str, token: str) -> dict[str, Any]:
    entity = str(check.get("entity") or "")
    match = check.get("match") or {}
    matches = [item for item in _entity_items(state, entity) if _match_item(item, match, state)]
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
            passed, reason = _check_expected(check, item, state, mock_url, token)
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
    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))

    checks: list[dict[str, Any]] = []
    state: dict[str, Any] = {}
    if not mock_url:
        checks.append({"id": "mock_url_present", "passed": False, "reason": "MOCK_SITE_URL missing"})
    elif not token:
        checks.append({"id": "verifier_token_present", "passed": False, "reason": "MOCK_VERIFIER_TOKEN missing"})
    else:
        try:
            state = _fetch_json(f"{mock_url}/api/state", token)
            checks.append({"id": "mock_state_readable", "passed": True, "reason": "state fetched"})
        except Exception as exc:  # noqa: BLE001
            checks.append({"id": "mock_state_readable", "passed": False, "reason": str(exc)[:500]})

    if state:
        checks.extend(_run_check(check, state, mock_url, token) for check in expected.get("checks", []))

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "notion_final_state.json").write_text(
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
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": score, "checks_passed": passed, "checks_total": total, "passed": payload["passed"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
