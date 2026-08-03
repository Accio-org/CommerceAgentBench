"""v2 verifier for file-logistics-cargo-insurance-multiparty-allocation.

Capacity-folded (2026-06-09): the verifier still validates every original
atomic dimension (gross / paid / reduction / status / 3 reason-keyword tiers
per customer + structural + aggregate), but emits **capability units** instead
of 45 atomic checks:

  - setup_gate (R2): the 4 structural/format checks folded into one plumbing
    gate (file exists + parseable object + exactly-5 settlements + summary keys
    complete).
  - customer_settled::<ID> (R3a): one per customer, = AND of that customer's 7
    atomic dimensions. Per-customer settlement completeness IS the hard
    competency (reading each policy's exclusion / sub-limit / coverage gap and
    applying the right clause) — getting 3/5 vs 5/5 customers right is a real
    capability difference, so this graded axis stays per-customer.
  - summary_consistent (R1): the 6 aggregate roll-up checks (totals + counts +
    container cap guard) folded into one "summary roll-up + count classification
    + cap guard" capability.

The internal per-atomic validation is unchanged byte-for-byte; only emission is
folded. Failing atomic dimensions are listed in the group's `reason` so the
fine-grained diagnosis is preserved. Reason-keyword checks use any-of semantics
over a tiered list per customer. Numeric tolerances per
private/expected_answer.json.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


# ---------- helpers ----------

def find_customer(settlements: list[Any], customer_id: str) -> dict[str, Any] | None:
    for s in settlements:
        if isinstance(s, dict) and str(s.get("customer_id", "")).strip().upper() == customer_id.upper():
            return s
    return None


def num_close(actual: Any, expected: float, tol: float) -> bool:
    if actual is None:
        return False
    try:
        a = float(actual)
    except (TypeError, ValueError):
        return False
    return math.isclose(a, expected, abs_tol=tol)


def any_keyword_in(text: str, keywords: list[Any]) -> bool:
    t = str(text or "").lower()
    if not t:
        return False
    return any(str(k).lower() in t for k in keywords if isinstance(k, (str, int, float)))


# ---------- fold spec ----------
# Each capability group -> ordered list of atomic check ids it ANDs over.
# Atomic predicates are computed by atomic_result() exactly as the pre-fold
# verifier did; this layer only aggregates them (pure AND) and surfaces the
# failing atomics in the reason string.

CUSTOMER_IDS = ("LINNEA", "JONAS", "MAHMOUD", "OCEANTECH", "VERDE")
CUSTOMER_KINDS = (
    "gross_claim_correct",
    "paid_correct",
    "reduction_correct",
    "status_correct",
    "reason_primary_keyword",
    "reason_secondary_keyword",
    "reason_tertiary_keyword",
)

SETUP_ATOMS = (
    "settlement_json_exists",
    "settlement_json_parseable_object",
    "settlements_array_length_exactly_5",
    "summary_keys_complete",
)
SUMMARY_ATOMS = (
    "summary_total_gross_claim_correct",
    "summary_total_paid_correct",
    "summary_total_reduction_correct",
    "summary_count_paid_correct",
    "summary_count_denied_correct",
    "summary_container_cap_check_correct",
)


# ---------- main ----------

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

    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    rubric = json.loads((task_dir / "rubric.json").read_text(encoding="utf-8-sig"))
    checks_spec = rubric.get("checks", [])

    customers_truth: dict[str, dict[str, Any]] = expected.get("customers", {})
    summary_truth: dict[str, Any] = expected.get("summary", {})
    tol = expected.get("tolerance", {})
    per_customer_tol = float(tol.get("per_customer_usd", 0.5))
    summary_tol = float(tol.get("summary_usd", 5.0))

    out_path = output_dir / "insurance_settlement.json"
    file_exists = out_path.exists()
    file_nonempty = file_exists and out_path.stat().st_size > 0

    parse_ok = False
    parse_error = ""
    payload: dict[str, Any] = {}
    if file_nonempty:
        try:
            raw = json.loads(out_path.read_text(encoding="utf-8-sig"))
            if isinstance(raw, dict):
                payload = raw
                parse_ok = True
            else:
                parse_error = f"top-level not object (got {type(raw).__name__})"
        except json.JSONDecodeError as exc:
            parse_error = str(exc)

    _settlements_raw = payload.get("settlements")
    settlements: list[Any] = _settlements_raw if isinstance(_settlements_raw, list) else []
    _summary_raw = payload.get("summary")
    summary: dict[str, Any] = _summary_raw if isinstance(_summary_raw, dict) else {}

    structural_top_ok = parse_ok and isinstance(_settlements_raw, list) and isinstance(_summary_raw, dict)
    settlements_len_ok = len(settlements) == 5

    required_summary_keys = (
        "total_gross_claim_usd",
        "total_paid_usd",
        "total_reduction_usd",
        "count_paid",
        "count_denied",
        "count_no_claim",
        "container_cap_check",
    )
    summary_keys_ok = all(k in summary for k in required_summary_keys)

    def atomic_result(cid: str) -> tuple[bool, str]:
        if cid == "settlement_json_exists":
            if not file_exists:
                return False, "file missing"
            if not file_nonempty:
                return False, "file empty"
            return True, "ok"
        if cid == "settlement_json_parseable_object":
            if not parse_ok:
                return False, f"parse error: {parse_error or 'unknown'}"
            return structural_top_ok, "ok" if structural_top_ok else f"missing top keys; got={list(payload.keys())}"
        if cid == "settlements_array_length_exactly_5":
            return settlements_len_ok, f"len={len(settlements)}"
        if cid == "summary_keys_complete":
            missing = [k for k in required_summary_keys if k not in summary]
            return summary_keys_ok, f"missing={missing}" if missing else "ok"

        m = re.match(r"^customer_([A-Z]+)_(.+)$", cid)
        if m:
            cust_id = m.group(1)
            kind = m.group(2)
            truth = customers_truth.get(cust_id)
            if truth is None:
                return False, f"no ground truth for customer {cust_id}"
            entry = find_customer(settlements, cust_id)
            if entry is None:
                return False, f"no settlement entry for {cust_id}"

            if kind == "gross_claim_correct":
                want = float(truth["gross_claim_usd"])
                return num_close(entry.get("gross_claim_usd"), want, per_customer_tol), f"got={entry.get('gross_claim_usd')!r} want={want} tol={per_customer_tol}"
            if kind == "paid_correct":
                want = float(truth["paid_usd"])
                return num_close(entry.get("paid_usd"), want, per_customer_tol), f"got={entry.get('paid_usd')!r} want={want} tol={per_customer_tol}"
            if kind == "reduction_correct":
                want = float(truth["reduction_from_claim_usd"])
                return num_close(entry.get("reduction_from_claim_usd"), want, per_customer_tol), f"got={entry.get('reduction_from_claim_usd')!r} want={want} tol={per_customer_tol}"
            if kind == "status_correct":
                got = str(entry.get("status", "")).strip().lower()
                acceptable = [str(s).strip().lower() for s in truth.get("status_acceptable", [])]
                return got in acceptable, f"got={got!r} acceptable={acceptable}"

            reason = str(entry.get("reason_short", ""))
            if kind == "reason_primary_keyword":
                kws = truth.get("reason_primary_keywords_any_of", [])
                return any_keyword_in(reason, kws), f"reason did not contain any of primary keywords (first 5={kws[:5]}...)"
            if kind == "reason_secondary_keyword":
                kws = truth.get("reason_secondary_keywords_any_of", [])
                return any_keyword_in(reason, kws), f"reason did not contain any of secondary keywords (first 5={kws[:5]}...)"
            if kind == "reason_tertiary_keyword":
                kws = truth.get("reason_tertiary_keywords_any_of", [])
                return any_keyword_in(reason, kws), f"reason did not contain any of tertiary keywords (first 5={kws[:5]}...)"

            return False, f"unknown per-customer kind {kind!r}"

        if cid == "summary_total_gross_claim_correct":
            return num_close(summary.get("total_gross_claim_usd"), float(summary_truth["total_gross_claim_usd"]), summary_tol), f"got={summary.get('total_gross_claim_usd')!r}"
        if cid == "summary_total_paid_correct":
            return num_close(summary.get("total_paid_usd"), float(summary_truth["total_paid_usd"]), summary_tol), f"got={summary.get('total_paid_usd')!r}"
        if cid == "summary_total_reduction_correct":
            return num_close(summary.get("total_reduction_usd"), float(summary_truth["total_reduction_usd"]), summary_tol), f"got={summary.get('total_reduction_usd')!r}"
        if cid == "summary_count_paid_correct":
            got = summary.get("count_paid")
            want = int(summary_truth["count_paid"])
            return got == want, f"got={got!r} want={want}"
        if cid == "summary_count_denied_correct":
            got = summary.get("count_denied")
            acceptable = [int(x) for x in summary_truth.get("count_denied_acceptable_set", [])]
            return got in acceptable, f"got={got!r} acceptable={acceptable}"
        if cid == "summary_container_cap_check_correct":
            want = summary_truth.get("container_cap_check", True)
            got = bool(summary.get("container_cap_check"))
            return got == want, f"got={got!r} want={want!r}"

        return False, f"unknown check id {cid!r}"

    def fold(atom_ids: tuple[str, ...]) -> tuple[bool, str]:
        """AND over the atomic predicates; reason lists the failing atomics."""
        failed: list[str] = []
        for aid in atom_ids:
            ok, reason = atomic_result(aid)
            if not ok:
                failed.append(f"{aid}[{reason}]")
        if not failed:
            return True, f"{len(atom_ids)}/{len(atom_ids)} ok"
        return False, "FAILED: " + "; ".join(failed)

    def run_check(cid: str) -> tuple[bool, str]:
        if cid == "setup_gate":
            return fold(SETUP_ATOMS)
        if cid == "summary_consistent":
            return fold(SUMMARY_ATOMS)
        m = re.match(r"^customer_settled::([A-Z]+)$", cid)
        if m:
            cust_id = m.group(1)
            if cust_id not in CUSTOMER_IDS:
                return False, f"unknown customer {cust_id!r}"
            atoms = tuple(f"customer_{cust_id}_{kind}" for kind in CUSTOMER_KINDS)
            return fold(atoms)
        return False, f"unknown check id {cid!r}"

    results = []
    passed_count = 0
    for c in checks_spec:
        cid = c["id"]
        ok, reason = run_check(cid)
        results.append({"id": cid, "passed": ok, "reason": reason, "check_type": c.get("check_type", "deterministic_exact")})
        if ok:
            passed_count += 1

    total = len(checks_spec)
    score = passed_count / total if total > 0 else 0.0

    reward = {
        "schema_version": "2.0",
        "task_id": rubric.get("task_id"),
        "score": round(score, 4),
        "checks_passed": passed_count,
        "checks_total": total,
        "checks_breakdown": results,
        "reward": round(score, 4),
        "passed": passed_count == total,
        "source": "v2_checks_runner",
    }
    reward_path.write_text(json.dumps(reward, ensure_ascii=False, indent=2))
    print(json.dumps({k: reward[k] for k in ("score", "checks_passed", "checks_total")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
