-- Seed for dws-comment-review-revision
DELETE FROM comment_replies;
DELETE FROM comments;
DELETE FROM blocks;
DELETE FROM documents;
DELETE FROM mock_config;

INSERT INTO mock_config (key, value) VALUES
  ('defaultWorkspaceId', 'ws-nb-listings'),
  ('defaultFolderId', 'fold-root'),
  ('mockUserId', 'uid-listops'),
  ('mockUserName', 'Listing Ops'),
  ('mockCorpId', 'corp-northbridge'),
  ('mockCorpName', 'NorthBridge Accessories');

INSERT OR IGNORE INTO documents (nodeId, name, type, extension, createTime, lastEditTime, creatorUid, parentId, workspaceId, content) VALUES
  ('fold-root', 'NorthBridge Listings KB', 'folder', 'folder', 1748304000000, 1748304000000, 'uid-listops', NULL, 'ws-nb-listings', ''),
  ('fold-drafts', 'Listing Drafts', 'folder', 'folder', 1748307600000, 1748307600000, 'uid-listops', 'fold-root', 'ws-nb-listings', ''),
  ('fold-approved', 'Approved Listings', 'folder', 'folder', 1748311200000, 1748311200000, 'uid-listops', 'fold-root', 'ws-nb-listings', ''),
  ('lst-000', 'Listing Draft — NB-JP-PET-001', 'file', 'adoc', 1748340000000, 1748340000000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-JP-PET-001

SKU: NB-JP-PET-001
Title: Cedar Pet Bed Accessories JP 001
Category: Animals & Pet Supplies > Pet Supplies > Pet Bed Accessories
Market: JP
Channel: Amazon
Price: 20.45 JPY
Availability: in_stock
GTIN: 9501000079191
MPN: NB-SHORE-1001
Status: Draft

## Description
Cedar Pet Bed Accessories JP 001 — high quality product for JP market. Available on Amazon.'),
  ('lst-001', 'Listing Draft — NB-BR-PET-002', 'file', 'adoc', 1748343600000, 1748343600000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-BR-PET-002

SKU: NB-BR-PET-002
Title: Harbor Pet Containment Systems BR 002
Category: Animals & Pet Supplies > Pet Supplies > Pet Containment Systems
Market: BR
Channel: TikTok Shop
Price: 22.9 BRL
Availability: in_stock
GTIN: 9501000158384
MPN: NB-PEARL-1002
Status: Draft

## Description
Harbor Pet Containment Systems BR 002 — high quality product for BR market. Available on TikTok Shop.'),
  ('lst-002', 'Listing Draft — NB-MX-PET-003', 'file', 'adoc', 1748347200000, 1748347200000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-MX-PET-003

SKU: NB-MX-PET-003
Title: Lumen Pet Heating Pad Accessories MX 003
Category: Animals & Pet Supplies > Pet Supplies > Pet Heating Pad Accessories
Market: MX
Channel: Walmart Marketplace
Price: 25.35 MXN
Availability: in_stock
GTIN: 9501000237577
MPN: NB-RIVER-1003
Status: Draft

## Description
Lumen Pet Heating Pad Accessories MX 003 — high quality product for MX market. Available on Walmart Marketplace.'),
  ('lst-003', 'Listing Draft — NB-AU-PET-004', 'file', 'adoc', 1748350800000, 1748350800000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-AU-PET-004

SKU: NB-AU-PET-004
Title: Meridian Pet Waste Disposal Systems and Tools AU 004
Category: Animals & Pet Supplies > Pet Supplies > Pet Waste Disposal Systems & Tools
Market: AU
Channel: Shopify
Price: 27.8 AUD
Availability: in_stock
GTIN: 9501000316760
MPN: NB-EVERM-1004
Status: Draft

## Description
Meridian Pet Waste Disposal Systems and Tools AU 004 — high quality product for AU market. Available on Shopify.'),
  ('lst-004', 'Listing Draft — NB-SG-BIR-005', 'file', 'adoc', 1748354400000, 1748354400000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-SG-BIR-005

SKU: NB-SG-BIR-005
Title: Nova Bird Ladders and Perches SG 005
Category: Animals & Pet Supplies > Pet Supplies > Bird Supplies > Bird Ladders & Perches
Market: SG
Channel: Google Merchant
Price: 30.25 SGD
Availability: in_stock
GTIN: 9501000395956
MPN: NB-SUNPE-1005
Status: Draft

## Description
Nova Bird Ladders and Perches SG 005 — high quality product for SG market. Available on Google Merchant.'),
  ('lst-005', 'Listing Draft — NB-US-BIR-006', 'file', 'adoc', 1748358000000, 1748358000000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-US-BIR-006

SKU: NB-US-BIR-006
Title: Orchid Bird Cage Food and Water Dishes US 006
Category: Animals & Pet Supplies > Pet Supplies > Bird Supplies > Bird Cage Accessories > Bird Cage Food & Water Dishes
Market: US
Channel: Amazon
Price: 32.7 USD
Availability: preorder
GTIN: 9501000475146
MPN: NB-HARBO-1006
Status: Draft

## Description
Orchid Bird Cage Food and Water Dishes US 006 — high quality product for US market. Available on Amazon.'),
  ('lst-006', 'Listing Draft — NB-UK-BIR-007', 'file', 'adoc', 1748361600000, 1748361600000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-UK-BIR-007

SKU: NB-UK-BIR-007
Title: Summit Bird Cage Food Dishes UK 007
Category: Animals & Pet Supplies > Pet Supplies > Bird Supplies > Bird Cage Accessories > Bird Cage Food & Water Dishes > Bird Cage Food Dishes
Market: UK
Channel: TikTok Shop
Price: 35.15 GBP
Availability: in_stock
GTIN: 9501000554339
MPN: NB-CEDAR-1007
Status: Draft

## Description
Summit Bird Cage Food Dishes UK 007 — high quality product for UK market. Available on TikTok Shop.'),
  ('lst-007', 'Listing Draft — NB-DE-BIR-008', 'file', 'adoc', 1748365200000, 1748365200000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-DE-BIR-008

SKU: NB-DE-BIR-008
Title: Vector Bird Cage Food Dishes DE 008
Category: Animals & Pet Supplies > Pet Supplies > Bird Supplies > Bird Cage Accessories > Bird Cage Food & Water Dishes > Bird Cage Food Dishes
Market: DE
Channel: Walmart Marketplace
Price: 37.6 EUR
Availability: in_stock
GTIN: 
MPN: NB-NOVA--1008
Status: Draft

## Description
Vector Bird Cage Food Dishes DE 008 — high quality product for DE market. Available on Walmart Marketplace.'),
  ('lst-008', 'Listing Draft — NB-JP-BIR-009', 'file', 'adoc', 1748368800000, 1748368800000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-JP-BIR-009

SKU: NB-JP-BIR-009
Title: Willow Bird Cages and Stands JP 009
Category: Animals & Pet Supplies > Pet Supplies > Bird Supplies > Bird Cages & Stands
Market: JP
Channel: Shopify
Price: 40.05 JPY
Availability: out_of_stock
GTIN: 9501000712715
MPN: NB-BLUEW-1009
Status: Draft

## Description
Willow Bird Cages and Stands JP 009 — high quality product for JP market. Available on Shopify.'),
  ('lst-009', 'Listing Draft — NB-BR-MIR-010', 'file', 'adoc', 1748372400000, 1748372400000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-BR-MIR-010

SKU: NB-BR-MIR-010
Title: Atlas Mirrors BR 010
Category: Animals & Pet Supplies > Pet Supplies > Bird Supplies > Bird Toys > Mirrors
Market: BR
Channel: Google Merchant
Price: 42.5 BRL
Availability: in_stock
GTIN: 9501000791901
MPN: NB-VECTO-1010
Status: Draft

## Description
Atlas Mirrors BR 010 — high quality product for BR market. Available on Google Merchant.'),
  ('lst-010', 'Listing Draft — NB-MX-PRE-011', 'file', 'adoc', 1748376000000, 1748376000000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-MX-PRE-011

SKU: NB-MX-PRE-011
Title: River Prescription Cat Food MX 011
Category: Animals & Pet Supplies > Pet Supplies > Cat Supplies > Cat Food > Prescription Cat Food
Market: MX
Channel: Amazon
Price: 44.95 MXN
Availability: in_stock
GTIN: 9501000871092
MPN: NB-ATLAS-1011
Status: Draft

## Description
River Prescription Cat Food MX 011 — high quality product for MX market. Available on Amazon.'),
  ('lst-011', 'Listing Draft — NB-AU-CAT-012', 'file', 'adoc', 1748379600000, 1748379600000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-AU-CAT-012

SKU: NB-AU-CAT-012
Title: Aurora Cat Steps and Ramps AU 012
Category: Animals & Pet Supplies > Pet Supplies > Cat Supplies > Cat Furniture > Cat Steps & Ramps
Market: AU
Channel: TikTok Shop
Price: 47.4 AUD
Availability: preorder
GTIN: 9501000950285
MPN: NB-ORCHI-1012
Status: Draft

## Description
Aurora Cat Steps and Ramps AU 012 — high quality product for AU market. Available on TikTok Shop.'),
  ('lst-012', 'Listing Draft — NB-SG-CAT-013', 'file', 'adoc', 1748383200000, 1748383200000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-SG-CAT-013

SKU: NB-SG-CAT-013
Title: Cedar Cat Litter Box Mats SG 013
Category: Animals & Pet Supplies > Pet Supplies > Cat Supplies > Cat Litter > Cat Litter Box Mats
Market: SG
Channel: Walmart Marketplace
Price: 49.85 SGD
Availability: backorder
GTIN: 9501001029478
MPN: NB-PRIME-1013
Status: Draft

## Description
Cedar Cat Litter Box Mats SG 013 — high quality product for SG market. Available on Walmart Marketplace.'),
  ('lst-013', 'Listing Draft — NB-US-INT-014', 'file', 'adoc', 1748386800000, 1748386800000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-US-INT-014

SKU: NB-US-INT-014
Title: Harbor Interactive Toys US 014
Category: Animals & Pet Supplies > Pet Supplies > Cat Supplies > Cat Toys > Interactive Toys
Market: US
Channel: Shopify
Price: 52.3 USD
Availability: in_stock
GTIN: 9501001108661
MPN: NB-WILLO-1014
Status: Draft

## Description
Harbor Interactive Toys US 014 — high quality product for US market. Available on Shopify.'),
  ('lst-014', 'Listing Draft — NB-UK-DOG-015', 'file', 'adoc', 1748390400000, 1748390400000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-UK-DOG-015

SKU: NB-UK-DOG-015
Title: Lumen Dog Diaper Pads and Liners UK 015
Category: Animals & Pet Supplies > Pet Supplies > Dog Supplies > Dog Diaper Pads & Liners
Market: UK
Channel: Google Merchant
Price: 54.75 GBP
Availability: in_stock
GTIN: 9501001187857
MPN: NB-PUREB-1015
Status: Draft

## Description
Lumen Dog Diaper Pads and Liners UK 015 — high quality product for UK market. Available on Google Merchant.'),
  ('lst-015', 'Listing Draft — NB-DE-DOG-016', 'file', 'adoc', 1748394000000, 1748394000000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-DE-DOG-016

SKU: NB-DE-DOG-016
Title: Meridian Dog Houses DE 016
Category: Animals & Pet Supplies > Pet Supplies > Dog Supplies > Dog Houses
Market: DE
Channel: Amazon
Price: 57.2 EUR
Availability: in_stock
GTIN: 
MPN: NB-NORTH-1016
Status: Draft

## Description
Meridian Dog Houses DE 016 — high quality product for DE market. Available on Amazon.'),
  ('lst-016', 'Listing Draft — NB-JP-DOG-017', 'file', 'adoc', 1748397600000, 1748397600000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-JP-DOG-017

SKU: NB-JP-DOG-017
Title: Nova Dog Toys JP 017
Category: Animals & Pet Supplies > Pet Supplies > Dog Supplies > Dog Toys
Market: JP
Channel: TikTok Shop
Price: 59.65 JPY
Availability: in_stock
GTIN: 9501001346230
MPN: NB-GREEN-1017
Status: Draft

## Description
Nova Dog Toys JP 017 — high quality product for JP market. Available on TikTok Shop.'),
  ('lst-017', 'Listing Draft — NB-BR-DOG-018', 'file', 'adoc', 1748401200000, 1748401200000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-BR-DOG-018

SKU: NB-BR-DOG-018
Title: Orchid Dog Diaper Pads and Liners BR 018
Category: Animals & Pet Supplies > Pet Supplies > Dog Supplies > Dog Diaper Pads & Liners
Market: BR
Channel: Walmart Marketplace
Price: 62.1 BRL
Availability: out_of_stock
GTIN: 9501001425423
MPN: NB-MERID-1018
Status: Draft

## Description
Orchid Dog Diaper Pads and Liners BR 018 — high quality product for BR market. Available on Walmart Marketplace.'),
  ('lst-018', 'Listing Draft — NB-MX-NON-019', 'file', 'adoc', 1748404800000, 1748404800000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-MX-NON-019

SKU: NB-MX-NON-019
Title: Summit Non-Prescription Dog Food MX 019
Category: Animals & Pet Supplies > Pet Supplies > Dog Supplies > Dog Food > Non-Prescription Dog Food
Market: MX
Channel: Shopify
Price: 64.55 MXN
Availability: in_stock
GTIN: 9501001504616
MPN: NB-BRIGH-1019
Status: Draft

## Description
Summit Non-Prescription Dog Food MX 019 — high quality product for MX market. Available on Shopify.'),
  ('lst-019', 'Listing Draft — NB-AU-PRE-020', 'file', 'adoc', 1748408400000, 1748408400000, 'uid-listops', 'fold-drafts', 'ws-nb-listings', '# Listing Draft — NB-AU-PRE-020

SKU: NB-AU-PRE-020
Title: Vector Prescription Dog Food AU 020
Category: Animals & Pet Supplies > Pet Supplies > Dog Supplies > Dog Food > Prescription Dog Food
Market: AU
Channel: Google Merchant
Price: 67 AUD
Availability: in_stock
GTIN: 9501001583802
MPN: NB-APEX--1020
Status: Draft

## Description
Vector Prescription Dog Food AU 020 — high quality product for AU market. Available on Google Merchant.');

INSERT OR IGNORE INTO comments (commentKey, nodeId, content, type, creatorUid, createTime, resolved, blockId, startOffset, endOffset, selectedText, mentionsJson) VALUES
  ('cmk-0000', 'lst-000', 'Price should be 21.47 JPY, not 20.45', 'global', 'uid-reviewer-a', 1748484000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0001', 'lst-000', 'Add MPN field: NB-SHORE-1001', 'global', 'uid-reviewer-b', 1748487600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0002', 'lst-001', 'GTIN looks wrong — please verify with supplier', 'global', 'uid-reviewer-a', 1748491200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0003', 'lst-001', 'Looks good, approved for this market', 'global', 'uid-reviewer-b', 1748494800000, 1, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0004', 'lst-001', 'Availability should be ''preorder'' not ''in_stock'' for launch items', 'global', 'uid-reviewer-c', 1748498400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0005', 'lst-002', 'Description needs min 150 characters per channel policy', 'global', 'uid-reviewer-a', 1748502000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0006', 'lst-002', 'Price should be 26.62 MXN, not 25.35', 'global', 'uid-reviewer-b', 1748505600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0007', 'lst-002', 'Add MPN field: NB-RIVER-1003', 'global', 'uid-reviewer-c', 1748509200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0008', 'lst-002', 'Is this the correct category? Please confirm.', 'global', 'uid-reviewer-a', 1748512800000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0009', 'lst-003', 'Is this the correct category? Please confirm.', 'global', 'uid-reviewer-a', 1748516400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0010', 'lst-003', 'GTIN looks wrong — please verify with supplier', 'global', 'uid-reviewer-b', 1748520000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0011', 'lst-004', 'Availability should be ''preorder'' not ''in_stock'' for launch items', 'global', 'uid-reviewer-a', 1748523600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0012', 'lst-004', 'Description needs min 150 characters per channel policy', 'global', 'uid-reviewer-b', 1748527200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0013', 'lst-004', 'Price should be 31.76 SGD, not 30.25', 'global', 'uid-reviewer-c', 1748530800000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0014', 'lst-005', 'Add MPN field: NB-HARBO-1006', 'global', 'uid-reviewer-a', 1748534400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0015', 'lst-005', 'Is this the correct category? Please confirm.', 'global', 'uid-reviewer-b', 1748538000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0016', 'lst-005', 'GTIN looks wrong — please verify with supplier', 'global', 'uid-reviewer-c', 1748541600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0017', 'lst-005', 'Looks good, approved for this market', 'global', 'uid-reviewer-a', 1748545200000, 1, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0018', 'lst-006', 'Looks good, approved for this market', 'global', 'uid-reviewer-a', 1748548800000, 1, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0019', 'lst-006', 'Availability should be ''preorder'' not ''in_stock'' for launch items', 'global', 'uid-reviewer-b', 1748552400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0020', 'lst-007', 'Price should be 39.48 EUR, not 37.6', 'global', 'uid-reviewer-a', 1748556000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0021', 'lst-007', 'Add MPN field: NB-NOVA--1008', 'global', 'uid-reviewer-b', 1748559600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0022', 'lst-007', 'Is this the correct category? Please confirm.', 'global', 'uid-reviewer-c', 1748563200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0023', 'lst-008', 'GTIN looks wrong — please verify with supplier', 'global', 'uid-reviewer-a', 1748566800000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0024', 'lst-008', 'Looks good, approved for this market', 'global', 'uid-reviewer-b', 1748570400000, 1, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0025', 'lst-008', 'Availability should be ''preorder'' not ''in_stock'' for launch items', 'global', 'uid-reviewer-c', 1748574000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0026', 'lst-008', 'Description needs min 150 characters per channel policy', 'global', 'uid-reviewer-a', 1748577600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0027', 'lst-009', 'Description needs min 150 characters per channel policy', 'global', 'uid-reviewer-a', 1748581200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0028', 'lst-009', 'Price should be 44.62 BRL, not 42.5', 'global', 'uid-reviewer-b', 1748584800000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0029', 'lst-010', 'Is this the correct category? Please confirm.', 'global', 'uid-reviewer-a', 1748588400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0030', 'lst-010', 'GTIN looks wrong — please verify with supplier', 'global', 'uid-reviewer-b', 1748592000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0031', 'lst-010', 'Looks good, approved for this market', 'global', 'uid-reviewer-c', 1748595600000, 1, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0032', 'lst-011', 'Availability should be ''preorder'' not ''in_stock'' for launch items', 'global', 'uid-reviewer-a', 1748599200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0033', 'lst-011', 'Description needs min 150 characters per channel policy', 'global', 'uid-reviewer-b', 1748602800000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0034', 'lst-011', 'Price should be 49.77 AUD, not 47.4', 'global', 'uid-reviewer-c', 1748606400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0035', 'lst-011', 'Add MPN field: NB-ORCHI-1012', 'global', 'uid-reviewer-a', 1748610000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0036', 'lst-012', 'Add MPN field: NB-PRIME-1013', 'global', 'uid-reviewer-a', 1748613600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0037', 'lst-012', 'Is this the correct category? Please confirm.', 'global', 'uid-reviewer-b', 1748617200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0038', 'lst-013', 'Looks good, approved for this market', 'global', 'uid-reviewer-a', 1748620800000, 1, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0039', 'lst-013', 'Availability should be ''preorder'' not ''in_stock'' for launch items', 'global', 'uid-reviewer-b', 1748624400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0040', 'lst-013', 'Description needs min 150 characters per channel policy', 'global', 'uid-reviewer-c', 1748628000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0041', 'lst-014', 'Price should be 57.49 GBP, not 54.75', 'global', 'uid-reviewer-a', 1748631600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0042', 'lst-014', 'Add MPN field: NB-PUREB-1015', 'global', 'uid-reviewer-b', 1748635200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0043', 'lst-014', 'Is this the correct category? Please confirm.', 'global', 'uid-reviewer-c', 1748638800000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0044', 'lst-014', 'GTIN looks wrong — please verify with supplier', 'global', 'uid-reviewer-a', 1748642400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0045', 'lst-015', 'GTIN looks wrong — please verify with supplier', 'global', 'uid-reviewer-a', 1748646000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0046', 'lst-015', 'Looks good, approved for this market', 'global', 'uid-reviewer-b', 1748649600000, 1, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0047', 'lst-016', 'Description needs min 150 characters per channel policy', 'global', 'uid-reviewer-a', 1748653200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0048', 'lst-016', 'Price should be 62.63 JPY, not 59.65', 'global', 'uid-reviewer-b', 1748656800000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0049', 'lst-016', 'Add MPN field: NB-GREEN-1017', 'global', 'uid-reviewer-c', 1748660400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0050', 'lst-017', 'Is this the correct category? Please confirm.', 'global', 'uid-reviewer-a', 1748664000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0051', 'lst-017', 'GTIN looks wrong — please verify with supplier', 'global', 'uid-reviewer-b', 1748667600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0052', 'lst-017', 'Looks good, approved for this market', 'global', 'uid-reviewer-c', 1748671200000, 1, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0053', 'lst-017', 'Availability should be ''preorder'' not ''in_stock'' for launch items', 'global', 'uid-reviewer-a', 1748674800000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0054', 'lst-018', 'Availability should be ''preorder'' not ''in_stock'' for launch items', 'global', 'uid-reviewer-a', 1748678400000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0055', 'lst-018', 'Description needs min 150 characters per channel policy', 'global', 'uid-reviewer-b', 1748682000000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0056', 'lst-019', 'Add MPN field: NB-APEX--1020', 'global', 'uid-reviewer-a', 1748685600000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0057', 'lst-019', 'Is this the correct category? Please confirm.', 'global', 'uid-reviewer-b', 1748689200000, 0, NULL, NULL, NULL, NULL, '[]'),
  ('cmk-0058', 'lst-019', 'GTIN looks wrong — please verify with supplier', 'global', 'uid-reviewer-c', 1748692800000, 0, NULL, NULL, NULL, NULL, '[]');
