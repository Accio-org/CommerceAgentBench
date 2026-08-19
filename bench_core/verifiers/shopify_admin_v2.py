"""v2 shared host-side verifier for shopify_admin mock tasks.

Mirrors alibaba_publish_v2 — each expected field is one atomic deterministic_exact
check; structural checks for session_exists / state_readable / session_submitted /
mock_submit_via_legitimate_path / each required file slot uploaded.

Page-aware: GET /api/sessions returns both `product` and `theme` sessions; we
filter by expected_answer.json.page (default: 'product').

private/expected_answer.json shape::

    {
      "page": "product" | "theme",                  // required
      "expected_fields": {...},                     // each entry → one atomic check
      "required_files": ["media_1", ...],           // optional
      "image_selection": {                          // optional
        "correct_files": [...], "acceptable_files": [...], "wrong_files": [...]
      },
      "json_fields": [...]                          // optional, auto-detected
    }
"""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Any


PRODUCT_FILE_FIELDS = [f"media_{i}" for i in range(1, 6)] + ["media_video"]
THEME_FILE_FIELDS = ["heroImage", "logo"]


def _headers(verifier_token: str) -> dict:
    h = {"Accept": "application/json"}
    if verifier_token:
        h["X-Mock-Verifier-Token"] = verifier_token
    return h


def _api_get(base: str, path: str, verifier_token: str = "") -> Any:
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, headers=_headers(verifier_token))
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _find_session(base: str, verifier_token: str, page: str | None) -> tuple[str | None, str | None]:
    try:
        sessions = _api_get(base, "/api/sessions", verifier_token)
    except Exception:
        return None, None
    if not isinstance(sessions, list):
        sessions = sessions.get("sessions") or sessions.get("data") or [] if isinstance(sessions, dict) else []
    if not sessions:
        return None, None

    def _filter(items: list[dict], wanted: str | None) -> list[dict]:
        if not wanted:
            return [s for s in items if isinstance(s, dict)]
        return [s for s in items if isinstance(s, dict) and s.get("page") == wanted]

    page_sessions = _filter(sessions, page) or _filter(sessions, None)
    # Prefer submitted > active > most recent
    for s in page_sessions:
        if s.get("status") == "submitted":
            return s.get("id"), s.get("page") or page
    for s in page_sessions:
        if s.get("status") == "active":
            return s.get("id"), s.get("page") or page
    if page_sessions:
        return page_sessions[0].get("id"), page_sessions[0].get("page") or page
    return None, None


def _check(check_id: str, passed: bool, reason: str = "", check_type: str = "deterministic_exact") -> dict:
    return {"id": check_id, "passed": bool(passed), "reason": reason[:300], "check_type": check_type}


def _compare(actual: Any, expected: Any, is_json: bool = False) -> bool:
    if actual is None and expected is None:
        return True
    if is_json:
        try:
            a = json.loads(actual) if isinstance(actual, str) else actual
            e = json.loads(expected) if isinstance(expected, str) else expected
            return _deep_eq(a, e)
        except Exception:
            return False
    return str(actual).strip() == str(expected).strip()


def _deep_eq(a: Any, b: Any) -> bool:
    """Compare actual (a) against expected (b) with subset-tolerant dict match.

    Dict semantics: every key in *expected* must be present in *actual* with an
    equal value, but *actual* may have additional keys. This lets the mock-side
    UI legitimately attach per-row metadata (e.g. per-variant ``price``/``sku``/
    ``quantity`` on Shopify products) without breaking grading when
    expected_answer.json only specifies the discriminating keys (``options``).

    List semantics: same length, and every expected element must match some
    actual element exactly once (set-like, but stable consumption).
    """
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        used: set[int] = set()
        for be in b:
            picked = None
            for i, ae in enumerate(a):
                if i in used:
                    continue
                if _deep_eq(ae, be):
                    picked = i
                    break
            if picked is None:
                return False
            used.add(picked)
        return True
    if isinstance(a, dict) and isinstance(b, dict):
        for k, v in b.items():
            if k not in a:
                return False
            if not _deep_eq(a[k], v):
                return False
        return True
    return a == b


