# NimbusOps — Full Billing Infrastructure Setup

Currency: USD. All amounts are customer-facing price; convert to cents for Stripe (×100).

## Phase 1: Product Catalog

Create these 6 products. Each product needs **both** monthly and annual prices (except add-ons which are monthly only).

### NimbusOps Starter
- **Name:** `NimbusOps Starter`
- **Description:** `Basic infrastructure monitoring for small teams. Up to 5 hosts, 30-day data retention, email alerts.`
- **Metadata:** `tier=starter`, `max_hosts=5`, `data_retention_days=30`
- **Monthly:** $49/mo | **Annual:** $470/yr

### NimbusOps Professional
- **Name:** `NimbusOps Professional`
- **Description:** `Advanced monitoring for growing teams. Up to 50 hosts, 90-day retention, Slack/PagerDuty integrations, custom dashboards.`
- **Metadata:** `tier=professional`, `max_hosts=50`, `data_retention_days=90`
- **Monthly:** $149/mo | **Annual:** $1,430/yr

### NimbusOps Enterprise
- **Name:** `NimbusOps Enterprise`
- **Description:** `Full-scale observability platform. Unlimited hosts, 1-year retention, SSO/SAML, dedicated support engineer, SLA guarantee.`
- **Metadata:** `tier=enterprise`, `max_hosts=unlimited`, `data_retention_days=365`
- **Monthly:** $499/mo | **Annual:** $4,790/yr

### Extra Seat Pack (add-on, monthly only)
- **Name:** `Extra Seat Pack`
- **Description:** `Add 10 additional team member seats to any NimbusOps plan.`
- **Metadata:** `addon=true`, `seats=10`
- **Monthly:** $29/mo

### Premium Support (add-on, monthly only)
- **Name:** `Premium Support`
- **Description:** `24/7 priority support with 15-minute response SLA and dedicated Slack channel.`
- **Metadata:** `addon=true`, `support_level=premium`
- **Monthly:** $199/mo

### Data Export API (add-on, monthly only)
- **Name:** `Data Export API`
- **Description:** `Programmatic access to raw monitoring data via REST API. Rate limit 1000 req/min.`
- **Metadata:** `addon=true`, `api_rate_limit=1000`
- **Monthly:** $79/mo

## Phase 2: Promotions

### Coupons

| Name | Type | Value | Duration | Extra |
|------|------|-------|----------|-------|
| `ANNUAL20` | percent_off | 20 | repeating, 12 months | — |
| `LAUNCH50` | amount_off | $50.00 (5000 cents) | once | currency=usd |
| `PARTNER30` | percent_off | 30 | forever | — |

### Tax Rate

- **Display name:** `US Sales Tax`
- **Percentage:** 8.875
- **Inclusive:** false
- **Description:** `Standard US combined state and local sales tax`
- **Metadata:** `jurisdiction=US`, `tax_type=sales_tax`

### Shipping Rate

- **Display name:** `Standard US Shipping`
- **Type:** fixed_amount
- **Amount:** $12.99 (1299 cents), currency: usd
- **Metadata:** `carrier=usps`, `speed=standard`

## Phase 3: Webhook Infrastructure

### Production endpoint
- **URL:** `https://hooks.nimbusops.dev/stripe/v1/production`
- **Events:** `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.paid`, `charge.refunded`
- **Description:** `Production payment notifications`

### Subscription lifecycle endpoint
- **URL:** `https://hooks.nimbusops.dev/stripe/v1/subscriptions`
- **Events:** `customer.subscription.created`, `customer.subscription.deleted`, `invoice.payment_failed`
- **Description:** `Subscription lifecycle events`

## Phase 4: Pilot Customer Onboarding

Two seed customers already exist. Find them with `stripe customers list`.

### Acme Inc

1. **Update customer metadata:** add `pilot=true`, `onboard_date=2026-06-01`, `account_manager=sarah_chen`
2. **Update customer description:** `Pilot — Professional annual + Extra Seat Pack + Data Export API`
3. **Subscribe** to `NimbusOps Professional` **annual** price. Apply coupon `ANNUAL20`.
4. **Subscribe** to `Extra Seat Pack` **monthly** (separate subscription, no coupon).
5. **Subscribe** to `Data Export API` **monthly** (separate subscription, no coupon).
6. **Create a charge** of $250.00 (25000 cents) for the onboarding setup fee. Description: `NimbusOps onboarding setup fee — Acme Inc`. Source: `tok_visa`.
7. **Create an invoice item** of $75.00 (7500 cents) for Acme's customer. Description: `Custom dashboard configuration — 3 hours @ $25/hr`. Currency: usd.
8. **Create an invoice** for Acme to collect the invoice item.

