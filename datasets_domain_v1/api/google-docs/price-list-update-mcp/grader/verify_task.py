#!/usr/bin/env python3
"""Verifier for google-docs-price-list-update-mcp.

Outcome-based, block-id-agnostic verifier.

The verifier locates product lines by CONTENT (SKU substring match) within the
document's two named regions — the current-catalogue region and the Q2-reference
region — rather than by fixed block ids.  An agent whose edits split/merge blocks
and therefore change block ids will still pass as long as the resulting text is
correct.

Regions are identified structurally:
  - Current-catalogue region: blocks that come AFTER the "Products" heading and
    BEFORE the "Notes" heading.  (The Q2 reference section begins with a heading
    that contains "Previous Quarter".)
  - Q2-reference region: blocks that come AFTER the "Previous Quarter" heading.

The verifier evaluates 17 atom-level predicates, then folds them into 9 stable
capability checks by pure AND aggregation. Binary reward is unchanged: all
capability groups pass iff every atom passes.

Capability checks emitted:
  1. setup_gate                 — mock state readable and target doc present/unique.
  2. imported_prices_updated    — all imported current-catalogue SKUs have the
                                  correct surcharge and $0.05 rounding.
  3. exempt_prices_preserved    — domestic, discontinued, and re-sourced SKUs keep
                                  their original prices.
  4. catalogue_structure_intact — each SKU appears exactly once in the
                                  current-catalogue region.
  5. q2_reference_intact        — Q2 reference rows keep original prices.
  6. structural_blocks_intact   — title, intro, headings, and footer remain.
  7. distractor_doc_unchanged   — supplier-contact distractor doc remains unchanged.
  8. document_count_unchanged   — no document was created/deleted/trashed.
  9. workspace_batch_update_used — at least one Workspace/MCP document update tool
                                  was used.

Discrimination:
  - Agent that applies surcharge to ALL 'Imported' items (including re-sourced
    AG-205): fails price_unchanged:AG-205.
  - Agent that rounds to $0.01 instead of $0.05: fails price_updated:AG-{100,115,145,175}.
  - Agent that modifies Q2 reference prices: fails q2_reference_intact.
  - Agent that drops/merges a product row: fails catalogue_structure_intact.
  - Agent with correct prices but different block ids (split/merge edits): PASSES.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fetch_state(mock_url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{mock_url.rstrip('/')}/api/state",
        headers={"X-Mock-Verifier-Token": token},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def check(check_id: str, passed: bool, reason: str = "") -> dict[str, Any]:
    return {
        "id": check_id,
        "passed": bool(passed),
        "reason": reason[:500],
        "check_type": "deterministic_state",
    }


def find_file_by_id(state: dict[str, Any], file_id: str) -> dict[str, Any] | None:
    for f in state.get("files") or []:
        if f.get("id") == file_id:
            return f
    return None


def find_docs_by_name(state: dict[str, Any], name: str) -> list[dict[str, Any]]:
    return [
        f for f in state.get("files") or []
        if f.get("type") == "document"
        and not f.get("trashed")
        and f.get("name") == name
    ]


def block_texts(doc: dict[str, Any]) -> list[str]:
    """Return ordered list of non-empty block texts for the document."""
    return [
        b.get("text") or ""
        for b in (doc.get("content") or {}).get("blocks") or []
    ]


def partition_regions(doc: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Split block texts into (current_catalogue_region, q2_reference_region).

    current_catalogue_region: blocks after the "Products" heading and before
        the "Notes" heading or end of doc, but stopping if a block whose text
        contains "Previous Quarter" is found.
    q2_reference_region: blocks after the first block containing "Previous Quarter".

    Returns two lists of text strings (not block objects, for id-independence).
    """
    blocks = (doc.get("content") or {}).get("blocks") or []
    texts = [b.get("text") or "" for b in blocks]

    # Locate the "Products" heading (case-sensitive exact match OR startswith)
    products_idx = -1
    notes_idx = -1
    q2_idx = -1

    for i, t in enumerate(texts):
        if products_idx < 0 and t.strip() == "Products":
            products_idx = i
        if notes_idx < 0 and t.strip() == "Notes":
            notes_idx = i
        if q2_idx < 0 and "Previous Quarter" in t:
            q2_idx = i

    # Current catalogue region: after "Products", before "Notes" (or q2 heading)
    if products_idx >= 0:
        cat_start = products_idx + 1
        if q2_idx >= 0 and q2_idx > products_idx:
            cat_end = q2_idx
        elif notes_idx >= 0 and notes_idx > products_idx:
            cat_end = notes_idx
        else:
            cat_end = len(texts)
        catalogue_region = texts[cat_start:cat_end]
    else:
        # Fallback: treat all blocks as catalogue (degenerate case)
        catalogue_region = texts[:]

    # Q2 reference region: after the "Previous Quarter" heading
    if q2_idx >= 0:
        q2_region = texts[q2_idx + 1:]
    else:
        q2_region = []

    return catalogue_region, q2_region


