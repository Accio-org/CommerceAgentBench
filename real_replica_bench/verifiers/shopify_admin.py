"""Shared host-side verifier for shopify_admin mock benchmark tasks.

The mock site exposes two pages — ``product`` (Add Product, 30 fields) and
``theme`` (Online Store theme editor, 38 fields). The page is selected by the
session that the agent created in the browser; the verifier reads back the
session's ``page`` from ``/api/sessions`` so the same script handles both
families of tasks.

Scoring weights are read from ``<task_dir>/private/grading_truth.json``:
    required_completion + overall_completion + field_accuracy
    + file_upload_check + llm_judge_score

Everything else mirrors :mod:`real_replica_bench.verifiers.alibaba_publish`:
    - ``/api/sessions`` is verifier-only (X-Mock-Verifier-Token).
    - ``/api/score``, ``/api/state``, ``/api/verify`` are verifier-only.
    - ``/api/access-log`` records the events used for the ``mock_integrity``
      validation check (UI-only submit, no programmatic 403s, etc).

Invoke as::

    python3 -m real_replica_bench.verifiers.shopify_admin \\
      --task-dir <task_dir> --output-dir <out> --reward-json <out/reward.json> \\
      --mock-url http://127.0.0.1:<host_port>
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.request
from pathlib import Path
from typing import Any


PRODUCT_FILE_FIELDS = [f"media_{i}" for i in range(1, 6)] + ["media_video"]
THEME_FILE_FIELDS = ["heroImage", "logo"]


def get_file_fields(page: str) -> list[str]:
    if page == "theme":
        return THEME_FILE_FIELDS
    return PRODUCT_FILE_FIELDS


def verifier_headers(verifier_token: str) -> dict[str, str]:
    if not verifier_token:
        return {}
    return {"X-Mock-Verifier-Token": verifier_token}


def api_get(base: str, path: str, verifier_token: str = "") -> Any:
    url = f"{base.rstrip('/')}{path}"
    req = urllib.request.Request(url, method="GET", headers=verifier_headers(verifier_token))
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def api_post_json(base: str, path: str, body: dict, verifier_token: str = "") -> dict:
    url = f"{base.rstrip('/')}{path}"
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", **verifier_headers(verifier_token)}
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def find_session_id(base: str, verifier_token: str, page: str | None) -> tuple[str | None, str | None]:
    """Return ``(session_id, page)`` for the most recent session matching ``page``.

    Preference order: submitted > active > most recent. When ``page`` is
    explicitly ``None`` (no page hint from grading_truth) we fall back to
    "any" — useful for early-development debugging.
    """
    sessions = api_get(base, "/api/sessions", verifier_token)
    if not sessions or not isinstance(sessions, list):
        return None, None

    def _filter(items: list[dict], wanted_page: str | None) -> list[dict]:
        if not wanted_page:
            return [s for s in items if isinstance(s, dict)]
        return [s for s in items if isinstance(s, dict) and s.get("page") == wanted_page]

    page_sessions = _filter(sessions, page) or _filter(sessions, None)
    for s in page_sessions:
        if s.get("status") == "submitted":
            return s["id"], s.get("page") or page
    for s in page_sessions:
        if s.get("status") == "active":
            return s["id"], s.get("page") or page
    if page_sessions:
        return page_sessions[0]["id"], page_sessions[0].get("page") or page
    return None, None


def load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return default


def write_reward(
    path: Path,
    checks: dict,
    details: dict | None = None,
    threshold: float = 0.6,
    hard_fail_reason: str | None = None,
    validation_checks: list[dict[str, Any]] | None = None,
) -> None:
    raw_score = round(min(1.0, max(0.0, sum(checks.values()))), 4)
    score = 0.0 if hard_fail_reason else raw_score
    payload: dict[str, Any] = {
        "reward": score,
        "score": score,
        "passed": (not hard_fail_reason) and score >= threshold,
        "threshold": threshold,
        "source": "script",
        "checks": checks,
        "details": details or {},
    }
    if hard_fail_reason:
        payload["raw_score"] = raw_score
        payload["hard_fail_reason"] = hard_fail_reason
    if validation_checks is not None:
        payload["validation_checks"] = validation_checks
        payload["check_summary"] = {
            "passed": sum(1 for item in validation_checks if item.get("passed")),
            "total": len(validation_checks),
        }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def make_check(check_id: str, passed: bool, score: float, reason: Any = "") -> dict[str, Any]:
    return {
        "id": check_id,
        "passed": bool(passed),
        "score": round(float(score), 4),
        "reason": reason if isinstance(reason, str) else json.dumps(reason, ensure_ascii=False),
    }


def check_image_selection(fields: dict, image_selection: dict, page: str) -> dict:
    correct_set = set(image_selection.get("correct_files", []))
    acceptable_set = set(image_selection.get("acceptable_files", []))
    wrong_set = set(image_selection.get("wrong_files", []))
    all_ok = correct_set | acceptable_set

    uploaded = []
    for fname in get_file_fields(page):
        f = fields.get(fname, {})
        val = f.get("value", "")
        if val:
            uploaded.append(val)

    if not uploaded:
        return {
            "uploaded_files": [],
            "correct_count": 0,
            "wrong_count": 0,
            "total_uploaded": 0,
            "ratio": 0.0,
        }

    correct = sum(1 for u in uploaded if u in all_ok)
    wrong = sum(1 for u in uploaded if u in wrong_set)
    ratio = correct / len(uploaded) if uploaded else 0.0

    return {
        "uploaded_files": uploaded,
        "correct_count": correct,
        "wrong_count": wrong,
        "total_uploaded": len(uploaded),
        "ratio": round(ratio, 4),
    }


def score_mock_integrity(
    access_log: list[dict[str, Any]], session_id: str, verifier_token: str
) -> tuple[bool, dict[str, Any]]:
    # Server-side defenses (enum validation, UI-token gate, browser-nonce gate,
    # browser-UA gate) are the source of truth. Any write the server rejected
    # left no state change, so the final session state the verifier scores is
    # by construction clean. Attempt-level events in /api/access-log are kept
    # as diagnostic metadata so reports can show what paths the agent tried,
    # but they DO NOT fail the run — penalising rejected attempts would punish
    # exploration without adding any defence-in-depth (a real bypass would not
    # log a *_required event in the first place).
    diagnostic_events = {
        "browser_required",
        "browser_session_required",
        "ui_token_required",
        "validation_failed",
        "verifier_only",
    }
    diagnostics = [
        {
            "event": item.get("event"),
            "path": item.get("path"),
            "method": item.get("method"),
            "reason": item.get("reason"),
            "userAgent": item.get("userAgent"),
            "errors": item.get("errors"),
        }
        for item in access_log
        if item.get("event") in diagnostic_events
    ]
    valid_submits = [
        item
        for item in access_log
        if item.get("event") == "ui_submit_valid" and item.get("sessionId") == session_id
    ]
    detail = {
        "verifier_token_present": bool(verifier_token),
        "rejected_attempts": diagnostics,
        "valid_submit_count": len(valid_submits),
    }
    return bool(verifier_token) and bool(valid_submits), detail


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    parser.add_argument(
        "--mock-url",
        default=os.environ.get("MOCK_SITE_URL", "http://localhost:3000"),
    )
    args = parser.parse_args()

    task_dir = Path(args.task_dir)
    reward_path = Path(args.reward_json)
    mock_url = args.mock_url
    verifier_token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    private_dir = task_dir / "private"
    truth = load_json(private_dir / "grading_truth.json", {})
    if not truth:
        write_reward(
            reward_path,
            {"error": 0.0},
            {"error": "grading_truth.json not found or empty"},
        )
        return

    requested_page = truth.get("page") or None

    weights = truth.get("weights", {})
    w_required = weights.get("required_completion", 0.25)
    w_overall = weights.get("overall_completion", 0.10)
    w_accuracy = weights.get("field_accuracy", 0.45)
    w_files = weights.get("file_upload_check", 0.10)
    w_llm = weights.get("llm_judge_score", 0.10)
    threshold = truth.get("pass_threshold", 0.6)

    expected_fields = truth.get("expected", {})
    required_files = truth.get("required_files", [])
    image_selection = truth.get("image_selection")

    session_id, resolved_page = find_session_id(mock_url, verifier_token, requested_page)
    page = resolved_page or requested_page or "product"

    if not session_id:
        write_reward(
            reward_path,
            {"no_session": 0.0},
            {"error": "No session found on mock site", "mock_url": mock_url, "page": page},
            threshold,
        )
        return

    try:
        score_resp = api_get(mock_url, f"/api/score/{session_id}", verifier_token)
    except Exception as exc:
        write_reward(
            reward_path,
            {"api_error": 0.0},
            {"error": f"Failed to call /api/score: {exc}"},
            threshold,
        )
        return

    req_completion = score_resp.get("requiredCompletion", 0)
    overall_completion = score_resp.get("completion", 0)

    checks: dict[str, float] = {}
    details: dict[str, Any] = {
        "session_id": session_id,
        "page": page,
        "session_status": score_resp.get("status"),
        "total_fields": score_resp.get("total"),
        "filled_fields": score_resp.get("filled", 0),
        "mock_url": mock_url,
    }

    checks["required_completion"] = round(w_required * req_completion, 4)
    checks["overall_completion"] = round(w_overall * overall_completion, 4)

    if expected_fields:
        try:
            verify_resp = api_post_json(
                mock_url,
                f"/api/verify/{session_id}",
                {"expected": expected_fields},
                verifier_token,
            )
            accuracy = verify_resp.get("accuracy", 0)
            checks["field_accuracy"] = round(w_accuracy * accuracy, 4)
            details["verify_accuracy"] = accuracy
            details["verify_matched"] = verify_resp.get("matchedFields", 0)
            details["verify_expected"] = verify_resp.get("expectedFields", 0)
            details["verify_details"] = verify_resp.get("details", [])
        except Exception as exc:
            checks["field_accuracy"] = 0.0
            details["verify_error"] = str(exc)
    else:
        checks["field_accuracy"] = 0.0

    try:
        state_resp = api_get(mock_url, f"/api/state/{session_id}", verifier_token)
        fields = state_resp.get("fields", {})
    except Exception:
        fields = {}

    try:
        access_log = api_get(mock_url, "/api/access-log", verifier_token)
        if not isinstance(access_log, list):
            access_log = []
    except Exception as exc:
        access_log = []
        details["mock_integrity_error"] = str(exc)
    integrity_ok, integrity_detail = score_mock_integrity(access_log, session_id, verifier_token)
    details["mock_integrity"] = integrity_detail

    if image_selection:
        img_result = check_image_selection(fields, image_selection, page)
        checks["file_upload_check"] = round(w_files * img_result["ratio"], 4)
        details["image_selection"] = img_result
    elif required_files:
        uploaded = 0
        for fname in required_files:
            f = fields.get(fname, {})
            if f.get("filePath") or f.get("value"):
                uploaded += 1
        file_ratio = uploaded / len(required_files) if required_files else 1.0
        checks["file_upload_check"] = round(w_files * file_ratio, 4)
        details["files_expected"] = required_files
        details["files_uploaded"] = uploaded
    else:
        checks["file_upload_check"] = round(w_files * 1.0, 4)

    llm_fields = truth.get("llm_judge_fields", [])
    if llm_fields:
        filled_llm = sum(1 for f in llm_fields if fields.get(f, {}).get("value"))
        llm_ratio = filled_llm / len(llm_fields)
        checks["llm_judge_score"] = round(w_llm * llm_ratio * 0.7, 4)
        details["llm_judge_fields"] = llm_fields
        details["llm_judge_filled"] = filled_llm
        details["llm_judge_note"] = "Partial credit for non-empty; full LLM judge TBD"
    else:
        checks["llm_judge_score"] = round(w_llm * 1.0, 4)

    out_dir = Path(args.output_dir)
    if out_dir.is_dir():
        try:
            (out_dir / "mock_shopify_admin_final_state.json").write_text(
                json.dumps(
                    {"session_id": session_id, "page": page, "fields": fields},
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
        except OSError:
            pass

    validation_checks = [
        make_check("mock_integrity", integrity_ok, 0.0, integrity_detail),
        make_check("minimum_score", sum(checks.values()) >= threshold, sum(checks.values()), checks),
    ]
    write_reward(
        reward_path,
        checks,
        details,
        threshold,
        hard_fail_reason=None if integrity_ok else "mock_integrity_failed",
        validation_checks=validation_checks,
    )


if __name__ == "__main__":
    main()
