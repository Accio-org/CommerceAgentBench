// Human-readable (YAML) text output for the Box CLI mock.
//
// Byte-for-byte port of src/box-command.js's formatObject/formatObjectKeys/
// formatKey/formatObjectHeader (github.com/box/boxcli @ 820cb9f, v4.8.2):
//   * renders with the real `js-yaml` (vendored, ^4.1.1) using the upstream
//     dump params { indent: 4, noRefs: true } (box-command.js:266-269);
//   * colorizes keys cyan and the collection header dim, matching chalk's ANSI
//     codes — but ONLY when color is enabled. Upstream uses chalk, which (like
//     this mock) auto-disables color on non-TTY output, so piped/captured
//     output is plain and identical to the real CLI.

import yaml from 'js-yaml';

// chalk ANSI codes (chalk@^2.4.1 in upstream): cyan = 36/39, dim = 2/22.
const CYAN_OPEN = '\x1b[36m';
const CYAN_CLOSE = '\x1b[39m';
const DIM_OPEN = '\x1b[2m';
const DIM_CLOSE = '\x1b[22m';

// Verbatim from src/box-command.js:47-73.
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

// lodash _.capitalize: upper-case first char, lower-case the rest.
function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// box-command.js:210-217
export function formatKey(key) {
  return key
    .replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)
    .split('_')
    .map((s) => KEY_MAPPINGS[s] || capitalize(s))
    .join(' ');
}

// box-command.js:225-251
export function formatObjectKeys(obj) {
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

// box-command.js:262-276
export function formatObject(obj, useColor = true) {
  const outputData = formatObjectKeys(obj);
  const yamlString = yaml.dump(outputData, {
    indent: 4,
    noRefs: true,
  });
  // js-yaml adds a trailing newline; oclif adds its own on write, so strip it.
  const trimmed = yamlString.replace(/\r?\n$/u, '');
  if (!useColor) return trimmed;
  return trimmed.replaceAll(/^([^:]+:)/gmu, (match, key) => `${CYAN_OPEN}${key}${CYAN_CLOSE}`);
}

// box-command.js:285-290
export function formatObjectHeader(obj, useColor = true) {
  const hdr = !obj.type || !obj.id ? '----------' : `----- ${formatKey(obj.type)} ${obj.id} -----`;
  return useColor ? `${DIM_OPEN}${hdr}${DIM_CLOSE}` : hdr;
}

// box-command.js:1482-1486 — collection rendering: each item is
// "<header>\n<object>", joined by a blank line.
export function formatCollection(items, useColor = true) {
  return items
    .map((o) => `${formatObjectHeader(o, useColor)}\n${formatObject(o, useColor)}`)
    .join('\n\n');
}
