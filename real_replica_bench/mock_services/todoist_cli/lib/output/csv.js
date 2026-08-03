// CSV output — mirrors Go's encoding/csv writer (main.go:273, default
// Comma=',' and UseCRLF=false). Activated by the global --csv flag.

/**
 * Decide whether a field needs quoting, faithfully porting Go's
 * (*csv.Writer).fieldNeedsQuotes: a non-empty field is quoted iff it equals
 * the literal `\.`, contains '"', ',', '\r' or '\n', or begins with a space
 * (Unicode whitespace). An empty field is never quoted.
 */
function fieldNeedsQuotes(str) {
  if (str === '') return false;
  if (str === '\\.') return true;
  if (/["\r\n,]/.test(str)) return true;
  return /^\s/.test(str);
}

/**
 * Escape a CSV field: quote per Go rules, doubling internal quotes.
 */
function escapeField(s) {
  const str = String(s ?? '');
  if (fieldNeedsQuotes(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Write rows as CSV to stdout.
 * @param {string[][]} rows
 * @param {object} opts
 * @param {boolean} opts.header
 * @param {string[]} opts.headerRow
 */
export function writeCSV(rows, opts = {}) {
  const lines = [];

  if (opts.header && opts.headerRow) {
    lines.push(opts.headerRow.map(escapeField).join(','));
  }

  for (const row of rows) {
    lines.push(row.map(escapeField).join(','));
  }

  if (lines.length > 0) {
    process.stdout.write(lines.join('\n') + '\n');
  }
}
