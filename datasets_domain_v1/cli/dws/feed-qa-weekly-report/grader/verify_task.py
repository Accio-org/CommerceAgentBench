#!/usr/bin/env python3
"""Deterministic verifier for dws-feed-qa-weekly-report.

Reads the FINAL dws_doc_cli state over HTTP
(GET ${MOCK_SITE_URL}/api/state, header X-Mock-Verifier-Token)
and scores it against private/expected_answer.json (ground truth).

The DWS state the agent produces IS the deliverable: a correctly
structured Feed QA Weekly Summary document, comment annotations on
qualifying product QA documents, and no modifications to excluded
documents. Score is discriminated by the final document/comment state.
"""
import argparse
import json
import os
import urllib.request
from pathlib import Path
from typing import Any


def _norm(value: Any) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _fetch_json(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(
        url, headers={"X-Mock-Verifier-Token": token},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _entity_items(state: dict[str, Any], entity: str) -> list[dict[str, Any]]:
    raw = (state.get("entities") or {}).get(entity) or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _field(item: dict[str, Any], key: str) -> Any:
    if key in item:
        return item[key]
    if "." in key:
        parts = key.split(".", 1)
        sub = item.get(parts[0])
        if parts[1] == "count" and isinstance(sub, (list, dict)):
            return len(sub)
        if isinstance(sub, dict):
            return sub.get(parts[1])
    return None


def _match_item(item: dict[str, Any], match: dict[str, Any]) -> bool:
    for key, want in match.items():
        got = _field(item, key)
        if isinstance(want, str):
            if _norm(got) != _norm(want):
                return False
        elif got != want:
            return False
    return True


def chk(cid: str, passed: bool, reason: str = "") -> dict[str, Any]:
    return {"id": cid, "passed": passed, "reason": reason[:500], "check_type": "deterministic_exact"}


def _eval_spec(spec: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Atomic per-spec evaluation (unchanged from the original verifier).

    Returns a single check record {id, passed, reason}. The match/count/
    field-comparison logic and all truth values are byte-identical to the
    pre-fold verifier; only the emit/grouping layer below aggregates these.
    """
    entity = str(spec.get("entity") or "documents")
    match = spec.get("match") or {}
    items = _entity_items(state, entity)
    matches = [item for item in items if _match_item(item, match)]
    expect = spec.get("expect") or {}
    check_id = str(spec.get("id") or f"{entity}:{match}")

    if "count" in expect:
        got = len(matches)
        want = int(expect["count"])
        return chk(check_id, got == want, f"expected count {want}, got {got}")

    item = matches[0] if len(matches) == 1 else None
    if len(matches) > 1 and not expect.get("absent"):
        return chk(check_id, False, f"expected one match, got {len(matches)}")

    if expect.get("absent"):
        return chk(check_id, item is None, "expected absent" if item else "absent as expected")

    if item is None:
        return chk(check_id, False, "no matching entity found")

    passed = True
    reason = "matched"

    for key, want in (expect.get("equals") or {}).items():
        got = _field(item, key)
        if isinstance(want, str):
            if _norm(got) != _norm(want):
                passed, reason = False, f"{key}: expected {want!r}, got {got!r}"
                break
        elif isinstance(want, bool):
            if bool(got) != want:
                passed, reason = False, f"{key}: expected {want!r}, got {got!r}"
                break
        elif got != want:
            passed, reason = False, f"{key}: expected {want!r}, got {got!r}"
            break

    if passed:
        for key, terms in (expect.get("contains") or {}).items():
            got = str(_field(item, key) or "")
            required = terms if isinstance(terms, list) else [terms]
            missing = [t for t in required if str(t) not in got]
            if missing:
                passed, reason = False, f"{key}: missing terms {missing}"
                break

    if passed:
        for key, terms in (expect.get("not_contains") or {}).items():
            got = str(_field(item, key) or "")
            forbidden = terms if isinstance(terms, list) else [terms]
            found = [t for t in forbidden if str(t) in got]
            if found:
                passed, reason = False, f"{key}: should not contain {found}"
                break

    if passed:
        for key, want in (expect.get("min") or {}).items():
            got = _field(item, key)
            try:
                if float(got) < float(want):
                    passed, reason = False, f"{key}: expected >= {want}, got {got}"
                    break
            except (TypeError, ValueError):
                passed, reason = False, f"{key}: expected numeric >= {want}, got {got!r}"
                break

    if passed:
        for key, want in (expect.get("max") or {}).items():
            got = _field(item, key)
            try:
                if float(got) > float(want):
                    passed, reason = False, f"{key}: expected <= {want}, got {got}"
                    break
            except (TypeError, ValueError):
                passed, reason = False, f"{key}: expected numeric <= {want}, got {got!r}"
                break

    return chk(check_id, passed, reason)


# --- Capacity-check folding (emit/grouping layer only) ---------------------
# Aggregates the 64 atomic specs (+ setup gate) into distinct capability units
# by AND. The per-spec atomic computation in _eval_spec and every truth value
# in expected_answer.json are untouched; this layer only buckets the atoms.
# See docs/check-granularity.md (R1/R3a/R4/R6).
#
#   setup_gate                (R2)  - mock state reachable
#   summary_doc_created       (R1)  - the "Week 23 Feed QA Summary" doc exists
#   included_issues_complete  (R3a) - all 18 qualifying SKUs appear in the
#                                     summary; item-completeness is the hard
#                                     selection competency (weak models truncate)
#   excluded_issues_filtered  (R6)  - all 26 non-qualifying SKUs absent from the
#                                     summary; the negative/restraint side of the
#                                     filter over a heterogeneous distractor set
#                                     (medium severity / prior cycle / closed /
#                                     non-QA docs)
#   comments_on_included      (R3a) - exactly one comment per included doc; the
#                                     distinct annotation competence (over- or
#                                     under-annotation is a separate gap)
#   no_archived_content       (R6)  - summary does not pull prior-cycle content
#                                     (distinct source-restraint negative)

_CAPABILITY_ORDER = [
    "summary_doc_created",
    "included_issues_complete",
    "excluded_issues_filtered",
    "comments_on_included",
    "no_archived_content",
]

_CAPABILITY_LABEL = {
    "summary_doc_created": "Week 23 Feed QA Summary document created",
    "included_issues_complete": "all qualifying (High/Highest, current-cycle, open) SKUs present in summary",
    "excluded_issues_filtered": "all non-qualifying SKUs excluded from summary",
    "comments_on_included": "exactly one comment added per included document",
    "no_archived_content": "summary does not reference prior-cycle / archived content",
}


def _group_for(spec_id: str) -> str:
    if spec_id == "summary_doc_exists":
        return "summary_doc_created"
    if spec_id == "no_archived_in_summary":
        return "no_archived_content"
    if spec_id.startswith("comment_on_"):
        return "comments_on_included"
    if spec_id.startswith("summary_has_"):
        return "included_issues_complete"
    if spec_id.startswith("summary_excludes_"):
        return "excluded_issues_filtered"
    raise AssertionError(f"unmapped spec id: {spec_id}")


def evaluate(expected: dict[str, Any], state: dict[str, Any], state_err: str = "") -> list[dict[str, Any]]:
    # setup_gate (R2): the lone plumbing check; short-circuit on state error.
    if state_err:
        return [chk("setup_gate", False, state_err)]
    checks: list[dict[str, Any]] = [chk("setup_gate", True, "state fetched")]

    # Internal: evaluate every spec atomically (unchanged logic), bucket by
    # capability, collecting failing member ids for the reason string.
    members: dict[str, list[str]] = {cap: [] for cap in _CAPABILITY_ORDER}
    failed: dict[str, list[str]] = {cap: [] for cap in _CAPABILITY_ORDER}
    for spec in expected.get("checks", []):
        atom = _eval_spec(spec, state)
        cap = _group_for(atom["id"])
        members[cap].append(atom["id"])
        if not atom.get("passed"):
            failed[cap].append(f"{atom['id']} ({atom.get('reason')})")

    # External: one capability-unit check per group, passing iff all members pass.
    for cap in _CAPABILITY_ORDER:
        if not members[cap]:
            continue
        bad = failed[cap]
        ok = not bad
        reason = (
            f"ok ({len(members[cap])} checks)"
            if ok
            else f"{_CAPABILITY_LABEL[cap]} — failing: {bad[:10]}"
        )
        checks.append(chk(cap, ok, reason))

    return checks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    args = parser.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    reward_json = Path(args.reward_json)
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "")
    mock_url = os.environ.get("MOCK_SITE_URL", "").rstrip("/")
    expected = json.loads(
        (task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig")
    )

    state: dict[str, Any] = {}
    state_err = ""
    if not mock_url:
        state_err = "MOCK_SITE_URL not set"
    elif not token:
        state_err = "MOCK_VERIFIER_TOKEN not set"
    else:
        try:
            state = _fetch_json(f"{mock_url}/api/state", token)
        except Exception as exc:
            state_err = str(exc)

    checks = evaluate(expected, state, state_err)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "dws_final_state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )

    passed = sum(1 for c in checks if c.get("passed"))
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_dir.name,
        "score": score,
        "reward": score,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "validation_checks": checks,
        "passed": total > 0 and passed == total,
    }
    reward_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps({"score": score, "checks_passed": passed, "checks_total": total, "passed": payload["passed"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
