#!/usr/bin/env node
'use strict';

const fs = require('fs');
const db = require('../lib/db');
const { writeSync: __ccbWriteSyncFd } = require("fs");
// Flush-safe stdout: process.exit() discards un-flushed async pipe writes
// (verifier state JSON >64KB was truncated through the daemon). writeSync
// to fd 1 is synchronous in both node and bun.
const __ccbOut = (s) => { try { __ccbWriteSyncFd(1, s); } catch (e) {} };

const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN || 'bench-verifier';

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`dws-bench — verifier control for DingTalk Doc CLI mock

Usage:
  dws-bench <command> [flags]

Commands:
  health              Liveness check (no token required)
  state  --token <T>  Dump full verifier state
  seed   --token <T> --file <path>   Inject fixture data from JSON file
  reset  --token <T>  Reset to default fixtures
  audit  --token <T>  Return mutation audit log

Flags:
  --token string  Verifier token (env: MOCK_VERIFIER_TOKEN, default "bench-verifier")

This binary is for benchmark verifier use only. Do NOT place on agent PATH.`);
}

function parseFlags(a) {
  const flags = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--token' && a[i + 1]) {
      flags.token = a[++i];
    } else if (a[i] === '--file' && a[i + 1]) {
      flags.file = a[++i];
    }
  }
  return flags;
}

function requireToken(flags) {
  if (flags.token === VERIFIER_TOKEN || process.env.CCB_INTERNAL_BENCH_TOKEN === VERIFIER_TOKEN) return true;
  process.stderr.write('Error: invalid or missing verifier token\n');
  process.exit(1);
}

function sendJson(data) {
  __ccbOut(JSON.stringify(data, null, 2) + '\n');
}

function readStateSummary() {
  const mockUser = db.getMockUser();
  return {
    mockUser,
    defaultWorkspaceId: db.getDefaultWorkspaceId(),
    defaultFolderId: db.getDefaultFolderId(),
    counts: {
      documents: db.documentCount()
    },
    dbPath: db.DB_PATH
  };
}

if (!command || command === '--help' || command === '-h') {
  usage();
  process.exit(0);
}

const flags = parseFlags(args.slice(1));

switch (command) {
  case 'health': {
    sendJson({ status: 'ok', service: 'dws_doc_cli', command: 'dws', mockHome: db.MOCK_HOME });
    break;
  }

  case 'state': {
    requireToken(flags);
    sendJson({
      ok: true,
      service: 'dws_doc_cli',
      summary: readStateSummary(),
      ...db.dumpFullState()
    });
    break;
  }

  case 'seed': {
    requireToken(flags);
    if (!flags.file) {
      process.stderr.write('Error: --file is required for seed\n');
      process.exit(1);
    }
    if (!fs.existsSync(flags.file)) {
      process.stderr.write(`Error: file not found: ${flags.file}\n`);
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(flags.file, 'utf8'));
    db.injectData(data);
    sendJson({ ok: true, message: 'State seeded successfully.' });
    break;
  }

  case 'seed-sql': {
    requireToken(flags);
    if (!flags.file) {
      process.stderr.write('Error: --file is required for seed-sql\n');
      process.exit(1);
    }
    if (!fs.existsSync(flags.file)) {
      process.stderr.write(`Error: file not found: ${flags.file}\n`);
      process.exit(1);
    }
    const sql = fs.readFileSync(flags.file, 'utf8');
    db.getDb().exec(sql);
    sendJson({ ok: true, message: `SQL seed applied from ${flags.file}` });
    break;
  }

  case 'reset': {
    requireToken(flags);
    db.resetDb();
    sendJson({ ok: true, message: 'State reset to default fixtures.' });
    break;
  }

  case 'audit': {
    requireToken(flags);
    sendJson({ ok: true, audit: db.getAuditLog() });
    break;
  }

  default:
    process.stderr.write(`Unknown command: ${command}\nRun "dws-bench --help" for usage.\n`);
    process.exit(1);
}
