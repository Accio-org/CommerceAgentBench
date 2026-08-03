#!/usr/bin/env bun
// gen_golden.mjs — INDEPENDENT golden-output oracle generator for the Box CLI mock.
//
//   Run:  bun golden/gen_golden.mjs
//   (from the box_cli mock root, OR any cwd — paths are resolved from import.meta.url)
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS AN *INDEPENDENT* ORACLE (read before editing)
// ─────────────────────────────────────────────────────────────────────────────
// The Box CLI's human-readable ("text") output is, per upstream box/boxcli
// @ 820cb9f (v4.8.2) src/box-command.js:262-276, literally:
//
//     yaml.dump(formatObjectKeys(obj), { indent: 4, noRefs: true })
//
// with cyan keys (TTY only) and `----- <Type> <id> -----` collection separators.
// The text format previously DRIFTED because the mock hand-rolled YAML. The
// remediation switched the mock to the REAL `js-yaml` library (vendored at
// ../node_modules/js-yaml, version 4.1.1, matching upstream's ^4.1.1).
//
// This generator is the authority that proves the mock's renderer stayed honest.
// For independence it:
//   1. imports the REAL `js-yaml` library directly (resolves to ../node_modules/
//      js-yaml — the same real lib upstream uses) and calls `yaml.dump` itself;
//   2. RE-PORTS the upstream key transform (formatKey / formatObjectKeys /
//      KEY_MAPPINGS) here, copied verbatim from box-command.js — it does NOT
//      import the mock's lib/output/text.js;
//   3. builds the representative plain objects from values read straight out of
//      seeds/default.sql (every field is annotated with its seed line below).
//
// Consequence: the golden derives ONLY from (a) the real js-yaml lib and (b) the
// documented upstream transform — NEVER from the mock's own renderer. If anyone
// regresses lib/output/text.js (reverts to hand-rolled YAML, changes the indent,
// breaks the camelCase→snake→Title key mapping, mishandles null/[]/nested
// collections, drops the trailing-newline contract, …), `smoke_test.sh`'s Golden
// section diffs the live mock against these files and fails. The golden is the
// reference; the mock must match it byte-for-byte — not the other way around.
// ─────────────────────────────────────────────────────────────────────────────

import yaml from 'js-yaml';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GOLDEN_DIR = dirname(fileURLToPath(import.meta.url));

// ═════════════════════════════════════════════════════════════════════════════
// 1. UPSTREAM TRANSFORM — ported verbatim from box/boxcli src/box-command.js.
//    (Independent re-implementation; NOT imported from the mock's text.js.)
// ═════════════════════════════════════════════════════════════════════════════

// box-command.js:47-73 — verbatim.
const KEY_MAPPINGS = {
  url: 'URL',
  id: 'ID',
  etag: 'ETag',
  sha1: 'SHA1',
  templateKey: 'Template Key',
  displayName: 'Display Name',
  tos: 'ToS',
  statusCode: 'Status Code',
  boxReportsFolderPath: 'Box Reports Folder Path',
  boxReportsFolderName: 'Box Reports Folder Name (Deprecated)',
  boxReportsFileFormat: 'Box Reports File Format',
  boxDownloadsFolderPath: 'Box Downloads Folder Path',
  boxDownloadsFolderName: 'Box Downloads Folder Name (Deprecated)',
  outputJson: 'Output JSON',
  clientId: 'Client ID',
  enterpriseId: 'Enterprise ID',
  boxConfigFilePath: 'Box Config File Path',
  hasInLinePrivateKey: 'Has Inline Private Key',
  privateKeyPath: 'Private Key Path',
  defaultAsUserId: 'Default As-User ID',
  useDefaultAsUser: 'Use Default As-User',
  cacheTokens: 'Cache Tokens',
  ip: 'IP',
  operationParams: 'Operation Params',
  copyInstanceOnItemCopy: 'Copy Instance On Item Copy',
};

