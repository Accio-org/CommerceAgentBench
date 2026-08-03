# NorthBridge Accessories — Supplier Document-Room Compliance Policy

**Audit date:** 2026-05-30

NorthBridge Accessories keeps every supplier's onboarding documents in Box under
the top-level **`Suppliers/`** folder — one sub-folder per supplier. Quality &
Compliance runs a periodic audit of this document room. This policy defines the
standard each supplier must meet and what to record for each.

## 1. What every supplier must have on file

A supplier folder is **compliant** only if it holds, current as of the audit
date, all three of the following, each belonging to that supplier:

1. A **Business License**.
2. An **ISO 9001 (quality-management-system)** certificate that (a) is current,
   (b) was issued to this supplier's own legal entity, and (c) whose **scope of
   certification covers the product line NorthBridge sources from that supplier**
   (see §4).
3. A **Factory Audit Report**.

A supplier that is missing any of the three — or whose ISO 9001 certificate is not
current, was not issued to this supplier, or whose scope does not cover that
supplier's product line — is **non-compliant**.

## 2. Identifying which supplier a document belongs to

Each document's name encodes its type and the supplier it is for, for example
`BusinessLicense_<Token>.pdf`, `ISO9001_<Token>_exp<YYYY-MM-DD>.pdf`,
`FactoryAudit_<Token>_<YYYY>.pdf`. `<Token>` is the supplier's name with the
spaces removed; `workspace/supplier_directory.csv` lists the token, city and the
**product line** for each folder. A document's name and folder location are labels
for convenience — they are not, by themselves, proof of which entity a certificate
was issued to or of what its scope covers (see §4).

Keeping the room correctly filed is part of the audit: every document belongs in
the folder of the supplier it is for. If a document is sitting in a folder it does
not belong to, move it into the folder it belongs to. Assess each supplier on the
documents that belong to it once the room is in order.

## 3. Certificate currency

A certificate is **current** if its expiry date is **on or after** the audit date
(2026-05-30); a certificate whose expiry date is exactly 2026-05-30 is still current.
A certificate whose expiry date is before 2026-05-30 is not current and does not
count.

## 4. A certificate must be the supplier's own — and cover its product line

A supplier is a registered legal entity. Its identity of record is the legal name
and the **Unified Social Credit Code (USCC)** shown on its Business License. The
**product line** NorthBridge sources from each supplier is listed in
`workspace/supplier_directory.csv`. An ISO 9001 certificate satisfies the
requirement for a supplier only if **both**:

- it was issued to that same legal entity — that is, the **USCC printed on the
  certificate matches the USCC on the supplier's Business License**; and
- its **scope of certification covers that supplier's product line** — i.e. the
  products NorthBridge sources from the supplier fall within the activities the
  certificate certifies.

A certificate states its **scope of certification** in its own words (the
products, materials and/or processes it certifies). Read that scope and judge
whether it covers the supplier's product line: a certificate that certifies a
**different product class, a different manufacturing process, or a different point
in the supply chain** does not cover the product line even if it shares some words
with it; and a certificate written in **broader category terms** covers the
product line when the sourced products clearly fall within that category. The
certificate's printed organization name and its file name/location are not, by
themselves, proof of the entity it was issued to or of what its scope covers —
confirm against the **USCC** and the **scope of certification** recorded inside
the document.

Read the document itself to confirm the issuing entity and the scope: you can save
a document's contents with `box files:download` and then open the saved file. The
legal name, USCC and scope of certification are recorded inside each certificate;
the Business License records the legal name and USCC.

## 5. What to record for each supplier

Once the room is correctly filed, classify each supplier folder under
`Suppliers/`, then record the outcome in Box. **These Box changes are the record
of the audit** — there is no separate write-up to produce.

- **Non-compliant supplier** — do BOTH:
  1. Create a **Box task** on **one of the documents inside that supplier's
     folder**, with `--due-at "2026-06-06T17:00:00Z"`. The task message must include every
     deficiency code that applies:
     - `BL-MISSING` — no Business License belonging to the supplier is on file.
     - `ISO-MISSING` — no ISO 9001 certificate belonging to the supplier is on file.
     - `ISO-EXPIRED` — the supplier's own ISO 9001 certificate is not current.
     - `ISO-WRONG-ENTITY` — the current ISO 9001 certificate was issued to a
       different legal entity/USCC.
     - `ISO-SCOPE` — the current ISO 9001 certificate's scope does not cover the
       sourced product line.
     - `AUDIT-MISSING` — no Factory Audit Report belonging to the supplier is on file.
     (Box tasks attach to a file, not a folder — pick any document in the folder.)
  2. Add **`qa-review@northbridge.example.com`** as a collaborator on that supplier's **folder** with the
     role **`viewer`**.
- **Compliant supplier** — create a **shared link** on that supplier's **folder**
  (so QA can review it). Do **not** create a task or a collaboration on a
  compliant supplier.

Do not add shared links to non-compliant folders, and do not create tasks or
collaborations on compliant folders. Leave any document that belongs to no
supplier folder where it is.
