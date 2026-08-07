// `shopify store execute` — run an arbitrary Admin API GraphQL query/mutation.
//
// Mirrors the ForgeFit replay's most-used CLI surface (build log:228, 337-339,
// 595, 832-834, 1054, …). The agent's helper script chose `--variable-file`
// because inline `--variables` for large base64 image payloads blew past argv
// size (build log:874). The mock doesn't suffer that ARG_MAX limit but the
// `--variable-file` codepath MUST work because real scripts call into it.
//
// Defaults:
//   * Resolves `--store` → token from ~/.cache/shopify-mock-cli/auth.json. If
//     `--store` is omitted, uses the activeStore from that cache.
//   * Hits POST <mockUrl>/admin/api/<api-version>/graphql.json with the bearer
//     token in `Authorization: Bearer <token>`.
//   * Prints the response JSON. `--json` switches to compact (single-line);
//     default is pretty (2-space indent).
//   * Returns 0 even when the GraphQL response carries `userErrors`; only HTTP
//     4xx/5xx (or a network failure) maps to exit 1.
//
// Phase E (alignment with real @shopify/cli 4.1.0):
//   * Flag rename `--api-version` → `--version` (and env var rename to
//     SHOPIFY_FLAG_VERSION) to match the real `shopify store execute -h`
//     output. `DEFAULT_API_VERSION = '2026-01'` is preserved — the mock
//     backend regex `/admin/api/[^/]+/graphql.json` accepts any version, so
//     this is just a sensible default for the path component when the flag
//     is omitted.
//   * `--allow-mutations` safety gate: queries detected as mutations (first
//     non-comment keyword `mutation`) are rejected with an error box unless
//     the flag is passed. Read queries proceed untouched.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { resolveMockUrl } from '../../api.mjs';
import { printJson, printJsonCompact, readHelpFile } from '../../output.mjs';
import { RuntimeError, globalFlagsSpec, jsonFlagSpec, parseFlags } from '../../parser.mjs';
import {
  getActiveStore,
  getStoreEntry,
  loadAuth,
} from '../../auth_store.mjs';

// Mock backend accepts any API version segment; default is a recent stable.
const DEFAULT_API_VERSION = '2026-01';

