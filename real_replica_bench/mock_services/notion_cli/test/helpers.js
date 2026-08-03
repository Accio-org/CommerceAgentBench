import { createApp } from '../lib/server/index.js';
import { StateStore } from '../lib/state/store.js';
import { createProgram } from '../lib/cli/index.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let serverInstance = null;
let store = null;
let baseUrl = '';
let port = 0;

export async function setupServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntn-mock-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  process.env.MOCK_VERIFIER_TOKEN = 'test-token';

  store = new StateStore(dbPath);
  store.load();

  const app = createApp(store);
  return new Promise((resolve) => {
    serverInstance = app.listen(0, () => {
      port = serverInstance.address().port;
      baseUrl = `http://localhost:${port}`;
      process.env.NTN_MOCK_PORT = String(port);
      process.env.NTN_MOCK_NO_AUTO_SERVER = '1';
      resolve({ store, baseUrl, port, tmpDir });
    });
  });
}

export async function teardownServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

export function getBaseUrl() {
  return baseUrl;
}

export function getStore() {
  return store;
}

export async function api(method, urlPath, body) {
  const url = new URL(urlPath, baseUrl).toString();
  const headers = { 'Content-Type': 'application/json' };
  if (urlPath.startsWith('/api/state')) {
    headers['Authorization'] = `Bearer ${process.env.MOCK_VERIFIER_TOKEN || 'test-token'}`;
  }
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

export async function cli(args) {
  const argv = ['node', 'ntn-mock', ...parseArgs(args)];
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => { stdout += str; },
    writeErr: (str) => { stdout += str; },
  });

  let stdout = '';
  let exitCode = 0;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  console.log = (...a) => { stdout += a.join(' ') + '\n'; };
  console.error = (...a) => { stdout += a.join(' ') + '\n'; };
  process.exit = (code) => { exitCode = code || 0; throw new ExitSignal(code); };

  try {
    await program.parseAsync(argv);
    return { stdout, exitCode: 0 };
  } catch (err) {
    if (err instanceof ExitSignal) {
      return { stdout, exitCode: err.code };
    }
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      return { stdout: stdout || err.message || '', exitCode: 0 };
    }
    return { stdout, exitCode: err.exitCode || 1 };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }
}

class ExitSignal extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code || 0;
  }
}

function parseArgs(str) {
  const args = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (const ch of str) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) { args.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}
