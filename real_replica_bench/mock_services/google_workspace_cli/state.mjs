// Tool implementations for the Google Workspace mock.
// All reads/writes go through bun:sqlite.
// Usage: const { tools, mutations, getState, reset } = createState(db);

import { auditLog, resetDb as dbReset } from './lib/db.mjs';

// --- ID handling (mirrors workspace IdUtils.extractDocId) ---

const DOC_ID_REGEX = /\/d\/([a-zA-Z0-9-_]+)/;

export function extractDocId(input) {
  if (!input || typeof input !== 'string') return undefined;
  const match = input.match(DOC_ID_REGEX);
  return match ? match[1] : undefined;
}

// --- A1 notation ---

export function colLetterToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToColLetter(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function parseA1(range) {
  let sheetName;
  let cellPart = range;
  const bangIdx = range.indexOf('!');
  if (bangIdx !== -1) {
    sheetName = range.slice(0, bangIdx).replace(/^'|'$/g, '');
    cellPart = range.slice(bangIdx + 1);
  }
  if (!cellPart) return { sheetName, startRow: 0, startCol: 0, endRow: null, endCol: null, sheetOnly: true };
  const cellRegex = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/i;
  const m = cellPart.match(cellRegex);
  if (!m) throw new Error(`Invalid A1 range: ${range}`);
  const startCol = colLetterToIndex(m[1]);
  const startRow = m[2] ? parseInt(m[2], 10) - 1 : 0;
  const endCol = m[3] ? colLetterToIndex(m[3]) : startCol;
  const endRow = m[4] ? parseInt(m[4], 10) - 1 : (m[2] ? startRow : null);
  return { sheetName, startRow, startCol, endRow, endCol, sheetOnly: false };
}

// --- Spreadsheet helpers ---

function findSheet(spreadsheet, sheetName) {
  if (!sheetName) return spreadsheet.sheets[0];
  return spreadsheet.sheets.find(s => s.properties.title === sheetName);
}

function getCell(sheet, row, col) {
  const a1 = `${indexToColLetter(col)}${row + 1}`;
  return sheet.cells[a1];
}

function setCell(sheet, row, col, value) {
  const a1 = `${indexToColLetter(col)}${row + 1}`;
  if (value === null || value === '') {
    delete sheet.cells[a1];
  } else {
    const isFormula = typeof value === 'string' && value.startsWith('=');
    const numeric = !isFormula && value !== '' && !Number.isNaN(Number(value)) && typeof value !== 'boolean';
    sheet.cells[a1] = isFormula
      ? { formula: value, value }
      : numeric ? { value: Number(value), type: 'number' } : { value: String(value) };
  }
  return a1;
}

function maxUsedRow(sheet) {
  let max = 0;
  for (const key of Object.keys(sheet.cells)) {
    const m = key.match(/^[A-Z]+(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

function maxUsedCol(sheet) {
  let max = 0;
  for (const key of Object.keys(sheet.cells)) {
    const m = key.match(/^([A-Z]+)\d+$/);
    if (m) max = Math.max(max, colLetterToIndex(m[1]));
  }
  return max;
}

function sheetToValues(sheet, startRow = 0, startCol = 0, endRow = null, endCol = null) {
  const lastRow = endRow ?? maxUsedRow(sheet) - 1;
  const lastCol = endCol ?? maxUsedCol(sheet);
  const out = [];
  for (let r = startRow; r <= lastRow; r++) {
    const row = [];
    let any = false;
    for (let c = startCol; c <= lastCol; c++) {
      const cell = getCell(sheet, r, c);
      const v = cell ? (cell.value !== undefined ? cell.value : '') : '';
      if (v !== '' && v !== null && v !== undefined) any = true;
      row.push(v);
    }
    if (any || endRow !== null) out.push(row);
  }
  return out;
}

function flattenParagraphs(text) {
  if (!text || !text.paragraphs) return '';
  return text.paragraphs.map(p => (p.runs || []).map(r => r.content).join('')).join('\n');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createState(db) {
  // --- DB accessors ---
  function loadSpreadsheet(input) {
    const id = extractDocId(input) || input;
    const row = db.query('SELECT data FROM spreadsheets WHERE id = ?').get(id);
    return row ? { id, data: JSON.parse(row.data) } : null;
  }

  function saveSpreadsheet(id, data) {
    db.query('UPDATE spreadsheets SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
  }

  function loadPresentation(input) {
    const id = extractDocId(input) || input;
    const row = db.query('SELECT data FROM presentations WHERE id = ?').get(id);
    return row ? { id, data: JSON.parse(row.data) } : null;
  }

  function savePresentation(id, data) {
    db.query('UPDATE presentations SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
  }

  function record(kind, tool, details) {
    auditLog(db, kind, tool, details);
  }

  // --- sheets.* tools ---

  const sheetsTools = {
    getMetadata({ spreadsheetId }) {
      const r = loadSpreadsheet(spreadsheetId);
      if (!r) return { content: [{ type: 'text', text: JSON.stringify({ error: `Spreadsheet not found: ${spreadsheetId}` }) }] };
      const ss = r.data;
      const meta = {
        spreadsheetId: ss.spreadsheetId, title: ss.properties.title,
        sheets: ss.sheets.map(s => ({
          sheetId: s.properties.sheetId, title: s.properties.title,
          index: s.properties.index,
          rowCount: s.properties.gridProperties.rowCount,
          columnCount: s.properties.gridProperties.columnCount,
        })),
        locale: ss.properties.locale, timeZone: ss.properties.timeZone,
      };
      return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
    },

    getRange({ spreadsheetId, range }) {
      const r = loadSpreadsheet(spreadsheetId);
      if (!r) return { content: [{ type: 'text', text: JSON.stringify({ error: `Spreadsheet not found: ${spreadsheetId}` }) }] };
      const ss = r.data;
      let parsed;
      try { parsed = parseA1(range); } catch (e) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }] };
      }
      const sheet = findSheet(ss, parsed.sheetName);
      if (!sheet) return { content: [{ type: 'text', text: JSON.stringify({ error: `Sheet not found: ${parsed.sheetName}` }) }] };
      const values = parsed.sheetOnly
        ? sheetToValues(sheet)
        : sheetToValues(sheet, parsed.startRow, parsed.startCol, parsed.endRow, parsed.endCol);
      const sheetTitle = sheet.properties.title;
      const normalized = parsed.sheetOnly
        ? `'${sheetTitle}'`
        : `'${sheetTitle}'!${indexToColLetter(parsed.startCol)}${parsed.startRow + 1}:${indexToColLetter(parsed.endCol ?? parsed.startCol)}${(parsed.endRow ?? parsed.startRow) + 1}`;
      return { content: [{ type: 'text', text: JSON.stringify({ range: normalized, values }) }] };
    },

    getText({ spreadsheetId, format = 'text' }) {
      const r = loadSpreadsheet(spreadsheetId);
      if (!r) return { content: [{ type: 'text', text: JSON.stringify({ error: `Spreadsheet not found: ${spreadsheetId}` }) }] };
      const ss = r.data;
      if (format === 'json') {
        const out = {};
        for (const sh of ss.sheets) out[sh.properties.title] = sheetToValues(sh);
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
      }
      let content = `Spreadsheet Title: ${ss.properties.title}\n\n`;
      for (const sh of ss.sheets) {
        content += `Sheet Name: ${sh.properties.title}\n`;
        const values = sheetToValues(sh);
        if (values.length === 0) { content += '(Empty sheet)\n'; }
        else if (format === 'csv') {
          for (const row of values) {
            content += row.map(cell => {
              const s = String(cell ?? '');
              if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
              return s;
            }).join(',') + '\n';
          }
        } else {
          for (const row of values) content += row.map(c => c ?? '').join(' | ') + '\n';
        }
        content += '\n';
      }
      return { content: [{ type: 'text', text: content.trim() }] };
    },
  };

  // --- slides.* tools ---

  const slidesTools = {
    getMetadata({ presentationId }) {
      const r = loadPresentation(presentationId);
      if (!r) return { content: [{ type: 'text', text: JSON.stringify({ error: `Presentation not found: ${presentationId}` }) }] };
      const p = r.data;
      const meta = {
        presentationId: p.presentationId, title: p.title, slideCount: p.slides.length,
        slides: p.slides.map(({ objectId, pageElements = [] }) => ({
          objectId,
          pageElements: pageElements.map((el) => {
            const item = {
              objectId: el.objectId,
              type: el.type || (el.shape ? 'shape' : el.table ? 'table' : el.image ? 'image' : 'unknown'),
            };
            if (el.shape?.text) {
              item.shapeType = el.shape.shapeType || null;
              item.text = flattenParagraphs(el.shape.text);
            }
            if (el.table) {
              item.tableRows = el.table.tableRows?.length ?? 0;
            }
            if (el.image) {
              item.image = {
                title: el.title ?? null,
                description: el.description ?? null,
              };
            }
            return item;
          }),
        })),
        pageSize: p.pageSize, hasMasters: false, hasLayouts: false, hasNotesMaster: false,
      };
      return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
    },

    getText({ presentationId }) {
      const r = loadPresentation(presentationId);
      if (!r) return { content: [{ type: 'text', text: JSON.stringify({ error: `Presentation not found: ${presentationId}` }) }] };
      const p = r.data;
      let content = `Presentation Title: ${p.title}\n\n`;
      p.slides.forEach((slide, i) => {
        content += `\n--- Slide ${i + 1} ---\n`;
        for (const el of slide.pageElements || []) {
          if (el.shape && el.shape.text) {
            const t = flattenParagraphs(el.shape.text);
            if (t) content += t + '\n';
          }
          if (el.table && el.table.tableRows) {
            content += '\n--- Table Data ---\n';
            for (const row of el.table.tableRows) {
              const cells = (row.tableCells || []).map(c => (c.text || '').trim());
              content += cells.join(' | ') + '\n';
            }
            content += '--- End Table Data ---\n';
          }
        }
        content += '\n';
      });
      return { content: [{ type: 'text', text: content.trim() }] };
    },

    getImages({ presentationId, localPath }) {
      const r = loadPresentation(presentationId);
      if (!r) return { content: [{ type: 'text', text: JSON.stringify({ error: `Presentation not found: ${presentationId}` }) }] };
      const p = r.data;
      const images = [];
      p.slides.forEach((slide, i) => {
        for (const el of slide.pageElements || []) {
          if (el.image) {
            images.push({
              slideIndex: i + 1, slideObjectId: slide.objectId,
              elementObjectId: el.objectId, title: el.title ?? null,
              description: el.description ?? null,
              contentUrl: el.image.contentUrl ?? null,
              sourceUrl: el.image.sourceUrl ?? null,
              localPath: localPath ? `${localPath}/slide_${i + 1}_${el.objectId}.png` : null,
              note: 'Mock environment: image download skipped, paths returned for parity only.',
            });
          }
        }
      });
      return { content: [{ type: 'text', text: JSON.stringify({ images }) }] };
    },

    getSlideThumbnail({ presentationId, slideObjectId, localPath }) {
      const r = loadPresentation(presentationId);
      if (!r) return { content: [{ type: 'text', text: JSON.stringify({ error: `Presentation not found: ${presentationId}` }) }] };
      const p = r.data;
      const slide = p.slides.find(s => s.objectId === slideObjectId);
      if (!slide) return { content: [{ type: 'text', text: JSON.stringify({ error: `Slide not found: ${slideObjectId}` }) }] };
      return { content: [{ type: 'text', text: JSON.stringify({
        contentUrl: `mock://thumbnail/${r.id}/${slideObjectId}.png`,
        width: 1600, height: 900, localPath: localPath || null,
        note: 'Mock environment: thumbnail render skipped, descriptor returned for parity only.',
      }) }] };
    },
  };

  const tools = {
    'sheets.getText': sheetsTools.getText,
    'sheets.getRange': sheetsTools.getRange,
    'sheets.getMetadata': sheetsTools.getMetadata,
    'slides.getText': slidesTools.getText,
    'slides.getMetadata': slidesTools.getMetadata,
    'slides.getImages': slidesTools.getImages,
    'slides.getSlideThumbnail': slidesTools.getSlideThumbnail,
  };

  // --- Mutations ---

  const mutations = {
    setCells({ spreadsheetId, sheetTitle, updates }) {
      const r = loadSpreadsheet(spreadsheetId);
      if (!r) throw new Error(`Spreadsheet not found: ${spreadsheetId}`);
      const ss = r.data;
      const sheet = findSheet(ss, sheetTitle);
      if (!sheet) throw new Error(`Sheet not found: ${sheetTitle}`);
      const applied = [];
      for (const u of updates) {
        const a1 = u.a1 ?? `${indexToColLetter(u.col)}${u.row + 1}`;
        const m = a1.match(/^([A-Z]+)(\d+)$/);
        if (!m) throw new Error(`Invalid A1: ${a1}`);
        const col = colLetterToIndex(m[1]);
        const row = parseInt(m[2], 10) - 1;
        setCell(sheet, row, col, u.value);
        applied.push(a1);
      }
      saveSpreadsheet(r.id, ss);
      record('sheets.setCells', 'sheets.setCells', { spreadsheetId: r.id, sheetTitle: sheet.properties.title, count: applied.length });
      return { spreadsheetId: r.id, sheetTitle: sheet.properties.title, applied };
    },

    addSheet({ spreadsheetId, title }) {
      const r = loadSpreadsheet(spreadsheetId);
      if (!r) throw new Error(`Spreadsheet not found: ${spreadsheetId}`);
      const ss = r.data;
      if (ss.sheets.some(s => s.properties.title === title)) throw new Error(`Sheet already exists: ${title}`);
      const nextSheetId = Math.max(0, ...ss.sheets.map(s => s.properties.sheetId)) + 1;
      ss.sheets.push({
        properties: { sheetId: nextSheetId, title, index: ss.sheets.length, gridProperties: { rowCount: 100, columnCount: 26 } },
        cells: {},
      });
      saveSpreadsheet(r.id, ss);
      record('sheets.addSheet', 'sheets.addSheet', { spreadsheetId: r.id, title });
      return { spreadsheetId: r.id, sheetId: nextSheetId, title };
    },

    deleteSheet({ spreadsheetId, sheetTitle }) {
      const r = loadSpreadsheet(spreadsheetId);
      if (!r) throw new Error(`Spreadsheet not found: ${spreadsheetId}`);
      const ss = r.data;
      if (ss.sheets.length <= 1) throw new Error('Cannot delete the only sheet');
      const idx = ss.sheets.findIndex(s => s.properties.title === sheetTitle);
      if (idx === -1) throw new Error(`Sheet not found: ${sheetTitle}`);
      ss.sheets.splice(idx, 1);
      ss.sheets.forEach((s, i) => { s.properties.index = i; });
      saveSpreadsheet(r.id, ss);
      record('sheets.deleteSheet', 'sheets.deleteSheet', { spreadsheetId: r.id, sheetTitle });
      return { spreadsheetId: r.id, sheetTitle };
    },

    renameSpreadsheet({ spreadsheetId, title }) {
      const r = loadSpreadsheet(spreadsheetId);
      if (!r) throw new Error(`Spreadsheet not found: ${spreadsheetId}`);
      const ss = r.data;
      ss.properties.title = title;
      saveSpreadsheet(r.id, ss);
      record('sheets.rename', 'sheets.rename', { spreadsheetId: r.id, title });
      return { spreadsheetId: r.id, title };
    },

    addSlide({ presentationId, layout = 'TITLE_AND_BODY', insertAfter }) {
      const r = loadPresentation(presentationId);
      if (!r) throw new Error(`Presentation not found: ${presentationId}`);
      const p = r.data;
      const newId = `g_${r.id}_${Date.now().toString(36)}`;
      const slide = {
        objectId: newId, layout, background: '#ffffff',
        pageElements: layout === 'TITLE'
          ? [{ objectId: `${newId}_title`, type: 'shape',
               shape: { shapeType: 'TEXT_BOX', text: { paragraphs: [{ runs: [{ content: 'Click to add title' }] }] } },
               transform: { x: 80, y: 160, width: 800, height: 70 },
               style: { fontSize: 44, color: '#1f2937', fontWeight: 700, align: 'center' } }]
          : [{ objectId: `${newId}_title`, type: 'shape',
               shape: { shapeType: 'TEXT_BOX', text: { paragraphs: [{ runs: [{ content: 'Click to add title' }] }] } },
               transform: { x: 60, y: 50, width: 820, height: 60 },
               style: { fontSize: 32, color: '#1f2937', fontWeight: 700 } },
             { objectId: `${newId}_body`, type: 'shape',
               shape: { shapeType: 'TEXT_BOX', text: { paragraphs: [{ runs: [{ content: 'Click to add text' }] }] } },
               transform: { x: 60, y: 130, width: 820, height: 280 },
               style: { fontSize: 20, color: '#1f2937', lineHeight: 1.6 } }],
      };
      let pos = p.slides.length;
      if (insertAfter) {
        const i = p.slides.findIndex(s => s.objectId === insertAfter);
        if (i !== -1) pos = i + 1;
      }
      p.slides.splice(pos, 0, slide);
      savePresentation(r.id, p);
      record('slides.addSlide', 'slides.addSlide', { presentationId: r.id, slideObjectId: newId, layout });
      return { presentationId: r.id, objectId: newId, index: pos };
    },

    deleteSlide({ presentationId, slideObjectId }) {
      const r = loadPresentation(presentationId);
      if (!r) throw new Error(`Presentation not found: ${presentationId}`);
      const p = r.data;
      if (p.slides.length <= 1) throw new Error('Cannot delete the only slide');
      const idx = p.slides.findIndex(s => s.objectId === slideObjectId);
      if (idx === -1) throw new Error(`Slide not found: ${slideObjectId}`);
      p.slides.splice(idx, 1);
      savePresentation(r.id, p);
      record('slides.deleteSlide', 'slides.deleteSlide', { presentationId: r.id, slideObjectId });
      return { presentationId: r.id, slideObjectId };
    },

    duplicateSlide({ presentationId, slideObjectId }) {
      const r = loadPresentation(presentationId);
      if (!r) throw new Error(`Presentation not found: ${presentationId}`);
      const p = r.data;
      const idx = p.slides.findIndex(s => s.objectId === slideObjectId);
      if (idx === -1) throw new Error(`Slide not found: ${slideObjectId}`);
      const newId = `g_${r.id}_${Date.now().toString(36)}_dup`;
      const copy = JSON.parse(JSON.stringify(p.slides[idx]));
      copy.objectId = newId;
      copy.pageElements = (copy.pageElements || []).map((el, i) => ({ ...el, objectId: `${newId}_e${i}` }));
      p.slides.splice(idx + 1, 0, copy);
      savePresentation(r.id, p);
      record('slides.duplicateSlide', 'slides.duplicateSlide', { presentationId: r.id, slideObjectId, newObjectId: newId });
      return { presentationId: r.id, objectId: newId, index: idx + 1 };
    },

    setSlideText({ presentationId, slideObjectId, elementObjectId, text }) {
      const r = loadPresentation(presentationId);
      if (!r) throw new Error(`Presentation not found: ${presentationId}`);
      const p = r.data;
      const slide = p.slides.find(s => s.objectId === slideObjectId);
      if (!slide) throw new Error(`Slide not found: ${slideObjectId}`);
      const el = (slide.pageElements || []).find(e => e.objectId === elementObjectId);
      if (!el || !el.shape) throw new Error(`Text element not found: ${elementObjectId}`);
      el.shape.text = { paragraphs: (text ?? '').split('\n').map(line => ({ runs: [{ content: line }] })) };
      savePresentation(r.id, p);
      record('slides.setText', 'slides.setText', { presentationId: r.id, slideObjectId, elementObjectId });
      return { presentationId: r.id, slideObjectId, elementObjectId };
    },

    renamePresentation({ presentationId, title }) {
      const r = loadPresentation(presentationId);
      if (!r) throw new Error(`Presentation not found: ${presentationId}`);
      const p = r.data;
      p.title = title;
      savePresentation(r.id, p);
      record('slides.rename', 'slides.rename', { presentationId: r.id, title });
      return { presentationId: r.id, title };
    },
  };

  // --- State accessors ---

  function getState() {
    const ssRows = db.query('SELECT id, data FROM spreadsheets').all();
    const spreadsheets = {};
    for (const row of ssRows) spreadsheets[row.id] = JSON.parse(row.data);
    const presRows = db.query('SELECT id, data FROM presentations').all();
    const presentations = {};
    for (const row of presRows) presentations[row.id] = JSON.parse(row.data);
    const auditRows = db.query('SELECT timestamp, kind, tool, details_json FROM audit_log ORDER BY id ASC').all();
    const audit = auditRows.map(r => ({ ts: r.timestamp, kind: r.kind, tool: r.tool, ...JSON.parse(r.details_json) }));
    return { spreadsheets, presentations, audit };
  }

  function getAudit() {
    return db.query('SELECT timestamp, kind, tool, details_json FROM audit_log ORDER BY id ASC').all()
      .map(r => ({ ts: r.timestamp, kind: r.kind, tool: r.tool, ...JSON.parse(r.details_json) }));
  }

  function reset() {
    dbReset(db);
  }

  return { tools, mutations, getState, getAudit, reset, record };
}
