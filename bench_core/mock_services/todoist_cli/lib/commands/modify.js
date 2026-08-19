// `todoist modify <id>` (alias: m) — modify an existing task
// Source: modify.go

import { nowISO, auditLog } from '../db.js';
import { ID_NOT_FOUND, COMMAND_FAILED, sectionNotFound } from '../errors.js';
import { mapUserPriorityToApi, findProjectByName, findSectionByName, completeItemIDByPrefix } from './_helpers.js';

export function cmdModify(db, positional, flags) {
  // modify.go:15-17 — `if !c.Args().Present()` -> CommandFailed
  if (positional.length === 0) {
    return { error: COMMAND_FAILED };
  }

  // modify.go:20 — resolve a (possibly partial) id via CompleteItemIDByPrefix.
  const itemId = completeItemIDByPrefix(db, positional[0]);
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND is_deleted = 0').get(itemId);
  if (!item) {
    return { error: ID_NOT_FOUND };
  }

  const now = nowISO();
  const updates = {};
  const setClauses = [];
  const params = [];

  // Content (modify.go:29)
  if (flags.content !== undefined) {
    setClauses.push('content = ?');
    params.push(flags.content);
    updates.content = flags.content;
  }

  // Description (modify.go:32)
  if (flags.description !== undefined) {
    setClauses.push('description = ?');
    params.push(flags.description);
    updates.description = flags.description;
  }

  // Priority (modify.go:35)
  if (flags.priority !== undefined) {
    const apiPriority = mapUserPriorityToApi(flags.priority);
    setClauses.push('priority = ?');
    params.push(apiPriority);
    updates.priority = apiPriority;
  }

  // Labels (modify.go:37-44)
  if (flags.labelNames !== undefined) {
    const labels = flags.labelNames.split(',').map(s => s.trim()).filter(Boolean);
    setClauses.push('labels_json = ?');
    params.push(JSON.stringify(labels));
    updates.labels = labels;
  }

  // Due date (modify.go:46-54)
  if (flags.date !== undefined) {
    if (flags.date === 'null') {
      setClauses.push("due_date = ''", "due_string = ''");
      updates.due_date = '';
    } else {
      setClauses.push('due_date = ?', 'due_string = ?');
      params.push(flags.date, flags.date);
      updates.due_date = flags.date;
    }
  }

  // Deadline (modify.go:56-63)
  if (flags.deadline !== undefined) {
    if (flags.deadline === 'null') {
      setClauses.push("deadline_date = ''");
      updates.deadline = '';
    } else {
      setClauses.push('deadline_date = ?');
      params.push(flags.deadline);
      updates.deadline = flags.deadline;
    }
  }

  // Project move (modify.go:65-68). project-id wins; otherwise resolve
  // project-name. Upstream does NOT error when the name doesn't resolve — it
  // leaves projectID empty (GetIDByName returns "") and simply performs no
  // move. Do the same: no project-not-found error here.
  let newProjectId = flags.projectId || '';
  if (newProjectId === '' && flags.projectName) {
    const proj = findProjectByName(db, flags.projectName);
    newProjectId = proj ? proj.id : '';
  }
  if (newProjectId) {
    setClauses.push('project_id = ?');
    params.push(newProjectId);
    updates.project_id = newProjectId;
  }

  // Section move (modify.go:70-77). Upstream resolves the section name against
  // the resolved move-target projectID (which may be "" -> match by name in any
  // project, see Sections.GetIDByName), NOT the item's current project. A
  // section name that doesn't resolve IS an error here (modify.go:74-76).
  let newSectionId = flags.sectionId || '';
  if (flags.sectionName) {
    const sec = findSectionByName(db, flags.sectionName, newProjectId);
    if (!sec) {
      return { error: sectionNotFound(flags.sectionName) };
    }
    newSectionId = sec.id;
  }
  if (newSectionId) {
    setClauses.push('section_id = ?');
    params.push(newSectionId);
    updates.section_id = newSectionId;
  }

  // Always update updated_at
  setClauses.push('updated_at = ?');
  params.push(now);

  if (setClauses.length > 1) {
    // more than just updated_at
    const sql = `UPDATE items SET ${setClauses.join(', ')} WHERE id = ?`;
    params.push(itemId);
    db.prepare(sql).run(...params);
    auditLog(db, 'modify', 'item', itemId, updates);
  }

  return { id: itemId };
}
