// `todoist delete <id> [<id>...]` (alias: d) — soft-delete tasks
// Source: delete.go
//
// Upstream flow (delete.go:9-30):
//   - resolve each arg via CompleteItemIDByPrefix (never errors)
//   - if zero ids -> CommandFailed
//   - DeleteItem(ids) in one batch; if it errors -> CommandFailed
// delete.go has NO local "specified id not found" check and never returns
// IdNotFound. The only error it can emit is "command failed". Offline the mock
// has no remote, so it treats a locally-unknown id as the batch-failed case and
// returns `command failed` (best-effort; whether the live Sync API rejects an
// unknown id or silently no-ops is not verifiable offline — see fact sheet).

import { nowISO, auditLog } from '../db.js';
import { COMMAND_FAILED } from '../errors.js';
import { completeItemIDByPrefix } from './_helpers.js';

export function cmdDelete(db, positional) {
  const itemIds = positional.map((arg) => completeItemIDByPrefix(db, arg));

  if (itemIds.length === 0) {
    return { error: COMMAND_FAILED };
  }

  // Validate the whole batch before mutating (mirrors DeleteItem failing the
  // batch). Any unresolved/unknown id -> command failed, nothing deleted.
  for (const itemId of itemIds) {
    const item = db.prepare('SELECT id FROM items WHERE id = ? AND is_deleted = 0').get(itemId);
    if (!item) {
      return { error: COMMAND_FAILED };
    }
  }

  const now = nowISO();
  for (const itemId of itemIds) {
    db.prepare('UPDATE items SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, itemId);
    auditLog(db, 'delete', 'item', itemId, {});
  }

  return { ok: true };
}
