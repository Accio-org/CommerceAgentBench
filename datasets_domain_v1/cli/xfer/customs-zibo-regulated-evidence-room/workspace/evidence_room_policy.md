# Zibo Regulated Evidence Room Policy

Use `customs_data/zibo_us_exports.csv`.

The roster below is the only candidate pool. Ignore every supplier that is not listed here, even if it looks regulated. Aggregate rows by exact `supplier`. Use only `amount_usd` for USD exposure. For each row, the effective market is `destination_country`; if that is blank, use `buyer_country`.

`Top Market` and `Top HS` mean the most frequent value by shipment count within that supplier's included rows. If tied, use the tied value with larger summed `amount_usd`, then lexical order.
`HS Count` (per supplier) and `Distinct HS Count` (per category) both mean the number of distinct non-blank `hs_code` values; ignore blank `hs_code` values.

| Supplier | Category | Owner |
|---|---|---|
| ZIBO FEIYUAN CHEMICAL CO LTD | Chemical | Mina Chen |
| ZIBO HAIZHENG CHEM CO LTD | Chemical | Oscar Li |
| ZIBO RHEMA INTERNATIONAL INC | Chemical | Priya Raman |
| ZIBO DINGTIAN PLASTICS CO LTD | Polymer | Ethan Zhou |
| ZIBO QRAY INTERNATIONAL CO LTD | Medical | Lena Ortiz |
| ZIBO SANKYO RIKAGAKU CO LTD | Abrasive | Noah Wang |
| ZIBO SISHA TAIYI GRINDING WHEEL CO LTD | Abrasive | Sara Kim |
| ZIBO OU MU SPECIAL PAPER CO LTD | Paper | Victor Lin |
| ZIBO OUMU SPECIAL PAPER CO LTD | Paper | Ava Patel |
| ZIBO HENGXIANG ENTERPRISE CO LTD | Industrial | Hugo Martinez |
| ZIBO BIG SHOPKEEPER AUTOMOBILE SALES CO LTD | Vehicle | Ivy Tan |
| ZIBO HANGXING INDUSTRIAL CO LTD | Glass | Caleb Wu |

Severity:

- `Critical`: category is Chemical.
- `High`: not Critical, and total USD is at least `500000` or shipment count is at least `45`.
- `Elevated`: not Critical or High, and total USD is at least `25000` or shipment count is at least `15`.
- Exclude anything below Elevated.

Deliverables:

1. Google Workspace spreadsheet `sheet-supplier-eval-003`:
   - Rename it to `Zibo Regulated Evidence Control - 2026-Q2`.
   - Create sheets `Evidence Control`, `Trace Matrix`, and `HS Review Summary`.
   - `Evidence Control` headers: `Supplier, Category, Severity, Shipments, Total USD, Market Count, HS Count, Top Market, Top HS, Jira Task Key, Box Folder ID, DWS Dossier ID`.
   - `Trace Matrix` headers: `Supplier, Jira Task Key, Box Folder ID, Box File ID, DWS Dossier ID, Severity, Owner`.
   - `HS Review Summary` headers: `Category, Supplier Count, Shipments, Total USD, Distinct HS Count`. One row per category.
2. Google Workspace presentation `pres-launch-101`:
   - Rename it to `Zibo Regulated Evidence Brief - 2026-Q2`.
   - Add a briefing slide containing included supplier count, Critical/High/Elevated counts, and the Jira Epic summary.
3. Jira project `PROJ`:
   - Create exactly one Epic named `Zibo Regulated Export Evidence Room - 2026-Q2`.
   - Create one Task per included supplier. Summary: `[<Severity>] <Supplier> evidence review`.
   - Labels: `zibo-evidence`, plus `severity-critical`, `severity-high`, or `severity-elevated`.
   - Priority: Critical -> `Highest`, High -> `High`, Elevated -> `Medium`.
   - Move every Task to `In Progress`, link it to the Epic with `relates to`, and add a comment containing supplier, total USD, top HS, Box folder id, Box file id, and DWS dossier id.
4. Box:
   - Create root folder `Zibo Regulated Evidence Room - 2026-Q2`.
   - Create one supplier subfolder named `<Supplier> - Evidence`.
   - Upload one markdown evidence summary per supplier into that subfolder. File name: `evidence_summary_<lowercase supplier with non-alphanumeric collapsed to underscores>.md`.
   - Add a Box comment to every uploaded file containing the Jira task key and DWS dossier id.
   - Add viewer collaboration for user id `10003` on every supplier folder.
   - Add a Box review task on every uploaded evidence summary.
5. DWS:
   - Create folder `Zibo Regulated Dossiers - 2026-Q2`.
   - Create one dossier per included supplier named `[<Severity>] <Supplier> Evidence Dossier`.
   - Each dossier must include supplier, category, severity, owner, shipment count, total USD, market count, HS count, top market, top HS, Jira task key, Box folder id, and Box file id.
   - Add a paragraph block exactly containing `Trace Summary: <Supplier> / <Jira Task Key> / <Box Folder ID> / <Total USD>`. In that block, render `<Total USD>` as the plain computed number with no thousands separators or currency symbol (e.g. 654820.0).
   - Add comment `Compliance review needed: <Supplier> -> <Jira Task Key>`.
   - Grant `compliance-reviewer@example.com` editor access to every dossier.
   - Upload `zibo_us_exports.csv` into DWS and export at least one Critical dossier.

Do not create final records for out-of-scope suppliers.
