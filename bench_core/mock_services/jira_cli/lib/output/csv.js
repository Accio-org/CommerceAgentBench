/**
 * csv.js — CSV renderer with Go encoding/csv byte-parity.
 *
 * Upstream writes CSV via encoding/csv (csv.NewWriter), see
 * internal/view/helper.go:173-187 (renderCSV). That writer:
 *   - separates fields with a comma and terminates each record with "\n"
 *     (UseCRLF defaults to false);
 *   - quotes a field iff csv.Writer.fieldNeedsQuotes returns true:
 *       field != "" AND ( field == `\.`
 *                         OR contains '\n' | '\r' | '"' | ','
 *                         OR its first rune is unicode whitespace );
 *   - escapes an embedded `"` by doubling it (`"` -> `""`).
 */

function fieldNeedsQuotes(field) {
  if (field === "") return false;
  if (field === "\\.") return true; // Go: field == `\.`
  if (/[\n\r",]/.test(field)) return true;
  // First rune is whitespace (unicode.IsSpace). \n/\r already handled above.
  return /^\s/.test(field);
}

function escapeField(val) {
  const s = String(val ?? "");
  if (fieldNeedsQuotes(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Render rows as CSV (no trailing newline; caller appends "\n", which yields
 * the same record-per-line + trailing newline that csv.Writer produces).
 *
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {object} opts
 * @param {boolean} opts.noHeaders
 * @returns {string}
 */
export function renderCsv(headers, rows, opts = {}) {
  const lines = [];
  if (!opts.noHeaders) {
    lines.push(headers.map(escapeField).join(","));
  }
  for (const row of rows) {
    lines.push(row.map(escapeField).join(","));
  }
  return lines.join("\n");
}
