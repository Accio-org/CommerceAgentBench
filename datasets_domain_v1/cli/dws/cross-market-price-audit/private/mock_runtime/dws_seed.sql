-- Seed for dws-cross-market-price-audit
DELETE FROM comment_replies;
DELETE FROM comments;
DELETE FROM blocks;
DELETE FROM documents;
DELETE FROM mock_config;

INSERT INTO mock_config (key, value) VALUES
  ('defaultWorkspaceId', 'ws-nb-pricing'),
  ('defaultFolderId', 'fold-root'),
  ('mockUserId', 'uid-pricing'),
  ('mockUserName', 'Pricing Ops'),
  ('mockCorpId', 'corp-northbridge'),
  ('mockCorpName', 'NorthBridge Accessories');

INSERT OR IGNORE INTO documents (nodeId, name, type, extension, createTime, lastEditTime, creatorUid, parentId, workspaceId, content) VALUES
  ('fold-root', 'NorthBridge Pricing KB', 'folder', 'folder', 1748304000000, 1748304000000, 'uid-pricing', NULL, 'ws-nb-pricing', ''),
  ('fold-mkt-au', 'AU Market Catalog', 'folder', 'folder', 1748307600000, 1748307600000, 'uid-pricing', 'fold-root', 'ws-nb-pricing', ''),
  ('doc-mkt-au', 'AU Product Catalog', 'file', 'adoc', 1748340000000, 1748340000000, 'uid-pricing', 'fold-mkt-au', 'ws-nb-pricing', '# AU Market Catalog

Market: AU
Last Updated: 2026-05-28
Products: 12

| SKU | Product | Price | Currency | Availability |
|-----|---------|-------|----------|-------------|
| NB-AU-PET-004 | Meridian Pet Waste Disposal Systems and Tools AU 004 | 27.8 | AUD | in_stock |
| NB-AU-CAT-012 | Aurora Cat Steps and Ramps AU 012 | 47.4 | AUD | preorder |
| NB-AU-PRE-020 | Vector Prescription Dog Food AU 020 | 67 | AUD | in_stock |
| NB-AU-BIR-028 | Meridian Bird Cage Food and Water Dishes AU 028 | 86.6 | AUD | in_stock |
| NB-AU-DOG-036 | Aurora Dog Supplies AU 036 | 106.2 | AUD | out_of_stock |
| NB-AU-PET-044 | Vector Pet Biometric Monitors AU 044 | 31.8 | AUD | in_stock |
| NB-AU-SWI-052 | Meridian Swings and Perches AU 052 | 51.4 | AUD | backorder |
| NB-AU-DOG-060 | Aurora Dog Treadmills AU 060 | 71 | AUD | preorder |
| NB-AU-PET-068 | Vector Pet Waste Disposal Systems and Tools AU 068 | 90.6 | AUD | in_stock |
| NB-AU-CAT-076 | Meridian Cat Steps and Ramps AU 076 | 110.2 | AUD | in_stock |
| NB-AU-PRE-084 | Aurora Prescription Dog Food AU 084 | 35.8 | AUD | preorder |
| NB-AU-BIR-092 | Vector Bird Cage Food and Water Dishes AU 092 | 55.4 | AUD | in_stock |'),
  ('doc-draft-au', '[DRAFT] AU Q3 Pricing Preview', 'file', 'adoc', 1748376000000, 1748376000000, 'uid-pricing', 'fold-mkt-au', 'ws-nb-pricing', '# [DRAFT] AU Q3 Pricing Preview

This is a draft — do not use for official pricing updates.'),
  ('fold-mkt-br', 'BR Market Catalog', 'folder', 'folder', 1748311200000, 1748311200000, 'uid-pricing', 'fold-root', 'ws-nb-pricing', ''),
  ('doc-mkt-br', 'BR Product Catalog', 'file', 'adoc', 1748343600000, 1748343600000, 'uid-pricing', 'fold-mkt-br', 'ws-nb-pricing', '# BR Market Catalog

Market: BR
Last Updated: 2026-05-28
Products: 12

| SKU | Product | Price | Currency | Availability |
|-----|---------|-------|----------|-------------|
| NB-BR-PET-002 | Harbor Pet Containment Systems BR 002 | 22.9 | BRL | in_stock |
| NB-BR-MIR-010 | Atlas Mirrors BR 010 | 42.5 | BRL | in_stock |
| NB-BR-DOG-018 | Orchid Dog Diaper Pads and Liners BR 018 | 62.1 | BRL | out_of_stock |
| NB-BR-BIR-026 | Harbor Bird Cage Accessories BR 026 | 81.7 | BRL | backorder |
| NB-BR-CAT-034 | Atlas Cat Furniture Accessories BR 034 | 101.3 | BRL | in_stock |
| NB-BR-DOG-042 | Orchid Dog Kennel and Run Accessories BR 042 | 26.9 | BRL | preorder |
| NB-BR-BIR-050 | Harbor Bird Cage Water Dishes BR 050 | 46.5 | BRL | in_stock |
| NB-BR-DOG-058 | Atlas Dog Diapers BR 058 | 66.1 | BRL | in_stock |
| NB-BR-PET-066 | Orchid Pet Containment Systems BR 066 | 85.7 | BRL | preorder |
| NB-BR-MIR-074 | Harbor Mirrors BR 074 | 105.3 | BRL | in_stock |
| NB-BR-DOG-082 | Atlas Dog Diaper Pads and Liners BR 082 | 30.9 | BRL | in_stock |
| NB-BR-BIR-090 | Orchid Bird Cage Accessories BR 090 | 50.5 | BRL | out_of_stock |'),
  ('fold-mkt-de', 'DE Market Catalog', 'folder', 'folder', 1748314800000, 1748314800000, 'uid-pricing', 'fold-root', 'ws-nb-pricing', ''),
  ('doc-mkt-de', 'DE Product Catalog', 'file', 'adoc', 1748347200000, 1748347200000, 'uid-pricing', 'fold-mkt-de', 'ws-nb-pricing', '# DE Market Catalog

Market: DE
Last Updated: 2026-05-28
Products: 12

| SKU | Product | Price | Currency | Availability |
|-----|---------|-------|----------|-------------|
| NB-DE-BIR-008 | Vector Bird Cage Food Dishes DE 008 | 37.6 | EUR | in_stock |
| NB-DE-DOG-016 | Meridian Dog Houses DE 016 | 57.2 | EUR | in_stock |
| NB-DE-PET-024 | Aurora Pet Food Scoops DE 024 | 76.8 | EUR | preorder |
| NB-DE-CAT-032 | Vector Cat Furniture Accessories DE 032 | 96.4 | EUR | in_stock |
| NB-DE-DOG-040 | Meridian Dog Food DE 040 | 22 | EUR | in_stock |
| NB-DE-BIR-048 | Aurora Bird Cage Accessories DE 048 | 41.6 | EUR | preorder |
| NB-DE-CAT-056 | Vector Catnip Toys DE 056 | 61.2 | EUR | in_stock |
| NB-DE-LIV-064 | Meridian Live Animals DE 064 | 80.8 | EUR | in_stock |
| NB-DE-BIR-072 | Aurora Bird Cage Food Dishes DE 072 | 100.4 | EUR | out_of_stock |
| NB-DE-DOG-080 | Vector Dog Houses DE 080 | 26 | EUR | in_stock |
| NB-DE-PET-088 | Meridian Pet Food Scoops DE 088 | 45.6 | EUR | in_stock |
| NB-DE-CAT-096 | Aurora Cat Furniture Accessories DE 096 | 65.2 | EUR | preorder |'),
  ('fold-mkt-jp', 'JP Market Catalog', 'folder', 'folder', 1748318400000, 1748318400000, 'uid-pricing', 'fold-root', 'ws-nb-pricing', ''),
  ('doc-mkt-jp', 'JP Product Catalog', 'file', 'adoc', 1748350800000, 1748350800000, 'uid-pricing', 'fold-mkt-jp', 'ws-nb-pricing', '# JP Market Catalog

Market: JP
Last Updated: 2026-05-28
Products: 12

| SKU | Product | Price | Currency | Availability |
|-----|---------|-------|----------|-------------|
| NB-JP-PET-001 | Cedar Pet Bed Accessories JP 001 | 20.45 | JPY | in_stock |
| NB-JP-BIR-009 | Willow Bird Cages and Stands JP 009 | 40.05 | JPY | out_of_stock |
| NB-JP-DOG-017 | Nova Dog Toys JP 017 | 59.65 | JPY | in_stock |
| NB-JP-PET-025 | Cedar Pet Sunscreen JP 025 | 79.25 | JPY | in_stock |
| NB-JP-OUT-033 | Willow Outdoor Cat Houses JP 033 | 98.85 | JPY | in_stock |
| NB-JP-NON-041 | Nova Non-Prescription Dog Food JP 041 | 24.45 | JPY | in_stock |
| NB-JP-BIR-049 | Cedar Bird Cage Bird Baths JP 049 | 44.05 | JPY | in_stock |
| NB-JP-CAT-057 | Willow Cat Treats JP 057 | 63.65 | JPY | in_stock |
| NB-JP-PET-065 | Nova Pet Bed Accessories JP 065 | 83.25 | JPY | backorder |
| NB-JP-BIR-073 | Cedar Bird Cages and Stands JP 073 | 102.85 | JPY | in_stock |
| NB-JP-DOG-081 | Willow Dog Toys JP 081 | 28.45 | JPY | out_of_stock |
| NB-JP-PET-089 | Nova Pet Sunscreen JP 089 | 48.05 | JPY | in_stock |'),
  ('doc-draft-jp', '[DRAFT] JP Q3 Pricing Preview', 'file', 'adoc', 1748386800000, 1748386800000, 'uid-pricing', 'fold-mkt-jp', 'ws-nb-pricing', '# [DRAFT] JP Q3 Pricing Preview

This is a draft — do not use for official pricing updates.'),
  ('fold-mkt-mx', 'MX Market Catalog', 'folder', 'folder', 1748322000000, 1748322000000, 'uid-pricing', 'fold-root', 'ws-nb-pricing', ''),
  ('doc-mkt-mx', 'MX Product Catalog', 'file', 'adoc', 1748354400000, 1748354400000, 'uid-pricing', 'fold-mkt-mx', 'ws-nb-pricing', '# MX Market Catalog

Market: MX
Last Updated: 2026-05-28
Products: 12

| SKU | Product | Price | Currency | Availability |
|-----|---------|-------|----------|-------------|
| NB-MX-PET-003 | Lumen Pet Heating Pad Accessories MX 003 | 25.35 | MXN | in_stock |
| NB-MX-PRE-011 | River Prescription Cat Food MX 011 | 44.95 | MXN | in_stock |
| NB-MX-NON-019 | Summit Non-Prescription Dog Food MX 019 | 64.55 | MXN | in_stock |
| NB-MX-BIR-027 | Lumen Bird Cage Bird Baths MX 027 | 84.15 | MXN | out_of_stock |
| NB-MX-STU-035 | River Stuffed Toys and Plushies MX 035 | 103.75 | MXN | in_stock |
| NB-MX-DOG-043 | Summit Dog Supplies MX 043 | 29.35 | MXN | in_stock |
| NB-MX-BIR-051 | Lumen Bird Cage Water Dishes MX 051 | 48.95 | MXN | in_stock |
| NB-MX-DOG-059 | River Dog Kennel and Run Accessories MX 059 | 68.55 | MXN | in_stock |
| NB-MX-PET-067 | Summit Pet Heating Pad Accessories MX 067 | 88.15 | MXN | in_stock |
| NB-MX-PRE-075 | Lumen Prescription Cat Food MX 075 | 107.75 | MXN | in_stock |
| NB-MX-NON-083 | River Non-Prescription Dog Food MX 083 | 33.35 | MXN | in_stock |
| NB-MX-BIR-091 | Summit Bird Cage Bird Baths MX 091 | 52.95 | MXN | backorder |'),
  ('fold-mkt-sg', 'SG Market Catalog', 'folder', 'folder', 1748325600000, 1748325600000, 'uid-pricing', 'fold-root', 'ws-nb-pricing', ''),
  ('doc-mkt-sg', 'SG Product Catalog', 'file', 'adoc', 1748358000000, 1748358000000, 'uid-pricing', 'fold-mkt-sg', 'ws-nb-pricing', '# SG Market Catalog

Market: SG
Last Updated: 2026-05-28
Products: 12

| SKU | Product | Price | Currency | Availability |
|-----|---------|-------|----------|-------------|
| NB-SG-BIR-005 | Nova Bird Ladders and Perches SG 005 | 30.25 | SGD | in_stock |
| NB-SG-CAT-013 | Cedar Cat Litter Box Mats SG 013 | 49.85 | SGD | backorder |
| NB-SG-DOG-021 | Willow Dog Kennels and Runs SG 021 | 69.45 | SGD | in_stock |
| NB-SG-COM-029 | Nova Combined Bird Cage Food and Water Dishes SG 029 | 89.05 | SGD | in_stock |
| NB-SG-DOG-037 | Cedar Dog Food SG 037 | 108.65 | SGD | in_stock |
| NB-SG-PET-045 | Willow Pet Door Accessories SG 045 | 34.25 | SGD | out_of_stock |
| NB-SG-CAT-053 | Nova Cat Furniture SG 053 | 53.85 | SGD | in_stock |
| NB-SG-DOG-061 | Cedar Dog Diapers SG 061 | 73.45 | SGD | in_stock |
| NB-SG-BIR-069 | Willow Bird Ladders and Perches SG 069 | 93.05 | SGD | in_stock |
| NB-SG-CAT-077 | Nova Cat Litter Box Mats SG 077 | 112.65 | SGD | in_stock |
| NB-SG-DOG-085 | Cedar Dog Kennels and Runs SG 085 | 38.25 | SGD | in_stock |
| NB-SG-COM-093 | Willow Combined Bird Cage Food and Water Dishes SG 093 | 57.85 | SGD | in_stock |'),
  ('fold-mkt-uk', 'UK Market Catalog', 'folder', 'folder', 1748329200000, 1748329200000, 'uid-pricing', 'fold-root', 'ws-nb-pricing', ''),
  ('doc-mkt-uk', 'UK Product Catalog', 'file', 'adoc', 1748361600000, 1748361600000, 'uid-pricing', 'fold-mkt-uk', 'ws-nb-pricing', '# UK Market Catalog

Market: UK
Last Updated: 2026-05-28
Products: 12

| SKU | Product | Price | Currency | Availability |
|-----|---------|-------|----------|-------------|
| NB-UK-BIR-007 | Summit Bird Cage Food Dishes UK 007 | 35.15 | GBP | in_stock |
| NB-UK-DOG-015 | Lumen Dog Diaper Pads and Liners UK 015 | 54.75 | GBP | in_stock |
| NB-UK-PET-023 | River Pet Carrier and Crate Accessories UK 023 | 74.35 | GBP | in_stock |
| NB-UK-PUZ-031 | Summit Puzzles and Interactive Toys UK 031 | 93.95 | GBP | in_stock |
| NB-UK-DOG-039 | Lumen Dog Treats UK 039 | 113.55 | GBP | backorder |
| NB-UK-SMA-047 | River Small Animal Supplies UK 047 | 39.15 | GBP | in_stock |
| NB-UK-OUT-055 | Summit Outdoor Cat Houses UK 055 | 58.75 | GBP | in_stock |
| NB-UK-DOG-063 | Lumen Dog Houses UK 063 | 78.35 | GBP | out_of_stock |
| NB-UK-BIR-071 | River Bird Cage Food Dishes UK 071 | 97.95 | GBP | in_stock |
| NB-UK-DOG-079 | Summit Dog Diaper Pads and Liners UK 079 | 117.55 | GBP | in_stock |
| NB-UK-PET-087 | Lumen Pet Carrier and Crate Accessories UK 087 | 43.15 | GBP | in_stock |
| NB-UK-PUZ-095 | River Puzzles and Interactive Toys UK 095 | 62.75 | GBP | in_stock |'),
  ('doc-draft-uk', '[DRAFT] UK Q3 Pricing Preview', 'file', 'adoc', 1748397600000, 1748397600000, 'uid-pricing', 'fold-mkt-uk', 'ws-nb-pricing', '# [DRAFT] UK Q3 Pricing Preview

This is a draft — do not use for official pricing updates.'),
  ('fold-mkt-us', 'US Market Catalog', 'folder', 'folder', 1748332800000, 1748332800000, 'uid-pricing', 'fold-root', 'ws-nb-pricing', ''),
  ('doc-mkt-us', 'US Product Catalog', 'file', 'adoc', 1748365200000, 1748365200000, 'uid-pricing', 'fold-mkt-us', 'ws-nb-pricing', '# US Market Catalog

Market: US
Last Updated: 2026-05-28
Products: 12

| SKU | Product | Price | Currency | Availability |
|-----|---------|-------|----------|-------------|
| NB-US-BIR-006 | Orchid Bird Cage Food and Water Dishes US 006 | 32.7 | USD | preorder |
| NB-US-INT-014 | Harbor Interactive Toys US 014 | 52.3 | USD | in_stock |
| NB-US-FIS-022 | Atlas Fish and Aquatic Supplies US 022 | 71.9 | USD | in_stock |
| NB-US-COM-030 | Orchid Combined Bird Cage Food and Water Dishes US 030 | 91.5 | USD | preorder |
| NB-US-DOG-038 | Harbor Dog Kennels and Runs US 038 | 111.1 | USD | in_stock |
| NB-US-PET-046 | Atlas Pet Medical Collars US 046 | 36.7 | USD | in_stock |
| NB-US-CAT-054 | Orchid Cat Steps and Ramps US 054 | 56.3 | USD | out_of_stock |
| NB-US-PRE-062 | Harbor Prescription Dog Food US 062 | 75.9 | USD | in_stock |
| NB-US-BIR-070 | Atlas Bird Cage Food and Water Dishes US 070 | 95.5 | USD | in_stock |
| NB-US-INT-078 | Orchid Interactive Toys US 078 | 115.1 | USD | backorder |
| NB-US-FIS-086 | Harbor Fish and Aquatic Supplies US 086 | 40.7 | USD | in_stock |
| NB-US-COM-094 | Atlas Combined Bird Cage Food and Water Dishes US 094 | 60.3 | USD | in_stock |'),
  ('fold-changelog', 'Change Logs', 'folder', 'folder', 1748412000000, 1748412000000, 'uid-pricing', 'fold-root', 'ws-nb-pricing', '');
