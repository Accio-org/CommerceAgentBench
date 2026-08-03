# Invoice collections queue handoff brief

The AR team uses Todoist as a lightweight handoff surface for weekly
collections work. The `Invoice Collections Q3` project should read like a
control queue rather than a spreadsheet dump: an analyst should be able to
open the project, find the invoices that require outreach, understand their
urgency, and trace each record back to the live Stripe account.

## Queue organization

Use separate project areas for three kinds of work:

- immediate Tier A customer calls;
- standard Tier B and Tier C follow-up;
- completed Tier A acknowledgement records.

The section names should be clear enough for an AR specialist to distinguish
those three queues without reading the source files again.

## Collections records

Each active collections task should identify the customer, tier, owner,
invoice amount, live Stripe invoice, live Stripe customer, related
subscription, and related plan or price. Keep the amount in Stripe's
`amount_due` integer unit so analysts can compare it directly with the CLI
output.

Use Todoist labels to make the queue searchable by invoice work, customer
tier, and customer industry. The tier and industry label conventions come
from the active rules and ledger data in `ar_collections_handbook_2026Q3_v3.xlsx`.

Due dates should follow the source Stripe invoice: use the invoice due date
when present, otherwise use a 30-day follow-up date from the invoice creation
date.

## Acknowledgement and handoff

Tier A invoices need a completed acknowledgement record in the completed
acknowledgements area. The acknowledgement should preserve the same Stripe
traceability as the active task.

Add one completed team handoff record for the project. It should summarize the
active customer roster and include enough live Stripe context for the morning
standup, including current balance context, the webhook endpoint, reviewer
identity, and the source brief reference.

## Boundaries

The Stripe account is read-only for this task. Do not create, edit, void,
mark-paid, or refund Stripe objects. Do not create Todoist records for
out-of-scope invoices, and do not reuse seeded Todoist projects for this
queue.
