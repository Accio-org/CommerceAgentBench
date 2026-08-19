from __future__ import annotations

import argparse
import json
import os
import urllib.request
from pathlib import Path
from typing import Any

from bench_core.verifiers.form_value_normalize import compare_form_value

FILE_CHECK_PREFIX = 'banner'
FILE_SELECTION_KEY = 'banner_selection'
SOURCE = 'smartwatch_campaign_direct_v2_verifier'

# ---------------------------------------------------------------------------
# Capacity check folding (docs/check-granularity.md).
#
# The verifier internally still computes every atomic field/banner/structural
# predicate (unchanged — needed for the per-item `reason` strings and for
# refold validation), but emits one capability check per distinct skill the
# task measures. Each emitted group = AND(its member atoms); the per-atom
# failures are surfaced in the group's `reason`. Pure aggregation: a session's
# binary pass (all groups) == old (all 32 atoms) by construction.
#
# GROUP_SPECS partitions the 32 atomic ids exactly (no overlap, none missing).
# Order here = emit order = rubric.json order.
# ---------------------------------------------------------------------------


def _fld(name: str) -> str:
    return f"field_{name}_correct"


GROUP_SPECS: list[tuple[str, list[str]]] = [
    # R2: all reachability / auth / legitimate-submit-path plumbing → one gate.
    ("setup_gate", [
        "session_exists", "session_state_readable",
        "session_submitted", "mock_submit_via_legitimate_path",
    ]),
    # R4: product disambiguation among 4 mixed products (pick the Pulse S2).
    ("product_identity", [_fld(x) for x in
                          ["productSku", "productTitle", "category", "basePrice", "currency"]]),
    # R4: pricing tiers with the CFO discount override + 2-dp price compute.
    ("pricing_with_cfo_override", [_fld(x) for x in
                                   ["discountType", "discountTiers", "freeShippingThreshold"]]),
    # R4: target markets with CEO last-minute expansion + per-region surcharge.
    ("regions_with_ceo_expansion", [_fld(x) for x in ["targetRegions", "regionSurcharge"]]),
    # R4: warehouse allocation with Ops adjustment, total-stock invariant.
    ("inventory_with_ops_adjustment", [_fld(x) for x in
                                       ["warehouseAllocation", "totalCampaignStock", "stockReserveMode"]]),
    # R3: marketing-director-driven campaign settings (homogeneous copy-from-spec).
    ("campaign_directives", [_fld(x) for x in
                             ["campaignName", "campaignType", "campaignStart", "campaignEnd",
                              "dailyAdBudget", "paymentMethods", "landingPageSlug",
                              "adPlatforms", "maxPerCustomer", "agreement"]]),
    # R3: banner selection — visual discrimination, pick the correct campaign
    #     set among fitness-band / charging-dock / reject distractors. The set
    #     (not each interchangeable slot) is the competency.
    ("banner_selection_correct", [f"banner_banner_{i}_correct_file" for i in range(1, 6)]),
]


def fold_atoms(atoms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold the atomic check list into capability-group checks (AND per group).

    Pure aggregation: each group passes iff all its member atoms passed; the
    failing member ids are listed in `reason`. Atoms whose id is unexpectedly
    absent (e.g. structural short-circuit before fields were checked) count as
    a failed member, so the group is conservatively not-passed.
    """
    by_id = {a["id"]: a for a in atoms}
    grouped: list[dict[str, Any]] = []
    for group_id, members in GROUP_SPECS:
        missing = [m for m in members if m not in by_id]
        failed = [m for m in members if m in by_id and not by_id[m].get("passed")]
        ok = not missing and not failed
        if ok:
            reason = "ok"
        else:
            bits = []
            if failed:
                bits.append("failed: " + ", ".join(failed))
            if missing:
                bits.append("missing: " + ", ".join(missing))
            reason = "; ".join(bits)
        grouped.append({
            "id": group_id,
            "passed": ok,
            "reason": reason[:300],
            "check_type": "deterministic_exact",
        })
    return grouped


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


def find_session_id(mock_url: str, checks: list[dict[str, Any]], verifier_token: str) -> str | None:
    try:
        sessions = api_get(mock_url, "/api/sessions", verifier_token)
    except Exception as exc:
        check(checks, "session_exists", False, f"cannot read sessions: {exc}")
        return None
    if isinstance(sessions, dict):
        sessions = sessions.get("sessions") or sessions.get("data") or []
    if not isinstance(sessions, list) or not sessions:
        check(checks, "session_exists", False, "no sessions")
        return None
    submitted = [s for s in sessions if isinstance(s, dict) and s.get("status") == "submitted"]
    pool = submitted or [s for s in sessions if isinstance(s, dict)]
    pool.sort(key=lambda s: s.get("updatedAt") or s.get("createdAt") or "", reverse=True)
    sid = str(pool[0].get("id") or pool[0].get("sessionId") or "") if pool else ""
    check(checks, "session_exists", bool(sid), f"session_id={sid[:16] if sid else 'missing'}")
    return sid or None


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
    expected = read_json(task_dir / "private" / "expected_answer.json")
    checks: list[dict[str, Any]] = []
    verifier_token = os.environ.get("MOCK_VERIFIER_TOKEN", "")
    session_id = find_session_id(mock_url, checks, verifier_token)

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
                check(checks, "session_state_readable", True)
            else:
                check(checks, "session_state_readable", False, "state response is not an object")
        except Exception as exc:
            check(checks, "session_state_readable", False, str(exc))
        if not access_log:
            try:
                fetched_log = api_get(mock_url, "/api/access-log", verifier_token)
                if isinstance(fetched_log, list):
                    access_log = fetched_log
            except Exception:
                access_log = []
    else:
        check(checks, "session_state_readable", False, "no session")

    check(checks, "session_submitted", status == "submitted", f"status={status!r}")
    legit = any(
        isinstance(item, dict)
        and item.get("event") == "cli_submit_valid"
        and (not item.get("sessionId") or str(item.get("sessionId")) == str(session_id))
        for item in access_log
    )
    check(checks, "mock_submit_via_legitimate_path", legit, "missing cli_submit_valid" if not legit else "")

    selection = expected.get(FILE_SELECTION_KEY) or expected.get("image_selection") or {}
    correct_files = set(selection.get("correct_files") or [])
    acceptable_files = set(selection.get("acceptable_files") or [])
    wrong_files = set(selection.get("wrong_files") or [])
    allowed_files = correct_files | acceptable_files
    for slot in expected.get("required_files", []):
        raw = files.get(slot) if slot in files else fields.get(slot)
        filename = str(value_from_field(raw) or "").split("/")[-1]
        ok = bool(filename) and filename in allowed_files and filename not in wrong_files
        check(checks, f"{FILE_CHECK_PREFIX}_{slot}_correct_file", ok, f"got={filename!r}")

    json_fields = set(expected.get("json_fields", []))
    for key, expected_value in expected.get("expected_fields", {}).items():
        actual = fields.get(key)
        ok = compare_value(key, actual, expected_value, as_json=key in json_fields)
        check(checks, f"field_{key}_correct", ok, f"got={value_from_field(actual)!r}")

    if output_dir.is_dir():
        try:
            (output_dir / "mock_final_state.json").write_text(
                json.dumps({"session_id": session_id, "fields": fields, "workspace": files}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError:
            pass
    # checks[] holds the fine-grained atomic predicates (byte-identical to the
    # pre-fold verifier — kept for the per-atom reason detail / refold audit).
    # Emit one capability check per group (AND of its atoms); see GROUP_SPECS.
    return emit(reward_json, task_dir.name, fold_atoms(checks))


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
