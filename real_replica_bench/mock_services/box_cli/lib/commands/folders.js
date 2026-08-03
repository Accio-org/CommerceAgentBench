// box folders:* — all folder operations
// Source: src/commands/folders/*.js

import { generateId, generateEtag, now, auditLog } from '../db.js';
import { notFound, CANNOT_DELETE_ROOT, folderNotEmpty, itemNameConflict, missingArg } from '../errors.js';

function getUserObj(db, userId) {
  const row = db.prepare('SELECT id, name, login FROM users WHERE id = ?').get(userId);
  if (!row) return { type: 'user', id: userId, name: 'Unknown', login: 'unknown@boxmock.example.com' };
  return { type: 'user', id: row.id, name: row.name, login: row.login };
}

function getFolderParent(db, parentId) {
  if (parentId === null || parentId === undefined) return null;
  if (parentId === '0') return { type: 'folder', id: '0', name: 'All Files' };
  const row = db.prepare('SELECT id, name FROM folders WHERE id = ?').get(parentId);
  if (!row) return null;
  return { type: 'folder', id: row.id, name: row.name };
}

function buildPathCollection(db, folderId) {
  const entries = [];
  let currentId = folderId;
  // Walk up to root, but don't include the folder itself
  const self = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(currentId);
  if (!self) return { total_count: 0, entries: [] };
  currentId = self.parent_id;

  while (currentId !== null && currentId !== undefined) {
    const folder = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(currentId);
    if (!folder) break;
    entries.unshift({ type: 'folder', id: folder.id, name: folder.name });
    currentId = folder.parent_id;
  }
  return { total_count: entries.length, entries };
}

function getItemCollection(db, folderId) {
  const subfolders = db.prepare(
    'SELECT id, name FROM folders WHERE parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL ORDER BY name'
  ).all(folderId);
  const files = db.prepare(
    'SELECT id, name FROM files WHERE parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL ORDER BY name'
  ).all(folderId);

  const entries = [
    ...subfolders.map((f) => ({ type: 'folder', id: f.id, name: f.name })),
    ...files.map((f) => ({ type: 'file', id: f.id, name: f.name })),
  ];

  return { total_count: entries.length, entries };
}

function folderToObj(db, row) {
  const tags = JSON.parse(row.tags_json || '[]');
  const parent = getFolderParent(db, row.parent_id);
  const createdBy = getUserObj(db, row.created_by);
  const ownedBy = getUserObj(db, row.owned_by || row.created_by);
  const pathCollection = buildPathCollection(db, row.id);
  const itemCollection = getItemCollection(db, row.id);

  return {
    type: 'folder',
    id: row.id,
    name: row.name,
    description: row.description,
    size: row.size,
    etag: row.etag,
    parent,
    created_at: row.created_at,
    modified_at: row.modified_at,
    created_by: createdBy,
    owned_by: ownedBy,
    item_status: row.item_status,
    path_collection: pathCollection,
    item_collection: itemCollection,
    tags,
  };
}

function filterFields(obj, fields) {
  if (!fields) return obj;
  const wanted = fields.split(',').map((f) => f.trim());
  const result = {};
  result.type = obj.type;
  result.id = obj.id;
  for (const f of wanted) {
    if (f in obj) result[f] = obj[f];
  }
  return result;
}

