// Error/diagnostic strings for the Box CLI mock.
//
// Source of truth: github.com/box/boxcli clone @ 820cb9f (v4.8.2).
// Every string below is either copied verbatim from that clone (with a
// file:line citation) or — for errors that originate in the Box REST API
// and are surfaced through the SDK — rendered with the SAME template the
// CLI uses to print API errors (src/box-command.js:1692). See apiError().

import { randomBytes } from 'node:crypto';

// ───────────────────────── Verbatim from the clone ─────────────────────────

// src/box-command.js:899 and :1087 (identical text in both getClient paths;
// the runtime strips per-line leading whitespace via .replaceAll(/^\s+/gmu, '')).
export const NO_DEFAULT_ENV =
  'No default environment found.\n' +
  "It looks like you haven't configured the Box CLI yet.\n" +
  'See this command for help adding an environment: box configure:environments:add --help\n' +
  'Or, supply a token with your command with --token.';

// src/box-command.js:1684-1685 (AUTH_FAILED_HINT, appended to the message on HTTP 401).
export const AUTH_FAILED =
  'Authentication failed: token is invalid or expired. OAuth: run "box login --reauthorize". ' +
  'JWT/CCG: tokens are refreshed automatically, so a 401 usually means app credentials or ' +
  'environment configuration must be fixed. You can also provide a fresh token with --token.';

// src/commands/files/upload.js:20-21
export function fileNotFound(path) {
  return `File not found: ${path}. Please check the file path and try again.`;
}

// src/commands/files/upload.js:60-63
export const ALREADY_EXISTS =
  'A file with the same name already exists in the destination folder. Use --overwrite to replace it with a new version.';

// src/commands/folders/delete.js:11-13
export const CANNOT_DELETE_ROOT =
  "Cannot delete folder '0': this is the root (All Files) folder and cannot be deleted.";

// src/modules/collaboration.js:63 — thrown (plain Error) when no role flag is given.
export const COLLAB_ROLE_REQUIRED = 'Missing required flag for collaboration role';

// src/commands/files/download.js:39 — interactive overwrite confirm prompt.
export function downloadOverwritePrompt(filePath) {
  return `File ${filePath} already exists. Overwrite? (Use --overwrite or -y to skip this prompt.)`;
}

// src/commands/files/download.js:32-34 — printed when --no-overwrite is set.
export function downloadNoOverwrite(filePath) {
  return `Downloading the file will not occur because the file ${filePath} already exists, and the --no-overwrite flag is set.`;
}

// ──────────────────── Box REST API errors (via the SDK) ─────────────────────
//
// The CLI renders API errors through src/box-command.js:1692:
//   `Unexpected API Response [${body.status} ${body.message} | ${body.request_id}] ${body.code} - ${body.message}`
//
// FLAG (cannot be byte-reproduced offline):
//   * The file/folder/collaboration/trash/etc. commands use the LEGACY
//     box-node-sdk (this.client), whose package is NOT vendored in the clone,
//     so its exact error-object wording can't be verified here. We render the
//     documented CLI template above (box-command.js:1692) as the closest
//     in-clone reference.
//   * request_id is generated server-side and varies on every call.
//   * code `item_name_in_use` IS confirmed in the clone (files/upload.js:53,58);
//     codes `not_found` / `folder_not_empty` and the human `message` strings are
//     standard Box API values, NOT present in the clone.

function requestId() {
  return randomBytes(12).toString('hex');
}

function apiError({ status, statusText, code, message }) {
  return `Unexpected API Response [${status} ${statusText} | ${requestId()}] ${code} - ${message}`;
}

// 404 on a missing item (files:get/delete/..., folders:get/..., collaborations,
// tasks, comments, etc.). Type/id are intentionally not part of the SDK message.
export function notFound() {
  return apiError({ status: 404, statusText: 'Not Found', code: 'not_found', message: 'Not Found' });
}

// 409 when creating an item whose name already exists in the destination folder
// (folders:create). code `item_name_in_use` is verbatim in files/upload.js:53,58.
export function itemNameConflict() {
  return apiError({
    status: 409,
    statusText: 'Conflict',
    code: 'item_name_in_use',
    message: 'Item with the same name already exists',
  });
}

// 409 when deleting a non-empty folder without --recursive. Upstream does NO
// local check (src/commands/folders/delete.js forwards `recursive` to the API);
// the SDK surfaces this 409.
export function folderNotEmpty() {
  return apiError({
    status: 409,
    statusText: 'Conflict',
    code: 'folder_not_empty',
    message: 'Cannot delete - folder not empty',
  });
}

// Permanently deleting / fetching an item that is not in the trash returns 404
// from the API — there is no distinct "not in trash" / "already deleted" string
// upstream, so both collapse to the same SDK 404.
export const notInTrash = notFound;
export const alreadyDeleted = notFound;

// ─────────────────────── oclif argument/flag validation ─────────────────────
//
// oclif (@oclif/core 4.8.0) validates `options:` flags/args and required
// args/flags itself, before the command body runs, and exits with code 2.
// The exact wordings below were captured by running @oclif/core@4.8.0 against
// the same flag/arg shapes (see remediation report). The trailing
// "\nSee more help with --help" line is part of oclif's error message.
//
// KNOWN MINOR DIVERGENCE: oclif reports ALL missing required args at once
// ("Missing 2 required args:\n...\n...") when several are absent. This mock's
// hand-rolled parser validates args sequentially, so running a multi-arg
// command with NO args reports just the first missing arg ("Missing 1 required
// arg:"). The realistic single-missing case (one arg provided, one omitted) is
// byte-identical.

const SEE_MORE = 'See more help with --help';

// Flag with out-of-set value → oclif FlagInvalidOptionError.
export function invalidFlagValue(flag, value, allowed) {
  return `Expected --${flag}=${value} to be one of: ${allowed.join(', ')}\n${SEE_MORE}`;
}

// Positional arg with out-of-set value (itemType, trash type) → oclif ArgInvalidOptionError.
export function invalidArgValue(value, allowed) {
  return `Expected ${value} to be one of: ${allowed.join(', ')}\n${SEE_MORE}`;
}

// One or more missing required positional args → oclif RequiredArgsError.
// `args` is an array of { name, description, options? }. oclif aligns the names
// in a column (padded to the longest name + 2 spaces) and prefixes option args
// with "(a|b|c) ".
export function missingArgs(args) {
  const n = args.length;
  const maxLen = Math.max(...args.map((a) => a.name.length));
  const lines = args.map((a) => {
    const optPrefix = a.options ? `(${a.options.join('|')}) ` : '';
    return `${a.name.padEnd(maxLen)}  ${optPrefix}${a.description}`;
  });
  return `Missing ${n} required arg${n === 1 ? '' : 's'}:\n${lines.join('\n')}\n${SEE_MORE}`;
}

// Convenience wrapper for a single missing arg.
export function missingArg(name, description = '', options = undefined) {
  return missingArgs([{ name, description, options }]);
}

// Missing required flag → oclif FailedFlagValidationError (single failure form).
export function missingFlag(name) {
  return `The following error occurred:\n  Missing required flag ${name}\n${SEE_MORE}`;
}
