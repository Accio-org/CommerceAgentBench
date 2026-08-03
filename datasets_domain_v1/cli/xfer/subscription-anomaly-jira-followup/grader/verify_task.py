#!/usr/bin/env python3
"""Final-state verifier for cli-xfer-subscription-anomaly-jira-followup.

The verifier derives renewal-risk subscriptions from the final Stripe source
state, then validates the final Jira state. It checks completion, source
faithfulness, and read-only source integrity; it never inspects command history.
"""
import argparse
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any


CHECK_IDS = (
    "setup_gate",
    "epic_correct",
    "inclusion_set_correct",
    "priority_correct",
    "summary_format_correct",
    "labels_correct",
    "risk_source_labels_correct",
    "escalation_comments_correct",
    "account_health_comments_correct",
    "transition_state_correct",
    "issue_description_markers_correct",
    "epic_description_markers_correct",
    "same_tier_links_correct",
    "source_integrity",
)


def _norm(v: Any) -> str:
    return " ".join(str(v or "").strip().casefold().split())


def _fetch(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _read_state(env_name: str, token: str) -> tuple[dict[str, Any], str]:
    base = os.environ.get(env_name, "").rstrip("/")
    if not base:
        return {}, f"{env_name} not set"
    if not token:
        return {}, "MOCK_VERIFIER_TOKEN not set"
    try:
        return _fetch(f"{base}/__bench/state", token), ""
    except Exception as exc:  # noqa: BLE001
        return {}, str(exc)


def chk(cid: str, ok: bool, reason: str = "") -> dict[str, Any]:
    return {
        "id": cid,
        "passed": bool(ok),
        "reason": str(reason)[:800],
        "check_type": "deterministic_exact",
    }


def _objects(stripe: dict[str, Any], resource: str) -> list[dict[str, Any]]:
    return [o for o in stripe.get("objects", []) if o.get("resource") == resource]


def _data_objects(stripe: dict[str, Any], resource: str) -> list[dict[str, Any]]:
    return [o.get("data") or {} for o in _objects(stripe, resource)]


def _object_map(stripe: dict[str, Any], resource: str) -> dict[str, dict[str, Any]]:
    out = {}
    for obj in _objects(stripe, resource):
        data = obj.get("data") or {}
        oid = obj.get("id") or data.get("id")
        if oid:
            out[str(oid)] = data
    return out


def _stripe_customers(stripe: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return _object_map(stripe, "customers")


def _stripe_subs(stripe: dict[str, Any]) -> list[dict[str, Any]]:
    return _data_objects(stripe, "subscriptions")


def _stripe_invoices(stripe: dict[str, Any]) -> list[dict[str, Any]]:
    return _data_objects(stripe, "invoices")


def _stripe_sub_items(stripe: dict[str, Any]) -> list[dict[str, Any]]:
    return _data_objects(stripe, "subscription_items")


def _stripe_prices_or_plans(stripe: dict[str, Any]) -> dict[str, dict[str, Any]]:
    prices = _object_map(stripe, "prices")
    prices.update(_object_map(stripe, "plans"))
    return prices


def _stripe_webhook_urls(stripe: dict[str, Any]) -> set[str]:
    return {
        str((o.get("data") or {}).get("url"))
        for o in _objects(stripe, "webhook_endpoints")
        if (o.get("data") or {}).get("url")
    }


def _stripe_balance_tokens(stripe: dict[str, Any]) -> set[str]:
    tokens: set[str] = set()
    for obj in _objects(stripe, "balance"):
        data = obj.get("data") or {}
        for key in ("available", "pending"):
            rows = data.get(key) or []
            if isinstance(rows, list):
                for row in rows:
                    amount = row.get("amount") if isinstance(row, dict) else None
                    if amount is not None:
                        try:
                            cents = int(amount)
                            tokens.add(str(cents))
                            tokens.add(str(cents // 100))
                            tokens.add(f"${cents // 100}")
                        except (TypeError, ValueError):
                            pass
    return tokens


def _extract_tier(description: str) -> str | None:
    m = re.search(r"\bTier\s*([ABC])\b", description or "", re.I)
    return f"Tier {m.group(1).upper()}" if m else None


def _extract_lead(description: str) -> str:
    m = re.search(r"renewal\s+lead\s+([^;,\n]+)", description or "", re.I)
    return " ".join(m.group(1).strip().split()) if m else ""


def _risk_for_subscription(sub: dict[str, Any], exp: dict[str, Any]) -> tuple[str, str, str] | None:
    status = _norm(sub.get("status"))
    rules = exp["risk_rules"]
    if status == "past_due":
        r = rules["past_due"]
        return "past_due", r["reason"], r["risk_source_label"]
    if status == "active" and bool(sub.get("cancel_at_period_end")):
        r = rules["pending_cancel"]
        return "pending_cancel", r["reason"], r["risk_source_label"]
    if status == "trialing":
        r = rules["trialing"]
        return "trialing", r["reason"], r["risk_source_label"]
    return None


def _sub_items_from_subscription(sub: dict[str, Any]) -> list[dict[str, Any]]:
    items = sub.get("items")
    if isinstance(items, dict) and isinstance(items.get("data"), list):
        return [i for i in items["data"] if isinstance(i, dict)]
    if isinstance(items, list):
        return [i for i in items if isinstance(i, dict)]
    return []


def _price_id_from_item(item: dict[str, Any]) -> str:
    for key in ("price", "plan"):
        val = item.get(key)
        if isinstance(val, dict) and val.get("id"):
            return str(val["id"])
        if isinstance(val, str):
            return val
    return ""


def _item_candidates(stripe: dict[str, Any], sub: dict[str, Any]) -> list[dict[str, Any]]:
    sid = str(sub.get("id") or "")
    out = [i for i in _stripe_sub_items(stripe) if str(i.get("subscription") or "") == sid]
    out.extend(_sub_items_from_subscription(sub))
    seen = set()
    uniq = []
    for item in out:
        iid = str(item.get("id") or "")
        if iid and iid not in seen:
            seen.add(iid)
            uniq.append(item)
    return uniq


def _invoice_candidates(stripe: dict[str, Any], sub: dict[str, Any]) -> list[dict[str, Any]]:
    sid = str(sub.get("id") or "")
    cid = str(sub.get("customer") or "")
    rows = [
        inv for inv in _stripe_invoices(stripe)
        if str(inv.get("subscription") or "") == sid or (cid and str(inv.get("customer") or "") == cid)
    ]
    rows.sort(key=lambda inv: int(inv.get("created") or 0), reverse=True)
    return rows


def _invoice_number(inv: dict[str, Any]) -> str:
    return str(inv.get("number") or inv.get("invoice_number") or inv.get("id") or "")


def _derive_specs(exp: dict[str, Any], stripe: dict[str, Any]) -> list[dict[str, Any]]:
    customers = _stripe_customers(stripe)
    prices = _stripe_prices_or_plans(stripe)
    specs = []
    for sub in _stripe_subs(stripe):
        risk = _risk_for_subscription(sub, exp)
        if not risk:
            continue
        risk_key, risk_reason, risk_source_label = risk
        cid = str(sub.get("customer") or "")
        customer = customers.get(cid, {})
        cname = str(customer.get("name") or customer.get("description") or cid)
        desc = str(customer.get("description") or "")
        tier = _extract_tier(desc) or ""
        tier_rule = exp["tier_rules"].get(tier, {})
        lead = _extract_lead(desc)
        items = _item_candidates(stripe, sub)
        item = items[0] if items else {}
        price_id = _price_id_from_item(item)
        if not price_id:
            sub_desc = _norm(sub.get("description"))
            for pid, price in prices.items():
                label = _norm(" ".join(str(price.get(k) or "") for k in ("nickname", "lookup_key", "product", "description")))
                if label and any(tok in sub_desc for tok in re.findall(r"[a-z0-9]+", label)):
                    price_id = pid
                    break
        invoices = _invoice_candidates(stripe, sub)
        latest_invoice = invoices[0] if invoices else {}
        specs.append({
            "customer": cname,
            "customer_id": cid,
            "subscription_id": str(sub.get("id") or ""),
            "subscription_status": str(sub.get("status") or ""),
            "subscription_item_id": str(item.get("id") or ""),
            "price_id": price_id,
            "latest_invoice_number": _invoice_number(latest_invoice),
            "latest_invoice_status": str(latest_invoice.get("status") or sub.get("status") or ""),
            "tier": tier,
            "tier_label": tier_rule.get("tier_label", ""),
            "priority": tier_rule.get("jira_priority", ""),
            "renewal_lead": lead,
            "risk_key": risk_key,
            "risk_reason": risk_reason,
            "risk_source_label": risk_source_label,
            "sla_terms": tier_rule.get("sla_terms", []),
        })
    return sorted(specs, key=lambda s: s["customer"])


def _source_fingerprint(exp: dict[str, Any], stripe: dict[str, Any], specs: list[dict[str, Any]]) -> dict[str, Any]:
    in_scope = [
        {
            "customer": s["customer"],
            "tier": s["tier"],
            "risk_reason": s["risk_reason"],
            "renewal_lead": s["renewal_lead"],
        }
        for s in sorted(specs, key=lambda x: x["customer"])
    ]
    in_names = {s["customer"] for s in specs}
    customers = _stripe_customers(stripe)
    sub_customers = {
        str(sub.get("customer") or "") for sub in _stripe_subs(stripe)
        if not _risk_for_subscription(sub, exp)
    }
    out_scope = sorted(str(customers.get(cid, {}).get("name") or cid) for cid in sub_customers if customers.get(cid, {}).get("name") not in in_names)
    return {
        "customer_count": len(customers),
        "subscription_count": len(_stripe_subs(stripe)),
        "in_scope": in_scope,
        "out_of_scope_customers": out_scope,
    }


def _issue_description(issue: dict[str, Any]) -> str:
    for key in ("description", "body", "description_text", "raw_description"):
        if issue.get(key):
            return str(issue[key])
    fields = issue.get("fields") or {}
    for key in ("description", "body"):
        if fields.get(key):
            return str(fields[key])
    return ""


def _issue_text(issue: dict[str, Any]) -> str:
    labels = " ".join(str(x) for x in (issue.get("labels") or []))
    return f"{issue.get('summary') or ''}\n{_issue_description(issue)}\n{labels}"


def _issue_type(issue: dict[str, Any]) -> str:
    return str(issue.get("type_name") or issue.get("issue_type") or issue.get("type") or "")


def _is_project(issue: dict[str, Any], project: str) -> bool:
    return issue.get("project_key") == project or issue.get("project") == project


def _has_all(text: str, terms: list[str]) -> bool:
    n = _norm(text)
    return all(_norm(term) in n for term in terms)


def _has_any(text: str, terms: list[str]) -> bool:
    n = _norm(text)
    return any(_norm(term) in n for term in terms)


def _token_present(text: str, token: str) -> bool:
    return bool(token) and token in text


def _comment_bodies(comments: list[dict[str, Any]], issue_key: str) -> list[str]:
    return [str(c.get("body") or "") for c in comments if c.get("issue_key") == issue_key]


def _active_proj_sprint(jira: dict[str, Any], project_key: str) -> tuple[str, str]:
    boards = {str(b.get("id")): b for b in jira.get("boards", [])}
    for sprint in jira.get("sprints", []):
        board = boards.get(str(sprint.get("board_id") or ""))
        if _norm(sprint.get("state")) == "active" and board and board.get("project_key") == project_key:
            return str(sprint.get("name") or ""), str(board.get("name") or "")
    return "", ""


def _current_jira_user(jira: dict[str, Any]) -> str:
    for row in jira.get("config", []):
        if row.get("key") in ("current_user", "user", "login", "email"):
            return str(row.get("value") or "")
    return "admin@example.com"


def evaluate(exp: dict[str, Any], stripe: dict[str, Any], jira: dict[str, Any],
             stripe_err: str, jira_err: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    project_key = exp["jira_project"]
    specs = [] if stripe_err else _derive_specs(exp, stripe)
    proj_ok = any(p.get("key") == project_key for p in jira.get("projects", [])) if not jira_err else False
    setup_ok = (not stripe_err) and (not jira_err) and proj_ok and bool(specs)
    setup_reason = (
        stripe_err or jira_err
        or ("" if proj_ok else f"jira project {project_key} missing")
        or (f"derived {len(specs)} risky subscriptions" if specs else "no risky subscriptions derived")
    )
    checks.append(chk("setup_gate", setup_ok, setup_reason))
    if not setup_ok:
        for cid in CHECK_IDS[1:]:
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    issues = jira.get("issues", [])
    comments = jira.get("comments", [])
    issue_links = jira.get("issue_links", [])

    epics = [
        i for i in issues
        if _is_project(i, project_key)
        and _norm(_issue_type(i)) == _norm(exp["epic_type"])
        and _norm(i.get("summary")) == _norm(exp["epic_summary"])
    ]
    epic = epics[0] if len(epics) == 1 else None
    checks.append(chk("epic_correct", epic is not None, f"epic count={len(epics)}" if epic is None else "ok"))

    # Match agent-created task issues by live customer/subscription identifiers
    # or customer name. The renewal-risk label is strongly expected but not used
    # as the only way to find the issue; this avoids hiding missing-label bugs.
    task_issues = [
        i for i in issues
        if _is_project(i, project_key)
        and _norm(_issue_type(i)) == _norm(exp["issue_type"])
        and not i.get("is_deleted")
    ]
    issue_by_sub: dict[str, list[dict[str, Any]]] = {s["subscription_id"]: [] for s in specs}
    extras = []
    spec_customers = {s["customer"] for s in specs}
    for issue in task_issues:
        text = _issue_text(issue)
        matched = [
            spec for spec in specs
            if _token_present(text, spec["subscription_id"])
            or _token_present(text, spec["customer_id"])
            or _norm(spec["customer"]) in _norm(text)
        ]
        if len(matched) == 1:
            issue_by_sub[matched[0]["subscription_id"]].append(issue)
        elif exp["fixed_label"] in (issue.get("labels") or []):
            extras.append(str(issue.get("summary") or "")[:120])
        else:
            for customer in exp.get("source_fingerprint", {}).get("out_of_scope_customers", []):
                if _norm(customer) in _norm(text):
                    extras.append(str(issue.get("summary") or "")[:120])
                    break

    missing = [s["customer"] for s in specs if not issue_by_sub.get(s["subscription_id"])]
    dups = [s["customer"] for s in specs if len(issue_by_sub.get(s["subscription_id"], [])) > 1]
    inc_ok = not missing and not dups and not extras
    checks.append(chk(
        "inclusion_set_correct",
        inc_ok,
        f"missing={missing} duplicates={dups} extras={extras[:4]}" if not inc_ok else "ok",
    ))

    priority_fail = []
    summary_fail = []
    labels_fail = []
    risk_label_fail = []
    esc_fail = []
    health_fail = []
    transition_fail = []
    desc_fail = []

    tier_labels = {v["tier_label"] for v in exp["tier_rules"].values()}
    risk_labels = {v["risk_source_label"] for v in exp["risk_rules"].values()}

    for spec in specs:
        issue = (issue_by_sub.get(spec["subscription_id"]) or [None])[0]
        if not issue:
            for bucket in (priority_fail, summary_fail, labels_fail, risk_label_fail, esc_fail, health_fail, transition_fail, desc_fail):
                bucket.append(f"{spec['customer']}: no issue")
            continue

        text = _issue_text(issue)
        summary = str(issue.get("summary") or "")
        labels = set(issue.get("labels") or [])
        comments_for_issue = _comment_bodies(comments, str(issue.get("key") or ""))
        desc = _issue_description(issue)

        if _norm(issue.get("priority_name")) != _norm(spec["priority"]):
            priority_fail.append(f"{spec['customer']}: priority={issue.get('priority_name')!r} expected={spec['priority']!r}")

        summary_norm = _norm(summary)
        missing_summary_parts = []
        if _norm(spec["tier"]) not in summary_norm and _norm(spec["tier_label"]) not in summary_norm:
            missing_summary_parts.append(f"{spec['tier']} or {spec['tier_label']}")
        for part in (spec["customer"], spec["risk_reason"], spec["renewal_lead"]):
            if _norm(part) not in summary_norm:
                missing_summary_parts.append(part)
        if missing_summary_parts:
            summary_fail.append(f"{spec['customer']}: summary missing {missing_summary_parts}")

        required_labels = {exp["fixed_label"], spec["tier_label"], spec["risk_source_label"]}
        wrong_tier = sorted((labels & tier_labels) - {spec["tier_label"]})
        wrong_source = sorted((labels & risk_labels) - {spec["risk_source_label"]})
        missing_labels = sorted(required_labels - labels)
        if missing_labels or wrong_tier or wrong_source:
            labels_fail.append(f"{spec['customer']}: missing={missing_labels} wrong_tier={wrong_tier} wrong_source={wrong_source} labels={sorted(labels)}")
        source_present = labels & risk_labels
        if source_present != {spec["risk_source_label"]}:
            risk_label_fail.append(f"{spec['customer']}: source_labels={sorted(source_present)} expected={spec['risk_source_label']}")

        high_sla = exp["tier_rules"]["Tier A"]["sla_terms"]
        has_high_escalation = any(_has_all(body, high_sla) for body in comments_for_issue)
        if spec["priority"] == "High":
            if not has_high_escalation:
                esc_fail.append(f"{spec['customer']}: missing Tier A SLA comment")
        elif has_high_escalation:
            esc_fail.append(f"{spec['customer']}: unexpected Tier A SLA comment")

        health_terms = exp.get("account_health_terms", ["account", "health"])
        expected_status = spec["latest_invoice_status"] or spec["subscription_status"]
        has_health = any(_has_all(body, health_terms) and _norm(expected_status) in _norm(body) for body in comments_for_issue)
        if not has_health:
            health_fail.append(f"{spec['customer']}: missing account-health comment with {expected_status!r}")

        if _norm(issue.get("status_name")) != _norm(exp["target_state"]):
            transition_fail.append(f"{spec['customer']}: status={issue.get('status_name')!r}")

        required_tokens = [
            ("self Jira key", str(issue.get("key") or "")),
            ("customer id", spec["customer_id"]),
            ("subscription id", spec["subscription_id"]),
            ("subscription item id", spec["subscription_item_id"]),
            ("price/plan id", spec["price_id"]),
            ("latest invoice", spec["latest_invoice_number"]),
        ]
        missing_tokens = [name for name, tok in required_tokens if tok and tok not in desc]
        if missing_tokens:
            desc_fail.append(f"{spec['customer']}: description missing {missing_tokens}")

    checks.append(chk("priority_correct", not priority_fail, "; ".join(priority_fail[:8]) if priority_fail else "ok"))
    checks.append(chk("summary_format_correct", not summary_fail, "; ".join(summary_fail[:8]) if summary_fail else "ok"))
    checks.append(chk("labels_correct", not labels_fail, "; ".join(labels_fail[:8]) if labels_fail else "ok"))
    checks.append(chk("risk_source_labels_correct", not risk_label_fail, "; ".join(risk_label_fail[:8]) if risk_label_fail else "ok"))
    checks.append(chk("escalation_comments_correct", not esc_fail, "; ".join(esc_fail[:8]) if esc_fail else "ok"))
    checks.append(chk("account_health_comments_correct", not health_fail, "; ".join(health_fail[:8]) if health_fail else "ok"))
    checks.append(chk("transition_state_correct", not transition_fail, "; ".join(transition_fail[:8]) if transition_fail else "ok"))
    checks.append(chk("issue_description_markers_correct", not desc_fail, "; ".join(desc_fail[:8]) if desc_fail else "ok"))

    epic_fail = []
    if not epic:
        epic_fail.append("no epic")
    else:
        edesc = _issue_description(epic)
        ndesc = _norm(edesc)
        customer_ids = {s["customer_id"] for s in specs}
        for cid in _stripe_customers(stripe):
            customer_ids.add(cid)
        missing_customers = sorted(cid for cid in customer_ids if cid not in edesc)
        if missing_customers:
            epic_fail.append(f"missing customer ids {missing_customers[:5]}")
        balance_tokens = _stripe_balance_tokens(stripe)
        if balance_tokens and not any(tok in edesc for tok in balance_tokens):
            epic_fail.append("missing live balance context")
        webhook_urls = _stripe_webhook_urls(stripe)
        if webhook_urls and not any(url in edesc for url in webhook_urls):
            epic_fail.append("missing live webhook endpoint")
        sprint_name, board_name = _active_proj_sprint(jira, project_key)
        if sprint_name and _norm(sprint_name) not in ndesc:
            epic_fail.append(f"missing active sprint {sprint_name!r}")
        if board_name and _norm(board_name) not in ndesc:
            epic_fail.append(f"missing board {board_name!r}")
        proj = next((p for p in jira.get("projects", []) if p.get("key") == project_key), {})
        lead = str(proj.get("lead") or "")
        if lead and _norm(lead) not in ndesc:
            epic_fail.append(f"missing project lead {lead!r}")
        reviewer = _current_jira_user(jira)
        if reviewer and _norm(reviewer) not in ndesc:
            epic_fail.append(f"missing reviewer {reviewer!r}")
    checks.append(chk("epic_description_markers_correct", not epic_fail, "; ".join(epic_fail[:8]) if epic_fail else "ok"))

    # Same-tier links are derived from Stripe, not hard-coded.
    link_fail = []
    key_by_sub = {
        sid: rows[0].get("key")
        for sid, rows in issue_by_sub.items()
        if rows and rows[0].get("key")
    }
    for tier in sorted({s["tier"] for s in specs}):
        tier_specs = [s for s in specs if s["tier"] == tier]
        if len(tier_specs) < 2:
            continue
        for i, left in enumerate(tier_specs):
            for right in tier_specs[i + 1:]:
                lk = key_by_sub.get(left["subscription_id"])
                rk = key_by_sub.get(right["subscription_id"])
                if not lk or not rk:
                    link_fail.append(f"{left['customer']}<->{right['customer']}: missing issue key")
                    continue
                ok = False
                for link in issue_links:
                    a = str(link.get("inward_key") or link.get("inwardIssue") or "")
                    b = str(link.get("outward_key") or link.get("outwardIssue") or "")
                    ltype = _norm(link.get("link_type") or link.get("type") or "")
                    if {a, b} == {lk, rk} and ("relat" in ltype or "relates" in ltype):
                        ok = True
                        break
                if not ok:
                    link_fail.append(f"{left['customer']}<->{right['customer']}: no relates link")
    checks.append(chk("same_tier_links_correct", not link_fail, "; ".join(link_fail[:8]) if link_fail else "ok"))

    fp_actual = _source_fingerprint(exp, stripe, specs)
    fp_expected = exp.get("source_fingerprint", {})
    src_fail = []
    if fp_expected and fp_actual != fp_expected:
        src_fail.append("source fingerprint differs from expected Q2 seed")
    checks.append(chk("source_integrity", not src_fail, "; ".join(src_fail) if src_fail else "ok"))
    return checks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    reward_json = Path(args.reward_json)
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    exp = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    stripe, stripe_err = _read_state("MOCK_SITE_URL_STRIPE_CLI", token)
    jira, jira_err = _read_state("MOCK_SITE_URL_JIRA_CLI", token)
    checks = evaluate(exp, stripe, jira, stripe_err, jira_err)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "stripe_final_state.json").write_text(json.dumps(stripe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "jira_final_state.json").write_text(json.dumps(jira, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    raw_score = round(passed / total, 4) if total else 0.0
    all_passed = total > 0 and passed == total
    final_score = 1.0 if all_passed else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": exp.get("task_id") or f"cli-xfer-{task_dir.name}",
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
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": final_score, "raw_score": raw_score, "checks_passed": passed, "checks_total": total, "passed": all_passed}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