export function get(db, args, flags, userId) {
  const id = args[0];
  if (!id && id !== '0') return { error: missingArg('id', 'ID of folder to get; use 0 for the root folder') };

  const row = db.prepare('SELECT * FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('folder', id) };

  const obj = folderToObj(db, row);
  return filterFields(obj, flags.fields);
}

export function items(db, args, flags, userId) {
  const id = args[0];
  if (!id && id !== '0') return { error: missingArg('id', 'ID of the folder to get the items in, use 0 for the root folder') };

  const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!folder) return { error: notFound('folder', id) };

  // Gather subfolders and files
  let subfolders = db.prepare(
    'SELECT * FROM folders WHERE parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL'
  ).all(id);
  let files = db.prepare(
    'SELECT * FROM files WHERE parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL'
  ).all(id);

  let allItems = [
    ...subfolders.map((f) => ({
      type: 'folder', id: f.id, name: f.name, description: f.description,
      size: f.size, etag: f.etag, created_at: f.created_at, modified_at: f.modified_at,
    })),
    ...files.map((f) => ({
      type: 'file', id: f.id, name: f.name, description: f.description,
      size: f.size, sha1: f.sha1, etag: f.etag, created_at: f.created_at, modified_at: f.modified_at,
    })),
  ];

  // Sort
  const sortField = flags.sort || 'name';
  const direction = (flags.direction || 'ASC').toUpperCase();
  allItems.sort((a, b) => {
    let va = a[sortField] ?? a[sortField === 'date' ? 'modified_at' : sortField] ?? '';
    let vb = b[sortField] ?? b[sortField === 'date' ? 'modified_at' : sortField] ?? '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return direction === 'ASC' ? -1 : 1;
    if (va > vb) return direction === 'ASC' ? 1 : -1;
    return 0;
  });

  // Limit
  if (flags['max-items']) {
    allItems = allItems.slice(0, parseInt(flags['max-items'], 10));
  }

  return allItems;
}

export function create(db, args, flags, userId) {
  const parentId = args[0];
  const name = args[1];
  if (!parentId && parentId !== '0') return { error: missingArg('parentID', "ID of parent folder to add new folder to, use '0' for the root folder") };
  if (!name) return { error: missingArg('name', 'Name of new folder') };

  // Verify parent folder exists
  const parentRow = db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(parentId);
  if (!parentRow) return { error: notFound('folder', parentId) };

  // Check for name conflict
  const existing = db.prepare(
    'SELECT id FROM folders WHERE name = ? AND parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL'
  ).get(name, parentId);
  if (existing) return { error: itemNameConflict(name) };

  const id = generateId();
  const ts = now();
  const etag = generateEtag();

  db.prepare(
    `INSERT INTO folders (id, name, description, parent_id, size, etag, created_at, modified_at, created_by, owned_by, item_status)
     VALUES (?, ?, '', ?, 0, ?, ?, ?, ?, ?, 'active')`
  ).run(id, name, parentId, etag, ts, ts, userId, userId);
  auditLog(db, 'create', 'folder', id, { name, parent_id: parentId });

  if (flags['id-only']) {
    return { _raw: id };
  }

  const newRow = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  return folderToObj(db, newRow);
}

