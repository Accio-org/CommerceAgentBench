// `todoist filters` — show all saved filters
// Source: filters.go (registered in main.go:407-413).
//
// Columns: ID, Name, Query, Favorite. Favorite is the literal "Y" when
// IsFavorite else "N" (filters.go:48-51). Deleted filters are skipped
// (filters.go:30) and the list is sorted by ItemOrder to preserve Todoist UI
// order (filters.go:43-45). The header row is ["ID", "Name", "Query",
// "Favorite"] (filters.go:16).

export function cmdFilters(db) {
  const rows = db
    .prepare('SELECT id, name, query, is_favorite FROM filters WHERE is_deleted = 0 ORDER BY item_order ASC')
    .all();
  return rows.map((f) => [f.id, f.name, f.query, f.is_favorite ? 'Y' : 'N']);
}

export const FILTERS_HEADER = ['ID', 'Name', 'Query', 'Favorite'];
