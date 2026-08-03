"""api-travel-asia-supplier-tour-handoff verifier.

Adapted from the historical trends HTML report verifier.
Match key changed from (error_type, section_id) to (error_type, leg_id).

See task.md for the full deliverable contract.

Capacity-check granularity (R3a per-finding collapse, 2026-06-09)
----------------------------------------------------------------
The audit is 10 *distinct* handoff errors (one per error_type: co-location,
allowlist, flight-window, timezone math, amenity disambiguation, budget
override, accessibility, billing convention, cancellation floor, dietary).
Finding completeness across these heterogeneous cross-source reasoning units
IS the measured competency, so each finding stays its own capability check
(R3a, same shape as jira `duplicate_handled`). What collapses is the per-finding
4-atom explosion: the old `error_N_present / _type_correct / _leg_correct /
_correct_value` quadruple is redundant — `type_correct` and `leg_correct` were
unconditionally True whenever the (error_type, leg_id) tuple matched (they ARE
the match key), and all three (present/type/leg) failed together when it did
not. The only independent signals per finding are "correct (type, leg) pair
identified" and "correct reconciled value". Those fold by AND into one
`finding_N_correct` check; the per-atom detail is preserved verbatim in the
`reason` string. Plumbing (output file presence) is the single anchor
`output_present`; over/under-reporting restraint stays its own negative check
`no_over_or_under_reporting` (R6). 42 -> 12 checks. Pure aggregation: the
predicates are byte-identical, binary `passed` is unchanged per case (every
old atom still computed internally; new pass = AND of the same atoms).

The `correct_value` matcher keeps its list-acceptable semantics intact
(`_match_value` accepts any member of a list of equally-valid alternatives —
e.g. finding #10's dietary correction is compliant under either the
dataset-wide-cheapest §4.7(a) reading or the §3-allowlist-cheapest reading).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _check(check_id, passed, reason="", check_type="deterministic_exact"):
    return {
        "id": check_id,
        "passed": bool(passed),
        "reason": (reason if isinstance(reason, str) else json.dumps(reason))[:400],
        "check_type": check_type,
    }


def _emit(reward_json, task_id, checks, source):
    p = sum(1 for c in checks if c["passed"])
    t = len(checks)
    raw_score = round(p / t, 4) if t else 0.0
    score = 1.0 if (t > 0 and p == t) else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_id,
        "score": score,
        "raw_score": raw_score,
        "checks_passed": p,
        "checks_total": t,
        "checks_breakdown": checks,
        "reward": score,
        "passed": p == t,
        "source": source,
    }
    Path(reward_json).parent.mkdir(parents=True, exist_ok=True)
    Path(reward_json).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("score", "raw_score", "checks_passed", "checks_total")}))


def _load_outputs_json(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def _norm(s):
    return (s or "").strip().lower() if isinstance(s, str) else ""


def _match_value(a, expected_val, kind, tol):
    if kind == "string":
        # `expected_val` may be a single string OR a list of acceptable strings —
        # the latter is used when multiple alternatives are equally valid per the
        # task's policy (e.g. a correction that's compliant under both §3 allowlist
        # and §4.7 lowest-price rules but resolves to different properties).
        if isinstance(expected_val, list):
            return any(_norm(a) == _norm(v) for v in expected_val)
        return _norm(a) == _norm(expected_val)
    try:
        return abs(float(a) - float(expected_val)) <= float(tol)
    except (TypeError, ValueError):
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    out_dir = Path(args.output_dir)
    rj = Path(args.reward_json)
    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    out_path = out_dir / "audit_findings.json"
    checks = []

    # Anchor: the single plumbing check (R2). If absent, none of the downstream
    # capabilities are exercisable, but we still emit the full breakdown with
    # every downstream check marked False so `checks_total` stays stable across
    # runs (a bare 1-check anchor breakdown would make `checks_total` flicker
    # between 1 and 12 depending on whether the agent wrote the output file).
    if not out_path.exists():
        checks.append(_check("output_present", False, f"missing {out_path.name}"))
        _missing_reason = f"missing {out_path.name}; downstream not exercisable"
        checks.append(_check("no_over_or_under_reporting", False, _missing_reason))
        for ex in expected["expected_findings"]:
            checks.append(_check(f"finding_{ex['finding_id']}_correct", False, _missing_reason))
        _emit(rj, expected.get("task_id", "api-travel-asia-supplier-tour-handoff"), checks, "v2_handoff_audit")
        return 0

    checks.append(_check("output_present", True))
    actual = _load_outputs_json(out_path) or {}
    a_findings = actual.get("findings", []) if isinstance(actual.get("findings"), list) else []
    a_count = len(a_findings)

    # R6 negative capability: no over- or under-reporting (decoys not flagged,
    # real errors not missed). Stays its own check, unchanged predicate.
    checks.append(_check(
        "no_over_or_under_reporting",
        a_count == expected["expected_total_findings"],
        f"got={a_count} expected={expected['expected_total_findings']} (over/under-reporting penalized)",
    ))

    # R3a per-finding capability checks. Each finding is a distinct cross-source
    # audit competency (10 distinct error_types). The old 4-atom quadruple
    # (present/type_correct/leg_correct/correct_value) folds by AND into one
    # `finding_N_correct` per finding; every atom is still computed internally
    # and surfaced in `reason`. type_correct/leg_correct are tautologically True
    # on a tuple match (they ARE the match key) so they add no signal — they are
    # folded, not dropped: the AND still requires the matched-tuple condition.
    used = set()
    for ex in expected["expected_findings"]:
        fid = ex["finding_id"]
        match = None
        for i, af in enumerate(a_findings):
            if not isinstance(af, dict) or i in used:
                continue
            if _norm(af.get("error_type")) == _norm(ex["error_type"]) and _norm(af.get("leg_id")) == _norm(ex["leg_id"]):
                match = af
                used.add(i)
                break
        present = match is not None
        # atom 1: correct (error_type, leg_id) tuple identified
        present_ok = present
        # atoms 2 & 3 (type_correct, leg_correct): unconditionally True iff matched
        type_ok = present
        leg_ok = present
        # atom 4: correct reconciled value (keeps list-acceptable semantics)
        if match is not None:
            cv = match.get("correct_value")
            value_ok = _match_value(cv, ex["correct_value"], ex["correct_value_kind"], ex.get("tolerance") or 0)
            if value_ok:
                reason = "ok"
            else:
                reason = (
                    f"correct (type, leg) identified but correct_value wrong: "
                    f"got={cv!r} expected={ex['correct_value']!r} (tol={ex.get('tolerance')})"
                )
        else:
            cv = None
            value_ok = False
            reason = (
                f"no finding with error_type={ex['error_type']!r} + leg_id={ex['leg_id']!r}"
            )
        finding_ok = present_ok and type_ok and leg_ok and value_ok
        checks.append(_check(f"finding_{fid}_correct", finding_ok, reason))

    _emit(rj, expected["task_id"], checks, "v2_handoff_audit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
