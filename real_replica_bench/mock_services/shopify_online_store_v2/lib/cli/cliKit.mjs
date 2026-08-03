// cli-kit-style ANSI box renderer.
//
// Replicates the visual shape of @shopify/cli-kit's renderInfo/renderSuccess/
// renderWarning/renderError on the non-TTY (no-color) code path:
//
//   ╭─ {label} ──────────────...─╮
//   │                            │
//   │  <content rows...>         │
//   │                            │
//   ╰────────────────────────────╯
//   [1] https://link-footnote-1
//   [2] https://link-footnote-2
//
// All boxes are exactly 80 columns wide (matching cli-kit's defaultWidth).
// Output is always plain text — no ANSI escape sequences — because real CLI
// strips them when stdout/stderr is piped. CJK / fullwidth characters count
// as 2 columns for padding calculations.
//
// The renderer is intentionally narrow in scope: it covers the shapes our
// 10 theme subcommands need (key/value sections, bullet lists, paragraph
// wraps, link footnotes). It is NOT a general-purpose cli-kit clone.

const BOX_WIDTH = 80;
const CONTENT_WIDTH = BOX_WIDTH - 2;           // 78 — between │ pipes
const TEXT_AREA_WIDTH = CONTENT_WIDTH - 2;     // 76 — after the 2-space pad
const KEY_VALUE_PAD = 2;                       // extra cells after the longest key

// East Asian Width approximation. Returns 2 for fullwidth (CJK, Hiragana,
// Katakana, fullwidth ASCII, Hangul Syllables, common emoji), else 1.
function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff)
  ) {
    return 2;
  }
  return 1;
}

export function stringWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0));
  return w;
}

function padRight(s, target) {
  const w = stringWidth(s);
  if (w >= target) return s;
  return s + ' '.repeat(target - w);
}

function topBorder(label) {
  // ╭─ {label} ───...─╮ = 80 cells total.
  // ╭(1) + ─(1) + space(1) + label + space(1) + ─×N + ╮(1) = 80
  // N = 80 - 5 - len(label)
  const fillCount = BOX_WIDTH - 5 - label.length;
  return `╭─ ${label} ${'─'.repeat(Math.max(0, fillCount))}╮`;
}

function bottomBorder() {
  return `╰${'─'.repeat(CONTENT_WIDTH)}╯`;
}

function blankRow() {
  return `│${' '.repeat(CONTENT_WIDTH)}│`;
}

// Build a content row from text that already fits in TEXT_AREA_WIDTH cells.
function contentRow(text) {
  const padded = padRight(text, TEXT_AREA_WIDTH);
  return `│  ${padded}│`;
}

