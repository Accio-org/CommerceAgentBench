# TerraCharge — Regional Pricing Rules (Q3 2026)

## 1. Regional Multipliers

Each region applies a multiplier to the base monthly USD rate from `base_rates.csv`.

| Region Code | Region Name | Multiplier |
|---|---|---|
| US-W | US West Coast | 1.15 |
| US-E | US East Coast | 1.08 |
| US-C | US Central | 1.00 |
| EU-W | Europe West | 1.32 |
| EU-N | Europe North | 1.28 |
| APAC | Asia-Pacific | 0.87 |

**⚠ APAC HOLD (2026-05-28):** Legal has flagged the APAC multiplier for regulatory review. The 0.87 rate in the table above is the PROPOSED rate, not approved. **Do not create any APAC-region products or prices until legal clears the rate card.** Create the APAC customer record (we need it for the CRM sync) but do not attach any subscriptions or charges to it. All other regions proceed normally.

## 2. Price Computation Formula

For each product × region:

```
regional_monthly = base_monthly_usd × multiplier
```

**Rounding rule:** Round to the nearest $0.01 FIRST, then convert to cents (multiply by 100 and truncate to integer). Example: $45 × 1.15 = $51.75 → 5175 cents.

**Annual pricing** (only for products with `includes_annual=yes`):
```
annual = regional_monthly × 10
```
(Annual is 10 months, not 12 — the 2-month discount is built into the formula.)

## 3. Product Naming in Stripe

Products are named with the region suffix:
```
<product_name> (<Region Name>)
```
Example: `TerraCharge Standard (US West Coast)`

Each product gets metadata: `tier=<tier>`, `region=<region_code>`, `base_rate=<base_monthly_usd>`

**Important:** Addon products (`includes_annual=no`) do NOT get regional variants. Create them once (no region suffix) with the base rate directly as the monthly price. One product per addon, not 6.

## 4. Customer Setup

Create one customer per region using these pre-assigned accounts:

| Region | Customer Name | Email |
|---|---|---|
| US-W | Pacific Coast Energy Co | procurement@pacificcoast.energy |
| US-E | Atlantic Grid Partners | billing@atlanticgrid.com |
| US-C | Heartland EV Alliance | accounts@heartlandev.org |
| EU-W | EuroVolt GmbH | einkauf@eurovolt.de |
| EU-N | NordCharge AS | faktura@nordcharge.no |
| APAC | AsiaFleet Pte Ltd | finance@asiafleet.sg |

Each customer gets metadata: `region=<region_code>`, `contract_start=2026-07-01`

## 5. Subscriptions

Each regional customer subscribes to the **Fleet** tier for their region (monthly), plus the **Developer API** addon.

That's 2 subscriptions per customer × number of active regional customers.

## 6. Coupon Rules

Create one coupon per **active** region (i.e., regions with products created) using this formula:
```
coupon_name = REGION_<region_code>
percent_off = floor(multiplier × 10)
duration = repeating, 12 months
```

Apply each regional coupon to that region's Fleet subscription (not the API addon sub).

## 7. Setup Charges

Create one setup charge per customer **that has subscriptions**:
```
amount = Fleet monthly price for that region (in cents)
currency = usd
description = "TerraCharge fleet onboarding — <Customer Name>"
source = tok_visa
```

## 8. Override Handling

**After** creating all standard subscriptions and charges, check `overrides.json`. For each override entry:
- Find the customer by name
- Update the customer's metadata to add `override=true` and `override_reason=<reason from JSON>`
- The override's `adjusted_monthly_cents` replaces the regional price. Create an additional price at the override rate and a NEW subscription using that price (the original subscription stays — both run in parallel per the contract terms).

## 9. Output

Write `outputs/price_matrix.json`:
```json
{
  "products": [
    {
      "name": "<full product name with region>",
      "region": "<region_code>",
      "monthly_cents": <computed>,
      "annual_cents": <computed or null>
    }
  ],
  "total_products": <count>,
  "total_prices": <count>,
  "total_subscriptions": <count>
}
```
