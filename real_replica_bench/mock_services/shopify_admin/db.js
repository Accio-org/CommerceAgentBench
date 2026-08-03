// Bun-only: this file runs under `bun server.js` inside the Accio workstation
// derived image (`commercecraftbench/acciocli:*phoenix0.6.9`).
// Uses Bun's built-in `bun:sqlite` so no native compilation is needed.
const { Database } = require('bun:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'benchmark.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH, { create: true });
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    init();
  }
  return db;
}

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active',
      page TEXT NOT NULL DEFAULT 'product'
    );

    CREATE TABLE IF NOT EXISTS field_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_value TEXT,
      file_path TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      UNIQUE(session_id, field_name)
    );
  `);

  // Migrate older databases that lack the page column (defensive only;
  // benchmark containers always start from a fresh data dir).
  const cols = db.prepare("PRAGMA table_info(sessions)").all();
  if (!cols.some(c => c.name === 'page')) {
    db.exec("ALTER TABLE sessions ADD COLUMN page TEXT NOT NULL DEFAULT 'product'");
  }
}

function createSession(id, page = 'product') {
  getDb().prepare('INSERT INTO sessions (id, page) VALUES (?, ?)').run(id, page);
}

function getActiveSession(page) {
  if (page) {
    return getDb().prepare(
      "SELECT * FROM sessions WHERE status = 'active' AND page = ? ORDER BY created_at DESC LIMIT 1"
    ).get(page);
  }
  return getDb().prepare(
    "SELECT * FROM sessions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get();
}

function archiveAllSessions(page) {
  if (page) {
    getDb().prepare("UPDATE sessions SET status = 'archived' WHERE status = 'active' AND page = ?").run(page);
  } else {
    getDb().prepare("UPDATE sessions SET status = 'archived' WHERE status = 'active'").run();
  }
}

function setSessionStatus(id, status) {
  getDb().prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id);
}

function upsertField(sessionId, fieldName, fieldValue, filePath) {
  getDb().prepare(`
    INSERT INTO field_values (session_id, field_name, field_value, file_path, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id, field_name) DO UPDATE SET
      field_value = excluded.field_value,
      file_path = excluded.file_path,
      updated_at = CURRENT_TIMESTAMP
  `).run(sessionId, fieldName, fieldValue || null, filePath || null);
}

function getSessionFields(sessionId) {
  return getDb().prepare(
    'SELECT field_name, field_value, file_path, updated_at FROM field_values WHERE session_id = ?'
  ).all(sessionId);
}

function getAllSessions() {
  return getDb().prepare(
    'SELECT s.*, COUNT(fv.id) as field_count FROM sessions s LEFT JOIN field_values fv ON s.id = fv.session_id GROUP BY s.id ORDER BY s.created_at DESC'
  ).all();
}

function getSession(id) {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

module.exports = {
  getDb,
  createSession,
  getActiveSession,
  archiveAllSessions,
  setSessionStatus,
  upsertField,
  getSessionFields,
  getAllSessions,
  getSession,
};
