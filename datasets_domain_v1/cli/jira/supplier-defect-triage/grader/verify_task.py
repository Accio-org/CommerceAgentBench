#!/usr/bin/env python3
"""Deterministic verifier for cli-jira-supplier-defect-triage.

Reads the FINAL jira_cli state over the bench HTTP bridge
(GET ${MOCK_SITE_URL}/__bench/state, header X-Mock-Verifier-Token:
${MOCK_VERIFIER_TOKEN}) and scores it against private/expected_answer.json
(ground truth). Emits a v2 reward.

The Jira state the agent produced is the sole signal:
  * priority / component / assignee on representative issues,
  * exactly one directed "Duplicates" link + a Done transition for each duplicate
    (canonical kept),
  * distractor near-dups left open and unlinked (false-positive guard),
  * the cycle-7 label on the exact capacity-bounded set (and nowhere else).
There is no agent-written file to grade.

Scoring is split so the offline solvers under scratch/scripts/ can score a
constructed state dict without HTTP/bun: build_checks(state, expected) is a pure
function; main() only adds the network fetch + reward I/O around it.
"""
import argparse
import json
import os
import re
import urllib.request
from pathlib import Path


def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300],
            "check_type": "deterministic_exact"}


def norm(s):
    return " ".join(str(s or "").strip().lower().split())


def norm_link_type(s):
    return re.sub(r"[^a-z]", "", str(s or "").lower())


def _accept(got, want):
    """List-accept: `want` may be a single value or a list of defensible values.
    Passes if the normalised `got` equals any normalised acceptable value. (All
    current ground-truth values are single strings; list-accept is here so a
    genuinely multi-defensible field can be widened without code changes.)"""
    cands = want if isinstance(want, (list, tuple)) else [want]
    g = norm(got)
    return any(g == norm(w) for w in cands)


def _accept_in(got_list, want):
    """Like _accept but for membership fields (components): passes if any
    acceptable value is present in the issue's list."""
    cands = want if isinstance(want, (list, tuple)) else [want]
    gset = {norm(x) for x in (got_list or [])}
    return any(norm(w) in gset for w in cands)


