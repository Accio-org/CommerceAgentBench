// `shopify theme duplicate` — packages/theme/src/cli/commands/theme/duplicate.ts
//
// Real CLI output (verified against shopify@4.1.0):
//   --json: COMPACT single-line {theme:{id,name,role,shop}} (no urls)
//   plain : renderSuccess box "The theme '{source}' (#{id}) has been duplicated."
//           + Next steps bullet "View the duplicated theme [1]"
//           + footnote: [1] {shop}?preview_theme_id={newId}

import { mutateThemes } from '../api.mjs';
import {
  MOCK_STORE_FQDN,
  adminRoleToCliRole,
  emitSuccess,
  previewUrl,
  printErrorJson,
  printJsonCompact,
  readHelpFile,
} from '../output.mjs';
import {
  RuntimeError,
  globalFlagsSpec,
  jsonFlagSpec,
  parseFlags,
} from '../parser.mjs';

// Upstream duplicate.ts uses individual themeFlags entries (password / store /
// environment), NOT the full themeFlags spread — `--path` is intentionally absent.
const SPEC = [
  ...globalFlagsSpec,
  ...jsonFlagSpec,
  { long: 'password', type: 'string', env: 'SHOPIFY_CLI_THEME_TOKEN' },
  { long: 'theme', char: 't', type: 'string', env: 'SHOPIFY_FLAG_THEME_ID' },
  { long: 'name', char: 'n', type: 'string', env: 'SHOPIFY_FLAG_NAME' },
  { long: 'store', char: 's', type: 'string', env: 'SHOPIFY_FLAG_STORE' },
  { long: 'environment', char: 'e', type: 'string', multiple: true, env: 'SHOPIFY_FLAG_ENVIRONMENT' },
  { long: 'force', char: 'f', type: 'boolean', env: 'SHOPIFY_FLAG_FORCE' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-duplicate'));
    return 0;
  }
  if (!flags.theme) {
    throw Object.assign(new Error('Failed to prompt'), {
      exitCode: 1,
      render: 'failed-prompt',
      promptText: `Which theme do you want to duplicate on ${MOCK_STORE_FQDN}?`,
    });
  }
  if (!flags.force) {
    // Match real CLI's wording: looks up the source theme name for the prompt.
    const state = await (await import('../api.mjs')).api.state();
    const themes = state.draft?.themes ?? [];
    const sample = themes.find(
      (t) => String(t.id) === String(flags.theme) || t.name === flags.theme,
    );
    const promptText = sample
      ? `Do you want to duplicate '${sample.name}' on ${MOCK_STORE_FQDN}?`
      : `Do you want to duplicate the selected theme on ${MOCK_STORE_FQDN}?`;
    throw Object.assign(new Error('Failed to prompt'), {
      exitCode: 1,
      render: 'failed-prompt',
      promptText,
    });
  }
  try {
    let sourceName = '';
    const after = await mutateThemes('cli_theme_duplicate', (draft) => {
      const source = (draft.themes || []).find(
        (t) => String(t.id) === String(flags.theme) || t.name === flags.theme,
      );
      if (!source) {
        throw new RuntimeError(`Theme ${flags.theme} was not found`, 1);
      }
      sourceName = source.name;
      // Real CLI yields pure-integer theme IDs (push.ts:38 sample 108267175958).
      const newId = String(Date.now() * 1000 + Math.floor(Math.random() * 1000)).slice(0, 12);
      const copy = {
        ...source,
        id: newId,
        name: flags.name || `${source.name} Copy`,
        role: 'draft',
        updatedText: '刚刚通过 Shopify CLI 创建副本',
      };
      draft.themes = [...(draft.themes || []), copy];
    });
    const created = (after.draft?.themes || after.saved?.themes || []).at(-1);
    const id = numericId(created.id);
    const role = adminRoleToCliRole(created.role);
    const payload = {
      theme: { id, name: created.name, role, shop: MOCK_STORE_FQDN },
    };
    if (flags.json) {
      printJsonCompact(payload);
      return 0;
    }
    emitSuccess(
      [
        { title: `The theme '${sourceName}' (#${numericId(flags.theme)}) has been duplicated.` },
        { title: 'Next steps', bullets: ['View the duplicated theme [1]'] },
      ],
      [previewUrl(MOCK_STORE_FQDN, id)],
    );
    return 0;
  } catch (err) {
    if (flags.json) {
      printErrorJson({
        message: 'The theme could not be duplicated due to errors',
        errors: [err.message || String(err)],
      });
      return 1;
    }
    throw err;
  }
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
