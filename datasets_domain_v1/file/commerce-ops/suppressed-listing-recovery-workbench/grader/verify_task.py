"""v2 verifier for file-commerce-ops-suppressed-listing-recovery-workbench.

Strict per-field evaluation against canonical answer in private/expected_answer.json.

Each atomic check votes 1 toward the binary checks_passed/checks_total ratio (v2 schema).
Score is purely deterministic: per-bullet positive token coverage, per-suppression-code
evidence_file + resolution_action validity, image recommendation field-by-field structural
match, recovery-note topic coverage. There is no len()-based stub: a placeholder/stub
submission cannot reach 0.5.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# IO helpers
# ---------------------------------------------------------------------------

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


def flatten_strings(value: Any) -> str:
    """Recursively flatten any nested dict/list into a single space-separated string."""
    if isinstance(value, dict):
        return " ".join(f"{k} {flatten_strings(v)}" for k, v in value.items())
    if isinstance(value, list):
        return " ".join(flatten_strings(v) for v in value)
    return str(value or "")


def norm(value: Any) -> str:
    return re.sub(r"\s+", " ", flatten_strings(value).lower()).strip()


def add(checks: list[dict[str, Any]], cid: str, passed: bool, reason: str, ctype: str) -> None:
    checks.append({"id": cid, "passed": bool(passed), "reason": reason, "check_type": ctype})


# ---------------------------------------------------------------------------
# Field extraction helpers
# ---------------------------------------------------------------------------

def get_field(fields: dict[str, Any] | None, key: str) -> str:
    if not isinstance(fields, dict):
        return ""
    return norm(fields.get(key, ""))


def all_present(text: str, tokens: list[str]) -> bool:
    return all(tok.lower() in text for tok in tokens)


def any_group_satisfied(text: str, groups: list[list[str]]) -> bool:
    """True if at least one group g exists where every token in g is in text."""
    return any(all_present(text, g) for g in groups)


def extract_substr_in(text: str, substrs: list[str]) -> str | None:
    for s in substrs:
        if s.lower() in text:
            return s
    return None


# ---------------------------------------------------------------------------
# emit
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Per-suppression-code resolver
# ---------------------------------------------------------------------------

def resolve_resolution_entry(resolutions: Any, code: str) -> dict[str, Any] | None:
    """Find resolution entry for a code, accepting either uppercase code or
    lowercased / field-name-keyed variants. Returns dict or None."""
    if not isinstance(resolutions, dict):
        return None
    # Direct hit
    for k, v in resolutions.items():
        if not isinstance(k, str):
            continue
        if k.strip().upper() == code.upper() and isinstance(v, dict):
            return v
    # Field-name fallback (PROHIBITED_PROMO -> title, etc.)
    field_name_map = {
        "PROHIBITED_PROMO": "title",
        "UNSUPPORTED_PERFORMANCE": "bullet_2",
        "RESTRICTED_SAFETY_CLAIM": "bullet_5",
        "IMAGE_TEXT_PROMO": "images",
        "COMPETITOR_BRAND_TERM": "search_terms",
        "DISHWASHER_SCOPE_CONFLICT": "bullet_4",
        "ENVIRONMENTAL_CLAIM_UNSUPPORTED": "description",
    }
    fallback_key = field_name_map.get(code.upper())
    if fallback_key:
        for k, v in resolutions.items():
            if isinstance(k, str) and k.strip().lower() == fallback_key and isinstance(v, dict):
                return v
    return None


def evidence_file_matches(entry: dict[str, Any], allowed: list[str], task_dir: Path) -> tuple[bool, str]:
    """Check entry has an evidence_file pointing to a real file under files/ AND
    matching one of the allowed paths (case-insensitive substring match)."""
    raw = entry.get("evidence_file") or entry.get("evidence") or ""
    candidates: list[str] = []
    if isinstance(raw, list):
        candidates = [str(x) for x in raw if x]
    elif isinstance(raw, str) and raw:
        candidates = [raw]
    elif isinstance(raw, dict):
        # nested {file: ..., id: ...} shape
        nested = raw.get("file") or raw.get("path") or raw.get("evidence_file")
        if nested:
            candidates = [str(nested)]
    if not candidates:
        return False, "no evidence_file in resolution entry"
    matched_path = None
    for c in candidates:
        cn = c.replace("\\", "/").lower().strip()
        # Strip leading "./" or "/"
        cn = cn.lstrip("/")
        for allowed_path in allowed:
            ap = allowed_path.lower().lstrip("/")
            if ap in cn or cn in ap:
                matched_path = allowed_path
                # verify real file (or directory for "*/" prefixes)
                target = task_dir / allowed_path.lstrip("/")
                if target.exists():
                    return True, f"evidence_file={c!r} matches {allowed_path}"
                break
    if matched_path:
        return False, f"evidence_file={candidates!r} mentions {matched_path} but file not found on disk"
    return False, f"evidence_file={candidates!r} not in allowed list"


def resolution_action_matches(entry: dict[str, Any], allowed_phrases: list[str]) -> tuple[bool, str]:
    raw = entry.get("resolution_action") or entry.get("action") or entry.get("resolution") or ""
    if isinstance(raw, list):
        text = " ".join(str(x) for x in raw)
    else:
        text = str(raw)
    text_n = norm(text)
    if not text_n:
        return False, "no resolution_action"
    for phrase in allowed_phrases:
        if phrase.lower() in text_n:
            return True, f"resolution_action contains {phrase!r}"
    return False, f"resolution_action={text!r} matches none of allowed phrases"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

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
    task_id = rubric.get("task_id") or task_dir.name
    expected = load_json(task_dir / "private" / "expected_answer.json") or {}

    fields_path = output_dir / "corrected_listing_fields.json"
    note_path = output_dir / "recovery_note.md"
    manifest_path = output_dir / "evidence_manifest.json"
    fields = load_json(fields_path)
    manifest = load_json(manifest_path)
    note_text = read_text(note_path)

    checks: list[dict[str, Any]] = []

    # ==================================================================
    # CAPACITY-REFACTOR NOTE (2026-06-09, schema 2.0 fold):
    #   The validation/computation logic below is UNCHANGED from the
    #   30-atom version. Only the EMIT layer is folded: each atom is
    #   computed into a local (ok, reason) pair, then aggregated into a
    #   smaller set of capability checks per docs/check-granularity.md.
    #   - R2: structural/plumbing atoms -> single `setup_gate`.
    #   - R3: same-skill field families (title / bullets / description /
    #         search_terms / image) collapse to one capability each;
    #         failing members listed in `reason`.
    #   - R3a: the 7 per-suppression-code resolutions are the genuine
    #         core competency (empirically the discriminator across the
    #         9-model release run) and stay per-code.
    #   - R6: the negative banned-term sweep + the unverifiable-claim
    #         restraint check stay explicit.
    #   binary pass is invariant: all(new) <=> all(old).
    # ==================================================================

    # ------------------------------------------------------------------
    # Structural atoms (parse / required keys) — fold into setup_gate (R2)
    # ------------------------------------------------------------------
    parse_ok = isinstance(fields, dict)
    parse_reason = ("corrected_listing_fields.json parses as dict" if parse_ok
                    else "corrected_listing_fields.json missing or not a JSON object")

    required = expected.get("required_fields") or []
    field_keys = set(fields.keys()) if isinstance(fields, dict) else set()
    missing = sorted(set(required) - field_keys)
    required_ok = isinstance(fields, dict) and not missing
    required_reason = f"missing_fields={missing}"

    # ------------------------------------------------------------------
    # Title: positive token coverage + no banned (R3 -> title_compliant)
    # ------------------------------------------------------------------
    title_v = get_field(fields, "title")
    title_required = expected.get("title", {}).get("required_tokens_all", ["750", "stainless", "bottle"])
    title_tokens_ok = all_present(title_v, title_required)
    title_tokens_reason = f"required={title_required} present={[t for t in title_required if t.lower() in title_v]}"

    title_banned = expected.get("title_banned_terms") or []
    title_remaining = [t for t in title_banned if t.lower() in title_v]
    title_banned_ok = isinstance(fields, dict) and not title_remaining
    title_banned_reason = f"remaining_banned={title_remaining}"

    title_ok = title_tokens_ok and title_banned_ok
    title_reason = f"tokens:{title_tokens_reason} | banned:{title_banned_reason}"

    # ------------------------------------------------------------------
    # Per-bullet positive grounding + per-bullet banned
    # (R3 -> bullets_compliant; internal per-bullet detail kept in reason)
    # ------------------------------------------------------------------
    bullet_specs = expected.get("bullet_specs", {})
    bullet_failures: list[str] = []
    for i in range(1, 6):
        key = f"bullet_{i}"
        spec = bullet_specs.get(key, {})
        bullet_v = get_field(fields, key)
        groups = spec.get("required_any_of_groups", [])
        banned = spec.get("banned", [])

        # Bullet must satisfy at least one positive group AND avoid all banned phrases.
        positive_ok = any_group_satisfied(bullet_v, groups) if groups else True
        banned_hit = [b for b in banned if b.lower() in bullet_v]
        ok = positive_ok and not banned_hit
        if not ok:
            if not bullet_v:
                bullet_failures.append(f"{key}:empty")
            elif not positive_ok:
                bullet_failures.append(f"{key}:fails any-of {groups}")
            else:
                bullet_failures.append(f"{key}:banned={banned_hit}")
    bullets_ok = not bullet_failures
    bullets_reason = "all 5 bullets grounded & compliant" if bullets_ok else f"bullet_failures={bullet_failures}"

    # ------------------------------------------------------------------
    # Description: ≥3 required tokens AND no banned eco/promo
    # (R3 -> description_compliant)
    # ------------------------------------------------------------------
    desc_v = get_field(fields, "description")
    desc_spec = expected.get("description", {})
    desc_tokens = desc_spec.get("required_tokens_any", [])
    desc_min = int(desc_spec.get("required_tokens_min", 3))
    hits = [t for t in desc_tokens if t.lower() in desc_v]
    desc_banned = desc_spec.get("banned", [])
    desc_banned_hit = [b for b in desc_banned if b.lower() in desc_v]
    desc_grounded_ok = len(hits) >= desc_min
    desc_banned_ok = isinstance(fields, dict) and not desc_banned_hit
    description_ok = desc_grounded_ok and desc_banned_ok
    description_reason = (f"grounded_hits={hits} need>={desc_min} | "
                          f"remaining_banned={desc_banned_hit}")

    # ------------------------------------------------------------------
    # Search terms: subset of allowed enum + min count + no banned
    # (R3 -> search_terms_compliant)
    # ------------------------------------------------------------------
    search_v_raw = (fields or {}).get("search_terms", "")
    if isinstance(search_v_raw, list):
        search_text = " ".join(str(x) for x in search_v_raw)
    else:
        search_text = str(search_v_raw)
    search_text = norm(search_text)
    search_spec = expected.get("search_terms", {})
    allowed = [a.lower() for a in search_spec.get("allowed_tokens_lowercase", [])]
    banned_search = [b.lower() for b in search_spec.get("banned", [])]

    # Tokenize on whitespace/comma/semicolon; strip simple punctuation.
    raw_tokens = [t.strip(".,;:!?\"'()[]") for t in re.split(r"[\s,;]+", search_text) if t.strip()]
    raw_tokens = [t for t in raw_tokens if t and len(t) > 1]
    distinct_allowed = sorted({t for t in raw_tokens if t in allowed})
    distinct_unknown = sorted({t for t in raw_tokens if t not in allowed and len(t) >= 3})
    min_distinct = int(search_spec.get("min_distinct_allowed_tokens", 4))
    st_min_ok = len(distinct_allowed) >= min_distinct
    st_subset_ok = bool(raw_tokens) and not distinct_unknown
    banned_in_search = [b for b in banned_search if b in search_text]
    st_no_banned_ok = bool(search_text) and not banned_in_search
    search_terms_ok = st_min_ok and st_subset_ok and st_no_banned_ok
    search_terms_reason = (f"distinct_allowed={distinct_allowed} need>={min_distinct} | "
                           f"unknown_tokens={distinct_unknown[:8]} | "
                           f"remaining_banned={banned_in_search}")

    # ------------------------------------------------------------------
    # Banned-term sweep across listing-facing fields only (R6 negative)
    # title / bullets / description / search_terms; metadata fields exempt.
    # ------------------------------------------------------------------
    listing_facing_blob_parts: list[str] = []
    for k in ("title", "bullet_1", "bullet_2", "bullet_3", "bullet_4", "bullet_5", "description", "search_terms"):
        if isinstance(fields, dict) and k in fields:
            listing_facing_blob_parts.append(norm(fields.get(k, "")))
    listing_blob = " ".join(listing_facing_blob_parts).strip()
    all_banned = expected.get("all_banned_terms") or []
    remaining_banned = [t for t in all_banned if t.lower() in listing_blob]
    no_banned_ok = isinstance(fields, dict) and bool(listing_blob) and not remaining_banned
    no_banned_reason = f"remaining_banned_in_listing_fields={remaining_banned}"

    # ------------------------------------------------------------------
    # Image recommendation: structured object + selected/rejected/reason.
    # The structured-object atom is plumbing -> setup_gate; the three
    # content atoms collapse (R3 -> image_correct).
    # ------------------------------------------------------------------
    img_rec = (fields or {}).get("image_recommendation") if isinstance(fields, dict) else None
    img_spec = expected.get("image_recommendation", {})
    selected_substrs = [s.lower() for s in img_spec.get("selected_image_required_substrs", [])]
    rejected_substrs = [s.lower() for s in img_spec.get("rejected_image_required_substrs", [])]
    reason_required = [s.lower() for s in img_spec.get("reason_required_any", [])]

    if not isinstance(img_rec, dict):
        # Try a flat fallback: if image_recommendation is a string, surface its blob to test.
        img_blob = norm(img_rec)
        sel_v = img_blob
        rej_v = img_blob
        rsn_v = img_blob
        is_obj = False
    else:
        sel_v = norm(img_rec.get("selected_image_file") or img_rec.get("selected") or img_rec.get("primary_image") or "")
        rej_v = norm(img_rec.get("rejected_image_file") or img_rec.get("rejected") or img_rec.get("removed_image") or "")
        rsn_v = norm(img_rec.get("reason") or img_rec.get("reason_for_rejection") or img_rec.get("notes") or "")
        is_obj = True

    sel_hit = extract_substr_in(sel_v, selected_substrs)
    rej_hit = extract_substr_in(rej_v, rejected_substrs)
    rsn_hit = extract_substr_in(rsn_v, reason_required)

    img_obj_ok = is_obj  # plumbing -> setup_gate
    image_correct_ok = bool(sel_hit) and bool(rej_hit) and bool(rsn_hit)
    image_correct_reason = (f"selected={sel_v!r} (need one of {selected_substrs}) | "
                            f"rejected={rej_v!r} (need one of {rejected_substrs}) | "
                            f"reason_cites={bool(rsn_hit)} (need one of {reason_required})")

    # ------------------------------------------------------------------
    # Evidence manifest: must reference >=3 real source files
    # (kept as own deliverable capability; folded with note-topics below)
    # ------------------------------------------------------------------
    manifest_blob = norm(manifest)
    em_spec = expected.get("evidence_manifest", {})
    min_real = int(em_spec.get("min_real_files_referenced", 3))
    roots = em_spec.get("real_file_path_roots", ["source_evidence", "review_inputs", "policies", "listing", "workbench", "messages"])
    roots_re = "|".join(re.escape(r) for r in roots)
    path_re = re.compile(rf"(?:files/)?({roots_re})/([\w./\-]+)")
    grounded: list[str] = []
    for m in path_re.finditer(manifest_blob):
        rel = f"{m.group(1)}/{m.group(2)}"
        if (task_dir / "workspace" / rel).exists():
            grounded.append(rel)
    grounded_unique = sorted(set(grounded))
    manifest_ok = len(grounded_unique) >= min_real
    manifest_reason = f"real_paths_found={grounded_unique[:8]} need>={min_real}"

    # ------------------------------------------------------------------
    # Recovery note: closed-set topic coverage (note-existence is plumbing).
    # ------------------------------------------------------------------
    note_exists_ok = note_path.exists() and bool(note_text.strip())
    note_exists_reason = f"exists={note_path.exists()} nonempty={bool(note_text.strip())}"

    note_blob = note_text.lower()
    rn_spec = expected.get("recovery_note_topics", {})
    rn_min = int(rn_spec.get("min_topics_covered", 4))
    rn_topics = rn_spec.get("topics", {})
    covered: list[str] = []
    for topic, pattern in rn_topics.items():
        try:
            if re.search(pattern, note_blob):
                covered.append(topic)
        except re.error:
            if pattern.lower() in note_blob:
                covered.append(topic)
    note_topics_ok = len(covered) >= rn_min
    note_topics_reason = f"covered_topics={covered} need>={rn_min}"

    # supporting deliverables: evidence manifest grounding + recovery-note
    # topic coverage are both "produce the grounded supporting artifact"
    # capabilities; collapse them (R3-style) into one check.
    supporting_ok = manifest_ok and note_topics_ok
    supporting_reason = f"manifest:{manifest_reason} | recovery_note_topics:{note_topics_reason}"

    # ------------------------------------------------------------------
    # fields_needing_more_evidence: restraint capability (R6) — kept own.
    # ------------------------------------------------------------------
    fne = (fields or {}).get("fields_needing_more_evidence") if isinstance(fields, dict) else None
    fne_spec = expected.get("fields_needing_more_evidence", {})
    fne_min = int(fne_spec.get("min_items", 1))
    fne_topics = [t.lower() for t in fne_spec.get("topic_required_any", [])]
    if isinstance(fne, list):
        fne_count = len(fne)
        fne_text = norm(fne)
    elif isinstance(fne, dict):
        fne_count = len(fne)
        fne_text = norm(fne)
    else:
        fne_count = 0
        fne_text = ""
    fne_hit = next((t for t in fne_topics if t in fne_text), None)
    fne_ok = fne_count >= fne_min and fne_hit is not None
    fne_reason = f"count={fne_count} topic_hit={fne_hit!r}"

    # ==================================================================
    # EMIT — folded capability checks (setup_gate first)
    # ==================================================================

    # 1. setup_gate (R2): file parses + required keys + image_rec is an
    #    object + recovery note exists & non-empty.
    setup_ok = parse_ok and required_ok and img_obj_ok and note_exists_ok
    add(checks, "setup_gate", setup_ok,
        f"parse:{parse_reason} | required_keys:{required_reason} | "
        f"image_recommendation_is_object={img_obj_ok} | recovery_note:{note_exists_reason}",
        "deterministic_exact")

    # 2. title_compliant (R3)
    add(checks, "title_compliant", title_ok, title_reason, "deterministic_exact")

    # 3. bullets_compliant (R3): all 5 per-bullet remediations correct
    add(checks, "bullets_compliant", bullets_ok, bullets_reason, "deterministic_semantic")

    # 4. description_compliant (R3)
    add(checks, "description_compliant", description_ok, description_reason, "deterministic_semantic")

    # 5. search_terms_compliant (R3)
    add(checks, "search_terms_compliant", search_terms_ok, search_terms_reason, "deterministic_exact")

    # 6. no_banned_terms_in_listing (R6 negative sweep)
    add(checks, "no_banned_terms_in_listing", no_banned_ok, no_banned_reason, "deterministic_exact")

    # 7. image_correct (R3): selected clean + rejected promo + reason cites overlay
    add(checks, "image_correct", image_correct_ok, image_correct_reason, "deterministic_semantic")

    # 8-14. suppression_reason_resolutions — per-code (R3a core competency)
    resolutions = (fields or {}).get("suppression_reason_resolutions") if isinstance(fields, dict) else None
    sup_spec = expected.get("suppression_resolutions", {})
    required_codes = sup_spec.get("required_codes", [])
    per_code = sup_spec.get("per_code", {})
    for code in required_codes:
        cspec = per_code.get(code, {})
        allowed_files = cspec.get("evidence_files_allowed", [])
        allowed_actions = cspec.get("resolution_action_required_any", [])
        entry = resolve_resolution_entry(resolutions, code)
        if entry is None:
            ok = False
            reason = f"no resolution entry for code={code!r}"
        else:
            file_ok, file_msg = evidence_file_matches(entry, allowed_files, task_dir)
            action_ok, action_msg = resolution_action_matches(entry, allowed_actions)
            ok = file_ok and action_ok
            reason = f"evidence_file:{file_msg} | resolution_action:{action_msg}"
        add(checks, f"resolution_{code}_valid", ok, reason, "deterministic_semantic")

    # 15. unverifiable_claims_flagged (R6 restraint)
    add(checks, "unverifiable_claims_flagged", fne_ok, fne_reason, "deterministic_semantic")

    # 16. supporting_deliverables_grounded (R3): evidence manifest + note topics
    add(checks, "supporting_deliverables_grounded", supporting_ok, supporting_reason, "deterministic_semantic")

    return emit(reward_path, task_id, checks)


if __name__ == "__main__":
    raise SystemExit(main())
