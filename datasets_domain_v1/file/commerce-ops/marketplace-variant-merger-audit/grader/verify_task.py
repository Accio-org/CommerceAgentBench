"""v2 verifier for file-commerce-ops-marketplace-variant-merger-audit.

All ground truth is loaded from `private/expected_answer.json`. No hard-coded
fallbacks.

Capacity-check granularity (2026-06-09 refactor, docs/check-granularity.md):
this file folds ONLY the emit layer. The per-item validation logic — decision
enums, same-evidence-item file+keyword matching, matrix equality — is
UNCHANGED. The emitted check set is:

  1. `setup_gate` (R2) — variant_audit.json exists/parses AND every proposed
     SKU appears exactly once with a valid decision enum (no missing/extra/
     duplicate/invalid). Pure format/completeness plumbing.
  2. 10x `<sku>_decision_correct` (R3a) — the per-candidate classification is
     the hard, countable core competency (merge vs separate vs duplicate vs
     reject across heterogeneous candidates), so it stays per-item.
  3. `evidence_grounding_correct` (R3) — one documentation-discipline
     competency ("ground every decision in the specific signal-row AND
     policy-clause evidence"), applied identically across all SKUs; the old
     20 per-SKU signal/policy atoms collapse into this single check, with
     every failing (sku, kind) pair listed in `reason`.
  4. `variation_matrix_consistent_with_decisions` (R6) — consistency/negative
     check; kept as its own check.

Binary pass is invariant: all(new) == all(old 33) because every fold is a pure
AND of the same atoms (no validation loosened).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def flatten(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(f"{k} {flatten(v)}" for k, v in value.items())
    if isinstance(value, list):
        return " ".join(flatten(v) for v in value)
    return str(value or "")


def norm(value: Any) -> str:
    return re.sub(r"\s+", " ", flatten(value).lower()).strip()


def add(checks: list[dict[str, Any]], check_id: str, passed: bool, reason: str, check_type: str) -> None:
    checks.append({"id": check_id, "passed": bool(passed), "reason": reason, "check_type": check_type})


def read_csv(path: Path) -> list[dict[str, str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))
    except OSError:
        return []


def evidence_items(row: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull the candidate row's structured `evidence[]` items, defensively."""
    ev = row.get("evidence")
    if not isinstance(ev, list):
        return []
    return [item for item in ev if isinstance(item, dict)]


def evidence_cite_blob(item: dict[str, Any]) -> str:
    """Concatenate every text-like field on a single evidence item except
    `source_file`. We deliberately exclude source_file so file-path tokens
    cannot leak into the "row keyword" match."""
    parts: list[str] = []
    for k, v in item.items():
        if k == "source_file":
            continue
        parts.append(flatten(v))
    return norm(" ".join(parts))


def has_file_match(src: str, file_substrings: list[str]) -> bool:
    src_n = norm(src)
    return any(f.lower() in src_n for f in file_substrings if f)


def has_keyword_match(blob: str, keywords: list[str]) -> bool:
    if not keywords:
        return True  # no keyword requirement set → vacuously satisfied
    return any(k.lower() in blob for k in keywords if k)


