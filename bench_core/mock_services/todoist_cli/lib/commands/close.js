// `todoist close <id> [<id>...]` (alias: c) — mark tasks as completed
// Source: close.go
//
// Upstream close.go:9-26 takes the raw args (no prefix resolution), returns
// CommandFailed only when zero ids are given, then calls CloseItem(ids) and
// returns its RAW error on failure (an ExecCommands error such as
// "command item_close failed: <status>"). It has no local existence check and
// never returns IdNotFound. Offline the mock cannot reproduce the live sync
// status, so for a missing id it falls back to a local "specified id not found"
// approximation (best-effort; see fact sheet). Close is graded by DB state via
// the bench, not by byte-diffing this error path.

import { nowISO, auditLog } from '../db.js';
import { COMMAND_FAILED, ID_NOT_FOUND } from '../errors.js';

export function cmdClose(db, positional) {
  if (positional.length === 0) {
    return { error: COMMAND_FAILED };
  }

  const now = nowISO();

  for (const itemId of positional) {
    const item = db.prepare('SELECT id FROM items WHERE id = ? AND is_deleted = 0').get(itemId);
    if (!item) {
      return { error: ID_NOT_FOUND };
    }

    db.prepare('UPDATE items SET is_completed = 1, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, itemId);

    auditLog(db, 'close', 'item', itemId, {});
  }

  return { ok: true };
}
