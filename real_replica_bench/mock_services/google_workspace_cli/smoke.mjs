#!/usr/bin/env node
// Smoke test for google-sheets-slides-mock.
// Exercises: CLI subcommands (in-process), HTTP tool surface, verifier token.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3091);
const BASE = `http://127.0.0.1:${PORT}`;
const VERIFIER_TOKEN = 'smoke-test-token';
const SMOKE_HOME = mkdtempSync(path.join(tmpdir(), 'gws-smoke-'));

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push({ name, ok: true }); console.log(`  ✓ ${name}`); })
    .catch((e) => { results.push({ name, ok: false, err: e.message }); console.error(`  ✗ ${name} — ${e.message}`); });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function http_(method, urlPath, body, headers = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

function unwrapToolText(body) {
  const t = body?.content?.[0]?.text;
  if (typeof t !== 'string') return null;
  try { return JSON.parse(t); } catch { return t; }
}

async function runCli(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', [path.join(__dirname, 'cli.mjs'), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GWS_MOCK_HOME: SMOKE_HOME },
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('close', (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(stderr || `exit ${code}`)));
  });
}

async function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', [path.join(__dirname, 'server.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(PORT), MOCK_VERIFIER_TOKEN: VERIFIER_TOKEN, GWS_MOCK_HOME: SMOKE_HOME },
    });
    let started = false;
    proc.stdout.on('data', (c) => {
      if (!started && c.toString().includes('running on')) {
        started = true;
        resolve(proc);
      }
    });
    proc.stderr.on('data', (c) => {
      if (!started) { started = true; reject(new Error(c.toString())); }
    });
    setTimeout(() => { if (!started) { started = true; reject(new Error('server start timeout')); } }, 5000);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  console.log(`google-sheets-slides-mock smoke test\n`);

  // ── CLI surface (in-process, no server) ──
  console.log('CLI surface (in-process):');

  await check('gws --help prints usage', async () => {
    const { stdout } = await runCli(['--help']);
    if (!stdout.includes('sheets get-text')) throw new Error('missing sheets get-text');
    if (!stdout.includes('slides get-metadata')) throw new Error('missing slides get-metadata');
  });

  await check('gws sheets get-metadata --pretty', async () => {
    const { stdout } = await runCli(['sheets', 'get-metadata', '--spreadsheet-id', 'sheet-q3-budget-001', '--json', '--pretty']);
    const m = JSON.parse(stdout);
    if (m.title !== 'Q3 Marketing Budget') throw new Error(`title=${m.title}`);
    if (!Array.isArray(m.sheets) || m.sheets.length !== 3) throw new Error('expected 3 sheets');
  });

  await check('gws sheets get-range parses A1', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-q3-budget-001', '--range', 'Summary!A1:D6', '--json']);
    const m = JSON.parse(stdout);
    if (m.values[0][0] !== 'Channel') throw new Error('header missing');
    if (m.values[5][0] !== 'Total') throw new Error('Total row missing');
  });

  await check('gws sheets get-text format=csv', async () => {
    const { stdout } = await runCli(['sheets', 'get-text', '--spreadsheet-id', 'sheet-q3-budget-001', '--format', 'csv']);
    if (!stdout.includes('Channel,Planned,Actual,Variance')) throw new Error('csv header missing');
  });

  await check('gws sheets get-text format=json', async () => {
    const { stdout } = await runCli(['sheets', 'get-text', '--spreadsheet-id', 'sheet-q3-budget-001', '--format', 'json', '--json']);
    const m = JSON.parse(stdout);
    if (!m.Summary) throw new Error('missing Summary key');
  });

  await check('gws sheets get-metadata accepts URL form', async () => {
    const { stdout } = await runCli([
      'sheets', 'get-metadata',
      '--spreadsheet-id', 'https://docs.google.com/spreadsheets/d/sheet-q3-budget-001/edit#gid=0',
      '--json',
    ]);
    const m = JSON.parse(stdout);
    if (m.spreadsheetId !== 'sheet-q3-budget-001') throw new Error(`got ${m.spreadsheetId}`);
  });

  await check('gws slides get-metadata', async () => {
    const { stdout } = await runCli(['slides', 'get-metadata', '--presentation-id', 'pres-launch-101', '--json']);
    const m = JSON.parse(stdout);
    if (m.slideCount !== 4) throw new Error(`slideCount=${m.slideCount}`);
  });

  await check('gws slides get-metadata exposes text element ids', async () => {
    const { stdout } = await runCli(['slides', 'get-metadata', '--presentation-id', 'pres-sourcing-review-303', '--json']);
    const m = JSON.parse(stdout);
    const textElements = (m.slides || []).flatMap(s => s.pageElements || []).filter(el => el.text);
    if (textElements.length < 2) throw new Error(`expected text elements, got ${textElements.length}`);
    if (!textElements.every(el => el.objectId)) throw new Error('missing text element objectId');
    if (!textElements.some(el => String(el.text).includes('Total inventory value'))) {
      throw new Error('missing key metrics text in metadata');
    }
  });

  await check('gws slides get-text includes table', async () => {
    const { stdout } = await runCli(['slides', 'get-text', '--presentation-id', 'pres-launch-101']);
    if (!stdout.includes('--- Table Data ---')) throw new Error('table marker missing');
  });

  await check('gws slides get-images returns array', async () => {
    const { stdout } = await runCli(['slides', 'get-images', '--presentation-id', 'pres-launch-101', '--local-path', '/tmp/mock', '--json']);
    const m = JSON.parse(stdout);
    if (!Array.isArray(m.images)) throw new Error('images not array');
  });

  await check('gws slides get-thumbnail returns descriptor', async () => {
    const { stdout } = await runCli([
      'slides', 'get-thumbnail',
      '--presentation-id', 'pres-launch-101',
      '--slide-object-id', 'g_slide_001',
      '--local-path', '/tmp/mock/t.png',
      '--json',
    ]);
    const m = JSON.parse(stdout);
    if (!m.contentUrl?.startsWith('mock://')) throw new Error(`contentUrl=${m.contentUrl}`);
  });

  await check('gws list shows all seeded docs (4 sheets, 3 presentations)', async () => {
    const { stdout } = await runCli(['list', '--pretty']);
    const m = JSON.parse(stdout);
    if (m.spreadsheets.length !== 4) throw new Error(`expected 4 spreadsheets, got ${m.spreadsheets.length}`);
    if (m.presentations.length !== 3) throw new Error(`expected 3 presentations, got ${m.presentations.length}`);
  });

  // ── Seed data integrity ──
  console.log('\nSeed data integrity:');

  await check('supplier-eval-003: Supplier Overview has 33 data rows', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-supplier-eval-003', '--range', 'Supplier Overview!A1:A35', '--json']);
    const m = JSON.parse(stdout);
    if (m.values.length < 34) throw new Error(`expected ≥34 rows (header+33), got ${m.values.length}`);
    if (m.values[0][0] !== 'Supplier') throw new Error('header mismatch');
  });

  await check('supplier-eval-003: Unicode supplier names preserved', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-supplier-eval-003', '--range', 'Supplier Overview!A2', '--json']);
    const m = JSON.parse(stdout);
    if (!m.values[0][0].includes('深圳流明科技')) throw new Error('Chinese name lost');
  });

  await check('supplier-eval-003: Quote Comparison formulas stored', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-supplier-eval-003', '--range', 'Quote Comparison!F2:G2', '--json']);
    const m = JSON.parse(stdout);
    if (m.values[0][0] !== 12.50) throw new Error(`best price: expected 12.50, got ${m.values[0][0]}`);
  });

  await check('supplier-eval-003: Audit Trail has 17 data rows', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-supplier-eval-003', '--range', 'Audit Trail!A1:A19', '--json']);
    const m = JSON.parse(stdout);
    if (m.values[0][0] !== 'Date') throw new Error('header mismatch');
    if (m.values.length < 18) throw new Error(`expected ≥18 rows, got ${m.values.length}`);
  });

  await check('inventory-004: Warehouse Stock has 39 data rows across 4 warehouses', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-inventory-004', '--range', 'Warehouse Stock!A1:L41', '--json']);
    const m = JSON.parse(stdout);
    if (m.values.length < 40) throw new Error(`expected ≥40 rows, got ${m.values.length}`);
    const warehouses = new Set(m.values.slice(1).map(r => r[2]).filter(w => w));
    if (warehouses.size !== 4) throw new Error(`expected 4 warehouses, got ${warehouses.size}: ${[...warehouses]}`);
  });

  await check('inventory-004: stockout items exist (On Hand = 0)', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-inventory-004', '--range', 'Warehouse Stock!D2:D16', '--json']);
    const m = JSON.parse(stdout);
    const zeros = m.values.filter(r => r[0] === 0).length;
    if (zeros < 2) throw new Error(`expected ≥2 zero-stock rows, got ${zeros}`);
  });

  await check('inventory-004: Cost Summary grand total row exists', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-inventory-004', '--range', 'Cost Summary!A6:C6', '--json']);
    const m = JSON.parse(stdout);
    if (m.values[0][0] !== 'Grand Total') throw new Error('Grand Total row missing');
    if (typeof m.values[0][2] !== 'number') throw new Error('total value should be numeric');
  });

  await check('inventory-004: Reorder Queue has 15 entries', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-inventory-004', '--range', 'Reorder Queue!A1:F17', '--json']);
    const m = JSON.parse(stdout);
    if (m.values.length < 16) throw new Error(`expected ≥16 rows, got ${m.values.length}`);
    if (!m.values[1][5].includes('Urgent')) throw new Error('first reorder should be urgent');
  });

  await check('inventory-004: PO Ledger has shipping and hold details', async () => {
    const { stdout } = await runCli(['sheets', 'get-range', '--spreadsheet-id', 'sheet-inventory-004', '--range', 'PO Ledger!A1:L14', '--json']);
    const m = JSON.parse(stdout);
    if (m.values.length < 13) throw new Error(`expected ≥13 rows, got ${m.values.length}`);
    if (!JSON.stringify(m.values).includes('QC hold')) throw new Error('QC hold detail missing');
  });

  await check('pres-sourcing-review-303: 6 slides', async () => {
    const { stdout } = await runCli(['slides', 'get-metadata', '--presentation-id', 'pres-sourcing-review-303', '--json']);
    const m = JSON.parse(stdout);
    if (m.slideCount !== 6) throw new Error(`expected 6 slides, got ${m.slideCount}`);
  });

  await check('pres-sourcing-review-303: getText includes table + Unicode + risk levels', async () => {
    const { stdout } = await runCli(['slides', 'get-text', '--presentation-id', 'pres-sourcing-review-303']);
    if (!stdout.includes('--- Table Data ---')) throw new Error('table missing');
    if (!stdout.includes('广州兰花美容')) throw new Error('Unicode supplier name missing');
    if (!stdout.includes('HIGH') || !stdout.includes('MEDIUM') || !stdout.includes('LOW')) throw new Error('risk levels missing');
  });

  await check('pres-sourcing-review-303: cost optimization data present', async () => {
    const { stdout } = await runCli(['slides', 'get-text', '--presentation-id', 'pres-sourcing-review-303']);
    if (!stdout.includes('$9,600/yr')) throw new Error('packaging savings figure missing');
    if (!stdout.includes('Monterrey Steel')) throw new Error('nearshoring supplier missing');
  });

  // ── HTTP server + verifier token ──
  console.log('\nHTTP server + verifier token:');
  const serverProc = await startServer();

  try {
    await check('GET /api/state without token → 403', async () => {
      const r = await http_('GET', '/api/state');
      if (r.status !== 403) throw new Error(`expected 403, got ${r.status}`);
    });

    await check('GET /api/state with token → 200', async () => {
      const r = await http_('GET', '/api/state', null, { 'x-mock-verifier-token': VERIFIER_TOKEN });
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      if (!r.body?.db?.spreadsheets?.['sheet-q3-budget-001']) throw new Error('missing seed');
    });

    await check('GET /api/audit without token → 403', async () => {
      const r = await http_('GET', '/api/audit');
      if (r.status !== 403) throw new Error(`expected 403, got ${r.status}`);
    });

    await check('POST /api/reset without token → 403', async () => {
      const r = await http_('POST', '/api/reset');
      if (r.status !== 403) throw new Error(`expected 403, got ${r.status}`);
    });

    await check('POST /api/tools/call works without token', async () => {
      const r = await http_('POST', '/api/tools/call', {
        name: 'sheets.getMetadata',
        arguments: { spreadsheetId: 'sheet-q3-budget-001' },
      });
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      const m = unwrapToolText(r.body);
      if (m.title !== 'Q3 Marketing Budget') throw new Error(`title=${m.title}`);
    });

    await check('POST /api/sheets/setCells + tools/call round-trip', async () => {
      await http_('POST', '/api/sheets/setCells', {
        spreadsheetId: 'sheet-q3-budget-001',
        sheetTitle: 'Summary',
        updates: [{ a1: 'A9', value: 'HTTP smoke' }],
      });
      const r = await http_('POST', '/api/tools/call', {
        name: 'sheets.getRange',
        arguments: { spreadsheetId: 'sheet-q3-budget-001', range: 'Summary!A9' },
      });
      const m = unwrapToolText(r.body);
      if (m.values[0][0] !== 'HTTP smoke') throw new Error(`got ${JSON.stringify(m.values)}`);
    });

    await check('POST /api/reset with token restores seed', async () => {
      await http_('POST', '/api/reset', null, { 'x-mock-verifier-token': VERIFIER_TOKEN });
      const r = await http_('POST', '/api/tools/call', {
        name: 'sheets.getMetadata',
        arguments: { spreadsheetId: 'sheet-q3-budget-001' },
      });
      const m = unwrapToolText(r.body);
      if (m.sheets.length !== 3) throw new Error('reset did not restore');
    });

    // ── CLI mutations via --remote (shared server state) ──
    console.log('\n  CLI mutations (--remote):');

    await check('gws sheets set-cells + get-range round-trip (--remote)', async () => {
      await runCli([
        'sheets', 'set-cells',
        '--spreadsheet-id', 'sheet-q3-budget-001',
        '--sheet-title', 'Summary',
        '--updates', '[{"a1":"A8","value":"Smoke"},{"a1":"B8","value":"42"}]',
        '--remote', BASE,
      ]);
      const { stdout } = await runCli([
        'sheets', 'get-range',
        '--spreadsheet-id', 'sheet-q3-budget-001',
        '--range', 'Summary!A8:B8',
        '--json',
        '--remote', BASE,
      ]);
      const m = JSON.parse(stdout);
      if (m.values[0][0] !== 'Smoke') throw new Error(`got ${m.values[0][0]}`);
      if (m.values[0][1] !== 42) throw new Error('numeric coercion failed');
    });

    await check('gws sheets add-sheet + get-metadata (--remote)', async () => {
      await runCli(['sheets', 'add-sheet', '--spreadsheet-id', 'sheet-q3-budget-001', '--title', 'Scratch', '--remote', BASE]);
      const { stdout } = await runCli(['sheets', 'get-metadata', '--spreadsheet-id', 'sheet-q3-budget-001', '--json', '--remote', BASE]);
      const m = JSON.parse(stdout);
      if (!m.sheets.some(s => s.title === 'Scratch')) throw new Error('new sheet missing');
    });

    await check('gws slides add-slide increments count (--remote)', async () => {
      const before = JSON.parse((await runCli(['slides', 'get-metadata', '--presentation-id', 'pres-launch-101', '--json', '--remote', BASE])).stdout).slideCount;
      await runCli(['slides', 'add-slide', '--presentation-id', 'pres-launch-101', '--layout', 'TITLE', '--remote', BASE]);
      const after = JSON.parse((await runCli(['slides', 'get-metadata', '--presentation-id', 'pres-launch-101', '--json', '--remote', BASE])).stdout).slideCount;
      if (after !== before + 1) throw new Error(`before=${before} after=${after}`);
    });

    await check('reset via verifier token restores seed after CLI mutations', async () => {
      await http_('POST', '/api/reset', null, { 'x-mock-verifier-token': VERIFIER_TOKEN });
      const { stdout } = await runCli(['sheets', 'get-metadata', '--spreadsheet-id', 'sheet-q3-budget-001', '--json', '--remote', BASE]);
      const m = JSON.parse(stdout);
      if (m.sheets.length !== 3) throw new Error('reset did not restore');
    });
  } finally {
    serverProc.kill('SIGTERM');
  }

  // ── Summary ──
  const failed = results.filter(r => !r.ok);
  console.log(`\nResults: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    for (const f of failed) console.error(`  FAIL ${f.name}: ${f.err}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
