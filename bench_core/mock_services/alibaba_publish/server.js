const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const FIELDS = require('./fields');
const { validateField } = require('./validation');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN || '';
const ALLOW_CLI = process.env.MOCK_ALLOW_CLI === '1';
const CLI_TOKEN = process.env.MOCK_CLI_TOKEN || 'local-mock-token';
const BROWSER_COOKIE = 'mock_browser_nonce';
const browserNonces = new Set();
const sessionUiTokens = new Map();
const accessLog = [];
const pinnedAccessLog = [];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const NON_BROWSER_UA = /(curl|wget|python-requests|python-urllib|httpx|aiohttp|node-fetch|undici|axios|go-http-client|java|ruby|php|libwww|okhttp|postmanruntime)/i;
const BROWSER_UA = /(mozilla|chrome|chromium|safari|firefox|edg|headlesschrome)/i;
const UI_FETCH_API_PATHS = new Set(['/api/session', '/api/reset', '/api/submit', '/api/fields']);

// Events the verifier inspects directly (mock_integrity check). These are
// stored separately so high-volume routine accesses (asset fetches,
// /api/session polls) can't push a one-shot ui_submit_valid out of the
// bounded ring buffer before the verifier reads it.
const PINNED_EVENTS = new Set([
  'ui_submit_valid',
  'browser_required',
  'browser_session_required',
  'ui_token_required',
  'verifier_only',
  'cli_submit_valid',
  'cli_token_required',
]);

