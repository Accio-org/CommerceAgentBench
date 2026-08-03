"""Standalone verifier for cli-commerce-skincare-order-reconciliation."""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path


def load_expected(task_dir: Path) -> dict:
    p = task_dir / "private" / "expected_answer.json"
    with open(p, encoding="utf-8-sig") as f:
        return json.load(f)


def _coerce_float(v) -> float:
    """Float coercion tolerant of natural commerce/CSV formats.

    Accepts ``$1,234.56`` / ``1,234`` / ``12%`` / trailing ``USD``/``CNY``;
    leading ``+`` is stripped (some agents emit signed differences). Raises
    ``ValueError`` for non-coercible input so existing callers can rely on
    the same surface as bare ``float(...)``."""
    s = str(v).strip().lstrip("+")
    if not s:
        raise ValueError("empty")
    cleaned = s.replace("$", "").replace("¥", "").replace(",", "").strip()
    for suffix in ("USD", "CNY", "%"):
        if cleaned.upper().endswith(suffix):
            cleaned = cleaned[: -len(suffix)].strip()
    return float(cleaned)


def check(results: list, cid: str, passed: bool, detail: str = ""):
    results.append({"id": cid, "passed": passed, "detail": detail})


# ---------------------------------------------------------------------------
# Capacity-check fold (2026-06-09, pure aggregation — see docs/check-granularity.md)
#
# The verifier still computes every atomic predicate below exactly as before
# (byte-identical expressions, collected via check() into `results`). The only
# change is the EMITTED check granularity: the 20 atoms are aggregated into 8
# capability units via AND. new_group.passed == all(member atoms). Per-case
# binary pass (score==1.0) is unchanged; per-atom detail survives in `reason`.
#
# Grouping (atom id -> capability unit):
#   setup_gate                      = unified_orders_exists ∧ exceptions_exists
#                                     ∧ monthly_summary_exists   (R2: pure file/JSON presence)
#   unified_orders_schema_normalized= columns ∧ date_format ∧ status_normalized
#                                     ∧ sample_jd ∧ sample_pdd   (heterogeneous-export
#                                     standardization: schema/date/status + cross-platform mapping)
#   unified_orders_dedup_and_remap  = row_count ∧ pdd_dedup ∧ legacy_sku  (R4: the two
#                                     seeded data-quality traps + resulting cardinality)
#   fulfillment_exceptions_correct  = fulfillment_count ∧ fulfillment_types (ship-log cross-check)
#   settlement_discrepancy_correct  = settlement_jd  (settlement recon w/ effective commission + sign)
#   data_quality_issues_correct     = data_quality   (data-quality reporting)
#   sku_performance_correct         = sku_performance_exists ∧ pdd_commission ∧ profit_accuracy
#                                     (per-SKU×platform profit; *_exists carries the 5×3=15 matrix
#                                     cardinality semantic, not pure plumbing)
#   monthly_summary_correct         = monthly_summary_totals ∧ monthly_summary_best_worst
# ---------------------------------------------------------------------------
GROUP_SPECS = [
    ("setup_gate", [
        "unified_orders_exists", "exceptions_exists", "monthly_summary_exists",
    ]),
    ("unified_orders_schema_normalized", [
        "unified_orders_columns", "unified_orders_date_format",
        "unified_orders_status_normalized", "unified_orders_sample_jd",
        "unified_orders_sample_pdd",
    ]),
    ("unified_orders_dedup_and_remap", [
        "unified_orders_row_count", "unified_orders_pdd_dedup",
        "unified_orders_legacy_sku",
    ]),
    ("fulfillment_exceptions_correct", [
        "exceptions_fulfillment_count", "exceptions_fulfillment_types",
    ]),
    ("settlement_discrepancy_correct", [
        "exceptions_settlement_jd",
    ]),
    ("data_quality_issues_correct", [
        "exceptions_data_quality",
    ]),
    ("sku_performance_correct", [
        "sku_performance_exists", "sku_performance_pdd_commission",
        "sku_performance_profit_accuracy",
    ]),
    ("monthly_summary_correct", [
        "monthly_summary_totals", "monthly_summary_best_worst",
    ]),
]


