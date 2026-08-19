-- Default seed data for Todoist CLI mock
-- Provides a realistic starting state: Inbox + 2 projects, 3 labels, 2 sections, 6 tasks

-- Auth session (mock token)
INSERT OR IGNORE INTO auth_session (token, user_email, karma, created_at)
VALUES ('mock-todoist-token-bench', 'bench@todoist.mock', 245, '2026-01-15T09:00:00Z');

-- Projects
INSERT OR IGNORE INTO projects (id, name, color, item_order, is_archived, is_deleted, created_at) VALUES
  ('2200000001', 'Inbox',        '48', 0, 0, 0, '2026-01-15T09:00:00Z'),
  ('2200000002', 'Work',         '31', 1, 0, 0, '2026-01-15T09:01:00Z'),
  ('2200000003', 'Shopping',     '42', 2, 0, 0, '2026-01-20T14:30:00Z');

-- Labels
INSERT OR IGNORE INTO labels (id, name, color, item_order, is_deleted) VALUES
  ('2300000001', 'urgent',    '30', 0, 0),
  ('2300000002', 'follow-up', '33', 1, 0),
  ('2300000003', 'waiting',   '37', 2, 0);

-- Sections
INSERT OR IGNORE INTO sections (id, name, project_id, section_order, is_archived, is_deleted) VALUES
  ('2400000001', 'Planning',    '2200000002', 0, 0, 0),
  ('2400000002', 'In Progress', '2200000002', 1, 0, 0);

-- Filters (item_order preserves Todoist UI order; is_favorite -> "Y"/"N")
INSERT OR IGNORE INTO filters (id, name, query, color, item_order, is_favorite, is_deleted) VALUES
  ('2600000001', 'Priority 1', 'p1',    '30', 1, 1, 0),
  ('2600000002', 'Today',      'today', '31', 2, 0, 0);

-- Items (tasks) — priority is API-style: 1=normal, 2=medium, 3=high, 4=urgent
INSERT OR IGNORE INTO items (id, content, description, project_id, section_id, priority, due_date, due_string, labels_json, is_completed, is_deleted, item_order, created_at, updated_at) VALUES
  ('2500000001', 'Review Q2 budget report',      'Check numbers against forecast spreadsheet', '2200000002', '2400000001', 4, '2026-05-30', 'May 30', '["urgent"]',    0, 0, 0, '2026-05-25T10:00:00Z', '2026-05-25T10:00:00Z'),
  ('2500000002', 'Send weekly status update',     '',                                          '2200000002', '2400000002', 3, '2026-05-29', 'today',  '["follow-up"]', 0, 0, 1, '2026-05-26T08:30:00Z', '2026-05-26T08:30:00Z'),
  ('2500000003', 'Buy groceries',                 'Milk, eggs, bread, vegetables',             '2200000003', '',           1, '2026-05-29', 'today',  '[]',            0, 0, 0, '2026-05-27T12:00:00Z', '2026-05-27T12:00:00Z'),
  ('2500000004', 'Schedule dentist appointment',  '',                                          '2200000001', '',           2, '',           '',       '["waiting"]',   0, 0, 0, '2026-05-28T09:00:00Z', '2026-05-28T09:00:00Z'),
  ('2500000005', 'Prepare presentation slides',   'For the team all-hands on Monday',          '2200000002', '2400000002', 3, '2026-06-02', 'Jun 2',  '["urgent"]',    0, 0, 2, '2026-05-20T14:00:00Z', '2026-05-20T14:00:00Z'),
  ('2500000006', 'Read "Thinking, Fast and Slow"','Chapters 10-15',                            '2200000001', '',           1, '',           '',       '[]',            0, 0, 1, '2026-05-22T20:00:00Z', '2026-05-22T20:00:00Z');