def find_lines_containing(region: list[str], sku: str) -> list[str]:
    """Return all lines in region that contain the SKU string."""
    return [line for line in region if sku in line]


def is_product_price_line(text: str, sku: str) -> bool:
    """Return True if text looks like a product price line for the given SKU.

    A product price line starts with the SKU (e.g. "AG-205 —") and contains
    "/ unit".  Note blocks (which also reference the SKU) do not start with
    the SKU directly and are therefore excluded.
    """
    stripped = text.strip()
    return stripped.startswith(sku) and "/ unit" in stripped


def workspace_tool_count(state: dict[str, Any], tool_names: set[str]) -> int:
    return sum(
        1 for event in state.get("events") or []
        if event.get("type") == "workspace_tool_called" and event.get("toolName") in tool_names
    )


def fold_checks(raw_checks: list[dict[str, Any]], expected: dict[str, Any]) -> list[dict[str, Any]]:
    """Fold atom checks into capability groups.

    This is an emit-layer transform only: every group passes iff all member atoms
    pass. Missing atoms are treated as failures so early verifier errors remain
    fail-loud.
    """
    by_id = {item["id"]: item for item in raw_checks}
    products = expected.get("products") or []
    imported_ids = [
        prod["check_id"]
        for prod in products
        if prod.get("origin") == "imported"
    ]
    exempt_ids = [
        prod["check_id"]
        for prod in products
        if prod.get("origin") != "imported"
    ]
    group_specs: list[tuple[str, list[str]]] = [
        ("setup_gate", ["mock_state_readable", "target_doc_present", "target_doc_unique"]),
        ("imported_prices_updated", imported_ids),
        ("exempt_prices_preserved", exempt_ids),
        ("catalogue_structure_intact", ["catalogue_structure_intact"]),
        ("q2_reference_intact", ["q2_reference_intact"]),
        ("structural_blocks_intact", ["structural_blocks_intact"]),
        ("distractor_doc_unchanged", ["distractor_doc_unchanged"]),
        ("document_count_unchanged", ["document_count_unchanged"]),
        ("workspace_batch_update_used", ["workspace_batch_update_used"]),
    ]

    expected_atoms = {atom for _gid, atoms in group_specs for atom in atoms}
    extras = sorted(set(by_id) - expected_atoms)
    if extras:
        raise AssertionError(f"unmapped atom ids (incomplete partition): {extras}")

    grouped: list[dict[str, Any]] = []
    for group_id, atom_ids in group_specs:
        fails: list[tuple[str, str]] = []
        for atom_id in atom_ids:
            atom = by_id.get(atom_id)
            if atom is None:
                fails.append((atom_id, "atom was not evaluated"))
            elif not atom.get("passed"):
                fails.append((atom_id, str(atom.get("reason") or "")))

        if not fails:
            reason = f"ok ({len(atom_ids)} atom(s))"
        else:
            detail = "; ".join(f"{atom_id}: {reason}" for atom_id, reason in fails)
            reason = f"{len(fails)}/{len(atom_ids)} atom(s) failed -> {detail}"

        grouped.append(check(group_id, not fails, reason))

    return grouped


# ---------------------------------------------------------------------------
# Evaluate
# ---------------------------------------------------------------------------

