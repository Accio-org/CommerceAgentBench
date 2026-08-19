'use strict';

const http = require('http');
const path = require('path');
const db = require('./lib/db');

const SERVICE = 'dws_doc_cli';
const VERSION = require('./package.json').version;
const PORT = Number(process.env.PORT || 3020);
const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN || '';
const accessLog = [];

function record(event) {
  accessLog.push({
    timestamp: Date.now(),
    ...event
  });
  if (accessLog.length > 500) accessLog.shift();
}

function safeEquals(left, right) {
  return String(left || '') === String(right || '');
}

function hasVerifierToken(req) {
  if (!VERIFIER_TOKEN) return true;
  return safeEquals(req.headers['x-mock-verifier-token'], VERIFIER_TOKEN);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function requireVerifier(req, res) {
  if (hasVerifierToken(req)) return true;
  record({
    path: req.url,
    method: req.method,
    blocked: true,
    reason: 'verifier_only',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 160)
  });
  sendJson(res, 403, {
    error: 'verifier_only',
    message: 'This endpoint is available only to the benchmark verifier.'
  });
  return false;
}

function readStateSummary() {
  const mockUser = db.getMockUser();
  return {
    mockUser,
    defaultWorkspaceId: db.getDefaultWorkspaceId(),
    defaultFolderId: db.getDefaultFolderId(),
    counts: {
      documents: db.documentCount()
    },
    dbPath: db.DB_PATH
  };
}

function verifyState() {
  const summary = readStateSummary();
  const checks = {
    documentsSeeded: summary.counts.documents > 0,
    defaultWorkspaceSeeded: Boolean(summary.defaultWorkspaceId),
    defaultFolderSeeded: Boolean(summary.defaultFolderId),
    commandName: 'dws'
  };

  return {
    ok: Object.values(checks).every(Boolean),
    service: SERVICE,
    version: VERSION,
    checks
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    record({ path: url.pathname, method: req.method, event: 'health_check' });
    return sendJson(res, 200, {
      ok: true,
      service: SERVICE,
      version: VERSION,
      command: 'dws'
    });
  }

  if (url.pathname === '/api/access-log') {
    if (!requireVerifier(req, res)) return;
    record({ path: url.pathname, method: req.method, event: 'verifier_access_log' });
    return sendJson(res, 200, { ok: true, events: accessLog });
  }

  if (url.pathname === '/api/state') {
    if (!requireVerifier(req, res)) return;
    record({ path: url.pathname, method: req.method, event: 'verifier_state' });
    return sendJson(res, 200, { ok: true, service: SERVICE, summary: readStateSummary(), ...db.dumpFullState() });
  }

  if (url.pathname === '/api/sessions') {
    if (!requireVerifier(req, res)) return;
    record({ path: url.pathname, method: req.method, event: 'verifier_sessions' });
    return sendJson(res, 200, {
      ok: true,
      sessions: [
        {
          id: 'local-dws-doc-cli',
          command: 'dws',
          stateFile: path.basename(db.DB_PATH)
        }
      ]
    });
  }

  if (url.pathname === '/api/verify') {
    if (!requireVerifier(req, res)) return;
    record({ path: url.pathname, method: req.method, event: 'verifier_verify' });
    return sendJson(res, 200, verifyState());
  }

  if (url.pathname === '/api/audit') {
    if (!requireVerifier(req, res)) return;
    record({ path: url.pathname, method: req.method, event: 'verifier_audit' });
    return sendJson(res, 200, { ok: true, audit: db.getAuditLog() });
  }

  record({ path: url.pathname, method: req.method, blocked: true, reason: 'not_found' });
  return sendJson(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  process.stdout.write(`dws_doc_cli mock service listening on ${PORT}\n`);
});
