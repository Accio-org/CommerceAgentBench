// box users:list / box users:get — user operations
// Source: src/commands/users/list.js, src/commands/users/get.js

import { notFound } from '../errors.js';

function userToObj(row) {
  return {
    type: 'user',
    id: row.id,
    name: row.name,
    login: row.login,
    created_at: row.created_at,
    modified_at: row.modified_at,
    status: row.status,
    space_amount: row.space_amount,
    space_used: row.space_used,
    job_title: row.job_title,
  };
}

export function list(db, args, flags) {
  let query = 'SELECT * FROM users WHERE 1=1';
  const params = [];

  if (flags.filter) {
    query += ' AND (name LIKE ? OR login LIKE ?)';
    const pattern = `%${flags.filter}%`;
    params.push(pattern, pattern);
  }

  if (flags['max-items']) {
    query += ` LIMIT ${parseInt(flags['max-items'], 10)}`;
  }

  const rows = db.prepare(query).all(...params);
  return rows.map(userToObj);
}

export function get(db, args, flags) {
  const id = args[0] || 'me';

  if (id === 'me') {
    // Return the first user (admin) as "me"
    const row = db.prepare('SELECT * FROM users ORDER BY rowid LIMIT 1').get();
    if (!row) return null;
    return userToObj(row);
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) return null;
  return userToObj(row);
}
