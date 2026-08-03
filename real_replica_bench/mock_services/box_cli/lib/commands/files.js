// box files:* — all file operations
// Source: src/commands/files/*.js

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { generateId, generateEtag, now, auditLog } from '../db.js';
import {
  notFound,
  fileNotFound,
  ALREADY_EXISTS,
  missingArg,
  downloadOverwritePrompt,
  downloadNoOverwrite,
} from '../errors.js';

function getUserObj(db, userId) {
  const row = db.prepare('SELECT id, name, login FROM users WHERE id = ?').get(userId);
  if (!row) return { type: 'user', id: userId, name: 'Unknown', login: 'unknown@boxmock.example.com' };
  return { type: 'user', id: row.id, name: row.name, login: row.login };
}

function getFolderName(db, folderId) {
  if (!folderId || folderId === '0') return { type: 'folder', id: '0', name: 'All Files' };
  const row = db.prepare('SELECT id, name FROM folders WHERE id = ? AND is_deleted = 0').get(folderId);
  if (!row) return { type: 'folder', id: folderId, name: '' };
  return { type: 'folder', id: row.id, name: row.name };
}

function buildPathCollection(db, parentId) {
  const entries = [];
  let currentId = parentId;
  while (currentId !== null && currentId !== undefined) {
    const folder = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(currentId);
    if (!folder) break;
    entries.unshift({ type: 'folder', id: folder.id, name: folder.name });
    currentId = folder.parent_id;
  }
  return { total_count: entries.length, entries };
}

function fileToObj(db, row) {
  const tags = JSON.parse(row.tags_json || '[]');
  const parent = getFolderName(db, row.parent_id);
  const createdBy = getUserObj(db, row.created_by);
  const ownedBy = getUserObj(db, row.owned_by || row.created_by);
  const pathCollection = buildPathCollection(db, row.parent_id);

  // Check for shared link
  const sl = db.prepare(
    "SELECT url, access, password, unshared_at FROM shared_links WHERE item_type = 'file' AND item_id = ? AND is_deleted = 0"
  ).get(row.id);

  return {
    type: 'file',
    id: row.id,
    name: row.name,
    description: row.description,
    size: row.size,
    sha1: row.sha1,
    etag: row.etag,
    parent,
    created_at: row.created_at,
    modified_at: row.modified_at,
    content_created_at: row.content_created_at || row.created_at,
    content_modified_at: row.content_modified_at || row.modified_at,
    created_by: createdBy,
    modified_by: createdBy,
    owned_by: ownedBy,
    item_status: row.item_status,
    path_collection: pathCollection,
    shared_link: sl ? { url: sl.url, access: sl.access, password: sl.password, unshared_at: sl.unshared_at } : null,
    tags,
  };
}

function filterFields(obj, fields) {
  if (!fields) return obj;
  const wanted = fields.split(',').map((f) => f.trim());
  const result = {};
  // Always include type and id
  result.type = obj.type;
  result.id = obj.id;
  for (const f of wanted) {
    if (f in obj) result[f] = obj[f];
  }
  return result;
}

