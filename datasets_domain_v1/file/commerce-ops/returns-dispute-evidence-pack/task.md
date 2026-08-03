I'm putting together defensible return-resolution evidence packs for a batch of marketplace returns. For each return, decide whether the seller should accept the return, issue a partial refund, issue a full refund, dispute / request platform review, or request more evidence — and ground that call in the order events, carrier scans, inspection records, SLA deadlines, customer messages, local photos, and the written policies. Keep it neutral throughout: don't accuse the buyer, use operational language, and focus on evidence, policy fit, and next actions.

Everything is local under `workspace/` and this is an offline task. The return-center export `returns/return_center_export.csv` is only the batch index — on its own it does NOT contain enough to substantiate any decision. The per-case detail lives elsewhere: order events in `orders/order_event_log.jsonl`, carrier scans in `carrier/carrier_scan_history.json`, RMA inspection results in `inspection/rma_inspection_worksheet.csv`, the customer conversation in `messages/customer_thread.md`, package / label / returned-item photos in `photos/`, the marketplace return policy and the seller's returns SOP in `policies/` (`marketplace_return_policy.pdf` + `seller_sop_returns.md`), and the case deadlines in `sla/marketplace_case_deadlines.csv`. To make each decision defensible you have to actually read the relevant per-case sources and cite the specific ones you used.

Write exactly three files to `outputs/`: `return_decision.json`, `evidence_pack.md`, and `customer_safe_response.md`.

`return_decision.json` uses this shape:

```json
{
  "case_decisions": [
    {
      "return_id": "RET-EXAMPLE",
      "order_id": "ORD-EXAMPLE",
      "decision": "accept_return | partial_refund | full_refund | dispute_claim | request_more_evidence",
      "decision_reason": "short explanation referencing the policy clause and the key factual finding",
      "evidence_items": [
        {
          "evidence_id": "E1",
          "source_file": "workspace/<subdir>/<filename>",
          "supports": "specific factual datum quoted/paraphrased from this exact file",
          "confidence": "high | medium | low"
        }
      ],
      "policy_cites": ["page or section references from marketplace_return_policy.pdf or seller_sop_returns.md"],
      "sla_or_followup_notes": ["per-case marketplace_case_id and/or sla_hours_remaining from sla/marketplace_case_deadlines.csv"],
      "next_actions": ["operational actions"]
    }
  ],
  "batch_notes": ["cross-case observations"]
}
```

For each `evidence_items[]` entry, `source_file` must be a real relative path under `workspace/` (for example `workspace/carrier/carrier_scan_history.json` or `workspace/photos/<image>.jpg`), and `supports` must quote or paraphrase a concrete factual data point from that exact file — a weight, tracking number, scan-event phrase, inspection observation, and so on — not just generic keywords. Fill `sla_or_followup_notes` for every case with a per-case reference back to the SLA data in `sla/marketplace_case_deadlines.csv`.

`evidence_pack.md` narrates the evidence per return, mentioning each `return_id` explicitly. `customer_safe_response.md` gives one short, neutral, non-accusatory message per return — keep the language neutral and non-accusatory throughout.
