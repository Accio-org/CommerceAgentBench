# Invoice collections policy

This policy defines which Stripe invoices belong in this week's personal
collections queue and how each task is prioritized. Read together with
`queue_brief.md` and `weekly_collections_brief.txt`.

## Inclusion criteria

An invoice is in scope for follow-up based on the standard threshold:
- Status must be exactly `open`.
- The minimum `amount_due` threshold is defined in `weekly_collections_brief.txt` (status=open AND amount_due >= 30000).

## Priority (derived from customer tier in description)

The customer tier is encoded in the customer `description` text on the Stripe
side (`Tier A`, `Tier B`, `Tier C`). 

The mapping from customer tier to Todoist priority and tier labels is detailed in the `CollectionsRules` sheet in the `ar_collections_handbook_2026Q3_v3.xlsx` workbook (only use active rules where `deprecated=false`).

Priority is derived from tier alone. The invoice amount does not affect
priority once it has passed the inclusion threshold.

## Owner

Each customer's collections lead must be strictly determined using the Stripe customer description (as specified in `weekly_collections_brief.txt`). The `CollectionsLeads` sheet in our workbook is for auxiliary lookup only. Carry this owner name through to the task content.
