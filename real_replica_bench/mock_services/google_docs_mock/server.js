const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const driveVal = require('./lib/drive_validation');
const docsModel = require('./lib/docs_model');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.GDOCS_MOCK_STATE_DIR || process.env.MOCK_STATE_DIR || path.join(ROOT, 'data');
const SEED_PATH = process.env.GDOCS_MOCK_SEED || path.join(ROOT, 'data', 'seed_state.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 3081);
const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN || 'bench-verifier';
const UI_TOKEN = crypto.randomBytes(24).toString('base64url');
// MCP / Workspace tool surface is DENY-BY-DEFAULT. It is an ungated mutation
// surface (no UI token), so for browser/UI tasks it must stay closed or an agent
// can bypass the UI entirely (anti-cheat: enforce in the environment, not the
// prompt). Enabled only when GDOCS_ENABLE_MCP=1 (smoke / standalone) OR the task
// seed sets config.mcpEnabled=true (MCP-mode tasks opt in explicitly).
const MCP_ENABLED_ENV = ['1', 'true', 'yes'].includes(
  String(process.env.GDOCS_ENABLE_MCP || '').toLowerCase()
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function suffixId(id = '', suffix = '') {
  return id ? `${id}-${suffix}` : makeId('item');
}

function loadState() {
  const source = fs.existsSync(STATE_PATH) ? STATE_PATH : SEED_PATH;
  const state = JSON.parse(fs.readFileSync(source, 'utf8'));
  state.files ||= [];
  state.templates ||= [];
  state.people ||= [];
  state.view ||= {};
  state.versions ||= {};
  state.events ||= [];
  return state;
}

let state = loadState();

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function pushEvent(type, details = {}) {
  state.events.unshift({ id: makeId('evt'), type, at: nowIso(), ...details });
  state.events = state.events.slice(0, 200);
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isVerifier(req) {
  return VERIFIER_TOKEN && req.headers['x-mock-verifier-token'] === VERIFIER_TOKEN;
}

function isUiWrite(req) {
  return req.headers['x-ui-token'] === UI_TOKEN;
}

function requireWriteAuth(req) {
  if (isVerifier(req)) return;
  // UI mode: a write must come from a real browser session (HttpOnly nonce minted
  // on page load) AND carry the per-session UI token. (MCP mode skips the nonce.)
  if (browserLockEnabled() && !hasValidBrowserNonce(req)) {
    const err = new Error('browser_session_required');
    err.status = 403;
    pushEvent('browser_session_required', { method: req.method, path: req.url });
    throw err;
  }
  if (isUiWrite(req)) return;
  const err = new Error('ui_token_required');
  err.status = 403;
  pushEvent('ui_token_required', { method: req.method, path: req.url });
  throw err;
}

// Is the MCP/Workspace surface open for this task? (deny-by-default; see MCP_ENABLED_ENV)
function mcpEnabled() {
  return MCP_ENABLED_ENV || state.config?.mcpEnabled === true;
}

// Reject an MCP/Workspace request and leave a forensic trail. A `mcp_blocked`
// event on a UI task = the agent attempted to bypass the browser; verifiers can
// surface it as a mock_integrity diagnostic.
function denyMcp(req, res, surface) {
  pushEvent('mcp_blocked', { surface, method: req.method, path: req.url });
  saveState();
  return sendJson(
    res,
    { error: 'mcp_disabled', message: 'MCP/Workspace surface is disabled for this task.' },
    403
  );
}

// ─── Browser-client gate (UI mode) ───────────────────────────────────────────
// Ported from shopify_admin (the repo's canonical browser anti-cheat pattern): in
// a UI task the agent must drive the real browser, not curl the API. Programmatic
// User-Agents are rejected; writes additionally need an HttpOnly browser-nonce
// (minted on page load) + the per-session UI token. This is bar-raising, not
// network isolation — consistent with AGENTS.md ("a co-located mock is not
// tamper-proof vs a root agent"); the verifier's positive `ui_*`-event gate is the
// real proof of UI usage. ON in UI mode (default); OFF in MCP mode
// (config.mcpEnabled / GDOCS_ENABLE_MCP) or via GDOCS_DISABLE_BROWSER_LOCK=1.
const BROWSER_COOKIE = 'gdocs_browser_nonce';
const browserNonces = new Set();
const NON_BROWSER_UA = /(curl|wget|python-requests|python-urllib|httpx|aiohttp|node-fetch|undici|axios|go-http-client|java|ruby|php|libwww|okhttp|postmanruntime)/i;
const BROWSER_UA = /(mozilla|chrome|chromium|safari|firefox|edg|headlesschrome)/i;

function browserLockEnabled() {
  return !mcpEnabled() && process.env.GDOCS_DISABLE_BROWSER_LOCK !== '1';
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function getBrowserNonce(req) {
  return parseCookies(req)[BROWSER_COOKIE] || '';
}
function hasValidBrowserNonce(req) {
  const n = getBrowserNonce(req);
  return !!(n && browserNonces.has(n));
}
function mintBrowserNonce(req, res) {
  let n = getBrowserNonce(req);
  if (!n || !browserNonces.has(n)) {
    n = crypto.randomBytes(24).toString('base64url');
    browserNonces.add(n);
  }
  res.setHeader('Set-Cookie', `${BROWSER_COOKIE}=${n}; Path=/; HttpOnly; SameSite=Lax`);
}
function classifyBrowserClient(req, { requireDocument = false } = {}) {
  const ua = req.headers['user-agent'] || '';
  const accept = req.headers['accept'] || '';
  const dest = req.headers['sec-fetch-dest'] || '';
  if (!ua) return 'missing user-agent';
  if (NON_BROWSER_UA.test(ua)) return 'programmatic user-agent';
  if (!BROWSER_UA.test(ua)) return 'non-browser user-agent';
  if (requireDocument && req.method === 'GET' && !accept.includes('text/html') && dest !== 'document') {
    return 'non-browser navigation headers';
  }
  return '';
}
function denyNonBrowser(req, res, reason) {
  pushEvent('browser_required', { reason, method: req.method, path: req.url });
  res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end('Access denied: open the URL in a browser. Programmatic HTTP clients (curl/fetch/scripts) are not permitted on UI-task endpoints.\n');
}

function personById(id) {
  if (id === 'me') return { id: 'me', ...(state.account || {}), displayName: state.account?.name || '李明' };
  return state.people.find((p) => p.id === id || p.personId === id) || {
    id,
    displayName: id || 'Unknown',
    email: ''
  };
}

function enrichFile(file) {
  const owner = personById(file.ownerId || 'me');
  const lastModifiedBy = personById(file.lastModifiedById || file.ownerId || 'me');
  return {
    ...file,
    owner,
    ownerName: owner.displayName || owner.name || '李明',
    lastModifiedBy,
    documentId: file.id
  };
}

function findFile(id) {
  return state.files.find((file) => file.id === id);
}

function requireFile(id, type) {
  const file = findFile(id);
  if (!file || (type && file.type !== type)) {
    throw driveVal.notFound(`File not found: ${id}.`, 'notFound');
  }
  return file;
}

function normalizeShareRole(role, fallback = 'editor') {
  return ['viewer', 'commenter', 'editor'].includes(role) ? role : fallback;
}

function normalizeLinkAccess(access, fallback = 'restricted') {
  return ['restricted', 'anyone'].includes(access) ? access : fallback;
}

function getBreadcrumbs(folderId) {
  const crumbs = [];
  let current = folderId && folderId !== 'root' ? findFile(folderId) : null;
  while (current && current.type === 'folder') {
    crumbs.unshift({ id: current.id, name: current.name });
    current = current.parentId && current.parentId !== 'root' ? findFile(current.parentId) : null;
  }
  crumbs.unshift({ id: 'root', name: '我的文档' });
  return crumbs;
}

function sortFiles(files, sortBy = 'lastOpenedAt', sortDir = 'desc') {
  const dir = sortDir === 'asc' ? 1 : -1;
  const field = sortBy === 'lastEditedAt' ? 'modifiedAt' : sortBy;
  return files.sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    const av = field === 'name' ? String(a.name || '').toLocaleLowerCase('zh-CN') : Date.parse(a[field] || a.modifiedAt || a.createdAt || 0);
    const bv = field === 'name' ? String(b.name || '').toLocaleLowerCase('zh-CN') : Date.parse(b[field] || b.modifiedAt || b.createdAt || 0);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
  });
}

function listFiles(searchParams) {
  const view = searchParams.get('view') || 'home';
  const query = (searchParams.get('query') || '').trim().toLocaleLowerCase('zh-CN');
  const parentId = searchParams.get('parentId') || state.view.currentFolderId || 'root';
  const owner = searchParams.get('owner') || 'any';
  const sortBy = searchParams.get('sortBy') || state.view.sortBy || 'lastOpenedAt';
  const sortDir = searchParams.get('sortDir') || state.view.sortDir || 'desc';

  let files = state.files.slice();
  if (view === 'trash') {
    files = files.filter((file) => file.trashed);
  } else {
    files = files.filter((file) => !file.trashed);
  }

  if (view === 'home') files = files.filter((file) => (file.parentId || 'root') === parentId);
  if (view === 'starred') files = files.filter((file) => file.starred);
  if (view === 'shared') files = files.filter((file) => Array.isArray(file.sharedWith) && file.sharedWith.length);
  if (view === 'recent') files = files.filter((file) => file.type !== 'folder');

  if (owner === 'me') files = files.filter((file) => (file.ownerId || 'me') === 'me');
  if (owner === 'others') files = files.filter((file) => (file.ownerId || 'me') !== 'me');
  if (query) files = files.filter((file) => String(file.name || '').toLocaleLowerCase('zh-CN').includes(query));

  state.view.currentFolderId = view === 'home' ? parentId : state.view.currentFolderId || 'root';
  return {
    files: sortFiles(files.map(enrichFile), sortBy, sortDir),
    currentFolderId: view === 'home' ? parentId : state.view.currentFolderId,
    breadcrumbs: getBreadcrumbs(view === 'home' ? parentId : state.view.currentFolderId)
  };
}

function snapshotVersion(file, label = '') {
  if (!file || file.type !== 'document') return;
  state.versions[file.id] ||= [];
  const version = {
    id: makeId('ver'),
    timestamp: nowIso(),
    authorId: 'me',
    authorName: state.account?.name || '李明',
    authorColor: '#1a73e8',
    title: file.content?.title || file.name,
    blocks: clone(file.content?.blocks || []),
    label
  };
  state.versions[file.id].unshift(version);
  state.versions[file.id] = state.versions[file.id].slice(0, 30);
  return version;
}

function ensureLatestVersion(file) {
  state.versions[file.id] ||= [];
  if (!state.versions[file.id].length) snapshotVersion(file, '');
  return state.versions[file.id][0];
}

function makeDocument(name = '未命名文档', parentId = 'root', content = null) {
  const id = makeId('doc');
  const doc = {
    id,
    name,
    type: 'document',
    parentId: parentId || 'root',
    starred: false,
    ownerId: 'me',
    lastModifiedById: 'me',
    sharedWith: [],
    trashed: false,
    createdAt: nowIso(),
    modifiedAt: nowIso(),
    lastOpenedAt: nowIso(),
    content: content || {
      title: name,
      blocks: [
        { id: makeId('b'), type: 'paragraph', text: '', format: {} }
      ]
    },
    comments: [],
    reactions: []
  };
  state.files.unshift(doc);
  snapshotVersion(doc, '创建');
  pushEvent('document_created', { fileId: id, name });
  saveState();
  return doc;
}

function applyTextReplace(file, args = {}) {
  const requests = Array.isArray(args.requests) ? args.requests : [];
  let changed = false;
  let replacementCount = 0;
  requests.forEach((request) => {
    const repl = request.replaceAllText;
    if (!repl?.containsText) return;
    const criteria = repl.containsText;
    const find = String(typeof criteria === 'object' ? criteria.text || '' : criteria);
    const replace = String(repl.replaceText || '');
    const matchCase = Boolean((typeof criteria === 'object' && criteria.matchCase) || repl.matchCase);
    const flags = matchCase ? 'g' : 'gi';
    const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const beforeCount = replacementCount;
    (file.content?.blocks || []).forEach((block) => {
      if (typeof block.text !== 'string' || !find) return;
      const before = block.text;
      block.text = block.text.replace(pattern, () => {
        replacementCount += 1;
        return replace;
      });
      if (block.text !== before) {
        changed = true;
      }
    });
    if (replacementCount > beforeCount) {
      pushEvent('find_replace_applied', {
        fileId: file.id,
        find,
        replace,
        matchCase,
        replacementCount
      });
    }
  });
  if (changed) {
    file.modifiedAt = nowIso();
    snapshotVersion(file, '查找和替换');
    saveState();
  }
  return { changed, replacementCount };
}

function copyDocumentAnnotations(file, copyId, options = {}) {
  if (!options.copyComments) return [];
  const includeResolved = Boolean(options.includeResolvedComments);
  return (file.comments || [])
    .filter((comment) => includeResolved || !comment.resolved)
    .map((comment) => {
      const copied = clone(comment);
      const sourceCommentId = copied.id;
      copied.id = makeId('cmt');
      copied.copiedFromFileId = file.id;
      copied.copiedFromCommentId = sourceCommentId;
      copied.copiedFromDocumentTitle = file.content?.title || file.name;
      copied.copiedNote = 'Copied from the original document.';
      copied.createdAt = nowIso();
      copied.updatedAt = nowIso();
      copied.replies = (copied.replies || []).map((reply) => ({
        ...reply,
        id: suffixId(reply.id, 'copy'),
        copiedFromFileId: file.id,
        copiedFromCommentId: sourceCommentId
      }));
      return copied;
    });
}

const EXPORT_FORMATS = {
  docx: {
    label: 'Microsoft Word (.docx)',
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  },
  odt: {
    label: 'OpenDocument 格式 (.odt)',
    ext: 'odt',
    mime: 'application/vnd.oasis.opendocument.text'
  },
  rtf: {
    label: '富文本格式 (.rtf)',
    ext: 'rtf',
    mime: 'application/rtf'
  },
  pdf: {
    label: 'PDF 文档 (.pdf)',
    ext: 'pdf',
    mime: 'application/pdf'
  },
  txt: {
    label: '纯文本 (.txt)',
    ext: 'txt',
    mime: 'text/plain'
  },
  html: {
    label: '网页 (.html, zip)',
    ext: 'zip',
    mime: 'application/zip'
  },
  epub: {
    label: 'EPUB 出版物 (.epub)',
    ext: 'epub',
    mime: 'application/epub+zip'
  },
  md: {
    label: 'Markdown (.md)',
    ext: 'md',
    mime: 'text/markdown'
  }
};

const CRC_TABLE = Array.from({ length: 256 }, (_, idx) => {
  let value = idx;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(entries = []) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  });
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

function xmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function htmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFileStem(name = 'Untitled document') {
  return String(name || 'Untitled document')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Untitled document';
}

function exportBlockText(block = {}) {
  if (block.type === 'table') {
    const rows = block.format?.rows || [];
    if (Array.isArray(rows) && rows.length) return rows.map((row) => (Array.isArray(row) ? row.join('\t') : '')).join('\n');
  }
  if (block.type === 'image') return block.format?.alt || block.text || '';
  return block.text || '';
}

function documentPlainText(file) {
  return (file.content?.blocks || []).map(exportBlockText).filter((text) => String(text).length).join('\n');
}

function markdownFor(file) {
  const lines = [];
  (file.content?.blocks || []).forEach((block) => {
    const text = exportBlockText(block);
    if (!text) return;
    if (block.type === 'heading1') lines.push(`# ${text}`);
    else if (block.type === 'heading2') lines.push(`## ${text}`);
    else if (block.type === 'heading3') lines.push(`### ${text}`);
    else if (block.type === 'bullet') lines.push(`- ${text}`);
    else if (block.type === 'numbered') lines.push(`1. ${text}`);
    else if (block.type === 'todo') lines.push(`- [ ] ${text}`);
    else lines.push(text);
  });
  return `${lines.join('\n\n')}\n`;
}

function htmlFor(file) {
  const title = htmlEscape(file.content?.title || file.name || 'Untitled document');
  const body = (file.content?.blocks || []).map((block) => {
    const text = htmlEscape(exportBlockText(block));
    if (!text) return '';
    if (block.type === 'heading1') return `<h1>${text}</h1>`;
    if (block.type === 'heading2') return `<h2>${text}</h2>`;
    if (block.type === 'heading3') return `<h3>${text}</h3>`;
    if (block.type === 'bullet') return `<ul><li>${text}</li></ul>`;
    if (block.type === 'numbered') return `<ol><li>${text}</li></ol>`;
    if (block.type === 'todo') return `<p>☐ ${text}</p>`;
    return `<p>${text.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>\n`;
}

function rtfEscape(value = '') {
  return String(value).replace(/[\\{}]/g, (ch) => `\\${ch}`).replace(/\n/g, '\\par\n');
}

function pdfEscape(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
}

function simplePdf(file) {
  const lines = documentPlainText(file).split('\n').slice(0, 42);
  const commands = ['BT', '/F1 11 Tf', '72 760 Td'];
  lines.forEach((line, idx) => {
    if (idx) commands.push('0 -16 Td');
    commands.push(`(${pdfEscape(line).slice(0, 110)}) Tj`);
  });
  commands.push('ET');
  const stream = commands.join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

function docxFor(file) {
  const paragraphs = documentPlainText(file).split('\n').map((line) => `<w:p><w:r><w:t>${xmlEscape(line)}</w:t></w:r></w:p>`).join('');
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>` }
  ]);
}

function odtFor(file) {
  return zipStore([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
    { name: 'META-INF/manifest.xml', data: '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/></manifest:manifest>' },
    { name: 'content.xml', data: `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${documentPlainText(file).split('\n').map((line) => `<text:p>${xmlEscape(line)}</text:p>`).join('')}</office:text></office:body></office:document-content>` }
  ]);
}

function epubFor(file) {
  const title = xmlEscape(file.content?.title || file.name || 'Untitled document');
  const html = htmlFor(file);
  return zipStore([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/package.opf', data: `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${xmlEscape(file.id)}</dc:identifier><dc:title>${title}</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="content"/></spine></package>` },
    { name: 'OEBPS/content.xhtml', data: html.replace('<!doctype html>', '<?xml version="1.0" encoding="UTF-8"?>').replace('<html>', '<html xmlns="http://www.w3.org/1999/xhtml">') }
  ]);
}

function exportDocument(file, format) {
  const spec = EXPORT_FORMATS[format] || EXPORT_FORMATS.docx;
  const title = file.content?.title || file.name || 'Untitled document';
  let data;
  if (format === 'txt') data = Buffer.from(`${documentPlainText(file)}\n`, 'utf8');
  else if (format === 'md') data = Buffer.from(markdownFor(file), 'utf8');
  else if (format === 'rtf') data = Buffer.from(`{\\rtf1\\ansi\\deff0 ${rtfEscape(documentPlainText(file))}}`, 'utf8');
  else if (format === 'pdf') data = simplePdf(file);
  else if (format === 'html') data = zipStore([{ name: `${sanitizeFileStem(title)}.html`, data: htmlFor(file) }]);
  else if (format === 'epub') data = epubFor(file);
  else if (format === 'odt') data = odtFor(file);
  else data = docxFor(file);
  return { ...spec, data, filename: `${sanitizeFileStem(title)}.${spec.ext}` };
}

function sendDownload(res, exportResult) {
  const asciiName = exportResult.filename.replace(/[^\x20-\x7e]/g, '_');
  res.writeHead(200, {
    'content-type': exportResult.mime,
    'cache-control': 'no-store',
    'content-length': exportResult.data.length,
    'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(exportResult.filename)}`
  });
  res.end(exportResult.data);
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

// ─── MCP / Workspace tool registry ───────────────────────────────────────────
//
// Phase 1 tools: docs.documents.get, docs.documents.batchUpdate,
//                drive.files.export  (+ Convention-C snake_case aliases).
// Phase 2 tools: docs.documents.create, drive.files.list, drive.files.get,
//                drive.files.create, drive.files.copy, drive.files.update,
//                drive.files.delete, drive.permissions.create/list/delete,
//                drive.revisions.list/get
//                (+ Convention-C snake_case aliases from §6.3)

function workspaceToolSchemas() {
  return [
    // ─── Phase 1 tools (unchanged) ──────────────────────────────────────────
    {
      name: 'docs.documents.get',
      description: 'Read a Google Docs document. Returns the enriched document object.',
      inputSchema: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The document id (also accepted as fileId).' },
          fileId: { type: 'string', description: 'Alias for documentId.' }
        },
        required: ['documentId']
      }
    },
    {
      name: 'docs.documents.batchUpdate',
      description: 'Apply a list of batchUpdate requests (e.g. replaceAllText) to a document.',
      inputSchema: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The document id (also accepted as fileId).' },
          fileId: { type: 'string', description: 'Alias for documentId.' },
          requests: {
            type: 'array',
            description: 'Array of Request objects, applied sequentially (e.g. [{replaceAllText:{replaceText,containsText:{text,matchCase}}}]).',
            items: { type: 'object' }
          }
        },
        required: ['documentId', 'requests']
      }
    },
    {
      name: 'drive.files.export',
      description: 'Export a Google Docs document to a specified MIME type. mimeType must be one of the 8 valid Docs export MIME types (§4.3): application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.oasis.opendocument.text, application/rtf, application/pdf, text/plain, application/zip, application/epub+zip, text/markdown. Short aliases: docx, odt, rtf, pdf, txt, html, epub, md.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file/document id (also accepted as documentId).' },
          documentId: { type: 'string', description: 'Alias for fileId.' },
          mimeType: { type: 'string', description: 'Target MIME type (full or short alias).' },
          format: { type: 'string', description: 'Short-format alias (docx/odt/rtf/pdf/txt/html/epub/md). Used if mimeType is absent.' }
        },
        required: ['fileId']
      }
    },
    // ─── Phase 2: Google Docs API tools ─────────────────────────────────────
    {
      name: 'docs.documents.create',
      description: 'Create a new Google Docs document. Supply title; if content (string) is given, seeds one paragraph block.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title.' },
          content: { type: 'string', description: 'Optional initial paragraph text.' },
          parentId: { type: 'string', description: 'Parent folder ID (default: root).' }
        },
        required: ['title']
      }
    },
    // ─── Phase 2: Google Drive API tools ────────────────────────────────────
    {
      name: 'drive.files.list',
      description: 'List Drive files. Filter with q DSL (§4.2: name/fullText/mimeType/trashed/starred/parents/owners/modifiedTime/createdTime). orderBy supports: createdTime,folder,modifiedByMeTime,modifiedTime,name,name_natural,quotaBytesUsed,recency,sharedWithMeTime,starred,viewedByMeTime (each with optional " desc"). pageSize clamped to 100.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'q DSL filter string.' },
          orderBy: { type: 'string', description: 'Comma-separated sort keys with optional " desc".' },
          pageSize: { type: 'number', description: 'Max results (clamped to 100).' },
          pageToken: { type: 'string', description: 'Pagination token.' },
          corpora: { type: 'string', description: 'user/domain/drive/allDrives.' },
          spaces: { type: 'string', description: 'drive/appDataFolder.' }
        }
      }
    },
    {
      name: 'drive.files.get',
      description: 'Get a Drive file by fileId. Returns a Drive-shaped File object.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file id.' },
          documentId: { type: 'string', description: 'Alias for fileId.' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'drive.files.create',
      description: 'Create a Drive file or folder. mimeType: "application/vnd.google-apps.document" for a Doc, "application/vnd.google-apps.folder" for a folder.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name.' },
          mimeType: { type: 'string', description: 'MIME type for the new file.' },
          parents: { type: 'array', items: { type: 'string' }, description: 'Parent folder IDs (first one used).' }
        },
        required: ['name']
      }
    },
    {
      name: 'drive.files.copy',
      description: 'Copy (duplicate) a Drive file. Returns the new File.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Source file id.' },
          name: { type: 'string', description: 'New name (defaults to "Copy of <original>").' },
          parents: { type: 'array', items: { type: 'string' }, description: 'Parent folder IDs for the copy.' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'drive.files.update',
      description: 'PATCH a Drive file: rename ({name}), star ({starred}), trash ({trashed:true}), restore ({trashed:false}). Move with addParents/removeParents (comma-separated folder IDs).',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file id.' },
          name: { type: 'string', description: 'New name.' },
          starred: { type: 'boolean', description: 'Star/un-star.' },
          trashed: { type: 'boolean', description: 'Trash (true) or restore (false).' },
          addParents: { type: 'string', description: 'Comma-separated folder IDs to add.' },
          removeParents: { type: 'string', description: 'Comma-separated folder IDs to remove.' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'drive.files.delete',
      description: 'Permanently delete a Drive file (bypasses trash).',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file id to delete.' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'drive.permissions.create',
      description: 'Add a permission to a Drive file. role ∈ {owner,organizer,fileOrganizer,writer,commenter,reader}; type ∈ {user,group,domain,anyone}.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file id.' },
          role: { type: 'string', description: 'Drive role: owner/organizer/fileOrganizer/writer/commenter/reader.' },
          type: { type: 'string', description: 'Permission type: user/group/domain/anyone.' },
          emailAddress: { type: 'string', description: 'Required when type is user or group.' },
          domain: { type: 'string', description: 'Required when type is domain.' }
        },
        required: ['fileId', 'role', 'type']
      }
    },
    {
      name: 'drive.permissions.list',
      description: 'List permissions on a Drive file. Returns Drive-shaped PermissionList.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file id.' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'drive.permissions.delete',
      description: 'Remove a permission from a Drive file by permissionId.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file id.' },
          permissionId: { type: 'string', description: 'The permission id (personId).' }
        },
        required: ['fileId', 'permissionId']
      }
    },
    {
      name: 'drive.revisions.list',
      description: 'List revision history for a file. Returns RevisionList.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file id.' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'drive.revisions.get',
      description: 'Get a single revision by revisionId.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file id.' },
          revisionId: { type: 'string', description: 'The revision id.' }
        },
        required: ['fileId', 'revisionId']
      }
    },
    // ─── Convention-C snake_case aliases (§6.3) ─────────────────────────────
    {
      name: 'get_doc_content',
      description: 'Alias for docs.documents.get — read a Google Docs document.',
      inputSchema: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          fileId: { type: 'string' }
        },
        required: ['documentId']
      }
    },
    {
      name: 'find_and_replace_doc',
      description: 'Alias for docs.documents.batchUpdate — find-and-replace text in a document.',
      inputSchema: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          fileId: { type: 'string' },
          requests: { type: 'array', items: { type: 'object' } }
        },
        required: ['documentId', 'requests']
      }
    },
    {
      name: 'export_doc_to_pdf',
      description: 'Alias for drive.files.export — export a document to PDF (or other MIME types).',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          documentId: { type: 'string' },
          mimeType: { type: 'string' },
          format: { type: 'string' }
        },
        required: ['fileId']
      }
    },
    // ─── Phase 2 Convention-C aliases (§6.3) ────────────────────────────────
    {
      name: 'create_doc',
      description: 'Alias for docs.documents.create — create a new Google Docs document.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          parentId: { type: 'string' }
        },
        required: ['title']
      }
    },
    {
      name: 'search_drive_files',
      description: 'Alias for drive.files.list — search Drive files with q DSL.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          orderBy: { type: 'string' },
          pageSize: { type: 'number' },
          pageToken: { type: 'string' },
          corpora: { type: 'string' },
          spaces: { type: 'string' }
        }
      }
    },
    {
      name: 'search_docs',
      description: 'Alias for drive.files.list filtered to Google Docs — search documents by name/fullText.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          orderBy: { type: 'string' },
          pageSize: { type: 'number' },
          pageToken: { type: 'string' }
        }
      }
    },
    {
      name: 'list_docs_in_folder',
      description: 'Alias for drive.files.list — list files in a specific folder.',
      inputSchema: {
        type: 'object',
        properties: {
          folder_id: { type: 'string', description: 'Folder ID (default: root).' },
          q: { type: 'string' },
          pageSize: { type: 'number' }
        }
      }
    },
    {
      name: 'get_drive_file_content',
      description: 'Alias for drive.files.get — get a Drive file by fileId.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          documentId: { type: 'string' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'create_drive_file',
      description: 'Alias for drive.files.create — create a Drive file or folder.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          mimeType: { type: 'string' },
          parents: { type: 'array', items: { type: 'string' } }
        },
        required: ['name']
      }
    },
    {
      name: 'copy_drive_file',
      description: 'Alias for drive.files.copy — copy a Drive file.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          name: { type: 'string' },
          parents: { type: 'array', items: { type: 'string' } }
        },
        required: ['fileId']
      }
    },
    {
      name: 'update_drive_file',
      description: 'Alias for drive.files.update — PATCH a Drive file (rename/star/trash/move).',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          name: { type: 'string' },
          starred: { type: 'boolean' },
          trashed: { type: 'boolean' },
          addParents: { type: 'string' },
          removeParents: { type: 'string' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'set_drive_file_permissions',
      description: 'Alias for drive.permissions.create — add a permission to a Drive file.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          role: { type: 'string' },
          type: { type: 'string' },
          emailAddress: { type: 'string' }
        },
        required: ['fileId', 'role', 'type']
      }
    },
    {
      name: 'get_drive_file_permissions',
      description: 'Alias for drive.permissions.list — list permissions on a Drive file.',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string' }
        },
        required: ['fileId']
      }
    }
  ];
}

