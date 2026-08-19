// `todoist projects` — list all projects
// `todoist add-project <name>` (alias: ap) — add a new project
// Source: projects.go, add_project.go

import { newId, nowISO, auditLog } from '../db.js';
import { COMMAND_FAILED } from '../errors.js';

export function cmdProjects(db) {
  const rows = db.prepare('SELECT id, name FROM projects WHERE is_deleted = 0 ORDER BY item_order ASC, created_at ASC').all();
  return rows.map(r => [r.id, '#' + r.name]);
}

export const PROJECTS_HEADER = ['ID', 'Name'];

export function cmdAddProject(db, positional, flags) {
  if (positional.length === 0) {
    return { error: COMMAND_FAILED };
  }

  const name = positional[0];
  const id = newId();
  const now = nowISO();
  const color = flags.color || '48';
  const itemOrder = flags.itemOrder || 0;

  // Get next order if not specified
  let order = itemOrder;
  if (!order) {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(item_order), -1) as m FROM projects').get();
    order = (maxOrder?.m ?? -1) + 1;
  }

  db.prepare('INSERT INTO projects (id, name, color, item_order, is_archived, is_deleted, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)')
    .run(id, name, String(color), order, now);

  auditLog(db, 'add', 'project', id, { name, color });

  return { id };
}
