# Supplier deal pipeline handoff brief

Procurement uses Jira `PROJ` as the working deal room for Q3 supplier onboarding.
The finished Jira state should be easy for the deal team to scan by epic,
priority, labels, and deal-size cohort.

## Deal room structure

Create a Q3 supplier deal-pipeline epic in `PROJ`; use the standard title
`Supplier Deal Pipeline - Q3 Onboarding`. Put the live migration context in the
epic body/description field: the in-scope supplier roster, current reviewer or
Jira user, project lead, active board/sprint context, and the Notion supplier
and purchase-order datasource identifiers.

Create one Task for each supplier that qualifies under the policy, and make the
relationship to the Q3 pipeline epic visible in Jira through the native epic
fields when available or an issue link when using the CLI surface. Do not move
seeded backlog issues into the pipeline.

## Supplier Task content

Each supplier Task should make the deal decision auditable from the Jira issue
alone:

- The summary should include the Deal Size, supplier name, normal PO volume,
  and procurement owner in a compact sortable form.
- The priority should follow the Deal Size mapping in the workbook.
- Labels should include the standard pipeline label `deal-pipeline`, the
  applicable size label, and the supplier category label in the form
  `category-<primary_category>`, lower-cased with non-alphanumeric runs
  collapsed to single hyphens (for example a supplier whose `primary_category`
  is `Raw Materials` would carry `category-raw-materials`).
- The Task body/description should include the issue's own Jira key after
  creation, a live Notion company page reference for the supplier, the Deal Size
  cohort, and the Notion supplier datasource used for traceability.
- Add a source trace comment that states the supplier name, normal PO total,
  Deal Size, and procurement owner.

Large deals also need an executive-introduction reminder comment so the
commercial lead can pick them up during board review. Medium and Standard deals
should not carry that reminder.

## Graph and workflow

Within each Deal Size cohort, link the supplier Tasks with Jira `relates to`
links so a reviewer can traverse from any supplier to the rest of the same
cohort. Keep unrelated seeded backlog issues out of those cohort links.

All active supplier Tasks should finish in `In Review`. Follow the workflow map
in the workbook and the process reminder in the kickoff email when moving issues
between statuses.

The Notion workspace remains read-only for this handoff.
