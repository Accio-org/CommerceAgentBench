// shopify_admin mock site for RealReplicaBench.
//
// Differences from the upstream prototype at mock_benchmark/shopify_admin:
//   - SQLite layer ported to bun:sqlite (no native build; runs under Bun).
//   - /api/submit performs server-side enum/structural validation via
//     validation.js for closed-set fields (per project anti-cheat rule).
//   - Browser-required + UI-token + verifier-token gate (mirrors
//     alibaba_publish/server.js): non-browser HTTP clients can't fetch
//     pages or call /api/submit, /api/state and /api/sessions and
//     /api/access-log require X-Mock-Verifier-Token, and /api/submit
//     requires the UI token issued for the session.
//   - /api/access-log surfaces the events the host verifier inspects
//     (browser_required / ui_token_required / ui_submit_valid / etc).

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const fieldsModule = require('./fields');
const { getFields, isValidPage, PAGES } = fieldsModule;
const { validateField } = require('./validation');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN || '';
const BROWSER_COOKIE = 'mock_browser_nonce';
const browserNonces = new Set();
const sessionUiTokens = new Map();
const accessLog = [];
const pinnedAccessLog = [];

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const NON_BROWSER_UA = /(curl|wget|python-requests|python-urllib|httpx|aiohttp|node-fetch|undici|axios|go-http-client|java|ruby|php|libwww|okhttp|postmanruntime)/i;
const BROWSER_UA = /(mozilla|chrome|chromium|safari|firefox|edg|headlesschrome)/i;
const UI_FETCH_API_PATHS = new Set([
  '/api/session', '/api/reset', '/api/submit', '/api/fields', '/api/pages',
]);

const PINNED_EVENTS = new Set([
  'ui_submit_valid',
  'browser_required',
  'browser_session_required',
  'ui_token_required',
  'verifier_only',
  'validation_failed',
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
  return res.status(403).type('text/plain').send(
    'Access Denied: automated HTTP clients (curl, web fetch, scripted submitters) are not permitted to retrieve this protected page. Open the URL in a browser.\n'
  );
}

function requireBrowserClient(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/uploads/')) return next();
  const isDocument = req.method === 'GET' && (
    req.path === '/' || req.path.endsWith('.html') ||
    req.path === '/products' || req.path === '/products/new' ||
    req.path === '/online-store/customize' ||
    req.path === '/themes/customize' || req.path === '/themes'
  );
  const isUiFetch = UI_FETCH_API_PATHS.has(req.path);
  if (!isDocument && !isUiFetch) return next();
  const reason = classifyBrowserClient(req, { requireDocument: isDocument });
  if (reason) return denyNonBrowser(req, res, reason);
  return next();
}

function issueBrowserNonce(req, res, next) {
  const isDocument = req.method === 'GET' && (
    req.path === '/' || req.path.endsWith('.html') ||
    req.path === '/products' || req.path === '/products/new' ||
    req.path === '/online-store/customize' ||
    req.path === '/themes/customize' || req.path === '/themes'
  );
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

app.get('/health', (req, res) => res.json({ ok: true, service: 'shopify_admin' }));
app.use(requireBrowserClient);
app.use(issueBrowserNonce);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// Friendly URLs (mirror Shopify Admin paths).
app.get('/products/new', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'products-new.html'));
});
app.get('/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'products-new.html'));
});
app.get(['/online-store/customize', '/themes/customize', '/themes'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'themes-customize.html'));
});

// Build a multer instance per page (different file fields).
const uploadByPage = {};
function getUploader(page) {
  if (uploadByPage[page]) return uploadByPage[page];
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
  const fileFields = getFields(page).filter(f => f.type === 'file').map(f => ({ name: f.name, maxCount: 1 }));
  uploadByPage[page] = { upload, fileFields };
  return uploadByPage[page];
}

function resolvePage(req) {
  const raw = (req.query.page || req.body?.page || '').toString().trim();
  if (raw && isValidPage(raw)) return raw;
  return null;
}

// GET /api/session?page=product|theme
app.get('/api/session', requireBrowserSession, (req, res) => {
  const page = resolvePage(req) || 'product';
  let session = db.getActiveSession(page);
  if (!session) {
    const id = uuidv4();
    db.createSession(id, page);
    session = db.getSession(id);
  }
  res.json({
    sessionId: session.id,
    page: session.page,
    createdAt: session.created_at,
    status: session.status,
    uiToken: getOrCreateUiToken(session.id),
  });
});

// POST /api/reset?page=product|theme
app.post('/api/reset', requireBrowserSession, (req, res) => {
  const page = resolvePage(req) || 'product';
  db.archiveAllSessions(page);
  const id = uuidv4();
  db.createSession(id, page);
  res.json({
    sessionId: id,
    page,
    uiToken: getOrCreateUiToken(id),
    message: 'New session created. Previous sessions archived.',
  });
});

