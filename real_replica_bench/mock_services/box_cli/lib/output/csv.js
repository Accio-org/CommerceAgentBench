// CSV output renderer for Box CLI mock
// Matches real CLI: standard CSV with dot-notation flattening for nested objects

/**
 * Flatten a nested object using dot notation.
 * { parent: { id: "1", name: "x" } } -> { "parent.id": "1", "parent.name": "x" }
 */
function flattenObject(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, fullKey));
    } else if (Array.isArray(value)) {
      result[fullKey] = value.map((v) =>
        typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
      ).join(';');
    } else {
      result[fullKey] = value === null || value === undefined ? '' : String(value);
    }
  }
  return result;
}

/**
 * Escape a CSV field (double-quote if needed).
 */
function escapeField(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Render data as CSV string.
 * Accepts a single object or an array of objects.
 */
export function renderCsv(data) {
  const items = Array.isArray(data) ? data : [data];
  if (items.length === 0) return '';

  const flatItems = items.map((item) => flattenObject(item));

  // Collect all unique keys across all items for header
  const allKeys = [];
  const seen = new Set();
  for (const item of flatItems) {
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key);
        allKeys.push(key);
      }
    }
  }

  const lines = [allKeys.map(escapeField).join(',')];
  for (const item of flatItems) {
    const row = allKeys.map((k) => escapeField(item[k] ?? ''));
    lines.push(row.join(','));
  }
  return lines.join('\n');
}
