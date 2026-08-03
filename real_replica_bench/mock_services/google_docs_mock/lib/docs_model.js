'use strict';

// ─── docs_model.js ────────────────────────────────────────────────────────────
// Google Docs API v1 index-space model for the google_docs_mock.
//
// THE INDEX MODEL (contract from scratch/docs/api_alignment/google_docs_workspace.md §3.6):
//   • The body is a flat UTF-16 code-unit index space (JS string.length).
//   • body.content[0] = sectionBreak element at [0,1).
//   • Editable content starts at index 1 (O1 fact-sheet).
//   • Each block i with text T occupies [startIndex, startIndex + (T+"\n").length).
//   • The trailing "\n" of each block is real and counts in the index.
//
// DEVIATIONS FROM REAL API (documented):
//   1. updateTextStyle applies style paragraph-granularly (per block), NOT at character
//      granularity. This is stored in block.format. The real API supports sub-run
//      styling via multiple ParagraphElement.textRun entries; the blocks[] model has
//      no sub-block runs.
//   2. HEADING_4, HEADING_5, HEADING_6 are accepted in updateParagraphStyle but stored
//      as raw namedStyleType strings in block.type (not mapped back to a blocks-native
//      type). They round-trip through blocksToDocument correctly using the raw string.
//   3. revisionId is a stable CRC32-based hash of the block content — not a sequential
//      counter. This ensures it changes when content changes and stays stable otherwise.
// ─────────────────────────────────────────────────────────────────────────────

const { invalidArgument } = require('./drive_validation');

// ── namedStyleType enum (§3.4 ParagraphStyle) ─────────────────────────────
const NAMED_STYLE_TYPES = new Set([
  'NAMED_STYLE_TYPE_UNSPECIFIED',
  'NORMAL_TEXT',
  'TITLE',
  'SUBTITLE',
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'HEADING_4',
  'HEADING_5',
  'HEADING_6'
]);

// Map from blocks-native type → namedStyleType
function blockTypeToNamedStyle(blockType) {
  switch (blockType) {
    case 'heading1': return 'HEADING_1';
    case 'heading2': return 'HEADING_2';
    case 'heading3': return 'HEADING_3';
    case 'subtitle': return 'SUBTITLE';
    case 'title':    return 'TITLE';
    // HEADING_4..6 stored as raw strings in block.type (deviation #2)
    case 'HEADING_4': return 'HEADING_4';
    case 'HEADING_5': return 'HEADING_5';
    case 'HEADING_6': return 'HEADING_6';
    default:         return 'NORMAL_TEXT';
  }
}

// Map from namedStyleType → blocks-native type (for updateParagraphStyle)
function namedStyleToBlockType(namedStyleType) {
  switch (namedStyleType) {
    case 'HEADING_1': return 'heading1';
    case 'HEADING_2': return 'heading2';
    case 'HEADING_3': return 'heading3';
    case 'SUBTITLE':  return 'subtitle';
    case 'TITLE':     return 'title';
    // HEADING_4..6: store as raw string in block.type (deviation #2)
    case 'HEADING_4': return 'HEADING_4';
    case 'HEADING_5': return 'HEADING_5';
    case 'HEADING_6': return 'HEADING_6';
    default:          return 'paragraph'; // NORMAL_TEXT + UNSPECIFIED
  }
}

// ── CRC32 for stable revisionId ────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, idx) => {
  let v = idx;
  for (let b = 0; b < 8; b++) v = v & 1 ? (0xedb88320 ^ (v >>> 1)) : (v >>> 1);
  return v >>> 0;
});