// lodash _.capitalize (used by box-command.js formatKey): upper-case the first
// character and lower-case the remainder of the string.
function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// box-command.js:210-217 — camelCase → snake_case → Title-Case (with KEY_MAPPINGS).
function formatKey(key) {
  return key
    .replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)
    .split('_')
    .map((s) => KEY_MAPPINGS[s] || capitalize(s))
    .join(' ');
}

// box-command.js:225-251 — recursively rewrite an object's keys for display.
function formatObjectKeys(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (obj.$type) return obj; // don't mangle metadata object keys
  if (Array.isArray(obj)) return obj.map((el) => formatObjectKeys(el));

  const formattedObj = Object.create(null);
  for (const key of Object.keys(obj)) {
    formattedObj[formatKey(key)] = formatObjectKeys(obj[key]);
  }
  return formattedObj;
}

// box-command.js:262-276 — the TEXT renderer, minus color.
//   Upstream applies chalk.cyan to keys, but chalk (like the mock) auto-disables
//   color on non-TTY output, so piped/captured output — and therefore the golden
//   — is plain. The mock strips js-yaml's trailing newline and oclif re-adds one
//   on write, so the net stdout equals `yaml.dump(...)` verbatim (single trailing
//   '\n'). We write that verbatim to the golden file.
function renderTextGolden(rawObj) {
  return yaml.dump(formatObjectKeys(rawObj), { indent: 4, noRefs: true });
}