export function get(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the file to get') };

  const row = db.prepare('SELECT * FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('file', id) };

  const obj = fileToObj(db, row);
  return filterFields(obj, flags.fields);
}

export function download(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the file to download') };

  // Upstream calls client.files.get(id) first; a missing file surfaces the SDK 404.
  const row = db.prepare('SELECT * FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('file', id) };

  const destDir = flags.destination || '.';
  const fileName = flags['save-as'] || row.name;

  // Ensure destination directory exists
  try {
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  } catch (_) { /* ignore */ }

  const fullPath = join(destDir, fileName);

  // Upstream: src/commands/files/download.js:30-45 — when the file exists and
  // --overwrite was not given, --no-overwrite skips silently, -y/--yes confirms,
  // otherwise it prompts. We can't prompt non-interactively, so we decline.
  if (existsSync(fullPath) && !flags.overwrite) {
    if (flags.overwrite === false) {
      return { _info: downloadNoOverwrite(fullPath) };
    }
    if (!flags.yes) {
      return { _info: downloadOverwritePrompt(fullPath) };
    }
  }

  writeFileSync(fullPath, row.file_content || '');
  auditLog(db, 'download', 'file', id, { destination: fullPath });
  // Upstream: this.info(`Downloaded file ${fileName}`) → stderr. No stdout output.
  return { _info: `Downloaded file ${fileName}` };
}

export function upload(db, args, flags, userId) {
  const filePath = args[0];
  if (!filePath) return { error: missingArg('path', 'Path to the file to be uploaded') };

  if (!existsSync(filePath)) {
    return { error: fileNotFound(filePath) };
  }

  const parentId = flags['parent-id'] || '0';

  // Verify parent folder exists
  const parentRow = db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(parentId);
  if (!parentRow) return { error: notFound('folder', parentId) };

  const content = readFileSync(filePath, 'utf-8');
  const fileName = flags.name || basename(filePath);
  const fileSize = Buffer.byteLength(content, 'utf-8');
  const sha1 = createHash('sha1').update(content).digest('hex');

  // Check for name conflict
  const existing = db.prepare(
    'SELECT id FROM files WHERE name = ? AND parent_id = ? AND is_deleted = 0 AND trashed_at IS NULL'
  ).get(fileName, parentId);

  if (existing && !flags.overwrite) {
    return { error: ALREADY_EXISTS };
  }

  const ts = now();
  let fileId;

  if (existing && flags.overwrite) {
    // Update existing file (new version)
    fileId = existing.id;
    const newEtag = generateEtag();
    db.prepare(
      'UPDATE files SET size = ?, sha1 = ?, etag = ?, modified_at = ?, content_modified_at = ?, file_content = ? WHERE id = ?'
    ).run(fileSize, sha1, newEtag, ts, ts, content, fileId);
    auditLog(db, 'upload_overwrite', 'file', fileId, { name: fileName, parent_id: parentId });
  } else {
    fileId = generateId();
    const etag = generateEtag();
    db.prepare(
      `INSERT INTO files (id, name, description, parent_id, size, sha1, etag, created_at, modified_at,
       content_created_at, content_modified_at, created_by, owned_by, item_status, file_content)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).run(fileId, fileName, parentId, fileSize, sha1, etag, ts, ts, ts, ts, userId, userId, content);
    auditLog(db, 'upload', 'file', fileId, { name: fileName, parent_id: parentId });
  }

  if (flags['id-only']) {
    return { _raw: fileId };
  }

  const newRow = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  return fileToObj(db, newRow);
}

export function del(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the file to delete') };

  const row = db.prepare('SELECT * FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('file', id) };

  const ts = now();
  if (flags.force) {
    // Permanently delete
    db.prepare('UPDATE files SET is_deleted = 1 WHERE id = ?').run(id);
    auditLog(db, 'delete_permanent', 'file', id, {});
  } else {
    // Move to trash
    db.prepare('UPDATE files SET trashed_at = ? WHERE id = ?').run(ts, id);
    auditLog(db, 'trash', 'file', id, {});
  }
  // Upstream: src/commands/files/delete.js:25-27 — this.info(`Deleted file <id>`
  // (+ ` permanently` with --force)) → stderr.
  return { _info: `Deleted file ${id}${flags.force ? ' permanently' : ''}` };
}

export function copy(db, args, flags, userId) {
  const id = args[0];
  const parentId = args[1];
  if (!id) return { error: missingArg('id', 'ID of the file to copy') };
  if (!parentId) return { error: missingArg('parentID', 'ID of the new parent folder to copy the file into') };

  const row = db.prepare('SELECT * FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('file', id) };

  const destFolder = db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(parentId);
  if (!destFolder) return { error: notFound('folder', parentId) };

  const newId = generateId();
  const newName = flags.name || row.name;
  const ts = now();
  const etag = generateEtag();

  db.prepare(
    `INSERT INTO files (id, name, description, parent_id, size, sha1, etag, created_at, modified_at,
     content_created_at, content_modified_at, created_by, owned_by, item_status, tags_json, file_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(newId, newName, row.description, parentId, row.size, row.sha1, etag, ts, ts, ts, ts,
    userId, userId, row.tags_json, row.file_content);
  auditLog(db, 'copy', 'file', newId, { source_id: id, parent_id: parentId });

  if (flags['id-only']) {
    return { _raw: newId };
  }

  const newRow = db.prepare('SELECT * FROM files WHERE id = ?').get(newId);
  return fileToObj(db, newRow);
}

export function move(db, args, flags, userId) {
  const id = args[0];
  const parentId = args[1];
  if (!id) return { error: missingArg('id', 'ID of the file to move') };
  if (!parentId) return { error: missingArg('parentID', 'ID of the new parent folder to move the file into') };

  const row = db.prepare('SELECT * FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('file', id) };

  const destFolder = db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(parentId);
  if (!destFolder) return { error: notFound('folder', parentId) };

  const ts = now();
  db.prepare('UPDATE files SET parent_id = ?, modified_at = ? WHERE id = ?').run(parentId, ts, id);
  auditLog(db, 'move', 'file', id, { new_parent_id: parentId });

  const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  return fileToObj(db, updated);
}

export function update(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the file to update') };

  const row = db.prepare('SELECT * FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(id);
  if (!row) return { error: notFound('file', id) };

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
    // No changes, just return current state
    return fileToObj(db, row);
  }

  sets.push('modified_at = ?');
  params.push(ts);
  sets.push('etag = ?');
  params.push(generateEtag());
  params.push(id);

  db.prepare(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditLog(db, 'update', 'file', id, { flags });

  const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  return fileToObj(db, updated);
}

export function comments(db, args, flags, userId) {
  const fileId = args[0];
  if (!fileId) return { error: missingArg('id', 'ID of the file to get comments for') };

  const row = db.prepare('SELECT id FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(fileId);
  if (!row) return { error: notFound('file', fileId) };

  const rows = db.prepare(
    "SELECT * FROM comments WHERE item_type = 'file' AND item_id = ? AND is_deleted = 0 ORDER BY created_at"
  ).all(fileId);

  return rows.map((c) => ({
    type: 'comment',
    id: c.id,
    message: c.message,
    created_by: getUserObj(db, c.created_by),
    created_at: c.created_at,
    modified_at: c.modified_at,
    item: { type: 'file', id: fileId },
    is_reply_comment: !!c.is_reply,
  }));
}
