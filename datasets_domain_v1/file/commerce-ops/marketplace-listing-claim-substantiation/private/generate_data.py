#!/usr/bin/env python3
"""Generate local inputs for file-commerce-ops-marketplace-listing-claim-substantiation."""

from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FILES = ROOT / "files"
PRIVATE = ROOT / "private"

for path in [
    FILES,
    FILES / "source_pages",
    FILES / "source_pages" / "raw",
    FILES / "policies",
    FILES / "policies" / "full_reference",
    FILES / "certificates",
]:
    path.mkdir(parents=True, exist_ok=True)


(FILES / "state_manifest.md").write_text(
    """# State Manifest

This task is fully offline. Use only files under `/benchmark/tasks/file-commerce-ops-marketplace-listing-claim-substantiation/files/`.

The source page and policy files are local snapshots prepared for this benchmark. Do not browse the live web.

Primary local sources:

- `source_pages/alibaba_product_page_snapshot.html` - readable offline Alibaba product-page snapshot reconstructed from the raw page for normal review. It references downloaded product images from the local `assets/alibaba_product_images/` folder.
- `source_pages/raw/alibaba_product_page_raw.html` - raw Alibaba product-introduction HTML fragment captured from the public page. It keeps page chrome, embedded JSON, related-search noise, remote CSS references, and original product content for provenance.
- `source_pages/assets/alibaba_product_images/` - six downloaded product images from the raw page's `pageProductCard.productImage.urls` array plus a local source manifest.
- `policies/full_reference/ftc_green_guides_16_cfr_part_260.pdf` - official FTC Green Guides PDF, 36 pages.
- `policies/full_reference/amazon_listings_product_detail_page_guide.pdf` - Amazon Product Detail Page Guide PDF, 6 pages.
- `certificates/supplier_certificate_summaries.md` - supplier evidence packet with certificate scopes, validity dates, and non-authoritative sales notes.
- `lab_test_results.csv` - mixed lab-result export covering HPT-750-SS plus nearby SKU/component distractors.

Treat the PDFs and the readable page snapshot as the primary review sources. Use the raw HTML only when provenance or embedded page-data confirmation is needed. Internal notes may help identify review concerns, but they do not override source scope, certificate scope, or platform policy.
""",
    encoding="utf-8",
)


