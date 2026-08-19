// `shopify theme preview` — packages/theme/src/cli/commands/theme/preview.ts
//
// Real CLI: reads a JSON overrides file, applies it on top of a chosen base
// theme to create (or update via --preview-id) a temporary preview, and
// returns the preview URL plus a stable preview identifier you can reuse.
//
// Mock behavior:
//   * --theme (required) selects the base theme by id or name.
//   * --overrides (required) is a path to a JSON file. Two shapes accepted:
//       1. settings_data shape — { current: {...}, presets: {...} }
//          → written to `config/settings_data.json`
//       2. file map shape       — { files: { "<path>": "<content>" } }
//          → each entry overrides / adds a themeFile
//     Anything else is wrapped as a settings_data `current` block.
//   * Creates a new theme (or, if --preview-id matches an existing
//     CLI-created preview, updates it). Marks `role: 'draft'` with a
//     `cli_preview` flag so `theme list` shows it as unpublished.
//   * Emits JSON with shape: {previewUrl, previewIdentifier} (compact line
//     under --json) or a renderSuccess box.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { mutateThemes } from '../api.mjs';
import { applyEnvironment } from '../environment.mjs';
import {
  MOCK_STORE_FQDN,
  emitSuccess,
  previewUrl,
  printJsonCompact,
  readHelpFile,
} from '../output.mjs';
import {
  RuntimeError,
  globalFlagsSpec,
  jsonFlagSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';

const SPEC = [
  ...globalFlagsSpec,
  ...themeFlagsSpec,
  ...jsonFlagSpec,
  { long: 'theme', char: 't', type: 'string', env: 'SHOPIFY_FLAG_THEME_ID' },
  { long: 'overrides', type: 'string', env: 'SHOPIFY_FLAG_OVERRIDES' },
  { long: 'preview-id', type: 'string', env: 'SHOPIFY_FLAG_PREVIEW_ID' },
  { long: 'open', type: 'boolean', env: 'SHOPIFY_FLAG_OPEN' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-preview'));
    return 0;
  }
  applyEnvironment(flags, ['path', 'password', 'store']);

  if (!flags.theme) {
    throw new RuntimeError('Missing required flag --theme', 1);
  }
  if (!flags.overrides) {
    throw new RuntimeError('Missing required flag --overrides', 1);
  }

  const overridesPath = resolve(flags.overrides);
  if (!existsSync(overridesPath) || !statSync(overridesPath).isFile()) {
    throw new RuntimeError(`Overrides file not found: ${overridesPath}`, 1);
  }
  let parsedOverrides;
  try {
    parsedOverrides = JSON.parse(readFileSync(overridesPath, 'utf8'));
  } catch (err) {
    throw new RuntimeError(`Failed to parse overrides JSON: ${err.message || err}`, 1);
  }

  // Decide whether we're creating or updating a preview.
  const requestedPreviewId = flags['preview-id'] || null;

  let baseSourceName = '';
  let previewId = '';
  let previewName = '';
  await mutateThemes('cli_theme_preview', (draft) => {
    const themes = draft.themes || [];
    const base = themes.find(
      (t) => String(t.id) === String(flags.theme) || t.name === flags.theme,
    );
    if (!base) {
      throw new RuntimeError(`Theme ${flags.theme} was not found`, 1);
    }
    baseSourceName = base.name;

    let target;
    if (requestedPreviewId) {
      target = themes.find(
        (t) => String(t.id) === String(requestedPreviewId) && t.cliPreview === true,
      );
      if (!target) {
        throw new RuntimeError(`No CLI-created preview with id ${requestedPreviewId}`, 1);
      }
    } else {
      const newId = String(Date.now() * 1000 + Math.floor(Math.random() * 1000)).slice(0, 12);
      target = {
        id: newId,
        name: `${base.name} (preview)`,
        role: 'draft',
        version: '1.0.0',
        cliPreview: true,
        updatedText: '刚刚通过 Shopify CLI preview 创建',
      };
      draft.themes = [...themes, target];
    }
    previewId = target.id;
    previewName = target.name;

    // Apply overrides → per-theme themeFiles entries. We store all theme
    // files in one flat list keyed by `themeId`; the storefront router
    // filters them at render time when ?preview_theme_id=<id> matches.
    draft.themeFiles = draft.themeFiles || [];

    const fileMap = extractFileMap(parsedOverrides);
    for (const [filePath, content] of Object.entries(fileMap)) {
      const idx = draft.themeFiles.findIndex(
        (f) => f.path === filePath && String(f.themeId) === String(target.id),
      );
      const next = {
        path: filePath,
        themeId: target.id,
        type: typeOf(filePath),
        updatedText: '刚刚通过 Shopify CLI preview 写入',
        content,
      };
      if (idx >= 0) draft.themeFiles[idx] = { ...draft.themeFiles[idx], ...next };
      else draft.themeFiles.push(next);
    }
    target.updatedText = `刚刚通过 Shopify CLI preview 应用了 ${Object.keys(fileMap).length} 个覆盖`;
  });

  const id = numericId(previewId);
  const url = previewUrl(MOCK_STORE_FQDN, id);
  const identifier = String(previewId);
  if (flags.json) {
    printJsonCompact({ previewUrl: url, previewIdentifier: identifier });
    return 0;
  }

  emitSuccess(
    [
      { title: `Preview ready for '${baseSourceName}' (#${numericId(flags.theme)}).` },
      { rows: [['Identifier', identifier], ['Theme', previewName]] },
      { title: 'Preview URL', bullets: ['Open in your browser [1]'] },
    ],
    [url],
  );
  return 0;
}

function extractFileMap(parsed) {
  if (!parsed || typeof parsed !== 'object') return {};
  // Shape 1: explicit files map.
  if (parsed.files && typeof parsed.files === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(parsed.files)) {
      out[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    }
    return out;
  }
  // Shape 2: looks like settings_data.json — wrap into config/settings_data.json.
  if ('current' in parsed || 'presets' in parsed || 'sections' in parsed) {
    return {
      'config/settings_data.json': JSON.stringify(parsed, null, 2),
    };
  }
  // Fallback: treat the entire object as the `current` block.
  return {
    'config/settings_data.json': JSON.stringify({ current: parsed }, null, 2),
  };
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

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
