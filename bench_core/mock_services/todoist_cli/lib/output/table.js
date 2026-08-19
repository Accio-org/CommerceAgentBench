// Aligned tab output — faithful port of Go's text/tabwriter.
//
// Upstream sachaos/todoist builds its default (non-CSV) writer with
//   text/tabwriter.NewWriter(os.Stdout, 0, 4, 1, ' ', 0)
//   (minwidth=0, tabwidth=4, padding=1, padchar=' ', flags=0)
// and feeds it rows joined by '\t' + '\n' (utils.go NewTSVWriter / Writer.Write,
// list.go/show.go/projects.go/labels.go/sections.go/completed.go/filters.go).
//
// With padchar=' ' the tabwidth parameter is irrelevant (it only affects
// tab-based padding). Each tab-terminated cell is space-padded to
// (max rune width in its column + padding); the trailing cell on each line
// (the text after the last tab, before the newline) is NOT part of a column
// and is written verbatim. This module reproduces that algorithm exactly,
// including the elastic-tabstops column-block behaviour, so output is
// byte-identical to the real CLI.

const MINWIDTH = 0;
const PADDING = 1;
const PADCHAR = ' ';

// Rune (code point) count, matching Go's utf8.RuneCount.
function runeLen(s) {
  return Array.from(s).length;
}

// Parse `text` into the same line/cell structure Go's tabwriter builds and
// format it. `text` is the concatenation of every record ("c0\tc1\t...\n").
// Returns the formatted string.
function tabFormat(text) {
  const groups = []; // each group is an array of lines; each line is array of {s,width,htab}
  let lines = [[]];
  let cur = '';

  const pushCell = (htab) => {
    const line = lines[lines.length - 1];
    line.push({ s: cur, width: runeLen(cur), htab });
    cur = '';
    return line.length;
  };

  for (const ch of text) {
    if (ch === '\t') {
      pushCell(true); // htab-terminated cell
    } else if (ch === '\v') {
      pushCell(false); // soft tab: cell terminator, not a line break
    } else if (ch === '\n' || ch === '\f') {
      const ncells = pushCell(false);
      lines.push([]); // addLine
      if (ch === '\f' || ncells === 1) {
        // A line with a single cell has no impact on the formatting of
        // following lines (the trailing cell is ignored by format), so the
        // writer flushes — the line block ends here.
        groups.push(lines);
        lines = [[]];
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) {
    pushCell(false); // leftover incomplete cell at EOF
  }
  groups.push(lines);

  const out = [];
  for (const g of groups) {
    formatGroup(g, out);
  }
  return out.join('');
}

function formatGroup(lines, out) {
  format(lines, out, 0, lines.length, []);
}

// Faithful port of tabwriter.format: widths is the stack of already-determined
// column widths to the left of the current column.
function format(lines, out, line0, line1, widths) {
  const column = widths.length;
  let cursor = line0;
  while (cursor < line1) {
    const line = lines[cursor];
    if (column >= line.length - 1) {
      cursor++;
      continue;
    }
    // A cell exists in this column on this line: a column block begins.
    writeLines(lines, out, line0, cursor, widths);
    line0 = cursor;

    let width = MINWIDTH;
    while (cursor < line1) {
      const ln = lines[cursor];
      if (column >= ln.length - 1) break;
      const c = ln[column];
      if (c.width + PADDING > width) width = c.width + PADDING;
      cursor++;
    }

    widths.push(width);
    format(lines, out, line0, cursor, widths);
    widths.pop();
    line0 = cursor;
    cursor++; // mirrors the for-loop post-statement in Go
  }
  writeLines(lines, out, line0, line1, widths);
}

function writeLines(lines, out, line0, line1, widths) {
  for (let i = line0; i < line1; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      // Left-aligned (AlignRight not set): content first, then padding.
      out.push(c.s);
      if (j < widths.length) {
        const pad = widths[j] - c.width;
        if (pad > 0) out.push(PADCHAR.repeat(pad));
      }
    }
    if (i + 1 !== lines.length) {
      out.push('\n');
    }
    // When this is the last buffered line there is no newline (Go writes only
    // the outstanding incomplete cell, which we have already emitted as the
    // trailing cell). todoist always terminates records with '\n', so the
    // final buffered line is empty and produces nothing.
  }
}

/**
 * Write rows as an aligned table to stdout (byte-identical to Go tabwriter).
 * @param {string[][]} rows - array of string arrays
 * @param {object} opts
 * @param {boolean} opts.header - whether headerRow should be prepended
 * @param {string[]} opts.headerRow - column names
 */
export function writeTSV(rows, opts = {}) {
  const allRows = [];
  if (opts.header && opts.headerRow) {
    allRows.push(opts.headerRow);
  }
  for (const r of rows) allRows.push(r);

  if (allRows.length === 0) return;

  // Reproduce the byte stream fed to the real tabwriter: each record is its
  // cells joined by '\t' followed by '\n' (utils.go Writer.Write -> Fprintln).
  const text = allRows.map((r) => r.map((c) => String(c ?? '')).join('\t') + '\n').join('');
  process.stdout.write(tabFormat(text));
}

/**
 * Write key-value pairs (for `show`). Upstream show.go feeds [key, value]
 * records through the same global tabwriter, so the keys form an aligned
 * column and values are the trailing (unpadded) cells.
 */
export function writeKV(pairs) {
  if (!pairs || pairs.length === 0) return;
  const text = pairs.map(([k, v]) => `${k}\t${v ?? ''}\n`).join('');
  process.stdout.write(tabFormat(text));
}
