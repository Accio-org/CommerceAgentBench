#!/usr/bin/env bun
// gws — Google Workspace CLI (mock)
//
// CLI surface aligned with the google/mcp workspace-server tool names.
// Agent calls `gws sheets get-text`, `gws slides get-metadata`, etc.
// Runs against local bun:sqlite DB by default; pass `--remote <url>` to talk to a server.

import { openDb } from './lib/db.mjs';
import { createState } from './state.mjs';

const HELP = `Usage: gws <group> <command> [options]

Groups:
  sheets    Google Sheets operations
  slides    Google Slides operations

Sheets commands:
  sheets get-text       --spreadsheet-id <id|url> [--format text|csv|json]
  sheets get-range      --spreadsheet-id <id|url> --range "Sheet1!A1:C10"
  sheets get-metadata   --spreadsheet-id <id|url>
  sheets set-cells      --spreadsheet-id <id> --sheet-title <name> --updates '[{"a1":"A1","value":"x"}]'
  sheets add-sheet      --spreadsheet-id <id> --title <name>
  sheets delete-sheet   --spreadsheet-id <id> --sheet-title <name>
  sheets rename         --spreadsheet-id <id> --title <name>

Slides commands:
  slides get-text       --presentation-id <id|url>
  slides get-metadata   --presentation-id <id|url>
  slides get-images     --presentation-id <id|url> [--local-path /dir]
  slides get-thumbnail  --presentation-id <id|url> --slide-object-id <id> [--local-path /file]
  slides add-slide      --presentation-id <id> [--layout TITLE|TITLE_AND_BODY|BLANK] [--insert-after <objectId>]
  slides delete-slide   --presentation-id <id> --slide-object-id <id>
  slides duplicate-slide --presentation-id <id> --slide-object-id <id>
  slides set-text       --presentation-id <id> --slide-object-id <id> --element-object-id <id> --text "..."
  slides rename         --presentation-id <id> --title <name>

Utility:
  list                  List all seeded documents
  reset                 Reset mock state to seed

Flags:
  --remote <url>        Call a running server instead of local DB
  --json                Parse JSON from content[0].text before printing
  --pretty              Pretty-print JSON output
  -h, --help            Show this help
`;

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [], remote: null, json: false, pretty: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.help = true; continue; }
    if (a === '--json') { out.json = true; continue; }
    if (a === '--pretty') { out.pretty = true; continue; }
    if (a === '--remote') { out.remote = argv[++i]; continue; }
    if (a.startsWith('--')) {
      const k = kebabToCamel(a.slice(2));
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
      continue;
    }
    out._.push(a);
  }
  return out;
}

function kebabToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Tool dispatch table
// ---------------------------------------------------------------------------

const TOOL_MAP = {
  'sheets get-text':      { tool: 'sheets.getText',         keys: ['spreadsheetId', 'format'] },
  'sheets get-range':     { tool: 'sheets.getRange',        keys: ['spreadsheetId', 'range'] },
  'sheets get-metadata':  { tool: 'sheets.getMetadata',     keys: ['spreadsheetId'] },
  'slides get-text':      { tool: 'slides.getText',         keys: ['presentationId'] },
  'slides get-metadata':  { tool: 'slides.getMetadata',     keys: ['presentationId'] },
  'slides get-images':    { tool: 'slides.getImages',       keys: ['presentationId', 'localPath'] },
  'slides get-thumbnail': { tool: 'slides.getSlideThumbnail', keys: ['presentationId', 'slideObjectId', 'localPath'] },
};

function buildMutationMap(mutations) {
  return {
    'sheets set-cells':      args => mutations.setCells({
      spreadsheetId: args.spreadsheetId, sheetTitle: args.sheetTitle,
      updates: typeof args.updates === 'string' ? JSON.parse(args.updates) : args.updates,
    }),
    'sheets add-sheet':      args => mutations.addSheet({ spreadsheetId: args.spreadsheetId, title: args.title }),
    'sheets delete-sheet':   args => mutations.deleteSheet({ spreadsheetId: args.spreadsheetId, sheetTitle: args.sheetTitle }),
    'sheets rename':         args => mutations.renameSpreadsheet({ spreadsheetId: args.spreadsheetId, title: args.title }),
    'slides add-slide':      args => mutations.addSlide({
      presentationId: args.presentationId, layout: args.layout, insertAfter: args.insertAfter,
    }),
    'slides delete-slide':   args => mutations.deleteSlide({ presentationId: args.presentationId, slideObjectId: args.slideObjectId }),
    'slides duplicate-slide': args => mutations.duplicateSlide({ presentationId: args.presentationId, slideObjectId: args.slideObjectId }),
    'slides set-text':       args => mutations.setSlideText({
      presentationId: args.presentationId, slideObjectId: args.slideObjectId,
      elementObjectId: args.elementObjectId, text: typeof args.text === 'string' ? args.text : String(args.text ?? ''),
    }),
    'slides rename':         args => mutations.renamePresentation({ presentationId: args.presentationId, title: args.title }),
  };
}

