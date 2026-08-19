// `shopify theme info` — packages/theme/src/cli/commands/theme/info.ts
//
// Mode 1: --theme <ref> or --development → single-theme detail.
//   --json: {theme:{id,name,role,shop,preview_url,editor_url}}
//   plain : renderInfo box with "Theme Details" section + URL footnotes
//
// Mode 2: no theme flag → environment info.
//   --json: {store,development_theme_id,cli_version,os,shell,node_version}
//   plain : renderInfo box w/ "Theme Configuration" + "Tooling and System"

import { api } from '../api.mjs';
import { applyEnvironment } from '../environment.mjs';
import {
  MOCK_STORE_FQDN,
  adminRoleToCliRole,
  editorUrl,
  emitInfo,
  previewUrl,
  printJson,
  readHelpFile,
  storeRootUrl,
} from '../output.mjs';
import {
  globalFlagsSpec,
  jsonFlagSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';

const SPEC = [
  ...globalFlagsSpec,
  ...jsonFlagSpec,
  ...themeFlagsSpec,
  { long: 'development', char: 'd', type: 'boolean', env: 'SHOPIFY_FLAG_DEVELOPMENT' },
  { long: 'theme', char: 't', type: 'string', env: 'SHOPIFY_FLAG_THEME_ID' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-info'));
    return 0;
  }
  applyEnvironment(flags, SPEC);
  const state = await api.state();
  const themes = state.draft?.themes ?? [];

  // Mode 1: --theme or --development → single-theme detail.
  if (flags.theme || flags.development) {
    const theme = findTheme(themes, flags.theme, flags.development);
    if (!theme) {
      // Match real CLI's exact message + exit code (verified against real CLI).
      const ref = flags.theme || 'development';
      throw Object.assign(
        new Error(`No themes on the store ${MOCK_STORE_FQDN} match the ID or name "${ref}"`),
        { exitCode: 1, render: 'error' },
      );
    }
    const id = numericId(theme.id);
    const role = adminRoleToCliRole(theme.role);
    // Real CLI: live theme → bare store root; unpublished/development → ?preview_theme_id=N
    const preview = role === 'live' ? storeRootUrl(MOCK_STORE_FQDN) : previewUrl(MOCK_STORE_FQDN, id);
    const editor = editorUrl(MOCK_STORE_FQDN, id);
    const payload = {
      theme: {
        id,
        name: theme.name,
        role,
        shop: MOCK_STORE_FQDN,
        preview_url: preview,
        editor_url: editor,
      },
    };
    if (flags.json) {
      printJson(payload);
      return 0;
    }
    // cli-kit wraps long link-text values when the URL itself is long enough
    // that a separate footnote line is clearer. For the editor URL (~64 chars)
    // it pushes [2] to its own line; for the preview URL (~30 chars) [1]
    // stays inline. Reproduce this by hand-formatting the value strings.
    emitInfo(
      [
        {
          title: 'Theme Details',
          rows: [
            ['Id', `#${id}`],
            ['Name', theme.name],
            ['Role', role],
            ['Shop', MOCK_STORE_FQDN],
            ['Preview Url', 'Preview Theme [1]'],
            ['Editor Url', 'Open in Theme Editor\n[2]'],
          ],
        },
      ],
      [preview, editor],
    );
    return 0;
  }

  // Mode 2: environment info.
  const envPayload = {
    store: MOCK_STORE_FQDN,
    development_theme_id: null,
    cli_version: '4.1.0',
    os: `${process.platform}-${process.arch}`,
    shell: process.env.SHELL || '',
    node_version: process.version,
  };
  if (flags.json) {
    printJson(envPayload);
    return 0;
  }
  emitInfo([
    {
      title: 'Theme Configuration',
      rows: [
        ['Store', envPayload.store],
        ['Development Theme ID', 'Not set'],
      ],
    },
    {
      title: 'Tooling and System',
      rows: [
        ['Shopify CLI', envPayload.cli_version],
        ['OS', envPayload.os],
        ['Shell', envPayload.shell],
        ['Node version', envPayload.node_version],
      ],
    },
  ]);
  return 0;
}

function findTheme(themes, themeRef, wantDevelopment) {
  if (themeRef) {
    return themes.find((t) => String(t.id) === String(themeRef) || t.name === themeRef);
  }
  if (wantDevelopment) {
    return themes.find((t) => t.role === 'draft') ?? themes[0];
  }
  return null;
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
