# Medtech Quality Dossier Policy

Use the three CSV files in `customs_data/`:

- `medical_ultrasound.csv`
- `medical_xray_ct_24.csv`
- `medical_xray_ct_25.csv`

The roster below is the candidate pool. Ignore every supplier that is not listed in the roster, even if it meets a numeric threshold. Aggregate by exact `supplier`. Use only `amount_usd` for USD exposure. For every row, define its effective market as `destination_country`; if `destination_country` is blank, use `buyer_country`. Count unique effective market values as destination count and unique `hs_code` values as HS count.

`Top Market` and `Top HS code` mean the most frequent value by shipment count within that supplier's included rows. If there is a tie, use the tied value with larger summed `amount_usd`, then lexical order.

Roster and owner mapping:

| Supplier | Owner |
|---|---|
| MR GLOBAL HK LIMITED | Mina Chen |
| GE HUALUN MEDICAL SYSTEMS CO LTD | Oscar Li |
| CARESTREAM HEALTH HK HOLDING LTD | Priya Raman |
| CHISON MEDICAL TECHNOLOGIES CO LTD | Ethan Zhou |
| SHANGHAI CHANNELMED IMPORT & EXPORT CO LTD | Lena Ortiz |
| SONOSCAPE MEDICAL CORP | Noah Wang |
| SHENZHEN BROWINER TECH CO LTD | Sara Kim |
| SIEMENS HEALTHINEERS AG | Victor Lin |
| FUJIFILM CORPORATION | Ava Patel |
| PHILIPS ELECTRONICS SINGAPORE PTE LTD | Hugo Martinez |
| NANJING PERLOVE MEDICAL EQUIPMENT CO LTD | Ivy Tan |
| EDAN INSTRUMENTS INC | Caleb Wu |
| SHENZHEN LANMAGE MEDICAL TECHNOLOGY CO LTD | Nora Singh |
| BEIJING WANDONG MEDICAL TECHNOLOGY CO LTD | Felix Gao |
| BEIJING GE HUALUN MEDICAL EQUIPMENT CO LTD | Olivia Reyes |
| SHENZHEN ANGELL TECHNOLOGY CO LTD | Marcus Shen |
| SIEMENS HEALTHINEERS INTERNATIONAL AG | Tara Ahmed |
| NEUSOFT MEDICAL SYSTEMS CO LTD | Leo Huang |
| SHENZHEN SONTU MEDICAL IMAGING EQUIPMENT CO LTD | Grace Park |

Severity:

- `Critical`: total USD is at least `10000000`, or destination count is at least `10`, or shipment count is at least `120`.
- `High`: total USD is at least `2000000`, or shipment count is at least `40`.
- Exclude suppliers below `High`.

Deliverables:

1. In Google Workspace, use `sheet-supplier-eval-003`, rename it to `Medtech Quality Dossier Control - 2026-Q2`, and create two sheets:
   - `Medtech Quality Control`
   - `Medtech Trace Map`
2. `Medtech Quality Control` headers must be:
   `Supplier, Severity, Shipments, Total USD, Destination Count, HS Count, Top Market, Owner, Jira Task Key, DWS Report ID`
   Rows must be ordered by total shipments, descending (highest shipment count first).
3. In Google Workspace, use presentation `pres-launch-101`, rename it to `Medtech Quality Dossier Control Brief - 2026-Q2`, and add a concise executive brief slide that states the included supplier count, Critical count, High count, and the Epic summary.
4. Create one Jira Epic in project `PROJ` named `Medtech Export Quality Dossier - 2026-Q2`.
5. Create one Jira Task per included supplier. Use summary `[<Severity>] <Supplier> quality dossier`, label `medtech-quality`, plus `severity-critical` or `severity-high`, move it to `In Progress`, and link it to the Epic with `relates to`, set priority to `Highest` for Critical and `High` for High.
6. Add a Jira comment to every supplier task containing: supplier, shipment count, total USD, destination count, HS count, top market, and the DWS report id.
7. In DWS, create folder `Medtech Quality Dossiers - 2026-Q2` and one document per included supplier named `[<Severity>] <Supplier> Quality Dossier`.
8. Upload all three source CSV files into DWS and export at least the Critical supplier dossier with the largest total USD.
9. Each DWS document must include supplier, severity, owner, shipment count, total USD, destination count, HS count, top market, top HS code, and the Jira task key. Also add a paragraph block containing `Trace Summary: <Supplier> / <Jira Task Key> / <Total USD>`; in that block, render `<Total USD>` as the plain computed number with no thousands separators or currency symbol (e.g. 654820.0). Add a comment `QA review needed: <Supplier> -> <Jira Task Key>` and grant `qa-reviewer@example.com` editor access.
10. Fill `Medtech Trace Map` with headers:
   `Supplier, Jira Task Key, DWS Report ID, Severity, Owner, Total USD`
   Rows must be ordered by total shipments, descending (highest shipment count first).

Do not create rows or Jira/DWS records for excluded suppliers.