function crc32(str) {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    crc = CRC_TABLE[(crc ^ (code & 0xff)) & 0xff] ^ (crc >>> 8);
    if (code > 0xff) crc = CRC_TABLE[(crc ^ ((code >> 8) & 0xff)) & 0xff] ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function revisionIdFor(file) {
  const blocks = (file.content && file.content.blocks) || [];
  const digest = blocks.map((b) => `${b.type}|${b.text || ''}`).join('\n');
  return `rev-${crc32(digest)}`;
}

// ── Build index layout from blocks ────────────────────────────────────────
// Returns array of {startIndex, endIndex, blockIndex} — one entry per block.
// The leading sectionBreak occupies [0,1); first block starts at index 1.
function buildLayout(blocks) {
  let cur = 1; // editable content starts at index 1 (O1)
  return blocks.map((block, i) => {
    const text = typeof block.text === 'string' ? block.text : '';
    const len = (text + '\n').length; // UTF-16 length (JS string.length)
    const entry = { startIndex: cur, endIndex: cur + len, blockIndex: i };
    cur += len;
    return entry;
  });
}

// ── blocksToDocument(file) → Document ─────────────────────────────────────
// Converts the blocks[] model to a real-shaped Docs API v1 Document.
// Contract per task spec §"THE INDEX MODEL".
function blocksToDocument(file) {
  const blocks = (file.content && file.content.blocks) || [];
  const layout = buildLayout(blocks);

  // body.content[0] = leading sectionBreak element at [0,1)
  const content = [
    {
      endIndex: 1,
      sectionBreak: {
        sectionStyle: {
          columnSeparatorStyle: 'NONE',
          contentDirection: 'LEFT_TO_RIGHT'
        }
      }
    }
  ];

  // One paragraph StructuralElement per block
  blocks.forEach((block, i) => {
    const { startIndex, endIndex } = layout[i];
    const text = typeof block.text === 'string' ? block.text : '';
    const content_ = text + '\n';
    const namedStyleType = blockTypeToNamedStyle(block.type || 'paragraph');

    content.push({
      startIndex,
      endIndex,
      paragraph: {
        elements: [
          {
            startIndex,
            endIndex,
            textRun: {
              content: content_,
              textStyle: block.format && typeof block.format === 'object' ? { ...block.format } : {}
            }
          }
        ],
        paragraphStyle: {
          namedStyleType
        }
      }
    });
  });

  return {
    documentId: file.id,
    title: (file.content && file.content.title) || file.name || 'Untitled document',
    revisionId: revisionIdFor(file),
    body: { content }
  };
}

// ── locate(file, index) → {blockIndex, offset} ────────────────────────────
// Find the block whose [startIndex,endIndex) covers `index`.
// offset = index - startIndex (into T+"\n").
// Out-of-range → throw INVALID_ARGUMENT.
function locate(file, index) {
  const blocks = (file.content && file.content.blocks) || [];
  if (blocks.length === 0) {
    throw invalidArgument(
      `Index ${index} is out of range: document has no content blocks.`,
      'indexOutOfRange'
    );
  }
  const layout = buildLayout(blocks);
  const totalEnd = layout[layout.length - 1].endIndex;

  // index 0 = section break (not editable)
  if (index < 1) {
    throw invalidArgument(
      `Index ${index} is before the first editable position (index 1). Index 0 is the implicit section break.`,
      'indexOutOfRange'
    );
  }
  if (index >= totalEnd) {
    throw invalidArgument(
      `Index ${index} is out of range (document ends at ${totalEnd}).`,
      'indexOutOfRange'
    );
  }

  for (const entry of layout) {
    if (index >= entry.startIndex && index < entry.endIndex) {
      return { blockIndex: entry.blockIndex, offset: index - entry.startIndex };
    }
  }

  throw invalidArgument(
    `Index ${index} could not be mapped to any block (totalEnd=${totalEnd}).`,
    'indexOutOfRange'
  );
}

// ── applyInsertText(file, {index}, text) ──────────────────────────────────
// Insert text at index. If text contains "\n", splits blocks accordingly.
// Mutates file.content.blocks.
function applyInsertText(file, location, text) {
  if (!file.content) file.content = { title: '', blocks: [] };
  if (!Array.isArray(file.content.blocks)) file.content.blocks = [];

  const blocks = file.content.blocks;
  const insertIndex = location && location.index != null ? Number(location.index) : null;

  // index null/undefined → reject (endOfSegmentLocation not checked here;
  // handled at callsite if needed; require explicit index)
  if (insertIndex === null || !Number.isFinite(insertIndex)) {
    throw invalidArgument('insertText requires location.index', 'missingIndex');
  }
  if (typeof text !== 'string') {
    throw invalidArgument('insertText requires a text string', 'missingText');
  }

  // Empty document: only section break at [0,1). Insert at 1 = append first block.
  if (blocks.length === 0) {
    if (insertIndex !== 1) {
      throw invalidArgument(
        `Index ${insertIndex} is out of range: document has no content blocks (only index 1 is valid for empty doc).`,
        'indexOutOfRange'
      );
    }
    // Split text on \n and create blocks
    const parts = text.split('\n');
    parts.forEach((part) => {
      blocks.push({ id: _makeId('b'), type: 'paragraph', text: part, format: {} });
    });
    return;
  }

  const { blockIndex, offset } = locate(file, insertIndex);
  const block = blocks[blockIndex];
  const blockText = typeof block.text === 'string' ? block.text : '';

  // The offset within T+"\n": if offset == blockText.length, we're at the \n position
  // We insert into the text portion (before the implicit \n)
  const insertAt = Math.min(offset, blockText.length);
  const before = blockText.slice(0, insertAt);
  const after = blockText.slice(insertAt);
  const combined = before + text + after;

  // Split on \n to produce new blocks
  const parts = combined.split('\n');
  // The last part replaces the current block's text (it stays as the current block)
  block.text = parts[0];
  // Additional parts become new blocks inserted after blockIndex
  const newBlocks = parts.slice(1).map((part, i) => ({
    id: _makeId('b'),
    type: block.type, // inherit type from split block
    text: part,
    format: { ...(block.format || {}) }
  }));
  if (newBlocks.length > 0) {
    blocks.splice(blockIndex + 1, 0, ...newBlocks);
  }
}

// ── applyDeleteContentRange(file, {startIndex, endIndex}) ─────────────────
// Delete chars in [startIndex, endIndex) across blocks.
// Merge partial blocks; drop blocks fully consumed (including their newline).
// Reject deleting into the section break (index < 1).
function applyDeleteContentRange(file, range) {
  if (!file.content || !Array.isArray(file.content.blocks)) return;
  const blocks = file.content.blocks;
  const start = Number(range.startIndex);
  const end = Number(range.endIndex);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw invalidArgument(
      `deleteContentRange: invalid range [${start}, ${end}).`,
      'invalidRange'
    );
  }
  if (start < 1) {
    throw invalidArgument(
      `deleteContentRange: cannot delete into the section break (startIndex ${start} < 1).`,
      'indexOutOfRange'
    );
  }
  if (blocks.length === 0) {
    throw invalidArgument(
      `deleteContentRange: document has no content blocks.`,
      'indexOutOfRange'
    );
  }

  const layout = buildLayout(blocks);
  const totalEnd = layout[layout.length - 1].endIndex;

  if (end > totalEnd) {
    throw invalidArgument(
      `deleteContentRange: endIndex ${end} exceeds document end ${totalEnd}.`,
      'indexOutOfRange'
    );
  }

  // Find first and last block overlapping [start, end)
  let firstBlock = -1;
  let lastBlock = -1;
  for (let i = 0; i < layout.length; i++) {
    const { startIndex: bs, endIndex: be } = layout[i];
    if (be > start && bs < end) {
      if (firstBlock < 0) firstBlock = i;
      lastBlock = i;
    }
  }

  if (firstBlock < 0) return; // nothing to delete

  if (firstBlock === lastBlock) {
    // Deletion within a single block
    const { startIndex: bs } = layout[firstBlock];
    const block = blocks[firstBlock];
    const text = typeof block.text === 'string' ? block.text : '';
    const delStart = start - bs;
    const delEnd = end - bs;

    if (delEnd > text.length) {
      // The range covers the trailing \n — this block gets merged with next
      // Remove this block's suffix + the newline, prepend remaining to next block
      const keepBefore = text.slice(0, Math.max(0, delStart));
      if (firstBlock + 1 < blocks.length) {
        const nextBlock = blocks[firstBlock + 1];
        const nextText = typeof nextBlock.text === 'string' ? nextBlock.text : '';
        const cutFromNext = Math.max(0, delEnd - text.length - 1); // -1 for the \n
        block.text = keepBefore + nextText.slice(cutFromNext);
        blocks.splice(firstBlock + 1, 1);
      } else {
        // Last block: just trim
        block.text = keepBefore;
      }
    } else {
      // Entirely within the text portion (before \n)
      block.text = text.slice(0, Math.max(0, delStart)) + text.slice(delEnd);
    }
    return;
  }

  // Multi-block deletion
  const firstBlockEntry = layout[firstBlock];
  const lastBlockEntry = layout[lastBlock];
  const firstBlockObj = blocks[firstBlock];
  const lastBlockObj = blocks[lastBlock];
  const firstText = typeof firstBlockObj.text === 'string' ? firstBlockObj.text : '';
  const lastText = typeof lastBlockObj.text === 'string' ? lastBlockObj.text : '';

  // What remains of the first block (before deletion start)
  const keepFromFirst = firstText.slice(0, start - firstBlockEntry.startIndex);
  // What remains of the last block (after deletion end)
  const lastDelEnd = end - lastBlockEntry.startIndex;
  const keepFromLast = lastDelEnd > lastText.length
    ? '' // entire last block consumed including its \n
    : lastText.slice(lastDelEnd);

  // Merge kept portions into first block
  firstBlockObj.text = keepFromFirst + keepFromLast;

  // If lastDelEnd > lastText.length, the last block's \n was deleted:
  // the first block now takes over the last block (already merged above)
  // and we remove everything in between + the last block.
  const removeCount = lastBlock - firstBlock + (lastDelEnd > lastText.length ? 1 : 0);
  if (removeCount > 0) {
    blocks.splice(firstBlock + 1, removeCount);
  }
}

