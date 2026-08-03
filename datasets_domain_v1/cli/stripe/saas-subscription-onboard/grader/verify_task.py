#!/usr/bin/env python3
"""Verifier for stripe-saas-subscription-onboard.

Checks the final mock state against the pricing-sheet onboarding spec:
- 6 products with names/descriptions/metadata + 9 prices
- 2 active coupons + 1 deleted coupon
- 2 webhook endpoints with correct enabled events
- pilot subscriptions, charges, audit-record customer with counted metadata
- pipeline triggers fired

Capacity refactor (2026-06-09): the per-resource atomic checks (up to 56 of
them; fewer when products/coupons are missing and the nested desc/meta/price/pct
atoms are skipped via ``continue``) are computed verbatim into ``atoms`` and
then folded by AND into 9 distinct capability groups (one onboarding competency
per Stripe resource type, plus a setup gate). The folding is pure emit/grouping:
every atomic boolean/threshold/field comparison below is byte-identical to the
pre-refactor verifier — only the final emit layer changed (``checks.append(
chk(...))`` became ``add(...)`` into an ordered ``atoms`` dict, plus a
``fold_atoms()`` aggregation). No comparison, threshold, field, string, or
skip-condition was altered. See ``docs/check-granularity.md`` (R2/R3/R4/R6) and
``docs/capacity-migration-status.md`` (stripe section).

STRIPE NOTE: this verifier runs INLINE against a LIVE stripe mock and the final
mock state is NOT archived, so RERUN is impossible. The refactor is validated
REFOLD-ONLY by re-folding the archived 9-model atomic breakdowns through these
same GROUP_SPECS (see scratch/scripts/capacity_refactor/refold_stripe_saas_onboard.py).
"""
import argparse, json, os, urllib.request
from pathlib import Path

def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300], "check_type": "deterministic_exact"}

def norm(s):
    return " ".join(str(s or "").strip().split())

def fetch_state(url, token):
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())

def active(objects, resource):
    return [o["data"] for o in objects if o.get("resource") == resource and not o.get("deleted")]


