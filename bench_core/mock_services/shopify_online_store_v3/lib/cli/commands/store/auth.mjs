// `shopify store auth` — fake-OAuth flow for the v3 mock CLI.
//
// Mirrors the ForgeFit replay shape (build log:208-221):
//
//   SHOPIFY_CLI_AGENT_INFO='n:Codex|v:1.0|p:OpenAI' \
//   SHOPIFY_CLI_AGENT_IDS='s:shopify-store-case|r:build-store|i:codex-desktop' \
//   shopify store auth --store m5mrmw-zk.myshopify.com \
//     --scopes read_products,write_products,...
//
// Real Shopify CLI opens a browser-based OAuth grant; the mock skips that and
// posts the request straight at the backend's `/__mock_auth/grant` endpoint
// (an implementation detail not reachable from agent-visible code paths). The
// returned bearer token + accepted scope list are written to ~/.cache/
// shopify-mock-cli/auth.json so subsequent `shopify store execute` calls can
// pick them up.

import { resolveMockUrl } from '../../api.mjs';
import { printJson, readHelpFile } from '../../output.mjs';
import { RuntimeError, globalFlagsSpec, jsonFlagSpec, parseFlags } from '../../parser.mjs';
import { loadAuth, saveAuth, setStoreEntry } from '../../auth_store.mjs';

const DEFAULT_EMAIL = 'theheavens24@gmail.com';

const SPEC = [
  ...globalFlagsSpec,
  ...jsonFlagSpec,
  { long: 'store', char: 's', type: 'string', env: 'SHOPIFY_FLAG_STORE' },
  { long: 'scopes', type: 'string', env: 'SHOPIFY_FLAG_SCOPES' },
  { long: 'password', type: 'string', env: 'SHOPIFY_CLI_THEME_TOKEN' },
  // --switch is a mock-only extension: re-running `auth` against an existing
  // store updates that store's entry in place; with --switch we also promote
  // it to the active store. Real Shopify CLI doesn't expose this flag (its
  // active-store concept lives in `shopify store switch`) but it's harmless
  // and documented in store-auth-help.stdout.
  { long: 'switch', type: 'boolean' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('store-auth'));
    return 0;
  }
  if (!flags.store) {
    throw new RuntimeError(
      'Missing required flag: --store. Pass --store <name>.myshopify.com.',
    );
  }
  if (!flags.scopes) {
    throw new RuntimeError(
      'Missing required flag: --scopes. Pass --scopes <csv> (e.g. read_products,write_products).',
    );
  }
  const store = String(flags.store).trim();
  const scopes = parseScopesCsv(flags.scopes);
  if (!scopes.length) {
    throw new RuntimeError('--scopes must contain at least one scope handle.');
  }

  const grant = await requestGrant(store, scopes);
  const acceptedScopes = (grant.accessScopes || [])
    .map((s) => (typeof s === 'string' ? s : s?.handle))
    .filter(Boolean);
  const email = resolveEmail();
  const entry = {
    token: grant.token,
    scopes: acceptedScopes.length ? acceptedScopes : scopes,
    email,
    grantedAt: new Date().toISOString(),
  };
  const loaded = loadAuth();
  const next = setStoreEntry(loaded, store, entry, { activate: Boolean(flags.switch) });
  saveAuth(next);

  if (flags.json) {
    printJson({ ok: true, store, email, scopes: entry.scopes });
    return 0;
  }
  // Byte-identical with ForgeFit log:218-220.
  process.stdout.write('✔ Logged in.\n');
  process.stdout.write(`✔ Authenticated as ${email} against ${store}.\n`);
  return 0;
}

function parseScopesCsv(raw) {
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveEmail() {
  // Allow tests to override the persona email without modifying source. Real
  // Shopify CLI resolves this from the authenticated identity service; the
  // mock just stamps a stable default that matches the ForgeFit replay.
  const override = process.env.SHOPIFY_MOCK_AUTH_EMAIL;
  return override && override.trim() ? override.trim() : DEFAULT_EMAIL;
}

// Parse `key:val|key:val` env-var attribution strings used by Shopify CLI's
// SHOPIFY_CLI_AGENT_INFO / SHOPIFY_CLI_AGENT_IDS hooks.
function parseAgentEnv(raw) {
  if (!raw) return null;
  const out = {};
  for (const piece of String(raw).split('|')) {
    const idx = piece.indexOf(':');
    if (idx === -1) continue;
    const key = piece.slice(0, idx).trim();
    const value = piece.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function buildAgentPayload() {
  const info = parseAgentEnv(process.env.SHOPIFY_CLI_AGENT_INFO);
  const ids = parseAgentEnv(process.env.SHOPIFY_CLI_AGENT_IDS);
  if (!info && !ids) return null;
  const payload = {};
  if (info) payload.info = info;
  if (ids) payload.ids = ids;
  return payload;
}

async function requestGrant(storeName, scopes) {
  const url = `${resolveMockUrl()}/__mock_auth/grant`;
  const body = { storeName, scopes };
  const agent = buildAgentPayload();
  if (agent) body.agent = agent;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new RuntimeError(
      `Mock backend unreachable at ${url}: ${err.message || err}.\n` +
        'Hint: ensure the mock server is running, or set SHOPIFY_MOCK_URL.',
    );
  }
  const text = await res.text();
  let data = null;
  if (text.length) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new RuntimeError(
        `POST /__mock_auth/grant: expected JSON, got: ${text.slice(0, 200)}`,
      );
    }
  }
  if (!res.ok) {
    const message = data && data.error ? data.error : `${res.status} ${res.statusText}`;
    throw new RuntimeError(`POST /__mock_auth/grant: ${message}`);
  }
  if (!data || !data.token) {
    throw new RuntimeError('POST /__mock_auth/grant: missing token in response.');
  }
  return data;
}