// POST /api/submit
app.post('/api/submit', requireBrowserSession, (req, res) => {
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

  const page = session.page || 'product';
  const fields = getFields(page);
  const { upload, fileFields } = getUploader(page);

  upload.fields(fileFields)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    // Server-side closed-set validation (anti-cheat) — see validation.js.
    const errors = [];
    for (const field of fields) {
      if (field.type === 'file') continue;
      const val = req.body[field.name];
      const e = validateField(page, field.name, val);
      if (e) errors.push(e);
    }
    if (errors.length > 0) {
      logAccess(req, 'validation_failed', { sessionId, page, errors });
      return res.status(400).json({
        error: 'Validation failed for closed-set fields',
        errors,
      });
    }

    const saved = [];
    for (const field of fields) {
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
    logAccess(req, 'ui_submit_valid', { sessionId, page, fieldsSaved: saved.length });
    res.json({ sessionId, page, fieldsSaved: saved.length, fields: saved });
  });
});

// GET /api/state/:sessionId  — verifier only.
app.get('/api/state/:sessionId', requireVerifierToken, (req, res) => {
  const session = db.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const fields = db.getSessionFields(req.params.sessionId);
  const fieldMap = {};
  for (const f of fields) {
    fieldMap[f.field_name] = { value: f.field_value, filePath: f.file_path, updatedAt: f.updated_at };
  }
  res.json({
    sessionId: session.id,
    page: session.page,
    status: session.status,
    createdAt: session.created_at,
    fields: fieldMap,
  });
});

// GET /api/score/:sessionId — UI uses it for local progress; verifier reads it for completion metrics.
app.get('/api/score/:sessionId', requireVerifierOrUiToken(req => req.params.sessionId), (req, res) => {
  const session = db.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const page = session.page || 'product';
  const fields = getFields(page);

  const stored = db.getSessionFields(req.params.sessionId);
  const storedMap = {};
  for (const s of stored) storedMap[s.field_name] = s;

  const fieldResults = fields.map(f => {
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

  const total = fields.length;
  const filledCount = fieldResults.filter(f => f.filled).length;
  const requiredFields = fields.filter(f => f.required);
  const requiredFilled = requiredFields.filter(f => storedMap[f.name] && (storedMap[f.name].field_value || storedMap[f.name].file_path)).length;

  res.json({
    sessionId: session.id,
    page,
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

// GET /api/fields?page=product|theme
app.get('/api/fields', requireBrowserSession, (req, res) => {
  const page = resolvePage(req) || 'product';
  res.json({ page, fields: getFields(page) });
});

// GET /api/pages
app.get('/api/pages', requireBrowserSession, (req, res) => {
  res.json(PAGES);
});

// GET /api/sessions — verifier only.
app.get('/api/sessions', requireVerifierToken, (req, res) => {
  res.json(db.getAllSessions());
});

// GET /api/access-log — verifier only. Pinned events first so a flood of
// asset / poll fetches can't push e.g. ui_submit_valid out of view.
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

// POST /api/verify/:sessionId — verifier only. Field-by-field accuracy
// against an expected map. JSON fields use deep compare (preserveOrder for
// fields where array element order is semantically meaningful).
const ORDERED_JSON_FIELDS = new Set(['sectionsConfig', 'menuItems', 'products']);

app.post('/api/verify/:sessionId', requireVerifierToken, (req, res) => {
  const session = db.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const page = session.page || 'product';
  const fields = getFields(page);

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
    const field = fields.find(f => f.name === key);
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
        const norm = ORDERED_JSON_FIELDS.has(key) ? normalizeKeepOrder : normalizeForCompare;
        match = JSON.stringify(norm(expObj)) === JSON.stringify(norm(actObj));
      } catch { match = String(exp).trim() === String(actual || '').trim(); }
    } else if (type === 'number') {
      const expNum = parseFloat(exp);
      const actNum = parseFloat(actual);
      match = !isNaN(expNum) && !isNaN(actNum) && Math.abs(expNum - actNum) < 1e-6;
    } else {
      match = String(exp).trim() === String(actual || '').trim();
    }

    if (match) matched++;
    details.push({ name: key, label: field ? field.label : key, expected: exp, actual, match });
  }

  const total = fields.length;
  const filledCount = stored.filter(s => s.field_value || s.file_path).length;

  res.json({
    sessionId: session.id,
    page,
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
    return mapped.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  }
  if (obj && typeof obj === 'object') {
    const sorted = {};
    Object.keys(obj).sort().forEach(k => { sorted[k] = normalizeForCompare(obj[k]); });
    return sorted;
  }
  return obj;
}

function normalizeKeepOrder(obj) {
  if (Array.isArray(obj)) return obj.map(normalizeKeepOrder);
  if (obj && typeof obj === 'object') {
    const sorted = {};
    Object.keys(obj).sort().forEach(k => { sorted[k] = normalizeKeepOrder(obj[k]); });
    return sorted;
  }
  return obj;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Shopify Admin benchmark server running on http://0.0.0.0:${PORT}`);
});
