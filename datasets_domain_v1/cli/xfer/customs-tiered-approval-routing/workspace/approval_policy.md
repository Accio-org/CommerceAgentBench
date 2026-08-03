# Customs Supplier Tiered Approval Policy

## Overview

All new qualified suppliers must go through a tiered approval workflow. The tier assignment determines which systems need to be set up and what level of review is required. **Strict compliance is mandatory** -- setting up too many systems for a low-tier supplier wastes executive time, while setting up too few for a high-tier supplier creates compliance gaps.

## Supplier Qualification

A supplier qualifies for processing if they meet BOTH:
- Total shipment count >= 50
- Total amount (USD) >= $500,000

Aggregate across ALL available customs data files.

## Tier Assignment Thresholds

| Tier | Condition | Label |
|------|-----------|-------|
| Tier 1 | total_amount_usd > $2,500,000 | Executive Review |
| Tier 2 | $900,000 < total_amount_usd <= $2,500,000 | Standard Approval |
| Tier 3 | total_amount_usd <= $900,000 | Fast-Track |

## Tier 1: Executive Review Workflow

Suppliers exceeding $2,500,000 require full executive oversight across all three systems.

### Google Workspace (GWS)
1. Add a row in the approval tracking spreadsheet with: supplier name, total amount, shipment count, HS chapters, tier label ("Tier 1 - Executive Review")
2. Create a **dedicated slide** in the executive briefing presentation for each Tier 1 supplier. The slide must contain:
   - Supplier name as title
   - Total amount, shipment count, weight, number of unique buyers
   - HS chapter summary
   - Tier designation

### Stripe
1. Create a **customer** record with supplier name and metadata (tier="1", category="executive")
2. Create a **product** for each unique HS chapter the supplier deals in (e.g., "HS 9018 - Medical Instruments" or "HS 7219 - Stainless Steel")
3. Create a **price** for each product (use the supplier's average amount per shipment as unit amount in cents)
4. Create a **deposit invoice** for the customer with line items referencing the prices
5. Create a **payment_intent** to hold the deposit (amount = 10% of total_amount_usd, in cents, currency=usd)

### Box
1. Create a **supplier folder** named after the supplier
2. **Upload** the contract template (from workspace/contract_template.md) into the supplier folder
3. Create an **exec review task** on the uploaded contract file with message "Executive review required - Tier 1 supplier"
4. Create a **collaboration** share on the supplier folder for each executive in the executive contacts list (role=editor)

## Tier 2: Standard Approval Workflow

Suppliers between $900,000 and $2,500,000 get standard processing. **No executive involvement.**

### Google Workspace (GWS)
1. Add a row in the approval tracking spreadsheet with: supplier name, total amount, shipment count, HS chapters, tier label ("Tier 2 - Standard Approval")
2. **Do NOT** create any slides. Tier 2 suppliers do not require executive briefing.

### Stripe
1. Create a **customer** record with supplier name and metadata (tier="2", category="standard")
2. Create an **invoice** for the customer with description containing the supplier name and tier
3. **Do NOT** create products, prices, or payment_intents. Standard-tier suppliers use existing product catalog.

### Box
1. Create a **supplier folder** named after the supplier
2. **Upload** an analysis summary file into the folder (create a simple text file with supplier stats)
3. **Do NOT** create review tasks or collaboration shares. Standard-tier files are reviewed by the team lead only.

## Tier 3: Fast-Track Workflow

Suppliers at or below $900,000 get minimal processing. **No financial infrastructure, no document management.**

### Google Workspace (GWS)
1. Add a row in the approval tracking spreadsheet with: supplier name, total amount, shipment count, HS chapters, tier label ("Tier 3 - Fast-Track")
2. **Do NOT** create any slides.

### Stripe
**Do NOT** create any Stripe records for Tier 3 suppliers. These suppliers are too small for individual financial infrastructure -- they will be batched into a quarterly group invoice.

### Box
**Do NOT** create any Box folders or files for Tier 3 suppliers. Their documents go into the existing shared "Fast-Track Batch" folder maintained by the operations team.

## Important Notes

- The approval tracking spreadsheet in GWS must contain ALL qualified suppliers regardless of tier
- Tier boundaries are STRICT: a supplier at exactly $900,000 is Tier 3, a supplier at $2,500,000 is Tier 2
- Over-provisioning (e.g., creating Stripe records for a Tier 3 supplier) is a compliance violation
- Under-provisioning (e.g., skipping the executive slide for a Tier 1 supplier) is also a compliance violation
