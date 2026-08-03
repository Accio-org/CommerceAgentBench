# State Manifest — file-commerce-ops-multilang-rfq-contradiction-extract

This task is fully offline. Use only files under `workspace/`. Do not browse the live web, and do not modify any input file.

## File layout

- `inbox/` — five inbound RFQ emails as `.eml` (MIME format with realistic Return-Path / Received / From / To / Subject / Message-ID / Content-Type headers; the body of each is written in the buyer's own language). Each message carries an `X-Internal-Tag: rfq-inbound; rfq_ref=RFQ-NN` header — that `RFQ-NN` is the identifier to use in your output.

- `internal/`
  - `sales_director_notes.md` — multi-perspective scratch-pad from the sales director, senior account manager, production planning lead, treasury, and compliance reviewer. Context only — voices sometimes disagree, sometimes have stale market intel, and **never override an objectively-flagged inconsistency in the buyer's email**. Use it for situational awareness; don't let it substitute for your own technical review.

- `references/`
  - `incoterms_2020_quick_reference.pdf` — internal-edition Incoterms 2020 reference card. All eleven rules tabulated for risk / cost / main-carriage allocation, including the "mutually exclusive choices" guidance for the FOB-pricing-with-DAP-obligations confusion.
  - `ocean_transit_times_reference.pdf` — internal table of typical port-to-port ocean-freight transit windows on the major lanes (China origins to North America, Europe, and rest of world), with a short note on how to read the numbers and a brief air-freight comparison.
  - `sourcing_supplemental_notes.md` — supplement covering air-freight transit, container capacities, realistic BOM floors by product family, the 2026/2027 calendar dates that matter for production planning, and the backward-arithmetic helper for date-driven RFQs.

  Treat the two PDF references as the authoritative working reference for this task.

## Privacy / safety note

All buyer companies, names, email addresses, phone numbers, postal addresses, message IDs, IP addresses, and certificate / policy numbers in the inbox emails are fictional. The buyer scenarios are constructed to test sourcing analysis under realistic-looking commercial inputs.