// Resolve MIME type string: accept both full MIME and short aliases.
// Phase 2: validates the MIME against the §4.3 closed set (throws 400 on invalid).
function resolveExportFormat(mimeTypeOrAlias, validate = false) {
  if (!mimeTypeOrAlias) return 'docx';
  const mime = String(mimeTypeOrAlias).trim();
  // Short aliases first
  const shortAliases = {
    docx: 'docx', odt: 'odt', rtf: 'rtf', pdf: 'pdf',
    txt: 'txt', html: 'html', epub: 'epub', md: 'md', markdown: 'md'
  };
  if (shortAliases[mime.toLowerCase()]) return shortAliases[mime.toLowerCase()];
  // Full MIME lookup via EXPORT_FORMATS reverse map
  for (const [key, spec] of Object.entries(EXPORT_FORMATS)) {
    if (spec.mime.split(';')[0].trim() === mime) return key;
  }
  // Phase 2 enum validation — unknown MIME → 400 INVALID_ARGUMENT
  if (validate) {
    driveVal.validateExportMime(mime); // throws 400 if not in closed set
  }
  return 'docx'; // safe default (only reached if validate=false)
}

// ─── callWorkspaceTool ────────────────────────────────────────────────────────
// Dispatch a tool call by name; returns a plain payload object.
// Both dotted names and snake_case aliases dispatch here.
// ALL enum validation fires here — shared by /api/workspace/call and /mcp tools/call.
// Error responses use the Google error envelope: {error:{code,message,status,errors[]}}.
// ─────────────────────────────────────────────────────────────────────────────
function callWorkspaceTool(name, args = {}) {
  const tool = String(name || '').trim();

  // ── docs.documents.get / get_doc_content ────────────────────────────────
  // Phase 3: returns a real-shaped Docs API v1 Document (blocksToDocument).
  if (tool === 'docs.documents.get' || tool === 'get_doc_content') {
    const id = args.documentId || args.fileId;
    if (!id) throw driveVal.invalidArgument('documentId is required', 'missingDocumentId');
    const file = requireFile(id, 'document');
    return docsModel.blocksToDocument(file);
  }

  // ── docs.documents.batchUpdate / find_and_replace_doc ───────────────────
  // Phase 3: real index-space batchUpdate with sequential request dispatch.
  // Supports: insertText, deleteContentRange, replaceAllText, updateTextStyle,
  //           updateParagraphStyle. Unknown keys → 400 INVALID_ARGUMENT.
  // Back-compat shim: if args.requests is absent but legacy {find,replace} args
  //   present, route through the old applyTextReplace path.
  if (tool === 'docs.documents.batchUpdate' || tool === 'find_and_replace_doc') {
    const id = args.documentId || args.fileId;
    if (!id) throw driveVal.invalidArgument('documentId is required', 'missingDocumentId');
    const file = requireFile(id, 'document');

    // Legacy back-compat shim: args.requests absent but legacy shape present
    if (!Array.isArray(args.requests)) {
      const result = applyTextReplace(file, args);
      return { documentId: file.id, replies: [], ...result };
    }

    const requests = args.requests;
    const replies = [];
    let dirty = false;

    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      if (!req || typeof req !== 'object') {
        throw driveVal.invalidArgument(
          `batchUpdate request[${i}] is not an object.`,
          'invalidRequest'
        );
      }

      const keys = Object.keys(req);
      if (keys.length === 0) {
        throw driveVal.invalidArgument(
          `batchUpdate request[${i}] is empty.`,
          'emptyRequest'
        );
      }

      const key = keys[0]; // Only one key per request (oneof)

      if (key === 'insertText') {
        // {insertText: {location: {index}, text}}
        const r = req.insertText;
        docsModel.applyInsertText(file, r.location || {}, r.text);
        dirty = true;
        replies.push({});

      } else if (key === 'deleteContentRange') {
        // {deleteContentRange: {range: {startIndex, endIndex}}}
        const r = req.deleteContentRange;
        docsModel.applyDeleteContentRange(file, r.range || r);
        dirty = true;
        replies.push({});

      } else if (key === 'replaceAllText') {
        // {replaceAllText: {replaceText, containsText: {text, matchCase}}}
        const r = req.replaceAllText;
        const occurrencesChanged = docsModel.applyReplaceAllText(
          file,
          r.containsText || {},
          r.replaceText
        );
        dirty = true;
        replies.push({ replaceAllText: { occurrencesChanged } });

      } else if (key === 'updateTextStyle') {
        // {updateTextStyle: {range, textStyle, fields}}
        const r = req.updateTextStyle;
        docsModel.applyUpdateTextStyle(
          file,
          r.range || {},
          r.textStyle || {},
          r.fields
        );
        dirty = true;
        replies.push({});

      } else if (key === 'updateParagraphStyle') {
        // {updateParagraphStyle: {range, paragraphStyle, fields}}
        const r = req.updateParagraphStyle;
        docsModel.applyUpdateParagraphStyle(
          file,
          r.range || {},
          r.paragraphStyle || {},
          r.fields
        );
        dirty = true;
        replies.push({});

      } else {
        // Unknown/unsupported request key → 400 INVALID_ARGUMENT
        throw driveVal.invalidArgument(
          `batchUpdate: unsupported request key '${key}'. ` +
          `Supported keys: insertText, deleteContentRange, replaceAllText, updateTextStyle, updateParagraphStyle.`,
          'unsupportedRequest'
        );
      }
    }

    if (dirty) {
      file.modifiedAt = nowIso();
      snapshotVersion(file, 'batchUpdate');
      saveState();
    }

    const newRevisionId = docsModel.revisionIdFor(file);
    return {
      documentId: file.id,
      replies,
      writeControl: { requiredRevisionId: newRevisionId }
    };
  }

  // ── drive.files.export / export_doc_to_pdf ──────────────────────────────
  // Phase 2: enum validation on mimeType (§4.3 closed set → 400 on violation).
  if (tool === 'drive.files.export' || tool === 'export_doc_to_pdf') {
    const id = args.fileId || args.documentId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    const file = requireFile(id, 'document');
    const mimeArg = args.mimeType || args.format;
    // Validate: unknown MIME → 400 INVALID_ARGUMENT
    const format = resolveExportFormat(mimeArg, true /* validate */);
    const exportResult = exportDocument(file, format);
    pushEvent('document_exported', {
      fileId: file.id,
      format,
      mime: exportResult.mime,
      filename: exportResult.filename,
      size: exportResult.data.length,
      source: 'workspace_tool'
    });
    saveState();
    return {
      exported: true,
      fileId: file.id,
      mimeType: exportResult.mime,
      filename: exportResult.filename,
      bytesBase64: exportResult.data.toString('base64')
    };
  }

  // ── docs.documents.create / create_doc ──────────────────────────────────
  // Per §3.1: create is title-only; if content given, seed one paragraph block.
  if (tool === 'docs.documents.create' || tool === 'create_doc') {
    const title = String(args.title || '未命名文档').trim();
    const parentId = args.parentId || 'root';
    let content = null;
    if (args.content && String(args.content).trim()) {
      content = {
        title,
        blocks: [{ id: makeId('b'), type: 'paragraph', text: String(args.content).trim(), format: {} }]
      };
    }
    const doc = makeDocument(title, parentId, content);
    return {
      documentId: doc.id,
      kind: 'docs#document',
      title: doc.name,
      document: enrichFile(doc)
    };
  }

  // ── drive.files.list / search_drive_files / search_docs / list_docs_in_folder ─
  if (tool === 'drive.files.list' || tool === 'search_drive_files' ||
      tool === 'search_docs' || tool === 'list_docs_in_folder') {

    // Build effective q string
    let effectiveQ = args.q || '';

    // list_docs_in_folder: inject parent filter
    if (tool === 'list_docs_in_folder' && !effectiveQ.includes('in parents')) {
      const folderId = args.folder_id || 'root';
      const parentClause = `'${folderId}' in parents`;
      effectiveQ = effectiveQ ? `${effectiveQ} and ${parentClause}` : parentClause;
    }

    // search_docs: inject mimeType filter for Docs only
    if (tool === 'search_docs' && !effectiveQ.includes('mimeType')) {
      const mimeClause = "mimeType = 'application/vnd.google-apps.document'";
      effectiveQ = effectiveQ ? `${effectiveQ} and ${mimeClause}` : mimeClause;
    }

    // Validate orderBy, corpora, spaces (§4.1, §3+4 table)
    driveVal.validateOrderBy(args.orderBy);
    driveVal.validateCorpora(args.corpora);
    driveVal.validateSpaces(args.spaces);

    // Parse + validate q DSL (§4.2 operator/field matrix — throws 400 on violation)
    const conditions = driveVal.parseAndValidateQ(effectiveQ);

    // Apply filter
    let files = driveVal.applyQFilter(state.files.slice(), conditions);

    // Apply orderBy sort
    if (args.orderBy) {
      files = driveVal.applyOrderBy(files, args.orderBy);
    }

    // pageSize: clamp to 100, not reject (§4.1 trap #16)
    const pageSize = Math.min(100, Math.max(1, Number(args.pageSize) || 100));
    const total = files.length;

    // Simple cursor-based pagination (opaque token = offset string)
    let offset = 0;
    if (args.pageToken) {
      const decoded = parseInt(Buffer.from(args.pageToken, 'base64url').toString(), 10);
      if (!isNaN(decoded)) offset = decoded;
    }
    const page = files.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    const nextPageToken = nextOffset < total
      ? Buffer.from(String(nextOffset)).toString('base64url')
      : undefined;

    // Project each file to Drive shape
    const ownerAccount = state.account || {};
    const driveFiles = page.map((f) => driveVal.projectFileToDrive(f, ownerAccount));

    const result = {
      kind: 'drive#fileList',
      incompleteSearch: false,
      files: driveFiles
    };
    if (nextPageToken) result.nextPageToken = nextPageToken;
    return result;
  }

  // ── drive.files.get / get_drive_file_content ─────────────────────────────
  if (tool === 'drive.files.get' || tool === 'get_drive_file_content') {
    const id = args.fileId || args.documentId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    const file = requireFile(id);
    const ownerAccount = state.account || {};
    return driveVal.projectFileToDrive(file, ownerAccount);
  }

  // ── drive.files.create / create_drive_file ───────────────────────────────
  if (tool === 'drive.files.create' || tool === 'create_drive_file') {
    const name = String(args.name || '未命名').trim();
    const mimeType = String(args.mimeType || 'application/vnd.google-apps.document').trim();
    const parentId = (Array.isArray(args.parents) && args.parents[0]) || args.parentId || 'root';

    let created;
    if (mimeType === 'application/vnd.google-apps.folder') {
      // Create folder
      created = {
        id: makeId('folder'),
        name,
        type: 'folder',
        parentId,
        color: '#5f6368',
        starred: false,
        ownerId: 'me',
        trashed: false,
        createdAt: nowIso(),
        modifiedAt: nowIso()
      };
      state.files.unshift(created);
      pushEvent('folder_created', { fileId: created.id, name });
    } else {
      // Create document
      created = makeDocument(name, parentId);
    }
    saveState();
    const ownerAccount = state.account || {};
    return driveVal.projectFileToDrive(created, ownerAccount);
  }

  // ── drive.files.copy / copy_drive_file ───────────────────────────────────
  // Reuses the duplicate handler logic (no forking — shared mutation path).
  if (tool === 'drive.files.copy' || tool === 'copy_drive_file') {
    const id = args.fileId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    const file = requireFile(id);
    const copy = clone(file);
    const requestedName = String(args.name || '').trim();
    copy.id = makeId(file.type === 'folder' ? 'folder' : 'doc');
    copy.name = requestedName || `${file.name} 的副本`;
    copy.parentId = (Array.isArray(args.parents) && args.parents[0]) || file.parentId || 'root';
    copy.createdAt = nowIso();
    copy.modifiedAt = nowIso();
    copy.lastOpenedAt = nowIso();
    copy.starred = false;
    if (copy.content) copy.content.title = copy.name;
    if (file.type === 'document') {
      copy.comments = [];
      copy.reactions = [];
      state.versions[copy.id] = [];
    }
    state.files.unshift(copy);
    pushEvent('file_duplicated', { fileId: file.id, copyId: copy.id, copyName: copy.name, source: 'drive_tool' });
    saveState();
    const ownerAccount = state.account || {};
    return driveVal.projectFileToDrive(copy, ownerAccount);
  }

  // ── drive.files.update / update_drive_file ───────────────────────────────
  // PATCH semantics: rename, star, trash/restore, addParents/removeParents (move).
  if (tool === 'drive.files.update' || tool === 'update_drive_file') {
    const id = args.fileId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    const file = requireFile(id);

    if (typeof args.name === 'string') {
      file.name = args.name;
      if (file.type === 'document' && file.content) file.content.title = file.name;
    }
    if (typeof args.starred === 'boolean') {
      file.starred = args.starred;
    }
    if (typeof args.trashed === 'boolean') {
      file.trashed = args.trashed;
    }
    // Move: addParents sets new parent (first value); removeParents is acknowledged.
    if (args.addParents) {
      const newParent = String(args.addParents).split(',')[0].trim();
      if (newParent) file.parentId = newParent;
    }
    file.modifiedAt = nowIso();
    pushEvent('file_updated_drive', { fileId: file.id, source: 'drive_tool' });
    saveState();
    const ownerAccount = state.account || {};
    return driveVal.projectFileToDrive(file, ownerAccount);
  }

  // ── drive.files.delete ───────────────────────────────────────────────────
  if (tool === 'drive.files.delete') {
    const id = args.fileId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    const idx = state.files.findIndex((f) => f.id === id);
    if (idx < 0) throw driveVal.notFound(`File not found: ${id}.`, 'notFound');
    const [deleted] = state.files.splice(idx, 1);
    delete state.versions[deleted.id];
    pushEvent('file_deleted_drive', { fileId: id, source: 'drive_tool' });
    saveState();
    return {}; // Drive returns empty body on delete
  }

  // ── drive.permissions.create / set_drive_file_permissions ────────────────
  // §4.5: role ∈ {owner,organizer,fileOrganizer,writer,commenter,reader}
  //        type ∈ {user,group,domain,anyone}
  if (tool === 'drive.permissions.create' || tool === 'set_drive_file_permissions') {
    const id = args.fileId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    const file = requireFile(id);

    // ── ENUM VALIDATION (CLAUDE.md rule #10) ────────────────────────────
    driveVal.validatePermission(args.role, args.type);

    const driveRole = String(args.role);
    const permType = String(args.type);
    const emailAddress = args.emailAddress || args.email || '';
    const permId = makeId('perm');

    // Map Drive role → mock role for sharedWith consistency
    const mockRole = driveVal.driveRoleToMock(driveRole);

    file.sharedWith ||= [];

    // Ensure the person exists in state.people if email provided
    let personId = permId;
    if (emailAddress && (permType === 'user' || permType === 'group')) {
      const existing = state.people.find((p) => p.email === emailAddress);
      if (existing) {
        personId = existing.id;
      } else {
        personId = makeId('p');
        state.people.push({
          id: personId,
          displayName: emailAddress.split('@')[0],
          email: emailAddress,
          color: '#5f6368',
          initial: emailAddress.slice(0, 1).toUpperCase()
        });
      }
    }

    // Add or update sharedWith entry (mock-native)
    const existingShare = file.sharedWith.find((s) => s.personId === personId);
    if (existingShare) {
      existingShare.role = mockRole;
      existingShare.permId = permId;
      existingShare.driveRole = driveRole;
      existingShare.type = permType;
      existingShare.email = emailAddress || existingShare.email;
    } else {
      file.sharedWith.push({
        personId,
        role: mockRole,   // mock-native role (viewer/commenter/editor)
        driveRole,        // Drive role verbatim
        permId,
        type: permType,
        email: emailAddress || undefined
      });
    }

    file.modifiedAt = nowIso();
    pushEvent('permission_created', { fileId: file.id, personId, driveRole, mockRole, type: permType, source: 'drive_tool' });
    saveState();

    // Return Drive-shaped Permission (§4.5)
    return {
      kind: 'drive#permission',
      id: permId,
      type: permType,
      role: driveRole,
      emailAddress: emailAddress || undefined
    };
  }

  // ── drive.permissions.list / get_drive_file_permissions ──────────────────
  if (tool === 'drive.permissions.list' || tool === 'get_drive_file_permissions') {
    const id = args.fileId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    const file = requireFile(id);

    // Build a people lookup map for enrichment
    const peopleMap = {};
    (state.people || []).forEach((p) => { peopleMap[p.id] = p; });

    const permissions = (file.sharedWith || []).map((entry) => {
      const perm = driveVal.drivePermissionShape(entry, entry.permId || entry.personId, peopleMap);
      // Use driveRole if stored, else re-derive from mock role
      if (entry.driveRole) perm.role = entry.driveRole;
      return perm;
    });

    return {
      kind: 'drive#permissionList',
      permissions
    };
  }

  // ── drive.permissions.delete ─────────────────────────────────────────────
  if (tool === 'drive.permissions.delete') {
    const id = args.fileId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    const file = requireFile(id);
    const permId = args.permissionId;
    if (!permId) throw driveVal.invalidArgument('permissionId is required', 'missingPermissionId');

    const before = (file.sharedWith || []).length;
    file.sharedWith = (file.sharedWith || []).filter(
      (s) => s.permId !== permId && s.personId !== permId
    );
    if (file.sharedWith.length === before) {
      throw driveVal.notFound(`Permission not found: ${permId}.`, 'notFound');
    }
    file.modifiedAt = nowIso();
    pushEvent('permission_deleted', { fileId: file.id, permId, source: 'drive_tool' });
    saveState();
    return {}; // empty body on delete
  }

  // ── drive.revisions.list ─────────────────────────────────────────────────
  if (tool === 'drive.revisions.list') {
    const id = args.fileId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    requireFile(id); // verify exists
    const versions = state.versions[id] || [];
    return {
      kind: 'drive#revisionList',
      revisions: versions.map((v) => driveVal.driveRevisionShape(v))
    };
  }

  // ── drive.revisions.get ──────────────────────────────────────────────────
  if (tool === 'drive.revisions.get') {
    const id = args.fileId;
    if (!id) throw driveVal.invalidArgument('fileId is required', 'missingFileId');
    requireFile(id); // verify file exists
    const revId = args.revisionId;
    if (!revId) throw driveVal.invalidArgument('revisionId is required', 'missingRevisionId');
    const versions = state.versions[id] || [];
    const version = versions.find((v) => v.id === revId);
    if (!version) throw driveVal.notFound(`Revision not found: ${revId}.`, 'notFound');
    return driveVal.driveRevisionShape(version);
  }

  throw driveVal.notFound(`Unknown tool: ${tool}`, 'unknownTool');
}

