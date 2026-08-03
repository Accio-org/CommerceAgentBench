#!/usr/bin/env python3
"""Final-state verifier for cli-xfer-invoice-followup-task-queue.

  - stripe_cli  : MOCK_SITE_URL_STRIPE_CLI/__bench/state  (source, read-only)
  - todoist_cli : MOCK_SITE_URL_TODOIST_CLI/__bench/state (deliverable)

The verifier checks the completed business state, not the command path used by
the agent. It recomputes the invoice set from Stripe and accepts reasonable
wording differences in Todoist text while requiring source-bound IDs, amounts,
dates, priorities, labels, and project scoping.
"""
import argparse
import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


CHECK_IDS = (
    "setup_gate",
    "inclusion_set_correct",
    "section_graph_correct",
    "priority_correct",
    "content_trace_correct",
    "labels_correct",
    "acknowledgements_correct",
    "project_scope_correct",
    "handoff_summary_correct",
    "content_cross_system_markers_correct",
    "industry_labels_correct",
    "source_integrity",
)


def _norm(v: Any) -> str:
    return " ".join(str(v or "").strip().casefold().split())


def _fetch(url: str, token: str) -> Any:
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _read_state(env: str, token: str) -> tuple[dict[str, Any], str]:
    base = os.environ.get(env, "").rstrip("/")
    if not base:
        return {}, f"{env} not set"
    if not token:
        return {}, "MOCK_VERIFIER_TOKEN not set"
    try:
        return _fetch(f"{base}/__bench/state", token), ""
    except Exception as e:
        return {}, str(e)


def chk(cid: str, ok: bool, reason: str = "") -> dict[str, Any]:
    return {"id": cid, "passed": bool(ok), "reason": str(reason)[:700], "check_type": "deterministic_exact"}


def _objects(stripe: dict[str, Any], resource: str) -> list[dict[str, Any]]:
    return [o for o in stripe.get("objects", []) if o.get("resource") == resource]


def _data_objects(stripe: dict[str, Any], resource: str) -> list[dict[str, Any]]:
    return [o.get("data") or {} for o in _objects(stripe, resource)]


def _object_map(stripe: dict[str, Any], resource: str) -> dict[str, dict[str, Any]]:
    out = {}
    for o in _objects(stripe, resource):
        data = o.get("data") or {}
        oid = o.get("id") or data.get("id")
        if oid:
            out[oid] = data
    return out


def _stripe_invoices(stripe: dict[str, Any]) -> list[dict[str, Any]]:
    return _data_objects(stripe, "invoices")


