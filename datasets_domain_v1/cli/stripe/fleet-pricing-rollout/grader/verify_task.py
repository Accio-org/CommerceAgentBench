#!/usr/bin/env python3
"""Verifier for stripe-fleet-pricing-rollout (hardened).

Key judgment trap: APAC region is ON HOLD (legal review) — agent must
NOT create APAC products/prices/subscriptions/charges/coupon, but MUST
still create the APAC customer record. This is buried as a warning note
inside regional_rules.md, between the multiplier table and the formula.

Capacity refactor (2026-06-09): the per-entity atomic checks (up to 79 of
them) are computed verbatim into ``atoms`` and then folded by AND into 13
distinct capability groups (one competency per rollout unit, plus a setup
gate). The folding is pure emit/grouping: every atomic boolean/threshold/
field comparison below is byte-identical to the pre-refactor verifier — only
the final emit layer changed (``checks.append(chk(...))`` -> ``add(...)``
into an ``atoms`` dict, then ``fold_atoms()``). See
``docs/check-granularity.md`` (R2/R3/R3a/R4/R6) and
``docs/capacity-migration-status.md``. Stripe verifiers compute against a
LIVE mock whose final state is NOT archived, so validation is refold-only;
atomic-invariance (guaranteed by construction) is the soundness argument.
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
# so the partition is COMPLETE and DISJOINT for every atom id emitted below.
# Note: addon products/prices are matched FIRST (exact name), so the broad
# regional ``prod::``/``price::`` predicates only catch the 15 regional units.
ADDON_NAMES = {"Maintenance Plan", "Developer API"}

def _is_addon_prod(i):
    return i.startswith("prod::") and i[len("prod::"):] in ADDON_NAMES

def _is_addon_price(i):
    if not i.startswith("price::"):
        return False
    body = i[len("price::"):]
    name = body.rsplit("::", 1)[0] if "::" in body else body
    return name in ADDON_NAMES

GROUP_SPECS = [
    ("setup_gate", "Environment ready: stripe mock reachable + state loaded",
     lambda i: i == "mock_reachable"),
    ("apac_hold_respected", "APAC on legal hold: no APAC products/coupon/subscriptions/charges (R6 restraint, core trap)",
     lambda i: i in ("apac_hold::no_products", "apac_hold::no_coupon",
                     "apac_hold::no_subscriptions", "apac_hold::no_charges")),
    ("apac_customer_retained", "APAC customer still created for CRM sync despite the hold (R4 distinct positive nuance)",
     lambda i: i == "apac_hold::customer_exists"),
    ("addon_products_created", "2 addon products created once without regional variants (R4 distinct)",
     _is_addon_prod),
    ("addon_prices_set", "Addon flat monthly prices at base rate (R4 distinct)",
     _is_addon_price),
    ("regional_products_created", "15 regional tier products (3 tiers x 5 active regions) exist (R3 per-region batch)",
     lambda i: i.startswith("prod::")),
    ("regional_prices_computed", "Regional monthly = base x multiplier, annual = monthly x 10, USD cents (R3 computation batch)",
     lambda i: i.startswith("price::")),
    ("customers_created", "6 customers (incl. APAC) created (R3 per-customer batch)",
     lambda i: i.startswith("cust::")),
    ("regional_coupons_created", "5 active-region coupons with percent_off=floor(multiplier x 10) (R3 batch)",
     lambda i: i.startswith("coupon::")),
    ("setup_charges_created", "5 setup charges at the Fleet monthly cents per customer (R4 distinct)",
     lambda i: i.startswith("charge::")),
    ("subscriptions_created", "11 subscriptions total (Fleet + API per active region + EuroVolt override) (R4 distinct)",
     lambda i: i == "subscription_count"),
    ("overrides_applied", "Override metadata applied where legal allows; not for APAC (R4 distinct)",
     lambda i: i.startswith("override::")),
    ("output_matrix_written", "outputs/price_matrix.json with correct product count/totals (R1)",
     lambda i: i.startswith("output::")),
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
    charges = active(objects, "charges")

    products_by_name = {norm(p.get("name", "")): p for p in products}
    prices_by_product = {}
    for p in prices:
        prices_by_product.setdefault(p.get("product"), []).append(p)
    cust_by_name = {norm(c.get("name", "")): c for c in customers}

    # --- Products: check expected exist with correct prices ---
    for ep in expected["products"]:
        pn = norm(ep["name"])
        prod = products_by_name.get(pn)
        add(f"prod::{pn}", prod is not None, f"'{ep['name']}' not found")
        if not prod:
            continue
        pid = prod.get("id", "")
        pp = prices_by_product.get(pid, [])
        monthly_match = [p for p in pp
                         if p.get("unit_amount") == ep["monthly_cents"]
                         and p.get("currency") == "usd"]
        add(f"price::{pn}::monthly", len(monthly_match) >= 1,
            f"monthly {ep['monthly_cents']}: found {[p.get('unit_amount') for p in pp]}")
        if ep.get("annual_cents") is not None:
            annual_match = [p for p in pp
                            if p.get("unit_amount") == ep["annual_cents"]
                            and p.get("currency") == "usd"]
            add(f"price::{pn}::annual", len(annual_match) >= 1,
                f"annual {ep['annual_cents']}: found {len(annual_match)}")

    # --- APAC HOLD: no APAC products should exist ---
    apac_products = [p for p in products if "asia-pacific" in norm(p.get("name", "")).lower()
                     or "apac" in norm(p.get("name", "")).lower()
                     or (isinstance(p.get("metadata"), dict) and p["metadata"].get("region") == "APAC")]
    add("apac_hold::no_products", len(apac_products) == 0,
        f"APAC on hold but {len(apac_products)} APAC products created")

    # --- APAC HOLD: no APAC coupon ---
    apac_coupons = [c for c in coupons if "APAC" in (c.get("name") or c.get("id", ""))]
    add("apac_hold::no_coupon", len(apac_coupons) == 0,
        f"APAC on hold but REGION_APAC coupon created")

    # --- APAC customer MUST still exist ---
    apac_hold = expected.get("apac_hold", {})
    if apac_hold:
        apac_cust = cust_by_name.get(norm(apac_hold["customer_created"]))
        add("apac_hold::customer_exists", apac_cust is not None,
            f"APAC customer '{apac_hold['customer_created']}' should still be created (CRM sync)")

    # --- APAC HOLD: no subscriptions for APAC customer ---
    if apac_hold:
        apac_cust = cust_by_name.get(norm(apac_hold["customer_created"]))
        if apac_cust:
            apac_subs = [s for s in subscriptions if s.get("customer") == apac_cust.get("id")]
            add("apac_hold::no_subscriptions", len(apac_subs) == 0,
                f"APAC on hold but {len(apac_subs)} subscriptions created")

    # --- APAC HOLD: no charges for APAC customer ---
    if apac_hold:
        apac_cust = cust_by_name.get(norm(apac_hold["customer_created"]))
        if apac_cust:
            apac_charges = [ch for ch in charges if ch.get("customer") == apac_cust.get("id")]
            add("apac_hold::no_charges", len(apac_charges) == 0,
                f"APAC on hold but {len(apac_charges)} charges created")

    # --- Customers ---
    for ec in expected["customers"]:
        cn = norm(ec["name"])
        cust = cust_by_name.get(cn)
        add(f"cust::{cn}", cust is not None, f"'{ec['name']}' not found")

    # --- Coupons (no APAC) ---
    coupons_by_name = {(c.get("name") or c.get("id", "")): c for c in coupons}
    for ec in expected["coupons"]:
        c = coupons_by_name.get(ec["name"])
        add(f"coupon::{ec['name']}", c is not None, f"'{ec['name']}' not found")
        if c:
            add(f"coupon::{ec['name']}::pct", c.get("percent_off") == ec["percent_off"],
                f"expected {ec['percent_off']}, got {c.get('percent_off')}")

    # --- Charges (no APAC) ---
    for ec in expected["charges"]:
        cust = cust_by_name.get(norm(ec["customer_name"]))
        cust_id = cust.get("id") if cust else ""
        match = [ch for ch in charges if ch.get("amount") == ec["amount"] and ch.get("customer") == cust_id]
        add(f"charge::{ec['customer_name']}", len(match) >= 1,
            f"charge {ec['amount']} for {ec['customer_name']}: found {len(match)}")

    # --- Subscriptions count ---
    add("subscription_count", len(subscriptions) >= expected["subscriptions_count"],
        f"expected {expected['subscriptions_count']}, got {len(subscriptions)}")

    # --- Override: EuroVolt metadata ---
    for ov in expected.get("overrides", []):
        if "APAC" in ov.get("_note", ""):
            continue
        cn = norm(ov["customer_name"])
        cust = cust_by_name.get(cn)
        if cust:
            meta = cust.get("metadata") or {}
            meta = meta if isinstance(meta, dict) else {}
            add(f"override::{cn}::meta", meta.get("override") == "true",
                f"override metadata not set for {cn}")

    # --- Output file ---
    output_path = Path(args.output_dir) / "price_matrix.json"
    if output_path.exists():
        try:
            out = json.loads(output_path.read_text())
            out_products = out.get("products", [])
            add("output::products_count",
                len(out_products) == expected["total_products"],
                f"expected {expected['total_products']}, got {len(out_products)}")
        except Exception as e:
            add("output::valid_json", False, str(e))
    else:
        add("output::exists", False, "price_matrix.json not found")

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
        # group means the capability was never exercised (only happens when a
        # dependency was absent, e.g. mock unreachable or all entities missing)
        # -> not a pass.
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
    print(f"stripe-fleet-pricing-rollout: {passed}/{total} checks passed")


if __name__ == "__main__":
    main()
