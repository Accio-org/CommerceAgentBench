-- schema.sql — Jira CLI mock, SQLite schema
-- Mirrors the subset of Jira Cloud state that jira-cli reads/writes.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  lead TEXT DEFAULT '',
  type TEXT DEFAULT 'classic',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  subtask INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS issue_statuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT DEFAULT 'To Do'
);

CREATE TABLE IF NOT EXISTS issue_priorities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  project_key TEXT NOT NULL REFERENCES projects(key),
  type_id TEXT NOT NULL REFERENCES issue_types(id),
  summary TEXT NOT NULL,
  description TEXT DEFAULT '',
  status_id TEXT NOT NULL REFERENCES issue_statuses(id),
  priority_id TEXT REFERENCES issue_priorities(id),
  assignee TEXT DEFAULT '',
  reporter TEXT DEFAULT '',
  labels_json TEXT DEFAULT '[]',
  components_json TEXT DEFAULT '[]',
  fix_versions_json TEXT DEFAULT '[]',
  parent_key TEXT,
  epic_key TEXT,
  resolution TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  issue_key TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_links (
  id TEXT PRIMARY KEY,
  link_type TEXT NOT NULL,
  inward_key TEXT NOT NULL,
  outward_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT DEFAULT 'active' CHECK (state IN ('future', 'active', 'closed')),
  board_id TEXT,
  start_date TEXT,
  end_date TEXT,
  complete_date TEXT
);

CREATE TABLE IF NOT EXISTS sprint_issues (
  sprint_id TEXT NOT NULL REFERENCES sprints(id),
  issue_key TEXT NOT NULL,
  PRIMARY KEY (sprint_id, issue_key)
);

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'scrum',
  project_key TEXT REFERENCES projects(key)
);

CREATE TABLE IF NOT EXISTS transitions (
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Indices for common queries
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_key);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status_id);
CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(type_id);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee);
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority_id);
CREATE INDEX IF NOT EXISTS idx_issues_key ON issues(key);
CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments(issue_key);
CREATE INDEX IF NOT EXISTS idx_sprint_issues_sprint ON sprint_issues(sprint_id);
CREATE INDEX IF NOT EXISTS idx_sprint_issues_issue ON sprint_issues(issue_key);