function logAccess(req, event, extra = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    method: req.method,
    path: req.path,
    userAgent: req.get('user-agent') || '',
    ...extra,
  };
  accessLog.push(entry);
  if (PINNED_EVENTS.has(event)) pinnedAccessLog.push(entry);
  if (accessLog.length > 5000) accessLog.shift();
  if (pinnedAccessLog.length > 1000) pinnedAccessLog.shift();
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function safeEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(req) {
  const raw = req.get('cookie') || '';
  const out = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function getBrowserNonce(req) {
  return parseCookies(req)[BROWSER_COOKIE] || '';
}

function hasValidBrowserNonce(req) {
  const nonce = getBrowserNonce(req);
  return !!(nonce && browserNonces.has(nonce));
}

function getOrCreateUiToken(sessionId) {
  if (!sessionUiTokens.has(sessionId)) sessionUiTokens.set(sessionId, randomToken());
  return sessionUiTokens.get(sessionId);
}

function hasValidUiToken(req, sessionId) {
  const expected = sessionUiTokens.get(sessionId);
  const actual = req.get('x-ui-token') || req.body?.ui_token || req.query?.ui_token || '';
  return !!(expected && actual && safeEquals(actual, expected));
}

function hasValidVerifierToken(req) {
  if (!VERIFIER_TOKEN) return true;
  return safeEquals(req.get('x-mock-verifier-token') || '', VERIFIER_TOKEN);
}

function extractBearerToken(req) {
  const raw = req.get('authorization') || '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hasValidCliToken(req) {
  if (!ALLOW_CLI) return false;
  return safeEquals(extractBearerToken(req), CLI_TOKEN);
}

function requireCliClient(req, res, next) {
  if (!ALLOW_CLI) {
    return denyJson(
      req,
      res,
      403,
      'cli_token_required',
      'CLI mode is not enabled on this mock instance.'
    );
  }
  if (!hasValidCliToken(req)) {
    return denyJson(
      req,
      res,
      403,
      'cli_token_required',
      'Provide Authorization: Bearer <MOCK_CLI_TOKEN> for /api/cli/* endpoints.'
    );
  }
  return next();
}

function denyJson(req, res, status, error, message, extra = {}) {
  logAccess(req, error, extra);
  return res.status(status).json({ error, message });
}

function classifyBrowserClient(req, { requireDocument = false } = {}) {
  const ua = req.get('user-agent') || '';
  const accept = req.get('accept') || '';
  const secFetchDest = req.get('sec-fetch-dest') || '';
  if (!ua) return 'missing user-agent';
  if (NON_BROWSER_UA.test(ua)) return 'programmatic user-agent';
  if (!BROWSER_UA.test(ua)) return 'non-browser user-agent';
  if (requireDocument && req.method === 'GET' && !accept.includes('text/html') && secFetchDest !== 'document') {
    return 'non-browser navigation headers';
  }
  return '';
}

function denyNonBrowser(req, res, reason) {
  logAccess(req, 'browser_required', { reason });
  return res.status(403).type('text/plain').send('Access Denied: automated HTTP clients, including curl and web fetch, are not permitted to retrieve this protected page. Please open the URL in a browser.\n');
}

function requireBrowserClient(req, res, next) {
  if (ALLOW_CLI && req.path.startsWith('/api/cli/')) return next();
  if (req.path === '/health' || req.path.startsWith('/uploads/')) return next();
  const isDocument = req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'));
  const isUiFetch = UI_FETCH_API_PATHS.has(req.path);
  if (!isDocument && !isUiFetch) return next();
  const reason = classifyBrowserClient(req, { requireDocument: isDocument });
  if (reason) return denyNonBrowser(req, res, reason);
  return next();
}

function issueBrowserNonce(req, res, next) {
  if (ALLOW_CLI && req.path.startsWith('/api/cli/')) return next();
  const isDocument = req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'));
  if (isDocument) {
    let nonce = getBrowserNonce(req);
    if (!nonce || !browserNonces.has(nonce)) {
      nonce = randomToken();
      browserNonces.add(nonce);
    }
    res.setHeader(
      'Set-Cookie',
      `${BROWSER_COOKIE}=${encodeURIComponent(nonce)}; Path=/; HttpOnly; SameSite=Lax`
    );
  }
  return next();
}

function requireBrowserSession(req, res, next) {
  if (!hasValidBrowserNonce(req)) {
    return denyJson(
      req,
      res,
      403,
      'browser_session_required',
      'Open the workflow page in the browser first, then submit through the UI.'
    );
  }
  return next();
}

function requireVerifierToken(req, res, next) {
  if (!hasValidVerifierToken(req)) {
    return denyJson(req, res, 403, 'verifier_only', 'This endpoint is available only to the benchmark verifier.');
  }
  return next();
}

function requireVerifierOrUiToken(getSessionId) {
  return (req, res, next) => {
    if (hasValidVerifierToken(req)) return next();
    const sessionId = getSessionId(req);
    if (sessionId && hasValidUiToken(req, sessionId)) return next();
    return denyJson(req, res, 403, 'ui_token_required', 'Use the browser UI session for this endpoint.');
  };
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'alibaba_publish' }));
app.use(requireBrowserClient);
app.use(issueBrowserNonce);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const sessionId = req.headers['x-session-id'] || 'unknown';
    const dir = path.join(UPLOAD_DIR, sessionId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const fileFields = FIELDS.filter(f => f.type === 'file').map(f => ({ name: f.name, maxCount: 1 }));

// GET /api/session
app.get('/api/session', requireBrowserSession, (req, res) => {
  let session = db.getActiveSession();
  if (!session) {
    const id = uuidv4();
    db.createSession(id);
    session = db.getSession(id);
  }
  res.json({
    sessionId: session.id,
    createdAt: session.created_at,
    status: session.status,
    uiToken: getOrCreateUiToken(session.id),
  });
});

// POST /api/reset
app.post('/api/reset', requireBrowserSession, (req, res) => {
  db.archiveAllSessions();
  const id = uuidv4();
  db.createSession(id);
  res.json({
    sessionId: id,
    uiToken: getOrCreateUiToken(id),
    message: 'New session created. Previous sessions archived.',
  });
});

// POST /api/submit
app.post('/api/submit', requireBrowserSession, (req, res, next) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(400).json({ error: 'Missing X-Session-Id header' });
  const session = db.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!hasValidUiToken(req, sessionId)) {
    return denyJson(
      req,
      res,
      403,
      'ui_token_required',
      'Submit through the browser UI; direct HTTP submission is not accepted.',
      { sessionId }
    );
  }

  upload.fields(fileFields)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const errors = [];
    for (const field of FIELDS) {
      if (field.type === 'file') continue;
      const val = req.body[field.name];
      const err = validateField(field.name, val);
      if (err) errors.push(err);
    }
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed for closed-set fields',
        errors,
      });
    }

    const saved = [];

    for (const field of FIELDS) {
      if (field.type === 'file') {
        const files = req.files && req.files[field.name];
        if (files && files.length > 0) {
          const f = files[0];
          const relPath = path.relative(__dirname, f.path);
          db.upsertField(sessionId, field.name, f.originalname, relPath);
          saved.push({ name: field.name, value: f.originalname, filePath: relPath });
        }
      } else {
        const val = req.body[field.name];
        if (val !== undefined && val !== null && val !== '') {
          db.upsertField(sessionId, field.name, String(val), null);
          saved.push({ name: field.name, value: String(val) });
        }
      }
    }

    db.setSessionStatus(sessionId, 'submitted');
    logAccess(req, 'ui_submit_valid', { sessionId, fieldsSaved: saved.length });
    res.json({ sessionId, fieldsSaved: saved.length, fields: saved });
  });
});

