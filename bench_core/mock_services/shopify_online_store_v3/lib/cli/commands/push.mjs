// `shopify theme push` — packages/theme/src/cli/commands/theme/push.ts
//
// Real CLI output (verified against shopify@4.1.0):
//   stdout:
//     plain — "Uploading files to remote theme [N%] ..." progress lines
//     --json — single-line JSON
//   stderr:
//     plain — renderInfo / renderSuccess box(es); warning box if not in theme
//             directory; per-error boxes when push reports errors
//
// JSON schema (single-line):
//   {theme:{id,name,role,shop,editor_url,preview_url[,warning,errors]}}
// `warning` (string) + `errors` (object: {path: [messages]}) appear when the
// upstream backend reports schema/template/cleanup failures. Mock backend
// doesn't validate liquid → we never populate them, matching the success
// (no-errors) shape real CLI emits for a clean push.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mutateThemes } from '../api.mjs';
import { applyEnvironment } from '../environment.mjs';
import {
  MOCK_STORE_FQDN,
  adminRoleToCliRole,
  editorUrl,
  emitWarning,
  emitSuccess,
  previewUrl,
  printJsonCompact,
  readHelpFile,
  storeRootUrl,
} from '../output.mjs';
import {
  RuntimeError,
  globFlagsSpec,
  globalFlagsSpec,
  jsonFlagSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';

const SPEC = [
  ...globalFlagsSpec,
  ...themeFlagsSpec,
  ...globFlagsSpec('upload'),
  ...jsonFlagSpec,
  { long: 'theme', char: 't', type: 'string', env: 'SHOPIFY_FLAG_THEME_ID' },
  { long: 'development', char: 'd', type: 'boolean', env: 'SHOPIFY_FLAG_DEVELOPMENT' },
  {
    long: 'development-context',
    char: 'c',
    type: 'string',
    env: 'SHOPIFY_FLAG_DEVELOPMENT_CONTEXT',
  },
  { long: 'live', char: 'l', type: 'boolean', env: 'SHOPIFY_FLAG_LIVE' },
  { long: 'unpublished', char: 'u', type: 'boolean', env: 'SHOPIFY_FLAG_UNPUBLISHED' },
  { long: 'nodelete', char: 'n', type: 'boolean', env: 'SHOPIFY_FLAG_NODELETE' },
  { long: 'allow-live', char: 'a', type: 'boolean', env: 'SHOPIFY_FLAG_ALLOW_LIVE' },
  { long: 'publish', char: 'p', type: 'boolean', env: 'SHOPIFY_FLAG_PUBLISH' },
  { long: 'force', char: 'f', type: 'boolean', env: 'SHOPIFY_FLAG_FORCE' },
  { long: 'strict', type: 'boolean', env: 'SHOPIFY_FLAG_STRICT_PUSH' },
  { long: 'listing', type: 'string', env: 'SHOPIFY_FLAG_LISTING' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-push'));
    return 0;
  }
  applyEnvironment(flags, SPEC);
  const rootDir = flags.path || process.cwd();

  // When --path is explicitly supplied we hard-error if it doesn't look like
  // a Shopify theme — the directory was deliberately named so a bad value is
  // a usage bug, not a "you probably meant your current dir" miss. Default
  // cwd keeps the old soft-warning behavior so the existing smoke flow (push
  // from a non-theme cwd to a known --theme id) still works.
  if (flags.path) {
    if (!isThemeDirectory(rootDir)) {
      throw new RuntimeError(
        `${rootDir} is not a valid Shopify theme directory (missing layout/theme.liquid or standard theme structure).`,
        1,
      );
    }
  } else if (!isThemeDirectory(rootDir)) {
    emitWarning([{ title: "It doesn't seem like you're running this command in a theme directory." }]);
  }

  // Real CLI prompts for name when --unpublished and no name flag; in
  // non-interactive mode it bails with "Failed to prompt: Name of the new theme".
  if (flags.unpublished && !process.env.SHOPIFY_MOCK_PUSH_NAME) {
    throw Object.assign(new Error('Failed to prompt'), {
      exitCode: 1,
      render: 'failed-prompt',
      promptText: 'Name of the new theme',
    });
  }

  const files = collectThemeFiles(rootDir, flags.only, flags.ignore);
  if (!files.length && !flags.unpublished) {
    throw new RuntimeError(
      `No theme files found under ${rootDir}. Run from a Shopify theme directory or pass --path.`,
      1,
    );
  }

  let chosenName = '';
  let chosenId = '';
  let chosenRole = '';
  const after = await mutateThemes(
    flags.publish ? 'cli_theme_push_publish' : 'cli_theme_push',
    (draft) => {
      let target;
      if (flags.unpublished) {
        const newId = String(Date.now() * 1000 + Math.floor(Math.random() * 1000)).slice(0, 12);
        target = {
          id: newId,
          name: process.env.SHOPIFY_MOCK_PUSH_NAME || `cli-push-${new Date().toISOString().slice(0, 10)}`,
          role: 'draft',
          version: '1.0.0',
          updatedText: '刚刚通过 Shopify CLI push 创建',
        };
        draft.themes = [...(draft.themes || []), target];
      } else if (flags.theme) {
        target = (draft.themes || []).find(
          (t) => String(t.id) === String(flags.theme) || t.name === flags.theme,
        );
        if (!target) throw new RuntimeError(`Theme ${flags.theme} was not found`, 1);
      } else if (flags.live) {
        target = (draft.themes || []).find((t) => t.role === 'current');
        if (!target) throw new RuntimeError(`No live theme found`, 1);
      } else if (flags.development) {
        target = (draft.themes || []).find((t) => t.role === 'draft');
        if (!target) throw new RuntimeError(`No development theme found`, 1);
      } else {
        target = (draft.themes || []).find((t) => t.role === 'current');
        if (!target) target = (draft.themes || [])[0];
        if (!target) throw new RuntimeError(`No themes available`, 1);
      }

      if (target.role === 'current' && !flags['allow-live'] && !flags.publish) {
        throw new RuntimeError(
          `Refusing to push to live theme without --allow-live`,
          1,
        );
      }

      draft.themeFiles = draft.themeFiles || [];
      const incomingPaths = new Set(files.map((f) => f.path));
      if (!flags.nodelete) {
        const validPrefixes = ['layout/', 'templates/', 'sections/', 'snippets/', 'assets/', 'config/', 'locales/'];
        draft.themeFiles = draft.themeFiles.filter((file) => {
          if (!validPrefixes.some((p) => file.path.startsWith(p))) return true;
          if (incomingPaths.has(file.path)) return true;
          return false;
        });
      }
      for (const file of files) {
        const idx = draft.themeFiles.findIndex((f) => f.path === file.path);
        const next = {
          path: file.path,
          type: typeOf(file.path),
          updatedText: '刚刚通过 Shopify CLI push',
          content: file.content,
        };
        if (idx >= 0) draft.themeFiles[idx] = { ...draft.themeFiles[idx], ...next };
        else draft.themeFiles.push(next);
      }
      target.updatedText = `刚刚通过 Shopify CLI push ${files.length} 个文件`;

      if (flags.publish) {
        draft.themes = (draft.themes || []).map((t) => ({
          ...t,
          role: t.id === target.id ? 'current' : (t.role === 'current' ? 'draft' : t.role),
        }));
        draft.themeId = target.id;
        draft.themeName = target.name;
      }
      chosenName = target.name;
      chosenId = target.id;
      chosenRole = target.role;
    },
  );

  // Progress lines on stdout (real CLI redraws these on TTY; piped capture
  // sees one line per percentage). Suppressed under --json so stdout stays
  // a single parseable JSON line.
  if (!flags.json) {
    for (const pct of [0, 25, 50, 75, 100]) {
      process.stdout.write(`Uploading files to remote theme [${pct}%] ...\n`);
    }
  }

  // Re-read so we see the post-save state.
  const final = (after.draft?.themes || after.saved?.themes || []).find(
    (t) => t.id === chosenId,
  );
  const id = numericId((final ?? { id: chosenId }).id);
  const role = adminRoleToCliRole((final ?? { role: chosenRole }).role);
  const preview = role === 'live' ? storeRootUrl(MOCK_STORE_FQDN) : previewUrl(MOCK_STORE_FQDN, id);
  const editor = editorUrl(MOCK_STORE_FQDN, id);
  const payload = {
    theme: {
      id,
      name: (final ?? { name: chosenName }).name,
      role,
      shop: MOCK_STORE_FQDN,
      editor_url: editor,
      preview_url: preview,
    },
  };
  if (flags.json) {
    printJsonCompact(payload);
    return 0;
  }
  emitSuccess(
    [
      { title: `The theme '${payload.theme.name}' (#${id}) was pushed.` },
      { title: 'Next steps', bullets: ['View your theme [1]', 'Customize your theme at the theme editor [2]'] },
    ],
    [preview, editor],
  );
  return 0;
}

function typeOf(path) {
  if (path.startsWith('layout/')) return 'layout';
  if (path.startsWith('templates/')) return 'template';
  if (path.startsWith('sections/')) return 'section';
  if (path.startsWith('snippets/')) return 'snippet';
  if (path.startsWith('assets/')) return 'asset';
  if (path.startsWith('config/')) return 'config';
  if (path.startsWith('locales/')) return 'locale';
  return 'asset';
}

function isThemeDirectory(root) {
  if (existsSync(join(root, 'layout', 'theme.liquid'))) return true;
  if (existsSync(join(root, 'config', 'settings_schema.json'))) return true;
  // Accept directories that contain any standard Shopify theme top-level
  // dir; this matches real CLI's "default Shopify theme folder structure"
  // heuristic referenced in push --help.
  const STANDARD = ['assets', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'];
  for (const d of STANDARD) {
    if (existsSync(join(root, d))) return true;
  }
  return false;
}

function collectThemeFiles(root, only, ignore) {
  const collected = [];
  const validPrefixes = ['layout/', 'templates/', 'sections/', 'snippets/', 'assets/', 'config/', 'locales/'];
  try {
    walk(root, '');
  } catch {
    return [];
  }
  return collected;

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
      const matchPrefix = validPrefixes.some((p) => rel.startsWith(p));
      if (!matchPrefix) continue;
      if (only && only.length && !only.some((g) => globMatch(g, rel))) continue;
      if (ignore && ignore.some((g) => globMatch(g, rel))) continue;
      try {
        const content = readFileSync(abs, 'utf8');
        collected.push({ path: rel, content });
      } catch {
        // Skip binary / unreadable files.
      }
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