// Wrap a plain payload as MCP content (mirrors gmail_mock).
function mcpToolResult(payload) {
  if (payload && Array.isArray(payload.content)) return payload;
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
  };
}

function callWorkspaceToolLogged(surface, toolName, args) {
  const result = callWorkspaceTool(toolName, args);
  pushEvent('workspace_tool_called', {
    surface,
    toolName: typeof toolName === 'string' ? toolName : String(toolName || '')
  });
  saveState();
  return result;
}

async function handleMcp(req, res) {
  const body = await readBody(req);
  const idValue = body.id !== undefined ? body.id : null;
  try {
    if (body.method === 'initialize') {
      return sendJson(res, {
        jsonrpc: '2.0',
        id: idValue,
        result: {
          protocolVersion: body.params?.protocolVersion || '2025-06-18',
          serverInfo: { name: 'google-docs-mock', version: '0.39.0' },
          capabilities: { tools: {} }
        }
      });
    }
    if (body.method === 'tools/list') {
      return sendJson(res, {
        jsonrpc: '2.0',
        id: idValue,
        result: { tools: workspaceToolSchemas() }
      });
    }
    if (body.method === 'tools/call') {
      const toolName = body.params?.name;
      const toolArgs = body.params?.arguments || {};
      const payload = callWorkspaceToolLogged('mcp', toolName, toolArgs);
      return sendJson(res, {
        jsonrpc: '2.0',
        id: idValue,
        result: mcpToolResult(payload)
      });
    }
    return sendJson(res, {
      jsonrpc: '2.0',
      id: idValue,
      error: { code: -32601, message: 'Method not found' }
    });
  } catch (err) {
    // Phase 2: embed Google error envelope in the MCP data field when available
    const mcpErr = { code: -32000, message: err.message };
    if (err.googleError) mcpErr.data = err.googleError;
    return sendJson(res, {
      jsonrpc: '2.0',
      id: idValue,
      error: mcpErr
    });
  }
}

