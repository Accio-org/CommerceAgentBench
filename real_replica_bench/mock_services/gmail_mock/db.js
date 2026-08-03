// Gmail mock — SQLite storage layer (bun:sqlite).
//
// Runs under `bun server.js` inside the Accio/OpenClaw workstation derived
// images (same runtime every other stateful mock uses — see
// mock_services/{shopify_admin,alibaba_publish}/db.js and the CLI mocks). Uses
// Bun's built-in `bun:sqlite`, so there is no native build step.
//
// Storage model (hydrate + write-through):
//   * getDb() opens data/gmail.db, applies schema.sql, and — if empty — seeds
//     it from the per-entity JSON files in seeds/ (the human-authored source
//     you edit to construct mailbox data).
//   * loadState(db) reads every table into a plain `state` object with the exact
//     shape the HTTP server expects (the same shape buildInitialState used to
//     return, minus derived counts which the server recomputes).
//   * The server mutates that in-memory `state` with its existing logic, then
//     calls persistState(db, state) to write the whole state back. So the DB is
//     the durable, queryable source of truth at rest; in-memory is a cache.
//   * resetDb(db) wipes + reseeds from JSON (POST /api/reset, fresh container).
//
// Editing workflow: change a file under seeds/, then POST /api/reset (or restart
// with a fresh data dir) to rebuild the DB from the new seed. Inspect live state
// with any SQLite tool: `sqlite3 data/gmail.db 'SELECT id,subject FROM messages'`.

