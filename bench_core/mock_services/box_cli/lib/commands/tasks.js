// box tasks:* — task CRUD
// Source: src/commands/tasks/*.js

import { generateId, now, auditLog } from '../db.js';
import { notFound, invalidFlagValue, missingArg } from '../errors.js';

// src/commands/tasks/create.js:46 & update.js:41 — --completion-rule oclif options.
const VALID_COMPLETION_RULES = ['all_assignees', 'any_assignee'];

function getUserObj(db, userId) {
  const row = db.prepare('SELECT id, name, login FROM users WHERE id = ?').get(userId);
  if (!row) return { type: 'user', id: userId, name: 'Unknown', login: 'unknown@boxmock.example.com' };
  return { type: 'user', id: row.id, name: row.name, login: row.login };
}

function getFileObj(db, fileId) {
  const row = db.prepare('SELECT id, name FROM files WHERE id = ?').get(fileId);
  if (!row) return { type: 'file', id: fileId, name: '' };
  return { type: 'file', id: row.id, name: row.name };
}

function taskToObj(db, row) {
  return {
    type: 'task',
    id: row.id,
    item: getFileObj(db, row.file_id),
    message: row.message,
    due_at: row.due_at,
    is_completed: !!row.is_completed,
    completion_rule: row.completion_rule,
    created_by: getUserObj(db, row.created_by),
    created_at: row.created_at,
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

export function create(db, args, flags, userId) {
  const fileId = args[0];
  if (!fileId) return { error: missingArg('fileID', 'ID of the file to create a task on') };

  // oclif validates --completion-rule against its options at parse time (exit 2).
  if (flags['completion-rule'] !== undefined && !VALID_COMPLETION_RULES.includes(flags['completion-rule'])) {
    return { error: invalidFlagValue('completion-rule', flags['completion-rule'], VALID_COMPLETION_RULES) };
  }
  const completionRule = flags['completion-rule'] || 'all_assignees';

  // Verify file exists
  const file = db.prepare('SELECT id FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(fileId);
  if (!file) return { error: notFound('file', fileId) };

  const id = generateId();
  const ts = now();

  db.prepare(
    `INSERT INTO tasks (id, file_id, message, due_at, is_completed, completion_rule, created_by, created_at, is_deleted)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0)`
  ).run(id, fileId, flags.message || '', flags['due-at'] || null, completionRule, userId, ts);
  auditLog(db, 'create', 'task', id, { file_id: fileId, message: flags.message });

  if (flags['id-only']) {
    return { _raw: id };
  }

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return taskToObj(db, row);
}

export function get(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the task to get') };

  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND is_deleted = 0').get(id);
  if (!row) return { error: notFound('task', id) };

  return filterFields(taskToObj(db, row), flags.fields);
}

export function listForFile(db, args, flags, userId) {
  const fileId = args[0];
  if (!fileId) return { error: missingArg('id', 'ID of file on which to retrieve tasks') };

  const file = db.prepare('SELECT id FROM files WHERE id = ? AND is_deleted = 0 AND trashed_at IS NULL').get(fileId);
  if (!file) return { error: notFound('file', fileId) };

  const rows = db.prepare(
    'SELECT * FROM tasks WHERE file_id = ? AND is_deleted = 0 ORDER BY created_at, id'
  ).all(fileId);

  return rows.map((row) => filterFields(taskToObj(db, row), flags.fields));
}

export function update(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the task to update') };

  // oclif validates --completion-rule against its options at parse time (exit 2).
  if (flags['completion-rule'] !== undefined && !VALID_COMPLETION_RULES.includes(flags['completion-rule'])) {
    return { error: invalidFlagValue('completion-rule', flags['completion-rule'], VALID_COMPLETION_RULES) };
  }

  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND is_deleted = 0').get(id);
  if (!row) return { error: notFound('task', id) };

  const sets = [];
  const params = [];

  if (flags.message !== undefined) {
    sets.push('message = ?');
    params.push(flags.message);
  }
  if (flags['due-at'] !== undefined) {
    sets.push('due_at = ?');
    params.push(flags['due-at']);
  }
  if (flags['completion-rule'] !== undefined) {
    sets.push('completion_rule = ?');
    params.push(flags['completion-rule']);
  }

  if (sets.length === 0) {
    return taskToObj(db, row);
  }

  params.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditLog(db, 'update', 'task', id, { flags });

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return taskToObj(db, updated);
}

export function del(db, args, flags, userId) {
  const id = args[0];
  if (!id) return { error: missingArg('id', 'ID of the task to delete') };

  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND is_deleted = 0').get(id);
  if (!row) return { error: notFound('task', id) };

  db.prepare('UPDATE tasks SET is_deleted = 1 WHERE id = ?').run(id);
  auditLog(db, 'delete', 'task', id, {});

  // Upstream: src/commands/tasks/delete.js:11 — stderr via this.info().
  return { _info: `Successfully deleted task ${id}` };
}