function sendText(res, value, status = 200, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(value);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 25 * 1024 * 1024) {
        reject(Object.assign(new Error('body_too_large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function staticFile(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 'forbidden', 403);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendText(res, 'not found', 404);
  const ext = path.extname(filePath);
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  const body = req.method === 'GET' ? {} : await readBody(req);
  const segments = url.pathname.split('/').filter(Boolean);
  const route = `/${segments.join('/')}`;

  if (req.method === 'GET' && route === '/api/session') {
    // UI mode: only a real browser session (page already loaded → nonce cookie) may
    // obtain the per-session UI token. Closes the "curl /api/session for a token" hole.
    if (browserLockEnabled() && !isVerifier(req) && !hasValidBrowserNonce(req)) {
      pushEvent('browser_session_required', { method: req.method, path: req.url });
      return sendJson(res, { error: 'browser_session_required', message: 'Open the page in a browser first.' }, 403);
    }
    res.setHeader('set-cookie', `gdocs_mock_nonce=${UI_TOKEN}; SameSite=Lax; Path=/`);
    return sendJson(res, { uiToken: UI_TOKEN, account: state.account || null });
  }
  if (req.method === 'GET' && route === '/api/state') {
    if (isVerifier(req)) return sendJson(res, state);
    if (browserLockEnabled() && hasValidBrowserNonce(req)) return sendJson(res, state);
    if (!browserLockEnabled()) return sendJson(res, state);
    {
      pushEvent('verifier_only', { method: req.method, path: req.url });
      return sendJson(res, { error: 'verifier_token_required' }, 403);
    }
  }
  if (req.method === 'GET' && route === '/api/files') {
    return sendJson(res, listFiles(url.searchParams));
  }
  if (req.method === 'GET' && segments[0] === 'api' && segments[1] === 'files' && segments[2]) {
    return sendJson(res, { file: enrichFile(requireFile(decodeURIComponent(segments[2]))) });
  }
  if (req.method === 'GET' && route === '/api/templates') {
    return sendJson(res, { templates: state.templates });
  }
  if (req.method === 'GET' && route === '/api/comments') {
    const file = requireFile(url.searchParams.get('fileId'), 'document');
    return sendJson(res, { comments: file.comments || [] });
  }
  if (req.method === 'GET' && route === '/api/reactions') {
    const file = requireFile(url.searchParams.get('fileId'), 'document');
    return sendJson(res, { reactions: file.reactions || [] });
  }
  if (req.method === 'GET' && route === '/api/versions') {
    return sendJson(res, { versions: state.versions[url.searchParams.get('fileId')] || [] });
  }
  if (req.method === 'GET' && route === '/api/documents/export') {
    const file = requireFile(url.searchParams.get('fileId'), 'document');
    const requestedFormat = String(url.searchParams.get('format') || 'docx').toLowerCase();
    const format = EXPORT_FORMATS[requestedFormat] ? requestedFormat : 'docx';
    const result = exportDocument(file, format);
    pushEvent('document_exported', {
      fileId: file.id,
      format,
      mime: result.mime,
      filename: result.filename,
      size: result.data.length
    });
    saveState();
    return sendDownload(res, result);
  }
  if (req.method === 'GET' && route === '/api/workspace/tools') {
    if (!mcpEnabled()) return denyMcp(req, res, 'workspace_tools');
    return sendJson(res, { tools: workspaceToolSchemas() });
  }
  // Workspace/MCP tool calls bypass the UI-token gate, so they are deny-by-default
  // (open only for MCP-mode tasks via config.mcpEnabled / GDOCS_ENABLE_MCP).
  if (req.method === 'POST' && route === '/api/workspace/call') {
    if (!mcpEnabled()) return denyMcp(req, res, 'workspace_call');
    const toolName = body.name || body.tool;
    const args = body.arguments || body.args || {};
    try {
      const result = callWorkspaceToolLogged('workspace_api', toolName, args);
      return sendJson(res, { result });
    } catch (err) {
      const status = err.status || 500;
      // Phase 2: propagate Google error envelope if present
      if (err.googleError) return sendJson(res, err.googleError, status);
      return sendJson(res, { error: err.message }, status);
    }
  }

  if (req.method !== 'GET') requireWriteAuth(req);

  if (req.method === 'POST' && route === '/api/reset') {
    if (!isVerifier(req)) return sendJson(res, { error: 'verifier_token_required' }, 403);
    if (fs.existsSync(STATE_PATH)) fs.rmSync(STATE_PATH);
    state = loadState();
    saveState();
    return sendJson(res, { ok: true });
  }
  if (req.method === 'POST' && route === '/api/ui-events') {
    const allowedTypes = new Set([
      'suggested_edits_review_opened',
      'suggested_edits_review_preview_changed',
      'suggested_edits_review_single_applied',
      'suggested_edits_review_batch_applied',
      'image_options_menu_opened',
      'image_options_panel_opened',
      'image_options_updated',
      'comments_panel_toggled',
      'comment_sidecard_draft_opened',
      'comment_sidecard_submitted',
      'comment_sidecard_reply_opened',
      'comment_sidecard_reply_submitted',
      'toolbar_menu_opened',
      'find_replace_opened',
      'find_replace_replace_all'
    ]);
    const type = String(body.type || '');
    if (!allowedTypes.has(type)) return sendJson(res, { error: 'unsupported_ui_event' }, 400);
    const event = {
      fileId: typeof body.fileId === 'string' ? body.fileId : null,
      action: typeof body.action === 'string' ? body.action : undefined,
      preview: typeof body.preview === 'string' ? body.preview : undefined,
      pendingCount: optionalNumber(body.pendingCount),
      commentCount: optionalNumber(body.commentCount),
      commentIds: Array.isArray(body.commentIds) ? body.commentIds.map((id) => String(id)).slice(0, 30) : undefined,
      commentId: typeof body.commentId === 'string' ? body.commentId : undefined,
      blockId: typeof body.blockId === 'string' ? body.blockId : undefined,
      anchorTop: optionalNumber(body.anchorTop),
      collapsed: typeof body.collapsed === 'boolean' ? body.collapsed : undefined,
      rangeStart: optionalNumber(body.rangeStart),
      rangeEnd: optionalNumber(body.rangeEnd),
      field: typeof body.field === 'string' ? body.field : undefined,
      value: typeof body.value === 'string' || typeof body.value === 'number' || typeof body.value === 'boolean' ? body.value : undefined,
      query: typeof body.query === 'string' ? body.query : undefined,
      replaceText: typeof body.replaceText === 'string' ? body.replaceText : undefined,
      matchCase: typeof body.matchCase === 'boolean' ? body.matchCase : undefined,
      replacementCount: optionalNumber(body.replacementCount)
    };
    Object.keys(event).forEach((key) => event[key] === undefined && delete event[key]);
    pushEvent(type, event);
    saveState();
    return sendJson(res, { ok: true });
  }
  if (req.method === 'POST' && route === '/api/folders') {
    const folder = {
      id: makeId('folder'),
      name: String(body.name || '新建文件夹'),
      type: 'folder',
      parentId: body.parentId || 'root',
      color: body.color || '#5f6368',
      starred: false,
      ownerId: 'me',
      trashed: false,
      createdAt: nowIso(),
      modifiedAt: nowIso()
    };
    state.files.unshift(folder);
    pushEvent('folder_created', { fileId: folder.id, name: folder.name });
    saveState();
    return sendJson(res, { folder: enrichFile(folder) });
  }
  if (req.method === 'POST' && route === '/api/documents') {
    const doc = makeDocument(String(body.name || '未命名文档'), body.parentId || 'root');
    return sendJson(res, { document: enrichFile(doc) });
  }
  if (req.method === 'POST' && route === '/api/documents/open') {
    const file = requireFile(body.fileId, 'document');
    file.lastOpenedAt = nowIso();
    state.view.activeDocId = file.id;
    saveState();
    return sendJson(res, { document: enrichFile(file) });
  }
  if (req.method === 'POST' && route === '/api/documents/edit') {
    const file = requireFile(body.fileId, 'document');
    const title = String(body.title || file.name || '未命名文档');
    file.name = title;
    file.content ||= {};
    file.content.title = title;
    if (Array.isArray(body.blocks)) file.content.blocks = clone(body.blocks);
    file.modifiedAt = nowIso();
    file.lastModifiedById = 'me';
    snapshotVersion(file, '编辑');
    pushEvent('document_edited', { fileId: file.id });
    saveState();
    return sendJson(res, { document: enrichFile(file) });
  }
  if (req.method === 'POST' && route === '/api/files/rename') {
    const file = requireFile(body.fileId);
    file.name = String(body.name || file.name);
    if (file.type === 'document') file.content = { ...(file.content || {}), title: file.name };
    file.modifiedAt = nowIso();
    saveState();
    return sendJson(res, { file: enrichFile(file) });
  }
  if (req.method === 'POST' && route === '/api/files/move') {
    const file = requireFile(body.fileId);
    file.parentId = body.parentId || 'root';
    file.modifiedAt = nowIso();
    saveState();
    return sendJson(res, { file: enrichFile(file) });
  }
  if (req.method === 'POST' && route === '/api/files/star') {
    const file = requireFile(body.fileId);
    file.starred = Boolean(body.starred);
    saveState();
    return sendJson(res, { file: enrichFile(file) });
  }
  if (req.method === 'POST' && route === '/api/files/trash') {
    const file = requireFile(body.fileId);
    file.trashed = true;
    file.modifiedAt = nowIso();
    saveState();
    return sendJson(res, { file: enrichFile(file) });
  }
  if (req.method === 'POST' && route === '/api/files/restore') {
    const file = requireFile(body.fileId);
    file.trashed = false;
    file.modifiedAt = nowIso();
    saveState();
    return sendJson(res, { file: enrichFile(file) });
  }
  if (req.method === 'POST' && route === '/api/files/delete') {
    const idx = state.files.findIndex((file) => file.id === body.fileId);
    if (idx < 0) return sendJson(res, { ok: false, error: 'file_not_found' }, 404);
    const [file] = state.files.splice(idx, 1);
    delete state.versions[file.id];
    saveState();
    return sendJson(res, { ok: true });
  }
  if (req.method === 'POST' && route === '/api/files/duplicate') {
    const file = requireFile(body.fileId);
    const copy = clone(file);
    const requestedName = String(body.name || '').trim();
    const copyComments = Boolean(body.copyComments);
    const includeResolvedComments = Boolean(body.includeResolvedComments);
    copy.id = makeId(file.type === 'folder' ? 'folder' : 'doc');
    copy.name = requestedName || `${file.name} 副本`;
    copy.parentId = body.parentId || file.parentId || 'root';
    copy.createdAt = nowIso();
    copy.modifiedAt = nowIso();
    copy.lastOpenedAt = nowIso();
    copy.starred = false;
    if (copy.content) copy.content.title = copy.name;
    if (file.type === 'document') {
      copy.comments = copyDocumentAnnotations(file, copy.id, { copyComments, includeResolvedComments });
      copy.reactions = [];
      state.versions[copy.id] = [];
    }
    state.files.unshift(copy);
    pushEvent('file_duplicated', {
      fileId: file.id,
      copyId: copy.id,
      copyName: copy.name,
      copyComments,
      includeResolvedComments,
      copiedCommentCount: copy.comments?.length || 0
    });
    saveState();
    return sendJson(res, { file: enrichFile(copy) });
  }
  if (req.method === 'POST' && route === '/api/files/share') {
    const file = requireFile(body.fileId);
    file.sharedWith ||= [];
    if (body.linkAccess || body.linkRole) {
      file.linkAccess = normalizeLinkAccess(body.linkAccess, file.linkAccess || 'restricted');
      file.linkRole = normalizeShareRole(body.linkRole, file.linkRole || 'viewer');
      file.modifiedAt = nowIso();
      pushEvent('link_access_updated', {
        fileId: file.id,
        linkAccess: file.linkAccess,
        linkRole: file.linkRole
      });
    }
    if (body.personId || body.email) {
      const personId = body.personId || makeId('p');
      const role = normalizeShareRole(body.role, 'editor');
      if (!state.people.some((p) => p.id === personId) && body.email) {
        state.people.push({
          id: personId,
          displayName: body.email.split('@')[0],
          email: body.email,
          color: '#5f6368',
          initial: body.email.slice(0, 1).toUpperCase()
        });
      }
      const existing = file.sharedWith.find((entry) => entry.personId === personId);
      if (existing) existing.role = role;
      else file.sharedWith.push({ personId, role });
      file.modifiedAt = nowIso();
      pushEvent('file_shared', { fileId: file.id, personId, role });
    }
    saveState();
    return sendJson(res, { file: enrichFile(file) });
  }
  if (req.method === 'POST' && route === '/api/view/sort') {
    state.view.sortBy = body.sortBy || state.view.sortBy;
    state.view.sortDir = body.sortDir || state.view.sortDir;
    saveState();
    return sendJson(res, { view: state.view });
  }
  if (req.method === 'POST' && route === '/api/view/layout') {
    state.view.layout = body.layout || state.view.layout;
    saveState();
    return sendJson(res, { view: state.view });
  }
  if (req.method === 'POST' && route === '/api/templates/use') {
    const tpl = state.templates.find((t) => t.id === body.templateId) || state.templates[0];
    const name = String(body.name || tpl?.content?.title || tpl?.name || '未命名文档');
    const content = clone(tpl?.content || {
      title: name,
      blocks: [{ id: makeId('b'), type: 'paragraph', text: '', format: {} }]
    });
    content.title = name;
    const doc = makeDocument(name, body.parentId || 'root', content);
    return sendJson(res, { document: enrichFile(doc) });
  }
  if (req.method === 'POST' && route === '/api/comments') {
    const file = requireFile(body.fileId, 'document');
    file.comments ||= [];
    const comment = {
      id: makeId('cmt'),
      authorId: 'me',
      authorName: state.account?.name || '李明',
      authorColor: '#1a73e8',
      text: String(body.text || ''),
      quotedText: String(body.quotedText || ''),
      beforeText: typeof body.beforeText === 'string' ? body.beforeText : '',
      afterText: typeof body.afterText === 'string' ? body.afterText : '',
      blockId: body.blockId || null,
      anchorTop: body.anchorTop,
      collapsed: Boolean(body.collapsed),
      rangeStart: optionalNumber(body.rangeStart),
      rangeEnd: optionalNumber(body.rangeEnd),
      originalRangeStart: optionalNumber(body.originalRangeStart),
      originalRangeEnd: optionalNumber(body.originalRangeEnd),
      insertedText: typeof body.insertedText === 'string' ? body.insertedText : '',
      deletedText: typeof body.deletedText === 'string' ? body.deletedText : '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      type: body.type === 'suggestion' ? 'suggestion' : 'comment',
      resolved: false,
      mentionsMe: false,
      replies: []
    };
    file.comments.push(comment);
    file.modifiedAt = nowIso();
    pushEvent('comment_created', { fileId: file.id, commentId: comment.id, blockId: comment.blockId });
    saveState();
    return sendJson(res, { comment });
  }
  if (req.method === 'POST' && route === '/api/comments/reply') {
    const file = requireFile(body.fileId, 'document');
    const comment = (file.comments || []).find((c) => c.id === body.commentId);
    if (!comment) return sendJson(res, { error: 'comment_not_found' }, 404);
    comment.replies ||= [];
    comment.replies.push({
      id: makeId('rpl'),
      authorId: 'me',
      authorName: state.account?.name || '李明',
      authorColor: '#1a73e8',
      text: String(body.text || ''),
      createdAt: nowIso()
    });
    comment.updatedAt = nowIso();
    pushEvent('comment_replied', { fileId: file.id, commentId: comment.id });
    saveState();
    return sendJson(res, { comment });
  }
  if (req.method === 'POST' && (route === '/api/comments/resolve' || route === '/api/comments/reopen')) {
    const file = requireFile(body.fileId, 'document');
    const comment = (file.comments || []).find((c) => c.id === body.commentId);
    if (!comment) return sendJson(res, { error: 'comment_not_found' }, 404);
    const resolving = route.endsWith('/resolve');
    if (resolving && comment.type === 'suggestion' && typeof comment.afterText === 'string') {
      const block = (file.content?.blocks || []).find((item) => item.id === comment.blockId);
      if (block && block.text !== comment.afterText) {
        block.text = comment.afterText;
        file.modifiedAt = nowIso();
        snapshotVersion(file, '接受建议');
      }
    }
    comment.resolved = resolving;
    comment.updatedAt = nowIso();
    pushEvent(comment.resolved ? 'comment_resolved' : 'comment_reopened', { fileId: file.id, commentId: comment.id });
    saveState();
    return sendJson(res, { comment });
  }
  if (req.method === 'POST' && route === '/api/comments/reject') {
    const file = requireFile(body.fileId, 'document');
    const comment = (file.comments || []).find((c) => c.id === body.commentId);
    if (!comment) return sendJson(res, { error: 'comment_not_found' }, 404);
    if (comment.type !== 'suggestion') return sendJson(res, { error: 'not_a_suggestion' }, 400);
    const block = (file.content?.blocks || []).find((item) => item.id === comment.blockId);
    const beforeText = typeof comment.beforeText === 'string' ? comment.beforeText : comment.quotedText;
    if (block && typeof beforeText === 'string') {
      block.text = beforeText;
    }
    comment.resolved = true;
    comment.rejected = true;
    comment.updatedAt = nowIso();
    file.modifiedAt = nowIso();
    snapshotVersion(file, '拒绝建议');
    pushEvent('suggestion_rejected', { fileId: file.id, commentId: comment.id, blockId: comment.blockId });
    saveState();
    return sendJson(res, { comment, document: enrichFile(file) });
  }
  if (req.method === 'POST' && route === '/api/reactions') {
    const file = requireFile(body.fileId, 'document');
    file.reactions ||= [];
    const reaction = {
      id: makeId('rxn'),
      authorId: 'me',
      emoji: String(body.emoji || '👍'),
      blockId: body.blockId || null,
      anchorTop: body.anchorTop,
      quotedText: String(body.quotedText || ''),
      collapsed: Boolean(body.collapsed),
      rangeStart: optionalNumber(body.rangeStart),
      rangeEnd: optionalNumber(body.rangeEnd),
      createdAt: nowIso()
    };
    file.reactions.push(reaction);
    pushEvent('reaction_created', { fileId: file.id, reactionId: reaction.id, blockId: reaction.blockId });
    saveState();
    return sendJson(res, { reaction });
  }
  if (req.method === 'POST' && route === '/api/versions/restore') {
    const file = requireFile(body.fileId, 'document');
    const version = (state.versions[file.id] || []).find((v) => v.id === body.versionId);
    if (!version) return sendJson(res, { error: 'version_not_found' }, 404);
    file.name = version.title;
    file.content = { title: version.title, blocks: clone(version.blocks || []) };
    file.modifiedAt = nowIso();
    const restoredVersion = snapshotVersion(file, '还原');
    pushEvent('version_restored', {
      fileId: file.id,
      versionId: version.id,
      restoredVersionId: restoredVersion?.id,
      title: version.title
    });
    saveState();
    return sendJson(res, { document: enrichFile(file), version: restoredVersion });
  }
  if (req.method === 'POST' && route === '/api/versions/name') {
    const file = requireFile(body.fileId, 'document');
    const name = String(body.name || '').trim();
    if (!name) return sendJson(res, { error: 'name_required' }, 400);
    const versions = state.versions[file.id] || [];
    const version = body.versionId
      ? versions.find((item) => item.id === body.versionId)
      : ensureLatestVersion(file);
    if (!version) return sendJson(res, { error: 'version_not_found' }, 404);
    version.name = name;
    version.label = name;
    version.named = true;
    version.updatedAt = nowIso();
    pushEvent('version_named', { fileId: file.id, versionId: version.id, name });
    saveState();
    return sendJson(res, { version, versions: state.versions[file.id] || [] });
  }
  if (req.method === 'POST' && route === '/api/versions/copy') {
    const file = requireFile(body.fileId, 'document');
    const versions = state.versions[file.id] || [];
    const version = versions.find((item) => item.id === body.versionId);
    if (!version) return sendJson(res, { error: 'version_not_found' }, 404);
    const name = String(body.name || '').trim();
    if (!name) return sendJson(res, { error: 'name_required' }, 400);
    const content = {
      title: name,
      blocks: clone(version.blocks || [])
    };
    const copy = makeDocument(name, body.parentId || file.parentId || 'root', content);
    copy.sharedWith = body.shareWithSamePeople ? clone(file.sharedWith || []) : [];
    copy.copiedFromFileId = file.id;
    copy.copiedFromVersionId = version.id;
    copy.copiedFromVersionName = version.name || version.label || '';
    copy.modifiedAt = nowIso();
    if (state.versions[copy.id]?.[0]) {
      state.versions[copy.id][0].copiedFromFileId = file.id;
      state.versions[copy.id][0].copiedFromVersionId = version.id;
      state.versions[copy.id][0].label = '复制版本';
    }
    pushEvent('version_copied', {
      fileId: file.id,
      versionId: version.id,
      copyId: copy.id,
      copyName: copy.name,
      shareWithSamePeople: Boolean(body.shareWithSamePeople)
    });
    saveState();
    return sendJson(res, { file: enrichFile(copy), version });
  }
  return sendJson(res, { error: 'not_found' }, 404);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, { ok: true, service: 'google_docs_mock', port: PORT });
    }
    // Browser-client gate (UI mode): programmatic clients can't touch the SPA or
    // its API. The verifier (verifier token) is always exempt, as are MCP-mode
    // tasks (browserLockEnabled() false). Writes still also require nonce+UI token.
    if (browserLockEnabled() && !isVerifier(req)) {
      const p = url.pathname;
      const isDoc = req.method === 'GET' && (p === '/' || p.endsWith('.html'));
      const isAsset = req.method === 'GET' && /\.(js|css|map|png|jpe?g|svg|ico|gif|woff2?|ttf)$/i.test(p);
      if (p.startsWith('/api/') || p === '/mcp' || isDoc || isAsset) {
        const reason = classifyBrowserClient(req, { requireDocument: isDoc });
        if (reason) return denyNonBrowser(req, res, reason);
      }
      if (isDoc) mintBrowserNonce(req, res);
    }
    // MCP endpoint — JSON-RPC 2.0, does NOT start with /api/ (deny-by-default)
    if (url.pathname === '/mcp' && req.method === 'POST') {
      if (!mcpEnabled()) return denyMcp(req, res, 'mcp');
      return await handleMcp(req, res);
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method === 'GET' || req.method === 'HEAD') return staticFile(res, url.pathname);
    return sendText(res, 'method not allowed', 405);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    // Phase 2: propagate Google error envelope where available
    if (err.googleError) return sendJson(res, err.googleError, status);
    return sendJson(res, { error: err.message || 'server_error' }, status);
  }
});

server.listen(PORT, () => {
  console.log(`Google Docs mock listening on http://127.0.0.1:${PORT}`);
});
