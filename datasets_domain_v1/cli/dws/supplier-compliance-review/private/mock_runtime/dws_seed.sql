-- Seed for dws-supplier-compliance-review (CLI-difficulty enhanced)
-- 24 suppliers + misfiled certs + duplicates + sub-folders + noise

DELETE FROM comment_replies;
DELETE FROM comments;
DELETE FROM blocks;
DELETE FROM documents;
DELETE FROM mock_config;

INSERT INTO mock_config (key, value) VALUES
  ('defaultWorkspaceId', 'ws-nb-qc'),
  ('defaultFolderId', 'fold-root'),
  ('mockUserId', 'uid-qcops'),
  ('mockUserName', 'QC Ops'),
  ('mockCorpId', 'corp-northbridge'),
  ('mockCorpName', 'NorthBridge Accessories');

INSERT OR IGNORE INTO documents (nodeId, name, type, extension, createTime, lastEditTime, creatorUid, parentId, workspaceId, content) VALUES
  ('fold-root', 'NorthBridge QC Knowledge Base', 'folder', 'folder', 1746316800000, 1746316800000, 'uid-qcops', NULL, 'ws-nb-qc', ''),
  ('fold-suppliers', 'Suppliers', 'folder', 'folder', 1746320400000, 1746320400000, 'uid-qcops', 'fold-root', 'ws-nb-qc', ''),
  ('fold-archive', 'Archive — Prior Quarters', 'folder', 'folder', 1746324000000, 1746324000000, 'uid-qcops', 'fold-root', 'ws-nb-qc', ''),
  ('fold-templates', 'Templates', 'folder', 'folder', 1746327600000, 1746327600000, 'uid-qcops', 'fold-root', 'ws-nb-qc', ''),
  ('fold-pending', 'Pending Review', 'folder', 'folder', 1746331200000, 1746331200000, 'uid-qcops', 'fold-root', 'ws-nb-qc', ''),
  ('doc-template-cert', 'ISO 9001 Certificate Template', 'file', 'adoc', 1746334800000, 1746334800000, 'uid-qcops', 'fold-templates', 'ws-nb-qc', '# ISO 9001 Certificate Template

[TEMPLATE — do not use for compliance assessment]

Organization: ___
USCC: ___
Scope: ___
Expiry: ___'),
  ('doc-archive-q4', 'Q4 2025 Compliance Review Results', 'file', 'adoc', 1746338400000, 1746338400000, 'uid-qcops', 'fold-archive', 'ws-nb-qc', '# Q4 2025 Compliance Review Results

Reviewed 24 suppliers. 18 compliant, 6 non-compliant.

This report is from Q4 2025 and should not be referenced for current quarter.'),
  ('doc-archive-q3', 'Q3 2025 Compliance Review Results', 'file', 'adoc', 1746342000000, 1746342000000, 'uid-qcops', 'fold-archive', 'ws-nb-qc', '# Q3 2025 Compliance Review Results

Reviewed 22 suppliers. 15 compliant, 7 non-compliant.'),
  ('doc-pending-memo', 'Compliance Process Update Memo', 'file', 'adoc', 1746345600000, 1746345600000, 'uid-qcops', 'fold-pending', 'ws-nb-qc', '# Compliance Process Update

Effective Q2 2026: all certificate scope evaluations must consider the product line sourced, not just the organization name.

Signed: QC Director'),
  ('fold-s00', 'Apex Plastics', 'folder', 'folder', 1746388800000, 1746388800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('fold-s00-certs', 'Certificates', 'folder', 'folder', 1746388800000, 1746388800000, 'uid-qcops', 'fold-s00', 'ws-nb-qc', ''),
  ('s00-spec', 'Apex Plastics Product Specification', 'file', 'adoc', 1746392400000, 1746392400000, 'uid-qcops', 'fold-s00', 'ws-nb-qc', '# Apex Plastics — Product Specification

## Company Information
Legal Name: Apex Plastics Co., Ltd.
USCC: 914403000MA5D00KL00XY
City: Shenzhen
Product Line: Pet Supplies & Accessories

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-AU-PRE-020 | Vector Prescription Dog Food AU 020 | 9501001583802 | 6.1 | 10.4 | 4.1 |
| NB-AU-PET-044 | Vector Pet Biometric Monitors AU 044 | 9501003484367 | 38.1 | 21.3 | 13.5 |
| NB-AU-PET-068 | Vector Pet Waste Disposal Systems and Tools AU 068 | 9501005384924 | 8.9 | 14.4 | 1.4 |
| NB-AU-BIR-092 | Vector Bird Cage Food and Water Dishes AU 092 | 9501007285489 | 14.8 | 16.6 | 1.4 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s00-cert', 'Apex Plastics ISO 9001 Certificate', 'file', 'adoc', 1746396000000, 1746396000000, 'uid-qcops', 'fold-s00-certs', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-APEXPL-2025-4257
Issuing Authority: SGS

## Certified Organization
Organization Name: Apex Plastics Co., Ltd.
Unified Social Credit Code (USCC): 914403000MA5D00KL00XY
Registered Address: Building 18, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of pet supplies & accessories

## Validity
Issue Date: 2026-11-04
Expiry Date: 2027-11-04
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-08
Next Scheduled Audit: 2026-10-19'),
  ('s00-audit', 'Apex Plastics Prior Audit Note', 'file', 'adoc', 1746399600000, 1746399600000, 'uid-qcops', 'fold-s00', 'ws-nb-qc', '# Apex Plastics — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s01', 'Atlas Packaging', 'folder', 'folder', 1746406800000, 1746406800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s01-spec', 'Atlas Packaging Product Specification', 'file', 'adoc', 1746410400000, 1746410400000, 'uid-qcops', 'fold-s01', 'ws-nb-qc', '# Atlas Packaging — Product Specification

## Company Information
Legal Name: Atlas Packaging Co., Ltd.
USCC: 914403001MA5D01KL01XY
City: Shenzhen
Product Line: Consumer Electronics Accessories

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-MX-PRE-011 | River Prescription Cat Food MX 011 | 9501000871092 | 44.1 | 23.5 | 3.2 |
| NB-MX-STU-035 | River Stuffed Toys and Plushies MX 035 | 9501002771659 | 24.0 | 10.5 | 4.0 |
| NB-MX-DOG-059 | River Dog Kennel and Run Accessories MX 059 | 9501004672213 | 39.4 | 5.8 | 6.3 |
| NB-MX-NON-083 | River Non-Prescription Dog Food MX 083 | 9501006572771 | 21.2 | 12.3 | 4.7 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s01-cert', 'Atlas Packaging ISO 9001 Certificate', 'file', 'adoc', 1746414000000, 1746414000000, 'uid-qcops', 'fold-s01', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-ATLASP-2025-1711
Issuing Authority: TUV Rheinland

## Certified Organization
Organization Name: Atlas Packaging Co., Ltd.
Unified Social Credit Code (USCC): 914403001MA5D01KL01XY
Registered Address: Building 15, Industrial Zone A, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of consumer electronics accessories

## Validity
Issue Date: 2026-05-26
Expiry Date: 2027-05-26
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-13
Next Scheduled Audit: 2026-07-18'),
  ('s01-audit', 'Atlas Packaging Prior Audit Note', 'file', 'adoc', 1746417600000, 1746417600000, 'uid-qcops', 'fold-s01', 'ws-nb-qc', '# Atlas Packaging — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('s01-noise', 'Internal Meeting Notes — 2026-04-10', 'file', 'adoc', 1746421200000, 1746421200000, 'uid-qcops', 'fold-s01', 'ws-nb-qc', '# Internal Meeting Notes

Discussed production timeline for Q3.
No action items for compliance.

Attendees: Zhang Wei, Li Ming'),
  ('fold-s02', 'Bluewave Outdoor', 'folder', 'folder', 1746424800000, 1746424800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s02-spec', 'Bluewave Outdoor Product Specification', 'file', 'adoc', 1746428400000, 1746428400000, 'uid-qcops', 'fold-s02', 'ws-nb-qc', '# Bluewave Outdoor — Product Specification

## Company Information
Legal Name: Bluewave Outdoor Co., Ltd.
USCC: 914403002MA5D02KL02XY
City: Shenzhen
Product Line: Home & Kitchen Products

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-JP-BIR-009 | Willow Bird Cages and Stands JP 009 | 9501000712715 | 33.3 | 26.9 | 6.1 |
| NB-JP-OUT-033 | Willow Outdoor Cat Houses JP 033 | 9501002613270 | 13.7 | 4.9 | 10.3 |
| NB-JP-CAT-057 | Willow Cat Treats JP 057 | 9501004513837 | 39.8 | 29.6 | 13.0 |
| NB-JP-DOG-081 | Willow Dog Toys JP 081 | 9501006414392 | 44.0 | 13.3 | 7.3 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s02-cert', 'Bluewave Outdoor ISO 9001 Certificate', 'file', 'adoc', 1746432000000, 1746432000000, 'uid-qcops', 'fold-s02', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-BLUEWA-2025-6977
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Bluewave Outdoor Co., Ltd.
Unified Social Credit Code (USCC): 914403002MA5D02KL02XY
Registered Address: Building 6, Industrial Zone C, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of home & kitchen products

## Validity
Issue Date: 2026-05-27
Expiry Date: 2027-05-27
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-12
Next Scheduled Audit: 2026-08-22'),
  ('s02-cert-old', 'Bluewave Outdoor ISO 9001 Certificate (2024)', 'file', 'adoc', 1745704800000, 1745704800000, 'uid-qcops', 'fold-s02', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-BLUEWA-2025-2169
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Bluewave Outdoor Co., Ltd.
Unified Social Credit Code (USCC): 914403002MA5D02KL02XY
Registered Address: Building 20, Industrial Zone B, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of home & kitchen products

## Validity
Issue Date: 2024-03-23
Expiry Date: 2025-03-23
Status: Expired

## Audit Details
Last Surveillance Audit: 2025-11-18
Next Scheduled Audit: 2026-12-08'),
  ('s02-audit', 'Bluewave Outdoor Prior Audit Note', 'file', 'adoc', 1746435600000, 1746435600000, 'uid-qcops', 'fold-s02', 'ws-nb-qc', '# Bluewave Outdoor — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s03', 'BrightHome Manufacturing', 'folder', 'folder', 1746442800000, 1746442800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s03-spec', 'BrightHome Manufacturing Product Specification', 'file', 'adoc', 1746446400000, 1746446400000, 'uid-qcops', 'fold-s03', 'ws-nb-qc', '# BrightHome Manufacturing — Product Specification

## Company Information
Legal Name: BrightHome Manufacturing Co., Ltd.
USCC: 914403003MA5D03KL03XY
City: Shenzhen
Product Line: Sports & Outdoor Equipment

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-MX-NON-019 | Summit Non-Prescription Dog Food MX 019 | 9501001504616 | 22.1 | 29.7 | 10.0 |
| NB-MX-DOG-043 | Summit Dog Supplies MX 043 | 9501003405171 | 30.1 | 21.5 | 12.8 |
| NB-MX-PET-067 | Summit Pet Heating Pad Accessories MX 067 | 9501005305738 | 39.9 | 9.2 | 1.4 |
| NB-MX-BIR-091 | Summit Bird Cage Bird Baths MX 091 | 9501007206293 | 19.2 | 10.2 | 4.0 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s03-cert', 'BrightHome Manufacturing ISO 9001 Certificate', 'file', 'adoc', 1746450000000, 1746450000000, 'uid-qcops', 'fold-s07', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-BRIGHT-2025-6155
Issuing Authority: SGS

## Certified Organization
Organization Name: BrightHome Manufacturing Co., Ltd.
Unified Social Credit Code (USCC): 914403003MA5D03KL03XY
Registered Address: Building 7, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of sports & outdoor equipment

## Validity
Issue Date: 2026-03-15
Expiry Date: 2027-03-15
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-13
Next Scheduled Audit: 2026-12-15'),
  ('s03-audit', 'BrightHome Manufacturing Prior Audit Note', 'file', 'adoc', 1746453600000, 1746453600000, 'uid-qcops', 'fold-s03', 'ws-nb-qc', '# BrightHome Manufacturing — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('s03-noise', 'Shipping Quote Comparison', 'file', 'adoc', 1746457200000, 1746457200000, 'uid-qcops', 'fold-s03', 'ws-nb-qc', '# Shipping Quote Comparison

| Carrier | Rate (USD/kg) | Transit Days |
|---------|--------------|-------------|
| DHL | 4.50 | 5 |
| FedEx | 4.20 | 7 |
| SF Express | 3.80 | 10 |

Pending procurement decision.'),
  ('fold-s04', 'Cedar Baby Goods', 'folder', 'folder', 1746460800000, 1746460800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('fold-s04-certs', 'Certificates', 'folder', 'folder', 1746460800000, 1746460800000, 'uid-qcops', 'fold-s04', 'ws-nb-qc', ''),
  ('s04-spec', 'Cedar Baby Goods Product Specification', 'file', 'adoc', 1746464400000, 1746464400000, 'uid-qcops', 'fold-s04', 'ws-nb-qc', '# Cedar Baby Goods — Product Specification

## Company Information
Legal Name: Cedar Baby Goods Co., Ltd.
USCC: 914403004MA5D04KL04XY
City: Shenzhen
Product Line: Baby & Toddler Products

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-UK-BIR-007 | Summit Bird Cage Food Dishes UK 007 | 9501000554339 | 11.3 | 23.1 | 8.5 |
| NB-UK-PUZ-031 | Summit Puzzles and Interactive Toys UK 031 | 9501002454897 | 38.6 | 14.6 | 9.2 |
| NB-UK-OUT-055 | Summit Outdoor Cat Houses UK 055 | 9501004355451 | 21.3 | 29.9 | 2.9 |
| NB-UK-DOG-079 | Summit Dog Diaper Pads and Liners UK 079 | 9501006256015 | 27.2 | 23.4 | 13.1 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s04-cert', 'Cedar Baby Goods ISO 9001 Certificate', 'file', 'adoc', 1746468000000, 1746468000000, 'uid-qcops', 'fold-s04-certs', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-CEDARB-2025-3504
Issuing Authority: TUV Rheinland

## Certified Organization
Organization Name: Cedar Baby Goods Co., Ltd.
Unified Social Credit Code (USCC): 914403004MA5D04KL04XY
Registered Address: Building 6, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of baby & toddler products

## Validity
Issue Date: 2026-03-09
Expiry Date: 2027-03-09
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-20
Next Scheduled Audit: 2026-07-13'),
  ('s04-audit', 'Cedar Baby Goods Prior Audit Note', 'file', 'adoc', 1746471600000, 1746471600000, 'uid-qcops', 'fold-s04', 'ws-nb-qc', '# Cedar Baby Goods — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s05', 'Eastern Carton', 'folder', 'folder', 1746478800000, 1746478800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s05-spec', 'Eastern Carton Product Specification', 'file', 'adoc', 1746482400000, 1746482400000, 'uid-qcops', 'fold-s05', 'ws-nb-qc', '# Eastern Carton — Product Specification

## Company Information
Legal Name: Eastern Carton Co., Ltd.
USCC: 914403005MA5D05KL05XY
City: Shenzhen
Product Line: Personal Care & Beauty

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-US-FIS-022 | Atlas Fish and Aquatic Supplies US 022 | 9501001742186 | 49.8 | 17.3 | 14.6 |
| NB-US-PET-046 | Atlas Pet Medical Collars US 046 | 9501003642743 | 43.7 | 3.3 | 11.1 |
| NB-US-BIR-070 | Atlas Bird Cage Food and Water Dishes US 070 | 9501005543307 | 35.7 | 17.5 | 4.7 |
| NB-US-COM-094 | Atlas Combined Bird Cage Food and Water Dishes US 094 | 9501007443865 | 33.8 | 6.0 | 7.1 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s05-cert', 'Eastern Carton ISO 9001 Certificate', 'file', 'adoc', 1746486000000, 1746486000000, 'uid-qcops', 'fold-s05', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-EASTER-2025-8433
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Eastern Carton Co., Ltd.
Unified Social Credit Code (USCC): 914403005MA5D05KL05XY
Registered Address: Building 1, Industrial Zone C, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of personal care & beauty

## Validity
Issue Date: 2026-07-20
Expiry Date: 2027-07-20
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-17
Next Scheduled Audit: 2026-08-17'),
  ('s05-cert-old', 'Eastern Carton ISO 9001 Certificate (2024)', 'file', 'adoc', 1745758800000, 1745758800000, 'uid-qcops', 'fold-s05', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-EASTER-2025-5889
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Eastern Carton Co., Ltd.
Unified Social Credit Code (USCC): 914403005MA5D05KL05XY
Registered Address: Building 17, Industrial Zone B, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of personal care & beauty

## Validity
Issue Date: 2024-01-28
Expiry Date: 2025-01-28
Status: Expired

## Audit Details
Last Surveillance Audit: 2025-11-05
Next Scheduled Audit: 2026-09-25'),
  ('s05-audit', 'Eastern Carton Prior Audit Note', 'file', 'adoc', 1746489600000, 1746489600000, 'uid-qcops', 'fold-s05', 'ws-nb-qc', '# Eastern Carton — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('s05-noise', 'DRAFT — New Product Proposal', 'file', 'adoc', 1746493200000, 1746493200000, 'uid-qcops', 'fold-s05', 'ws-nb-qc', '# DRAFT — New Product Proposal

[DRAFT — not finalized]

Proposed SKU: NB-XX-NEW-001
Category: TBD
Target price: $15.00
Status: Under review'),
  ('fold-s06', 'EverMold', 'folder', 'folder', 1746496800000, 1746496800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s06-spec', 'EverMold Product Specification', 'file', 'adoc', 1746500400000, 1746500400000, 'uid-qcops', 'fold-s06', 'ws-nb-qc', '# EverMold — Product Specification

## Company Information
Legal Name: EverMold Co., Ltd.
USCC: 914403006MA5D06KL06XY
City: Shenzhen
Product Line: Office Supplies

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-AU-PET-004 | Meridian Pet Waste Disposal Systems and Tools AU 004 | 9501000316760 | 47.9 | 27.9 | 13.9 |
| NB-AU-BIR-028 | Meridian Bird Cage Food and Water Dishes AU 028 | 9501002217324 | 32.0 | 16.2 | 2.6 |
| NB-AU-SWI-052 | Meridian Swings and Perches AU 052 | 9501004117882 | 21.3 | 29.6 | 12.3 |
| NB-AU-CAT-076 | Meridian Cat Steps and Ramps AU 076 | 9501006018446 | 15.8 | 9.5 | 8.9 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s06-cert', 'EverMold ISO 9001 Certificate', 'file', 'adoc', 1746504000000, 1746504000000, 'uid-qcops', 'fold-s01', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-EVERMO-2025-2290
Issuing Authority: SGS

## Certified Organization
Organization Name: EverMold Co., Ltd.
Unified Social Credit Code (USCC): 914403006MA5D06KL06XY
Registered Address: Building 3, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of office supplies

## Validity
Issue Date: 2026-03-18
Expiry Date: 2027-03-18
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-27
Next Scheduled Audit: 2026-07-25'),
  ('s06-audit', 'EverMold Prior Audit Note', 'file', 'adoc', 1746507600000, 1746507600000, 'uid-qcops', 'fold-s06', 'ws-nb-qc', '# EverMold — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s07', 'GoldRiver Packaging', 'folder', 'folder', 1746514800000, 1746514800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('fold-s07-certs', 'Certificates', 'folder', 'folder', 1746514800000, 1746514800000, 'uid-qcops', 'fold-s07', 'ws-nb-qc', ''),
  ('s07-spec', 'GoldRiver Packaging Product Specification', 'file', 'adoc', 1746518400000, 1746518400000, 'uid-qcops', 'fold-s07', 'ws-nb-qc', '# GoldRiver Packaging — Product Specification

## Company Information
Legal Name: GoldRiver Packaging Co., Ltd.
USCC: 914403007MA5D07KL07XY
City: Shenzhen
Product Line: Automotive Parts & Accessories

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-UK-PET-023 | River Pet Carrier and Crate Accessories UK 023 | 9501001821379 | 10.7 | 20.8 | 14.3 |
| NB-UK-SMA-047 | River Small Animal Supplies UK 047 | 9501003721936 | 12.4 | 17.2 | 9.5 |
| NB-UK-BIR-071 | River Bird Cage Food Dishes UK 071 | 9501005622491 | 48.4 | 28.1 | 11.6 |
| NB-UK-PUZ-095 | River Puzzles and Interactive Toys UK 095 | 9501007523055 | 36.0 | 22.2 | 6.6 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s07-cert', 'GoldRiver Packaging ISO 9001 Certificate', 'file', 'adoc', 1746522000000, 1746522000000, 'uid-qcops', 'fold-s07-certs', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-GOLDRI-2025-7118
Issuing Authority: TUV Rheinland

## Certified Organization
Organization Name: GoldRiver Packaging Co., Ltd.
Unified Social Credit Code (USCC): 914403007MA5D07KL07XY
Registered Address: Building 15, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of automotive parts & accessories

## Validity
Issue Date: 2026-09-25
Expiry Date: 2027-09-25
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-04
Next Scheduled Audit: 2026-08-08'),
  ('s07-audit', 'GoldRiver Packaging Prior Audit Note', 'file', 'adoc', 1746525600000, 1746525600000, 'uid-qcops', 'fold-s07', 'ws-nb-qc', '# GoldRiver Packaging — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s08', 'Greenfield Tools', 'folder', 'folder', 1746532800000, 1746532800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s08-spec', 'Greenfield Tools Product Specification', 'file', 'adoc', 1746536400000, 1746536400000, 'uid-qcops', 'fold-s08', 'ws-nb-qc', '# Greenfield Tools — Product Specification

## Company Information
Legal Name: Greenfield Tools Co., Ltd.
USCC: 914403008MA5D08KL08XY
City: Shenzhen
Product Line: Garden & Outdoor Tools

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-JP-DOG-017 | Nova Dog Toys JP 017 | 9501001346230 | 5.9 | 18.0 | 9.2 |
| NB-JP-NON-041 | Nova Non-Prescription Dog Food JP 041 | 9501003246798 | 5.3 | 22.1 | 1.8 |
| NB-JP-PET-065 | Nova Pet Bed Accessories JP 065 | 9501005147352 | 8.0 | 3.8 | 5.6 |
| NB-JP-PET-089 | Nova Pet Sunscreen JP 089 | 9501007047919 | 28.1 | 10.5 | 7.8 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s08-cert', 'Greenfield Tools ISO 9001 Certificate', 'file', 'adoc', 1746540000000, 1746540000000, 'uid-qcops', 'fold-s15', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-GREENF-2025-9834
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Greenfield Tools Co., Ltd.
Unified Social Credit Code (USCC): 914403008MA5D08KL08XY
Registered Address: Building 5, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of garden & outdoor tools

## Validity
Issue Date: 2026-02-11
Expiry Date: 2027-02-11
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-08
Next Scheduled Audit: 2026-10-26'),
  ('s08-audit', 'Greenfield Tools Prior Audit Note', 'file', 'adoc', 1746543600000, 1746543600000, 'uid-qcops', 'fold-s08', 'ws-nb-qc', '# Greenfield Tools — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('s08-noise', 'Supplier Contact List', 'file', 'adoc', 1746547200000, 1746547200000, 'uid-qcops', 'fold-s08', 'ws-nb-qc', '# Supplier Contact List

Primary: sales@supplier.example.com
Quality: qa@supplier.example.com
Shipping: logistics@supplier.example.com'),
  ('fold-s09', 'Harbor Homeware', 'folder', 'folder', 1746550800000, 1746550800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s09-spec', 'Harbor Homeware Product Specification', 'file', 'adoc', 1746554400000, 1746554400000, 'uid-qcops', 'fold-s09', 'ws-nb-qc', '# Harbor Homeware — Product Specification

## Company Information
Legal Name: Harbor Homeware Co., Ltd.
USCC: 914403009MA5D09KL09XY
City: Shenzhen
Product Line: Lighting & Electrical

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-US-BIR-006 | Orchid Bird Cage Food and Water Dishes US 006 | 9501000475146 | 9.2 | 20.8 | 6.0 |
| NB-US-COM-030 | Orchid Combined Bird Cage Food and Water Dishes US 030 | 9501002375703 | 23.5 | 26.3 | 1.8 |
| NB-US-CAT-054 | Orchid Cat Steps and Ramps US 054 | 9501004276268 | 34.4 | 20.4 | 1.8 |
| NB-US-INT-078 | Orchid Interactive Toys US 078 | 9501006176825 | 37.8 | 24.6 | 2.5 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s09-cert', 'Harbor Homeware ISO 9001 Certificate', 'file', 'adoc', 1746558000000, 1746558000000, 'uid-qcops', 'fold-s09', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-HARBOR-2025-4139
Issuing Authority: SGS

## Certified Organization
Organization Name: Harbor Homeware Co., Ltd.
Unified Social Credit Code (USCC): 914403009MA5D09KL09XY
Registered Address: Building 7, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of lighting & electrical

## Validity
Issue Date: 2026-07-07
Expiry Date: 2027-07-07
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-05
Next Scheduled Audit: 2026-10-06'),
  ('s09-cert-old', 'Harbor Homeware ISO 9001 Certificate (2024)', 'file', 'adoc', 1745830800000, 1745830800000, 'uid-qcops', 'fold-s09', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-HARBOR-2025-5092
Issuing Authority: SGS

## Certified Organization
Organization Name: Harbor Homeware Co., Ltd.
Unified Social Credit Code (USCC): 914403009MA5D09KL09XY
Registered Address: Building 3, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of lighting & electrical

## Validity
Issue Date: 2024-03-15
Expiry Date: 2025-03-15
Status: Expired

## Audit Details
Last Surveillance Audit: 2025-11-26
Next Scheduled Audit: 2026-11-04'),
  ('s09-audit', 'Harbor Homeware Prior Audit Note', 'file', 'adoc', 1746561600000, 1746561600000, 'uid-qcops', 'fold-s09', 'ws-nb-qc', '# Harbor Homeware — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s10', 'LumenBattery', 'folder', 'folder', 1746568800000, 1746568800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s10-spec', 'LumenBattery Product Specification', 'file', 'adoc', 1746572400000, 1746572400000, 'uid-qcops', 'fold-s10', 'ws-nb-qc', '# LumenBattery — Product Specification

## Company Information
Legal Name: LumenBattery Co., Ltd.
USCC: 914403010MA5D10KL10XY
City: Shenzhen
Product Line: Packaging Materials

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-SG-DOG-021 | Willow Dog Kennels and Runs SG 021 | 9501001662996 | 50.0 | 25.6 | 14.6 |
| NB-SG-PET-045 | Willow Pet Door Accessories SG 045 | 9501003563550 | 46.7 | 25.9 | 3.3 |
| NB-SG-BIR-069 | Willow Bird Ladders and Perches SG 069 | 9501005464114 | 26.9 | 8.8 | 6.6 |
| NB-SG-COM-093 | Willow Combined Bird Cage Food and Water Dishes SG 093 | 9501007364672 | 7.6 | 13.2 | 14.8 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s10-cert', 'LumenBattery ISO 9001 Certificate', 'file', 'adoc', 1746576000000, 1746576000000, 'uid-qcops', 'fold-s10', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-LUMENB-2025-5345
Issuing Authority: TUV Rheinland

## Certified Organization
Organization Name: LumenBattery Co., Ltd.
Unified Social Credit Code (USCC): 914403010MA5D10KL10XY
Registered Address: Building 15, Industrial Zone C, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of packaging materials

## Validity
Issue Date: 2025-01-21
Expiry Date: 2026-01-21
Status: Expired

## Audit Details
Last Surveillance Audit: 2025-11-14
Next Scheduled Audit: 2026-12-24'),
  ('s10-audit', 'LumenBattery Prior Audit Note', 'file', 'adoc', 1746579600000, 1746579600000, 'uid-qcops', 'fold-s10', 'ws-nb-qc', '# LumenBattery — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('s10-noise', 'Payment Terms Memo', 'file', 'adoc', 1746583200000, 1746583200000, 'uid-qcops', 'fold-s10', 'ws-nb-qc', '# Payment Terms Memo

Standard: Net 30
New suppliers: Net 15 for first 3 orders
Bulk (>$50k): Net 45 with 2% early payment discount'),
  ('fold-s11', 'Meridian Supply', 'folder', 'folder', 1746586800000, 1746586800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s11-spec', 'Meridian Supply Product Specification', 'file', 'adoc', 1746590400000, 1746590400000, 'uid-qcops', 'fold-s11', 'ws-nb-qc', '# Meridian Supply — Product Specification

## Company Information
Legal Name: Meridian Supply Co., Ltd.
USCC: 914403011MA5D11KL11XY
City: Shenzhen
Product Line: Cable & Wiring Components

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-BR-DOG-018 | Orchid Dog Diaper Pads and Liners BR 018 | 9501001425423 | 37.3 | 7.2 | 5.2 |
| NB-BR-DOG-042 | Orchid Dog Kennel and Run Accessories BR 042 | 9501003325981 | 48.6 | 18.6 | 8.6 |
| NB-BR-PET-066 | Orchid Pet Containment Systems BR 066 | 9501005226545 | 38.7 | 4.5 | 9.2 |
| NB-BR-BIR-090 | Orchid Bird Cage Accessories BR 090 | 9501007127109 | 27.6 | 26.0 | 3.2 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s11-cert', 'Meridian Supply ISO 9001 Certificate', 'file', 'adoc', 1746594000000, 1746594000000, 'uid-qcops', 'fold-s11', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-MERIDI-2025-9320
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Meridian Supply Co., Ltd.
Unified Social Credit Code (USCC): 914403011MA5D11KL11XY
Registered Address: Building 3, Industrial Zone B, Shenzhen

## Scope of Certification
Design, development and production of industrial pumping systems

## Validity
Issue Date: 2026-09-22
Expiry Date: 2027-09-22
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-03
Next Scheduled Audit: 2026-11-03'),
  ('s11-audit', 'Meridian Supply Prior Audit Note', 'file', 'adoc', 1746597600000, 1746597600000, 'uid-qcops', 'fold-s11', 'ws-nb-qc', '# Meridian Supply — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s12', 'Nanshan Cable', 'folder', 'folder', 1746604800000, 1746604800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s12-spec', 'Nanshan Cable Product Specification', 'file', 'adoc', 1746608400000, 1746608400000, 'uid-qcops', 'fold-s12', 'ws-nb-qc', '# Nanshan Cable — Product Specification

## Company Information
Legal Name: Nanshan Cable Co., Ltd.
USCC: 914403012MA5D12KL12XY
City: Shenzhen
Product Line: Plastic Molded Components

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-DE-PET-024 | Aurora Pet Food Scoops DE 024 |  | 15.6 | 6.2 | 13.5 |
| NB-DE-BIR-048 | Aurora Bird Cage Accessories DE 048 |  | 16.1 | 19.1 | 9.7 |
| NB-DE-BIR-072 | Aurora Bird Cage Food Dishes DE 072 |  | 23.9 | 18.8 | 8.3 |
| NB-DE-CAT-096 | Aurora Cat Furniture Accessories DE 096 |  | 47.1 | 8.5 | 11.0 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s12-cert', 'Nanshan Cable ISO 9001 Certificate', 'file', 'adoc', 1746612000000, 1746612000000, 'uid-qcops', 'fold-s12', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-NANSHA-2025-4910
Issuing Authority: SGS

## Certified Organization
Organization Name: Nanshan Cable Holdings Group Co., Ltd.
Unified Social Credit Code (USCC): 91310115MA1H9LCE2X
Registered Address: Building 9, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of plastic molded components

## Validity
Issue Date: 2026-11-28
Expiry Date: 2027-11-28
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-05
Next Scheduled Audit: 2026-12-21'),
  ('s12-audit', 'Nanshan Cable Prior Audit Note', 'file', 'adoc', 1746615600000, 1746615600000, 'uid-qcops', 'fold-s12', 'ws-nb-qc', '# Nanshan Cable — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s13', 'Northstar Lighting', 'folder', 'folder', 1746622800000, 1746622800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('fold-s13-certs', 'Certificates', 'folder', 'folder', 1746622800000, 1746622800000, 'uid-qcops', 'fold-s13', 'ws-nb-qc', ''),
  ('s13-spec', 'Northstar Lighting Product Specification', 'file', 'adoc', 1746626400000, 1746626400000, 'uid-qcops', 'fold-s13', 'ws-nb-qc', '# Northstar Lighting — Product Specification

## Company Information
Legal Name: Northstar Lighting Co., Ltd.
USCC: 914403013MA5D13KL13XY
City: Shenzhen
Product Line: Metal Fabrication

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-DE-DOG-016 | Meridian Dog Houses DE 016 |  | 19.2 | 23.3 | 2.0 |
| NB-DE-DOG-040 | Meridian Dog Food DE 040 |  | 25.6 | 30.0 | 14.9 |
| NB-DE-LIV-064 | Meridian Live Animals DE 064 |  | 8.3 | 8.8 | 4.7 |
| NB-DE-PET-088 | Meridian Pet Food Scoops DE 088 |  | 47.0 | 26.8 | 13.3 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s13-cert', 'Northstar Lighting ISO 9001 Certificate', 'file', 'adoc', 1746630000000, 1746630000000, 'uid-qcops', 'fold-s13-certs', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-NORTHS-2025-7054
Issuing Authority: TUV Rheinland

## Certified Organization
Organization Name: Northstar Lighting Co., Ltd.
Unified Social Credit Code (USCC): 914403013MA5D13KL13XY
Registered Address: Building 10, Industrial Zone B, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of metal fabrication

## Validity
Issue Date: 2026-05-15
Expiry Date: 2027-05-15
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-15
Next Scheduled Audit: 2026-11-23'),
  ('s13-audit', 'Northstar Lighting Prior Audit Note', 'file', 'adoc', 1746633600000, 1746633600000, 'uid-qcops', 'fold-s13', 'ws-nb-qc', '# Northstar Lighting — Prior Audit Findings (Q1 2026)

Finding 1: Corrective action request — production floor humidity controls outside specification during March inspection
Status: Open — supplier acknowledged; corrective plan submitted 2026-04-15, implementation not yet verified

Finding 2: Minor labeling discrepancy on export cartons (wrong HS code printed)
Status: Closed — corrected in production batch 2026-03-22

Note: Finding 1 remains open pending on-site verification scheduled for Q2 2026.'),
  ('fold-s14', 'Nova Pet Products', 'folder', 'folder', 1746640800000, 1746640800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s14-spec', 'Nova Pet Products Product Specification', 'file', 'adoc', 1746644400000, 1746644400000, 'uid-qcops', 'fold-s14', 'ws-nb-qc', '# Nova Pet Products — Product Specification

## Company Information
Legal Name: Nova Pet Products Co., Ltd.
USCC: 914403014MA5D14KL14XY
City: Shenzhen
Product Line: Textile & Fabric Products

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-DE-BIR-008 | Vector Bird Cage Food Dishes DE 008 |  | 49.3 | 24.8 | 8.4 |
| NB-DE-CAT-032 | Vector Cat Furniture Accessories DE 032 |  | 35.1 | 18.0 | 14.0 |
| NB-DE-CAT-056 | Vector Catnip Toys DE 056 |  | 9.7 | 26.7 | 4.7 |
| NB-DE-DOG-080 | Vector Dog Houses DE 080 |  | 45.0 | 23.0 | 3.2 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s14-cert', 'Nova Pet Products ISO 9001 Certificate', 'file', 'adoc', 1746648000000, 1746648000000, 'uid-qcops', 'fold-s14', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-NOVAPE-2025-5616
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Nova Pet Products Co., Ltd.
Unified Social Credit Code (USCC): 914403014MA5D14KL14XY
Registered Address: Building 20, Industrial Zone B, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of textile & fabric products

## Validity
Issue Date: 2025-03-20
Expiry Date: 2026-03-20
Status: Expired

## Audit Details
Last Surveillance Audit: 2025-11-23
Next Scheduled Audit: 2026-09-07'),
  ('s14-audit', 'Nova Pet Products Prior Audit Note', 'file', 'adoc', 1746651600000, 1746651600000, 'uid-qcops', 'fold-s14', 'ws-nb-qc', '# Nova Pet Products — Prior Audit Findings (Q1 2026)

Finding 1: Corrective action request — production floor humidity controls outside specification during March inspection
Status: Open — supplier acknowledged; corrective plan submitted 2026-04-15, implementation not yet verified

Finding 2: Minor labeling discrepancy on export cartons (wrong HS code printed)
Status: Closed — corrected in production batch 2026-03-22

Note: Finding 1 remains open pending on-site verification scheduled for Q2 2026.'),
  ('s14-noise', 'Sample Tracking Sheet', 'file', 'adoc', 1746655200000, 1746655200000, 'uid-qcops', 'fold-s14', 'ws-nb-qc', '# Sample Tracking Sheet

| Sample ID | Date Sent | Date Received | Status |
|-----------|-----------|--------------|--------|
| SPL-001 | 2026-03-15 | 2026-03-22 | Approved |
| SPL-002 | 2026-04-01 | Pending | In transit |'),
  ('fold-s15', 'Orchid Beauty', 'folder', 'folder', 1746658800000, 1746658800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s15-spec', 'Orchid Beauty Product Specification', 'file', 'adoc', 1746662400000, 1746662400000, 'uid-qcops', 'fold-s15', 'ws-nb-qc', '# Orchid Beauty — Product Specification

## Company Information
Legal Name: Orchid Beauty Co., Ltd.
USCC: 914403015MA5D15KL15XY
City: Shenzhen
Product Line: Bath & Sanitary Products

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-AU-CAT-012 | Aurora Cat Steps and Ramps AU 012 | 9501000950285 | 43.4 | 16.6 | 4.5 |
| NB-AU-DOG-036 | Aurora Dog Supplies AU 036 | 9501002850842 | 45.9 | 4.4 | 9.9 |
| NB-AU-DOG-060 | Aurora Dog Treadmills AU 060 | 9501004751406 | 42.3 | 4.2 | 5.7 |
| NB-AU-PRE-084 | Aurora Prescription Dog Food AU 084 | 9501006651964 | 10.9 | 29.5 | 3.3 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s15-cert', 'Orchid Beauty ISO 9001 Certificate', 'file', 'adoc', 1746666000000, 1746666000000, 'uid-qcops', 'fold-s15', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-ORCHID-2025-8239
Issuing Authority: SGS

## Certified Organization
Organization Name: Orchid Beauty Co., Ltd.
Unified Social Credit Code (USCC): 914403015MA5D15KL15XY
Registered Address: Building 18, Industrial Zone D, Shenzhen

## Scope of Certification
Warehousing, distribution and logistics management services

## Validity
Issue Date: 2026-11-21
Expiry Date: 2027-11-21
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-18
Next Scheduled Audit: 2026-07-04'),
  ('s15-audit', 'Orchid Beauty Prior Audit Note', 'file', 'adoc', 1746669600000, 1746669600000, 'uid-qcops', 'fold-s15', 'ws-nb-qc', '# Orchid Beauty — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s16', 'Pearl PCB', 'folder', 'folder', 1746676800000, 1746676800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s16-spec', 'Pearl PCB Product Specification', 'file', 'adoc', 1746680400000, 1746680400000, 'uid-qcops', 'fold-s16', 'ws-nb-qc', '# Pearl PCB — Product Specification

## Company Information
Legal Name: Pearl PCB Co., Ltd.
USCC: 914403016MA5D16KL16XY
City: Shenzhen
Product Line: Pet Food & Nutrition

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-BR-PET-002 | Harbor Pet Containment Systems BR 002 | 9501000158384 | 45.7 | 17.7 | 12.7 |
| NB-BR-BIR-026 | Harbor Bird Cage Accessories BR 026 | 9501002058941 | 31.2 | 7.0 | 2.8 |
| NB-BR-BIR-050 | Harbor Bird Cage Water Dishes BR 050 | 9501003959506 | 18.9 | 27.3 | 12.1 |
| NB-BR-MIR-074 | Harbor Mirrors BR 074 | 9501005860060 | 43.7 | 27.3 | 3.9 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s16-cert', 'Pearl PCB ISO 9001 Certificate', 'file', 'adoc', 1746684000000, 1746684000000, 'uid-qcops', 'fold-s16', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-PEARLP-2025-5088
Issuing Authority: TUV Rheinland

## Certified Organization
Organization Name: Pearl PCB Holdings Group Co., Ltd.
Unified Social Credit Code (USCC): 91440300MA5F7PQR8T
Registered Address: Building 4, Industrial Zone C, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of pet food & nutrition

## Validity
Issue Date: 2025-01-23
Expiry Date: 2026-01-23
Status: Expired

## Audit Details
Last Surveillance Audit: 2025-11-25
Next Scheduled Audit: 2026-11-28'),
  ('s16-audit', 'Pearl PCB Prior Audit Note', 'file', 'adoc', 1746687600000, 1746687600000, 'uid-qcops', 'fold-s16', 'ws-nb-qc', '# Pearl PCB — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s17', 'Prime Auto Parts', 'folder', 'folder', 1746694800000, 1746694800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s17-spec', 'Prime Auto Parts Product Specification', 'file', 'adoc', 1746698400000, 1746698400000, 'uid-qcops', 'fold-s17', 'ws-nb-qc', '# Prime Auto Parts — Product Specification

## Company Information
Legal Name: Prime Auto Parts Co., Ltd.
USCC: 914403017MA5D17KL17XY
City: Shenzhen
Product Line: Home Décor

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-SG-CAT-013 | Cedar Cat Litter Box Mats SG 013 | 9501001029478 | 38.7 | 28.0 | 4.3 |
| NB-SG-DOG-037 | Cedar Dog Food SG 037 | 9501002930032 | 12.3 | 24.6 | 3.5 |
| NB-SG-DOG-061 | Cedar Dog Diapers SG 061 | 9501004830590 | 23.6 | 7.8 | 13.9 |
| NB-SG-DOG-085 | Cedar Dog Kennels and Runs SG 085 | 9501006731154 | 40.2 | 14.1 | 10.4 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s17-cert', 'Prime Auto Parts ISO 9001 Certificate', 'file', 'adoc', 1746702000000, 1746702000000, 'uid-qcops', 'fold-s17', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-PRIMEA-2025-5065
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Prime Auto Parts Co., Ltd.
Unified Social Credit Code (USCC): 914403017MA5D17KL17XY
Registered Address: Building 9, Industrial Zone B, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of home décor

## Validity
Issue Date: 2026-07-20
Expiry Date: 2027-07-20
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-26
Next Scheduled Audit: 2026-12-04'),
  ('s17-audit', 'Prime Auto Parts Prior Audit Note', 'file', 'adoc', 1746705600000, 1746705600000, 'uid-qcops', 'fold-s17', 'ws-nb-qc', '# Prime Auto Parts — Prior Audit Findings (Q1 2026)

Finding 1: Corrective action request — production floor humidity controls outside specification during March inspection
Status: Open — supplier acknowledged; corrective plan submitted 2026-04-15, implementation not yet verified

Finding 2: Minor labeling discrepancy on export cartons (wrong HS code printed)
Status: Closed — corrected in production batch 2026-03-22

Note: Finding 1 remains open pending on-site verification scheduled for Q2 2026.'),
  ('s17-noise', 'Warehouse Capacity Report', 'file', 'adoc', 1746709200000, 1746709200000, 'uid-qcops', 'fold-s17', 'ws-nb-qc', '# Warehouse Capacity Report

Warehouse A: 78% utilized
Warehouse B: 45% utilized
Warehouse C: 92% utilized — consider overflow to B'),
  ('fold-s18', 'PureBath', 'folder', 'folder', 1746712800000, 1746712800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s18-spec', 'PureBath Product Specification', 'file', 'adoc', 1746716400000, 1746716400000, 'uid-qcops', 'fold-s18', 'ws-nb-qc', '# PureBath — Product Specification

## Company Information
Legal Name: PureBath Co., Ltd.
USCC: 914403018MA5D18KL18XY
City: Shenzhen
Product Line: Outdoor Recreation

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-UK-DOG-015 | Lumen Dog Diaper Pads and Liners UK 015 | 9501001187857 | 6.7 | 15.7 | 3.8 |
| NB-UK-DOG-039 | Lumen Dog Treats UK 039 | 9501003088411 | 46.3 | 12.4 | 12.5 |
| NB-UK-DOG-063 | Lumen Dog Houses UK 063 | 9501004988970 | 44.2 | 9.0 | 10.2 |
| NB-UK-PET-087 | Lumen Pet Carrier and Crate Accessories UK 087 | 9501006889534 | 22.9 | 10.5 | 2.0 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s18-audit', 'PureBath Prior Audit Note', 'file', 'adoc', 1746723600000, 1746723600000, 'uid-qcops', 'fold-s18', 'ws-nb-qc', '# PureBath — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('fold-s19', 'RiverWorks Metal', 'folder', 'folder', 1746730800000, 1746730800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s19-spec', 'RiverWorks Metal Product Specification', 'file', 'adoc', 1746734400000, 1746734400000, 'uid-qcops', 'fold-s19', 'ws-nb-qc', '# RiverWorks Metal — Product Specification

## Company Information
Legal Name: RiverWorks Metal Co., Ltd.
USCC: 914403019MA5D19KL19XY
City: Shenzhen
Product Line: PCB & Electronic Boards

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-MX-PET-003 | Lumen Pet Heating Pad Accessories MX 003 | 9501000237577 | 33.9 | 13.8 | 14.7 |
| NB-MX-BIR-027 | Lumen Bird Cage Bird Baths MX 027 | 9501002138131 | 29.1 | 28.4 | 2.6 |
| NB-MX-BIR-051 | Lumen Bird Cage Water Dishes MX 051 | 9501004038699 | 48.7 | 7.8 | 14.5 |
| NB-MX-PRE-075 | Lumen Prescription Cat Food MX 075 | 9501005939254 | 16.9 | 5.9 | 7.1 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s19-cert', 'RiverWorks Metal ISO 9001 Certificate', 'file', 'adoc', 1746738000000, 1746738000000, 'uid-qcops', 'fold-s19', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-RIVERW-2025-6139
Issuing Authority: TUV Rheinland

## Certified Organization
Organization Name: RiverWorks Metal Co., Ltd.
Unified Social Credit Code (USCC): 914403019MA5D19KL19XY
Registered Address: Building 14, Industrial Zone A, Shenzhen

## Scope of Certification
Processing and packaging of agricultural food products

## Validity
Issue Date: 2026-05-12
Expiry Date: 2027-05-12
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-13
Next Scheduled Audit: 2026-11-07'),
  ('s19-audit', 'RiverWorks Metal Prior Audit Note', 'file', 'adoc', 1746741600000, 1746741600000, 'uid-qcops', 'fold-s19', 'ws-nb-qc', '# RiverWorks Metal — Prior Audit Findings (Q1 2026)

Finding 1: Corrective action request — production floor humidity controls outside specification during March inspection
Status: Open — supplier acknowledged; corrective plan submitted 2026-04-15, implementation not yet verified

Finding 2: Minor labeling discrepancy on export cartons (wrong HS code printed)
Status: Closed — corrected in production batch 2026-03-22

Note: Finding 1 remains open pending on-site verification scheduled for Q2 2026.'),
  ('fold-s20', 'Shoreline Silicone', 'folder', 'folder', 1746748800000, 1746748800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s20-spec', 'Shoreline Silicone Product Specification', 'file', 'adoc', 1746752400000, 1746752400000, 'uid-qcops', 'fold-s20', 'ws-nb-qc', '# Shoreline Silicone — Product Specification

## Company Information
Legal Name: Shoreline Silicone Co., Ltd.
USCC: 914403020MA5D20KL20XY
City: Shenzhen
Product Line: Silicone Products

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-JP-PET-001 | Cedar Pet Bed Accessories JP 001 | 9501000079191 | 36.9 | 3.0 | 14.0 |
| NB-JP-PET-025 | Cedar Pet Sunscreen JP 025 | 9501001979759 | 29.2 | 22.4 | 11.4 |
| NB-JP-BIR-049 | Cedar Bird Cage Bird Baths JP 049 | 9501003880312 | 35.2 | 12.8 | 2.0 |
| NB-JP-BIR-073 | Cedar Bird Cages and Stands JP 073 | 9501005780870 | 34.9 | 11.9 | 5.4 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s20-cert', 'Shoreline Silicone ISO 9001 Certificate', 'file', 'adoc', 1746756000000, 1746756000000, 'uid-qcops', 'fold-s20', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-SHOREL-2025-3041
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Shoreline Silicone Holdings Group Co., Ltd.
Unified Social Credit Code (USCC): 91320500MA1MBXYZ9K
Registered Address: Building 10, Industrial Zone C, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of silicone products

## Validity
Issue Date: 2026-05-02
Expiry Date: 2027-05-02
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-22
Next Scheduled Audit: 2026-10-11'),
  ('s20-audit', 'Shoreline Silicone Prior Audit Note', 'file', 'adoc', 1746759600000, 1746759600000, 'uid-qcops', 'fold-s20', 'ws-nb-qc', '# Shoreline Silicone — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.'),
  ('s20-noise', 'Quality Incident Log — Q1', 'file', 'adoc', 1746763200000, 1746763200000, 'uid-qcops', 'fold-s20', 'ws-nb-qc', '# Quality Incident Log — Q1 2026

No major incidents reported.
3 minor cosmetic defects escalated to suppliers.
All resolved within SLA.'),
  ('fold-s21', 'SunPeak Cable', 'folder', 'folder', 1746766800000, 1746766800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s21-spec', 'SunPeak Cable Product Specification', 'file', 'adoc', 1746770400000, 1746770400000, 'uid-qcops', 'fold-s21', 'ws-nb-qc', '# SunPeak Cable — Product Specification

## Company Information
Legal Name: SunPeak Cable Co., Ltd.
USCC: 914403021MA5D21KL21XY
City: Shenzhen
Product Line: Battery & Power Solutions

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-SG-BIR-005 | Nova Bird Ladders and Perches SG 005 | 9501000395956 | 18.3 | 6.4 | 6.9 |
| NB-SG-COM-029 | Nova Combined Bird Cage Food and Water Dishes SG 029 | 9501002296510 | 47.3 | 21.3 | 13.6 |
| NB-SG-CAT-053 | Nova Cat Furniture SG 053 | 9501004197075 | 32.7 | 11.1 | 8.7 |
| NB-SG-CAT-077 | Nova Cat Litter Box Mats SG 077 | 9501006097632 | 5.0 | 10.7 | 7.0 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s21-cert', 'SunPeak Cable ISO 9001 Certificate', 'file', 'adoc', 1746774000000, 1746774000000, 'uid-qcops', 'fold-s21', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-SUNPEA-2025-6279
Issuing Authority: SGS

## Certified Organization
Organization Name: SunPeak Cable Co., Ltd.
Unified Social Credit Code (USCC): 914403021MA5D21KL21XY
Registered Address: Building 15, Industrial Zone D, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of battery & power solutions

## Validity
Issue Date: 2026-07-23
Expiry Date: 2027-07-23
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-15
Next Scheduled Audit: 2026-12-07'),
  ('fold-s22', 'Vector Office', 'folder', 'folder', 1746784800000, 1746784800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s22-spec', 'Vector Office Product Specification', 'file', 'adoc', 1746788400000, 1746788400000, 'uid-qcops', 'fold-s22', 'ws-nb-qc', '# Vector Office — Product Specification

## Company Information
Legal Name: Vector Office Co., Ltd.
USCC: 914403022MA5D22KL22XY
City: Shenzhen
Product Line: Furniture Hardware

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-BR-MIR-010 | Atlas Mirrors BR 010 | 9501000791901 | 40.7 | 28.9 | 11.3 |
| NB-BR-CAT-034 | Atlas Cat Furniture Accessories BR 034 | 9501002692466 | 34.6 | 10.7 | 10.3 |
| NB-BR-DOG-058 | Atlas Dog Diapers BR 058 | 9501004593020 | 32.9 | 5.5 | 14.3 |
| NB-BR-DOG-082 | Atlas Dog Diaper Pads and Liners BR 082 | 9501006493588 | 15.6 | 11.4 | 12.3 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s22-cert', 'Vector Office ISO 9001 Certificate', 'file', 'adoc', 1746792000000, 1746792000000, 'uid-qcops', 'fold-s22', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-VECTOR-2025-3414
Issuing Authority: TUV Rheinland

## Certified Organization
Organization Name: Vector Office Co., Ltd.
Unified Social Credit Code (USCC): 914403022MA5D22KL22XY
Registered Address: Building 1, Industrial Zone A, Shenzhen

## Scope of Certification
Design, manufacture, and quality control of furniture hardware

## Validity
Issue Date: 2026-09-16
Expiry Date: 2027-09-16
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-08
Next Scheduled Audit: 2026-10-20'),
  ('s22-audit', 'Vector Office Prior Audit Note', 'file', 'adoc', 1746795600000, 1746795600000, 'uid-qcops', 'fold-s22', 'ws-nb-qc', '# Vector Office — Prior Audit Findings (Q1 2026)

Finding 1: Corrective action request — production floor humidity controls outside specification during March inspection
Status: Open — supplier acknowledged; corrective plan submitted 2026-04-15, implementation not yet verified

Finding 2: Minor labeling discrepancy on export cartons (wrong HS code printed)
Status: Closed — corrected in production batch 2026-03-22

Note: Finding 1 remains open pending on-site verification scheduled for Q2 2026.'),
  ('fold-s23', 'Willow Textile', 'folder', 'folder', 1746802800000, 1746802800000, 'uid-qcops', 'fold-suppliers', 'ws-nb-qc', ''),
  ('s23-spec', 'Willow Textile Product Specification', 'file', 'adoc', 1746806400000, 1746806400000, 'uid-qcops', 'fold-s23', 'ws-nb-qc', '# Willow Textile — Product Specification

## Company Information
Legal Name: Willow Textile Co., Ltd.
USCC: 914403023MA5D23KL23XY
City: Shenzhen
Product Line: Industrial Tooling

## Products Sourced by NorthBridge

| SKU | Product | GTIN | Length (cm) | Width (cm) | Height (cm) |
|-----|---------|------|-------------|------------|-------------|
| NB-US-INT-014 | Harbor Interactive Toys US 014 | 9501001108661 | 23.6 | 20.0 | 3.7 |
| NB-US-DOG-038 | Harbor Dog Kennels and Runs US 038 | 9501003009225 | 36.3 | 16.3 | 4.4 |
| NB-US-PRE-062 | Harbor Prescription Dog Food US 062 | 9501004909784 | 34.5 | 3.1 | 11.5 |
| NB-US-FIS-086 | Harbor Fish and Aquatic Supplies US 086 | 9501006810347 | 39.7 | 5.9 | 7.0 |

Total SKUs: 4
Last updated: 2026-05-15'),
  ('s23-cert', 'Willow Textile ISO 9001 Certificate', 'file', 'adoc', 1746810000000, 1746810000000, 'uid-qcops', 'fold-s23', 'ws-nb-qc', '# ISO 9001:2015 Quality Management System Certificate

Certificate No: QMS-WILLOW-2025-3881
Issuing Authority: Bureau Veritas

## Certified Organization
Organization Name: Willow Textile Co., Ltd.
Unified Social Credit Code (USCC): 914403023MA5D23KL23XY
Registered Address: Building 17, Industrial Zone D, Shenzhen

## Scope of Certification
Manufacture of pharmaceutical packaging and medical devices

## Validity
Issue Date: 2026-02-15
Expiry Date: 2027-02-15
Status: Valid

## Audit Details
Last Surveillance Audit: 2025-11-02
Next Scheduled Audit: 2026-11-08'),
  ('s23-audit', 'Willow Textile Prior Audit Note', 'file', 'adoc', 1746813600000, 1746813600000, 'uid-qcops', 'fold-s23', 'ws-nb-qc', '# Willow Textile — Prior Audit Findings (Q1 2026)

Finding 1: Minor documentation gap in raw material traceability records
Status: Closed — supplier provided complete batch records 2026-03-10

Finding 2: Suggestion to improve worker break-area ventilation
Status: Closed — ventilation upgrade completed 2026-04-01

All findings from Q1 2026 review are resolved. No open items.');
