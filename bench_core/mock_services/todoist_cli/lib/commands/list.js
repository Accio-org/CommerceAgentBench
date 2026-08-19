// `todoist list` (alias: l) — show all active tasks
// Columns: ID, Priority, DueDate, Project[/Section], Labels, Content
// Source: list.go

import { formatPriority, formatDueDate, formatLabels, projectFormat, resolveSectionSuffix } from './_helpers.js';
import { NO_TASKS_LIST } from '../errors.js';

export function cmdList(db, flags) {
  const conditions = ['i.is_deleted = 0', 'i.is_completed = 0'];
  const params = [];

  // --filter is a simplified text match (real CLI uses a full filter parser;
  // mock supports basic content/project/label substring matching)
  if (flags.filter) {
    conditions.push("(i.content LIKE ? OR i.labels_json LIKE ?)");
    params.push(`%${flags.filter}%`, `%${flags.filter}%`);
  }

  const sql = `
    SELECT i.*, p.name as project_name
    FROM items i
    LEFT JOIN projects p ON i.project_id = p.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY i.item_order ASC, i.created_at ASC
  `;

  const rows = db.prepare(sql).all(...params);

  if (rows.length === 0) {
    process.stderr.write(NO_TASKS_LIST + '\n');
    return [];
  }

  // Sort by priority if requested (sort flag, not filter)
  let items = rows;
  if (flags.sortPriority) {
    items = [...rows].sort((a, b) => b.priority - a.priority);
  }

  if (flags.limit && flags.limit > 0) {
    items = items.slice(0, flags.limit);
  }

  return items.map(row => formatListRow(db, row));
}

export function formatListRow(db, row) {
  // list.go:74-82 — Project column is ProjectFormat(...) + SectionFormat(...).
  const sectionSuffix = resolveSectionSuffix(db, row.section_id);
  return [
    row.id,
    formatPriority(row.priority),
    formatDueDate(row.due_date, row.due_datetime),
    projectFormat(db, row.project_id) + sectionSuffix,
    formatLabels(row.labels_json),
    row.content,
  ];
}

export const LIST_HEADER = ['ID', 'Priority', 'DueDate', 'Project', 'Labels', 'Content'];
