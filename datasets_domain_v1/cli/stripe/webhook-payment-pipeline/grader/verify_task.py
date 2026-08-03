#!/usr/bin/env python3
"""Verifier for stripe-webhook-payment-pipeline (hardened).

Judgment traps:
  - finance webhook must include charge.failed (v2.1 update buried in prose)
  - tax rate + shipping rate from section 4 (easy to skip as "not pipeline")
  - report format not specified (agent must infer key names)

Capacity refactor (2026-06-09): the per-resource atomic checks are computed
verbatim into ``atoms`` and then folded by AND into 8 distinct capability
groups (one competency per pipeline stage: setup gate, webhook configuration,
test-customer creation, charge+refund execution, trigger firing, tax-rate
config, shipping-rate config, and the pipeline-report deliverable). The folding
is pure emit/grouping: every atomic boolean/threshold/field comparison below is
byte-identical to the pre-refactor verifier — only the final emit layer changed
(``checks.append(chk(...))`` became ``add(...)`` into an ordered ``atoms`` dict,
plus ``fold_atoms()``). No predicate, threshold, field, string, or
conditional-skip was altered. Stripe verifiers compute against a LIVE mock and
the final state is NOT archived, so this fold was validated REFOLD-ONLY (re-fold
the archived atomic breakdown of 9 release models by AND; 0 binary mismatch).
See ``docs/check-granularity.md`` (R2/R3/R4) and
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


# --- Capability fold (emit/grouping layer only; atom computations unchanged) ---
# Ordered list of (group_id, capability description, predicate(atom_id)->bool).
# Predicates are evaluated in order; the FIRST matching group claims the atom,
# so the partition is complete and disjoint for every atom id emitted below.
GROUP_SPECS = [
    ("setup_gate", "Environment ready: stripe mock reachable + state loaded",
     lambda i: i == "mock_reachable"),
    ("webhooks_configured",
     "3 webhook endpoints with correct URLs + enabled events, incl. the buried "
     "v2.1 charge.failed on finance (R4 distinct + R3 per-endpoint batch)",
     lambda i: i.startswith("wh::") or i.startswith("wh_events::") or i == "v21_charge_failed"),
    ("test_customer_created",
     "Integration test customer with correct name/email/metadata (R3 same-skill batch)",
     lambda i: i == "test_customer" or i == "tc_email" or i.startswith("tc_meta::")),
    ("charge_refund_executed",
     "Scenario A direct charge ($75) + partial refund ($25) executed (R4 distinct)",
     lambda i: i in ("charge_a", "refund_a")),
    ("triggers_fired",
     "Pipeline triggers fired (payment_intent.succeeded / checkout.session.completed / invoice.paid) (R4 distinct)",
     lambda i: i.startswith("trigger::")),
    ("tax_rate_configured",
     "US sales tax rate created at correct percentage (R4 distinct resource)",
     lambda i: i.startswith("tax_rate")),
    ("shipping_rate_configured",
     "Standard US shipping rate created at correct fixed amount (R4 distinct resource)",
     lambda i: i.startswith("shipping_rate")),
    ("pipeline_report_written",
     "outputs/pipeline_report.json deliverable parses + contains key pipeline figures (R4 distinct)",
     lambda i: i.startswith("report_")),
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
    except Exception:
        state = {}

    objects = state.get("objects", []) if isinstance(state, dict) else []
    add("mock_reachable", bool(objects), "no objects")

    active = lambda res: [o["data"] for o in objects if o.get("resource") == res and not o.get("deleted")]

    # --- Webhooks (including v2.1 charge.failed on finance) ---
    webhooks = active("webhook_endpoints")
    for ew in expected["webhooks"]:
        slug = ew["url"].split("/")[-1]
        match = [w for w in webhooks if w.get("url") == ew["url"]]
        add(f"wh::{slug}", len(match) >= 1, f"webhook {ew['url']} not found")
        if match:
            got_events = match[0].get("enabled_events") or []
            if isinstance(got_events, str):
                got_events = [got_events]
            got_set = set(got_events)
            want_set = set(ew["events"])
            missing = want_set - got_set
            add(f"wh_events::{slug}", len(missing) == 0,
                f"missing events: {missing}")
            if slug == "finance" and "charge.failed" in want_set:
                add("v21_charge_failed",
                    "charge.failed" in got_set,
                    "v2.1 update requires charge.failed on finance webhook")

    # --- Test customer ---
    customers = active("customers")
    etc = expected["test_customer"]
    tc = [c for c in customers if norm(c.get("name", "")) == norm(etc["name"])]
    add("test_customer", len(tc) >= 1, f"'{etc['name']}' not found")
    if tc:
        add("tc_email", tc[0].get("email") == etc["email"],
            f"expected {etc['email']}, got {tc[0].get('email')}")
        meta = tc[0].get("metadata") or {}
        meta = meta if isinstance(meta, dict) else {}
        for mk, mv in etc.get("metadata", {}).items():
            add(f"tc_meta::{mk}", str(meta.get(mk, "")) == mv,
                f"{mk}: expected {mv}, got {meta.get(mk)}")

    # --- Scenario A: charge + partial refund ---
    charges = active("charges")
    sa = expected["scenario_a"]
    matching_charges = [c for c in charges if c.get("amount") == sa["charge_amount"]]
    add("charge_a", len(matching_charges) >= 1,
        f"charge {sa['charge_amount']} not found")
    refunds = active("refunds")
    matching_refunds = [r for r in refunds if r.get("amount") == sa["refund_amount"]]
    add("refund_a", len(matching_refunds) >= 1,
        f"partial refund {sa['refund_amount']} not found")

    # --- Triggers ---
    events = active("events")
    event_types = {e.get("type") for e in events}
    for trig in expected["triggers"]:
        add(f"trigger::{trig}", trig in event_types,
            f"trigger {trig} not fired")

    # --- Tax rate (section 4) ---
    tax_rates = active("tax_rates")
    add("tax_rate_exists", len(tax_rates) >= 1, f"found {len(tax_rates)}")
    if tax_rates:
        pct = tax_rates[0].get("percentage", 0)
        try:
            pct = float(pct)
        except (ValueError, TypeError):
            pct = 0
        add("tax_rate_pct", abs(pct - expected["tax_rate_percentage"]) < 0.01,
            f"expected {expected['tax_rate_percentage']}, got {pct}")

    # --- Shipping rate (section 4) ---
    shipping_rates = active("shipping_rates")
    add("shipping_rate_exists", len(shipping_rates) >= 1, f"found {len(shipping_rates)}")
    if shipping_rates:
        fa = shipping_rates[0].get("fixed_amount") or {}
        add("shipping_rate_amount", fa.get("amount") == expected["shipping_rate_amount"],
            f"expected {expected['shipping_rate_amount']}, got {fa.get('amount')}")

    # --- Pipeline report (format not specified — just check it exists and has key info) ---
    output_dir = Path(args.output_dir)
    report_path = output_dir / "pipeline_report.json"
    if report_path.exists():
        try:
            report = json.loads(report_path.read_text())
            add("report_valid", True, "report parsed")
            has_wh = any(v == 3 for v in report.values() if isinstance(v, int))
            has_refund = any(v == 2500 for v in report.values() if isinstance(v, int))
            add("report_content", has_wh or has_refund,
                "report should contain webhook count or refund amount")
        except Exception as e:
            add("report_valid", False, str(e))
    else:
        add("report_exists", False, "pipeline_report.json not found")

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
    print(f"stripe-webhook-payment-pipeline: {passed}/{total} checks passed")


if __name__ == "__main__":
    main()
