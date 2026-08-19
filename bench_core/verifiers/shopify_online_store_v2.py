"""Deterministic verifier for ``shopify_online_store_v2`` events-stream mock.

The v2 mock has no sessions — instead it exposes:

- ``GET /api/state``         -> ``{saved, draft, events, dirty}`` (verifier-token exempt)
- ``GET /__bench/state``     -> ``{state{counts,products,...}, events}`` (Bearer token)

Pages/menus/products/etc. live under ``state.saved.<key>`` (lists or dicts).
Theme settings live as nested dicts under ``state.saved.themeSettings``.
Events from every mutation are appended to ``state.events`` as
``{type, ...payload}`` dicts.

``private/expected_answer.json`` shape::

    {
      "checks": [
        {
          "id": "save_event_emitted",
          "kind": "event_present",
          "type": "ui_save_valid",
          "min_count": 1
        },
        {
          "id": "logo_uploaded",
          "kind": "path_value",
          "path": "saved.themeSettings.logo.image",
          "expect": {"pattern": "^/media/"}
        },
        {
          "id": "main_menu_has_six_items",
          "kind": "entity_match",
          "path": "saved.menus",
          "match": {"handle": "main-menu"},
          "expect": {"length_eq": {"items": 6}}
        }
      ]
    }

Declared check kinds:

* ``event_present`` — diagnostic only. The verifier reports event counts in
  ``diagnostics`` but does not include them in reward scoring.
* ``path_value`` — walks dot-path in ``state``, applies one of the matchers
  in ``expect``: ``equals`` (string casefold/strip or numeric or deep dict),
  ``pattern`` (regex), ``min``/``max`` (numeric), ``one_of`` (list),
  ``length_eq``/``length_min``/``length_max`` (when target is list/str).
* ``entity_match`` — selects ``state.<path>`` (must be a list), filters by
  ``match`` (sub-paths inside item), then on the selected item(s) asserts
  ``expect`` (same matchers as ``path_value``, plus ``absent`` and
  ``count``).

Numeric segments in dot-path index lists (``colorSchemes.0.background``).
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MISSING = object()


def _fetch_json(url: str, token: str = "") -> Any:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-Mock-Verifier-Token"] = token
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _walk(obj: Any, path: str) -> Any:
    """Resolve ``a.b.0.c`` against a nested dict/list. Returns _MISSING on miss."""
    if not path:
        return obj
    cur: Any = obj
    for raw in path.split("."):
        if cur is None:
            return _MISSING
        if isinstance(cur, list):
            try:
                idx = int(raw)
            except ValueError:
                return _MISSING
            if idx < 0 or idx >= len(cur):
                return _MISSING
            cur = cur[idx]
            continue
        if isinstance(cur, dict):
            if raw not in cur:
                return _MISSING
            cur = cur[raw]
            continue
        return _MISSING
    return cur


def _norm(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(html.unescape(str(value)).strip().casefold().split())


def _scalar_equal(actual: Any, expected: Any) -> bool:
    """``True`` when actual matches expected as scalar.

    Both ``None`` -> True. Booleans match exactly. Numbers tolerate
    numeric-string vs number. Strings are casefolded + whitespace-collapsed.
    Lists/dicts fall back to deep equality.
    """
    if expected is None:
        return actual is None
    if isinstance(expected, bool) or isinstance(actual, bool):
        return bool(actual) == bool(expected)
    if isinstance(expected, (int, float)) or _looks_numeric(expected):
        try:
            return float(actual) == float(expected)
        except (TypeError, ValueError):
            return False
    if isinstance(expected, str):
        return _norm(actual) == _norm(expected)
    if isinstance(expected, (list, dict)):
        return _deep_equal(actual, expected)
    return actual == expected


def _looks_numeric(value: Any) -> bool:
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        try:
            float(value)
            return True
        except ValueError:
            return False
    return False


def _deep_equal(a: Any, b: Any) -> bool:
    """Subset-tolerant equality.

    Dict: every key in ``b`` must be present in ``a`` with deep-equal value
    (``a`` may have extra keys). List: same length, element-wise deep-equal
    in the listed order.
    """
    if isinstance(a, dict) and isinstance(b, dict):
        for k, v in b.items():
            if k not in a:
                return False
            if not _deep_equal(a[k], v):
                return False
        return True
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        return all(_deep_equal(x, y) for x, y in zip(a, b))
    return _scalar_equal(a, b)


def _length(value: Any) -> int | None:
    try:
        return len(value)
    except TypeError:
        return None


# ---------------------------------------------------------------------------
# Matcher application
# ---------------------------------------------------------------------------

def _apply_matchers(value: Any, expect: dict[str, Any]) -> tuple[bool, str]:
    """Apply each matcher in ``expect``. Returns (passed, first failure reason)."""
    if "absent" in expect:
        absent = bool(expect["absent"])
        present = value is not _MISSING and value is not None
        if absent and present:
            return False, f"expected absent, got {_short(value)!r}"
        if not absent and not present:
            return False, "expected present, got missing"
        if absent:
            return True, "absent as expected"

    if value is _MISSING:
        if not expect:
            return True, "no matchers"
        return False, "value missing"

    if "equals" in expect:
        want = expect["equals"]
        if isinstance(want, dict):
            for sub_path, sub_expected in want.items():
                got = _walk(value, sub_path) if isinstance(value, (dict, list)) else _MISSING
                if got is _MISSING:
                    return False, f"equals.{sub_path}: missing"
                if not _scalar_equal(got, sub_expected):
                    return False, f"equals.{sub_path}: expected {_short(sub_expected)!r}, got {_short(got)!r}"
        else:
            if not _scalar_equal(value, want):
                return False, f"equals: expected {_short(want)!r}, got {_short(value)!r}"

    if "pattern" in expect:
        s = str(value or "")
        if not re.search(expect["pattern"], s):
            return False, f"pattern {expect['pattern']!r} not in {_short(s)!r}"

    if "contains" in expect:
        terms = expect["contains"]
        if isinstance(terms, str):
            terms = [terms]
        if isinstance(value, list):
            missing = [t for t in terms if t not in value]
        else:
            s = str(value or "")
            missing = [t for t in terms if str(t) not in s]
        if missing:
            return False, f"contains: missing {missing!r}"

    if "min" in expect:
        bounds = expect["min"]
        if isinstance(bounds, dict):
            for sub_path, threshold in bounds.items():
                got = _walk(value, sub_path) if isinstance(value, (dict, list)) else value
                ok, reason = _check_min(got, threshold, label=f"min.{sub_path}")
                if not ok:
                    return False, reason
        else:
            ok, reason = _check_min(value, bounds, label="min")
            if not ok:
                return False, reason

    if "max" in expect:
        bounds = expect["max"]
        if isinstance(bounds, dict):
            for sub_path, threshold in bounds.items():
                got = _walk(value, sub_path) if isinstance(value, (dict, list)) else value
                ok, reason = _check_max(got, threshold, label=f"max.{sub_path}")
                if not ok:
                    return False, reason
        else:
            ok, reason = _check_max(value, bounds, label="max")
            if not ok:
                return False, reason

    if "one_of" in expect:
        choices = expect["one_of"]
        if not any(_scalar_equal(value, c) for c in choices):
            return False, f"one_of: {_short(value)!r} not in {choices!r}"

    if "length_eq" in expect:
        ok, reason = _check_length(value, expect["length_eq"], "length_eq", "==")
        if not ok:
            return False, reason
    if "length_min" in expect:
        ok, reason = _check_length(value, expect["length_min"], "length_min", ">=")
        if not ok:
            return False, reason
    if "length_max" in expect:
        ok, reason = _check_length(value, expect["length_max"], "length_max", "<=")
        if not ok:
            return False, reason

    return True, "matched"


def _check_min(value: Any, threshold: Any, *, label: str) -> tuple[bool, str]:
    try:
        f = float(value)
        t = float(threshold)
    except (TypeError, ValueError):
        return False, f"{label}: expected numeric >= {threshold!r}, got {_short(value)!r}"
    if f < t:
        return False, f"{label}: expected >= {threshold}, got {f}"
    return True, ""


def _check_max(value: Any, threshold: Any, *, label: str) -> tuple[bool, str]:
    try:
        f = float(value)
        t = float(threshold)
    except (TypeError, ValueError):
        return False, f"{label}: expected numeric <= {threshold!r}, got {_short(value)!r}"
    if f > t:
        return False, f"{label}: expected <= {threshold}, got {f}"
    return True, ""


def _check_length(value: Any, want: Any, label: str, op: str) -> tuple[bool, str]:
    """``want`` may be int (length of value) or dict (per-sub-path length)."""
    if isinstance(want, dict):
        for sub_path, target in want.items():
            sub = _walk(value, sub_path) if isinstance(value, (dict, list)) else _MISSING
            if sub is _MISSING:
                return False, f"{label}.{sub_path}: missing"
            n = _length(sub)
            if n is None:
                return False, f"{label}.{sub_path}: not list/str ({type(sub).__name__})"
            target_n = int(target)
            if op == "==" and n != target_n:
                return False, f"{label}.{sub_path}: expected {target_n}, got {n}"
            if op == ">=" and n < target_n:
                return False, f"{label}.{sub_path}: expected >= {target_n}, got {n}"
            if op == "<=" and n > target_n:
                return False, f"{label}.{sub_path}: expected <= {target_n}, got {n}"
        return True, ""
    n = _length(value)
    if n is None:
        return False, f"{label}: not list/str ({type(value).__name__})"
    target_n = int(want)
    if op == "==" and n != target_n:
        return False, f"{label}: expected {target_n}, got {n}"
    if op == ">=" and n < target_n:
        return False, f"{label}: expected >= {target_n}, got {n}"
    if op == "<=" and n > target_n:
        return False, f"{label}: expected <= {target_n}, got {n}"
    return True, ""


def _short(value: Any) -> str:
    if isinstance(value, (dict, list)):
        s = json.dumps(value, ensure_ascii=False, default=str)
    else:
        s = str(value)
    return s if len(s) <= 80 else s[:77] + "..."


# ---------------------------------------------------------------------------
# Per-check evaluators
# ---------------------------------------------------------------------------

def _event_present_diagnostic(check: dict[str, Any], events: list[Any]) -> dict[str, Any]:
    want_type = check.get("type")
    where = check.get("where") or {}
    min_count = int(check.get("min_count", 1))
    if not want_type:
        return {
            "id": str(check.get("id") or "unnamed"),
            "type": "",
            "where": where,
            "matched": 0,
            "min_count": min_count,
            "configured": False,
        }
    matched = []
    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        if ev.get("type") != want_type:
            continue
        ok = True
        for sub_path, want in where.items():
            got = _walk(ev, sub_path)
            if not _scalar_equal(got, want):
                ok = False
                break
        if ok:
            matched.append(ev)
    return {
        "id": str(check.get("id") or "unnamed"),
        "type": want_type,
        "where": where,
        "matched": len(matched),
        "min_count": min_count,
        "configured": True,
    }


def _check_path_value(check: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    path = check.get("path")
    if not path:
        return _check_record(check, False, "path_value requires a 'path' field")
    value = _walk(state, path)
    expect = check.get("expect") or {}
    passed, reason = _apply_matchers(value, expect)
    return _check_record(
        check,
        passed,
        f"path={path} {reason}".strip(),
    )


def _check_entity_match(check: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    path = check.get("path")
    if not path:
        return _check_record(check, False, "entity_match requires a 'path' field")
    items = _walk(state, path)
    if items is _MISSING:
        items = []
    if not isinstance(items, list):
        return _check_record(check, False, f"entity_match path {path!r} is not a list")
    match = check.get("match") or {}
    selected = []
    for item in items:
        if not isinstance(item, dict):
            continue
        ok = True
        for sub_path, want in match.items():
            got = _walk(item, sub_path)
            if not _scalar_equal(got, want):
                ok = False
                break
        if ok:
            selected.append(item)

    expect = check.get("expect") or {}
    if "count" in expect:
        target = int(expect["count"])
        if len(selected) != target:
            return _check_record(
                check,
                False,
                f"path={path} match={match} expected count {target}, got {len(selected)}",
            )
        return _check_record(check, True, f"count={target} matched")

    if expect.get("absent"):
        return _check_record(
            check,
            len(selected) == 0,
            f"path={path} match={match} found {len(selected)} (want 0)",
        )

    if not selected:
        return _check_record(check, False, f"path={path} match={match} no matches")
    if len(selected) > 1 and not expect.get("multi_ok"):
        return _check_record(
            check,
            False,
            f"path={path} match={match} expected one, got {len(selected)}",
        )
    target_item = selected[0]
    passed, reason = _apply_matchers(target_item, expect)
    return _check_record(
        check,
        passed,
        f"path={path} match={match} {reason}".strip(),
    )


def _check_record(check: dict[str, Any], passed: bool, reason: str) -> dict[str, Any]:
    return {
        "id": str(check.get("id") or "unnamed"),
        "passed": bool(passed),
        "reason": reason[:400],
        "check_type": "deterministic_exact",
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def verify(
    *,
    task_dir: Path,
    output_dir: Path,
    reward_json: Path,
    mock_url: str,
    verifier_token: str = "",
) -> dict[str, Any]:
    expected_path = task_dir / "private" / "expected_answer.json"
    if not expected_path.is_file():
        return _emit(reward_json, task_dir.name, [
            _check_record({"id": "expected_answer_loaded"}, False, "missing private/expected_answer.json"),
        ])
    expected_data = json.loads(expected_path.read_text(encoding="utf-8-sig"))
    declared = expected_data.get("checks") or []

    checks: list[dict[str, Any]] = []
    state: dict[str, Any] = {}
    if not mock_url:
        checks.append(_check_record({"id": "mock_url_present"}, False, "MOCK_SITE_URL/MOCK_URL missing"))
        return _emit(reward_json, task_dir.name, checks)

    try:
        state = _fetch_json(f"{mock_url.rstrip('/')}/api/state", verifier_token)
        checks.append(_check_record({"id": "mock_state_readable"}, True, "fetched /api/state"))
    except (urllib.error.URLError, json.JSONDecodeError, OSError) as exc:
        checks.append(_check_record({"id": "mock_state_readable"}, False, f"{exc}"))
        return _emit(reward_json, task_dir.name, checks)

    bench_state: dict[str, Any] = {}
    if verifier_token:
        try:
            bench_state = _fetch_json(f"{mock_url.rstrip('/')}/__bench/state", verifier_token) or {}
        except (urllib.error.URLError, json.JSONDecodeError, OSError):
            bench_state = {}

    events = state.get("events") or []
    if not isinstance(events, list):
        events = []

    eval_state = {
        "saved": state.get("saved") or {},
        "draft": state.get("draft") or {},
        "events": events,
        "dirty": state.get("dirty"),
        "bench": bench_state.get("state") or {},
    }

    diagnostics: dict[str, Any] = {"event_present": []}
    for check in declared:
        kind = str(check.get("kind") or "path_value")
        if kind == "event_present":
            diagnostics["event_present"].append(_event_present_diagnostic(check, events))
        elif kind == "entity_match":
            checks.append(_check_entity_match(check, eval_state))
        elif kind == "path_value":
            checks.append(_check_path_value(check, eval_state))
        else:
            checks.append(_check_record(check, False, f"unsupported check kind {kind!r}"))

    if output_dir and Path(output_dir).is_dir():
        try:
            (Path(output_dir) / "shopify_v2_final_state.json").write_text(
                json.dumps(eval_state, ensure_ascii=False, indent=2, default=str) + "\n",
                encoding="utf-8",
            )
        except OSError:
            pass

    return _emit(reward_json, task_dir.name, checks, diagnostics=diagnostics)


def _emit(reward_json: Path, task_id: str, checks: list[dict[str, Any]], diagnostics: dict[str, Any] | None = None) -> dict[str, Any]:
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_id,
        "score": score,
        "reward": score,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "validation_checks": checks,
        "diagnostics": diagnostics or {},
        "passed": total > 0 and passed == total,
        "source": "v2_shopify_online_store",
    }
    reward_json.parent.mkdir(parents=True, exist_ok=True)
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("score", "checks_passed", "checks_total", "passed")}))
    return payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    ap.add_argument("--mock-url", default=os.environ.get("MOCK_SITE_URL", os.environ.get("MOCK_URL", "")))
    args = ap.parse_args()

    verify(
        task_dir=Path(args.task_dir),
        output_dir=Path(args.output_dir),
        reward_json=Path(args.reward_json),
        mock_url=args.mock_url,
        verifier_token=os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier"),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
