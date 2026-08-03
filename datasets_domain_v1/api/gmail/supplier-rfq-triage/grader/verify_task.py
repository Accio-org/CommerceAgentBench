#!/usr/bin/env python3
"""Deterministic verifier for api-gmail-supplier-rfq-triage (v5 — capacity-folded).

The GATE is messy supplier-identity resolution: there is NO clean key in the quotes — identity is
resolved by corroborating >=2 of {works address, phone stem, bank beneficiary, export licence}.
This verifier is UNCHANGED in mechanism and in every atomic predicate: it grades the agent's RESULT
(the company NAMES it reported + the labels/drafts/events it mutated), resolving names to canonical
suppliers via the alias table (canonical + every variant display-name token), so the in-body identity
encoding is irrelevant to scoring.

CAPACITY REFACTOR (2026-06-09): the 42 atomic checks are folded into capability GROUPS for the
reward breakdown (a group passes IFF all its member atoms pass — pure AND aggregation; binary
``passed`` is unchanged). The folding is purely an emit-layer change:

  * Every per-atom predicate/reason/id is byte-identical to the prior version (computed via ``add``
    into an ``atoms`` dict instead of appended to ``checks``).
  * ``GROUP_SPECS`` + ``fold_atoms`` AND-fold the atoms into capability units. The COMPLETE
    PARTITION (every atom maps to exactly one group) is asserted by ``fold_atoms``.
  * The messy multi-signal supplier-identity gate (the discriminating core) is kept as a graded
    R3a per-supplier capability: one ``supplier_resolved::<token>`` group per disqualified supplier
    of record, so "resolved 14 of 15 vs 9 of 15" stays legible. Everything else collapses (R1/R2/
    R3/R4/R6). Per-atom failure detail still surfaces in each group's ``reason``.

Reads:
  * Verifier-authenticated GET ${MOCK_SITE_URL}/api/state — the live gmail_mock
    state the agent mutated (messages + their labels, drafts, calendarEvents).
  * private/expected_answer.json     — ground truth (never shipped to the container).
  * outputs/triage_summary.json      — the agent's reported answer.

First check is `setup_gate` (fail-loud on mock unreachable): if the mock can't be reached the run
fails immediately with a single failing group. Emits a v2 reward (schema_version 2.0; binary pass =
ALL groups pass).

IDENTITY SCORING (the gate): the agent's `disqualified` keys (free-form company names) are resolved
to a canonical SUPPLIER OF RECORD via `alias_token_to_canon` (every canonical AND variant
display-name token -> its canonical token). This gives merge credit for using any of a supplier's
variant names, while detecting the three identity error modes:
  * summary_dq_no_duplicates — two agent keys resolving to the SAME supplier (failed to merge a
    variant identity / re-send / forwarded copy).
  * summary_dq_no_unknowns   — an agent key matching NO known supplier (a broker/agent listed as a
    supplier, a hallucinated name, or a bare brand stem too generic to disambiguate a look-alike).
  * summary_dq_set_exact     — the resolved supplier set differs from ground truth.
"""
import argparse
import json
import os
import re
import urllib.request
from collections import Counter
from pathlib import Path

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
MUTATION_EVENTS = {
    "message_action",
    "draft_saved",
    "draft_deleted",
    "message_sent",
    "message_scheduled",
    "label_created",
    "filter_saved",
    "subscription_unsubscribed",
    "task_created",
    "task_updated",
    "calendar_event_created",
    "note_created",
    "contact_created",
    "contact_updated",
    "settings_saved",
    "ui_command",
    "reset",
    "workspace_tool_call",
}


def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300],
            "check_type": "deterministic_exact"}


# --- DQ-token universe (kept here so GROUP_SPECS can build one group per supplier
#     of record without importing the ground-truth file at module load). It mirrors
#     expected_answer.json["disqualified_tokens"] keys; the live atoms are still
#     emitted from the ground truth at runtime, this is only the fold partition. ---
DQ_TOKENS = [
    "brookfield", "castings", "castworks", "extrusions", "fabrication",
    "formworks", "metalworks", "orion", "pinnacle", "riverton",
    "saito", "stampworks", "tanaka", "tooling", "westgate",
]


