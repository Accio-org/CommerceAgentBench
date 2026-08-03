BEGIN;

DELETE FROM audit_log;
DELETE FROM auth_session;
DELETE FROM shared_links;
DELETE FROM tasks;
DELETE FROM comments;
DELETE FROM collaborations;
DELETE FROM files;
DELETE FROM folders;
DELETE FROM users;

INSERT INTO users (id, name, login, created_at, modified_at, status, job_title)
VALUES
  ('10001', 'NorthBridge Artwork Ops', 'artwork.ops@northbridge.example.com', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', 'active', 'Artwork operations'),
  ('10002', 'Priya Nair', 'priya.nair@northbridge.example.com', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', 'active', 'Legal reviewer');

INSERT INTO auth_session (env_name, token, created_at)
VALUES ('default', 'mock-box-token-bench', '2026-05-20T09:00:00Z');

INSERT INTO folders (id, name, description, parent_id, size, etag, created_at, modified_at, created_by, owned_by, item_status)
VALUES
  ('0', 'All Files', 'Root', NULL, 0, '0', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20000', 'Packaging Artwork', 'Q3 packaging artwork room', '0', 0, '1', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20010', 'Artwork Intake', 'Unsorted artwork files for review', '20000', 0, '2', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20020', 'Launch Packets', 'Approved launch packets by SKU', '20000', 0, '3', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20021', 'NB-CHG-18', 'Launch packet for NB-CHG-18', '20020', 0, '4', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20022', 'NB-CSE-22', 'Launch packet for NB-CSE-22', '20020', 0, '5', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20023', 'NB-DCK-31', 'Launch packet for NB-DCK-31', '20020', 0, '6', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20030', 'Legal Review', 'Legal review holding area by SKU', '20000', 0, '7', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20031', 'NB-CHG-18', 'Legal review for NB-CHG-18', '20030', 0, '8', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20032', 'NB-CSE-22', 'Legal review for NB-CSE-22', '20030', 0, '9', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20033', 'NB-DCK-31', 'Legal review for NB-DCK-31', '20030', 0, '10', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20040', 'Archive', 'Artwork archive', '20000', 0, '11', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active'),
  ('20041', 'Obsolete Artwork', 'Superseded and canceled artwork', '20040', 0, '12', '2026-05-20T09:00:00Z', '2026-05-20T09:00:00Z', '10001', '10001', 'active');

INSERT INTO files (id, name, description, parent_id, size, sha1, etag, created_at, modified_at, content_created_at, content_modified_at, created_by, owned_by, item_status, tags_json, file_content)
VALUES
  ('30001', 'NB-CHG-18_front_panel_v3.txt', '', '20010', 370, 'sha30001', '21', '2026-05-28T09:00:00Z', '2026-05-28T09:00:00Z', '2026-05-28T09:00:00Z', '2026-05-28T09:00:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-CHG-18
Asset: front panel
Claim code: UL-BC-27
Evidence: approved battery compliance memo in artwork ticket ART-883.
Decision signal: READY
'),
  ('30002', 'NB-CHG-18_battery_callout_v2.txt', '', '20010', 360, 'sha30002', '22', '2026-05-28T09:02:00Z', '2026-05-28T09:02:00Z', '2026-05-28T09:02:00Z', '2026-05-28T09:02:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-CHG-18
Asset: lithium battery callout
Claim: safer charging cell.
Problem: legal substantiation memo is missing.
Review code: UNSUPPORTED-SAFETY
Decision signal: LEGAL_REVIEW
'),
  ('30003', 'NB-CHG-18_retail_insert_v1.txt', '', '20010', 340, 'sha30003', '23', '2026-05-28T09:04:00Z', '2026-05-28T09:04:00Z', '2026-05-28T09:04:00Z', '2026-05-28T09:04:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-CHG-18
Asset: retail insert
Claim code: WARRANTY-2Y
Evidence: warranty copy approved by CX and legal.
Decision signal: READY
'),
  ('30004', 'NB-CSE-22_front_panel_v4.txt', '', '20010', 330, 'sha30004', '24', '2026-05-28T09:06:00Z', '2026-05-28T09:06:00Z', '2026-05-28T09:06:00Z', '2026-05-28T09:06:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-CSE-22
Asset: front panel
Claim code: DROP-1M
Evidence: final drop-test summary approved for US retail.
Decision signal: READY
'),
  ('30005', 'NB-CSE-22_bpa_free_icon_v2.txt', '', '20010', 350, 'sha30005', '25', '2026-05-28T09:08:00Z', '2026-05-28T09:08:00Z', '2026-05-28T09:08:00Z', '2026-05-28T09:08:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-CSE-22
Asset: BPA-free icon
Claim: BPA-free molded case.
Problem: resin declaration is not attached to the claim ticket.
Review code: MATERIAL-CLAIM-MISSING
Decision signal: LEGAL_REVIEW
'),
  ('30006', 'NB-CSE-22_spanish_panel_v1.txt', '', '20010', 350, 'sha30006', '26', '2026-05-28T09:10:00Z', '2026-05-28T09:10:00Z', '2026-05-28T09:10:00Z', '2026-05-28T09:10:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-CSE-22
Asset: Spanish-language side panel
Problem: translation is not approved for the US/CA launch region.
Review code: LOCALE-UNAPPROVED
Decision signal: LEGAL_REVIEW
'),
  ('30007', 'NB-DCK-31_top_label_v2.txt', '', '20010', 340, 'sha30007', '27', '2026-05-28T09:12:00Z', '2026-05-28T09:12:00Z', '2026-05-28T09:12:00Z', '2026-05-28T09:12:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-DCK-31
Asset: top label
Claim code: RECYCLED-40
Evidence: recycled-content declaration signed by supplier.
Decision signal: READY
'),
  ('30008', 'NB-DCK-31_fast_charge_badge_v1.txt', '', '20010', 360, 'sha30008', '28', '2026-05-28T09:14:00Z', '2026-05-28T09:14:00Z', '2026-05-28T09:14:00Z', '2026-05-28T09:14:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-DCK-31
Asset: fast-charge badge
Claim: 100W fast charging.
Problem: engineering signoff only covers 65W.
Review code: PERFORMANCE-CLAIM-MISMATCH
Decision signal: LEGAL_REVIEW
'),
  ('30009', 'NB-DCK-31_quickstart_card_v2.txt', '', '20010', 330, 'sha30009', '29', '2026-05-28T09:16:00Z', '2026-05-28T09:16:00Z', '2026-05-28T09:16:00Z', '2026-05-28T09:16:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-DCK-31
Asset: quickstart card
Claim code: SETUP-3STEP
Evidence: product team approved wording.
Decision signal: READY
'),
  ('30010', 'NB-OLD-09_side_panel_v5.txt', '', '20010', 320, 'sha30010', '30', '2026-05-28T09:18:00Z', '2026-05-28T09:18:00Z', '2026-05-28T09:18:00Z', '2026-05-28T09:18:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-OLD-09
Asset: side panel
Problem: product canceled and replaced by NB-CHG-18.
Decision signal: ARCHIVE
'),
  ('30011', 'NB-CSE-20_retail_insert_v9.txt', '', '20010', 320, 'sha30011', '31', '2026-05-28T09:20:00Z', '2026-05-28T09:20:00Z', '2026-05-28T09:20:00Z', '2026-05-28T09:20:00Z', '10001', '10001', 'active', '[]', 'SKU: NB-CSE-20
Asset: retail insert
Problem: superseded by NB-CSE-22 launch kit.
Decision signal: ARCHIVE
'),
  ('30012', 'Shared_supplier_logo_library.txt', '', '20010', 310, 'sha30012', '32', '2026-05-28T09:22:00Z', '2026-05-28T09:22:00Z', '2026-05-28T09:22:00Z', '2026-05-28T09:22:00Z', '10001', '10001', 'active', '[]', 'Reference: supplier logo library for future artwork.
No SKU ownership. Do not route into SKU folders.
Decision signal: REFERENCE_ONLY
');

INSERT INTO comments (id, item_type, item_id, message, created_by, created_at, modified_at, is_reply, is_deleted)
VALUES
  ('c-pre-ready-30001', 'file', '30001', 'APPROVED FOR LAUNCH NB-CHG-18 - carried over from 2026-05-31 artwork review.', '10001', '2026-05-31T16:00:00Z', '2026-05-31T16:00:00Z', 0, 0),
  ('c-pre-ready-30007', 'file', '30007', 'APPROVED FOR LAUNCH NB-DCK-31 - carried over from 2026-05-31 artwork review.', '10001', '2026-05-31T16:05:00Z', '2026-05-31T16:05:00Z', 0, 0);

INSERT INTO tasks (id, file_id, message, due_at, is_completed, completion_rule, created_by, created_at, is_deleted)
VALUES
  ('t-pre-30002', '30002', 'NB-CHG-18 legal review required: UNSUPPORTED-SAFETY', '2026-06-12T17:00:00Z', 0, 'all_assignees', '10001', '2026-05-31T16:10:00Z', 0),
  ('t-pre-30008', '30008', 'NB-DCK-31 legal review required: PERFORMANCE-CLAIM-MISMATCH', '2026-06-12T17:00:00Z', 0, 'all_assignees', '10001', '2026-05-31T16:15:00Z', 0);

INSERT INTO shared_links (id, item_type, item_id, url, access, password, unshared_at, created_at, is_deleted)
VALUES
  ('sl-pre-20021', 'folder', '20021', 'https://boxmock.box.com/s/sl-pre-20021', 'company', NULL, NULL, '2026-05-31T16:20:00Z', 0);

COMMIT;
