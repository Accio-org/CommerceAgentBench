# GreenLeaf Trading — QA Inspection Report

**Period:** June 2026 purchasing cycle  
**Prepared by:** Li Wei, Senior QC Inspector  
**Date:** 2026-06-01  
**Distribution:** Finance Controller (for refund processing)

---

## Inspection Results

### Shenzhen HuaXin Electronics

**PO-2026-0891 — Bluetooth Module Batch B-4412**  
500 units received. Re-tested RF certification on random sample of 100; extrapolated failure rate 25% (115 of 500 units failed). Supplier acknowledges the defect and will not dispute a proportional credit. Original charge was $8,500 for the lot.

**PO-2026-1104 — USB-C Cable Lot C-5523**  
All 2,000 units passed continuity and data throughput tests at rated speeds. No action required.

**PO-2026-1201 — LED Driver Board LD-7710**  
500 boards received at blended rate ($44/unit standard, $88/unit premium sub-lot). Visual inspection found 3 boards with solder bridge defects — all 3 from the premium sub-lot. Overall defect rate 0.6% (within 1% contractual tolerance). Per the standing batch-credit policy, this lot should be logged as no-credit despite the defect note.

### Dongguan MeiDa Packaging

**PO-2026-0742 — Retail Box Print Run RB-7790**  
Entire batch rejected. Pantone color measurement showed ΔE > 5.0 on the brand logo across all units. This is a full batch failure — supplier will reprint at their cost. Original invoice: $3,200.

**PO-2026-0955 — Corrugated Mailer Batch CM-3301**  
2,000 mailers received. 150 had torn flaps on arrival (7.5%). MeiDa's per-unit cost on the invoice is $3.40/mailer. They've agreed to credit the affected units at cost.

**PO-2026-1033 — Gift Box Insert Set GBI-4420**  
This is a duplicate invoice for the same order as the CM-3301 batch re-run. MeiDa's accounting confirmed the billing error. Original charge: $1,850.

### Ningbo SailWind Logistics

**FD-2026-038 — Freight Deposit FD-2026-038**  
Container was delivered 18 calendar days past the contractual deadline. Our SLA penalty clause applies starting from day 8 of the delay.

**WH-2026-Q2 — Warehousing Fee WH-2026-Q2**  
Invoiced for the full 90-day quarter but goods were transferred out after 71 days. The overcharge is proportional to the unused 19 days. Original invoice: $5,600.

### Guangzhou YiHe Textiles

**SS-A10 — Fabric Sample Set SS-A10**  
Entire sample set arrived water-damaged — packaging was compromised during ocean transit. Supplier is air-shipping replacements and has agreed to credit the original shipment. Original charge: $950.

**PO-2026-0889 — Organic Cotton Bolt OC-889**  
Lab test confirmed organic certification. Tensile strength and colorfastness both within spec. No quality issues found.

---

## Batch Closure

After all credits have been issued:

1. Update each credited supplier's account description to summarize: `Refunded $X.XX across N transactions (2026-06 batch)`.

2. Create a batch tracking customer named `Refund Batch 2026-06` (email: refunds@greenleaf-trading.com) with metadata: total_refunded_cents, refund_count, customers_affected, batch_date=2026-06-01.

3. Create a payment intent for the net refund total (USD) with description `Net refund liability — Batch 2026-06`, metadata batch=2026-06 and type=refund_liability.

---

*End of report.*