def verify(
    task_dir: Path,
    output_dir: Path,
    reward_json: Path,
    mock_url: str,
) -> dict:
    task_dir = Path(task_dir)
    output_dir = Path(output_dir)
    reward_json = Path(reward_json)
    verifier_token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    expected_path = task_dir / "private" / "expected_answer.json"
    if not expected_path.exists():
        legacy = task_dir / "private" / "grading_truth.json"
        if legacy.exists():
            legacy_data = json.loads(legacy.read_text(encoding="utf-8-sig"))
            expected_data = {
                "page": legacy_data.get("page", "product"),
                "expected_fields": legacy_data.get("expected", {}),
                "required_files": legacy_data.get("required_files") or [],
                "image_selection": legacy_data.get("image_selection"),
                "json_fields": [],
            }
        else:
            return _emit(reward_json, task_dir.name, [_check("expected_answer_loaded", False, "missing private/expected_answer.json")])
    else:
        expected_data = json.loads(expected_path.read_text(encoding="utf-8-sig"))

    page = expected_data.get("page", "product")
    expected_fields: dict = expected_data.get("expected_fields") or {}
    required_files: list = expected_data.get("required_files") or (
        ["media_1"] if page == "product" else ["heroImage"]
    )
    image_selection = expected_data.get("image_selection")
    json_field_names = set(expected_data.get("json_fields") or [])
    for k, v in expected_fields.items():
        if isinstance(v, str) and v.startswith(("[", "{")):
            try:
                json.loads(v)
                json_field_names.add(k)
            except Exception:
                pass

    checks: list[dict] = []
    fields: dict = {}
    status: str | None = None
    access_log: list = []

    session_id, _ = _find_session(mock_url, verifier_token, page)
    checks.append(_check("session_exists", session_id is not None,
                         f"page={page} session_id={(session_id or '')[:16]}"))

    if session_id:
        state_ok = False
        try:
            state = _api_get(mock_url, f"/api/state/{session_id}", verifier_token)
            state_ok = True
            fields = state.get("fields") or {}
            status = state.get("status")
        except Exception as exc:
            checks.append(_check("session_state_readable", False, f"{exc}"))
        if state_ok:
            checks.append(_check("session_state_readable", True))
        try:
            access_log = _api_get(mock_url, "/api/access-log", verifier_token)
            if not isinstance(access_log, list):
                access_log = []
        except Exception:
            access_log = []
    else:
        checks.append(_check("session_state_readable", False, "no session"))

    checks.append(_check("session_submitted", status == "submitted", f"status={status}"))

    # mock integrity — ui_submit_valid for this session
    valid_submits = [
        e for e in access_log
        if e.get("event") == "ui_submit_valid" and e.get("sessionId") == session_id
    ] if session_id else []
    checks.append(_check(
        "mock_submit_via_legitimate_path",
        bool(valid_submits),
        f"need ui_submit_valid event for this session, found {len(valid_submits)}",
    ))

    # File uploads
    if image_selection:
        correct = set(image_selection.get("correct_files") or [])
        acceptable = set(image_selection.get("acceptable_files") or [])
        wrong = set(image_selection.get("wrong_files") or [])
        for slot in required_files:
            v = (fields.get(slot) or {}).get("value", "")
            base = v.split("/")[-1] if v else ""
            ok = bool(base) and (base in correct or base in acceptable) and base not in wrong
            checks.append(_check(
                f"image_{slot}_correct_file",
                ok,
                f"slot={slot} value={base!r}",
            ))
    else:
        for slot in required_files:
            f = fields.get(slot, {})
            uploaded = bool(f.get("value") or f.get("filePath"))
            checks.append(_check(
                f"{slot}_uploaded",
                uploaded,
                f"slot={slot} value={(f.get('value') or '')[:80]!r}",
            ))

    for field_name, expected_val in expected_fields.items():
        actual = (fields.get(field_name) or {}).get("value", "")
        is_json = field_name in json_field_names
        ok = _compare(actual, expected_val, is_json=is_json)
        snippet = (str(actual)[:80] + ("..." if len(str(actual)) > 80 else "")) if actual != "" else "(empty)"
        checks.append(_check(
            f"field_{field_name}_correct",
            ok,
            f"got={snippet}",
        ))

    if output_dir.is_dir():
        try:
            (output_dir / "mock_shopify_admin_final_state.json").write_text(
                json.dumps({"session_id": session_id, "page": page, "fields": fields}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError:
            pass

    return _emit(reward_json, task_dir.name, checks)


def _emit(reward_json: Path, task_id: str, checks: list[dict]) -> dict:
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_id,
        "score": score,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "reward": score,
        "passed": passed == total,
        "source": "v2_shopify_admin",
    }
    reward_json.parent.mkdir(parents=True, exist_ok=True)
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("score", "checks_passed", "checks_total")}))
    return payload