def _build_group_specs():
    """Capability groups as (group_id, predicate) over atom ids. AND-folded.

    Pure aggregation: a group passes IFF all atoms whose id satisfies its predicate
    pass. Order here == reward breakdown order == rubric order.
    """
    specs = []

    # R2: all plumbing + summary-presence -> one setup_gate.
    setup_atoms = {
        "mock_reachable", "mock_events_readable", "no_direct_api_mutation_events",
        "workspace_tool_evidence_present", "summary_exists",
    }
    specs.append(("setup_gate", lambda a, s=setup_atoms: a in s))

    # R1: identified + labelled the correct winner (exclusively, real domain not fraud).
    winner_atoms = {
        "label_rfq_on_chosen", "label_rfq_exclusive",
        "summary_chosen_supplier", "summary_chosen_supplier_email",
    }
    specs.append(("winner_selected", lambda a, s=winner_atoms: a in s))

    # R4: reconciled the requirement evolving across non-adjacent threads
    # (qty re-revision 2800, finish retraction matte black, in-DC pull 56).
    recon_atoms = {
        "summary_final_quantity", "summary_final_finish", "summary_allowed_lead_days",
    }
    specs.append(("requirement_reconciled", lambda a, s=recon_atoms: a in s))

    # R4: FX/incoterm landed-cost computation + near-tie ranking (winner + runner-up).
    cost_atoms = {
        "summary_landed_cost", "summary_runner_up_supplier", "summary_runner_up_landed_cost",
    }
    specs.append(("landed_cost_ranked", lambda a, s=cost_atoms: a in s))

    # R3/R6: flagged exactly the three BEC payment-redirections (no decoys) + summary set.
    fraud_atoms = {
        "label_security_fraud_1", "label_security_fraud_2", "label_security_fraud_3",
        "label_security_exclusive", "summary_flagged_ids_set",
    }
    specs.append(("fraud_flagged", lambda a, s=fraud_atoms: a in s))

    # R1: scheduled the kickoff call on the right date, titled for the winner.
    cal_atoms = {"calendar_event_date", "calendar_event_supplier"}
    specs.append(("kickoff_scheduled", lambda a, s=cal_atoms: a in s))

    # R1: drafted the reply to the winner's real quote domain.
    draft_atoms = {"draft_exists", "draft_to_supplier"}
    specs.append(("reply_drafted", lambda a, s=draft_atoms: a in s))

    # R3a graded CORE: messy multi-signal identity resolution, one group per supplier
    # of record (resolve identity + assign the right DQ reason). This is the
    # discriminating axis (co-located look-alikes / merge-variants / supersede /
    # broker). Kept per-supplier because completeness of resolution IS the measured
    # skill (cf. promo-fraud 15x per-order, jira 8x per-pair).
    for tok in DQ_TOKENS:
        atom = f"summary_dq_{tok}"
        specs.append((f"supplier_resolved::{tok}", lambda a, x=atom: a == x))

    # R6 negatives: the resolved DQ set is exactly right, with no double-count and
    # no unknown (broker/hallucination/too-generic) entries.
    integ_atoms = {"summary_dq_set_exact", "summary_dq_no_duplicates", "summary_dq_no_unknowns"}
    specs.append(("dq_set_integrity", lambda a, s=integ_atoms: a in s))

    return specs


GROUP_SPECS = _build_group_specs()


def group_for(atom_id):
    for gid, pred in GROUP_SPECS:
        if pred(atom_id):
            return gid
    return None


