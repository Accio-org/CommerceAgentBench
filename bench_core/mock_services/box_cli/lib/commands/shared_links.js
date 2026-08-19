// box shared-links:* — shared link create/delete
// Source: src/commands/shared-links/*.js

import { generateId, now, auditLog } from '../db.js';
import { notFound, invalidArgValue, missingArg } from '../errors.js';

function getItemObj(db, itemType, itemId) {
  if (itemType === 'folder') {
    const row = db.prepare('SELECT id, name FROM folders WHERE id = ? AND is_deleted = 0').get(itemId);
    if (!row) return null;
    return { type: 'folder', id: row.id, name: row.name };
  }
  const row = db.prepare('SELECT id, name FROM files WHERE id = ? AND is_deleted = 0').get(itemId);
  if (!row) return null;
  return { type: 'file', id: row.id, name: row.name };
}

export function create(db, args, flags, userId) {
  const itemId = args[0];
  const itemType = args[1];
  if (!itemId) return { error: missingArg('itemID', 'ID of the Box item to share') };
  if (!itemType) return { error: missingArg('itemType', 'Type of item for shared link: either file or folder', ['file', 'folder']) };
  if (!['file', 'folder'].includes(itemType)) return { error: invalidArgValue(itemType, ['file', 'folder']) };

  // Upstream does NOT declare oclif options for --access (src/commands/shared-links/create.js:26):
  // the CLI forwards the value and the API validates it. Default access is 'open'.
  const access = flags.access || 'open';

  // Verify item exists
  const item = getItemObj(db, itemType, itemId);
  if (!item) return { error: notFound(itemType, itemId) };

  // Check if shared link already exists
  const existing = db.prepare(
    'SELECT id FROM shared_links WHERE item_type = ? AND item_id = ? AND is_deleted = 0'
  ).get(itemType, itemId);

  if (existing) {
    // Update existing
    const sets = ['access = ?'];
    const params = [access];
    if (flags.password !== undefined) {
      sets.push('password = ?');
      params.push(flags.password);
    }
    if (flags['unshared-at'] !== undefined) {
      sets.push('unshared_at = ?');
      params.push(flags['unshared-at']);
    }
    params.push(existing.id);
    db.prepare(`UPDATE shared_links SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    auditLog(db, 'update_shared_link', itemType, itemId, { access });

    const row = db.prepare('SELECT * FROM shared_links WHERE id = ?').get(existing.id);
    return buildSharedLinkResponse(db, row, item);
  }

  const id = generateId();
  const ts = now();
  const url = `https://boxmock.box.com/s/${id}`;

  db.prepare(
    `INSERT INTO shared_links (id, item_type, item_id, url, access, password, unshared_at, created_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(id, itemType, itemId, url, access, flags.password || null, flags['unshared-at'] || null, ts);
  auditLog(db, 'create_shared_link', itemType, itemId, { access, url });

  const row = db.prepare('SELECT * FROM shared_links WHERE id = ?').get(id);
  return buildSharedLinkResponse(db, row, item);
}

function buildSharedLinkResponse(db, row, item) {
  return {
    type: item.type,
    id: item.id,
    name: item.name,
    shared_link: {
      url: row.url,
      access: row.access,
      password: row.password,
      unshared_at: row.unshared_at,
    },
  };
}

export function del(db, args, flags, userId) {
  const itemId = args[0];
  const itemType = args[1];
  if (!itemId) return { error: missingArg('itemID', 'ID of the Box item to remove the shared link from') };
  if (!itemType) return { error: missingArg('itemType', 'Type of item for shared link: either file or folder', ['file', 'folder']) };
  if (!['file', 'folder'].includes(itemType)) return { error: invalidArgValue(itemType, ['file', 'folder']) };

  // Upstream removes the shared link via the API and prints the item name; a
  // missing item surfaces the SDK 404. Removing a non-existent link is a no-op
  // success (src/commands/shared-links/delete.js).
  const item = getItemObj(db, itemType, itemId);
  if (!item) return { error: notFound(itemType, itemId) };

  db.prepare(
    'UPDATE shared_links SET is_deleted = 1 WHERE item_type = ? AND item_id = ? AND is_deleted = 0'
  ).run(itemType, itemId);
  auditLog(db, 'delete_shared_link', itemType, itemId, {});

  // Upstream: src/commands/shared-links/delete.js:14-16 — stderr via this.info().
  return { _info: `Removed shared link from ${itemType} "${item.name}"` };
}