// Word-wrap a paragraph to TEXT_AREA_WIDTH cells, breaking on whitespace.
// Long words are split mid-character to avoid overflowing the box.
export function wrapToTextArea(text, width = TEXT_AREA_WIDTH) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/(\s+)/);
    let line = '';
    for (const piece of words) {
      if (piece === '') continue;
      const lineW = stringWidth(line);
      const pieceW = stringWidth(piece);
      if (lineW + pieceW <= width) {
        line += piece;
        continue;
      }
      // Doesn't fit. If this piece is whitespace, drop it at line boundary.
      if (/^\s+$/.test(piece)) {
        if (line) lines.push(line);
        line = '';
        continue;
      }
      // Try wrapping: flush current line if non-empty, then start with piece.
      if (line) {
        lines.push(line);
        line = '';
      }
      // If the piece itself overflows, hard-split.
      if (pieceW > width) {
        let remaining = piece;
        while (stringWidth(remaining) > width) {
          let cut = 0;
          let cw = 0;
          for (const ch of remaining) {
            const w = charWidth(ch.codePointAt(0));
            if (cw + w > width) break;
            cw += w;
            cut += ch.length;
          }
          lines.push(remaining.slice(0, cut));
          remaining = remaining.slice(cut);
        }
        line = remaining;
      } else {
        line = piece;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

// Render a key/value section: keys are padded into a fixed column, values
// wrap onto continuation lines that keep the key column blank.
function renderKeyValueSection(rows) {
  const keyColWidth = Math.max(...rows.map(([k]) => stringWidth(k))) + KEY_VALUE_PAD;
  const valueWidth = TEXT_AREA_WIDTH - keyColWidth;
  const out = [];
  for (const [key, value] of rows) {
    const keyStr = padRight(key, keyColWidth);
    const valueText = value == null ? '' : String(value);
    const wrapped = wrapToTextArea(valueText, valueWidth);
    out.push(contentRow(keyStr + wrapped[0]));
    for (let i = 1; i < wrapped.length; i += 1) {
      out.push(contentRow(' '.repeat(keyColWidth) + wrapped[i]));
    }
  }
  return out;
}

// Render the box. `sections` is an array of:
//   { title?: string, rows?: [[key, value], ...], bullets?: string[], text?: string }
// `links` is an array of URLs; they appear AS-IS below the box with [N] prefix.
export function renderBox(label, sections, links = []) {
  const lines = [topBorder(label), blankRow()];
  for (let i = 0; i < sections.length; i += 1) {
    if (i > 0) lines.push(blankRow());
    const section = sections[i];
    if (section.title) {
      for (const wrapped of wrapToTextArea(section.title)) {
        lines.push(contentRow(wrapped));
      }
    }
    if (section.rows && section.rows.length) {
      lines.push(...renderKeyValueSection(section.rows));
    }
    if (section.bullets && section.bullets.length) {
      const bulletIndent = '  • ';
      const continuation = '    ';
      for (const bullet of section.bullets) {
        const wrapped = wrapToTextArea(bullet, TEXT_AREA_WIDTH - bulletIndent.length);
        lines.push(contentRow(bulletIndent + wrapped[0]));
        for (let j = 1; j < wrapped.length; j += 1) {
          lines.push(contentRow(continuation + wrapped[j]));
        }
      }
    }
    if (section.text) {
      for (const wrapped of wrapToTextArea(section.text)) {
        lines.push(contentRow(wrapped));
      }
    }
  }
  lines.push(blankRow(), bottomBorder());
  let out = `${lines.join('\n')}\n`;
  if (links.length) {
    out += `${links.map((url, idx) => `[${idx + 1}] ${url}`).join('\n')}\n`;
  }
  // cli-kit always appends a trailing blank line after the box (and after
  // link footnotes if present); preserves the spacing real CLI emits.
  return `${out}\n`;
}

// Convenience wrappers — match cli-kit's named renderers.
export function renderInfo(sections, links) {
  return renderBox('info', sections, links);
}
export function renderSuccess(sections, links) {
  return renderBox('success', sections, links);
}
export function renderWarning(sections, links) {
  return renderBox('warning', sections, links);
}
export function renderError(sections, links) {
  return renderBox('error', sections, links);
}

// Multi-column table renderer for `theme list` plain output. Mirrors
// cli-kit's renderTable on the non-TTY code path:
//   header row + dash underline row + data rows, columns separated by "  ",
//   each column padded to its observed max width (or a min if specified).
export function renderTable({ columns, rows }) {
  const widths = columns.map((col, idx) => {
    const dataMax = rows.reduce((max, row) => {
      return Math.max(max, stringWidth(String(row[idx] ?? '')));
    }, 0);
    return Math.max(col.minWidth ?? 0, stringWidth(col.header), dataMax);
  });
  const headerLine = columns
    .map((col, idx) => padRight(col.header, widths[idx]))
    .join('  ');
  const dashLine = widths.map((w) => '─'.repeat(w)).join('  ');
  const dataLines = rows.map((row) =>
    columns.map((_col, idx) => padRight(String(row[idx] ?? ''), widths[idx])).join('  '),
  );
  const allLines = [headerLine, dashLine, ...dataLines];
  // Wrap in a single-section renderInfo so the table sits inside the same box.
  return renderBox(
    'info',
    [{ text: allLines.join('\n') }],
  );
}
