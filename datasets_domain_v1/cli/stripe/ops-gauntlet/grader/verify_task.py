#!/usr/bin/env python3
"""Verifier for stripe-ops-gauntlet (QA sprint setup — business-oriented).

Tests CLI proficiency: agent receives business requirements and must
map them to correct Stripe resources and CLI commands without being told
what to create or which flags to use.

Capacity refactor (2026-06-09): the per-resource atomic checks (56 of them)
are computed verbatim into ``atoms`` and then folded by AND into 13 distinct
capability groups (one competency per distinct Stripe operation chained by the
gauntlet, plus a setup gate). The folding is pure emit/grouping: every atomic
boolean/threshold/field comparison below is byte-identical to the pre-refactor
verifier — only the final emit layer changed (``checks.append(chk(...))`` ->
``add(...)`` into an ordered ``atoms`` dict + ``fold_atoms()``). No predicate,
threshold, field name, string, or conditional skip was altered. See
``docs/check-granularity.md`` (R2/R3/R4/R6) and
``docs/capacity-migration-status.md``.
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
# so the partition is complete and disjoint for every atom id produced below.
# The gauntlet chains many genuinely distinct Stripe ops (R4): products,
# prices, the price-correction read, three restraint judgments (no-annual /
# blocked-product / preserve-legacy = R6 negatives), customers, two distinct
# webhook event-mapping ops, subscription restraint, coupons, sprint tagging,
# and the output artifact.
GROUP_SPECS = [
    ("setup_gate", "Environment ready: stripe mock reachable + state loaded",
     lambda i: i == "mock_reachable"),
    ("products_created", "All 5 products created with descriptions (R3 per-product batch)",
     lambda i: i.startswith("prod::")),
    ("prices_correct", "Monthly/annual/one-time prices at correct amounts incl. $59.99 correction (R3 per-price + correction read)",
     lambda i: i.startswith("price::") or i == "trap::price_not_4999"),
    ("no_annual_addons", "Add-on/one-time products have NO annual price (R6 restraint)",
     lambda i: i.startswith("trap::no_annual::")),
    ("blocked_products_respected", "JIRA-4521-blocked refund products NOT created (R6 restraint)",
     lambda i: i.startswith("trap::blocked::")),
    ("legacy_data_preserved", "TechCorp customer + deprecated product left untouched (R6 restraint)",
     lambda i: i.startswith("trap::preserve_")),
    ("customers_created", "All 4 testers created incl. Refund Test User despite blocked products (R3 per-customer)",
     lambda i: i.startswith("cust::") or i == "trap::refund_user_exists"),
    ("webhook_payment_events", "Payment webhook maps correct events + drops charge.failed (R4 distinct op)",
     lambda i: i.startswith("wh::payment") or i == "trap::wh::payment::no_charge.failed"),
    ("webhook_lifecycle_events", "Lifecycle webhook maps customer.* + invoice.created (R4 distinct op)",
     lambda i: i.startswith("wh::lifecycle")),
    ("subscriptions_correct", "Exactly A+C subscribed, User B pristine, count==2 (R4 distinct restraint)",
     lambda i: i == "sub_count" or i == "trap::user_b_no_subs" or i.startswith("sub::")),
    ("coupons_correct", "Free-trial 100% coupon + QA_PARTIAL_25 at 20% correction (R4/R3 coupon op)",
     lambda i: i.startswith("coupon::") or i == "trap::coupon_not_25"),
    ("sprint_tags_applied", "Every product tagged payment-q3 (R3 per-product metadata batch)",
     lambda i: i.startswith("tag::")),
    ("output_summary_written", "setup_summary.json artifact written (R1 output)",
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
    # Canceled subscriptions are excluded: the runtime has no delete op for
    # subscriptions (`subscriptions cancel` leaves status=canceled), and real
    # Stripe list views exclude canceled by default.
    subscriptions = [
        s for s in active(objects, "subscriptions")
        if s.get("status") != "canceled"
    ]
    coupons = active(objects, "coupons")
    webhooks = active(objects, "webhook_endpoints")

    products_by_name = {norm(p.get("name", "")): p for p in products}
    prices_by_product = {}
    for p in prices:
        prices_by_product.setdefault(p.get("product"), []).append(p)
    cust_by_name = {norm(c.get("name", "")): c for c in customers}

    # === Products exist with correct prices ===
    for ep in expected["products"]:
        pn = norm(ep["name"])
        prod = products_by_name.get(pn)
        add(f"prod::{pn}", prod is not None, f"'{ep['name']}' not found")
        if not prod:
            continue

        if ep.get("has_description"):
            desc = prod.get("description") or ""
            add(f"prod::{pn}::description", len(desc.strip()) > 0,
                "product needs a description per Sarah's email")

        pid = prod.get("id", "")
        pp = prices_by_product.get(pid, [])

        if ep.get("monthly_cents") is not None:
            match = [p for p in pp if p.get("unit_amount") == ep["monthly_cents"]
                     and (p.get("recurring") or {}).get("interval") == "month"]
            add(f"price::{pn}::monthly", len(match) >= 1,
                f"monthly {ep['monthly_cents']}: found {[p.get('unit_amount') for p in pp]}")

        if ep.get("one_time_cents") is not None:
            match = [p for p in pp if p.get("unit_amount") == ep["one_time_cents"]
                     and not p.get("recurring")]
            add(f"price::{pn}::one_time", len(match) >= 1,
                f"one_time {ep['one_time_cents']}: found {len(match)}")

        if ep.get("annual_cents") is not None:
            annual = [p for p in pp if p.get("unit_amount") == ep["annual_cents"]
                      and (p.get("recurring") or {}).get("interval") == "year"]
            add(f"price::{pn}::annual", len(annual) >= 1,
                f"annual {ep['annual_cents']}: found {len(annual)}")

        if ep.get("annual_cents") is None:
            annual = [p for p in pp if (p.get("recurring") or {}).get("interval") == "year"]
            add(f"trap::no_annual::{pn}", len(annual) == 0,
                f"no annual billing for this product, found {len(annual)}")

    # === Price correction: Analytics at $59.99 not $49.99 ===
    analytics = products_by_name.get(norm("Pro Analytics Dashboard"))
    if analytics:
        pp = prices_by_product.get(analytics.get("id", ""), [])
        wrong = [p for p in pp if p.get("unit_amount") == 4999
                 and (p.get("recurring") or {}).get("interval") == "month"]
        add("trap::price_not_4999", len(wrong) == 0,
            "Sarah corrected to $59.99, should not have $49.99 price")

    # === Blocked products must NOT exist ===
    for bn in expected["blocked_products"]:
        add(f"trap::blocked::{norm(bn)}",
            products_by_name.get(norm(bn)) is None,
            f"'{bn}' blocked on JIRA-4521, should not be created")

    # === Preserved legacy data ===
    preserved = expected.get("preserved", {})
    if preserved.get("techcorp_customer"):
        add("trap::preserve_techcorp",
            cust_by_name.get(norm(preserved["techcorp_customer"])) is not None,
            "TechCorp customer should not be deleted")
    if preserved.get("deprecated_product"):
        add("trap::preserve_deprecated",
            products_by_name.get(norm(preserved["deprecated_product"])) is not None,
            "deprecated product should be left alone")

    # === Customers ===
    for ec in expected["customers"]:
        cn = norm(ec["name"])
        cust = cust_by_name.get(cn)
        add(f"cust::{cn}", cust is not None, f"'{ec['name']}' not found")

    add("trap::refund_user_exists",
        cust_by_name.get(norm("Refund Test User")) is not None,
        "refund test user needed even though refund products are blocked")

    # === Webhooks — agent must map business descriptions to Stripe events ===
    for wh_key, wh_spec in expected["webhooks"].items():
        wh_url = wh_spec["url"]
        slug = wh_key
        match = [w for w in webhooks if w.get("url") == wh_url]
        add(f"wh::{slug}", len(match) >= 1, f"webhook {wh_url} not found")
        if match:
            got = match[0].get("enabled_events") or []
            if isinstance(got, str):
                got = [got]
            for evt in wh_spec.get("required_events", []):
                add(f"wh::{slug}::has_{evt}", evt in got,
                    f"missing event: {evt}")
            for evt in wh_spec.get("excluded_events", []):
                add(f"trap::wh::{slug}::no_{evt}", evt not in got,
                    f"'{evt}' should be excluded per Sarah's correction")

    # === Subscriptions ===
    user_b = cust_by_name.get(norm("Sprint Test User B"))
    if user_b:
        b_subs = [s for s in subscriptions if s.get("customer") == user_b.get("id")]
        add("trap::user_b_no_subs", len(b_subs) == 0,
            f"User B needs clean state, found {len(b_subs)} subscriptions")

    add("sub_count",
        len(subscriptions) == expected["subscriptions"]["count"],
        f"expected {expected['subscriptions']['count']}, got {len(subscriptions)}")

    for un in expected["subscriptions"]["users_with_subs"]:
        cust = cust_by_name.get(norm(un))
        if cust:
            user_subs = [s for s in subscriptions if s.get("customer") == cust.get("id")]
            add(f"sub::{norm(un)}", len(user_subs) >= 1,
                f"'{un}' should have a subscription")

    # === Coupons ===
    all_coupons = {(c.get("name") or c.get("id", "")): c for c in coupons}

    # Free trial coupon: 100% off, once
    free_coupons = [c for c in coupons if c.get("percent_off") == 100]
    add("coupon::free_trial", len(free_coupons) >= 1,
        "need a 100% off coupon for free trial testing")

    # QA_PARTIAL_25: 20% off (corrected from 25%)
    partial = all_coupons.get("QA_PARTIAL_25")
    add("coupon::QA_PARTIAL_25", partial is not None,
        "QA_PARTIAL_25 coupon not found")
    if partial:
        add("coupon::QA_PARTIAL_25::pct",
            partial.get("percent_off") == 20,
            f"should be 20% per Sarah, got {partial.get('percent_off')}%")
        add("trap::coupon_not_25",
            partial.get("percent_off") != 25,
            "Sarah changed from 25% to 20%")

    # === Sprint tag ===
    for ep in expected["products"]:
        prod = products_by_name.get(norm(ep["name"]))
        if prod:
            meta = prod.get("metadata") or {}
            meta = meta if isinstance(meta, dict) else {}
            has_sprint = any(v == "payment-q3" for v in meta.values())
            add(f"tag::{norm(ep['name'])}::sprint", has_sprint,
                f"should be tagged with payment-q3, metadata: {meta}")

    # === Output file ===
    output_path = Path(args.output_dir) / "setup_summary.json"
    if output_path.exists():
        add("output::exists", True)
    else:
        add("output::exists", False, "setup_summary.json not found")

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
    print(f"stripe-ops-gauntlet: {passed}/{total} checks passed")


if __name__ == "__main__":
    main()