(FILES / "source_pages" / "alibaba_bpa_free_insulated_bottle.html").write_text(
    """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Alibaba snapshot - BPA Free Insulated 750ml 304 Stainless Steel Drinking 24oz Water Bottle</title>
  <meta name="source_url" content="https://www.alibaba.com/product-introduction/BPA-Free-Insulated-750ml-304-Stainless_1601367168287.html">
  <meta name="captured_for_benchmark" content="2026-05-24">
</head>
<body>
  <h1>BPA Free Insulated 750ml 304 Stainless Steel Drinking 24oz Water Bottle</h1>
  <section id="pricing">
    <p>200 - 999 Pieces: $3.80; 1000 - 4999 Pieces: $3.70; &gt;= 5000 Pieces: $3.50.</p>
    <p>Customization: customized logo min order 100 pieces; customized packaging min order 500 pieces.</p>
  </section>
  <section id="overview">
    <h2>Product overview</h2>
    <p>Hydration Solution: This BPA-free 304 stainless steel water bottle is designed to keep beverages hot or cold for extended periods.</p>
    <p>With a BPA-free 304 stainless steel construction, this water bottle ensures durability and safety, maintaining beverage temperature effectively with its double-wall vacuum insulation.</p>
    <p>With its 750ml capacity, the bottle caters to daily hydration needs, offering a solution that's approximately 20% more efficient in maintaining temperature than traditional models. Disclaimer: Based on internal testing; actual results may vary.</p>
    <p>With LFGB certification and eco-friendly features, you can trust in the quality and sustainability of this water bottle.</p>
  </section>
  <section id="technical-specifications">
    <h2>Technical specifications</h2>
    <table>
      <tr><th>Feature</th><th>Specification</th><th>Benefit</th></tr>
      <tr><td>Material</td><td>304 Stainless Steel</td><td>Durable and resistant to corrosion</td></tr>
      <tr><td>Insulation</td><td>Double Wall Vacuum</td><td>Maintains temperature for hours</td></tr>
      <tr><td>Capacity</td><td>750ml (24oz)</td><td>Ideal for daily hydration</td></tr>
      <tr><td>Certification</td><td>LFGB</td><td>Ensures safety and quality</td></tr>
      <tr><td>Portability</td><td>Handle on Lid</td><td>Easy to carry anywhere</td></tr>
    </table>
  </section>
  <section id="model-table">
    <h2>Choose your model</h2>
    <table>
      <tr><th>Parameter</th><th>Base Model</th><th>Advanced Model</th><th>Pro Model</th></tr>
      <tr><td>Insulation</td><td>Standard</td><td>+15%</td><td>+30%</td></tr>
      <tr><td>Capacity</td><td>750ml</td><td>1000ml</td><td>1500ml</td></tr>
      <tr><td>Material</td><td>304 SS</td><td>316 SS</td><td>Titanium</td></tr>
    </table>
    <p>Supplier note: The Pro version's insulation capability, 30% higher than industry benchmarks, combines with titanium build.</p>
  </section>
  <section id="comparison">
    <h2>Product comparison</h2>
    <p>Eco-Friendly Bottles: BPA-free materials, non-toxic and safe; environmentally friendly, safe for everyday use.</p>
    <p>Leak-Proof Bottles: leak-proof design prevents spills; ideal for carrying in bags without worry.</p>
  </section>
  <footer>
    <p>The product description is generated by third-party material and may differ from the details on the product listing page. Verify details with the supplier for the most accurate information.</p>
  </footer>
</body>
</html>
""",
    encoding="utf-8",
)


(FILES / "policies" / "ftc_green_guides_excerpt.md").write_text(
    """# FTC Environmental Claims - Local Excerpt

Source URL: https://www.ftc.gov/business-guidance/resources/environmental-claims-summary-green-guides
Captured for benchmark: 2026-05-24

Relevant rules for this listing review:

- Broad, unqualified general environmental benefit claims such as "green" or "eco-friendly" are difficult to substantiate. Marketers should qualify those claims with clear, prominent, and specific environmental benefits.
- If a qualified general claim conveys an overall environmental benefit because of a special attribute, marketers should analyze trade-offs from that attribute before making the claim.
- Certifications and seals may imply general environmental benefits if they do not clearly state the basis for the certification. A third-party certification does not by itself substantiate every express or implied claim.
- "Free-of" claims require that the product has no more than trace/background levels of the substance, that the amount does not cause the associated harm, and that the substance was not intentionally added.
- "Non-toxic" claims need competent and reliable scientific evidence that the product is safe for both people and the environment.
- Recycled-content claims should be made only for materials recovered or diverted from the waste stream, and partial recycled-content claims should be qualified with the percentage and basis.
""",
    encoding="utf-8",
)


(FILES / "policies" / "amazon_detail_page_rules_excerpt.md").write_text(
    """# Amazon Product Detail Page Guide - Local Excerpt

Source URL: https://m.media-amazon.com/images/G/35/sp-marketing-toolkit/Sellerfacingguides/Amazon_Listings_Product_Detail_Page_Guide.pdf
Captured for benchmark: 2026-05-24

Relevant rules for this listing review:

- Product detail pages should be clear, concise, accurate, and consistently formatted.
- Do not include seller-specific information such as price points, delivery speeds, or personal information.
- Titles, descriptions, bullet points, and images must not include phone numbers, physical mail addresses, email addresses, website URLs, availability, price, condition, alternative ordering information, alternative delivery offers, reviews, quotes, testimonials, solicitations for positive customer reviews, promotional material, watermarks, or time-sensitive information.
- All products must be appropriately and accurately categorized.
- Product titles, descriptions, and bullet points must assist the customer in understanding the product.
- Titles should be concise, should not use ALL CAPS, should not use subjective commentary such as "Hot Item" or "Best Seller", should not include the merchant name, and should contain only the minimal information needed to identify the item.
- Product descriptions should include accurate dimensions, care instructions, warranty information, correct grammar, and complete sentences.
- Bullet points should highlight the top five features, begin with a capital letter, write numbers as numerals, and avoid vague statements.
- New versions that materially differ in color, size, material, features, or product name should not be presented as the same existing listing.
""",
    encoding="utf-8",
)