# --- Capability fold (emit/grouping layer only; atom computations unchanged) ---
# Ordered list of (group_id, capability description, predicate(atom_id)->bool).
# Predicates are evaluated in order; the FIRST matching group claims the atom,
# so the partition is complete and disjoint for every atom id the verifier can
# emit (verified against the full 56-atom universe of the 9 archived runs).
GROUP_SPECS = [
    ("setup_gate", "Environment ready: stripe mock reachable + state loaded",
     lambda i: i == "mock_reachable"),
    ("products_created", "Every product created with correct name/description/metadata (R3 per-product batch)",
     lambda i: i.startswith("prod::")),
    ("prices_created", "All prices present at correct amounts/intervals linked to products (R3 per-price batch)",
     lambda i: i.startswith("price::")),
    ("coupons_managed", "Active coupons created with correct discount + launch coupon deleted (R3 + R6 lifecycle)",
     lambda i: i == "coupon_deleted" or i.startswith("coupon::")),
    ("webhooks_created", "Webhook endpoints present with correct URLs + enabled events (R4 distinct resource)",
     lambda i: i.startswith("wh::")),
    ("triggers_fired", "Pipeline triggers fired (payment_intent/invoice/checkout) (R4 distinct)",
     lambda i: i.startswith("trigger::")),
    ("charges_created", "Onboarding setup-fee charges at correct amounts (R4 distinct)",
     lambda i: i.startswith("charge::")),
    ("subscriptions_attached", "Pilot subscriptions attached with correct customer-product-interval associations (R4 distinct)",
     lambda i: i.startswith("sub::")),
    ("audit_record_computed", "Audit customer with dynamically-counted metadata totals (R4 distinct)",
     lambda i: i == "audit_exists" or i.startswith("audit::")),
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

    # atoms: ordered dict {atom_id: (passed: bool, reason: str)} computed with
    # the EXACT pre-refactor expressions. add() is a drop-in for the old
    # checks.append(chk(...)) so every comparison below stays byte-identical.
    atoms = {}

    def add(cid, passed, reason=""):
        atoms[cid] = (bool(passed), str(reason)[:300])

    try:
        state = fetch_state(f"{mock_url}/__bench/state", token)
    except Exception as e:
        add("mock_reachable", False, str(e))
        _write_reward(atoms, args.reward_json)
        return

    objects = state.get("objects", []) if isinstance(state, dict) else []
    add("mock_reachable", bool(objects), f"{len(objects)} objects")

    products = active(objects, "products")
    prices = active(objects, "prices")
    customers = active(objects, "customers")
    coupons = active(objects, "coupons")
    subscriptions = active(objects, "subscriptions")
    charges = active(objects, "charges")
    events = active(objects, "events")
    webhooks = active(objects, "webhook_endpoints")

    products_by_name = {norm(p.get("name", "")): p for p in products}
    prices_by_product = {}
    for p in prices:
        prices_by_product.setdefault(p.get("product"), []).append(p)

    # --- Products + prices ---
    for ep in expected["products"]:
        pn = norm(ep["name"])
        prod = products_by_name.get(pn)
        add(f"prod::{pn}", prod is not None, f"'{ep['name']}' not found")
        if not prod:
            continue
        desc = ep.get("updated_description") or ep.get("description")
        if desc:
            add(f"prod::{pn}::desc",
                norm(prod.get("description", "")) == norm(desc),
                "description mismatch")
        meta = prod.get("metadata") or {}
        meta = meta if isinstance(meta, dict) else {}
        for mk, mv in ep.get("metadata", {}).items():
            add(f"prod::{pn}::meta::{mk}", str(meta.get(mk, "")) == str(mv),
                f"{mk}: expected {mv}, got {meta.get(mk)}")
        pid = prod.get("id", "")
        pp = prices_by_product.get(pid, [])
        for wp in ep.get("prices", []):
            interval = wp.get("interval", "month")
            match = [p for p in pp if p.get("unit_amount") == wp["unit_amount"]
                     and (p.get("recurring") or {}).get("interval") == interval]
            add(f"price::{pn}::{wp['unit_amount']}_{interval}", len(match) >= 1,
                f"price {wp['unit_amount']}/{interval}: found {len(match)}")

    # --- Coupons active ---
    coupons_by_name = {(c.get("name") or c.get("id", "")): c for c in coupons}
    for ec in expected.get("coupons_active", []):
        c = coupons_by_name.get(ec["name"])
        add(f"coupon::{ec['name']}", c is not None, f"'{ec['name']}' not found")
        if c and "percent_off" in ec:
            add(f"coupon::{ec['name']}::pct", c.get("percent_off") == ec["percent_off"],
                f"expected {ec['percent_off']}, got {c.get('percent_off')}")

    # --- Coupon deleted ---
    deleted_coupon = expected.get("coupon_deleted")
    if deleted_coupon:
        add("coupon_deleted", deleted_coupon not in coupons_by_name,
            f"'{deleted_coupon}' should be deleted")

    # --- Webhooks ---
    for ew in expected.get("webhooks", []):
        slug = ew["url"].split("/")[-1]
        match = [w for w in webhooks if w.get("url") == ew["url"]]
        add(f"wh::{slug}", len(match) >= 1, f"webhook {ew['url']} not found")
        if match:
            got = match[0].get("enabled_events") or []
            if isinstance(got, str): got = [got]
            missing = set(ew["events"]) - set(got)
            add(f"wh::{slug}::events", len(missing) == 0, f"missing: {missing}")

    # --- Triggers ---
    event_types = {e.get("type") for e in events}
    for trig in expected.get("triggers", []):
        add(f"trigger::{trig}", trig in event_types, f"not fired")

    # --- Charges ---
    for ec in expected.get("charges", []):
        match = [c for c in charges if c.get("amount") == ec["amount"]]
        add(f"charge::{ec['amount']}", len(match) >= 1,
            f"charge {ec['amount']} not found")

    # --- Subscriptions (customer x product x interval tuples) ---
    sub_list = expected.get("subscriptions", [])
    cust_id_to_name = {c.get("id", ""): norm(c.get("name", "")) for c in customers}
    products_by_id = {p.get("id", ""): p for p in products}
    prices_by_id = {p.get("id", ""): p for p in prices}

    for esub in sub_list:
        exp_cust = norm(esub["customer_name"])
        exp_prod = norm(esub["product_name"])
        exp_interval = esub["interval"]
        atom_id = f"sub::{exp_cust}::{exp_prod}::{exp_interval}"
        found = False
        for sub in subscriptions:
            sub_cust = cust_id_to_name.get(sub.get("customer", ""), "")
            if sub_cust != exp_cust:
                continue
            items = (sub.get("items") or {}).get("data", [])
            for item in items:
                price_obj = item.get("price", {})
                if isinstance(price_obj, str):
                    price_obj = prices_by_id.get(price_obj, {})
                prod_ref = price_obj.get("product", "")
                if isinstance(prod_ref, dict):
                    prod_name = norm(prod_ref.get("name", ""))
                else:
                    prod_name = norm(products_by_id.get(prod_ref, {}).get("name", ""))
                interval = (price_obj.get("recurring") or {}).get("interval", "")
                if prod_name == exp_prod and interval == exp_interval:
                    found = True
                    break
            if found:
                break
        add(atom_id, found,
            f"{esub['customer_name']} / {esub['product_name']} / {esub['interval']}: "
            f"{'found' if found else 'not found'}")

    # --- Audit customer ---
    ac = expected.get("audit_customer", {})
    if ac:
        audit = [c for c in customers if norm(c.get("name", "")) == norm(ac.get("name", ""))]
        add("audit_exists", len(audit) >= 1, f"'{ac.get('name')}' not found")
        if audit:
            meta = audit[0].get("metadata") or {}
            meta = meta if isinstance(meta, dict) else {}
            for mk, mv in ac.get("metadata", {}).items():
                add(f"audit::{mk}", str(meta.get(mk, "")) == str(mv),
                    f"{mk}: expected {mv}, got {meta.get(mk)}")

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
    print(f"stripe-saas-subscription-onboard: {passed}/{total} checks passed")


if __name__ == "__main__":
    main()
