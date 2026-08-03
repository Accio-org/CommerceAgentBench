"""Standalone verifier for cli-commerce-camping-stove-listing-config.

Capacity-migration note (2026-06-09): the verifier still computes the SAME 20
atomic predicates it always did (byte-identical predicate/reason logic below),
but they are now *aggregated* into capability-unit checks per
`docs/check-granularity.md` (R1-R7). Each emitted check is the AND of its member
atoms; the per-atom detail is preserved in the `reason` string for diagnosis.
This is pure aggregation: `all(atoms) == all(groups)`, so per-case binary
`passed` is unchanged. No validation logic was loosened.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Hard PyYAML dependency — emit clear failure on amazon checks if missing
try:
    import yaml as pyyaml  # type: ignore
    _yaml_available = True
    _yaml_import_error: str | None = None
except ImportError as _e:  # pragma: no cover
    pyyaml = None  # type: ignore
    _yaml_available = False
    _yaml_import_error = str(_e)


def load_expected(task_dir: Path) -> dict:
    with open(task_dir / "private" / "expected_answer.json") as f:
        return json.load(f)


def check(results: list, cid: str, passed: bool, detail: str = ""):
    results.append({"id": cid, "passed": passed, "detail": detail})


def load_yaml(path: Path):
    """Parse YAML with PyYAML. Caller must check `_yaml_available` first."""
    if not _yaml_available or pyyaml is None:
        raise RuntimeError(f"pyyaml import failed: {_yaml_import_error}")
    with open(path, encoding="utf-8-sig") as f:
        return pyyaml.safe_load(f)


# ---------------------------------------------------------------------------
# Shopify checks
# ---------------------------------------------------------------------------

def verify_shopify(output_dir: Path, expected: dict, results: list):
    spath = output_dir / "shopify_product.json"
    if not spath.exists():
        check(results, "shopify_exists", False, "file not found")
        for cid in ["shopify_variant_count", "shopify_pm_weight",
                     "shopify_prices_usd", "shopify_imperial_units",
                     "shopify_seo_keywords", "shopify_main_image"]:
            check(results, cid, False, "skipped — file missing")
        return

    try:
        with open(spath) as f:
            data = json.load(f)
        check(results, "shopify_exists", True)
    except json.JSONDecodeError as e:
        check(results, "shopify_exists", False, f"invalid JSON: {e}")
        for cid in ["shopify_variant_count", "shopify_pm_weight",
                     "shopify_prices_usd", "shopify_imperial_units",
                     "shopify_seo_keywords", "shopify_main_image"]:
            check(results, cid, False, "skipped — invalid JSON")
        return

    exp = expected["shopify"]
    product = data.get("product", data)

    # --- variant_count ---
    variants = product.get("variants", [])
    check(results, "shopify_variant_count",
          len(variants) == exp["variant_count"],
          f"got {len(variants)}, expected {exp['variant_count']}")

    # --- pm_weight (Solo weight = 98g) ---
    solo_variants = [v for v in variants if "SOLO" in v.get("sku", "").upper()]
    weight_ok = False
    if solo_variants:
        w = solo_variants[0].get("weight")
        if w is not None:
            try:
                # Tolerate strings with units (e.g., "98g", "98 g", "98.0")
                import re as _re
                w_str = str(w).strip()
                m = _re.match(r"^\s*(-?\d+(?:\.\d+)?)", w_str)
                w_num = float(m.group(1)) if m else float(w_str)
                weight_ok = int(round(w_num)) == exp["solo_weight_g"]
            except (ValueError, TypeError):
                weight_ok = False
    check(results, "shopify_pm_weight", weight_ok,
          f"Solo weight={solo_variants[0].get('weight') if solo_variants else 'N/A'}, "
          f"expected {exp['solo_weight_g']}")

    # --- prices_usd ---
    price_map = {v.get("sku", ""): v.get("price", "") for v in variants}
    prices_ok = True
    bad = []
    for sku, exp_price in exp["prices"].items():
        got = str(price_map.get(sku, ""))
        if got != exp_price:
            prices_ok = False
            bad.append(f"{sku}: got {got}, exp {exp_price}")
    check(results, "shopify_prices_usd", prices_ok,
          "; ".join(bad[:3]) if bad else "")

    # --- imperial_units (Solo weight in oz, must be ≈3.46 numerically) ---
    metafields = product.get("metafields", [])
    expected_oz = float(exp["solo_weight_oz_str"])  # 3.46

    def _extract_solo_oz(value) -> float | None:
        """Pull the first number from `value`. Tolerates plain numbers,
        ' / '-separated lists (variant order Solo/Kit/Pro), and
        unit-suffixed strings ('3.46 oz')."""
        if not isinstance(value, str):
            return None
        # Solo is first variant by convention; if list-shaped, take leading slice
        head = value.split("/")[0] if "/" in value else value
        # Strip non-numeric suffix
        import re as _re
        m = _re.search(r"-?\d+(?:\.\d+)?", head)
        if not m:
            return None
        try:
            return float(m.group(0))
        except ValueError:
            return None

    imperial_ok = False
    imperial_detail = "no imperial-named weight metafield found"
    for mf in metafields:
        k = (mf.get("key") or "").lower()
        is_imperial_weight = (
            ("weight" in k and ("imperial" in k or "_oz" in k or k.endswith("oz")))
            or k in ("weight_oz", "weight_imperial_oz", "weight_imperial")
        )
        if not is_imperial_weight:
            continue
        raw = mf.get("value", "")
        got = _extract_solo_oz(str(raw))
        if got is None:
            imperial_detail = f"key='{k}' value='{raw}' — no numeric leading value"
            break
        if abs(got - expected_oz) < 0.01:
            imperial_ok = True
            imperial_detail = ""
        else:
            imperial_detail = (f"key='{k}' parsed={got}, "
                               f"expected≈{expected_oz} (±0.01)")
        break
    check(results, "shopify_imperial_units", imperial_ok, imperial_detail)

    # --- seo_keywords ---
    seo = product.get("seo", {})
    desc = (seo.get("description", "") or "").lower()
    missing_kw = [kw for kw in exp["seo_keywords"] if kw.lower() not in desc]
    check(results, "shopify_seo_keywords",
          len(missing_kw) == 0,
          f"missing: {missing_kw}" if missing_kw else "")

    # --- main_image ---
    images = product.get("images", [])
    main_ok = False
    main_detail = "no images"
    if images:
        first = images[0] if isinstance(images[0], dict) else {"src": str(images[0])}
        src = first.get("src", "")
        main_ok = exp["main_image_prefix"] in src
        main_detail = f"first image: {src}" if not main_ok else ""
    check(results, "shopify_main_image", main_ok, main_detail)


# ---------------------------------------------------------------------------
# Amazon JP checks
# ---------------------------------------------------------------------------

def verify_amazon(output_dir: Path, expected: dict, results: list):
    amazon_check_ids = ["amazon_child_count", "amazon_title_format",
                        "amazon_bullet_count", "amazon_price_jpy",
                        "amazon_pse_warning", "amazon_browse_node"]

    apath = output_dir / "amazon_jp_listing.yaml"
    if not apath.exists():
        check(results, "amazon_exists", False, "file not found")
        for cid in amazon_check_ids:
            check(results, cid, False, "skipped — file missing")
        return

    if not _yaml_available:
        # PyYAML not installed — verifier can't parse YAML; still emit a valid
        # reward but mark every YAML-dependent check as failed with reason.
        check(results, "amazon_exists", False,
              f"pyyaml import failed: {_yaml_import_error}")
        for cid in amazon_check_ids:
            check(results, cid, False, "pyyaml import failed")
        return

    try:
        data = load_yaml(apath)
        if data is None:
            raise ValueError("parsed as None")
        check(results, "amazon_exists", True)
    except Exception as e:
        check(results, "amazon_exists", False, f"parse error: {e}")
        for cid in amazon_check_ids:
            check(results, cid, False, "skipped — parse error")
        return

    exp = expected["amazon_jp"]
    listing = data.get("listing", data)
    parent = listing.get("parent", {})

    # --- child_count ---
    children = listing.get("children", [])
    check(results, "amazon_child_count",
          len(children) == exp["child_count"],
          f"got {len(children)}, expected {exp['child_count']}")

    # --- title_format ---
    title = str(parent.get("title", ""))
    title_ok = (title.startswith(exp["title_starts_with"])
                and exp["title_contains"] in title)
    check(results, "amazon_title_format", title_ok,
          f"title='{title[:60]}...'" if not title_ok else "")

    # --- bullet_count ---
    bullets = parent.get("bullet_points", [])
    check(results, "amazon_bullet_count",
          len(bullets) == exp["bullet_count"],
          f"got {len(bullets)}, expected {exp['bullet_count']}")

    # --- price_jpy ---
    child_prices = {c.get("sku", ""): c.get("price") for c in children}
    price_ok = True
    bad_p = []
    for sku, exp_price in exp["prices"].items():
        got = child_prices.get(sku)
        if got is None or int(got) != int(exp_price):
            price_ok = False
            bad_p.append(f"{sku}: got {got}, exp {exp_price}")
    check(results, "amazon_price_jpy", price_ok,
          "; ".join(bad_p[:3]) if bad_p else "")

    # --- pse_warning ---
    compliance = listing.get("compliance", {})
    cert = str(compliance.get("pse_cert_number", ""))
    warning = str(compliance.get("safety_warning", ""))
    pse_ok = (cert == exp["pse_cert"] and exp["pse_warning_contains"] in warning)
    check(results, "amazon_pse_warning", pse_ok,
          f"cert={cert}, warning contains '{exp['pse_warning_contains']}'={exp['pse_warning_contains'] in warning}"
          if not pse_ok else "")

    # --- browse_node ---
    node = str(parent.get("browse_node_id", ""))
    check(results, "amazon_browse_node",
          node == exp["browse_node"],
          f"got '{node}', expected '{exp['browse_node']}'" if node != exp["browse_node"] else "")


# ---------------------------------------------------------------------------
# Douyin checks
# ---------------------------------------------------------------------------

def verify_douyin(output_dir: Path, expected: dict, results: list):
    dpath = output_dir / "douyin_product.json"
    if not dpath.exists():
        check(results, "douyin_exists", False, "file not found")
        for cid in ["douyin_spec_groups", "douyin_price_cny",
                     "douyin_no_banned_words", "douyin_ccc_cert",
                     "douyin_category_path"]:
            check(results, cid, False, "skipped — file missing")
        return

    try:
        with open(dpath) as f:
            data = json.load(f)
        check(results, "douyin_exists", True)
    except json.JSONDecodeError as e:
        check(results, "douyin_exists", False, f"invalid JSON: {e}")
        for cid in ["douyin_spec_groups", "douyin_price_cny",
                     "douyin_no_banned_words", "douyin_ccc_cert",
                     "douyin_category_path"]:
            check(results, cid, False, "skipped — invalid JSON")
        return

    exp = expected["douyin"]
    product = data.get("product", data)

    # --- spec_groups (SKU count = 5) ---
    skus = product.get("skus", [])
    check(results, "douyin_spec_groups",
          len(skus) == exp["sku_count"],
          f"got {len(skus)} SKUs, expected {exp['sku_count']}")

    # --- price_cny ---
    sku_prices = {s.get("sku_id", ""): s.get("price") for s in skus}
    price_ok = True
    bad_p = []
    for sku, exp_price in exp["prices"].items():
        got = sku_prices.get(sku)
        if got is None or int(got) != int(exp_price):
            price_ok = False
            bad_p.append(f"{sku}: got {got}, exp {exp_price}")
    check(results, "douyin_price_cny", price_ok,
          "; ".join(bad_p[:3]) if bad_p else "")

    # --- no_banned_words ---
    title = str(product.get("title", ""))
    desc = str(product.get("description", ""))
    text = title + " " + desc
    found = [w for w in exp["banned_words"] if w in text]
    check(results, "douyin_no_banned_words",
          len(found) == 0,
          f"found banned words: {found}" if found else "")

    # --- ccc_cert ---
    certs = product.get("certifications", [])
    ccc_found = any(
        str(c.get("cert_number", "")) == exp["ccc_cert"]
        for c in certs
    )
    check(results, "douyin_ccc_cert", ccc_found,
          f"CCC cert {exp['ccc_cert']} not found" if not ccc_found else "")

    # --- category_path ---
    cat = str(product.get("category_path", ""))
    check(results, "douyin_category_path",
          cat == exp["category_path"],
          f"got '{cat}', expected '{exp['category_path']}'" if cat != exp["category_path"] else "")


# ---------------------------------------------------------------------------
# Capability-unit folding (docs/check-granularity.md)
# ---------------------------------------------------------------------------
#
# The 20 atoms above are aggregated into 11 capability-unit checks. Each group
# is the AND of its member atoms; the per-atom failure detail is preserved in
# the emitted `reason` so debugging signal is intact. This is pure aggregation
# (no predicate is altered or loosened), so per-case binary `passed` is
# identical to the old 20-atom schema (all(atoms) == all(groups)).

# group id -> (description, [member atom ids])
GROUP_SPECS: list[tuple[str, str, list[str]]] = [
    # R2 — all deliverable-file plumbing (3 files present + parse) folds to one.
    ("setup_gate",
     "All three deliverable files produced and parse cleanly.",
     ["shopify_exists", "amazon_exists", "douyin_exists"]),
    # R3 — one skill (apply PM Pro-colors correction → 5 variants, not 6)
    # tested across all three platform files.
    ("variant_matrix_correct",
     "Final sellable variant matrix is 5 SKUs (PM Pro→Titanium-only applied) on every platform.",
     ["shopify_variant_count", "amazon_child_count", "douyin_spec_groups"]),
    # R3 — platform pricing competency (formula + PM Pro-price correction +
    # rounding) across the three platforms.
    ("pricing_correct",
     "Per-platform prices computed correctly (USD direct / JPY ×150→…90 / CNY ×7.2→…9, PM Pro price applied).",
     ["shopify_prices_usd", "amazon_price_jpy", "douyin_price_cny"]),
    # R3 — Solo-weight handling: PM weight correction (98g) and the metric→
    # imperial conversion of that same value (3.46oz).
    ("unit_conversion_correct",
     "Solo weight uses PM-corrected 98g and the metric→imperial conversion (98g = 3.46oz) is present.",
     ["shopify_pm_weight", "shopify_imperial_units"]),
    # R3 — compliance certificate / mandated-warning sourcing across platforms.
    ("compliance_certs_warnings",
     "Mandated compliance content sourced correctly (Amazon PSE cert + safety warning; Douyin CCC cert).",
     ["amazon_pse_warning", "douyin_ccc_cert"]),
    # R3 — category-taxonomy mapping sourced from category_mapping.csv across
    # the two platforms that require it.
    ("category_taxonomy_correct",
     "Category taxonomy mapped correctly (Amazon browse node + Douyin category path).",
     ["amazon_browse_node", "douyin_category_path"]),
    # R4 — distinct single-skill capabilities below.
    ("shopify_seo_keywords",
     "Shopify SEO description contains all required keywords.",
     ["shopify_seo_keywords"]),
    ("shopify_main_image",
     "Shopify first image (position 1) is the white-background main shot.",
     ["shopify_main_image"]),
    ("amazon_title_format",
     "Amazon parent title follows the brand title formula (starts TrailBlaze, contains ThermoJet).",
     ["amazon_title_format"]),
    ("amazon_bullet_count",
     "Amazon parent listing has exactly 5 bullet points.",
     ["amazon_bullet_count"]),
    # R6 — advertising-law restraint (negative capability).
    ("douyin_banned_words_compliance",
     "Douyin title/description contain no advertising-law banned words.",
     ["douyin_no_banned_words"]),
]


def fold_atoms(atoms: dict[str, dict]) -> list[dict]:
    """Aggregate the per-atom results into capability-unit checks.

    Each group passes iff all its member atoms passed. The `reason` lists the
    failing members (with their atom-level detail) so diagnosis is preserved.
    """
    folded: list[dict] = []
    for gid, gdesc, members in GROUP_SPECS:
        failing = []
        for aid in members:
            a = atoms.get(aid)
            if a is None:
                failing.append(f"{aid}: <missing atom>")
            elif not a["passed"]:
                d = a.get("detail") or "fail"
                failing.append(f"{aid}: {d}")
        ok = not failing
        folded.append({
            "id": gid,
            "passed": ok,
            "reason": "ok" if ok else "; ".join(failing),
            "check_type": "deterministic_exact",
        })
    return folded


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    reward_path = Path(args.reward_json)

    expected = load_expected(task_dir)
    results = []

    verify_shopify(output_dir, expected, results)
    verify_amazon(output_dir, expected, results)
    verify_douyin(output_dir, expected, results)

    # Index the 20 atomic predicate results by id (byte-identical to before),
    # then fold into capability-unit checks for the reward breakdown.
    atoms = {
        r["id"]: {"passed": bool(r.get("passed")),
                  "detail": str(r.get("detail") or r.get("reason") or "")}
        for r in results
    }
    checks = fold_atoms(atoms)

    passed = sum(1 for r in checks if r["passed"])
    total = len(checks)
    score = round(passed / total, 4) if total > 0 else 0.0

    reward = {
        "schema_version": "2.0",
        "task_id": task_dir.name,
        "score": score,
        "reward": score,
        "passed": total > 0 and passed == total,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "summary": f"{passed}/{total} checks passed",
        "source": "v2_verify_task",
    }

    reward_path.parent.mkdir(parents=True, exist_ok=True)
    with open(reward_path, "w", encoding="utf-8") as f:
        json.dump(reward, f, indent=2, ensure_ascii=False)

    print(f"Score: {passed}/{total} = {score:.2%}")
    for r in checks:
        mark = "PASS" if r["passed"] else "FAIL"
        detail = f" — {r['reason']}" if r.get("reason") else ""
        print(f"  [{mark}] {r['id']}{detail}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
