#!/usr/bin/env python3
"""Verifier for stripe-supplier-payment-refund.

Capacity refactor (2026-06-09): the per-charge / per-meta atomic checks (up to
32 of them, with conditional-skip variability) are computed verbatim into
``atoms`` and then folded by AND into 7 distinct capability groups (setup gate,
the defect-rate trap competency, the per-charge refund-issuance batch, the
restraint negative, the batch-summary record, the net-liability payment intent,
and the per-supplier description rollup). The folding is pure emit/grouping:
every atomic boolean/threshold/field comparison below is byte-identical to the
pre-refactor verifier — only the final emit layer changed (``checks.append(
chk(...))`` -> ``add(...)`` into the atoms dict, then ``fold_atoms``). See
``docs/check-granularity.md`` (R2/R3/R5/R6/R4) and
``docs/capacity-migration-status.md``.

Stripe verifiers compute checks INLINE against a LIVE mock and the final mock
state is NOT archived, so RERUN is impossible; validation is REFOLD-ONLY
(``scratch/scripts/capacity_refactor/refold_stripe_supplier_refund.py``).
"""
import argparse
import json
import os
import urllib.request
from pathlib import Path


def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300], "check_type": "deterministic_exact"}


def norm(s):
    return " ".join(str(s or "").strip().split())


def fetch_state(url, token):
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


# --- Capability fold (emit/grouping layer only; atom computations unchanged) ---
# Ordered list of (group_id, capability description, predicate(atom_id)->bool).
# Predicates are evaluated in order; the FIRST matching group claims the atom,
# so the partition is complete and disjoint for every atom id emitted below.
# NOTE: the defect-rate trap predicate is placed BEFORE the refunds predicate so
# the trap atom (a distinct "reject the report's stated 25% rate" competency, R5)
# is not swept into the per-charge refund batch.
GROUP_SPECS = [
    ("setup_gate", "Environment ready: stripe mock reachable + state loaded (R2)",
     lambda i: i == "mock_reachable"),
    ("defect_rate_trap_handled", "Computed B-4412 credit from the actual defect count (115/500=23%), not the report's stated 25% (R5 boundary)",
     lambda i: i == "trap::b4412_not_25pct"),
    ("refunds_issued_correct", "Every required refund issued at the correct per-policy amount (R3 per-charge batch)",
     lambda i: i.startswith("refund_exists::") or i.startswith("refund_amount::")),
    ("no_false_refunds", "No refund issued on QA-passed / within-tolerance / out-of-scope charges (R6 restraint negative)",
     lambda i: i.startswith("no_refund::")),
    ("summary_record_correct", "Batch tracking customer with correct total/count/affected/date metadata (R4 distinct)",
     lambda i: i == "summary_exists" or i.startswith("summary_meta::")),
    ("liability_pi_correct", "Net refund-liability payment intent with correct amount + batch/type metadata (R4 distinct)",
     lambda i: i == "liability_pi_exists" or i.startswith("liability_meta::")),
    ("customer_descriptions_updated", "Each credited supplier's account description rolled up (amount + count + batch) (R3 per-supplier batch)",
     lambda i: i.startswith("cust_desc::")),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    args = parser.parse_args()

    task_dir = Path(args.task_dir)
    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text())
    mock_url = os.environ.get("MOCK_SITE_URL", "http://127.0.0.1:3000")
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier")

    # atoms: ordered dict {atom_id: (passed: bool, reason: str)} computed with the
    # EXACT pre-refactor expressions. add() is a drop-in for the old
    # checks.append(chk(...)) so every comparison below stays byte-identical.
    atoms = {}

    def add(cid, passed, reason=""):
        atoms[cid] = (bool(passed), str(reason)[:300])

    state_err = ""
    try:
        state = fetch_state(f"{mock_url}/__bench/state", token)
    except Exception as e:
        state = {}
        state_err = str(e)

    objects = state.get("objects", []) if isinstance(state, dict) else []
    add("mock_reachable", isinstance(state, dict) and bool(objects) and not state_err,
        state_err or "stripe mock state reachable")

    refunds = [o["data"] for o in objects if o.get("resource") == "refunds" and not o.get("deleted")]
    charges = [o["data"] for o in objects if o.get("resource") == "charges" and not o.get("deleted")]
    customers = [o["data"] for o in objects if o.get("resource") == "customers" and not o.get("deleted")]
    pis = [o["data"] for o in objects if o.get("resource") == "payment_intents" and not o.get("deleted")]

    charge_by_desc = {}
    for c in charges:
        desc = norm(c.get("description", ""))
        if desc:
            charge_by_desc[desc] = c

    # Check expected refunds exist with correct amounts
    for er in expected["expected_refunds"]:
        desc = norm(er["charge_description"])
        charge = charge_by_desc.get(desc)
        charge_id = charge.get("id") if charge else None
        matching_refunds = [r for r in refunds if r.get("charge") == charge_id] if charge_id else []

        add(f"refund_exists::{desc}", len(matching_refunds) >= 1,
            f"found {len(matching_refunds)} refund(s)" if matching_refunds else f"no refund for charge '{desc}'")
        if matching_refunds:
            got_amount = matching_refunds[0].get("amount", 0)
            tolerance = int(er.get("tolerance", 0) or 0)
            add(
                f"refund_amount::{desc}",
                abs(got_amount - er["refund_amount"]) <= tolerance,
                f"expected {er['refund_amount']} ±{tolerance}, got {got_amount}",
            )

    # Trap: B-4412 stated "25%" but actual count is 115/500 = 23%. Agent using 25% gets 212500 instead of 195500.
    b4412_charge = charge_by_desc.get(norm("Bluetooth Module Batch B-4412"))
    if b4412_charge:
        b4412_id = b4412_charge.get("id")
        b4412_refunds = [r for r in refunds if r.get("charge") == b4412_id]
        if b4412_refunds:
            b4412_amt = b4412_refunds[0].get("amount", 0)
            add("trap::b4412_not_25pct", b4412_amt != 212500,
                "used stated 25% instead of actual 115/500=23%")

    # Check NO refund on items that should not be refunded
    for no_ref in expected.get("no_refund", []):
        desc = norm(no_ref)
        charge = charge_by_desc.get(desc)
        charge_id = charge.get("id") if charge else None
        false_refunds = [r for r in refunds if r.get("charge") == charge_id] if charge_id else []
        add(f"no_refund::{desc}", len(false_refunds) == 0,
            f"should NOT be refunded, found {len(false_refunds)} refund(s)")

    # Check summary customer
    es = expected["summary_customer"]
    summary = [c for c in customers if norm(c.get("name", "")) == norm(es["name"])]
    add("summary_exists", len(summary) == 1,
        f"summary customer '{es['name']}': found {len(summary)}")
    if summary:
        meta = summary[0].get("metadata", {})
        for mk, mv in es["metadata"].items():
            got = str(meta.get(mk, ""))
            if mk == "customers_affected":
                try:
                    ok = int(got) == int(mv) or got.count(",") + 1 == int(mv)
                except (ValueError, TypeError):
                    ok = False
                add(f"summary_meta::{mk}", ok, f"{mk}: expected {mv}, got {got}")
            else:
                add(f"summary_meta::{mk}", got == mv,
                    f"{mk}: expected {mv}, got {got}")

    # Check liability payment intent
    eli = expected.get("liability_payment_intent", {})
    if eli:
        matching_pi = [p for p in pis
                       if p.get("amount") == eli["amount"]
                       and norm(p.get("description", "")) == norm(eli.get("description", ""))]
        add("liability_pi_exists", len(matching_pi) >= 1,
            f"found {len(matching_pi)} matching PI" if matching_pi else "liability payment intent not found")
        if matching_pi:
            pi_meta = matching_pi[0].get("metadata", {})
            for mk, mv in eli.get("metadata", {}).items():
                got = str(pi_meta.get(mk, ""))
                add(f"liability_meta::{mk}", got == mv,
                    f"{mk}: expected {mv}, got {got}")

    # Check customer description updates
    for cname, cdata in expected.get("customer_refund_totals", {}).items():
        total_dollars = cdata["total_cents"] / 100
        count = cdata["count"]
        cust = [c for c in customers if norm(c.get("name", "")) == norm(cname)]
        if cust:
            got_desc = norm(cust[0].get("description", ""))
            total_str_plain = f"${total_dollars:.2f}"
            total_str_comma = f"${total_dollars:,.2f}"
            has_amount = total_str_plain in got_desc or total_str_comma in got_desc
            has_count = f"{count} transaction" in got_desc
            has_batch = "2026-06" in got_desc
            add(f"cust_desc::{cname}",
                has_amount and has_count and has_batch,
                f"desc should contain amount+count+batch, got '{got_desc[:80]}'")
        else:
            add(f"cust_desc::{cname}", False, f"customer '{cname}' not found")

    _write_reward(atoms, args.reward_json)


