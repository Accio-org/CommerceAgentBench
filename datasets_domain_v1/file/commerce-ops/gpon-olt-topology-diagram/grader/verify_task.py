"""v2 verifier for file-commerce-ops-gpon-olt-topology-diagram.

Offline diagram. HTML+SVG / JSON / CSV / md.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from io import StringIO
from pathlib import Path
from typing import Any


HTML_NAME = "topology_diagram.html"
JSON_NAME = "topology_spec.json"
CSV_NAME = "topology_plan.csv"
NOTES_NAME = "design_notes.md"

# Required visible label groups.
# Each entry is a list of alternatives (OR). An alternative can be:
#   - a plain string: matches if present in the HTML text
#   - a tuple of strings: matches only if ALL parts are present (AND)
REQUIRED_HTML_LABEL_GROUPS = [
    ["GPON OLT 连接效果图"], ["机房"], ["mini GPON OLT"], ["PON-1"], ["红色指示灯"],
    ["一级分光器 1:4", ("一级", "1:4")],
    ["二级分光器 1:32", ("二级", "1:32")],
    ["4×1:32", "4x1:32", "4 × 1:32"],
    ["高速光纤"], ["馈线光纤"], ["配线光纤"],
    ["×128", "x128", "×  128"],
    ["住宅区"], ["ONU", "光猫"],
    ["上网/WiFi", "WiFi", "wifi"], ["电视/TV", "TV"], ["电话"],
]
REQUIRED_COMPONENTS = [
    "equipment_room", "mini_gpon_olt", "pon_1", "primary_splitter_1_4",
    "secondary_splitter_1_32_x4", "residential_area", "onu_nodes",
    "wifi_service", "tv_service", "phone_service",
]
CSV_REQUIRED_COLUMNS = ["layer", "component", "count", "ratio_or_capacity", "upstream", "downstream", "visual_label", "note"]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def check_html_no_remote_urls(p: Path) -> tuple[bool, str]:
    if not p.exists():
        return False, "missing"
    text = p.read_text(encoding="utf-8-sig")
    if "<svg" not in text.lower():
        return False, "no <svg>"
    allowed_namespace_urls = {
        "http://www.w3.org/2000/svg",
        "http://www.w3.org/1999/xlink",
    }
    urls = re.findall(r"https?://[^\"'\s>)]+", text)
    remote_urls = [u for u in urls if u not in allowed_namespace_urls]
    if remote_urls:
        return False, f"contains remote url(s): {remote_urls[:3]}"
    return True, f"size={len(text)}, has SVG, no remote"


def _alt_matches(alt, text: str, text_lower: str) -> bool:
    if isinstance(alt, tuple):
        return all(part in text or part.lower() in text_lower for part in alt)
    return alt in text or alt.lower() in text_lower


def check_html_required_labels(p: Path) -> tuple[bool, str]:
    if not p.exists():
        return False, "missing"
    text = p.read_text(encoding="utf-8-sig")
    text_lower = text.lower()
    missing_groups = []
    for group in REQUIRED_HTML_LABEL_GROUPS:
        if not any(_alt_matches(alt, text, text_lower) for alt in group):
            label = group[0] if isinstance(group[0], str) else "+".join(group[0])
            missing_groups.append(label)
    if missing_groups:
        return False, f"missing labels: {missing_groups[:5]}"
    return True, f"all {len(REQUIRED_HTML_LABEL_GROUPS)} labels present"


def check_topology_spec_basic(p: Path) -> tuple[bool, str, dict | None]:
    if not p.exists():
        return False, "missing", None
    try:
        data = load_json(p)
    except json.JSONDecodeError as e:
        return False, f"not parseable: {e}", None
    if not isinstance(data, dict):
        return False, "not a dict", None
    fails = []
    if data.get("layout_direction") != "left_to_right":
        fails.append(f"layout_direction={data.get('layout_direction')!r}")
    if data.get("reference_used") != "workspace/gpon_reference.jpg":
        fails.append(f"reference_used={data.get('reference_used')!r}")
    sa = str(data.get("split_architecture", ""))
    if not all(s in sa for s in ("1:4", "32", "128")):
        fails.append(f"split_architecture missing tokens: {sa!r}")
    if data.get("pon_ports_used") != 1:
        fails.append(f"pon_ports_used={data.get('pon_ports_used')!r}")
    if data.get("split_ratio") != "1:128":
        fails.append(f"split_ratio={data.get('split_ratio')!r}")
    if fails:
        return False, "; ".join(fails), data
    return True, "spec basic ok", data


def check_splitter_stages(data: dict) -> tuple[bool, str]:
    ss = data.get("splitter_stages", [])
    if not isinstance(ss, list):
        return False, "splitter_stages not a list"
    if "primary_1_4" not in ss or "secondary_1_32_x4" not in ss:
        return False, f"splitter_stages = {ss}, need both 'primary_1_4' and 'secondary_1_32_x4'"
    return True, "splitter_stages ok"


def check_components_complete(data: dict) -> tuple[bool, str]:
    comps = data.get("components", [])
    if not isinstance(comps, list):
        return False, "components not a list"
    missing = [c for c in REQUIRED_COMPONENTS if c not in comps]
    if missing:
        return False, f"missing: {missing}"
    return True, f"all {len(REQUIRED_COMPONENTS)} components present"


def check_links_three_segments(data: dict) -> tuple[bool, str]:
    links = data.get("links", [])
    if not isinstance(links, list) or len(links) < 3:
        return False, f"links length {len(links) if isinstance(links, list) else 'N/A'} < 3"
    text = json.dumps(links, ensure_ascii=False).lower()
    has_olt_to_primary = ("olt" in text or "pon-1" in text) and "primary" in text
    has_primary_to_secondary = "primary" in text and "secondary" in text
    has_secondary_to_residential = "secondary" in text and ("onu" in text or "residential" in text)
    if not (has_olt_to_primary and has_primary_to_secondary and has_secondary_to_residential):
        return False, f"missing link segments: olt2primary={has_olt_to_primary} primary2secondary={has_primary_to_secondary} secondary2residential={has_secondary_to_residential}"
    for i, link in enumerate(links):
        if not isinstance(link, dict):
            return False, f"links[{i}] not a dict"
        for f in ("from", "to", "kind"):
            v = link.get(f)
            if not isinstance(v, str) or not v.strip():
                return False, f"links[{i}].{f} empty"
    return True, f"{len(links)} links cover required segments"


def check_csv_header_and_min_rows(p: Path) -> tuple[bool, str, str]:
    if not p.exists():
        return False, "missing", ""
    try:
        text = p.read_text(encoding="utf-8-sig")
        reader = csv.DictReader(StringIO(text))
        rows = list(reader)
        if not reader.fieldnames:
            return False, "no header", text
        missing = [c for c in CSV_REQUIRED_COLUMNS if c not in reader.fieldnames]
        if missing:
            return False, f"missing columns: {missing}", text
        if len(rows) < 7:
            return False, f"only {len(rows)} rows < 7", text
    except Exception as e:
        return False, f"csv parse: {e}", ""
    return True, f"csv ok, {len(rows)} rows", text


def check_csv_data_covers_components(text: str) -> tuple[bool, str]:
    text_lower = text.lower()
    must_have = [
        ("OLT", "olt"), ("PON-1", "pon-1"), ("1:4",), ("1:32",), ("128",),
        ("WiFi", "wifi"), ("TV", "tv"), ("电话", "phone"),
    ]
    missing = []
    for group in must_have:
        if not any((alt in text or alt.lower() in text_lower) for alt in group):
            missing.append(group[0])
    if missing:
        return False, f"missing in csv: {missing}"
    return True, "csv covers components"


def check_design_notes(p: Path) -> tuple[bool, str]:
    if not p.exists():
        return False, "missing"
    text = p.read_text(encoding="utf-8-sig")
    if not text.strip():
        return False, "empty"
    if "gpon_reference.jpg" not in text:
        return False, "missing 'gpon_reference.jpg'"
    if "示意" not in text and "schematic" not in text.lower():
        return False, "missing schematic acknowledgment"
    return True, "notes reference gpon_reference.jpg and acknowledge schematic"


def check_outputs_dir_clean(output_dir: Path) -> tuple[bool, str]:
    expected = {HTML_NAME, JSON_NAME, CSV_NAME, NOTES_NAME}
    found = {p.name for p in output_dir.iterdir() if not p.name.startswith(".")}
    extras = found - expected
    if extras:
        return False, f"unexpected: {sorted(extras)}"
    return True, "outputs/ clean"


def run_llm_checks(
    llm_checks: list[dict],
    html_path: Path,
    json_path: Path,
    csv_path: Path,
    notes_path: Path,
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

    html_text = html_path.read_text(encoding="utf-8-sig")[:60000] if html_path.exists() else ""
    json_text = json_path.read_text(encoding="utf-8-sig")[:30000] if json_path.exists() else "{}"
    csv_text = csv_path.read_text(encoding="utf-8-sig")[:20000] if csv_path.exists() else ""
    notes_text = notes_path.read_text(encoding="utf-8-sig")[:10000] if notes_path.exists() else ""
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
        f"=== {JSON_NAME} ===\n{json_text}\n\n"
        f"=== {CSV_NAME} ===\n{csv_text}\n\n"
        f"=== {NOTES_NAME} ===\n{notes_text}\n"
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
    json_path = output_dir / JSON_NAME
    csv_path = output_dir / CSV_NAME
    notes_path = output_dir / NOTES_NAME

    rubric = load_json(task_dir / "rubric.json")
    checks_spec = rubric.get("checks", [])

    det: list[dict[str, Any]] = []

    # --- HTML: offline anti-cheat (SVG present, no remote URL) -----------------
    ok, reason = check_html_no_remote_urls(html_path)
    det.append({"id": "html_offline_svg_no_remote", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    # --- HTML: all required visible diagram labels ----------------------------
    ok, reason = check_html_required_labels(html_path)
    det.append({"id": "html_required_visible_labels", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    # --- topology_spec.json: one capability (R3 collinear collapse) -----------
    # The spec is one structured-construction skill validated across four facets:
    # top-level schema fields, two-stage splitter list, complete component set,
    # and the three link segments. Every facet is still validated internally; the
    # per-facet detail surfaces in `reason`.
    spec_fails: list[str] = []
    ok, reason, data = check_topology_spec_basic(json_path)
    if not ok:
        spec_fails.append(f"schema[{reason}]")
    if data is not None:
        ok, reason = check_splitter_stages(data)
        if not ok:
            spec_fails.append(f"splitter_stages[{reason}]")
        ok, reason = check_components_complete(data)
        if not ok:
            spec_fails.append(f"components[{reason}]")
        ok, reason = check_links_three_segments(data)
        if not ok:
            spec_fails.append(f"links[{reason}]")
    else:
        spec_fails.append("json unavailable for splitter_stages/components/links")
    det.append({
        "id": "topology_spec_correct",
        "passed": not spec_fails,
        "reason": "spec complete and correct" if not spec_fails else "; ".join(spec_fails),
        "check_type": "deterministic_exact",
    })

    # --- topology_plan.csv: one capability (R3 collinear collapse) ------------
    # CSV header/min-rows and required-component coverage are one skill:
    # "produce a correct device + link plan table". Both facets validated.
    csv_fails: list[str] = []
    ok, reason, csv_text = check_csv_header_and_min_rows(csv_path)
    if not ok:
        csv_fails.append(f"header/rows[{reason}]")
    if csv_text:
        ok, reason = check_csv_data_covers_components(csv_text)
        if not ok:
            csv_fails.append(f"coverage[{reason}]")
    else:
        csv_fails.append("csv unavailable for component coverage")
    det.append({
        "id": "topology_plan_csv_correct",
        "passed": not csv_fails,
        "reason": "csv plan complete and covers components" if not csv_fails else "; ".join(csv_fails),
        "check_type": "deterministic_exact",
    })

    # --- design_notes.md: schematic acknowledgment + reference ----------------
    ok, reason = check_design_notes(notes_path)
    det.append({"id": "design_notes_acknowledges_schematic", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    # --- outputs hygiene (R6 negative: no extra files) ------------------------
    if output_dir.exists():
        ok, reason = check_outputs_dir_clean(output_dir)
    else:
        ok, reason = False, "outputs/ dir missing"
    det.append({"id": "outputs_dir_clean", "passed": ok, "reason": reason, "check_type": "deterministic_exact"})

    llm_specs = [c for c in checks_spec if c.get("check_type") == "llm_judge_boolean"]
    private_dir = Path(os.environ.get("PRIVATE_DIR") or (task_dir / "private"))
    expected_facts_path = private_dir / "expected_facts.md"
    llm_results = run_llm_checks(llm_specs, html_path, json_path, csv_path, notes_path, expected_facts_path)

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
