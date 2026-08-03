I need you to recover a suppressed marketplace listing for a 750ml stainless-steel water bottle. Go through every suppression reason on the listing, draft policy-compliant replacement copy narrowed to what the supplier evidence actually supports, pick the right primary image, and attach file-path evidence for each resolution. Anything that lacks sufficient backing should be flagged and kept out of the listing rather than papered over — don't reach for unsupported or restricted claims just to get the page live. The restored listing still has to be commercially useful, not just compliant. Leave a short recovery note for the catalog team at the end.

Everything is local under `workspace/` — offline task, no network. The listing itself is in `listing/current_listing_state.json` (the live suppressed fields plus the per-field suppression-code list), mirrored visually in the frozen Seller Central snapshot `workbench/suppression_workbench_snapshot.html`. The rules are in `policies/`: `listing_quality_and_restricted_claims.pdf` (prohibited promo / restricted safety / image-overlay policy) and `amazon_product_detail_page_guide.pdf` (title, image, and prohibited-content constraints). Your evidence is in `source_evidence/`: `supplier_certificates.md` (LFGB / BPA / lab temperature / lab leak / lab dishwasher / packaging-BOM / competitor-price evidence, each with its own identifier) and `product_photos/` (the two candidate primary images). The review inputs are in `review_inputs/`: `field_level_suppression_export.csv` (per-field current value + suppression code), `candidate_copy_options.csv` (candidate replacement copy per field), `case_history.json` (prior recovery attempts and what failed), and `image_ocr_results.json` (OCR text extracted from each candidate image). The internal discussion — Marketplace Ops, Compliance, Creative, Search Ops, and the Sustainability PM all weighing in — is in `messages/catalog_team_thread.md`.

Write three files under `outputs/`.

`corrected_listing_fields.json` holds the corrected listing content:

```json
{
  "title": "...",
  "bullet_1": "...",
  "bullet_2": "...",
  "bullet_3": "...",
  "bullet_4": "...",
  "bullet_5": "...",
  "description": "...",
  "search_terms": "...",
  "image_recommendation": {
    "selected_image_file": "<path to chosen image>",
    "rejected_image_file": "<path to rejected image>",
    "reason": "<why>"
  },
  "suppression_reason_resolutions": {
    "<SUPPRESSION_CODE>": {
      "evidence_file": "<workspace path to supporting evidence>",
      "resolution_action": "<what you changed and why>"
    }
  },
  "fields_needing_more_evidence": [
    {
      "field": "<field_name>",
      "topic": "<claim that cannot be substantiated>",
      "reason": "<why evidence is insufficient>"
    }
  ]
}
```

For each suppressed field, select or draft compliant copy narrowed to what the lab reports and certificates actually demonstrate, and under `suppression_reason_resolutions` address every suppression code found in the listing state file. For `search_terms`, use only product-descriptive backend tokens that comply with platform keyword policy — no brand names, competitor names, or promotional phrases. Backend tokens must come from this set (case-insensitive): `750ml, 750, insulated, stainless, steel, water, bottle, loop, cap, loopcap, matte, black, hiking, commute, commuter, lfgb, bpa, free, bpa-free, 304, outdoor, outdoors, reusable, gym, sport, sports, travel, school, workout, thermos, vacuum, hydration, drinkware, tumbler, fitness, trail, and, with, for, the`. Any other token — including brand names and promo phrases — will fail the platform's backend keyword audit.

`evidence_manifest.json` maps each changed field or removed claim to the local evidence or policy source that justifies it, referencing actual file paths under `workspace/`.

`recovery_note.md` is a brief note for the catalog team summarizing what changed, the evidence basis, and any items needing follow-up.