def fold_atoms(atoms):
    """Fold the per-atom results into the GROUP_SPECS capability checks.

    Pure emit/grouping: each group = AND(member atoms); failing members are
    listed in ``reason``. Complete partition is asserted — every atom id must
    map to exactly one group (no drop, no None)."""
    members = {gid: [] for gid, _desc, _pred in GROUP_SPECS}
    for aid in atoms:
        claimed = None
        for gid, _desc, pred in GROUP_SPECS:
            if pred(aid):
                claimed = gid
                break
        assert claimed is not None, f"atom '{aid}' maps to no capability group (incomplete partition)"
        members[claimed].append(aid)

    checks = []
    for gid, _desc, _pred in GROUP_SPECS:
        ids = members[gid]
        failing = [aid for aid in ids if not atoms[aid][0]]
        # A group passes iff it has >=1 evaluated atom and none failed. An empty
        # group means the capability was never exercised (e.g. the summary/
        # liability/refund_amount atoms are conditionally skipped when their
        # prerequisite atom failed) -> not a pass.
        passed = len(ids) >= 1 and len(failing) == 0
        if failing:
            detail = "; ".join(f"{aid}: {atoms[aid][1]}" for aid in failing)
            reason = f"{len(failing)}/{len(ids)} failed: {detail}"
        elif not ids:
            reason = "no atoms evaluated"
        else:
            reason = f"ok ({len(ids)} atoms)"
        checks.append(chk(gid, passed, reason))
    return checks


def _write_reward(atoms, path):
    checks = fold_atoms(atoms)
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    reward = {
        "schema_version": "2.0",
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "score": passed / total if total else 0,
        "reward": passed / total if total else 0,
        "passed": passed == total,
    }
    Path(path).write_text(json.dumps(reward, indent=2, ensure_ascii=False))
    print(f"stripe-supplier-payment-refund: {passed}/{total} checks passed")


if __name__ == "__main__":
    main()
