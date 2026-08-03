-- default.sql — seed data for Jira CLI mock
-- 2 projects, standard issue types/statuses/priorities, sample issues

-- Projects
INSERT OR IGNORE INTO projects (id, key, name, lead, type, created_at) VALUES
  ('10000', 'PROJ', 'Project Alpha', 'admin@example.com', 'classic', '2026-01-10T08:00:00.000Z'),
  ('10001', 'BENCH', 'Benchmark Suite', 'admin@example.com', 'classic', '2026-02-15T10:00:00.000Z');

-- Issue types
INSERT OR IGNORE INTO issue_types (id, name, handle, subtask) VALUES
  ('10001', 'Story', 'story', 0),
  ('10002', 'Bug', 'bug', 0),
  ('10003', 'Task', 'task', 0),
  ('10004', 'Sub-task', 'sub-task', 1),
  ('10005', 'Epic', 'epic', 0);

-- Statuses
INSERT OR IGNORE INTO issue_statuses (id, name, category) VALUES
  ('1', 'To Do', 'To Do'),
  ('2', 'In Progress', 'In Progress'),
  ('3', 'In Review', 'In Progress'),
  ('4', 'Done', 'Done');

-- Priorities
INSERT OR IGNORE INTO issue_priorities (id, name, sort_order) VALUES
  ('1', 'Highest', 1),
  ('2', 'High', 2),
  ('3', 'Medium', 3),
  ('4', 'Low', 4),
  ('5', 'Lowest', 5);

-- Status transitions (workflow)
INSERT OR IGNORE INTO transitions (from_status, to_status) VALUES
  ('To Do', 'In Progress'),
  ('In Progress', 'In Review'),
  ('In Progress', 'Done'),
  ('In Review', 'Done'),
  ('In Review', 'In Progress'),
  ('Done', 'To Do');

-- Boards (1 per project)
INSERT OR IGNORE INTO boards (id, name, type, project_key) VALUES
  ('100', 'Project Alpha Board', 'scrum', 'PROJ'),
  ('101', 'Benchmark Board', 'scrum', 'BENCH');

-- Sprints
INSERT OR IGNORE INTO sprints (id, name, state, board_id, start_date, end_date) VALUES
  ('1', 'PROJ Sprint 1', 'active', '100', '2026-05-01T00:00:00.000Z', '2026-05-15T00:00:00.000Z'),
  ('2', 'BENCH Sprint 1', 'active', '101', '2026-05-05T00:00:00.000Z', '2026-05-19T00:00:00.000Z'),
  ('3', 'PROJ Sprint 2', 'future', '100', '2026-05-16T00:00:00.000Z', '2026-05-30T00:00:00.000Z');

-- Config (default project)
INSERT OR IGNORE INTO config (key, value) VALUES
  ('default_project', 'PROJ'),
  ('issue_seq_PROJ', '8'),
  ('issue_seq_BENCH', '5');

-- Sample issues — PROJ
INSERT OR IGNORE INTO issues (id, key, project_key, type_id, summary, description, status_id, priority_id, assignee, reporter, labels_json, components_json, resolution, created_at, updated_at) VALUES
  ('100001', 'PROJ-1', 'PROJ', '10005', 'Q3 Platform Migration', 'Epic for all migration-related work in Q3.', '2', '2', 'alice@example.com', 'admin@example.com', '["migration","q3"]', '["platform"]', '', '2026-04-20T09:00:00.000Z', '2026-05-10T14:30:00.000Z'),
  ('100002', 'PROJ-2', 'PROJ', '10001', 'Migrate user authentication to OAuth2', 'Replace legacy token auth with OAuth2 flow.', '2', '2', 'alice@example.com', 'admin@example.com', '["migration","auth"]', '["platform"]', '', '2026-04-22T10:00:00.000Z', '2026-05-08T11:00:00.000Z'),
  ('100003', 'PROJ-3', 'PROJ', '10002', 'Login page crashes on Safari 18', 'Users on Safari 18 see a blank page after entering credentials.', '1', '1', '', 'bob@example.com', '["safari","login"]', '["frontend"]', '', '2026-05-01T08:30:00.000Z', '2026-05-01T08:30:00.000Z'),
  ('100004', 'PROJ-4', 'PROJ', '10003', 'Write migration runbook', 'Document step-by-step migration procedure for ops team.', '4', '3', 'charlie@example.com', 'alice@example.com', '["docs"]', '["platform"]', 'Done', '2026-04-25T13:00:00.000Z', '2026-05-06T16:00:00.000Z'),
  ('100005', 'PROJ-5', 'PROJ', '10001', 'Add rate limiting to public API', 'Implement 429 responses with configurable thresholds.', '3', '3', 'bob@example.com', 'admin@example.com', '["api"]', '["backend"]', '', '2026-05-02T09:00:00.000Z', '2026-05-12T10:00:00.000Z'),
  ('100006', 'PROJ-6', 'PROJ', '10002', 'Memory leak in background job worker', 'RSS grows unbounded after ~24h of continuous operation.', '1', '1', 'alice@example.com', 'charlie@example.com', '["performance"]', '["backend"]', '', '2026-05-10T07:45:00.000Z', '2026-05-10T07:45:00.000Z'),
  ('100007', 'PROJ-7', 'PROJ', '10004', 'Update OAuth2 client library to v3.2', 'Sub-task of PROJ-2.', '2', '3', 'alice@example.com', 'alice@example.com', '[]', '["platform"]', '', '2026-05-05T11:00:00.000Z', '2026-05-09T14:00:00.000Z');