# The public task uses the full PDF rule files and raw Alibaba HTML snapshot.
# Remove the short orientation excerpts if this helper is re-run locally.
for obsolete in [
    FILES / "source_pages" / "alibaba_bpa_free_insulated_bottle.html",
    FILES / "policies" / "ftc_green_guides_excerpt.md",
    FILES / "policies" / "amazon_detail_page_rules_excerpt.md",
]:
    obsolete.unlink(missing_ok=True)


(FILES / "certificates" / "supplier_certificate_summaries.md").write_text(
    """# Supplier Certificate Summaries

Product under review: HPT-750-SS, "HydraPeak Trail 750ml Insulated Stainless Bottle", Base model, matte slate finish, LoopCap v2.

## CERT-LFGB-2026

- Issuer: TUV Rheinland Food Contact Lab
- Certificate ID: LFGB-24-7750-HPT750
- Valid through: 2027-03-31
- Scope: HPT-750-SS Base model body, inner wall, rim, LoopCap v2 drinking surface, and silicone gasket.
- Result: Pass for LFGB food-contact migration requirements.
- Notes: Does not cover HPT-1000-SS Advanced model or HPT-1500-TI Pro model.

## CERT-BPA-2025

- Issuer: Intertek Polymer Safety Lab
- Certificate ID: BPA-ND-25-HPT-LID
- Valid through: 2026-09-15
- Scope: LoopCap v2 lid assembly, Tritan window, polypropylene latch, and silicone gasket used with HPT-750-SS and HPT-1000-SS.
- Result: BPA not detected above 0.01 mg/kg reporting limit.
- Notes: Certificate does not test stainless steel body because BPA is not used in the steel body.

## CERT-ROHS-PAINT-2024

- Issuer: SGS Coatings Lab
- Certificate ID: ROHS-PAINT-24-MATTE
- Valid through: 2025-12-31
- Scope: Matte slate powder coating on sample panels.
- Result: Heavy-metal limits passed for coating sample.
- Notes: Expired before this review date and is not a food-contact certificate.

## SUP-RECYCLED-LETTER

- Issuer: Ningbo Haiyuan Bottle Factory sales team
- Date: 2026-02-10
- Statement: The stainless-steel mill used by the supplier "often uses around 30% post-industrial scrap in 304 coils."
- Limitations: Not batch-specific; no mill certificate, chain-of-custody record, or finished-product bill of materials was provided.
""",
    encoding="utf-8",
)