// ── applyReplaceAllText(file, {text, matchCase}, replaceText) ─────────────
// Replace all occurrences. Returns occurrencesChanged count.
// matchCase honored.
function applyReplaceAllText(file, containsText, replaceText) {
  if (!file.content || !Array.isArray(file.content.blocks)) return 0;
  const find = String(containsText && containsText.text != null ? containsText.text : '');
  const replace = String(replaceText != null ? replaceText : '');
  const matchCase = Boolean(containsText && containsText.matchCase);
  if (!find) return 0;

  const flags = matchCase ? 'g' : 'gi';
  const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

  let total = 0;
  for (const block of file.content.blocks) {
    if (typeof block.text !== 'string') continue;
    const newText = block.text.replace(pattern, () => { total++; return replace; });
    block.text = newText;
  }
  return total;
}

// ── applyUpdateTextStyle(file, {startIndex,endIndex}, textStyle, fields) ──
// fields mask REQUIRED (missing/empty → throw INVALID_ARGUMENT).
// DEVIATION: applies style paragraph-granularly (per block), not character-granularly.
// Stores merged fields under block.format.
function applyUpdateTextStyle(file, range, textStyle, fields) {
  if (!fields || typeof fields !== 'string' || !fields.trim()) {
    throw invalidArgument(
      'updateTextStyle: fields FieldMask is required and must not be empty.',
      'missingFieldsMask'
    );
  }
  if (!file.content || !Array.isArray(file.content.blocks)) return;
  const blocks = file.content.blocks;
  if (blocks.length === 0) return;

  const start = Number(range.startIndex);
  const end = Number(range.endIndex);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw invalidArgument(
      `updateTextStyle: invalid range [${start}, ${end}).`,
      'invalidRange'
    );
  }

  const layout = buildLayout(blocks);

  // The fields mask specifies which subfields of textStyle to apply.
  const fieldSet = new Set(fields.split(',').map((f) => f.trim()).filter(Boolean));

  for (let i = 0; i < layout.length; i++) {
    const { startIndex: bs, endIndex: be } = layout[i];
    // Block overlaps range if its range [bs, be) intersects [start, end)
    if (be <= start || bs >= end) continue;

    const block = blocks[i];
    if (!block.format || typeof block.format !== 'object') block.format = {};

    // Apply only the fields listed in the mask
    for (const field of fieldSet) {
      if (Object.prototype.hasOwnProperty.call(textStyle, field)) {
        block.format[field] = textStyle[field];
      }
    }
  }
}

