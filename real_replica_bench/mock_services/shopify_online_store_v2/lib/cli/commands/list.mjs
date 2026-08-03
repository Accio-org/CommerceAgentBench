// `shopify theme list` — packages/theme/src/cli/commands/theme/list.ts
//
// Output shapes (verified against real CLI 4.1.0 against a live store, see
// scratch/docs/cli_alignment/shopify_cli.md):
//
//   --json: bare array, each entry = {id, name, processing, createdAtRuntime, role}
//   plain:  cli-kit renderInfo box on STDERR with a 3-col table:
//             name (col 31)  role (col 22, brackets)  id (col 14, # prefix)

import { api } from '../api.mjs';
import {
  adminRoleToCliRole,
  emitTable,
  printJson,
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
  ...jsonFlagSpec,
  ...themeFlagsSpec,
  { long: 'id', type: 'integer', env: 'SHOPIFY_FLAG_ID' },
  { long: 'name', type: 'string', env: 'SHOPIFY_FLAG_NAME' },
  {
    long: 'role',
    type: 'string',
    env: 'SHOPIFY_FLAG_ROLE',
    options: ['live', 'unpublished', 'development'],
  },
];

export async function run(argv) {
  const { flags } = parseFlags(argv, SPEC);
  if (flags.help) {
    process.stdout.write(readHelpFile('theme-list'));
    return 0;
  }
  const state = await api.state();
  const themes = (state.draft?.themes ?? []).map((theme) => ({
    id: numericId(theme.id),
    name: theme.name,
    processing: Boolean(theme.processing),
    createdAtRuntime: Boolean(theme.createdAtRuntime),
    role: adminRoleToCliRole(theme.role),
  }));

  let filtered = themes;
  if (flags.id !== undefined) {
    filtered = filtered.filter((t) => t.id === flags.id);
  }
  if (flags.name) {
    const needle = String(flags.name).toLowerCase();
    filtered = filtered.filter((t) => (t.name || '').toLowerCase().includes(needle));
  }
  if (flags.role) {
    filtered = filtered.filter((t) => t.role === flags.role);
  }

  if (flags.json) {
    printJson(filtered);
    return 0;
  }

  emitTable({
    columns: [
      { header: 'name', minWidth: 31 },
      { header: 'role', minWidth: 22 },
      { header: 'id', minWidth: 14 },
    ],
    rows: filtered.map((t) => [t.name, `[${t.role}]`, `#${t.id}`]),
  });
  return 0;
}

function numericId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : id;
}
