from __future__ import annotations

import argparse
import json
import os
import urllib.request
from pathlib import Path
from typing import Any

from bench_core.verifiers.alibaba_publish_v2 import GROUP_ORDER, group_for
from bench_core.verifiers.form_value_normalize import compare_form_value

FILE_CHECK_PREFIX = 'image'
FILE_SELECTION_KEY = 'image_selection'
SOURCE = 'portable_projector_direct_v2_verifier'


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def verifier_headers(verifier_token: str) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if verifier_token:
        headers["X-Mock-Verifier-Token"] = verifier_token
    return headers


def api_get(base: str, path: str, verifier_token: str = "") -> Any:
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, headers=verifier_headers(verifier_token))
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def check(checks: list[dict[str, Any]], check_id: str, passed: bool, reason: str = "") -> None:
    checks.append({
        "id": check_id,
        "passed": bool(passed),
        "reason": str(reason)[:300],
        "check_type": "deterministic_exact",
    })


def fold(checks: list[dict[str, Any]], check_id: str, atoms: list[tuple[str, bool, str]]) -> None:
    """Fold atomic ``(name, passed, note)`` results into one capability check.

    Pure aggregation (R3/R4 of docs/check-granularity.md): ``passed = all atoms
    pass`` — identical to the AND of the old per-atom checks, so binary pass is
    unchanged and only capacity (passed/total) de-inflates. The per-atom
    validation expressions are untouched; every failing member is listed in the
    ``reason`` so diagnosability is preserved.
    """
    total = len(atoms)
    failed = [a for a in atoms if not a[1]]
    npass = total - len(failed)
    if not failed:
        reason = f"{npass}/{total} ok"
    else:
        parts = [a[0] + (f"[{a[2]}]" if a[2] else "") for a in failed]
        reason = f"{npass}/{total} ok; FAILED: " + "; ".join(parts)
    check(checks, check_id, not failed, reason)


def deep_equal(actual: Any, expected: Any) -> bool:
    if isinstance(actual, str) and actual.strip().startswith(("[", "{")):
        try:
            actual = json.loads(actual)
        except Exception:
            pass
    if isinstance(expected, str) and expected.strip().startswith(("[", "{")):
        try:
            expected = json.loads(expected)
        except Exception:
            pass
    if isinstance(actual, list) and isinstance(expected, list):
        if len(actual) != len(expected):
            return False
        unmatched = list(expected)
        for item in actual:
            for idx, other in enumerate(unmatched):
                if deep_equal(item, other):
                    unmatched.pop(idx)
                    break
            else:
                return False
        return not unmatched
    if isinstance(actual, dict) and isinstance(expected, dict):
        return set(actual) == set(expected) and all(deep_equal(actual[k], expected[k]) for k in actual)
    return actual == expected


def value_from_field(raw: Any) -> Any:
    if isinstance(raw, dict):
        if "value" in raw:
            return raw.get("value")
        if "filePath" in raw:
            return raw.get("filePath")
    return raw


def compare_value(field_name: str, actual: Any, expected: Any, *, as_json: bool) -> bool:
    actual = value_from_field(actual)
    return compare_form_value(field_name, actual, expected, as_json=as_json)


def find_session_id(mock_url: str, verifier_token: str) -> tuple[str | None, tuple[str, bool, str]]:
    """Return ``(session_id, session_exists_atom)``.

    The ``session_exists`` predicate is unchanged from before; it is now returned
    as a foldable atom (``(name, passed, reason)``) instead of being appended
    directly, so the plumbing folds into ``setup_gate`` (R2).
    """
    try:
        sessions = api_get(mock_url, "/api/sessions", verifier_token)
    except Exception as exc:
        return None, ("session_exists", False, f"cannot read sessions: {exc}")
    if isinstance(sessions, dict):
        sessions = sessions.get("sessions") or sessions.get("data") or []
    if not isinstance(sessions, list) or not sessions:
        return None, ("session_exists", False, "no sessions")
    submitted = [s for s in sessions if isinstance(s, dict) and s.get("status") == "submitted"]
    pool = submitted or [s for s in sessions if isinstance(s, dict)]
    pool.sort(key=lambda s: s.get("updatedAt") or s.get("createdAt") or "", reverse=True)
    sid = str(pool[0].get("id") or pool[0].get("sessionId") or "") if pool else ""
    return (sid or None), ("session_exists", bool(sid), f"session_id={sid[:16] if sid else 'missing'}")


def emit(reward_json: Path, task_id: str, checks: list[dict[str, Any]]) -> dict[str, Any]:
    passed = sum(1 for c in checks if c.get("passed"))
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_id,
        "source": SOURCE,
        "reward": score,
        "score": score,
        "passed": total > 0 and passed == total,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "summary": f"{passed}/{total} checks passed",
    }
    reward_json.parent.mkdir(parents=True, exist_ok=True)
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": score, "checks_passed": passed, "checks_total": total}, ensure_ascii=False))
    return payload


