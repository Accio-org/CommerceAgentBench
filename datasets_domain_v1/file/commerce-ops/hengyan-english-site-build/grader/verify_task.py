"""v2 verifier for file-commerce-ops-hengyan-english-site-build.

Offline static website: HTML + CSS + JS + SVG + 2 traceability JSON.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


HTML_NAME = "index.html"
CSS_NAME = "css/style.css"
JS_NAME = "js/script.js"
SVG_NAME = "assets/hero-lifting.svg"
IMPL_MANIFEST_NAME = "implementation_manifest.json"
TRACEABILITY_NAME = "content_traceability.json"

REQUIRED_HTML_PRODUCT_TERMS = ["HENGYAN", "Overhead Crane", "Gantry Crane", "Electric Hoist", "Winch", "Jib Crane", "Crab Trolley"]
FORBIDDEN_HTML_PHRASES = ["CE Certified", "ISO Certified", "passed EU safety certifications"]
TRACEABILITY_REQUIRED_TOKENS = [
    "HY-OHC-20", "HY-GANTRY-32", "HY-EHOIST-5", "HY-WINCH-10",
    "HY-JIB-3", "HY-CRAB-16", "CASE-SEA-YARD", "NEWS-INQUIRY-CHECKLIST",
    "site_content_brief.json",
]
IMPL_MANIFEST_REQUIRED_TOKENS = ["css/style.css", "js/script.js", "hero-lifting.svg", "mock", "responsive"]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def check_all_artifacts_exist(output_dir: Path) -> tuple[bool, str]:
    expected = [HTML_NAME, CSS_NAME, JS_NAME, SVG_NAME, IMPL_MANIFEST_NAME, TRACEABILITY_NAME]
    missing = [n for n in expected if not (output_dir / n).exists()]
    if missing:
        return False, f"missing: {missing}"
    return True, "all 6 artifact files exist"


def check_html_local_refs_no_remote(html_path: Path) -> tuple[bool, str]:
    if not html_path.exists():
        return False, "html missing"
    text = html_path.read_text(encoding="utf-8-sig")
    if not text.strip():
        return False, "html empty"
    for ref in ("css/style.css", "js/script.js", "assets/hero-lifting.svg"):
        if ref not in text:
            return False, f"html missing local ref: {ref}"
    for pat in (r"http://", r"https://"):
        if re.search(pat, text):
            return False, f"contains remote URL: {pat}"
    return True, "all local refs present, no remote URLs"


def check_html_required_product_terms(html_path: Path) -> tuple[bool, str]:
    if not html_path.exists():
        return False, "html missing"
    text = html_path.read_text(encoding="utf-8-sig")
    missing = [t for t in REQUIRED_HTML_PRODUCT_TERMS if t not in text]
    if missing:
        return False, f"missing terms: {missing}"
    return True, "all product terms present"


def check_html_no_forbidden_phrases(html_path: Path) -> tuple[bool, str]:
    if not html_path.exists():
        return False, "html missing"
    text = html_path.read_text(encoding="utf-8-sig")
    found = [p for p in FORBIDDEN_HTML_PHRASES if p in text]
    if found:
        return False, f"forbidden phrases: {found}"
    return True, "no forbidden phrases"


def check_css_features(css_path: Path) -> tuple[bool, str]:
    if not css_path.exists():
        return False, "css missing"
    text = css_path.read_text(encoding="utf-8-sig")
    if not text.strip():
        return False, "css empty"
    if "@media" not in text:
        return False, "missing @media"
    if not (re.search(r"display\s*:\s*(grid|flex)", text)):
        return False, "missing display: grid/flex"
    if not (re.search(r":focus|focus-visible", text)):
        return False, "missing :focus / focus-visible"
    return True, "css features ok"


def check_js_features(js_path: Path) -> tuple[bool, str]:
    if not js_path.exists():
        return False, "js missing"
    text = js_path.read_text(encoding="utf-8-sig")
    if not text.strip():
        return False, "js empty"
    fails = []
    if "mousemove" not in text:
        fails.append("missing mousemove")
    if "submit" not in text:
        fails.append("missing submit")
    if "preventDefault" not in text:
        fails.append("missing preventDefault")
    if "filter" not in text:
        fails.append("missing filter")
    if not (re.search(r"keydown|aria-expanded|keyup", text)):
        fails.append("missing keyboard hook (keydown/aria-expanded/keyup)")
    if fails:
        return False, "; ".join(fails)
    return True, "js features ok"


def check_svg_features(svg_path: Path) -> tuple[bool, str]:
    if not svg_path.exists():
        return False, "svg missing"
    text = svg_path.read_text(encoding="utf-8-sig")
    if not text.strip():
        return False, "svg empty"
    if "<svg" not in text.lower():
        return False, "no <svg> tag"
    if not re.search(r"crane|hook|hoist|beam", text, re.IGNORECASE):
        return False, "missing crane/hook/hoist/beam element"
    return True, "svg has <svg> tag and crane element"


def check_implementation_manifest(manifest_path: Path) -> tuple[bool, str]:
    if not manifest_path.exists():
        return False, "missing"
    try:
        data = load_json(manifest_path)
    except json.JSONDecodeError as e:
        return False, f"not parseable: {e}"
    if not isinstance(data, dict):
        return False, "not dict"
    sections = data.get("sections")
    if not isinstance(sections, list) or len(sections) < 6:
        return False, f"sections len={len(sections) if isinstance(sections, list) else 'N/A'} < 6"
    if data.get("backend_required") is not False:
        return False, f"backend_required={data.get('backend_required')!r}, expected false"
    text = json.dumps(data, ensure_ascii=False)
    missing = [t for t in IMPL_MANIFEST_REQUIRED_TOKENS if t not in text]
    if missing:
        return False, f"missing tokens: {missing}"
    return True, "manifest schema ok"


def check_traceability_required_ids(t_path: Path) -> tuple[bool, str]:
    if not t_path.exists():
        return False, "missing"
    try:
        text = t_path.read_text(encoding="utf-8-sig")
        load_json(t_path)
    except json.JSONDecodeError as e:
        return False, f"not parseable: {e}"
    missing = [t for t in TRACEABILITY_REQUIRED_TOKENS if t not in text]
    if missing:
        return False, f"missing tokens: {missing}"
    return True, "traceability has all required IDs"


def check_outputs_dir_clean(output_dir: Path) -> tuple[bool, str]:
    expected_root = {"index.html", "css", "js", "assets", "implementation_manifest.json", "content_traceability.json"}
    found_root = {p.name for p in output_dir.iterdir() if not p.name.startswith(".")}
    extras = found_root - expected_root
    if extras:
        return False, f"unexpected: {sorted(extras)}"
    for sub, expected_files in [
        ("css", {"style.css"}),
        ("js", {"script.js"}),
        ("assets", {"hero-lifting.svg"}),
    ]:
        sub_dir = output_dir / sub
        if sub_dir.exists():
            found_sub = {p.name for p in sub_dir.iterdir() if not p.name.startswith(".")}
            extras_sub = found_sub - expected_files
            if extras_sub:
                return False, f"unexpected in {sub}/: {sorted(extras_sub)}"
    return True, "outputs/ clean"


def run_llm_checks(
    llm_checks: list[dict],
    html_path: Path,
    css_path: Path,
    js_path: Path,
    impl_path: Path,
    trace_path: Path,
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

    html_text = html_path.read_text(encoding="utf-8-sig")[:30000] if html_path.exists() else ""
    css_text = css_path.read_text(encoding="utf-8-sig")[:15000] if css_path.exists() else ""
    js_text = js_path.read_text(encoding="utf-8-sig")[:15000] if js_path.exists() else ""
    impl_text = impl_path.read_text(encoding="utf-8-sig")[:10000] if impl_path.exists() else "{}"
    trace_text = trace_path.read_text(encoding="utf-8-sig")[:10000] if trace_path.exists() else "{}"
    expected_facts_text = ""
    if expected_facts_path and expected_facts_path.exists():
        try:
            expected_facts_text = expected_facts_path.read_text(encoding="utf-8-sig")[:20000]
        except Exception:
            expected_facts_text = ""

    questions_block = "\n".join(f"  - id: {c['id']}\n    question: {c['description']}" for c in llm_checks)

    prompt = (
        "You are a strict benchmark verifier. Return JUDGE_SCHEMA `criteria: [{id, score, reason}]`. "
        "Each criterion is YES/NO: 1.0 if fully satisfied, 0.0 otherwise. No partial credit.\n\n"
        f"Criteria:\n{questions_block}\n\n"
        f"Reference facts:\n{expected_facts_text or '(none)'}\n\n"
        f"=== {HTML_NAME} ===\n{html_text}\n\n"
        f"=== {CSS_NAME} ===\n{css_text}\n\n"
        f"=== {JS_NAME} ===\n{js_text}\n\n"
        f"=== {IMPL_MANIFEST_NAME} ===\n{impl_text}\n\n"
        f"=== {TRACEABILITY_NAME} ===\n{trace_text}\n"
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
            results.append({"id": c["id"], "passed": False, "reason": "LLM omitted",
                            "check_type": c.get("check_type", "llm_judge_boolean")})
            continue
        try:
            score = float(item.get("score", 0))
        except (TypeError, ValueError):
            score = 0.0
        results.append({"id": c["id"], "passed": score >= 0.5, "reason": str(item.get("reason", ""))[:300],
                        "check_type": c.get("check_type", "llm_judge_boolean"), "llm_score": score})
    return results


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
    html_path = output_dir / HTML_NAME
    css_path = output_dir / CSS_NAME
    js_path = output_dir / JS_NAME
    svg_path = output_dir / SVG_NAME
    impl_path = output_dir / IMPL_MANIFEST_NAME
    trace_path = output_dir / TRACEABILITY_NAME

    rubric = load_json(task_dir / "rubric.json")
    checks_spec = rubric.get("checks", [])

    det: list[dict[str, Any]] = []

    # --- setup_gate (R2): all 6 deliverable files were produced. Pure
    #     file-presence plumbing — every per-artifact capability check below
    #     re-tests existence internally, so this carries no capability on its
    #     own; it is the precondition the agent must satisfy to be graded. ---
    ok, reason = check_all_artifacts_exist(output_dir) if output_dir.exists() else (False, "outputs/ missing")
    det.append({"id": "setup_gate", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    # --- index_html_correct (R1 collinear merge): one capability =
    #     "produce a correct, offline, content-complete homepage". Internal AND
    #     of (a) local css/js/svg refs present + no remote URLs, and (b) all
    #     required product terms present. Both are observations of the single
    #     "index.html is right" competence. ---
    html_fails: list[str] = []
    ok_refs, reason_refs = check_html_local_refs_no_remote(html_path)
    if not ok_refs:
        html_fails.append(f"refs/remote: {reason_refs}")
    ok_terms, reason_terms = check_html_required_product_terms(html_path)
    if not ok_terms:
        html_fails.append(f"terms: {reason_terms}")
    det.append({
        "id": "index_html_correct",
        "passed": not html_fails,
        "reason": "ok" if not html_fails else "; ".join(html_fails),
        "check_type": "deterministic_exact",
    })

    # --- anti-fabrication negative (R6): keep explicit. ---
    ok, reason = check_html_no_forbidden_phrases(html_path)
    det.append({"id": "html_no_forbidden_certification_phrases", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason = check_css_features(css_path)
    det.append({"id": "css_min_size_and_required_features", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason = check_js_features(js_path)
    det.append({"id": "js_min_size_and_required_features", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason = check_svg_features(svg_path)
    det.append({"id": "svg_min_size_and_crane_elements", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason = check_implementation_manifest(impl_path)
    det.append({"id": "implementation_manifest_schema_correct", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    ok, reason = check_traceability_required_ids(trace_path)
    det.append({"id": "content_traceability_required_product_and_case_ids", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    if output_dir.exists():
        ok, reason = check_outputs_dir_clean(output_dir)
    else:
        ok, reason = False, "outputs/ missing"
    det.append({"id": "outputs_dir_clean_no_extras", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    llm_specs = [c for c in checks_spec if c.get("check_type") == "llm_judge_boolean"]
    private_dir = Path(os.environ.get("PRIVATE_DIR") or (task_dir / "private"))
    expected_facts_path = private_dir / "expected_facts.md"
    llm_results = run_llm_checks(llm_specs, html_path, css_path, js_path, impl_path, trace_path, expected_facts_path)

    by_id = {r["id"]: r for r in det + llm_results}
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
