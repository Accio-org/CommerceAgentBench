"""v2 verifier for browser-alibaba-yushengxm-shop-diagnosis.

Public-web shop diagnosis with 18 screenshots + structured peer manifest.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


REPORT_NAME = "shop_diagnosis_report.md"
TARGET_SCREENSHOTS = ["target_home.png", "target_products.png", "target_company_profile.png"]
ALIBABA_PEER_NAMES = [f"alibaba_peer_{i:02d}.png" for i in range(1, 11)]
INDEPENDENT_PEER_NAMES = [f"independent_peer_{i:02d}.png" for i in range(1, 6)]
ALL_DECLARED_SCREENSHOTS = TARGET_SCREENSHOTS + ALIBABA_PEER_NAMES + INDEPENDENT_PEER_NAMES
ALLOWED_ACCESS_STATUS = {"visited", "inaccessible", "search_result_only"}
FORBIDDEN_TERMS = ["local_seed_only", "seed_only", "本地池", "本地种子", "local seed pool", "local pool"]


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


def check_report_md_exists(report_md: Path) -> tuple[bool, str]:
    if not report_md.exists():
        return False, f"missing {report_md.name}"
    if report_md.stat().st_size == 0:
        return False, "report is empty"
    return True, f"size={report_md.stat().st_size}B"


def check_evidence_manifest(manifest_path: Path) -> tuple[bool, str, dict | None]:
    if not manifest_path.exists():
        return False, "missing file", None
    try:
        data = load_json(manifest_path)
    except json.JSONDecodeError as e:
        return False, f"not parseable: {e}", None
    if not isinstance(data, dict):
        return False, "manifest not a dict", None
    if not isinstance(data.get("target"), dict):
        return False, "target field is not an object", data
    ali = data.get("alibaba_peers")
    if not isinstance(ali, list) or len(ali) != 10:
        return False, f"alibaba_peers length {len(ali) if isinstance(ali, list) else 'N/A'}, need 10", data
    indep = data.get("independent_peers")
    if not isinstance(indep, list) or len(indep) != 5:
        return False, f"independent_peers length {len(indep) if isinstance(indep, list) else 'N/A'}, need 5", data
    return True, "manifest schema ok", data


def check_target_screenshots_or_blocker(evidence_dir: Path, manifest: dict | None) -> tuple[bool, str]:
    target = manifest.get("target") if isinstance(manifest, dict) else None
    target_dict = target if isinstance(target, dict) else {}
    all_target_ok = all(is_valid_image(evidence_dir / n) for n in TARGET_SCREENSHOTS)
    if all_target_ok:
        return True, "all 3 target screenshots valid"
    if target_dict.get("access_status") == "inaccessible":
        bs = target_dict.get("blocker_screenshot", "")
        if isinstance(bs, str) and bs.strip():
            blocker_p = evidence_dir.parent / bs.strip() if bs.startswith("evidence/") else evidence_dir / bs.strip()
            if is_valid_image(blocker_p):
                return True, "target inaccessible; blocker_screenshot valid"
    missing = [n for n in TARGET_SCREENSHOTS if not is_valid_image(evidence_dir / n)]
    return False, f"missing/invalid target screenshots: {missing}; access_status={target_dict.get('access_status')!r}"


def _check_peer_screenshots(evidence_dir: Path, peers: list, expected_names: list[str], peer_kind: str, output_dir: Path) -> tuple[bool, str]:
    failures: list[str] = []
    if len(peers) != len(expected_names):
        return False, f"{peer_kind}_peers length {len(peers)}, need {len(expected_names)}"
    for idx, peer in enumerate(peers):
        if not isinstance(peer, dict):
            failures.append(f"[{idx}] not a dict")
            continue
        peer_id = peer.get("id", f"<missing id idx{idx}>")
        ss_field = peer.get("screenshot", "")
        ss_path = output_dir / ss_field.strip() if isinstance(ss_field, str) and ss_field.startswith("evidence/") else evidence_dir / (ss_field if isinstance(ss_field, str) else "")
        if is_valid_image(ss_path):
            continue
        if peer.get("access_status") == "inaccessible":
            bs = peer.get("blocker_screenshot", "")
            if isinstance(bs, str) and bs.strip():
                bs_path = output_dir / bs.strip() if bs.startswith("evidence/") else evidence_dir / bs.strip()
                if is_valid_image(bs_path):
                    continue
        failures.append(f"[{peer_id}] no valid screenshot or blocker")
    if failures:
        return False, f"{peer_kind}_peers screenshot failures: {failures[:5]}{' …' if len(failures) > 5 else ''}"
    return True, f"all {len(peers)} {peer_kind}_peers have valid screenshot or blocker"


def check_alibaba_peer_screenshots_or_blockers(evidence_dir: Path, manifest: dict | None, output_dir: Path) -> tuple[bool, str]:
    peers = (manifest or {}).get("alibaba_peers", [])
    return _check_peer_screenshots(evidence_dir, peers, ALIBABA_PEER_NAMES, "alibaba", output_dir)


def check_independent_peer_screenshots_or_blockers(evidence_dir: Path, manifest: dict | None, output_dir: Path) -> tuple[bool, str]:
    peers = (manifest or {}).get("independent_peers", [])
    return _check_peer_screenshots(evidence_dir, peers, INDEPENDENT_PEER_NAMES, "independent", output_dir)


def check_peer_objects_have_required_fields(manifest: dict) -> tuple[bool, str]:
    required = ("id", "url", "access_status", "screenshot", "positioning", "reference_value")
    failures: list[str] = []
    for kind in ("alibaba_peers", "independent_peers"):
        for idx, peer in enumerate(manifest.get(kind, [])):
            if not isinstance(peer, dict):
                failures.append(f"{kind}[{idx}] not a dict")
                continue
            for f in required:
                v = peer.get(f)
                if not isinstance(v, str) or not v.strip():
                    failures.append(f"{kind}[{idx}].{f} empty")
                    break
    if failures:
        return False, f"peer fields missing: {failures[:5]}{' …' if len(failures) > 5 else ''}"
    return True, f"all peers have required fields"


def check_access_status_values(manifest: dict) -> tuple[bool, str]:
    bad: list[str] = []
    target = manifest.get("target", {})
    if isinstance(target, dict):
        s = target.get("access_status", "")
        if s not in ALLOWED_ACCESS_STATUS:
            bad.append(f"target.access_status={s!r}")
    for kind in ("alibaba_peers", "independent_peers"):
        for idx, peer in enumerate(manifest.get(kind, [])):
            if not isinstance(peer, dict):
                continue
            s = peer.get("access_status", "")
            if s not in ALLOWED_ACCESS_STATUS:
                bad.append(f"{kind}[{idx}].access_status={s!r}")
    if bad:
        return False, f"invalid access_status values: {bad[:5]}{' …' if len(bad) > 5 else ''}"
    return True, f"all access_status in allowed set"


def check_outputs_dir_clean(output_dir: Path) -> tuple[bool, str]:
    expected_root = {REPORT_NAME, "evidence_manifest.json", "evidence"}
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
        from real_replica_bench import llm_judge  # type: ignore
    except ImportError as exc:
        return [{"id": c["id"], "passed": False, "reason": f"llm_judge import failed: {exc}",
                 "check_type": c.get("check_type", "llm_judge_boolean"), "llm_skipped": True} for c in llm_checks]

    config = llm_judge.JudgeConfig(
        provider=provider, model=model,
        timeout_sec=int(os.environ.get("BENCH_LLM_JUDGE_TIMEOUT") or 240),
        base_url=os.environ.get("BENCH_LLM_JUDGE_BASE_URL"),
        api_key=os.environ.get("BENCH_LLM_JUDGE_API_KEY"),
    )

    report_text = report_md.read_text(encoding="utf-8-sig")[:80000] if report_md.exists() else ""
    try:
        manifest_text = evidence_manifest_path.read_text(encoding="utf-8-sig")[:60000] if evidence_manifest_path.exists() else "{}"
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
        "Agent deliverable — report:\n"
        f"=== {REPORT_NAME} ===\n{report_text}\n\n"
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


# --- Capacity-check granularity (R1–R7, docs/check-granularity.md) ---------
# The 17 historical atomic predicates are computed UNCHANGED below; we only
# fold them into 11 capability checks at the emit layer (pure AND aggregation,
# binary `passed` is byte-for-byte preserved — refold-validated on the 9-model
# release archive, 0 mismatch). Per-atom detail is preserved verbatim in each
# group's `reason`. No deterministic predicate is loosened; no LLM check is
# re-run — LLM atoms carry their archived/per-run judgment straight into the
# group AND. There is NO environment plumbing in this task (the agent generates
# every artifact from live web), so per R1 we do NOT fabricate a setup_gate;
# "produced the two deliverables" is itself a real capability.
#
# group id -> (check_type, [atom ids folded by AND])
GROUP_SPECS: list[tuple[str, str, list[str]]] = [
    # deterministic capability buckets
    ("deliverables_produced", "deterministic_exact", [
        "report_md_exists",
        "evidence_manifest_exists_and_parseable",
    ]),
    ("evidence_screenshots_complete", "deterministic_exact", [
        "target_screenshots_exist_or_blocker",
        "alibaba_peer_screenshots_or_blockers",
        "independent_peer_screenshots_or_blockers",
    ]),
    ("manifest_structured_correctly", "deterministic_exact", [
        "manifest_peer_objects_have_required_fields",
        "manifest_uses_only_allowed_access_status_values",
    ]),
    ("workspace_clean", "deterministic_exact", [  # R6 negative / restraint
        "outputs_dir_has_only_declared_files",
    ]),
    # LLM capability buckets (each a distinct content/judgment competence)
    ("report_has_all_8_required_sections", "llm_judge_boolean", [
        "report_has_all_8_required_sections",
    ]),
    ("target_diagnosis_covers_5_required_areas", "llm_judge_boolean", [
        "target_diagnosis_covers_5_required_areas",
    ]),
    ("peer_comparison_tables", "llm_judge_boolean", [  # R3: same table skill x2 peer sets
        "alibaba_peer_table_has_10_rows_with_required_columns",
        "independent_peer_table_has_5_rows_with_required_columns",
    ]),
    ("market_opportunity_analysis", "llm_judge_boolean", [  # R3: same analysis skill x2 markets
        "domestic_market_opportunity_specific",
        "international_market_opportunity_specific",
    ]),
    ("action_plan_7_30_90_days_concrete", "llm_judge_boolean", [
        "action_plan_7_30_90_days_concrete",
    ]),
    ("no_local_seed_pool_terms_in_report_or_manifest", "llm_judge_boolean", [  # R6 anti-cheat negative
        "no_local_seed_pool_terms_in_report_or_manifest",
    ]),
    ("no_login_or_inquiry_action", "llm_judge_boolean", [  # R6 anti-cheat negative
        "no_login_or_inquiry_action",
    ]),
]


def fold_atoms(atoms: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold the atomic check records into capability groups (AND aggregation).

    Each group passes iff every member atom passed. The group `reason`
    surfaces the per-atom detail so debugging signal is preserved. A group
    inherits `llm_skipped` if any member atom was skipped.
    """
    out: list[dict[str, Any]] = []
    for gid, ctype, members in GROUP_SPECS:
        parts = [atoms.get(mid) for mid in members]
        present = [p for p in parts if p is not None]
        group_ok = bool(present) and all(p.get("passed") for p in present)
        if not present:
            group_ok = False
        if len(members) == 1 and present:
            reason = str(present[0].get("reason", ""))
        else:
            reason = "; ".join(
                f"{(p.get('id') if p else mid)}={'ok' if (p and p.get('passed')) else 'FAIL'}"
                f"({str((p or {}).get('reason',''))[:120]})"
                for mid, p in zip(members, parts)
            )
        rec: dict[str, Any] = {"id": gid, "passed": group_ok, "reason": reason, "check_type": ctype}
        if any((p or {}).get("llm_skipped") for p in parts):
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
    manifest_path = output_dir / "evidence_manifest.json"

    rubric = load_json(task_dir / "rubric.json")
    checks_spec = rubric.get("checks", [])

    det: list[dict[str, Any]] = []

    ok, reason = check_report_md_exists(report_md)
    det.append({"id": "report_md_exists", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason, manifest = check_evidence_manifest(manifest_path)
    det.append({"id": "evidence_manifest_exists_and_parseable", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason = check_target_screenshots_or_blocker(evidence_dir, manifest)
    det.append({"id": "target_screenshots_exist_or_blocker", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    if manifest is not None:
        ok, reason = check_alibaba_peer_screenshots_or_blockers(evidence_dir, manifest, output_dir)
    else:
        ok, reason = False, "manifest unavailable"
    det.append({"id": "alibaba_peer_screenshots_or_blockers", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    if manifest is not None:
        ok, reason = check_independent_peer_screenshots_or_blockers(evidence_dir, manifest, output_dir)
    else:
        ok, reason = False, "manifest unavailable"
    det.append({"id": "independent_peer_screenshots_or_blockers", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    if manifest is not None:
        ok, reason = check_peer_objects_have_required_fields(manifest)
    else:
        ok, reason = False, "manifest unavailable"
    det.append({"id": "manifest_peer_objects_have_required_fields", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

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

    # LLM atoms still computed at the original rubric-question granularity; the
    # rubric file is the (folded) capability list, so drive the judge off the
    # canonical 9 atomic LLM questions defined here instead of the rubric.
    llm_specs = [
        {"id": "report_has_all_8_required_sections", "check_type": "llm_judge_boolean",
         "description": "Does outputs/shop_diagnosis_report.md contain all 8 sections (目标店铺访问情况与主营判断 + 目标店铺诊断 + 10 家阿里同行对标表 + 5 个独立站同行对标表 + 国内市场机会 + 国外市场机会 + 7/30/90 天行动清单 + 证据索引和访问限制说明), each with substantive content?"},
        {"id": "target_diagnosis_covers_5_required_areas", "check_type": "llm_judge_boolean",
         "description": "Does the 目标店铺诊断 section cover all 5 areas with concrete observations: 产品、页面、信任背书、询盘路径、痛点? Penalize generic advice not tied to evidence_manifest.json.target.key_observations."},
        {"id": "alibaba_peer_table_has_10_rows_with_required_columns", "check_type": "llm_judge_boolean",
         "description": "Does the 10 家阿里国际站同行对标表 section contain a table with 10 rows, each row having all 5 columns: id/URL/positioning/reference_value/差异 (vs target)? IDs must match alibaba_peer_01 through alibaba_peer_10 in the manifest."},
        {"id": "independent_peer_table_has_5_rows_with_required_columns", "check_type": "llm_judge_boolean",
         "description": "Does the 5 个独立站同行对标表 section contain a table with 5 rows, each row having all 5 columns: id/URL/positioning/reference_value/差异? IDs must match independent_peer_01 through independent_peer_05."},
        {"id": "domestic_market_opportunity_specific", "check_type": "llm_judge_boolean",
         "description": "Does the 国内市场机会 section contain >=2 concrete opportunities tied to the target shop's category (from manifest.target.main_category) with cited evidence — NOT generic 'B2B 平台机会大' boilerplate?"},
        {"id": "international_market_opportunity_specific", "check_type": "llm_judge_boolean",
         "description": "Does the 国外市场机会 section contain >=2 concrete opportunities tied to peers' positioning (from manifest.alibaba_peers / independent_peers) with cited evidence — NOT generic boilerplate?"},
        {"id": "action_plan_7_30_90_days_concrete", "check_type": "llm_judge_boolean",
         "description": "Does the 7/30/90 天行动清单 section have items grouped or labeled for all three timeframes (7-day, 30-day, 90-day), each with at least 2 actionable items? Vague items like '继续优化页面' do not count; needs concrete action targeting a specific element."},
        {"id": "no_local_seed_pool_terms_in_report_or_manifest", "check_type": "llm_judge_boolean",
         "description": "Yes/no: NEITHER report.md NOR evidence_manifest.json contains any of these forbidden terms: 'local_seed_only', 'seed_only', '本地池', '本地种子', 'local seed pool', 'local pool'. Answer 'no' if any of these appear."},
        {"id": "no_login_or_inquiry_action", "check_type": "llm_judge_boolean",
         "description": "Does the report avoid mentioning any login, inquiry submission, RFQ submission, contact-merchant, or messaging action? Pure read-only browsing only."},
    ]
    private_dir = Path(os.environ.get("PRIVATE_DIR") or (task_dir / "private"))
    expected_facts_path = private_dir / "expected_facts.md"
    llm_results = run_llm_checks(llm_specs, report_md, manifest_path, expected_facts_path)

    # Fold the 17 atomic predicates into the 11 capability checks (AND).
    atoms = {r["id"]: r for r in det + llm_results}
    folded = fold_atoms(atoms)

    by_id = {r["id"]: r for r in folded}
    ordered = [by_id.get(c["id"], {"id": c["id"], "passed": False, "reason": "no result", "check_type": c.get("check_type", "")}) for c in checks_spec]

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
