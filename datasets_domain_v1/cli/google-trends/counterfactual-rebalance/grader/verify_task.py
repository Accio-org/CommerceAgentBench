"""V2 verifier — see task.md for the contract.

Capacity-refactor (2026-06-08): the 19 atomic checks (1 plumbing + 9 cells ×
{action, qoq_growth}) are folded into 6 capability buckets per
docs/check-granularity.md. Pure aggregation — every cell is still validated
internally with the same action-enum and ±0.005 qoq tolerance; only the
emitted check granularity changes. Binary pass is unchanged.

The earlier fold collapsed all 9 `action` cells into one
`decision_actions_correct` bucket, but that bucket糅合了三种 R4-distinct
capabilities inside the same loop (R4: genuinely independent capabilities
exercised inside one loop must stay separate). The 9 action cells split by
the capability each one actually exercises:

Buckets:
  - setup_gate (R2): deliverable file present.
  - qoq_baseline_correct (R3): the 5 qoq cells where Sarah's draft already
    agreed with the API truth — basic qoq computation / faithful transcription.
  - qoq_bugfix_recompute (R3): the 4 qoq cells corrupted by qoq.py's
    quarter-slicing bug (14/13/13/12 weeks instead of 13/13/13/13). One
    capability: "distrust the draft, find the script defect, recompute". 9-model
    data: every model is 4/4 or 0/4 — perfectly binary, the single discriminator
    that separates passing from failing models (R3, not R3a — no completeness
    gradient to recover).
  - action_threshold_correct (R4, R3): the 5 cells whose action follows
    purely from the ±0.05 QoQ decision-threshold rule with no further judgement
    — Q2/Q3 speaker (hold_watch) + Q4 earbuds/drill/speaker (keep). Mechanical
    enum classification.
  - swap_in_target_correct (R4): the 3 swap_out cells — Q2 earbuds, Q2 drill,
    Q3 earbuds. Beyond crossing the swap_out threshold, this exercises a
    distinct skill: pick the highest-Qn-average replacement brand among the
    OTHER 4 brands in the same category (cross-category max selection). The
    draft plants a wrong target here (Q2 earbuds: beats studio buds vs GT
    jabra elite).
  - recalled_opinion_override (R4): the single Q3 drill cell. The threshold
    puts it at hold_watch (qoq -0.0339 > -0.05), but the draft AND the Slack
    excerpt both push swap_in:dewalt — a pencil-in the analyst later moved off.
    The measured capability is "recognise the walked-back recommendation and
    let the recomputed rule override it", distinct from mechanical thresholding.

Why these are R4-independent, not one skill: a model can ace mechanical
thresholding yet pick the wrong swap-in target (a separate max-selection step),
and can do both yet still copy the draft's recalled dewalt opinion (a separate
distrust-the-handoff judgement). Each isolates a different failure mode.
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


PLANTED_WRONG_CHECK_IDS = (
    # cells where workspace/drafts/draft_rebalance.md has a wrong value
    # → agent who copies the draft unchanged will fail these checks
    "Q2_earbuds_action",       # draft: swap_in:beats studio buds  (GT: jabra elite)
    "Q2_drill_qoq_growth",     # draft: -0.27   (GT: -0.2527  — buggy qoq.py)
    "Q3_drill_action",         # draft: swap_in:dewalt    (GT: hold_watch)
    "Q3_drill_qoq_growth",     # draft: -0.085  (GT: -0.0339 — from Slack hot-take)
    "Q4_earbuds_qoq_growth",   # draft: 60.15   (GT: 55.445  — buggy qoq.py)
    "Q4_drill_qoq_growth",     # draft: 0.93    (GT: 0.8622  — buggy qoq.py)
    "Q4_speaker_qoq_growth",   # draft: 1466.67 (GT: 1353.85 — buggy qoq.py)
)

# Per-cell atomic check id → capability bucket. Source of truth for the fold;
# every (quarter, slot) × {action, qoq_growth} atom plus the plumbing atom must
# appear exactly once.
BUCKETS = (
    ("setup_gate", ("output_file_present",)),
    ("qoq_baseline_correct", (
        "Q2_earbuds_qoq_growth", "Q2_speaker_qoq_growth",
        "Q3_earbuds_qoq_growth", "Q3_drill_qoq_growth", "Q3_speaker_qoq_growth",
    )),
    ("qoq_bugfix_recompute", (
        "Q2_drill_qoq_growth", "Q4_earbuds_qoq_growth",
        "Q4_drill_qoq_growth", "Q4_speaker_qoq_growth",
    )),
    # --- 9 action cells split by the capability each exercises (R4) ---
    ("action_threshold_correct", (
        "Q2_speaker_action", "Q3_speaker_action",
        "Q4_earbuds_action", "Q4_drill_action", "Q4_speaker_action",
    )),
    ("swap_in_target_correct", (
        "Q2_earbuds_action", "Q2_drill_action", "Q3_earbuds_action",
    )),
    ("recalled_opinion_override", (
        "Q3_drill_action",
    )),
)


def _fold(atoms):
    """Collapse the per-cell atomic checks into the 4 capability buckets.

    Pure aggregation: a bucket passes iff every member atom passes (AND);
    failing member ids are surfaced in `reason` for diagnosis. Binary pass is
    identical to all(atoms)."""
    by_id = {a["id"]: a for a in atoms}
    out = []
    for bucket_id, member_ids in BUCKETS:
        members = [by_id[m] for m in member_ids if m in by_id]
        failed = [m["id"] for m in members if not m["passed"]]
        ok = (not failed) and len(members) == len(member_ids)
        if ok:
            reason = "ok"
        elif len(members) != len(member_ids):
            reason = "internal: missing atoms for bucket"
        else:
            detail = "; ".join(f"{m['id']}: {m['reason']}" for m in members if not m["passed"])
            reason = f"failed: {failed} | {detail}"
        out.append(_check(bucket_id, ok, reason))
    return out


def _emit(reward_json, task_id, checks, source, atoms):
    # Binary scoring: unique-answer tasks have unique correct outputs.
    # score = 1.0 only if every capability bucket passes; otherwise 0.0.
    # raw_score (passed/total) is kept for diagnostic purposes.
    p = sum(1 for c in checks if c["passed"])
    t = len(checks)
    raw_score = round(p / t, 4) if t else 0.0
    score = 1.0 if (t > 0 and p == t) else 0.0
    # Planted-error diagnostics still computed from the underlying per-cell atoms.
    by_atom = {a["id"]: a["passed"] for a in atoms}
    planted_fixed = [cid for cid in PLANTED_WRONG_CHECK_IDS if by_atom.get(cid) is True]
    planted_missed = [cid for cid in PLANTED_WRONG_CHECK_IDS if by_atom.get(cid) is False]
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
        "planted_errors_fixed": planted_fixed,
        "planted_errors_missed": planted_missed,
        "planted_total": len(PLANTED_WRONG_CHECK_IDS),
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True); ap.add_argument("--output-dir", required=True); ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()
    task_dir = Path(args.task_dir); out_dir = Path(args.output_dir); rj = Path(args.reward_json)
    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    out_path = out_dir / "rebalance.json"

    # Internal per-cell atoms (full granularity, kept for fold + planted diagnostics).
    atoms = []
    if not out_path.exists():
        atoms.append(_check("output_file_present", False, f"missing {out_path.name}"))
        checks = _fold(atoms)
        _emit(rj, expected.get("task_id", "counterfactual-rebalance"), checks, "v2_rebalance", atoms); return 0
    atoms.append(_check("output_file_present", True))
    actual = _load_outputs_json(out_path) or {}
    a_decisions = actual.get("decisions", []) if isinstance(actual.get("decisions"), list) else []
    a_by_key = {(d.get("quarter"), d.get("slot")): d for d in a_decisions if isinstance(d, dict)}
    for exp_d in expected["decisions"]:
        key = f"{exp_d['quarter']}_{exp_d['slot']}"
        a = a_by_key.get((exp_d["quarter"], exp_d["slot"]), {})
        # Action enum (case-insensitive, whitespace-trimmed)
        atoms.append(_check(f"{key}_action",
            _norm(a.get("action")) == _norm(exp_d["action"]),
            f"got={a.get('action')!r} expected={exp_d['action']!r}"))
        # qoq_growth ±0.005
        try: a_q = float(a.get("qoq_growth"))
        except (TypeError, ValueError): a_q = float("nan")
        ok = a_q == a_q and abs(a_q - exp_d["qoq_growth"]) <= 0.005
        atoms.append(_check(f"{key}_qoq_growth", ok,
            f"got={a_q} expected={exp_d['qoq_growth']} (±0.005)"))

    checks = _fold(atoms)
    _emit(rj, expected["task_id"], checks, "v2_rebalance", atoms); return 0


if __name__ == "__main__":
    sys.exit(main())
