#!/usr/bin/env python3
"""Verifier for cli-stripe-trial-conversion.

Tests whether the agent correctly mapped business requirements to Stripe
CLI operations: products, prices, payment_methods, setup_intents,
subscriptions, coupons, webhook_endpoints.

Capacity refactor (2026-06-09): the per-resource atomic checks are computed
verbatim into ``atoms`` and then folded by AND into 10 distinct capability
groups (catalog build, pricing, customer creation, pre-billing card
verification, subscription attachment, churn restraint, the per-customer
discount/trial special cases, and webhook config; plus a setup gate). The
folding is pure emit/grouping: every atomic boolean/threshold/field comparison
below is byte-identical to the pre-refactor verifier (same predicate, same
thresholds, same field names, same conditional sub-check skips) — only the
final emit layer changed (``checks.append(chk(...))`` -> ``add(...)`` storing
into an ordered ``atoms`` dict, then ``fold_atoms()``). See
``docs/check-granularity.md`` (R2/R3/R4/R6) and
``docs/capacity-migration-status.md``.

NOTE: this verifier computes checks INLINE against a LIVE stripe mock and the
final mock state is NOT archived, so RERUN validation is impossible. The fold
is validated REFOLD-ONLY (re-folding the archived atomic breakdown of 9 release
runs into the new groups; binary mismatch == 0). Atomic-invariance is
guaranteed by construction (the atom expressions are unchanged).
"""
import argparse, json, os, urllib.request
from pathlib import Path


def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300], "check_type": "deterministic_exact"}


def norm(s):
    return " ".join(str(s or "").strip().split()).lower()


def fetch_state(url, token):
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def active(objects, resource):
    return [o["data"] for o in objects if o.get("resource") == resource and not o.get("deleted")]


