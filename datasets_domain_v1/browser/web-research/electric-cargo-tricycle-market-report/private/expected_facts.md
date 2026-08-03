# Expected facts / LLM judge ground truth (browser-web-research-electric-cargo-tricycle-market-report v2)

This file is **not shown to the agent**. Verifier injects into LLM judge prompt as ground-truth.

## Subject

North American electric cargo tricycle market analysis. Source data: `market_research_dump.json` (mixed: wholesale, retail, brand sites, blockers, partial visibility, some non-electric-tricycle items).

## Channel order (FIXED)

1. `Alibaba.com`
2. `Amazon`
3. `Walmart`
4. `Brand Sites`

This order applies to: Excel sheet order, evidence_manifest.channels order, all references.

## Required record IDs that MUST appear in normalized_comparison.csv

- `ALI-EEC-BOX-60V` (an Alibaba record from research_dump)
- `BR-LECTRIC-XP-TRIKE2` (a brand-site record; high-quality candidate)

## Required exclusion reason codes

These exclusion codes from normalization_policy.json must appear in the CSV's exclusion_reason column for at least 2 rows total:
- `not_electric_cargo_tricycle` (record is not actually a cargo tricycle)
- `moq_exceeds_pilot_limit` (MOQ > 10 = pilot constraint)

## Normalization math expectations (per normalization_policy.json)

- CNY → USD: multiply by 0.138
- kg → lb: multiply by 2.20462
- Alibaba landed price: midpoint of range + freight + 8% import buffer
- opportunity_score: 0-100 scale, weighted sum
- Pilot price band: target $900-$2200 USD

## Recommendation strategy

Per `required_recommendation_view`:
- Pick top opportunity_score among non-excluded records
- Tie-break: higher evidence_confidence → Brand Sites preference → lower normalized_price_usd
- `BR-LECTRIC-XP-TRIKE2` is typically the top recommendation given its brand-site provenance and balanced specs

## Channel risks expected

Per the policy `report_risks` field:
- `blocked_or_partial_pages` (some pages blocked/partial)
- `invisible_sales_signals` (Amazon/Walmart hide units sold)
- `marketplace_vs_brand_site_comparability` (apples vs oranges)
- `Alibaba_landed_price_assumption` (importing assumptions are estimates)

The report's channel_risks should cover at least 3 of the 4 channels with substantive risk language matching these themes.

## Anti-cheat

- Do NOT fabricate Amazon/Walmart sales-rank numbers (those are typically not visible without paid tools)
- Do NOT delete records that don't fit; mark exclusion_reason
- Do NOT recommend a record with non-empty exclusion_reason

## What is NOT fabrication

- Using research_dump prices and specs as-is
- Computing landed price per policy
- Marking '未见' / blocked for inaccessible pages
- Reasonable inference about "this brand site looks more accessible to North American buyers"
