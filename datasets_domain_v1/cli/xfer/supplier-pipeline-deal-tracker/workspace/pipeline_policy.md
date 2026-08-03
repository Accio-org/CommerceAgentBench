# Supplier deal pipeline policy

This policy defines which suppliers in the Notion commerce workspace are
"pipeline-ready" for procurement to formalise into a long-term deal, and how
each pipeline deal is sized and prioritised. Read together with
`pipeline_brief.md` for the destination layout.

## Workspace layout (Notion side)

The Notion commerce workspace holds:

- `Supplier Due Diligence` database — multiple review records per supplier
  company; the `CertificationStatus` field reflects the legal posture
  (`Hold` / `Watchlist` / `Needs Renewal` / `Approved`).
- `Purchase Order Tracker` database — every PO references a supplier by name;
  the `Status` field is `Exception` (anomalous) or one of `Booked` /
  `In Transit` / `At Port` (normal in-flight).

A supplier company appears as several records in the supplier database and
several POs in the purchase-order database. Reason at the company level (by
supplier name).

## Inclusion criteria

A supplier is in scope for the deal pipeline only when the company-level Notion
record is clean and the Q3 normal-PO volume is material.

A clean record means no supplier due-diligence record for the company has
`CertificationStatus = Hold`. Any other status combination is acceptable.

Material volume is the sum of `ValueUSD` over the company's normal purchase
orders. Exception POs are excluded under the kickoff reminder. The materiality
threshold for Q3 is 600,000 USD.

A supplier whose normal-PO total is `599,999` or less is out of scope, even
if the company is otherwise clean. A supplier with any `Hold` record is out
of scope regardless of volume.

## Deal Size and Priority (computed from the normal-PO total)

For deal size classification, thresholds, and priority mapping, refer directly
to the `DealSizeBuckets` sheet in the Q3 pipeline workbook.

Boundaries defined in that sheet are exact: Large (>= 640,000 USD), Medium 
(>= 620,000 USD and < 640,000 USD), and Standard (>= 600,000 USD and < 620,000 
USD). Priority is derived from Deal Size, not from any supplier-record field, 
as mapped in the workbook.

## Owner

The primary owner for each in-scope supplier must be determined by looking up 
the supplier's `primary_owner_id` column in the `SupplierMaster` sheet of the 
workbook, which corresponds to the `employee_id` in the `ProcurementOwners` 
sheet.

If the workbook is missing a supplier record, use the modal `Owner` value across
the company's supplier due-diligence records in Notion as the backup owner.
Carry the chosen owner name through to the Jira issue.
