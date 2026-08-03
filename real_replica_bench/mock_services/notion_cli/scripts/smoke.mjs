#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NTN = `bun ${path.join(ROOT, 'bin/ntn')}`;
const BASE_URL = `http://localhost:${process.env.NTN_MOCK_PORT || 3456}`;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, cmd, expectFn) {
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
    if (expectFn && !expectFn(out)) {
      throw new Error(`Assertion failed. Output: ${out.slice(0, 200)}`);
    }
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    const msg = err.stderr || err.message || String(err);
    failures.push({ name, error: msg.slice(0, 200) });
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${msg.slice(0, 100)}`);
  }
}

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  console.log('\n\x1b[1mNTN Mock Smoke Tests\x1b[0m\n');

  console.log('Checking server...');
  const serverUp = await waitForServer();
  if (!serverUp) {
    console.log('\x1b[31mServer not running. Start with: npm start\x1b[0m');
    process.exit(1);
  }
  console.log('Server is running.\n');

  // === API Health ===
  console.log('\x1b[1mAPI Health\x1b[0m');
  test('GET /health', `curl -sf ${BASE_URL}/health`, out => out.includes('"ok"'));
  test('GET /api/state', `curl -sf ${BASE_URL}/api/state`, out => {
    const state = JSON.parse(out);
    return state.account && state.entities;
  });

  // === Auth ===
  console.log('\n\x1b[1mAuthentication\x1b[0m');
  test('logout', `${NTN} logout`, out => out.includes('Logged out'));
  test('login', `${NTN} login`, out => out.includes('Logged in'));

  // === Workers ===
  console.log('\n\x1b[1mWorkers\x1b[0m');
  test('workers list', `${NTN} workers list`, out => out.includes('my-sync-worker'));
  test('workers list --json', `${NTN} workers list --json`, out => JSON.parse(out));
  test('workers get', `${NTN} workers get wkr_abc123`, out => out.includes('wkr_abc123'));
  test('workers create', `${NTN} workers create --name smoke-test-worker`, out => out.includes('Created'));
  test('workers new', `${NTN} workers new /tmp/test-proj --no-git --no-install`, out => out.includes('Scaffolded'));
  test('workers deploy', `${NTN} workers deploy --name smoke-deploy`, out => out.includes('Deployed'));

  // === Workers exec ===
  console.log('\n\x1b[1mWorkers Exec\x1b[0m');
  test('workers exec', `${NTN} workers exec sayHello -d '{"name":"World"}' --worker-id wkr_abc123`, out => out.includes('Hello'));

  // === Capabilities ===
  console.log('\n\x1b[1mCapabilities\x1b[0m');
  test('capabilities list', `${NTN} workers capabilities list --worker-id wkr_abc123`, out => out.includes('sayHello'));

  // === TUI ===
  console.log('\n\x1b[1mTUI\x1b[0m');
  test('workers tui', `${NTN} workers tui`, out => out.includes('mock') || out.includes('admin'));

  // === Sync ===
  console.log('\n\x1b[1mSync\x1b[0m');
  test('sync status', `${NTN} workers sync status --worker-id wkr_abc123`, out => out.length > 0);
  test('sync trigger', `${NTN} workers sync trigger importUsers --worker-id wkr_abc123`, out => out.includes('Triggered'));
  test('sync pause', `${NTN} workers sync pause importUsers --worker-id wkr_abc123`, out => out.includes('Paused'));
  test('sync resume', `${NTN} workers sync resume importUsers --worker-id wkr_abc123`, out => out.includes('Resumed'));
  test('sync state get', `${NTN} workers sync state get importUsers --worker-id wkr_abc123`, out => out.length > 0);
  test('sync state reset', `${NTN} workers sync state reset importUsers --worker-id wkr_abc123`, out => out.includes('Reset') || out.includes('reset'));

  // === Env ===
  console.log('\n\x1b[1mEnvironment Variables\x1b[0m');
  test('env set', `${NTN} workers env set SMOKE_KEY=smoke_val --worker-id wkr_abc123`, out => out.includes('Set'));
  test('env list', `${NTN} workers env list --worker-id wkr_abc123`, out => out.includes('SMOKE_KEY'));
  test('env pull', `${NTN} workers env pull --no-file --worker-id wkr_abc123`, out => out.includes('SMOKE_KEY'));
  test('env unset', `${NTN} workers env unset SMOKE_KEY --worker-id wkr_abc123`, out => out.includes('Removed'));

  // === OAuth ===
  console.log('\n\x1b[1mOAuth\x1b[0m');
  test('oauth start', `${NTN} workers oauth start githubSync --worker-id wkr_abc123`, out => out.includes('http'));
  test('oauth token', `${NTN} workers oauth token githubSync --worker-id wkr_abc123`, out => out.includes('gho_'));
  test('oauth redirect-url', `${NTN} workers oauth show-redirect-url --worker-id wkr_abc123`, out => out.includes('notion.so'));

  // === Runs ===
  console.log('\n\x1b[1mRuns\x1b[0m');
  test('runs list', `${NTN} workers runs list --worker-id wkr_abc123`, out => out.includes('run_'));
  test('runs logs', `${NTN} workers runs logs run_001 --worker-id wkr_abc123`, out => out.includes('Executing'));

  // === Webhooks ===
  console.log('\n\x1b[1mWebhooks\x1b[0m');
  test('webhooks list', `${NTN} workers webhooks list --worker-id wkr_abc123`, out => out.includes('notion.so'));

  // === API ===
  console.log('\n\x1b[1mAPI\x1b[0m');
  test('api ls', `${NTN} api ls`, out => out.includes('v1/pages'));
  test('api request', `${NTN} api v1/users/me --json`, out => {
    const data = JSON.parse(out);
    return data.id || data.object;
  });

  // === Datasources ===
  console.log('\n\x1b[1mDatasources\x1b[0m');
  test('datasources query', `${NTN} datasources query ds_001 --limit 5`, out => out.length > 0);
  test('datasources resolve', `${NTN} datasources resolve db_001`, out => out.includes('ds_001'));

  // === Pages ===
  console.log('\n\x1b[1mPages\x1b[0m');
  test('pages get', `${NTN} pages get page_001`, out => out.includes('Getting Started'));
  test('pages create', `${NTN} pages create --parent page:page_001 --content "# Smoke Test Page"`, out => out.includes('Created'));
  test('pages update', `${NTN} pages update page_001 --content "# Updated Getting Started"`, out => out.includes('Updated'));
  test('pages trash', `${NTN} pages trash page_001 --yes`, out => out.includes('trash'));

  // === Files ===
  console.log('\n\x1b[1mFiles\x1b[0m');
  test('files list', `${NTN} files list`, out => out.includes('architecture-diagram'));
  test('files get', `${NTN} files get file_001`, out => out.includes('uploaded'));
  test('files create', `${NTN} files create`, out => out.includes('upload'));

  // === Utility ===
  console.log('\n\x1b[1mUtility\x1b[0m');
  test('doctor', `${NTN} doctor`, out => out.includes('✓'));
  test('update', `${NTN} update`, out => out.includes('up to date'));
  test('update --force', `${NTN} update --force`, out => out.includes('Reinstalled'));
  test('--version', `${NTN} --version`, out => out.includes('0.18.0'));

  // === State Reset ===
  console.log('\n\x1b[1mState Management\x1b[0m');
  test('POST /api/state/reset', `curl -sf -X POST ${BASE_URL}/api/state/reset -H "Content-Type: application/json" -d '{}'`, out => out.includes('reset'));

  // === Web UI ===
  console.log('\n\x1b[1mWeb UI\x1b[0m');
  test('Docs page loads', `curl -sf ${BASE_URL}/`, out => out.includes('html'));
  test('Admin page loads', `curl -sf ${BASE_URL}/admin.html`, out => out.includes('html'));

  // === Summary ===
  console.log(`\n\x1b[1mResults: ${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main();
