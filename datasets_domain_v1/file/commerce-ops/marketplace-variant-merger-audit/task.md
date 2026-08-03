I'm the catalog governance reviewer for a marketplace seller. Before a promotion, the merchandising team wants to merge a batch of proposed supplier products into one existing parent listing, and I need you to decide which proposed children can join the parent variation family, which must stay separate, which are duplicate workflow records, and which need corrected attributes, a parent rebuild, or more evidence before submission.

This is an offline review — don't browse live websites, and don't modify any of the source files. Everything is under `workspace/`. The platform rules are in `platform_policy/`: `marketplace_variation_policy.pdf` (variation families and prohibited child/parent relationships) and `amazon_product_detail_page_guide.pdf` (listing / image / content constraints). The catalog state is in `catalog/`: `current_parent_listing.json` (the current parent and its child ASIN/SKU map), `parent_edit_history.json` (recent parent contribution, theme, and duplicate-child history), and `proposed_children.csv` (the merchandising team's proposed additions). Source-page evidence sits in `source_pages/` — `reference_alibaba_water_bottle_snapshot.html` for the base bottle, `supplier_product_pages/` for the proposed products, and `assets/alibaba_product_images/` for the local downloaded images. Supporting signals are in `review_signals/` (image OCR flags, category template constraints, return/search risk signals), product and package images in `images/`, and the internal request — with the usual noisy business pressure — in `messages/merchandising_thread.md`.

Work each candidate across the dimensions that matter: product identity, material, size, pack count, color, cap/accessory differences, duplicate or archived child history, images and OCR flags, category template constraints, return/search risk signals, policy constraints, and the source-page evidence. Preserve valid commercial opportunities, but don't merge products that would mislead shoppers or violate variation policy.

Write exactly three files to `outputs/`: `variant_audit.json`, `revised_variation_matrix.csv`, and `evidence_notes.md`.

`variant_audit.json` uses this top-level shape:

```json
{
  "parent_decision": "partial_accept",
  "candidate_decisions": [
    {
      "candidate_sku": "SKU-EXAMPLE",
      "decision": "accept | reject | needs_fix",
      "reason_code": "same_product_valid_variant | duplicate_fulfillment_workflow | wrong_product_type | material_mismatch | pack_count_mismatch | unsupported_claim | image_conflict | missing_evidence",
      "evidence": [
        {
          "source_file": "workspace/review_signals/<csv-or-json filename>",
          "cite": "short verbatim quote or distinctive token from the actual row that drove this decision"
        },
        {
          "source_file": "workspace/platform_policy/marketplace_variation_policy.pdf",
          "cite": "short verbatim quote or section name from the policy clause that backs this decision"
        }
      ],
      "required_fix": "empty when not applicable"
    }
  ],
  "parent_strategy": {
    "recommended_theme": "keep_current | rebuild_parent | split_parent",
    "rationale": "short rationale",
    "duplicate_or_migration_notes": ["short notes"]
  },
  "submission_risks": ["short risk bullets"]
}
```

Every candidate decision must include an `evidence` array with at least (1) one item whose `source_file` points to the specific local signal/source/catalog file that drove the call, and (2) one item whose `source_file` points to a policy file under `workspace/platform_policy/`. Each `cite` must be a short verbatim quote, distinctive token, or section name pulled from that source — generic paraphrasing of the merchandising thread is not enough.

`revised_variation_matrix.csv` is a clean parent/child variation matrix for only the accepted or fixable children, with columns: `parent_sku,child_sku,variation_theme,color,size,pack_count,material,submission_status,notes`.

`evidence_notes.md` summarizes the important evidence trail with source filenames and page/section/image references — concise enough for a catalog manager to review.