(FILES / "lab_test_results.csv").write_text(
    "",
    encoding="utf-8",
)
with (FILES / "lab_test_results.csv").open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(
        fh,
        fieldnames=[
            "test_id",
            "sku",
            "component_scope",
            "test_date",
            "protocol",
            "result_summary",
            "claim_support",
            "limitations",
        ],
    )
    writer.writeheader()
    writer.writerows(
        [
            {
                "test_id": "LAB-TEMP-750-APR",
                "sku": "HPT-750-SS",
                "component_scope": "assembled bottle with LoopCap v2",
                "test_date": "2026-04-11",
                "protocol": "Cold start 4C and hot start 90C, ambient chamber 22C",
                "result_summary": "Cold liquid measured 9.8C after 24h; hot liquid measured 56C after 12h and 44C after 18h.",
                "claim_support": "Supports cold retention up to 24h below 10C and heat retention up to 12h under lab conditions.",
                "limitations": "Does not support hot retention for 24h; does not compare against industry benchmarks.",
            },
            {
                "test_id": "LAB-LEAK-750-FEB",
                "sku": "HPT-750-SS",
                "component_scope": "LoopCap v2 only",
                "test_date": "2026-02-19",
                "protocol": "30-min inverted static test plus 100-cycle bag-shake simulation",
                "result_summary": "No visible leakage in all 12 samples.",
                "claim_support": "Supports leak-resistant wording for LoopCap v2 under tested conditions.",
                "limitations": "Does not support absolute 'spills never happen' or straw-cap variants.",
            },
            {
                "test_id": "LAB-DISH-750-MAR",
                "sku": "HPT-750-SS",
                "component_scope": "body and LoopCap v2",
                "test_date": "2026-03-06",
                "protocol": "10-cycle consumer dishwasher simulation",
                "result_summary": "LoopCap v2 passed top-rack dishwasher cycle; powder-coated body showed dulling and label lift.",
                "claim_support": "Supports top-rack dishwasher-safe lid only.",
                "limitations": "Body should be hand-washed; does not support dishwasher-safe whole bottle.",
            },
            {
                "test_id": "LAB-DROP-750-MAR",
                "sku": "HPT-750-SS",
                "component_scope": "assembled bottle with LoopCap v2",
                "test_date": "2026-03-22",
                "protocol": "Five 1.2m drops onto plywood over concrete",
                "result_summary": "Bottle remained usable with two cosmetic dents and no cap failure.",
                "claim_support": "Supports durable stainless-steel construction; does not support dent-proof wording.",
                "limitations": "Not tested on bare concrete or from higher drops.",
            },
            {
                "test_id": "LAB-TEMP-1000-MAY",
                "sku": "HPT-1000-SS",
                "component_scope": "Advanced 1000ml model",
                "test_date": "2026-05-04",
                "protocol": "Cold start 4C, ambient chamber 22C",
                "result_summary": "Cold liquid measured 8.2C after 30h.",
                "claim_support": "Supports 30h cold retention for HPT-1000-SS only.",
                "limitations": "Different capacity and material stack; not evidence for HPT-750-SS.",
            },
        ]
    )


(FILES / "listing_draft.md").write_text(
    """# Draft Listing: HydraPeak Trail 750ml Insulated Stainless Bottle

Marketplace target: Amazon US product detail page
SKU under review: HPT-750-SS Base model, matte slate finish, LoopCap v2

## Draft title

HydraPeak Trail 750ml Eco-Friendly BPA-Free 304 Stainless Steel Insulated Water Bottle - LFGB Certified, 24H Hot or Cold, Leak-Proof, Best Seller, Free 2-Day Delivery

## Claim inventory

Use these claim IDs in your review output.

| claim_id | draft claim text | draft location |
|---|---|---|
| CLM-001 | Eco-friendly BPA-free 304 stainless steel insulated water bottle | title |
| CLM-002 | LFGB certified food-contact 304 stainless steel body | bullet 1 |
| CLM-003 | Keeps drinks cold for 24 hours | bullet 2 |
| CLM-004 | Keeps beverages hot or cold for 24 hours | A+ module |
| CLM-005 | 100% leak-proof; spills never happen | bullet 3 |
| CLM-006 | Dishwasher safe bottle and lid | bullet 4 |
| CLM-007 | Made with 30% recycled stainless steel | A+ sustainability module |
| CLM-008 | Non-toxic and safe for kids | bullet 5 |
| CLM-009 | FDA approved stainless steel | comparison chart |
| CLM-010 | Best Seller with 4.9-star customer reviews | title and A+ headline |
| CLM-011 | Free 2-day delivery and 20% launch discount this week | A+ banner |
| CLM-012 | Dent-proof titanium Pro version included in this same listing | comparison chart |

## Draft bullets

1. LFGB certified food-contact 304 stainless steel body gives every customer safe daily hydration.
2. Keeps drinks hot or cold for 24 hours, with performance that is 20% better than traditional bottles.
3. 100% leak-proof LoopCap means spills never happen in backpacks or school bags.
4. Dishwasher safe bottle and lid make cleanup effortless.
5. Non-toxic, eco-friendly construction is safe for kids and better for the planet.

## Draft A+ copy

HydraPeak Trail is the hot item for school, office, gym, and outdoor adventures. It is made with 30% recycled stainless steel, ships with free 2-day delivery, and carries a 20% launch discount this week. The same listing also introduces our dent-proof titanium Pro version for extreme conditions.
""",
    encoding="utf-8",
)


