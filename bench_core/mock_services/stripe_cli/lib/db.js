/**
 * db.js — bun:sqlite 状态层。
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DB_PATH = process.env.STRIPE_MOCK_DB || join(ROOT, "data", "stripe_mock.sqlite");

let _db = null;

export function getDb() {
  if (_db) return _db;
  // 确保 data/ 存在
  try {
    require("node:fs").mkdirSync(dirname(DB_PATH), { recursive: true });
  } catch {}
  _db = new Database(DB_PATH, { create: true });
  _db.exec(readFileSync(join(ROOT, "schema.sql"), "utf8"));
  return _db;
}

export function insertObject(db, { id, object, resource, created, data }) {
  db.prepare(
    "INSERT INTO objects (id, object, resource, created, deleted, data_json) VALUES (?,?,?,?,0,?)",
  ).run(id, object, resource, created, JSON.stringify(data));
}

// 跨资源按 id 查（--expand 用）
export function getById(db, id) {
  const row = db.prepare("SELECT data_json, deleted FROM objects WHERE id = ?").get(id);
  if (!row || row.deleted) return null;
  return JSON.parse(row.data_json);
}

export function getObject(db, resource, id) {
  const row = db
    .prepare("SELECT data_json, deleted FROM objects WHERE id = ? AND resource = ?")
    .get(id, resource);
  if (!row || row.deleted) return null;
  return JSON.parse(row.data_json);
}

export function updateObject(db, resource, id, data) {
  db.prepare("UPDATE objects SET data_json = ? WHERE id = ? AND resource = ?").run(
    JSON.stringify(data),
    id,
    resource,
  );
}

export function markDeleted(db, resource, id) {
  db.prepare("UPDATE objects SET deleted = 1 WHERE id = ? AND resource = ?").run(id, resource);
}

export function listObjects(db, resource, limit, filter) {
  let rows = db
    .prepare(
      "SELECT data_json FROM objects WHERE resource = ? AND deleted = 0 ORDER BY created DESC, id DESC LIMIT ?",
    )
    .all(resource, limit);
  if (filter) {
    rows = rows.filter((r) => {
      const d = JSON.parse(r.data_json);
      return Object.entries(filter).every(([k, v]) => d[k] === v);
    });
  }
  return rows.map((r) => JSON.parse(r.data_json));
}

export function audit(db, { resource, operation, objectId, details }) {
  db.prepare(
    "INSERT INTO audit_log (ts, resource, operation, object_id, details_json) VALUES (?,?,?,?,?)",
  ).run(Math.floor(Date.now() / 1000), resource, operation, objectId || null, JSON.stringify(details || {}));
}

// --- config ---
export function getConfig(db, profile, key) {
  const row = db.prepare("SELECT value FROM config WHERE profile = ? AND key = ?").get(profile, key);
  return row ? row.value : null;
}

export function setConfig(db, profile, key, value) {
  db.prepare(
    "INSERT INTO config (profile, key, value) VALUES (?,?,?) ON CONFLICT(profile, key) DO UPDATE SET value = excluded.value",
  ).run(profile, key, value);
}

export function unsetConfig(db, profile, key) {
  db.prepare("DELETE FROM config WHERE profile = ? AND key = ?").run(profile, key);
}

export function listConfig(db) {
  return db.prepare("SELECT profile, key, value FROM config ORDER BY profile, key").all();
}