# --- Capability fold (emit/grouping layer only; atom computations unchanged) ---
# Ordered list of (group_id, capability description, predicate(atom_id)->bool).
# Predicates are evaluated in order; the FIRST matching group claims the atom,
# so the partition is complete and disjoint for every atom id emitted below.
GROUP_SPECS = [
    ("setup_gate", "Environment ready: stripe mock reachable + batch summary written (R2 plumbing)",
     lambda i: i in ("mock_reachable", "output_exists")),
    ("catalog_built", "All 3 product tiers created with correct names (R3 per-product batch)",
     lambda i: i.startswith("prod::")),
    ("pricing_correct", "Correct monthly/annual prices per tier; Enterprise has no annual (R3 per-price grid)",
     lambda i: i.startswith("price::")),
    ("customers_created", "All 6 cohort customers created by email (R3 per-customer batch)",
     lambda i: i.startswith("cust::")),
    ("payment_verification", "Cards verified before billing: 5 payment methods + 5 setup_intents linked to converters (R4 distinct pre-billing step)",
     lambda i: i in ("payment_methods_count", "setup_intents_count") or i.startswith("setup_intent::")),
    ("subscriptions_correct", "Each converter has a subscription on the correct plan/price (R3 per-customer + plan linkage)",
     lambda i: i == "subscription_count" or i.startswith("sub::")),
    ("churn_restraint", "Frank not subscribed and marked churned in metadata (R6 negative restraint)",
     lambda i: i in ("frank_no_sub", "frank_churned_metadata")),
    ("discount_applied", "Dave's 15% one-time first-payment discount coupon created (R4 distinct special case)",
     lambda i: i == "coupon_dave_15pct"),
    ("trial_extension", "Carol's 30-day trial extension applied via trial_end or 100%-off coupon (R4 distinct special case)",
     lambda i: i == "carol_trial_extension"),
    ("webhook_configured", "Billing-lifecycle webhook endpoint created with >=2 events (R4 distinct)",
     lambda i: i in ("webhook_exists", "webhook_has_events")),
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
    subscriptions = active(objects, "subscriptions")
    coupons = active(objects, "coupons")
    webhooks = active(objects, "webhook_endpoints")
    payment_methods = active(objects, "payment_methods")
    setup_intents = active(objects, "setup_intents")

    products_by_name = {}
    for p in products:
        key = norm(p.get("name", ""))
        products_by_name[key] = p

    prices_by_product = {}
    for p in prices:
        prices_by_product.setdefault(p.get("product"), []).append(p)

    cust_by_email = {}
    for c in customers:
        cust_by_email[c.get("email", "")] = c

    # === Products ===
    for ep in expected["products"]:
        pn = norm(ep["name"])
        prod = products_by_name.get(pn)
        add(f"prod::{ep['name']}", prod is not None, f"product '{ep['name']}' not found")
        if not prod:
            continue
        pid = prod.get("id", "")
        pp = prices_by_product.get(pid, [])
        monthly = [p for p in pp if p.get("unit_amount") == ep["monthly_cents"]
                   and (p.get("recurring") or {}).get("interval") == "month"]
        add(f"price::{ep['name']}::monthly", len(monthly) >= 1,
            f"expected monthly {ep['monthly_cents']}, found {[p.get('unit_amount') for p in pp]}")
        if ep.get("annual_cents") is not None:
            annual = [p for p in pp if p.get("unit_amount") == ep["annual_cents"]
                      and (p.get("recurring") or {}).get("interval") == "year"]
            add(f"price::{ep['name']}::annual", len(annual) >= 1,
                f"expected annual {ep['annual_cents']}, found {len(annual)}")
        else:
            annual = [p for p in pp if (p.get("recurring") or {}).get("interval") == "year"]
            add(f"price::{ep['name']}::no_annual", len(annual) == 0,
                f"Enterprise should have no annual price, found {len(annual)}")

    # === Customers ===
    for ec in expected["customers"]:
        cust = cust_by_email.get(ec["email"])
        add(f"cust::{ec['name']}", cust is not None, f"customer '{ec['name']}' ({ec['email']}) not found")

    # === Payment Methods (5 — all converting customers) ===
    add("payment_methods_count",
        len(payment_methods) >= expected["payment_method_count"],
        f"expected >= {expected['payment_method_count']}, found {len(payment_methods)}")

    # === Setup Intents (5 — card verification before billing) ===
    add("setup_intents_count",
        len(setup_intents) >= expected["setup_intent_count"],
        f"expected >= {expected['setup_intent_count']}, found {len(setup_intents)}")

    # Setup intents should reference customers
    si_customers = {si.get("customer") for si in setup_intents if si.get("customer")}
    for ec in expected["customers"]:
        if ec.get("converts"):
            cust = cust_by_email.get(ec["email"])
            if cust:
                add(f"setup_intent::{ec['name']}",
                    cust.get("id") in si_customers,
                    f"no setup_intent found for {ec['name']}")

    # === Subscriptions ===
    add("subscription_count",
        len(subscriptions) >= expected["subscription_count"],
        f"expected >= {expected['subscription_count']}, found {len(subscriptions)}")

    # Check each converting customer has a subscription linked to the correct plan
    sub_customers = {s.get("customer") for s in subscriptions}
    for ec in expected["customers"]:
        if ec.get("converts"):
            cust = cust_by_email.get(ec["email"])
            if cust:
                has_sub = cust.get("id") in sub_customers
                add(f"sub::{ec['name']}", has_sub,
                    f"{'has' if has_sub else 'missing'} subscription")
                if has_sub and ec.get("expected_price_cents"):
                    cust_subs = [s for s in subscriptions
                                 if s.get("customer") == cust.get("id")]
                    price_match = any(
                        s.get("plan", {}).get("amount") == ec["expected_price_cents"]
                        or any(
                            item.get("price", {}).get("unit_amount") == ec["expected_price_cents"]
                            for item in (s.get("items", {}).get("data", [])
                                         if isinstance(s.get("items"), dict) else [])
                        )
                        for s in cust_subs
                    )
                    add(f"sub::{ec['name']}::correct_plan", price_match,
                        f"expected price {ec['expected_price_cents']}c")

    # === Frank should NOT have a subscription ===
    frank = cust_by_email.get("frank@retail.de")
    if frank:
        frank_subs = [s for s in subscriptions if s.get("customer") == frank.get("id")]
        add("frank_no_sub", len(frank_subs) == 0,
            f"Frank is churned, should have no subscription, found {len(frank_subs)}")
        meta = frank.get("metadata") or {}
        meta = meta if isinstance(meta, dict) else {}
        has_churn = any("churn" in str(v).lower() or "churn" in str(k).lower() for k, v in meta.items())
        add("frank_churned_metadata", has_churn,
            f"Frank should be marked as churned in metadata, got: {meta}")

    # === Coupons — Dave's 15% discount ===
    pct15_coupons = [c for c in coupons
                     if c.get("percent_off") == 15 and c.get("duration") == "once"]
    add("coupon_dave_15pct", len(pct15_coupons) >= 1,
        f"need a 15% once coupon for Dave's discount, found {len(pct15_coupons)}")

    # === Carol — trial extension (either trial_end on sub or 100% coupon) ===
    carol = cust_by_email.get("carol@design.studio")
    if carol:
        carol_subs = [s for s in subscriptions if s.get("customer") == carol.get("id")]
        if carol_subs:
            sub = carol_subs[0]
            has_trial = sub.get("trial_end") is not None and sub.get("trial_end") != "null"
            has_coupon = sub.get("discount") is not None or sub.get("coupon") is not None
            trial_100_coupons = [c for c in coupons if c.get("percent_off") == 100]
            add("carol_trial_extension",
                has_trial or has_coupon or len(trial_100_coupons) >= 1,
                "Carol needs 30-day extension: trial_end, coupon, or 100% off coupon")

    # === Webhook ===
    wh_match = [w for w in webhooks if w.get("url") == expected["webhook_url"]]
    add("webhook_exists", len(wh_match) >= 1,
        f"webhook {expected['webhook_url']} not found")
    if wh_match:
        events = wh_match[0].get("enabled_events") or []
        if isinstance(events, str):
            events = [events]
        add("webhook_has_events", len(events) >= 2,
            f"webhook should have billing lifecycle events, found {len(events)}")

    # === Output file ===
    output_path = Path(args.output_dir) / "conversion_summary.json"
    add("output_exists", output_path.exists(),
        "conversion_summary.json not found")

    _write_reward(atoms, args.reward_json)


def fold_atoms(atoms):
    """Fold the per-atom results into the GROUP_SPECS capability checks.

    Pure emit/grouping: each group = AND(member atoms); failing members are
    listed in ``reason``. Complete partition is asserted — every atom id must
    map to exactly one group (no drop, no None). The verifier conditionally
    skips some atoms (e.g. ``price::*`` when the product is absent, ``sub::*``
    when the customer is absent), so a group may have fewer members in a given
    run; prefix-matching maps whatever atoms are present, and the parent
    ``::exists``/count atom failure already forces the group AND to fail."""
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
    print(f"cli-stripe-trial-conversion: {passed}/{total} checks passed")


if __name__ == "__main__":
    main()
