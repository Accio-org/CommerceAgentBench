#!/usr/bin/env python3
"""Verification script for file-commerce-ops-search-ad-bid-optimization task.

Capacity-refactor note (2026-06-09): the underlying per-keyword / per-field
validation logic is UNCHANGED. Only the *emit* layer was refactored — the many
atomic pass/fail observations are now aggregated into distinct capability-unit
checks (see docs/check-granularity.md). Each emitted check = AND(its atomic
members); failing members are surfaced in the ``reason`` for debugging. The
binary pass (``all(checks)``) is identical to the old 39-atomic schema because
the grouping is a complete, disjoint partition of the same atomic conditions.
"""
import argparse
import csv
import json
import os


def load_csv(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader)


def load_json(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _coerce_float(v) -> float:
    """Float coercion tolerant of natural CSV/commerce formats.

    Accepts `$1,234.56`, `1,234`, `12%`, trailing `USD`/`CNY`. Raises ValueError
    when *v* is not coercible — keeps the same surface as the bare ``float(v)``
    calls this replaces (callers wrap them in try/except already)."""
    s = str(v).strip()
    if not s:
        raise ValueError("empty")
    cleaned = s.replace("$", "").replace("¥", "").replace(",", "").strip()
    for suffix in ("USD", "CNY", "%"):
        if cleaned.upper().endswith(suffix):
            cleaned = cleaned[: -len(suffix)].strip()
    return float(cleaned)


def rubric_check_ids(task_dir):
    try:
        rubric = load_json(os.path.join(task_dir, "rubric.json"))
    except Exception:
        return []
    checks = rubric.get("checks", []) if isinstance(rubric, dict) else []
    return [c.get("id") for c in checks if isinstance(c, dict) and c.get("id")]


def align_results_to_rubric(task_dir, results):
    check_ids = rubric_check_ids(task_dir)
    if not check_ids:
        return results
    by_id = {}
    for rid, ok, msg in results:
        by_id.setdefault(rid, (rid, ok, msg))
    aligned = []
    for rid in check_ids:
        aligned.append(
            by_id.get(
                rid,
                (rid, False, "not evaluated because prerequisite output was missing or invalid"),
            )
        )
    return aligned


def approx(a, b, tol):
    return abs(_coerce_float(a) - _coerce_float(b)) <= tol


def normalize_summary_keyword(item, diag_by_id):
    if isinstance(item, dict):
        for key in ("keyword_id", "id"):
            value = str(item.get(key, "")).strip()
            if value:
                return value
        keyword = str(item.get("keyword", "")).strip()
    else:
        keyword = str(item).strip()
    if keyword in diag_by_id:
        return keyword
    for kw_id, row in diag_by_id.items():
        if keyword == str(row.get("keyword", "")).strip():
            return kw_id
    return keyword


def warning_mentions_keyword(warning, kw_id, diag_by_id):
    text = str(warning or "").lower()
    keyword = str(diag_by_id.get(kw_id, {}).get("keyword", "")).lower()
    if kw_id.lower() in text:
        return True
    return bool(keyword and keyword in text)


def run_checks(task_dir, output_dir):
    """Run the same atomic validations as before, but emit capability-grouped checks.

    Internally we collect every atomic (id, ok, detail) observation, then fold
    them into capability units. The aggregation is pure AND over a complete,
    disjoint partition of the atomic set, so ``all(grouped) == all(atomic)``.
    """
    expected = load_json(os.path.join(task_dir, "private", "expected_answer.json"))
    diag_by_id = {}

    # atomic[id] = (ok, detail). detail is only surfaced when the atomic fails.
    atomic = {}

    def record(aid, ok, detail=""):
        atomic[aid] = (bool(ok), detail)

    def fail_msg(*aids):
        """Build a reason listing the failing atomic members of a group."""
        bad = []
        for aid in aids:
            ok, detail = atomic.get(aid, (False, "not evaluated"))
            if not ok:
                bad.append(f"{aid}: {detail}" if detail else aid)
        return "ok" if not bad else "; ".join(bad)

    # ------------------------------------------------------------------
    # ATOMIC VALIDATIONS (logic identical to the pre-refactor verifier)
    # ------------------------------------------------------------------

    # --- keyword_diagnosis.csv ---
    diag_path = os.path.join(output_dir, "keyword_diagnosis.csv")
    if not os.path.isfile(diag_path):
        record("diagnosis_exists", False, "keyword_diagnosis.csv not found")
    else:
        record("diagnosis_exists", True)
        try:
            diag = load_csv(diag_path)

            record("diagnosis_row_count", len(diag) == 20,
                   f"Expected 20 rows, got {len(diag)}")

            if not diag:
                raise ValueError("keyword_diagnosis.csv has no data rows")

            required_cols = ["keyword_id", "action", "final_bid", "adjusted_roi",
                             "diagnosis", "projected_daily_cost", "ltv_multiplier"]
            missing = [c for c in required_cols if c not in diag[0]]
            record("diagnosis_columns", len(missing) == 0,
                   f"Missing columns: {missing}")

            diag_by_id = {row["keyword_id"]: row for row in diag}

            # anomaly detection (CTR>10% -> excluded, bid=0)
            for kw_id in ["KW05", "KW10", "KW20"]:
                if kw_id in diag_by_id:
                    row = diag_by_id[kw_id]
                    passed = (row.get("action", "").strip().lower() == "excluded" and
                              approx(row.get("final_bid", -1), 0, 0.01))
                    record(f"anomaly_{kw_id}", passed,
                           f"action={row.get('action')}, bid={row.get('final_bid')}")
                else:
                    record(f"anomaly_{kw_id}", False, f"{kw_id} not found")

            # insufficient data KW14
            if "KW14" in diag_by_id:
                row = diag_by_id["KW14"]
                passed = row.get("action", "").strip().lower() == "insufficient"
                record("insufficient_KW14", passed, f"action={row.get('action')}")
            else:
                record("insufficient_KW14", False, "KW14 not found")

            # LTV adjustments
            for kw_id, exp_mult, exp_adj_rev in [("KW07", 2.5, 225.0), ("KW18", 3.0, 525.0)]:
                if kw_id in diag_by_id:
                    row = diag_by_id[kw_id]
                    mult_ok = approx(row.get("ltv_multiplier", 0), exp_mult, 0.01)
                    adj_ok = approx(row.get("adjusted_revenue", 0), exp_adj_rev, 1.0)
                    record(f"ltv_{kw_id}", mult_ok and adj_ok,
                           f"mult={row.get('ltv_multiplier')}, adj_rev={row.get('adjusted_revenue')}")
                else:
                    record(f"ltv_{kw_id}", False, f"{kw_id} not found")

            # brand protection KW19
            if "KW19" in diag_by_id:
                row = diag_by_id["KW19"]
                passed = (row.get("action", "").strip().lower() == "brand_protect" and
                          approx(row.get("final_bid", 0), 0.50, 0.01))
                record("brand_protect_KW19", passed,
                       f"action={row.get('action')}, bid={row.get('final_bid')}")
            else:
                record("brand_protect_KW19", False, "KW19 not found")

            # KW12 paused (LTV=1.0 no rescue)
            if "KW12" in diag_by_id:
                row = diag_by_id["KW12"]
                passed = (row.get("action", "").strip().lower() == "pause" and
                          approx(row.get("final_bid", 1), 0, 0.01))
                record("pause_KW12", passed,
                       f"action={row.get('action')}, bid={row.get('final_bid')}")
            else:
                record("pause_KW12", False, "KW12 not found")

            # ROI-tier action classification
            for kw_id, exp_action in [("KW01", "increase"), ("KW03", "increase"),
                                       ("KW08", "increase"), ("KW02", "keep"),
                                       ("KW04", "decrease"), ("KW17", "decrease")]:
                aid = f"action_{kw_id}_{exp_action}"
                if kw_id in diag_by_id:
                    row = diag_by_id[kw_id]
                    passed = row.get("action", "").strip().lower() == exp_action
                    record(aid, passed, f"expected={exp_action}, got={row.get('action')}")
                else:
                    record(aid, False, f"{kw_id} not found")

            # budget-scaled final bids (per-keyword)
            exp_bids = expected["final_bids"]
            for kw_id in ["KW01", "KW08", "KW15"]:
                if kw_id in diag_by_id:
                    row = diag_by_id[kw_id]
                    passed = approx(row.get("final_bid", 0), exp_bids[kw_id], 0.02)
                    record(f"bid_{kw_id}", passed,
                           f"expected≈{exp_bids[kw_id]}, got={row.get('final_bid')}")
                else:
                    record(f"bid_{kw_id}", False, f"{kw_id} not found")

            # competitor warning flag on KW15 row
            if "KW15" in diag_by_id:
                row = diag_by_id["KW15"]
                passed = row.get("competitor_warning", "").strip().lower() == "true"
                record("competitor_warning_KW15", passed,
                       f"competitor_warning={row.get('competitor_warning')}")
            else:
                record("competitor_warning_KW15", False, "KW15 not found")

        except Exception as e:
            # parse failure invalidates every diagnosis-derived atomic
            for aid in ["diagnosis_row_count", "diagnosis_columns",
                        "anomaly_KW05", "anomaly_KW10", "anomaly_KW20",
                        "insufficient_KW14", "ltv_KW07", "ltv_KW18",
                        "brand_protect_KW19", "pause_KW12",
                        "action_KW01_increase", "action_KW03_increase",
                        "action_KW08_increase", "action_KW02_keep",
                        "action_KW04_decrease", "action_KW17_decrease",
                        "bid_KW01", "bid_KW08", "bid_KW15",
                        "competitor_warning_KW15"]:
                atomic.setdefault(aid, (False, f"diagnosis parse error: {e}"))

    # --- bid_plan.csv ---
    plan_path = os.path.join(output_dir, "bid_plan.csv")
    if not os.path.isfile(plan_path):
        record("plan_exists", False, "bid_plan.csv not found")
    else:
        record("plan_exists", True)
        try:
            plan = load_csv(plan_path)

            record("plan_row_count", len(plan) == 16,
                   f"Expected 16 rows, got {len(plan)}")

            plan_ids = [row.get("keyword_id", "").strip() for row in plan]
            excluded = {"KW05", "KW10", "KW12", "KW20"}
            has_excluded = excluded.intersection(set(plan_ids))
            record("plan_no_excluded", len(has_excluded) == 0,
                   f"Found excluded/paused keywords in plan: {has_excluded}")

            if len(plan) >= 2:
                bids = [_coerce_float(row.get("final_bid", 0)) for row in plan]
                is_sorted = all(bids[i] >= bids[i + 1] for i in range(len(bids) - 1))
                record("plan_sorted", is_sorted, "Not sorted by final_bid desc")
            else:
                record("plan_sorted", False, "Too few rows to check sort")

        except Exception as e:
            for aid in ["plan_row_count", "plan_no_excluded", "plan_sorted"]:
                atomic.setdefault(aid, (False, f"bid_plan parse error: {e}"))

    # --- optimization_summary.json ---
    summary_path = os.path.join(output_dir, "optimization_summary.json")
    if not os.path.isfile(summary_path):
        record("summary_exists", False, "optimization_summary.json not found")
    else:
        record("summary_exists", True)
        try:
            summary = load_json(summary_path)
            exp_summary = expected["summary"]

            for field, exp_val in [("total_keywords", 20), ("anomaly_excluded", 3),
                                    ("insufficient_data", 1), ("paused", 1),
                                    ("brand_protected", 1), ("ltv_adjusted", 2),
                                    ("active_keywords", 16)]:
                actual = summary.get(field)
                record(f"summary_{field}", actual == exp_val,
                       f"Expected {exp_val}, got {actual}")

            bs = summary.get("budget_status", {})
            record("summary_budget_exceeded", bs.get("exceeded") == True,
                   f"Expected exceeded=true, got {bs.get('exceeded')}")

            sf = bs.get("scale_factor", 0)
            record("summary_scale_factor", approx(sf, exp_summary["scale_factor"], 0.005),
                   f"Expected≈{exp_summary['scale_factor']}, got {sf}")

            pas = bs.get("projected_after_scale", 0)
            record("summary_projected_after", approx(pas, exp_summary["projected_after_scale"], 2.0),
                   f"Expected≈{exp_summary['projected_after_scale']}, got {pas}")

            ad = summary.get("action_distribution", {})
            exp_ad = exp_summary["action_distribution"]
            dist_ok = all(ad.get(k) == v for k, v in exp_ad.items())
            record("summary_action_dist", dist_ok, f"Expected {exp_ad}, got {ad}")

            top3 = summary.get("top3_roi_keywords", [])
            exp_top3 = exp_summary["top3_roi_keywords"]
            normalized_top3 = [normalize_summary_keyword(item, diag_by_id) for item in top3[:3]]
            record("summary_top3_roi", normalized_top3 == exp_top3,
                   f"Expected {exp_top3}, got {top3} normalized={normalized_top3}")

            warnings = summary.get("competitor_warnings", [])
            has_kw15 = any(warning_mentions_keyword(w, "KW15", diag_by_id) for w in warnings)
            record("summary_competitor_warning", has_kw15,
                   f"Expected warning about KW15, got {warnings}")

        except Exception as e:
            for aid in ["summary_total_keywords", "summary_anomaly_excluded",
                        "summary_insufficient_data", "summary_paused",
                        "summary_brand_protected", "summary_ltv_adjusted",
                        "summary_active_keywords", "summary_budget_exceeded",
                        "summary_scale_factor", "summary_projected_after",
                        "summary_action_dist", "summary_top3_roi",
                        "summary_competitor_warning"]:
                atomic.setdefault(aid, (False, f"summary parse error: {e}"))

    # ------------------------------------------------------------------
    # CAPABILITY GROUPING (pure AND over a disjoint partition of `atomic`)
    # ------------------------------------------------------------------
    # Each group = (check_id, [atomic member ids]). all(group) == all(atomic).
    groups = [
        ("setup_gate", [
            "diagnosis_exists", "diagnosis_row_count", "diagnosis_columns",
            "plan_exists", "summary_exists",
        ]),
        ("anomaly_detection", ["anomaly_KW05", "anomaly_KW10", "anomaly_KW20"]),
        ("insufficient_data_gate", ["insufficient_KW14"]),
        ("ltv_revenue_adjustment", ["ltv_KW07", "ltv_KW18"]),
        ("brand_protection", ["brand_protect_KW19"]),
        ("negative_roi_pause", ["pause_KW12"]),
        ("roi_action_classification", [
            "action_KW01_increase", "action_KW03_increase", "action_KW08_increase",
            "action_KW02_keep", "action_KW04_decrease", "action_KW17_decrease",
        ]),
        ("bid_budget_scaling", [
            "bid_KW01", "bid_KW08", "bid_KW15",
            "summary_budget_exceeded", "summary_scale_factor", "summary_projected_after",
        ]),
        ("competitor_warning", ["competitor_warning_KW15", "summary_competitor_warning"]),
        ("bid_plan_deliverable", ["plan_row_count", "plan_no_excluded", "plan_sorted"]),
        ("summary_classification_tallies", [
            "summary_total_keywords", "summary_anomaly_excluded",
            "summary_insufficient_data", "summary_paused", "summary_brand_protected",
            "summary_ltv_adjusted", "summary_active_keywords", "summary_action_dist",
        ]),
        ("top3_roi_ranking", ["summary_top3_roi"]),
    ]

    results = []
    for gid, members in groups:
        ok = all(atomic.get(m, (False, ""))[0] for m in members)
        results.append((gid, ok, fail_msg(*members)))
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    args = parser.parse_args()

    results = align_results_to_rubric(args.task_dir, run_checks(args.task_dir, args.output_dir))

    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)

    checks = [
        {"id": rid, "passed": bool(ok), "reason": str(msg or ""), "check_type": "deterministic_exact"}
        for rid, ok, msg in results
    ]
    score = round(passed / total, 4) if total > 0 else 0.0
    reward = {
        "schema_version": "2.0",
        "task_id": "file-commerce-ops-search-ad-bid-optimization",
        "score": score,
        "reward": score,
        "passed": total > 0 and passed == total,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "summary": f"{passed}/{total} checks passed",
        "source": "v2_verify_task",
    }

    os.makedirs(os.path.dirname(args.reward_json), exist_ok=True)
    with open(args.reward_json, "w", encoding="utf-8") as f:
        json.dump(reward, f, ensure_ascii=False, indent=2)

    print(f"Score: {passed}/{total} = {reward['score']}")
    for rid, ok, msg in results:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {rid}: {msg}")


if __name__ == "__main__":
    main()
