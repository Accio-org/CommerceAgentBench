#!/usr/bin/env python3
"""Deterministic verifier for cli-dws-block-edit-product-table.

Reads the FINAL dws_doc_cli state over HTTP (GET ${MOCK_SITE_URL}/api/state,
header X-Mock-Verifier-Token) and scores the block-level edits to the
procurement-calendar document: Q3 product-table insertion, a provisional-pricing
callout, Q1-archive removal + new archive document, title rename, comment
preservation + a new JP inline comment, and archive read permissions.

Scoring is folded into distinct capability units (see docs/check-granularity.md,
R1/R3/R4/R6): the per-spec atomic computation and every truth value in
private/expected_answer.json are byte-identical to the pre-fold verifier; only
the emit/grouping layer (`_group_for` + the aggregation inside `evaluate`)
collapses the 40 atomic specs into capability-unit checks by AND.
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

    if passed:
        for key, pair in (expect.get("before") or {}).items():
            got = str(_field(item, key) or "")
            if isinstance(pair, list) and len(pair) == 2:
                pos_a = got.find(str(pair[0]))
                pos_b = got.find(str(pair[1]))
                if pos_a < 0:
                    passed, reason = False, f"{key}: '{pair[0]}' not found"
                    break
                if pos_b < 0:
                    passed, reason = False, f"{key}: '{pair[1]}' not found"
                    break
                if pos_a >= pos_b:
                    passed, reason = False, f"{key}: '{pair[0]}' should appear before '{pair[1]}'"
                    break

    return chk(check_id, passed, reason)


# --- Capacity-check folding (emit/grouping layer only) ---------------------
# Maps each atomic spec id (40 in expected_answer.json) to a capability-unit
# check. The per-spec atomic computation in _eval_spec and every truth value in
# expected_answer.json are untouched; this layer only aggregates the atoms
# (+ setup gate) into distinct capability units by AND. See
# docs/check-granularity.md (R1/R3/R4/R6).
#
#   setup_gate                  (R2)  - mock state reachable
#   q3_table_built              (R3)  - all 12 Q3 SKUs inserted from the KB and
#                                       positioned before Procurement Contacts
#                                       (one "build the Q3 product table" skill
#                                       applied across 12 rows; do not pad rows)
#   provisional_callout_added   (R4)  - yellow callout w/ provisional text above
#                                       the Q3 table (distinct formatted-block
#                                       capability)
#   q1_entries_removed          (R3)  - all 8 Q1-archive entries removed from
#                                       the catalog (one "remove the Q1 block")
#   existing_body_preserved     (R6)  - 6 Q2 rows + Procurement Contacts footer
#                                       survive the restructure (body-content
#                                       restraint)
#   title_renamed               (R1)  - new H2 title present AND old title gone
#                                       (2 observations of one rename skill)
#   review_comments_preserved   (R3)  - all 5 pre-existing review comments kept
#                                       through the block edit (comment-entity
#                                       restraint; anchors shift during edits)
#   jp_inline_comment_added     (R4)  - the new JP inline comment was created
#   archive_doc_created         (R4)  - the "Q1 Archive" document was created
#   archive_permissions_granted (R1)  - READER perms to both archive reviewers
#
# Each capability check passes iff ALL its member atoms pass; failing member
# atom ids (with reasons) are listed in the reason string for diagnosis.

_CAPABILITY_ORDER = [
    "q3_table_built",
    "provisional_callout_added",
    "q1_entries_removed",
    "existing_body_preserved",
    "title_renamed",
    "review_comments_preserved",
    "jp_inline_comment_added",
    "archive_doc_created",
    "archive_permissions_granted",
]

_CAPABILITY_LABEL = {
    "q3_table_built": "Q3 product table inserted from KB (all 12 SKUs) before Procurement Contacts",
    "provisional_callout_added": "yellow provisional-pricing callout added above the Q3 table",
    "q1_entries_removed": "all 8 Q1-archive product entries removed from the catalog",
    "existing_body_preserved": "pre-existing Q2 rows and the Procurement Contacts footer preserved",
    "title_renamed": "document title renamed to the new H2 and the old title removed",
    "review_comments_preserved": "all 5 pre-existing review comments preserved",
    "jp_inline_comment_added": "new JP inline comment created on the first Q3 JP row",
    "archive_doc_created": "'Q1 Archive' document created",
    "archive_permissions_granted": "READER permission granted to both archive reviewers",
}

# Exact, complete partition of the 40 atomic spec ids → capability units.
_EXPLICIT_GROUP = {
    "q3_before_footer": "q3_table_built",
    "callout_before_q3": "provisional_callout_added",
    "new_title": "title_renamed",
    "old_title_gone": "title_renamed",
    "footer_preserved": "existing_body_preserved",
    "jp_comment_is_inline": "jp_inline_comment_added",
    "archive_exists": "archive_doc_created",
    "perm_a": "archive_permissions_granted",
    "perm_b": "archive_permissions_granted",
}


def _group_for(spec_id: str) -> str:
    if spec_id in _EXPLICIT_GROUP:
        return _EXPLICIT_GROUP[spec_id]
    if spec_id.startswith("q3_content_"):
        return "q3_table_built"
    if spec_id.startswith("q1_removed_"):
        return "q1_entries_removed"
    if spec_id.startswith("q2_preserved_"):
        return "existing_body_preserved"
    if spec_id.startswith("comment_"):
        return "review_comments_preserved"
    raise KeyError(f"no capability group for spec id {spec_id!r}")


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
            else f"{_CAPABILITY_LABEL[cap]} — failing: {bad[:12]}"
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
