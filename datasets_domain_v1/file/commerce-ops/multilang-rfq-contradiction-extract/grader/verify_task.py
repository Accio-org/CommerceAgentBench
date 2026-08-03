"""v2 verifier for file-commerce-ops-multilang-rfq-contradiction-extract.

Capacity-refactored emit layer (2026-06-09): the underlying per-RFQ
validation is unchanged; only the *grouping* of the emitted checks changed
so that ``checks_total`` reflects distinct capability units rather than
4 structural + 5 RFQ x 7 atomic explosion.

Emitted checks (9):
  - setup_gate            : R2 plumbing (file exists + parseable object +
                            exactly 5 RFQ entries + summary count >= 5)
  - language_detection    : R3 collapse of the 5 per-RFQ language checks
  - quantity_normalization: R3 collapse of the 5 per-RFQ quantity checks
  - incoterm_extraction   : R3 collapse of the 5 per-RFQ incoterm checks
  - contradiction_rfq_0N  : R3a/R4 per-RFQ core competency — each RFQ carries
                            a structurally different inconsistency (transit
                            physics / Incoterm semantics / BOM cost / container
                            logic / date math). For each RFQ this folds the
                            present+category+evidence+resolution atoms via AND.

Aggregation is pure AND of the same atoms the old schema emitted, so the
binary pass (all checks) is identical to the old schema. Per-item failure
detail is preserved in the ``reason`` strings.

Evidence uses list-of-lists semantics (all-of outer, any-of inner) to allow
agents to quote in original language or English. Resolution is any-of a curated
list of action keywords.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


RFQ_IDS = ["RFQ-01", "RFQ-02", "RFQ-03", "RFQ-04", "RFQ-05"]


# ---------- helpers ----------

def lower_str(value: Any) -> str:
    return str(value or "").strip().lower()


def find_rfq_entry(rfqs: list[Any], rfq_id: str) -> dict[str, Any] | None:
    for entry in rfqs:
        if isinstance(entry, dict) and str(entry.get("rfq_id", "")).strip().upper() == rfq_id.upper():
            return entry
    return None


def evidence_matches_all_inner_any(evidence: str, all_of_inner_any: list[list[str]]) -> bool:
    """Return True if `evidence` (case-insensitive) contains at least one
    phrase from each inner list."""
    text = lower_str(evidence)
    if not text:
        return False
    for inner in all_of_inner_any:
        if not isinstance(inner, list) or not inner:
            return False
        if not any(phrase.lower() in text for phrase in inner if isinstance(phrase, str)):
            return False
    return True


def resolution_contains_any(resolution: str, any_of: list[str]) -> bool:
    text = lower_str(resolution)
    if not text:
        return False
    return any(phrase.lower() in text for phrase in any_of if isinstance(phrase, str))


def coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):  # bool is a subclass of int — exclude it
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if abs(value - round(value)) < 1e-9:
            return int(round(value))
        return None
    if isinstance(value, str):
        s = value.strip().replace(",", "").replace(" ", "")
        if re.fullmatch(r"-?\d+", s):
            try:
                return int(s)
            except ValueError:
                return None
    return None


# ---------- main ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", default="")
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir).resolve()
    reward_path = Path(args.reward_json)
    reward_path.parent.mkdir(parents=True, exist_ok=True)
    output_dir = Path(args.output_dir) if args.output_dir else task_dir / "outputs"

    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    rubric = json.loads((task_dir / "rubric.json").read_text(encoding="utf-8-sig"))
    checks_spec = rubric.get("checks", [])

    expected_rfqs: dict[str, dict[str, Any]] = {
        str(r["rfq_id"]).upper(): r for r in expected.get("rfqs", [])
    }

    # Load agent output
    out_path = output_dir / "rfq_analysis.json"
    file_exists = out_path.exists()
    file_nonempty = file_exists and out_path.stat().st_size > 0

    parse_ok = False
    parse_error = ""
    payload: dict[str, Any] = {}
    if file_nonempty:
        try:
            raw = json.loads(out_path.read_text(encoding="utf-8-sig"))
            if isinstance(raw, dict):
                payload = raw
                parse_ok = True
            else:
                parse_error = f"top-level not object (got {type(raw).__name__})"
        except json.JSONDecodeError as exc:
            parse_error = str(exc)

    _rfqs_raw = payload.get("rfqs")
    rfqs_arr: list[Any] = _rfqs_raw if isinstance(_rfqs_raw, list) else []
    _summary_raw = payload.get("summary")
    summary: dict[str, Any] = _summary_raw if isinstance(_summary_raw, dict) else {}

    structural_top_ok = parse_ok and isinstance(_rfqs_raw, list) and isinstance(_summary_raw, dict)
    array_len_ok = len(rfqs_arr) == 5
    total_contradictions = coerce_int(summary.get("total_contradictions"))
    summary_count_ok = (total_contradictions is not None and total_contradictions >= 5)

    # ---------- atomic validators (logic UNCHANGED from the old schema) ----------

    def atom_setup() -> list[tuple[str, bool, str]]:
        atoms: list[tuple[str, bool, str]] = []
        # file exists / non-empty
        if not file_exists:
            atoms.append(("file", False, "file missing"))
        elif not file_nonempty:
            atoms.append(("file", False, "file empty"))
        else:
            atoms.append(("file", True, "ok"))
        # parseable object with required top-level keys
        if not parse_ok:
            atoms.append(("parse", False, f"parse error: {parse_error or 'unknown'}"))
        else:
            atoms.append(("parse", structural_top_ok,
                          "ok" if structural_top_ok else f"missing keys; got={list(payload.keys())}"))
        # rfqs[] length exactly 5
        atoms.append(("rfqs_len", array_len_ok,
                      f"len={len(rfqs_arr)}" if isinstance(rfqs_arr, list) else "rfqs not a list"))
        # summary.total_contradictions >= 5
        atoms.append(("summary_count", summary_count_ok,
                      f"total_contradictions={total_contradictions}"))
        return atoms

    def atom_field(rfq_id: str, field: str) -> tuple[bool, str]:
        """field in {'language','quantity','incoterm'}."""
        expected_rfq = expected_rfqs.get(rfq_id)
        if expected_rfq is None:
            return False, f"no expected ground truth for {rfq_id}"
        agent_entry = find_rfq_entry(rfqs_arr, rfq_id) if isinstance(rfqs_arr, list) else None
        if agent_entry is None:
            return False, f"no agent entry with rfq_id={rfq_id}"
        _n = agent_entry.get("normalized")
        normalized: dict[str, Any] = _n if isinstance(_n, dict) else {}

        if field == "language":
            got = lower_str(agent_entry.get("language"))
            want = lower_str(expected_rfq.get("language"))
            return got == want, f"got={got!r} want={want!r}"
        if field == "quantity":
            got = coerce_int(normalized.get("quantity_units"))
            want = int(expected_rfq["quantity_units"])
            return got == want, f"got={got!r} want={want}"
        if field == "incoterm":
            got = str(normalized.get("incoterm", "")).strip().upper()
            want = str(expected_rfq.get("incoterm", "")).strip().upper()
            return got == want, f"got={got!r} want={want!r}"
        return False, f"unknown field {field!r}"

    def atom_contradiction(rfq_id: str) -> list[tuple[str, bool, str]]:
        """Returns the 4 contradiction atoms for one RFQ:
        present / category / evidence / resolution (logic UNCHANGED)."""
        expected_rfq = expected_rfqs.get(rfq_id)
        if expected_rfq is None:
            return [(k, False, f"no expected ground truth for {rfq_id}")
                    for k in ("present", "category", "evidence", "resolution")]
        agent_entry = find_rfq_entry(rfqs_arr, rfq_id) if isinstance(rfqs_arr, list) else None
        if agent_entry is None:
            return [(k, False, f"no agent entry with rfq_id={rfq_id}")
                    for k in ("present", "category", "evidence", "resolution")]

        _c = agent_entry.get("contradictions")
        contradictions: list[Any] = _c if isinstance(_c, list) else []
        expected_contras = expected_rfq.get("expected_contradictions", [])

        atoms: list[tuple[str, bool, str]] = []

        # present
        atoms.append(("present", len(contradictions) >= 1, f"len={len(contradictions)}"))

        # category
        cat_ok = False
        cat_reason = ""
        for exp_c in expected_contras:
            want_cat = str(exp_c.get("category", "")).strip().lower()
            for ag in contradictions:
                if isinstance(ag, dict) and str(ag.get("category", "")).strip().lower() == want_cat:
                    cat_ok = True
                    cat_reason = f"matched category={want_cat}"
                    break
            if cat_ok:
                break
        if not cat_ok:
            wants = [str(c.get("category")) for c in expected_contras]
            gots = [str(c.get("category")) for c in contradictions if isinstance(c, dict)]
            cat_reason = f"want one of {wants}; got {gots}"
        atoms.append(("category", cat_ok, cat_reason))

        # evidence
        ev_ok = False
        for exp_c in expected_contras:
            want_cat = str(exp_c.get("category", "")).strip().lower()
            requirements = exp_c.get("evidence_contains_all_of", [])
            for ag in contradictions:
                if not isinstance(ag, dict):
                    continue
                if str(ag.get("category", "")).strip().lower() != want_cat:
                    continue
                if evidence_matches_all_inner_any(str(ag.get("evidence", "")), requirements):
                    ev_ok = True
                    break
            if ev_ok:
                break
        atoms.append(("evidence", ev_ok,
                      "evidence ok" if ev_ok
                      else "no contradiction entry matched both expected category and evidence requirements"))

        # resolution
        res_ok = False
        for exp_c in expected_contras:
            want_cat = str(exp_c.get("category", "")).strip().lower()
            keywords = exp_c.get("resolution_contains_any_of", [])
            for ag in contradictions:
                if not isinstance(ag, dict):
                    continue
                if str(ag.get("category", "")).strip().lower() != want_cat:
                    continue
                if resolution_contains_any(str(ag.get("suggested_resolution", "")), keywords):
                    res_ok = True
                    break
            if res_ok:
                break
        atoms.append(("resolution", res_ok,
                      "resolution ok" if res_ok
                      else "no contradiction entry matched expected category with a recognised resolution keyword"))

        return atoms

    # ---------- emit layer: aggregate atoms into capability checks ----------

    def chk(cid: str, atoms: list[tuple[str, bool, str]]) -> dict[str, Any]:
        ok = all(a[1] for a in atoms)
        if ok:
            reason = "ok"
        else:
            fails = [f"{a[0]}: {a[2]}" for a in atoms if not a[1]]
            reason = "; ".join(fails)
        return {"id": cid, "passed": ok, "reason": reason, "check_type": "deterministic_exact"}

    results: list[dict[str, Any]] = []

    # 1. setup_gate (R2)
    results.append(chk("setup_gate", atom_setup()))

    # 2-4. field-extraction skills, each collapsed across the 5 RFQs (R3 / R4)
    for cid, field in (("language_detection", "language"),
                       ("quantity_normalization", "quantity"),
                       ("incoterm_extraction", "incoterm")):
        atoms: list[tuple[str, bool, str]] = []
        for rfq_id in RFQ_IDS:
            ok, reason = atom_field(rfq_id, field)
            atoms.append((rfq_id, ok, reason))
        results.append(chk(cid, atoms))

    # 5-9. per-RFQ contradiction core competency (R3a/R4)
    for rfq_id in RFQ_IDS:
        num = rfq_id.split("-")[1]
        results.append(chk(f"contradiction_rfq_{num}", atom_contradiction(rfq_id)))

    passed_count = sum(1 for r in results if r["passed"])

    # checks_total comes from the rubric (must match the emitted ids)
    rubric_ids = [c["id"] for c in checks_spec]
    emitted_ids = [r["id"] for r in results]
    if rubric_ids and rubric_ids != emitted_ids:
        # surface a clear error rather than silently scoring against a stale rubric
        raise SystemExit(
            f"rubric/verifier check-id mismatch:\n  rubric={rubric_ids}\n  emitted={emitted_ids}"
        )

    total = len(results)
    score = passed_count / total if total > 0 else 0.0

    reward = {
        "schema_version": "2.0",
        "task_id": rubric.get("task_id"),
        "score": round(score, 4),
        "checks_passed": passed_count,
        "checks_total": total,
        "checks_breakdown": results,
        "reward": round(score, 4),
        "passed": passed_count == total,
        "source": "v2_checks_runner",
    }
    reward_path.write_text(json.dumps(reward, ensure_ascii=False, indent=2))
    print(json.dumps({k: reward[k] for k in ("score", "checks_passed", "checks_total")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
