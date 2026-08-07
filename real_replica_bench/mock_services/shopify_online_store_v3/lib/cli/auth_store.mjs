// Persistent CLI auth cache for the mock `shopify store` topic.
//
// Real Shopify CLI keeps its OAuth credentials in ~/.config/shopify/cache.json
// (or %APPDATA% on Windows). This mock keeps a similarly-shaped credential
// store under ~/.cache/shopify-mock-cli/auth.json so multiple invocations of
// `shopify store auth` / `shopify store execute` can share a session without
// re-granting on every call.
//
// File shape:
//   {
//     "stores": {
//       "m5mrmw-zk.myshopify.com": {
//         "token": "<hex>",
//         "scopes": ["read_products", "write_products", ...],
//         "email": "theheavens24@gmail.com",
//         "grantedAt": "2026-06-03T...Z"
//       }
//     },
//     "activeStore": "m5mrmw-zk.myshopify.com"
//   }
//
// `auth.mjs` writes here; `execute.mjs` (and the B.3 list/link/switch stubs)
// read here. The mock never expires tokens — the file is the single source of
// truth until the user blows it away manually.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const EMPTY_STATE = Object.freeze({ stores: {}, activeStore: null });

export function authCachePath() {
  const override = process.env.SHOPIFY_MOCK_AUTH_PATH;
  if (override && override.trim()) return override;
  return join(homedir(), '.cache', 'shopify-mock-cli', 'auth.json');
}

export function loadAuth() {
  const path = authCachePath();
  if (!existsSync(path)) return { stores: {}, activeStore: null };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { stores: {}, activeStore: null };
  }
  if (!text.trim()) return { stores: {}, activeStore: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { stores: {}, activeStore: null };
  }
  // Defensive normalisation — surface a sane shape even if the file was
  // hand-edited to garbage.
  const stores = parsed && typeof parsed.stores === 'object' && parsed.stores ? parsed.stores : {};
  const activeStore = typeof parsed?.activeStore === 'string' ? parsed.activeStore : null;
  return { stores, activeStore };
}

export function saveAuth(state) {
  const path = authCachePath();
  mkdirSync(dirname(path), { recursive: true });
  const payload = {
    stores: state?.stores && typeof state.stores === 'object' ? state.stores : {},
    activeStore: typeof state?.activeStore === 'string' ? state.activeStore : null,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

export function getStoreEntry(loaded, store) {
  if (!loaded || !store) return null;
  return loaded.stores?.[store] ?? null;
}

export function getStoreToken(loaded, store) {
  return getStoreEntry(loaded, store)?.token ?? null;
}

// Single-store fallback is mock-only convenience (Phase F.6 — real CLI 4.1.0
// always requires `--store` on `execute` because there's no `store switch`
// subcommand to set an active store). With list/link/switch removed, callers
// that only authed a single store would otherwise have to type `--store ...`
// every time; falling through to the sole entry keeps the existing ForgeFit
// replay scripts working without a flag wave.
export function getActiveStore(loaded) {
  if (loaded?.activeStore) return loaded.activeStore;
  const stores = loaded?.stores;
  if (stores && typeof stores === 'object') {
    const names = Object.keys(stores);
    if (names.length === 1) return names[0];
  }
  return null;
}

export function setStoreEntry(loaded, store, entry, { activate = false } = {}) {
  const next = {
    stores: { ...(loaded?.stores || {}) },
    activeStore: loaded?.activeStore ?? null,
  };
  next.stores[store] = entry;
  if (activate || !next.activeStore) next.activeStore = store;
  return next;
}

export function setActiveStore(loaded, store) {
  if (!loaded?.stores?.[store]) {
    throw new Error(`Store '${store}' is not present in the auth cache.`);
  }
  return { stores: { ...loaded.stores }, activeStore: store };
}

export function emptyState() {
  // Return a fresh mutable copy so callers can safely tweak without affecting
  // the frozen module constant.
  return { ...EMPTY_STATE, stores: {} };
}
