-- SQLite schema for Todoist CLI mock
-- Mirrors real Todoist data model for projects, labels, sections, items

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '48',
  item_order INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '48',
  item_order INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  section_order INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  description TEXT DEFAULT '',
  project_id TEXT NOT NULL REFERENCES projects(id),
  section_id TEXT DEFAULT '',
  -- API priority: 1=normal..4=urgent. 0 is the value real todoist stores when
  -- given an out-of-range --priority (Go map zero value; displays as "p0").
  priority INTEGER DEFAULT 1 CHECK (priority IN (0, 1, 2, 3, 4)),
  due_date TEXT DEFAULT '',
  due_datetime TEXT DEFAULT '',
  due_string TEXT DEFAULT '',
  deadline_date TEXT DEFAULT '',
  labels_json TEXT DEFAULT '[]',
  is_completed INTEGER DEFAULT 0,
  completed_at TEXT DEFAULT '',
  is_deleted INTEGER DEFAULT 0,
  parent_id TEXT DEFAULT '',
  item_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT DEFAULT '',
  color TEXT DEFAULT '48',
  item_order INTEGER DEFAULT 0,
  is_favorite INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT DEFAULT '',
  details_json TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS auth_session (
  token TEXT PRIMARY KEY,
  user_email TEXT DEFAULT 'bench@todoist.mock',
  karma INTEGER DEFAULT 245,
  created_at TEXT NOT NULL
);
