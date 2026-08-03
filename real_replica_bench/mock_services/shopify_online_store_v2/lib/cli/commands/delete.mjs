// `shopify theme delete` — packages/theme/src/cli/commands/theme/delete.ts
//
// --theme is `multiple: true` (repeatable). --force required in non-interactive
// contexts. Current/live theme cannot be deleted.
//
// Output (verified): per deleted theme, one renderSuccess box with
//   "The theme '{name}' (#{id}) was deleted from {shop}."

import { mutateThemes } from '../api.mjs';
import { MOCK_STORE_FQDN, emitSuccess, readHelpFile } from '../output.mjs';
import {
  RuntimeError,
  globalFlagsSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';

const SPEC = [
  ...globalFlagsSpec,
  ...themeFlagsSpec,
  { long: 'development', char: 'd', type: 'boolean', env: 'SHOPIFY_FLAG_DEVELOPMENT' },
  { long: 'show-all', char: 'a', type: 'boolean', env: 'SHOPIFY_FLAG_SHOW_ALL' },
  { long: 'force', char: 'f', type: 'boolean', env: 'SHOPIFY_FLAG_FORCE' },
  { long: 'theme', char: 't', type: 'string', multiple: true, env: 'SHOPIFY_FLAG_THEME_ID' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-delete'));
    return 0;
  }
  const targetRefs = flags.theme ? (Array.isArray(flags.theme) ? flags.theme : [flags.theme]) : [];
  if (!targetRefs.length && !flags.development) {
    throw new RuntimeError(
      'Specify themes via --theme (repeatable) or use --development.',
      2,
    );
  }
  if (!flags.force) {
    // Match real CLI's "Failed to prompt: Delete 'X' (#Y) from {shop}?" wording.
    // Look up the first target so the message names a real theme.
    const state = await (await import('../api.mjs')).api.state();
    const themes = state.draft?.themes ?? [];
    const sample = targetRefs.length
      ? themes.find((t) => String(t.id) === String(targetRefs[0]) || t.name === targetRefs[0])
      : null;
    const promptText = sample
      ? `Delete '${sample.name}' (#${numericId(sample.id)}) from ${MOCK_STORE_FQDN}?`
      : `Delete the selected themes from ${MOCK_STORE_FQDN}?`;
    throw Object.assign(new Error('Failed to prompt'), {
      exitCode: 1,
      render: 'failed-prompt',
      promptText,
    });
  }
  const deleted = [];
  await mutateThemes('cli_theme_delete', (draft) => {
    const themes = draft.themes || [];
    let toDelete;
    if (targetRefs.length) {
      toDelete = targetRefs.map((ref) => {
        const found = themes.find((t) => String(t.id) === String(ref) || t.name === ref);
        if (!found) throw new RuntimeError(`Theme ${ref} was not found`, 1);
        return found;
      });
    } else if (flags.development) {
      toDelete = themes.filter((t) => t.role === 'draft');
    } else {
      toDelete = [];
    }
    const liveTarget = toDelete.find((t) => t.role === 'current');
    if (liveTarget) {
      throw new RuntimeError(
        `Cannot delete current theme ${liveTarget.id}; publish another theme first`,
        1,
      );
    }
    const ids = new Set(toDelete.map((t) => t.id));
    draft.themes = themes.filter((t) => !ids.has(t.id));
    deleted.push(...toDelete.map((t) => ({ id: numericId(t.id), name: t.name })));
  });
  // Real CLI emits one success box per deleted theme.
  for (const t of deleted) {
    emitSuccess([
      { title: `The theme '${t.name}' (#${t.id}) was deleted from ${MOCK_STORE_FQDN}.` },
    ]);
  }
  return 0;
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
