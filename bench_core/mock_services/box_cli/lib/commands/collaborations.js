// box collaborations:* — collaboration CRUD
// Source: src/commands/collaborations/*.js

import { generateId, now, auditLog } from '../db.js';
import { notFound, invalidFlagValue, invalidArgValue, missingArg, COLLAB_ROLE_REQUIRED } from '../errors.js';

// src/commands/collaborations/create.js:39-47 — the --role flag's oclif options.
// NOTE: `owner` is NOT an upstream option (removed here + from schema.sql).
const VALID_ROLES = ['editor', 'viewer', 'previewer', 'uploader', 'previewer_uploader', 'viewer_uploader', 'co-owner'];

function getUserObj(db, userId) {
  const row = db.prepare('SELECT id, name, login FROM users WHERE id = ?').get(userId);
  if (!row) return { type: 'user', id: userId, name: 'Unknown', login: 'unknown@boxmock.example.com' };
  return { type: 'user', id: row.id, name: row.name, login: row.login };
}

function getItemName(db, itemType, itemId) {
  if (itemType === 'folder') {
    const row = db.prepare('SELECT name FROM folders WHERE id = ?').get(itemId);
    return row ? row.name : '';
  }
  const row = db.prepare('SELECT name FROM files WHERE id = ?').get(itemId);
  return row ? row.name : '';
}

function collabToObj(db, row) {
  return {
    type: 'collaboration',
    id: row.id,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    modified_at: row.modified_at,
    accessible_by: getUserObj(db, row.accessible_by),
    item: { type: row.item_type, id: row.item_id, name: getItemName(db, row.item_type, row.item_id) },
  };
}

export function create(db, args, flags, userId) {
  const itemId = args[0];
  const itemType = args[1];
  if (!itemId) return { error: missingArg('itemID', 'The ID of the Box item to add the collaboration to') };
  if (!itemType) return { error: missingArg('itemType', 'The type of the Box item to add the collaboration to', ['file', 'folder']) };
  if (!['file', 'folder'].includes(itemType)) return { error: invalidArgValue(itemType, ['file', 'folder']) };

  // oclif validates --role against its options at parse time (exit 2); the
  // collaboration module then requires a role to be present at runtime
  // (src/modules/collaboration.js:62-64). No default role upstream.
  if (flags.role !== undefined && !VALID_ROLES.includes(flags.role)) {
    return { error: invalidFlagValue('role', flags.role, VALID_ROLES) };
  }
  const role = flags.role;
  if (!role) {
    return { error: COLLAB_ROLE_REQUIRED };
  }

  // Determine target user
  let targetUserId = flags['user-id'];
  if (!targetUserId && flags.login) {
    const user = db.prepare('SELECT id FROM users WHERE login = ?').get(flags.login);
    if (!user) return { error: `User not found with login: ${flags.login}` };
    targetUserId = user.id;
  }
  if (!targetUserId) {
    return { error: 'Must specify --user-id or --login for the collaborator' };
  }

  // Verify item exists
  if (itemType === 'folder') {
    const row = db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0').get(itemId);
    if (!row) return { error: notFound('folder', itemId) };
  } else if (itemType === 'file') {
    const row = db.prepare('SELECT id FROM files WHERE id = ? AND is_deleted = 0').get(itemId);
    if (!row) return { error: notFound('file', itemId) };
  }

  const id = generateId();
  const ts = now();

  db.prepare(
    `INSERT INTO collaborations (id, item_type, item_id, accessible_by, role, status, created_at, modified_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, 0)`
  ).run(id, itemType, itemId, targetUserId, role, ts, ts);
  auditLog(db, 'create', 'collaboration', id, { item_type: itemType, item_id: itemId, role });

  if (flags['id-only']) {
    return { _raw: id };
  }

  const row = db.prepare('SELECT * FROM collaborations WHERE id = ?').get(id);
  return collabToObj(db, row);
}

export function get(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the collaboration to get') };

  const row = db.prepare('SELECT * FROM collaborations WHERE id = ? AND is_deleted = 0').get(id);
  if (!row) return { error: notFound('collaboration', id) };

  return collabToObj(db, row);
}

export function del(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'The ID of the collaboration to delete') };

  const row = db.prepare('SELECT * FROM collaborations WHERE id = ? AND is_deleted = 0').get(id);
  if (!row) return { error: notFound('collaboration', id) };

  db.prepare('UPDATE collaborations SET is_deleted = 1 WHERE id = ?').run(id);
  auditLog(db, 'delete', 'collaboration', id, {});

  // Upstream: src/commands/collaborations/delete.js:11 — stderr via this.info().
  return { _info: `Collaboration ${id} successfully removed` };
}
