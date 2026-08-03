I need you to review a draft Amazon US product detail page for `HPT-750-SS` — the HydraPeak Trail 750ml Base model with LoopCap v2. The product team copied and adapted claims from supplier material, certificates, lab results, and internal notes, and I need you to decide which draft claims can stay as written, which need narrower wording, which should come out, and which need more evidence before we use them.

Everything is local — this is an offline review, so don't browse the live web, and treat the source-page and policy files as frozen snapshots prepared for this review. The draft you're reviewing is `workspace/listing_draft.md`. The evidence sits alongside it in `workspace/`: `compliance_inbox.md` (internal notes), `lab_test_results.csv`, `certificates/supplier_certificate_summaries.md`, and the two authoritative rule documents under `policies/full_reference/` — the Amazon listings product-detail-page guide and the FTC Green Guides (16 CFR Part 260), both full PDFs you should actually read. The Alibaba source page is captured under `source_pages/`: `alibaba_product_page_snapshot.html` is the readable offline page (its images load from the local `source_pages/assets/alibaba_product_images/` folder), `raw/alibaba_product_page_raw.html` is the original saved fragment kept for provenance, and `state_manifest.md` describes the snapshot set. Don't modify anything under `workspace/` — those are frozen reference files.

For every claim in `listing_draft.md`, make exactly one decision:

- `approve` — the claim is supportable as written for HPT-750-SS.
- `revise` — the claim can be used only with narrower wording.
- `remove` — the claim should not appear on the product detail page.
- `needs_more_evidence` — don't use the claim yet; a specific missing evidence type is needed.

Base every call on the local evidence, including the full PDF rule documents and the Alibaba snapshot. Preserve commercially useful, supported product benefits where you can, but don't keep broad or unsupported wording.

Write exactly three files to `outputs/` (and nothing else): `claim_review.json`, `revised_listing.md`, and `evidence_manifest.json`.

`claim_review.json` uses this top-level shape:

```json
{
  "claim_decisions": [
    {
      "claim_id": "CLM-EXAMPLE",
      "decision": "<approve|revise|remove|needs_more_evidence>",
      "reason_code": "<one of the allowed reason codes below>",
      "supporting_evidence_ids": ["<EVIDENCE-ID-1>", "<EVIDENCE-ID-2>"],
      "replacement_text": "<revised wording, only when decision is revise>",
      "rationale": "<short explanation tied to the local evidence>"
    }
  ],
  "listing_compliance_summary": {
    "approved_claims": 0,
    "revised_claims": 0,
    "removed_claims": 0,
    "needs_more_evidence_claims": 0
  }
}
```

Include exactly one `claim_decisions` object for each claim ID in `listing_draft.md`. `decision` must be one of `approve`, `revise`, `remove`, `needs_more_evidence`. `reason_code` must be one of: `substantiated`, `overbroad_environmental`, `wrong_component_scope`, `missing_or_expired_evidence`, `platform_prohibited`, `unsupported_performance`, `overabsolute_performance`, `wrong_product_scope`, `overbroad_safety`. `supporting_evidence_ids` should cite the local evidence IDs you used, drawn consistently from: `SOURCE-ALIBABA-PRIMARY`, `POL-AMZ-DETAIL`, `POL-FTC-GREEN`, `POL-FTC-NONTOXIC`, `CERT-LFGB-2026`, `CERT-BPA-2025`, `CERT-ROHS-PAINT-2024`, `SUP-RECYCLED-LETTER`, `LAB-TEMP-750-APR`, `LAB-LEAK-750-FEB`, `LAB-DISH-750-MAR`, `LAB-DROP-750-MAR`. `replacement_text` may be empty only when the decision is `remove`. `rationale` should explain the evidence boundary in one or two sentences.

`revised_listing.md` is a clean product-detail-page draft for HPT-750-SS only. Start with a level-one Markdown heading for the revised product title (the heading may be the title text itself, such as `# HydraPeak Trail ...`), and include `## Bullet Points`, `## Product Description`, and `## Care And Use` sections. The copy should be commercially usable but stay inside the evidence boundaries of the local files.

`evidence_manifest.json` uses this shape:

```json
{
  "sources": [
    {
      "source_id": "<one of the evidence IDs listed above, e.g. POL-AMZ-DETAIL>",
      "file": "<path to the matching local file under workspace/>",
      "used_for_claims": ["<claim IDs from listing_draft.md that this source supports>"],
      "quoted_points": ["<concise evidence note; include page / section / table / certificate ID / test ID / HTML anchor when available>"]
    }
  ]
}
```

Every `source_id` must be one of the evidence IDs above; `file` must point to an existing local file under `workspace/`; `used_for_claims` must contain claim IDs from `listing_draft.md`; and `quoted_points` must be a non-empty list of concise evidence notes — include page, section, table, certificate ID, test ID, or HTML section anchor whenever those are available.
