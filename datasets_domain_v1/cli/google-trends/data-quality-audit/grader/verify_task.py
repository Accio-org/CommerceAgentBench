"""V2 verifier — see task.md for the contract.

Capacity-refactor (2026-06-08): the 15 atomic checks collapse to 5 capability
units (pure aggregation, binary `passed` unchanged — re-folded against the
9-model phoenix0140 release with 0 binary-pass mismatches). The fine-grained
per-item validation is unchanged; it just surfaces in the `reason` strings:

  setup_gate            output file present + parseable      (R2 plumbing)
  partial_data_correct  partial-data set + every per-set count  (R3 same-skill)
  empty_query_correct   empty-query criterion / scope          (R4)
  sub_floor_correct     sub-floor (slug, brand) scope          (R4)
  monopoly_correct      monopoly slug set + every leader_share  (R3 same-skill)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _check(check_id, passed, reason="", check_type="deterministic_exact"):
    return {
        "id": check_id,
        "passed": bool(passed),
        "reason": (reason if isinstance(reason, str) else json.dumps(reason))[:400],
        "check_type": check_type,
    }


PLANTED_WRONG_CHECK_IDS = (
    # Capability units whose ground truth differs from the draft / its source
    # results.json. An agent who copies the draft unchanged fails these.
    "partial_data_correct",  # draft drops set_headset (Slack PM "sunset" override)
    "empty_query_correct",   # draft adds 2024 baselines (buggy majority-zero empty rule)
    "monopoly_correct",      # draft adds speaker+headset (buggy scope, no date_range filter)
    "sub_floor_correct",     # draft adds 2024 zero-interest brands (buggy scope, no date_range filter)
)


def _emit(reward_json, task_id, checks, source):
    # Binary scoring: unique-answer tasks have unique correct outputs.
    # score = 1.0 only if every capability check passes; otherwise 0.0.
    # raw_score (passed/total) is kept for diagnostic purposes.
    p = sum(1 for c in checks if c["passed"])
    t = len(checks)
    raw_score = round(p / t, 4) if t else 0.0
    score = 1.0 if (t > 0 and p == t) else 0.0
    by_id = {c["id"]: c["passed"] for c in checks}
    planted_fixed = [cid for cid in PLANTED_WRONG_CHECK_IDS if by_id.get(cid) is True]
    planted_missed = [cid for cid in PLANTED_WRONG_CHECK_IDS if by_id.get(cid) is False]
    payload = {
        "schema_version": "2.0",
        "task_id": task_id,
        "score": score,
        "raw_score": raw_score,
        "checks_passed": p,
        "checks_total": t,
        "checks_breakdown": checks,
        "reward": score,
        "passed": p == t,
        "source": source,
        "planted_errors_fixed": planted_fixed,
        "planted_errors_missed": planted_missed,
        "planted_total": len(PLANTED_WRONG_CHECK_IDS),
    }
    Path(reward_json).parent.mkdir(parents=True, exist_ok=True)
    Path(reward_json).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("score", "raw_score", "checks_passed", "checks_total")}))


def _load_outputs_json(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def _norm(s):
    return (s or "").strip().lower() if isinstance(s, str) else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True); ap.add_argument("--output-dir", required=True); ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()
    task_dir = Path(args.task_dir); out_dir = Path(args.output_dir); rj = Path(args.reward_json)
    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    out_path = out_dir / "quality_audit.json"

    # --- setup_gate (R2): output file present + parseable ---
    # On setup_gate fail we still emit the full 5-check breakdown (each
    # downstream capability marked False) so `checks_total` is stable across
    # runs — otherwise the same task alternates between 1 and 5 total checks
    # depending on whether the agent wrote the output file, which breaks
    # capacity aggregation and report tables.
    def _all_missing(reason: str):
        return [
            _check("setup_gate", False, reason),
            _check("partial_data_correct", False, reason),
            _check("empty_query_correct", False, reason),
            _check("sub_floor_correct", False, reason),
            _check("monopoly_correct", False, reason),
        ]
    if not out_path.exists():
        _emit(rj, expected.get("task_id", "data-quality-audit"),
              _all_missing(f"missing {out_path.name}"), "v2_quality"); return 0
    actual = _load_outputs_json(out_path)
    if actual is None:
        _emit(rj, expected.get("task_id", "data-quality-audit"),
              _all_missing(f"{out_path.name} present but not valid JSON"), "v2_quality"); return 0
    checks = [_check("setup_gate", True, "output file present and parseable")]

    # --- partial_data_correct (R3): set match AND every per-set count ---
    a_pd = sorted([_norm(d.get("dataset_id")) for d in actual.get("partial_data_datasets", []) if isinstance(d, dict)])
    e_pd = sorted([_norm(d["dataset_id"]) for d in expected["partial_data_datasets"]])
    pd_set_ok = a_pd == e_pd
    a_pd_map = {_norm(d.get("dataset_id")): d.get("partial_data_week_count") for d in actual.get("partial_data_datasets", []) if isinstance(d, dict)}
    pd_count_fails = []
    for d in expected["partial_data_datasets"]:
        a_v = a_pd_map.get(_norm(d["dataset_id"]))
        try: a_v_i = int(a_v)
        except (TypeError, ValueError): a_v_i = None
        if a_v_i != d["partial_data_week_count"]:
            pd_count_fails.append(f"{d['dataset_id']}={a_v_i}≠{d['partial_data_week_count']}")
    pd_ok = pd_set_ok and not pd_count_fails
    pd_reason = "ok" if pd_ok else (
        ("" if pd_set_ok else f"set got={a_pd} expected={e_pd}; ")
        + ("" if not pd_count_fails else f"count fails: {pd_count_fails}")
    )
    checks.append(_check("partial_data_correct", pd_ok, pd_reason))

    # --- empty_query_correct (R4) ---
    a_eq = sorted([_norm(s) for s in actual.get("empty_query_datasets", [])])
    e_eq = sorted([_norm(s) for s in expected["empty_query_datasets"]])
    checks.append(_check("empty_query_correct", a_eq == e_eq, "ok" if a_eq == e_eq else f"got={a_eq} expected={e_eq}"))

    # --- sub_floor_correct (R4) ---
    a_sf = sorted({(_norm(d.get("slug")), _norm(d.get("brand"))) for d in actual.get("sub_floor_brand_presences", []) if isinstance(d, dict)})
    e_sf = sorted({(_norm(d["slug"]), _norm(d["brand"])) for d in expected["sub_floor_brand_presences"]})
    checks.append(_check("sub_floor_correct", a_sf == e_sf, "ok" if a_sf == e_sf else f"got={a_sf} expected={e_sf}"))

    # --- monopoly_correct (R3): slug set match AND every leader_share within ±0.02 ---
    a_mono = sorted({_norm(d.get("slug")) for d in actual.get("monopoly_datasets", []) if isinstance(d, dict)})
    e_mono = sorted({_norm(d["slug"]) for d in expected["monopoly_datasets"]})
    mono_set_ok = a_mono == e_mono
    a_mono_map = {_norm(d.get("slug")): d.get("leader_share") for d in actual.get("monopoly_datasets", []) if isinstance(d, dict)}
    mono_share_fails = []
    for d in expected["monopoly_datasets"]:
        try: a_ls = float(a_mono_map.get(_norm(d["slug"])))
        except (TypeError, ValueError): a_ls = None
        if not (a_ls is not None and abs(a_ls - d["leader_share"]) <= 0.02):
            mono_share_fails.append(f"{d['slug']}={a_ls}≠{d['leader_share']}±0.02")
    mono_ok = mono_set_ok and not mono_share_fails
    mono_reason = "ok" if mono_ok else (
        ("" if mono_set_ok else f"set got={a_mono} expected={e_mono}; ")
        + ("" if not mono_share_fails else f"share fails: {mono_share_fails}")
    )
    checks.append(_check("monopoly_correct", mono_ok, mono_reason))

    _emit(rj, expected["task_id"], checks, "v2_quality"); return 0


if __name__ == "__main__":
    sys.exit(main())