def fold_atoms(results: list) -> list:
    """Aggregate the per-atom results into capability-unit checks (AND).

    Internal per-atom validation is unchanged; this only reshapes the emitted
    breakdown. Each group passes iff all its member atoms passed; failing
    members (with their per-atom reason) are listed in the group's reason.
    """
    by_id = {r["id"]: r for r in results}
    grouped = []
    for gid, member_ids in GROUP_SPECS:
        members = [by_id[mid] for mid in member_ids if mid in by_id]
        ok = bool(members) and all(m.get("passed") for m in members)
        if ok:
            reason = "ok"
        else:
            fails = [
                f"{m['id']}: {m.get('detail') or 'fail'}"
                for m in members if not m.get("passed")
            ]
            missing = [mid for mid in member_ids if mid not in by_id]
            if missing:
                fails.append(f"missing atoms: {missing}")
            reason = "; ".join(fails) if fails else "fail"
        grouped.append({
            "id": gid,
            "passed": ok,
            "reason": reason,
            "check_type": "deterministic_exact",
        })
    return grouped


def verify_unified_orders(output_dir: Path, expected: dict, results: list):
    upath = output_dir / "unified_orders.csv"
    if not upath.exists():
        check(results, "unified_orders_exists", False, "file not found")
        for cid in ["unified_orders_row_count", "unified_orders_columns",
                     "unified_orders_pdd_dedup", "unified_orders_legacy_sku",
                     "unified_orders_date_format", "unified_orders_status_normalized",
                     "unified_orders_sample_jd", "unified_orders_sample_pdd"]:
            check(results, cid, False, "skipped — file missing")
        return

    check(results, "unified_orders_exists", True)

    exp = expected["unified_orders"]
    cols = exp["columns"]
    with open(upath, encoding="utf-8-sig", newline="") as f:
        raw = [r for r in csv.reader(f) if r and any(c.strip() for c in r)]
    rows = [dict(zip(cols, r)) for r in raw]
    bad_arity = [i for i, r in enumerate(raw) if len(r) != len(cols)]

    # Row count
    check(results, "unified_orders_row_count",
          len(rows) == exp["total_rows"],
          f"got {len(rows)}, expected {exp['total_rows']}")

    # Columns (positional: every row must have exactly the expected arity)
    check(results, "unified_orders_columns",
          len(bad_arity) == 0,
          f"rows with wrong field count: {bad_arity[:5]}")

    rows_by_id = {r.get("order_id", ""): r for r in rows}

    # PDD dedup
    dup_ids = exp["duplicate_order_ids"]
    dup_ok = all(
        sum(1 for r in rows if r.get("order_id") == did) == 1
        for did in dup_ids
    )
    check(results, "unified_orders_pdd_dedup", dup_ok,
          f"duplicate IDs: {dup_ids}")

    # Legacy SKU
    legacy_row = rows_by_id.get(exp["legacy_sku_order_id"])
    if legacy_row:
        check(results, "unified_orders_legacy_sku",
              legacy_row.get("internal_sku") == exp["legacy_sku_mapped_to"],
              f"got {legacy_row.get('internal_sku')}")
    else:
        check(results, "unified_orders_legacy_sku", False,
              f"order {exp['legacy_sku_order_id']} not found")

    # Date format
    date_re = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    bad_dates = [r.get("order_id", "") for r in rows
                 if not date_re.match(r.get("order_date", ""))]
    check(results, "unified_orders_date_format",
          len(bad_dates) == 0,
          f"{len(bad_dates)} bad dates" if bad_dates else "")

    # Status normalized
    valid_statuses = {"completed", "cancelled", "refunded", "pending", "paid", "shipped"}
    bad_status = [r.get("order_id", "") for r in rows
                  if r.get("status", "") not in valid_statuses]
    check(results, "unified_orders_status_normalized",
          len(bad_status) == 0,
          f"{len(bad_status)} bad statuses" if bad_status else "")

    # Sample rows
    for sample_id, sample_exp in exp["sample_rows"].items():
        cid_suffix = {"JD-2026060103": "sample_jd", "PDD20260601004": "sample_pdd"}.get(sample_id)
        if not cid_suffix:
            continue
        row = rows_by_id.get(sample_id)
        if not row:
            check(results, f"unified_orders_{cid_suffix}", False, f"{sample_id} not found")
            continue
        ok = (row.get("platform") == sample_exp["platform"]
              and row.get("internal_sku") == sample_exp["internal_sku"]
              and int(row.get("qty", 0)) == sample_exp["qty"]
              and row.get("order_date") == sample_exp["order_date"]
              and row.get("status") == sample_exp["status"])
        check(results, f"unified_orders_{cid_suffix}", ok,
              f"got {row}" if not ok else "")