// GET /api/state/:sessionId
app.get('/api/state/:sessionId', requireVerifierToken, (req, res) => {
  const session = db.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const fields = db.getSessionFields(req.params.sessionId);
  const fieldMap = {};
  for (const f of fields) {
    fieldMap[f.field_name] = { value: f.field_value, filePath: f.file_path, updatedAt: f.updated_at };
  }
  res.json({ sessionId: session.id, status: session.status, createdAt: session.created_at, fields: fieldMap });
});

// GET /api/score/:sessionId
app.get('/api/score/:sessionId', requireVerifierOrUiToken(req => req.params.sessionId), (req, res) => {
  const session = db.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const stored = db.getSessionFields(req.params.sessionId);
  const storedMap = {};
  for (const s of stored) storedMap[s.field_name] = s;

  const fieldResults = FIELDS.map(f => {
    const s = storedMap[f.name];
    const filled = !!(s && (s.field_value || s.file_path));
    return {
      name: f.name,
      label: f.label,
      section: f.section,
      type: f.type,
      required: !!f.required,
      filled,
      value: s ? s.field_value : null,
      filePath: s ? s.file_path : null,
    };
  });

  const total = FIELDS.length;
  const filledCount = fieldResults.filter(f => f.filled).length;
  const requiredFields = FIELDS.filter(f => f.required);
  const requiredFilled = requiredFields.filter(f => storedMap[f.name] && (storedMap[f.name].field_value || storedMap[f.name].file_path)).length;

  res.json({
    sessionId: session.id,
    status: session.status,
    total,
    filled: filledCount,
    completion: +(filledCount / total).toFixed(4),
    requiredTotal: requiredFields.length,
    requiredFilled,
    requiredCompletion: requiredFields.length > 0 ? +(requiredFilled / requiredFields.length).toFixed(4) : 1,
    fields: fieldResults,
  });
});

// GET /api/fields
app.get('/api/fields', requireBrowserSession, (req, res) => {
  res.json(FIELDS);
});

// GET /api/sessions
app.get('/api/sessions', requireVerifierToken, (req, res) => {
  res.json(db.getAllSessions());
});

