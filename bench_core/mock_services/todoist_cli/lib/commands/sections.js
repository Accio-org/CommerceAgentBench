// `todoist sections` and subcommands — manage sections
// Source: sections.go, add_section.go, delete_section.go, update_section.go,
//         move_section.go, archive_section.go, unarchive_section.go, reorder_sections.go

import { newId, nowISO, auditLog } from '../db.js';
import {
  ID_NOT_FOUND, COMMAND_FAILED,
  SECTION_PROJECT_REQUIRED, SECTION_UPDATE_NAME_REQUIRED,
  SECTION_MOVE_PROJECT_REQUIRED, REORDER_MIN_IDS,
  projectNotFound, reorderIdNotFound
} from '../errors.js';
import { findProjectByName } from './_helpers.js';

/**
 * `sections` / `sections list` — list active sections
 * Columns: ID, Project, Name (sections.go)
 */
export function cmdSectionsList(db) {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.project_id, p.name as project_name
    FROM sections s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.is_deleted = 0 AND s.is_archived = 0
    ORDER BY s.section_order ASC
  `).all();

  return rows.map(r => [r.id, r.project_name || '', r.name]);
}

export const SECTIONS_HEADER = ['ID', 'Project', 'Name'];

/**
 * `sections add <name>` — add a new section
 * Requires --project-name or --project-id (add_section.go:32)
 */
export function cmdSectionsAdd(db, positional, flags) {
  if (positional.length === 0) {
    return { error: COMMAND_FAILED };
  }

  const name = positional[0];

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

  if (!projectId) {
    return { error: SECTION_PROJECT_REQUIRED };
  }

  const id = newId();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(section_order), -1) as m FROM sections WHERE project_id = ?').get(projectId);
  const order = (maxOrder?.m ?? -1) + 1;

  db.prepare('INSERT INTO sections (id, name, project_id, section_order, is_archived, is_deleted) VALUES (?, ?, ?, ?, 0, 0)')
    .run(id, name, projectId, order);

  auditLog(db, 'add', 'section', id, { name, projectId });

  return { id };
}

/**
 * `sections delete <id>` (delete_section.go)
 */
export function cmdSectionsDelete(db, positional) {
  if (positional.length === 0) {
    return { error: COMMAND_FAILED };
  }

  const sectionId = positional[0];
  const section = db.prepare('SELECT id FROM sections WHERE id = ? AND is_deleted = 0').get(sectionId);
  if (!section) {
    return { error: ID_NOT_FOUND };
  }

  db.prepare('UPDATE sections SET is_deleted = 1 WHERE id = ?').run(sectionId);
  auditLog(db, 'delete', 'section', sectionId, {});

  return { ok: true };
}

/**
 * `sections archive <id>` (archive_section.go)
 */
export function cmdSectionsArchive(db, positional) {
  if (positional.length === 0) {
    return { error: COMMAND_FAILED };
  }

  const sectionId = positional[0];
  const section = db.prepare('SELECT id FROM sections WHERE id = ? AND is_deleted = 0').get(sectionId);
  if (!section) {
    return { error: ID_NOT_FOUND };
  }

  db.prepare('UPDATE sections SET is_archived = 1 WHERE id = ?').run(sectionId);
  auditLog(db, 'archive', 'section', sectionId, {});

  return { ok: true };
}

/**
 * `sections unarchive <id>` (unarchive_section.go)
 */
export function cmdSectionsUnarchive(db, positional) {
  if (positional.length === 0) {
    return { error: COMMAND_FAILED };
  }

  const sectionId = positional[0];
  // unarchive_section.go: does NOT validate against local cache for archived sections
  const section = db.prepare('SELECT id FROM sections WHERE id = ?').get(sectionId);
  if (!section) {
    return { error: ID_NOT_FOUND };
  }

  db.prepare('UPDATE sections SET is_archived = 0 WHERE id = ?').run(sectionId);
  auditLog(db, 'unarchive', 'section', sectionId, {});

  return { ok: true };
}

/**
 * `sections update <id> --name <name>` (update_section.go)
 */
export function cmdSectionsUpdate(db, positional, flags) {
  if (positional.length === 0) {
    return { error: COMMAND_FAILED };
  }

  const sectionId = positional[0];
  const section = db.prepare('SELECT id FROM sections WHERE id = ? AND is_deleted = 0').get(sectionId);
  if (!section) {
    return { error: ID_NOT_FOUND };
  }

  const name = flags.name;
  if (!name) {
    return { error: SECTION_UPDATE_NAME_REQUIRED };
  }

  db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name, sectionId);
  auditLog(db, 'update', 'section', sectionId, { name });

  return { ok: true };
}

/**
 * `sections move <id> --project-id/--project-name` (move_section.go)
 */
export function cmdSectionsMove(db, positional, flags) {
  if (positional.length === 0) {
    return { error: COMMAND_FAILED };
  }

  const sectionId = positional[0];
  const section = db.prepare('SELECT id FROM sections WHERE id = ? AND is_deleted = 0').get(sectionId);
  if (!section) {
    return { error: ID_NOT_FOUND };
  }

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

  if (!projectId) {
    return { error: SECTION_MOVE_PROJECT_REQUIRED };
  }

  db.prepare('UPDATE sections SET project_id = ? WHERE id = ?').run(projectId, sectionId);
  auditLog(db, 'move', 'section', sectionId, { projectId });

  return { ok: true };
}

/**
 * `sections reorder <id> <id> ...` (reorder_sections.go)
 * Requires >= 2 IDs.
 */
export function cmdSectionsReorder(db, positional) {
  if (positional.length < 2) {
    return { error: REORDER_MIN_IDS };
  }

  // Validate all IDs exist
  for (const id of positional) {
    const section = db.prepare('SELECT id FROM sections WHERE id = ? AND is_deleted = 0').get(id);
    if (!section) {
      return { error: reorderIdNotFound(id) };
    }
  }

  // Apply new order
  for (let i = 0; i < positional.length; i++) {
    db.prepare('UPDATE sections SET section_order = ? WHERE id = ?').run(i, positional[i]);
  }

  auditLog(db, 'reorder', 'section', '', { ids: positional });

  return { ok: true };
}
