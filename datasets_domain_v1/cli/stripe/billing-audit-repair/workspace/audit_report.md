# VoltGrid Energy — Billing Audit Report

Auditor: Finance Operations  
Date: 2026-06-03

This audit covers the complete Stripe billing state. You must inspect, compare against the specification below, and fix every discrepancy. **Do not follow a pre-written fix list** — you must discover each issue yourself by diffing the live state against the spec.

---

## Part A: Product Catalog Specification

The account should contain **exactly 7 products** (no more, no less). Delete any extras; create any missing.

| # | Product Name | Description | Metadata | Prices |
|---|---|---|---|---|
| 1 | `VoltGrid Basic` | `Single charging station management. Real-time monitoring, basic analytics, email alerts.` | `tier=basic`, `stations=1` | $89/mo (8900), $890/yr (89000) |
| 2 | `VoltGrid Professional` | `Up to 10 stations. Advanced analytics, load balancing, mobile app, API access.` | `tier=professional`, `stations=10` | $149/mo (14900), $1,490/yr (149000) |
| 3 | `VoltGrid Fleet` | `Unlimited stations. Fleet management, route optimization, priority support, SLA guarantee.` | `tier=fleet`, `stations=unlimited` | $899/mo (89900), $8,990/yr (899000) |
| 4 | `Maintenance Add-on` | `Quarterly on-site maintenance inspection for each registered station.` | `addon=true`, `frequency=quarterly` | $149/mo (14900) |
| 5 | `Hardware Warranty` | `Extended 3-year warranty for VoltGrid charging hardware. Covers parts and labor.` | `addon=true`, `warranty_years=3` | $39/mo (3900) |
| 6 | `Energy Analytics` | `Real-time energy consumption dashboards with carbon offset tracking and utility rate optimization.` | `addon=true`, `analytics_tier=advanced` | $69/mo (6900) |
| 7 | `API Integration Pack` | `RESTful API access for third-party fleet management and billing system integration.` | `addon=true`, `api_rate_limit=5000` | $129/mo (12900) |

**Price rules:**
- Tier products (1-3) have both monthly AND annual prices. Annual = monthly × 10 (not × 12).
- Add-on products (4-7) have monthly prices ONLY.
- Total active prices should be **10** (3 tiers × 2 + 4 add-ons × 1).
- All prices are USD, recurring.

## Part B: Promotions

### Coupons — exactly 3 active

| Name | Type | Value | Duration |
|---|---|---|---|
| `EARLYBIRD` | percent_off | 15 | repeating, 6 months |
| `FLEET25` | percent_off | 25 | forever |
| `HARDWARE10` | amount_off | 1000 (=$10.00) | once, currency=usd |

### Tax Rates — exactly 1

| Display Name | Percentage | Inclusive | Metadata |
|---|---|---|---|
| `US Sales Tax` | 8.875 | false | `jurisdiction=US`, `tax_type=sales_tax` |

### Shipping Rates — exactly 1

| Display Name | Type | Amount | Metadata |
|---|---|---|---|
| `Equipment Delivery` | fixed_amount | $24.99 (2499 cents), usd | `carrier=fedex`, `speed=ground` |

## Part C: Webhook Endpoints — exactly 3

| URL | Events | Description |
|---|---|---|
| `https://api.voltgrid.com/webhooks/billing` | `invoice.paid`, `invoice.payment_failed`, `charge.refunded` | `Billing event notifications` |
| `https://api.voltgrid.com/webhooks/fleet` | `customer.subscription.created`, `customer.subscription.deleted`, `payment_intent.succeeded` | `Fleet subscription lifecycle` |
| `https://api.voltgrid.com/webhooks/analytics` | `charge.succeeded`, `payment_intent.payment_failed` | `Analytics data pipeline` |

## Part D: Customer Specification — exactly 5

| Name | Email | Description | Extra Metadata |
|---|---|---|---|
| `ChargeFast Inc` | `billing@chargefast.io` | `Fleet customer — unlimited stations, annual billing` | `segment=enterprise` |
| `GreenDrive LLC` | `accounts@greendrive.com` | `Professional customer — 10 stations, monthly billing` | `segment=mid_market` |
| `ParkCharge Systems` | `finance@parkcharge.dev` | `Basic customer — 1 station, monthly billing with maintenance` | `segment=smb` |
| `EcoFleet Partners` | `ops@ecofleet.co` | `Fleet customer — unlimited stations, monthly billing` | `segment=enterprise`, `partner=true` |
| `CityGrid Municipal` | `procurement@citygrid.gov` | `Professional customer — 10 stations, annual billing, government rate` | `segment=government`, `tax_exempt=true` |

## Part E: Active Subscriptions — exactly 8

| Customer | Product | Interval | Coupon |
|---|---|---|---|
| ChargeFast Inc | VoltGrid Fleet | year | FLEET25 |
| ChargeFast Inc | API Integration Pack | month | — |
| GreenDrive LLC | VoltGrid Professional | month | EARLYBIRD |
| GreenDrive LLC | Energy Analytics | month | — |
| ParkCharge Systems | VoltGrid Basic | month | — |
| ParkCharge Systems | Maintenance Add-on | month | — |
| EcoFleet Partners | VoltGrid Fleet | month | FLEET25 |
| CityGrid Municipal | VoltGrid Professional | year | — |

## Part F: Charges — exactly 4 setup fees

| Customer | Amount | Description |
|---|---|---|
| ChargeFast Inc | $2,500.00 (250000) | `Fleet onboarding and hardware installation — ChargeFast Inc` |
| GreenDrive LLC | $750.00 (75000) | `Professional setup and station configuration — GreenDrive LLC` |
| EcoFleet Partners | $2,500.00 (250000) | `Fleet onboarding and hardware installation — EcoFleet Partners` |
| CityGrid Municipal | $1,200.00 (120000) | `Professional setup with government compliance audit — CityGrid Municipal` |

## Part G: Pipeline Verification

After all repairs are complete, verify the billing pipeline by firing three standard triggers:
1. A successful payment intent
2. A paid invoice
3. A completed checkout session

Then confirm that the corresponding event records were created in the account.

## Part H: Final Audit Record

Create customer `Audit Complete 2026-06-03`:
- **Email:** `audit@voltgrid.com`
- **Description:** `Billing audit — all discrepancies resolved`
- **Metadata** — count from the LIVE account state (do not hardcode):
  - `products_total`: number of active products in the account
  - `prices_active`: number of active prices (excluding any deactivated)
  - `coupons_total`: number of active coupons
  - `customers_total`: total customer count (including this audit customer)
  - `subscriptions_total`: number of active subscriptions
  - `webhooks_total`: number of webhook endpoints
  - `charges_total`: number of charges
  - `events_total`: number of events recorded in the account
