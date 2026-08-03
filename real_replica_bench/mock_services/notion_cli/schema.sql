-- SQLite schema for Notion CLI mock
-- Source of truth for database structure. store.js reads this at init.

CREATE TABLE IF NOT EXISTS account (data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (data TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

CREATE TABLE IF NOT EXISTS api_endpoints (data TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS file_blobs (
  id TEXT PRIMARY KEY,
  data BLOB NOT NULL
);