// ---------------------------------------------------------------------------
// Remote call
// ---------------------------------------------------------------------------

async function callRemote(remote, toolName, toolArgs) {
  const base = remote.endsWith('/') ? remote : remote + '/';
  const res = await fetch(new URL('/api/tools/call', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: toolName, arguments: toolArgs }),
  });
  if (!res.ok) throw new Error(`Remote ${toolName} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function mutateRemote(remote, group, cmd, body) {
  const base = remote.endsWith('/') ? remote : remote + '/';
  const path = `/api/${group}/${kebabToCamel(cmd)}`;
  const res = await fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mutation ${group} ${cmd} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printResult(result, args) {
  const text = result?.content?.[0]?.text;
  if (!args.json && text !== undefined) {
    process.stdout.write((typeof text === 'string' ? text : JSON.stringify(text)) + '\n');
    return;
  }
  let payload = result;
  if (args.json && text !== undefined) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (typeof payload === 'string') process.stdout.write(payload + '\n');
  else process.stdout.write(JSON.stringify(payload, null, args.pretty ? 2 : 0) + '\n');
}

function printJson(obj, args) {
  process.stdout.write(JSON.stringify(obj, null, args.pretty ? 2 : 0) + '\n');
}

function pluck(args, keys) {
  const out = {};
  for (const k of keys) { if (k in args) out[k] = args[k]; }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    process.stdout.write(HELP);
    return;
  }

  const group = args._[0];
  const cmd = args._[1];

  // Only open local DB when not using --remote
  let state;
  if (!args.remote) {
    const db = openDb();
    state = createState(db);
  }

  // Utility: list
  if (group === 'list') {
    if (args.remote) {
      throw new Error('list not supported in --remote mode');
    }
    const s = state.getState();
    const sheets = Object.values(s.spreadsheets).map(ss => ({
      id: ss.spreadsheetId, title: ss.properties.title, sheets: ss.sheets.length,
    }));
    const slides = Object.values(s.presentations).map(p => ({
      id: p.presentationId, title: p.title, slides: p.slides.length,
    }));
    printJson({ spreadsheets: sheets, presentations: slides }, args);
    return;
  }

  // Utility: reset
  if (group === 'reset') {
    if (args.remote) {
      await fetch(new URL('/api/reset', args.remote), { method: 'POST' });
    } else {
      state.reset();
    }
    printJson({ ok: true }, args);
    return;
  }

  if (!cmd) {
    process.stderr.write(`Missing command. Use: gws ${group} <command>\n`);
    process.exit(1);
  }

  const key = `${group} ${cmd}`;

  // Official read tools
  const toolDef = TOOL_MAP[key];
  if (toolDef) {
    const toolArgs = pluck(args, toolDef.keys);
    let result;
    if (args.remote) {
      result = await callRemote(args.remote, toolDef.tool, toolArgs);
    } else {
      result = state.tools[toolDef.tool](toolArgs);
      state.record('cli.tool', toolDef.tool, toolArgs);
    }
    printResult(result, args);
    return;
  }

  // Mutations — recognize command names statically so --remote works without local DB
  const MUTATION_KEYS = new Set([
    'sheets set-cells', 'sheets add-sheet', 'sheets delete-sheet', 'sheets rename',
    'slides add-slide', 'slides delete-slide', 'slides duplicate-slide', 'slides set-text', 'slides rename',
  ]);
  if (MUTATION_KEYS.has(key)) {
    if (args.remote) {
      const mutArgs = {};
      for (const [k, v] of Object.entries(args)) {
        if (k !== '_' && k !== 'remote' && k !== 'json' && k !== 'pretty' && k !== 'help') {
          mutArgs[k] = typeof v === 'string' && v.startsWith('[') ? JSON.parse(v) : v;
        }
      }
      const result = await mutateRemote(args.remote, group, cmd, mutArgs);
      printJson(result, args);
    } else {
      const mutFn = buildMutationMap(state.mutations)[key];
      const result = mutFn(args);
      printJson(result, args);
    }
    return;
  }

  process.stderr.write(`Unknown command: gws ${key}\n\n`);
  process.stdout.write(HELP);
  process.exit(1);
}

main().catch(e => {
  process.stderr.write(`Error: ${e.message}\n`);
  process.exit(1);
});
