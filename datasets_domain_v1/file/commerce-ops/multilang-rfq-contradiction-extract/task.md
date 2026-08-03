I'm the inbound-RFQ analyst on a Hangzhou-based sourcing team that ships consumer goods worldwide. Five buyer RFQs came in this week in different languages, and the account managers need them processed before they reply. For each one, identify the language and pull out a short normalised summary of the key commercial fields the sales desk quotes on, then flag any internal inconsistency the RFQ contains — places where one part of the buyer's request is incompatible with another (a transit time that's wrong by physics, an Incoterm that conflicts with the delivery obligation they describe, a target price that's unrealistic given the certifications they also require, a shipping spec that mixes incompatible modes, a backward timeline). These are common when buyers are early in their sourcing journey or copy-paste from an old template; flagging them politely up front is how we avoid costly rework after the quote goes out. Be accurate — misreporting a field misleads the account manager, and missing a real inconsistency lands the rework cost on the relationship later.

Everything is under `workspace/` and this is an offline task (no network). The five RFQs are in `inbox/` as RFC 5322 / MIME `.eml` messages, each written in the buyer's own language; every message carries an `X-Internal-Tag: rfq-inbound; rfq_ref=RFQ-NN` header, and that `RFQ-NN` is the identifier you must use in your output. Your authoritative working references are in `references/`: `incoterms_2020_quick_reference.pdf` (internal-edition Incoterms 2020 — all eleven rules with risk / cost / main-carriage allocation, the mutually exclusive buyer-side choices, and standard ancillary obligations), `ocean_transit_times_reference.pdf` (typical ocean transit times from China origins to North America, Europe, and the rest of world, plus a short air-freight comparison), and `sourcing_supplemental_notes.md` (air-freight transit, container capacities, realistic BOM floors per product family, the 2026/2027 production-calendar dates, and a backward-arithmetic helper for date-driven RFQs). `internal/sales_director_notes.md` is a multi-perspective scratch pad from the sales director, senior account manager, production planning, treasury, and compliance — use it for situational awareness only; the voices sometimes disagree and must never override an inconsistency that is objectively present in the buyer's email. Don't modify any of the workspace files.

Write your analysis to `outputs/rfq_analysis.json` (UTF-8), and keep only that file in `outputs/`. The top-level shape must be exactly:

```json
{
  "rfqs": [
    {
      "rfq_id": "<the RFQ-NN identifier from the email's X-Internal-Tag header, e.g. 'RFQ-01'>",
      "language": "<ISO 639-1 two-letter code, lowercase>",
      "normalized": {
        "quantity_units": <integer: the headline total units the buyer states (e.g. "12,000 unidades" → 12000); report what they wrote, don't re-normalise to a different figure>,
        "incoterm": "<uppercase 3-letter Incoterm the buyer explicitly names (FOB/CFR/CIF/DAP/DDP/EXW); report what the buyer wrote, not what would be 'correct' — the conflict, if any, goes in contradictions>"
      },
      "contradictions": [
        {
          "category": "<one of the five category values described below>",
          "evidence": "<short string quoting or paraphrasing the conflicting parts of the RFQ; concrete enough for the account manager to paste into the reply>",
          "suggested_resolution": "<one short sentence proposing a concrete fix>"
        }
      ]
    }
  ],
  "summary": {
    "total_rfqs": 5,
    "total_contradictions": <integer: sum of len(contradictions) across all 5 RFQs>
  }
}
```

Produce exactly one entry per RFQ file. For `category`, use exactly one of:

- `physical_impossibility` — a transit, lead, or production time the buyer states that isn't achievable under normal shipping physics or practice.
- `incoterm_conflict` — the Incoterm the buyer names is incompatible with the cost / risk allocation they describe in the same RFQ.
- `cost_infeasible` — the buyer's target price is below a realistic BOM given the certifications, customisation, and inspection they also require.
- `logical_conflict` — two operational specs conflict in a non-physics way (e.g. a quantity that doesn't match the booking type, or two shipping modes mixed in one spec).
- `timeline_conflict` — the required arrival date is incompatible with the production + transit times the buyer themselves describes.
