"""v2 verifier for file-commerce-ops-returns-dispute-evidence-pack.

Per-case atomic checks against return_decision.json. Ground truth lives in
private/expected_answer.json.

Cheat-resistance design (vs the prior version that scored 1.0 against pure
keyword soup with no file reading):

- No `term in flattened_blob` substring matching anywhere.
- No `len(text) > N` character-count proxies for "did real work".
- No global `all_text` blobs combining every output file.

Each per-case content check looks at a SPECIFIC field path. The unique-fact
phrase pool per case is restricted to facts that are NOT visible in the
agent-facing `files/returns/return_center_export.csv` and that are not
trivially derivable from the visible CSV row alone — so the agent must
actually read inspection / carrier / orders / messages and the SLA CSV.

Gated content checks:

- `evidence_anchor_real_file_with_unique_fact` (per case): at least one
  `evidence_items[]` entry pairs `source_file` with one of the canonical
  source files for this return AND puts one of that file's unique fact
  phrases into the same entry's `supports`.
- `decision_reason_includes_unique_fact` (per case): the case's
  `decision_reason` field contains at least one per-case unique fact phrase
  (proves the decision was grounded in real source data, not just a guess).
- `sla_notes_reference_case_or_hours` (per case): `sla_or_followup_notes`
  references the per-case `marketplace_case_id` (CASE-90X) or
  `sla_hours_remaining=<n>` value from
  `files/sla/marketplace_case_deadlines.csv`.
- `evidence_pack_md_includes_unique_fact_per_case` (cross-case): the
  evidence pack narrative cites at least one per-case unique phrase for
  each return.
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


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except OSError:
        return ""


def norm(value: Any) -> str:
    """Lowercase + collapse whitespace. For string-field substring lookups."""
    if value is None:
        return ""
    if isinstance(value, list):
        text = " ".join(norm(v) for v in value)
    elif isinstance(value, dict):
        text = " ".join(f"{k} {norm(v)}" for k, v in value.items())
    else:
        text = str(value)
    return re.sub(r"\s+", " ", text.lower()).strip()


def add(checks: list[dict[str, Any]], cid: str, passed: bool, reason: str, ctype: str) -> None:
    checks.append({"id": cid, "passed": bool(passed), "reason": reason, "check_type": ctype})


def normalize_source_file(raw: Any) -> str:
    """Normalize a source_file string to a relative path under files/.

    Strips leading slashes and any leading ``files/`` prefix the agent might
    or might not include, then re-adds a single canonical ``files/`` prefix.
    """
    s = str(raw or "").strip().lstrip("/")
    s = s.replace("\\", "/")
    s_low = s.lower()
    if s_low.startswith("workspace/"):
        s = s[len("workspace/"):]
    return f"workspace/{s}" if s else ""


def source_file_resolves(task_dir: Path, source_file: str) -> bool:
    """True iff source_file (already normalized to ``files/...``) maps to an
    actually-existing regular file inside ``task_dir/workspace/``."""
    if not source_file.startswith("workspace/"):
        return False
    rel = source_file[len("workspace/"):]
    if not rel:
        return False
    candidate = (task_dir / "workspace" / rel).resolve()
    files_root = (task_dir / "workspace").resolve()
    try:
        candidate.relative_to(files_root)
    except ValueError:
        return False
    return candidate.is_file()


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


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))
    except OSError:
        return []


def collect_unique_phrases(anchor_options: list[dict[str, Any]]) -> list[str]:
    """Flatten all fact_phrases_any across a case's anchor options."""
    out: list[str] = []
    seen: set[str] = set()
    for opt in anchor_options or []:
        for p in opt.get("fact_phrases_any") or []:
            ps = str(p).lower().strip()
            if ps and ps not in seen:
                seen.add(ps)
                out.append(ps)
    return out


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
    expected = load_json(task_dir / "private" / "expected_answer.json") or {}
    task_id = rubric.get("task_id") or task_dir.name

    expected_returns: list[str] = list(expected.get("all_return_ids") or [])
    if not expected_returns:
        expected_returns = sorted(
            row.get("return_id", "").strip()
            for row in read_csv_rows(task_dir / "workspace" / "returns" / "return_center_export.csv")
            if row.get("return_id")
        )
    return_decisions: dict[str, list[str]] = expected.get("return_decisions") or {}
    anchor_options: dict[str, list[dict[str, Any]]] = expected.get("evidence_anchor_options_by_return") or {}
    sla_anchors: dict[str, list[str]] = expected.get("sla_anchors_by_return") or {}
    forbidden_unsafe_terms: list[str] = [
        t.lower() for t in (expected.get("forbidden_unsafe_terms") or [])
    ]

    decision_path = output_dir / "return_decision.json"
    evidence_path = output_dir / "evidence_pack.md"
    response_path = output_dir / "customer_safe_response.md"
    decision_doc = load_json(decision_path)
    decisions = (
        decision_doc.get("case_decisions", []) if isinstance(decision_doc, dict) else []
    )
    by_return: dict[str, dict[str, Any]] = {}
    for row in decisions:
        if isinstance(row, dict):
            rid = str(row.get("return_id", "")).strip()
            if rid and rid not in by_return:
                by_return[rid] = row

    evidence_text_low = read_text(evidence_path).lower()
    response_text = read_text(response_path)
    response_low = response_text.lower()

    checks: list[dict[str, Any]] = []
    expected_set = set(expected_returns)

    # ---- Internal atomic validation (UNCHANGED logic) --------------------
    # Every atom below is computed exactly as before; only the EMIT layer is
    # aggregated per docs/check-granularity.md (R2 plumbing -> setup_gate,
    # R3 collinear-batch collapse, R3a per-case judgement core).

    # (a) Plumbing: output JSON parseable.
    json_ok = isinstance(decision_doc, dict)

    # (b) Coverage / restraint: exact return-id set (no missing, no extras).
    actual_set = set(by_return)
    missing = sorted(expected_set - actual_set)
    extra = sorted(actual_set - expected_set)
    cases_ok = not missing and not extra

    # (c) evidence_pack.md cites a per-case unique fact phrase for every
    #     return. Forces the narrative to be grounded in real source files.
    pack_per_case_hits: dict[str, str | None] = {}
    pack_per_case_pool_sizes: dict[str, int] = {}
    for rid in expected_returns:
        phrases = collect_unique_phrases(anchor_options.get(rid) or [])
        pack_per_case_pool_sizes[rid] = len(phrases)
        hit = next((p for p in phrases if p and p in evidence_text_low), None)
        pack_per_case_hits[rid] = hit
    pack_ok = (
        evidence_path.is_file()
        and all(pack_per_case_hits[rid] for rid in expected_returns)
    )

    # (d) customer_safe_response.md exists, mentions every return_id,
    #     no unsafe terms.
    referenced_in_response = [
        rid for rid in expected_returns if rid.lower() in response_low
    ]
    unsafe_hits = [t for t in forbidden_unsafe_terms if t in response_low]
    response_ok = (
        response_path.is_file()
        and set(referenced_in_response) == expected_set
        and not unsafe_hits
    )

    # (e) Per-case atoms: decision / evidence-anchor / decision-reason / sla.
    decision_ok_by_return: dict[str, bool] = {}
    decision_detail_by_return: dict[str, str] = {}
    anchor_ok_by_return: dict[str, bool] = {}
    anchor_detail_by_return: dict[str, str] = {}
    reason_ok_by_return: dict[str, bool] = {}
    reason_detail_by_return: dict[str, str] = {}
    sla_ok_by_return: dict[str, bool] = {}
    sla_detail_by_return: dict[str, str] = {}

    for rid in expected_returns:
        row = by_return.get(rid) or {}
        case_anchors = anchor_options.get(rid) or []
        unique_phrase_pool = collect_unique_phrases(case_anchors)

        # decision_in_allowed_set
        decision_actual = norm(row.get("decision"))
        allowed = {norm(d) for d in (return_decisions.get(rid) or []) if norm(d)}
        decision_ok = bool(decision_actual) and decision_actual in allowed
        decision_ok_by_return[rid] = decision_ok
        decision_detail_by_return[rid] = f"got={decision_actual!r} allowed={sorted(allowed)}"

        # evidence_items collection for this case
        raw_items = row.get("evidence_items")
        items: list[dict[str, Any]] = (
            [it for it in raw_items if isinstance(it, dict)]
            if isinstance(raw_items, list)
            else []
        )

        # evidence_anchor_real_file_with_unique_fact: at least one item has
        # source_file in the case's ground-truth file set AND supports
        # contains one of that file's unique fact phrases.
        anchor_pass = False
        anchor_reason = ""
        for it in items:
            sf_norm = normalize_source_file(it.get("source_file"))
            if not source_file_resolves(task_dir, sf_norm):
                continue
            supports_text = norm(it.get("supports"))
            if not supports_text:
                continue
            for opt in case_anchors:
                opt_sf = normalize_source_file(opt.get("source_file"))
                if sf_norm != opt_sf:
                    continue
                phrases = [str(p).lower() for p in (opt.get("fact_phrases_any") or [])]
                hit = next((p for p in phrases if p and p in supports_text), None)
                if hit:
                    anchor_pass = True
                    anchor_reason = f"hit source_file={sf_norm!r} phrase={hit!r}"
                    break
            if anchor_pass:
                break
        if not anchor_pass:
            opt_summary = [
                {
                    "source_file": normalize_source_file(o.get("source_file")),
                    "any_phrase_count": len(o.get("fact_phrases_any") or []),
                }
                for o in case_anchors
            ]
            anchor_reason = f"items_count={len(items)} required_one_of={opt_summary}"
        anchor_ok_by_return[rid] = anchor_pass
        anchor_detail_by_return[rid] = anchor_reason

        # decision_reason_includes_unique_fact: decision_reason contains at
        # least one per-case unique fact phrase.
        decision_reason_text = norm(row.get("decision_reason"))
        dr_hit = next((p for p in unique_phrase_pool if p and p in decision_reason_text), None)
        reason_ok_by_return[rid] = bool(dr_hit)
        reason_detail_by_return[rid] = (
            f"decision_reason={decision_reason_text[:120]!r} hit={dr_hit!r} pool_size={len(unique_phrase_pool)}"
        )

        # sla_notes_reference_case_or_hours: forces reading
        # files/sla/marketplace_case_deadlines.csv to map RET-id to CASE-id
        # or sla_hours_remaining.
        sla_notes_text = norm(row.get("sla_or_followup_notes"))
        sla_targets = [str(s).lower() for s in (sla_anchors.get(rid) or [])]
        sla_hit = next((t for t in sla_targets if t and t in sla_notes_text), None)
        sla_ok_by_return[rid] = bool(sla_hit)
        sla_detail_by_return[rid] = (
            f"sla_notes={sla_notes_text[:120]!r} hit={sla_hit!r} required_one_of={sla_targets}"
        )

    # ---- Emit layer (aggregated capability units) ------------------------
    # setup_gate first (R2: plumbing folds into one gate).
    add(
        checks,
        "setup_gate",
        json_ok,
        "return_decision.json parsed" if json_ok else "return_decision.json missing or invalid JSON",
        "setup_gate",
    )

    # Coverage / restraint — exact return-id set, no missing, no extras
    # (R6 negative; distinct capability, kept separate).
    add(
        checks,
        "all_return_cases_decided",
        cases_ok,
        f"missing={missing} extra={extra}",
        "deterministic_exact",
    )

    # Per-case decision judgement (R3a core: the hard per-case judgement is
    # the discriminating competency; kept per-return).
    for rid in expected_returns:
        suffix = rid.lower().replace("-", "_")
        add(
            checks,
            f"{suffix}_decision_correct",
            decision_ok_by_return[rid],
            decision_detail_by_return[rid],
            "deterministic_exact",
        )

    # Evidence grounding (R3 collinear collapse): one skill — ground every
    # case's decision in a real source file's unique fact — exercised across
    # the JSON evidence anchors, the decision_reason fields, and the
    # evidence_pack.md narrative. AND of all those atoms.
    grounding_failures: list[str] = []
    for rid in expected_returns:
        if not anchor_ok_by_return[rid]:
            grounding_failures.append(f"{rid}:anchor[{anchor_detail_by_return[rid]}]")
        if not reason_ok_by_return[rid]:
            grounding_failures.append(f"{rid}:decision_reason[{reason_detail_by_return[rid]}]")
        if pack_per_case_hits.get(rid) is None:
            grounding_failures.append(f"{rid}:evidence_pack_narrative")
    grounding_ok = (
        all(anchor_ok_by_return[rid] for rid in expected_returns)
        and all(reason_ok_by_return[rid] for rid in expected_returns)
        and pack_ok
    )
    grounding_reason = (
        "all evidence grounded in real source files"
        if grounding_ok
        else f"evidence_pack_exists={evidence_path.is_file()} failures={grounding_failures}"
    )
    add(
        checks,
        "evidence_grounding_correct",
        grounding_ok,
        grounding_reason,
        "deterministic_semantic",
    )

    # SLA referencing (R3 collinear collapse): one skill — read
    # sla/marketplace_case_deadlines.csv and map each RET to CASE-id /
    # sla_hours_remaining — across all returns. AND of per-case atoms.
    sla_failures = [rid for rid in expected_returns if not sla_ok_by_return[rid]]
    sla_all_ok = not sla_failures
    sla_reason = (
        "all cases reference per-case SLA case-id/hours"
        if sla_all_ok
        else f"missing/ungrounded SLA reference for: {sla_failures} "
        + "; ".join(f"{rid}->{sla_detail_by_return[rid]}" for rid in sla_failures)
    )
    add(
        checks,
        "sla_references_correct",
        sla_all_ok,
        sla_reason,
        "deterministic_exact",
    )

    # Customer-facing communication (distinct deliverable + safety skill).
    add(
        checks,
        "customer_response_safe_complete",
        response_ok,
        f"file_exists={response_path.is_file()} referenced_ids={referenced_in_response} unsafe_hits={unsafe_hits}",
        "deterministic_semantic",
    )

    return emit(reward_path, task_id, checks)


if __name__ == "__main__":
    raise SystemExit(main())
