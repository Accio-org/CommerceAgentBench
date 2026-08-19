# serpapi_hotels_replay

Read-only replay of SerpAPI's `google_hotels` engine. Used by v2 commerce/sourcing
trip-planning audit tasks (e.g. `api-travel-asia-supplier-tour-handoff`) that need real-shape
hotel candidate data without going to the live network.

## Snapshot layout

```
snapshots/
├── manifest.json                       ← dataset catalog (id → metadata)
├── shenzhen_huaqiang.json              ← Shenzhen (Huaqiangbei) — 1 night, 5 guests
├── yiwu_market.json                    ← Yiwu (International Trade Market) — 3 nights, 5 guests
├── ho_chi_minh_d1.json                 ← HCMC District 1 — 2 nights, 5 guests
├── bangkok_sukhumvit.json              ← Bangkok Sukhumvit — 2 nights, 5 guests (default)
└── bangkok_sukhumvit_revised.json      ← Bangkok Sukhumvit — 2 nights, 5 guests, max_price=250
```

Each snapshot carries the raw SerpAPI google_hotels response wrapped in a
`{_meta, payload}` envelope (the `_meta` block records the original query,
dates, filters, and fetch timestamp; `payload` is the raw SerpAPI body).

## Endpoint surface

```
GET /api/help                           ← top-level discovery
GET /api/datasets                       ← list all datasets with metadata
GET /api/datasets/<id>                  ← raw SerpAPI response JSON for one search
GET /api/datasets/<id>/help             ← response shape description
GET /health                             ← liveness probe
```

All endpoints are GET-only, return JSON. No authentication, no body parsing.
Errors return `{error, hint}` pointing back to `/api/help`.

## Why no anti-cheat access logging

Per the v2 outcome-based evaluation policy, scoring relies exclusively on
the agent's structured output (`outputs/audit_findings.json`). The mock is
a pure data-access channel; the verifier never inspects mock logs, request
counts, or query patterns.

## Running locally

```bash
cd bench_core/mock_services/serpapi_hotels_replay
PORT=4501 bun server.js
curl http://127.0.0.1:4501/api/help
curl http://127.0.0.1:4501/api/datasets | jq '.datasets[].id'
curl http://127.0.0.1:4501/api/datasets/bangkok_sukhumvit | jq '.payload.properties[0].name'
```

## Key design points for task authors

- **Chinese-locale OTA gap**: Google Hotels does not surface OTA prices in the
  listing-level response for Chinese cities (Shenzhen, Yiwu, etc.). Tasks that
  reference price-driven errors (arithmetic_error, policy_violation,
  cancellation_floor_violation) **must place those errors in legs covered by
  non-CN snapshots** (HCMC, Bangkok, etc.). CN snapshots still expose
  hotel_class, reviews_breakdown, nearby_places, amenities — those drive
  non-price errors (accessibility_mismatch, co_location_failure, rating_misquote).
- **`prices[]` may carry `free_cancellation` + `free_cancellation_until_date`**
  per-OTA. Tasks that need cancellation-policy errors must check this array
  rather than relying on a single boolean at the property level.
- **Vacation rentals carry rich `excluded_amenities`** (often 10+ entries
  including "Not wheelchair accessible", "No Wi-Fi", "No kitchen", "No
  elevator"). Hotels usually have empty `excluded_amenities`. Tasks that need
  cross_source_inconsistency errors should anchor those in vacation rentals.
- **5-star hotels carry full `reviews_breakdown`** (typically 6 categories:
  Service / Property / Bar / Breakfast / Dining / Fitness or similar). Mid-tier
  hotels (3-4 star) also have it; vacation rentals typically don't.
- **Mock returns SerpAPI data verbatim** — when amenities and excluded_amenities
  conflict for a single property, this mock does NOT decide which one wins.
  That disambiguation belongs in the task's authoritative source (corporate
  policy, task.md spec).
