-- Task seed for customs-dual-source-reconciliation.
-- Applied ON TOP of the default fixture: jira-daemon-start deletes the DB,
-- then jira-bench seed -> getDb() re-creates it with seeds/default.sql before
-- exec'ing this file, so only task-specific additions belong here.
--
-- The task contract (workspace/resolution_rules.md) directs agents to file
-- reconciliation issues under the RECONCILIATION project; the jira CLI mock
-- has no `project create` command, so the project must be pre-seeded.

INSERT OR IGNORE INTO projects (id, key, name, lead, type, created_at) VALUES
  ('10002', 'RECONCILIATION', 'Customs Reconciliation', 'admin@example.com', 'classic', '2026-05-18T08:00:00.000Z');

INSERT OR IGNORE INTO boards (id, name, type, project_key) VALUES
  ('102', 'Customs Reconciliation Board', 'scrum', 'RECONCILIATION');