def build_checks(state, expected, state_err=""):
    """Pure scorer: given a jira-bench `state` dict and the ground-truth
    `expected`, return the ordered list of atomic check dicts."""
    triage_by_key = {t["key"].upper(): t for t in expected["triage"]}
    cycle_label = expected["cycle_label"]
    closed_state = expected["closed_state"]
    want_link = expected["duplicate_link_type"]

    issues = state.get("issues", []) if isinstance(state, dict) else []
    links = state.get("issue_links", []) if isinstance(state, dict) else []
    by_key = {str(i.get("key", "")).upper(): i for i in issues}

    def comps(issue):
        c = issue.get("components", []) if issue else []
        return [norm(x) for x in c] if isinstance(c, list) else []

    def labels(issue):
        lb = issue.get("labels", []) if issue else []
        return [norm(x) for x in lb] if isinstance(lb, list) else []

    def dup_link_records():
        return [ln for ln in links
                if norm_link_type(ln.get("link_type")) == norm_link_type(want_link)]

    def directed_dup_links(dup_key, canon_key):
        dk, ck = dup_key.upper(), canon_key.upper()
        return [ln for ln in dup_link_records()
                if str(ln.get("inward_key", "")).upper() == dk
                and str(ln.get("outward_key", "")).upper() == ck]

    def in_any_dup_link(key):
        """True if `key` appears as either end of any 'Duplicates' link — catches
        a false-positive duplicate on a distractor near-dup."""
        k = key.upper()
        for ln in links:
            if norm_link_type(ln.get("link_type")) != norm_link_type(want_link):
                continue
            if k in {str(ln.get("inward_key", "")).upper(),
                     str(ln.get("outward_key", "")).upper()}:
                return True
        return False

    sfx = f" ({state_err})" if state_err else ""
    checks = []
    expected_issue_keys = {str(t["key"]).upper() for t in expected["triage"]}
    expected_issue_keys |= {str(p["duplicate"]).upper() for p in expected["duplicates"]}
    expected_dup_keys = {str(p["duplicate"]).upper() for p in expected["duplicates"]}

    # Check granularity (see docs/check-granularity.md): plumbing -> one setup_gate;
    # same-skill trivia batches (priority/component/assignee/distractors) collapse to one
    # capability check each, validating every item internally and reporting per-item
    # failures in `reason`. Duplicate handling is KEPT per-pair because dedup completeness
    # (finding all duplicates among 35 issues) is the task's core graded competency.

    # 1. setup_gate: jira bench state readable (plumbing, R2).
    checks.append(chk("setup_gate",
                      isinstance(state, dict) and bool(issues) and not state_err,
                      state_err or "jira bench state read over MOCK_SITE_URL"))

    # 2. priority_correct: severity x volume matrix / regulatory override (collapsed batch).
    bad = []
    for key in expected["scored"]["priority_keys"]:
        want = triage_by_key[key.upper()]["priority"]
        got = (by_key.get(key.upper()) or {}).get("priority_name")
        if not (key.upper() in by_key and _accept(got, want)):
            bad.append(f"{key}: want '{want}' got '{norm(got) or '(missing)'}'")
    checks.append(chk("priority_correct", not bad,
                      "ok" if not bad else f"wrong priority -> {bad}{sfx}"))

    # 3. component_correct: defect-from-narrative -> component (collapsed batch).
    bad = []
    for key in expected["scored"]["component_keys"]:
        want = triage_by_key[key.upper()]["component"]
        issue = by_key.get(key.upper())
        if not (issue is not None and _accept_in(comps(issue), want)):
            bad.append(f"{key}: want '{want}' got {comps(issue)}")
    checks.append(chk("component_correct", not bad,
                      "ok" if not bad else f"wrong component -> {bad}{sfx}"))

    # 4. assignee_correct: component -> owner (collapsed batch).
    bad = []
    for key in expected["scored"]["assignee_keys"]:
        want = triage_by_key[key.upper()]["assignee"]
        got = (by_key.get(key.upper()) or {}).get("assignee")
        if not (key.upper() in by_key and _accept(got, want)):
            bad.append(f"{key}: want '{want}' got '{norm(got) or '(missing)'}'")
    checks.append(chk("assignee_correct", not bad,
                      "ok" if not bad else f"wrong assignee -> {bad}{sfx}"))

    # 5..N. duplicate_handled::<dup> — KEPT per-pair (dedup completeness is the graded
    # core competency). Each duplicate pair = exactly one directed link to its canonical
    # AND the duplicate transitioned to the closed state.
    for pair in expected["duplicates"]:
        dup, canon = pair["duplicate"], pair["canonical"]
        found = directed_dup_links(dup, canon)
        got_status = norm((by_key.get(dup.upper()) or {}).get("status_name"))
        link_ok = len(found) == 1
        close_ok = dup.upper() in by_key and got_status == norm(closed_state)
        reasons = []
        if not link_ok:
            reasons.append(f"expected one directed '{want_link}' {dup}->{canon}, found {len(found)}")
        if not close_ok:
            reasons.append(f"expected {dup} in '{closed_state}', got '{got_status or '(missing)'}'")
        checks.append(chk(f"duplicate_handled::{dup}", link_ok and close_ok,
                          "ok" if not reasons else "; ".join(reasons) + sfx))

    # duplicate_set_integrity — precision guard (negative capability, R6): no reversed/extra
    # duplicate links, exactly the duplicate issues closed, canonicals kept open.
    actual_directed_pairs = [
        (str(ln.get("inward_key", "")).upper(), str(ln.get("outward_key", "")).upper())
        for ln in dup_link_records()
    ]
    expected_directed_pairs = [
        (str(p["duplicate"]).upper(), str(p["canonical"]).upper())
        for p in expected["duplicates"]
    ]
    link_set_ok = sorted(actual_directed_pairs) == sorted(expected_directed_pairs)
    bad_closed = [k for k in expected["canonical_keys"]
                  if norm((by_key.get(k.upper()) or {}).get("status_name")) == norm(closed_state)]
    canon_ok = len(bad_closed) == 0
    actual_closed_keys = {k for k in expected_issue_keys
                          if norm((by_key.get(k) or {}).get("status_name")) == norm(closed_state)}
    closed_set_ok = actual_closed_keys == expected_dup_keys
    reasons = []
    if not link_set_ok:
        reasons.append(f"directed link set {sorted(actual_directed_pairs)} != expected")
    if not canon_ok:
        reasons.append(f"canonical(s) wrongly closed: {bad_closed}")
    if not closed_set_ok:
        reasons.append(f"closed set {sorted(actual_closed_keys)} != {sorted(expected_dup_keys)}")
    checks.append(chk("duplicate_set_integrity", link_set_ok and canon_ok and closed_set_ok,
                      "ok" if not reasons else "; ".join(reasons) + sfx))

    # distractors_untouched — near-dup distractors NOT linked as duplicates and NOT closed
    # (negative capability, collapsed batch).
    bad = []
    for key in expected["scored"].get("distractor_keys", []):
        got_status = norm((by_key.get(key.upper()) or {}).get("status_name"))
        if in_any_dup_link(key):
            bad.append(f"{key}: wrongly carries a 'Duplicates' link")
        if not (key.upper() in by_key and got_status != norm(closed_state)):
            bad.append(f"{key}: must stay open, got '{got_status or '(missing)'}'")
    checks.append(chk("distractors_untouched", not bad,
                      "ok" if not bad else f"{bad}{sfx}"))

    # cycle_label_correct — cycle-7 exactly on the capacity/blocker-correct committed set
    # (single deterministic answer per triage_policy.md §5). Internally validates the full
    # committed / not-committed partition; reports missing/extra in `reason`.
    expected_cycle_keys = {str(k).upper() for k in expected["committed_keys"]}
    actual_cycle_keys = {k for k in expected_issue_keys
                         if norm(cycle_label) in labels(by_key.get(k))}
    missing = sorted(expected_cycle_keys - actual_cycle_keys)
    extra = sorted(actual_cycle_keys - expected_cycle_keys)
    checks.append(chk("cycle_label_correct",
                      actual_cycle_keys == expected_cycle_keys,
                      "ok" if not (missing or extra)
                      else f"cycle-7 set wrong: missing={missing} extra={extra}{sfx}"))

    return checks


def score(checks):
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    return passed, total, (round(passed / total, 4) if total else 0.0)


def fetch_state(url, token):
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    a = ap.parse_args()
    task = Path(a.task_dir)
    out_dir = Path(a.output_dir)

    expected = json.loads((task / "private/expected_answer.json").read_text())

    mock_url = os.environ.get("MOCK_SITE_URL", "").rstrip("/")
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    state, state_err = {}, ""
    if not mock_url:
        state_err = "MOCK_SITE_URL not set"
    else:
        try:
            state = fetch_state(f"{mock_url}/__bench/state", token)
        except Exception as e:  # noqa: BLE001
            state_err = f"state fetch failed: {e}"

    # Persist the final state for debugging (best-effort).
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "mock_jira_final_state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass

    checks = build_checks(state, expected, state_err)
    passed, total, reward = score(checks)
    result = {
        "schema_version": "2.0",
        "task_id": task.name,
        "score": reward,
        "reward": reward,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "passed": passed == total,
    }
    Path(a.reward_json).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"score": reward, "checks_passed": passed, "checks_total": total,
                      "passed": result["passed"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
