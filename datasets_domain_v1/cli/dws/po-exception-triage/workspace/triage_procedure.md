# PO Exception Triage Policy

## What counts as an exception

A PO has an exception if **any** of the following are true:

1. Its **Status** field is `Exception`.
2. Its **Status** field is `Partial Receipt` (some units missing).
3. Its content mentions a **customs hold**, **documentation hold**, or similar shipping disruption — regardless of what the Status field shows. The system often lags behind real-world events; a PO might display `In Transit`, `Booked`, or any other non-exception status while actually being held.

**Important:** Do not rely solely on the Status field. Read the full content of each PO document. POs with any status value (including `In Transit` or `Booked`) may contain shipping update notes describing customs holds or delays — these must be triaged as exceptions.

Ignore POs with Status `Delivered` or `Closed` (already completed) — unless their content explicitly mentions an unresolved customs hold. If a delivered/closed PO appears in the Active POs folder without an active hold, it is misfiled — leave it in place and do not triage it.

## Severity classification

- **Urgent**: units at risk ≥ 500, OR any customs hold/documentation hold.
- **Standard**: all other exceptions (units at risk < 500 and no customs involvement).

## Triage actions

For each PO with an exception:

1. **Create a triage report document** — use the Triage Report Template (located in the root folder) as a format guide. Name it `Triage — <PO Number>`. Fill in all fields. Place it in the appropriate triage folder:
   - Urgent → `Triage — Urgent` folder
   - Standard → `Triage — Standard` folder

2. **Add a global comment** on the original PO document in the Active POs folder with the text:
   > Exception triaged — [Urgent/Standard]. See triage report.

Do not add comments on normal (non-exception) POs. Do not modify the Triage Report Template. Do not delete or move the original PO documents.

## Summary

After triaging all exceptions, create a document named **PO Exception Summary** under the root folder:

```
# PO Exception Summary

Date: 2026-06-03

Total Active POs reviewed: <N>
Exceptions found: <N>
  Urgent: <N>
  Standard: <N>
Normal (no exception): <N>

## Exception Details
| PO | SKU | Supplier | Exception Type | Severity |
|----|-----|----------|---------------|----------|
| ... | ... | ... | ... | ... |
```
