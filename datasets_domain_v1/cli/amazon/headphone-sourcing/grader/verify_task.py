"""v2 verifier for amazon-headphone-sourcing-{file,cli}.

Outcome-based: reads only outputs/sourcing_decision.json against a frozen
ground truth in private/expected_answer.json. Does not introspect agent process,
API call logs, or source code.

Capacity-migration note (2026-06-09): the 26 underlying atomic predicates are
UNCHANGED (every `run_check(<atom_id>)` body is byte-identical to the pre-migration
verifier). They are folded into 10 capability checks per docs/check-granularity.md
(R2/R3/R4/R6). Each emitted check is the AND of its member atoms; the per-atom
failures are surfaced in the `reason` string for diagnosis. Binary pass
(`all(atoms) == all(groups)`) is preserved exactly. The cli + file variants share
this verify_task.py byte-for-byte.

L1 — unique optimal portfolio:
    opportunity = log10(max(reviews,1)) * rating * (80 - price) / 50
    portfolio_score = sum(opportunity over 3 selected ASINs)
    optimal := argmax over portfolios (3 distinct subcategories, 1 ASIN each)

L2 — distractor identification:
    excluded_candidates must call out ≥2 ASINs from the GT obvious_traps set
    (high-review search hits that fail hard constraints).

L3 — portfolio aggregates:
    portfolio_avg_rating, portfolio_total_reviews — derived from the selection.

Folded capability checks (each = AND of the listed atoms; see GROUP_SPECS):
    setup_gate                      = json_exists, json_parseable
    output_schema_valid             = selected_asins_shape, no_duplicates,
                                      rationale_aligned, subcategories_in_enum,
                                      excluded_candidates_shape,
                                      excluded_candidates_reason_codes_valid,
                                      selection_reasons_substantive
    eligibility_filter_correct      = asin_{0,1,2}_in_valid_set
    subcategory_derivation_correct  = asin_{0,1,2}_subcategory_matches_ground_truth,
                                      subcategories_all_distinct
    field_values_match_snapshot     = field_values_match_snapshot
    opportunity_computation_correct = opportunity_scores_present/correct,
                                      portfolio_score_present/correct
    portfolio_is_optimal            = portfolio_is_optimal
    distractor_traps_identified     = excluded_candidates_overlap_traps
    portfolio_aggregates_correct    = portfolio_avg_rating_correct,
                                      portfolio_total_reviews_correct
    output_hygiene                  = outputs_dir_only_sourcing_decision
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

VALID_SUBCATEGORIES_FALLBACK = ["bone_conduction", "open_ear", "clip_on", "in_ear", "over_ear"]
VALID_REASON_CODES = {
    "PRICE_OUT_OF_RANGE",
    "RATING_BELOW_FLOOR",
    "REVIEWS_INSUFFICIENT",
    "OPPORTUNITY_SCORE_LOWER",
    "SUBCATEGORY_DUPLICATE",
    "MISSING_DETAIL",
}
NEAR_OPTIMAL_TOLERANCE = 0.05  # 5% relative
PRICE_CEILING = 80.0

# ---------------------------------------------------------------------------
# Capacity-migration folding map (docs/check-granularity.md R2/R3/R4/R6).
# Each capability check is the AND of its member ATOM ids. The atom predicates
# (run_check) are UNCHANGED — folding is pure aggregation, never loosening.
# This list is the complete, disjoint partition of the 26 atoms; the order is
# the emit order and must match the rubric.json "checks" id order.
# ---------------------------------------------------------------------------
GROUP_SPECS: list[tuple[str, list[str]]] = [
    ("setup_gate", [
        "sourcing_decision_json_exists",
        "sourcing_decision_json_parseable",
    ]),
    ("output_schema_valid", [
        "selected_asins_shape_correct",
        "selected_asins_no_duplicates",
        "rationale_aligned_with_asins",
        "subcategories_in_enum",
        "excluded_candidates_shape",
        "excluded_candidates_reason_codes_valid",
        "selection_reasons_substantive",
    ]),
    ("eligibility_filter_correct", [
        "asin_0_in_valid_set",
        "asin_1_in_valid_set",
        "asin_2_in_valid_set",
    ]),
    ("subcategory_derivation_correct", [
        "asin_0_subcategory_matches_ground_truth",
        "asin_1_subcategory_matches_ground_truth",
        "asin_2_subcategory_matches_ground_truth",
        "subcategories_all_distinct",
    ]),
    ("field_values_match_snapshot", [
        "field_values_match_snapshot",
    ]),
    ("opportunity_computation_correct", [
        "opportunity_scores_present",
        "opportunity_scores_correct",
        "portfolio_score_present",
        "portfolio_score_correct",
    ]),
    ("portfolio_is_optimal", [
        "portfolio_is_optimal",
    ]),
    ("distractor_traps_identified", [
        "excluded_candidates_overlap_traps",
    ]),
    ("portfolio_aggregates_correct", [
        "portfolio_avg_rating_correct",
        "portfolio_total_reviews_correct",
    ]),
    ("output_hygiene", [
        "outputs_dir_only_sourcing_decision",
    ]),
]


def is_close(a: Any, b: Any, abs_tol: float) -> bool:
    try:
        return math.isclose(float(a), float(b), rel_tol=0.0, abs_tol=abs_tol)
    except (TypeError, ValueError):
        return False


def is_close_rel(a: Any, b: Any, rel_tol: float, abs_floor: float = 1e-6) -> bool:
    try:
        af, bf = float(a), float(b)
    except (TypeError, ValueError):
        return False
    return math.isclose(af, bf, rel_tol=rel_tol, abs_tol=abs_floor)


def opportunity_formula(price: Any, rating: Any, reviews: Any) -> float | None:
    try:
        p, ra, re_ = float(price), float(rating), float(reviews)
    except (TypeError, ValueError):
        return None
    return math.log10(max(re_, 1.0)) * ra * (PRICE_CEILING - p) / 50.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", default="")
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir).resolve()
    reward_path = Path(args.reward_json)
    reward_path.parent.mkdir(parents=True, exist_ok=True)

    output_dir = Path(args.output_dir) if args.output_dir else task_dir / "outputs"
    pred_path = output_dir / "sourcing_decision.json"

    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    rubric = json.loads((task_dir / "rubric.json").read_text(encoding="utf-8-sig"))
    checks_spec = rubric.get("checks", [])

    valid_subcategories: list[str] = expected.get("valid_subcategories", VALID_SUBCATEGORIES_FALLBACK)
    valid_subcat_set: set[str] = set(valid_subcategories)
    asin_subcategory_gt: dict[str, str] = expected.get("asin_subcategory_gt", {})
    asin_field_gt: dict[str, dict[str, Any]] = expected.get("asin_field_gt", {})
    valid_asin_set: set[str] = set(expected.get("valid_asin_set", []))
    # Layer 1 GT — optimal portfolio
    optimal_portfolio: dict[str, Any] = expected.get("optimal_portfolio", {}) or {}
    optimal_score: float = float(optimal_portfolio.get("portfolio_score", 0.0) or 0.0)
    # Layer 2 GT — distractor traps. asin_field_gt is the source for L3 aggregates.
    obvious_traps_gt: list[dict[str, Any]] = expected.get("obvious_traps", []) or []
    obvious_traps_set: set[str] = {
        str(t["asin"]) for t in obvious_traps_gt
        if isinstance(t, dict) and t.get("asin")
    }

    # Load prediction
    pred: Any = None
    file_exists = pred_path.exists() and pred_path.stat().st_size > 0
    if file_exists:
        try:
            pred = json.loads(pred_path.read_text(encoding="utf-8-sig"))
        except Exception:
            pred = None

    parseable = isinstance(pred, dict)

    selected = (pred.get("selected_asins") if parseable else None) or []
    rationale = (pred.get("rationale") if parseable else None) or []

    asins_shape_ok = (
        isinstance(selected, list)
        and len(selected) == 3
        and all(isinstance(x, str) and x.strip() for x in selected)
    )
    no_dup = asins_shape_ok and len(set(selected)) == 3

    rationale_shape_ok = isinstance(rationale, list) and len(rationale) == 3
    rationale_aligned = (
        rationale_shape_ok
        and asins_shape_ok
        and all(
            isinstance(rationale[i], dict) and rationale[i].get("asin") == selected[i]
            for i in range(3)
        )
    )

    # Per-ASIN subcategory checks (only valid when rationale is shape-correct)
    def get_rationale_subcat(idx: int) -> str | None:
        if not rationale_shape_ok or idx >= len(rationale):
            return None
        r = rationale[idx]
        if not isinstance(r, dict):
            return None
        sc = r.get("subcategory")
        return sc if isinstance(sc, str) else None

    def get_rationale_field(idx: int, field: str) -> Any:
        if not rationale_shape_ok or idx >= len(rationale):
            return None
        r = rationale[idx]
        return r.get(field) if isinstance(r, dict) else None

    def check_field_match(idx: int) -> tuple[bool, str]:
        if not asins_shape_ok or not rationale_shape_ok:
            return False, "shape prerequisite failed"
        asin = selected[idx]
        gt = asin_field_gt.get(asin)
        if not gt:
            return False, f"no field GT for {asin}"
        # brand: case-insensitive
        got_brand = str(get_rationale_field(idx, "brand") or "").strip().casefold()
        want_brand = str(gt.get("brand") or "").strip().casefold()
        if got_brand != want_brand:
            return False, f"brand mismatch got={got_brand!r} want={want_brand!r}"
        # price: tolerance 0.01
        got_price = get_rationale_field(idx, "price")
        want_price = gt.get("price")
        if want_price is not None and not is_close(got_price, want_price, abs_tol=0.01):
            return False, f"price mismatch got={got_price!r} want={want_price!r}"
        # rating: tolerance 0.1
        got_rating = get_rationale_field(idx, "rating")
        want_rating = gt.get("rating")
        if want_rating is not None and not is_close(got_rating, want_rating, abs_tol=0.1):
            return False, f"rating mismatch got={got_rating!r} want={want_rating!r}"
        # reviews: integer exact (tolerance 0)
        got_reviews = get_rationale_field(idx, "reviews")
        want_reviews = gt.get("reviews")
        try:
            got_int = int(got_reviews) if got_reviews is not None else None
            want_int = int(want_reviews) if want_reviews is not None else None
        except (TypeError, ValueError):
            return False, f"reviews not numeric got={got_reviews!r}"
        if want_int is not None and got_int != want_int:
            return False, f"reviews mismatch got={got_int} want={want_int}"
        return True, "ok"

    def run_check(cid: str) -> tuple[bool, str]:
        if cid == "sourcing_decision_json_exists":
            return file_exists, ("ok" if file_exists else "file missing or empty")
        if cid == "sourcing_decision_json_parseable":
            return parseable, ("ok" if parseable else "parse failed or not a dict")
        if cid == "selected_asins_shape_correct":
            return asins_shape_ok, (
                "ok" if asins_shape_ok else f"got={selected!r} (expected list of 3 non-empty strings)"
            )
        if cid == "selected_asins_no_duplicates":
            return no_dup, ("ok" if no_dup else f"duplicates in {selected!r}")
        if cid == "rationale_aligned_with_asins":
            return rationale_aligned, (
                "ok" if rationale_aligned else "rationale[i].asin != selected_asins[i] or shape wrong"
            )

        m = re.match(r"^asin_(\d)_in_valid_set$", cid)
        if m:
            idx = int(m.group(1))
            if not asins_shape_ok:
                return False, "shape prerequisite failed"
            asin = selected[idx]
            ok = asin in valid_asin_set
            return ok, f"asin={asin} {'∈' if ok else '∉'} valid_asin_set (size={len(valid_asin_set)})"

        if cid == "subcategories_in_enum":
            if not rationale_shape_ok:
                return False, "shape prerequisite failed"
            scs = [get_rationale_subcat(i) for i in range(3)]
            bad = [sc for sc in scs if sc not in valid_subcat_set]
            ok = not bad
            return ok, ("ok" if ok else f"out-of-enum subcategories: {bad}")

        m = re.match(r"^asin_(\d)_subcategory_matches_ground_truth$", cid)
        if m:
            idx = int(m.group(1))
            if not asins_shape_ok or not rationale_shape_ok:
                return False, "shape prerequisite failed"
            asin = selected[idx]
            got = get_rationale_subcat(idx)
            want = asin_subcategory_gt.get(asin)
            if want is None:
                return False, f"no subcategory GT for {asin}"
            ok = got == want
            return ok, f"got={got!r} want={want!r}"

        if cid == "subcategories_all_distinct":
            if not rationale_shape_ok:
                return False, "shape prerequisite failed"
            scs = [get_rationale_subcat(i) for i in range(3)]
            ok = len(set(s for s in scs if s)) == 3
            return ok, ("ok" if ok else f"subcategories={scs}")

        if cid == "field_values_match_snapshot":
            results = [check_field_match(i) for i in range(3)]
            ok = all(r[0] for r in results)
            reason = "ok" if ok else "; ".join(f"[{i}] {results[i][1]}" for i in range(3) if not results[i][0])
            return ok, reason

        if cid == "selection_reasons_substantive":
            if not rationale_shape_ok:
                return False, "shape prerequisite failed"
            reasons = [
                str(get_rationale_field(i, "selection_reason") or "")
                for i in range(3)
            ]
            short = [i for i, r in enumerate(reasons) if len(r) < 50]
            ok = not short
            return ok, ("ok" if ok else f"selection_reason too short at idx {short}")

        if cid == "outputs_dir_only_sourcing_decision":
            if not output_dir.exists():
                return False, "output dir missing"
            extras = sorted(
                p.name for p in output_dir.iterdir()
                if p.is_file() and p.name != "sourcing_decision.json"
            )
            ok = not extras
            return ok, ("ok" if ok else f"extras={extras}")

        # ----- Layer 1: opportunity scores + portfolio score + optimality -----
        if cid == "opportunity_scores_present":
            if not rationale_shape_ok:
                return False, "shape prerequisite failed"
            missing = [i for i in range(3)
                       if not isinstance(get_rationale_field(i, "opportunity_score"), (int, float))]
            ok = not missing
            return ok, ("ok" if ok else f"missing/non-numeric at idx {missing}")

        if cid == "opportunity_scores_correct":
            if not rationale_shape_ok or not asins_shape_ok:
                return False, "shape prerequisite failed"
            problems = []
            for i in range(3):
                asin = selected[i]
                gt = asin_field_gt.get(asin, {})
                want = opportunity_formula(gt.get("price"), gt.get("rating"), gt.get("reviews"))
                got = get_rationale_field(i, "opportunity_score")
                if want is None:
                    problems.append(f"[{i}] no GT for {asin}")
                    continue
                if not isinstance(got, (int, float)) or not is_close_rel(got, want, NEAR_OPTIMAL_TOLERANCE):
                    problems.append(f"[{i}] got={got!r} want≈{want:.4f}")
            ok = not problems
            return ok, ("ok" if ok else "; ".join(problems))

        if cid == "portfolio_score_present":
            ps = pred.get("portfolio_score") if parseable else None
            ok = isinstance(ps, (int, float))
            return ok, ("ok" if ok else f"got={ps!r} (expected numeric)")

        if cid == "portfolio_score_correct":
            ps = pred.get("portfolio_score") if parseable else None
            if not isinstance(ps, (int, float)):
                return False, f"portfolio_score not numeric (got={ps!r})"
            if not rationale_shape_ok:
                return False, "rationale shape prerequisite failed"
            # sum of agent-declared per-asin opportunity_scores
            agent_ops = [get_rationale_field(i, "opportunity_score") for i in range(3)]
            if not all(isinstance(x, (int, float)) for x in agent_ops):
                return False, f"per-asin opportunity_scores not all numeric: {agent_ops}"
            expected_sum = sum(float(x) for x in agent_ops)  # type: ignore[arg-type]
            ok = is_close_rel(ps, expected_sum, NEAR_OPTIMAL_TOLERANCE)
            return ok, ("ok" if ok else f"portfolio_score={ps} vs sum-of-rationale={expected_sum:.4f}")

        if cid == "portfolio_is_optimal":
            if not asins_shape_ok:
                return False, "shape prerequisite failed"
            # Compute the agent's portfolio's true score from GT (not from agent-declared
            # opportunity_score — that's a separate check). If any selected ASIN lacks
            # a GT field, score 0.
            true_score = 0.0
            for asin in selected:
                gt = asin_field_gt.get(asin, {})
                op = opportunity_formula(gt.get("price"), gt.get("rating"), gt.get("reviews"))
                if op is None:
                    return False, f"no opportunity-derivable GT for {asin}"
                true_score += op
            if optimal_score <= 0:
                return False, "GT optimal_score is non-positive (data issue)"
            ratio = true_score / optimal_score
            ok = ratio >= (1.0 - NEAR_OPTIMAL_TOLERANCE)
            return ok, (
                f"score={true_score:.4f}/optimal={optimal_score:.4f} ratio={ratio:.4f} "
                f"(threshold={1.0 - NEAR_OPTIMAL_TOLERANCE:.2f})"
            )

        # ----- Layer 2: excluded_candidates -----
        excluded = pred.get("excluded_candidates") if parseable else None

        if cid == "excluded_candidates_shape":
            if not isinstance(excluded, list) or len(excluded) < 3:
                return False, f"got len={len(excluded) if isinstance(excluded, list) else '<not-list>'} (need ≥3)"
            for i, e in enumerate(excluded):
                if not isinstance(e, dict):
                    return False, f"[{i}] not a dict: {type(e).__name__}"
                for k in ("asin", "reason_code", "brief"):
                    if k not in e:
                        return False, f"[{i}] missing key {k!r}"
                    if not isinstance(e[k], str) or not e[k].strip():
                        return False, f"[{i}].{k} not a non-empty string"
            return True, f"ok (n={len(excluded)})"

        if cid == "excluded_candidates_reason_codes_valid":
            if not isinstance(excluded, list) or len(excluded) < 3:
                return False, "shape prerequisite failed"
            bad = []
            for i, e in enumerate(excluded):
                rc = e.get("reason_code") if isinstance(e, dict) else None
                if rc not in VALID_REASON_CODES:
                    bad.append(f"[{i}] reason_code={rc!r}")
            ok = not bad
            return ok, ("ok" if ok else "; ".join(bad))

        if cid == "excluded_candidates_overlap_traps":
            if not isinstance(excluded, list):
                return False, "shape prerequisite failed"
            excluded_asins: set[str] = {
                str(e["asin"]) for e in excluded
                if isinstance(e, dict) and e.get("asin")
            }
            overlap = excluded_asins & obvious_traps_set
            ok = len(overlap) >= 2
            return ok, (
                f"overlap={sorted(overlap)} (need ≥2 from obvious_traps "
                f"of size {len(obvious_traps_set)})"
            )

        # ----- Layer 3: portfolio aggregates -----
        if cid == "portfolio_avg_rating_correct":
            agent_val = pred.get("portfolio_avg_rating") if parseable else None
            if not isinstance(agent_val, (int, float)):
                return False, f"portfolio_avg_rating not numeric (got={agent_val!r})"
            if not asins_shape_ok:
                return False, "shape prerequisite failed"
            ratings = []
            for asin in selected:
                r = asin_field_gt.get(asin, {}).get("rating")
                if r is None:
                    return False, f"no rating GT for {asin}"
                ratings.append(float(r))
            want = sum(ratings) / len(ratings)
            ok = is_close(agent_val, want, abs_tol=0.05)
            return ok, ("ok" if ok else f"got={agent_val} want={want:.4f}")

        if cid == "portfolio_total_reviews_correct":
            agent_val = pred.get("portfolio_total_reviews") if parseable else None
            try:
                got_int = int(agent_val) if agent_val is not None else None
            except (TypeError, ValueError):
                return False, f"portfolio_total_reviews not integer (got={agent_val!r})"
            if got_int is None:
                return False, "portfolio_total_reviews missing"
            if not asins_shape_ok:
                return False, "shape prerequisite failed"
            total = 0
            for asin in selected:
                r = asin_field_gt.get(asin, {}).get("reviews")
                if r is None:
                    return False, f"no reviews GT for {asin}"
                total += int(r)
            ok = got_int == total
            return ok, ("ok" if ok else f"got={got_int} want={total}")

        return False, f"unknown check id {cid!r}"

    # ---- Evaluate every ATOM once (predicates unchanged), then fold ----
    atom_results: dict[str, tuple[bool, str]] = {
        atom_id: run_check(atom_id)
        for _, members in GROUP_SPECS
        for atom_id in members
    }

    # Map rubric check_type by group id (falls back to deterministic_exact).
    check_type_by_id: dict[str, str] = {
        c["id"]: c.get("check_type", "") for c in checks_spec
    }

    results = []
    passed = 0
    for group_id, members in GROUP_SPECS:
        sub = [(m, *atom_results[m]) for m in members]
        ok = all(s[1] for s in sub)
        if ok:
            reason = f"ok ({len(members)}/{len(members)} atoms)"
        else:
            failed = [f"{m}: {r}" for (m, p, r) in sub if not p]
            reason = "; ".join(failed)
        results.append({
            "id": group_id,
            "passed": ok,
            "reason": reason,
            "check_type": check_type_by_id.get(group_id, "deterministic_exact"),
        })
        if ok:
            passed += 1

    total = len(GROUP_SPECS)
    score = passed / total if total > 0 else 0.0

    reward = {
        "schema_version": "2.0",
        "task_id": rubric.get("task_id"),
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
