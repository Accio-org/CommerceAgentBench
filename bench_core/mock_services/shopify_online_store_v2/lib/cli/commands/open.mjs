// `shopify theme open` — packages/theme/src/cli/commands/theme/open.ts
//
// Output (verified against real CLI 4.1.0): identical for --editor, --live,
// and -t variants — always prints both preview + editor URLs via the cli-kit
// info box. Mock matches that behavior; flags select the target theme but
// not what gets printed.

import { api } from '../api.mjs';
import {
  MOCK_STORE_FQDN,
  adminRoleToCliRole,
  editorUrl,
  emitInfo,
  previewUrl,
  readHelpFile,
  storeRootUrl,
} from '../output.mjs';
import {
  globalFlagsSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';

const SPEC = [
  ...globalFlagsSpec,
  ...themeFlagsSpec,
  { long: 'development', char: 'd', type: 'boolean', env: 'SHOPIFY_FLAG_DEVELOPMENT' },
  { long: 'editor', char: 'E', type: 'boolean', env: 'SHOPIFY_FLAG_EDITOR' },
  { long: 'live', char: 'l', type: 'boolean', env: 'SHOPIFY_FLAG_LIVE' },
  { long: 'theme', char: 't', type: 'string', env: 'SHOPIFY_FLAG_THEME_ID' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-open'));
    return 0;
  }
  const state = await api.state();
  const themes = state.draft?.themes ?? [];
  const theme = findTheme(themes, flags);
  if (!theme) {
    const ref = flags.theme || (flags.live ? 'live' : flags.development ? 'development' : '');
    throw Object.assign(
      new Error(`No themes on the store ${MOCK_STORE_FQDN} match the ID or name "${ref}"`),
      { exitCode: 1, render: 'error' },
    );
  }
  const id = numericId(theme.id);
  const role = adminRoleToCliRole(theme.role);
  const preview = role === 'live' ? storeRootUrl(MOCK_STORE_FQDN) : previewUrl(MOCK_STORE_FQDN, id);
  const editor = editorUrl(MOCK_STORE_FQDN, id);
  // cli-kit puts an extra blank line between the title section and the bullet
  // list (verified against real CLI). Empty section acts as the spacer.
  emitInfo(
    [
      { title: `Preview information for theme '${theme.name}' (#${id})` },
      {},
      {
        bullets: [
          'Preview your theme [1]',
          'Customize your theme at the theme editor [2]',
        ],
      },
    ],
    [preview, editor],
  );
  return 0;
}

function findTheme(themes, flags) {
  if (flags.theme) {
    return themes.find((t) => String(t.id) === String(flags.theme) || t.name === flags.theme);
  }
  if (flags.live) {
    return themes.find((t) => t.role === 'current');
  }
  if (flags.development) {
    return themes.find((t) => t.role === 'draft') ?? themes[0];
  }
  return themes.find((t) => t.role === 'current') ?? themes[0];
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
