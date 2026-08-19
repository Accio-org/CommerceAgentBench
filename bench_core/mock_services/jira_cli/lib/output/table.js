/**
 * table.js — Plain-text table renderer with Go text/tabwriter byte-parity.
 *
 * Upstream renders plain issue/project/board/sprint tables through
 * Go's text/tabwriter, constructed as:
 *
 *     tabwriter.NewWriter(os.Stdout, 0, 8, 1, '\t', 0)
 *       minwidth=0, tabwidth=8, padding=1, padchar='\t', flags=0
 *
 *   internal/view/issues.go:54, internal/view/helper.go:26 (tabWidth=8),
 *   internal/view/{project,board,sprint,release,serverinfo}.go (same params).
 *
 * Rows are fed via internal/view/helper.go:renderPlain — cells joined by the
 * delimiter, one fmt.Fprintln per row (so output ends with a trailing newline;
 * that final "\n" is added by the command callers here).
 *
 * Because padchar == '\t', upstream pads with LITERAL TAB characters (not
 * spaces) and treats a tab as `tabwidth` columns wide. Faithful algorithm
 * (text/tabwriter writePadding + format):
 *   - cells are split on '\t'; the LAST cell on a line is the trailing,
 *     newline-terminated cell and is NEVER padded.
 *   - for each aligned column j (all but the last): column width
 *       W_j = max(minwidth, max_rows(runeLen(cell)) + padding)   = maxlen+1
 *     rounded UP to a multiple of tabwidth:  Wr_j = ceil(W_j/8)*8
 *   - each cell in column j is emitted as: <text> + ceil((Wr_j - runeLen)/8) tabs
 *
 * With a non-tab delimiter (plain mode + --delimiter X), upstream still pipes
 * through the tabwriter but the rows contain no tabs, so there is no alignment:
 * output is just the rows joined by X. We mirror that.
 */

const TABWIDTH = 8;
const PADDING = 1;
const MINWIDTH = 0;

function runeLen(s) {
  // Go tabwriter measures cell width in runes (utf8.RuneCount); flags=0 so no
  // ANSI-escape stripping. Code-point count matches for the data we render.
  return [...String(s ?? "")].length;
}

/**
 * Render rows as a plain-text table.
 *
 * @param {string[]} headers - Column header names
 * @param {string[][]} rows - Array of row arrays (same length as headers)
 * @param {object} opts
 * @param {boolean} opts.noHeaders - Skip header row
 * @param {string}  opts.delimiter - Column separator (default "\t")
 * @returns {string} Formatted table (no trailing newline; caller appends "\n")
 */
export function renderTable(headers, rows, opts = {}) {
  const delim = opts.delimiter ?? "\t";
  const showHeaders = !opts.noHeaders;

  if (delim === "\t") {
    return renderAligned(headers, rows, showHeaders);
  }

  // Custom delimiter: no tab alignment (tabwriter sees a single trailing cell).
  const lines = [];
  if (showHeaders) lines.push(headers.join(delim));
  for (const row of rows) lines.push(row.join(delim));
  return lines.join("\n");
}

/**
 * Go text/tabwriter alignment with padchar='\t', tabwidth=8, padding=1.
 */
function renderAligned(headers, rows, showHeaders) {
  const allRows = showHeaders ? [headers, ...rows] : rows;
  if (allRows.length === 0) return "";

  const numCols = headers.length;

  // Column widths for the aligned columns (every column except the last, which
  // is the trailing newline-terminated cell and is never padded).
  const widths = [];
  for (let j = 0; j < numCols - 1; j++) {
    let maxw = 0;
    for (const row of allRows) {
      const w = runeLen(row[j]);
      if (w > maxw) maxw = w;
    }
    const col = Math.max(MINWIDTH, maxw + PADDING);
    // Round up to the next multiple of tabwidth (writePadding: cellw rounding).
    widths.push(Math.ceil(col / TABWIDTH) * TABWIDTH);
  }

  const lines = [];
  for (const row of allRows) {
    let line = "";
    for (let j = 0; j < numCols; j++) {
      const cell = String(row[j] ?? "");
      line += cell;
      if (j < numCols - 1) {
        const n = widths[j] - runeLen(cell);
        line += "\t".repeat(Math.ceil(n / TABWIDTH));
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}
