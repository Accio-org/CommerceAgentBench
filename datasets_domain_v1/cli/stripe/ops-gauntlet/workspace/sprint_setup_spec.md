# QA Sprint — Test Account Requirements

Author: Maya Chen (QA Lead)
Created: 2026-05-28

The account already has some data from last quarter's integration work with TechCorp — don't touch their stuff, just add what we need on top.

## What We're Testing

We have five products going through payment integration testing this sprint. Here's the catalog:

**Pro Analytics Dashboard** — our flagship real-time dashboards product with custom alerts and API access. Core product, monthly and annual billing. Forty-nine ninety-nine a month.

**Team Collaboration Hub** — shared workspaces, permission management, team inbox. Core, monthly and annual. Twenty-nine ninety-nine a month.

**Enterprise Data Vault** — SOC2 audit logs, encryption at rest, data residency controls. Core, monthly and annual. One hundred ninety-nine dollars a month.

**Bulk Export Add-on** — bulk data export to S3/GCS. Month-to-month only, no annual. Fourteen ninety-nine a month.

**Single Report Download** — one-time purchase, four ninety-nine flat.

Annual pricing uses our standard 2-month discount formula (10 months instead of 12).

We were also going to test the refund flow (Refund Stress-Test Widget $99/mo and Partial Refund Scenarios Pack $149/mo) but those depend on the partial-refund mock processor which is blocked on JIRA-4521. I'll add them when the ticket resolves — don't set them up now. We do still need a test account for the refund scenarios though (see testers below).

## Testers

Four QA engineers need test accounts:

- **Sprint Test User A** (testuser-a@qamail.internal) — main payment flow testing
- **Sprint Test User B** (testuser-b@qamail.internal) — edge-case isolation; this person's tests require a completely clean starting state with nothing pre-attached, so just create the account
- **Sprint Test User C** (testuser-c@qamail.internal) — subscription lifecycle
- **Refund Test User** (refund-test@qamail.internal) — refund scenarios (still needs the account even though the refund products are blocked)

Users A and C should be on the Analytics Dashboard monthly plan right away so they can start writing tests against live subscriptions.

Tag everything with our sprint identifier `payment-q3` so we can filter in the dashboard.

## Notifications

Our backend needs to know when:
- A payment goes through or fails (both charge-level and intent-level)
- A charge gets refunded (for receipt regeneration)

Send those to `https://qa-hooks.internal/payment`.

We also need lifecycle notifications at `https://qa-hooks.internal/lifecycle` for when customer records are created, updated, or deleted, and when invoices are generated.

## Discounts

Two test discount scenarios:
- A full-comp code for free trial testing (one-time use)
- A 20% quarterly discount running for 3 months — call it `QA_PARTIAL_25` (yeah the name doesn't match the percentage, it's already hardcoded in thirty test fixtures)

## Output

Drop a summary in `outputs/setup_summary.json` with counts of what you created.
