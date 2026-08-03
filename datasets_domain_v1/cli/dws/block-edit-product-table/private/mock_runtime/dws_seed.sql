-- Seed for dws-block-edit-product-table
DELETE FROM comment_replies;
DELETE FROM comments;
DELETE FROM blocks;
DELETE FROM documents;
DELETE FROM mock_config;

INSERT INTO mock_config (key, value) VALUES
  ('defaultWorkspaceId', 'ws-nb-catalog'),
  ('defaultFolderId', 'fold-root'),
  ('mockUserId', 'uid-catops'),
  ('mockUserName', 'Catalog Ops'),
  ('mockCorpId', 'corp-northbridge'),
  ('mockCorpName', 'NorthBridge Accessories');

INSERT OR IGNORE INTO documents (nodeId, name, type, extension, createTime, lastEditTime, creatorUid, parentId, workspaceId, content) VALUES
  ('fold-root', 'NorthBridge Catalog', 'folder', 'folder', 1748304000000, 1748304000000, 'uid-catops', NULL, 'ws-nb-catalog', ''),
  ('doc-catalog', 'Q2 Procurement Calendar', 'file', 'adoc', 1748307600000, 1748307600000, 'uid-catops', 'fold-root', 'ws-nb-catalog', '# Q2 Procurement Calendar

## Active Products — Q2 2026

| NB-JP-PET-001 | Cedar Pet Bed Accessories JP 001 | 20.45 JPY | JP |
| NB-BR-PET-002 | Harbor Pet Containment Systems BR 002 | 22.9 BRL | BR |
| NB-MX-PET-003 | Lumen Pet Heating Pad Accessories MX 003 | 25.35 MXN | MX |
| NB-AU-PET-004 | Meridian Pet Waste Disposal Systems and Tools AU 004 | 27.8 AUD | AU |
| NB-SG-BIR-005 | Nova Bird Ladders and Perches SG 005 | 30.25 SGD | SG |
| NB-US-BIR-006 | Orchid Bird Cage Food and Water Dishes US 006 | 32.7 USD | US |
| NB-UK-BIR-007 | Summit Bird Cage Food Dishes UK 007 | 35.15 GBP | UK |
| NB-DE-BIR-008 | Vector Bird Cage Food Dishes DE 008 | 37.6 EUR | DE |
| NB-JP-BIR-009 | Willow Bird Cages and Stands JP 009 | 40.05 JPY | JP |
| NB-BR-MIR-010 | Atlas Mirrors BR 010 | 42.5 BRL | BR |
| NB-MX-PRE-011 | River Prescription Cat Food MX 011 | 44.95 MXN | MX |
| NB-AU-CAT-012 | Aurora Cat Steps and Ramps AU 012 | 47.4 AUD | AU |
| NB-SG-CAT-013 | Cedar Cat Litter Box Mats SG 013 | 49.85 SGD | SG |
| NB-US-INT-014 | Harbor Interactive Toys US 014 | 52.3 USD | US |
| NB-UK-DOG-015 | Lumen Dog Diaper Pads and Liners UK 015 | 54.75 GBP | UK |
| NB-DE-DOG-016 | Meridian Dog Houses DE 016 | 57.2 EUR | DE |

## Q1 Archive (to be moved)

| NB-JP-DOG-017 | Nova Dog Toys JP 017 | 59.65 JPY | JP |
| NB-BR-DOG-018 | Orchid Dog Diaper Pads and Liners BR 018 | 62.1 BRL | BR |
| NB-MX-NON-019 | Summit Non-Prescription Dog Food MX 019 | 64.55 MXN | MX |
| NB-AU-PRE-020 | Vector Prescription Dog Food AU 020 | 67 AUD | AU |
| NB-SG-DOG-021 | Willow Dog Kennels and Runs SG 021 | 69.45 SGD | SG |
| NB-US-FIS-022 | Atlas Fish and Aquatic Supplies US 022 | 71.9 USD | US |
| NB-UK-PET-023 | River Pet Carrier and Crate Accessories UK 023 | 74.35 GBP | UK |
| NB-DE-PET-024 | Aurora Pet Food Scoops DE 024 | 76.8 EUR | DE |

## Procurement Contacts

Primary: Sarah Chen (sarah.chen@northbridge.co) — JP/SG/AU markets
Secondary: Marcus Rivera (m.rivera@northbridge.co) — BR/MX/US markets
Escalation: David Park (d.park@northbridge.co) — UK/DE markets, all disputes
Approval workflow: Submit via procurement-approvals@northbridge.co — include SKU, qty, target ship date'),
  ('doc-q3-ref', 'Q3 2026 New Products', 'file', 'adoc', 1748322000000, 1748322000000, 'uid-catops', 'fold-root', 'ws-nb-catalog', '# Q3 2026 New Products

The following products are confirmed for Q3 procurement:

| SKU | Product | Price | Market |
|-----|---------|-------|--------|
| NB-JP-PET-025 | Cedar Pet Sunscreen JP 025 | 79.25 JPY | JP |
| NB-BR-BIR-026 | Harbor Bird Cage Accessories BR 026 | 81.7 BRL | BR |
| NB-MX-BIR-027 | Lumen Bird Cage Bird Baths MX 027 | 84.15 MXN | MX |
| NB-AU-BIR-028 | Meridian Bird Cage Food and Water Dishes AU 028 | 86.6 AUD | AU |
| NB-SG-COM-029 | Nova Combined Bird Cage Food and Water Dishes SG 029 | 89.05 SGD | SG |
| NB-US-COM-030 | Orchid Combined Bird Cage Food and Water Dishes US 030 | 91.5 USD | US |
| NB-UK-PUZ-031 | Summit Puzzles and Interactive Toys UK 031 | 93.95 GBP | UK |
| NB-DE-CAT-032 | Vector Cat Furniture Accessories DE 032 | 96.4 EUR | DE |
| NB-JP-OUT-033 | Willow Outdoor Cat Houses JP 033 | 98.85 JPY | JP |
| NB-BR-CAT-034 | Atlas Cat Furniture Accessories BR 034 | 101.3 BRL | BR |
| NB-MX-STU-035 | River Stuffed Toys and Plushies MX 035 | 103.75 MXN | MX |
| NB-AU-DOG-036 | Aurora Dog Supplies AU 036 | 106.2 AUD | AU |');

INSERT OR IGNORE INTO blocks (blockId, nodeId, blockType, contentJson, blockOrder) VALUES
  ('blk-0000', 'doc-catalog', 'heading', '{"text":"Q2 Procurement Calendar","level":1}', 0),
  ('blk-0001', 'doc-catalog', 'heading', '{"text":"Active Products — Q2 2026","level":2}', 1),
  ('blk-0002', 'doc-catalog', 'paragraph', '{"text":"| NB-JP-PET-001 | Cedar Pet Bed Accessories JP 001 | 20.45 JPY | JP |"}', 2),
  ('blk-0003', 'doc-catalog', 'paragraph', '{"text":"| NB-BR-PET-002 | Harbor Pet Containment Systems BR 002 | 22.9 BRL | BR |"}', 3),
  ('blk-0004', 'doc-catalog', 'paragraph', '{"text":"| NB-MX-PET-003 | Lumen Pet Heating Pad Accessories MX 003 | 25.35 MXN | MX |"}', 4),
  ('blk-0005', 'doc-catalog', 'paragraph', '{"text":"| NB-AU-PET-004 | Meridian Pet Waste Disposal Systems and Tools AU 004 | 27.8 AUD | AU |"}', 5),
  ('blk-0006', 'doc-catalog', 'paragraph', '{"text":"| NB-SG-BIR-005 | Nova Bird Ladders and Perches SG 005 | 30.25 SGD | SG |"}', 6),
  ('blk-0007', 'doc-catalog', 'paragraph', '{"text":"| NB-US-BIR-006 | Orchid Bird Cage Food and Water Dishes US 006 | 32.7 USD | US |"}', 7),
  ('blk-0008', 'doc-catalog', 'paragraph', '{"text":"| NB-UK-BIR-007 | Summit Bird Cage Food Dishes UK 007 | 35.15 GBP | UK |"}', 8),
  ('blk-0009', 'doc-catalog', 'paragraph', '{"text":"| NB-DE-BIR-008 | Vector Bird Cage Food Dishes DE 008 | 37.6 EUR | DE |"}', 9),
  ('blk-0010', 'doc-catalog', 'paragraph', '{"text":"| NB-JP-BIR-009 | Willow Bird Cages and Stands JP 009 | 40.05 JPY | JP |"}', 10),
  ('blk-0011', 'doc-catalog', 'paragraph', '{"text":"| NB-BR-MIR-010 | Atlas Mirrors BR 010 | 42.5 BRL | BR |"}', 11),
  ('blk-0012', 'doc-catalog', 'paragraph', '{"text":"| NB-MX-PRE-011 | River Prescription Cat Food MX 011 | 44.95 MXN | MX |"}', 12),
  ('blk-0013', 'doc-catalog', 'paragraph', '{"text":"| NB-AU-CAT-012 | Aurora Cat Steps and Ramps AU 012 | 47.4 AUD | AU |"}', 13),
  ('blk-0014', 'doc-catalog', 'paragraph', '{"text":"| NB-SG-CAT-013 | Cedar Cat Litter Box Mats SG 013 | 49.85 SGD | SG |"}', 14),
  ('blk-0015', 'doc-catalog', 'paragraph', '{"text":"| NB-US-INT-014 | Harbor Interactive Toys US 014 | 52.3 USD | US |"}', 15),
  ('blk-0016', 'doc-catalog', 'paragraph', '{"text":"| NB-UK-DOG-015 | Lumen Dog Diaper Pads and Liners UK 015 | 54.75 GBP | UK |"}', 16),
  ('blk-0017', 'doc-catalog', 'paragraph', '{"text":"| NB-DE-DOG-016 | Meridian Dog Houses DE 016 | 57.2 EUR | DE |"}', 17),
  ('blk-0018', 'doc-catalog', 'heading', '{"text":"Q1 Archive (to be moved)","level":2}', 18),
  ('blk-0019', 'doc-catalog', 'paragraph', '{"text":"| NB-JP-DOG-017 | Nova Dog Toys JP 017 | 59.65 JPY | JP |"}', 19),
  ('blk-0020', 'doc-catalog', 'paragraph', '{"text":"| NB-BR-DOG-018 | Orchid Dog Diaper Pads and Liners BR 018 | 62.1 BRL | BR |"}', 20),
  ('blk-0021', 'doc-catalog', 'paragraph', '{"text":"| NB-MX-NON-019 | Summit Non-Prescription Dog Food MX 019 | 64.55 MXN | MX |"}', 21),
  ('blk-0022', 'doc-catalog', 'paragraph', '{"text":"| NB-AU-PRE-020 | Vector Prescription Dog Food AU 020 | 67 AUD | AU |"}', 22),
  ('blk-0023', 'doc-catalog', 'paragraph', '{"text":"| NB-SG-DOG-021 | Willow Dog Kennels and Runs SG 021 | 69.45 SGD | SG |"}', 23),
  ('blk-0024', 'doc-catalog', 'paragraph', '{"text":"| NB-US-FIS-022 | Atlas Fish and Aquatic Supplies US 022 | 71.9 USD | US |"}', 24),
  ('blk-0025', 'doc-catalog', 'paragraph', '{"text":"| NB-UK-PET-023 | River Pet Carrier and Crate Accessories UK 023 | 74.35 GBP | UK |"}', 25),
  ('blk-0026', 'doc-catalog', 'paragraph', '{"text":"| NB-DE-PET-024 | Aurora Pet Food Scoops DE 024 | 76.8 EUR | DE |"}', 26),
  ('blk-0027', 'doc-catalog', 'heading', '{"text":"Procurement Contacts","level":2}', 27),
  ('blk-0028', 'doc-catalog', 'paragraph', '{"text":"Primary: Sarah Chen (sarah.chen@northbridge.co) — JP/SG/AU markets"}', 28),
  ('blk-0029', 'doc-catalog', 'paragraph', '{"text":"Secondary: Marcus Rivera (m.rivera@northbridge.co) — BR/MX/US markets"}', 29),
  ('blk-0030', 'doc-catalog', 'paragraph', '{"text":"Escalation: David Park (d.park@northbridge.co) — UK/DE markets, all disputes"}', 30),
  ('blk-0031', 'doc-catalog', 'paragraph', '{"text":"Approval workflow: Submit via procurement-approvals@northbridge.co — include SKU, qty, target ship date"}', 31);

INSERT OR IGNORE INTO comments (commentKey, nodeId, content, type, creatorUid, createTime, resolved, blockId, startOffset, endOffset, selectedText, mentionsJson) VALUES
  ('cmk-inline-03', 'doc-catalog', 'Price needs review before Q3', 'inline', 'uid-reviewer', 1748494800000, 0, 'blk-0005', 0, 10, 'price data', '[]'),
  ('cmk-inline-07', 'doc-catalog', 'Price needs review before Q3', 'inline', 'uid-reviewer', 1748509200000, 0, 'blk-0009', 0, 10, 'price data', '[]'),
  ('cmk-inline-11', 'doc-catalog', 'Price needs review before Q3', 'inline', 'uid-reviewer', 1748523600000, 0, 'blk-0013', 0, 10, 'price data', '[]'),
  ('cmk-footer-28', 'doc-catalog', 'Sarah is on leave Jul 15-30, route JP/SG to Marcus during that window', 'inline', 'uid-catops', 1748580000000, 0, 'blk-0028', 0, 5, 'Sarah', '[]'),
  ('cmk-footer-31', 'doc-catalog', 'Reminder: approval SLA is 48h, not 72h — confirmed with finance', 'inline', 'uid-catops', 1748590000000, 0, 'blk-0031', 0, 8, 'Approval', '[]');
