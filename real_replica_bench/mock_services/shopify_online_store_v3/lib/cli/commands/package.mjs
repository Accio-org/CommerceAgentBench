// `shopify theme package` — packages/theme/src/cli/commands/theme/package.ts
//
// Real CLI: walks the theme directory at --path (cwd default), packages every
// file under the recognized Shopify theme dirs (assets, config, layout,
// locales, sections, snippets, templates, listings) into a ZIP named
// `<theme-name>-<theme-version>.zip`. Names come from
// `config/settings_schema.json`'s `theme_info` block:
//   { theme_info: { theme_name: "...", theme_version: "..." } }
//
// Output:
//   stderr: cli-kit renderSuccess box "Theme packaged at: <abs path to zip>"
//   exit 0
//
// Errors:
//   * --path doesn't look like a theme dir → RuntimeError exit 1
//     ("<path> is not a valid Shopify theme directory (missing
//       layout/theme.liquid or standard theme structure).")

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { applyEnvironment } from '../environment.mjs';
import { emitSuccess, readHelpFile } from '../output.mjs';
import {
  RuntimeError,
  globalFlagsSpec,
  parseFlags,
} from '../parser.mjs';
import { zipDirectory } from '../zip.mjs';

const SPEC = [
  ...globalFlagsSpec,
  { long: 'path', type: 'string', env: 'SHOPIFY_FLAG_PATH' },
];

const THEME_DIRS = ['assets', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-package'));
    return 0;
  }
  applyEnvironment(flags, ['path']);

  const root = resolve(flags.path || process.cwd());
  if (!isThemeDirectory(root)) {
    throw new RuntimeError(
      `${root} is not a valid Shopify theme directory (missing layout/theme.liquid or standard theme structure).`,
      1,
    );
  }

  const { themeName, themeVersion } = readThemeInfo(root);
  const safeName = themeName.replace(/[^A-Za-z0-9._-]/g, '_');
  const zipName = `${safeName}-${themeVersion}.zip`;
  const zipPath = resolve(root, zipName);
  const { fileCount } = zipDirectory(root, zipPath, {
    includePrefixes: THEME_DIRS,
    includeListing: true,
  });

  emitSuccess([
    { title: `Theme packaged at: ${zipPath}` },
    { rows: [['Files', String(fileCount)], ['Name', themeName], ['Version', themeVersion]] },
  ]);
  return 0;
}

function isThemeDirectory(root) {
  if (existsSync(join(root, 'layout', 'theme.liquid'))) return true;
  return THEME_DIRS.some((d) => existsSync(join(root, d)));
}

function readThemeInfo(root) {
  // Default values match real CLI's fallback when settings_schema.json is
  // missing the theme_info block.
  let themeName = basename(root) || 'theme';
  let themeVersion = '0.0.0';
  const schemaPath = join(root, 'config', 'settings_schema.json');
  if (!existsSync(schemaPath)) return { themeName, themeVersion };
  try {
    const arr = JSON.parse(readFileSync(schemaPath, 'utf8'));
    if (Array.isArray(arr)) {
      const info = arr.find((entry) => entry && entry.name === 'theme_info');
      if (info) {
        if (info.theme_name) themeName = String(info.theme_name);
        if (info.theme_version) themeVersion = String(info.theme_version);
      }
    } else if (arr && typeof arr === 'object' && arr.theme_info) {
      if (arr.theme_info.theme_name) themeName = String(arr.theme_info.theme_name);
      if (arr.theme_info.theme_version) themeVersion = String(arr.theme_info.theme_version);
    }
  } catch {
    // Malformed schema → fall back to directory basename + 0.0.0 (matches
    // real CLI's "best-effort" behavior).
  }
  return { themeName, themeVersion };
}