-- Sample issues — BENCH
INSERT OR IGNORE INTO issues (id, key, project_key, type_id, summary, description, status_id, priority_id, assignee, reporter, labels_json, components_json, resolution, created_at, updated_at) VALUES
  ('200001', 'BENCH-1', 'BENCH', '10005', 'Benchmark Infrastructure Setup', 'Epic for initial benchmark infrastructure.', '2', '2', 'admin@example.com', 'admin@example.com', '["infra"]', '["ci"]', '', '2026-02-20T10:00:00.000Z', '2026-04-15T12:00:00.000Z'),
  ('200002', 'BENCH-2', 'BENCH', '10003', 'Set up CI pipeline for nightly runs', 'Configure GitHub Actions workflow for benchmark execution.', '4', '3', 'diana@example.com', 'admin@example.com', '["ci","automation"]', '["ci"]', 'Done', '2026-03-01T09:00:00.000Z', '2026-04-10T15:00:00.000Z'),
  ('200003', 'BENCH-3', 'BENCH', '10001', 'Implement result dashboard', 'Web dashboard showing benchmark history and trends.', '1', '3', '', 'diana@example.com', '["dashboard"]', '["frontend"]', '', '2026-04-01T08:00:00.000Z', '2026-04-01T08:00:00.000Z'),
  ('200004', 'BENCH-4', 'BENCH', '10002', 'Flaky test: cache invalidation benchmark', 'Intermittent failures in cache-invalidation suite, ~15% failure rate.', '2', '2', 'diana@example.com', 'admin@example.com', '["flaky","cache"]', '["testing"]', '', '2026-04-20T11:30:00.000Z', '2026-05-05T09:00:00.000Z');

-- Parent/epic links
UPDATE issues SET epic_key = 'PROJ-1' WHERE key IN ('PROJ-2', 'PROJ-5');
UPDATE issues SET parent_key = 'PROJ-2' WHERE key = 'PROJ-7';
UPDATE issues SET epic_key = 'BENCH-1' WHERE key IN ('BENCH-2', 'BENCH-3');

-- Sprint assignments
INSERT OR IGNORE INTO sprint_issues (sprint_id, issue_key) VALUES
  ('1', 'PROJ-2'), ('1', 'PROJ-3'), ('1', 'PROJ-5'), ('1', 'PROJ-6'), ('1', 'PROJ-7'),
  ('2', 'BENCH-3'), ('2', 'BENCH-4'),
  ('3', 'PROJ-3');

-- Sample comments
INSERT OR IGNORE INTO comments (id, issue_key, author, body, created_at, updated_at) VALUES
  ('c-001', 'PROJ-3', 'bob@example.com', 'Reproduced on Safari 18.0.1 with WebKit 620.1.15. Stack trace attached.', '2026-05-01T09:00:00.000Z', '2026-05-01T09:00:00.000Z'),
  ('c-002', 'PROJ-2', 'alice@example.com', 'OAuth2 provider integration code is ready for review. See PR #142.', '2026-05-07T14:00:00.000Z', '2026-05-07T14:00:00.000Z'),
  ('c-003', 'BENCH-4', 'diana@example.com', 'Added retry logic with exponential backoff. Failure rate dropped to ~2%.', '2026-05-04T16:30:00.000Z', '2026-05-04T16:30:00.000Z');