def evaluate(
    expected: dict[str, Any],
    state: dict[str, Any],
    state_err: str = "",
) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    if state_err:
        return [check("mock_state_readable", False, state_err)]
    checks.append(check("mock_state_readable", True, "state fetched OK"))

    target_name: str = expected["target_doc_name"]
    target_id: str = expected["target_doc_id"]

    # ------------------------------------------------------------------
    # Check 1: target doc exists (by ID) and was not trashed
    # ------------------------------------------------------------------
    target_doc = find_file_by_id(state, target_id)
    if target_doc is None:
        checks.append(check("target_doc_present", False,
                             f"doc id {target_id!r} not found in state"))
        # Cannot proceed without the target doc; add failing stubs
        for prod in expected.get("products") or []:
            checks.append(check(prod["check_id"], False, "target doc missing"))
        checks.append(check("catalogue_structure_intact", False, "target doc missing"))
        checks.append(check("q2_reference_intact", False, "target doc missing"))
        checks.append(check("structural_blocks_intact", False, "target doc missing"))
        checks.append(check("distractor_doc_unchanged", False, "target doc missing"))
        checks.append(check("document_count_unchanged", False, "target doc missing"))
        return checks

    checks.append(check(
        "target_doc_present",
        not bool(target_doc.get("trashed")),
        f"doc {target_id!r} present and not trashed",
    ))

    # ------------------------------------------------------------------
    # Check 2: exactly one document with the target name
    # ------------------------------------------------------------------
    name_matches = find_docs_by_name(state, target_name)
    checks.append(check(
        "target_doc_unique",
        len(name_matches) == 1,
        f"expected 1 doc named {target_name!r}, found {len(name_matches)}",
    ))

    # ------------------------------------------------------------------
    # Partition document into regions (id-agnostic)
    # ------------------------------------------------------------------
    catalogue_region, q2_region = partition_regions(target_doc)

    # ------------------------------------------------------------------
    # Checks 3/4: Per-product price checks — locate by SKU content in
    #             catalogue region, not by block id.
    #
    # We only consider lines that look like product price lines (start with
    # the SKU and contain "/ unit") so that note/annotation blocks (e.g. the
    # AG-205 re-sourcing note) do not confuse the match.
    # ------------------------------------------------------------------
    products = expected.get("products") or []
    for prod in products:
        sku: str = prod["sku"]
        want_text: str = prod["expected_block_text"]
        origin: str = prod["origin"]
        check_id: str = prod["check_id"]

        matching_lines = [
            line for line in catalogue_region
            if is_product_price_line(line, sku)
        ]

        if not matching_lines:
            checks.append(check(
                check_id,
                False,
                f"no product price line for {sku!r} found in current-catalogue region "
                f"(region has {len(catalogue_region)} lines; "
                f"products heading/notes heading may be missing or misidentified)",
            ))
            continue

        # At least one match — check whether any line equals the expected text
        passed = any(line == want_text for line in matching_lines)
        if passed:
            if origin == "imported":
                action = "surcharge applied"
            elif origin == "re-sourced":
                action = "unchanged (re-sourced domestic, exempt)"
            else:
                action = "unchanged"
            reason = f"correct ({origin} item price {action})"
        else:
            # Report the first matching line vs expected
            actual = matching_lines[0]
            reason = f"got {actual!r:.200}, want {want_text!r:.200}"
        checks.append(check(check_id, passed, reason))

    # ------------------------------------------------------------------
    # Check 5: catalogue_structure_intact
    # Each of the 8 SKUs appears exactly once as a product price line in the
    # catalogue region (lines starting with SKU and containing "/ unit").
    # Catches dropped or merged product rows.  Note/annotation blocks that
    # reference the same SKU are intentionally excluded from the count.
    # ------------------------------------------------------------------
    expected_skus = [prod["sku"] for prod in products]
    struct_passed = True
    struct_reason_parts: list[str] = []
    for sku in expected_skus:
        count = sum(1 for line in catalogue_region if is_product_price_line(line, sku))
        if count != 1:
            struct_passed = False
            struct_reason_parts.append(f"{sku}: {count} product-price-line(s) in catalogue region")
    checks.append(check(
        "catalogue_structure_intact",
        struct_passed,
        "all 8 SKUs appear exactly once in catalogue region"
        if struct_passed
        else "; ".join(struct_reason_parts),
    ))

    # ------------------------------------------------------------------
    # Check 6: q2_reference_intact
    # Each SKU appears exactly once in the Q2 reference region with its
    # original price text.  Checks the section exists and is untouched.
    # ------------------------------------------------------------------
    ref_products = expected.get("q2_reference_products") or []
    q2_all_ok = True
    q2_reason_parts: list[str] = []

    if not q2_region:
        q2_all_ok = False
        q2_reason_parts.append("Q2 reference region not found (missing 'Previous Quarter' heading)")
    else:
        for rp in ref_products:
            sku: str = rp["sku"]
            want: str = rp["expected_text"]
            matching = [
                line for line in q2_region
                if is_product_price_line(line, sku)
            ]
            if len(matching) == 0:
                q2_all_ok = False
                q2_reason_parts.append(f"{sku}: missing from Q2 reference region")
            elif len(matching) > 1:
                q2_all_ok = False
                q2_reason_parts.append(f"{sku}: {len(matching)} lines in Q2 region (expected 1)")
            elif matching[0] != want:
                q2_all_ok = False
                q2_reason_parts.append(
                    f"{sku}: got {matching[0]!r:.150}, want {want!r:.150}"
                )

    checks.append(check(
        "q2_reference_intact",
        q2_all_ok,
        "Q2 reference region fully intact"
        if q2_all_ok
        else "; ".join(q2_reason_parts),
    ))

    # ------------------------------------------------------------------
    # Check 7: structural_blocks_intact
    # Key structural texts (title, intro, headings, footer) must appear
    # somewhere in the document.  Id-agnostic: search block texts list.
    # ------------------------------------------------------------------
    all_texts = block_texts(target_doc)
    structural_required = {
        "struct_title": "AccessoryHub Wholesale Price List — Q3 2026",
        "struct_intro": "Wholesale unit prices, USD, exclusive of tax and freight.",
        "struct_heading_products": "Products",
        "struct_heading_notes": "Notes",
        "struct_footer": (
            "All prices are USD, ex-warehouse. Minimum order quantity: 50 units per SKU. "
            "Discontinued items remain available while stock lasts; no reorders accepted."
        ),
    }
    struct_block_ok = True
    struct_block_parts: list[str] = []
    for label, want in structural_required.items():
        if want not in all_texts:
            struct_block_ok = False
            struct_block_parts.append(f"{label}: text not found in any block")
    checks.append(check(
        "structural_blocks_intact",
        struct_block_ok,
        "all structural blocks present"
        if struct_block_ok
        else "; ".join(struct_block_parts),
    ))

    # ------------------------------------------------------------------
    # Check 8: Distractor document entirely unchanged
    # Id-based for the distractor (agent should not touch it at all)
    # ------------------------------------------------------------------
    dist_info: dict[str, Any] = expected.get("distractor_doc") or {}
    dist_id: str = dist_info.get("id", "")
    dist_orig_texts: dict[str, str] = dist_info.get("block_original_texts") or {}

    dist_doc = find_file_by_id(state, dist_id)
    if dist_doc is None:
        checks.append(check("distractor_doc_unchanged", False,
                             f"distractor doc {dist_id!r} missing"))
    else:
        actual_dist_texts = {
            b["id"]: (b.get("text") or "")
            for b in (dist_doc.get("content") or {}).get("blocks") or []
        }
        mismatches = [
            bid for bid, orig in dist_orig_texts.items()
            if actual_dist_texts.get(bid) != orig
        ]
        checks.append(check(
            "distractor_doc_unchanged",
            len(mismatches) == 0,
            "distractor unchanged"
            if not mismatches
            else f"modified blocks: {mismatches}",
        ))

    # ------------------------------------------------------------------
    # Check 9: Document count unchanged (no docs created or deleted)
    # ------------------------------------------------------------------
    expected_count: int = expected.get("expected_doc_count", 2)
    all_docs = [
        f for f in state.get("files") or []
        if f.get("type") == "document" and not f.get("trashed")
    ]
    checks.append(check(
        "document_count_unchanged",
        len(all_docs) == expected_count,
        f"expected {expected_count} docs, got {len(all_docs)}",
    ))
    checks.append(check(
        "workspace_batch_update_used",
        workspace_tool_count(state, {"docs.documents.batchUpdate", "find_and_replace_doc"}) >= 1,
        "expected a workspace/MCP document update tool call",
    ))

    return checks


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reward-json", required=True)
    parser.add_argument(
        "--mock-url",
        default=os.environ.get("MOCK_SITE_URL", "http://127.0.0.1:3081"),
    )
    parser.add_argument(
        "--verifier-token",
        default=os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier"),
    )
    args = parser.parse_args()

    task_dir = Path(args.task_dir)
    expected: dict[str, Any] = json.loads(
        (task_dir / "private" / "expected_answer.json").read_text()
    )

    Path(args.output_dir).mkdir(parents=True, exist_ok=True)

    state: dict[str, Any] = {}
    state_err = ""
    try:
        state = fetch_state(args.mock_url, args.verifier_token)
    except Exception as exc:  # pragma: no cover
        state_err = str(exc)

    raw_checks = evaluate(expected, state, state_err)
    all_checks = fold_checks(raw_checks, expected)
    n_pass = sum(1 for item in all_checks if item["passed"])
    n_total = len(all_checks)
    passed = n_total > 0 and n_pass == n_total
    failed_ids = [item["id"] for item in all_checks if not item["passed"]]
    result = {
        "schema_version": "2.0",
        "score": 1.0 if passed else 0.0,
        "reward": 1.0 if passed else 0.0,
        "raw_score": 1.0 if passed else 0.0,
        "raw_reward": 1.0 if passed else 0.0,
        "raw_passed": passed,
        "checks_passed": n_pass,
        "checks_total": n_total,
        "check_summary": {
            "passed": n_pass,
            "total": n_total,
            "failed": failed_ids,
        },
        "validation_checks": all_checks,
        "checks_breakdown": all_checks,
        "raw_validation_checks": raw_checks,
        "passed": passed,
    }
    Path(args.reward_json).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
