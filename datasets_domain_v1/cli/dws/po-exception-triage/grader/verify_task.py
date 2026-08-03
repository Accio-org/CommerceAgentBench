#!/usr/bin/env python3
"""Deterministic verifier for dws-po-exception-triage.

Reads the FINAL dws_doc_cli state over HTTP
(GET ${MOCK_SITE_URL}/api/state, header X-Mock-Verifier-Token)
and scores it against private/expected_answer.json (ground truth).

The DWS state the agent produces IS the deliverable: per-exception triage
report documents (correctly named, severity-classified, placed in the right
triage folder, content filled), a global comment on each exception PO,
restraint on the normal/distractor POs, an unmodified template, and a
PO Exception Summary document with correct counts.

Capacity checks are folded capability units (see docs/check-granularity.md).
The per-spec atomic computation and every truth value in
private/expected_answer.json are byte-identical to the pre-fold verifier;
only the emit/grouping layer aggregates the 43 atoms (+ setup gate) into
distinct capability units by AND.
"""
import argparse
import json
import os
import re
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


TRIAGE_SEVERITY = {
    "PO-8806": ("Urgent", "fold-triage-urgent"),
    "PO-8807": ("Standard", "fold-triage-standard"),
    "PO-8810": ("Urgent", "fold-triage-urgent"),
    "PO-8814": ("Urgent", "fold-triage-urgent"),
    "PO-8816": ("Urgent", "fold-triage-urgent"),
    "PO-8821": ("Urgent", "fold-triage-urgent"),
    "PO-8828": ("Urgent", "fold-triage-urgent"),
    "PO-8832": ("Urgent", "fold-triage-urgent"),
}


SUMMARY_COUNT_REQUIREMENTS = [
    (
        "Total Active POs reviewed",
        32,
        [
            r"\btotal\b.*\bactive\b.*\bpo(?:s)?\b.*\breviewed\b",
            r"\bactive\b.*\bpo(?:s)?\b.*\breviewed\b.*\btotal\b",
        ],
    ),
    (
        "Exceptions found",
        8,
        [r"\bexceptions?\b.*\bfound\b", r"\btotal\b.*\bexceptions?\b"],
    ),
    ("Urgent", 7, [r"\burgent\b"]),
    ("Standard", 1, [r"\bstandard\b"]),
    (
        "Normal (no exception)",
        24,
        [
            r"\bnormal\b.*\bno\s+exceptions?\b",
            r"\bno\s+exceptions?\b.*\bnormal\b",
            r"\bnormal\b",
        ],
    ),
]

SUMMARY_HEADING_PATTERNS = [
    r"^\s*#\s*PO Exception Summary\s*$",
    r"^\s*PO Exception Summary\s*$",
]


def _summary_lines(content: str) -> list[str]:
    summary_block = re.split(
        r"^\s*##\s+Exception Details\b",
        content,
        maxsplit=1,
        flags=re.I | re.M,
    )[0]
    return [line.strip() for line in summary_block.splitlines() if line.strip()]


def _summary_heading_present(lines: list[str]) -> bool:
    return any(
        re.search(pattern, line, re.I)
        for line in lines
        for pattern in SUMMARY_HEADING_PATTERNS
    )


def _summary_count_present(lines: list[str], label_patterns: list[str], count: int) -> bool:
    count_pattern = re.compile(rf"(?<![\d.]){count}(?![\d.])")
    for line in lines:
        if not count_pattern.search(line):
            continue
        if any(re.search(pattern, line, re.I) for pattern in label_patterns):
            return True
    return False


def _custom_note_check(check_id: str, note: str, state: dict[str, Any]) -> dict[str, Any]:
    docs = _entity_items(state, "documents")
    if "summary" in check_id:
        matches = [
            item for item in docs
            if _norm(item.get("name")) == _norm("PO Exception Summary")
            and item.get("parentId") == "fold-root"
        ]
        if len(matches) != 1:
            return chk(check_id, False, f"expected one root summary doc, got {len(matches)}")
        content = str(matches[0].get("content") or "")
        lines = _summary_lines(content)
        missing = [] if _summary_heading_present(lines) else ["PO Exception Summary heading"]
        missing.extend(
            label
            for label, count, patterns in SUMMARY_COUNT_REQUIREMENTS
            if not _summary_count_present(lines, patterns, count)
        )
        reason = "summary content ok" if not missing else f"missing or mismatched summary requirements: {missing}"
        return chk(check_id, not missing, reason)

    po_suffix = check_id.split("po_", 1)[-1]
    po = f"PO-{po_suffix}"
    if po not in TRIAGE_SEVERITY:
        return chk(check_id, False, f"unsupported custom note {note!r}")
    severity, parent_id = TRIAGE_SEVERITY[po]
    matches = [
        item for item in docs
        if _norm(item.get("name")) == _norm(f"Triage — {po}")
        and item.get("parentId") == parent_id
    ]
    if len(matches) != 1:
        return chk(check_id, False, f"expected one {severity} triage doc for {po}, got {len(matches)}")
    content = str(matches[0].get("content") or "")
    required = [po, f"Severity: {severity}"]
    missing = [term for term in required if term not in content]
    return chk(check_id, not missing, "triage doc content ok" if not missing else f"missing {missing}")


