"""v2 verifier for browser-web-research-seamless-tape-seo-title-pack.

Capacity-refactored (2026-06-09): the same atomic predicates are computed
internally (byte-identical to the pre-fold logic — see ``run_check``), then
aggregated by ``fold_atoms`` into 7 capability checks. ``new_check =
AND(member atoms)`` (pure aggregation), so the binary ``passed`` is unchanged.
Per-atom failures still surface in each group's ``reason`` string for
diagnosis. Grouping (see ``GROUP_ATOMS``):

  setup_gate                   — 4 deliverable files exist+non-empty + manifest exists + parses (R2)
  evidence_screenshots_captured— 7 required screenshots present, size>0 (R3, homogeneous)
  manifest_research_complete   — source/search url + competitors len==5 + 5 competitor key-sets + keyword_groups (R3/R1)
  titles_count_and_format      — 20 table rows + every title <=128 chars (R3)
  titles_contain_core_term     — every title hits a core term (R4, SEO keyword skill)
  titles_no_forbidden_efficacy — no title uses a high-risk efficacy term (R6, compliance restraint — marquee trap)
  listing_pack_complete        — 5 bullets + 10 search terms + A/B grouping + short-description (R3/R1)

LLM judge dropped per v2 design.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def _has_image(parent: Path, prefix: str, exts: list[str]) -> bool:
    for ext in exts:
        p = parent / f"{prefix}{ext}"
        if p.is_file() and p.stat().st_size > 0:
            return True
    return False


def _extract_titles_from_md(md_text: str) -> list[dict[str, str]]:
    """Find first Markdown table and parse its data rows."""
    lines = md_text.splitlines()
    rows: list[dict[str, str]] = []
    in_table = False
    header: list[str] = []
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not line.startswith("|"):
            in_table = False
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if not header:
            header = [c.strip() for c in cells]
            in_table = True
            continue
        if in_table and len(cells) == len(header):
            if all(set(c) <= set("-: ") for c in cells):
                continue
            rows.append({h: v for h, v in zip(header, cells)})
    return rows


def _count_bullets_in_section(md_text: str, section_pattern: str) -> int:
    """Find the section matching `section_pattern` (a heading or label) and count
    bullet point lines (`-` or `*`) until the next heading."""
    pattern = re.compile(section_pattern, re.I)
    lines = md_text.splitlines()
    section_start = None
    for i, raw in enumerate(lines):
        if pattern.search(raw):
            section_start = i + 1
            break
    if section_start is None:
        return 0
    cnt = 0
    for line in lines[section_start:]:
        s = line.strip()
        if re.match(r"^#{1,6}\s+\S", s):
            break
        if re.match(r"^[\-\*]\s+\S", s):
            cnt += 1
    return cnt


def _count_search_terms_in_section(md_text: str) -> int:
    """Find a 'search terms' section and count list items / table rows / numbered entries inside."""
    pattern = re.compile(r"(?im)^(#{1,6}.*search\s*terms.*|.*\bsearch terms\b.*)$")
    lines = md_text.splitlines()
    section_start = None
    for i, raw in enumerate(lines):
        if pattern.search(raw):
            section_start = i + 1
            break
    if section_start is None:
        return 0
    section_lines: list[str] = []
    for line in lines[section_start:]:
        s = line.strip()
        if re.match(r"^#{1,6}\s+\S", s):
            break
        section_lines.append(s)
    cnt = 0
    for s in section_lines:
        if re.match(r"^[\-\*]\s+\S", s):
            cnt += 1
        elif re.match(r"^\d+[\.\)]\s+\S", s):
            cnt += 1
        elif s.startswith("|") and not all(set(c) <= set("-: ") for c in s.strip("|").split("|")):
            cnt += 1
    return cnt


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

    core_terms = [t.lower() for t in expected["core_terms"]]
    high_risk = [t.lower() for t in expected["high_risk_forbidden_terms"]]
    image_exts = expected["evidence_image_extensions"]
    competitor_keys = expected["manifest_competitor_required_keys"]
    bullet_required = int(expected["listing_pack_required_bullet_count"])
    search_terms_required = int(expected["listing_pack_required_search_term_count"])
    title_count_required = int(expected["title_count_required"])
    title_max_chars = int(expected["title_max_chars"])
    ab_groups = expected["ab_grouping_regex_groups"]

    # File presence
    keyword_md = output_dir / "keyword_research.md"
    titles_md = output_dir / "titles.md"
    listing_md = output_dir / "listing_pack.md"
    manifest_json = output_dir / "evidence_manifest.json"
    evidence_dir = output_dir / "evidence"

    keyword_md_exists = keyword_md.exists() and keyword_md.stat().st_size > 0
    titles_md_exists = titles_md.exists() and titles_md.stat().st_size > 0
    listing_md_exists = listing_md.exists() and listing_md.stat().st_size > 0
    manifest_json_exists = manifest_json.exists() and manifest_json.stat().st_size > 0

    titles_text = titles_md.read_text(encoding="utf-8-sig") if titles_md_exists else ""
    listing_text = listing_md.read_text(encoding="utf-8-sig") if listing_md_exists else ""

    manifest_data: dict[str, Any] | None = None
    manifest_parseable = False
    if manifest_json_exists:
        try:
            parsed = json.loads(manifest_json.read_text(encoding="utf-8-sig"))
            if isinstance(parsed, dict):
                manifest_data = parsed
                manifest_parseable = True
        except Exception:
            manifest_parseable = False

    # Image existence
    image_present: dict[str, bool] = {}
    for prefix in expected["evidence_image_filenames"]:
        image_present[prefix] = _has_image(evidence_dir, prefix, image_exts) if evidence_dir.exists() else False

    # Parse titles table
    title_rows = _extract_titles_from_md(titles_text) if titles_text else []
    title_strings = [r.get("Title", "").strip() for r in title_rows]
    title_count_ok = len(title_strings) == title_count_required
    all_within_max = (
        len(title_strings) == title_count_required
        and all(len(t) <= title_max_chars for t in title_strings)
    )
    all_have_core = (
        len(title_strings) == title_count_required
        and all(any(ct in t.lower() for ct in core_terms) for t in title_strings)
    )
    no_high_risk = (
        len(title_strings) == title_count_required
        and not any(any(hr in t.lower() for hr in high_risk) for t in title_strings)
    )

    # listing_pack content — look for "Bullet points" / "卖点" section specifically
    bullet_count = _count_bullets_in_section(
        listing_text,
        r"(?im)^\s*#{0,6}\s*(.*\bbullet\s*points?\b.*|.*卖点.*|.*要点.*)$",
    )
    has_5_bullets = bullet_count == bullet_required
    search_terms_count = _count_search_terms_in_section(listing_text)
    has_10_search_terms = search_terms_count == search_terms_required
    has_ab_grouping = bool(re.search("|".join(re.escape(g) for g in ab_groups), listing_text, re.I))
    has_short_desc = bool(re.search(r"(short\s*description|短描述)", listing_text, re.I))

    def _competitor_entry_ok(entry: Any) -> bool:
        if not isinstance(entry, dict):
            return False
        for k in competitor_keys:
            v = entry.get(k)
            if v is None:
                return False
            if isinstance(v, str) and not v.strip():
                return False
            if isinstance(v, list) and not v:
                return False
        return True

    def run_check(cid: str) -> tuple[bool, str]:
        if cid == "keyword_research_md_exists":
            return keyword_md_exists, ("ok" if keyword_md_exists else "missing")
        if cid == "titles_md_exists":
            return titles_md_exists, ("ok" if titles_md_exists else "missing")
        if cid == "listing_pack_md_exists":
            return listing_md_exists, ("ok" if listing_md_exists else "missing")
        if cid == "evidence_manifest_json_exists":
            return manifest_json_exists, ("ok" if manifest_json_exists else "missing")

        m = re.match(r"^evidence_(.*)_image_exists$", cid)
        if m:
            prefix = m.group(1)
            return image_present.get(prefix, False), ("ok" if image_present.get(prefix) else f"missing image with prefix {prefix}")

        if cid == "evidence_manifest_parseable":
            return manifest_parseable, ("ok" if manifest_parseable else "json parse failed or not object")

        if not manifest_parseable or manifest_data is None:
            if cid in (
                "manifest_has_source_product_url",
                "manifest_has_search_url",
                "manifest_competitors_array_length_5",
                "manifest_keyword_groups_present",
            ):
                return False, "manifest parseable prerequisite failed"

        if cid == "manifest_has_source_product_url":
            sp = manifest_data.get("source_product") if isinstance(manifest_data, dict) else None
            ok = isinstance(sp, dict) and isinstance(sp.get("url"), str) and bool(sp.get("url").strip())
            return ok, "ok" if ok else "missing source_product.url"
        if cid == "manifest_has_search_url":
            sp = manifest_data.get("search") if isinstance(manifest_data, dict) else None
            ok = isinstance(sp, dict) and isinstance(sp.get("url"), str) and bool(sp.get("url").strip())
            return ok, "ok" if ok else "missing search.url"
        if cid == "manifest_competitors_array_length_5":
            comps = manifest_data.get("competitors") if isinstance(manifest_data, dict) else None
            return isinstance(comps, list) and len(comps) == 5, f"got len={len(comps) if isinstance(comps, list) else None}"
        if cid == "manifest_keyword_groups_present":
            kg = manifest_data.get("keyword_groups") if isinstance(manifest_data, dict) else None
            ok = (isinstance(kg, dict) and len(kg) > 0) or (isinstance(kg, list) and len(kg) > 0)
            return ok, "ok" if ok else "keyword_groups missing or empty"

        m = re.match(r"^manifest_competitor_(\d{2})_has_required_keys$", cid)
        if m:
            idx = int(m.group(1)) - 1
            comps = manifest_data.get("competitors") if isinstance(manifest_data, dict) else None
            if not isinstance(comps, list) or idx >= len(comps):
                return False, f"competitor[{idx}] not present"
            ok = _competitor_entry_ok(comps[idx])
            return ok, "ok" if ok else "missing one of required keys (url/screenshot/status/keywords)"

        if cid == "titles_md_has_20_data_rows_in_table":
            return title_count_ok, f"got {len(title_strings)} rows"
        if cid == "all_20_titles_within_128_chars":
            return all_within_max, f"got {len(title_strings)} rows; lengths={[len(t) for t in title_strings][:5]}..."
        if cid == "all_20_titles_contain_core_term":
            return all_have_core, "ok" if all_have_core else "some title missing core term"
        if cid == "no_title_contains_high_risk_efficacy_term":
            return no_high_risk, "ok" if no_high_risk else "some title contains forbidden risk term"

        if cid == "listing_pack_has_5_bullet_points":
            return has_5_bullets, f"max consecutive bullet run = {bullet_count}"
        if cid == "listing_pack_has_10_search_terms":
            return has_10_search_terms, f"got {search_terms_count} search terms in section"
        if cid == "listing_pack_mentions_ab_grouping":
            return has_ab_grouping, "ok" if has_ab_grouping else "no A/B grouping marker"
        if cid == "listing_pack_has_short_description_section":
            return has_short_desc, "ok" if has_short_desc else "no short description heading"

        return False, f"unknown check id {cid!r}"

    # --- Capacity fold (pure aggregation; group = AND of member atoms) ---
    # Each capability check folds the byte-identical per-atom predicates from
    # run_check(). A group passes iff ALL member atoms pass; the reason lists
    # any failing atoms (with their own reason) so diagnosis is unchanged.
    GROUP_ATOMS: dict[str, list[str]] = {
        "setup_gate": [
            "keyword_research_md_exists",
            "titles_md_exists",
            "listing_pack_md_exists",
            "evidence_manifest_json_exists",
            "evidence_manifest_parseable",
        ],
        "evidence_screenshots_captured": [
            "evidence_source_product_image_exists",
            "evidence_search_results_image_exists",
            "evidence_competitor_01_image_exists",
            "evidence_competitor_02_image_exists",
            "evidence_competitor_03_image_exists",
            "evidence_competitor_04_image_exists",
            "evidence_competitor_05_image_exists",
        ],
        "manifest_research_complete": [
            "manifest_has_source_product_url",
            "manifest_has_search_url",
            "manifest_competitors_array_length_5",
            "manifest_competitor_01_has_required_keys",
            "manifest_competitor_02_has_required_keys",
            "manifest_competitor_03_has_required_keys",
            "manifest_competitor_04_has_required_keys",
            "manifest_competitor_05_has_required_keys",
            "manifest_keyword_groups_present",
        ],
        "titles_count_and_format": [
            "titles_md_has_20_data_rows_in_table",
            "all_20_titles_within_128_chars",
        ],
        "titles_contain_core_term": [
            "all_20_titles_contain_core_term",
        ],
        "titles_no_forbidden_efficacy": [
            "no_title_contains_high_risk_efficacy_term",
        ],
        "listing_pack_complete": [
            "listing_pack_has_5_bullet_points",
            "listing_pack_has_10_search_terms",
            "listing_pack_mentions_ab_grouping",
            "listing_pack_has_short_description_section",
        ],
    }

    def fold_atoms(group_id: str) -> tuple[bool, str]:
        atom_ids = GROUP_ATOMS[group_id]
        failures: list[str] = []
        for aid in atom_ids:
            ok, reason = run_check(aid)
            if not ok:
                failures.append(f"{aid}: {reason}")
        if not failures:
            return True, "ok"
        return False, "; ".join(failures)

    results = []
    passed = 0
    for c in checks_spec:
        cid = c["id"]
        ok, reason = fold_atoms(cid)
        results.append({"id": cid, "passed": ok, "reason": reason, "check_type": c.get("check_type", "")})
        if ok:
            passed += 1

    total = len(checks_spec)
    score = passed / total if total > 0 else 0.0

    reward = {
        "schema_version": "2.0",
        "task_id": rubric.get("task_id"),
        "score": round(score, 4),
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": results,
        "reward": round(score, 4),
        "passed": passed == total,
        "source": "v2_checks_runner",
    }
    reward_path.write_text(json.dumps(reward, ensure_ascii=False, indent=2))
    print(json.dumps({k: reward[k] for k in ("score", "checks_passed", "checks_total")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