def _stripe_customers(stripe: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return _object_map(stripe, "customers")


def _stripe_subscriptions(stripe: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return _object_map(stripe, "subscriptions")


def _stripe_prices_or_plans(stripe: dict[str, Any]) -> dict[str, dict[str, Any]]:
    prices = _object_map(stripe, "prices")
    prices.update(_object_map(stripe, "plans"))
    return prices


def _stripe_webhook_endpoints(stripe: dict[str, Any]) -> set[str]:
    return {
        str((o.get("data") or {}).get("url"))
        for o in _objects(stripe, "webhook_endpoints")
        if (o.get("data") or {}).get("url")
    }


def _expected_due_date(inv: dict[str, Any]) -> str | None:
    due = inv.get("due_date")
    if due:
        if isinstance(due, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
            return due
        try:
            return datetime.fromtimestamp(int(due), tz=timezone.utc).date().isoformat()
        except (TypeError, ValueError, OSError):
            return None
    try:
        created = datetime.fromtimestamp(int(inv.get("created")), tz=timezone.utc).date()
    except (TypeError, ValueError, OSError):
        return None
    return (created + timedelta(days=30)).isoformat()


def _stripe_invoice_trace(stripe: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    customers = _stripe_customers(stripe)
    for inv in _stripe_invoices(stripe):
        cust_id = inv.get("customer")
        cust = customers.get(cust_id, {})
        if (
            _norm(cust.get("name")) == _norm(spec["customer"])
            and inv.get("status") == "open"
            and int(inv.get("amount_due") or 0) == int(spec["amount_due"])
        ):
            return {
                "invoice": inv,
                "customer": cust,
                "invoice_id": inv.get("id"),
                "customer_id": cust_id,
                "due_date": _expected_due_date(inv),
            }
    return {"invoice": {}, "customer": {}, "invoice_id": None, "customer_id": None, "due_date": None}


def _item_text(item: dict[str, Any]) -> str:
    labels = " ".join(str(l) for l in (item.get("labels") or []))
    return " ".join(str(item.get(k) or "") for k in ("content", "description")) + " " + labels


def _contains_amount(text: str, amount: int) -> bool:
    if str(amount) in text:
        return True
    for m in re.findall(r"(?<![A-Za-z0-9])\$?(\d[\d,]*)(?:\.00)?(?![A-Za-z0-9])", text):
        try:
            if int(m.replace(",", "")) == int(amount):
                return True
        except ValueError:
            pass
    return False


def _slug_tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", _norm(value).replace("_", "-")))


def _label_has_terms(labels: list[Any] | set[Any], terms: list[str] | set[str]) -> bool:
    nlabels = [_norm(label) for label in labels]
    return any(any(_norm(term) in label for term in terms) for label in nlabels)


def _industry_label_matches(label: Any, expected_label: str) -> bool:
    expected_tokens = _slug_tokens(expected_label.removeprefix("from-"))
    label_tokens = _slug_tokens(str(label).removeprefix("from-").removeprefix("industry-"))
    return bool(expected_tokens) and expected_tokens <= label_tokens


def _user_to_api_priority(priority: int) -> int:
    return 5 - int(priority)


def _section_role(section_name: str, exp: dict[str, Any]) -> str | None:
    n = _norm(section_name)
    sections = exp.get("sections", {})
    exact = {
        _norm(sections.get("tier_a")): "tier_a",
        _norm(sections.get("standard")): "standard",
        _norm(sections.get("ack")): "ack",
    }
    if n in exact:
        return exact[n]
    if any(k in n for k in ("ack", "acknowledg", "completed", "confirmed", "receipt")):
        return "ack"
    if any(k in n for k in ("tier a", "immediate", "urgent", "call")):
        return "tier_a"
    if any(k in n for k in ("tier b", "tier c", "standard", "follow", "routine")):
        return "standard"
    return None


def _matches_customer_item(text: str, spec: dict[str, Any], trace: dict[str, Any]) -> bool:
    needles = [trace.get("invoice_id"), trace.get("customer_id"), spec.get("customer")]
    return any(n and str(n) in text for n in needles)


def _is_ack_item(item: dict[str, Any], role_by_section: dict[str, str | None]) -> bool:
    text = _norm(_item_text(item))
    role = role_by_section.get(str(item.get("section_id") or ""))
    return role == "ack" or any(k in text for k in ("ack", "acknowledg", "confirmed", "receipt"))


def _is_handoff_item(
    item: dict[str, Any],
    exp: dict[str, Any],
    stripe: dict[str, Any],
    in_scope: list[dict[str, Any]],
    trace_by_customer: dict[str, dict[str, Any]],
) -> bool:
    if not item.get("is_completed"):
        return False
    text = _item_text(item)
    ntext = _norm(text)
    keywords = exp.get("handoff_summary", {}).get("keywords", [])
    keyword_hit = any(k in ntext for k in keywords)
    roster_hits = 0
    for spec in in_scope:
        trace = trace_by_customer.get(spec["customer"], {})
        if (trace.get("customer_id") and trace["customer_id"] in text) or spec["customer"] in text:
            roster_hits += 1
    webhook_hit = any(url and url in text for url in _stripe_webhook_endpoints(stripe))
    context_terms = sum(1 for term in ("balance", "reviewer", "source", "brief", "standup") if term in ntext)
    return keyword_hit and roster_hits >= len(in_scope) and webhook_hit and context_terms >= 3


def _subscription_customer_map(stripe: dict[str, Any]) -> dict[str, str]:
    out = {}
    for sid, sub in _stripe_subscriptions(stripe).items():
        cust = sub.get("customer")
        if cust:
            out[sid] = str(cust)
    return out


def _price_matches_invoice(price: dict[str, Any], invoice: dict[str, Any]) -> bool:
    desc = _norm(invoice.get("description"))
    if not desc:
        return False
    label = _norm(" ".join(str(price.get(k) or "") for k in ("nickname", "lookup_key", "product", "description")))
    stop = {"plan", "monthly", "annual", "usd", "price", "basic", "pro"}
    # Keep Basic/Pro as useful plan tokens while ignoring generic billing words.
    tokens = [t for t in re.findall(r"[a-z0-9]+", label) if len(t) >= 3 and t not in (stop - {"basic", "pro"})]
    return any(t in desc for t in tokens)


def _valid_plan_ids_for_invoice(stripe: dict[str, Any], invoice: dict[str, Any]) -> set[str]:
    prices = _stripe_prices_or_plans(stripe)
    matched = {pid for pid, price in prices.items() if _price_matches_invoice(price, invoice)}
    return matched or set(prices)


def _tokens_for_item(item: dict[str, Any]) -> tuple[set[str], set[str]]:
    text = _item_text(item)
    subs = set(re.findall(r"\bsub_[A-Za-z0-9_]+\b", text))
    plans = set(re.findall(r"\b(?:price|plan)_[A-Za-z0-9_]+\b", text))
    return subs, plans


def evaluate(exp: dict[str, Any], stripe: dict[str, Any], todoist: dict[str, Any], se: str, te: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    proj_name = exp["project_name"]

    proj_found = None
    if not te:
        for p in todoist.get("projects", []):
            if _norm(p.get("name")) == _norm(proj_name) and not p.get("is_deleted"):
                proj_found = p
                break
    sections = []
    section_by_name = {}
    role_by_section: dict[str, str | None] = {}
    if proj_found is not None:
        sections = [
            s for s in todoist.get("sections", [])
            if s.get("project_id") == proj_found.get("id") and not s.get("is_deleted") and not s.get("is_archived")
        ]
        section_by_name = {_norm(s.get("name")): s for s in sections}
        role_by_section = {str(s.get("id")): _section_role(str(s.get("name") or ""), exp) for s in sections}
    roles = set(r for r in role_by_section.values() if r)
    # Seeded personal Todoist tasks (todoist_cli seeds 2500000001-2500000006)
    # must survive; destructive cleanup of pre-existing user data fails the gate.
    seed_missing: list[str] = []
    if not te:
        _live_ids = {str(i.get("id")) for i in todoist.get("items", []) if not i.get("is_deleted")}
        seed_missing = [str(s) for s in range(2500000001, 2500000007) if str(s) not in _live_ids]

    setup_ok = (not se) and (not te) and (proj_found is not None) and {"tier_a", "standard", "ack"} <= roles and not seed_missing
    setup_reason = (
        se or te
        or ("" if proj_found else f"todoist project {proj_name!r} missing")
        or ("" if {"tier_a", "standard", "ack"} <= roles else f"section roles={sorted(roles)} sections={sorted(section_by_name)}")
        or ("" if not seed_missing else f"seeded personal tasks deleted: {seed_missing}")
        or "ok"
    )
    checks.append(chk("setup_gate", setup_ok, setup_reason))
    if not setup_ok:
        for cid in CHECK_IDS[1:]:
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    proj_id = proj_found.get("id")
    items = todoist.get("items", [])
    proj_items = [i for i in items if i.get("project_id") == proj_id and not i.get("is_deleted")]
    in_scope = exp["in_scope"]
    expected_customers = {s["customer"] for s in in_scope}
    trace_by_customer = {s["customer"]: _stripe_invoice_trace(stripe, s) for s in in_scope}
    missing_trace = [cust for cust, tr in trace_by_customer.items() if not tr.get("invoice_id") or not tr.get("customer_id")]
    if missing_trace:
        checks.append(chk("inclusion_set_correct", False, f"missing source invoice trace for {missing_trace}"))
        for cid in CHECK_IDS[2:]:
            checks.append(chk(cid, False, "source trace failed"))
        return checks

    handoff_items = [
        i for i in proj_items
        if _is_handoff_item(i, exp, stripe, in_scope, trace_by_customer)
    ]
    customer_items = [i for i in proj_items if i not in handoff_items]
    item_by_customer: dict[str, list[dict[str, Any]]] = {}
    ack_by_customer: dict[str, list[dict[str, Any]]] = {}
    extras = []

    for item in customer_items:
        text = _item_text(item)
        matched = [
            spec["customer"] for spec in in_scope
            if _matches_customer_item(text, spec, trace_by_customer[spec["customer"]])
        ]
        if len(matched) != 1:
            extras.append(str(item.get("content") or "")[:100])
            continue
        cust = matched[0]
        if item.get("is_completed"):
            if _is_ack_item(item, role_by_section):
                ack_by_customer.setdefault(cust, []).append(item)
            else:
                extras.append(str(item.get("content") or "")[:100])
        else:
            item_by_customer.setdefault(cust, []).append(item)

    # Inclusion set: exactly one active follow-up per in-scope customer and no
    # out-of-scope invoice/customer records in the collections project.
    missing = expected_customers - set(item_by_customer)
    dups = sorted(k for k, vals in item_by_customer.items() if len(vals) != 1)
    out_scope_hits = []
    in_scope_invoice_ids = {tr["invoice_id"] for tr in trace_by_customer.values()}
    in_scope_customer_ids = {tr["customer_id"] for tr in trace_by_customer.values()}
    customers = _stripe_customers(stripe)
    for inv in _stripe_invoices(stripe):
        inv_id = inv.get("id")
        cust_id = inv.get("customer")
        cust = customers.get(cust_id, {})
        if inv_id in in_scope_invoice_ids:
            continue
        for item in customer_items:
            text = _item_text(item)
            content_only = str(item.get("content") or "")
            if inv_id and inv_id in content_only:
                out_scope_hits.append(f"out-of-scope invoice {inv_id} in {item.get('content')!r}")
            elif cust_id not in in_scope_customer_ids and cust.get("name") and cust["name"] in text:
                out_scope_hits.append(f"out-of-scope customer {cust.get('name')} in {item.get('content')!r}")
    inc_ok = not missing and not dups and not out_scope_hits
    checks.append(chk(
        "inclusion_set_correct",
        inc_ok,
        f"missing={sorted(missing)} dups={dups} out_scope={out_scope_hits[:3]}" if not inc_ok else "ok",
    ))

    # Section graph: active tasks route by tier role.
    sec_fail = []
    for spec in in_scope:
        item = (item_by_customer.get(spec["customer"]) or [None])[0]
        if not item:
            sec_fail.append(f"{spec['customer']} (no active task)")
            continue
        want_role = "tier_a" if spec["tier"] == "Tier A" else "standard"
        got_role = role_by_section.get(str(item.get("section_id") or ""))
        if got_role != want_role:
            sec_fail.append(f"{spec['customer']}: section role={got_role} want={want_role}")
    checks.append(chk("section_graph_correct", not sec_fail, "; ".join(sec_fail) if sec_fail else "ok"))

    # Priority: Todoist stores API priority where 4=urgent..1=normal.
    p_fail = []
    for spec in in_scope:
        item = (item_by_customer.get(spec["customer"]) or [None])[0]
        if not item:
            p_fail.append(f"{spec['customer']} (no active task)")
            continue
        want_api = _user_to_api_priority(spec["priority"])
        if item.get("priority") != want_api:
            p_fail.append(f"{spec['customer']}: api_priority={item.get('priority')} want={want_api}")
    checks.append(chk("priority_correct", not p_fail, "; ".join(p_fail) if p_fail else "ok"))

    # Content trace: accept wording differences, require source-derived facts.
    c_fail = []
    for spec in in_scope:
        item = (item_by_customer.get(spec["customer"]) or [None])[0]
        if not item:
            c_fail.append(f"{spec['customer']} (no active task)")
            continue
        text = _item_text(item)
        ntext = _norm(text)
        trace = trace_by_customer[spec["customer"]]
        missing_parts = []
        if _norm(spec["tier"]) not in ntext:
            missing_parts.append(spec["tier"])
        if spec["customer"] not in text and trace["customer_id"] not in text:
            missing_parts.append(spec["customer"])
        if not _contains_amount(text, int(spec["amount_due"])):
            missing_parts.append(f"amount {spec['amount_due']}")
        for part in (spec["owner"], trace["invoice_id"], trace["customer_id"]):
            if part and str(part) not in text:
                missing_parts.append(str(part))
        if missing_parts:
            c_fail.append(f"{spec['customer']}: missing {missing_parts}")
        if exp.get("due_date_required"):
            want_due = trace.get("due_date")
            got_due = str(item.get("due_date") or item.get("dueString") or item.get("due_string") or "")
            if not want_due:
                c_fail.append(f"{spec['customer']}: source invoice lacks computable due date")
            elif got_due != want_due:
                c_fail.append(f"{spec['customer']}: due_date={got_due!r} expected {want_due!r}")
    checks.append(chk("content_trace_correct", not c_fail, "; ".join(c_fail[:8]) if c_fail else "ok"))

    # Labels: required business labels must be present; avoid wrong tier labels.
    l_fail = []
    tier_labels = {"tier-a", "tier-b", "tier-c"}
    for spec in in_scope:
        item = (item_by_customer.get(spec["customer"]) or [None])[0]
        if not item:
            l_fail.append(f"{spec['customer']} (no active task)")
            continue
        labels = set(item.get("labels") or [])
        missing_labels = []
        if not _label_has_terms(labels, exp.get("invoice_label_terms", ["invoice"])):
            missing_labels.append("invoice/collections label")
        if spec["tier_label"] not in labels:
            missing_labels.append(spec["tier_label"])
        expected_industry = exp["industry_labels"].get(spec["customer"], "")
        if not any(_industry_label_matches(label, expected_industry) for label in labels):
            missing_labels.append(f"industry label matching {expected_industry}")
        wrong_tier = sorted((labels & tier_labels) - {spec["tier_label"]})
        if missing_labels or wrong_tier:
            l_fail.append(f"{spec['customer']}: missing={missing_labels} wrong_tier={wrong_tier} labels={sorted(labels)}")
    checks.append(chk("labels_correct", not l_fail, "; ".join(l_fail[:8]) if l_fail else "ok"))

    # Completed acknowledgements for Tier A only.
    ack_fail = []
    ack_tiers = set(exp.get("ack_tiers", []))
    ack_expected = [s for s in in_scope if s["tier"] in ack_tiers]
    ack_expected_customers = {s["customer"] for s in ack_expected}
    for spec in ack_expected:
        ack = (ack_by_customer.get(spec["customer"]) or [None])[0]
        if not ack:
            ack_fail.append(f"{spec['customer']}: no completed acknowledgement")
            continue
        text = _item_text(ack)
        trace = trace_by_customer[spec["customer"]]
        missing_parts = []
        if not _contains_amount(text, int(spec["amount_due"])):
            missing_parts.append(f"amount {spec['amount_due']}")
        for part in (spec["customer"], spec["owner"], trace["invoice_id"], trace["customer_id"]):
            if part and str(part) not in text:
                missing_parts.append(str(part))
        if missing_parts:
            ack_fail.append(f"{spec['customer']}: ack missing {missing_parts}")
        if not ack.get("is_completed"):
            ack_fail.append(f"{spec['customer']}: ack not completed")
        if role_by_section.get(str(ack.get("section_id") or "")) != "ack":
            ack_fail.append(f"{spec['customer']}: ack not in acknowledgement section")
        labels = set(ack.get("labels") or [])
        if "tier-a" not in labels or not (_label_has_terms(labels, exp.get("invoice_label_terms", ["invoice"])) or _label_has_terms(labels, ["acknowledgement", "ack"])):
            ack_fail.append(f"{spec['customer']}: ack labels={sorted(labels)}")
    wrong_ack = sorted(set(ack_by_customer) - ack_expected_customers)
    ack_dups = sorted(c for c, vals in ack_by_customer.items() if len(vals) != 1)
    if wrong_ack:
        ack_fail.append(f"unexpected ack customers {wrong_ack}")
    if ack_dups:
        ack_fail.append(f"duplicate ack customers {ack_dups}")
    if extras:
        ack_fail.append(f"unexpected project items {extras[:5]}")
    checks.append(chk("acknowledgements_correct", not ack_fail, "; ".join(ack_fail[:10]) if ack_fail else "ok"))

    # Project scope: no in-scope invoice/customer tasks should leak into seeded projects.
    leaked = []
    other_items = [i for i in items if i.get("project_id") != proj_id and not i.get("is_deleted")]
    for i in other_items:
        text = _item_text(i)
        for spec in in_scope:
            trace = trace_by_customer[spec["customer"]]
            if _matches_customer_item(text, spec, trace):
                leaked.append(f"{spec['customer']} in project {i.get('project_id')}")
                break
    checks.append(chk("project_scope_correct", not leaked, "; ".join(leaked[:5]) if leaked else "ok"))

    # Handoff summary: one completed project-level handoff with live state context.
    h_fail = []
    if len(handoff_items) != 1:
        h_fail.append(f"handoff_items={len(handoff_items)}")
    else:
        handoff = handoff_items[0]
        text = _item_text(handoff)
        roster_ids = [
            trace_by_customer[s["customer"]]["customer_id"]
            for s in in_scope
            if trace_by_customer[s["customer"]]["customer_id"] in text or s["customer"] in text
        ]
        if len(set(roster_ids)) < len(in_scope):
            h_fail.append(f"handoff roster only has {len(set(roster_ids))}/{len(in_scope)} customers")
        if not any(url in text for url in _stripe_webhook_endpoints(stripe)):
            h_fail.append("handoff lacks live webhook endpoint")
        if not re.search(r"\$\s*\d", text) and "balance" not in _norm(text):
            h_fail.append("handoff lacks balance context")
        if "reviewer" not in _norm(text) and not re.search(r"\b(admin@example\.com|acct_[A-Za-z0-9_]+)\b", text):
            h_fail.append("handoff lacks reviewer identity")
        source_terms = exp.get("handoff_summary", {}).get("source_reference_terms", [])
        if source_terms and not any(_norm(term) in _norm(text) for term in source_terms):
            h_fail.append("handoff lacks source brief reference")
        label_terms = exp.get("handoff_summary", {}).get("label_terms", [])
        labels = set(handoff.get("labels") or [])
        if labels and label_terms and not _label_has_terms(labels, label_terms):
            h_fail.append(f"handoff labels={sorted(labels)} missing handoff/meta meaning")
    checks.append(chk("handoff_summary_correct", not h_fail, "; ".join(h_fail) if h_fail else "ok"))

    # Cross-system sub/price markers: bind subscription to customer, price to invoice description when possible.
    cross_fail = []
    sub_customer = _subscription_customer_map(stripe)
    prices_or_plans = _stripe_prices_or_plans(stripe)
    all_checked_items = []
    for spec in in_scope:
        all_checked_items.extend(item_by_customer.get(spec["customer"], []))
        all_checked_items.extend(ack_by_customer.get(spec["customer"], []))
    for spec in in_scope:
        trace = trace_by_customer[spec["customer"]]
        valid_subs = {sid for sid, cust in sub_customer.items() if cust == trace["customer_id"]}
        valid_plans = _valid_plan_ids_for_invoice(stripe, trace["invoice"])
        for item in item_by_customer.get(spec["customer"], []) + ack_by_customer.get(spec["customer"], []):
            subs, plans = _tokens_for_item(item)
            if not (subs & valid_subs):
                cross_fail.append(f"{spec['customer']}: subs={sorted(subs)} valid={sorted(valid_subs)}")
            if not plans:
                cross_fail.append(f"{spec['customer']}: missing price/plan token")
            elif not (plans & valid_plans):
                cross_fail.append(f"{spec['customer']}: plans={sorted(plans)} valid={sorted(valid_plans)}")
            elif not all(p in prices_or_plans for p in plans):
                cross_fail.append(f"{spec['customer']}: unknown price/plan in {sorted(plans)}")
    checks.append(chk("content_cross_system_markers_correct", not cross_fail, "; ".join(cross_fail[:8]) if cross_fail else "ok"))

    # Industry label: exactly one from-* label and it matches the customer's ledger industry.
    industry_fail = []
    for spec in in_scope:
        item = (item_by_customer.get(spec["customer"]) or [None])[0]
        if not item:
            industry_fail.append(f"{spec['customer']}: no active task found")
            continue
        labels = item.get("labels") or []
        expected_label = exp["industry_labels"].get(spec["customer"])
        industry_labels = [l for l in labels if _industry_label_matches(l, expected_label)]
        if not industry_labels:
            industry_fail.append(f"{spec['customer']}: expected {expected_label!r} labels={labels}")
        elif len(industry_labels) != 1:
            industry_fail.append(f"{spec['customer']}: industry_labels={industry_labels}")
    checks.append(chk("industry_labels_correct", not industry_fail, "; ".join(industry_fail[:8]) if industry_fail else "ok"))

    # Source integrity: Stripe is read-only.
    src = exp["stripe_source"]
    counts = {
        "customer_count": len(_objects(stripe, "customers")),
        "invoice_count": len(_objects(stripe, "invoices")),
        "subscription_count": len(_objects(stripe, "subscriptions")),
        "price_count": len(_objects(stripe, "prices")),
        "webhook_endpoint_count": len(_objects(stripe, "webhook_endpoints")),
    }
    wrong_counts = {k: (counts.get(k), src.get(k)) for k in src if counts.get(k) != src.get(k)}
    checks.append(chk("source_integrity", not wrong_counts, f"counts={wrong_counts}" if wrong_counts else "ok"))
    return checks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    td = Path(args.task_dir)
    od = Path(args.output_dir)
    rj = Path(args.reward_json)
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "")
    exp = json.loads((td / "private/expected_answer.json").read_text(encoding="utf-8-sig"))
    stripe, se = _read_state("MOCK_SITE_URL_STRIPE_CLI", token)
    todoist, te = _read_state("MOCK_SITE_URL_TODOIST_CLI", token)
    checks = evaluate(exp, stripe, todoist, se, te)

    od.mkdir(parents=True, exist_ok=True)
    (od / "stripe_final_state.json").write_text(json.dumps(stripe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (od / "todoist_final_state.json").write_text(json.dumps(todoist, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    raw_score = round(passed / total, 4) if total else 0.0
    all_passed = total > 0 and passed == total
    final_score = 1.0 if all_passed else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": exp.get("task_id") or f"cli-xfer-{td.name}",
        "score": final_score,
        "reward": final_score,
        "raw_score": raw_score,
        "raw_reward": raw_score,
        "raw_passed": all_passed,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "validation_checks": checks,
        "passed": all_passed,
    }
    rj.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": final_score, "raw_score": raw_score, "checks_passed": passed, "checks_total": total, "passed": all_passed}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
