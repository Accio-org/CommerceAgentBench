# CloudMerch — Stripe Integration Spec v2.1

Author: Platform Engineering  
Date: 2026-06-01  
Status: APPROVED — deploy to staging by Monday

---

## 1. Webhook Endpoints

We need three endpoints for our microservices. The DevOps team has already configured the DNS and TLS certs for these URLs, so just wire them up in Stripe.

### Order Fulfillment Service
URL: `https://api.cloudmerch.io/webhooks/fulfillment`  
Triggers the print queue when a customer successfully pays. Needs: `checkout.session.completed`, `payment_intent.succeeded`, `charge.succeeded`.  
Description: `Order fulfillment pipeline — triggers print queue on successful payment`

### Billing & Dunning Service  
URL: `https://api.cloudmerch.io/webhooks/billing`  
Handles subscription lifecycle and dunning flows. Needs: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.deleted`.  
Description: `Billing lifecycle — handles subscription changes and failed payments`

### Finance Reconciliation Service
URL: `https://api.cloudmerch.io/webhooks/finance`  
Syncs every charge and refund movement to the general ledger. Needs: `charge.refunded`, `charge.succeeded`, `payment_intent.payment_failed`.  
Description: `Finance ledger sync — records all charge and refund movements`

**Important — v2.1 update (2026-05-30):** After the May incident where a failed payment wasn't caught, the finance service now also needs `charge.failed` added to its event list. This was a P1 post-mortem action item. Make sure it's included alongside the three events listed above.

## 2. Test Customer

Create an integration test customer:  
Name: `CloudMerch Integration Test`, email: `integration-test@cloudmerch.io`, description: `Automated integration test customer — do not use for production`.  
Tag it with metadata `env=test` and `pipeline_version=2.1`.

## 3. Payment Scenarios

Run these in order to generate the events our verification relies on.

**A — Direct charge + partial refund.** Charge the test customer $75 (USD, tok_visa). Then partially refund $25.00 from that charge. Keep the charge ID — you'll need it for the report.

**B — Trigger payment_intent.succeeded.** This simulates a real checkout completing.

**C — Trigger checkout.session.completed.** End-to-end checkout flow.

**D — Trigger invoice.paid.** Simulates a subscription invoice being paid.

## 4. Tax & Shipping Configuration

While you're setting up the payment infrastructure, also configure:
- **Tax rate:** US Sales Tax, 8.875%, non-inclusive. Metadata: `jurisdiction=US`
- **Shipping rate:** "Standard US Shipping", fixed amount $5.99 USD

These aren't used by the pipeline directly but the checkout flow needs them available. Our checkout pages won't render without a shipping rate on file.

## 5. Pipeline Report

After all scenarios complete, write `outputs/pipeline_report.json`. Include the webhook endpoint count, test customer ID, which scenarios ran, the distinct event types you observed, the charge ID from scenario A, and the partial refund amount in cents.
