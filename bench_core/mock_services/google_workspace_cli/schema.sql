-- SQLite schema for Google Workspace (Sheets + Slides) CLI mock
-- Source of truth for database structure. lib/db.mjs reads this at init.

CREATE TABLE IF NOT EXISTS spreadsheets (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presentations (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT DEFAULT '',
  details_json TEXT DEFAULT '{}'
);