// Phase F.4/F.5 — align with real @shopify/cli 4.1.0 `store execute -h`:
//   -q, --query=<value>        (short form added)
//   -v, --variables=<value>    (short form added)
//   --query-file=<value>       Read query body from file (xor with --query)
//   --output-file=<value>      Write response JSON to file (no stdout)
const SPEC = [
  ...globalFlagsSpec,
  ...jsonFlagSpec,
  { long: 'store', char: 's', type: 'string', env: 'SHOPIFY_FLAG_STORE' },
  { long: 'query', char: 'q', type: 'string', env: 'SHOPIFY_FLAG_QUERY' },
  { long: 'query-file', type: 'string', env: 'SHOPIFY_FLAG_QUERY_FILE' },
  { long: 'variables', char: 'v', type: 'string', env: 'SHOPIFY_FLAG_VARIABLES' },
  { long: 'variable-file', type: 'string', env: 'SHOPIFY_FLAG_VARIABLE_FILE' },
  { long: 'output-file', type: 'string', env: 'SHOPIFY_FLAG_OUTPUT_FILE' },
  { long: 'version', type: 'string', env: 'SHOPIFY_FLAG_VERSION' },
  { long: 'allow-mutations', type: 'boolean', env: 'SHOPIFY_FLAG_ALLOW_MUTATIONS' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('store-execute'));
    return 0;
  }

  // Resolve target store (explicit flag → activeStore → error).
  const loaded = loadAuth();
  const store = flags.store ? String(flags.store).trim() : getActiveStore(loaded);
  if (!store) {
    throw new RuntimeError(
      'No active store. Pass --store or run `shopify store auth` first.',
    );
  }
  const entry = getStoreEntry(loaded, store);
  if (!entry || !entry.token) {
    throw new RuntimeError(
      `No token found for store '${store}'. Run \`shopify store auth --store ${store} --scopes ...\` first.`,
    );
  }

  // Resolve query (flag → query-file → stdin fallback). --query and
  // --query-file are mutually exclusive (matches real CLI 4.1.0 wording).
  if (flags.query && flags['query-file']) {
    throw new RuntimeError('Cannot use --query and --query-file together.');
  }
  let query = flags.query;
  if (!query && flags['query-file']) {
    const path = flags['query-file'];
    if (!existsSync(path)) {
      throw new RuntimeError(`--query-file not found: ${path}`);
    }
    try {
      query = readFileSync(path, 'utf8');
    } catch (err) {
      throw new RuntimeError(`--query-file unreadable: ${path}: ${err.message || err}`);
    }
  }
  if (!query) {
    const piped = await readStdinIfPiped();
    if (piped !== null && piped.trim()) {
      query = piped;
    }
  }
  if (!query || !String(query).trim()) {
    throw new RuntimeError(
      'Missing --query. Pass --query <graphql>, --query-file <path>, or pipe a query via stdin.',
    );
  }

  // Phase E.3 — `--allow-mutations` safety gate. Real `shopify store execute`
  // (cli 4.1.0) rejects mutation operations unless `--allow-mutations` is
  // passed, to prevent agents from accidentally writing to a live store.
  // Detect mutations by scanning for an `operationType` keyword of
  // `mutation` (or any later mutation in a multi-operation document).
  if (!flags['allow-mutations'] && containsMutationOperation(String(query))) {
    throw new RuntimeError(
      'Mutations are not allowed by default. Re-run with `--allow-mutations` to mutate store data.',
    );
  }

  // Resolve variables (--variables OR --variable-file, mutually exclusive).
  if (flags.variables && flags['variable-file']) {
    throw new RuntimeError('--variables and --variable-file are mutually exclusive.');
  }
  let variables = {};
  if (flags.variables) {
    variables = parseJsonOrThrow(flags.variables, '--variables');
  } else if (flags['variable-file']) {
    const path = flags['variable-file'];
    if (!existsSync(path)) {
      throw new RuntimeError(`--variable-file not found: ${path}`);
    }
    let raw;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      throw new RuntimeError(`--variable-file unreadable: ${path}: ${err.message || err}`);
    }
    variables = parseJsonOrThrow(raw, `--variable-file ${path}`);
  }

  const apiVersion = flags.version || DEFAULT_API_VERSION;
  const baseUrl = resolveMockUrl();
  const endpoint = `${baseUrl}/admin/api/${apiVersion}/graphql.json`;

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${entry.token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new RuntimeError(
      `Admin GraphQL unreachable at ${endpoint}: ${err.message || err}.\n` +
        'Hint: ensure the mock server is running, or set SHOPIFY_MOCK_URL.',
    );
  }

  const text = await res.text();
  let payload = null;
  if (text.length) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Non-JSON body on error: print verbatim to stderr and bail.
      process.stderr.write(text);
      if (!text.endsWith('\n')) process.stderr.write('\n');
      throw new RuntimeError(`Admin GraphQL ${res.status}: response was not JSON.`);
    }
  }

  // For non-2xx HTTP responses, mirror the body to stderr and exit 1 — but
  // still go through the same printer so users see the structured error.
  if (!res.ok) {
    const stream = process.stderr;
    if (payload === null) {
      stream.write(`Admin GraphQL ${res.status} ${res.statusText}\n`);
    } else if (flags.json) {
      stream.write(`${JSON.stringify(payload)}\n`);
    } else {
      stream.write(`${JSON.stringify(payload, null, 2)}\n`);
    }
    throw new RuntimeError(`Admin GraphQL request failed: ${res.status} ${res.statusText}`);
  }

  // 200 response: unwrap `data` like real `shopify store execute` does (build
  // log:240-285 — agent saw `{ "shop": {...}, "products": ... }` rather than
  // `{ "data": {...} }`). Preserve `errors` alongside when present, since the
  // GraphQL spec allows partial-data 200 responses.
  const view = unwrapResponse(payload);
  const serialized = flags.json
    ? `${JSON.stringify(view)}\n`
    : `${JSON.stringify(view, null, 2)}\n`;
  if (flags['output-file']) {
    // Phase F.5 — write response JSON to file, no stdout (matches real CLI
    // 4.1.0 `--output-file`). Used during Tier 1B capture to dodge ANSI
    // pollution from progress dots / cliKit boxes.
    try {
      writeFileSync(flags['output-file'], serialized);
    } catch (err) {
      throw new RuntimeError(
        `--output-file unwritable: ${flags['output-file']}: ${err.message || err}`,
      );
    }
  } else if (flags.json) {
    printJsonCompact(view);
  } else {
    printJson(view);
  }
  return 0;
}

