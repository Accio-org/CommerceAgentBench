// box comments:* — comment CRUD
// Source: src/commands/comments/*.js

import { generateId, now, auditLog } from '../db.js';
import { notFound, missingFlag, missingArg } from '../errors.js';

function getUserObj(db, userId) {
  const row = db.prepare('SELECT id, name, login FROM users WHERE id = ?').get(userId);
  if (!row) return { type: 'user', id: userId, name: 'Unknown', login: 'unknown@boxmock.example.com' };
  return { type: 'user', id: row.id, name: row.name, login: row.login };
}

function commentToObj(db, row) {
  return {
    type: 'comment',
    id: row.id,
    message: row.message,
    created_by: getUserObj(db, row.created_by),
    created_at: row.created_at,
    modified_at: row.modified_at,
    item: { type: row.item_type, id: row.item_id },
    is_reply_comment: !!row.is_reply,
  };
}

export function create(db, args, flags, userId) {
  const fileId = args[0];
  if (!fileId) return { error: missingArg('fileID', 'ID of file on which to comment') };

  // NOTE: upstream does not mark --message/--tagged-message as oclif-required;
  // the mock needs a message to insert (schema NOT NULL), so this guard is a
  // mock affordance using oclif's missing-flag wording.
  const message = flags.message || flags['tagged-message'];
  if (!message) return { error: missingFlag('message') };

  // Verify file exists
  const file = db.prepare('SELECT id FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(fileId);
  if (!file) return { error: notFound('file', fileId) };

  const id = generateId();
  const ts = now();

  db.prepare(
    `INSERT INTO comments (id, item_type, item_id, message, created_by, created_at, modified_at, is_reply, is_deleted)
     VALUES (?, 'file', ?, ?, ?, ?, ?, 0, 0)`
  ).run(id, fileId, message, userId, ts, ts);
  auditLog(db, 'create', 'comment', id, { file_id: fileId, message });

  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  return commentToObj(db, row);
}

export function get(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the comment to get') };

  const row = db.prepare('SELECT * FROM comments WHERE id = ? AND is_deleted = 0').get(id);
  if (!row) return { error: notFound('comment', id) };

  return commentToObj(db, row);
}

export function del(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the comment to delete') };

  const row = db.prepare('SELECT * FROM comments WHERE id = ? AND is_deleted = 0').get(id);
  if (!row) return { error: notFound('comment', id) };

  db.prepare('UPDATE comments SET is_deleted = 1 WHERE id = ?').run(id);
  auditLog(db, 'delete', 'comment', id, {});

  // Upstream: src/commands/comments/delete.js:11 — stderr via this.info().
  return { _info: `Successfully deleted comment ${id}` };
}
