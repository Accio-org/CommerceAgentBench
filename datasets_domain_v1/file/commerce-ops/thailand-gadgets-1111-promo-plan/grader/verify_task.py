"""v2 verifier for file-commerce-ops-thailand-gadgets-1111-promo-plan.

Capacity schema 2.0: the per-atom validation logic is UNCHANGED; only the
emit layer is folded into distinct capability units (docs/check-granularity.md).

Internally we still compute every original atomic predicate (file/parse/shape,
each spot-checked pricing row, each allocation/budget/flash sub-condition) so the
``reason`` field keeps full diagnostic detail. We then AND the atoms into 7
capability checks. Binary pass is invariant:
``all(new) <=> all(old 27 atoms)`` by construction (the new checks partition the
old atoms; each new check = AND of its members).

score = passed / total.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any


def load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def to_float(v: Any) -> float | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    cleaned = s.replace("$", "").replace("¥", "").replace(",", "").strip()
    for suffix in ("USD", "CNY", "%"):
        if cleaned.upper().endswith(suffix):
            cleaned = cleaned[: -len(suffix)].strip()
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return None


def to_int(v: Any) -> int | None:
    f = to_float(v)
    if f is None:
        return None
    return int(round(f))


def to_bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in {"true", "1", "yes"}:
        return True
    if s in {"false", "0", "no"}:
        return False
    return None


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
    expected = load_json(task_dir / "private" / "expected_answer.json", {}) or {}
    rubric = load_json(task_dir / "rubric.json", {}) or {}
    checks_spec = rubric.get("checks", [])

    pricing_path = output_dir / "pricing_matrix.csv"
    allocation_path = output_dir / "inventory_allocation.csv"
    plan_path = output_dir / "promotion_plan.json"
    report_path = output_dir / "campaign_report.md"

    # Parse pricing CSV
    pricing_rows: list[dict[str, str]] = []
    pricing_parseable = False
    if pricing_path.exists():
        try:
            with pricing_path.open(encoding="utf-8-sig") as f:
                pricing_rows = list(csv.DictReader(f))
            pricing_parseable = True
        except Exception:
            pricing_parseable = False

    # Parse allocation CSV
    alloc_rows: list[dict[str, str]] = []
    alloc_parseable = False
    if allocation_path.exists():
        try:
            with allocation_path.open(encoding="utf-8-sig") as f:
                alloc_rows = list(csv.DictReader(f))
            alloc_parseable = True
        except Exception:
            alloc_parseable = False

    # Parse promotion plan JSON
    plan_raw = load_json(plan_path) if plan_path.exists() else None
    plan = plan_raw if isinstance(plan_raw, dict) else {}

    expected_pricing = expected.get("pricing_rows", [])
    price_tol = float(expected.get("pricing_tolerance_thb", 1.0))

    SKUS = ["A01", "A02", "A03", "A04", "A05", "A06"]
    PLATFORMS = ["shopee_th", "lazada_th", "tiktok_th"]

    # SKUs whose pricing rows are individually spot-checked (Part 2 capability).
    PRICING_SPOT_ROWS = [
        ("A01", "shopee_th"), ("A02", "tiktok_th"), ("A03", "shopee_th"),
        ("A04", "tiktok_th"), ("A05", "shopee_th"), ("A05", "tiktok_th"),
        ("A06", "shopee_th"), ("A06", "tiktok_th"),
    ]

    def find_pricing_row(sku: str, platform: str) -> dict[str, str] | None:
        for r in pricing_rows:
            if (str(r.get("sku_id", "")).strip() == sku
                    and str(r.get("platform", "")).strip().lower() == platform):
                return r
        return None

    def find_alloc_row(sku: str, platform: str) -> dict[str, str] | None:
        for r in alloc_rows:
            if (str(r.get("sku_id", "")).strip() == sku
                    and str(r.get("platform", "")).strip().lower() == platform):
                return r
        return None

    def find_expected_pricing(sku: str, platform: str) -> dict | None:
        return next((e for e in expected_pricing
                     if e["sku_id"] == sku and e["platform"] == platform), None)

    def check_pricing_row(sku: str, platform: str) -> tuple[bool, str]:
        row = find_pricing_row(sku, platform)
        if not row:
            return False, f"missing row for {sku}/{platform}"
        exp = find_expected_pricing(sku, platform)
        if not exp:
            return False, f"no expected for {sku}/{platform}"
        issues = []

        # source warehouse
        got_src = str(row.get("source_warehouse", "")).strip().lower()
        if got_src != exp["source_warehouse"]:
            issues.append(f"source={got_src!r} expected={exp['source_warehouse']}")

        # landed cost
        got_lc = to_float(row.get("landed_cost_thb"))
        if got_lc is None or not math.isclose(got_lc, exp["landed_cost_thb"], abs_tol=price_tol):
            issues.append(f"landed={got_lc!r} expected≈{exp['landed_cost_thb']}")

        # final regular price
        got_fr = to_float(row.get("final_regular_price_thb"))
        if got_fr is None or not math.isclose(got_fr, exp["final_regular_price_thb"], abs_tol=price_tol):
            issues.append(f"final_regular={got_fr!r} expected≈{exp['final_regular_price_thb']}")

        # best promo tier
        got_tier = str(row.get("best_promo_tier", "")).strip().lower()
        exp_tier = exp["best_promo_tier"].lower()
        if got_tier != exp_tier:
            issues.append(f"best_tier={got_tier!r} expected={exp_tier}")

        # best promo price
        got_bp = to_float(row.get("best_promo_price_thb"))
        if got_bp is None or not math.isclose(got_bp, exp["best_promo_price_thb"], abs_tol=price_tol):
            issues.append(f"best_price={got_bp!r} expected≈{exp['best_promo_price_thb']}")

        # flash eligible
        got_fe = to_bool(row.get("flash_eligible"))
        if got_fe is None or got_fe != exp["flash_eligible"]:
            issues.append(f"flash_eligible={row.get('flash_eligible')!r} expected={exp['flash_eligible']}")

        # flash floor ok
        got_ff = to_bool(row.get("flash_floor_ok"))
        if got_ff is not None and got_ff != exp["flash_floor_ok"]:
            issues.append(f"flash_floor_ok={row.get('flash_floor_ok')!r} expected={exp['flash_floor_ok']}")

        return len(issues) == 0, "; ".join(issues) if issues else "ok"

    def check_alloc_split(sku: str, platform: str, exp_req: int,
                          exp_th: int, exp_cn: int, exp_total: int) -> tuple[bool, str]:
        row = find_alloc_row(sku, platform)
        if not row:
            return False, f"{sku}/{platform}: missing row"
        issues = []
        req = to_int(row.get("required_units"))
        if req != exp_req:
            issues.append(f"required={req} expected={exp_req}")
        th = to_int(row.get("th_warehouse_alloc"))
        if th != exp_th:
            issues.append(f"th_alloc={th} expected={exp_th}")
        cn = to_int(row.get("cn_warehouse_alloc"))
        if cn != exp_cn:
            issues.append(f"cn_alloc={cn} expected={exp_cn}")
        total = to_int(row.get("total_alloc"))
        if total != exp_total:
            issues.append(f"total={total} expected={exp_total}")
        return len(issues) == 0, f"{sku}/{platform}: " + ("; ".join(issues) if issues else "ok")

    def check_alloc_skipped(sku: str, platform: str) -> tuple[bool, str]:
        row = find_alloc_row(sku, platform)
        if not row:
            return False, f"{sku}/{platform}: missing row"
        skipped = to_bool(row.get("skipped"))
        return skipped is True, f"{sku}/{platform}: skipped={row.get('skipped')!r}"

    # ----- Atomic predicates (logic unchanged) -----
    atoms: dict[str, tuple[bool, str]] = {}

    # --- setup / format / shape (plumbing) ---
    if not pricing_path.exists():
        atoms["pricing_csv"] = (False, "missing pricing csv")
    else:
        atoms["pricing_csv"] = (pricing_parseable and len(pricing_rows) == 18,
                                f"pricing parsed={pricing_parseable} rows={len(pricing_rows)}")

    if not allocation_path.exists():
        atoms["alloc_csv"] = (False, "missing allocation csv")
    else:
        atoms["alloc_csv"] = (alloc_parseable and len(alloc_rows) == 18,
                              f"alloc parsed={alloc_parseable} rows={len(alloc_rows)}")

    if not plan_path.exists():
        atoms["plan_json"] = (False, "missing plan json")
    else:
        atoms["plan_json"] = (isinstance(plan_raw, dict),
                              "plan parsed" if isinstance(plan_raw, dict) else "plan not JSON object")

    if not report_path.exists():
        atoms["report_md"] = (False, "missing report md")
    else:
        try:
            content = report_path.read_text(encoding="utf-8-sig", errors="ignore")
            atoms["report_md"] = (len(content.strip()) > 0, f"report len={len(content.strip())}")
        except OSError as e:
            atoms["report_md"] = (False, f"cannot read report: {e}")

    if not pricing_parseable:
        atoms["pricing_combos"] = (False, "pricing parse prerequisite failed")
    else:
        combos = set()
        for r in pricing_rows:
            combos.add((str(r.get("sku_id", "")).strip(),
                        str(r.get("platform", "")).strip().lower()))
        expected_combos = {(s, p) for s in SKUS for p in PLATFORMS}
        atoms["pricing_combos"] = (
            combos == expected_combos,
            f"combos missing={sorted(expected_combos - combos)} extra={sorted(combos - expected_combos)}")

    if not pricing_parseable or not pricing_rows:
        atoms["pricing_cols"] = (False, "pricing parse prerequisite failed")
    else:
        required = {"sku_id", "platform", "source_warehouse", "landed_cost_thb",
                    "platform_fee_rate", "regular_price_thb", "final_regular_price_thb",
                    "flash_sale_price_thb", "voucher_price_thb", "normal_promo_price_thb",
                    "flash_eligible", "best_promo_tier", "best_promo_price_thb"}
        missing = required - set(pricing_rows[0].keys())
        atoms["pricing_cols"] = (len(missing) == 0, f"pricing missing cols={sorted(missing)}")

    if not alloc_parseable or not alloc_rows:
        atoms["alloc_cols"] = (False, "alloc parse prerequisite failed")
    else:
        required = {"sku_id", "platform", "required_units",
                    "th_warehouse_alloc", "cn_warehouse_alloc", "total_alloc",
                    "allocation_cost_thb", "skipped"}
        missing = required - set(alloc_rows[0].keys())
        atoms["alloc_cols"] = (len(missing) == 0, f"alloc missing cols={sorted(missing)}")

    # --- Part 1: warehouse selection across all 18 rows ---
    if not pricing_parseable:
        atoms["source_warehouse"] = (False, "pricing parse prerequisite failed")
    else:
        src_issues = []
        for sku in SKUS:
            expected_src = "cn_warehouse" if sku in ("A01", "A04") else "th_warehouse"
            for plat in PLATFORMS:
                row = find_pricing_row(sku, plat)
                if not row:
                    src_issues.append(f"{sku}/{plat}: missing")
                    continue
                got = str(row.get("source_warehouse", "")).strip().lower()
                if got != expected_src:
                    src_issues.append(f"{sku}/{plat}: got={got} expected={expected_src}")
        atoms["source_warehouse"] = (len(src_issues) == 0,
                                     "; ".join(src_issues[:5]) if src_issues else "ok")

    # --- Part 2: per-row pricing spot checks ---
    pricing_row_failures = []
    for sku, plat in PRICING_SPOT_ROWS:
        ok, reason = check_pricing_row(sku, plat)
        atoms[f"pricing_row::{sku}/{plat}"] = (ok, reason)
        if not ok:
            pricing_row_failures.append(f"{sku}/{plat}({reason})")

    # --- Part 3: allocation warehouse-overflow splits ---
    atoms["alloc_A05_split"] = check_alloc_split("A05", "tiktok_th", 1092, 521, 571, 1092)
    atoms["alloc_A02_split"] = check_alloc_split("A02", "tiktok_th", 728, 276, 452, 728)

    # --- Part 4: budget-driven removal ---
    atoms["alloc_A01_skipped"] = check_alloc_skipped("A01", "tiktok_th")
    atoms["alloc_A04_skipped"] = check_alloc_skipped("A04", "tiktok_th")

    if not alloc_parseable:
        atoms["total_cost"] = (False, "alloc parse prerequisite failed")
    else:
        total_cost = 0.0
        for r in alloc_rows:
            if to_bool(r.get("skipped")) is True:
                continue
            c = to_float(r.get("allocation_cost_thb"))
            if c is not None:
                total_cost += c
        expected_total = expected["total_allocation_cost_thb"]
        close_enough = math.isclose(total_cost, expected_total, abs_tol=50.0)
        within_budget = total_cost <= 800000.0
        atoms["total_cost"] = (
            close_enough and within_budget,
            f"total={total_cost:.2f} expected≈{expected_total} within_budget={within_budget}")

    bs = plan.get("budget_summary", {})
    if not isinstance(bs, dict):
        atoms["budget_summary"] = (False, "budget_summary not a dict")
    else:
        bs_issues = []
        if to_bool(bs.get("within_budget")) is not True:
            bs_issues.append(f"within_budget={bs.get('within_budget')!r}")
        if to_int(bs.get("active_combo_count")) != 16:
            bs_issues.append(f"active_combo_count={bs.get('active_combo_count')!r} expected=16")
        removed = bs.get("removed_combos", [])
        if not isinstance(removed, list):
            bs_issues.append("removed_combos not a list")
        else:
            removed_lower = [str(x).strip().lower() for x in removed]
            if "a01/tiktok_th" not in removed_lower and "a01/tiktok" not in removed_lower:
                bs_issues.append("missing A01/tiktok_th in removed")
            if "a04/tiktok_th" not in removed_lower and "a04/tiktok" not in removed_lower:
                bs_issues.append("missing A04/tiktok_th in removed")
        atoms["budget_summary"] = (len(bs_issues) == 0, "; ".join(bs_issues) if bs_issues else "ok")

    # --- Part 5: flash slot assignment per platform ---
    fa = plan.get("flash_sale_assignments", {})
    shopee = fa.get("shopee_th", []) if isinstance(fa, dict) else []
    if not isinstance(shopee, list):
        atoms["flash_shopee"] = (False, "shopee not a list")
    else:
        atoms["flash_shopee"] = (len(shopee) == 4 and set(shopee) == {"A05", "A02", "A01", "A06"},
                                 f"shopee={shopee}")
    lazada = fa.get("lazada_th", []) if isinstance(fa, dict) else []
    if not isinstance(lazada, list):
        atoms["flash_lazada"] = (False, "lazada not a list")
    else:
        atoms["flash_lazada"] = (len(lazada) == 2 and set(lazada) == {"A05", "A02"},
                                 f"lazada={lazada}")
    tiktok = fa.get("tiktok_th", []) if isinstance(fa, dict) else []
    if not isinstance(tiktok, list):
        atoms["flash_tiktok"] = (False, "tiktok not a list")
    else:
        atoms["flash_tiktok"] = (len(tiktok) == 0, f"tiktok={tiktok}")

    # --- promotion plan summary fields ---
    ts = plan.get("tier_summary", {})
    if not isinstance(ts, dict):
        atoms["tier_summary"] = (False, "tier_summary not a dict")
    else:
        ts_issues = []
        if to_int(ts.get("flash_sale_count")) != 8:
            ts_issues.append(f"flash_sale_count={ts.get('flash_sale_count')!r} expected=8")
        if to_int(ts.get("platform_voucher_count")) != 10:
            ts_issues.append(f"platform_voucher_count={ts.get('platform_voucher_count')!r} expected=10")
        none_count = to_int(ts.get("none_count"))
        if none_count is not None and none_count != 0:
            ts_issues.append(f"none_count={ts.get('none_count')!r} expected=0")
        atoms["tier_summary"] = (len(ts_issues) == 0, "; ".join(ts_issues) if ts_issues else "ok")

    warnings = plan.get("warnings", [])
    if not isinstance(warnings, list):
        atoms["warnings"] = (False, "warnings not a list")
    else:
        non_empty = [w for w in warnings if isinstance(w, str) and w.strip()]
        atoms["warnings"] = (len(non_empty) >= 2, f"warnings non_empty={len(non_empty)}")

    # ----- Fold atoms into capability checks (AND), emit per rubric ids -----
    def fold(members: list[str]) -> tuple[bool, str]:
        ok = all(atoms[m][0] for m in members)
        if ok:
            return True, "ok"
        fails = [f"{m}: {atoms[m][1]}" for m in members if not atoms[m][0]]
        return False, " | ".join(fails)

    GROUPS: dict[str, list[str]] = {
        "setup_gate": [
            "pricing_csv", "alloc_csv", "plan_json", "report_md",
            "pricing_combos", "pricing_cols", "alloc_cols",
        ],
        "source_warehouse_selection_correct": ["source_warehouse"],
        "pricing_matrix_correct": [
            f"pricing_row::{s}/{p}" for s, p in PRICING_SPOT_ROWS
        ],
        "inventory_allocation_correct": ["alloc_A05_split", "alloc_A02_split"],
        "budget_removal_correct": [
            "alloc_A01_skipped", "alloc_A04_skipped", "total_cost", "budget_summary",
        ],
        "flash_slot_assignment_correct": ["flash_shopee", "flash_lazada", "flash_tiktok"],
        "promotion_plan_summary_correct": ["tier_summary", "warnings"],
    }

    folded: dict[str, tuple[bool, str]] = {gid: fold(members) for gid, members in GROUPS.items()}

    results = []
    passed = 0
    for c in checks_spec:
        cid = c["id"]
        if cid in folded:
            ok, reason = folded[cid]
        else:
            ok, reason = False, f"unknown check id {cid!r}"
        results.append({"id": cid, "passed": ok, "reason": reason,
                        "check_type": c.get("check_type", "")})
        if ok:
            passed += 1

    total = len(checks_spec)
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