def fold_atoms(atoms):
    """Fold {atom_id: (passed, reason)} into capability groups by AND.

    A group passes IFF every atom mapped to it passes. Failing atoms' (id, reason)
    are surfaced in the group reason. Asserts a COMPLETE PARTITION: every atom maps
    to exactly one group, and no group is empty.
    """
    unmapped = [aid for aid in atoms if group_for(aid) is None]
    assert not unmapped, f"unmapped atom ids (incomplete partition): {unmapped}"

    out = []
    for gid, pred in GROUP_SPECS:
        members = [aid for aid in atoms if pred(aid)]
        assert members, f"empty group {gid} (atom not emitted?)"
        fails = [(aid, atoms[aid][1]) for aid in members if not atoms[aid][0]]
        passed = not fails
        if passed:
            reason = f"ok ({len(members)} atom(s))"
        else:
            detail = "; ".join(f"{aid}: {r}" for aid, r in fails)
            reason = f"{len(fails)}/{len(members)} atom(s) failed -> {detail}"
        out.append(chk(gid, passed, reason))
    return out


def norm_label(s):
    return re.sub(r"[\s_]+", "-", str(s).strip().lower())


def norm_name(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s).strip().lower()).strip()


def as_float(x):
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    try:
        return float(str(x).replace(",", "").replace("$", "").replace("USD", "").strip())
    except (TypeError, ValueError):
        return None


def as_int(x):
    f = as_float(x)
    return int(round(f)) if f is not None else None


def emails_in(value):
    return [m.group(0).lower() for m in EMAIL_RE.finditer(str(value or ""))]


def domains_in(value):
    return [e.split("@", 1)[1] for e in emails_in(value)]


# Map a (possibly free-form) disqualification reason to one canonical code.
_REASON_SYNONYMS = {
    "spec": "spec", "finish": "spec", "spec-finish": "spec", "specification": "spec",
    "wrong-finish": "spec", "colorway": "spec", "material": "spec", "size": "spec",
    "certification": "certification", "cert": "certification", "iso": "certification",
    "iso-9001": "certification", "iso9001": "certification", "compliance": "certification",
    "payment-terms": "payment_terms", "payment": "payment_terms", "payment-term": "payment_terms",
    "terms": "payment_terms", "deposit": "payment_terms", "payment-terms-violation": "payment_terms",
    "lead-time": "lead_time", "leadtime": "lead_time", "lead": "lead_time",
    "delivery": "lead_time", "lead-time-days": "lead_time", "deadline": "lead_time",
    "moq": "moq", "volume": "moq", "quantity": "moq", "min-order": "moq",
    "minimum-order-quantity": "moq",
    "warranty": "warranty", "warranty-term": "warranty", "guarantee": "warranty",
}


def canon_reason(s):
    n = norm_label(s)
    if n in _REASON_SYNONYMS:
        return _REASON_SYNONYMS[n]
    for tok in n.split("-"):
        if tok in _REASON_SYNONYMS:
            return _REASON_SYNONYMS[tok]
    return n


def fetch_state(mock_url):
    url = mock_url.rstrip("/") + "/api/state"
    token = os.environ.get("MOCK_VERIFIER_TOKEN") or "bench-verifier"
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    last = None
    for _ in range(5):
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"cannot GET {url}: {last}")


def fetch_events(mock_url):
    url = mock_url.rstrip("/") + "/api/events"
    token = os.environ.get("MOCK_VERIFIER_TOKEN") or "bench-verifier"
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=10) as r:
        payload = json.loads(r.read())
    events = payload.get("events", []) if isinstance(payload, dict) else []
    return events if isinstance(events, list) else []