// GET /api/access-log
//
// Returns the union of pinned (verifier-relevant) entries and the bounded
// rolling log. Pinned entries are kept in a separate ring buffer so a flood
// of asset/poll fetches can't push e.g. ui_submit_valid out of the verifier's
// view before scoring runs.
app.get('/api/access-log', requireVerifierToken, (req, res) => {
  const seen = new Set();
  const merged = [];
  for (const entry of pinnedAccessLog) {
    const key = entry.ts + '|' + entry.event + '|' + (entry.sessionId || '');
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  for (const entry of accessLog) {
    const key = entry.ts + '|' + entry.event + '|' + (entry.sessionId || '');
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  res.json(merged);
});

// POST /api/verify/:sessionId
app.post('/api/verify/:sessionId', requireVerifierToken, (req, res) => {
  const session = db.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const expected = req.body.expected || {};
  const stored = db.getSessionFields(req.params.sessionId);
  const storedMap = {};
  for (const s of stored) storedMap[s.field_name] = s;

  const expectedKeys = Object.keys(expected);
  const details = [];
  let matched = 0;

  for (const key of expectedKeys) {
    const exp = expected[key];
    const s = storedMap[key];
    const actual = s ? s.field_value : null;
    const field = FIELDS.find(f => f.name === key);
    const type = field ? field.type : 'text';
    let match = false;

    if (type === 'file') {
      match = !!(s && (s.field_value || s.file_path));
    } else if (type === 'html') {
      match = !!(actual && actual.trim().length > 0);
    } else if (type === 'json') {
      try {
        const expObj = typeof exp === 'string' ? JSON.parse(exp) : exp;
        const actObj = actual ? JSON.parse(actual) : null;
        match = JSON.stringify(normalizeForCompare(expObj)) === JSON.stringify(normalizeForCompare(actObj));
      } catch { match = String(exp).trim() === String(actual || '').trim(); }
    } else {
      match = String(exp).trim() === String(actual || '').trim();
    }

    if (match) matched++;
    details.push({ name: key, label: field ? field.label : key, expected: exp, actual, match });
  }

  const total = FIELDS.length;
  const filledCount = stored.filter(s => s.field_value || s.file_path).length;

  res.json({
    sessionId: session.id,
    status: session.status,
    totalFields: total,
    filledFields: filledCount,
    completion: +(filledCount / total).toFixed(4),
    expectedFields: expectedKeys.length,
    matchedFields: matched,
    accuracy: expectedKeys.length > 0 ? +(matched / expectedKeys.length).toFixed(4) : 1,
    details,
  });
});

function normalizeForCompare(obj) {
  if (Array.isArray(obj)) {
    const mapped = obj.map(normalizeForCompare);
    // Sort arrays by their JSON representation so order doesn't matter
    return mapped.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  }
  if (obj && typeof obj === 'object') {
    const sorted = {};
    Object.keys(obj).sort().forEach(k => { sorted[k] = normalizeForCompare(obj[k]); });
    return sorted;
  }
  return obj;
}

// === CLI mode: optional API-only surface (gated by MOCK_ALLOW_CLI=1) ===
// Mirrors /api/session + /api/fields + /api/submit but with Bearer auth
// (Authorization: Bearer <MOCK_CLI_TOKEN>) instead of browser nonce + UI
// token. The same validateField() closed-set check runs on /api/cli/submit
// so the anti-cheat enum invariant is preserved on this surface too.
if (ALLOW_CLI) {
  app.post('/api/cli/session', requireCliClient, (req, res) => {
    let session = db.getActiveSession();
    if (!session) {
      const id = uuidv4();
      db.createSession(id);
      session = db.getSession(id);
    }
    res.json({
      sessionId: session.id,
      createdAt: session.created_at,
      status: session.status,
    });
  });

  app.get('/api/cli/fields', requireCliClient, (req, res) => {
    res.json(FIELDS);
  });

  app.post('/api/cli/submit', requireCliClient, (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(400).json({ error: 'Missing X-Session-Id header' });
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    upload.fields(fileFields)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });

      const errors = [];
      for (const field of FIELDS) {
        if (field.type === 'file') continue;
        const val = req.body[field.name];
        const fieldErr = validateField(field.name, val);
        if (fieldErr) errors.push(fieldErr);
      }
      if (errors.length > 0) {
        return res.status(400).json({
          error: 'Validation failed for closed-set fields',
          errors,
        });
      }

      const saved = [];
      for (const field of FIELDS) {
        if (field.type === 'file') {
          const files = req.files && req.files[field.name];
          if (files && files.length > 0) {
            const f = files[0];
            const relPath = path.relative(__dirname, f.path);
            db.upsertField(sessionId, field.name, f.originalname, relPath);
            saved.push({ name: field.name, value: f.originalname, filePath: relPath });
          }
        } else {
          const val = req.body[field.name];
          if (val !== undefined && val !== null && val !== '') {
            db.upsertField(sessionId, field.name, String(val), null);
            saved.push({ name: field.name, value: String(val) });
          }
        }
      }

      db.setSessionStatus(sessionId, 'submitted');
      logAccess(req, 'cli_submit_valid', { sessionId, fieldsSaved: saved.length });
      res.json({ sessionId, fieldsSaved: saved.length, fields: saved });
    });
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Benchmark server running on http://0.0.0.0:${PORT}`);
  if (ALLOW_CLI) {
    console.log('  [dual-mode] /api/cli/* mounted; Bearer auth via MOCK_CLI_TOKEN');
  }
});
