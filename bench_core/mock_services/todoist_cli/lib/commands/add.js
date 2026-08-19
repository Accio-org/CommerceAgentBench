// `todoist add <content>` (alias: a) — add a new task
// Source: add.go

import { newId, nowISO, auditLog } from '../db.js';
import { addArgCountError, projectNotFound, sectionNotFound } from '../errors.js';
import { mapUserPriorityToApi, findProjectByName, findSectionByName } from './_helpers.js';

export function cmdAdd(db, positional, flags) {
  // Exactly 1 positional argument required (add.go:23-25)
  if (positional.length !== 1) {
    return { error: addArgCountError(positional.length) };
  }

  const content = positional[0];
  const id = newId();
  const now = nowISO();

  // Resolve priority: user input 1=urgent..4=normal -> API 4=urgent..1=normal
  const userPriority = flags.priority ?? 4;
  const apiPriority = mapUserPriorityToApi(userPriority);

  // Resolve project
  let projectId = '';
  if (flags.projectName) {
    const proj = findProjectByName(db, flags.projectName);
    if (!proj) {
      return { error: projectNotFound(flags.projectName) };
    }
    projectId = proj.id;
  } else if (flags.projectId) {
    projectId = flags.projectId;
  }

  // Default to Inbox
  if (!projectId) {
    const inbox = db.prepare("SELECT id FROM projects WHERE name = 'Inbox' AND is_deleted = 0").get();
    projectId = inbox ? inbox.id : '';
  }

  // Resolve section
  let sectionId = '';
  if (flags.sectionName) {
    const sec = findSectionByName(db, flags.sectionName, projectId);
    if (!sec) {
      return { error: sectionNotFound(flags.sectionName) };
    }
    sectionId = sec.id;
  } else if (flags.sectionId) {
    sectionId = flags.sectionId;
  }

  // Parse labels
  let labels = [];
  if (flags.labelNames) {
    labels = flags.labelNames.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Due date
  const dueDate = flags.date || '';
  const dueString = flags.date || '';

  // Deadline
  const deadlineDate = flags.deadline || '';

  // Description
  const description = flags.description || '';

  // Get next item_order
  const maxOrder = db.prepare('SELECT COALESCE(MAX(item_order), -1) as m FROM items WHERE project_id = ?').get(projectId);
  const itemOrder = (maxOrder?.m ?? -1) + 1;

  db.prepare(`
    INSERT INTO items (id, content, description, project_id, section_id, priority, due_date, due_string, deadline_date, labels_json, is_completed, is_deleted, item_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
  `).run(id, content, description, projectId, sectionId, apiPriority, dueDate, dueString, deadlineDate, JSON.stringify(labels), itemOrder, now, now);

  auditLog(db, 'add', 'item', id, { content, projectId, priority: apiPriority });

  // Real CLI does Sync after add which prints nothing extra on success.
  // We print a confirmation matching typical CLI patterns.
  return { id };
}