def verify_exceptions(output_dir: Path, expected: dict, results: list):
    epath = output_dir / "exceptions.json"
    if not epath.exists():
        check(results, "exceptions_exists", False, "file not found")
        for cid in ["exceptions_fulfillment_count", "exceptions_fulfillment_types",
                     "exceptions_settlement_jd", "exceptions_data_quality"]:
            check(results, cid, False, "skipped — file missing")
        return

    try:
        with open(epath, encoding="utf-8-sig") as f:
            data = json.load(f)
        check(results, "exceptions_exists", True)
    except json.JSONDecodeError as e:
        check(results, "exceptions_exists", False, f"invalid JSON: {e}")
        for cid in ["exceptions_fulfillment_count", "exceptions_fulfillment_types",
                     "exceptions_settlement_jd", "exceptions_data_quality"]:
            check(results, cid, False, "skipped — invalid JSON")
        return

    exp_exc = expected["exceptions"]

    # Fulfillment count
    ff = data.get("fulfillment_exceptions", [])
    check(results, "exceptions_fulfillment_count",
          len(ff) == len(exp_exc["fulfillment_exceptions"]),
          f"got {len(ff)}, expected {len(exp_exc['fulfillment_exceptions'])}")

    # Fulfillment types
    type_counts = {}
    for e in ff:
        t = e.get("type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
    exp_type_counts = {}
    for e in exp_exc["fulfillment_exceptions"]:
        t = e["type"]
        exp_type_counts[t] = exp_type_counts.get(t, 0) + 1
    check(results, "exceptions_fulfillment_types",
          type_counts == exp_type_counts,
          f"got {type_counts}, expected {exp_type_counts}")

    # Settlement JD
    sd = data.get("settlement_discrepancies", [])
    jd_disc = [d for d in sd if d.get("platform") == "jd"]
    exp_jd = [d for d in exp_exc["settlement_discrepancies"] if d["platform"] == "jd"]
    if exp_jd and jd_disc:
        diff_ok = abs(_coerce_float(jd_disc[0].get("difference", "0")) -
                      _coerce_float(exp_jd[0]["difference"])) < 0.02
        check(results, "exceptions_settlement_jd", diff_ok,
              f"got diff={jd_disc[0].get('difference')}, expected {exp_jd[0]['difference']}")
    elif exp_jd and not jd_disc:
        check(results, "exceptions_settlement_jd", False, "JD discrepancy not found")
    else:
        check(results, "exceptions_settlement_jd", True)

    # Data quality
    dq = data.get("data_quality_issues", [])
    has_dup = any(d.get("type") == "duplicate_order" for d in dq)
    has_legacy = any(d.get("type") == "legacy_sku" for d in dq)
    check(results, "exceptions_data_quality",
          has_dup and has_legacy,
          f"dup={has_dup}, legacy={has_legacy}")


def verify_sku_performance(output_dir: Path, expected: dict, results: list):
    spath = output_dir / "sku_performance.csv"
    if not spath.exists():
        check(results, "sku_performance_exists", False, "file not found")
        for cid in ["sku_performance_pdd_commission", "sku_performance_profit_accuracy"]:
            check(results, cid, False, "skipped — file missing")
        return

    with open(spath, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    check(results, "sku_performance_exists",
          len(rows) == len(expected["sku_performance"]),
          f"got {len(rows)} rows, expected {len(expected['sku_performance'])}")

    rows_by_key = {(r.get("internal_sku", ""), r.get("platform", "")): r for r in rows}
    exp_rows = {(r["internal_sku"], r["platform"]): r for r in expected["sku_performance"]}

    # PDD commission check
    pdd_hem = rows_by_key.get(("LC-HEM-01", "pdd"))
    exp_pdd_hem = exp_rows.get(("LC-HEM-01", "pdd"))
    if pdd_hem and exp_pdd_hem:
        comm_ok = abs(_coerce_float(pdd_hem.get("commission", 0)) - _coerce_float(exp_pdd_hem["commission"])) < 0.02
        check(results, "sku_performance_pdd_commission", comm_ok,
              f"got {pdd_hem.get('commission')}, expected {exp_pdd_hem['commission']}")
    else:
        check(results, "sku_performance_pdd_commission", False,
              "LC-HEM-01/pdd row not found")

    # Profit accuracy
    profit_ok = True
    bad_profits = []
    for key, exp_row in exp_rows.items():
        row = rows_by_key.get(key)
        if not row:
            profit_ok = False
            bad_profits.append(f"{key}: missing")
            continue
        try:
            diff = abs(_coerce_float(row.get("net_profit", 0)) - _coerce_float(exp_row["net_profit"]))
            if diff > 0.02:
                profit_ok = False
                bad_profits.append(f"{key}: got {row.get('net_profit')}, expected {exp_row['net_profit']}")
        except (ValueError, TypeError):
            profit_ok = False
            bad_profits.append(f"{key}: parse error")

    check(results, "sku_performance_profit_accuracy", profit_ok,
          "; ".join(bad_profits[:3]) if bad_profits else "")


def verify_monthly_summary(output_dir: Path, expected: dict, results: list):
    mpath = output_dir / "monthly_summary.json"
    if not mpath.exists():
        check(results, "monthly_summary_exists", False, "file not found")
        for cid in ["monthly_summary_totals", "monthly_summary_best_worst"]:
            check(results, cid, False, "skipped — file missing")
        return

    try:
        with open(mpath, encoding="utf-8-sig") as f:
            data = json.load(f)
        check(results, "monthly_summary_exists", True)
    except json.JSONDecodeError as e:
        check(results, "monthly_summary_exists", False, f"invalid JSON: {e}")
        for cid in ["monthly_summary_totals", "monthly_summary_best_worst"]:
            check(results, cid, False, "skipped — invalid JSON")
        return

    exp_ms = expected["monthly_summary"]

    # Totals
    def approx(a, b, tol=0.02):
        try:
            return abs(_coerce_float(a) - _coerce_float(b)) < tol
        except (ValueError, TypeError):
            return False

    totals_ok = (
        approx(data.get("total_revenue"), exp_ms["total_revenue"])
        and approx(data.get("total_cogs"), exp_ms["total_cogs"])
        and approx(data.get("total_commission"), exp_ms["total_commission"])
        and approx(data.get("net_profit"), exp_ms["net_profit"])
    )
    detail = ""
    if not totals_ok:
        detail = (f"rev={data.get('total_revenue')}(exp {exp_ms['total_revenue']}), "
                  f"cogs={data.get('total_cogs')}(exp {exp_ms['total_cogs']}), "
                  f"comm={data.get('total_commission')}(exp {exp_ms['total_commission']}), "
                  f"profit={data.get('net_profit')}(exp {exp_ms['net_profit']})")
    check(results, "monthly_summary_totals", totals_ok, detail)

    # Best/worst SKU
    best = data.get("best_sku", {})
    worst = data.get("worst_sku", {})
    bw_ok = (best.get("sku") == exp_ms["best_sku"]["sku"]
             and worst.get("sku") == exp_ms["worst_sku"]["sku"])
    check(results, "monthly_summary_best_worst", bw_ok,
          f"best={best.get('sku')}, worst={worst.get('sku')}" if not bw_ok else "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    reward_path = Path(args.reward_json)

    try:
        expected = load_expected(task_dir)
    except (FileNotFoundError, json.JSONDecodeError, OSError) as e:
        checks = [
            {"id": "expected_answer_loaded", "passed": False,
             "reason": f"expected_answer.json unavailable: {e}",
             "check_type": "deterministic_exact"}
        ]
        reward = {
            "schema_version": "2.0",
            "task_id": task_dir.name,
            "score": 0.0,
            "reward": 0.0,
            "passed": False,
            "checks_passed": 0,
            "checks_total": 1,
            "checks_breakdown": checks,
            "summary": "0/1 checks passed",
            "source": "v2_verify_task",
        }
        reward_path.parent.mkdir(parents=True, exist_ok=True)
        with open(reward_path, "w", encoding="utf-8") as f:
            json.dump(reward, f, indent=2, ensure_ascii=False)
        print(f"Score: 0/1 = 0.00%")
        print(f"  [FAIL] expected_answer_loaded — {e}")
        return 0

    results = []

    verify_unified_orders(output_dir, expected, results)
    verify_exceptions(output_dir, expected, results)
    verify_sku_performance(output_dir, expected, results)
    verify_monthly_summary(output_dir, expected, results)

    # Fold the 20 atoms into 8 capability-unit checks (pure AND aggregation).
    checks = fold_atoms(results)

    passed = sum(1 for r in checks if r["passed"])
    total = len(checks)
    score = round(passed / total, 4) if total > 0 else 0.0

    reward = {
        "schema_version": "2.0",
        "task_id": task_dir.name,
        "score": score,
        "reward": score,
        "passed": total > 0 and passed == total,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "summary": f"{passed}/{total} checks passed",
        "source": "v2_verify_task",
    }

    reward_path.parent.mkdir(parents=True, exist_ok=True)
    with open(reward_path, "w", encoding="utf-8") as f:
        json.dump(reward, f, indent=2, ensure_ascii=False)

    print(f"Score: {passed}/{total} = {score:.2%}")
    for r in checks:
        mark = "PASS" if r["passed"] else "FAIL"
        detail = f" — {r['reason']}" if r.get("reason") else ""
        print(f"  [{mark}] {r['id']}{detail}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
