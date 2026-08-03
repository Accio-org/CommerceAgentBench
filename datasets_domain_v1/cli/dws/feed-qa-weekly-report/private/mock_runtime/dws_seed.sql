-- Seed for dws-feed-qa-weekly-report
DELETE FROM comment_replies;
DELETE FROM comments;
DELETE FROM blocks;
DELETE FROM documents;
DELETE FROM mock_config;

INSERT INTO mock_config (key, value) VALUES
  ('defaultWorkspaceId', 'ws-nb-ops'),
  ('defaultFolderId', 'fold-root'),
  ('mockUserId', 'uid-mktops'),
  ('mockUserName', 'Marketplace Ops'),
  ('mockCorpId', 'corp-northbridge'),
  ('mockCorpName', 'NorthBridge Accessories');

INSERT OR IGNORE INTO documents (nodeId, name, type, extension, createTime, lastEditTime, creatorUid, parentId, workspaceId, content) VALUES
  ('fold-root', 'NorthBridge Operations KB', 'folder', 'folder', 1747699200000, 1747699200000, 'uid-mktops', NULL, 'ws-nb-ops', ''),
  ('fold-qa', 'Merchant Feed QA', 'folder', 'folder', 1747702800000, 1747702800000, 'uid-mktops', 'fold-root', 'ws-nb-ops', ''),
  ('fold-archive', 'Archive — Prior Cycles', 'folder', 'folder', 1747706400000, 1747706400000, 'uid-mktops', 'fold-root', 'ws-nb-ops', ''),
  ('doc-old-summary', 'Week 20 Feed QA Summary', 'file', 'adoc', 1747710000000, 1747710000000, 'uid-mktops', 'fold-archive', 'ws-nb-ops', '# Week 20 Feed QA Summary

This is from the prior review cycle. Do not reference.'),
  ('fold-qa-au', 'AU Market', 'folder', 'folder', 1747717200000, 1747717200000, 'uid-mktops', 'fold-qa', 'ws-nb-ops', ''),
  ('fold-qa-br', 'BR Market', 'folder', 'folder', 1747717200000, 1747717200000, 'uid-mktops', 'fold-qa', 'ws-nb-ops', ''),
  ('fold-qa-de', 'DE Market', 'folder', 'folder', 1747717200000, 1747717200000, 'uid-mktops', 'fold-qa', 'ws-nb-ops', ''),
  ('fold-qa-jp', 'JP Market', 'folder', 'folder', 1747717200000, 1747717200000, 'uid-mktops', 'fold-qa', 'ws-nb-ops', ''),
  ('fold-qa-mx', 'MX Market', 'folder', 'folder', 1747717200000, 1747717200000, 'uid-mktops', 'fold-qa', 'ws-nb-ops', ''),
  ('fold-qa-sg', 'SG Market', 'folder', 'folder', 1747717200000, 1747717200000, 'uid-mktops', 'fold-qa', 'ws-nb-ops', ''),
  ('fold-qa-uk', 'UK Market', 'folder', 'folder', 1747717200000, 1747717200000, 'uid-mktops', 'fold-qa', 'ws-nb-ops', ''),
  ('fold-qa-us', 'US Market', 'folder', 'folder', 1747717200000, 1747717200000, 'uid-mktops', 'fold-qa', 'ws-nb-ops', ''),
  ('qa-000', 'Feed QA — NB-JP-PET-001', 'file', 'adoc', 1747735200000, 1747735200000, 'uid-mktops', 'fold-qa-jp', 'ws-nb-ops', '# Feed QA — NB-JP-PET-001

SKU: NB-JP-PET-001
Product: Cedar Pet Bed Accessories JP 001
Market: JP
Channel: Amazon
Issue Code: DIMENSION_UNIT_MIX
Domain: Catalog Detail
Severity: Medium
Owner: marketplace.ops@northbridge.example.com
Expected Action: normalize length, width, height, and package weight units in product detail data
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-001', 'Feed QA — NB-BR-PET-002', 'file', 'adoc', 1747738800000, 1747738800000, 'uid-mktops', 'fold-qa-br', 'ws-nb-ops', '# Feed QA — NB-BR-PET-002

SKU: NB-BR-PET-002
Product: Harbor Pet Containment Systems BR 002
Market: BR
Channel: TikTok Shop
Issue Code: DRAFT_STATUS_BLOCKER
Domain: Product Catalog
Severity: High
Owner: supplier.ops@northbridge.example.com
Expected Action: complete catalog detail and move product out of Draft only after required fields are approved
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-002', 'Feed QA — NB-MX-PET-003', 'file', 'adoc', 1747742400000, 1747742400000, 'uid-mktops', 'fold-qa-mx', 'ws-nb-ops', '# Feed QA — NB-MX-PET-003

SKU: NB-MX-PET-003
Product: Lumen Pet Heating Pad Accessories MX 003
Market: MX
Channel: Walmart Marketplace
Issue Code: MPN_GTIN_GAP
Domain: Identifier QA
Severity: Medium
Owner: inventory.ops@northbridge.example.com
Expected Action: confirm whether GTIN is truly unavailable and backfill MPN/brand evidence
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-003', 'Feed QA — NB-AU-PET-004', 'file', 'adoc', 1747746000000, 1747746000000, 'uid-mktops', 'fold-archive', 'ws-nb-ops', '# Feed QA — NB-AU-PET-004

SKU: NB-AU-PET-004
Product: Meridian Pet Waste Disposal Systems and Tools AU 004
Market: AU
Channel: Shopify
Issue Code: TRANSFER_PARTIAL_RECEIPT
Domain: Inventory
Severity: High
Owner: artwork.ops@northbridge.example.com
Expected Action: split transfer receipt, record tracking, and keep shortage open until reconciled
Review Cycle: Week 20 (prior cycle — archived)
Status: Open'),
  ('qa-004', 'Feed QA — NB-SG-BIR-005', 'file', 'adoc', 1747749600000, 1747749600000, 'uid-mktops', 'fold-qa-sg', 'ws-nb-ops', '# Feed QA — NB-SG-BIR-005

SKU: NB-SG-BIR-005
Product: Nova Bird Ladders and Perches SG 005
Market: SG
Channel: Google Merchant
Issue Code: BAD_LANDING_PAGE
Domain: Feed Quality
Severity: High
Owner: cx.ops@northbridge.example.com
Expected Action: point feed link to canonical product page and remove interstitial redirect
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-005', 'Feed QA — NB-US-BIR-006', 'file', 'adoc', 1747753200000, 1747753200000, 'uid-mktops', 'fold-qa-jp', 'ws-nb-ops', '# Feed QA — NB-US-BIR-006

SKU: NB-US-BIR-006
Product: Orchid Bird Cage Food and Water Dishes US 006
Market: US
Channel: Amazon
Issue Code: PROMOTIONAL_HIGHLIGHT
Domain: Listing Content
Severity: Medium
Owner: compliance@northbridge.example.com
Expected Action: rewrite product highlight to remove promotional or duplicate detail language
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-006', 'Feed QA — NB-UK-BIR-007', 'file', 'adoc', 1747756800000, 1747756800000, 'uid-mktops', 'fold-qa-uk', 'ws-nb-ops', '# Feed QA — NB-UK-BIR-007

SKU: NB-UK-BIR-007
Product: Summit Bird Cage Food Dishes UK 007
Market: UK
Channel: TikTok Shop
Issue Code: UNLISTED_CHANNEL_RISK
Domain: Product Catalog
Severity: Medium
Owner: growth.ops@northbridge.example.com
Expected Action: confirm product can be discovered on the intended channel or document direct-link-only scope
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-007', 'Team Standup Notes', 'file', 'adoc', 1747760400000, 1747760400000, 'uid-mktops', 'fold-qa-de', 'ws-nb-ops', '# Standup Notes 2026-05-28

- Feed pipeline stable
- No escalations
- Next standup Friday'),
  ('qa-008', 'Feed QA — NB-JP-BIR-009', 'file', 'adoc', 1747764000000, 1747764000000, 'uid-mktops', 'fold-qa-jp', 'ws-nb-ops', '# Feed QA — NB-JP-BIR-009

SKU: NB-JP-BIR-009
Product: Willow Bird Cages and Stands JP 009
Market: JP
Channel: Shopify
Issue Code: RETURN_POLICY_CONFLICT
Domain: Customer Experience
Severity: Medium
Owner: marketplace.ops@northbridge.example.com
Expected Action: align product page, merchant settings, and support macro before next publish
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-009', 'Feed QA — NB-BR-MIR-010', 'file', 'adoc', 1747767600000, 1747767600000, 'uid-mktops', 'fold-qa-br', 'ws-nb-ops', '# Feed QA — NB-BR-MIR-010

SKU: NB-BR-MIR-010
Product: Atlas Mirrors BR 010
Market: BR
Channel: Google Merchant
Issue Code: AVAILABILITY_MISMATCH
Domain: Inventory
Severity: Highest
Owner: supplier.ops@northbridge.example.com
Expected Action: reconcile stock truth against feed availability before campaign launch
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-010', 'Feed QA — NB-MX-PRE-011', 'file', 'adoc', 1747771200000, 1747771200000, 'uid-mktops', 'fold-qa-mx', 'ws-nb-ops', '# Feed QA — NB-MX-PRE-011

SKU: NB-MX-PRE-011
Product: River Prescription Cat Food MX 011
Market: MX
Channel: Amazon
Issue Code: CATEGORY_UNCATEGORIZED
Domain: Product Catalog
Severity: High
Owner: inventory.ops@northbridge.example.com
Expected Action: assign a predefined Shopify taxonomy breadcrumb and verify sales-channel fit
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-011', 'Feed QA — NB-AU-CAT-012', 'file', 'adoc', 1747774800000, 1747774800000, 'uid-mktops', 'fold-archive', 'ws-nb-ops', '# Feed QA — NB-AU-CAT-012

SKU: NB-AU-CAT-012
Product: Aurora Cat Steps and Ramps AU 012
Market: AU
Channel: TikTok Shop
Issue Code: MISSING_MAIN_IMAGE
Domain: Feed Quality
Severity: High
Owner: artwork.ops@northbridge.example.com
Expected Action: replace placeholder image and confirm image URL resolves from verified merchant domain
Review Cycle: Week 20 (prior cycle — archived)
Status: Open'),
  ('qa-012', 'Feed QA — NB-SG-CAT-013', 'file', 'adoc', 1747778400000, 1747778400000, 'uid-mktops', 'fold-qa-sg', 'ws-nb-ops', '# Feed QA — NB-SG-CAT-013

SKU: NB-SG-CAT-013
Product: Cedar Cat Litter Box Mats SG 013
Market: SG
Channel: Walmart Marketplace
Issue Code: DIMENSION_UNIT_MIX
Domain: Catalog Detail
Severity: Medium
Owner: cx.ops@northbridge.example.com
Expected Action: normalize length, width, height, and package weight units in product detail data
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-013', 'Feed QA — NB-US-INT-014', 'file', 'adoc', 1747782000000, 1747782000000, 'uid-mktops', 'fold-qa-us', 'ws-nb-ops', '# Feed QA — NB-US-INT-014

SKU: NB-US-INT-014
Product: Harbor Interactive Toys US 014
Market: US
Channel: Shopify
Issue Code: DRAFT_STATUS_BLOCKER
Domain: Product Catalog
Severity: High
Owner: compliance@northbridge.example.com
Expected Action: complete catalog detail and move product out of Draft only after required fields are approved
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-014', 'Feed QA — NB-UK-DOG-015', 'file', 'adoc', 1747785600000, 1747785600000, 'uid-mktops', 'fold-qa-de', 'ws-nb-ops', '# Feed QA — NB-UK-DOG-015

SKU: NB-UK-DOG-015
Product: Lumen Dog Diaper Pads and Liners UK 015
Market: UK
Channel: Google Merchant
Issue Code: MPN_GTIN_GAP
Domain: Identifier QA
Severity: Medium
Owner: growth.ops@northbridge.example.com
Expected Action: confirm whether GTIN is truly unavailable and backfill MPN/brand evidence
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-015', 'Channel Onboarding Checklist', 'file', 'adoc', 1747789200000, 1747789200000, 'uid-mktops', 'fold-qa-de', 'ws-nb-ops', '# Channel Onboarding Checklist

- [ ] API credentials
- [ ] Feed template
- [ ] Test submission
- [x] Contract signed'),
  ('qa-016', 'Feed QA — NB-JP-DOG-017', 'file', 'adoc', 1747792800000, 1747792800000, 'uid-mktops', 'fold-qa-jp', 'ws-nb-ops', '# Feed QA — NB-JP-DOG-017

SKU: NB-JP-DOG-017
Product: Nova Dog Toys JP 017
Market: JP
Channel: TikTok Shop
Issue Code: BAD_LANDING_PAGE
Domain: Feed Quality
Severity: High
Owner: marketplace.ops@northbridge.example.com
Expected Action: point feed link to canonical product page and remove interstitial redirect
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-017', 'Feed QA — NB-BR-DOG-018', 'file', 'adoc', 1747796400000, 1747796400000, 'uid-mktops', 'fold-qa-br', 'ws-nb-ops', '# Feed QA — NB-BR-DOG-018

SKU: NB-BR-DOG-018
Product: Orchid Dog Diaper Pads and Liners BR 018
Market: BR
Channel: Walmart Marketplace
Issue Code: PROMOTIONAL_HIGHLIGHT
Domain: Listing Content
Severity: Medium
Owner: supplier.ops@northbridge.example.com
Expected Action: rewrite product highlight to remove promotional or duplicate detail language
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-018', 'Feed QA — NB-MX-NON-019', 'file', 'adoc', 1747800000000, 1747800000000, 'uid-mktops', 'fold-qa-mx', 'ws-nb-ops', '# Feed QA — NB-MX-NON-019

SKU: NB-MX-NON-019
Product: Summit Non-Prescription Dog Food MX 019
Market: MX
Channel: Shopify
Issue Code: UNLISTED_CHANNEL_RISK
Domain: Product Catalog
Severity: Medium
Owner: inventory.ops@northbridge.example.com
Expected Action: confirm product can be discovered on the intended channel or document direct-link-only scope
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-019', 'Feed QA — NB-AU-PRE-020', 'file', 'adoc', 1747803600000, 1747803600000, 'uid-mktops', 'fold-archive', 'ws-nb-ops', '# Feed QA — NB-AU-PRE-020

SKU: NB-AU-PRE-020
Product: Vector Prescription Dog Food AU 020
Market: AU
Channel: Google Merchant
Issue Code: EU_CERT_CODE_MISSING
Domain: Compliance
Severity: High
Owner: artwork.ops@northbridge.example.com
Expected Action: add certification authority, name, and code from approved certificate record
Review Cycle: Week 20 (prior cycle — archived)
Status: Open'),
  ('qa-020', 'Feed QA — NB-SG-DOG-021', 'file', 'adoc', 1747807200000, 1747807200000, 'uid-mktops', 'fold-qa-sg', 'ws-nb-ops', '# Feed QA — NB-SG-DOG-021

SKU: NB-SG-DOG-021
Product: Willow Dog Kennels and Runs SG 021
Market: SG
Channel: Amazon
Issue Code: RETURN_POLICY_CONFLICT
Domain: Customer Experience
Severity: Medium
Owner: cx.ops@northbridge.example.com
Expected Action: align product page, merchant settings, and support macro before next publish
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-021', 'Feed QA — NB-US-FIS-022', 'file', 'adoc', 1747810800000, 1747810800000, 'uid-mktops', 'fold-qa-us', 'ws-nb-ops', '# Feed QA — NB-US-FIS-022

SKU: NB-US-FIS-022
Product: Atlas Fish and Aquatic Supplies US 022
Market: US
Channel: TikTok Shop
Issue Code: AVAILABILITY_MISMATCH
Domain: Inventory
Severity: Highest
Owner: compliance@northbridge.example.com
Expected Action: reconcile stock truth against feed availability before campaign launch
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-022', 'Feed QA — NB-UK-PET-023', 'file', 'adoc', 1747814400000, 1747814400000, 'uid-mktops', 'fold-qa-au', 'ws-nb-ops', '# Feed QA — NB-UK-PET-023

SKU: NB-UK-PET-023
Product: River Pet Carrier and Crate Accessories UK 023
Market: UK
Channel: Walmart Marketplace
Issue Code: CATEGORY_UNCATEGORIZED
Domain: Product Catalog
Severity: High
Owner: growth.ops@northbridge.example.com
Expected Action: assign a predefined Shopify taxonomy breadcrumb and verify sales-channel fit
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-023', 'Holiday Calendar Memo', 'file', 'adoc', 1747818000000, 1747818000000, 'uid-mktops', 'fold-qa-de', 'ws-nb-ops', '# Holiday Calendar — Shipping Cutoffs

JP: Golden Week 2026-04-29 to 2026-05-05
DE: Whitsun 2026-05-25
US: Memorial Day 2026-05-26'),
  ('qa-024', 'Feed QA — NB-JP-PET-025', 'file', 'adoc', 1747821600000, 1747821600000, 'uid-mktops', 'fold-qa-jp', 'ws-nb-ops', '# Feed QA — NB-JP-PET-025

SKU: NB-JP-PET-025
Product: Cedar Pet Sunscreen JP 025
Market: JP
Channel: Google Merchant
Issue Code: DIMENSION_UNIT_MIX
Domain: Catalog Detail
Severity: Medium
Owner: marketplace.ops@northbridge.example.com
Expected Action: normalize length, width, height, and package weight units in product detail data
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-025', 'Feed QA — NB-BR-BIR-026', 'file', 'adoc', 1747825200000, 1747825200000, 'uid-mktops', 'fold-qa-br', 'ws-nb-ops', '# Feed QA — NB-BR-BIR-026

SKU: NB-BR-BIR-026
Product: Harbor Bird Cage Accessories BR 026
Market: BR
Channel: Amazon
Issue Code: DRAFT_STATUS_BLOCKER
Domain: Product Catalog
Severity: High
Owner: supplier.ops@northbridge.example.com
Expected Action: complete catalog detail and move product out of Draft only after required fields are approved
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-026', 'Feed QA — NB-MX-BIR-027', 'file', 'adoc', 1747828800000, 1747828800000, 'uid-mktops', 'fold-qa-mx', 'ws-nb-ops', '# Feed QA — NB-MX-BIR-027

SKU: NB-MX-BIR-027
Product: Lumen Bird Cage Bird Baths MX 027
Market: MX
Channel: TikTok Shop
Issue Code: MPN_GTIN_GAP
Domain: Identifier QA
Severity: Medium
Owner: inventory.ops@northbridge.example.com
Expected Action: confirm whether GTIN is truly unavailable and backfill MPN/brand evidence
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-027', 'Feed QA — NB-AU-BIR-028', 'file', 'adoc', 1747832400000, 1747832400000, 'uid-mktops', 'fold-archive', 'ws-nb-ops', '# Feed QA — NB-AU-BIR-028

SKU: NB-AU-BIR-028
Product: Meridian Bird Cage Food and Water Dishes AU 028
Market: AU
Channel: Walmart Marketplace
Issue Code: TRANSFER_PARTIAL_RECEIPT
Domain: Inventory
Severity: High
Owner: artwork.ops@northbridge.example.com
Expected Action: split transfer receipt, record tracking, and keep shortage open until reconciled
Review Cycle: Week 20 (prior cycle — archived)
Status: Open'),
  ('qa-028', 'Feed QA — NB-SG-COM-029', 'file', 'adoc', 1747836000000, 1747836000000, 'uid-mktops', 'fold-qa-sg', 'ws-nb-ops', '# Feed QA — NB-SG-COM-029

SKU: NB-SG-COM-029
Product: Nova Combined Bird Cage Food and Water Dishes SG 029
Market: SG
Channel: Shopify
Issue Code: BAD_LANDING_PAGE
Domain: Feed Quality
Severity: High
Owner: cx.ops@northbridge.example.com
Expected Action: point feed link to canonical product page and remove interstitial redirect
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-029', 'Feed QA — NB-US-COM-030', 'file', 'adoc', 1747839600000, 1747839600000, 'uid-mktops', 'fold-qa-us', 'ws-nb-ops', '# Feed QA — NB-US-COM-030

SKU: NB-US-COM-030
Product: Orchid Combined Bird Cage Food and Water Dishes US 030
Market: US
Channel: Google Merchant
Issue Code: PROMOTIONAL_HIGHLIGHT
Domain: Listing Content
Severity: Medium
Owner: compliance@northbridge.example.com
Expected Action: rewrite product highlight to remove promotional or duplicate detail language
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-030', 'Feed QA — NB-UK-PUZ-031', 'file', 'adoc', 1747843200000, 1747843200000, 'uid-mktops', 'fold-qa-uk', 'ws-nb-ops', '# Feed QA — NB-UK-PUZ-031

SKU: NB-UK-PUZ-031
Product: Summit Puzzles and Interactive Toys UK 031
Market: UK
Channel: Amazon
Issue Code: UNLISTED_CHANNEL_RISK
Domain: Product Catalog
Severity: Medium
Owner: growth.ops@northbridge.example.com
Expected Action: confirm product can be discovered on the intended channel or document direct-link-only scope
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-031', 'Feed Schema Reference', 'file', 'adoc', 1747846800000, 1747846800000, 'uid-mktops', 'fold-qa-de', 'ws-nb-ops', '# Feed Schema Reference

See Google Merchant Center product data specification.
Required: title, description, link, image_link, price, availability.'),
  ('qa-032', 'Feed QA — NB-JP-OUT-033', 'file', 'adoc', 1747850400000, 1747850400000, 'uid-mktops', 'fold-qa-jp', 'ws-nb-ops', '# Feed QA — NB-JP-OUT-033

SKU: NB-JP-OUT-033
Product: Willow Outdoor Cat Houses JP 033
Market: JP
Channel: Walmart Marketplace
Issue Code: RETURN_POLICY_CONFLICT
Domain: Customer Experience
Severity: Medium
Owner: marketplace.ops@northbridge.example.com
Expected Action: align product page, merchant settings, and support macro before next publish
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-033', 'Feed QA — NB-BR-CAT-034', 'file', 'adoc', 1747854000000, 1747854000000, 'uid-mktops', 'fold-qa-br', 'ws-nb-ops', '# Feed QA — NB-BR-CAT-034

SKU: NB-BR-CAT-034
Product: Atlas Cat Furniture Accessories BR 034
Market: BR
Channel: Shopify
Issue Code: AVAILABILITY_MISMATCH
Domain: Inventory
Severity: Highest
Owner: supplier.ops@northbridge.example.com
Expected Action: reconcile stock truth against feed availability before campaign launch
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-034', 'Feed QA — NB-MX-STU-035', 'file', 'adoc', 1747857600000, 1747857600000, 'uid-mktops', 'fold-qa-mx', 'ws-nb-ops', '# Feed QA — NB-MX-STU-035

SKU: NB-MX-STU-035
Product: River Stuffed Toys and Plushies MX 035
Market: MX
Channel: Google Merchant
Issue Code: CATEGORY_UNCATEGORIZED
Domain: Product Catalog
Severity: High
Owner: inventory.ops@northbridge.example.com
Expected Action: assign a predefined Shopify taxonomy breadcrumb and verify sales-channel fit
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-035', 'Feed QA — NB-AU-DOG-036', 'file', 'adoc', 1747861200000, 1747861200000, 'uid-mktops', 'fold-archive', 'ws-nb-ops', '# Feed QA — NB-AU-DOG-036

SKU: NB-AU-DOG-036
Product: Aurora Dog Supplies AU 036
Market: AU
Channel: Amazon
Issue Code: MISSING_MAIN_IMAGE
Domain: Feed Quality
Severity: High
Owner: artwork.ops@northbridge.example.com
Expected Action: replace placeholder image and confirm image URL resolves from verified merchant domain
Review Cycle: Week 20 (prior cycle — archived)
Status: Open'),
  ('qa-036', 'Feed QA — NB-SG-DOG-037', 'file', 'adoc', 1747864800000, 1747864800000, 'uid-mktops', 'fold-qa-sg', 'ws-nb-ops', '# Feed QA — NB-SG-DOG-037

SKU: NB-SG-DOG-037
Product: Cedar Dog Food SG 037
Market: SG
Channel: TikTok Shop
Issue Code: DIMENSION_UNIT_MIX
Domain: Catalog Detail
Severity: Medium
Owner: cx.ops@northbridge.example.com
Expected Action: normalize length, width, height, and package weight units in product detail data
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-037', 'Feed QA — NB-US-DOG-038', 'file', 'adoc', 1747868400000, 1747868400000, 'uid-mktops', 'fold-qa-us', 'ws-nb-ops', '# Feed QA — NB-US-DOG-038

SKU: NB-US-DOG-038
Product: Harbor Dog Kennels and Runs US 038
Market: US
Channel: Walmart Marketplace
Issue Code: DRAFT_STATUS_BLOCKER
Domain: Product Catalog
Severity: High
Owner: compliance@northbridge.example.com
Expected Action: complete catalog detail and move product out of Draft only after required fields are approved
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-038', 'Feed QA — NB-UK-DOG-039', 'file', 'adoc', 1747872000000, 1747872000000, 'uid-mktops', 'fold-qa-uk', 'ws-nb-ops', '# Feed QA — NB-UK-DOG-039

SKU: NB-UK-DOG-039
Product: Lumen Dog Treats UK 039
Market: UK
Channel: Shopify
Issue Code: MPN_GTIN_GAP
Domain: Identifier QA
Severity: Medium
Owner: growth.ops@northbridge.example.com
Expected Action: confirm whether GTIN is truly unavailable and backfill MPN/brand evidence
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-039', 'Feed QA — NB-DE-DOG-040', 'file', 'adoc', 1747875600000, 1747875600000, 'uid-mktops', 'fold-qa-de', 'ws-nb-ops', '# Feed QA — NB-DE-DOG-040

SKU: NB-DE-DOG-040
Product: Meridian Dog Food DE 040
Market: DE
Channel: Google Merchant
Issue Code: TRANSFER_PARTIAL_RECEIPT
Domain: Inventory
Severity: High
Owner: catalog.ops@northbridge.example.com
Expected Action: split transfer receipt, record tracking, and keep shortage open until reconciled
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-040', 'Feed QA — NB-JP-NON-041', 'file', 'adoc', 1747879200000, 1747879200000, 'uid-mktops', 'fold-qa-jp', 'ws-nb-ops', '# Feed QA — NB-JP-NON-041

SKU: NB-JP-NON-041
Product: Nova Non-Prescription Dog Food JP 041
Market: JP
Channel: Amazon
Issue Code: BAD_LANDING_PAGE
Domain: Feed Quality
Severity: High
Owner: marketplace.ops@northbridge.example.com
Expected Action: point feed link to canonical product page and remove interstitial redirect
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-041', 'Feed QA — NB-BR-DOG-042', 'file', 'adoc', 1747882800000, 1747882800000, 'uid-mktops', 'fold-qa-br', 'ws-nb-ops', '# Feed QA — NB-BR-DOG-042

SKU: NB-BR-DOG-042
Product: Orchid Dog Kennel and Run Accessories BR 042
Market: BR
Channel: TikTok Shop
Issue Code: PROMOTIONAL_HIGHLIGHT
Domain: Listing Content
Severity: Medium
Owner: supplier.ops@northbridge.example.com
Expected Action: rewrite product highlight to remove promotional or duplicate detail language
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-042', 'Feed QA — NB-MX-DOG-043', 'file', 'adoc', 1747886400000, 1747886400000, 'uid-mktops', 'fold-qa-mx', 'ws-nb-ops', '# Feed QA — NB-MX-DOG-043

SKU: NB-MX-DOG-043
Product: Summit Dog Supplies MX 043
Market: MX
Channel: Walmart Marketplace
Issue Code: UNLISTED_CHANNEL_RISK
Domain: Product Catalog
Severity: Medium
Owner: inventory.ops@northbridge.example.com
Expected Action: confirm product can be discovered on the intended channel or document direct-link-only scope
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-043', 'Feed QA — NB-AU-PET-044', 'file', 'adoc', 1747890000000, 1747890000000, 'uid-mktops', 'fold-archive', 'ws-nb-ops', '# Feed QA — NB-AU-PET-044

SKU: NB-AU-PET-044
Product: Vector Pet Biometric Monitors AU 044
Market: AU
Channel: Shopify
Issue Code: EU_CERT_CODE_MISSING
Domain: Compliance
Severity: High
Owner: artwork.ops@northbridge.example.com
Expected Action: add certification authority, name, and code from approved certificate record
Review Cycle: Week 20 (prior cycle — archived)
Status: Open'),
  ('qa-044', 'Feed QA — NB-SG-PET-045', 'file', 'adoc', 1747893600000, 1747893600000, 'uid-mktops', 'fold-qa-sg', 'ws-nb-ops', '# Feed QA — NB-SG-PET-045

SKU: NB-SG-PET-045
Product: Willow Pet Door Accessories SG 045
Market: SG
Channel: Google Merchant
Issue Code: RETURN_POLICY_CONFLICT
Domain: Customer Experience
Severity: Medium
Owner: cx.ops@northbridge.example.com
Expected Action: align product page, merchant settings, and support macro before next publish
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-045', 'Feed QA — NB-US-PET-046', 'file', 'adoc', 1747897200000, 1747897200000, 'uid-mktops', 'fold-qa-us', 'ws-nb-ops', '# Feed QA — NB-US-PET-046

SKU: NB-US-PET-046
Product: Atlas Pet Medical Collars US 046
Market: US
Channel: Amazon
Issue Code: AVAILABILITY_MISMATCH
Domain: Inventory
Severity: Highest
Owner: compliance@northbridge.example.com
Expected Action: reconcile stock truth against feed availability before campaign launch
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-046', 'Feed QA — NB-UK-SMA-047', 'file', 'adoc', 1747900800000, 1747900800000, 'uid-mktops', 'fold-qa-uk', 'ws-nb-ops', '# Feed QA — NB-UK-SMA-047

SKU: NB-UK-SMA-047
Product: River Small Animal Supplies UK 047
Market: UK
Channel: TikTok Shop
Issue Code: CATEGORY_UNCATEGORIZED
Domain: Product Catalog
Severity: High
Owner: growth.ops@northbridge.example.com
Expected Action: assign a predefined Shopify taxonomy breadcrumb and verify sales-channel fit
Review Cycle: Week 23 (current)
Status: Open'),
  ('qa-047', 'Feed QA — NB-DE-BIR-048', 'file', 'adoc', 1747904400000, 1747904400000, 'uid-mktops', 'fold-qa-de', 'ws-nb-ops', '# Feed QA — NB-DE-BIR-048

SKU: NB-DE-BIR-048
Product: Aurora Bird Cage Accessories DE 048
Market: DE
Channel: Walmart Marketplace
Issue Code: MISSING_MAIN_IMAGE
Domain: Feed Quality
Severity: High
Owner: catalog.ops@northbridge.example.com
Expected Action: replace placeholder image and confirm image URL resolves from verified merchant domain
Review Cycle: Week 23 (current)
Status: Open');
