# Sourcing Desk — Supplemental Reference Notes

> Internal cheatsheet supplementing the two PDF references under
> `references/`. Use this for facts that don't fit naturally into the
> Incoterms quick reference or the ocean transit times table —
> realistic BOM floors by product family, container capacities, the
> 2026/2027 calendar dates that matter for production planning, and
> the backward-arithmetic helper for date-driven RFQs.

## 1. Air freight typical transit times

| Origin → Destination | Typical transit (days) | Notes |
|---|---|---|
| Shanghai PVG → any major hub (DXB / FRA / JFK / LAX / SYD / GRU) | 3–7 | Direct cargo flight + customs |
| Shanghai PVG → Mexico City / Manzanillo | 5–9 | Often with US transshipment |
| Shanghai PVG → small / non-hub airports | 7–14 | Multi-leg, customs through hub |

Air freight is roughly 7–12× ocean cost per kilogram. Reserve for
high-value, urgent, or perishable cargo. The ocean lane PDF covers
sea freight transit windows in detail.

## 2. Container types and typical capacity

| Container type | Internal volume | Max payload | Typical use |
|---|---|---|---|
| 20'GP | ~33 m³ | ~28 t | Heavy / dense small loads |
| 40'GP | ~67 m³ | ~28 t | General light cargo |
| 40'HQ (High Cube) | ~76 m³ | ~28 t | Light bulky cargo |

A **40'HQ exclusive-use** booking only makes economic sense when the
shipper has either (a) at least ~30 m³ of cargo or (b) specific
non-volume reasons (high-value, hazmat segregation, time-critical
single-customer clearance). Booking a full 40'HQ for an order that
fits in a single LCL pallet (≤ 1 m³ / ≤ 100 kg) almost always
indicates the buyer has mixed up "container shipping" (FCL) with
"shipping in general" (LCL or air). Flag and clarify.

Note: **air freight does not use ocean containers**. Air cargo
travels on aircraft ULDs (unit load devices) such as PMC pallets or
AKE containers. A buyer requesting "40HQ container via air freight"
is mixing two incompatible shipping modes.

## 3. Realistic BOM floors (rough order of magnitude)

These are floor numbers — actual cost depends on volume, supplier,
material grade. Quote requests below these floors are unlikely to be
fulfillable unless quality is sacrificed.

| Product | Realistic FOB floor / unit (USD) | Typical BOM drivers |
|---|---|---|
| Ceramic mug, custom embossed, 11oz, ISO + FDA | 0.65 – 1.20 | Clay + glaze + firing + emboss tooling + cert |
| LED desk lamp, mid-range, CE + RoHS + GS | 5.50 – 9.00 | LED module + driver + aluminium + plastic + cert testing |
| Silicone TPU phone case, custom silkscreen, ISO + INMETRO + RoHS + REACH + 100% inspection | 0.45 – 0.80 | Silicone TPU + mould + silkscreen + cert (INMETRO ~$0.08/unit alone) + 100% inspection |
| SS304 vacuum bottle 750ml, laser-engraved | 3.20 – 6.50 | SS304 sheet + vacuum sealing + insulation + engraving + cert |
| Garden trowel SS304 full-tang, hardwood handle, CE + BSCI | 1.80 – 3.50 | SS304 forging + handle wood + tang fit + heat-treat + cert |

A target price below the floor with full certification, customisation,
and inspection requirements is a commercial-reality flag — the buyer
either has out-of-date market info or has not budgeted the
certification / inspection costs separately. Flag in your reply.

## 4. Calendar dates that matter for production planning

For RFQs received between mid-2026 and early-2027:

- **Chinese New Year 2027**: 17 February (Year of the Goat). Most
  factories close 10–14 days around this date. Expect a production
  blackout from ~12 February to ~24 February 2027.
- **Easter 2027**: 17 April (Sunday). UK / EU retail spring stock-up
  window — Good Friday is 15 April.
- **Black Friday 2026**: 27 November. US / EU retail Q4 peak.
- **Christmas 2026**: 25 December.
- **Día de Reyes 2027 (Mexico)**: 6 January. Mexican retail
  gift-giving peak; goods need to be on shelves by ~20 December.
- **Eid al-Fitr 2027 (approximate)**: mid-March (depends on moon
  sighting in target country).
- **National Day Holiday 2026 (China)**: 1–7 October.

## 5. Backward-arithmetic helper for date-driven RFQs

For any RFQ with a hard delivery date, compute backward through this
chain:

  required_arrival_at_buyer_warehouse
  − inland_transit_to_destination_warehouse  (1–5 days, varies)
  − ocean_transit                            (see transit-times PDF)
  − production_lead_time                     (typically 25–45 days)
  − payment_clearance + PO-to-production-start (3–7 days)
  = latest_PO_confirmation_date

If the buyer's stated PO date does not leave enough working days, the
deadline is at risk and must be flagged with a concrete alternative
(reduce qty, change shipping mode, change product spec).

For RFQs that explicitly invite "tell me if the timeline is tight",
treat the polite invitation as the buyer's pre-acknowledgement, not as
permission to ignore the math.
