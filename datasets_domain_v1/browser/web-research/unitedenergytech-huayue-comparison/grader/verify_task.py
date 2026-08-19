"""v2 verifier for browser-web-research-unitedenergytech-huayue-comparison.

Two-shop conversion benchmarking. 5 target screenshots + 5 benchmark screenshots + 2 reports.

Capacity refactor (2026-06-09): the verifier still computes the same 16 atomic
predicates (8 deterministic + 8 LLM-judge), byte-identical, but folds them into
11 capability-unit checks before emitting ``checks_breakdown`` (R1/R3/R4/R6 of
docs/check-granularity.md). Each folded check is an AND of its member atoms; the
per-atom detail survives in the ``reason`` string. Binary ``passed`` is
unchanged (all(atoms) == all(groups)).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


REPORT_NAME = "optimization_report.md"
COMPARISON_TABLE_NAME = "comparison_table.md"
PAGE_TYPES = ["home", "products", "pdp", "company_profile", "inquiry_path"]
TARGET_SCREENSHOTS = [f"target_{p}.png" for p in PAGE_TYPES]
BENCHMARK_SCREENSHOTS = [f"benchmark_{p}.png" for p in PAGE_TYPES]
ALL_DECLARED_SCREENSHOTS = TARGET_SCREENSHOTS + BENCHMARK_SCREENSHOTS
ALLOWED_ACCESS_STATUS = {"visited", "inaccessible", "search_result_only"}


# --- Internal LLM-judge atomic spec ----------------------------------------
# The eight atomic LLM questions, byte-identical to the descriptions that the
# rubric used to carry as ``llm_judge_boolean`` entries. The verifier drives the
# LLM judge from THIS list (not from rubric.json), so the prompt the judge sees
# is unchanged after the fold; the rubric now lists the folded capability groups
# instead. Keeping the questions here lets us fold two structural LLM atoms into
# one capability check while still asking the judge both questions.
LLM_ATOMIC_SPEC: list[dict[str, str]] = [
    {
        "id": "report_has_all_8_required_sections",
        "check_type": "llm_judge_boolean",
        "description": "Does optimization_report.md contain all 8 sections: 两站访问情况与主营判断 + unitedenergytech 当前运营问题 + huayuecorp 可借鉴点 + 5 维度对比 + 商详到商机转化优化 + 商机到订单转化优化 + 7/14/30 天保姆级整改清单 + 证据索引和访问限制说明?",
    },
    {
        "id": "comparison_table_has_5plus_dimension_rows",
        "check_type": "llm_judge_boolean",
        "description": "Does comparison_table.md contain a Markdown table with >=5 rows, each row having all required columns: 维度 + target 现状 + benchmark 做法 + 差距 + 优化建议? The 5 dimensions should cover 店铺结构/产品呈现/信任背书/询盘路径/商详页转化设计.",
    },
    {
        "id": "target_problems_diagnosed_concretely",
        "check_type": "llm_judge_boolean",
        "description": "Does the unitedenergytech 当前运营问题 section list >=3 specific problems, each tied to a screenshot or manifest observation (not generic '页面不够吸引人')?",
    },
    {
        "id": "pdp_to_lead_optimization_concrete",
        "check_type": "llm_judge_boolean",
        "description": "Does the 商详到商机转化优化 section provide >=3 concrete adjustments tied to specific PDP elements observed in target_pdp.png vs benchmark_pdp.png (e.g., 'add 3D viewer like benchmark', 'add MOQ panel above fold')? Reject vague boilerplate.",
    },
    {
        "id": "lead_to_order_optimization_concrete",
        "check_type": "llm_judge_boolean",
        "description": "Does the 商机到订单转化优化 section provide >=3 concrete adjustments tied to specific inquiry-path observations (e.g., 'reduce inquiry form fields from N to M', 'add response-time SLA badge')? Reject vague boilerplate.",
    },
    {
        "id": "action_plan_7_14_30_days_concrete",
        "check_type": "llm_judge_boolean",
        "description": "Does the 7/14/30 天保姆级整改清单 section have items grouped or labeled for all three timeframes, each with >=2 concrete actionable items? Each item should reference a specific page element to change.",
    },
    {
        "id": "no_local_seed_pool_terms",
        "check_type": "llm_judge_boolean",
        "description": "Yes/no: NEITHER report files NOR evidence_manifest.json contain forbidden terms: 'local_seed_only', 'seed_only', '本地池', '本地种子', 'local seed pool', 'local pool'.",
    },
    {
        "id": "no_login_or_inquiry_submission",
        "check_type": "llm_judge_boolean",
        "description": "Does the report avoid any mention of attempting login, sending inquiry/RFQ, submitting forms, contacting merchants, or messaging? Read-only browsing only (opening pages and screenshotting is OK).",
    },
]


# --- Fold map: capability group -> ordered list of atomic ids ----------------
# Pure AND aggregation (docs/check-granularity.md). Exact partition of all 16
# atomic ids. Order = the rubric.json order.
GROUPS: dict[str, list[str]] = {
    # R3: produced the three required deliverable artifacts in parseable form.
    "deliverables_present": [
        "optimization_report_exists",
        "comparison_table_exists",
        "evidence_manifest_exists_and_parseable",
    ],
    # R3: captured all 5 page-type screenshots per shop (or documented blockers).
    "evidence_screenshots_captured": [
        "target_screenshots_or_blocker",
        "benchmark_screenshots_or_blocker",
    ],
    # R3/R1: structured manifest correct — all fields complete + closed-set
    # access_status honest (deterministic anti-cheat on offline-pool markers).
    "manifest_well_formed": [
        "manifest_target_and_benchmark_fields_complete",
        "manifest_uses_only_allowed_access_status_values",
    ],
    # R6 negative: restraint — no extra files polluting outputs/.
    "outputs_dir_clean": [
        "outputs_dir_has_only_declared_files",
    ],
    # R3: required document structure (8 report sections + 5-dimension table).
    "report_structure_complete": [
        "report_has_all_8_required_sections",
        "comparison_table_has_5plus_dimension_rows",
    ],
    # R4: four distinct analytical capabilities, kept 1:1.
    "target_problems_diagnosed_concretely": ["target_problems_diagnosed_concretely"],
    "pdp_to_lead_optimization_concrete": ["pdp_to_lead_optimization_concrete"],
    "lead_to_order_optimization_concrete": ["lead_to_order_optimization_concrete"],
    "action_plan_7_14_30_days_concrete": ["action_plan_7_14_30_days_concrete"],
    # R6 negatives: two distinct anti-cheat restraints, kept separate.
    "no_local_seed_pool_terms": ["no_local_seed_pool_terms"],
    "no_login_or_inquiry_submission": ["no_login_or_inquiry_submission"],
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def is_valid_image(p: Path) -> bool:
    if not p.exists():
        return False
    try:
        try:
            from PIL import Image  # type: ignore
            with Image.open(p) as im:
                im.verify()
            return True
        except ImportError:
            head = p.read_bytes()[:8]
            return head.startswith(b"\x89PNG\r\n\x1a\n") or head[:2] == b"\xff\xd8" or head[:4] == b"GIF8"
    except Exception:
        return False


def check_md_exists(p: Path, label: str) -> tuple[bool, str]:
    if not p.exists():
        return False, f"missing {label}"
    if p.stat().st_size == 0:
        return False, f"{label} is empty"
    return True, f"size={p.stat().st_size}B"


def check_evidence_manifest(manifest_path: Path) -> tuple[bool, str, dict | None]:
    if not manifest_path.exists():
        return False, "missing file", None
    try:
        data = load_json(manifest_path)
    except json.JSONDecodeError as e:
        return False, f"not parseable: {e}", None
    if not isinstance(data, dict):
        return False, "not a dict", None
    for k in ("target", "benchmark"):
        if not isinstance(data.get(k), dict):
            return False, f"missing or non-object {k}", data
    cd = data.get("comparison_dimensions")
    if not isinstance(cd, list) or len(cd) < 5:
        return False, f"comparison_dimensions length {len(cd) if isinstance(cd, list) else 'N/A'}, need >=5", data
    return True, "manifest schema ok", data


def _shop_screenshots_or_blocker(shop: dict, shop_label: str, screenshots: list[str], output_dir: Path, evidence_dir: Path) -> tuple[bool, str]:
    all_ok = all(is_valid_image(evidence_dir / n) for n in screenshots)
    if all_ok:
        return True, f"all 5 {shop_label} screenshots valid"
    if shop.get("access_status") == "inaccessible":
        bs_dict = shop.get("blocker_screenshots", {})
        if isinstance(bs_dict, dict):
            for v in bs_dict.values():
                if isinstance(v, str) and v.strip():
                    bs_path = output_dir / v.strip() if v.startswith("evidence/") else evidence_dir / v.strip()
                    if is_valid_image(bs_path):
                        return True, f"{shop_label} inaccessible; blocker screenshot valid"
    missing = [n for n in screenshots if not is_valid_image(evidence_dir / n)]
    return False, f"missing/invalid {shop_label} screenshots: {missing}; access_status={shop.get('access_status')!r}"


def check_target_screenshots_or_blocker(evidence_dir: Path, manifest: dict | None, output_dir: Path) -> tuple[bool, str]:
    target = (manifest or {}).get("target", {})
    return _shop_screenshots_or_blocker(target, "target", TARGET_SCREENSHOTS, output_dir, evidence_dir)


def check_benchmark_screenshots_or_blocker(evidence_dir: Path, manifest: dict | None, output_dir: Path) -> tuple[bool, str]:
    benchmark = (manifest or {}).get("benchmark", {})
    return _shop_screenshots_or_blocker(benchmark, "benchmark", BENCHMARK_SCREENSHOTS, output_dir, evidence_dir)


def check_target_and_benchmark_fields_complete(manifest: dict) -> tuple[bool, str]:
    failures: list[str] = []
    for k in ("target", "benchmark"):
        shop = manifest.get(k, {})
        if not isinstance(shop, dict):
            failures.append(f"{k} not a dict")
            continue
        for f in ("url", "access_status", "main_category"):
            v = shop.get(f)
            if not isinstance(v, str) or not v.strip():
                failures.append(f"{k}.{f} empty")
                break
        ss_dict = shop.get("screenshots", {})
        if not isinstance(ss_dict, dict):
            failures.append(f"{k}.screenshots not a dict")
            continue
        for pt in PAGE_TYPES:
            if not isinstance(ss_dict.get(pt), str) or not ss_dict.get(pt, "").strip():
                failures.append(f"{k}.screenshots.{pt} empty")
                break
    if failures:
        return False, f"target/benchmark fields incomplete: {failures[:5]}{' …' if len(failures) > 5 else ''}"
    return True, "target and benchmark fields all present"


def check_access_status_values(manifest: dict) -> tuple[bool, str]:
    bad: list[str] = []
    for k in ("target", "benchmark"):
        shop = manifest.get(k, {})
        if isinstance(shop, dict):
            s = shop.get("access_status", "")
            if s not in ALLOWED_ACCESS_STATUS:
                bad.append(f"{k}.access_status={s!r}")
    if bad:
        return False, f"invalid access_status values: {bad}"
    return True, "all access_status valid"


def check_outputs_dir_clean(output_dir: Path) -> tuple[bool, str]:
    expected_root = {REPORT_NAME, COMPARISON_TABLE_NAME, "evidence_manifest.json", "evidence"}
    found_root = {p.name for p in output_dir.iterdir() if not p.name.startswith(".")}
    extras = found_root - expected_root
    if extras:
        return False, f"unexpected files/dirs in outputs/: {sorted(extras)}"
    evidence_dir = output_dir / "evidence"
    if evidence_dir.exists():
        expected_evidence = set(ALL_DECLARED_SCREENSHOTS) | {"blockers"}
        for p in evidence_dir.iterdir():
            if p.name.startswith("."):
                continue
            if p.name == "blockers" and p.is_dir():
                continue
            if p.name not in expected_evidence:
                return False, f"unexpected file in evidence/: {p.name}"
    return True, "outputs/ clean"


def run_llm_checks(
    llm_checks: list[dict],
    report_md: Path,
    comparison_table: Path,
    evidence_manifest_path: Path,
    expected_facts_path: Path | None = None,
) -> list[dict[str, Any]]:
    if not llm_checks:
        return []
    provider = os.environ.get("BENCH_LLM_JUDGE_PROVIDER")
    model = os.environ.get("BENCH_LLM_JUDGE_MODEL")
    if not provider or not model:
        return [{"id": c["id"], "passed": False, "reason": "BENCH_LLM_JUDGE_PROVIDER/MODEL not set",
                 "check_type": c.get("check_type", "llm_judge_boolean"), "llm_skipped": True} for c in llm_checks]

    try:
        from bench_core import llm_judge  # type: ignore
    except ImportError as exc:
        return [{"id": c["id"], "passed": False, "reason": f"llm_judge import failed: {exc}",
                 "check_type": c.get("check_type", "llm_judge_boolean"), "llm_skipped": True} for c in llm_checks]

    config = llm_judge.JudgeConfig(
        provider=provider, model=model,
        timeout_sec=int(os.environ.get("BENCH_LLM_JUDGE_TIMEOUT") or 240),
        base_url=os.environ.get("BENCH_LLM_JUDGE_BASE_URL"),
        api_key=os.environ.get("BENCH_LLM_JUDGE_API_KEY"),
    )

    report_text = report_md.read_text(encoding="utf-8-sig")[:60000] if report_md.exists() else ""
    cmp_text = comparison_table.read_text(encoding="utf-8-sig")[:30000] if comparison_table.exists() else ""
    try:
        manifest_text = evidence_manifest_path.read_text(encoding="utf-8-sig")[:50000] if evidence_manifest_path.exists() else "{}"
    except Exception:
        manifest_text = "{}"
    expected_facts_text = ""
    if expected_facts_path and expected_facts_path.exists():
        try:
            expected_facts_text = expected_facts_path.read_text(encoding="utf-8-sig")[:20000]
        except Exception:
            expected_facts_text = ""

    questions_block = "\n".join(f"  - id: {c['id']}\n    question: {c['description']}" for c in llm_checks)

    prompt = (
        "You are a strict benchmark verifier. Return JUDGE_SCHEMA `criteria: [{id, score, reason}]`. "
        "Each criterion is a strict YES/NO question: score = 1.0 if fully satisfied, 0.0 otherwise. "
        "Use exactly 1.0 or 0.0; no partial credit.\n\n"
        "Overall fields: `score` = sum/count of criteria; `passed` = (score >= 0.8); "
        "`summary` = one line; strengths/weaknesses can be short or empty.\n\n"
        "Criteria (return one criterion per id in SAME order):\n"
        f"{questions_block}\n\n"
        "Reference facts (ground truth context, agent did NOT see this):\n"
        f"{expected_facts_text or '(none provided)'}\n\n"
        "Agent deliverable — optimization report:\n"
        f"=== {REPORT_NAME} ===\n{report_text}\n\n"
        "Agent deliverable — comparison table:\n"
        f"=== {COMPARISON_TABLE_NAME} ===\n{cmp_text}\n\n"
        "Agent deliverable — evidence manifest:\n"
        f"=== evidence_manifest.json ===\n{manifest_text}\n"
    )

    try:
        judgment = llm_judge.run_llm_judge(config, prompt)
    except Exception as e:
        return [{"id": c["id"], "passed": False, "reason": f"llm call failed: {e}",
                 "check_type": c.get("check_type", "llm_judge_boolean"), "llm_skipped": True} for c in llm_checks]

    criteria = judgment.get("criteria") or []
    by_id: dict[str, dict] = {}
    for item in criteria:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            by_id[item["id"]] = item

    results: list[dict[str, Any]] = []
    for c in llm_checks:
        item = by_id.get(c["id"])
        if not item:
            results.append({"id": c["id"], "passed": False, "reason": "LLM omitted this criterion",
                            "check_type": c.get("check_type", "llm_judge_boolean")})
            continue
        try:
            score = float(item.get("score", 0))
        except (TypeError, ValueError):
            score = 0.0
        results.append({"id": c["id"], "passed": score >= 0.5, "reason": str(item.get("reason", ""))[:300],
                        "check_type": c.get("check_type", "llm_judge_boolean"), "llm_score": score})
    return results


def fold_atoms(atoms: dict[str, dict[str, Any]], checks_spec: list[dict]) -> list[dict[str, Any]]:
    """Fold the 16 atomic results into the capability groups defined by GROUPS.

    Pure AND aggregation: a group passes iff all its member atoms passed. The
    per-atom failure detail is surfaced in the group ``reason``. ``checks_spec``
    (rubric order) drives the emitted order and check_type. ``llm_skipped``
    propagates so an LLM-judge outage still folds to a failed group.
    """
    covered = [m for ms in GROUPS.values() for m in ms]
    assert sorted(covered) == sorted(atoms.keys()), (
        f"GROUPS partition mismatch: missing={set(atoms) - set(covered)} "
        f"extra={set(covered) - set(atoms)}"
    )

    out: list[dict[str, Any]] = []
    for spec in checks_spec:
        gid = spec["id"]
        members = GROUPS[gid]
        member_results = [atoms[m] for m in members]
        ok = all(bool(r.get("passed")) for r in member_results)
        skipped = any(r.get("llm_skipped") for r in member_results)
        if ok:
            if len(members) == 1:
                reason = str(member_results[0].get("reason", "ok"))
            else:
                reason = "; ".join(f"{m}: {member_results[i].get('reason', 'ok')}" for i, m in enumerate(members))
        else:
            failed = [
                f"{m}: {member_results[i].get('reason', 'fail')}"
                for i, m in enumerate(members)
                if not member_results[i].get("passed")
            ]
            reason = "; ".join(failed)
        rec: dict[str, Any] = {
            "id": gid,
            "passed": ok,
            "reason": reason[:400],
            "check_type": spec.get("check_type", member_results[0].get("check_type", "")),
            "folded_atoms": members,
        }
        if skipped:
            rec["llm_skipped"] = True
        out.append(rec)
    return out


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
    evidence_dir = output_dir / "evidence"
    report_md = output_dir / REPORT_NAME
    comparison_table = output_dir / COMPARISON_TABLE_NAME
    manifest_path = output_dir / "evidence_manifest.json"

    rubric = load_json(task_dir / "rubric.json")
    checks_spec = rubric.get("checks", [])

    # --- Compute all 8 deterministic atoms (predicates byte-identical) -------
    det: list[dict[str, Any]] = []

    ok, reason = check_md_exists(report_md, REPORT_NAME)
    det.append({"id": "optimization_report_exists", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason = check_md_exists(comparison_table, COMPARISON_TABLE_NAME)
    det.append({"id": "comparison_table_exists", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason, manifest = check_evidence_manifest(manifest_path)
    det.append({"id": "evidence_manifest_exists_and_parseable", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason = check_target_screenshots_or_blocker(evidence_dir, manifest, output_dir)
    det.append({"id": "target_screenshots_or_blocker", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason = check_benchmark_screenshots_or_blocker(evidence_dir, manifest, output_dir)
    det.append({"id": "benchmark_screenshots_or_blocker", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    if manifest is not None:
        ok, reason = check_target_and_benchmark_fields_complete(manifest)
    else:
        ok, reason = False, "manifest unavailable"
    det.append({"id": "manifest_target_and_benchmark_fields_complete", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    if manifest is not None:
        ok, reason = check_access_status_values(manifest)
    else:
        ok, reason = False, "manifest unavailable"
    det.append({"id": "manifest_uses_only_allowed_access_status_values", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    if output_dir.exists():
        ok, reason = check_outputs_dir_clean(output_dir)
    else:
        ok, reason = False, "outputs/ dir missing"
    det.append({"id": "outputs_dir_has_only_declared_files", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    # --- Compute all 8 LLM atoms (prompt/questions byte-identical) -----------
    private_dir = Path(os.environ.get("PRIVATE_DIR") or (task_dir / "private"))
    expected_facts_path = private_dir / "expected_facts.md"
    llm_results = run_llm_checks(LLM_ATOMIC_SPEC, report_md, comparison_table, manifest_path, expected_facts_path)

    # --- Fold 16 atoms -> capability groups (pure AND), emit in rubric order -
    atoms = {r["id"]: r for r in det + llm_results}
    ordered = fold_atoms(atoms, checks_spec)

    passed = sum(1 for r in ordered if r["passed"])
    total = len(ordered)
    score = passed / total if total > 0 else 0.0
    n_llm_skipped = sum(1 for r in ordered if r.get("llm_skipped"))

    reward = {
        "schema_version": "2.0", "task_id": rubric.get("task_id"),
        "score": round(score, 4), "checks_passed": passed, "checks_total": total,
        "llm_checks_skipped": n_llm_skipped, "checks_breakdown": ordered,
        "reward": round(score, 4), "passed": passed == total, "source": "v2_checks_runner",
    }
    reward_path.write_text(json.dumps(reward, ensure_ascii=False, indent=2))
    print(json.dumps({k: reward[k] for k in ("score", "checks_passed", "checks_total", "llm_checks_skipped")}))

    return 0


if __name__ == "__main__":
    sys.exit(main())
