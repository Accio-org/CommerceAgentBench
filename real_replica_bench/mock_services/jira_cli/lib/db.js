/**
 * db.js — SQLite database init and accessor for Jira CLI mock.
 * Uses bun:sqlite (built-in, zero npm deps).
 */

import { Database } from "bun:sqlite";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const __dirname = dirname(new URL(import.meta.url).pathname);
const MOCK_ROOT = join(__dirname, "..");

let _db = null;

/**
 * Return (or lazily create) the singleton Database instance.
 * DB path: $JIRA_MOCK_DB || $JIRA_MOCK_HOME/jira_mock.db || <mock_root>/jira_mock.db
 */
export function getDb() {
  if (_db) return _db;

  const dbPath =
    process.env.JIRA_MOCK_DB ||
    join(process.env.JIRA_MOCK_HOME || MOCK_ROOT, "jira_mock.db");

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const needsInit = !existsSync(dbPath);
  _db = new Database(dbPath);
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA foreign_keys=ON");

  if (needsInit) {
    initSchema(_db);
    seedDefault(_db);
  }

  return _db;
}

/**
 * Force-init: create tables + seed.  Used by `jira-bench reset`.
 */
export function resetDb() {
  const db = getDb();
  // Drop all user tables in dependency order
  const tables = [
    "audit_log", "sprint_issues", "comments", "issue_links",
    "issues", "transitions", "sprints", "boards",
    "issue_priorities", "issue_statuses", "issue_types",
    "projects", "config",
  ];
  for (const t of tables) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  initSchema(db);
  seedDefault(db);
}

/**
 * Run schema.sql to create tables.
 */
function initSchema(db) {
  const sql = readFileSync(join(MOCK_ROOT, "schema.sql"), "utf-8");
  db.exec(sql);
}

/**
 * Run default seed or a custom seed file.
 */
export function seedDefault(db) {
  const sql = readFileSync(join(MOCK_ROOT, "seeds", "default.sql"), "utf-8");
  db.exec(sql);
}

/**
 * Seed from an arbitrary SQL file path.
 */
export function seedFromFile(db, filePath) {
  const sql = readFileSync(filePath, "utf-8");
  db.exec(sql);
}

/**
 * Write an entry to the audit log.
 */
export function auditLog(operation, entityType, entityId, details) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (timestamp, operation, entity_type, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    operation,
    entityType,
    entityId || null,
    details ? JSON.stringify(details) : null
  );
}

/**
 * Get next issue sequence number for a project, then increment.
 */
export function nextIssueSeq(projectKey) {
  const db = getDb();
  const configKey = `issue_seq_${projectKey}`;
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(configKey);
  let seq = row ? parseInt(row.value, 10) : 0;
  seq += 1;
  db.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?"
  ).run(configKey, String(seq), String(seq));
  return seq;
}

/**
 * Generate a UUID-like id.
 */
export function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
