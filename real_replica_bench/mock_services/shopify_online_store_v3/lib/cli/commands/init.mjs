// `shopify theme init` — packages/theme/src/cli/commands/theme/init.ts
//
// Real CLI: clones a Git repo (defaults to Shopify's Skeleton theme) into a
// local directory. Honors `--name` (subdir name; can also be the first
// positional arg), `--path` (parent dir, defaults to cwd), and the cosmetic
// flags `--clone-url` / `--latest`.
//
// Mock divergence (documented in README.md "Shopify CLI divergences"):
//   * No git/network access — we always copy the bundled seed theme at
//     `seeds/themes/origin/` regardless of `--clone-url` / `--latest`. A
//     short notice is printed to stderr when those flags are passed so the
//     caller knows their value was ignored.
//
// Output (mock-specific success line, chosen to be byte-stable for smokes):
//   stderr: cli-kit renderSuccess box "Theme initialised at: <abs path>"
//   exit 0
//
// Errors:
//   * Target directory exists & is non-empty → RuntimeError (exit 1) with
//     message exactly `Target directory <abs path> already exists and is
//     not empty.` so smokes / scripts can assert against it.

import { existsSync, mkdirSync, readdirSync, copyFileSync, readlinkSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnvironment } from '../environment.mjs';
import {
  emitInfo,
  emitSuccess,
  readHelpFile,
} from '../output.mjs';
import {
  RuntimeError,
  globalFlagsSpec,
  parseFlagsAllowPositional,
} from '../parser.mjs';

// upstream init.ts: only globalFlags + themeFlags.path + clone-url + latest
const SPEC = [
  ...globalFlagsSpec,
  { long: 'path', type: 'string', env: 'SHOPIFY_FLAG_PATH' },
  { long: 'name', type: 'string', env: 'SHOPIFY_FLAG_NAME' },
  { long: 'clone-url', char: 'u', type: 'string', env: 'SHOPIFY_FLAG_CLONE_URL' },
  { long: 'latest', char: 'l', type: 'boolean', env: 'SHOPIFY_FLAG_LATEST' },
];

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = resolve(HERE, '..', '..', '..', 'seeds', 'themes', 'origin');

export async function run(argv) {
  const { flags, positional } = parseFlagsAllowPositional(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-init'));
    return 0;
  }
  applyEnvironment(flags, ['path']);

  const parent = flags.path ? resolve(flags.path) : process.cwd();
  const name = flags.name || positional[0] || 'theme';
  const destination = resolve(join(parent, name));

  if (flags['clone-url'] || flags.latest) {
    emitInfo([
      {
        text:
          'Note: this mock has no GitHub access; --clone-url / --latest are ignored and the bundled seed theme is used.',
      },
    ]);
  }

  if (!existsSync(SEED_DIR)) {
    throw new RuntimeError(`Seed theme source not found at ${SEED_DIR}.`, 1);
  }
  if (existsSync(destination)) {
    let entries = [];
    try { entries = readdirSync(destination); } catch { entries = []; }
    if (entries.length) {
      throw new RuntimeError(
        `Target directory ${destination} already exists and is not empty.`,
        1,
      );
    }
  } else {
    mkdirSync(destination, { recursive: true });
  }

  copyDirRecursive(SEED_DIR, destination);

  emitSuccess([
    { title: `Theme initialised at: ${destination}` },
    { title: 'Next steps', bullets: ['Run `shopify theme dev` to start a local preview server'] },
  ]);
  return 0;
}

function copyDirRecursive(src, dst) {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(d, { recursive: true });
      copyDirRecursive(s, d);
    } else if (entry.isSymbolicLink()) {
      try {
        const link = readlinkSync(s);
        symlinkSync(link, d);
      } catch {
        // best-effort copy of target
        try { copyFileSync(s, d); } catch {}
      }
    } else if (entry.isFile()) {
      copyFileSync(s, d);
    }
  }
}
