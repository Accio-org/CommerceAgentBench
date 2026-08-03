// `todoist labels` — list all labels
// Source: labels.go

export function cmdLabels(db) {
  const rows = db.prepare('SELECT id, name FROM labels WHERE is_deleted = 0 ORDER BY item_order ASC').all();
  // labels.go:23 — name is prefixed with "@"
  return rows.map(r => [r.id, '@' + r.name]);
}

export const LABELS_HEADER = ['ID', 'Name'];
