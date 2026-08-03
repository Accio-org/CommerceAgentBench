"""V2 verifier for trends-csv-flatten (file + cli variants share this code).

Reads agent's outputs/trends_flat.csv, runs deterministic checks against
../private/expected_answer.json, emits v2 reward.json.

Check granularity (docs/check-granularity.md):
  This task applies ONE mechanical flatten transform to every weekly entry
  (epoch->ISO week, slug = id minus `set_`, brand = lowercased verbatim query,
  value = extracted_value, partial_data = 0/1). All 50 sampled-row probes
  exercise that single transform skill, so they collapse (R3) into ONE
  capability check `row_values_correct`; the verifier still validates every
  sampled row internally and lists failures in `reason`. Row completeness is a
  *distinct* capability (the BI-sample lure tempts dropping the partial week),
  so it stays its own check `all_rows_complete` (R5/negative). Two reachability
  probes fold into `setup_gate` (R2).

  M5 (lure) task: workspace/bi_reference_sample.csv is a ~12-row "format
  sample" that is subtly wrong vs the spec — brands are Title Case (spec:
  lowercase) and the partial-data week is omitted (spec: keep it). An agent who
  mimics the sample instead of the field spec fails:
    - all_rows_complete: dropping the partial week -> 2080 rows not 2120
    - row_values_correct: Title-Cased brand col -> key lookup misses every row
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


# Diagnostic-only planted-error tracking. These are the atomic ids (internal,
# pre-collapse) whose pass/fail signals whether the agent resisted the lure.
PLANTED_WRONG_CHECK_PREFIXES = ("row_",)
PLANTED_WRONG_CHECK_IDS = (
    "row_count_matches",
)


def _check(check_id: str, passed: bool, reason: str = "", check_type: str = "deterministic_exact") -> dict:
    return {
        "id": check_id,
        "passed": bool(passed),
        "reason": reason[:300] if isinstance(reason, str) else json.dumps(reason)[:300],
        "check_type": check_type,
    }


def _emit(reward_json: Path, task_id: str, checks: list[dict], atoms: list[dict] | None = None) -> dict:
    # Binary scoring: full credit only if every (collapsed) capability check passes.
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    raw_score = round(passed / total, 4) if total else 0.0
    score = 1.0 if (total > 0 and passed == total) else 0.0

    # Planted-error diagnostics are computed from the ATOMIC results so the
    # signal survives collapse; they are reporting-only and do not affect score.
    planted_fixed: list[str] = []
    planted_missed: list[str] = []
    for atom in (atoms or []):
        cid = atom["id"]
        if cid in PLANTED_WRONG_CHECK_IDS or any(cid.startswith(p) for p in PLANTED_WRONG_CHECK_PREFIXES):
            (planted_fixed if atom["passed"] else planted_missed).append(cid)

    payload = {
        "schema_version": "2.0",
        "task_id": task_id,
        "score": score,
        "raw_score": raw_score,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "reward": score,
        "passed": passed == total,
        "source": "v2_trends_csv_flatten",
        "planted_errors_fixed": planted_fixed,
        "planted_errors_missed": planted_missed,
        "planted_total": len(planted_fixed) + len(planted_missed),
    }
    reward_json.parent.mkdir(parents=True, exist_ok=True)
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("score", "raw_score", "checks_passed", "checks_total")}))
    return payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    reward_json = Path(args.reward_json)

    expected_path = task_dir / "private" / "expected_answer.json"
    if not expected_path.exists():
        return 0 if _emit(reward_json, "trends-csv-flatten",
                          [_check("setup_gate", False, "missing private/expected_answer.json")]) else 1
    expected = json.loads(expected_path.read_text(encoding="utf-8-sig"))

    csv_path = output_dir / "trends_flat.csv"

    # --- setup_gate (R2): output reachable + non-empty ------------------------
    # On setup_gate fail we still emit the full 5-check breakdown (each
    # downstream capability marked False) so `checks_total` is stable across
    # runs — otherwise the same task alternates between 1 and 5 total checks
    # depending on whether the agent wrote the CSV, which breaks capacity
    # aggregation and report tables.
    def _all_missing(reason: str):
        return [
            _check("setup_gate", False, reason),
            _check("header_correct", False, reason),
            _check("all_rows_complete", False, reason),
            _check("serialization_valid", False, reason),
            _check("row_values_correct", False, reason),
        ]
    if not csv_path.exists():
        _emit(reward_json, "trends-csv-flatten", _all_missing(f"missing {csv_path}"))
        return 0
    raw = csv_path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
    if not raw:
        _emit(reward_json, "trends-csv-flatten", _all_missing("csv file is empty"))
        return 0
    setup_gate = _check("setup_gate", True, "ok")

    # --- header_correct -------------------------------------------------------
    expected_header = expected["structure"]["header_line"]
    actual_header = raw[0].strip()
    header_chk = _check(
        "header_correct",
        actual_header == expected_header,
        "ok" if actual_header == expected_header
        else f"got={actual_header!r} expected={expected_header!r}",
    )

    data_lines = raw[1:]

    # --- all_rows_complete (R5/negative): no rows dropped (lure trap) ----------
    expected_total = expected["structure"]["total_data_rows"]
    rows_complete_chk = _check(
        "all_rows_complete",
        len(data_lines) == expected_total,
        "ok" if len(data_lines) == expected_total
        else f"got={len(data_lines)} expected={expected_total} (did you drop the partial-data week?)",
    )

    # --- serialization_valid: every line parses as 5 typed fields -------------
    parsed = {}
    parse_errors = 0
    for ln in data_lines:
        parts = ln.split(",")
        if len(parts) != 5:
            parse_errors += 1
            continue
        wk, sl, br, val, pd = parts
        try:
            v = int(val)
            p = int(pd)
        except ValueError:
            parse_errors += 1
            continue
        parsed[(sl, br, wk)] = (v, p)
    serialization_chk = _check(
        "serialization_valid",
        parse_errors == 0,
        "ok" if parse_errors == 0 else f"unparseable rows: {parse_errors}",
    )

    # --- row_values_correct (R3 collapse): each sampled row's flatten transform
    # Internally validate every sampled row; report the aggregate as one check.
    row_atoms: list[dict] = []
    row_failures: list[str] = []
    for sample in expected["sample_rows"]:
        wk, sl, br, val, pd = sample["expected"]
        idx = sample["row_index"]
        key = (sl, br, wk)
        check_id = f"row_{idx:04d}_{sl}_{br[:8].replace(' ', '_')}_{wk}"
        actual = parsed.get(key)
        if actual is None:
            row_atoms.append(_check(check_id, False, f"row not found in agent CSV: key={key}"))
            row_failures.append(f"{check_id}(missing)")
            continue
        a_val, a_pd = actual
        ok = a_val == val and a_pd == pd
        row_atoms.append(_check(
            check_id, ok,
            f"got=({a_val},{a_pd}) expected=({val},{pd})" if not ok else "ok",
        ))
        if not ok:
            row_failures.append(f"{check_id}(got=({a_val},{a_pd}) exp=({val},{pd}))")
    rows_correct_chk = _check(
        "row_values_correct",
        not row_failures,
        "ok" if not row_failures
        else f"{len(row_failures)}/{len(row_atoms)} sampled rows wrong: " + "; ".join(row_failures[:8]),
    )

    # Collapsed capability checks (binary pass identical to the pre-collapse AND).
    checks = [
        setup_gate,
        header_chk,
        rows_complete_chk,
        serialization_chk,
        rows_correct_chk,
    ]
    # Atomic results retained only for planted-error diagnostics (reporting-only).
    # row_count_matches is the original id of the completeness probe.
    atoms = [
        _check("row_count_matches", rows_complete_chk["passed"], rows_complete_chk["reason"]),
        *row_atoms,
    ]

    _emit(reward_json, "trends-csv-flatten", checks, atoms=atoms)
    return 0


if __name__ == "__main__":
    sys.exit(main())