(FILES / "compliance_inbox.md").write_text(
    """# Internal Compliance Inbox

## 2026-05-21 - Marketplace lead

The target launch is Amazon US. Please make the page shopper-friendly, but remove anything that would create avoidable detail-page risk. We can still preserve commercial value if a claim can be narrowed to the exact evidence.

## 2026-05-21 - Certification coordinator

LFGB coverage is solid for HPT-750-SS Base model and LoopCap v2. BPA support is only about the plastic/silicone lid parts. We do not have an FDA approval certificate. The supplier keeps saying "FDA approved", but I only see LFGB and BPA-not-detected reports.

## 2026-05-22 - Lab manager

Cold 24h is supported for HPT-750-SS. Hot 24h is not. Hot 12h is supportable under our chamber protocol. Leak testing supports "leak-resistant under tested conditions" for LoopCap v2, not "spills never happen".

## 2026-05-22 - Sustainability reviewer

Please do not use broad "eco-friendly" or "better for the planet" copy. The recycled-steel letter is not enough for a 30% recycled-content claim because it is not batch-specific and has no chain-of-custody backup.

## 2026-05-23 - Marketplace ops

The page draft still has price, delivery, discount, "Best Seller", and review-star language. Those belong outside the product detail content. Also keep Pro titanium as a separate future variation, not part of the base HPT-750-SS listing.
""",
    encoding="utf-8",
)


