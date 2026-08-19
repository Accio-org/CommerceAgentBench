// Shared formatting helpers — mirrors format.go from upstream
// Priority display, date formatting, label formatting, project/section name resolution

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Format priority for display.
 * API stores: 1=normal, 2=medium, 3=high, 4=urgent
 * Display (format.go:68-86 PriorityFormat): p4=urgent, p3=high, p2=medium,
 * p1=normal. The Go switch has no default, so an API priority outside 1..4
 * (e.g. a 0 produced by an out-of-range --priority, see mapUserPriorityToApi)
 * leaves the local `p` variable at its zero value and prints "p0".
 */
export function formatPriority(apiPriority) {
  const displayMap = { 1: 4, 2: 3, 3: 2, 4: 1 };
  const displayNum = displayMap[apiPriority] ?? 0;
  return `p${displayNum}`;
}

/**
 * Format due date string.
 * Real CLI uses Go's "06/01/02(Mon)" = "YY/MM/DD(Day)"
 * and "06/01/02(Mon) 15:04" for datetime.
 */
export function formatDueDate(dueDate, dueDateTime) {
  if (dueDateTime) {
    const d = new Date(dueDateTime);
    if (!isNaN(d.getTime())) {
      return shortDateTimeFormat(d);
    }
  }
  if (dueDate) {
    const d = new Date(dueDate + 'T00:00:00');
    if (!isNaN(d.getTime())) {
      return shortDateFormat(d);
    }
  }
  return '';
}

/**
 * "YY/MM/DD(Day)" format — matches Go's "06/01/02(Mon)"
 */
function shortDateFormat(d) {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const day = DAYS[d.getDay()];
  return `${yy}/${mm}/${dd}(${day})`;
}

/**
 * "YY/MM/DD(Day) HH:MM" format — matches Go's "06/01/02(Mon) 15:04"
 */
function shortDateTimeFormat(d) {
  const base = shortDateFormat(d);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${base} ${hh}:${mi}`;
}

/**
 * Format labels for display — mirrors lib/item.go:243-248 Item.LabelsString:
 *   if len == 0 -> ""
 *   else        -> "@" + strings.Join(names, ",@")   e.g. "@a,@b,@c"
 * Note the separator is ",@" with NO space after the comma.
 */
export function formatLabels(labelsJson) {
  try {
    const labels = JSON.parse(labelsJson || '[]');
    if (labels.length === 0) return '';
    return '@' + labels.join(',@');
  } catch {
    return '';
  }
}

/**
 * Parse labels_json to array.
 */
export function parseLabels(labelsJson) {
  try {
    return JSON.parse(labelsJson || '[]');
  } catch {
    return [];
  }
}

/**
 * Resolve project name by ID (raw name, no prefix).
 */
export function resolveProjectName(db, projectId) {
  const row = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
  return row ? row.name : 'Unknown';
}

/**
 * Format a project reference for display — mirrors format.go:88-105 ProjectFormat.
 * store.FindProject(id) returns nil for an empty or unknown id, in which case
 * the CLI prints the literal "Unknown" (no '#'); otherwise it prints "#"+name.
 */
export function projectFormat(db, projectId) {
  if (!projectId) return 'Unknown';
  const row = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
  return row ? '#' + row.name : 'Unknown';
}

/**
 * Resolve an item ID by prefix — mirrors lib/todoist.go:197-214
 * CompleteItemIDByPrefix. Returns the full id when exactly one active item
 * has that prefix; otherwise (no match or an ambiguous prefix) returns the
 * prefix unchanged. Never errors. Used by `modify` and `delete`.
 */
export function completeItemIDByPrefix(db, prefix) {
  const rows = db.prepare('SELECT id FROM items WHERE is_deleted = 0').all();
  let matchid = '';
  for (const row of rows) {
    if (String(row.id).startsWith(prefix)) {
      if (matchid !== '') return prefix; // ambiguous prefix -> return input
      matchid = String(row.id);
    }
  }
  return matchid !== '' ? matchid : prefix;
}

/**
 * Resolve section suffix for display (format.go:107-116).
 * Returns "/SectionName" if section exists, empty string otherwise.
 */
export function resolveSectionSuffix(db, sectionId) {
  if (!sectionId) return '';
  const row = db.prepare('SELECT name FROM sections WHERE id = ?').get(sectionId);
  return row ? '/' + row.name : '';
}

/**
 * Find project ID by name (case-sensitive). Mirrors lib/project.go:34-42
 * Projects.GetIDByName, which strips a single leading '#' before matching.
 */
export function findProjectByName(db, name) {
  const stripped = name.replace(/^#/, '');
  return db.prepare('SELECT id FROM projects WHERE name = ? AND is_deleted = 0').get(stripped);
}

/**
 * Find section ID by name — mirrors lib/section.go:27-34 Sections.GetIDByName,
 * which scans Active() sections (not deleted AND not archived) and returns the
 * first whose name matches and (projectID=="" OR ProjectID==projectID).
 */
export function findSectionByName(db, name, projectId) {
  if (projectId) {
    return db.prepare('SELECT id FROM sections WHERE name = ? AND project_id = ? AND is_deleted = 0 AND is_archived = 0 ORDER BY section_order ASC').get(name, projectId);
  }
  return db.prepare('SELECT id FROM sections WHERE name = ? AND is_deleted = 0 AND is_archived = 0 ORDER BY section_order ASC').get(name);
}

/**
 * Map user-facing priority (1=urgent..4=normal) to API priority (4=urgent..1=normal).
 * Mirrors add.go:12-17 priorityMapping (a Go map[int]int). The real CLI does
 * NOT validate the range: `item.Priority = priorityMapping[c.Int("priority")]`,
 * and a Go map lookup for an absent key yields the zero value 0. So an
 * out-of-range value such as --priority 7 or 0 stores API priority 0 (which
 * displays as "p0"), it is NOT clamped to a valid priority.
 */
export function mapUserPriorityToApi(userPriority) {
  const mapping = { 1: 4, 2: 3, 3: 2, 4: 1 };
  return mapping[userPriority] ?? 0;
}
