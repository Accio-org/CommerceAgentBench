"""v2 verifier for file-commerce-ops-marketplace-listing-claim-substantiation.

This task mixes deterministic evidence/accounting checks with a small set of
LLM-judge boolean checks for copy quality and evidence-bound reasoning.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


CLAIM_IDS = [f"CLM-{i:03d}" for i in range(1, 13)]
DECISION_TO_SUMMARY_FIELD = {
    "approve": "approved_claims",
    "revise": "revised_claims",
    "remove": "removed_claims",
    "needs_more_evidence": "needs_more_evidence_claims",
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def check_result(
    check_id: str,
    passed: bool,
    reason: str,
    check_type: str = "deterministic_exact",
    **extra: Any,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": check_id,
        "passed": bool(passed),
        "reason": reason,
        "check_type": check_type,
    }
    result.update(extra)
    return result


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalized_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower())


def path_is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def load_optional_json(path: Path) -> tuple[Any | None, str]:
    try:
        return load_json(path), "parseable"
    except json.JSONDecodeError as exc:
        return None, f"not parseable: {exc}"
    except OSError as exc:
        return None, f"read failed: {exc}"


def check_nonempty_file(path: Path) -> tuple[bool, str]:
    if not path.exists():
        return False, f"missing {path.name}"
    if path.stat().st_size <= 0:
        return False, f"{path.name} is empty"
    return True, f"size={path.stat().st_size}B"


def count_pdf_pages(path: Path) -> int:
    try:
        data = path.read_bytes()
    except OSError:
        return 0
    return len(re.findall(rb"/Type\s*/Page\b", data))


def get_claim_rows(claim_review: Any) -> list[dict[str, Any]]:
    if not isinstance(claim_review, dict):
        return []
    rows = claim_review.get("claim_decisions")
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def rows_by_claim_id(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        claim_id = clean_text(row.get("claim_id"))
        if claim_id and claim_id not in by_id:
            by_id[claim_id] = row
    return by_id


def decision_counts(rows: list[dict[str, Any]]) -> Counter[str]:
    return Counter(clean_text(row.get("decision")) for row in rows)


def check_outputs_dir_clean(output_dir: Path) -> tuple[bool, str]:
    if not output_dir.exists():
        return False, "outputs/ does not exist"
    expected = {"claim_review.json", "revised_listing.md", "evidence_manifest.json"}
    found = {p.name for p in output_dir.iterdir() if not p.name.startswith(".")}
    extras = sorted(found - expected)
    missing = sorted(expected - found)
    if extras or missing:
        details: list[str] = []
        if missing:
            details.append(f"missing={missing}")
        if extras:
            details.append(f"unexpected={extras}")
        return False, "; ".join(details)
    return True, "outputs/ contains exactly the declared deliverables"


def check_all_claim_ids_covered(rows: list[dict[str, Any]]) -> tuple[bool, str]:
    ids = [clean_text(row.get("claim_id")) for row in rows]
    missing = sorted(set(CLAIM_IDS) - set(ids))
    extra = sorted(set(ids) - set(CLAIM_IDS))
    duplicates = sorted({claim_id for claim_id in ids if claim_id and ids.count(claim_id) > 1})
    if missing or extra or duplicates or len(rows) != len(CLAIM_IDS):
        return False, f"missing={missing}, extra={extra}, duplicates={duplicates}, rows={len(rows)}"
    return True, "all 12 claim IDs covered exactly once"


def check_enum_clean(rows: list[dict[str, Any]], field: str, allowed: set[str]) -> tuple[bool, str]:
    invalid = sorted(
        {
            clean_text(row.get(field))
            for row in rows
            if clean_text(row.get(field)) not in allowed
        }
    )
    if invalid:
        return False, f"invalid {field}: {invalid}"
    return True, f"all {field} values are valid"


def check_summary_counts(claim_review: Any, counts: Counter[str]) -> tuple[bool, str]:
    if not isinstance(claim_review, dict) or not isinstance(claim_review.get("listing_compliance_summary"), dict):
        return False, "missing listing_compliance_summary object"
    summary = claim_review["listing_compliance_summary"]
    mismatches: list[str] = []
    for decision, field in DECISION_TO_SUMMARY_FIELD.items():
        actual_value = summary.get(field)
        if actual_value != counts.get(decision, 0):
            mismatches.append(f"{field}={actual_value!r}, expected {counts.get(decision, 0)}")
    if mismatches:
        return False, "; ".join(mismatches)
    return True, "summary counts match decisions"


def check_manifest_sources(manifest: Any, task_dir: Path, source_map: dict[str, str]) -> tuple[bool, str]:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("sources"), list):
        return False, "missing sources array"
    files_root = task_dir / "workspace"
    invalid: list[str] = []
    for idx, source in enumerate(manifest["sources"]):
        if not isinstance(source, dict):
            invalid.append(f"source[{idx}] not object")
            continue
        source_id = clean_text(source.get("source_id"))
        rel_file = clean_text(source.get("file"))
        if source_id not in source_map:
            invalid.append(f"source[{idx}] invalid source_id={source_id!r}")
            continue
        if not rel_file:
            invalid.append(f"{source_id} missing file")
            continue
        if rel_file != source_map[source_id]:
            invalid.append(f"{source_id} file={rel_file!r}, expected {source_map[source_id]!r}")
            continue
        file_path = task_dir / rel_file
        if not path_is_under(file_path, files_root) or not file_path.exists():
            invalid.append(f"{source_id} file does not exist under files/: {rel_file!r}")
    if invalid:
        return False, "; ".join(invalid[:6])
    return True, f"{len(manifest['sources'])} source entries reference valid local files"


def check_manifest_claim_ids(manifest: Any) -> tuple[bool, str]:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("sources"), list):
        return False, "missing sources array"
    invalid: list[str] = []
    for source in manifest["sources"]:
        if not isinstance(source, dict):
            continue
        source_id = clean_text(source.get("source_id"))
        used_for_claims = source.get("used_for_claims")
        if not isinstance(used_for_claims, list) or not used_for_claims:
            invalid.append(f"{source_id or '<unknown>'} missing used_for_claims")
            continue
        bad_ids = sorted({clean_text(claim_id) for claim_id in used_for_claims if clean_text(claim_id) not in CLAIM_IDS})
        if bad_ids:
            invalid.append(f"{source_id}: invalid claim IDs {bad_ids}")
    if invalid:
        return False, "; ".join(invalid[:6])
    return True, "all manifest used_for_claims entries are known claim IDs"


def check_manifest_quotes(manifest: Any) -> tuple[bool, str]:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("sources"), list):
        return False, "missing sources array"
    invalid: list[str] = []
    for source in manifest["sources"]:
        if not isinstance(source, dict):
            continue
        source_id = clean_text(source.get("source_id"))
        quoted_points = source.get("quoted_points")
        if not isinstance(quoted_points, list) or not any(clean_text(point) for point in quoted_points):
            invalid.append(source_id or "<unknown>")
    if invalid:
        return False, f"sources with empty quoted_points: {invalid[:8]}"
    return True, "all manifest sources include non-empty quoted_points"


def check_reference_files_are_substantial(task_dir: Path) -> tuple[bool, str]:
    html_path = task_dir / "workspace/source_pages/alibaba_product_page_snapshot.html"
    raw_html_path = task_dir / "workspace/source_pages/raw/alibaba_product_page_raw.html"
    image_asset_dir = task_dir / "workspace/source_pages/assets/alibaba_product_images"
    ftc_pdf = task_dir / "workspace/policies/full_reference/ftc_green_guides_16_cfr_part_260.pdf"
    amazon_pdf = task_dir / "workspace/policies/full_reference/amazon_listings_product_detail_page_guide.pdf"

    problems: list[str] = []
    if not html_path.exists() or html_path.stat().st_size < 20_000:
        size = html_path.stat().st_size if html_path.exists() else 0
        problems.append(f"Alibaba readable snapshot too small or missing: {size}B")
    else:
        html_text = html_path.read_text(encoding="utf-8-sig", errors="ignore")
        required_markers = [
            "Product image gallery",
            "Contact supplier",
            "Product overview",
            "Key features",
            "Product details",
            "Choose your model",
            "Product comparison",
        ]
        missing = [marker for marker in required_markers if marker not in html_text]
        if missing:
            problems.append(f"Alibaba readable snapshot missing markers: {missing}")
        data_uri_count = html_text.count("data:image/")
        if data_uri_count:
            problems.append(f"Alibaba readable snapshot still contains {data_uri_count} data-URI image payloads")
        img_srcs = re.findall(r"<img\b[^>]*\bsrc=[\"']([^\"']+)[\"']", html_text, flags=re.IGNORECASE)
        remote_img_srcs = [src for src in img_srcs if src.startswith(("http://", "https://", "//"))]
        if remote_img_srcs:
            problems.append(f"Alibaba readable snapshot still has remote image srcs: {remote_img_srcs[:3]}")
        local_product_images = {
            src
            for src in img_srcs
            if re.fullmatch(r"assets/alibaba_product_images/product_\d{2}\.jpg", src)
        }
        if len(local_product_images) < 6:
            problems.append(f"Alibaba readable snapshot references only {len(local_product_images)} local product images")
        if re.search(r"<script\b", html_text, flags=re.IGNORECASE):
            problems.append("Alibaba readable snapshot should not depend on scripts")
        remote_stylesheets = re.findall(
            r"<link\b[^>]*rel=[\"']stylesheet[\"'][^>]*href=[\"'](https?:)?//[^\"']+",
            html_text,
            flags=re.IGNORECASE,
        )
        if remote_stylesheets:
            problems.append("Alibaba readable snapshot still has remote stylesheet dependencies")

    image_problems: list[str] = []
    for idx in range(1, 7):
        image_path = image_asset_dir / f"product_{idx:02d}.jpg"
        if not image_path.exists() or image_path.stat().st_size < 50_000:
            size = image_path.stat().st_size if image_path.exists() else 0
            image_problems.append(f"{image_path.name}={size}B")
    if not (image_asset_dir / "manifest.jsonl").exists():
        image_problems.append("manifest.jsonl missing")
    if image_problems:
        problems.append(f"Alibaba local product image assets incomplete: {image_problems}")

    if not raw_html_path.exists() or raw_html_path.stat().st_size < 200_000:
        size = raw_html_path.stat().st_size if raw_html_path.exists() else 0
        problems.append(f"Alibaba raw HTML provenance too small or missing: {size}B")
    else:
        raw_text = raw_html_path.read_text(encoding="utf-8-sig", errors="ignore")
        if "window._PAGE_DATA_" not in raw_text or "Product details" not in raw_text:
            problems.append("Alibaba raw HTML provenance missing embedded page data markers")

    for path, expected_pages in [(ftc_pdf, 36), (amazon_pdf, 6)]:
        if not path.exists():
            problems.append(f"missing PDF {path.name}")
            continue
        try:
            head = path.read_bytes()[:5]
        except OSError as exc:
            problems.append(f"cannot read {path.name}: {exc}")
            continue
        pages = count_pdf_pages(path)
        if head != b"%PDF-" or pages != expected_pages:
            problems.append(f"{path.name}: header={head!r}, pages={pages}, expected={expected_pages}")

    if problems:
        return False, "; ".join(problems)
    return True, "Alibaba readable/raw HTML files, local product image assets, and both PDFs are substantial and parseable"


def quoted_text_for_source(manifest: Any, source_id: str) -> str:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("sources"), list):
        return ""
    parts: list[str] = []
    for source in manifest["sources"]:
        if not isinstance(source, dict) or clean_text(source.get("source_id")) != source_id:
            continue
        quoted_points = source.get("quoted_points")
        if isinstance(quoted_points, list):
            parts.extend(clean_text(point) for point in quoted_points)
    return " ".join(parts)


def check_manifest_pdf_locators(manifest: Any, requirements: dict[str, list[list[str]]]) -> tuple[bool, str]:
    del requirements
    missing: list[str] = []
    expectations = {
        "POL-FTC-GREEN": ["environment", "eco-friendly", "recycled", "260.4", "260.13"],
        "POL-FTC-NONTOXIC": ["non-toxic", "nontoxic", "260.10"],
        "POL-AMZ-DETAIL": ["price", "delivery", "reviews", "time-sensitive", "best seller", "new version", "another product"],
    }
    for source_id in ("POL-FTC-GREEN", "POL-FTC-NONTOXIC", "POL-AMZ-DETAIL"):
        text = normalized_text(quoted_text_for_source(manifest, source_id))
        if not text:
            missing.append(f"{source_id}: missing source notes")
            continue
        has_locator = bool(re.search(r"\bpage\s*\d+\b|section\s*\d|§\s*\d|260\.\d+|product detail page rules", text))
        theme_hits = [term for term in expectations[source_id] if term in text]
        if not has_locator or not theme_hits:
            missing.append(f"{source_id}: locator={has_locator}, theme_hits={theme_hits}")
    if missing:
        return False, "; ".join(missing)
    return True, "PDF source notes include page/section locators and relevant rule themes"


def check_manifest_html_locator(manifest: Any, requirements: dict[str, list[list[str]]]) -> tuple[bool, str]:
    del requirements
    text = normalized_text(quoted_text_for_source(manifest, "SOURCE-ALIBABA-PRIMARY"))
    locator_terms = [
        "hero",
        "product details",
        "choose your model",
        "model comparison",
        "model-comparison",
        "source page wording",
        "embedded page data",
        "page data",
        "window._page_data_",
        "window._page_data",
    ]
    hits = [term for term in locator_terms if term in text]
    if not text or not hits:
        return False, f"Alibaba source notes lack a readable-page or raw-page locator; hits={hits}"
    return True, "Alibaba source notes identify a readable-page or raw-page locator"


def contains_all(text: str, terms: list[str]) -> bool:
    haystack = normalized_text(text)
    return all(term.lower() in haystack for term in terms)


def contains_any(text: str, terms: list[str]) -> list[str]:
    haystack = normalized_text(text)
    return [term for term in terms if term.lower() in haystack]


def check_required_sections(listing_text: str) -> tuple[bool, str]:
    heading_lines = [line.strip().lower() for line in listing_text.splitlines() if line.lstrip().startswith("#")]
    heading_names = [re.sub(r"\s+", " ", line.lstrip("#").strip()) for line in heading_lines]
    missing: list[str] = []
    if not any(line.startswith("# ") for line in heading_lines):
        missing.append("level-one title heading")
    for section in ("bullet points", "product description", "care and use"):
        if not any(name == section for name in heading_names):
            missing.append(f"## {section}")
    if missing:
        return False, f"missing sections: {missing}"
    return True, "all required sections present"


def check_rationales_nonempty(rows: list[dict[str, Any]]) -> tuple[bool, str]:
    missing = [clean_text(row.get("claim_id")) for row in rows if len(clean_text(row.get("rationale"))) < 20]
    if missing:
        return False, f"short or missing rationales: {missing}"
    return True, "all claim rationales are non-empty"


def check_replacement_text(rows: list[dict[str, Any]]) -> tuple[bool, str]:
    missing = [
        clean_text(row.get("claim_id"))
        for row in rows
        if clean_text(row.get("decision")) != "remove" and not clean_text(row.get("replacement_text"))
    ]
    if missing:
        return False, f"missing replacement_text for non-remove decisions: {missing}"
    return True, "replacement_text is present for approve/revise/needs_more_evidence decisions"


def run_llm_checks(
    llm_checks: list[dict[str, Any]],
    claim_review_path: Path,
    revised_listing_path: Path,
    evidence_manifest_path: Path,
    expected_facts_path: Path,
) -> list[dict[str, Any]]:
    if not llm_checks:
        return []

    provider = os.environ.get("BENCH_LLM_JUDGE_PROVIDER")
    model = os.environ.get("BENCH_LLM_JUDGE_MODEL")
    if not provider or not model:
        return [
            check_result(
                c["id"],
                False,
                "BENCH_LLM_JUDGE_PROVIDER/MODEL not set",
                c.get("check_type", "llm_judge_boolean"),
                llm_skipped=True,
            )
            for c in llm_checks
        ]

    try:
        from bench_core import llm_judge  # type: ignore
    except ImportError as exc:
        return [
            check_result(
                c["id"],
                False,
                f"llm_judge import failed: {exc}",
                c.get("check_type", "llm_judge_boolean"),
                llm_skipped=True,
            )
            for c in llm_checks
        ]

    config = llm_judge.JudgeConfig(
        provider=provider,
        model=model,
        timeout_sec=int(os.environ.get("BENCH_LLM_JUDGE_TIMEOUT") or 240),
        base_url=os.environ.get("BENCH_LLM_JUDGE_BASE_URL"),
        api_key=os.environ.get("BENCH_LLM_JUDGE_API_KEY"),
    )

    claim_review_text = claim_review_path.read_text(encoding="utf-8-sig")[:50000] if claim_review_path.exists() else ""
    revised_listing_text = revised_listing_path.read_text(encoding="utf-8-sig")[:40000] if revised_listing_path.exists() else ""
    evidence_manifest_text = evidence_manifest_path.read_text(encoding="utf-8-sig")[:40000] if evidence_manifest_path.exists() else ""
    expected_facts_text = expected_facts_path.read_text(encoding="utf-8-sig")[:20000] if expected_facts_path.exists() else ""
    questions_block = "\n".join(f"  - id: {c['id']}\n    question: {c['description']}" for c in llm_checks)

    prompt = (
        "You are a strict RealReplicaBench verifier. Return the standard JUDGE_SCHEMA "
        "with `criteria: [{id, score, reason}]`. For every criterion below, answer as a "
        "strict YES/NO check: score must be exactly 1.0 when fully satisfied and 0.0 "
        "otherwise. Do not give partial credit.\n\n"
        "Criteria, in required order:\n"
        f"{questions_block}\n\n"
        "Hidden expected facts:\n"
        f"{expected_facts_text or '(none provided)'}\n\n"
        "Agent deliverable: claim_review.json\n"
        f"{claim_review_text}\n\n"
        "Agent deliverable: revised_listing.md\n"
        f"{revised_listing_text}\n\n"
        "Agent deliverable: evidence_manifest.json\n"
        f"{evidence_manifest_text}\n"
    )

    try:
        judgment = llm_judge.run_llm_judge(config, prompt)
    except Exception as exc:
        return [
            check_result(
                c["id"],
                False,
                f"llm call failed: {exc}",
                c.get("check_type", "llm_judge_boolean"),
                llm_skipped=True,
            )
            for c in llm_checks
        ]

    criteria = judgment.get("criteria") or []
    by_id = {item.get("id"): item for item in criteria if isinstance(item, dict) and isinstance(item.get("id"), str)}
    results: list[dict[str, Any]] = []
    for check in llm_checks:
        item = by_id.get(check["id"])
        if not item:
            results.append(check_result(check["id"], False, "LLM omitted this criterion", check.get("check_type", "llm_judge_boolean")))
            continue
        try:
            score = float(item.get("score", 0))
        except (TypeError, ValueError):
            score = 0.0
        results.append(
            check_result(
                check["id"],
                score >= 0.5,
                clean_text(item.get("reason"))[:300],
                check.get("check_type", "llm_judge_boolean"),
                llm_score=score,
            )
        )
    return results


# --- check-granularity folding (docs/check-granularity.md) ---------------------
# The deterministic atoms below are computed exactly as before; only their
# *emission* is folded into capability units. new_check = AND(member atoms), so
# binary pass is identical to the old all-atoms pass (pure aggregation) and only
# capacity (passed/total) de-inflates. Per-atom detail is preserved in reason.
SETUP_ATOMS = [
    "claim_review_json_exists", "claim_review_json_parseable", "revised_listing_md_exists",
    "evidence_manifest_json_exists", "evidence_manifest_json_parseable", "outputs_dir_clean",
    "all_claim_ids_covered_no_dup", "decision_enum_clean", "reason_code_enum_clean",
    "reference_files_are_substantial_and_parseable",
]
SUMMARY_ATOMS = [
    "aggregate_count_approve", "aggregate_count_revise", "aggregate_count_remove",
    "aggregate_count_needs_more_evidence", "summary_counts_match_decisions",
]
MANIFEST_ATOMS = [
    "manifest_sources_reference_existing_files", "manifest_claim_ids_valid",
    "manifest_quoted_points_nonempty", "manifest_pdf_sources_include_page_or_section_locators",
    "manifest_html_source_includes_snapshot_locator",
]
CLAIM_REVIEW_COMPLETENESS_ATOMS = [
    "claim_rationales_nonempty",
    "replacement_text_present_for_approve_revise_needs_more_evidence",
]
LISTING_ATOMS = [
    "revised_listing_contains_required_sections", "approved_claim_terms_preserved",
    "unsupported_environmental_terms_removed", "unsupported_performance_terms_removed",
    "platform_prohibited_terms_removed", "wrong_scope_terms_removed",
    "overbroad_safety_terms_removed", "dishwasher_scope_narrowed",
]


def fold_deterministic(atoms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {a["id"]: a for a in atoms}

    def fold(group_id: str, member_ids: list[str]) -> dict[str, Any]:
        members = [by_id[m] for m in member_ids if m in by_id]
        failed = [m for m in members if not m["passed"]]
        if not failed:
            reason = f"{len(members)}/{len(members)} ok"
        else:
            reason = f"{len(members) - len(failed)}/{len(members)} ok; FAILED: " + "; ".join(
                f"{m['id']}[{m['reason']}]" for m in failed
            )
        return check_result(group_id, not failed, reason[:300])

    folded = [fold("setup_gate", SETUP_ATOMS)]
    for claim_id in CLAIM_IDS:
        folded.append(fold(
            f"claim_{claim_id}_correct",
            [f"claim_{claim_id}_decision", f"claim_{claim_id}_reason_code",
             f"claim_{claim_id}_required_evidence_present"],
        ))
    folded.append(fold("summary_counts_correct", SUMMARY_ATOMS))
    folded.append(fold("evidence_manifest_quality", MANIFEST_ATOMS))
    folded.append(fold("claim_review_completeness", CLAIM_REVIEW_COMPLETENESS_ATOMS))
    folded.append(fold("revised_listing_correct", LISTING_ATOMS))

    # safety net: surface any atom that no group consumed (should never fire)
    mapped = set(SETUP_ATOMS) | set(SUMMARY_ATOMS) | set(MANIFEST_ATOMS) | \
        set(CLAIM_REVIEW_COMPLETENESS_ATOMS) | set(LISTING_ATOMS)
    for cid in CLAIM_IDS:
        mapped |= {f"claim_{cid}_decision", f"claim_{cid}_reason_code",
                   f"claim_{cid}_required_evidence_present"}
    unmapped = [a["id"] for a in atoms if a["id"] not in mapped]
    if unmapped:
        folded.append(check_result("unmapped_atoms", False, f"unfolded atoms: {unmapped}"))
    return folded


def build_deterministic_results(
    task_dir: Path,
    output_dir: Path,
    expected: dict[str, Any],
) -> tuple[list[dict[str, Any]], Path, Path, Path]:
    claim_review_path = output_dir / "claim_review.json"
    revised_listing_path = output_dir / "revised_listing.md"
    evidence_manifest_path = output_dir / "evidence_manifest.json"

    results: list[dict[str, Any]] = []
    ok, reason = check_nonempty_file(claim_review_path)
    results.append(check_result("claim_review_json_exists", ok, reason))
    claim_review, parse_reason = load_optional_json(claim_review_path) if claim_review_path.exists() else (None, "missing file")
    results.append(check_result("claim_review_json_parseable", claim_review is not None, parse_reason))

    ok, reason = check_nonempty_file(revised_listing_path)
    results.append(check_result("revised_listing_md_exists", ok, reason))
    listing_text = revised_listing_path.read_text(encoding="utf-8-sig") if revised_listing_path.exists() else ""

    ok, reason = check_nonempty_file(evidence_manifest_path)
    results.append(check_result("evidence_manifest_json_exists", ok, reason))
    evidence_manifest, parse_reason = load_optional_json(evidence_manifest_path) if evidence_manifest_path.exists() else (None, "missing file")
    results.append(check_result("evidence_manifest_json_parseable", evidence_manifest is not None, parse_reason))

    ok, reason = check_outputs_dir_clean(output_dir)
    results.append(check_result("outputs_dir_clean", ok, reason))

    rows = get_claim_rows(claim_review)
    by_id = rows_by_claim_id(rows)
    counts = decision_counts(rows)
    expected_counts = expected["expected_counts"]
    expected_per_claim = expected["per_claim"]
    decision_enum = set(expected["decision_enum"])
    reason_enum = set(expected["reason_code_enum"])

    ok, reason = check_all_claim_ids_covered(rows)
    results.append(check_result("all_claim_ids_covered_no_dup", ok, reason))

    ok, reason = check_enum_clean(rows, "decision", decision_enum)
    results.append(check_result("decision_enum_clean", ok, reason))
    ok, reason = check_enum_clean(rows, "reason_code", reason_enum)
    results.append(check_result("reason_code_enum_clean", ok, reason))

    for decision in ("approve", "revise", "remove", "needs_more_evidence"):
        actual = counts.get(decision, 0)
        expected_range = expected.get("expected_count_ranges", {}).get(decision)
        if expected_range:
            low, high = expected_range
            count_ok = low <= actual <= high
            reason = f"{decision} count={actual}, expected range={low}-{high}"
        else:
            expected_count = expected_counts[decision]
            count_ok = actual == expected_count
            reason = f"{decision} count={actual}, expected={expected_count}"
        results.append(
            check_result(
                f"aggregate_count_{decision}",
                count_ok,
                reason,
            )
        )

    ok, reason = check_summary_counts(claim_review, counts)
    results.append(check_result("summary_counts_match_decisions", ok, reason))

    ok, reason = check_manifest_sources(evidence_manifest, task_dir, expected["source_id_to_file"])
    results.append(check_result("manifest_sources_reference_existing_files", ok, reason))
    ok, reason = check_manifest_claim_ids(evidence_manifest)
    results.append(check_result("manifest_claim_ids_valid", ok, reason))
    ok, reason = check_manifest_quotes(evidence_manifest)
    results.append(check_result("manifest_quoted_points_nonempty", ok, reason))

    ok, reason = check_reference_files_are_substantial(task_dir)
    results.append(check_result("reference_files_are_substantial_and_parseable", ok, reason))
    locator_requirements = expected.get("manifest_locator_requirements", {})
    ok, reason = check_manifest_pdf_locators(evidence_manifest, locator_requirements)
    results.append(check_result("manifest_pdf_sources_include_page_or_section_locators", ok, reason))
    ok, reason = check_manifest_html_locator(evidence_manifest, locator_requirements)
    results.append(check_result("manifest_html_source_includes_snapshot_locator", ok, reason))

    for claim_id in CLAIM_IDS:
        actual = by_id.get(claim_id, {})
        canonical = expected_per_claim[claim_id]
        actual_decision = clean_text(actual.get("decision"))
        actual_reason = clean_text(actual.get("reason_code"))
        actual_evidence = {
            clean_text(source_id)
            for source_id in actual.get("supporting_evidence_ids", [])
            if clean_text(source_id)
        } if isinstance(actual.get("supporting_evidence_ids"), list) else set()
        acceptable_decisions = set(canonical.get("acceptable_decisions", [canonical["decision"]]))
        acceptable_reason_codes = set(canonical.get("acceptable_reason_codes", [canonical["reason_code"]]))
        required_evidence = set(canonical["required_evidence"])
        required_evidence_any_groups = [
            {clean_text(source_id) for source_id in group if clean_text(source_id)}
            for group in canonical.get("required_evidence_any_groups", [])
            if isinstance(group, list)
        ]
        missing_evidence = sorted(required_evidence - actual_evidence)
        missing_any_groups = [
            sorted(group)
            for group in required_evidence_any_groups
            if actual_evidence.isdisjoint(group)
        ]

        results.append(
            check_result(
                f"claim_{claim_id}_decision",
                actual_decision in acceptable_decisions,
                f"{actual_decision or '<missing>'} vs accepted {sorted(acceptable_decisions)}",
            )
        )
        results.append(
            check_result(
                f"claim_{claim_id}_reason_code",
                actual_reason in acceptable_reason_codes,
                f"{actual_reason or '<missing>'} vs accepted {sorted(acceptable_reason_codes)}",
            )
        )
        results.append(
            check_result(
                f"claim_{claim_id}_required_evidence_present",
                not missing_evidence and not missing_any_groups,
                "all required evidence present"
                if not missing_evidence and not missing_any_groups
                else f"missing evidence: {missing_evidence}, missing any-of groups: {missing_any_groups}",
            )
        )

    ok, reason = check_required_sections(listing_text)
    results.append(check_result("revised_listing_contains_required_sections", ok, reason))

    approved_terms_ok = contains_all(listing_text, ["LFGB", "food-contact", "cold", "24"])
    results.append(
        check_result(
            "approved_claim_terms_preserved",
            approved_terms_ok,
            "LFGB/food-contact/cold/24 terms present" if approved_terms_ok else "missing at least one supported term",
        )
    )

    forbidden_checks = [
        (
            "unsupported_environmental_terms_removed",
            ["eco-friendly", "better for the planet", "30% recycled stainless steel", "30 percent recycled"],
        ),
        (
            "unsupported_performance_terms_removed",
            ["hot or cold for 24 hours", "24h hot", "hot 24", "100% leak-proof", "spills never happen", "dent-proof"],
        ),
        (
            "platform_prohibited_terms_removed",
            ["best seller", "4.9-star", "4.9 star", "free 2-day delivery", "20% launch discount", "discount this week"],
        ),
        (
            "wrong_scope_terms_removed",
            ["fda approved", "fda-approved", "titanium pro", "pro version"],
        ),
        (
            "overbroad_safety_terms_removed",
            ["non-toxic", "safe for kids"],
        ),
    ]
    for check_id, forbidden_terms in forbidden_checks:
        hits = contains_any(listing_text, forbidden_terms)
        results.append(check_result(check_id, not hits, "no forbidden terms found" if not hits else f"found forbidden terms: {hits}"))

    listing_lower = normalized_text(listing_text)
    broad_dishwasher_hits = contains_any(
        listing_text,
        ["dishwasher safe bottle and lid", "dishwasher-safe bottle and lid", "dishwasher safe body", "dishwasher-safe body"],
    )
    narrowed = "lid" in listing_lower and ("top-rack" in listing_lower or "top rack" in listing_lower) and not broad_dishwasher_hits
    results.append(
        check_result(
            "dishwasher_scope_narrowed",
            narrowed,
            "dishwasher scope is narrowed to top-rack lid" if narrowed else f"bad scope terms={broad_dishwasher_hits}",
        )
    )

    ok, reason = check_rationales_nonempty(rows)
    results.append(check_result("claim_rationales_nonempty", ok, reason))
    ok, reason = check_replacement_text(rows)
    results.append(check_result("replacement_text_present_for_approve_revise_needs_more_evidence", ok, reason))

    folded = fold_deterministic(results)
    return folded, claim_review_path, revised_listing_path, evidence_manifest_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", default="")
    parser.add_argument("--reward-json", required=True)
    args = parser.parse_args()

    task_dir = Path(args.task_dir).resolve()
    output_dir = Path(args.output_dir).resolve() if args.output_dir else task_dir / "outputs"
    reward_path = Path(args.reward_json)
    reward_path.parent.mkdir(parents=True, exist_ok=True)

    rubric = load_json(task_dir / "rubric.json")
    expected = load_json(task_dir / "private" / "expected_answer.json")
    checks_spec = rubric.get("checks", [])

    det_results, claim_review_path, revised_listing_path, evidence_manifest_path = build_deterministic_results(
        task_dir, output_dir, expected
    )

    llm_checks = [check for check in checks_spec if check.get("check_type") == "llm_judge_boolean"]
    llm_results = run_llm_checks(
        llm_checks,
        claim_review_path,
        revised_listing_path,
        evidence_manifest_path,
        task_dir / "private" / "expected_facts.md",
    )

    all_results = det_results + llm_results
    spec_ids = [check.get("id") for check in checks_spec]
    produced_ids = [result["id"] for result in all_results]
    missing_spec_ids = [check_id for check_id in spec_ids if check_id not in produced_ids]
    extra_ids = [check_id for check_id in produced_ids if check_id not in spec_ids]
    if missing_spec_ids or extra_ids:
        all_results.append(
            check_result(
                "verifier_check_spec_alignment",
                False,
                f"missing_spec_ids={missing_spec_ids}, extra_ids={extra_ids}",
            )
        )

    passed_count = sum(1 for result in all_results if result.get("passed"))
    total_count = len(all_results)
    score = passed_count / total_count if total_count else 0.0
    llm_skipped = sum(1 for result in all_results if result.get("llm_skipped"))
    payload = {
        "schema_version": "2.0",
        "task_id": expected.get("task_id", rubric.get("task_id")),
        "source": "v2_checks_runner",
        "score": round(score, 4),
        "reward": round(score, 4),
        "passed": passed_count == total_count,
        "checks_passed": passed_count,
        "checks_total": total_count,
        "llm_checks_skipped": llm_skipped,
        "checks_breakdown": all_results,
    }

    reward_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
