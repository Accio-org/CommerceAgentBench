// Error messages — verbatim from real ntn 0.15.0 (closed-source Rust binary).
// Captured via `ntn <bad-input>` on 2026-06-01. Since ntn is closed-source,
// source-file citations are unavailable; all strings are captured from actual
// CLI stderr output.

// ntn boguscmd → stderr, exit 2
export function unrecognizedSubcommand(cmd) {
  return `error: unrecognized subcommand '${cmd}'`;
}

// ntn api v1/users/me (no login) → stderr, exit 4
export const NO_WORKSPACE = `error: No workspace selected.\n  hint: Run \`ntn login\` first, or set NOTION_WORKSPACE_ID.`;

// ntn api --data '{invalid' → stderr
export const INVALID_JSON_DATA = 'Invalid JSON for --data';

// ntn api --file /nonexistent → stderr
export function fileNotFound(path) {
  return `Could not read file: ${path}`;
}

// ntn files create (no stdin, no --external-url) → stderr
export const FILES_CREATE_HINT = 'Pipe file bytes to stdin or use --external-url';

// ntn workers deploy (no worker-id, no --name, multiple workers) → stderr
export const NO_WORKER_ID = 'No worker-id specified. Use --worker-id or --name flag.';

// ntn workers ... (no workers found) → stderr
export const NO_WORKERS_FOUND = 'No workers found';

// ntn workers ... (multiple workers, ambiguous) → stderr
export const MULTIPLE_WORKERS = 'Multiple workers found. Use --worker-id to specify.';

// ntn workers get <bad-id> → stderr
export const WORKER_ID_REQUIRED = 'Worker ID required';

// Exit codes (observed from real ntn 0.15.0)
export const EXIT = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,      // bad flags, unrecognized subcommand
  AUTH: 4,        // no workspace selected / not authenticated
};
