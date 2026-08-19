// box trash / trash:list / trash:delete / trash:restore — trash operations
// Source: src/commands/trash/*.js

import { now, auditLog } from '../db.js';
import { notFound, notInTrash, alreadyDeleted, missingArg, invalidArgValue } from '../errors.js';

// trash:delete / trash:get / trash:restore positional `type` is an oclif arg
// with options ['file','folder','web_link'] (src/commands/trash/{delete,get,restore}.js).
const TRASH_ITEM_TYPES = ['file', 'folder', 'web_link'];

export function list(db, args, flags, userId) {
  const maxItems = flags['max-items'] ? parseInt(flags['max-items'], 10) : 100;

  // Get trashed files
  const trashedFiles = db.prepare(
    'SELECT id, name, trashed_at FROM files WHERE trashed_at IS NOT NULL AND is_deleted = 0 ORDER BY trashed_at DESC'
  ).all();

  // Get trashed folders
  const trashedFolders = db.prepare(
    "SELECT id, name, trashed_at FROM folders WHERE trashed_at IS NOT NULL AND is_deleted = 0 AND id != '0' ORDER BY trashed_at DESC"
  ).all();

  const items = [
    ...trashedFiles.map((f) => ({
      type: 'file', id: f.id, name: f.name, trashed_at: f.trashed_at,
    })),
    ...trashedFolders.map((f) => ({
      type: 'folder', id: f.id, name: f.name, trashed_at: f.trashed_at,
    })),
  ];

  // Sort by trashed_at descending
  items.sort((a, b) => (b.trashed_at || '').localeCompare(a.trashed_at || ''));

  return items.slice(0, maxItems);
}

export function del(db, args, flags, userId) {
  const type = args[0];
  const id = args[1];
  if (!type) return { error: missingArg('type', 'Type of the item to permanently delete', TRASH_ITEM_TYPES) };
  if (!TRASH_ITEM_TYPES.includes(type)) return { error: invalidArgValue(type, TRASH_ITEM_TYPES) };
  if (!id) return { error: missingArg('id', 'ID of the item to permanently delete') };

  if (type === 'file') {
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    if (!row) return { error: notFound('file', id) };
    if (row.is_deleted) return { error: alreadyDeleted('file', id) };
    if (!row.trashed_at) return { error: notInTrash('file', id) };

    db.prepare('UPDATE files SET is_deleted = 1 WHERE id = ?').run(id);
    auditLog(db, 'permanent_delete', 'file', id, {});
  } else if (type === 'folder') {
    const row = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
    if (!row) return { error: notFound('folder', id) };
    if (row.is_deleted) return { error: alreadyDeleted('folder', id) };
    if (!row.trashed_at) return { error: notInTrash('folder', id) };

    db.prepare('UPDATE folders SET is_deleted = 1 WHERE id = ?').run(id);
    auditLog(db, 'permanent_delete', 'folder', id, {});
  } else {
    // web_link: the mock has no web_links store, so a permanent-delete of one
    // surfaces the SDK 404 (matches the API for a non-existent trashed web link).
    return { error: notFound('web_link', id) };
  }

  // Upstream: src/commands/trash/delete.js:30 — this.info(`Deleted item <id>`) → stderr.
  return { _info: `Deleted item ${id}` };
}

export function restore(db, args, flags, userId) {
  const type = args[0];
  const id = args[1];
  if (!type) return { error: missingArg('type', 'Type of the item to restore', TRASH_ITEM_TYPES) };
  if (!TRASH_ITEM_TYPES.includes(type)) return { error: invalidArgValue(type, TRASH_ITEM_TYPES) };
  if (!id) return { error: missingArg('id', 'ID of the item to restore') };

  const ts = now();

  if (type === 'file') {
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    if (!row) return { error: notFound('file', id) };
    if (row.is_deleted) return { error: alreadyDeleted('file', id) };
    if (!row.trashed_at) return { error: notInTrash('file', id) };

    const sets = ['trashed_at = NULL', 'modified_at = ?'];
    const params = [ts];

    if (flags.name) {
      sets.push('name = ?');
      params.push(flags.name);
    }
    if (flags['parent-id']) {
      sets.push('parent_id = ?');
      params.push(flags['parent-id']);
    }
    params.push(id);

    db.prepare(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    auditLog(db, 'restore', 'file', id, {});

    const restored = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    return {
      type: 'file',
      id: restored.id,
      name: restored.name,
      parent: { type: 'folder', id: restored.parent_id },
      item_status: 'active',
    };
  } else if (type === 'folder') {
    const row = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
    if (!row) return { error: notFound('folder', id) };
    if (row.is_deleted) return { error: alreadyDeleted('folder', id) };
    if (!row.trashed_at) return { error: notInTrash('folder', id) };

    const sets = ['trashed_at = NULL', 'modified_at = ?'];
    const params = [ts];

    if (flags.name) {
      sets.push('name = ?');
      params.push(flags.name);
    }
    if (flags['parent-id']) {
      sets.push('parent_id = ?');
      params.push(flags['parent-id']);
    }
    params.push(id);

    db.prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    auditLog(db, 'restore', 'folder', id, {});

    const restored = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
    return {
      type: 'folder',
      id: restored.id,
      name: restored.name,
      parent: restored.parent_id ? { type: 'folder', id: restored.parent_id } : null,
      item_status: 'active',
    };
  }

  // web_link: the mock has no web_links store, so restore surfaces the SDK 404.
  return { error: notFound('web_link', id) };
}
