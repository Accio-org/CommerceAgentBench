We're the issuing bank — Bank of America, Chicago Branch — and we've just received a presentation from Bank of China, Hangzhou Branch (the negotiating bank) under our irrevocable documentary credit **BOA-DC-2026031045**, issued in favour of **Hangzhou Green Bag Co., Ltd.** for an eco-tote-bag shipment to the applicant **Acme Distribution LLC, Chicago**. The negotiating bank has already paid the beneficiary and is now claiming reimbursement from us. We have five banking days from the day of presentation to decide whether the documents constitute a complying presentation and, if not, to issue a single notice of refusal under UCP 600 Article 16.

I need you to examine the LC against the presented documents and identify every material discrepancy that would justify a refusal under UCP 600 — and, just as important, record the items that look discrepant but are in fact within the rules, so the audit trail shows you considered them and decided correctly. In LC examination both directions are mistakes: citing a spurious discrepancy (a false positive) loses the bank its right of refusal and invites a beneficiary dispute, while missing a real one forces us to honour a non-complying presentation.

Everything is in `workspace/` as local text transcriptions of the originals — this is an offline task, no network access needed or permitted. `lc_document.txt` is the issued LC (SWIFT MT700 transcription); `documents/` holds the six presented documents (`01_commercial_invoice.txt`, `02_packing_list.txt`, `03_bill_of_lading.txt`, `04_certificate_of_origin.txt`, `05_insurance_policy.txt`, and `06_bank_presentation_schedule.txt` — the negotiating bank's covering schedule, which gives the date of presentation/despatch); and `reference/ucp600_isbp821_cheatsheet.md` has the relevant UCP 600 articles and ISBP 821 practice notes with article numbers — use it whenever you cite a rule.

Write your audit to `outputs/discrepancy_audit.json` in exactly this shape:

```json
{
  "material_discrepancies": [
    {
      "doc": "<one of: commercial_invoice|packing_list|bill_of_lading|certificate_of_origin|insurance_policy|bank_presentation_schedule>",
      "field": "<short snake_case field name, e.g. on_board_date>",
      "lc_says": "<what the LC requires, as a short string>",
      "doc_says": "<what the document shows, as a short string>",
      "rule_cite": "<UCP 600 article and/or ISBP 821 paragraph reference>",
      "reason": "<one-sentence explanation>"
    }
  ],
  "non_material_examined": [
    {
      "doc": "<one of the enum values above>",
      "field": "<short snake_case field name>",
      "lc_says": "<what the LC requires>",
      "doc_says": "<what the document shows>",
      "rule_cite": "<UCP 600 article and/or ISBP 821 paragraph reference>",
      "reason": "<why this is NOT a material discrepancy>"
    }
  ],
  "decision_enum": "<one of: compliant | discrepant>",
  "decision_reason": "<one-sentence summary>"
}
```

A few rules on the fields: `doc` must be one of the enum strings shown (snake_case) — use `bank_presentation_schedule` for any field on the covering schedule (document 06). `field` is a snake_case identifier using the field's natural name as it appears on the document (e.g. "Date of Shipment" → `date_of_shipment`); common aliases are fine. `rule_cite` must include the article or paragraph reference (e.g. `"UCP 600 art 14(c)"`, `"UCP 600 article 30(c)"`, `"ISBP 821 A23 / typographical"`) — exact formatting is flexible. `decision_enum` is `"discrepant"` if any material discrepancy exists, otherwise `"compliant"`. A given (doc, field) pair belongs in exactly one of the two arrays, never both — listing it in both is an audit contradiction — and `material_discrepancies` must contain only true material discrepancies.

Keep only `discrepancy_audit.json` in `outputs/`; put any working notes or scratch files elsewhere in the working directory.