def emit(reward_path: Path, task_id: str, checks: list[dict[str, Any]]) -> int:
    passed = sum(1 for c in checks if c.get("passed"))
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_id,
        "reward": score,
        "score": score,
        "passed": total > 0 and passed == total,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "source": "v2_direct_verifier",
    }
    reward_path.parent.mkdir(parents=True, exist_ok=True)
    reward_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"score": score, "checks_passed": passed, "checks_total": total}, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", default="")
    parser.add_argument("--reward-json", required=True)
    args = parser.parse_args()

    task_dir = Path(args.task_dir).resolve()
    output_dir = Path(args.output_dir) if args.output_dir else task_dir / "outputs"
    reward_path = Path(args.reward_json)
    rubric = load_json(task_dir / "rubric.json") or {}
    task_id = rubric.get("task_id") or task_dir.name
    expected = load_json(task_dir / "private" / "expected_answer.json") or {}

    audit_path = output_dir / "variant_audit.json"
    matrix_path = output_dir / "revised_variation_matrix.csv"

    audit = load_json(audit_path)
    audit_valid = isinstance(audit, dict)
    if not audit_valid:
        audit = {}

    candidate_rows = read_csv(task_dir / "workspace" / "catalog" / "proposed_children.csv")
    expected_skus = {row.get("candidate_sku", "").strip() for row in candidate_rows if row.get("candidate_sku")}
    decisions = audit.get("candidate_decisions", []) if isinstance(audit, dict) else []
    by_sku = {
        str(row.get("candidate_sku", "")).strip(): row
        for row in decisions
        if isinstance(row, dict) and row.get("candidate_sku")
    }
    matrix_rows = read_csv(matrix_path)
    matrix_skus = {str(r.get("child_sku", "")).strip() for r in matrix_rows if r.get("child_sku")}

    checks: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Check 1 (R2 plumbing → setup_gate): variant_audit.json exists & parses
    # AND every proposed SKU appears exactly once with a valid decision enum.
    # Folds the old `variant_audit_json_exists_parseable` and
    # `all_candidate_skus_decided_once` atoms (pure AND).
    # ------------------------------------------------------------------
    decision_skus = [str(row.get("candidate_sku", "")).strip() for row in decisions if isinstance(row, dict)]
    duplicated = sorted({sku for sku in decision_skus if decision_skus.count(sku) > 1 and sku})
    missing = sorted(expected_skus - set(decision_skus))
    extra = sorted(set(decision_skus) - expected_skus)
    valid_decisions = {"accept", "reject", "needs_fix"}
    invalid = [
        sku
        for sku, row in by_sku.items()
        if str(row.get("decision", "")).strip().lower() not in valid_decisions
    ]
    decided_once_ok = (
        not missing and not extra and not duplicated and not invalid and len(by_sku) == len(expected_skus)
    )
    setup_ok = audit_valid and decided_once_ok
    if not audit_valid:
        setup_reason = "variant_audit.json missing or invalid"
    elif not decided_once_ok:
        setup_reason = f"decision-set malformed: missing={missing} extra={extra} duplicated={duplicated} invalid={invalid}"
    else:
        setup_reason = "ok: variant_audit.json parsed; all proposed SKUs decided exactly once with valid enums"
    add(checks, "setup_gate", setup_ok, setup_reason, "deterministic_exact")

    def decision(sku: str) -> str:
        return str(by_sku.get(sku, {}).get("decision", "")).strip().lower()

    # ------------------------------------------------------------------
    # Per-SKU decision checks (R3a: per-candidate classification is the hard
    # countable core competency → kept per-item). Loaded from
    # expected_answer.json; no hard-coded fallback.
    # ------------------------------------------------------------------
    decision_specs = expected.get("candidate_decision_checks") or []
    if not isinstance(decision_specs, list) or not decision_specs:
        # explicit failure mode rather than silent fallback
        add(
            checks,
            "expected_answer_decision_specs_present",
            False,
            "private/expected_answer.json is missing candidate_decision_checks[]",
            "deterministic_exact",
        )
    for item in decision_specs:
        if not isinstance(item, dict):
            continue
        check_id = str(item.get("check_id") or "").strip()
        sku = str(item.get("sku") or "").strip()
        allowed = {norm(v) for v in item.get("allowed_decisions", []) if norm(v)}
        if not (check_id and sku and allowed):
            continue
        d = decision(sku)
        add(
            checks,
            check_id,
            d in allowed,
            f"{sku} decision={d!r} (expected one of {sorted(allowed)})",
            "deterministic_exact",
        )

    # ------------------------------------------------------------------
    # Evidence grounding (R3 collapse): ONE documentation-discipline check
    # over all SKUs. For each SKU the agent must, for BOTH the signal and the
    # policy requirement, supply an evidence[] item whose source_file matches a
    # required file AND whose cite contains a row/clause-specific keyword.
    # Same strict same-item file+keyword matching as before; the 20 old atoms
    # (10 signal + 10 policy) fold into this single check by AND. Every failing
    # (sku, kind) pair is listed in `reason` for diagnosis.
    # ------------------------------------------------------------------
    evidence_per_sku = expected.get("evidence_per_sku") or {}
    required_policy_files = expected.get("required_policy_files") or []
    if not isinstance(required_policy_files, list):
        required_policy_files = []
    if not isinstance(evidence_per_sku, dict):
        evidence_per_sku = {}

    evidence_failures: list[str] = []
    for spec_item in decision_specs:
        if not isinstance(spec_item, dict):
            continue
        sku = str(spec_item.get("sku") or "").strip()
        if not sku:
            continue
        spec = evidence_per_sku.get(sku) or {}
        if not isinstance(spec, dict):
            spec = {}

        signal_check_id = str(spec.get("signal_evidence_check_id") or "").strip()
        policy_check_id = str(spec.get("policy_evidence_check_id") or "").strip()
        sig_files = [s for s in (spec.get("required_signal_files") or []) if isinstance(s, str)]
        sig_keywords = [s for s in (spec.get("required_signal_keywords_any") or []) if isinstance(s, str)]
        pol_keywords = [s for s in (spec.get("required_policy_keywords_any") or []) if isinstance(s, str)]

        candidate_row = by_sku.get(sku, {}) if isinstance(by_sku.get(sku), dict) else {}
        items = evidence_items(candidate_row)

        # Signal sub-check: at least one evidence item where source_file matches
        # a required signal file AND its cite contains a row-specific keyword.
        if signal_check_id:
            signal_pass = any(
                has_file_match(it.get("source_file", ""), sig_files)
                and has_keyword_match(evidence_cite_blob(it), sig_keywords)
                for it in items
            )
            if not signal_pass:
                evidence_failures.append(f"{sku}:signal")

        # Policy sub-check: at least one evidence item where source_file matches
        # a required policy file AND its cite contains a clause-specific keyword.
        if policy_check_id:
            policy_pass = any(
                has_file_match(it.get("source_file", ""), required_policy_files)
                and has_keyword_match(evidence_cite_blob(it), pol_keywords)
                for it in items
            )
            if not policy_pass:
                evidence_failures.append(f"{sku}:policy")

    evidence_ok = not evidence_failures
    add(
        checks,
        "evidence_grounding_correct",
        evidence_ok,
        (
            "ok: every decision cites a matching signal-row AND policy-clause"
            if evidence_ok
            else f"missing/weak evidence (source_file+cite) for: {sorted(evidence_failures)}"
        ),
        "deterministic_semantic",
    )

    # ------------------------------------------------------------------
    # Variation matrix consistency (R6 negative/consistency): strict equality,
    # no slack. Kept as its own check.
    # ------------------------------------------------------------------
    rejected = {sku for sku in expected_skus if decision(sku) == "reject"}
    should_include = {sku for sku in expected_skus if decision(sku) in {"accept", "needs_fix"}}
    core_accepted_skus = set(expected.get("core_accepted_skus") or [])

    matrix_ok = (
        bool(matrix_rows)
        and matrix_skus == should_include
        and core_accepted_skus.issubset(matrix_skus)
        and not (matrix_skus & rejected)
    )
    add(
        checks,
        "variation_matrix_consistent_with_decisions",
        matrix_ok,
        (
            f"matrix_skus={sorted(matrix_skus)} expected_should_include={sorted(should_include)} "
            f"rejected_in_matrix={sorted(matrix_skus & rejected)} "
            f"missing_from_matrix={sorted(should_include - matrix_skus)} "
            f"extra_in_matrix={sorted(matrix_skus - should_include)}"
        ),
        "deterministic_exact",
    )

    return emit(reward_path, task_id, checks)


if __name__ == "__main__":
    raise SystemExit(main())
