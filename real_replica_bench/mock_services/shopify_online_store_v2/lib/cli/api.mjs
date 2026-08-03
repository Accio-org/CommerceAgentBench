// HTTP client wrapping the v2 mock backend (server.js).
// Endpoints used:
//   GET  /api/state              → { ok, dirty, saved, draft, events }
//   POST /api/draft  body:{draft,reason}  → set draft (requires draft.sections)
//   POST /api/save                → commit draft → saved
//   POST /api/reset               → wipe to seed + clear events
//   GET  /__bench/state           → bench-canonical snapshot (Bearer auth, shopify-bench only)
//   GET  /health                  → liveness

import { RuntimeError } from './parser.mjs';

export function resolveMockUrl() {
  const candidates = [
    process.env.SHOPIFY_MOCK_URL,
    process.env.MOCK_SITE_URL,
    process.env.BENCH_RUNTIME_MOCK_SHOPIFY_ONLINE_STORE_V2_URL,
    'http://127.0.0.1:3098',
  ];
  for (const url of candidates) {
    if (url && url.trim()) return url.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:3098';
}

async function request(method, path, { body, bearerToken, expectJson = true } = {}) {
  const url = resolveMockUrl() + path;
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new RuntimeError(
      `Mock backend unreachable at ${url}: ${err.message || err}.\n` +
        `Hint: ensure the mock server is running, or set SHOPIFY_MOCK_URL.`,
    );
  }
  const text = await res.text();
  let data;
  if (expectJson && text.length) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new RuntimeError(`${method} ${path}: expected JSON, got: ${text.slice(0, 200)}`);
    }
  } else {
    data = text;
  }
  if (!res.ok) {
    const message = data && data.error ? data.error : `${res.status} ${res.statusText}`;
    throw new RuntimeError(`${method} ${path}: ${message}`);
  }
  return data;
}

export const api = {
  state: () => request('GET', '/api/state'),
  benchState: (token) => request('GET', '/__bench/state', { bearerToken: token }),
  setDraft: (draft, reason) => request('POST', '/api/draft', { body: { draft, reason } }),
  save: () => request('POST', '/api/save', { body: {} }),
  reset: () => request('POST', '/api/reset', { body: {} }),
  health: () => request('GET', '/health'),
};

// Mutate the saved theme list in-place: pull state, apply mutator(draftClone),
// POST /api/draft, POST /api/save. Returns the resulting saved state.
//
// The mock's events-stream model treats all CLI theme operations as one
// admin-side draft cycle: rename / publish / delete / duplicate all show up
// as a single `draft_updated` followed by `ui_save_valid`.
export async function mutateThemes(reason, mutator) {
  const state = await api.state();
  const draft = JSON.parse(JSON.stringify(state.draft));
  mutator(draft);
  await api.setDraft(draft, reason);
  const after = await api.save();
  return after;
}
