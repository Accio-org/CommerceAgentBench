#!/usr/bin/env python3
"""Verifier for deck-reconciliation (capacity-check fold).

Capacity refactor: the ~30-40 per-claim/CLI atomic checks are computed
verbatim into ``atoms`` and then folded by AND into 6 distinct capability
groups (setup gate, send recommendation, claim identification, claim
reconciliation, CLI source coverage, data access restraint). The folding
is pure emit/grouping: every atomic boolean/threshold/field comparison is
byte-identical to the pre-refactor verifier — only the final emit layer
changed. See ``docs/check-granularity.md`` (R2/R3/R4/R6).

Scorer-validity fix (2026-06-15, user-consented): two atom computations were
INTENTIONALLY changed because they rejected demonstrably-correct answers
(verifier_misalignment, not capability):
  1. ``claim_slide_*`` now accepts the page id OR the slide's body element id
     (``slide_object_id_accept``) — both are valid locators since each claim's
     text lives in one body element.
  2. ``canonical_claim_ids`` now also maps an agent's free-text claim id to a
     canonical claim by the claim's distinguishing metric token
     (``claim_id_match_tokens``) — the task invites free-text ids, so the fixed
     alias allowlist was under-inclusive. Tokens are claim-distinguishing but
     substring-overlapping ids can map to >1 canonical; since ``must_fix`` is
     graded recall-only (issubset), this only widens recall and never admits a
     wrong binary. Over-flagging a supported claim is penalized only when its
     ``claims[]`` item also carries a wrong status (``claim_status_group_*``).
These two are the ONLY deviations from byte-identical; everything else is
unchanged. See ``paper_experiments/results/PILOT_RESULTS.md`` (deck B1 finding).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any


def norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def norm_id(value: Any) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(value or "").lower())).strip("_")


def load_json(path: Path) -> tuple[Any | None, str]:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig")), ""
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def fetch_json(url: str, token: str) -> tuple[dict[str, Any], str]:
    try:
        req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8")), ""
    except Exception as exc:  # noqa: BLE001
        return {}, str(exc)


def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300], "check_type": "deterministic"}


def claim_items(answer: dict[str, Any]) -> list[dict[str, Any]]:
    claims = answer.get("claims")
    if not isinstance(claims, list):
        return []
    return [item for item in claims if isinstance(item, dict)]


def claim_text(item: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("claim_id", "status", "deck_value", "correct_value", "slide_object_id", "brief_reason"):
        parts.append(str(item.get(key, "")))
    evidence = item.get("evidence_ranges")
    if isinstance(evidence, list):
        parts.extend(str(x) for x in evidence)
    return norm(" ".join(parts))


def fragment_present(text: str, fragment: str) -> bool:
    fragment_n = norm(fragment)
    if fragment_n in text:
        return True
    ratio = re.fullmatch(r"(\d+)\s*/\s*(\d+)", str(fragment).strip())
    if not ratio:
        return False
    numerator, denominator = ratio.groups()
    alternatives = [
        f"{numerator} of {denominator}",
        f"{numerator} out of {denominator}",
        f"{numerator} over {denominator}",
    ]
    return any(norm(alt) in text for alt in alternatives)


def canonical_claim_ids(raw_ids: Any, aliases: dict[str, list[str]],
                        match_tokens: dict[str, list[str]] | None = None) -> set[str]:
    if not isinstance(raw_ids, list):
        return set()
    alias_to_canonical: dict[str, str] = {}
    for canonical, values in aliases.items():
        alias_to_canonical[norm_id(canonical)] = canonical
        for value in values:
            alias_to_canonical[norm_id(value)] = canonical

    # Content-based fallback (2026-06-15 identification fix). The task INVITES
    # free-text claim ids ("use stable claim ids that describe the claim"), so a
    # fixed alias allowlist cannot be exhaustive and was rejecting semantically
    # correct identifications on spelling alone. Map a raw id to a canonical claim
    # when the id contains that claim's distinguishing metric token (e.g.
    # "coverage" -> inventory_coverage, "pruning"/"shears" -> pruning_shears_savings).
    # Tokens are claim-distinguishing, but substring overlap means an unusual id
    # can map to >1 canonical (e.g. 'country_coverage'). Since must_fix is graded
    # recall-only (issubset), an extra canonical is harmless to a correct answer and
    # at worst slightly widens recall; it never flips a binary. Over-flagging a
    # SUPPORTED claim is penalized only via claim_reconciliation's claim_status_group_*
    # atoms (the claims[] item status), not here.
    match_tokens = match_tokens or {}

    canonicalized: set[str] = set()
    for raw_id in raw_ids:
        raw_norm = norm_id(raw_id)
        if not raw_norm:
            continue
        canonicalized.add(raw_norm)
        if raw_norm in alias_to_canonical:
            canonicalized.add(alias_to_canonical[raw_norm])
        for canonical, tokens in match_tokens.items():
            if any(norm_id(tok) in raw_norm for tok in tokens):
                canonicalized.add(norm_id(canonical))
                canonicalized.add(canonical)
    return canonicalized


def answer_has_evidence(answer: dict[str, Any], fragment: str) -> bool:
    fragment_n = norm(fragment)
    for item in claim_items(answer):
        evidence = item.get("evidence_ranges")
        if isinstance(evidence, list) and any(fragment_n in norm(x) for x in evidence):
            return True
    return False


def audit_entries(state_payload: dict[str, Any]) -> list[dict[str, Any]]:
    db = state_payload.get("db", {})
    if isinstance(db, dict):
        audit = db.get("audit", [])
        if isinstance(audit, list):
            return [x for x in audit if isinstance(x, dict)]
    return []


def audit_has_tool(audit: list[dict[str, Any]], tool: str) -> bool:
    return any(entry.get("kind") == "cli.tool" and entry.get("tool") == tool for entry in audit)


def range_entries(audit: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        entry for entry in audit
        if entry.get("kind") == "cli.tool" and entry.get("tool") == "sheets.getRange"
    ]


def audit_has_range(audit: list[dict[str, Any]], fragment: str) -> bool:
    fragment_n = norm(fragment)
    for entry in range_entries(audit):
        if fragment_n in norm(entry.get("range")):
            return True
    return False


def forbidden_bulk_sheet_text(audit: list[dict[str, Any]], spreadsheet_ids: list[str]) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for entry in audit:
        if entry.get("kind") != "cli.tool" or entry.get("tool") != "sheets.getText":
            continue
        spreadsheet_id = str(entry.get("spreadsheetId", ""))
        if any(target in spreadsheet_id for target in spreadsheet_ids):
            hits.append(entry)
    return hits


def add_claim_atoms(add, items: list[dict[str, Any]], claim_id: str, spec: dict[str, Any]) -> None:
    """Add atoms for a single claim group. Logic byte-identical to check_claim_group."""
    status_items = [item for item in items if item.get("status") == spec["status"]]
    add(f"claim_status_group_{claim_id}", bool(status_items),
        f"found {len(status_items)} {spec['status']} claims")
    if not status_items:
        return

    # 2026-06-15 slide-locator fix: accept the page id OR the slide's body
    # element id (the claim text lives in one body element, so both locate it).
    slide_accept = {norm(a) for a in (spec.get("slide_object_id_accept") or [spec.get("slide_object_id")])}
    add(f"claim_slide_{claim_id}",
        any(norm(item.get("slide_object_id")) in slide_accept for item in status_items),
        f"expected one of {sorted(slide_accept)}")
    add(f"claim_evidence_{claim_id}",
        any(isinstance(item.get("evidence_ranges"), list) and item.get("evidence_ranges")
            for item in status_items),
        "at least one evidence range")
    combined = " ".join(claim_text(item) for item in status_items)
    required = spec.get("required_fragments") or []
    if required:
        missing = [frag for frag in required if not fragment_present(combined, frag)]
        add(f"claim_value_{claim_id}", not missing,
            f"missing {missing}; required {required}")
    else:
        fragments = spec.get("correct_fragments", [])
        matched = [frag for frag in fragments if norm(frag) in combined]
        add(f"claim_value_{claim_id}", bool(matched),
            f"matched {matched}; expected one of {fragments}")


# --- Capability fold (emit/grouping layer only; atom computations unchanged) ---
# Ordered list of (group_id, capability description, predicate(atom_id)->bool).
# Predicates are evaluated in order; the FIRST matching group claims the atom,
# so the partition is complete and disjoint for every atom id below.
GROUP_SPECS = [
    ("setup_gate", "Environment ready: mock reachable + output parseable + audit present",
     lambda i: i in ("mock_reachable", "output_json_readable", "audit_present")),
    ("send_recommendation", "Correct top-level send/revise recommendation (R4 distinct)",
     lambda i: i == "send_recommendation"),
    ("claim_identification", "Correctly identified which claims need fixing vs validated (R4 distinct)",
     lambda i: i in ("must_fix_claim_ids", "validated_claim_ids_present")),
    ("claim_reconciliation", "All 6 claims reconciled: correct status, slide, evidence, values (R3 batch)",
     lambda i: i.startswith("claim_")),
    ("cli_source_coverage", "Used required CLI tools and accessed correct sheet ranges (R3 batch)",
     lambda i: i.startswith("cli_tool_") or i.startswith("cli_range_") or i == "minimum_cli_range_calls"),
    ("data_access_restraint", "No forbidden bulk sheet reads or non-CLI access (R6)",
     lambda i: i in ("no_bulk_sheet_get_text_for_sources", "no_server_direct_or_write_audit")),
]


def evaluate(expected: dict[str, Any], answer: Any, state: dict[str, Any],
             output_err: str, state_err: str) -> dict[str, tuple[bool, str]]:
    """Build atoms dict. Every comparison is byte-identical to pre-refactor."""
    atoms: dict[str, tuple[bool, str]] = {}

    def add(cid: str, passed: bool, reason: str = "") -> None:
        atoms[cid] = (bool(passed), str(reason)[:300])

    add("mock_reachable", not state_err, state_err or "state endpoint reachable")
    add("output_json_readable", not output_err and isinstance(answer, dict), output_err or "JSON parsed")
    if not isinstance(answer, dict):
        return atoms

    items = claim_items(answer)
    add("send_recommendation", answer.get("send_recommendation") == expected["send_recommendation"],
        f"got {answer.get('send_recommendation')!r}")

    got_fixes = canonical_claim_ids(answer.get("must_fix_claim_ids"), expected.get("claim_id_aliases", {}),
                                    expected.get("claim_id_match_tokens", {}))
    add("must_fix_claim_ids", set(expected["must_fix_claim_ids"]).issubset(got_fixes),
        f"got {sorted(got_fixes)}")
    got_validated = answer.get("validated_claim_ids")
    add("validated_claim_ids_present", isinstance(got_validated, list) and bool(got_validated),
        f"got {got_validated!r}")

    for claim_id, spec in expected["expected_claims"].items():
        add_claim_atoms(add, items, claim_id, spec)

    audit = audit_entries(state)
    add("audit_present", bool(audit), f"{len(audit)} audit entries")
    for tool in expected["required_cli_tools"]:
        add(f"cli_tool_{tool}", audit_has_tool(audit, tool), f"required {tool}")
    min_range_calls = int(expected.get("minimum_cli_range_calls", 0))
    if min_range_calls:
        observed_ranges = range_entries(audit)
        add("minimum_cli_range_calls", len(observed_ranges) >= min_range_calls,
            f"got {len(observed_ranges)}, expected at least {min_range_calls}")
    forbidden_bulk = forbidden_bulk_sheet_text(audit, expected.get("forbid_bulk_sheet_text_spreadsheet_ids", []))
    add("no_bulk_sheet_get_text_for_sources", not forbidden_bulk,
        f"{len(forbidden_bulk)} forbidden sheets.getText calls on source spreadsheets")
    for fragment in expected["required_range_fragments"]:
        add(f"cli_range_{fragment}", audit_has_range(audit, fragment),
            f"required CLI range containing {fragment}")

    forbidden_writes = [e for e in audit if str(e.get("tool", "")).startswith(("sheets.", "slides.")) and e.get("kind") != "cli.tool"]
    add("no_server_direct_or_write_audit", not forbidden_writes,
        f"{len(forbidden_writes)} non-cli tool/write audit entries")
    return atoms


def fold_atoms(atoms):
    """Fold per-atom results into GROUP_SPECS capability checks.

    Pure emit/grouping: each group = AND(member atoms); failing members
    listed in reason. Complete partition asserted."""
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


def _write_reward(atoms, path, task_id=""):
    checks = fold_atoms(atoms)
    passed_count = sum(1 for c in checks if c["passed"])
    total = len(checks)
    score = passed_count / total if total else 0.0
    all_passed = passed_count == total
    reward = {
        "schema_version": "2.0",
        "task_id": task_id,
        "checks_passed": passed_count,
        "checks_total": total,
        "checks_breakdown": checks,
        "score": score,
        "reward": score,
        "passed": all_passed,
    }
    Path(path).write_text(json.dumps(reward, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"deck-reconciliation: {passed_count}/{total} checks passed")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    ap.add_argument("--mock-url", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    expected = json.loads((task_dir / "private/expected_answer.json").read_text(encoding="utf-8-sig"))
    answer, output_err = load_json(output_dir / "deck_reconciliation.json")
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier")
    state, state_err = fetch_json(args.mock_url.rstrip("/") + "/api/state", token)

    try:
        (output_dir / "mock_google_workspace_state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    except OSError:
        pass

    atoms = evaluate(expected, answer, state, output_err, state_err)
    _write_reward(atoms, args.reward_json, task_id=task_dir.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
