import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Database } from 'bun:sqlite';
import { generateSeedData } from './seed.js';
import { generateId } from '../utils/ids.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class StateStore {
  constructor(dbPath) {
    const dataDir = process.env.NTN_MOCK_DATA_DIR || path.join(__dirname, '../../data');
    this._dbPath = dbPath || path.join(dataDir, 'mock.db');
    this._db = null;
  }

  load() {
    const dir = path.dirname(this._dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this._db = new Database(this._dbPath);
    this._db.exec('PRAGMA journal_mode = WAL');
    this._db.exec('PRAGMA foreign_keys = ON');

    this._createTables();

    const row = this._db.query('SELECT COUNT(*) as cnt FROM account').get();
    if (row.cnt === 0) {
      this._seedDatabase();
    }
  }

  _createTables() {
    this._db.exec(`
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
    `);
  }

  _seedDatabase() {
    const seed = generateSeedData();
    this._db.exec('BEGIN');
    try {
      this._db.query('DELETE FROM account').run();
      this._db.query('DELETE FROM settings').run();
      this._db.query('DELETE FROM entities').run();
      this._db.query('DELETE FROM events').run();
      this._db.query('DELETE FROM api_endpoints').run();
      this._db.query('DELETE FROM file_blobs').run();

      this._db.query('INSERT INTO account (data) VALUES (?)').run(JSON.stringify(seed.account));
      this._db.query('INSERT INTO settings (data) VALUES (?)').run(JSON.stringify(seed.settings));

      const insertEntity = this._db.query('INSERT OR REPLACE INTO entities (id, type, data) VALUES (?, ?, ?)');
      for (const [type, collection] of Object.entries(seed.entities)) {
        if (type === 'apiEndpoints') continue;
        if (Array.isArray(collection)) {
          for (const item of collection) {
            insertEntity.run(item.id || `${type}_${Math.random().toString(36).slice(2, 10)}`, type, JSON.stringify(item));
          }
        } else {
          for (const [id, item] of Object.entries(collection)) {
            insertEntity.run(id, type, JSON.stringify(item));
          }
        }
      }

      this._db.query('INSERT INTO api_endpoints (data) VALUES (?)').run(JSON.stringify(seed.entities.apiEndpoints));

      const insertEvent = this._db.query('INSERT INTO events (id, timestamp, action, entity_type, entity_id, data) VALUES (?, ?, ?, ?, ?, ?)');
      for (const evt of seed.events) {
        insertEvent.run(evt.id, evt.timestamp, evt.action, evt.entityType, evt.entityId, JSON.stringify(evt));
      }
      for (const [fileId, content] of Object.entries(seed.fileBlobs || {})) {
        this.saveFileBlob(fileId, Buffer.from(String(content), 'base64'));
      }
      this._db.exec('COMMIT');
    } catch (err) {
      this._db.exec('ROLLBACK');
      throw err;
    }
  }

  save() {
    // No-op: SQLite persists on every write
  }

  reset() {
    this._db.query('DELETE FROM file_blobs').run();
    this._seedDatabase();
    return { message: 'State reset to seed data', timestamp: new Date().toISOString() };
  }

  applySeedOverlay(overlay) {
    if (!overlay || typeof overlay !== 'object') {
      throw new Error('seed overlay must be an object');
    }

    this._db.exec('BEGIN');
    try {
      if (overlay.account) {
        this.updateAccount(overlay.account);
      }
      if (overlay.settings) {
        const updated = { ...this.getSettings(), ...overlay.settings };
        this._db.query('UPDATE settings SET data = ?').run(JSON.stringify(updated));
      }

      const upsertEntity = this._db.query('INSERT OR REPLACE INTO entities (id, type, data) VALUES (?, ?, ?)');
      for (const [type, collection] of Object.entries(overlay.entities || {})) {
        if (type === 'apiEndpoints') {
          this._db.query('DELETE FROM api_endpoints').run();
          this._db.query('INSERT INTO api_endpoints (data) VALUES (?)').run(JSON.stringify(collection));
          continue;
        }
        if (Array.isArray(collection)) {
          for (const item of collection) {
            if (!item?.id) throw new Error(`seed overlay ${type} array item missing id`);
            upsertEntity.run(item.id, type, JSON.stringify(item));
          }
          continue;
        }
        for (const [id, item] of Object.entries(collection || {})) {
          upsertEntity.run(id, type, JSON.stringify({ ...item, id: item.id || id }));
        }
      }

      const insertEvent = this._db.query(
        'INSERT OR REPLACE INTO events (id, timestamp, action, entity_type, entity_id, data) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const evt of overlay.events || []) {
        if (!evt.id || !evt.timestamp || !evt.action) {
          throw new Error('seed overlay event missing id, timestamp, or action');
        }
        insertEvent.run(evt.id, evt.timestamp, evt.action, evt.entityType || null, evt.entityId || null, JSON.stringify(evt));
      }

      for (const [fileId, content] of Object.entries(overlay.fileBlobs || {})) {
        this.saveFileBlob(fileId, Buffer.from(String(content), 'base64'));
      }

      this._db.exec('COMMIT');
    } catch (err) {
      this._db.exec('ROLLBACK');
      throw err;
    }

    return { message: 'Seed overlay applied', timestamp: new Date().toISOString() };
  }

  getState() {
    const account = this.getAccount();
    const settings = this.getSettings();

    const entityTypes = ['workers', 'capabilities', 'envVars', 'syncs', 'oauthTokens', 'runs', 'webhooks', 'pages', 'datasources', 'files'];
    const entities = {};
    for (const type of entityTypes) {
      const rows = this._db.query('SELECT id, data FROM entities WHERE type = ?').all(type);
      const obj = {};
      for (const row of rows) {
        obj[row.id] = JSON.parse(row.data);
      }
      entities[type] = obj;
    }

    const epRow = this._db.query('SELECT data FROM api_endpoints').get();
    entities.apiEndpoints = epRow ? JSON.parse(epRow.data) : [];

    const events = this._db.query('SELECT data FROM events ORDER BY timestamp ASC').all().map(r => JSON.parse(r.data));

    return { account, settings, entities, events };
  }

  getAccount() {
    const row = this._db.query('SELECT data FROM account').get();
    return row ? JSON.parse(row.data) : {};
  }

  updateAccount(patch) {
    const current = this.getAccount();
    const updated = { ...current, ...patch };
    this._db.query('UPDATE account SET data = ?').run(JSON.stringify(updated));
    return { ...updated };
  }

  getSettings() {
    const row = this._db.query('SELECT data FROM settings').get();
    return row ? JSON.parse(row.data) : {};
  }

  listEntities(type, filter) {
    if (type === 'apiEndpoints') {
      const row = this._db.query('SELECT data FROM api_endpoints').get();
      return row ? JSON.parse(row.data) : [];
    }

    const rows = this._db.query('SELECT data FROM entities WHERE type = ?').all(type);
    let items = rows.map(r => JSON.parse(r.data));

    if (filter) {
      items = items.filter(item =>
        Object.entries(filter).every(([k, v]) => item[k] === v)
      );
    }
    return items;
  }

  getEntity(type, id) {
    const row = this._db.query('SELECT data FROM entities WHERE id = ? AND type = ?').get(id, type);
    return row ? JSON.parse(row.data) : null;
  }

  createEntity(type, data) {
    const entityTypeMap = {
      workers: 'worker', capabilities: 'capability', envVars: 'envVar',
      syncs: 'sync', oauthTokens: 'oauth', runs: 'run', webhooks: 'webhook',
      pages: 'page', datasources: 'datasource', files: 'file',
    };
    const id = data.id || generateId(entityTypeMap[type] || type);
    const now = new Date().toISOString();
    const entity = { id, createdAt: now, updatedAt: now, ...data, id };

    this._db.query('INSERT OR REPLACE INTO entities (id, type, data) VALUES (?, ?, ?)').run(id, type, JSON.stringify(entity));
    return { ...entity };
  }

  updateEntity(type, id, patch) {
    const row = this._db.query('SELECT data FROM entities WHERE id = ? AND type = ?').get(id, type);
    if (!row) return null;

    const current = JSON.parse(row.data);
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this._db.query('UPDATE entities SET data = ? WHERE id = ?').run(JSON.stringify(updated), id);
    return { ...updated };
  }

  deleteEntity(type, id) {
    const result = this._db.query('DELETE FROM entities WHERE id = ? AND type = ?').run(id, type);
    return result.changes > 0;
  }

  addEvent(action, entityType, entityId, details = {}) {
    const event = {
      id: generateId('event'),
      timestamp: new Date().toISOString(),
      action,
      entityType,
      entityId,
      details,
    };
    this._db.query('INSERT INTO events (id, timestamp, action, entity_type, entity_id, data) VALUES (?, ?, ?, ?, ?, ?)').run(
      event.id, event.timestamp, event.action, entityType, entityId, JSON.stringify(event)
    );

    const count = this._db.query('SELECT COUNT(*) as cnt FROM events').get().cnt;
    if (count > 1000) {
      this._db.query(`DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY timestamp ASC LIMIT ?)`).run(count - 500);
    }

    return event;
  }

  getEvents(limit = 50) {
    const rows = this._db.query('SELECT data FROM events ORDER BY timestamp DESC LIMIT ?').all(limit);
    return rows.map(r => JSON.parse(r.data));
  }

  saveFileBlob(fileId, buffer) {
    this._db.query('INSERT OR REPLACE INTO file_blobs (id, data) VALUES (?, ?)').run(fileId, new Uint8Array(buffer));
  }

  getFileBlob(fileId) {
    const row = this._db.query('SELECT data FROM file_blobs WHERE id = ?').get(fileId);
    return row ? Buffer.from(row.data) : null;
  }

  deleteFileBlob(fileId) {
    this._db.query('DELETE FROM file_blobs WHERE id = ?').run(fileId);
  }
}
