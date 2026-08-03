"""v2 verifier for browser-reddit-auth-browse.

Capacity-migration note (2026-06-09): the per-field atomic predicates below are
UNCHANGED — every individual fact is still validated with the same comparison and
the same tolerance. What changed is the *emit* layer: the 22 atomic results are
folded (pure AND aggregation) into 7 capability checks so that ``checks_total``
reflects distinct competence units instead of one-check-per-output-field
(collapse-only / R3, per ``docs/check-granularity.md``). Binary ``passed`` is
unchanged for every archived run (refold + rerun mismatch = 0). The per-field
detail survives in each group's ``reason`` string for diagnosis.

score = checks_passed / checks_total over the 7 capability checks.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


# Capability grouping: capability check id -> ordered list of atomic field ids.
# This is a complete, exact partition of the 22 atomic checks. Each capability
# check passes iff ALL its member atoms pass (pure AND). The atoms themselves
# are computed identically to before; only the reporting is aggregated.
#
#   answer_json_valid_schema      -> deliverable produced in the exact required
#                                    shape (unconditional anchor: the only check
#                                    evaluated when the schema is broken).
#   session_cookie_recognized     -> authenticated-browse competency: reuse a
#                                    real session cookie, reject the rotating
#                                    `reddit_browser_ready` decoy (distinct skill).
#   target_located                -> navigated to the right user + subreddit.
#   ppwr_facts_correct            -> extracted the EU PPWR regulation facts.
#   inspection_economics_correct  -> extracted the inspection cost/ROI figures.
#   inspection_qc_spec_correct    -> extracted the AQL table + inspection stages.
#   third_party_sourcing_correct  -> extracted the third-party / freelance rates.
CAPABILITY_GROUPS: dict[str, list[str]] = {
    "answer_json_valid_schema": ["answer_json_valid_schema"],
    "session_cookie_recognized": ["session_cookie_recognized"],
    "target_located": [
        "target_username_correct",
        "target_subreddit_correct",
    ],
    "ppwr_facts_correct": [
        "ppwr_effective_date_correct",
        "ppwr_recycled_content_min_pct_correct",
        "ppwr_empty_space_max_pct_correct",
        "ppwr_dpp_required_correct",
        "ppwr_epr_per_country_required_correct",
        "ppwr_penalty_max_eur_correct",
        "ppwr_penalty_max_revenue_pct_correct",
    ],
    "inspection_economics_correct": [
        "inspection_total_cost_usd_correct",
        "inspection_orders_count_correct",
        "inspection_savings_usd_correct",
        "inspection_roi_multiplier_correct",
    ],
    "inspection_qc_spec_correct": [
        "aql_critical_correct",
        "aql_major_correct",
        "aql_minor_correct",
        "inspection_stages_complete",
    ],
    "third_party_sourcing_correct": [
        "third_party_threshold_usd_correct",
        "freelance_inspector_min_day_rate_correct",
        "freelance_inspector_max_day_rate_correct",
    ],
}

# Human-readable summary for each capability's pass `reason`.
CAPABILITY_OK_REASON: dict[str, str] = {
    "answer_json_valid_schema": "ok",
    "session_cookie_recognized": "ok",
    "target_located": "user + subreddit correct",
    "ppwr_facts_correct": "all 7 PPWR facts correct",
    "inspection_economics_correct": "cost/orders/savings/ROI correct",
    "inspection_qc_spec_correct": "AQL + inspection stages correct",
    "third_party_sourcing_correct": "threshold + freelance rates correct",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", default="")
    ap.add_argument("--reward-json", required=True)
    ap.add_argument("--mock-url", default="http://localhost:3001")
    args = ap.parse_args()

    task_dir = Path(args.task_dir).resolve()
    reward_path = Path(args.reward_json)
    reward_path.parent.mkdir(parents=True, exist_ok=True)

    output_dir = Path(args.output_dir) if args.output_dir else task_dir / "outputs"
    answer_path = output_dir / "answer.json"

    expected = load_json(task_dir / "private" / "expected_answer.json")
    schema = load_json(task_dir / "private" / "answer.schema.json")

    agent_answer: dict | None = None
    schema_ok = False
    schema_reason = ""
    if not answer_path.exists():
        schema_reason = f"missing file: {answer_path}"
    else:
        try:
            agent_answer = load_json(answer_path)
            if not isinstance(agent_answer, dict):
                schema_reason = f"answer.json is not a JSON object (got {type(agent_answer).__name__})"
                agent_answer = None
            else:
                missing = [k for k in schema.get("required", []) if k not in agent_answer]
                extra = (
                    [k for k in agent_answer.keys() if k not in schema.get("properties", {})]
                    if not schema.get("additionalProperties", True)
                    else []
                )
                if missing or extra:
                    schema_reason = f"schema mismatch: missing={missing}, extra={extra}"
                else:
                    schema_ok = True
        except json.JSONDecodeError as e:
            schema_reason = f"answer.json not parseable: {e}"

    def get(field: str) -> Any:
        return (agent_answer or {}).get(field)

    def approx_eq(a: Any, b: Any, abs_tol: float = 0.0, rel_tol: float = 0.0) -> bool:
        if a is None or b is None:
            return False
        try:
            af = float(a)
            bf = float(b)
        except (TypeError, ValueError):
            return False
        if abs_tol == 0 and rel_tol == 0:
            return af == bf
        return math.isclose(af, bf, abs_tol=abs_tol, rel_tol=rel_tol)

    def str_eq_ci(a: Any, b: Any, *, strip_prefixes: tuple[str, ...] = ()) -> bool:
        if not isinstance(a, str) or not isinstance(b, str):
            return False
        sa = a.strip().lower()
        sb = b.strip().lower()
        for p in strip_prefixes:
            if sa.startswith(p):
                sa = sa[len(p):]
            if sb.startswith(p):
                sb = sb[len(p):]
        return sa == sb

    # ---- Atomic field checks (UNCHANGED predicates / tolerances) ----------
    # Each returns (passed, reason) exactly as the original per-field checks did.
    def run_check(cid: str) -> tuple[bool, str]:
        if cid != "answer_json_valid_schema" and not schema_ok:
            return False, f"prerequisite failed: {schema_reason}"

        if cid == "answer_json_valid_schema":
            return schema_ok, ("ok" if schema_ok else schema_reason)

        if cid == "session_cookie_recognized":
            v = (get("primary_session_cookie") or "").strip()
            allowed = [c.strip() for c in expected["primary_session_cookie_acceptable_values"]]
            return v in allowed, f"got={v!r}"

        if cid == "target_username_correct":
            return (
                str_eq_ci(get("target_username"), expected["target_username"], strip_prefixes=("u/",)),
                f"got={get('target_username')!r}",
            )

        if cid == "target_subreddit_correct":
            return (
                str_eq_ci(get("target_subreddit"), expected["target_subreddit"], strip_prefixes=("r/",)),
                f"got={get('target_subreddit')!r}",
            )

        if cid == "ppwr_effective_date_correct":
            return get("ppwr_effective_date") == expected["ppwr_effective_date"], f"got={get('ppwr_effective_date')!r}"

        if cid == "inspection_savings_usd_correct":
            return (
                approx_eq(get("inspection_savings_usd"), expected["inspection_savings_usd"], abs_tol=200),
                f"got={get('inspection_savings_usd')!r}",
            )
        if cid == "inspection_roi_multiplier_correct":
            return (
                approx_eq(get("inspection_roi_multiplier"), expected["inspection_roi_multiplier"], abs_tol=0.1),
                f"got={get('inspection_roi_multiplier')!r}",
            )

        direct_numeric = {
            "ppwr_recycled_content_min_pct_correct": "ppwr_recycled_content_min_pct",
            "ppwr_empty_space_max_pct_correct": "ppwr_empty_space_max_pct",
            "ppwr_penalty_max_eur_correct": "ppwr_penalty_max_eur",
            "ppwr_penalty_max_revenue_pct_correct": "ppwr_penalty_max_revenue_pct",
            "inspection_total_cost_usd_correct": "inspection_total_cost_usd",
            "inspection_orders_count_correct": "inspection_orders_count",
            "aql_critical_correct": "aql_critical",
            "aql_major_correct": "aql_major",
            "aql_minor_correct": "aql_minor",
            "third_party_threshold_usd_correct": "third_party_threshold_usd",
            "freelance_inspector_min_day_rate_correct": "freelance_inspector_min_day_rate_usd",
            "freelance_inspector_max_day_rate_correct": "freelance_inspector_max_day_rate_usd",
        }
        if cid in direct_numeric:
            field = direct_numeric[cid]
            return approx_eq(get(field), expected[field]), f"got={get(field)!r} expected={expected[field]!r}"

        direct_bool = {
            "ppwr_dpp_required_correct": "ppwr_dpp_required",
            "ppwr_epr_per_country_required_correct": "ppwr_epr_per_country_required",
        }
        if cid in direct_bool:
            field = direct_bool[cid]
            return bool(get(field)) == bool(expected[field]), f"got={get(field)!r} expected={expected[field]!r}"

        if cid == "inspection_stages_complete":
            agent_stages = get("inspection_stages") or []
            if not isinstance(agent_stages, list):
                return False, f"not a list: {agent_stages!r}"
            agent_norm = {str(s).strip().lower() for s in agent_stages}
            required = {s.lower() for s in expected["inspection_stages_required"]}
            missing = required - agent_norm
            return len(missing) == 0, f"missing={sorted(missing)!r}"

        return False, f"unknown check id {cid!r}"

    # ---- Fold atoms into capability checks (pure AND aggregation) ---------
    # Validate every atom internally; emit one record per capability unit with
    # the per-atom failures listed in `reason` (collapse-only / R3, R6).
    results = []
    passed = 0
    for cap_id, member_atoms in CAPABILITY_GROUPS.items():
        failed_detail: list[str] = []
        for atom_id in member_atoms:
            ok, atom_reason = run_check(atom_id)
            if not ok:
                failed_detail.append(f"{atom_id}({atom_reason})")
        cap_ok = not failed_detail
        if cap_ok:
            reason = CAPABILITY_OK_REASON.get(cap_id, "ok")
        else:
            reason = "; ".join(failed_detail)
        results.append(
            {
                "id": cap_id,
                "passed": cap_ok,
                "reason": reason,
                "check_type": "deterministic_exact",
            }
        )
        if cap_ok:
            passed += 1

    total = len(results)
    score = passed / total if total > 0 else 0.0

    reward = {
        "schema_version": "2.0",
        "task_id": "browser-reddit-auth-browse",
        "score": round(score, 4),
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": results,
        "reward": round(score, 4),
        "passed": passed == total,
        "source": "v2_checks_runner",
    }
    reward_path.write_text(json.dumps(reward, ensure_ascii=False, indent=2))
    print(json.dumps({k: reward[k] for k in ("score", "checks_passed", "checks_total")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
