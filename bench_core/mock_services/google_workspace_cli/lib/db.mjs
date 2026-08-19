import { Database } from 'bun:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildSeed } from '../seeds/default.mjs';

const MOCK_DIR = dirname(dirname(import.meta.path));

export function resolveHome() {
  return process.env.GWS_MOCK_HOME || process.env.HOME || '/root';
}

export function dbPath() {
  const home = resolveHome();
  const dir = join(home, '.cache', 'gws');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'mock.db');
}

export function openDb(path) {
  const p = path || dbPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(p);
  db.exec('PRAGMA journal_mode = WAL');

  const schemaPath = join(MOCK_DIR, 'schema.sql');
  db.exec(readFileSync(schemaPath, 'utf-8'));

  const count = db.query('SELECT COUNT(*) as c FROM spreadsheets').get();
  if (count.c === 0) {
    seedDb(db);
  }

  return db;
}

export function seedDb(db) {
  const seed = buildSeed();

  db.exec('BEGIN');
  try {
    db.query('DELETE FROM spreadsheets').run();
    db.query('DELETE FROM presentations').run();
    db.query('DELETE FROM audit_log').run();

    const insertSS = db.query('INSERT INTO spreadsheets (id, data) VALUES (?, ?)');
    for (const [id, ss] of Object.entries(seed.spreadsheets)) {
      insertSS.run(id, JSON.stringify(ss));
    }

    const insertPres = db.query('INSERT INTO presentations (id, data) VALUES (?, ?)');
    for (const [id, pres] of Object.entries(seed.presentations)) {
      insertPres.run(id, JSON.stringify(pres));
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function resetDb(db) {
  seedDb(db);
}

export function auditLog(db, kind, tool, details) {
  db.query(
    'INSERT INTO audit_log (timestamp, kind, tool, details_json) VALUES (?, ?, ?, ?)'
  ).run(new Date().toISOString(), kind, tool || '', JSON.stringify(details || {}));

  const count = db.query('SELECT COUNT(*) as c FROM audit_log').get().c;
  if (count > 500) {
    db.query('DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log ORDER BY id ASC LIMIT ?)').run(count - 500);
  }
}
