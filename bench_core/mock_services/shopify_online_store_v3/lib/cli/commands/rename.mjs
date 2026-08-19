// `shopify theme rename` — packages/theme/src/cli/commands/theme/rename.ts
//
// Real CLI output (verified): renderSuccess box with one message line:
//   "The theme '{oldName}' (#{id}) was renamed to '{newName}'"
//
// Footgun: name env is SHOPIFY_FLAG_NEW_NAME (not _NAME) — rename.ts:25.

import { mutateThemes } from '../api.mjs';
import { applyEnvironment } from '../environment.mjs';
import { emitSuccess, readHelpFile } from '../output.mjs';
import {
  RuntimeError,
  globalFlagsSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';

const SPEC = [
  ...globalFlagsSpec,
  ...themeFlagsSpec,
  { long: 'name', char: 'n', type: 'string', env: 'SHOPIFY_FLAG_NEW_NAME' },
  { long: 'development', char: 'd', type: 'boolean', env: 'SHOPIFY_FLAG_DEVELOPMENT' },
  { long: 'theme', char: 't', type: 'string', env: 'SHOPIFY_FLAG_THEME_ID' },
  { long: 'live', char: 'l', type: 'boolean', env: 'SHOPIFY_FLAG_LIVE' },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-rename'));
    return 0;
  }
  applyEnvironment(flags, SPEC);
  if (!flags.name) {
    // Real CLI prompts "New name for the theme" interactively; non-TTY → fail.
    throw Object.assign(new Error('Failed to prompt'), {
      exitCode: 1,
      render: 'failed-prompt',
      promptText: 'New name for the theme',
    });
  }
  if (!flags.theme && !flags.live && !flags.development) {
    throw Object.assign(new Error('Failed to prompt'), {
      exitCode: 1,
      render: 'failed-prompt',
      promptText: 'Which theme do you want to rename?',
    });
  }
  let oldName = '';
  let targetId = '';
  await mutateThemes('cli_theme_rename', (draft) => {
    const themes = draft.themes || [];
    let target;
    if (flags.theme) {
      target = themes.find((t) => String(t.id) === String(flags.theme) || t.name === flags.theme);
    } else if (flags.live) {
      target = themes.find((t) => t.role === 'current');
    } else if (flags.development) {
      target = themes.find((t) => t.role === 'draft');
    }
    if (!target) {
      throw new RuntimeError(`Theme not found for the given selector`, 1);
    }
    oldName = target.name;
    targetId = numericId(target.id);
    target.name = flags.name;
    target.updatedText = '刚刚通过 Shopify CLI 重命名';
    if (draft.themeId === target.id) draft.themeName = target.name;
  });
  emitSuccess([
    { title: `The theme '${oldName}' (#${targetId}) was renamed to '${flags.name}'` },
  ]);
  return 0;
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
