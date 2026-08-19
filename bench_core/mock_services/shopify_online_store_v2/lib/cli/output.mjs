// Output helpers shared by all subcommands.
//
// Stream routing follows real Shopify CLI behavior:
//   --json output                           → stdout (machine-readable)
//   success / info / warning / error boxes  → stderr (cli-kit renderers)
//   progress dots / per-file lines          → stdout (push/pull progress)
//
// Visual rendering goes through ./cliKit.mjs which reproduces the ANSI-box
// shape used by @shopify/cli-kit on the non-TTY code path.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderError as kitRenderError,
  renderInfo as kitRenderInfo,
  renderSuccess as kitRenderSuccess,
  renderTable as kitRenderTable,
  renderWarning as kitRenderWarning,
} from './cliKit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, '..', '..', 'golden');

// --- JSON output ---------------------------------------------------------

// Pretty-printed JSON (2-space indent + trailing newline). Matches real CLI's
// `list --json`, `info --json`, and most other --json outputs.
export function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

// Compact (single-line) JSON. Real CLI uses this only for a few commands —
// `duplicate --json` and `push --json` ship payloads on a single line.
export function printJsonCompact(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

// JSON failure shape pulled from upstream duplicate.ts:37-43 (the only
// command that documents an error JSON shape). Emitted compact to match
// real CLI behavior under --json.
export function printErrorJson({ message, errors = [], requestId } = {}) {
  const payload = { message };
  if (errors.length) payload.errors = errors;
  if (requestId) payload.requestId = requestId;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

// --- ANSI box output (always stderr) -------------------------------------

export function emitInfo(sections, links) {
  process.stderr.write(kitRenderInfo(sections, links));
}
export function emitSuccess(sections, links) {
  process.stderr.write(kitRenderSuccess(sections, links));
}
export function emitWarning(sections, links) {
  process.stderr.write(kitRenderWarning(sections, links));
}
export function emitError(sections, links) {
  process.stderr.write(kitRenderError(sections, links));
}
export function emitTable(spec) {
  process.stderr.write(kitRenderTable(spec));
}

// --- Help fixtures -------------------------------------------------------

// Help text comes verbatim from golden/<name>.stdout — single source of truth,
// so `bun bin/shopify <cmd> --help` and `diff golden/<name>.stdout` always agree.
export function readHelpFile(name) {
  const candidates = [
    join(GOLDEN_DIR, `${name}.stdout`),
    join(GOLDEN_DIR, `${name}-help.stdout`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(
    `help fixture not found for ${JSON.stringify(name)} ` +
      `(looked under ${GOLDEN_DIR}/${name}.stdout and ${GOLDEN_DIR}/${name}-help.stdout)`,
  );
}

// --- Role translation ----------------------------------------------------

// `shopify theme list` role mapping: backend uses `current`/`draft`, upstream
// CLI yields `live`/`unpublished`/`development`/`demo` enums.
export function adminRoleToCliRole(role) {
  if (role === 'current') return 'live';
  if (role === 'draft') return 'unpublished';
  return role;
}

export function cliRoleToAdminRole(role) {
  if (role === 'live') return 'current';
  if (role === 'unpublished') return 'draft';
  return role;
}

// --- URL composition -----------------------------------------------------

// Real CLI's preview URL: https://{shop}?preview_theme_id={id} for the
// duplicated-theme preview link; for the LIVE theme open command it drops
// the query string entirely. previewUrl() returns the unpublished form.
export function editorUrl(store, themeId) {
  return `https://${store}/admin/themes/${themeId}/editor`;
}
export function previewUrl(store, themeId) {
  return `https://${store}/?preview_theme_id=${themeId}`;
}
export function storeRootUrl(store) {
  return `https://${store}`;
}

// The mock's canonical shop fqdn. Real CLI uses the authenticated store's
// fqdn; the mock surfaces a stable value so JSON output stays predictable.
// MOCK_STORE_FQDN env var lets the byte-diff smoke probe with a real fqdn
// (e.g. the user's actual test store) without changing seeded data.
export const MOCK_STORE_FQDN = process.env.MOCK_STORE_FQDN || 'ccb-mock.myshopify.com';