export function del(db, args, flags, userId) {
  const id = args[0];
  if (!id && id !== '0') return { error: missingArg('id', 'ID of the folder to delete') };

  if (id === '0') {
    return { error: CANNOT_DELETE_ROOT };
  }

  const row = db.prepare('SELECT * FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('folder', id) };

  // Check if folder is non-empty and --recursive not set
  const childFolders = db.prepare(
    'SELECT COUNT(*) as cnt FROM folders WHERE parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL'
  ).get(id);
  const childFiles = db.prepare(
    'SELECT COUNT(*) as cnt FROM files WHERE parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL'
  ).get(id);
  const hasChildren = (childFolders.cnt + childFiles.cnt) > 0;

  if (hasChildren && !flags.recursive && !flags.r) {
    return { error: folderNotEmpty() };
  }

  const ts = now();

  if (flags.force || flags.f) {
    // Permanently delete folder and all contents recursively
    permanentlyDeleteFolder(db, id);
    auditLog(db, 'delete_permanent', 'folder', id, { recursive: true });
  } else {
    // Move to trash (folder + contents)
    trashFolder(db, id, ts);
    auditLog(db, 'trash', 'folder', id, {});
  }
  // Upstream: src/commands/folders/delete.js:38-40 — this.info(`Deleted folder
  // <id>` (+ ` permanently` with --force)) → stderr.
  return { _info: `Deleted folder ${id}${flags.force ? ' permanently' : ''}` };
}

function permanentlyDeleteFolder(db, folderId) {
  // Recursively delete subfolders
  const subfolders = db.prepare('SELECT id FROM folders WHERE parent_id = ? AND is_deleted = 0').all(folderId);
  for (const sub of subfolders) {
    permanentlyDeleteFolder(db, sub.id);
  }
  // Delete files in this folder
  db.prepare('UPDATE files SET is_deleted = 1 WHERE parent_id = ? AND is_deleted = 0').run(folderId);
  // Delete the folder itself
  db.prepare('UPDATE folders SET is_deleted = 1 WHERE id = ?').run(folderId);
}

function trashFolder(db, folderId, ts) {
  // Recursively trash subfolders
  const subfolders = db.prepare('SELECT id FROM folders WHERE parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL').all(folderId);
  for (const sub of subfolders) {
    trashFolder(db, sub.id, ts);
  }
  // Trash files in this folder
  db.prepare('UPDATE files SET trashed_at = ? WHERE parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL').run(ts, folderId);
  // Trash the folder itself
  db.prepare('UPDATE folders SET trashed_at = ? WHERE id = ?').run(ts, folderId);
}

export function copy(db, args, flags, userId) {
  const id = args[0];
  const parentId = args[1];
  if (!id) return { error: missingArg('id', 'ID of the folder to copy') };
  if (!parentId && parentId !== '0') return { error: missingArg('parentID', 'ID of the new parent folder to copy the folder into') };

  const row = db.prepare('SELECT * FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('folder', id) };

  const destFolder = db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(parentId);
  if (!destFolder) return { error: notFound('folder', parentId) };

  const newId = generateId();
  const newName = flags.name || row.name;
  const ts = now();
  const etag = generateEtag();

  db.prepare(
    `INSERT INTO folders (id, name, description, parent_id, size, etag, created_at, modified_at, created_by, owned_by, item_status, tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  ).run(newId, newName, row.description, parentId, row.size, etag, ts, ts, userId, userId, row.tags_json);
  auditLog(db, 'copy', 'folder', newId, { source_id: id, parent_id: parentId });

  if (flags['id-only']) {
    return { _raw: newId };
  }

  const newRow = db.prepare('SELECT * FROM folders WHERE id = ?').get(newId);
  return folderToObj(db, newRow);
}

export function move(db, args, flags, userId) {
  const id = args[0];
  const parentId = args[1];
  // NOTE: upstream's folders:move `id` arg description is literally "ID of
  // folder to copy" (a copy/paste typo in src/commands/folders/move.js:47) —
  // reproduced verbatim for bit-identity.
  if (!id) return { error: missingArg('id', 'ID of folder to copy') };
  if (!parentId && parentId !== '0') return { error: missingArg('parentID', 'ID of the new parent folder to move the folder into') };

  if (id === '0') {
    return { error: 'Cannot move the root folder.' };
  }

  const row = db.prepare('SELECT * FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('folder', id) };

  const destFolder = db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(parentId);
  if (!destFolder) return { error: notFound('folder', parentId) };

  const ts = now();
  db.prepare('UPDATE folders SET parent_id = ?, modified_at = ? WHERE id = ?').run(parentId, ts, id);
  auditLog(db, 'move', 'folder', id, { new_parent_id: parentId });

  const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  return folderToObj(db, updated);
}

export function update(db, args, flags, userId) {
  const id = args[0];
  if (!id && id !== '0') return { error: missingArg('id', 'ID of the folder to update') };

  const row = db.prepare('SELECT * FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('folder', id) };

  const ts = now();
  const sets = [];
  const params = [];

  if (flags.name !== undefined) {
    sets.push('name = ?');
    params.push(flags.name);
  }
  if (flags.description !== undefined) {
    sets.push('description = ?');
    params.push(flags.description);
  }
  if (flags.tags !== undefined) {
    const tags = flags.tags.split(',').map((t) => t.trim());
    sets.push('tags_json = ?');
    params.push(JSON.stringify(tags));
  }

  if (sets.length === 0) {
    return folderToObj(db, row);
  }

  sets.push('modified_at = ?');
  params.push(ts);
  sets.push('etag = ?');
  params.push(generateEtag());
  params.push(id);

  db.prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditLog(db, 'update', 'folder', id, { flags });

  const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  return folderToObj(db, updated);
}
