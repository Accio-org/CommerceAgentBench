I'm a marine cargo claims analyst at the consolidator MSC Logistics China. One of our 40HQ co-loaded containers, **OCEAN-2026-04-V552**, suffered a door-seal failure in the Malacca Strait on 12 April 2026 — saltwater entered the back-bottom and wet part of the cargo before the seal was re-secured at Singapore (transhipment). The container carries goods belonging to **five different customers**, each insured under their own separate marine cargo policy: some were arranged by the Chinese supplier under CIF, others by the buyer directly under FOB, and each policy has its own coverage scope (ICC(A) / (B) / (C)), its own deductible structure, and in some cases commodity-specific exclusions or per-event sub-limits. I need you to process the surveyor's per-carton damage finding against each customer's policy and produce a per-customer settlement summary. Both under-paying a customer who is entitled to recovery and over-paying one whose policy exclusion applies expose us to disputes (the under-paid customer escalates; the over-paid claim gets reversed by the insurer's audit team months later), so read each policy carefully.

Everything is local under `workspace/` — offline task, no network, and don't modify any of the input files. `shipments.csv` is the per-carton manifest (`customer_id, carton_id, sku, units_per_carton, unit_value_usd, total_value_usd, stow_tier, stow_section` — 50 cartons total across the 5 customers). `damage_report.json` is the surveyor's structured per-carton damage finding (`damage_pct` 0.0 / 0.30 / 1.00, plus the incident summary and cause classification: `ordinary_water_damage_in_transit`, `no_gross_negligence_determined`), and `surveyor_report.pdf` is the matching narrative survey report (Lloyd's Register, case #LR-SIN-2026-04-V552-A) with the incident account, cause/negligence finding of fact, damage-percentage methodology, and per-carton findings table. The five marine cargo policy PDFs are in `policies/`, one per customer: `linnea_pingan_policy.pdf` (Linnea Furniture, Sweden — CIF / PingAn), `jonas_allianz_policy.pdf` (Jonas Auto Parts, Germany — FOB / Allianz), `mahmoud_sinosure_policy.pdf` (Mahmoud Trading, Egypt — CIF / Sinosure), `oceantech_baoviet_policy.pdf` (OceanTech Marine, Vietnam — FOB / BaoViet), and `verde_mapfre_policy.pdf` (Verde Importadora, Chile — CIF / Mapfre). `container_master_insurance.md` is the container-level co-loading memorandum (master cap threshold, stow layout), and `icc_clauses_reference.pdf` is the Institute Cargo Clauses (A)/(B)/(C) coverage-scope reference card (London-market 1/1/2009 revision).

Write **`outputs/insurance_settlement.json`** (UTF-8); keep only that file in `outputs/`. The top-level shape must be exactly:

```json
{
  "settlements": [
    {
      "customer_id": "LINNEA",
      "gross_claim_usd": 5000.00,
      "reduction_from_claim_usd": 250.00,
      "paid_usd": 4750.00,
      "status": "paid_partial",
      "insurer": "PingAn",
      "reason_short": "ICC(A) covers water damage; absolute deductible applied per policy schedule."
    }
  ],
  "summary": {
    "total_gross_claim_usd": 30000.00,
    "total_paid_usd": 22000.00,
    "total_reduction_usd": 8000.00,
    "count_paid": 3,
    "count_denied": 1,
    "count_no_claim": 1,
    "container_cap_check": true
  }
}
```

That single entry is illustrative — follow the same shape for all five settlements, but compute the actual numbers from `shipments.csv`, `damage_report.json`, and each policy; don't reuse the example figures.

Field constraints:

| Field | Type | Constraint |
|---|---|---|
| `settlements` | array | exactly 5 entries, one per customer |
| `settlements[].customer_id` | string | one of: `LINNEA`, `JONAS`, `MAHMOUD`, `OCEANTECH`, `VERDE` (uppercase) |
| `settlements[].gross_claim_usd` | number | sum of (carton damage_pct × carton total_value_usd) across all cartons of this customer. USD, two decimals, ±0.50 tolerance |
| `settlements[].reduction_from_claim_usd` | number | `gross_claim_usd − paid_usd`. Encodes whatever combination of deductible, exclusion, sub-limit, or coverage gap reduced the payout |
| `settlements[].paid_usd` | number | final amount the insurer pays this customer for this event. USD, two decimals, ±0.50 tolerance |
| `settlements[].status` | string | one of: `paid_full`, `paid_partial`, `denied`, `no_claim`, `escalate_surveyor` |
| `settlements[].insurer` | string | short insurer name (e.g. `PingAn`, `Allianz`, `Sinosure`, `BaoViet`, `Mapfre`) — case-insensitive substring match against policy doc |
| `settlements[].reason_short` | string | 1–2 sentences citing the policy clause(s) that govern the settlement (clause name, ICC tier, sub-limit, exclusion language). Used as the customer-facing explanation |
| `summary.total_gross_claim_usd` | number | sum of `settlements[].gross_claim_usd`. ±1.00 tolerance |
| `summary.total_paid_usd` | number | sum of `settlements[].paid_usd`. ±1.00 tolerance |
| `summary.total_reduction_usd` | number | sum of `settlements[].reduction_from_claim_usd`. ±1.00 tolerance |
| `summary.count_paid` | integer | number of customers with status in {`paid_full`, `paid_partial`} |
| `summary.count_denied` | integer | number of customers with status in {`denied`, `escalate_surveyor`} (treat escalation as a non-payment outcome from the consolidator's view) |
| `summary.count_no_claim` | integer | number of customers with status `no_claim` |
| `summary.container_cap_check` | bool | `true` iff `total_paid_usd ≤ 130_000` (the container-level aggregate threshold defined in `container_master_insurance.md`) |

Status semantics:

- `paid_full` — paid_usd equals gross_claim_usd (no deductible / no cap / no exclusion bites).
- `paid_partial` — paid_usd is positive but less than gross_claim_usd (deductible, sub-limit, or partial-coverage reduction applies).
- `denied` — paid_usd is zero because a policy exclusion or coverage-scope gap applies; no further escalation path is available under the policy as written.
- `escalate_surveyor` — paid_usd is zero on the current record but the policy permits a path to recovery if additional surveyor evidence (e.g. gross-negligence finding) is later obtained. Use this when there is a contingent recovery path that the customer service team should know about, rather than a flat denial.
- `no_claim` — gross_claim_usd is zero (no damage), so paid_usd is also zero and the customer record is closed without an insurance settlement.

For `insurer`, use a concise canonical name; case differences against the policy doc's stated insurer name are acceptable, and these spellings are interchangeable: `PingAn` (or `PingAn P&C` / `Ping An`), `Allianz`, `Sinosure`, `BaoViet` (or `Bảo Việt`), `Mapfre`.
