// `todoist show <id>` — show detailed task or section info
// Source: show.go

import { ID_NOT_FOUND } from '../errors.js';
import { formatPriority, formatDueDate, formatLabels, projectFormat, resolveSectionSuffix } from './_helpers.js';

export function cmdShow(db, positional) {
  if (positional.length === 0) {
    return { error: 'command failed' };
  }

  const id = positional[0];

  // Check if it's a section first (show.go:18-19)
  const section = db.prepare('SELECT * FROM sections WHERE id = ? AND is_deleted = 0').get(id);
  if (section) {
    // showSection (show.go:65-84): records ID, Name, Project (ProjectFormat).
    return {
      kv: [
        ['ID', section.id],
        ['Name', section.name],
        ['Project', projectFormat(db, section.project_id)],
      ]
    };
  }

  // Look up item
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND is_deleted = 0').get(id);
  if (!item) {
    return { error: ID_NOT_FOUND };
  }

  const sectionSuffix = resolveSectionSuffix(db, item.section_id);

  // show.go:34-47 — build key-value records.
  const pairs = [
    ['ID', item.id],
    ['Content', item.content],
    ['Description', item.description || ''],
    ['Project', projectFormat(db, item.project_id)],
    ['Section', sectionSuffix],
    ['Labels', formatLabels(item.labels_json)],
    ['Priority', formatPriority(item.priority)],
    ['DueDate', formatDueDate(item.due_date, item.due_datetime)],
  ];

  // Conditionally add Deadline (show.go:44-46)
  if (item.deadline_date) {
    pairs.push(['Deadline', item.deadline_date]);
  }

  // URL field (always present, may be empty — show.go:47)
  pairs.push(['URL', '']);

  return { kv: pairs };
}
