-- Seed for dws-po-exception-triage
DELETE FROM comment_replies;
DELETE FROM comments;
DELETE FROM blocks;
DELETE FROM documents;
DELETE FROM mock_config;

INSERT INTO mock_config (key, value) VALUES
  ('defaultWorkspaceId', 'ws-nb-scm'),
  ('defaultFolderId', 'fold-root'),
  ('mockUserId', 'uid-scmops'),
  ('mockUserName', 'SCM Ops'),
  ('mockCorpId', 'corp-northbridge'),
  ('mockCorpName', 'NorthBridge Accessories');

INSERT OR IGNORE INTO documents (nodeId, name, type, extension, createTime, lastEditTime, creatorUid, parentId, workspaceId, content) VALUES
  ('fold-root', 'NorthBridge SCM KB', 'folder', 'folder', 1747699200000, 1747699200000, 'uid-scmops', NULL, 'ws-nb-scm', ''),
  ('fold-active', 'Active POs', 'folder', 'folder', 1747702800000, 1747702800000, 'uid-scmops', 'fold-root', 'ws-nb-scm', ''),
  ('fold-triage-urgent', 'Triage — Urgent', 'folder', 'folder', 1747706400000, 1747706400000, 'uid-scmops', 'fold-root', 'ws-nb-scm', ''),
  ('fold-triage-standard', 'Triage — Standard', 'folder', 'folder', 1747710000000, 1747710000000, 'uid-scmops', 'fold-root', 'ws-nb-scm', ''),
  ('fold-closed', 'Closed POs', 'folder', 'folder', 1747713600000, 1747713600000, 'uid-scmops', 'fold-root', 'ws-nb-scm', ''),
  ('doc-triage-tmpl', 'Triage Report Template', 'file', 'adoc', 1747717200000, 1747717200000, 'uid-scmops', 'fold-root', 'ws-nb-scm', '# Triage Report — [PO NUMBER]

PO: 
SKU: 
Supplier: 
Exception Type: 
Severity: 
Recommended Action: 
Notes: '),
  ('po-000', 'PO — PO-8801', 'file', 'adoc', 1747735200000, 1747735200000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8801

PO Number: PO-8801
SKU: NB-MX-PET-003
Supplier: RiverWorks Metal
Origin: Ningbo
Destination: LGB
Status: Booked
ETD: 2026-05-25
ETA: 2026-06-10
Units: 437
Risk: none'),
  ('po-001', 'PO — PO-8802', 'file', 'adoc', 1747738800000, 1747738800000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8802

PO Number: PO-8802
SKU: NB-SG-BIR-005
Supplier: SunPeak Cable
Origin: Qingdao
Destination: SEA
Status: Booked
ETD: 2026-05-26
ETA: 2026-06-11
Units: 474
Risk: none'),
  ('po-002', 'PO — PO-8803', 'file', 'adoc', 1747742400000, 1747742400000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8803

PO Number: PO-8803
SKU: NB-UK-BIR-007
Supplier: Cedar Baby Goods
Origin: Xiamen
Destination: HAM
Status: Booked
ETD: 2026-05-27
ETA: 2026-06-12
Units: 511
Risk: none'),
  ('po-003', 'PO — PO-8804', 'file', 'adoc', 1747746000000, 1747746000000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8804

PO Number: PO-8804
SKU: NB-JP-BIR-009
Supplier: Bluewave Outdoor
Origin: Yantian
Destination: Yokohama
Status: Booked
ETD: 2026-05-28
ETA: 2026-06-13
Units: 548
Risk: none'),
  ('po-004', 'PO — PO-8805', 'file', 'adoc', 1747749600000, 1747749600000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8805

PO Number: PO-8805
SKU: NB-MX-PRE-011
Supplier: Atlas Packaging
Origin: Shanghai
Destination: Santos
Status: In Transit
ETD: 2026-05-29
ETA: 2026-06-14
Units: 585
Risk: none'),
  ('po-005', 'PO — PO-8806', 'file', 'adoc', 1747753200000, 1747753200000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8806

PO Number: PO-8806
SKU: NB-SG-CAT-013
Supplier: Prime Auto Parts
Origin: Shenzhen
Destination: Manzanillo
Status: Booked
ETD: 2026-05-30
ETA: 2026-06-15
Units: 622
Risk: none

## Shipping Update
Note: Customs hold at destination port since 2026-06-15. Documentation under review by customs authority. Carrier reports potential 2-week delay.'),
  ('po-006', 'PO — PO-8807', 'file', 'adoc', 1747756800000, 1747756800000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8807

PO Number: PO-8807
SKU: NB-UK-DOG-015
Supplier: PureBath
Origin: Ningbo
Destination: Felixstowe
Status: Partial Receipt
ETD: 2026-05-31
ETA: 2026-06-16
Units: 659
Risk: none

## Partial Receipt
Ordered: 659 units
Received: 505 units
Shortfall: 154 units
Action Required: Contact supplier for balance'),
  ('po-007', 'PO — PO-8808', 'file', 'adoc', 1747760400000, 1747760400000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8808

PO Number: PO-8808
SKU: NB-JP-DOG-017
Supplier: Greenfield Tools
Origin: Qingdao
Destination: LAX
Status: Booked
ETD: 2026-06-01
ETA: 2026-06-17
Units: 696
Risk: none'),
  ('po-008', 'PO — PO-8809', 'file', 'adoc', 1747764000000, 1747764000000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8809

PO Number: PO-8809
SKU: NB-MX-NON-019
Supplier: BrightHome Manufacturing
Origin: Xiamen
Destination: LGB
Status: Booked
ETD: 2026-06-02
ETA: 2026-06-18
Units: 733
Risk: none'),
  ('po-009', 'PO — PO-8810', 'file', 'adoc', 1747767600000, 1747767600000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8810

PO Number: PO-8810
SKU: NB-SG-DOG-021
Supplier: LumenBattery
Origin: Yantian
Destination: SEA
Status: In Transit
ETD: 2026-06-03
ETA: 2026-06-19
Units: 770
Risk: none

## Shipping Update
Note: Customs hold at destination port since 2026-06-19. Documentation under review by customs authority. Carrier reports potential 2-week delay.'),
  ('po-010', 'PO — PO-8811', 'file', 'adoc', 1747771200000, 1747771200000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8811

PO Number: PO-8811
SKU: NB-UK-PET-023
Supplier: GoldRiver Packaging
Origin: Shanghai
Destination: HAM
Status: Booked
ETD: 2026-06-04
ETA: 2026-06-20
Units: 807
Risk: none'),
  ('po-011', 'PO — PO-8812', 'file', 'adoc', 1747774800000, 1747774800000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8812

PO Number: PO-8812
SKU: NB-JP-PET-025
Supplier: Shoreline Silicone
Origin: Shenzhen
Destination: Yokohama
Status: Booked
ETD: 2026-06-05
ETA: 2026-06-21
Units: 844
Risk: none'),
  ('po-012', 'PO — PO-8813', 'file', 'adoc', 1747778400000, 1747778400000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8813

PO Number: PO-8813
SKU: NB-MX-BIR-027
Supplier: RiverWorks Metal
Origin: Ningbo
Destination: Santos
Status: Booked
ETD: 2026-06-06
ETA: 2026-06-22
Units: 881
Risk: none'),
  ('po-013', 'PO — PO-8814', 'file', 'adoc', 1747782000000, 1747782000000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8814

PO Number: PO-8814
SKU: NB-SG-COM-029
Supplier: SunPeak Cable
Origin: Qingdao
Destination: Manzanillo
Status: Partial Receipt
ETD: 2026-06-07
ETA: 2026-06-23
Units: 918
Risk: none

## Partial Receipt
Ordered: 918 units
Received: 411 units
Shortfall: 507 units
Action Required: Contact supplier for balance'),
  ('po-014', 'PO — PO-8815', 'file', 'adoc', 1747785600000, 1747785600000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8815

PO Number: PO-8815
SKU: NB-UK-PUZ-031
Supplier: Cedar Baby Goods
Origin: Xiamen
Destination: Felixstowe
Status: In Transit
ETD: 2026-06-08
ETA: 2026-06-24
Units: 955
Risk: none'),
  ('po-015', 'PO — PO-8816', 'file', 'adoc', 1747789200000, 1747789200000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8816

PO Number: PO-8816
SKU: NB-JP-OUT-033
Supplier: Bluewave Outdoor
Origin: Yantian
Destination: LAX
Status: Exception
ETD: 2026-06-09
ETA: 2026-06-25
Units: 992
Risk: missing certificate

## Exception Details
Type: missing certificate
Impact: 992 units at risk
Action Required: Escalate to supplier'),
  ('po-016', 'PO — PO-8817', 'file', 'adoc', 1747792800000, 1747792800000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8817

PO Number: PO-8817
SKU: NB-MX-STU-035
Supplier: Atlas Packaging
Origin: Shanghai
Destination: LGB
Status: Booked
ETD: 2026-06-10
ETA: 2026-06-26
Units: 1029
Risk: none'),
  ('po-017', 'PO — PO-8818', 'file', 'adoc', 1747796400000, 1747796400000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8818

PO Number: PO-8818
SKU: NB-SG-DOG-037
Supplier: Prime Auto Parts
Origin: Shenzhen
Destination: SEA
Status: Booked
ETD: 2026-06-11
ETA: 2026-06-27
Units: 1066
Risk: none'),
  ('po-018', 'PO — PO-8819', 'file', 'adoc', 1747800000000, 1747800000000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8819

PO Number: PO-8819
SKU: NB-UK-DOG-039
Supplier: PureBath
Origin: Ningbo
Destination: HAM
Status: Booked
ETD: 2026-06-12
ETA: 2026-06-28
Units: 1103
Risk: none'),
  ('po-019', 'PO — PO-8820', 'file', 'adoc', 1747803600000, 1747803600000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8820

PO Number: PO-8820
SKU: NB-JP-NON-041
Supplier: Greenfield Tools
Origin: Qingdao
Destination: Yokohama
Status: In Transit
ETD: 2026-06-13
ETA: 2026-06-29
Units: 1140
Risk: none'),
  ('po-020', 'PO — PO-8821', 'file', 'adoc', 1747807200000, 1747807200000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8821

PO Number: PO-8821
SKU: NB-MX-DOG-043
Supplier: BrightHome Manufacturing
Origin: Xiamen
Destination: Santos
Status: Partial Receipt
ETD: 2026-06-14
ETA: 2026-06-30
Units: 1177
Risk: none

## Partial Receipt
Ordered: 1177 units
Received: 533 units
Shortfall: 644 units
Action Required: Contact supplier for balance'),
  ('po-021', 'PO — PO-8822', 'file', 'adoc', 1747810800000, 1747810800000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8822

PO Number: PO-8822
SKU: NB-SG-PET-045
Supplier: LumenBattery
Origin: Yantian
Destination: Manzanillo
Status: Booked
ETD: 2026-06-15
ETA: 2026-07-01
Units: 1214
Risk: none'),
  ('po-022', 'PO — PO-8823', 'file', 'adoc', 1747814400000, 1747814400000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8823

PO Number: PO-8823
SKU: NB-UK-SMA-047
Supplier: GoldRiver Packaging
Origin: Shanghai
Destination: Felixstowe
Status: Booked
ETD: 2026-06-16
ETA: 2026-07-02
Units: 1251
Risk: none'),
  ('po-023', 'PO — PO-8824', 'file', 'adoc', 1747818000000, 1747818000000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8824

PO Number: PO-8824
SKU: NB-JP-BIR-049
Supplier: Shoreline Silicone
Origin: Shenzhen
Destination: LAX
Status: Booked
ETD: 2026-06-17
ETA: 2026-07-03
Units: 1288
Risk: none'),
  ('po-024', 'PO — PO-8825', 'file', 'adoc', 1747821600000, 1747821600000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8825

PO Number: PO-8825
SKU: NB-MX-BIR-051
Supplier: RiverWorks Metal
Origin: Ningbo
Destination: LGB
Status: In Transit
ETD: 2026-06-18
ETA: 2026-07-04
Units: 1325
Risk: none'),
  ('po-025', 'PO — PO-8826', 'file', 'adoc', 1747825200000, 1747825200000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8826

PO Number: PO-8826
SKU: NB-SG-CAT-053
Supplier: SunPeak Cable
Origin: Qingdao
Destination: SEA
Status: Booked
ETD: 2026-06-19
ETA: 2026-07-05
Units: 1362
Risk: none'),
  ('po-026', 'PO — PO-8827', 'file', 'adoc', 1747828800000, 1747828800000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8827

PO Number: PO-8827
SKU: NB-UK-OUT-055
Supplier: Cedar Baby Goods
Origin: Xiamen
Destination: HAM
Status: Booked
ETD: 2026-06-20
ETA: 2026-07-06
Units: 1399
Risk: none'),
  ('po-027', 'PO — PO-8828', 'file', 'adoc', 1747832400000, 1747832400000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8828

PO Number: PO-8828
SKU: NB-JP-CAT-057
Supplier: Bluewave Outdoor
Origin: Yantian
Destination: Yokohama
Status: Partial Receipt
ETD: 2026-05-24
ETA: 2026-07-07
Units: 1436
Risk: none

## Partial Receipt
Ordered: 1436 units
Received: 841 units
Shortfall: 595 units
Action Required: Contact supplier for balance'),
  ('po-028', 'PO — PO-8829', 'file', 'adoc', 1747836000000, 1747836000000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8829

PO Number: PO-8829
SKU: NB-MX-DOG-059
Supplier: Atlas Packaging
Origin: Shanghai
Destination: Santos
Status: Booked
ETD: 2026-05-25
ETA: 2026-07-08
Units: 1473
Risk: none'),
  ('po-029', 'PO — PO-8830', 'file', 'adoc', 1747839600000, 1747839600000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8830

PO Number: PO-8830
SKU: NB-SG-DOG-061
Supplier: Prime Auto Parts
Origin: Shenzhen
Destination: Manzanillo
Status: In Transit
ETD: 2026-05-26
ETA: 2026-07-09
Units: 1510
Risk: none'),
  ('po-030', 'PO — PO-8831', 'file', 'adoc', 1747843200000, 1747843200000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8831

PO Number: PO-8831
SKU: NB-UK-DOG-063
Supplier: PureBath
Origin: Ningbo
Destination: Felixstowe
Status: Booked
ETD: 2026-05-27
ETA: 2026-07-10
Units: 1547
Risk: none'),
  ('po-031', 'PO — PO-8832', 'file', 'adoc', 1747846800000, 1747846800000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-8832

PO Number: PO-8832
SKU: NB-JP-PET-065
Supplier: Greenfield Tools
Origin: Qingdao
Destination: LAX
Status: Exception
ETD: 2026-05-28
ETA: 2026-07-11
Units: 1584
Risk: missing certificate

## Exception Details
Type: missing certificate
Impact: 1584 units at risk
Action Required: Escalate to supplier'),
  ('po-closed-noise', 'PO — PO-7799 (Closed)', 'file', 'adoc', 1747879200000, 1747879200000, 'uid-scmops', 'fold-active', 'ws-nb-scm', '# Purchase Order — PO-7799

Status: Delivered
All units received 2026-04-15.
This PO is closed.');
