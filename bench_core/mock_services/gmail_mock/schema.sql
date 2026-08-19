-- Gmail mock — SQLite schema (bun:sqlite).
--
-- Storage model: the HTTP server keeps an in-memory working copy of state and
-- writes the whole state back to these tables after every mutation (see db.js
-- persistState). So these tables are the durable, queryable source of truth at
-- rest; the in-memory copy is a runtime cache rebuilt from here on boot/reset.
--
-- Conventions:
--   * Every list table has a `seq` column = the entity's position in its array.
--     Order is significant (e.g. message list order, sidebar label order) and
--     is NOT derivable from any other column, so it is stored explicitly and
--     read back with ORDER BY seq.
--   * Booleans are stored as INTEGER 0/1.
--   * `labels` / `attachments` / `actions` hold JSON text (SQLite json1).
--   * Optional/absent fields are stored as NULL and OMITTED on read (so the
--     reconstructed object matches the original shape exactly — e.g. a label
--     with no parent has no `parentId` key rather than `parentId: null`).
--   * Derived counts (label.unread, category.unread) are NOT stored — the
--     server recomputes them from messages + counterOffsets.
--   * Singletons (account, settings, counterOffsets, nextLabelId) live in
--     `meta` as JSON; the audit log lives in `events`.
--
-- Column names use snake_case and rename SQL-reserved/ambiguous fields
-- (from -> from_name/from_addr, to -> to_addr). db.js ENTITY_SPECS maps these
-- back to the original camelCase JS field names on load.

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL DEFAULT 0,
  category       TEXT,
  labels         TEXT,            -- json array
  from_name      TEXT,
  from_email     TEXT,
  to_addr        TEXT,
  cc             TEXT,
  bcc            TEXT,
  subject        TEXT,
  snippet        TEXT,
  body           TEXT,
  date           TEXT,
  full_date      TEXT,
  unread         INTEGER DEFAULT 0,
  starred        INTEGER DEFAULT 0,
  important      INTEGER DEFAULT 0,
  selected       INTEGER DEFAULT 0,
  has_attachment INTEGER DEFAULT 0,
  attachments    TEXT,            -- json array
  muted          INTEGER DEFAULT 0,
  scheduled_at   TEXT,
  snoozed_until  TEXT,
  thread_id      TEXT
);

CREATE TABLE IF NOT EXISTS labels (
  id        TEXT PRIMARY KEY,
  seq       INTEGER NOT NULL DEFAULT 0,
  name      TEXT,
  icon      TEXT,
  type      TEXT,
  color     TEXT,
  parent_id TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id       TEXT PRIMARY KEY,
  seq      INTEGER NOT NULL DEFAULT 0,
  name     TEXT,
  selected INTEGER DEFAULT 0,
  teaser   TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id         TEXT PRIMARY KEY,
  seq        INTEGER NOT NULL DEFAULT 0,
  name       TEXT,
  email      TEXT,
  phone      TEXT,
  notes      TEXT,
  source     TEXT,
  color      TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id           TEXT PRIMARY KEY,
  seq          INTEGER NOT NULL DEFAULT 0,
  name         TEXT,
  email        TEXT,
  recent       TEXT,
  unsubscribed INTEGER DEFAULT 0,
  status       TEXT,
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id          TEXT PRIMARY KEY,
  seq         INTEGER NOT NULL DEFAULT 0,
  title       TEXT,
  date        TEXT,
  start       TEXT,
  end         TEXT,
  guests      TEXT,
  location    TEXT,
  description TEXT,
  meet        INTEGER,
  all_day     INTEGER,
  color       TEXT,
  calendar    TEXT,
  created_at  TEXT
);

CREATE TABLE IF NOT EXISTS drafts (
  id         TEXT PRIMARY KEY,
  seq        INTEGER NOT NULL DEFAULT 0,
  to_addr    TEXT,
  cc         TEXT,
  bcc        TEXT,
  subject    TEXT,
  body       TEXT,
  updated_at TEXT,
  thread_id  TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  seq               INTEGER NOT NULL DEFAULT 0,
  title             TEXT,
  details           TEXT,
  due               TEXT,
  source_message_id TEXT,
  completed         INTEGER DEFAULT 0,
  created_at        TEXT,
  updated_at        TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  seq        INTEGER NOT NULL DEFAULT 0,
  title      TEXT,
  body       TEXT,
  pinned     INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS filters (
  id             TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL DEFAULT 0,
  from_addr      TEXT,
  to_addr        TEXT,
  subject        TEXT,
  has_words      TEXT,
  doesnt_have    TEXT,
  has_attachment INTEGER DEFAULT 0,
  actions        TEXT,            -- json object
  updated_at     TEXT
);

-- Audit log (server.js pushEvent). Entries are heterogeneous per event type,
-- so the whole entry is stored as JSON; seq preserves insertion order.
CREATE TABLE IF NOT EXISTS events (
  seq   INTEGER PRIMARY KEY,
  entry TEXT NOT NULL           -- json object {ts, type, ...details}
);

-- Singletons: account, settings, counterOffsets, nextLabelId (JSON values).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL           -- json
);
