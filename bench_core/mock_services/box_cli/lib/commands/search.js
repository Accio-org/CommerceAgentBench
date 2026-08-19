// box search — search files and folders
// Source: src/commands/search.js

import { invalidFlagValue } from '../errors.js';

// src/commands/search.js:241-245 — --type oclif options.
const VALID_SEARCH_TYPES = ['file', 'folder', 'web_link'];

export function run(db, args, flags, userId) {
  const query = args[0] || '';
  const typeFilter = flags.type; // file, folder, web_link
  // oclif validates --type against its options at parse time (exit 2).
  if (typeFilter !== undefined && !VALID_SEARCH_TYPES.includes(typeFilter)) {
    return { error: invalidFlagValue('type', typeFilter, VALID_SEARCH_TYPES) };
  }
  const limit = parseInt(flags.limit || '100', 10);
  const ancestorFolderIds = flags['ancestor-folder-ids'];
  const fileExtensions = flags['file-extensions'];

  const results = [];

  // Search files
  if (!typeFilter || typeFilter === 'file') {
    let sql = 'SELECT * FROM files WHERE is_deleted = 0 AND trashed_at IS NULL';
    const params = [];

    if (query) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${query}%`, `%${query}%`);
    }
    if (ancestorFolderIds) {
      const ids = ancestorFolderIds.split(',').map((s) => s.trim());
      sql += ` AND parent_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
    if (fileExtensions) {
      const exts = fileExtensions.split(',').map((s) => s.trim());
      const extClauses = exts.map(() => 'name LIKE ?');
      sql += ` AND (${extClauses.join(' OR ')})`;
      for (const ext of exts) {
        params.push(`%.${ext}`);
      }
    }

    const files = db.prepare(sql).all(...params);
    for (const f of files) {
      results.push({
        type: 'file',
        id: f.id,
        name: f.name,
        description: f.description,
        size: f.size,
        sha1: f.sha1,
        etag: f.etag,
        parent: { type: 'folder', id: f.parent_id },
        created_at: f.created_at,
        modified_at: f.modified_at,
      });
    }
  }

  // Search folders
  if (!typeFilter || typeFilter === 'folder') {
    let sql = "SELECT * FROM folders WHERE is_deleted = 0 AND trashed_at IS NULL AND id != '0'";
    const params = [];

    if (query) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${query}%`, `%${query}%`);
    }
    if (ancestorFolderIds) {
      const ids = ancestorFolderIds.split(',').map((s) => s.trim());
      sql += ` AND parent_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }

    const folders = db.prepare(sql).all(...params);
    for (const f of folders) {
      results.push({
        type: 'folder',
        id: f.id,
        name: f.name,
        description: f.description,
        size: f.size,
        etag: f.etag,
        parent: { type: 'folder', id: f.parent_id },
        created_at: f.created_at,
        modified_at: f.modified_at,
      });
    }
  }

  // Sort
  const sortField = flags.sort || 'relevance';
  const direction = (flags.direction || 'DESC').toUpperCase();
  if (sortField !== 'relevance') {
    results.sort((a, b) => {
      const field = sortField === 'date' ? 'modified_at' : sortField;
      let va = a[field] ?? '';
      let vb = b[field] ?? '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return direction === 'ASC' ? -1 : 1;
      if (va > vb) return direction === 'ASC' ? 1 : -1;
      return 0;
    });
  }

  // Limit
  return results.slice(0, limit);
}
