# Supplier Roster Merge Policy — Q1 2026 Refresh

## Overview

Every quarter we refresh the supplier roster by merging the previous quarter's roster with newly received customs export data. This document defines the rules for handling three categories of suppliers during the merge process.

## Qualification Thresholds

A supplier qualifies for inclusion from the new customs data if they meet **both** criteria:
- **Shipment count** >= 8
- **Total amount (USD)** >= $100,000

Suppliers below these thresholds in the new data are excluded from the new-data side of the merge (but old roster entries are never deleted regardless of new-data qualification).

## Merge Categories

### Category 1: OVERLAP (exists in both old roster AND new customs data)

When a supplier appears in both the Q4 2025 roster and the Q1 2026 customs data:

**Use NEW customs data for these fields:**
- `total_amount_usd` — updated from CSV aggregation
- `shipment_count` — updated from CSV aggregation
- `weight_kg` — updated from CSV aggregation
- `hs_codes` — updated from CSV aggregation
- `destinations` — updated from CSV aggregation

**PRESERVE from OLD roster for these fields:**
- `contract_id` — existing contract reference, do not overwrite
- `payment_terms_days` — existing negotiated terms
- `quality_rating` — existing quality assessment
- `last_audit_date` — existing audit record
- `internal_notes` — existing internal documentation
- `primary_contact_name` — existing contact person
- `primary_contact_email` — existing contact email

Label these suppliers as **"updated"** in the merge category field.

### Category 2: NEW ONLY (exists in new customs data but NOT in old roster)

When a qualified supplier appears in the new customs data but has no entry in the Q4 2025 roster:

- Use all CSV-derived fields as-is (total_amount_usd, shipment_count, weight_kg, hs_codes, destinations)
- Set default values for roster-only fields:
  - `contract_id`: "TBD-<SUPPLIER_NAME>" (e.g., "TBD-ACME TRADING CO LTD")
  - `payment_terms_days`: 30
  - `quality_rating`: "Pending"
  - `last_audit_date`: "N/A"
  - `internal_notes`: "New supplier, pending initial review"
  - `primary_contact_name`: "TBD"
  - `primary_contact_email`: "TBD"

Label these suppliers as **"new"** in the merge category field.

### Category 3: OLD ONLY (exists in old roster but NOT in new customs data)

When a supplier appears in the Q4 2025 roster but has no matching records in the Q1 2026 customs data:

- **Do NOT delete** these entries
- Migrate ALL original roster fields as-is (both CSV-derivable and roster-only fields from Q4)
- Add the label **"legacy-active"** to mark them as carried forward without new data

Label these suppliers as **"legacy"** in the merge category field.

## Important Notes

- Supplier name matching is exact (case-insensitive). Do not attempt fuzzy matching.
- Every supplier from both sources must be accounted for — no supplier should be lost in the merge.
- The final merged roster should contain entries from all three categories.
- When recording the merge in project management systems, clearly indicate which category each supplier falls into and which fields were sourced from which data vintage. In the project tracker, tag each supplier's ticket with the bare label `updated` / `new` respectively; old-only suppliers carry the label `legacy-active`.
