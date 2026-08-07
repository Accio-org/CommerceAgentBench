// `shopify theme share` — packages/theme/src/cli/commands/theme/share.ts
//
// Real CLI: equivalent to `theme push --unpublished --theme <random-name>`
// — uploads the local theme as a new unpublished theme with a random
// "creative" name (e.g. "creative-rooster-1234"), then prints the shareable
// preview link.
//
// Mock behavior:
//   * Generates a random name (`creative-<adj>-<noun>-<4 digits>`).
//   * Re-uses push.mjs's mutateThemes() logic via SHOPIFY_MOCK_PUSH_NAME so
//     the underlying events-stream remains a single push event.
//   * Output: cli-kit renderSuccess box "Your theme is shared at: <preview url>"
//
// Errors:
//   * --path doesn't look like a theme dir → RuntimeError exit 1 (push handles
//     this), same shape as `theme push --path <non-theme>`.

import { run as runPush } from './push.mjs';
import { applyEnvironment } from '../environment.mjs';
import {
  MOCK_STORE_FQDN,
  emitSuccess,
  previewUrl,
  readHelpFile,
} from '../output.mjs';
import {
  globalFlagsSpec,
  jsonFlagSpec,
  parseFlags,
  themeFlagsSpec,
} from '../parser.mjs';

const SPEC = [
  ...globalFlagsSpec,
  ...themeFlagsSpec,
  ...jsonFlagSpec,
  { long: 'force', char: 'f', type: 'boolean', env: 'SHOPIFY_FLAG_FORCE' },
  { long: 'listing', type: 'string', env: 'SHOPIFY_FLAG_LISTING' },
];

const ADJECTIVES = ['creative', 'curious', 'electric', 'fluffy', 'jolly', 'modest', 'sparkling', 'witty'];
const NOUNS = ['rooster', 'whale', 'panda', 'tiger', 'badger', 'penguin', 'otter', 'sparrow'];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-share'));
    return 0;
  }
  applyEnvironment(flags, ['path', 'password', 'store']);

  const generatedName = randomThemeName();

  // Re-use push.mjs via env baton — push reads SHOPIFY_MOCK_PUSH_NAME when
  // --unpublished is set, which is exactly the slot we need. We swap stdout
  // AND stderr to sinks for the duration so push's "Uploading files..."
  // progress lines + renderSuccess box don't double up with share's own
  // output. The captured stdout is replayed verbatim when --json is set
  // (push emits a single compact JSON line in that mode).
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);
  const stdoutCaptured = [];
  process.stdout.write = (chunk, ...rest) => {
    stdoutCaptured.push(typeof chunk === 'string' ? chunk : chunk.toString());
    if (typeof rest[0] === 'function') rest[0]();
    return true;
  };
  process.stderr.write = (_chunk, ...rest) => {
    if (typeof rest[0] === 'function') rest[0]();
    return true;
  };
  const prevName = process.env.SHOPIFY_MOCK_PUSH_NAME;
  process.env.SHOPIFY_MOCK_PUSH_NAME = generatedName;
  let exitCode;
  try {
    const pushArgv = ['--unpublished'];
    if (flags.path) { pushArgv.push('--path', flags.path); }
    if (flags.store) { pushArgv.push('--store', flags.store); }
    if (flags.password) { pushArgv.push('--password', flags.password); }
    if (flags['no-color']) { pushArgv.push('--no-color'); }
    if (flags.json) { pushArgv.push('--json'); }
    if (flags.force) { pushArgv.push('--force'); }
    exitCode = await runPush(pushArgv);
  } finally {
    process.stdout.write = realStdoutWrite;
    process.stderr.write = realStderrWrite;
    if (prevName === undefined) delete process.env.SHOPIFY_MOCK_PUSH_NAME;
    else process.env.SHOPIFY_MOCK_PUSH_NAME = prevName;
  }

  if (exitCode !== 0) return exitCode;

  // Parse pushed JSON payload (if --json) or look up the latest theme by
  // name so we can mint the preview URL.
  if (flags.json) {
    // push printed a compact JSON line; replay it verbatim.
    for (const chunk of stdoutCaptured) realStdoutWrite(chunk);
    return 0;
  }

  // Look up the new theme to build a preview URL.
  const { api } = await import('../api.mjs');
  const state = await api.state();
  const themes = state.draft?.themes ?? state.saved?.themes ?? [];
  const created = themes.find((t) => t.name === generatedName) || themes.at(-1);
  const id = numericId(created?.id ?? 0);
  const preview = previewUrl(MOCK_STORE_FQDN, id);

  emitSuccess(
    [
      { title: `Your theme '${generatedName}' is shared.` },
      { rows: [['ID', `#${id}`], ['Name', generatedName]] },
      { title: 'Preview', bullets: ['Share this link with reviewers [1]'] },
    ],
    [preview],
  );
  return 0;
}

function randomThemeName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = String(Math.floor(Math.random() * 9000) + 1000);
  return `${adj}-${noun}-${num}`;
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
