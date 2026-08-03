#!/usr/bin/env python3
"""Verifier for stripe-invoice-reconciliation (hardened).

Key judgment points:
  - Alpine Ridge tent stakes: short-ship adjustment (70 units credit → net $2,940 not $3,150)
  - Basecamp sleeping bags: QC rejection (12 units → 168 accepted, $20,160 not $21,600)
  - Summit Trail Direct: new customer needs to be created before invoicing
  - 4 invoices total (not 3), 11 line items (not 9)

Capacity refactor (2026-06-09): the per-item atomic checks (21-23 of them; the
count varies because the reconciliation branch is conditional) are computed
verbatim into ``atoms`` and then folded by AND into 7 distinct capability groups
(setup gate, new-customer provisioning, customer descriptions, invoice line
items, the two real-world adjustments as a restraint capability, invoice
creation, and the reconciliation output). The folding is pure emit/grouping:
every atomic boolean/threshold/field comparison below is byte-identical to the
pre-refactor verifier — only the final emit layer changed. See
``docs/check-granularity.md`` (R2/R3/R4/R6) and
``docs/capacity-migration-status.md``.

Stripe verifiers compute checks INLINE against a LIVE mock and the final mock
state is NOT archived → RERUN is impossible. Fold validation is REFOLD-ONLY
(see ``scratch/scripts/capacity_refactor/refold_stripe_invoice_recon.py``).
"""
import argparse, json, os, urllib.request
from pathlib import Path

def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300], "check_type": "deterministic_exact"}

def norm(s):
    return " ".join(str(s or "").strip().split())

def first_present(mapping, *keys):
    for key in keys:
        if key in mapping:
            return mapping.get(key)
    return None

def fetch_state(url, token):
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


