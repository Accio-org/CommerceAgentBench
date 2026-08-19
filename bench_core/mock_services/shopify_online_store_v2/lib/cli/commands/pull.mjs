// `shopify theme pull` — packages/theme/src/cli/commands/theme/pull.ts
//
// Real CLI output (verified):
//   stdout: "Downloading files from remote theme [0%] ..." progress (with
//           cursor-rewrite ANSI when TTY; cleared when piped).
//   stderr: cli-kit renderSuccess box
//             "The theme '{name}' (#{id}) has been pulled."
//           + "Next steps" bullets
//             "View your theme [1]"
//             "Customize your theme at the theme editor [2]"
//           + footnotes [1] preview_url  [2] editor_url
//
// No --json flag upstream — kept absent.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { api } from '../api.mjs';
import {
  MOCK_STORE_FQDN,
  adminRoleToCliRole,
  editorUrl,
  emitSuccess,
  previewUrl,
  readHelpFile,
  storeRootUrl,
} from '../output.mjs';
import {
  RuntimeError,
  globFlagsSpec,
  globalFlagsSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';

const SPEC = [
  ...globalFlagsSpec,
  ...themeFlagsSpec,
  ...globFlagsSpec('download'),
  { long: 'theme', char: 't', type: 'string', env: 'SHOPIFY_FLAG_THEME_ID' },
  { long: 'development', char: 'd', type: 'boolean', env: 'SHOPIFY_FLAG_DEVELOPMENT' },
  { long: 'live', char: 'l', type: 'boolean', env: 'SHOPIFY_FLAG_LIVE' },
  { long: 'nodelete', char: 'n', type: 'boolean', env: 'SHOPIFY_FLAG_NODELETE' },
  { long: 'force', char: 'f', type: 'boolean', env: 'SHOPIFY_FLAG_FORCE' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-pull'));
    return 0;
  }
  const state = await api.state();
  const themes = state.draft?.themes ?? [];
  const target = pickTheme(themes, flags);
  if (!target) {
    throw new RuntimeError('Theme not found for the given selector', 1);
  }
  const allFiles = state.draft?.themeFiles ?? [];
  const selected = allFiles.filter((file) => {
    if (flags.only && flags.only.length && !flags.only.some((g) => globMatch(g, file.path))) {
      return false;
    }
    if (flags.ignore && flags.ignore.some((g) => globMatch(g, file.path))) {
      return false;
    }
    return true;
  });
  const rootDir = resolve(flags.path || process.cwd());

  // Progress line (real CLI redraws this on TTY; piped capture sees the
  // single line). No --json on pull upstream, but guard for symmetry.
  process.stdout.write('Downloading files from remote theme [0%] ...\n');

  if (!flags.nodelete) {
    const remotePaths = new Set(selected.map((f) => f.path));
    const validPrefixes = ['layout/', 'templates/', 'sections/', 'snippets/', 'assets/', 'config/', 'locales/'];
    for (const localRel of listLocalThemeFiles(rootDir)) {
      if (!validPrefixes.some((p) => localRel.startsWith(p))) continue;
      if (remotePaths.has(localRel)) continue;
      try {
        rmSync(join(rootDir, localRel));
      } catch {
        // Best-effort.
      }
    }
  }
  for (const file of selected) {
    const outPath = join(rootDir, file.path);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, file.content ?? '', 'utf8');
  }
  const id = numericId(target.id);
  const role = adminRoleToCliRole(target.role);
  const preview = role === 'live' ? storeRootUrl(MOCK_STORE_FQDN) : previewUrl(MOCK_STORE_FQDN, id);
  const editor = editorUrl(MOCK_STORE_FQDN, id);
  emitSuccess(
    [
      { title: `The theme '${target.name}' (#${id}) has been pulled.` },
      { title: 'Next steps', bullets: ['View your theme [1]', 'Customize your theme at the theme editor [2]'] },
    ],
    [preview, editor],
  );
  return 0;
}

function pickTheme(themes, flags) {
  if (flags.theme) {
    return themes.find((t) => String(t.id) === String(flags.theme) || t.name === flags.theme);
  }
  if (flags.live) return themes.find((t) => t.role === 'current');
  if (flags.development) return themes.find((t) => t.role === 'draft');
  return themes.find((t) => t.role === 'current') ?? themes[0];
}

function listLocalThemeFiles(root) {
  const out = [];
  walk(root, '');
  return out;

  function walk(absDir, relDir) {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const abs = join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      out.push(rel);
    }
  }
}

function globMatch(pattern, path) {
  if (!pattern.includes('*')) return path === pattern || path.includes(pattern);
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*') +
      '$',
  );
  return re.test(path);
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
