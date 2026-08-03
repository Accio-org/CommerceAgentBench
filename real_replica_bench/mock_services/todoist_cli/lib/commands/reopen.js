// `todoist reopen <id> [<id>...]` — reopen (uncomplete) closed tasks
// Source: reopen.go

import { nowISO, auditLog } from '../db.js';
import { REOPEN_NO_IDS, reopenFailed, REOPEN_API_ERROR } from '../errors.js';

export function cmdReopen(db, positional) {
  // reopen.go:13-21 — upstream loops over the args calling client.ReopenItem
  // (a live REST POST) FIRST, then returns the no-IDs error only when the loop
  // body never ran (Args().Len()==0). With no args the loop is empty, so the
  // observable result is the same: the no-IDs message, exit 1.
  if (positional.length === 0) {
    return { error: REOPEN_NO_IDS };
  }

  const now = nowISO();

  for (const itemId of positional) {
    // Upstream reopen does NOT consult the local cache — it always hits the
    // API. The mock has no remote, so it approximates by treating an id that
    // is not a known local item as the API's "not found" failure. The wrapper
    // text is verbatim (reopen.go:14); the inner text is best-effort (the real
    // inner error is a live ParseAPIError HTTP response, not knowable offline).
    const item = db.prepare('SELECT id, is_completed FROM items WHERE id = ? AND is_deleted = 0').get(itemId);
    if (!item) {
      return { error: reopenFailed(itemId, REOPEN_API_ERROR) };
    }

    db.prepare("UPDATE items SET is_completed = 0, completed_at = '', updated_at = ? WHERE id = ?")
      .run(now, itemId);

    auditLog(db, 'reopen', 'item', itemId, {});
  }

  // reopen.go: does NOT call Sync(c) — no sync after reopen
  return { ok: true };
}
