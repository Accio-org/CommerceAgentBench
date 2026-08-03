# Pricing Policy Update — Effective 2026-06-03

## Global adjustment

Apply an **8% price increase** to all products across all markets.

New price = current price × 1.08, rounded to 2 decimal places.

## Exemptions

The following SKU-market combinations are **exempt** from the price increase. Their prices must remain unchanged:

| Market | Exempt SKU | Reason |
|--------|-----------|--------|
| JP | NB-JP-PET-001 | Government-regulated pricing |
| BR | NB-BR-PET-002 | Contractual lock until Q3 |

If a SKU appears in the exempt list for a specific market, do not change its price in that market's catalog. The same SKU in other markets should still receive the increase.

## How to apply

1. Read each market catalog document.
2. For every product row, calculate the new price (current × 1.08) unless the SKU-market combination is exempt.
3. Update the catalog document with the new prices. Preserve all other fields and the table format.
4. Do not modify draft documents (documents with `[DRAFT]` in the title).

## Change log

After updating all catalogs, create a document named **Pricing Audit Change Log** under the root folder:

```
# Pricing Audit Change Log

Effective Date: 2026-06-03
Adjustment: 8% increase
Applied by: Pricing Ops

## Changes

| Market | SKU | Old Price | New Price | Currency | Status |
|--------|-----|-----------|-----------|----------|--------|
| JP | NB-JP-PET-001 | 20.45 | 20.45 | JPY | exempt |
| JP | NB-JP-XXX-002 | 15.00 | 16.20 | JPY | updated |
...

## Summary
Total products: <N>
Updated: <N>
Exempt: <N>
```

Sort by market, then by SKU.