### Globex Corp

1. **Update customer metadata:** add `pilot=true`, `onboard_date=2026-06-01`, `account_manager=james_wong`, `partner_tier=gold`
2. **Update customer description:** `Pilot — Enterprise monthly + Premium Support + Extra Seat Pack`
3. **Subscribe** to `NimbusOps Enterprise` **monthly** price. Apply coupon `LAUNCH50`.
4. **Subscribe** to `Premium Support` **monthly** (separate subscription, no coupon).
5. **Subscribe** to `Extra Seat Pack` **monthly** (separate subscription). Apply coupon `PARTNER30`.
6. **Create a charge** of $500.00 (50000 cents) for the enterprise onboarding fee. Description: `NimbusOps enterprise onboarding — Globex Corp`. Source: `tok_visa`.
7. **Create an invoice item** of $150.00 (15000 cents) for Globex's customer. Description: `SSO/SAML integration consulting — 6 hours @ $25/hr`. Currency: usd.
8. **Create an invoice** for Globex to collect the invoice item.

## Phase 5: Pipeline Verification (stateful — triggers create objects)

Fire the three standard payment pipeline test triggers: `payment_intent.succeeded`, `invoice.paid`, and `checkout.session.completed`.

**Important:** Triggers create real objects in the account. After firing all three:

4. List recent events and confirm the trigger events appear.
5. Retrieve one of your webhook endpoints by ID to confirm it remains active.

## Phase 6: State Mutations & Corrections

These steps depend on state created in earlier phases. Track IDs carefully.

### 6.1 Verify & update Acme's charge

1. **Find Acme's onboarding charge:** Locate the setup fee charge you created for Acme (amount=25000).
2. **Issue a partial refund** of $50.00 (5000 cents) on that charge. Reason: Acme negotiated a $50 discount after the fact.
3. **Retrieve the charge** after the refund and confirm it reflects the partial refund.

### 6.2 Delete coupon & handle cascading state

1. **Delete the `LAUNCH50` coupon** (confirm the deletion).
2. **Verify deletion:** List coupons and confirm `LAUNCH50` no longer appears. Only `ANNUAL20`, `PARTNER30`, and any seed coupons should remain.

### 6.3 Product update (stateful — changes what retrieve returns)

1. **Retrieve the `NimbusOps Starter` product** by its ID.
2. **Update** its description to: `Basic infrastructure monitoring for small teams. Up to 5 hosts, 30-day data retention, email alerts. LIMITED TIME: Free 14-day trial available.`
3. **Retrieve it again** to confirm the description changed.

### 6.4 Expand-based cross-reference verification

1. Pick the Professional annual price ID you created.
2. **Retrieve the price with its product expanded** so that the product appears as a full object rather than just an ID string.
3. Confirm the expanded product's name is `NimbusOps Professional`.

### 6.5 HTTP verb commands

1. Use the HTTP GET verb interface to list customers and verify you get a valid list response.
2. Use the HTTP POST verb interface to create a temporary product named `Scratch Pad`. Then immediately **delete** it (it was only for testing).
3. Attempt to retrieve the deleted product and confirm it returns a "resource_missing" error.

### 6.6 Config state

1. Set the `webhook_signing_secret` config value to `whsec_nimbusops_production_2026`.
2. List the config and verify the setting persists.

## Phase 7: Final Audit

Create a customer named `Setup Audit 2026-06-03` that records the full setup state:

- **Email:** `audit@nimbusops.dev`
- **Description:** `Automated setup verification record`
- **Metadata:** For each key below, query the current account state and set the value to the actual count. Every value must be dynamically determined from what exists in the account right now, not assumed.
  - `products_created` — number of active products (exclude any that were created and then deleted)
  - `prices_created` — total number of prices that currently exist in the account (count every price, including any not attached to a product)
  - `coupons_active` — number of coupons that currently exist (deleted coupons do not count)
  - `webhooks_created` — number of webhook endpoints
  - `subscriptions_created` — number of active subscriptions
  - `charges_created` — number of charges created for pilot customers
  - `refunds_issued` — number of refunds issued
  - `invoices_created` — number of invoices created for pilot customers
  - `triggers_fired` — number of pipeline triggers you fired
  - `events_total` — number of events visible in the events list