// Strip line comments + string literals, then scan top-level (depth-0 wrt
// braces and parens) for any `mutation` keyword that opens an operation —
// either at the top of the document or after another operation closes.
// Returns true iff at least one such operation is found. Selection-set
// names containing the substring "mutation" (e.g. fields named
// `bulkOperation`) are NOT matched because we require depth==0 and a word
// boundary against the operation header.
function containsMutationOperation(query) {
  // Strip `# line comments`. Strings can't contain newlines in graphql so
  // line comments are safe to wipe first.
  let stripped = '';
  let i = 0;
  const n = query.length;
  while (i < n) {
    const c = query[i];
    if (c === '#') {
      while (i < n && query[i] !== '\n') i++;
      continue;
    }
    if (c === '"') {
      // Skip string (block-string or normal). Push placeholder.
      stripped += '_';
      if (query.substr(i, 3) === '"""') {
        i += 3;
        while (i < n && query.substr(i, 3) !== '"""') i++;
        if (i < n) i += 3;
      } else {
        i++;
        while (i < n && query[i] !== '"') {
          if (query[i] === '\\' && i + 1 < n) i += 2;
          else i++;
        }
        if (i < n) i++;
      }
      continue;
    }
    stripped += c;
    i++;
  }
  // Now scan: track brace/paren depth; a `mutation` token at depth 0 with a
  // following whitespace/`(`/`{` indicates an operation definition.
  let braceDepth = 0;
  let parenDepth = 0;
  let j = 0;
  const m = stripped.length;
  while (j < m) {
    const ch = stripped[j];
    if (ch === '{') { braceDepth++; j++; continue; }
    if (ch === '}') { braceDepth--; j++; continue; }
    if (ch === '(') { parenDepth++; j++; continue; }
    if (ch === ')') { parenDepth--; j++; continue; }
    if (braceDepth === 0 && parenDepth === 0 && /[A-Za-z_]/.test(ch)) {
      const ns = j;
      while (j < m && /[A-Za-z0-9_]/.test(stripped[j])) j++;
      const word = stripped.substring(ns, j);
      if (word === 'mutation') {
        const next = stripped[j] || '';
        if (next === '' || /[\s({]/.test(next)) return true;
      }
      continue;
    }
    j++;
  }
  return false;
}

function parseJsonOrThrow(raw, label) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('top-level value must be a JSON object');
    }
    return parsed;
  } catch (err) {
    throw new RuntimeError(`${label}: invalid JSON — ${err.message || err}`);
  }
}

function unwrapResponse(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  // Prefer the `data` field (matches real CLI output); attach `errors` only
  // when present so partial-data responses don't get silently dropped.
  if ('data' in payload && payload.errors) {
    return { ...payload.data, errors: payload.errors };
  }
  if ('data' in payload) return payload.data;
  return payload;
}

async function readStdinIfPiped() {
  if (process.stdin.isTTY) return null;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { process.stdin.pause(); } catch {}
        resolve(null);
      }
    }, 50);
    process.stdin.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      chunks.push(buf);
      if (total > 8 * 1024 * 1024) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('stdin query exceeded 8MB ceiling'));
        }
      }
    });
    process.stdin.on('end', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    process.stdin.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
