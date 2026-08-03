# PeakVenture Outdoors — May 2026 Wholesale Ledger

From: Sarah Kim (Accounting)  
Exported: 2026-06-01  
Notes: All amounts USD. Convert to cents for Stripe. Round to nearest cent where needed.

---

**Alpine Ridge Outfitters** — Tier 1 wholesale, net 30. They get a 5% volume discount which is ALREADY reflected in the amounts below. Update their account description to: `Tier 1 wholesale — net 30, 5% volume discount applied`

- INV-2026-0501: Trekking pole assortment, 120 units at $119 each = $14,280
- INV-2026-0502: Waterproof daypack lot, 96 units at $90 each = $8,640
- INV-2026-0503: Replacement tent stakes, 1,050 units at $3.00 = $3,150
- INV-2026-0503-ADJ: CORRECTION — tent stakes were short-shipped, only 980 arrived. Credit the difference (70 units × $3.00 = $210). Net tent stakes = $2,940.

**Basecamp Supply Co** — Tier 2 wholesale, net 45. Standard pricing, no special terms. Set description: `Tier 2 wholesale — net 45, standard pricing`

- INV-2026-0504: Insulated water bottle case, 150 units × $42.50 = $6,375
- INV-2026-0505: 3-season sleeping bag pallet — originally 180 units at $120. HOWEVER: 12 bags failed QC inspection on arrival. Basecamp only accepted 168. Revised amount = 168 × $120 = $20,160. Do NOT invoice the rejected 12.

**Crestline Camping Wholesale** — Tier 1, net 30, priority fulfillment. Update description: `Tier 1 wholesale — net 30, priority fulfillment`

- INV-2026-0506: LED headlamp multipack, 330 units at $15 = $4,950
- INV-2026-0507: Camp stove set w/ fuel, 80 units at $140 = $11,200
- INV-2026-0508: Hiking boot clearance lot, 120 pairs at $64 = $7,680
- INV-2026-0509: First aid kit bundle, 90 units at $25 = $2,250

**Summit Trail Direct** — New account (not in Stripe yet). Create the customer first. Email: wholesale@summittrail.com. Description: `New wholesale account — net 60, first order`

- INV-2026-0510: Trekking backpack 55L, 40 units at $185 = $7,400
- INV-2026-0511: Portable water filter set, 200 units at $34.50 = $6,900

---

After all invoices are created, write `outputs/reconciliation.json` with the total invoiced amount (in cents), number of invoices, and number of line items.
