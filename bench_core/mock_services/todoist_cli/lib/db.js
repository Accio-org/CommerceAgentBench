// Database module — opens/inits SQLite via bun:sqlite
import { Database } from 'bun:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MOCK_DIR = dirname(dirname(import.meta.path));

/**
 * Resolve the base home directory for mock state.
 * Uses TODOIST_MOCK_HOME env if set, otherwise $HOME.
 */
export function resolveHome() {
  return process.env.TODOIST_MOCK_HOME || process.env.HOME || '/root';
}

/**
 * Get the path to the mock SQLite database.
 */
export function dbPath() {
  const home = resolveHome();
  const dir = join(home, '.cache', 'todoist');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, 'mock.db');
}

/**
 * Open the database, run schema if tables don't exist,
 * run default seeds if the items table is empty.
 */
export function openDb(path) {
  const p = path || dbPath();
  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(p);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  // Run schema
  const schemaPath = join(MOCK_DIR, 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);

  // Seed if empty
  const count = db.query('SELECT COUNT(*) as c FROM projects').get();
  if (count.c === 0) {
    const seedPath = join(MOCK_DIR, 'seeds', 'default.sql');
    if (existsSync(seedPath)) {
      const seedSql = readFileSync(seedPath, 'utf-8');
      db.exec(seedSql);
    }
  }

  return db;
}

/**
 * Generate a new ID (numeric string, 10 digits).
 */
let _idCounter = 0;
export function newId() {
  _idCounter++;
  const ts = Date.now().toString().slice(-7);
  const suffix = _idCounter.toString().padStart(3, '0');
  return ts + suffix;
}

/**
 * Get current ISO timestamp.
 */
export function nowISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Write an audit log entry.
 */
export function auditLog(db, operation, entityType, entityId, details) {
  db.prepare(
    'INSERT INTO audit_log (timestamp, operation, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?)'
  ).run(nowISO(), operation, entityType, entityId || '', JSON.stringify(details || {}));
}
