-- SQLite schema for DingTalk Workspace CLI (dws) doc mock
-- Mirrors the doc product's node/block/comment data model

CREATE TABLE IF NOT EXISTS mock_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  nodeId TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('file', 'folder')),
  extension TEXT DEFAULT 'adoc',
  createTime INTEGER NOT NULL,
  lastEditTime INTEGER NOT NULL,
  creatorUid TEXT NOT NULL,
  parentId TEXT,
  workspaceId TEXT,
  content TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS blocks (
  blockId TEXT PRIMARY KEY,
  nodeId TEXT NOT NULL REFERENCES documents(nodeId) ON DELETE CASCADE,
  blockType TEXT NOT NULL,
  contentJson TEXT NOT NULL DEFAULT '{}',
  blockOrder INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
  commentKey TEXT PRIMARY KEY,
  nodeId TEXT NOT NULL REFERENCES documents(nodeId) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('global', 'inline')) DEFAULT 'global',
  creatorUid TEXT NOT NULL,
  createTime INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  blockId TEXT,
  startOffset INTEGER,
  endOffset INTEGER,
  selectedText TEXT,
  mentionsJson TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS comment_replies (
  replyKey TEXT PRIMARY KEY,
  commentKey TEXT NOT NULL REFERENCES comments(commentKey) ON DELETE CASCADE,
  content TEXT NOT NULL,
  emoji INTEGER NOT NULL DEFAULT 0,
  creatorUid TEXT NOT NULL,
  createTime INTEGER NOT NULL,
  mentionsJson TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nodeId TEXT NOT NULL REFERENCES documents(nodeId) ON DELETE CASCADE,
  userId TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('MANAGER', 'EDITOR', 'DOWNLOADER', 'READER')),
  grantedAt INTEGER NOT NULL,
  UNIQUE(nodeId, userId)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  operation TEXT NOT NULL,
  entityType TEXT NOT NULL DEFAULT '',
  entityId TEXT DEFAULT '',
  detailsJson TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'docx',
  exported_at INTEGER NOT NULL
);