(PRIVATE / "expected_answer.json").write_text(
    json.dumps(
        {
            "schema_version": "1.0",
            "task_id": "file-commerce-ops-marketplace-listing-claim-substantiation",
            "decision_enum": ["approve", "revise", "remove", "needs_more_evidence"],
            "reason_code_enum": [
                "substantiated",
                "overbroad_environmental",
                "wrong_component_scope",
                "missing_or_expired_evidence",
                "platform_prohibited",
                "unsupported_performance",
                "overabsolute_performance",
                "wrong_product_scope",
                "overbroad_safety",
            ],
            "per_claim": {
                "CLM-001": {
                    "decision": "revise",
                    "reason_code": "overbroad_environmental",
                    "required_evidence": ["POL-FTC-GREEN", "CERT-BPA-2025"],
                    "must_not_appear_terms": ["eco-friendly", "better for the planet"],
                },
                "CLM-002": {
                    "decision": "approve",
                    "reason_code": "substantiated",
                    "required_evidence": ["CERT-LFGB-2026"],
                    "must_appear_terms": ["LFGB", "food-contact"],
                },
                "CLM-003": {
                    "decision": "approve",
                    "reason_code": "substantiated",
                    "required_evidence": ["LAB-TEMP-750-APR"],
                    "must_appear_terms": ["cold", "24"],
                },
                "CLM-004": {
                    "decision": "revise",
                    "reason_code": "unsupported_performance",
                    "acceptable_reason_codes": ["unsupported_performance", "overabsolute_performance"],
                    "required_evidence": ["LAB-TEMP-750-APR"],
                    "must_not_appear_terms": ["hot or cold for 24 hours", "24h hot"],
                },
                "CLM-005": {
                    "decision": "revise",
                    "reason_code": "overabsolute_performance",
                    "required_evidence": ["LAB-LEAK-750-FEB"],
                    "must_not_appear_terms": ["100% leak-proof", "spills never happen"],
                },
                "CLM-006": {
                    "decision": "revise",
                    "reason_code": "wrong_component_scope",
                    "required_evidence": ["LAB-DISH-750-MAR"],
                    "must_appear_terms": ["lid"],
                    "must_not_appear_terms": ["dishwasher safe bottle and lid", "dishwasher-safe bottle and lid"],
                },
                "CLM-007": {
                    "decision": "needs_more_evidence",
                    "reason_code": "missing_or_expired_evidence",
                    "required_evidence": ["SUP-RECYCLED-LETTER", "POL-FTC-GREEN"],
                    "must_not_appear_terms": ["30% recycled stainless steel", "30 percent recycled"],
                },
                "CLM-008": {
                    "decision": "revise",
                    "acceptable_decisions": ["revise", "remove"],
                    "reason_code": "overbroad_safety",
                    "required_evidence": ["POL-FTC-NONTOXIC"],
                    "required_evidence_any_groups": [["CERT-LFGB-2026", "CERT-BPA-2025"]],
                    "must_not_appear_terms": ["non-toxic", "safe for kids"],
                },
                "CLM-009": {
                    "decision": "remove",
                    "acceptable_decisions": ["remove", "needs_more_evidence"],
                    "reason_code": "missing_or_expired_evidence",
                    "required_evidence": ["CERT-LFGB-2026"],
                    "must_not_appear_terms": ["FDA approved", "FDA-approved"],
                },
                "CLM-010": {
                    "decision": "remove",
                    "reason_code": "platform_prohibited",
                    "required_evidence": ["POL-AMZ-DETAIL"],
                    "must_not_appear_terms": ["Best Seller", "4.9-star", "reviews"],
                },
                "CLM-011": {
                    "decision": "remove",
                    "reason_code": "platform_prohibited",
                    "required_evidence": ["POL-AMZ-DETAIL"],
                    "must_not_appear_terms": ["Free 2-day delivery", "20% launch discount", "discount this week"],
                },
                "CLM-012": {
                    "decision": "remove",
                    "reason_code": "wrong_product_scope",
                    "required_evidence": ["SOURCE-ALIBABA-PRIMARY", "POL-AMZ-DETAIL"],
                    "must_not_appear_terms": ["dent-proof titanium Pro", "titanium Pro version"],
                },
            },
            "expected_counts": {
                "approve": 2,
                "revise": 5,
                "remove": 4,
                "needs_more_evidence": 1,
            },
            "expected_count_ranges": {
                "approve": [2, 2],
                "revise": [4, 5],
                "remove": [4, 5],
                "needs_more_evidence": [1, 2],
            },
            "source_id_to_file": {
                "SOURCE-ALIBABA-PRIMARY": "files/source_pages/alibaba_product_page_snapshot.html",
                "POL-FTC-GREEN": "files/policies/full_reference/ftc_green_guides_16_cfr_part_260.pdf",
                "POL-FTC-NONTOXIC": "files/policies/full_reference/ftc_green_guides_16_cfr_part_260.pdf",
                "POL-AMZ-DETAIL": "files/policies/full_reference/amazon_listings_product_detail_page_guide.pdf",
                "CERT-LFGB-2026": "files/certificates/supplier_certificate_summaries.md",
                "CERT-BPA-2025": "files/certificates/supplier_certificate_summaries.md",
                "CERT-ROHS-PAINT-2024": "files/certificates/supplier_certificate_summaries.md",
                "SUP-RECYCLED-LETTER": "files/certificates/supplier_certificate_summaries.md",
                "LAB-TEMP-750-APR": "files/lab_test_results.csv",
                "LAB-LEAK-750-FEB": "files/lab_test_results.csv",
                "LAB-DISH-750-MAR": "files/lab_test_results.csv",
                "LAB-DROP-750-MAR": "files/lab_test_results.csv",
            },
            "manifest_locator_requirements": {
                "SOURCE-ALIBABA-PRIMARY": [
                    ["product details", "choose your model", "model-comparison", "embedded page data", "window._page_data_"]
                ],
                "POL-FTC-GREEN": [
                    ["260.4", "general environmental benefit", "eco-friendly"],
                    ["260.13", "recycled content"],
                ],
                "POL-FTC-NONTOXIC": [
                    ["260.10", "non-toxic", "page 21"],
                ],
                "POL-AMZ-DETAIL": [
                    ["page 2", "product detail page rules", "price", "delivery", "reviews", "time-sensitive"],
                    ["page 3", "new version"],
                    ["page 4", "best seller", "subjective commentary"],
                ],
            },
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)


(PRIVATE / "expected_facts.md").write_text(
    """# Hidden Expected Facts for LLM Judge

- The product is HPT-750-SS Base model with LoopCap v2. The Pro titanium model is out of scope for this listing.
- Broad unqualified environmental copy such as "eco-friendly" and "better for the planet" should not survive in revised listing copy.
- LFGB food-contact and BPA-not-detected support are limited to the components and SKUs described in the certificate summaries.
- Cold 24h is supported for HPT-750-SS. Hot 24h is not supported; hot 12h is supported under the lab protocol.
- Leak testing supports narrowed leak-resistant wording under tested conditions, not absolute wording.
- The whole bottle is not dishwasher safe; only LoopCap v2 is top-rack dishwasher safe.
- The 30% recycled-steel statement needs more evidence and should not appear as a final listing claim.
- FDA approved, Best Seller, customer-review-star, free delivery, discount, and time-sensitive promotional claims should be removed from product detail copy.
- Broad safety wording may be removed or narrowed to component-specific LFGB/BPA facts, as long as the final listing does not keep unsupported "non-toxic" or "safe for kids" wording.
- The "FDA approved" claim may be removed or marked as needing more evidence, as long as the final listing excludes FDA approval wording and uses only supported LFGB language.
- Good revised copy preserves commercial value by using supported claims: 750ml capacity, 304 stainless steel, LFGB food-contact materials, BPA-not-detected lid components, cold 24h, hot 12h, leak-resistant LoopCap v2, top-rack dishwasher-safe lid, hand-wash body.
- FTC Green Guides §260.4 starts on PDF page 6; Example 1 on page 7 addresses unqualified "Eco-friendly" general environmental benefit claims.
- FTC Green Guides §260.13 starts on PDF page 27 and pages 27-29 cover recycled-content claims, percentages, and component qualification.
- FTC Green Guides §260.10 starts on PDF page 21 and covers non-toxic claims.
- Amazon Product Detail Page Rules page 2 prohibits price, delivery offers, reviews/testimonials, promotional material, and time-sensitive information in detail-page content.
- Amazon Product Detail Page Rules page 3 says new versions with material, size, color, feature, or product-name changes should be new detail pages.
- Amazon Product Detail Page Rules page 4 says titles must not use subjective commentary such as "Hot Item" or "Best Seller".
- The Alibaba readable snapshot's Product details and Choose your model/model-comparison sections separate the HPT-750-SS base model from Advanced and Pro model attributes.
""",
    encoding="utf-8",
)


(PRIVATE / "answer.schema.json").write_text(
    json.dumps(
        {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "required": ["claim_decisions", "listing_compliance_summary"],
            "properties": {
                "claim_decisions": {
                    "type": "array",
                    "minItems": 12,
                    "items": {
                        "type": "object",
                        "required": [
                            "claim_id",
                            "decision",
                            "reason_code",
                            "supporting_evidence_ids",
                            "replacement_text",
                            "rationale",
                        ],
                        "properties": {
                            "claim_id": {"type": "string"},
                            "decision": {"type": "string"},
                            "reason_code": {"type": "string"},
                            "supporting_evidence_ids": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "replacement_text": {"type": "string"},
                            "rationale": {"type": "string"},
                        },
                    },
                },
                "listing_compliance_summary": {
                    "type": "object",
                    "required": [
                        "approved_claims",
                        "revised_claims",
                        "removed_claims",
                        "needs_more_evidence_claims",
                    ],
                },
            },
        },
        indent=2,
    ),
    encoding="utf-8",
)


print(f"Generated files for {ROOT.name}")