// JSON renderer: box-command.js JSON path == JSON.stringify(rawObj, null, 4) on
// the RAW (snake_case) object — keys are NOT transformed for --json. The mock
// (bin/box) appends '\n' on write, so the golden ends in a single newline too.
function renderJsonGolden(rawObj) {
  return `${JSON.stringify(rawObj, null, 4)}\n`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. REPRESENTATIVE ENTITIES — plain objects built from seeds/default.sql.
//    Field order mirrors the documented Box object contract (users.js userToObj,
//    files.js fileToObj, folders.js folderToObj); every value is traced to its
//    seed row below. These are the inputs to the REAL js-yaml above; the mock,
//    fed the same seed via `bin/box`, must serialize them identically.
// ═════════════════════════════════════════════════════════════════════════════

// Nested user "mini-objects" as embedded by created_by / modified_by / owned_by
// (files.js:17-21 / folders.js:7-11 getUserObj → {type,id,name,login}).
// Values: seeds/default.sql users table (lines 10-12).
const USER_10001_MINI = { type: 'user', id: '10001', name: 'Admin User', login: 'admin@boxmock.example.com' };
const USER_10002_MINI = { type: 'user', id: '10002', name: 'Alice Chen', login: 'alice@boxmock.example.com' };

// Nested folder "mini-objects" as embedded by parent / path_collection entries
// ({type:'folder',id,name}). Values: seeds/default.sql folders table (lines 16-17).
const FOLDER_0_MINI = { type: 'folder', id: '0', name: 'All Files' };
const FOLDER_20001_MINI = { type: 'folder', id: '20001', name: 'Project Alpha' };

const ENTITIES = [
  // ── FILE: `box files:get 30001` ──────────────────────────────────────────
  // Source row: seeds/default.sql line 23 (Q2-Budget-Report.xlsx).
  // Shape: files.js fileToObj (lines 54-74). Derived fields:
  //   parent          ← folder 20001 (file's parent_id), seed line 17.
  //   created_by /     ← user 10002 (created_by/owned_by), seed line 11.
  //     modified_by /        modified_by == created_by (fileToObj line 68).
  //     owned_by
  //   path_collection ← ancestor chain of parent_id 20001: [root 0, 20001].
  //   shared_link     ← null (no shared_links row seeded for file 30001).
  //   tags            ← [] (no tags_json; defaults to '[]').
  {
    name: 'file-30001',
    obj: {
      type: 'file',
      id: '30001',
      name: 'Q2-Budget-Report.xlsx',
      description: 'Quarterly budget report',
      size: 245760,
      sha1: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      etag: '1',
      parent: FOLDER_20001_MINI,
      created_at: '2026-04-10T09:30:00Z',
      modified_at: '2026-05-20T14:00:00Z',
      content_created_at: '2026-04-10T09:30:00Z',
      content_modified_at: '2026-05-20T14:00:00Z',
      created_by: USER_10002_MINI,
      modified_by: USER_10002_MINI,
      owned_by: USER_10002_MINI,
      item_status: 'active',
      path_collection: {
        total_count: 2,
        entries: [FOLDER_0_MINI, FOLDER_20001_MINI],
      },
      shared_link: null,
      tags: [],
    },
  },

  // ── FOLDER: `box folders:get 20001` ──────────────────────────────────────
  // Source row: seeds/default.sql line 17 (Project Alpha).
  // Shape: folders.js folderToObj (lines 62-78). Derived fields:
  //   parent          ← root folder 0 (folder's parent_id), seed line 16.
  //   created_by /     ← user 10001 (created_by/owned_by), seed line 10.
  //     owned_by
  //   path_collection ← ancestor chain ABOVE 20001: [root 0].
  //   item_collection ← child files of 20001 (no subfolders), ORDER BY name:
  //                       30005 Meeting-Notes-May.txt, 30002 Product-Roadmap.pdf,
  //                       30001 Q2-Budget-Report.xlsx (seed lines 23,24,27).
  //   tags            ← [].
  {
    name: 'folder-20001',
    obj: {
      type: 'folder',
      id: '20001',
      name: 'Project Alpha',
      description: 'Main project workspace',
      size: 0,
      etag: '1',
      parent: FOLDER_0_MINI,
      created_at: '2026-03-01T09:00:00Z',
      modified_at: '2026-05-18T16:30:00Z',
      created_by: USER_10001_MINI,
      owned_by: USER_10001_MINI,
      item_status: 'active',
      path_collection: {
        total_count: 1,
        entries: [FOLDER_0_MINI],
      },
      item_collection: {
        total_count: 3,
        entries: [
          { type: 'file', id: '30005', name: 'Meeting-Notes-May.txt' },
          { type: 'file', id: '30002', name: 'Product-Roadmap.pdf' },
          { type: 'file', id: '30001', name: 'Q2-Budget-Report.xlsx' },
        ],
      },
      tags: [],
    },
  },

  // ── USER: `box users:get` (defaults to "me") ─────────────────────────────
  // "me" == first user by rowid == Admin User (users.js get → ORDER BY rowid
  // LIMIT 1). Source row: seeds/default.sql line 10.
  // Shape: users.js userToObj (lines 6-19).
  {
    name: 'user-10001',
    obj: {
      type: 'user',
      id: '10001',
      name: 'Admin User',
      login: 'admin@boxmock.example.com',
      created_at: '2026-01-10T08:00:00Z',
      modified_at: '2026-01-10T08:00:00Z',
      status: 'active',
      space_amount: 10737418240,
      space_used: 524288000,
      job_title: 'Administrator',
    },
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// 3. EMIT
// ═════════════════════════════════════════════════════════════════════════════

for (const { name, obj } of ENTITIES) {
  const textPath = join(GOLDEN_DIR, `${name}.text`);
  const jsonPath = join(GOLDEN_DIR, `${name}.json`);
  writeFileSync(textPath, renderTextGolden(obj));
  writeFileSync(jsonPath, renderJsonGolden(obj));
  console.log(`wrote ${name}.text + ${name}.json`);
}
console.log(`\nGolden written to ${GOLDEN_DIR}`);
console.log('text = real js-yaml dump(formatObjectKeys(obj),{indent:4,noRefs:true}); json = JSON.stringify(obj,null,4)+"\\n"');
