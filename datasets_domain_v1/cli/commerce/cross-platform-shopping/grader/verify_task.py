"""Standalone verifier for cli-commerce-cross-platform-shopping.

Capacity-check granularity (docs/check-granularity.md, 2026-06 migration):
the legality + arithmetic + optimum atoms are folded into 8 capability
units. Internally every atom is still validated exactly as before (same
predicates, byte-identical); the fold layer only AND-aggregates atoms
into one capability check and lists failing members in `reason`. Binary
pass (score == 1.0) is unchanged.
"""
from __future__ import annotations

import argparse
import json
import sys
from itertools import product
from pathlib import Path
from typing import Any


PLATFORM_IDS = ("JD", "TM", "PDD")

# Folded capability units (denominator = distinct capabilities, not atoms).
GROUP_IDS = [
    "setup_gate",
    "assignment_completeness",
    "assignments_legal",
    "prices_accurate",
    "platform_summary_consistent",
    "shipping_and_coupon_rules",
    "totals_correct",
    "globally_optimal",
]


def load_expected(task_dir: Path) -> dict[str, Any]:
    with open(task_dir / "private" / "expected_answer.json", encoding="utf-8-sig") as f:
        return json.load(f)


def platform_config(expected: dict[str, Any], platform_id: str) -> dict[str, Any]:
    return expected["platforms"][platform_id]


def catalog_price(expected: dict[str, Any], platform_id: str, item_id: str) -> int | None:
    return expected["prices"].get(platform_id, {}).get(item_id)


def legal_platforms_for_item(expected: dict[str, Any], item_id: str) -> list[str]:
    item = expected["items"][item_id]
    legal = []
    for platform_id in PLATFORM_IDS:
        price = catalog_price(expected, platform_id, item_id)
        if price is None:
            continue
        if item.get("urgent") and platform_config(expected, platform_id)["delivery_days"] > 2:
            continue
        legal.append(platform_id)
    return legal


