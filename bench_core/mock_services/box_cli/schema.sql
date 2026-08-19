-- SQLite schema for Box CLI mock
-- Mirrors real Box data model for files, folders, users, comments, collaborations, tasks

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'cannot_delete_edit', 'cannot_delete_edit_upload')),
  space_amount INTEGER DEFAULT 10737418240,
  space_used INTEGER DEFAULT 0,
  job_title TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  avatar_url TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  parent_id TEXT REFERENCES folders(id),
  size INTEGER DEFAULT 0,
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  owned_by TEXT REFERENCES users(id),
  item_status TEXT DEFAULT 'active',
  tags_json TEXT DEFAULT '[]',
  trashed_at TEXT,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  parent_id TEXT NOT NULL REFERENCES folders(id),
  size INTEGER DEFAULT 0,
  sha1 TEXT DEFAULT '',
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  content_created_at TEXT,
  content_modified_at TEXT,
  created_by TEXT REFERENCES users(id),
  owned_by TEXT REFERENCES users(id),
  item_status TEXT DEFAULT 'active',
  tags_json TEXT DEFAULT '[]',
  file_content TEXT DEFAULT '',
  trashed_at TEXT,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('file', 'comment')),
  item_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  is_reply INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collaborations (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('file', 'folder')),
  item_id TEXT NOT NULL,
  accessible_by TEXT REFERENCES users(id),
  -- Upstream --role options (src/commands/collaborations/create.js:39-47); 'owner' is NOT one of them.
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer', 'previewer', 'uploader', 'previewer_uploader', 'viewer_uploader', 'co-owner')),
  status TEXT DEFAULT 'accepted',
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shared_links (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('file', 'folder')),
  item_id TEXT NOT NULL,
  url TEXT NOT NULL,
  -- Upstream's --access flag has NO oclif options (src/commands/shared-links/create.js:26):
  -- the CLI forwards any value and the API validates it, so no CHECK here. Default 'open'.
  access TEXT DEFAULT 'open',
  password TEXT,
  unshared_at TEXT,
  created_at TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id),
  message TEXT DEFAULT '',
  due_at TEXT,
  is_completed INTEGER DEFAULT 0,
  completion_rule TEXT DEFAULT 'all_assignees' CHECK (completion_rule IN ('all_assignees', 'any_assignee')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS auth_session (
  env_name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL
);