// ── applyUpdateParagraphStyle(file, {startIndex,endIndex}, paragraphStyle, fields) ──
// fields REQUIRED. If paragraphStyle.namedStyleType present, validate ∈ NAMED_STYLE_TYPES.
// Sets each overlapped block's type via reverse map.
function applyUpdateParagraphStyle(file, range, paragraphStyle, fields) {
  if (!fields || typeof fields !== 'string' || !fields.trim()) {
    throw invalidArgument(
      'updateParagraphStyle: fields FieldMask is required and must not be empty.',
      'missingFieldsMask'
    );
  }
  if (!file.content || !Array.isArray(file.content.blocks)) return;
  const blocks = file.content.blocks;
  if (blocks.length === 0) return;

  const start = Number(range.startIndex);
  const end = Number(range.endIndex);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw invalidArgument(
      `updateParagraphStyle: invalid range [${start}, ${end}).`,
      'invalidRange'
    );
  }

  // Validate namedStyleType if present
  const namedStyleType = paragraphStyle && paragraphStyle.namedStyleType;
  if (namedStyleType !== undefined && namedStyleType !== null) {
    if (!NAMED_STYLE_TYPES.has(String(namedStyleType))) {
      throw invalidArgument(
        `updateParagraphStyle: invalid namedStyleType '${namedStyleType}'. ` +
        `Valid values: ${[...NAMED_STYLE_TYPES].join(', ')}.`,
        'invalidNamedStyleType'
      );
    }
  }

  const layout = buildLayout(blocks);
  const fieldSet = new Set(fields.split(',').map((f) => f.trim()).filter(Boolean));

  for (let i = 0; i < layout.length; i++) {
    const { startIndex: bs, endIndex: be } = layout[i];
    if (be <= start || bs >= end) continue;

    const block = blocks[i];

    if (namedStyleType !== undefined && fieldSet.has('namedStyleType')) {
      block.type = namedStyleToBlockType(namedStyleType);
    }

    // Apply other paragraphStyle fields to block.format
    if (paragraphStyle) {
      if (!block.format || typeof block.format !== 'object') block.format = {};
      for (const field of fieldSet) {
        if (field === 'namedStyleType') continue; // handled above
        if (Object.prototype.hasOwnProperty.call(paragraphStyle, field)) {
          block.format[field] = paragraphStyle[field];
        }
      }
    }
  }
}

// ── internal id generator (minimised copy, avoids circular dep on server.js) ─
let _idCounter = 0;
function _makeId(prefix) {
  _idCounter++;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  blocksToDocument,
  locate,
  applyInsertText,
  applyDeleteContentRange,
  applyReplaceAllText,
  applyUpdateTextStyle,
  applyUpdateParagraphStyle,
  // exported for tests / server.js revisionId
  revisionIdFor,
  NAMED_STYLE_TYPES,
  blockTypeToNamedStyle,
  namedStyleToBlockType
};