def calculate_summary(expected: dict[str, Any], assignments_by_item: dict[str, str]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for platform_id in PLATFORM_IDS:
        items = [item_id for item_id, pid in assignments_by_item.items() if pid == platform_id]
        subtotal = sum(catalog_price(expected, platform_id, item_id) or 0 for item_id in items)
        cfg = platform_config(expected, platform_id)
        shipping = 0 if not items or subtotal >= cfg["free_shipping_threshold"] else cfg["shipping_fee"]
        coupon = cfg["coupon"]
        coupon_discount = coupon["discount"] if subtotal >= coupon["threshold"] else 0
        summary[platform_id] = {
            "items": items,
            "subtotal": subtotal,
            "shipping": shipping,
            "coupon_applied": coupon_discount > 0,
            "coupon_discount": coupon_discount,
            "platform_total": subtotal + shipping - coupon_discount,
        }
    return summary


def calculate_total(summary: dict[str, Any]) -> int:
    return sum(int(summary[platform_id]["platform_total"]) for platform_id in PLATFORM_IDS)


def calculate_savings(summary: dict[str, Any]) -> int:
    return sum(int(summary[platform_id]["coupon_discount"]) for platform_id in PLATFORM_IDS)


def compute_optimal_total(expected: dict[str, Any]) -> int:
    item_ids = list(expected["items"].keys())
    choices = [legal_platforms_for_item(expected, item_id) for item_id in item_ids]
    best: int | None = None
    for assignment in product(*choices):
        summary = calculate_summary(expected, dict(zip(item_ids, assignment)))
        total = calculate_total(summary)
        if best is None or total < best:
            best = total
    if best is None:
        raise ValueError("no legal shopping plan exists")
    return best


def normalize_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


class Atoms:
    """Collects fine-grained validation results, then folds into capability groups."""

    def __init__(self) -> None:
        self._passed: dict[str, bool] = {}
        self._detail: dict[str, str] = {}

    def add(self, aid: str, passed: bool, detail: str = "") -> None:
        self._passed[aid] = bool(passed)
        self._detail[aid] = detail

    def fold(self, results: list[dict[str, Any]], gid: str, atom_ids: list[str], headline: str = "") -> None:
        """Emit one capability check = AND(atoms). reason lists failing members."""
        present = [a for a in atom_ids if a in self._passed]
        # Treat an unexercised atom (skipped because upstream failed) as a failure
        # so the group surfaces the capability as not-demonstrated (R2: no short-circuit).
        missing = [a for a in atom_ids if a not in self._passed]
        ok = bool(present) and all(self._passed[a] for a in present) and not missing
        fails = [a for a in present if not self._passed[a]] + [f"{m}(skipped)" for m in missing]
        if ok:
            reason = headline or "ok"
        else:
            parts = []
            for a in fails:
                base = a.replace("(skipped)", "")
                d = self._detail.get(base, "")
                parts.append(f"{a}: {d}" if d else a)
            reason = "; ".join(parts)
        results.append({
            "id": gid,
            "passed": ok,
            "reason": reason,
            "check_type": "deterministic_exact",
        })


def verify(output_dir: Path, expected: dict[str, Any], results: list[dict[str, Any]]) -> None:
    atoms = Atoms()
    plan_path = output_dir / "shopping_plan.json"

    # ---- setup_gate: file present + valid JSON + well-formed structure ----
    data: Any = None
    plan: Any = None
    if not plan_path.exists():
        atoms.add("plan_exists", False, "file not found")
    else:
        try:
            with open(plan_path, encoding="utf-8-sig") as f:
                data = json.load(f)
            plan = data.get("shopping_plan")
            if not isinstance(plan, dict):
                atoms.add("plan_exists", False, "missing object: shopping_plan")
                plan = None
            else:
                a = plan.get("assignments")
                ps = plan.get("platform_summary")
                if not isinstance(a, list) or not isinstance(ps, dict):
                    atoms.add("plan_exists", False, "assignments must be a list and platform_summary must be an object")
                    plan = None
                else:
                    atoms.add("plan_exists", True)
        except json.JSONDecodeError as e:
            atoms.add("plan_exists", False, f"invalid JSON: {e}")
            plan = None

    if plan is None:
        # Nothing else can be exercised; fold every group (unexercised → fail).
        _fold_all(results, atoms)
        return

    assignments = plan.get("assignments")
    platform_summary = plan.get("platform_summary")
    expected_item_ids = list(expected["items"].keys())

    # ---- assignment_completeness: item_count + item_ids_complete ----
    atoms.add(
        "item_count",
        len(assignments) == expected["item_count"],
        f"got {len(assignments)}, expected {expected['item_count']}",
    )

    assign_entries: dict[str, dict[str, Any]] = {}
    duplicate_ids: list[str] = []
    unknown_ids: list[str] = []
    for entry in assignments:
        if not isinstance(entry, dict):
            continue
        item_id = entry.get("item_id")
        if not isinstance(item_id, str):
            continue
        if item_id in assign_entries:
            duplicate_ids.append(item_id)
        if item_id not in expected["items"]:
            unknown_ids.append(item_id)
        assign_entries[item_id] = entry

    missing_ids = [item_id for item_id in expected_item_ids if item_id not in assign_entries]
    ids_ok = not duplicate_ids and not unknown_ids and not missing_ids
    id_detail = []
    if missing_ids:
        id_detail.append(f"missing={missing_ids}")
    if duplicate_ids:
        id_detail.append(f"duplicates={duplicate_ids}")
    if unknown_ids:
        id_detail.append(f"unknown={unknown_ids}")
    atoms.add("item_ids_complete", ids_ok, "; ".join(id_detail))

    # ---- assignments_legal + prices_accurate ----
    assignments_by_item: dict[str, str] = {}
    invalid_platforms = []
    availability_violations = []
    urgent_violations = []
    price_violations = []

    for item_id in expected_item_ids:
        entry = assign_entries.get(item_id, {})
        platform_id = entry.get("platform")
        if platform_id not in PLATFORM_IDS:
            invalid_platforms.append(f"{item_id}:{platform_id}")
            continue

        assignments_by_item[item_id] = platform_id
        price = catalog_price(expected, platform_id, item_id)
        if price is None:
            availability_violations.append(f"{item_id} on {platform_id}")
            continue

        if expected["items"][item_id].get("urgent") and platform_config(expected, platform_id)["delivery_days"] > 2:
            urgent_violations.append(f"{item_id} on {platform_id}")

        got_price = normalize_int(entry.get("price"))
        if got_price != price:
            price_violations.append(f"{item_id} on {platform_id}: got {entry.get('price')}, expected {price}")

    atoms.add("platforms_valid", not invalid_platforms, ", ".join(invalid_platforms))
    atoms.add("urgent_delivery_respected", not urgent_violations, ", ".join(urgent_violations))
    atoms.add("availability_respected", not availability_violations, ", ".join(availability_violations))
    atoms.add("prices_match_catalog", not price_violations, "; ".join(price_violations))

    # Downstream arithmetic atoms can only be meaningfully computed when the
    # assignment is complete and legal. If not, leave them unexercised so their
    # groups fold to fail (R2: no short-circuit, surface unexercised capability).
    if not ids_ok or invalid_platforms or availability_violations:
        _fold_all(results, atoms)
        return

    calculated_summary = calculate_summary(expected, assignments_by_item)

    # ---- platform_summary_consistent: items lists + subtotals + platform_totals ----
    item_summary_errors = []
    for platform_id in PLATFORM_IDS:
        got_items = platform_summary.get(platform_id, {}).get("items", [])
        got_set = set(got_items) if isinstance(got_items, list) else set()
        exp_set = set(calculated_summary[platform_id]["items"])
        if got_set != exp_set:
            item_summary_errors.append(f"{platform_id}: got {sorted(got_set)}, expected {sorted(exp_set)}")
    atoms.add("platform_items_match_assignments", not item_summary_errors, "; ".join(item_summary_errors))

    # ---- per-platform arithmetic atoms (subtotal/shipping/coupon/platform_total) ----
    for platform_id, prefix in (("JD", "jd"), ("TM", "tm"), ("PDD", "pdd")):
        got_summary = platform_summary.get(platform_id, {})
        expected_summary = calculated_summary[platform_id]
        for field in ("subtotal", "shipping", "coupon_discount", "platform_total"):
            cid_field = "coupon" if field == "coupon_discount" else field
            cid = f"{prefix}_{cid_field}"
            got = normalize_int(got_summary.get(field))
            exp = expected_summary[field]
            atoms.add(cid, got == exp, f"got {got_summary.get(field)}, expected {exp}" if got != exp else "")

    # ---- totals_correct: total_cost + total_savings ----
    calculated_total = calculate_total(calculated_summary)
    got_total = normalize_int(plan.get("total_cost"))
    atoms.add(
        "total_cost_calculated",
        got_total == calculated_total,
        f"got {plan.get('total_cost')}, expected {calculated_total}" if got_total != calculated_total else "",
    )

    calculated_savings = calculate_savings(calculated_summary)
    got_savings = normalize_int(plan.get("total_savings"))
    atoms.add(
        "total_savings_calculated",
        got_savings == calculated_savings,
        f"got {plan.get('total_savings')}, expected {calculated_savings}" if got_savings != calculated_savings else "",
    )

    # ---- globally_optimal: the combinatorial optimum (core competency) ----
    optimal_total = expected.get("optimal_total_cost", expected.get("total_cost"))
    recomputed_optimal_total = compute_optimal_total(expected)
    if optimal_total != recomputed_optimal_total:
        atoms.add(
            "optimal_total_cost",
            False,
            f"expected file says {optimal_total}, recomputed optimum is {recomputed_optimal_total}",
        )
    else:
        atoms.add(
            "optimal_total_cost",
            got_total == optimal_total,
            f"got {plan.get('total_cost')}, optimal is {optimal_total}" if got_total != optimal_total else "",
        )

    _fold_all(results, atoms)


def _fold_all(results: list[dict[str, Any]], atoms: "Atoms") -> None:
    """Emit the 8 capability groups (AND of their atoms). Order matches GROUP_IDS."""
    atoms.fold(results, "setup_gate", ["plan_exists"],
               "output file present and well-formed")
    atoms.fold(results, "assignment_completeness", ["item_count", "item_ids_complete"],
               "exactly 12 distinct expected items assigned")
    atoms.fold(results, "assignments_legal",
               ["platforms_valid", "urgent_delivery_respected", "availability_respected"],
               "all assignments respect platform/urgent/availability constraints")
    atoms.fold(results, "prices_accurate", ["prices_match_catalog"],
               "every assignment price matches the hidden catalog")
    atoms.fold(results, "platform_summary_consistent",
               ["platform_items_match_assignments",
                "jd_subtotal", "tm_subtotal", "pdd_subtotal",
                "jd_platform_total", "tm_platform_total", "pdd_platform_total"],
               "per-platform item lists, subtotals and platform_totals consistent")
    atoms.fold(results, "shipping_and_coupon_rules",
               ["jd_shipping", "tm_shipping", "pdd_shipping",
                "jd_coupon", "tm_coupon", "pdd_coupon"],
               "free-shipping and coupon thresholds applied correctly")
    atoms.fold(results, "totals_correct",
               ["total_cost_calculated", "total_savings_calculated"],
               "total_cost and total_savings aggregated correctly")
    atoms.fold(results, "globally_optimal", ["optimal_total_cost"],
               "plan achieves the global minimum total cost")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    reward_path = Path(args.reward_json)

    expected = load_expected(task_dir)
    results: list[dict[str, Any]] = []

    verify(output_dir, expected, results)

    checks = []
    for r in results:
        checks.append({
            "id": r.get("id"),
            "passed": bool(r.get("passed")),
            "reason": str(r.get("detail") or r.get("reason") or ""),
            "check_type": r.get("check_type") or "deterministic_exact",
        })

    passed = sum(1 for r in checks if r["passed"])
    total = len(checks)
    score = round(passed / total, 4) if total > 0 else 0.0

    all_passed = total > 0 and passed == total
    reward = {
        "schema_version": "2.0",
        "task_id": task_dir.name,
        "score": score,
        "reward": score,
        "passed": all_passed,
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
        detail = f" - {r['reason']}" if r.get("reason") else ""
        print(f"  [{mark}] {r['id']}{detail}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
