# Subscription renewal-risk policy

This policy defines which Stripe subscription customers must be queued for
proactive renewal follow-up this week, and how each one is prioritised.

## Inclusion criteria (a customer is IN SCOPE if ANY holds)

Evaluate each subscription on the Stripe billing side and include the customer
when ANY of the following risk signals is true:

- **Past-due collections**: the subscription `status` equals `past_due`.
- **Pending cancellation**: the subscription `status` is `active` AND its
  `cancel_at_period_end` flag is `true`.
- **Trial ending**: the subscription `status` equals `trialing`.

A customer whose only subscription is `active` with `cancel_at_period_end =
false` and no trial is **out of scope** — do not queue them.

## Priority (derived from customer tier, NOT from status)

The customer tier is encoded in the customer `description` text on the Stripe
side: `Tier A`, `Tier B`, or `Tier C`.

The authoritative tier-to-priority mapping (including the tier label and the
SLA phrasing each tier uses) lives in the `TierPlaybook` sheet of the
`customer_accounts_master_2026Q2_v3.xlsx` master spreadsheet. Join the customer's
tier code (retrieved from the `Accounts` sheet) to the `tier_code` in the `TierPlaybook`
sheet to resolve a customer's Jira priority and tier label. Do not infer them
from this document.

Priority is NOT derived from the subscription status; an account's priority is
determined entirely by its tier, regardless of which anomaly placed it in
scope.

## Risk reason (one phrase per subscription)

For each in-scope subscription, label the risk reason with exactly one of the
following phrases, picked by the matching inclusion criterion:

| Signal | Risk reason phrase |
|---|---|
| `status = past_due` | `past_due` |
| `status = active` AND `cancel_at_period_end = true` | `pending cancellation` |
| `status = trialing` | `trial ending` |

If a customer matches more than one signal on different subscriptions, file
one issue per subscription, each with its own reason.

Use a searchable risk-source label that identifies which signal brought the
subscription into scope:

| Signal | Risk-source label |
|---|---|
| Past-due collections | `from-collections` |
| Pending cancellation | `from-pending-cancel` |
| Trial ending | `from-trial` |

## Owner

Each customer's renewal lead is named after `renewal lead` in the customer
`description`. Carry this name through to the issue summary; assignee stays
as the default Jira admin.

Note: The renewal lead must be determined strictly based on the Stripe customer
description (renewal lead 以 Stripe description 为准), and the roster in the
`RenewalLeads` sheet of the master spreadsheet is only for auxiliary reference
(花名册仅做辅助参考) and must not override the Stripe description.