# --- Capability fold (emit/grouping layer only; atom computations unchanged) ---
# Ordered list of (group_id, capability description, predicate(atom_id)->bool).
# Predicates are evaluated in order; the FIRST matching group claims the atom,
# so the partition is complete and disjoint for every atom id below.
GROUP_SPECS = [
    ("setup_gate", "Environment ready: stripe mock reachable + state loaded",
     lambda i: i == "mock_reachable"),
    ("new_customer_provisioned", "Recognized Summit Trail Direct is absent and created it (R4 distinct)",
     lambda i: i == "new_customer"),
    ("customer_descriptions", "All customer description/account-note fields set (R3 per-customer batch)",
     lambda i: i.startswith("desc::")),
    ("invoice_line_items", "All 11 ledger line items created with correct customer + amount (R3 per-item batch)",
     lambda i: i.startswith("item::")),
    ("adjustments_correct", "Both real-world adjustments applied AND the unadjusted amounts absent (R4/R6 restraint)",
     lambda i: i.startswith("adj::")),
    ("invoices_created", "Correct number of invoices created (R4 distinct)",
     lambda i: i == "invoice_count"),
    ("reconciliation_output", "reconciliation.json present with correct total + invoice/line-item counts (R3)",
     lambda i: i in ("recon_exists", "recon_total", "recon_inv_count", "recon_li_count")),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    args = parser.parse_args()

    expected = json.loads((Path(args.task_dir) / "private" / "expected_answer.json").read_text())
    mock_url = os.environ.get("MOCK_SITE_URL", "http://127.0.0.1:3000")
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier")

    try:
        state = fetch_state(f"{mock_url}/__bench/state", token)
    except Exception:
        state = {}

    # atoms: ordered dict {atom_id: (passed: bool, reason: str)} computed with
    # the EXACT pre-refactor expressions. add() is a drop-in for the old
    # checks.append(chk(...)) so every comparison below stays byte-identical.
    atoms = {}

    def add(cid, passed, reason=""):
        atoms[cid] = (bool(passed), str(reason)[:300])

    objects = state.get("objects", []) if isinstance(state, dict) else []
    add("mock_reachable", bool(objects), "no objects")

    active = lambda res: [o["data"] for o in objects if o.get("resource") == res and not o.get("deleted")]
    customers = active("customers")
    invoice_items = active("invoiceitems")
    invoices = active("invoices")

    customers_by_name = {norm(c.get("name", "")): c for c in customers}

    # --- New customer created ---
    nc = expected.get("new_customer", {})
    if nc:
        add("new_customer", norm(nc["name"]) in customers_by_name,
            f"'{nc['name']}' not found — needs to be created")

    # --- Customer descriptions ---
    for cname, want_desc in expected.get("customer_descriptions", {}).items():
        cust = customers_by_name.get(norm(cname))
        if not cust:
            add(f"desc::{cname}", False, f"customer '{cname}' not found")
            continue
        got_desc = norm(cust.get("description", ""))
        add(f"desc::{cname}", norm(want_desc) == got_desc,
            f"expected '{want_desc[:60]}', got '{got_desc[:60]}'")

    # --- Invoice items with correct adjusted amounts ---
    for eli in expected["line_items"]:
        cust = customers_by_name.get(norm(eli["customer_name"]))
        cust_id = cust.get("id") if cust else None
        matching = [ii for ii in invoice_items
                    if ii.get("customer") == cust_id and ii.get("amount") == eli["amount"]]
        desc_hint = eli.get("desc_contains", "")
        add(f"item::{eli['customer_name']}::{desc_hint}::{eli['amount']}",
            len(matching) >= 1,
            f"{desc_hint} {eli['amount']} cents for {eli['customer_name']}: found {len(matching)}")

    # --- Adjustment checks: wrong amounts should NOT exist ---
    cust_alpine = customers_by_name.get(norm("Alpine Ridge Outfitters"))
    if cust_alpine:
        wrong_stakes = [ii for ii in invoice_items
                        if ii.get("customer") == cust_alpine.get("id") and ii.get("amount") == 315000]
        add("adj::alpine_not_3150", len(wrong_stakes) == 0,
            "tent stakes at original $3,150 — should be $2,940 after short-ship adj")

    cust_base = customers_by_name.get(norm("Basecamp Supply Co"))
    if cust_base:
        wrong_bags = [ii for ii in invoice_items
                      if ii.get("customer") == cust_base.get("id") and ii.get("amount") == 2160000]
        add("adj::basecamp_not_21600", len(wrong_bags) == 0,
            "sleeping bags at original $21,600 — should be $20,160 after QC rejection")

    # --- Invoice count ---
    add("invoice_count", len(invoices) == expected["invoice_count"],
        f"expected {expected['invoice_count']}, got {len(invoices)}")

    # --- Reconciliation output ---
    output_dir = Path(args.output_dir)
    recon_path = output_dir / "reconciliation.json"
    if recon_path.exists():
        recon = json.loads(recon_path.read_text())
        er = expected["reconciliation"]
        got_total = first_present(
            recon,
            "total_invoiced_cents",
            "total_amount_cents",
            "total_invoiced_amount",
            "total_invoiced_amount_cents",
        )
        add("recon_total",
            got_total == er["total_invoiced_cents"],
            f"total: expected {er['total_invoiced_cents']}, got {got_total}")
        got_invoice_count = first_present(recon, "invoice_count", "number_of_invoices", "invoices_count")
        got_line_item_count = first_present(recon, "line_item_count", "number_of_line_items", "line_items_count")
        add("recon_inv_count",
            got_invoice_count == er["invoice_count"],
            f"expected {er['invoice_count']}, got {got_invoice_count}")
        add("recon_li_count",
            got_line_item_count == er["line_item_count"],
            f"expected {er['line_item_count']}, got {got_line_item_count}")
    else:
        add("recon_exists", False, "reconciliation.json not found")

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
        # group means the capability was never exercised (only happens when the
        # mock was unreachable and setup_gate already failed) -> not a pass.
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
        "schema_version": "2.0", "checks_passed": passed, "checks_total": total,
        "checks_breakdown": checks, "score": passed / total if total else 0,
        "reward": passed / total if total else 0, "passed": passed == total,
    }
    Path(path).write_text(json.dumps(reward, indent=2, ensure_ascii=False))
    print(f"stripe-invoice-reconciliation: {passed}/{total} checks passed")


if __name__ == "__main__":
    main()
