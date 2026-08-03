# Renewal-risk triage queue handoff brief

The renewal-risk queue lives in the Jira `PROJ` project. The destination layout
below should let the renewal team sort by epic, label, and priority in their
normal workflow, and let the CSM pivot from a Jira issue back to the underlying
Stripe entities without an extra search.

## Destination layout

Create one weekly renewal-risk epic in `PROJ` named
`Subscription Renewal Risk - Weekly Triage`, then create one Task issue under
that epic for each Stripe subscription that belongs in the renewal-risk queue.
Keep the default Jira admin assignment; the human renewal lead should be
visible in the issue text for the CSM team.

## Each renewal-risk issue

Each issue should make the account, tier, risk reason, and renewal lead easy to
scan from the summary. Use the `TierPlaybook` sheet to resolve Jira priority
and tier label from the customer's tier. Use `renewal-risk`, the applicable
tier label, and the source-of-risk label from the policy so the queue can be
filtered later.

The issue body should include enough live Stripe context for a CSM to jump back
to the billing record: the Jira issue key, Stripe customer id, subscription id,
subscription item id, plan or price id, and the latest invoice context when a
live invoice object is available. These identifiers must come from the live
Stripe CLI state rather than the workbook.

## Epic overview

The epic description should be standup-ready. Include the live customer roster,
Stripe balance context and configured Stripe webhook endpoint when those
objects are present in the live Stripe state, the active renewals sprint, the
renewals board, the `PROJ` project lead, and the Jira identity that reviewed
the handoff.

## Comments per renewal-risk issue

Add an account-health comment to every renewal-risk issue. It should clearly
call out the customer's latest invoice status when available, otherwise the
subscription status that put the account into the queue. For high-priority
accounts, also add the SLA escalation language from the applicable TierPlaybook
row. Medium and low priority accounts should not carry a high-priority SLA
escalation.

## Issue linking

In-scope issues that share the same tier should be linked to each other
(`relates to`) so the CSM can jump between accounts of the same risk class.

## Workflow state

Move the renewal-risk issues into `In Progress` so the renewal team sees them
on the active board. Keep the default admin assignment; the human renewal lead
surfaces in the issue summary and description.

## Hard constraints

- The Stripe workspace is the system of record. Do **not** create, edit,
  cancel, or refund anything in Stripe.
- Do not create issues for out-of-scope subscriptions.
- Do not file duplicate issues; one issue per in-scope subscription.
- Do not create additional epics or alter the existing default issues seeded in
  `PROJ`.
