// `shopify theme dev` — packages/theme/src/cli/commands/theme/dev.ts
//
// Divergence #1: mock does NOT start a watcher / hot-reload server. It prints
// the same header information real CLI emits up front (warning if not in a
// theme dir + cli-kit renderSuccess with keyboard shortcuts and link
// footnotes) and exits 0. All flags accepted but no-op at runtime.

import { api } from '../api.mjs';
import {
  MOCK_STORE_FQDN,
  adminRoleToCliRole,
  editorUrl,
  emitSuccess,
  emitWarning,
  previewUrl,
  readHelpFile,
  storeRootUrl,
} from '../output.mjs';
import {
  globFlagsSpec,
  globalFlagsSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SPEC = [
  ...globalFlagsSpec,
  ...themeFlagsSpec,
  ...globFlagsSpec('upload'),
  { long: 'theme', char: 't', type: 'string', env: 'SHOPIFY_FLAG_THEME_ID' },
  { long: 'host', type: 'string', env: 'SHOPIFY_FLAG_HOST' },
  { long: 'port', type: 'string', env: 'SHOPIFY_FLAG_PORT' },
  {
    long: 'live-reload',
    type: 'string',
    env: 'SHOPIFY_FLAG_LIVE_RELOAD',
    options: ['hot-reload', 'full-page', 'off'],
    default: 'hot-reload',
  },
  {
    long: 'error-overlay',
    type: 'string',
    env: 'SHOPIFY_FLAG_ERROR_OVERLAY',
    options: ['silent', 'default'],
    default: 'default',
  },
  { long: 'theme-editor-sync', type: 'boolean', env: 'SHOPIFY_FLAG_THEME_EDITOR_SYNC' },
  { long: 'poll', type: 'boolean', env: 'SHOPIFY_FLAG_POLL' },
  { long: 'listing', type: 'string', env: 'SHOPIFY_FLAG_LISTING' },
  { long: 'nodelete', char: 'n', type: 'boolean', env: 'SHOPIFY_FLAG_NODELETE' },
  { long: 'force', char: 'f', type: 'boolean', env: 'SHOPIFY_FLAG_FORCE' },
  { long: 'notify', type: 'string', env: 'SHOPIFY_FLAG_NOTIFY' },
  { long: 'open', type: 'boolean', env: 'SHOPIFY_FLAG_OPEN' },
  { long: 'store-password', type: 'string', env: 'SHOPIFY_FLAG_STORE_PASSWORD' },
  { long: 'allow-live', char: 'a', type: 'boolean', env: 'SHOPIFY_FLAG_ALLOW_LIVE' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-dev'));
    return 0;
  }
  const state = await api.state();
  const themes = state.draft?.themes ?? [];
  const theme = flags.theme
    ? themes.find((t) => String(t.id) === String(flags.theme) || t.name === flags.theme)
    : (themes.find((t) => t.role === 'draft') ?? themes[0]);
  if (!theme) {
    process.stderr.write('No development theme available.\n');
    return 1;
  }

  const rootDir = flags.path || process.cwd();
  if (!isThemeDirectory(rootDir)) {
    emitWarning([{ title: "It doesn't seem like you're running this command in a theme directory." }]);
  }

  const port = flags.port || '9292';
  const host = flags.host || '127.0.0.1';
  const id = numericId(theme.id);
  const local = `http://${host}:${port}`;
  const role = adminRoleToCliRole(theme.role);
  const previewLink = role === 'live'
    ? storeRootUrl(MOCK_STORE_FQDN)
    : previewUrl(MOCK_STORE_FQDN, id);
  const editorLink = `${editorUrl(MOCK_STORE_FQDN, id)}?hr=${port}`;
  const giftcardsLink = `${local}/gift_cards/[store_id]/preview`;

  emitSuccess(
    [
      { title: 'Preview your theme (t)', bullets: ['[1]'] },
      {
        title: 'Next steps',
        bullets: [
          `Share your theme preview (p) [2]\n  ${previewLink}`,
          'Customize your theme at the theme editor (e) [3]',
          'Preview your gift cards (g) [4]',
        ],
      },
    ],
    [local, previewLink, editorLink, giftcardsLink],
  );
  return 0;
}

function isThemeDirectory(root) {
  return (
    existsSync(join(root, 'layout', 'theme.liquid')) ||
    existsSync(join(root, 'config', 'settings_schema.json'))
  );
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
