# Merchandising Thread

## 2026-05-20 - Category Manager (Linh)

We are four days from the June outdoor-promo lock and I want a clean parent decision before then. Merchandising is pushing all ten supplier products under TRAIL-750-PARENT. Catalog governance, please tell me what survives - decisions in `outputs/variant_audit.json` with an `evidence[]` cite for each candidate.

I do not want a "looks fine" answer. Each call should point at a specific local file (signal CSV row, source page, parent listing record, edit-history entry, OCR flag, or policy clause) so we can defend it to the supplier reps on Friday.

## 2026-05-21 - Catalog Associate (Maria)

I went through the supplier pages quickly. The matte black, ocean blue, and canyon red ones look identical to the parent except for color in the supplier images. Probably straightforward but governance still needs to verify against the OCR signal file and the variation policy on Color theme.

The two-pack is the awkward one. I know we have had bundle confusion before, but Sales is pushing it as "still the same product, just two of them". The returns analyst flagged a Q1 cohort issue - the actual rate is in `review_signals/returns_and_search_risk.csv` if anyone wants to cite it.

I am also not 100 percent on the FBA-prep variant. If it is a duplicate of an old archived child we already have on file, we should not be making a new child row at all - but I have not checked the parent edit history yet.

## 2026-05-21 - Sales / Demand Planning (Devansh)

I am pushing back on auto-rejecting the bundle and the FBA-prep variant. Both have buyers ready to convert this week. If governance wants to block them I need a written policy basis, not a feeling. Pull up `platform_policy/marketplace_variation_policy.pdf` and tell me which dimension is or is not enabled for this parent's category. Do not just say "different product".

Also - the glass-bodied bottle and the infuser-lid one feel close enough to color variants to me. They are still drinking bottles in the same family. If governance disagrees, point me at the exact policy clause.

## 2026-05-22 - Ops / FBA Lead (Priya)

Heads up on the FBA-prep black SKU (TRAIL-750-BLK-FBA). Receiving flagged the carton because the barcode looks similar to one we have seen before. Whether that is actually a duplicate of an archived child or just a SKU rename - I genuinely do not know.

Cross-check it against `catalog/parent_edit_history.json` and the workflow flag in `review_signals/image_ocr_and_packaging_flags.csv` before deciding. The variation policy has a clause about fulfilment-only differences too; look that up before signing off.

## 2026-05-22 - Returns Analyst (Jonas)

Two data points from my side, take them as risk signals not verdicts:

- The Q1 cohort of bundle SKUs sold under the parent had elevated "I only got one bottle" contacts. The exact rate is in `review_signals/returns_and_search_risk.csv`. Doesn't automatically kill TRAIL-750-2PK, but it is a known failure mode for that pack pattern.
- The infuser-lid product (TRAIL-INFUSER-GRN) keeps coming up in our 90-day Q&A logs in the way customers ask whether a tea basket is included. Some shoppers clearly treat that as a different shopping intent. Whether that means it is a different product or just a cap-style variant is governance's call, not mine.

## 2026-05-22 - Search Lead (Aiyana)

Search log perspective: kids straw, glass-bodied, infuser, wood-lid, and the 1000ml candidate all show distinct query intents from the standard insulated steel 750ml parent. That does not by itself tell you whether they are variants or separate products - the marketplace's variation theme rules are what decide that.

Check `review_signals/category_variation_template.csv` for which themes the Water Bottles parent supports today and which would force a parent rebuild instead. Then cross-reference against the variation policy.

## 2026-05-22 - Catalog Associate (Maria, follow-up)

One more thing I noticed in `parent_edit_history.json`: there is a 2026-05-18 event about a prior size-theme rebuild attempt that was rejected. Relevant for at least one of the size-changing candidates - I will leave it to governance to decide which one(s).

## 2026-05-23 - Merchandising (Devansh, follow-up)

Look I just need decisions in the audit JSON for all ten candidates. If something is `needs_fix` give me a concrete `required_fix` string I can hand back to the supplier - not just "wrong product".

Cite the policy clause AND the signal-row evidence that drove each call so I can defend it on Friday. Use the `evidence` array on each candidate. One cite per source minimum: at least one signal-file row and at least one policy clause per SKU.

## 2026-05-23 - Catalog Associate (Maria)

Final reminder: all 10 candidates from `proposed_children.csv` need governance decisions before Friday. Please go through each one systematically against the signal files and the variation policy. Devansh wants defensibility, not adjectives.