def _eval_spec(spec: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Atomic per-spec evaluation (unchanged from the original verifier).

    Returns a single check record {id, passed, reason}. The match/count/
    custom-note/field-comparison logic and all truth values are byte-identical
    to the pre-fold verifier; only the emit/grouping layer below aggregates
    these into capability units.
    """
    entity = str(spec.get("entity") or "documents")
    match = spec.get("match") or {}
    items = _entity_items(state, entity)
    matches = [item for item in items if _match_item(item, match)]
    expect = spec.get("expect") or {}
    check_id = str(spec.get("id") or f"{entity}:{match}")

    if "custom_note" in expect:
        return _custom_note_check(check_id, str(expect["custom_note"]), state)

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
# Aggregates the 43 atomic specs (+ setup gate) into distinct capability
# units by AND. The per-spec atomic computation in _eval_spec and every
# truth value in expected_answer.json are UNTOUCHED. See
# docs/check-granularity.md (R2/R3a/R6/R1).
#
#   setup_gate                  (R2)   - mock state reachable/readable
#   exception_triaged::PO-XXXX  (R3a)  - per-exception completeness IS the
#                                        hard core competency of this task
#                                        (identify the 8 exceptions hidden
#                                        among 32 incl. customs-holds under
#                                        non-exception status, classify
#                                        severity via the shortfall/units-at-
#                                        risk >=500 rule, build the correctly
#                                        named/placed/filled triage doc, AND
#                                        comment on the PO). 8 per-exception
#                                        checks, each ANDs that PO's
#                                        triage_exists + comment_on atoms.
#   normal_pos_untouched        (R6)   - no comments on the 24 normal POs
#                                        (over-triage restraint / the trap)
#   distractors_respected       (R6)   - template unmodified AND the misfiled
#                                        closed PO not triaged
#   summary_correct             (R1)   - PO Exception Summary doc with all
#                                        required counts present

_RESTRAINT_SPEC_IDS = {"template_unmodified", "no_triage_closed_po"}


def _po_suffix(spec_id: str) -> str:
    return spec_id.rsplit("po_", 1)[-1]


def _group_for(spec_id: str) -> str:
    if spec_id.startswith("triage_exists_po_") or spec_id.startswith("comment_on_po_"):
        return f"exception_triaged::PO-{_po_suffix(spec_id)}"
    if spec_id.startswith("no_comment_po_"):
        return "normal_pos_untouched"
    if spec_id in _RESTRAINT_SPEC_IDS:
        return "distractors_respected"
    if spec_id == "summary_doc_exists":
        return "summary_correct"
    raise KeyError(f"unmapped spec id {spec_id!r}")  # complete-partition guard


# Per-exception group ids in PO order; the non-per-item capabilities follow.
_EXCEPTION_ORDER = [f"exception_triaged::PO-{po.split('PO-')[-1]}" for po in TRIAGE_SEVERITY]
_TAIL_ORDER = ["normal_pos_untouched", "distractors_respected", "summary_correct"]
_CAPABILITY_ORDER = _EXCEPTION_ORDER + _TAIL_ORDER

_CAPABILITY_LABEL = {
    "normal_pos_untouched": "no comments added to the 24 normal (non-exception) POs",
    "distractors_respected": "Triage Report Template unmodified and the misfiled closed PO not triaged",
    "summary_correct": "PO Exception Summary document with all required counts",
}
_CAPABILITY_LABEL.update(
    {gid: f"{gid.split('::')[-1]} correctly triaged (severity doc + comment)" for gid in _EXCEPTION_ORDER}
)


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