def write_reward(path, checks, diagnostics=None):
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    reward = round(passed / total, 4) if total else 0.0
    out = {
        "schema_version": "2.0", "score": reward, "reward": reward,
        "checks_passed": passed, "checks_total": total, "checks_breakdown": checks,
        "diagnostics": diagnostics or {},
        "passed": passed == total,
    }
    Path(path).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"score": reward, "checks_passed": passed, "checks_total": total,
                      "passed": passed == total}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--mock-url", required=True)
    ap.add_argument("--reward-json", required=True)
    a = ap.parse_args()
    task = Path(a.task_dir)
    expected = json.loads((task / "private/expected_answer.json").read_text())

    # ---- internal atoms dict (id -> (passed, reason)); folded at emit time -----
    atoms = {}

    def add(cid, passed, reason=""):
        atoms[cid] = (bool(passed), str(reason)[:300])

    # ---- mock_reachable: fail-loud first atom --------------------------------
    try:
        state = fetch_state(a.mock_url)
    except Exception as e:  # noqa: BLE001
        # setup_gate fails loud as a single failing group.
        write_reward(a.reward_json, [chk("setup_gate", False, f"gmail_mock unreachable: {e}")])
        return 0

    add("mock_reachable", True, "")
    try:
        audit_events = fetch_events(a.mock_url)
        add("mock_events_readable", True, "")
    except Exception as e:  # noqa: BLE001
        audit_events = []
        add("mock_events_readable", False, f"gmail_mock events unreachable: {e}")

    direct_mutations = [
        ev for ev in audit_events
        if ev.get("source") == "api" and ev.get("type") in MUTATION_EVENTS
    ]
    add(
        "no_direct_api_mutation_events",
        len(direct_mutations) == 0,
        f"direct_api_mutations={len(direct_mutations)}",
    )
    workspace_tools = [
        str(ev.get("tool") or "")
        for ev in audit_events
        if ev.get("type") == "workspace_tool_call"
    ]
    required_tool_evidence = {
        "search": any(tool == "gmail.search" for tool in workspace_tools),
        "get": any(tool == "gmail.get" for tool in workspace_tools),
        "label": any(tool in {"gmail.modify", "gmail.batchModify", "gmail.modifyThread"} for tool in workspace_tools),
        "draft": any(tool == "gmail.createDraft" for tool in workspace_tools),
        "calendar": any(tool == "calendar.createEvent" for tool in workspace_tools),
    }
    add(
        "workspace_tool_evidence_present",
        True,
        f"diagnostic_only tool_evidence={required_tool_evidence}",
    )
    path_diagnostics = {
        "direct_api_mutation_events": len(direct_mutations),
        "workspace_tools": workspace_tools,
        "required_tool_evidence": required_tool_evidence,
    }

    chosen_id = expected["chosen_quote_message_id"]
    supplier_domain = expected["chosen_supplier_domain"].lower()
    supplier_token = expected["chosen_supplier_token"]                  # "meridian"
    runner_token = expected["runner_up_supplier_token"]                 # "apex"
    runner_landed = float(expected["runner_up_landed_cost_usd"])
    kickoff = expected["kickoff_date"]
    final_qty = int(expected["final_quantity"])
    allowed_lead = int(expected["allowed_lead_days"])
    exp_landed = float(expected["landed_cost_usd"])
    tol = float(expected.get("landed_cost_tolerance", 0.05))
    rfq_label = norm_label(expected["labels"]["rfq_decision"])
    sec_label = norm_label(expected["labels"]["security_review"])
    fraud_ids = list(expected["flagged_email_ids"])
    fraud_senders = {s.lower() for s in expected.get("flagged_sender_emails", [])}
    alias = dict(expected["alias_token_to_canon"])                     # any token -> canon token
    exp_dq_tokens = dict(expected["disqualified_tokens"])              # canon token -> reason

    messages = state.get("messages", []) or []
    labels = state.get("labels", []) or []
    drafts = state.get("drafts", []) or []
    events = state.get("calendarEvents", []) or []
    label_id_to_name = {l.get("id"): l.get("name") for l in labels}
    by_id = {m.get("id"): m for m in messages}

    def msg_label_set(m):
        out = set()
        for l in (m.get("labels") or []):
            out.add(norm_label(l))
            if l in label_id_to_name:
                out.add(norm_label(label_id_to_name[l]))
        return out

    def has_label(m, t):
        return t in msg_label_set(m)

    # ---- summary file -------------------------------------------------------
    summary = None
    try:
        summary = json.loads((Path(a.output_dir) / "triage_summary.json").read_text(encoding="utf-8-sig"))
        add("summary_exists", isinstance(summary, dict),
            "" if isinstance(summary, dict) else "triage_summary.json is not a JSON object")
    except Exception as e:  # noqa: BLE001
        add("summary_exists", False, f"cannot read/parse triage_summary.json: {e}")
    summary = summary if isinstance(summary, dict) else {}

    # ---- RFQ-Decision label on the chosen quote (+ exclusivity) -------------
    chosen_msg = by_id.get(chosen_id)
    add("label_rfq_on_chosen",
        chosen_msg is not None and has_label(chosen_msg, rfq_label),
        f"chosen quote {chosen_id} missing label {expected['labels']['rfq_decision']}")
    rfq_wrong = [m.get("id") for m in messages if m.get("id") != chosen_id and has_label(m, rfq_label)]
    add("label_rfq_exclusive", not rfq_wrong,
        f"RFQ-Decision also on: {rfq_wrong}" if rfq_wrong else "")

    # ---- Security-Review on EACH fraud (+ exclusivity, catches decoys) ------
    for n, fid in enumerate(fraud_ids, start=1):
        fm = by_id.get(fid)
        add(f"label_security_fraud_{n}",
            fm is not None and has_label(fm, sec_label),
            f"fraud msg {fid} missing label {expected['labels']['security_review']}")
    sec_wrong = [m.get("id") for m in messages
                 if m.get("id") not in set(fraud_ids) and has_label(m, sec_label)]
    add("label_security_exclusive", not sec_wrong,
        f"Security-Review also on (e.g. a legit/internal notice): {sec_wrong}"
        if sec_wrong else "")

    # ---- calendar event -----------------------------------------------------
    def ev_on_kickoff(ev):
        for key in ("date", "start", "end"):
            v = str(ev.get(key, "")).strip()
            if v == kickoff or v.startswith(kickoff) or kickoff in v:
                return True
        return False

    kickoff_events = [ev for ev in events if ev_on_kickoff(ev)]
    add("calendar_event_date", bool(kickoff_events),
        f"no calendar event on kickoff {kickoff}; events={[e.get('date') for e in events]}")
    titled = [ev for ev in kickoff_events if supplier_token in str(ev.get("title", "")).lower()]
    add("calendar_event_supplier", bool(titled),
        f"no kickoff event titled for '{supplier_token}'; "
        f"titles={[e.get('title') for e in kickoff_events]}")

    # ---- draft to the correct supplier (rejects look-alike) ----------------
    add("draft_exists", len(drafts) >= 1, "no drafts created")
    draft_ok = any(supplier_domain in domains_in(d.get("to", "")) for d in drafts)
    add("draft_to_supplier", draft_ok,
        f"no draft addressed to @{supplier_domain} (reject look-alike); "
        f"draft tos={[d.get('to') for d in drafts]}")

    # ---- summary scalar fields ---------------------------------------------
    add("summary_chosen_supplier",
        supplier_token in norm_name(summary.get("chosen_supplier", "")),
        f"chosen_supplier={summary.get('chosen_supplier')!r} (want token '{supplier_token}')")
    add("summary_chosen_supplier_email",
        supplier_domain in domains_in(summary.get("chosen_supplier_email", "")),
        f"chosen_supplier_email={summary.get('chosen_supplier_email')!r} "
        f"(want domain {supplier_domain})")
    add("summary_final_quantity", as_int(summary.get("final_quantity")) == final_qty,
        f"expected {final_qty}, got {summary.get('final_quantity')!r}")
    got_finish = str(summary.get("final_finish", "")).lower()
    add("summary_final_finish",
        ("matte" in got_finish and "black" in got_finish and "silver" not in got_finish),
        f"final_finish={summary.get('final_finish')!r} (want post-retraction matte black)")
    add("summary_allowed_lead_days", as_int(summary.get("allowed_lead_days")) == allowed_lead,
        f"expected {allowed_lead} (PO->final in-DC), got {summary.get('allowed_lead_days')!r} "
        f"(63 = used the brief's in-DC date, not the pulled-earlier one)")
    got_landed = as_float(summary.get("landed_cost_usd"))
    add("summary_landed_cost",
        got_landed is not None and abs(got_landed - exp_landed) <= tol,
        f"expected {exp_landed}+-{tol}, got {summary.get('landed_cost_usd')!r}")

    # ---- runner-up (the near-tie loser) ------------------------------------
    add("summary_runner_up_supplier",
        runner_token in norm_name(summary.get("runner_up_supplier", "")),
        f"runner_up_supplier={summary.get('runner_up_supplier')!r} (want token '{runner_token}')")
    got_runner = as_float(summary.get("runner_up_landed_cost_usd"))
    add("summary_runner_up_landed_cost",
        got_runner is not None and abs(got_runner - runner_landed) <= tol,
        f"expected {runner_landed}+-{tol}, got {summary.get('runner_up_landed_cost_usd')!r}")

    # ---- flagged email id set (must equal the fraud set exactly) -----------
    def resolve_to_id(entry):
        e = str(entry).strip()
        if e in by_id:
            return e
        ems = emails_in(e)
        if ems:
            for m in messages:
                if str(m.get("fromEmail", "")).lower() in ems:
                    return m.get("id")
        return e
    raw_flags = summary.get("flagged_email_ids")
    if raw_flags is None and summary.get("flagged_email_id") is not None:
        raw_flags = [summary.get("flagged_email_id")]
    raw_flags = raw_flags if isinstance(raw_flags, list) else ([raw_flags] if raw_flags else [])
    agent_flag_ids = {resolve_to_id(x) for x in raw_flags}
    add("summary_flagged_ids_set", agent_flag_ids == set(fraud_ids),
        f"flagged set {sorted(agent_flag_ids)} != fraud set {sorted(fraud_ids)}")

    # ---- disqualification map (resolve each agent name to a canonical supplier) ----
    # Each agent key is matched against the alias table (canonical + variant tokens).
    #   0 canons  -> unknown (broker-as-supplier, hallucination, or a bare brand stem)
    #   >=2 canons-> ambiguous (failed to disambiguate a look-alike pair) -> credit none
    #   exactly 1 -> credit that supplier; >1 distinct keys for one canon = failed merge
    raw_dq = summary.get("disqualified") if isinstance(summary.get("disqualified"), dict) else {}
    agent_dq = {}            # canon token -> canonical reason
    canon_key_counts = Counter()   # canon token -> # of distinct agent keys resolving to it
    unknown_keys = []
    for name, code in raw_dq.items():
        nm = norm_name(name)
        canons = sorted({alias[t] for t in alias if t in nm})
        if not canons:
            unknown_keys.append(name)
        elif len(canons) >= 2:
            pass                                 # ambiguous: credit neither (set-exact catches it)
        else:
            canon = canons[0]
            canon_key_counts[canon] += 1
            agent_dq[canon] = canon_reason(code)

    def dq_check(token):
        return chk(f"summary_dq_{token}", agent_dq.get(token) == exp_dq_tokens.get(token),
                   f"disqualified[{token}]={agent_dq.get(token)!r}, want {exp_dq_tokens.get(token)!r}")

    for token in sorted(exp_dq_tokens):
        c = dq_check(token)
        add(c["id"], c["passed"], c["reason"])

    add("summary_dq_set_exact", set(agent_dq.keys()) == set(exp_dq_tokens.keys()),
        f"disqualified set {sorted(agent_dq.keys())} != {sorted(exp_dq_tokens.keys())} "
        f"(catches merged look-alikes [drops one], a superseded/retracted revision, "
        f"a broker dropped, or the winner/runner/an eligible supplier wrongly listed)")
    dup_canons = sorted(t for t, c in canon_key_counts.items() if c > 1)
    add("summary_dq_no_duplicates", not dup_canons,
        f"the same supplier was listed under >1 name (failed to merge a variant "
        f"identity / re-send / forwarded copy): {dup_canons}" if dup_canons else "")
    add("summary_dq_no_unknowns", not unknown_keys,
        f"disqualified contains name(s) that resolve to no known supplier "
        f"(a broker/agent, a hallucinated supplier, or a too-generic brand stem): "
        f"{unknown_keys}" if unknown_keys else "")

    # ---- fold the 42 atoms into capability groups (pure AND aggregation) ----
    checks = fold_atoms(atoms)
    write_reward(a.reward_json, checks, diagnostics={"events": path_diagnostics})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
