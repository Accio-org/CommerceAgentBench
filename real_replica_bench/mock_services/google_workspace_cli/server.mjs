#!/usr/bin/env bun
// google-sheets-slides-mock — HTTP server
//
// Two roles:
//   1. Backend for gws CLI --remote mode (tool calls + mutations)
//   2. Verifier-only endpoints (protected by X-Mock-Verifier-Token)

import http from 'node:http';
import crypto from 'node:crypto';
import { openDb } from './lib/db.mjs';
import { createState } from './state.mjs';

const PORT = Number(process.env.PORT || 3081);
const HOST = process.env.HOST || '127.0.0.1';
const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN || '';

const db = openDb();
const state = createState(db);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { throw new Error(`Invalid JSON body: ${e.message}`); }
}

function safeEquals(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function requireVerifierToken(req, res) {
  if (!VERIFIER_TOKEN) return true;
  const given = req.headers['x-mock-verifier-token'] || '';
  if (given && safeEquals(given, VERIFIER_TOKEN)) return true;
  send(res, 403, { error: 'verifier_only', message: 'This endpoint requires X-Mock-Verifier-Token.' });
  return false;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTES = {
  'GET /health': async (_req, res) => {
    send(res, 200, { status: 'ok' });
  },
  'GET /api/state': async (req, res) => {
    if (!requireVerifierToken(req, res)) return;
    send(res, 200, { db: state.getState() });
  },
  'GET /api/audit': async (req, res) => {
    if (!requireVerifierToken(req, res)) return;
    send(res, 200, { audit: state.getAudit() });
  },
  'POST /api/reset': async (req, res) => {
    if (!requireVerifierToken(req, res)) return;
    state.reset();
    send(res, 200, { ok: true });
  },

  'POST /api/tools/call': async (req, res) => {
    let body;
    try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    const { name, arguments: args = {} } = body || {};
    const fn = state.tools[name];
    if (!fn) return send(res, 404, { error: `Unknown tool: ${name}` });
    try {
      const result = fn(args);
      state.record('tool.call', name, args);
      send(res, 200, result);
    } catch (e) {
      send(res, 500, { content: [{ type: 'text', text: JSON.stringify({ error: String(e.message || e) }) }] });
    }
  },

  'POST /api/sheets/setCells': async (req, res) => {
    let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    try { send(res, 200, state.mutations.setCells(body)); } catch (e) { send(res, 400, { error: e.message }); }
  },
  'POST /api/sheets/addSheet': async (req, res) => {
    let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    try { send(res, 200, state.mutations.addSheet(body)); } catch (e) { send(res, 400, { error: e.message }); }
  },
  'POST /api/sheets/deleteSheet': async (req, res) => {
    let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    try { send(res, 200, state.mutations.deleteSheet(body)); } catch (e) { send(res, 400, { error: e.message }); }
  },
  'POST /api/sheets/rename': async (req, res) => {
    let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    try { send(res, 200, state.mutations.renameSpreadsheet(body)); } catch (e) { send(res, 400, { error: e.message }); }
  },

  'POST /api/slides/addSlide': async (req, res) => {
    let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    try { send(res, 200, state.mutations.addSlide(body)); } catch (e) { send(res, 400, { error: e.message }); }
  },
  'POST /api/slides/deleteSlide': async (req, res) => {
    let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    try { send(res, 200, state.mutations.deleteSlide(body)); } catch (e) { send(res, 400, { error: e.message }); }
  },
  'POST /api/slides/duplicateSlide': async (req, res) => {
    let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    try { send(res, 200, state.mutations.duplicateSlide(body)); } catch (e) { send(res, 400, { error: e.message }); }
  },
  'POST /api/slides/setText': async (req, res) => {
    let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    try { send(res, 200, state.mutations.setSlideText(body)); } catch (e) { send(res, 400, { error: e.message }); }
  },
  'POST /api/slides/rename': async (req, res) => {
    let body; try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    try { send(res, 200, state.mutations.renamePresentation(body)); } catch (e) { send(res, 400, { error: e.message }); }
  },
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);
    const key = `${req.method} ${url.pathname}`;
    const handler = ROUTES[key];
    if (handler) return handler(req, res, url);
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`google-sheets-slides-mock running on http://${HOST}:${PORT}`);
});