const { Database } = require('bun:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.GMAIL_MOCK_DB || path.join(__dirname, 'data', 'gmail.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SEEDS_DIR = path.join(__dirname, 'seeds');

function now() {
  return new Date().toISOString();
}

// Default-fill a (possibly sparse) message so seed entries only need the fields
// you care about. Mirrors server.js makeMessage exactly.
function makeMessage(id, overrides = {}) {
  return {
    id,
    category: 'primary',
    labels: ['inbox'],
    from: 'Google',
    fromEmail: 'no-reply@example.com',
    to: 'kylekk0215@gmail.com',
    cc: '',
    bcc: '',
    subject: '(无主题)',
    snippet: '',
    body: '',
    date: '5月28日',
    fullDate: '2026年5月28日周四',
    unread: false,
    starred: false,
    important: false,
    selected: false,
    hasAttachment: false,
    attachments: [],
    muted: false,
    ...overrides
  };
}

// Field spec: [jsKey, column, type]. type ∈ {'text','bool','json'} (default text).
const f = (k, c, t = 'text') => ({ k, c, t });

// One spec per list entity. `stateKey` is the key in the state object,
// `seed` the seeds/ filename, `defaults` an optional sparse->full filler.
const ENTITY_SPECS = [
  {
    stateKey: 'messages', table: 'messages', seed: 'messages.json', defaults: makeMessage,
    fields: [
      f('category', 'category'), f('labels', 'labels', 'json'),
      f('from', 'from_name'), f('fromEmail', 'from_email'), f('to', 'to_addr'),
      f('cc', 'cc'), f('bcc', 'bcc'), f('subject', 'subject'),
      f('snippet', 'snippet'), f('body', 'body'), f('date', 'date'), f('fullDate', 'full_date'),
      f('unread', 'unread', 'bool'), f('starred', 'starred', 'bool'),
      f('important', 'important', 'bool'), f('selected', 'selected', 'bool'),
      f('hasAttachment', 'has_attachment', 'bool'), f('attachments', 'attachments', 'json'),
      f('muted', 'muted', 'bool'),
      f('scheduledAt', 'scheduled_at'), f('snoozedUntil', 'snoozed_until'), f('threadId', 'thread_id')
    ]
  },
  {
    stateKey: 'labels', table: 'labels', seed: 'labels.json',
    fields: [f('name', 'name'), f('icon', 'icon'), f('type', 'type'), f('color', 'color'), f('parentId', 'parent_id')]
  },
  {
    stateKey: 'categories', table: 'categories', seed: 'categories.json',
    fields: [f('name', 'name'), f('selected', 'selected', 'bool'), f('teaser', 'teaser')]
  },
  {
    stateKey: 'contacts', table: 'contacts', seed: 'contacts.json',
    fields: [
      f('name', 'name'), f('email', 'email'), f('phone', 'phone'), f('notes', 'notes'),
      f('source', 'source'), f('color', 'color'), f('createdAt', 'created_at'), f('updatedAt', 'updated_at')
    ]
  },
  {
    stateKey: 'subscriptions', table: 'subscriptions', seed: 'subscriptions.json',
    fields: [
      f('name', 'name'), f('email', 'email'), f('recent', 'recent'),
      f('unsubscribed', 'unsubscribed', 'bool'), f('status', 'status'), f('updatedAt', 'updated_at')
    ]
  },
  {
    stateKey: 'calendarEvents', table: 'calendar_events', seed: 'calendar_events.json',
    fields: [
      f('title', 'title'), f('date', 'date'), f('start', 'start'), f('end', 'end'),
      f('guests', 'guests'), f('location', 'location'), f('description', 'description'),
      f('meet', 'meet', 'bool'), f('allDay', 'all_day', 'bool'), f('color', 'color'),
      f('calendar', 'calendar'), f('createdAt', 'created_at')
    ]
  },
  {
    stateKey: 'drafts', table: 'drafts', seed: 'drafts.json',
    fields: [
      f('to', 'to_addr'), f('cc', 'cc'), f('bcc', 'bcc'), f('subject', 'subject'),
      f('body', 'body'), f('updatedAt', 'updated_at'), f('threadId', 'thread_id')
    ]
  },
  {
    stateKey: 'tasks', table: 'tasks', seed: 'tasks.json',
    fields: [
      f('title', 'title'), f('details', 'details'), f('due', 'due'),
      f('sourceMessageId', 'source_message_id'), f('completed', 'completed', 'bool'),
      f('createdAt', 'created_at'), f('updatedAt', 'updated_at')
    ]
  },
  {
    stateKey: 'notes', table: 'notes', seed: 'notes.json',
    fields: [
      f('title', 'title'), f('body', 'body'), f('pinned', 'pinned', 'bool'),
      f('createdAt', 'created_at'), f('updatedAt', 'updated_at')
    ]
  },
  {
    stateKey: 'filters', table: 'filters', seed: 'filters.json',
    fields: [
      f('from', 'from_addr'), f('to', 'to_addr'), f('subject', 'subject'),
      f('hasWords', 'has_words'), f('doesntHave', 'doesnt_have'),
      f('hasAttachment', 'has_attachment', 'bool'), f('actions', 'actions', 'json'), f('updatedAt', 'updated_at')
    ]
  }
];

const SINGLETON_DEFAULTS = {
  account: {},
  settings: {},
  counterOffsets: { labels: {}, categories: {} },
  nextLabelId: 1
};

function toCol(field, obj) {
  if (!(field.k in obj)) return null;
  const v = obj[field.k];
  if (v === undefined || v === null) return null;
  if (field.t === 'bool') return v ? 1 : 0;
  if (field.t === 'json') return JSON.stringify(v);
  return v;
}

function fromCol(field, v) {
  if (v === null || v === undefined) return undefined; // omit key — preserve original shape
  if (field.t === 'bool') return !!v;
  if (field.t === 'json') return JSON.parse(v);
  return v;
}

function insertRows(db, spec, arr, applyDefaults) {
  if (!arr || !arr.length) return;
  const cols = ['id', 'seq', ...spec.fields.map((x) => x.c)];
  const stmt = db.prepare(
    `INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  );
  arr.forEach((raw, i) => {
    const obj = applyDefaults && spec.defaults ? spec.defaults(raw.id, raw) : raw;
    stmt.run(obj.id, i, ...spec.fields.map((field) => toCol(field, obj)));
  });
}

function loadEntity(db, spec) {
  const rows = db.prepare(`SELECT * FROM ${spec.table} ORDER BY seq ASC`).all();
  return rows.map((row) => {
    const obj = { id: row.id };
    for (const field of spec.fields) {
      const val = fromCol(field, row[field.c]);
      if (val !== undefined) obj[field.k] = val;
    }
    return obj;
  });
}

function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : JSON.parse(JSON.stringify(SINGLETON_DEFAULTS[key] ?? null));
}

function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

function readSeed(name, fallback) {
  const p = path.join(SEEDS_DIR, name);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Safety net: fail loudly if schema.sql and ENTITY_SPECS drift apart.
function assertSchema(db) {
  for (const spec of ENTITY_SPECS) {
    const cols = new Set(db.prepare(`PRAGMA table_info(${spec.table})`).all().map((r) => r.name));
    for (const need of ['id', 'seq', ...spec.fields.map((x) => x.c)]) {
      if (!cols.has(need)) throw new Error(`schema/spec drift: ${spec.table}.${need} missing from schema.sql`);
    }
  }
}

function seedFromJson(db) {
  db.transaction(() => {
    for (const spec of ENTITY_SPECS) insertRows(db, spec, readSeed(spec.seed, []), true);
    setMeta(db, 'account', readSeed('account.json', {}));
    setMeta(db, 'settings', readSeed('settings.json', {}));
    const meta = readSeed('meta.json', {});
    setMeta(db, 'counterOffsets', meta.counterOffsets || { labels: {}, categories: {} });
    setMeta(db, 'nextLabelId', meta.nextLabelId ?? 1);
    appendEvent(db, {
      ts: now(),
      type: 'seed_loaded',
      messages: readSeed('messages.json', []).length,
      subscriptions: readSeed('subscriptions.json', []).length
    });
  })();
}

let _db = null;

function getDb() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  assertSchema(db);
  const seeded = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  if (!seeded) seedFromJson(db);
  _db = db;
  return db;
}

function loadState(db) {
  const state = {};
  for (const spec of ENTITY_SPECS) state[spec.stateKey] = loadEntity(db, spec);
  state.account = getMeta(db, 'account');
  state.settings = getMeta(db, 'settings');
  state.counterOffsets = getMeta(db, 'counterOffsets');
  state.nextLabelId = getMeta(db, 'nextLabelId');
  // events are intentionally NOT loaded into memory — the audit log is DB-only
  // (read on demand via getEvents / GET /api/events).
  return state;
}

// --- Audit log (DB-only) -------------------------------------------------
// Append one event row. `seq` is the INTEGER PRIMARY KEY (rowid), so omitting
// it lets SQLite auto-assign max+1 — append-only ordering without reading the
// table, and no in-memory accumulation.
function appendEvent(db, entry) {
  db.prepare('INSERT INTO events (entry) VALUES (?)').run(JSON.stringify(entry));
  return entry;
}

// Read events in chronological order. No opts → all. `limit` → the most recent
// N (still returned oldest-first); `offset` → skip that many of the most recent
// before taking `limit` (for paging back through history).
function getEvents(db, opts = {}) {
  const { limit, offset } = opts;
  if (limit == null && !offset) {
    return db.prepare('SELECT entry FROM events ORDER BY seq ASC').all().map((r) => JSON.parse(r.entry));
  }
  const lim = limit == null ? -1 : Math.max(0, Number(limit) || 0); // SQLite LIMIT -1 = unbounded
  const off = offset ? Math.max(0, Number(offset) || 0) : 0;
  return db.prepare('SELECT entry FROM events ORDER BY seq DESC LIMIT ? OFFSET ?')
    .all(lim, off).reverse().map((r) => JSON.parse(r.entry));
}

function countEvents(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM events').get().c;
}

function persistState(db, state) {
  db.transaction(() => {
    for (const spec of ENTITY_SPECS) {
      db.exec(`DELETE FROM ${spec.table}`);
      insertRows(db, spec, state[spec.stateKey] || [], false);
    }
    setMeta(db, 'account', state.account || {});
    setMeta(db, 'settings', state.settings || {});
    setMeta(db, 'counterOffsets', state.counterOffsets || { labels: {}, categories: {} });
    setMeta(db, 'nextLabelId', state.nextLabelId ?? 1);
    // Events are NOT persisted here: the audit log is DB-only and written
    // directly by appendEvent (see server.js pushEvent), so it never lives in
    // the in-memory state object and persist cost is independent of log size.
  })();
}

function resetDb(db) {
  db.transaction(() => {
    for (const spec of ENTITY_SPECS) db.exec(`DELETE FROM ${spec.table}`);
    db.exec('DELETE FROM events');
    db.exec('DELETE FROM meta');
  })();
  seedFromJson(db);
}

module.exports = {
  getDb, loadState, persistState, resetDb, seedFromJson,
  appendEvent, getEvents, countEvents,
  makeMessage, now, DB_PATH, ENTITY_SPECS
};
