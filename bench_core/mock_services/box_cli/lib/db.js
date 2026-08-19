// Database initialization and helpers for Box CLI mock
// Uses bun:sqlite — no external dependencies needed

import { Database } from 'bun:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_ROOT = join(__dirname, '..');
const SCHEMA_PATH = join(MOCK_ROOT, 'schema.sql');
const DEFAULT_SEED_PATH = join(MOCK_ROOT, 'seeds', 'default.sql');

let _idCounter = 0;
const _idBase = Date.now();

/** Generate a Box-style numeric string ID (11 digits). */
export function generateId() {
  _idCounter++;
  // Combine base timestamp with process-unique counter to guarantee uniqueness
  return String(_idBase + _idCounter) + String(Math.floor(Math.random() * 100)).padStart(2, '0');
}

let _etagCounter = 0;

/** Generate an etag string (incrementing integer). */
export function generateEtag() {
  _etagCounter++;
  return String(_etagCounter);
}

/** Current ISO timestamp. */
export function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Open (or create) the SQLite database.
 * DB path: $BOX_MOCK_DB or $BOX_MOCK_HOME/.box/box_mock.db or ~/.box/box_mock.db
 */
export function openDb() {
  let dbPath;
  if (process.env.BOX_MOCK_DB) {
    dbPath = process.env.BOX_MOCK_DB;
  } else {
    const homeBase = process.env.BOX_MOCK_HOME || process.env.HOME || '/root';
    const boxDir = join(homeBase, '.box');
    if (!existsSync(boxDir)) {
      mkdirSync(boxDir, { recursive: true });
    }
    dbPath = join(boxDir, 'box_mock.db');
  }
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA foreign_keys=ON;');
  return db;
}

/** Initialize schema (idempotent — IF NOT EXISTS). */
export function initSchema(db) {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
}

/** Run a seed SQL file. */
export function runSeed(db, seedPath) {
  const sql = readFileSync(seedPath || DEFAULT_SEED_PATH, 'utf-8');
  db.exec(sql);
}

/** Full init: open + schema + default seed if empty. */
export function initDb() {
  const db = openDb();
  initSchema(db);
  // Seed only if users table is empty (first run)
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (row.cnt === 0 && existsSync(DEFAULT_SEED_PATH)) {
    runSeed(db, DEFAULT_SEED_PATH);
  }
  return db;
}

/** Log an operation to the audit_log table. */
export function auditLog(db, operation, entityType, entityId, details) {
  db.prepare(
    'INSERT INTO audit_log (timestamp, operation, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?)'
  ).run(now(), operation, entityType, entityId || '', JSON.stringify(details || {}));
}
