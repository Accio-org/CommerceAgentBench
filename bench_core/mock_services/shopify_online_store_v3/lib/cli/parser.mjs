// Tight oclif-flavored CLI flag parser used by bin/shopify.
//
// Each subcommand defines its flag spec (see commands/*.mjs); the parser
// reads argv, maps short forms (-t) and long forms (--theme[=value]),
// honors SHOPIFY_FLAG_* env vars when a flag is absent, collects
// multiple-valued flags into arrays, and yields { flags, positional }.
//
// Hidden flags (defined as such in upstream packages/theme/src/cli/commands/
// theme/*.ts) are accepted silently — they don't appear in `--help` but are
// not rejected. Unknown flags trigger a UsageError with exit code 2.

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = 2;
  }
}

export class RuntimeError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'RuntimeError';
    this.exitCode = exitCode;
  }
}

// Each entry: { long, char, type, env, multiple, default, options }
// type: 'string' | 'boolean' | 'integer'
export function parseFlags(argv, spec) {
  // Build lookup tables.
  const byLong = new Map();
  const byChar = new Map();
  for (const flag of spec) {
    byLong.set(flag.long, flag);
    if (flag.char) byChar.set(flag.char, flag);
  }

  const flags = {};
  // Apply env-var defaults first so explicit CLI args win on overwrite.
  for (const flag of spec) {
    if (flag.env && process.env[flag.env] !== undefined) {
      const raw = process.env[flag.env];
      assignValue(flags, flag, raw);
    } else if (flag.default !== undefined && flag.type === 'boolean') {
      flags[flag.long] = flag.default;
    }
  }

  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    // End-of-flags marker.
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    // --long or --long=value
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
      const flag = byLong.get(name);
      if (!flag) throw new UsageError(`Nonexistent flag: --${name}`);
      i += 1;
      if (flag.type === 'boolean') {
        if (inlineValue !== null) throw new UsageError(`Flag --${name} does not take a value`);
        flags[flag.long] = true;
      } else {
        const value = inlineValue !== null ? inlineValue : argv[i++];
        if (value === undefined) throw new UsageError(`Flag --${name} requires a value`);
        assignValue(flags, flag, value);
      }
      continue;
    }

    // -x or -x value or combined boolean shorts (-ab)
    if (arg.startsWith('-') && arg.length > 1) {
      const body = arg.slice(1);
      // Single short: -x VALUE or -x (boolean)
      if (body.length === 1) {
        const flag = byChar.get(body);
        if (!flag) throw new UsageError(`Nonexistent flag: -${body}`);
        i += 1;
        if (flag.type === 'boolean') {
          flags[flag.long] = true;
        } else {
          const value = argv[i++];
          if (value === undefined) throw new UsageError(`Flag -${body} requires a value`);
          assignValue(flags, flag, value);
        }
        continue;
      }
      // Combined boolean shorts (-abc); only allowed if every char is a known boolean flag.
      const allBoolean = body.split('').every((c) => {
        const f = byChar.get(c);
        return f && f.type === 'boolean';
      });
      if (allBoolean) {
        for (const c of body) flags[byChar.get(c).long] = true;
        i += 1;
        continue;
      }
      // Otherwise treat as -xVALUE (oclif also accepts -t 123 → handled above)
      const head = body[0];
      const flag = byChar.get(head);
      if (!flag || flag.type === 'boolean') {
        throw new UsageError(`Unknown or malformed short flag: -${body}`);
      }
      const value = body.slice(1);
      i += 1;
      assignValue(flags, flag, value);
      continue;
    }

    positional.push(arg);
    i += 1;
  }

  // Theme subcommands accept no positional arguments — surface the first
  // stray one the way real CLI does ("Unexpected argument: X").
  if (positional.length) {
    throw new UsageError(`Unexpected argument: ${positional[0]}`);
  }

  return { flags, positional };
}

