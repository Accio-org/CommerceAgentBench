"""V2 verifier — pairwise-rescaling multi-brand comparison.

Agent must (a) extract the final item set + periods + output format from
files/chat_log.md, (b) rescale the independently-normalized pairwise
comparisons onto one common scale, (c) emit the unified comparison chart.
See expected_answer.json for ground truth.

Check granularity (docs/check-granularity.md): the per-brand index checks
test a SINGLE capability — cross-call pairwise rescaling onto a common
scale — applied to the 6 final brands. They are collapsed (R3) into one
`unified_index_correct` capability check; the verifier still validates
every brand internally and lists the offenders in `reason`. Plumbing
(file present + parseable) folds into `setup_gate` (R2). Requirement
extraction (`label_set_exact`) and the derived `ranking_order` deliverable
stay as their own capability checks (R4/R1). 4 checks total.
"""
from __future__ import annotations
import argparse, json, sys, re
from pathlib import Path

TOL = 2  # ±2 on the 0-100 index (validated: correct reconstruction ≤1.1; naive ~45)


def _check(cid, passed, reason="", ct="deterministic_exact"):
    return {"id": cid, "passed": bool(passed),
            "reason": (reason if isinstance(reason, str) else json.dumps(reason))[:400],
            "check_type": ct}


# Difficulty checks an agent fails if they naively compare raw pairwise values
# (off by ~45) or pick the wrong brand set from the chat. Capability checks
# whose failure reveals the planted "don't rescale" trap.
PLANTED_WRONG_CHECK_IDS = (
    "label_set_exact",
    "unified_index_correct",
    "ranking_order",
)


def _emit(rj, task_id, checks, source="v2_intent_pairwise"):
    p = sum(1 for c in checks if c["passed"]); t = len(checks)
    raw = round(p/t, 4) if t else 0.0
    score = 1.0 if (t > 0 and p == t) else 0.0
    by = {c["id"]: c["passed"] for c in checks}
    fixed = [c for c in PLANTED_WRONG_CHECK_IDS if by.get(c) is True]
    missed = [c for c in PLANTED_WRONG_CHECK_IDS if by.get(c) is False]
    payload = {"schema_version": "2.0", "task_id": task_id, "score": score, "raw_score": raw,
               "checks_passed": p, "checks_total": t, "checks_breakdown": checks,
               "reward": score, "passed": p == t, "source": source,
               "planted_errors_fixed": fixed, "planted_errors_missed": missed,
               "planted_total": len(PLANTED_WRONG_CHECK_IDS)}
    Path(rj).parent.mkdir(parents=True, exist_ok=True)
    Path(rj).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("score", "raw_score", "checks_passed", "checks_total")}))


def _norm(s):
    if not isinstance(s, str): return ""
    return re.sub(r"\s+", " ", s).strip().lower()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True); ap.add_argument("--output-dir", required=True); ap.add_argument("--reward-json", required=True)
    a = ap.parse_args()
    task_dir = Path(a.task_dir); out_dir = Path(a.output_dir); rj = Path(a.reward_json)
    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    exp_cmp = {_norm(k): v for k, v in expected["comparison"].items()}
    exp_rank = [_norm(x) for x in expected["ranking"]]

    out = out_dir / "intent_picks.json"

    # --- setup_gate (R2): output file present + parseable JSON ---
    # All downstream capability checks fail-by-absence when the gate fails,
    # so the breakdown is always the same 4 rows regardless of failure point.
    gate_ok = out.exists()
    gate_reason = "ok" if gate_ok else f"missing {out.name}"
    actual = None
    if gate_ok:
        try:
            actual = json.loads(out.read_text(encoding="utf-8-sig"))
        except Exception as e:
            gate_ok = False
            gate_reason = f"json parse error: {e}"

    a_cmp = {}
    a_rank = []
    if actual is not None:
        a_cmp_raw = actual.get("comparison", {}) if isinstance(actual.get("comparison"), dict) else {}
        a_cmp = {_norm(k): v for k, v in a_cmp_raw.items()}
        a_rank = [_norm(x) for x in actual.get("ranking", [])] if isinstance(actual.get("ranking"), list) else []

    checks = [_check("setup_gate", gate_ok, gate_reason, ct="setup")]

    # --- label_set_exact (R4): requirement extraction from the inbox timeline ---
    label_ok = bool(a_cmp) and set(a_cmp.keys()) == set(exp_cmp.keys())
    checks.append(_check("label_set_exact", label_ok,
                         f"got={sorted(a_cmp.keys())} expected={sorted(exp_cmp.keys())}"))

    # --- unified_index_correct (R3): cross-call pairwise rescaling, all 6 brands ---
    # One capability (rescale independently-normalized pulls onto a common
    # scale) tested across the 6 final brands. Validate every brand; collapse
    # to a single pass/fail. Completeness is NOT the measured skill here — a
    # model either rescales or it doesn't — so this is R3, not R3a.
    per_brand_fail = []
    for lab, ev in exp_cmp.items():
        try:
            av = float(a_cmp.get(lab))
        except (TypeError, ValueError):
            av = None
        if av is None or abs(av - ev) > TOL:
            per_brand_fail.append(f"{lab}: got={a_cmp.get(lab)!r} expected={ev}")
    index_ok = (not per_brand_fail) and label_ok
    if not label_ok and not per_brand_fail:
        # labels wrong but every present value matched — still a fail (set mismatch)
        index_reason = "label set mismatch (see label_set_exact)"
    else:
        index_reason = "ok" if index_ok else f"wrong unified index (±{TOL}) for: {per_brand_fail}"
    checks.append(_check("unified_index_correct", index_ok, index_reason))

    # --- ranking_order (R1/R4): derived strongest-to-weakest deliverable ---
    checks.append(_check("ranking_order", a_rank == exp_rank,
                         f"got={a_rank} expected={exp_rank}"))

    _emit(rj, expected["task_id"], checks); return 0


if __name__ == "__main__":
    sys.exit(main())
