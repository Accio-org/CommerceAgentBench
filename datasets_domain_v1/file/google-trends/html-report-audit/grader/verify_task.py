"""V2.5 verifier — see task.md for the contract.

Capacity-refactor (2026-06-08): emitted at capability granularity per
docs/check-granularity.md. Internal per-finding validation is unchanged; only
the check emission is folded. Pure aggregation — binary pass is identical to
the pre-fold schema.

  setup_gate                 R2  output file exists AND parses to a findings list
  findings_count_exact       R6  exactly expected_total_findings (no over/under-report)
  finding_correct::<sec>     R3a one per planted error; AND(present, error_type,
                                 section_id, correct_value). Audit completeness
                                 (finding every planted error and getting its
                                 value right) is the measured hard competency, so
                                 each error stays its own check (jira-style).
"""
from __future__ import annotations

import argparse, json, sys
from pathlib import Path


def _check(check_id, passed, reason="", check_type="deterministic_exact"):
    return {"id": check_id, "passed": bool(passed), "reason": (reason if isinstance(reason, str) else json.dumps(reason))[:400], "check_type": check_type}


def _emit(reward_json, task_id, checks, source):
    p = sum(1 for c in checks if c["passed"])
    t = len(checks)
    raw_score = round(p / t, 4) if t else 0.0
    score = 1.0 if (t > 0 and p == t) else 0.0
    payload = {"schema_version": "2.0", "task_id": task_id, "score": score, "raw_score": raw_score, "checks_passed": p, "checks_total": t, "checks_breakdown": checks, "reward": score, "passed": p == t, "source": source}
    Path(reward_json).parent.mkdir(parents=True, exist_ok=True)
    Path(reward_json).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("score", "raw_score", "checks_passed", "checks_total")}))


def _load_outputs_json(p):
    try: return json.loads(Path(p).read_text(encoding="utf-8-sig"))
    except Exception: return None


def _norm(s): return (s or "").strip().lower() if isinstance(s, str) else ""


def _match_value(a, expected_val, kind, tol):
    if isinstance(expected_val, list):
        return any(_match_value(a, ev, kind, tol) for ev in expected_val)
    if kind == "string":
        return _norm(a) == _norm(expected_val)
    try:
        return abs(float(a) - float(expected_val)) <= float(tol or 0)
    except (TypeError, ValueError):
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True); ap.add_argument("--output-dir", required=True); ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()
    task_dir = Path(args.task_dir); out_dir = Path(args.output_dir); rj = Path(args.reward_json)
    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    task_id = expected.get("task_id", "html-report-audit")
    expected_findings = expected.get("expected_findings") or []
    try:
        expected_total = int(expected.get("expected_total_findings"))
    except (TypeError, ValueError):
        expected_total = len(expected_findings)
    out_path = out_dir / "audit_findings.json"

    # --- setup_gate (R2): deliverable exists AND is parseable to a findings list ---
    actual = _load_outputs_json(out_path) if out_path.exists() else None
    parsed_findings = actual.get("findings") if isinstance(actual, dict) else None
    setup_ok = out_path.exists() and isinstance(parsed_findings, list)
    if not out_path.exists():
        setup_reason = f"missing {out_path.name}"
    elif actual is None:
        setup_reason = f"{out_path.name} present but not parseable as JSON"
    elif not isinstance(parsed_findings, list):
        setup_reason = f"{out_path.name} parsed but 'findings' is not a list"
    else:
        setup_reason = "ok"
    checks = [_check("setup_gate", setup_ok, setup_reason)]

    a_findings = parsed_findings if isinstance(parsed_findings, list) else []
    a_count = len(a_findings)

    # --- findings_count_exact (R6): no over- or under-reporting (decoys must not be flagged) ---
    checks.append(_check("findings_count_exact", a_count == expected_total,
        f"got={a_count} expected={expected_total} (over/under-reporting penalized)"))

    # --- per-finding capability checks (R3a): one per planted error ---
    used = set()
    for ex in expected_findings:
        sec = ex.get("section_id")
        match = None
        for i, af in enumerate(a_findings):
            if not isinstance(af, dict) or i in used: continue
            if _norm(af.get("error_type")) == _norm(ex.get("error_type")) and _norm(af.get("section_id")) == _norm(sec):
                match = af; used.add(i); break
        # internal per-finding validation (unchanged): present (== correct error_type
        # AND section_id) AND correct_value
        present = match is not None
        value_ok = False
        if present:
            cv = match.get("correct_value")
            value_ok = _match_value(cv, ex.get("correct_value"), ex.get("correct_value_kind"), ex.get("tolerance"))
            reason = ("ok" if value_ok
                      else f"present but wrong correct_value: got={match.get('correct_value')!r} expected={ex.get('correct_value')!r} (tol={ex.get('tolerance')})")
        else:
            reason = f"not found: no finding with error_type={ex.get('error_type')!r} + section_id={sec!r}"
        finding_ok = present and value_ok
        checks.append(_check(f"finding_correct::{sec}", finding_ok, reason))

    _emit(rj, task_id, checks, "v2_html_audit"); return 0


if __name__ == "__main__":
    sys.exit(main())
