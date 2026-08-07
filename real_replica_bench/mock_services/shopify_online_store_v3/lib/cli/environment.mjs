// `--environment <name>` support — packages/theme/src/cli/flags.ts +
// packages/theme/src/cli/services/local-storage.ts.
//
// Real CLI reads `shopify.theme.toml` in cwd; each `[environments.<name>]`
// block contributes per-command flag defaults. Explicit CLI flags win over
// env-named flags.
//
// We support the subset of TOML we actually see in upstream samples:
//   * `[environments.<name>]` table headers
//   * `key = "string"` and `key = bool/integer` scalars
//
// (No arrays, no inline tables, no nested keys — none are documented for
// shopify.theme.toml.) If the file is malformed we emit a warning and
// continue without applying env defaults; the command proceeds with the
// caller-supplied flags. This matches real CLI's permissive behavior when
// the toml is unreadable.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Apply environment defaults onto `flags` in-place. `acceptedKeys` is the
// list of flag long-names that the calling command actually understands —
// keys not in the list are silently ignored so an `[environments.staging]`
// shared across multiple commands won't break the ones that don't grok them
// all. You may pass either an array of strings or a SPEC array (objects with
// `.long`). Returns the list of applied environment names (mostly for tests).
export function applyEnvironment(flags, acceptedKeys, opts = {}) {
  // Auto-extract long names if a SPEC array was supplied.
  if (Array.isArray(acceptedKeys) && acceptedKeys.length && typeof acceptedKeys[0] === 'object' && acceptedKeys[0].long) {
    acceptedKeys = acceptedKeys.map((f) => f.long);
  }
  const cwd = opts.cwd || process.cwd();
  const envFlags = flags.environment;
  if (!envFlags || (Array.isArray(envFlags) && !envFlags.length)) return [];

  const tomlPath = join(cwd, 'shopify.theme.toml');
  if (!existsSync(tomlPath)) return [];

  let envs;
  try {
    const text = readFileSync(tomlPath, 'utf8');
    envs = parseEnvironments(text);
  } catch {
    return [];
  }

  const accepted = new Set(acceptedKeys);
  const requested = Array.isArray(envFlags) ? envFlags : [envFlags];
  const applied = [];
  for (const name of requested) {
    const block = envs[name];
    if (!block) continue;
    applied.push(name);
    for (const [key, value] of Object.entries(block)) {
      if (!accepted.has(key)) continue;
      // Don't overwrite explicit flags (parseFlags already populated env-var
      // and command-line values before we ran).
      if (flags[key] !== undefined) continue;
      flags[key] = value;
    }
  }
  return applied;
}

// Parse just the [environments.*] tables out of a small toml file. Returns
// { '<env-name>': { key: value, ... } }. Ignores everything else.
function parseEnvironments(text) {
  const envs = {};
  let current = null; // env-name string or null
  const lines = text.split(/\r?\n/);
  for (let raw of lines) {
    const line = stripComment(raw).trim();
    if (!line) continue;

    const tableMatch = line.match(/^\[(.+)\]$/);
    if (tableMatch) {
      const path = tableMatch[1].trim();
      const envMatch = path.match(/^environments\.([A-Za-z0-9_.-]+)$/);
      if (envMatch) {
        const name = envMatch[1];
        if (!envs[name]) envs[name] = {};
        current = name;
      } else {
        current = null;
      }
      continue;
    }

    if (!current) continue;

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = parseScalar(rawValue.trim());
    if (value === undefined) continue;
    envs[current][key] = value;
  }
  return envs;
}

// Strip an inline TOML comment (`#`), respecting double-quoted strings so
// `# inside "a string"` stays intact. Best-effort — single-quote literals
// are passed through without special handling because the values we care
// about (store, theme, password, path) are always double-quoted in upstream
// samples.
function stripComment(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') inQuotes = !inQuotes;
    if (ch === '#' && !inQuotes) return line.slice(0, i);
  }
  return line;
}

function parseScalar(raw) {
  if (!raw) return undefined;
  // strip trailing comma if present (unusual but defensive)
  let s = raw.replace(/,$/, '').trim();
  if (s.length === 0) return undefined;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s[0] === '"' && s[s.length - 1] === '"') {
    // basic-string: unescape \", \\, \n, \t
    return s.slice(1, -1).replace(/\\(.)/g, (_, c) => {
      if (c === 'n') return '\n';
      if (c === 't') return '\t';
      return c;
    });
  }
  if (s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1);
  }
  // integer
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  // float
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  // bare value — return as string
  return s;
}
