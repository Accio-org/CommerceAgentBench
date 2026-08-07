// `shopify theme publish` — packages/theme/src/cli/commands/theme/publish.ts
//
// Real CLI output (verified): renderSuccess with
//   "The theme '{name}' (#{id}) is now live at {shop_url} [1]."
// + footnote: [1] {shop_url}

import { mutateThemes } from '../api.mjs';
import { applyEnvironment } from '../environment.mjs';
import { MOCK_STORE_FQDN, emitSuccess, readHelpFile, storeRootUrl } from '../output.mjs';
import {
  RuntimeError,
  globalFlagsSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';

const SPEC = [
  ...globalFlagsSpec,
  ...themeFlagsSpec,
  { long: 'force', char: 'f', type: 'boolean', env: 'SHOPIFY_FLAG_FORCE' },
  { long: 'theme', char: 't', type: 'string', env: 'SHOPIFY_FLAG_THEME_ID' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-publish'));
    return 0;
  }
  applyEnvironment(flags, SPEC);
  if (!flags.theme) {
    throw Object.assign(new Error('Failed to prompt'), {
      exitCode: 1,
      render: 'failed-prompt',
      promptText: `Which theme do you want to publish on ${MOCK_STORE_FQDN}?`,
    });
  }
  if (!flags.force) {
    throw Object.assign(new Error('Failed to prompt'), {
      exitCode: 1,
      render: 'failed-prompt',
      promptText: `Publish the selected theme on ${MOCK_STORE_FQDN}?`,
    });
  }
  let publishedName = '';
  let publishedId = '';
  await mutateThemes('cli_theme_publish', (draft) => {
    const target = (draft.themes || []).find(
      (t) => String(t.id) === String(flags.theme) || t.name === flags.theme,
    );
    if (!target) {
      throw new RuntimeError(`Theme ${flags.theme} was not found`, 1);
    }
    publishedName = target.name;
    publishedId = numericId(target.id);
    draft.themes = (draft.themes || []).map((t) => ({
      ...t,
      role: t.id === target.id ? 'current' : (t.role === 'current' ? 'draft' : t.role),
    }));
    draft.themeId = target.id;
    draft.themeName = target.name;
  });
  const url = storeRootUrl(MOCK_STORE_FQDN);
  emitSuccess(
    [{ title: `The theme '${publishedName}' (#${publishedId}) is now live at ${url} [1].` }],
    [url],
  );
  return 0;
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