def verify(task_dir: Path, output_dir: Path, reward_json: Path, mock_url: str) -> dict[str, Any]:
    # Capacity granularity (docs/check-granularity.md): plumbing folds into one
    # setup_gate (R2); image upload is one capability; field accuracy folds into
    # the canonical alibaba_publish capability buckets (R3 same-skill trivia /
    # R4 distinct skills) via the shared FIELD_GROUPS map (R7 — one cluster-wide
    # bucket scheme). Every per-atom predicate below is unchanged; only the
    # emission is aggregated, so binary pass (score==1.0) is identical and only
    # capacity de-inflates. Per-atom failures surface in each bucket's reason.
    expected = read_json(task_dir / "private" / "expected_answer.json")
    checks: list[dict[str, Any]] = []
    verifier_token = os.environ.get("MOCK_VERIFIER_TOKEN", "")
    session_id, session_exists_atom = find_session_id(mock_url, verifier_token)

    fields: dict[str, Any] = {}
    files: dict[str, Any] = {}
    access_log: list[Any] = []
    status: Any = None

    if session_id:
        try:
            fetched = api_get(mock_url, f"/api/state/{session_id}", verifier_token)
            if isinstance(fetched, dict):
                fields = fetched.get("fields") if isinstance(fetched.get("fields"), dict) else {}
                files = fetched.get("files") if isinstance(fetched.get("files"), dict) else {}
                access_log = fetched.get("access_log") if isinstance(fetched.get("access_log"), list) else []
                status = fetched.get("status")
                state_readable_atom = ("session_state_readable", True, "")
            else:
                state_readable_atom = ("session_state_readable", False, "state response is not an object")
        except Exception as exc:
            state_readable_atom = ("session_state_readable", False, str(exc))
        if not access_log:
            try:
                fetched_log = api_get(mock_url, "/api/access-log", verifier_token)
                if isinstance(fetched_log, list):
                    access_log = fetched_log
            except Exception:
                access_log = []
    else:
        state_readable_atom = ("session_state_readable", False, "no session")

    submitted_atom = ("session_submitted", status == "submitted", f"status={status!r}")
    legit = any(
        isinstance(item, dict)
        and item.get("event") == "cli_submit_valid"
        and (not item.get("sessionId") or str(item.get("sessionId")) == str(session_id))
        for item in access_log
    )
    legit_atom = ("mock_submit_via_legitimate_path", legit, "missing cli_submit_valid" if not legit else "")

    # R2: plumbing + completion-of-submit fold into one setup gate.
    fold(checks, "setup_gate", [
        session_exists_atom,
        state_readable_atom,
        submitted_atom,
        legit_atom,
    ])

    # R3: image upload (vision selection) — one capability across all required slots.
    selection = expected.get(FILE_SELECTION_KEY) or expected.get("image_selection") or {}
    correct_files = set(selection.get("correct_files") or [])
    acceptable_files = set(selection.get("acceptable_files") or [])
    wrong_files = set(selection.get("wrong_files") or [])
    allowed_files = correct_files | acceptable_files
    image_atoms: list[tuple[str, bool, str]] = []
    for slot in expected.get("required_files", []):
        raw = files.get(slot) if slot in files else fields.get(slot)
        filename = str(value_from_field(raw) or "").split("/")[-1]
        ok = bool(filename) and filename in allowed_files and filename not in wrong_files
        image_atoms.append((f"{FILE_CHECK_PREFIX}_{slot}_correct_file", ok, f"got={filename!r}"))
    if image_atoms:
        fold(checks, "images_correct", image_atoms)

    # R3/R4: field accuracy folded into capability buckets via the shared
    # alibaba_publish FIELD_GROUPS map. Each bucket = AND of its present members.
    json_fields = set(expected.get("json_fields", []))
    bucket_atoms: dict[str, list[tuple[str, bool, str]]] = {}
    for key, expected_value in expected.get("expected_fields", {}).items():
        actual = fields.get(key)
        ok = compare_value(key, actual, expected_value, as_json=key in json_fields)
        bucket_atoms.setdefault(group_for(key), []).append(
            (f"field_{key}_correct", ok, f"got={value_from_field(actual)!r}")
        )
    extras = sorted(b for b in bucket_atoms if b not in GROUP_ORDER)
    for bucket in GROUP_ORDER + extras:
        atoms = bucket_atoms.get(bucket)
        if atoms:
            fold(checks, f"{bucket}_correct", atoms)

    if output_dir.is_dir():
        try:
            (output_dir / "mock_final_state.json").write_text(
                json.dumps({"session_id": session_id, "fields": fields, "workspace": files}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError:
            pass
    return emit(reward_json, task_dir.name, checks)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    parser.add_argument("--mock-url", default=os.environ.get("MOCK_SITE_URL", "http://127.0.0.1:3000"))
    parser.add_argument("--mode", choices=["browser", "cli"], default="cli")
    args = parser.parse_args()
    verify(Path(args.task_dir), Path(args.output_dir), Path(args.reward_json), args.mock_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
