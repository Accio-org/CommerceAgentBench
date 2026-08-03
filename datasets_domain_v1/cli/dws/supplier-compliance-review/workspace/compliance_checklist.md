# NorthBridge Accessories — Supplier Compliance Policy (Q2 2026)

**Audit date:** 2026-06-03

NorthBridge Accessories keeps every supplier's onboarding documents in the DingTalk Docs knowledge base under the **`Suppliers`** folder — one sub-folder per supplier. Quality & Compliance runs a quarterly audit of this document set. This policy defines the standard each supplier must meet and what to record.

## 1. What every supplier must have on file

A supplier folder is **compliant** only if it contains, current as of the audit date, all three of the following documents, each belonging to that supplier:

1. A **Product Specification** document.
2. An **ISO 9001 (quality-management-system) certificate** that (a) is current, (b) was issued to this supplier's own legal entity, and (c) whose **scope of certification covers the product line NorthBridge sources from that supplier** (see §4).
3. A **Prior Audit Note** (factory audit findings from the previous quarter) with **all findings resolved** (see §5).

A supplier that is missing any of the three, or whose certificate fails any of the §4 checks, or whose audit note has open findings, is **non-compliant**.

## 2. Document room housekeeping

Before evaluating any supplier, put the document room in order:

- Some supplier folders contain **sub-folders** (e.g. `Certificates`). Check inside sub-folders too — a certificate filed in a sub-folder of the correct supplier is still valid.
- A document may be sitting in the **wrong supplier's folder**. The folder location is a convenience label — it is not proof of which entity a certificate belongs to. Read each certificate's USCC (§4) and compare with the Product Specification USCC in the supplier folder that matches. If they do not match, the certificate belongs to a different supplier. **Move misfiled documents to the folder of the supplier they actually belong to** before evaluating compliance. Use the document's USCC — not its file name — to determine where it belongs.
- Some suppliers may have **duplicate certificates** (e.g. an old expired version and a newer one). When duplicates exist, use the one with the **later expiry date** for evaluation. You do not need to remove the old one.
- Ignore irrelevant documents (meeting notes, shipping quotes, drafts, memos) — they are not compliance documents and should not affect the evaluation.

## 3. Certificate currency

A certificate is **current** if its expiry date is **on or after** the audit date (2026-06-03). A certificate whose expiry date is before 2026-06-03 is expired and does not count.

## 4. A certificate must be the supplier's own — and cover its product line

A supplier is a registered legal entity. Its identity of record is the legal name and the **Unified Social Credit Code (USCC)** shown on its Product Specification. An ISO 9001 certificate satisfies the requirement for a supplier only if **both**:

- it was issued to that same legal entity — that is, the **USCC printed on the certificate matches the USCC on the supplier's Product Specification**; and
- its **scope of certification covers that supplier's product line** — i.e. the products NorthBridge sources from the supplier fall within the activities the certificate certifies.

A certificate states its scope of certification in its own words. Read that scope and judge whether it covers the supplier's product line listed in `workspace/supplier_directory.csv`: a certificate that certifies a **different product class, a different manufacturing process, or a different point in the supply chain** does not cover the product line even if it shares some words with it; a certificate in **broader category terms** covers the product line when the sourced products clearly fall within that category.

Read the document itself to confirm the issuing entity and the scope.

## 5. Prior audit note — all findings must be resolved

The Prior Audit Note records findings from the previous quarter's factory inspection. A supplier is compliant on this criterion only if **every finding** in the document has status **Closed** or **Resolved**. If any finding has status **Open** (or any non-resolved status), the supplier is non-compliant.

If a supplier's prior audit note is **missing entirely**, the supplier is non-compliant.

## 6. What to record for each supplier

Once you have put the document room in order and evaluated every supplier, record the outcome:

- **Non-compliant supplier** — add a **global comment** on the most relevant document (the certificate if the issue is certificate-related, the audit note if the issue is open findings) that cites every deficiency code that applies:
  - `CERT-EXPIRED` — the ISO 9001 certificate's expiry date is before the audit date.
  - `CERT-WRONG-ENTITY` — the certificate's USCC does not match the supplier's USCC from their Product Specification.
  - `CERT-SCOPE-MISMATCH` — the certificate's scope of certification does not cover the supplier's product line.
  - `CERT-MISSING` — no ISO 9001 certificate belonging to the supplier is on file (even after checking other folders for misfiled documents).
  - `AUDIT-OPEN-FINDING` — the Prior Audit Note has one or more unresolved findings.
  - `AUDIT-MISSING` — no Prior Audit Note is on file for the supplier.

  If a supplier has multiple deficiency codes, include all of them in a single comment.

- **Compliant supplier** — no comment needed.

## 7. Review results document

After evaluating all suppliers, create one document named **Q2 2026 Compliance Review Results** under the knowledge base root folder. The document must list every supplier with its compliance status and, for non-compliant suppliers, the deficiency codes. Use this format:

```
# Q2 2026 Compliance Review Results

Audit Date: 2026-06-03
Reviewer: QC Ops

## Summary
Total suppliers: <N>
Compliant: <N>
Non-Compliant: <N>

## Results

| Supplier | Status | Deficiency Codes |
|----------|--------|-----------------|
| <name> | Compliant | — |
| <name> | Non-Compliant | CERT-EXPIRED, AUDIT-OPEN-FINDING |
...
```

Sort suppliers alphabetically. Do not modify any existing document content — only move misfiled documents, add comments on non-compliant suppliers, and create the results document.
