-- Default seed data for Box CLI mock
-- Provides a realistic starting state: 3 users, root + 3 folders, 6 files, comments, collab, task

-- Auth session (mock token)
INSERT OR IGNORE INTO auth_session (env_name, token, created_at)
VALUES ('default', 'mock-box-token-bench', '2026-01-15T09:00:00Z');

-- Users
INSERT OR IGNORE INTO users (id, name, login, created_at, modified_at, status, space_amount, space_used, job_title) VALUES
  ('10001', 'Admin User',   'admin@boxmock.example.com',   '2026-01-10T08:00:00Z', '2026-01-10T08:00:00Z', 'active', 10737418240, 524288000, 'Administrator'),
  ('10002', 'Alice Chen',   'alice@boxmock.example.com',   '2026-02-01T10:00:00Z', '2026-02-01T10:00:00Z', 'active', 10737418240, 209715200, 'Product Manager'),
  ('10003', 'Bob Martinez', 'bob@boxmock.example.com',     '2026-02-15T14:30:00Z', '2026-02-15T14:30:00Z', 'active', 10737418240, 104857600, 'Engineer');

-- Folders (root folder id=0 is special)
INSERT OR IGNORE INTO folders (id, name, description, parent_id, size, etag, created_at, modified_at, created_by, owned_by, item_status) VALUES
  ('0',     'All Files',       '',                              NULL,  0, '0', '2026-01-10T08:00:00Z', '2026-05-20T12:00:00Z', '10001', '10001', 'active'),
  ('20001', 'Project Alpha',   'Main project workspace',        '0',   0, '1', '2026-03-01T09:00:00Z', '2026-05-18T16:30:00Z', '10001', '10001', 'active'),
  ('20002', 'Marketing',       'Marketing assets and campaigns', '0',  0, '1', '2026-03-05T11:00:00Z', '2026-05-15T10:00:00Z', '10002', '10002', 'active'),
  ('20003', 'Archive',         'Archived documents',            '0',   0, '1', '2026-04-01T08:00:00Z', '2026-04-20T09:00:00Z', '10001', '10001', 'active');

-- Files
INSERT OR IGNORE INTO files (id, name, description, parent_id, size, sha1, etag, created_at, modified_at, content_created_at, content_modified_at, created_by, owned_by, item_status, file_content) VALUES
  ('30001', 'Q2-Budget-Report.xlsx',   'Quarterly budget report',            '20001', 245760, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', '1', '2026-04-10T09:30:00Z', '2026-05-20T14:00:00Z', '2026-04-10T09:30:00Z', '2026-05-20T14:00:00Z', '10002', '10002', 'active', 'Budget report content placeholder'),
  ('30002', 'Product-Roadmap.pdf',     'Product roadmap for 2026',           '20001', 1048576, 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3', '1', '2026-03-15T10:00:00Z', '2026-05-10T11:30:00Z', '2026-03-15T10:00:00Z', '2026-05-10T11:30:00Z', '10002', '10002', 'active', 'Product roadmap content placeholder'),
  ('30003', 'Brand-Guidelines.pdf',    'Official brand style guide',         '20002', 5242880, 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', '1', '2026-03-20T15:00:00Z', '2026-04-25T09:00:00Z', '2026-03-20T15:00:00Z', '2026-04-25T09:00:00Z', '10001', '10001', 'active', 'Brand guidelines content placeholder'),
  ('30004', 'Campaign-Plan-Q3.docx',   'Q3 marketing campaign plan',        '20002', 327680, 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5', '1', '2026-05-01T08:00:00Z', '2026-05-18T16:00:00Z', '2026-05-01T08:00:00Z', '2026-05-18T16:00:00Z', '10002', '10002', 'active', 'Campaign plan content placeholder'),
  ('30005', 'Meeting-Notes-May.txt',   'Monthly team meeting notes',         '20001', 8192,   'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6', '1', '2026-05-15T14:00:00Z', '2026-05-15T14:30:00Z', '2026-05-15T14:00:00Z', '2026-05-15T14:30:00Z', '10003', '10003', 'active', 'Meeting notes content placeholder'),
  ('30006', 'Old-Specs-Draft.txt',     'Deprecated specification document',  '20003', 4096,   'f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1', '1', '2026-02-01T10:00:00Z', '2026-02-10T12:00:00Z', '2026-02-01T10:00:00Z', '2026-02-10T12:00:00Z', '10001', '10001', 'active', 'Old specs content placeholder');

-- Comments
INSERT OR IGNORE INTO comments (id, item_type, item_id, message, created_by, created_at, modified_at, is_reply, is_deleted) VALUES
  ('40001', 'file', '30001', 'Please review the updated budget figures for Q2.',         '10002', '2026-05-20T14:15:00Z', '2026-05-20T14:15:00Z', 0, 0),
  ('40002', 'file', '30001', 'Numbers look good. Approved.',                              '10001', '2026-05-21T09:00:00Z', '2026-05-21T09:00:00Z', 0, 0),
  ('40003', 'file', '30004', 'Can we add social media metrics to the campaign tracker?',  '10003', '2026-05-19T11:30:00Z', '2026-05-19T11:30:00Z', 0, 0);

-- Collaboration
INSERT OR IGNORE INTO collaborations (id, item_type, item_id, accessible_by, role, status, created_at, modified_at, is_deleted) VALUES
  ('50001', 'folder', '20001', '10003', 'editor', 'accepted', '2026-03-01T09:30:00Z', '2026-03-01T09:30:00Z', 0);

-- Task
INSERT OR IGNORE INTO tasks (id, file_id, message, due_at, is_completed, completion_rule, created_by, created_at, is_deleted) VALUES
  ('60001', '30001', 'Review and sign off on Q2 budget numbers', '2026-06-01T17:00:00Z', 0, 'all_assignees', '10002', '2026-05-20T14:20:00Z', 0);

-- Task-specific: executive approvers (must match workspace/executive_contacts.csv)
INSERT OR IGNORE INTO users (id, name, login, created_at, modified_at, status, space_amount, space_used, job_title) VALUES
  ('exec-001', 'Sarah Chen',      'sarah.chen@company.com',      '2026-01-12T08:00:00Z', '2026-01-12T08:00:00Z', 'active', 10737418240, 0, 'VP of Procurement'),
  ('exec-002', 'James Rodriguez', 'james.rodriguez@company.com', '2026-01-12T08:00:00Z', '2026-01-12T08:00:00Z', 'active', 10737418240, 0, 'Chief Compliance Officer'),
  ('exec-003', 'Lisa Wang',       'lisa.wang@company.com',       '2026-01-12T08:00:00Z', '2026-01-12T08:00:00Z', 'active', 10737418240, 0, 'Director of Trade Finance');
