#!/usr/bin/env python3
"""Verifier for stripe-billing-audit-repair.

Checks the final mock state against the audit report specification:
- Part A: 7 products with correct fields + 10 prices
- Part B: 3 coupons, 1 tax rate, 1 shipping rate
- Part C: 3 webhook endpoints with correct events
- Part D: 5 customers with correct fields + metadata
- Part E: 8 subscriptions (per-tuple customer x product x interval)
- Part F: 4 charges with correct amounts
- Part G: triggers fired
- Part H: audit record customer with dynamically-counted metadata

Capacity refactor (2026-06-09): the per-resource atomic checks are computed
verbatim into ``atoms`` and then folded by AND into 13 distinct capability
groups (one repair competency per Stripe resource type, plus a setup gate, a
catalog-cardinality negative, the dynamic-count audit record, and the
pipeline-trigger capability). The folding is pure emit/grouping — only the
final emit layer changed. See ``docs/check-granularity.md`` (R2/R3/R4/R6)
and ``docs/capacity-migration-status.md``.

Fix 2026-06-10: subscription check upgraded from count-only to per-tuple
verification (customer_name x product_name x interval). Audit metadata check
upgraded from existence-only to exact-value comparison against
expected_answer.json (events_total kept as existence check since the mock
creates a non-deterministic number of events during agent operations).
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


EXPECTED_PRODUCTS = [
    {"name": "VoltGrid Basic", "desc_contains": "Single charging station", "meta": {"tier": "basic", "stations": "1"}, "prices": [(8900, "month"), (89000, "year")]},
    {"name": "VoltGrid Professional", "desc_contains": "Up to 10 stations", "meta": {"tier": "professional", "stations": "10"}, "prices": [(14900, "month"), (149000, "year")]},
    {"name": "VoltGrid Fleet", "desc_contains": "Unlimited stations", "meta": {"tier": "fleet", "stations": "unlimited"}, "prices": [(89900, "month"), (899000, "year")]},
    {"name": "Maintenance Add-on", "desc_contains": "Quarterly on-site", "meta": {"addon": "true", "frequency": "quarterly"}, "prices": [(14900, "month")]},
    {"name": "Hardware Warranty", "desc_contains": "3-year warranty", "meta": {"addon": "true", "warranty_years": "3"}, "prices": [(3900, "month")]},
    {"name": "Energy Analytics", "desc_contains": "energy consumption", "meta": {"addon": "true", "analytics_tier": "advanced"}, "prices": [(6900, "month")]},
    {"name": "API Integration Pack", "desc_contains": "RESTful API", "meta": {"addon": "true", "api_rate_limit": "5000"}, "prices": [(12900, "month")]},
]

EXPECTED_CUSTOMERS = [
    {"name": "ChargeFast Inc", "email": "billing@chargefast.io", "meta": {"segment": "enterprise"}},
    {"name": "GreenDrive LLC", "email": "accounts@greendrive.com", "meta": {"segment": "mid_market"}},
    {"name": "ParkCharge Systems", "email": "finance@parkcharge.dev", "meta": {"segment": "smb"}},
    {"name": "EcoFleet Partners", "email": "ops@ecofleet.co", "meta": {"segment": "enterprise", "partner": "true"}},
    {"name": "CityGrid Municipal", "email": "procurement@citygrid.gov", "meta": {"segment": "government", "tax_exempt": "true"}},
]

EXPECTED_COUPONS = [
    {"name": "EARLYBIRD", "percent_off": 15, "duration": "repeating"},
    {"name": "FLEET25", "percent_off": 25, "duration": "forever"},
    {"name": "HARDWARE10", "amount_off": 1000, "duration": "once"},
]

EXPECTED_WEBHOOKS = [
    {"url": "https://api.voltgrid.com/webhooks/billing", "events": {"invoice.paid", "invoice.payment_failed", "charge.refunded"}},
    {"url": "https://api.voltgrid.com/webhooks/fleet", "events": {"customer.subscription.created", "customer.subscription.deleted", "payment_intent.succeeded"}},
    {"url": "https://api.voltgrid.com/webhooks/analytics", "events": {"charge.succeeded", "payment_intent.payment_failed"}},
]

EXPECTED_CHARGES = [
    {"customer_name": "ChargeFast Inc", "amount": 250000},
    {"customer_name": "GreenDrive LLC", "amount": 75000},
    {"customer_name": "EcoFleet Partners", "amount": 250000},
    {"customer_name": "CityGrid Municipal", "amount": 120000},
]


# --- Capability fold (emit/grouping layer only; atom computations unchanged) ---
# Ordered list of (group_id, capability description, predicate(atom_id)->bool).
# Predicates are evaluated in order; the FIRST matching group claims the atom,
# so the partition is complete and disjoint for every atom id below.
GROUP_SPECS = [
    ("setup_gate", "Environment ready: stripe mock reachable + state loaded",
     lambda i: i == "mock_reachable"),
    ("catalog_cardinality_correct", "Exactly 7 products, junk removed, no extras (R6 negative + cardinality)",
     lambda i: i in ("junk_deleted", "product_count")),
    ("products_repaired", "Every product has correct name/description/metadata (R3 per-product batch)",
     lambda i: i.startswith("prod::")),
    ("prices_repaired", "All 10 active prices present at correct amounts/intervals (R3 per-price batch)",
     lambda i: i.startswith("price::")),
    ("coupons_repaired", "3 coupons correct, junk coupon removed (R3 + R6)",
     lambda i: i.startswith("coupon::")),
    ("tax_rate_repaired", "US sales tax rate created at correct percentage (R4 distinct resource)",
     lambda i: i.startswith("tax_rate::")),
    ("shipping_rate_repaired", "Equipment delivery shipping rate created at correct amount (R4 distinct resource)",
     lambda i: i.startswith("shipping_rate::")),
    ("webhooks_repaired", "3 webhook endpoints with correct URLs + enabled events (R4 distinct)",
     lambda i: i == "webhook_count" or i.startswith("wh::")),
    ("customers_repaired", "Exactly the 5 customers with correct email + segment metadata (R3 per-customer batch)",
     lambda i: i == "customer_count" or i.startswith("cust::")),
    ("subscriptions_correct", "All 8 subscriptions with correct customer-product-interval associations (R3 per-subscription batch)",
     lambda i: i == "subscription_count" or i.startswith("sub::")),
    ("charges_repaired", "4 setup-fee charges at correct amounts per customer (R4 distinct)",
     lambda i: i == "charge_count" or i.startswith("charge::")),
    ("triggers_fired", "Pipeline triggers fired (payment_intent/invoice/checkout) (R4 distinct)",
     lambda i: i.startswith("trigger::")),
    ("audit_record_computed", "Audit customer with dynamically-counted metadata (R4 distinct)",
     lambda i: i == "audit_customer" or i.startswith("audit::")),
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
    add("mock_reachable", bool(objects), "no objects" if not objects else f"{len(objects)} objects")

    products = active(objects, "products")
    prices = active(objects, "prices")
    customers = active(objects, "customers")
    coupons = active(objects, "coupons")
    webhooks = active(objects, "webhook_endpoints")
    charges = active(objects, "charges")
    subscriptions = active(objects, "subscriptions")
    events = active(objects, "events")
    tax_rates = active(objects, "tax_rates")
    shipping_rates = active(objects, "shipping_rates")

    # --- Part A: Products ---
    junk_names = {"Test Product DO NOT USE", "Old Charger v1 (deprecated)"}
    junk_remaining = [p for p in products if norm(p.get("name", "")) in junk_names]
    add("junk_deleted", len(junk_remaining) == 0,
        f"{len(junk_remaining)} junk products still exist")

    add("product_count", len(products) == 7,
        f"expected 7, got {len(products)}")

    products_by_name = {norm(p.get("name", "")): p for p in products}
    for ep in EXPECTED_PRODUCTS:
        pn = norm(ep["name"])
        prod = products_by_name.get(pn)
        add(f"prod::{pn}::exists", prod is not None, f"'{ep['name']}' not found")
        if not prod:
            continue
        add(f"prod::{pn}::desc", ep["desc_contains"].lower() in (prod.get("description") or "").lower(),
            f"description missing '{ep['desc_contains']}'")
        meta = prod.get("metadata") or {}
        meta = meta if isinstance(meta, dict) else {}
        for mk, mv in ep["meta"].items():
            add(f"prod::{pn}::meta::{mk}", str(meta.get(mk, "")) == mv,
                f"{mk}: expected '{mv}', got '{meta.get(mk)}'")

    # --- Prices ---
    prices_by_product = {}
    for p in prices:
        pid = p.get("product", "")
        prices_by_product.setdefault(pid, []).append(p)

    for ep in EXPECTED_PRODUCTS:
        pn = norm(ep["name"])
        prod = products_by_name.get(pn)
        if not prod:
            continue
        pp = prices_by_product.get(prod.get("id", ""), [])
        for amount, interval in ep["prices"]:
            match = [p for p in pp
                     if p.get("unit_amount") == amount
                     and p.get("currency") == "usd"
                     and (p.get("recurring", {}) or {}).get("interval") == interval]
            add(f"price::{pn}::{interval}::{amount}", len(match) >= 1,
                f"{interval} {amount} for {pn}: found {len(match)}")

    # --- Part B: Coupons ---
    coupons_by_name = {}
    for c in coupons:
        cn = c.get("name") or c.get("id", "")
        coupons_by_name[cn] = c

    junk_coupon = coupons_by_name.get("TESTDISCOUNT")
    add("coupon::junk_deleted", junk_coupon is None, "TESTDISCOUNT still exists")

    for ec in EXPECTED_COUPONS:
        c = coupons_by_name.get(ec["name"])
        add(f"coupon::{ec['name']}::exists", c is not None, f"'{ec['name']}' not found")
        if not c:
            continue
        if "percent_off" in ec:
            add(f"coupon::{ec['name']}::pct", c.get("percent_off") == ec["percent_off"],
                f"expected {ec['percent_off']}, got {c.get('percent_off')}")
        if "amount_off" in ec:
            add(f"coupon::{ec['name']}::amt", c.get("amount_off") == ec["amount_off"],
                f"expected {ec['amount_off']}, got {c.get('amount_off')}")

    # --- Tax rate ---
    add("tax_rate::exists", len(tax_rates) >= 1, f"found {len(tax_rates)}")
    if tax_rates:
        tr = tax_rates[0]
        add("tax_rate::pct", abs(float(tr.get("percentage", 0)) - 8.875) < 0.01,
            f"expected 8.875, got {tr.get('percentage')}")

    # --- Shipping rate ---
    add("shipping_rate::exists", len(shipping_rates) >= 1, f"found {len(shipping_rates)}")
    if shipping_rates:
        sr = shipping_rates[0]
        fa = sr.get("fixed_amount") or {}
        add("shipping_rate::amount", fa.get("amount") == 2499,
            f"expected 2499, got {fa.get('amount')}")

    # --- Part C: Webhooks ---
    add("webhook_count", len(webhooks) >= 3, f"expected 3, got {len(webhooks)}")
    wh_by_url = {w.get("url", ""): w for w in webhooks}
    for ew in EXPECTED_WEBHOOKS:
        wh = wh_by_url.get(ew["url"])
        add(f"wh::{ew['url'].split('/')[-1]}::exists", wh is not None, f"webhook {ew['url']} not found")
        if wh:
            wh_events = set(wh.get("enabled_events", []) if isinstance(wh.get("enabled_events"), list) else [wh.get("enabled_events", "")])
            missing = ew["events"] - wh_events
            add(f"wh::{ew['url'].split('/')[-1]}::events", len(missing) == 0,
                f"missing events: {missing}")

    # --- Part D: Customers ---
    add("customer_count", len(customers) >= 5, f"expected >=5, got {len(customers)}")
    cust_by_name = {norm(c.get("name", "")): c for c in customers}
    for ec in EXPECTED_CUSTOMERS:
        cn = norm(ec["name"])
        cust = cust_by_name.get(cn)
        add(f"cust::{cn}::exists", cust is not None, f"'{ec['name']}' not found")
        if not cust:
            continue
        add(f"cust::{cn}::email", cust.get("email") == ec["email"],
            f"expected '{ec['email']}', got '{cust.get('email')}'")
        meta = cust.get("metadata") or {}
        meta = meta if isinstance(meta, dict) else {}
        for mk, mv in ec["meta"].items():
            add(f"cust::{cn}::meta::{mk}", str(meta.get(mk, "")) == mv,
                f"{mk}: expected '{mv}', got '{meta.get(mk)}'")

    # --- Part E: Subscriptions (per-tuple customer x product x interval) ---
    add("subscription_count", len(subscriptions) >= 8,
        f"expected 8, got {len(subscriptions)}")

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

    # --- Part F: Charges ---
    add("charge_count", len(charges) >= 4, f"expected 4, got {len(charges)}")
    cust_id_to_name_charges = {c.get("id", ""): norm(c.get("name", "")) for c in customers}
    for ec in EXPECTED_CHARGES:
        match = [ch for ch in charges
                 if ch.get("amount") == ec["amount"]
                 and norm(cust_id_to_name_charges.get(ch.get("customer", ""), "")) == norm(ec["customer_name"])]
        add(f"charge::{ec['customer_name']}::{ec['amount']}", len(match) >= 1,
            f"charge {ec['amount']} for {ec['customer_name']}: found {len(match)}")

    # --- Part G: Triggers ---
    for evt_type in ["payment_intent.succeeded", "invoice.paid", "checkout.session.completed"]:
        match = [e for e in events if e.get("type") == evt_type]
        add(f"trigger::{evt_type}", len(match) >= 1, f"trigger {evt_type} not fired")

    # --- Part H: Audit record ---
    exp_audit = expected.get("audit_customer", {})
    audit_cust = [c for c in customers if "Audit" in (c.get("name") or "") and "2026" in (c.get("name") or "")]
    add("audit_customer", len(audit_cust) >= 1, "audit customer not found")
    if audit_cust:
        meta = audit_cust[0].get("metadata") or {}
        meta = meta if isinstance(meta, dict) else {}
        exp_meta = exp_audit.get("metadata", {})
        # Keys with known expected values: compare exactly
        for key, exp_val in exp_meta.items():
            val = meta.get(key)
            add(f"audit::{key}", str(val) == str(exp_val),
                f"{key}: expected '{exp_val}', got '{val}'")
        # events_total: non-deterministic (mock creates events during agent
        # operations), so only check existence + positive integer
        val = meta.get("events_total")
        add("audit::events_total", val is not None and str(val).isdigit() and int(val) > 0,
            f"events_total: '{val}'")

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
        "schema_version": "2.0",
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "score": passed / total if total else 0,
        "reward": passed / total if total else 0,
        "passed": passed == total,
    }
    Path(path).write_text(json.dumps(reward, indent=2, ensure_ascii=False))
    print(f"stripe-billing-audit-repair: {passed}/{total} checks passed")


if __name__ == "__main__":
    main()