// Variant for commands that accept positional arguments (e.g. `theme init [name]`).
// Same parsing rules — just skips the "Unexpected argument" guard.
export function parseFlagsAllowPositional(argv, spec) {
  const byLong = new Map();
  const byChar = new Map();
  for (const flag of spec) {
    byLong.set(flag.long, flag);
    if (flag.char) byChar.set(flag.char, flag);
  }

  const flags = {};
  for (const flag of spec) {
    if (flag.env && process.env[flag.env] !== undefined) {
      assignValue(flags, flag, process.env[flag.env]);
    } else if (flag.default !== undefined && flag.type === 'boolean') {
      flags[flag.long] = flag.default;
    }
  }

  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
      const flag = byLong.get(name);
      if (!flag) throw new UsageError(`Nonexistent flag: --${name}`);
      i += 1;
      if (flag.type === 'boolean') {
        if (inlineValue !== null) throw new UsageError(`Flag --${name} does not take a value`);
        flags[flag.long] = true;
      } else {
        const value = inlineValue !== null ? inlineValue : argv[i++];
        if (value === undefined) throw new UsageError(`Flag --${name} requires a value`);
        assignValue(flags, flag, value);
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const body = arg.slice(1);
      if (body.length === 1) {
        const flag = byChar.get(body);
        if (!flag) throw new UsageError(`Nonexistent flag: -${body}`);
        i += 1;
        if (flag.type === 'boolean') {
          flags[flag.long] = true;
        } else {
          const value = argv[i++];
          if (value === undefined) throw new UsageError(`Flag -${body} requires a value`);
          assignValue(flags, flag, value);
        }
        continue;
      }
      const allBoolean = body.split('').every((c) => {
        const f = byChar.get(c);
        return f && f.type === 'boolean';
      });
      if (allBoolean) {
        for (const c of body) flags[byChar.get(c).long] = true;
        i += 1;
        continue;
      }
      const head = body[0];
      const flag = byChar.get(head);
      if (!flag || flag.type === 'boolean') {
        throw new UsageError(`Unknown or malformed short flag: -${body}`);
      }
      const value = body.slice(1);
      i += 1;
      assignValue(flags, flag, value);
      continue;
    }
    positional.push(arg);
    i += 1;
  }

  return { flags, positional };
}

function assignValue(flags, flag, raw) {
  let value;
  if (flag.type === 'integer') {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) throw new UsageError(`Flag --${flag.long} requires an integer, got ${raw}`);
    value = n;
  } else {
    value = raw;
  }
  if (flag.options && !flag.options.includes(value)) {
    throw new UsageError(
      `Flag --${flag.long} expected one of <${flag.options.join('|')}>, got ${value}`,
    );
  }
  if (flag.multiple) {
    if (!Array.isArray(flags[flag.long])) flags[flag.long] = [];
    flags[flag.long].push(value);
  } else {
    flags[flag.long] = value;
  }
}

// Shared theme-flags (corresponds to packages/theme/src/cli/flags.ts:11-59
// + cli-kit globalFlags + jsonFlag). Imported by each command's spec.
export const globalFlagsSpec = [
  { long: 'no-color', type: 'boolean', env: 'SHOPIFY_FLAG_NO_COLOR' },
  { long: 'verbose', type: 'boolean', env: 'SHOPIFY_FLAG_VERBOSE' },
  { long: 'help', char: 'h', type: 'boolean' },
];

export const jsonFlagSpec = [
  { long: 'json', char: 'j', type: 'boolean', env: 'SHOPIFY_FLAG_JSON' },
];

export const themeFlagsSpec = [
  { long: 'path', type: 'string', env: 'SHOPIFY_FLAG_PATH' },
  { long: 'password', type: 'string', env: 'SHOPIFY_CLI_THEME_TOKEN' },
  { long: 'store', char: 's', type: 'string', env: 'SHOPIFY_FLAG_STORE' },
  { long: 'environment', char: 'e', type: 'string', multiple: true, env: 'SHOPIFY_FLAG_ENVIRONMENT' },
];

export function globFlagsSpec(/* action */) {
  return [
    { long: 'only', char: 'o', type: 'string', multiple: true, env: 'SHOPIFY_FLAG_ONLY' },
    { long: 'ignore', char: 'x', type: 'string', multiple: true, env: 'SHOPIFY_FLAG_IGNORE' },
  ];
}
