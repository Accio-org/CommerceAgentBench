/* eslint-disable no-console */
// Google Docs Mock — frontend, aligned with the real product layout.

const API = {
  session: () => fetch('/api/session').then(unwrap),
  state: () => fetch('/api/state').then(unwrap),
  files: (params) => fetch('/api/files?' + new URLSearchParams(params)).then(unwrap),
  file: (id) => fetch(`/api/files/${encodeURIComponent(id)}`).then(unwrap),
  templates: () => fetch('/api/templates').then(unwrap),
  createFolder: (body) => post('/api/folders', body),
  createDocument: (body) => post('/api/documents', body),
  openDocument: (fileId) => post('/api/documents/open', { fileId }),
  editDocument: (body) => post('/api/documents/edit', body),
  rename: (fileId, name) => post('/api/files/rename', { fileId, name }),
  move: (fileId, parentId) => post('/api/files/move', { fileId, parentId }),
  star: (fileId, starred) => post('/api/files/star', { fileId, starred }),
  trash: (fileId) => post('/api/files/trash', { fileId }),
  restore: (fileId) => post('/api/files/restore', { fileId }),
  remove: (fileId) => post('/api/files/delete', { fileId }),
  duplicate: (fileId, options = {}) => post('/api/files/duplicate', { fileId, ...options }),
  share: (body) => post('/api/files/share', body),
  setSort: (sortBy, sortDir) => post('/api/view/sort', { sortBy, sortDir }),
  setLayout: (layout) => post('/api/view/layout', { layout }),
  useTemplate: (templateId, name, parentId) => post('/api/templates/use', { templateId, name, parentId }),
  comments: (fileId) => fetch('/api/comments?' + new URLSearchParams({ fileId })).then(unwrap),
  addComment: (body) => post('/api/comments', body),
  replyComment: (body) => post('/api/comments/reply', body),
  resolveComment: (body) => post('/api/comments/resolve', body),
  rejectComment: (body) => post('/api/comments/reject', body),
  reopenComment: (body) => post('/api/comments/reopen', body),
  reactions: (fileId) => fetch('/api/reactions?' + new URLSearchParams({ fileId })).then(unwrap),
  addReaction: (body) => post('/api/reactions', body),
  nameVersion: (body) => post('/api/versions/name', body),
  copyVersion: (body) => post('/api/versions/copy', body),
  logUiEvent: (body) => post('/api/ui-events', body)
};

function unwrap(res) {
  if (!res.ok) return res.json().then((err) => Promise.reject(err));
  return res.json();
}
function apiHeaders(extra = {}) {
  const headers = { ...extra };
  if (ui.uiToken) headers['x-ui-token'] = ui.uiToken;
  return headers;
}
function jsonHeaders() {
  return apiHeaders({ 'content-type': 'application/json' });
}
function post(path, body) {
  return fetch(path, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body || {}) }).then(unwrap);
}

// ============================ UI state ============================
const ui = {
  uiToken: null,
  view: 'home',
  currentFolderId: 'root',
  filterView: 'home',
  sortBy: 'lastOpenedAt',
  sortDir: 'desc',
  layout: 'grid',                     // grid is default on real Docs home
  ownerFilter: 'any',                 // 默认"不限归属"
  query: '',
  files: [],
  breadcrumbs: [],
  templates: [],
  templatesCategory: 'all',
  activeDocId: null,
  activeDoc: null,
  saveTimer: null,
  rowMenuTargetId: null,
  outlineCollapsed: false,
  editMode: 'editing',
  imeMode: null,
  fontSize: 11,
  paintFormatType: null,
  commentsTab: 'all',
  commentsType: null,
  commentsTabFilter: null,
  commentTarget: null,
  currentComments: null,
  commentsRenderSeq: 0,
  activeMarginCommentId: null,
  commentDraftTarget: null,
  reviewSuggestedEditsOpen: false,
  reviewSuggestedEditsPreview: 'suggestions',
  currentReactions: null,
  selectedImageBlockId: null,
  imageOptionsOpen: false,
  imageResize: null,
  imageClearGuardUntil: 0,
  imageSelectionStickyUntil: 0,
  wordCountVisible: false,
  findReplace: null,
  suggestionTimers: new Map(),
  pickerTab: 'recent',
  pickerFolderId: 'root',
  pickerBreadcrumbs: [],
  pickerFiles: [],
  pickerRenderSeq: 0,
  shareReturnView: null,
  account: null,
  people: []
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const SORT_LABELS = {
  lastOpenedAt: '我上次打开的时间',
  lastEditedAt: '我上次编辑的时间',
  modifiedAt: '上次修改时间',
  name: '标题'
};
const SORT_ORDER = ['lastOpenedAt', 'lastEditedAt', 'modifiedAt', 'name'];
const OWNER_LABELS = { any: '不限归属', me: '归我所有', others: '非我所有' };

// Default to "不限归属" like the real Docs home shows.
const DEFAULT_OWNER = 'any';

const DOWNLOAD_FORMATS = [
  { id: 'docx', label: 'Microsoft Word (.docx)' },
  { id: 'odt', label: 'OpenDocument 格式 (.odt)' },
  { id: 'rtf', label: '富文本格式 (.rtf)' },
  { id: 'pdf', label: 'PDF 文档 (.pdf)' },
  { id: 'txt', label: '纯文本 (.txt)' },
  { id: 'html', label: '网页 (.html, zip)' },
  { id: 'epub', label: 'EPUB 出版物 (.epub)' },
  { id: 'md', label: 'Markdown (.md)' }
];

// ============================ Boot ============================

document.addEventListener('DOMContentLoaded', async () => {
  const session = await API.session();
  ui.uiToken = session.uiToken;
  await refreshState();
  ui.layout = 'grid';                 // override stale state from previous version
  bindGlobalEvents();
  await renderHome();
});

async function refreshState() {
  const state = await API.state();
  ui.account = state.account;
  ui.people = state.people;
  ui.sortBy = state.view.sortBy;
  ui.sortDir = state.view.sortDir;
  ui.templates = state.templates;
  $('#owner-filter-label').textContent = OWNER_LABELS[ui.ownerFilter];
  syncLayoutToggle();
  $('#account-button').textContent = state.account.avatar;
  $('#editor-avatar').textContent = state.account.avatar;
}

function syncLayoutToggle() {
  const btn = $('#layout-toggle');
  if (!btn) return;
  // In grid mode the button represents "switch to list" — shows list icon + 列表视图 tooltip.
  // In list mode it represents "switch to grid" — shows grid icon + 网格视图 tooltip.
  const showsListIcon = ui.layout === 'grid';
  btn.dataset.mode = ui.layout;
  btn.setAttribute('aria-label', showsListIcon ? '列表视图' : '网格视图');
  btn.setAttribute('data-tooltip', showsListIcon ? '列表视图' : '网格视图');
  $('#layout-toggle-icon').innerHTML = showsListIcon
    ? '<path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>'                                         /* list icon */
    : '<path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z"/>';                            /* grid icon */
}

function setView(view) {
  ui.view = view;
  document.body.dataset.view = view;
  $('#home-view').hidden = view !== 'home';
  $('#templates-view').hidden = view !== 'templates';
  $('#editor-view').hidden = view !== 'editor';
  const hv = $('#history-view'); if (hv) hv.hidden = view !== 'history';
  syncWordCountBubble();
}

// ============================ Home view ============================

async function renderHome(viewKey = ui.filterView) {
  setView('home');
  ui.filterView = viewKey;

  const params = { sortBy: ui.sortBy, sortDir: ui.sortDir };
  if (ui.ownerFilter && ui.ownerFilter !== 'any') params.owner = ui.ownerFilter;
  if (ui.query) params.query = ui.query;
  if (viewKey === 'home') {
    params.parentId = ui.currentFolderId;
    params.view = 'home';
  } else {
    params.view = viewKey;
  }
  const data = await API.files(params);
  ui.files = viewKey === 'home'
    ? data.files.filter((file) => file.type === 'document')
    : data.files;
  ui.breadcrumbs = data.breadcrumbs || [];
  ui.currentFolderId = data.currentFolderId;

  renderTemplateStrip();
  renderBreadcrumb();
  renderFiles();
}

function renderTemplateStrip() {
  const row = $('#template-row');
  row.innerHTML = '';
  const featured = ui.templates.filter((t) => t.featured).slice(0, 6);
  featured.forEach((tpl) => row.appendChild(renderTemplateCard(tpl, { featured: true })));
}

function renderTemplateCard(tpl, opts = {}) {
  const card = document.createElement('div');
  card.className = 'template-card docs-homescreen-templates-list-item' + (tpl.id === 'tpl-blank' ? ' blank' : '');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', '选择模板');
  card.dataset.tooltip = tpl.subname ? `${tpl.name} ${tpl.subname}` : tpl.name;
  const thumb = document.createElement('div');
  thumb.className = 'thumb docs-homescreen-templates-list-item-thumbnail';
  if (tpl.id === 'tpl-blank') {
    const plus = document.createElement('div');
    plus.className = 'blank-plus';
    plus.textContent = '+';
    thumb.appendChild(plus);
  } else {
    thumb.appendChild(renderTplSkin(tpl, { useContentPreview: !opts.featured }));
  }
  card.appendChild(thumb);
  const name = document.createElement('div');
  name.className = 'name docs-homescreen-templates-list-item-title';
  name.textContent = tpl.name;
  card.appendChild(name);
  if (tpl.subname) {
    const sub = document.createElement('div');
    sub.className = 'subname docs-homescreen-templates-list-item-subtitle';
    sub.textContent = tpl.subname;
    card.appendChild(sub);
  }
  card.addEventListener('click', async () => {
    const result = await API.useTemplate(tpl.id, '', ui.currentFolderId);
    toast(`已从模版「${tpl.name}」创建文档`);
    await renderHome();
    openEditor(result.document.id);
  });
  return card;
}

// Render the colorful preview skin inside a template thumb based on its skin id.
function renderTplSkin(tpl, opts = {}) {
  // If template explicitly opts into content-driven preview, render the actual document at scale.
  if (opts.useContentPreview !== false && tpl.previewFromContent && tpl.content?.blocks?.length) {
    return renderTplRealPreview(tpl);
  }
  const skin = document.createElement('div');
  const variant = tpl.skin || 'generic';
  skin.className = `tpl-skin ${variant}`;
  skin.innerHTML = generateSkinBody(variant);
  return skin;
}

// Render the template's actual content as a scaled-down "real" mini-preview.
// The container fixes the canvas at editor-paper width (816px) and uses CSS transform: scale to fit.
function renderTplRealPreview(tpl) {
  const skin = document.createElement('div');
  skin.className = 'tpl-skin tpl-real';
  const canvas = document.createElement('div');
  canvas.className = 'tpl-real-canvas paper-content';
  if (tpl.content.layout === 'two-col-resume') {
    canvas.classList.add('two-col-resume');
    renderTwoColResumeInto(canvas, tpl.content.blocks);
  } else {
    tpl.content.blocks.forEach((b) => canvas.appendChild(renderBlock(b)));
  }
  skin.appendChild(canvas);
  return skin;
}

function generateSkinBody(variant) {
  const lines = (n, classes = ['f', 'm', 's']) => Array.from({ length: n }, (_, i) => `<div class="l ${classes[i % classes.length]}"></div>`).join('');
  switch (variant) {
    // ===== 简历 =====
    case 'resume-serif':
      return `
        <div class="side">
          <div class="seg"><div class="lbl"></div></div>
          <div class="seg"><div class="lbl short"></div></div>
          <div class="seg"><div class="lbl"></div></div>
          <div class="seg"><div class="lbl short"></div></div>
        </div>
        <div class="main">
          <div class="h"></div>
          <div class="sub"></div>
          ${lines(2, ['f', 'm'])}
          <div class="gap"></div>
          ${lines(2, ['f', 's'])}
          <div class="gap"></div>
          ${lines(3, ['f', 'm', 's'])}
        </div>`;
    case 'resume-coral':
    case 'resume-mint':
      return `
        <div class="top">
          <div class="h"></div>
          <div class="sub"></div>
        </div>
        <div class="body">
          <div class="sec-h"></div>
          ${lines(2, ['f', 'm'])}
          <div class="sec-h"></div>
          ${lines(3, ['f', 'm', 's'])}
          <div class="sec-h"></div>
          ${lines(2, ['m', 's'])}
        </div>`;
    case 'resume-swiss':
      return `
        <div class="h"></div>
        <div class="sub"></div>
        <div class="grid"><div></div><div></div><div></div></div>
        ${lines(5, ['f', 'm', 'f', 's', 'f'])}`;
    case 'resume-modern':
      return `
        <div class="h"></div>
        <div class="accent"></div>
        ${lines(2, ['m', 's'])}
        <div class="sec-h"></div>
        ${lines(3, ['f', 'm', 's'])}`;

    // ===== 信函 =====
    case 'letter-mint':
      return `
        <div class="frame">
          <div class="h"></div>
          <div class="sub"></div>
          <div class="gap"></div>
          ${lines(5)}
          <div class="gap"></div>
          ${lines(2, ['m', 's'])}
        </div>`;
    case 'letter-coral':
    case 'letter-modern':
    case 'letter-informal':
      return `
        <div class="body">
          <div class="h"></div>
          <div class="sub"></div>
          <div class="gap"></div>
          ${lines(5)}
        </div>`;
    case 'letter-bold':
      return `
        <div class="h"></div>
        <div class="sub"></div>
        <div class="gap"></div>
        ${lines(5)}`;

    // ===== 工作 =====
    case 'project-tropical':
    case 'lesson-illustrated':
      return `
        <div class="hero"></div>
        <div class="body">
          <div class="h"></div>
          <div class="sub"></div>
          <div class="sec-h"></div>
          ${lines(3, ['f', 'm', 's'])}
        </div>`;
    case 'project-modern':
      return `
        <div class="top">
          <div class="h"></div>
          <div class="sub"></div>
        </div>
        <div class="body">
          <div class="sec-h"></div>
          ${lines(2, ['f', 'm'])}
          <div class="sec-h"></div>
          ${lines(3, ['f', 'm', 's'])}
        </div>`;
    case 'brochure-geo':
    case 'brochure-spearmint':
      return `
        <div class="hero"></div>
        <div class="body">
          <div class="h"></div>
          <div class="sub"></div>
          ${lines(3)}
        </div>`;
    case 'report-luxe':
      return `
        <div class="pre">
          <div class="sub"></div>
          <div class="h"></div>
          <div class="accent"></div>
        </div>
        <div class="photo"></div>
        <div class="body">
          ${lines(4, ['f', 'm', 's', 'f'])}
        </div>`;
    case 'meeting':
      return `
        <div class="h"></div>
        <div class="sub"></div>
        <div class="sec-h"></div>
        ${lines(2, ['m', 's'])}
        <div class="sec-h"></div>
        ${lines(2, ['m', 's'])}`;
    case 'email-draft':
      return `
        <div class="h"></div>
        ${lines(5, ['f', 'm', 'f', 's', 'f'])}`;
    case 'onboarding':
      return `
        <div class="h"></div>
        <div class="sec-h"></div>
        ${lines(2, ['f', 'm'])}
        <div class="sec-h"></div>
        ${lines(2, ['f', 's'])}`;
    case 'proposal-blue':
      return `
        <div class="h"></div>
        <div class="accent"></div>
        <div class="sec-h"></div>
        ${lines(3, ['f', 'm', 's'])}`;

    // ===== 教育 =====
    case 'notes-serif':
      return `
        <div class="h"></div>
        <div class="sub"></div>
        <div class="accent"></div>
        <div class="sec-h"></div>
        ${lines(3, ['f', 'm', 's'])}
        <div class="sec-h"></div>
        ${lines(2, ['f', 's'])}`;
    case 'academic-mla':
      return `
        <div class="name"></div>
        <div class="meta"></div>
        <div class="h"></div>
        ${lines(6, ['f', 'm', 'f', 's', 'f', 'm'])}`;
    case 'academic-apa':
      return `
        <div class="h"></div>
        <div class="meta"></div>
        <div class="sec-h"></div>
        ${lines(4, ['f', 'm', 's', 'f'])}`;

    // ===== 生活 =====
    case 'recipe-warm':
      return `
        <div class="body">
          <div class="h"></div>
          <div class="sub"></div>
          <div class="sec-h"></div>
          ${lines(2, ['f', 'm'])}
          <div class="sec-h"></div>
          ${lines(3, ['f', 'm', 's'])}
        </div>`;
    case 'paperback-classic':
      return `
        <div class="h"></div>
        <div class="accent"></div>
        <div class="sub"></div>
        <div class="author"></div>`;
    case 'biodata-portrait':
      return `
        <div class="h"></div>
        <div class="sub"></div>
        ${lines(4, ['f', 'm', 'f', 's'])}`;

    default:
      return `
        <div class="h"></div>
        ${lines(2, ['m', 's'])}
        <div class="gap"></div>
        ${lines(5)}`;
  }
}

function renderBreadcrumb() {
  const wrap = $('#breadcrumb');
  wrap.innerHTML = '';
  if (ui.filterView !== 'home' || !ui.breadcrumbs.length || ui.breadcrumbs.length === 1) return;
  ui.breadcrumbs.forEach((crumb, idx) => {
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep'; sep.textContent = '›';
      wrap.appendChild(sep);
    }
    if (idx === ui.breadcrumbs.length - 1) {
      const span = document.createElement('span');
      span.className = 'current'; span.textContent = crumb.name;
      wrap.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = crumb.name;
      btn.addEventListener('click', () => { ui.currentFolderId = crumb.id; renderHome('home'); });
      wrap.appendChild(btn);
    }
  });
}

function renderFiles() {
  const tbody = $('#file-list-body');
  const grid = $('#file-grid');
  tbody.innerHTML = ''; grid.innerHTML = '';

  if (!ui.files.length) {
    $('#empty-state').hidden = false;
    $('#file-list-table').hidden = true;
    grid.hidden = true;
    return;
  }
  $('#empty-state').hidden = true;
  $('#file-list-table').hidden = ui.layout !== 'list';
  grid.hidden = ui.layout !== 'grid';

  if (ui.layout === 'list') {
    ui.files.forEach((file) => tbody.appendChild(renderFileRow(file)));
  } else {
    ui.files.forEach((file) => grid.appendChild(renderFileCard(file)));
  }
}

function docIconSvg(color = '#1a73e8') {
  return `<svg class="doc-icon" viewBox="0 0 24 24"><path fill="${color}" d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM6 20V4h8v5h5v11z"/><path fill="#fff" d="M8 12h8v1.5H8zm0 3h8v1.5H8zm0 3h5v1.5H8z"/></svg>`;
}

function renderFileCard(file) {
  const card = document.createElement('div');
  card.className = 'file-card docs-homescreen-grid-item' + (file.type === 'folder' ? ' folder-card' : '');
  card.setAttribute('role', 'listitem');
  card.setAttribute('aria-label', `${file.name} ${file.type === 'folder' ? '文件夹' : 'Google 文档'}`);
  card.dataset.fileId = file.id;
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (file.type === 'folder') {
    thumb.textContent = '📁';
    thumb.style.color = file.color || 'var(--gd-text-muted)';
  } else {
    const doc = document.createElement('div');
    doc.className = 'fake-doc';
    doc.innerHTML = `<div class="h"></div><div class="l"></div><div class="l med"></div><div class="l short"></div><div class="l"></div><div class="l med"></div><div class="l short"></div><div class="l"></div>`;
    thumb.appendChild(doc);
  }
  const meta = document.createElement('div');
  meta.className = 'meta';
  const timeText = file.type === 'folder'
    ? '文件夹'
    : '上次打开时间 ' + relTime(file.lastOpenedAt || file.modifiedAt, '');
  meta.innerHTML = `
    <div class="name docs-homescreen-list-item-title">${escape(file.name)}</div>
    ${file.type === 'folder' ? '<span class="doc-icon" style="font-size:14px;">📁</span>' : docIconSvg()}
    <div class="sub docs-homescreen-list-item-time" aria-label="${escape(timeText)}">${escape(timeText)}</div>
    <button class="row-action" type="button" data-action="menu" aria-label="更多操作。" aria-haspopup="true">⋮</button>
  `;
  // star floats over thumb top-right
  const star = document.createElement('button');
  star.className = `star ${file.starred ? 'active' : ''}`;
  star.type = 'button'; star.dataset.action = 'star'; star.setAttribute('aria-label', '加星');
  star.textContent = '★';
  star.style.cssText = 'position:absolute;top:8px;right:8px;z-index:1;border:0;background:transparent;cursor:pointer;font-size:14px;color:transparent;';
  if (file.starred) star.style.color = 'var(--gd-yellow)';
  thumb.style.position = 'relative';
  thumb.appendChild(star);
  card.appendChild(thumb); card.appendChild(meta);
  card.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    handleOpenFile(file);
  });
  star.addEventListener('click', async (event) => {
    event.stopPropagation();
    await API.star(file.id, !file.starred);
    await renderHome(ui.filterView);
  });
  meta.querySelector('[data-action="menu"]').addEventListener('click', (event) => {
    event.stopPropagation();
    showRowMenu(event.currentTarget, file);
  });
  // reveal star on hover
  card.addEventListener('mouseenter', () => { star.style.color = file.starred ? 'var(--gd-yellow)' : 'var(--gd-text-muted)'; });
  card.addEventListener('mouseleave', () => { star.style.color = file.starred ? 'var(--gd-yellow)' : 'transparent'; });
  return card;
}

function renderFileRow(file) {
  const tr = document.createElement('tr');
  tr.dataset.fileId = file.id;
  const sharedBadge = file.sharedWith && file.sharedWith.length ? ' <span class="badge">已共享</span>' : '';
  tr.innerHTML = `
    <td class="col-name">
      ${file.type === 'folder'
        ? `<span class="doc-icon" style="font-size:18px;color:${escape(file.color || '#5f6368')}">📁</span>`
        : docIconSvg()}
      <div>
        <div class="file-name">${escape(file.name)}${sharedBadge}</div>
      </div>
      <button class="star ${file.starred ? 'active' : ''}" type="button" data-action="star" aria-label="加星">★</button>
    </td>
    <td>${escape(file.owner.displayName)}</td>
    <td>${escape(relTime(file.modifiedAt))}</td>
    <td><button class="row-action" type="button" data-action="menu" aria-label="更多操作">⋮</button></td>
  `;
  tr.addEventListener('click', (event) => { if (event.target.closest('button')) return; handleOpenFile(file); });
  tr.querySelector('[data-action="star"]').addEventListener('click', async (event) => {
    event.stopPropagation();
    await API.star(file.id, !file.starred);
    await renderHome(ui.filterView);
  });
  tr.querySelector('[data-action="menu"]').addEventListener('click', (event) => {
    event.stopPropagation();
    showRowMenu(event.currentTarget, file);
  });
  return tr;
}

function handleOpenFile(file) {
  if (file.trashed) { toast('该文件位于回收站，需要先还原'); return; }
  if (file.type === 'folder') {
    ui.currentFolderId = file.id;
    ui.filterView = 'home';
    renderHome('home');
  } else {
    openEditor(file.id);
  }
}

// ============================ Templates view ============================

function showTemplatesView() {
  setView('templates');
  renderTemplateGallery();
}

function renderTemplateGallery() {
  const body = $('#gallery-body');
  body.innerHTML = '';

  // Section 1: "最近用过的模板" — featured templates first, blank doc included.
  const featured = ui.templates.filter((t) => t.featured);
  body.appendChild(renderGallerySection('最近用过的模板', featured, { columns: 7 }));

  // Section 2..N: each category as its own section, ordered by a known sequence.
  const categoryOrder = ['简历', '信函', '工作', '教育', '生活', '通用'];
  const seenCats = new Set();
  categoryOrder.forEach((cat) => {
    seenCats.add(cat);
    const items = ui.templates.filter((t) => t.category === cat && t.id !== 'tpl-blank');
    if (items.length) body.appendChild(renderGallerySection(cat, items));
  });
  // any leftover categories not in our preferred order
  const leftover = [...new Set(ui.templates.map((t) => t.category))].filter((c) => !seenCats.has(c));
  leftover.forEach((cat) => {
    const items = ui.templates.filter((t) => t.category === cat && t.id !== 'tpl-blank');
    if (items.length) body.appendChild(renderGallerySection(cat, items));
  });
}

function renderGallerySection(title, items, opts = {}) {
  const section = document.createElement('section');
  section.className = 'gallery-section';
  if (opts.columns) section.style.setProperty('--gallery-cols', opts.columns);
  const head = document.createElement('h2');
  head.className = 'gallery-section-title';
  head.textContent = title;
  section.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'gallery-grid';
  items.forEach((tpl) => grid.appendChild(renderTemplateCard(tpl)));
  section.appendChild(grid);
  return section;
}

// ============================ Editor view ============================

async function openEditor(fileId) {
  setView('editor');
  ui.activeDocId = fileId;
  ui.currentComments = null;
  ui.currentReactions = null;
  ui.commentTarget = null;
  ui.commentDraftTarget = null;
  ui.activeMarginCommentId = null;
  const result = await API.openDocument(fileId);
  ui.activeDoc = result.document;
  $('#editor-title').value = ui.activeDoc.content.title || ui.activeDoc.name;
  syncStarButton();
  renderEditorContent();
  renderOutline();
  renderPaperSuggestions();
  setSaved(true);
  syncHistoryTooltip();
  focusEditorEnd();
  await refreshCommentSurfaces();
  await renderDocReactions();
}

function renderEditorContent(options = {}) {
  const wrap = $('#paper-content');
  wrap.innerHTML = '';
  ui.selectedImageBlockId = null;
  wrap.classList.remove('two-col-resume');
  const blocks = options.blocks || ui.activeDoc.content.blocks || [];
  const layout = options.layout || ui.activeDoc.content.layout;
  const reviewPreview = options.reviewSuggestedEditsPreview || 'suggestions';
  if (layout === 'two-col-resume') {
    wrap.classList.add('two-col-resume');
    renderTwoColResumeInto(wrap, blocks);
  } else {
    blocks.forEach((b) => wrap.appendChild(renderBlock(b)));
  }
  if (!wrap.children.length) wrap.appendChild(renderBlock({ id: 'b-empty', type: 'paragraph', text: '' }));
  wrap.contentEditable = reviewPreview === 'suggestions' && ui.editMode !== 'viewing' ? 'true' : 'false';
  wrap.spellcheck = false;
  if (reviewPreview === 'suggestions') {
    renderCommentAnchors();
    renderDocReactions();
  } else {
    renderDocCommentCards([], null);
    renderDocReactions();
  }
  updatePaperQuickActions();
  syncWordCountBubble();
}

// Group blocks by format.section and emit grid rows: each row = .tcr-left + .tcr-right
function renderTwoColResumeInto(parent, blocks) {
  const sections = {};
  const order = [];
  blocks.forEach((b) => {
    const sec = b.format?.section || 'main';
    if (!sections[sec]) { sections[sec] = { L: [], R: [] }; order.push(sec); }
    const col = b.format?.col === 'R' ? 'R' : 'L';
    sections[sec][col].push(b);
  });
  order.forEach((sec, idx) => {
    const row = document.createElement('div');
    row.className = `tcr-row tcr-${sec}` + (idx > 0 ? ' tcr-divided' : '');
    const left = document.createElement('div'); left.className = 'tcr-left';
    const right = document.createElement('div'); right.className = 'tcr-right';
    sections[sec].L.forEach((b) => left.appendChild(renderBlock(b)));
    sections[sec].R.forEach((b) => right.appendChild(renderBlock(b)));
    row.appendChild(left); row.appendChild(right);
    parent.appendChild(row);
  });
}

function normalizeLinkRanges(links = [], textLength = 0) {
  return (Array.isArray(links) ? links : [])
    .map((link) => ({
      start: Math.max(0, Math.min(textLength, Number(link.start) || 0)),
      end: Math.max(0, Math.min(textLength, Number(link.end) || 0)),
      url: String(link.url || '').trim()
    }))
    .filter((link) => link.url && link.end > link.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function normalizeTextRanges(ranges = [], textLength = 0) {
  return (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({
      start: Math.max(0, Math.min(textLength, Number(range.start) || 0)),
      end: Math.max(0, Math.min(textLength, Number(range.end) || 0)),
      id: range.id || ''
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function renderAnnotatedTextInto(node, text = '', links = [], highlights = [], suggestions = []) {
  node.textContent = '';
  const source = String(text || '');
  const cleanLinks = normalizeLinkRanges(links, source.length);
  const cleanHighlights = normalizeTextRanges(highlights, source.length);
  const cleanSuggestions = normalizeTextRanges(suggestions, source.length);
  const points = new Set([0, source.length]);
  cleanLinks.forEach((link) => { points.add(link.start); points.add(link.end); });
  cleanHighlights.forEach((range) => { points.add(range.start); points.add(range.end); });
  cleanSuggestions.forEach((range) => { points.add(range.start); points.add(range.end); });
  const sortedPoints = [...points].sort((a, b) => a - b);
  for (let i = 0; i < sortedPoints.length - 1; i += 1) {
    const start = sortedPoints[i];
    const end = sortedPoints[i + 1];
    if (end <= start) continue;
    const segment = source.slice(start, end);
    const link = cleanLinks.find((item) => item.start < end && item.end > start);
    const highlight = cleanHighlights.find((item) => item.start < end && item.end > start);
    const suggestion = cleanSuggestions.find((item) => item.start < end && item.end > start);
    if (!link && !highlight && !suggestion) {
      node.appendChild(document.createTextNode(segment));
      continue;
    }
    let child;
    if (link) {
      const anchor = document.createElement('a');
      anchor.className = 'doc-link';
      anchor.href = link.url;
      anchor.textContent = segment;
      anchor.setAttribute('data-doc-link', link.url);
      anchor.addEventListener('click', (event) => event.preventDefault());
      child = anchor;
    } else {
      child = document.createElement('span');
      child.textContent = segment;
    }
    if (highlight) {
      child.classList.add('doc-comment-highlight');
      if (highlight.id) child.dataset.commentId = highlight.id;
    }
    if (suggestion) {
      child.classList.add('doc-suggestion-insert');
      if (suggestion.id) child.dataset.suggestionId = suggestion.id;
    }
    node.appendChild(child);
  }
}

function renderLinkedTextInto(node, text = '', links = []) {
  renderAnnotatedTextInto(node, text, links, []);
}

function renderBlockTextAnnotations(block, comments = []) {
  if (!block || ['banner', 'image', 'table'].includes(block.dataset.type)) return;
  const text = block.textContent || '';
  const format = parseBlockFormat(block);
  const highlights = commentHighlightRangesForBlock(block, comments);
  const suggestions = suggestionRangesForBlock(block, comments);
  renderAnnotatedTextInto(block, text, format.links || [], highlights, suggestions);
}

function commentHighlightRangesForBlock(block, comments = []) {
  const text = block?.textContent || '';
  const ranges = [];
  comments.filter((comment) => !comment.resolved && comment.blockId === block.dataset.id).forEach((comment) => {
    const start = Number(comment.rangeStart);
    const end = Number(comment.rangeEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      ranges.push({ start, end, id: comment.id });
      return;
    }
    const quoted = String(comment.quotedText || '').trim();
    if (!comment.collapsed && quoted) {
      const index = text.indexOf(quoted);
      if (index >= 0) ranges.push({ start: index, end: index + quoted.length, id: comment.id });
    }
  });
  return normalizeTextRanges(ranges, text.length);
}

function renderCommentTextHighlights(comments = []) {
  $$('.pb', $('#paper-content')).forEach((block) => renderBlockTextAnnotations(block, comments));
}

function suggestionRangesForBlock(block, comments = []) {
  const text = block?.textContent || '';
  const ranges = [];
  comments.filter((comment) => !comment.resolved && comment.type === 'suggestion' && comment.blockId === block.dataset.id).forEach((comment) => {
    const start = Number(comment.rangeStart);
    const end = Number(comment.rangeEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push({ start, end, id: comment.id });
  });
  return normalizeTextRanges(ranges, text.length);
}

function linkRangesFromElement(node) {
  const links = [];
  let offset = 0;
  const walk = (child, activeUrl = '') => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.nodeValue || '';
      if (activeUrl && text.length) links.push({ start: offset, end: offset + text.length, url: activeUrl });
      offset += text.length;
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const url = child.matches?.('a.doc-link,a[href]') ? (child.getAttribute('href') || child.dataset.docLink || activeUrl) : activeUrl;
    child.childNodes.forEach((nested) => walk(nested, url));
  };
  node.childNodes.forEach((child) => walk(child));
  return normalizeLinkRanges(links, node.textContent.length);
}

function renderBlock(block) {
  const div = document.createElement('div');
  div.className = 'pb';
  div.dataset.id = block.id;
  const type = block.type || 'paragraph';
  div.dataset.type = type;
  // store format on the node so autosave / snapshot can preserve it across edits
  if (block.format && Object.keys(block.format).length) {
    try { div.dataset.format = JSON.stringify(block.format); } catch (e) {}
  }
  // Banner block — colored horizontal rule or full-bleed hero band.
  if (type === 'banner') {
    div.classList.add('banner');
    const f = block.format || {};
    if (f.gradient) div.classList.add('gradient-bg-' + f.gradient);
    else if (f.color) div.style.background = f.color;
    if (f.height) div.style.height = `${f.height}px`;
    div.contentEditable = 'false';
    return div;
  }
  if (type === 'image') {
    const f = block.format || {};
    const img = document.createElement('img');
    img.src = f.src || '';
    img.alt = block.text || f.alt || '';
    if (f.width) img.style.width = `${Math.max(80, Math.min(622, Number(f.width) || 0))}px`;
    applyImageVisualFormat(img, f);
    img.loading = 'eager';
    img.draggable = false;
    img.addEventListener('dragstart', (event) => event.preventDefault());
    div.classList.add('image-block');
    if (f.wrapping) div.dataset.wrapping = f.wrapping;
    div.contentEditable = 'false';
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', `图片：${img.alt || '无标题图片'}`);
    div.setAttribute('aria-selected', 'false');
    div.appendChild(img);
    if (f.caption) {
      const caption = document.createElement('span');
      caption.className = 'image-caption';
      caption.textContent = f.caption;
      div.appendChild(caption);
    }
    const selection = document.createElement('div');
    selection.className = 'image-selection-ui';
    selection.setAttribute('aria-hidden', 'true');
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((pos) => {
      const handle = document.createElement('span');
      handle.className = `image-resize-handle ${pos}`;
      selection.appendChild(handle);
    });
    div.appendChild(selection);
    const toolbar = document.createElement('div');
    toolbar.className = 'image-object-toolbar';
    toolbar.setAttribute('aria-label', '图片工具栏');
    [
      ['inline', '内嵌'],
      ['wrap', '换行'],
      ['break', '断行'],
      ['behind', '文字后方'],
      ['front', '文字前方'],
      ['options', '图片选项 ▾'],
      ['replace', '替换图片']
    ].forEach(([action, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.imageAction = action;
      button.textContent = label;
      toolbar.appendChild(button);
    });
    div.appendChild(toolbar);
    bindImageBlockSelectionHandlers(div);
    return div;
  }
  if (type === 'table') {
    return renderTableBlock(div, block);
  }
  const f = block.format || {};
  renderLinkedTextInto(div, block.text || '', f.links || []);
  if (f.align) div.style.textAlign = f.align;
  if (f.color) div.style.color = f.color;
  if (f.background) div.style.background = f.background;
  if (f.gradient) div.classList.add('gradient-bg-' + f.gradient);
  if (f.padding) div.classList.add('padding-' + f.padding);
  if (f.fontSize) div.style.fontSize = `${f.fontSize}pt`;
  if (f.bold) div.style.fontWeight = '700';
  if (f.italic) div.style.fontStyle = 'italic';
  if (f.underline) div.style.textDecoration = 'underline';
  if (f.indent) div.style.textIndent = `${f.indent * 2}em`;
  return div;
}

function renderOutline() {
  const list = $('#outline-list');
  list.innerHTML = '';
  // Real Docs shows a single default "标签页 1" doc tab. Headings (when added) appear nested.
  const tabLi = document.createElement('li');
  tabLi.className = 'active';
  tabLi.innerHTML = `
    <span class="tab-icon"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg></span>
    <span class="tab-name">标签页 1</span>
    <button type="button" class="tab-menu" aria-label="标签页选项">⋮</button>
  `;
  list.appendChild(tabLi);

  // headings render as sub-items under the tab
  const headings = (ui.activeDoc.content.blocks || []).filter((b) => b.type === 'heading1' || b.type === 'heading2' || b.type === 'heading3');
  headings.forEach((h) => {
    const li = document.createElement('li');
    li.dataset.blockId = h.id;
    const depth = h.type === 'heading1' ? 1 : (h.type === 'heading2' ? 2 : 3);
    li.style.marginLeft = `${20 + (depth - 1) * 16}px`;
    li.style.fontWeight = '400';
    li.innerHTML = `<span class="tab-icon"></span><span class="tab-name">${escape(h.text || '（空标题）')}</span>`;
    li.addEventListener('click', () => {
      const target = $(`.pb[data-id="${h.id}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    list.appendChild(li);
  });
  $('.outline-hint').hidden = headings.length > 0;
}

function renderPaperSuggestions() {
  const blocks = ui.activeDoc.content.blocks || [];
  const isEmpty = blocks.length <= 1 && (!blocks[0]?.text);
  $('#paper-suggestions').hidden = !isEmpty;
}

function setSaved(saved) {
  $('#editor-cloud').setAttribute('aria-label', saved ? '所有更改已保存到云端硬盘' : '正在保存…');
  const text = $('#save-text');
  if (text) {
    text.textContent = saved ? '所有更改已保存到云端硬盘' : '正在保存…';
    text.classList.toggle('saving', !saved);
  }
}

function snapshotEditor() {
  const blocks = $$('.pb', $('#paper-content')).map((el) => {
    let format = {};
    if (el.dataset.format) { try { format = JSON.parse(el.dataset.format); } catch (e) {} }
    const type = el.dataset.type || 'paragraph';
    if (type === 'table') {
      format = { ...format, rows: tableRowsFromElement(el) };
    }
    if (!['banner', 'image', 'table'].includes(type)) {
      const links = linkRangesFromElement(el);
      if (links.length) format = { ...format, links };
      else if (format.links) {
        format = { ...format };
        delete format.links;
      }
    }
    return {
      id: el.dataset.id,
      type,
      text: type === 'banner' ? ''
        : type === 'image' ? (format.alt || '')
          : type === 'table' ? tableText(format.rows)
            : (el.textContent || ''),
      format
    };
  });
  return { title: $('#editor-title').value, blocks };
}

function scheduleSave() {
  setSaved(false);
  if (ui.saveTimer) clearTimeout(ui.saveTimer);
  ui.saveTimer = setTimeout(async () => {
    const snap = snapshotEditor();
    await API.editDocument({ fileId: ui.activeDocId, title: snap.title, blocks: snap.blocks });
    ui.activeDoc.content.blocks = snap.blocks;
    setSaved(true);
    renderOutline();
    renderPaperSuggestions();
  }, 500);
}

function applyBlockType(type) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.getRangeAt(0).startContainer;
  const block = node.nodeType === 1 ? node.closest('.pb') : node.parentElement?.closest('.pb');
  if (!block) return;
  block.dataset.type = type;
  scheduleSave();
}

// ---------------- toolbar helpers ----------------
const COLOR_SWATCHES = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'
];

function showColorPicker(anchor, command) {
  const existing = document.querySelector('.color-picker');
  if (existing) existing.remove();
  const picker = document.createElement('div');
  picker.className = 'color-picker';
  // "no color" / reset swatch first
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'swatch none';
  none.title = command === 'foreColor' ? '默认' : '无填充';
  none.addEventListener('click', () => {
    document.execCommand(command, false, command === 'foreColor' ? '#000000' : 'transparent');
    picker.remove(); scheduleSave();
  });
  picker.appendChild(none);
  COLOR_SWATCHES.forEach((color) => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch';
    sw.style.background = color;
    sw.title = color;
    sw.addEventListener('click', () => {
      document.execCommand(command, false, color);
      // visually update the toolbar indicator
      if (command === 'foreColor') $('#tb-color .A-color').style.borderBottomColor = color;
      else $('#tb-highlight .highlight-color').style.background = color;
      picker.remove(); scheduleSave();
    });
    picker.appendChild(sw);
  });
  document.body.appendChild(picker);
  const rect = anchor.getBoundingClientRect();
  picker.style.top = `${rect.bottom + 4}px`;
  picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px`;
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!picker.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
        picker.remove(); document.removeEventListener('click', close);
      }
    });
  }, 0);
}

function setLineHeight(value) {
  // apply to current block via CSS
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.getRangeAt(0).startContainer;
  const block = node.nodeType === 1 ? node.closest('.pb') : node.parentElement?.closest('.pb');
  if (block) {
    block.style.lineHeight = String(value);
    scheduleSave();
    toast(`行距已设为 ${value}`);
  }
}

function adjustFontSize(delta) {
  ui.fontSize = Math.max(6, Math.min(96, ui.fontSize + delta));
  const sizeEl = document.querySelector('.tb-size');
  if (sizeEl) sizeEl.textContent = String(ui.fontSize);
  // try to apply to selection
  const sel = window.getSelection();
  if (sel.rangeCount && !sel.isCollapsed) {
    const span = document.createElement('span');
    span.style.fontSize = `${ui.fontSize}pt`;
    try {
      const range = sel.getRangeAt(0);
      span.appendChild(range.extractContents());
      range.insertNode(span);
      scheduleSave();
    } catch (e) { /* ignore */ }
  }
}

function documentTextForWordCount() {
  return $$('.pb', $('#paper-content')).map((block) => {
    if (block.dataset.type === 'table') return tableText(tableRowsFromElement(block));
    if (block.dataset.type === 'image' || block.dataset.type === 'banner') return '';
    return block.textContent || '';
  }).join('\n');
}

function selectedTextForWordCount() {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !$('#paper-content')?.contains(sel.anchorNode)) return '';
  return sel.toString();
}

function countTextStats(text) {
  const source = String(text || '');
  const characters = source.length;
  const charactersNoSpaces = source.replace(/\s/g, '').length;
  const words = (source.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?|[\u4e00-\u9fff]/g) || []).length;
  const pages = Math.max(1, Math.ceil(charactersNoSpaces / 3000));
  return { pages, words, characters, charactersNoSpaces };
}

function currentWordCountStats() {
  const selected = selectedTextForWordCount();
  const text = selected || documentTextForWordCount();
  return { ...countTextStats(text), selected: Boolean(selected) };
}

function ensureWordCountBubble() {
  let bubble = $('#word-count-bubble');
  if (bubble) return bubble;
  bubble = document.createElement('button');
  bubble.id = 'word-count-bubble';
  bubble.type = 'button';
  bubble.className = 'word-count-bubble';
  bubble.addEventListener('click', () => openWordCountDialog());
  document.body.appendChild(bubble);
  return bubble;
}

function syncWordCountBubble() {
  const existing = $('#word-count-bubble');
  if (!ui.wordCountVisible || ui.view !== 'editor') {
    if (existing) existing.hidden = true;
    return;
  }
  const bubble = ensureWordCountBubble();
  const stats = currentWordCountStats();
  bubble.textContent = `字数：${stats.words}`;
  bubble.hidden = false;
}

function openWordCountDialog() {
  const stats = currentWordCountStats();
  const wrap = document.createElement('div');
  wrap.className = 'word-count-dialog';
  wrap.innerHTML = `
    <div class="wc-table" role="table" aria-label="字数统计">
      <div class="wc-row"><span>页数</span><strong>${stats.pages}</strong></div>
      <div class="wc-row"><span>字数</span><strong>${stats.words}</strong></div>
      <div class="wc-row"><span>字符数</span><strong>${stats.characters}</strong></div>
      <div class="wc-row"><span>不计空格的字符数</span><strong>${stats.charactersNoSpaces}</strong></div>
    </div>
    <label class="wc-check"><input id="wc-display-live" type="checkbox" ${ui.wordCountVisible ? 'checked' : ''}> <span>输入时显示字数统计</span></label>
    ${stats.selected ? '<p class="wc-selection-note">当前统计的是所选文字。</p>' : ''}
  `;
  openDialog({
    title: '字数统计',
    body: wrap,
    confirmLabel: '确定',
    onConfirm: () => {
      ui.wordCountVisible = $('#wc-display-live')?.checked || false;
      syncWordCountBubble();
    }
  });
}

function setEditMode(mode) {
  ui.editMode = mode;
  const wrap = $('#paper-content');
  wrap.contentEditable = mode === 'viewing' ? 'false' : 'true';
  document.body.classList.toggle('mode-suggesting', mode === 'suggesting');
  document.body.classList.toggle('mode-viewing', mode === 'viewing');
  const modeLabel = $('#tb-mode-label');
  if (modeLabel) modeLabel.textContent = { editing: '编辑', suggesting: '建议', viewing: '查看' }[mode] || '编辑';
  if (mode === 'suggesting') captureSuggestionBaselines();
  syncQuickActionState();
  toast({ editing: '已切换到编辑模式', suggesting: '已切换到建议模式', viewing: '已切换到查看模式' }[mode]);
}

function captureSuggestionBaselines() {
  $$('.pb', $('#paper-content')).forEach((block) => {
    if (block.dataset.type === 'image' || block.dataset.type === 'table') return;
    if (block.dataset.suggestionBaseText == null) block.dataset.suggestionBaseText = block.textContent || '';
  });
}

function handleEditorInput() {
  if (ui.editMode === 'suggesting') {
    queueSuggestionForCurrentBlock();
  }
  syncWordCountBubble();
  scheduleSave();
}

function queueSuggestionForCurrentBlock() {
  const sel = window.getSelection?.();
  const block = sel?.rangeCount
    ? getBlockFromNode(sel.getRangeAt(0).commonAncestorContainer) || getBlockFromNode(sel.getRangeAt(0).startContainer)
    : null;
  if (!block || block.dataset.type === 'image' || block.dataset.type === 'table') return;
  if (block.dataset.suggestionRecorded === 'true') return;
  const blockId = block.dataset.id;
  if (!blockId) return;
  if (block.dataset.suggestionBaseText == null) block.dataset.suggestionBaseText = block.textContent || '';
  block.classList.add('suggesting-edited');
  if (ui.suggestionTimers.has(blockId)) clearTimeout(ui.suggestionTimers.get(blockId));
  ui.suggestionTimers.set(blockId, setTimeout(() => {
    ui.suggestionTimers.delete(blockId);
    submitSuggestionForBlock(block);
  }, 650));
}

async function submitSuggestionForBlock(block) {
  if (!ui.activeDocId || !block || block.dataset.suggestionRecorded === 'true') return;
  const before = block.dataset.suggestionBaseText || '';
  const after = block.textContent || '';
  if (before === after) return;
  block.dataset.suggestionRecorded = 'true';
  const diff = textDiffRange(before, after);
  const target = {
    blockId: block.dataset.id || null,
    quotedText: before.trim().slice(0, 180) || '空白位置',
    anchorTop: getBlockAnchorTop(block),
    collapsed: false
  };
  const text = buildSuggestionText(before, after);
  try {
    const result = await API.addComment({
      fileId: ui.activeDocId,
      text,
      type: 'suggestion',
      quotedText: target.quotedText,
      beforeText: before,
      afterText: after,
      blockId: target.blockId,
      anchorTop: target.anchorTop,
      collapsed: target.collapsed,
      rangeStart: diff.rangeStart,
      rangeEnd: diff.rangeEnd,
      originalRangeStart: diff.originalRangeStart,
      originalRangeEnd: diff.originalRangeEnd,
      insertedText: diff.insertedText,
      deletedText: diff.deletedText
    });
    ui.currentComments = null;
    ui.activeMarginCommentId = result.comment?.id || null;
    await refreshCommentSurfaces(result.comment?.id);
    block.classList.remove('suggesting-edited');
  } catch (e) {
    block.dataset.suggestionRecorded = 'false';
    toast('无法保存建议');
  }
}

function textDiffRange(before = '', after = '') {
  const oldText = String(before || '');
  const newText = String(after || '');
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start += 1;
  let beforeEnd = oldText.length;
  let afterEnd = newText.length;
  while (beforeEnd > start && afterEnd > start && oldText[beforeEnd - 1] === newText[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    rangeStart: start,
    rangeEnd: afterEnd,
    originalRangeStart: start,
    originalRangeEnd: beforeEnd,
    insertedText: newText.slice(start, afterEnd),
    deletedText: oldText.slice(start, beforeEnd)
  };
}

function buildSuggestionText(before, after) {
  const oldText = before.trim();
  const newText = after.trim();
  const diff = textDiffRange(before, after);
  const inserted = diff.insertedText.trim();
  const deleted = diff.deletedText.trim();
  if (!deleted && inserted) return `建议添加：${inserted.slice(0, 160)}`;
  if (deleted && !inserted) return `建议删除：${deleted.slice(0, 160)}`;
  if (!oldText && newText) return `建议添加：${newText.slice(0, 160)}`;
  if (oldText && !newText) return `建议删除：${oldText.slice(0, 160)}`;
  return `建议修改：${oldText.slice(0, 90)} → ${newText.slice(0, 120)}`;
}

function promptAddComment() {
  const target = getQuickActionTarget();
  if (!target?.blockId) { toast('请先在文档中选择要评论的位置'); return; }
  ui.commentTarget = target;
  addCommentInteractive(target);
}

function rememberCommentTarget() {
  const target = getEditorTarget({ allowCollapsed: true, fallbackStored: false });
  if (target) ui.commentTarget = target;
}

function getCommentTarget(options = {}) {
  return getEditorTarget({
    allowCollapsed: Boolean(options.allowCollapsed),
    fallbackStored: !options.freshOnly
  });
}

function getEditorTarget(options = {}) {
  const allowCollapsed = Boolean(options.allowCollapsed);
  const fallbackStored = options.fallbackStored !== false;
  const sel = window.getSelection?.();
  if (!sel || !sel.rangeCount) return fallbackStored ? ui.commentTarget : null;
  const range = sel.getRangeAt(0);
  const block = getBlockFromNode(range.commonAncestorContainer) || getBlockFromNode(range.startContainer);
  if (!block) return fallbackStored ? ui.commentTarget : null;
  const selectedText = sel.toString().trim();
  if (!selectedText && !allowCollapsed) return fallbackStored ? ui.commentTarget : null;
  const blockText = (block.textContent || '').trim();
  let rangeStart = textOffsetInBlock(block, range.startContainer, range.startOffset);
  let rangeEnd = textOffsetInBlock(block, range.endContainer, range.endOffset);
  if (rangeEnd < rangeStart) [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
  return {
    quotedText: selectedText || blockText.slice(0, 80) || '空白位置',
    blockId: block.dataset.id || null,
    anchorTop: getRangeAnchorTop(range, block),
    collapsed: !selectedText,
    rangeStart,
    rangeEnd
  };
}

function getQuickActionTarget() {
  const current = getEditorTarget({ allowCollapsed: true, fallbackStored: false });
  if (current?.blockId) {
    ui.commentTarget = current;
    return current;
  }
  if (ui.commentTarget?.blockId) return ui.commentTarget;
  const sel = window.getSelection?.();
  const blockFromCaret = sel?.rangeCount
    ? getBlockFromNode(sel.getRangeAt(0).commonAncestorContainer)
    : null;
  const block = blockFromCaret
    || $('.pb.active-comment', $('#paper-content'))
    || $$('.pb', $('#paper-content')).find((el) => (el.textContent || '').trim())
    || $('.pb', $('#paper-content'));
  if (!block) return null;
  return {
    blockId: block.dataset.id || null,
    quotedText: (block.textContent || '').trim().slice(0, 80) || '空白位置',
    anchorTop: getBlockAnchorTop(block),
    collapsed: true,
    rangeStart: 0,
    rangeEnd: 0
  };
}

function getBlockFromNode(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const block = el?.closest?.('.pb');
  return $('#paper-content')?.contains(block) ? block : null;
}

function getRangeAnchorTop(range, block) {
  const paper = $('#paper-content');
  if (!paper) return 0;
  const paperRect = paper.getBoundingClientRect();
  const rects = Array.from(range.getClientRects?.() || []);
  let rect = rects.find((item) => item.height > 0) || range.getBoundingClientRect?.();
  if ((!rect || rect.height === 0) && range.collapsed) rect = measureCollapsedRange(range);
  if (!rect || rect.height === 0) rect = block.getBoundingClientRect();
  return Math.max(0, Math.round(rect.top - paperRect.top));
}

function measureCollapsedRange(range) {
  const sel = window.getSelection?.();
  const restore = range.cloneRange();
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  marker.style.cssText = 'display:inline-block;width:0;height:1em;overflow:hidden;line-height:inherit;';
  try {
    const probe = range.cloneRange();
    probe.insertNode(marker);
    const rect = marker.getBoundingClientRect();
    marker.remove();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(restore);
    }
    return rect;
  } catch (e) {
    marker.remove();
    return null;
  }
}

function getBlockAnchorTop(block) {
  const paper = $('#paper-content');
  if (!paper || !block) return 0;
  return Math.max(0, Math.round(block.getBoundingClientRect().top - paper.getBoundingClientRect().top));
}

function updatePaperQuickActions() {
  const bar = $('#paper-quick-actions');
  const paper = $('#paper');
  const wrap = $('#paper-wrap');
  if (!bar || !paper || !wrap || ui.view !== 'editor' || !ui.activeDocId) {
    if (bar) bar.hidden = true;
    return;
  }
  if (ui.commentDraftTarget?.blockId || ui.activeMarginCommentId) {
    bar.hidden = true;
    return;
  }
  const target = getQuickActionTarget();
  const wrapRect = wrap.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  const block = target?.blockId ? $(`.pb[data-id="${cssEscape(target.blockId)}"]`, $('#paper-content')) : null;
  const contentRect = $('#paper-content')?.getBoundingClientRect();
  const targetTop = target?.anchorTop != null && contentRect
    ? contentRect.top - wrapRect.top + Number(target.anchorTop) - 8
    : null;
  const blockTop = targetTop ?? (block ? block.getBoundingClientRect().top - wrapRect.top - 8 : paperRect.top - wrapRect.top + 66);
  const minTop = paperRect.top - wrapRect.top + 48;
  const maxTop = paperRect.top - wrapRect.top + Math.max(72, paperRect.height - 152);
  const top = Math.max(minTop, Math.min(blockTop, maxTop));
  const left = Math.round(paperRect.left - wrapRect.left + paperRect.width - 20);
  bar.style.left = `${left}px`;
  bar.style.top = `${Math.round(top)}px`;
  bar.hidden = false;
  syncQuickActionState();
}

function syncQuickActionState() {
  const btn = $('#quick-suggest-edit');
  if (!btn) return;
  const active = ui.editMode === 'suggesting';
  btn.classList.toggle('active', active);
  btn.setAttribute('aria-pressed', String(active));
}

function showImageInsertMenu(anchor, options = {}) {
  const side = anchor.closest?.('.popup-menu') ? 'submenu' : autoSide(anchor);
  if (side === 'submenu') $$('.image-insert-submenu').forEach((menu) => menu.remove());
  const replaceBlock = options.replaceBlock || null;
  logUiEvent('toolbar_menu_opened', { action: replaceBlock ? 'replace_image_menu' : 'insert_image_menu' });
  const upload = () => promptLocalImageUpload(replaceBlock ? { replaceBlock } : {});
  const boundary = (title, insertMessage, replaceMessage) => {
    showImageSourceBoundary(title, replaceBlock ? replaceMessage : insertMessage);
  };
  showFloatingMenu(anchor, [
    { label: '生成图片新(J)', onClick: () => boundary('生成图片', '真实 Google 文档会打开 Gemini 图片生成面板；此 mock 不调用生成式图片服务。', '真实 Google 文档会打开 Gemini 图片生成面板并替换当前图片；此 mock 不调用生成式图片服务。') },
    { divider: true },
    { label: '从计算机中上传(U)', onClick: upload },
    { label: '在网络上搜索(S)', onClick: () => boundary('在网络上搜索', 'Google 文档会在右侧打开图片搜索面板；此 mock 保持在文档内，不访问外部图片搜索。', '真实 Google 文档会在右侧打开图片搜索面板并用选中结果替换当前图片；此 mock 不访问外部图片搜索。') },
    { divider: true },
    { label: '云端硬盘(D)', onClick: () => boundary('云端硬盘', '真实 Google 文档会打开 Google Picker 选择 Drive 图片；此 mock 不扩展到 Drive 图片库。', '真实 Google 文档会打开 Google Picker 并用 Drive 图片替换当前图片；此 mock 不扩展到 Drive 图片库。') },
    { label: 'Google 相册(P)', onClick: () => boundary('Google 相册', '真实 Google 文档会打开 Google 相册选择器；此 mock 不读取真实相册。', '真实 Google 文档会打开 Google 相册选择器并用相册图片替换当前图片；此 mock 不读取真实相册。') },
    { label: '摄像头(C)', onClick: () => showImageSourceBoundary('摄像头', '未检测到可用摄像头。') },
    { label: '通过网址(B)', onClick: () => promptImageUrl(replaceBlock ? { replaceBlock } : {}) }
  ], { side, className: side === 'submenu' ? 'image-insert-submenu' : replaceBlock ? 'image-replace-menu' : 'image-insert-menu' });
}

function promptInsertImage() {
  const anchor = $('#tb-image');
  if (anchor) showImageInsertMenu(anchor);
}

function showTableInsertMenu(anchor) {
  const side = anchor.closest?.('.popup-menu') ? 'submenu' : autoSide(anchor);
  if (side === 'submenu') $$('.table-insert-submenu').forEach((menu) => menu.remove());
  const menu = document.createElement('div');
  menu.className = `popup-menu floating-menu table-grid-menu ${side === 'submenu' ? 'table-insert-submenu' : 'table-insert-menu'}`;
  const label = document.createElement('div');
  label.className = 'table-grid-label';
  label.textContent = '1 x 1';
  const grid = document.createElement('div');
  grid.className = 'table-grid-picker';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', '选择表格大小');
  const maxRows = 20;
  const maxCols = 20;
  grid.style.setProperty('--table-grid-cols', String(maxCols));
  function highlight(rows, cols) {
    label.textContent = `${rows} x ${cols}`;
    $$('.table-grid-cell', grid).forEach((cell) => {
      const active = Number(cell.dataset.row) <= rows && Number(cell.dataset.col) <= cols;
      cell.classList.toggle('active', active);
      cell.setAttribute('aria-selected', String(active));
    });
  }
  for (let r = 1; r <= maxRows; r += 1) {
    for (let c = 1; c <= maxCols; c += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'table-grid-cell';
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `${r} x ${c}`);
      cell.addEventListener('mouseenter', () => highlight(r, c));
      cell.addEventListener('focus', () => highlight(r, c));
      cell.addEventListener('click', () => {
        insertTableBlock(r, c);
        closeFloatingMenus();
      });
      grid.appendChild(cell);
    }
  }
  menu.append(label, grid);
  document.body.appendChild(menu);
  positionPopup(menu, anchor, { side });
  menu.hidden = false;
  highlight(1, 1);
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!menu.contains(ev.target) && ev.target !== anchor) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 0);
}

function promptImageUrl(options = {}) {
  const url = document.createElement('input');
  url.type = 'text';
  url.placeholder = 'https://...';
  const wrap = document.createElement('div');
  wrap.appendChild(Object.assign(document.createElement('label'), { textContent: '粘贴图片网址' }));
  wrap.appendChild(url);
  openDialog({
    title: options.replaceBlock ? '替换图片' : '插入图片', body: wrap,
    onConfirm: () => {
      if (!url.value.trim()) return;
      if (options.replaceBlock) replaceImageBlock(options.replaceBlock, { src: url.value.trim(), alt: '通过网址替换的图片' });
      else insertImageBlock({ src: url.value.trim(), alt: '通过网址插入的图片' });
    }
  });
  setTimeout(() => url.focus(), 0);
}

function promptLocalImageUpload(options = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) { input.remove(); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      if (options.replaceBlock) replaceImageBlock(options.replaceBlock, { src, alt: file.name || '上传的图片' });
      else insertImageBlock({ src, alt: file.name || '上传的图片' });
      input.remove();
    };
    reader.onerror = () => {
      toast('无法读取图片');
      input.remove();
    };
    reader.readAsDataURL(file);
  }, { once: true });
  input.click();
}

function showImageSourceBoundary(title, message) {
  const wrap = document.createElement('div');
  wrap.className = 'source-boundary';
  wrap.innerHTML = `<p>${escape(message)}</p>`;
  openDialog({ title, body: wrap, onConfirm: () => {} });
}

function textOffsetInBlock(block, container, offset) {
  const range = document.createRange();
  range.selectNodeContents(block);
  try {
    range.setEnd(container, offset);
    return range.toString().length;
  } catch (e) {
    return 0;
  }
}

function currentLinkSelection() {
  const sel = window.getSelection?.();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  const block = getBlockFromNode(range.commonAncestorContainer) || getBlockFromNode(range.startContainer);
  if (!block || ['image', 'table', 'banner'].includes(block.dataset.type)) return null;
  const endBlock = getBlockFromNode(range.endContainer);
  if (endBlock && endBlock !== block) return null;
  const start = textOffsetInBlock(block, range.startContainer, range.startOffset);
  const end = textOffsetInBlock(block, range.endContainer, range.endOffset);
  if (end <= start) return null;
  return { block, blockId: block.dataset.id, start, end, text: range.toString() };
}

function applyLinkToSelection(target, url) {
  const block = target?.block || $(`.pb[data-id="${cssEscape(target?.blockId || '')}"]`, $('#paper-content'));
  if (!block) return false;
  const text = block.textContent || '';
  const start = Math.max(0, Math.min(text.length, target.start));
  const end = Math.max(0, Math.min(text.length, target.end));
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl || end <= start) return false;
  let format = parseBlockFormat(block);
  const keptLinks = normalizeLinkRanges(format.links || [], text.length).flatMap((link) => {
    if (link.end <= start || link.start >= end) return [link];
    const pieces = [];
    if (link.start < start) pieces.push({ ...link, end: start });
    if (link.end > end) pieces.push({ ...link, start: end });
    return pieces;
  });
  format = { ...format, links: normalizeLinkRanges([...keptLinks, { start, end, url: cleanUrl }], text.length) };
  block.dataset.format = JSON.stringify(format);
  renderLinkedTextInto(block, text, format.links);
  scheduleSave();
  return true;
}

function promptInsertLink() {
  const target = currentLinkSelection();
  if (!target) {
    toast('请先选中要添加链接的文字');
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'link-edit-dialog';
  wrap.innerHTML = `
    <label for="link-display">文字</label>
    <input id="link-display" type="text" readonly>
    <label for="link-url">链接</label>
    <input id="link-url" type="url" placeholder="https://example.com" autocomplete="off">
  `;
  openDialog({
    title: '插入链接',
    body: wrap,
    confirmLabel: '应用',
    onConfirm: () => {
      const url = $('#link-url', wrap).value.trim();
      if (!url) { toast('请输入链接'); return; }
      if (!applyLinkToSelection(target, url)) { toast('无法插入链接'); return; }
      toast('链接已插入');
    }
  });
  $('#link-display', wrap).value = target.text;
  setTimeout(() => $('#link-url', wrap).focus(), 0);
}

function currentBlockForInsert() {
  const selectedImage = getSelectedImageBlock();
  if (selectedImage) return selectedImage;
  const sel = window.getSelection?.();
  if (sel?.rangeCount) {
    const block = getBlockFromNode(sel.getRangeAt(0).startContainer);
    if (block) return block;
  }
  return $('.pb.active-comment', $('#paper-content')) || $('.pb:last-child', $('#paper-content'));
}

function getSelectedImageBlock() {
  if (!ui.selectedImageBlockId) return null;
  const block = $(`.pb.image-block[data-id="${cssEscape(ui.selectedImageBlockId)}"]`, $('#paper-content'));
  return block || null;
}

function clearImageSelection(options = {}) {
  if (!options.force && Date.now() < ui.imageSelectionStickyUntil && getSelectedImageBlock()) {
    syncImageOptionsPanel();
    return;
  }
  $$('.pb.image-block.selected', $('#paper-content')).forEach((block) => {
    block.classList.remove('selected');
    block.setAttribute('aria-selected', 'false');
  });
  ui.selectedImageBlockId = null;
  syncImageOptionsPanel();
}

function selectImageBlock(block, options = {}) {
  if (!block || !$('#paper-content')?.contains(block)) return;
  clearImageSelection({ force: true });
  block.classList.add('selected');
  block.setAttribute('aria-selected', 'true');
  ui.selectedImageBlockId = block.dataset.id || null;
  if (options.stickyFor) ui.imageSelectionStickyUntil = Math.max(ui.imageSelectionStickyUntil, Date.now() + options.stickyFor);
  const img = $('img', block);
  ui.commentTarget = {
    blockId: block.dataset.id || null,
    quotedText: img?.alt || '图片',
    anchorTop: getBlockAnchorTop(block),
    collapsed: true
  };
  const sel = window.getSelection?.();
  if (sel) sel.removeAllRanges();
  if (options.focus !== false) block.focus({ preventScroll: true });
  syncImageOptionsPanel();
  updatePaperQuickActions();
}

function guardImageSelectionClear(ms = 300) {
  ui.imageClearGuardUntil = Date.now() + ms;
  ui.imageSelectionStickyUntil = Math.max(ui.imageSelectionStickyUntil, ui.imageClearGuardUntil);
}

function isImageClearGuardActive() {
  return ui.imageClearGuardUntil > Date.now() && Boolean(getSelectedImageBlock());
}

function imageBlockFromEvent(event) {
  const target = event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
  if (target?.closest?.('[data-image-action]')) return null;
  let block = target?.closest?.('.pb.image-block');
  if (!block && typeof event.composedPath === 'function') {
    block = event.composedPath().find((node) => node?.nodeType === Node.ELEMENT_NODE && node.classList?.contains('image-block'));
  }
  return block && $('#paper-content')?.contains(block) ? block : null;
}

function bindImageBlockSelectionHandlers(block) {
  if (!block || block.dataset.imageSelectionBound === 'true') return;
  block.dataset.imageSelectionBound = 'true';
  const selectFromBlock = (event) => {
    if (event.target.closest?.('[data-image-action]')) return;
    if (event.target.closest?.('.image-resize-handle')) return;
    event.preventDefault();
    event.stopPropagation();
    selectImageBlock(block);
    guardImageSelectionClear(180);
  };
  block.addEventListener('pointerdown', selectFromBlock);
  block.addEventListener('pointerup', selectFromBlock);
  block.addEventListener('mousedown', selectFromBlock);
  block.addEventListener('click', selectFromBlock);
  block.addEventListener('focus', () => selectImageBlock(block, { focus: false }));
  block.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    selectImageBlock(block, { focus: false });
    guardImageSelectionClear(180);
  });
}

function handleImagePointerSelect(event) {
  const resizeHandle = event.target.closest('.image-resize-handle');
  if (resizeHandle) {
    const block = resizeHandle.closest('.pb.image-block');
    beginImageResize(event, block, resizeHandle);
    return;
  }
  const block = imageBlockFromEvent(event);
  if (!block) return;
  event.preventDefault();
  event.stopPropagation();
  selectImageBlock(block);
  guardImageSelectionClear(300);
}

function replaceImageBlock(block, { src, alt }) {
  if (!block || !src) return;
  const img = $('img', block);
  if (!img) return;
  img.src = src;
  img.alt = alt || img.alt || '图片';
  block.setAttribute('aria-label', `图片：${img.alt}`);
  let format = {};
  if (block.dataset.format) { try { format = JSON.parse(block.dataset.format); } catch (e) {} }
  format = { ...format, src, alt: img.alt };
  block.dataset.format = JSON.stringify(format);
  syncImageOptionsPanel();
  scheduleSave();
  selectImageBlock(block);
  toast('图片已替换');
}

function handleImageToolbarAction(action, block) {
  selectImageBlock(block);
  if (action === 'replace') {
    const button = $(`[data-image-action="replace"]`, block) || block;
    showImageInsertMenu(button, { replaceBlock: block });
    return;
  }
  if (action === 'options') {
    const button = $(`[data-image-action="options"]`, block) || block;
    showImageOptionsMenu(button, block);
    return;
  }
  if (['inline', 'wrap', 'break', 'behind', 'front'].includes(action)) {
    updateImageBlockFormat(block, { wrapping: action });
    toast({
      inline: '已设为内嵌图片',
      wrap: '已设为文字环绕',
      break: '已设为断开文字',
      behind: '已置于文字后方',
      front: '已置于文字前方'
    }[action]);
    return;
  }
  toast('图片选项');
}

function parseBlockFormat(block) {
  let format = {};
  if (block?.dataset?.format) { try { format = JSON.parse(block.dataset.format); } catch (e) {} }
  return format;
}

function imageNaturalWidth(block) {
  const img = $('img', block);
  return img?.naturalWidth || Math.round(img?.getBoundingClientRect?.().width || 420);
}

function applyImageVisualFormat(img, format = {}) {
  if (!img) return;
  const rotation = Number(format.rotation || 0);
  img.style.transform = rotation ? `rotate(${rotation}deg)` : '';
  img.style.opacity = format.transparency != null ? String(Math.max(0.2, Math.min(1, Number(format.transparency) || 1))) : '';
  const brightness = format.brightness != null ? Math.max(0.4, Math.min(1.8, Number(format.brightness) || 1)) : 1;
  const contrast = format.contrast != null ? Math.max(0.4, Math.min(1.8, Number(format.contrast) || 1)) : 1;
  const recolor = format.recolor || 'none';
  const filters = [];
  if (brightness !== 1) filters.push(`brightness(${brightness})`);
  if (contrast !== 1) filters.push(`contrast(${contrast})`);
  if (recolor === 'grayscale') filters.push('grayscale(1)');
  if (recolor === 'warm') filters.push('sepia(.32) saturate(1.18)');
  if (recolor === 'cool') filters.push('hue-rotate(185deg) saturate(.92)');
  img.style.filter = filters.join(' ');
}

function normalizeTableRows(rows, rowCount = 3, colCount = 3) {
  const source = Array.isArray(rows) && rows.length ? rows : Array.from({ length: rowCount }, () => []);
  const width = Math.max(colCount, ...source.map((row) => Array.isArray(row) ? row.length : 0));
  return source.map((row) => {
    const cells = Array.isArray(row) ? row : [];
    return Array.from({ length: width }, (_, idx) => String(cells[idx] ?? ''));
  });
}

function tableText(rows = []) {
  return normalizeTableRows(rows, 0, 0).map((row) => row.join('\t')).join('\n');
}

function renderTableBlock(div, block) {
  const rows = normalizeTableRows(block.format?.rows || block.rows, 3, 3);
  const format = { ...(block.format || {}), rows };
  const colCount = Math.max(1, ...rows.map((row) => row.length));
  div.classList.add('table-block');
  div.contentEditable = 'false';
  div.dataset.format = JSON.stringify(format);
  div.style.setProperty('--table-col-min', `${Math.min(92, Math.max(28, Math.floor(622 / colCount) - 2))}px`);
  div.style.setProperty('--table-cell-xpad', `${colCount >= 8 ? 4 : 7}px`);
  const table = document.createElement('table');
  table.setAttribute('aria-label', '表格');
  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cellText) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.spellcheck = false;
      td.textContent = cellText;
      td.addEventListener('contextmenu', (event) => showTableCellContextMenu(td, event));
      td.addEventListener('keydown', (event) => handleTableCellKeydown(td, event));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  div.appendChild(table);
  return div;
}

function tableRowsFromElement(block) {
  return $$('tr', block).map((tr) => $$('td,th', tr).map((cell) => cell.textContent || ''));
}

function tableCellPosition(cell) {
  const rowEl = cell?.closest?.('tr');
  const block = cell?.closest?.('.pb.table-block');
  if (!rowEl || !block) return null;
  const rowIndex = Array.from(rowEl.parentElement?.children || []).indexOf(rowEl);
  const colIndex = Array.from(rowEl.children || []).indexOf(cell);
  if (rowIndex < 0 || colIndex < 0) return null;
  return { block, rowIndex, colIndex };
}

function focusTableCell(block, rowIndex, colIndex) {
  const row = $$('tr', block)[rowIndex];
  const cell = row ? $$('td,th', row)[colIndex] : null;
  if (!cell) return;
  cell.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  const sel = window.getSelection?.();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function replaceTableRows(block, rows, focusRow = 0, focusCol = 0, message = '表格已更新') {
  if (!block) return null;
  const format = { ...parseBlockFormat(block), rows: normalizeTableRows(rows, 1, 1) };
  const next = renderBlock({
    id: block.dataset.id,
    type: 'table',
    text: tableText(format.rows),
    format
  });
  block.replaceWith(next);
  ui.activeDoc.content.blocks = snapshotEditor().blocks;
  scheduleSave();
  focusTableCell(next, Math.max(0, Math.min(focusRow, format.rows.length - 1)), Math.max(0, Math.min(focusCol, format.rows[0].length - 1)));
  if (message) toast(message);
  return next;
}

function handleTableCellKeydown(cell, event) {
  if (event.key !== 'Tab') return;
  const pos = tableCellPosition(cell);
  if (!pos) return;
  event.preventDefault();
  event.stopPropagation();
  const { block, rowIndex, colIndex } = pos;
  const rows = tableRowsFromElement(block);
  const rowCount = rows.length;
  const colCount = Math.max(1, ...rows.map((row) => row.length));
  const normalized = normalizeTableRows(rows, rowCount, colCount);
  if (event.shiftKey) {
    if (colIndex > 0) focusTableCell(block, rowIndex, colIndex - 1);
    else if (rowIndex > 0) focusTableCell(block, rowIndex - 1, colCount - 1);
    return;
  }
  if (colIndex < colCount - 1) {
    focusTableCell(block, rowIndex, colIndex + 1);
    return;
  }
  if (rowIndex < rowCount - 1) {
    focusTableCell(block, rowIndex + 1, 0);
    return;
  }
  if (rowCount >= 20) {
    toast('最多可插入 20 行');
    return;
  }
  normalized.push(Array.from({ length: colCount }, () => ''));
  replaceTableRows(block, normalized, rowIndex + 1, 0, '');
}

function applyTableCellAction(action, cell) {
  const pos = tableCellPosition(cell);
  if (!pos) return;
  const { block, rowIndex, colIndex } = pos;
  const rows = tableRowsFromElement(block);
  const rowCount = rows.length;
  const colCount = Math.max(1, ...rows.map((row) => row.length));
  const normalized = normalizeTableRows(rows, rowCount, colCount);
  if (action === 'insert-row-above' || action === 'insert-row-below') {
    if (rowCount >= 20) { toast('最多可插入 20 行'); return; }
    const insertAt = action === 'insert-row-above' ? rowIndex : rowIndex + 1;
    normalized.splice(insertAt, 0, Array.from({ length: colCount }, () => ''));
    replaceTableRows(block, normalized, insertAt, colIndex, action === 'insert-row-above' ? '已在上方插入 1 行' : '已在下方插入 1 行');
    return;
  }
  if (action === 'insert-col-left' || action === 'insert-col-right') {
    if (colCount >= 20) { toast('最多可插入 20 列'); return; }
    const insertAt = action === 'insert-col-left' ? colIndex : colIndex + 1;
    normalized.forEach((row) => row.splice(insertAt, 0, ''));
    replaceTableRows(block, normalized, rowIndex, insertAt, action === 'insert-col-left' ? '已在左侧插入 1 列' : '已在右侧插入 1 列');
    return;
  }
  if (action === 'delete-row') {
    if (rowCount <= 1) { block.remove(); scheduleSave(); toast('表格已删除'); return; }
    normalized.splice(rowIndex, 1);
    replaceTableRows(block, normalized, Math.min(rowIndex, normalized.length - 1), colIndex, '已删除行');
    return;
  }
  if (action === 'delete-col') {
    if (colCount <= 1) { block.remove(); scheduleSave(); toast('表格已删除'); return; }
    normalized.forEach((row) => row.splice(colIndex, 1));
    replaceTableRows(block, normalized, rowIndex, Math.min(colIndex, colCount - 2), '已删除列');
    return;
  }
  if (action === 'delete-table') {
    block.remove();
    scheduleSave();
    toast('表格已删除');
  }
}

function showTableCellContextMenu(cell, event) {
  const pos = tableCellPosition(cell);
  if (!pos) return;
  event.preventDefault();
  event.stopPropagation();
  closeFloatingMenus();
  const anchor = {
    getBoundingClientRect: () => ({
      left: event.clientX,
      right: event.clientX,
      top: event.clientY,
      bottom: event.clientY,
      width: 0,
      height: 0
    })
  };
  showFloatingMenu(anchor, [
    { label: '在上方插入 1 行', onClick: () => applyTableCellAction('insert-row-above', cell) },
    { label: '在下方插入 1 行', onClick: () => applyTableCellAction('insert-row-below', cell) },
    { divider: true },
    { label: '在左侧插入 1 列', onClick: () => applyTableCellAction('insert-col-left', cell) },
    { label: '在右侧插入 1 列', onClick: () => applyTableCellAction('insert-col-right', cell) },
    { divider: true },
    { label: '删除行', onClick: () => applyTableCellAction('delete-row', cell) },
    { label: '删除列', onClick: () => applyTableCellAction('delete-col', cell) },
    { label: '删除表格', onClick: () => applyTableCellAction('delete-table', cell) }
  ], { side: autoSide(anchor), className: 'table-cell-context-menu' });
}

function beginImageResize(event, block, handle) {
  if (!block || !handle || event.type === 'mousedown' && window.PointerEvent) return;
  const img = $('img', block);
  const rect = img?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  selectImageBlock(block, { focus: false });
  const position = Array.from(handle.classList).find((name) => ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].includes(name)) || 'se';
  ui.imageResize = {
    blockId: block.dataset.id,
    position,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: rect.width,
    aspect: rect.width / rect.height,
    pointerId: event.pointerId ?? null
  };
  block.classList.add('resizing');
  document.body.classList.add('docs-image-resizing');
  document.addEventListener('pointermove', handleImageResizeMove, true);
  document.addEventListener('pointerup', finishImageResize, true);
  document.addEventListener('pointercancel', finishImageResize, true);
  document.addEventListener('mousemove', handleImageResizeMove, true);
  document.addEventListener('mouseup', finishImageResize, true);
  event.preventDefault();
  event.stopPropagation();
}

function imageResizeWidthFromEvent(event, resize) {
  const dx = event.clientX - resize.startX;
  const dy = event.clientY - resize.startY;
  const pos = resize.position || '';
  if (pos.includes('e')) return resize.startWidth + dx;
  if (pos.includes('w')) return resize.startWidth - dx;
  if (pos.includes('s')) return resize.startWidth + dy * resize.aspect;
  if (pos.includes('n')) return resize.startWidth - dy * resize.aspect;
  return resize.startWidth;
}

function handleImageResizeMove(event) {
  const resize = ui.imageResize;
  if (!resize) return;
  if (resize.pointerId != null && event.pointerId != null && event.pointerId !== resize.pointerId) return;
  const block = $(`.pb.image-block[data-id="${cssEscape(resize.blockId)}"]`, $('#paper-content'));
  if (!block) return finishImageResize(event);
  updateImageBlockFormat(block, { width: imageResizeWidthFromEvent(event, resize) });
  event.preventDefault();
  event.stopPropagation();
}

function finishImageResize(event) {
  const resize = ui.imageResize;
  if (!resize) return;
  const block = $(`.pb.image-block[data-id="${cssEscape(resize.blockId)}"]`, $('#paper-content'));
  block?.classList.remove('resizing');
  ui.imageResize = null;
  document.body.classList.remove('docs-image-resizing');
  document.removeEventListener('pointermove', handleImageResizeMove, true);
  document.removeEventListener('pointerup', finishImageResize, true);
  document.removeEventListener('pointercancel', finishImageResize, true);
  document.removeEventListener('mousemove', handleImageResizeMove, true);
  document.removeEventListener('mouseup', finishImageResize, true);
  if (block) {
    selectImageBlock(block, { focus: false });
    guardImageSelectionClear();
    scheduleSave();
  }
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

function updateImageBlockFormat(block, patch = {}) {
  if (!block) return;
  const img = $('img', block);
  const format = { ...parseBlockFormat(block), ...patch };
  if (format.alt != null) {
    format.alt = String(format.alt);
    if (img) img.alt = format.alt || '图片';
    block.setAttribute('aria-label', `图片：${format.alt || '图片'}`);
  }
  if (format.width != null) {
    const width = Math.max(80, Math.min(622, Number(format.width) || imageNaturalWidth(block)));
    format.width = width;
    if (img) img.style.width = `${width}px`;
  }
  if (format.caption != null) {
    format.caption = String(format.caption);
    let caption = $('.image-caption', block);
    if (format.caption) {
      if (!caption) {
        caption = document.createElement('span');
        caption.className = 'image-caption';
        block.insertBefore(caption, $('.image-selection-ui', block));
      }
      caption.textContent = format.caption;
    } else {
      caption?.remove();
      delete format.caption;
    }
  }
  if (format.wrapping) block.dataset.wrapping = format.wrapping;
  if (format.position) block.dataset.position = format.position;
  applyImageVisualFormat(img, format);
  block.dataset.format = JSON.stringify(format);
  ui.activeDoc.content.blocks = snapshotEditor().blocks;
  syncImageOptionsPanel();
  scheduleSave();
  Object.entries(patch).forEach(([field, value]) => {
    logUiEvent('image_options_updated', { blockId: block.dataset.id || '', field, value: String(value ?? '') });
  });
}

function showImageOptionsMenu(anchor, block = getSelectedImageBlock()) {
  if (!block) return;
  selectImageBlock(block, { focus: false });
  logUiEvent('image_options_menu_opened', { blockId: block.dataset.id || '' });
  showFloatingMenu(anchor, [
    { label: '替代文字', onClick: () => openImageOptionsPanel(block, { focus: 'alt' }) },
    { label: '所有图片选项', onClick: () => openImageOptionsPanel(block, { focus: 'all' }) },
    { divider: true },
    { label: '大小和旋转', onClick: () => openImageOptionsPanel(block, { focus: 'width' }) },
    { label: '文字环绕', onClick: () => openImageOptionsPanel(block, { focus: 'wrapping' }) },
    { label: '位置', onClick: () => openImageOptionsPanel(block, { focus: 'position' }) },
    { divider: true },
    { label: '重置图片', onClick: () => resetSelectedImageFormat(block) }
  ], { side: autoSide(anchor), className: 'image-options-menu' });
}

function ensureImageOptionsPanel() {
  let panel = $('#image-options-panel');
  if (panel) return panel;
  panel = document.createElement('aside');
  panel.id = 'image-options-panel';
  panel.className = 'image-options-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <header class="iop-header">
      <div>
        <h2>所有图片选项</h2>
        <span>大小、文字环绕、位置和替代文字</span>
      </div>
      <button type="button" class="icon-btn small" id="iop-close" aria-label="关闭图片选项" data-tooltip="关闭">
        <svg viewBox="0 0 24 24"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3 10.59 10.59 16.89 4.3z"/></svg>
      </button>
    </header>
    <section class="iop-section">
      <h3>大小和旋转</h3>
      <label>宽度
        <div class="iop-number-row">
          <input id="iop-width" type="number" min="80" max="622" step="10">
          <span>px</span>
        </div>
      </label>
      <input id="iop-width-slider" type="range" min="80" max="622" step="10">
      <label class="iop-spaced">旋转
        <div class="iop-number-row">
          <input id="iop-rotation" type="number" min="-180" max="180" step="15">
          <span>°</span>
        </div>
      </label>
    </section>
    <section class="iop-section">
      <h3>文字环绕</h3>
      <div class="iop-segments" role="group" aria-label="文字环绕">
        <button type="button" data-wrap-mode="inline">内嵌</button>
        <button type="button" data-wrap-mode="wrap">换行</button>
        <button type="button" data-wrap-mode="break">断行</button>
        <button type="button" data-wrap-mode="behind">文字后方</button>
        <button type="button" data-wrap-mode="front">文字前方</button>
      </div>
    </section>
    <section class="iop-section">
      <h3>位置</h3>
      <div class="iop-chip-row" role="group" aria-label="图片位置">
        <button type="button" data-position-mode="move">随文字移动</button>
        <button type="button" data-position-mode="fixed">固定在页面上</button>
      </div>
    </section>
    <section class="iop-section">
      <h3>替代文字</h3>
      <label>说明
        <input id="iop-alt" type="text" placeholder="为屏幕阅读器描述图片">
      </label>
    </section>
    <section class="iop-section">
      <h3>重新着色</h3>
      <div class="iop-chip-row" role="group" aria-label="重新着色">
        <button type="button" data-recolor-mode="none">无</button>
        <button type="button" data-recolor-mode="grayscale">灰度</button>
        <button type="button" data-recolor-mode="warm">暖色</button>
        <button type="button" data-recolor-mode="cool">冷色</button>
      </div>
    </section>
    <section class="iop-section">
      <h3>调整</h3>
      <label>透明度
        <input id="iop-transparency" type="range" min="0.2" max="1" step="0.05">
      </label>
      <label class="iop-spaced">亮度
        <input id="iop-brightness" type="range" min="0.4" max="1.8" step="0.05">
      </label>
      <label class="iop-spaced">对比度
        <input id="iop-contrast" type="range" min="0.4" max="1.8" step="0.05">
      </label>
    </section>
    <section class="iop-section">
      <h3>标题</h3>
      <label>图片说明
        <input id="iop-caption" type="text" placeholder="添加图片说明">
      </label>
    </section>
  `;
  document.body.appendChild(panel);
  $('#iop-close', panel).addEventListener('click', () => closeImageOptionsPanel());
  $('#iop-width', panel).addEventListener('input', (event) => {
    const block = getSelectedImageBlock();
    updateImageBlockFormat(block, { width: event.target.value });
  });
  $('#iop-width-slider', panel).addEventListener('input', (event) => {
    const block = getSelectedImageBlock();
    updateImageBlockFormat(block, { width: event.target.value });
  });
  $('#iop-rotation', panel).addEventListener('input', (event) => {
    const block = getSelectedImageBlock();
    updateImageBlockFormat(block, { rotation: event.target.value });
  });
  $('#iop-alt', panel).addEventListener('input', (event) => {
    const block = getSelectedImageBlock();
    updateImageBlockFormat(block, { alt: event.target.value });
  });
  $('#iop-caption', panel).addEventListener('input', (event) => {
    const block = getSelectedImageBlock();
    updateImageBlockFormat(block, { caption: event.target.value });
  });
  $$('.iop-segments button', panel).forEach((button) => {
    button.addEventListener('click', () => {
      const block = getSelectedImageBlock();
      updateImageBlockFormat(block, { wrapping: button.dataset.wrapMode });
    });
  });
  $$('[data-position-mode]', panel).forEach((button) => {
    button.addEventListener('click', () => {
      const block = getSelectedImageBlock();
      updateImageBlockFormat(block, { position: button.dataset.positionMode });
    });
  });
  $$('[data-recolor-mode]', panel).forEach((button) => {
    button.addEventListener('click', () => {
      const block = getSelectedImageBlock();
      updateImageBlockFormat(block, { recolor: button.dataset.recolorMode });
    });
  });
  ['transparency', 'brightness', 'contrast'].forEach((name) => {
    $(`#iop-${name}`, panel).addEventListener('input', (event) => {
      const block = getSelectedImageBlock();
      updateImageBlockFormat(block, { [name]: event.target.value });
    });
  });
  return panel;
}

function openImageOptionsPanel(block = getSelectedImageBlock(), options = {}) {
  if (!block) return;
  ui.imageOptionsOpen = true;
  selectImageBlock(block, { focus: false });
  syncImageOptionsPanel();
  logUiEvent('image_options_panel_opened', { blockId: block.dataset.id || '', action: options.focus || 'all' });
  const focusMap = {
    alt: '#iop-alt',
    width: '#iop-width',
    wrapping: '.iop-segments button',
    position: '[data-position-mode]',
    all: '#iop-width'
  };
  const target = focusMap[options.focus] ? $(focusMap[options.focus], $('#image-options-panel')) : null;
  if (target) setTimeout(() => target.focus({ preventScroll: true }), 0);
}

function closeImageOptionsPanel() {
  ui.imageOptionsOpen = false;
  const panel = $('#image-options-panel');
  if (panel) panel.hidden = true;
}

function syncImageOptionsPanel() {
  const panel = ui.imageOptionsOpen ? ensureImageOptionsPanel() : $('#image-options-panel');
  if (!panel) return;
  const block = getSelectedImageBlock();
  if (!ui.imageOptionsOpen || !block) {
    panel.hidden = true;
    return;
  }
  const format = parseBlockFormat(block);
  const img = $('img', block);
  const width = Math.round(Number(format.width) || img?.getBoundingClientRect?.().width || imageNaturalWidth(block));
  $('#iop-width', panel).value = String(width);
  $('#iop-width-slider', panel).value = String(Math.max(80, Math.min(622, width)));
  $('#iop-rotation', panel).value = String(Math.round(Number(format.rotation || 0)));
  $('#iop-alt', panel).value = format.alt || img?.alt || '';
  $('#iop-caption', panel).value = format.caption || '';
  $('#iop-transparency', panel).value = String(format.transparency ?? 1);
  $('#iop-brightness', panel).value = String(format.brightness ?? 1);
  $('#iop-contrast', panel).value = String(format.contrast ?? 1);
  $$('.iop-segments button', panel).forEach((button) => {
    button.classList.toggle('active', (format.wrapping || 'inline') === button.dataset.wrapMode);
  });
  $$('[data-position-mode]', panel).forEach((button) => {
    button.classList.toggle('active', (format.position || 'move') === button.dataset.positionMode);
  });
  $$('[data-recolor-mode]', panel).forEach((button) => {
    button.classList.toggle('active', (format.recolor || 'none') === button.dataset.recolorMode);
  });
  panel.hidden = false;
}

function resetSelectedImageFormat(block = getSelectedImageBlock()) {
  if (!block) return;
  const format = parseBlockFormat(block);
  const next = {
    src: format.src,
    alt: format.alt,
    caption: format.caption
  };
  Object.keys(next).forEach((key) => {
    if (next[key] == null || next[key] === '') delete next[key];
  });
  block.dataset.format = JSON.stringify(next);
  const img = $('img', block);
  if (img) {
    img.style.width = '';
    applyImageVisualFormat(img, next);
  }
  block.dataset.wrapping = 'inline';
  delete block.dataset.position;
  ui.activeDoc.content.blocks = snapshotEditor().blocks;
  syncImageOptionsPanel();
  scheduleSave();
  selectImageBlock(block, { focus: false });
  toast('图片已重置');
}

function removeSelectedImageBlock() {
  const block = getSelectedImageBlock();
  if (!block) return false;
  const next = block.nextElementSibling;
  const prev = block.previousElementSibling;
  block.remove();
  clearImageSelection();
  const focusTarget = next || prev;
  if (focusTarget && focusTarget.dataset.type !== 'image') {
    const sel = window.getSelection?.();
    const range = document.createRange();
    range.selectNodeContents(focusTarget);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  } else {
    $('#paper-content')?.focus();
  }
  scheduleSave();
  toast('图片已删除');
  return true;
}

function insertImageBlock({ src, alt }) {
  if (!src) return;
  const block = {
    id: `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'image',
    text: alt || '图片',
    format: { src, alt: alt || '图片' }
  };
  const el = renderBlock(block);
  const wrap = $('#paper-content');
  const ref = currentBlockForInsert();
  if (ref && wrap.contains(ref)) ref.insertAdjacentElement('afterend', el);
  else wrap.appendChild(el);
  ui.activeDoc.content.blocks = snapshotEditor().blocks;
  scheduleSave();
  toast('图片已插入');
  selectImageBlock(el, { stickyFor: 1200 });
  guardImageSelectionClear(1200);
  syncInsertedImageSelection(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function syncInsertedImageSelection(block) {
  const img = $('img', block);
  const keepSelected = () => {
    if (!$('#paper-content')?.contains(block)) return;
    selectImageBlock(block, { focus: false, stickyFor: 650 });
    guardImageSelectionClear(650);
    updatePaperQuickActions();
  };
  requestAnimationFrame(() => {
    keepSelected();
  });
  [100, 300, 750].forEach((delay) => setTimeout(keepSelected, delay));
  if (img && !img.complete) {
    img.addEventListener('load', () => {
      if (ui.selectedImageBlockId !== block.dataset.id && !block.classList.contains('selected')) return;
      keepSelected();
    }, { once: true });
  }
}

function insertHorizontalRuleBlock() {
  const block = {
    id: `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'banner',
    text: '',
    format: { color: '#dadce0', height: 1 }
  };
  const el = renderBlock(block);
  const wrap = $('#paper-content');
  const ref = currentBlockForInsert();
  if (ref && wrap.contains(ref)) ref.insertAdjacentElement('afterend', el);
  else wrap.appendChild(el);
  ui.activeDoc.content.blocks = snapshotEditor().blocks;
  scheduleSave();
  toast('水平线已插入');
}

function insertTableBlock(rows = 3, cols = 3) {
  const safeRows = Math.max(1, Math.min(20, Number(rows) || 3));
  const safeCols = Math.max(1, Math.min(20, Number(cols) || 3));
  const block = {
    id: `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'table',
    text: '',
    format: { rows: normalizeTableRows([], safeRows, safeCols) }
  };
  const el = renderBlock(block);
  const wrap = $('#paper-content');
  const ref = currentBlockForInsert();
  if (ref && wrap.contains(ref)) ref.insertAdjacentElement('afterend', el);
  else wrap.appendChild(el);
  ui.activeDoc.content.blocks = snapshotEditor().blocks;
  scheduleSave();
  toast(`已插入 ${safeRows} x ${safeCols} 表格`);
  const firstCell = $('td', el);
  firstCell?.focus();
}

function syncStarButton() {
  const btn = $('#editor-star');
  if (!btn) return;
  const starred = !!ui.activeDoc?.starred;
  btn.classList.toggle('active', starred);
  btn.setAttribute('aria-pressed', String(starred));
  btn.setAttribute('aria-label', starred ? '已加星标' : '加注星标');
  btn.setAttribute('data-tooltip', starred ? '从"已加星标"中移除' : '加注星标');
}

// ---------------- Version history ----------------
async function openHistoryView() {
  if (!ui.activeDocId) { toast('请先打开一个文档'); return; }
  closeFloatingMenus();
  // persist any pending edits before snapshotting
  if (ui.saveTimer) {
    clearTimeout(ui.saveTimer);
    const snap = snapshotEditor();
    await API.editDocument({ fileId: ui.activeDocId, title: snap.title, blocks: snap.blocks });
  }
  const r = await fetch('/api/versions?fileId=' + encodeURIComponent(ui.activeDocId)).then((x) => x.json());
  ui.versions = r.versions || [];
  ui.activeVersionIdx = 0;
  ui.showDiff = true;
  setView('history');
  syncHistoryFilterButton();
  syncHistoryRestoreButton();
  renderHistoryList();
  renderHistoryPaper();
}

function historyVersionEntries() {
  return (ui.versions || []).map((version, idx) => ({ version, idx }));
}

function visibleHistoryVersionEntries() {
  const entries = historyVersionEntries();
  return ui.versionFilter === 'named'
    ? entries.filter(({ version }) => version.named || version.name)
    : entries;
}

function ensureVisibleHistorySelection(entries = visibleHistoryVersionEntries()) {
  if (!entries.length) return;
  if (!entries.some(({ idx }) => idx === ui.activeVersionIdx)) {
    ui.activeVersionIdx = entries[0].idx;
  }
  syncHistoryRestoreButton();
}

function syncHistoryFilterButton() {
  const button = $('#hv-rail-filter');
  if (!button) return;
  button.firstChild.textContent = ui.versionFilter === 'named' ? '已命名版本 ' : '所有版本 ';
}

function setHistoryVersionFilter(filter) {
  ui.versionFilter = filter === 'named' ? 'named' : null;
  closeFloatingMenus();
  const entries = visibleHistoryVersionEntries();
  ensureVisibleHistorySelection(entries);
  syncHistoryFilterButton();
  renderHistoryList();
  renderHistoryPaper();
}

function moveHistorySelection(delta) {
  const entries = visibleHistoryVersionEntries();
  if (!entries.length) return;
  ensureVisibleHistorySelection(entries);
  const current = entries.findIndex(({ idx }) => idx === ui.activeVersionIdx);
  const next = Math.max(0, Math.min(entries.length - 1, current + delta));
  ui.activeVersionIdx = entries[next].idx;
  syncHistoryRestoreButton();
  renderHistoryList();
  renderHistoryPaper();
}

function syncHistoryRestoreButton() {
  const button = $('#hv-restore-version');
  if (!button) return;
  const version = ui.versions?.[ui.activeVersionIdx];
  const canRestore = Boolean(version && ui.activeVersionIdx > 0);
  button.hidden = !canRestore;
  button.disabled = !canRestore;
  button.dataset.versionId = canRestore ? version.id : '';
}

function renderHistoryList() {
  const list = $('#hv-rail-list');
  list.innerHTML = '';
  const visibleVersions = visibleHistoryVersionEntries();
  ensureVisibleHistorySelection(visibleVersions);
  if (!visibleVersions.length) {
    list.innerHTML = '<p style="color:var(--gd-text-muted);padding:24px;text-align:center;">暂无版本记录。</p>';
    return;
  }
  // group by date label (今天 / 昨天 / 更早)
  const today = new Date(); today.setHours(0,0,0,0);
  const groups = { today: [], yesterday: [], earlier: [] };
  visibleVersions.forEach(({ version, idx }) => {
    const t = new Date(version.timestamp);
    const dayDelta = Math.floor((today - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
    const grp = dayDelta <= 0 ? 'today' : dayDelta === 1 ? 'yesterday' : 'earlier';
    groups[grp].push({ version, idx });
  });
  [['today', '今天'], ['yesterday', '昨天'], ['earlier', '更早']].forEach(([key, label]) => {
    if (!groups[key].length) return;
    const head = document.createElement('div'); head.className = 'hv-group-label'; head.textContent = label;
    list.appendChild(head);
    groups[key].forEach(({ version: v, idx }) => list.appendChild(renderVersionCard(v, idx)));
  });
}

function renderVersionCard(v, idx) {
  const card = document.createElement('div');
  card.className = 'hv-version' + (idx === ui.activeVersionIdx ? ' active' : '');
  card.dataset.versionId = v.id;
  const t = new Date(v.timestamp);
  const timeStr = `${t.getMonth() + 1}月${t.getDate()}日${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const named = v.name || (v.named ? v.label : '');
  card.innerHTML = `
    <div class="hv-version-time">${escape(named || timeStr)}</div>
    ${named ? `<div class="hv-version-named-time">${escape(timeStr)}</div>` : ''}
    ${idx === 0 ? '<div class="hv-version-current">当前版本</div>' : ''}
    <div class="hv-version-author">${escape(v.authorName || '')}</div>
    <button type="button" class="hv-version-menu" aria-label="版本选项" data-version-id="${escape(v.id)}">⋮</button>
  `;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.hv-version-menu')) return;
    ui.activeVersionIdx = idx;
    syncHistoryRestoreButton();
    renderHistoryList();
    renderHistoryPaper();
  });
  card.querySelector('.hv-version-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    showFloatingMenu(e.currentTarget, [
      { label: '还原此版本', onClick: () => restoreHistoryVersion(v) },
      { label: '为此版本命名', onClick: () => promptNameVersion(v) },
      { label: '复制此版本为新文档', onClick: () => promptCopyVersion(v) }
    ]);
  });
  return card;
}

async function restoreHistoryVersion(version = null) {
  const target = version || ui.versions?.[ui.activeVersionIdx];
  if (!ui.activeDocId || !target?.id) { toast('请选择一个版本'); return; }
  if (ui.activeVersionIdx === 0 && target.id === ui.versions?.[0]?.id) {
    toast('当前已经是此版本');
    return;
  }
  const label = target.name || target.label || new Date(target.timestamp).toLocaleString();
  if (!confirm(`将文档还原到 ${label}？`)) return;
  await fetch('/api/versions/restore', {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ fileId: ui.activeDocId, versionId: target.id })
  });
  toast('已还原到此版本');
  const r = await fetch('/api/versions?fileId=' + encodeURIComponent(ui.activeDocId)).then((x) => x.json());
  ui.versions = r.versions || [];
  ui.activeVersionIdx = 0;
  syncHistoryRestoreButton();
  renderHistoryList();
  renderHistoryPaper();
}

async function refreshVersions() {
  const r = await fetch('/api/versions?fileId=' + encodeURIComponent(ui.activeDocId)).then((x) => x.json());
  ui.versions = r.versions || [];
}

async function flushPendingEditorSave() {
  if (!ui.activeDocId) return;
  if (ui.saveTimer) clearTimeout(ui.saveTimer);
  const snap = snapshotEditor();
  await API.editDocument({ fileId: ui.activeDocId, title: snap.title, blocks: snap.blocks });
}

function promptNameVersion(version = null) {
  if (!ui.activeDocId) { toast('请先打开一个文档'); return; }
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '输入版本名称';
  input.value = version?.name || (version?.named ? version?.label || '' : '');
  const wrap = document.createElement('div');
  wrap.className = 'version-name-dialog';
  wrap.appendChild(Object.assign(document.createElement('label'), { textContent: '版本名称' }));
  wrap.appendChild(input);
  openDialog({
    title: version ? '为此版本命名' : '命名当前版本',
    body: wrap,
    onConfirm: async () => {
      const name = input.value.trim();
      if (!name) { toast('请输入版本名称'); return; }
      if (!version) await flushPendingEditorSave();
      const result = await API.nameVersion({ fileId: ui.activeDocId, versionId: version?.id, name });
      ui.versions = result.versions || ui.versions || [];
      if (ui.view === 'history') {
        renderHistoryList();
        renderHistoryPaper();
      }
      toast('版本已命名');
    }
  });
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function promptCopyVersion(version) {
  if (!ui.activeDocId || !version?.id) { toast('请选择一个版本'); return; }
  fetch('/api/state').then((r) => r.json()).then((state) => {
    const liveFile = state.files.find((item) => item.id === ui.activeDocId) || ui.activeDoc || {};
    const folders = state.files.filter((item) => item.type === 'folder' && !item.trashed && item.id !== liveFile.id);
    const versionName = version.name || version.label || '';
    const defaultName = `${liveFile.name || version.title || '未命名文档'}${versionName ? ` - ${versionName}` : ''} 副本`;
    const wrap = document.createElement('div');
    wrap.className = 'make-copy-dialog version-copy-dialog';
    wrap.innerHTML = `
      <label for="version-copy-name">名称</label>
      <input id="version-copy-name" type="text" value="${escape(defaultName)}">
      <label for="version-copy-folder">文件夹</label>
      <select id="version-copy-folder"></select>
      <label class="mcd-check">
        <input id="version-copy-share" type="checkbox" ${Array.isArray(liveFile.sharedWith) && liveFile.sharedWith.length ? 'checked' : ''}>
        <span>与同一批用户共享</span>
      </label>
    `;
    const folderSelect = $('#version-copy-folder', wrap);
    const rootOption = document.createElement('option');
    rootOption.value = 'root';
    rootOption.textContent = '我的云端硬盘';
    folderSelect.appendChild(rootOption);
    folders.forEach((folder) => {
      const opt = document.createElement('option');
      opt.value = folder.id;
      opt.textContent = describeFolderPath(folder, state.files);
      if (folder.id === liveFile.parentId) opt.selected = true;
      folderSelect.appendChild(opt);
    });
    openDialog({
      title: '复制此版本',
      body: wrap,
      confirmLabel: '创建副本',
      closeOnConfirm: false,
      onConfirm: async () => {
        const name = $('#version-copy-name', wrap).value.trim();
        if (!name) { toast('请输入副本名称'); return; }
        const result = await API.copyVersion({
          fileId: ui.activeDocId,
          versionId: version.id,
          name,
          parentId: folderSelect.value || 'root',
          shareWithSamePeople: $('#version-copy-share', wrap).checked
        });
        closeDialog();
        toast('已复制此版本');
        await openEditor(result.file.id);
      }
    });
    setTimeout(() => {
      const nameInput = $('#version-copy-name', wrap);
      nameInput?.focus();
      nameInput?.select();
    }, 0);
  });
}

function renderHistoryPaper() {
  const v = ui.versions[ui.activeVersionIdx];
  const wrap = $('#hv-paper-content');
  wrap.innerHTML = '';
  wrap.contentEditable = 'false';
  if (!v) {
    $('#hv-version-label').textContent = '版本记录';
    $('#hv-count').textContent = '0';
    return;
  }
  // diff against previous version (older)
  const prev = ui.versions[ui.activeVersionIdx + 1];
  const prevTexts = new Set((prev?.blocks || []).map((b) => b.text || ''));
  (v.blocks || []).forEach((b) => {
    const div = document.createElement('div');
    div.className = 'pb';
    if (ui.showDiff && prev && !prevTexts.has(b.text || '')) div.classList.add('changed');
    div.dataset.id = b.id;
    div.dataset.type = b.type || 'paragraph';
    div.textContent = b.text || '';
    wrap.appendChild(div);
  });
  // header label
  const t = new Date(v.timestamp);
  const today = new Date(); today.setHours(0,0,0,0);
  const day = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const dayDelta = Math.floor((today - day) / 86400000);
  const dayLabel = dayDelta <= 0 ? '今天' : dayDelta === 1 ? '昨天' : `${t.getMonth() + 1}月${t.getDate()}日`;
  $('#hv-version-label').textContent = `${dayLabel} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  // count changed blocks
  const changedCount = (v.blocks || []).filter((b) => prev && !prevTexts.has(b.text || '')).length;
  $('#hv-count').textContent = String(changedCount);
}

function syncHistoryTooltip() {
  const btn = $('#editor-history');
  if (!btn || !ui.activeDoc) return;
  const t = new Date(ui.activeDoc.modifiedAt || ui.activeDoc.lastOpenedAt || Date.now());
  const minutes = Math.floor((Date.now() - t.getTime()) / 60000);
  let label;
  if (minutes < 1) label = '上次修改是几秒前进行的';
  else if (minutes < 60) label = `上次修改是在 ${minutes} 分钟前进行的`;
  else if (minutes < 1440) label = `上次修改是在 ${Math.floor(minutes / 60)} 小时前进行的`;
  else label = `上次修改是在 ${Math.floor(minutes / 1440)} 天前进行的`;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('data-tooltip', label);
}

// ---------------- Comments side panel ----------------
function toggleCommentsPanel(force) {
  const panel = $('#comments-panel');
  const view = $('.editor-view');
  const want = typeof force === 'boolean' ? force : !!panel.hidden;
  const wasOpen = !panel.hidden;
  panel.hidden = !want;
  view.classList.toggle('with-comments', want);
  $('#editor-comment').setAttribute('aria-expanded', String(want));
  if (wasOpen !== want) {
    logUiEvent('comments_panel_toggled', { action: want ? 'open' : 'close' });
  }
  renderDocCommentCards(ui.currentComments || [], ui.activeMarginCommentId);
  if (want) return renderCommentsPanel();
  return Promise.resolve();
}

async function renderCommentsPanel() {
  if (!ui.activeDocId) return;
  const seq = ++ui.commentsRenderSeq;
  const body = $('#cp-body');
  body.innerHTML = '';
  let comments = [];
  try {
    const r = await API.comments(ui.activeDocId);
    comments = r.comments || [];
  } catch (e) { comments = []; }
  if (seq !== ui.commentsRenderSeq) return;
  ui.currentComments = comments;

  const tab = ui.commentsTab || 'all';
  const filtered = comments.filter((c) => {
    if (tab === 'me' && !c.mentionsMe) return false;
    if (ui.commentsType === 'resolved') return !!c.resolved;
    if (ui.commentsType === 'comment' && c.type !== 'comment') return false;
    if (ui.commentsType === 'suggestion' && c.type !== 'suggestion') return false;
    if (ui.commentsType !== 'resolved' && c.resolved) return false;
    return true;
  });

  if (!filtered.length) {
    body.classList.add('cp-empty-mode');
    body.innerHTML = `
      <div class="cp-empty">
        <p class="cp-empty-title">发起讨论</p>
        <button type="button" class="cp-add-btn" id="cp-add-btn">添加评论</button>
      </div>
    `;
    const target = getCommentTarget({ allowCollapsed: true });
    const btn = $('#cp-add-btn');
    if (target) {
      btn.classList.add('enabled');
      btn.disabled = false;
      btn.addEventListener('click', () => addCommentInteractive(target));
    } else {
      btn.disabled = true;
      btn.title = '请先在文档中选中一段文字再添加评论';
    }
    return;
  }
  body.classList.remove('cp-empty-mode');
  filtered.forEach((c) => body.appendChild(renderCommentItem(c)));
}

function renderCommentItem(c) {
  const div = document.createElement('div');
  div.className = 'cp-comment' + (c.resolved ? ' resolved' : '') + (c.type === 'suggestion' ? ' suggestion' : '');
  div.dataset.commentId = c.id;
  if (c.blockId) div.dataset.blockId = c.blockId;
  const initial = (c.authorName || 'U').slice(0, 1).toUpperCase();
  const color = c.authorColor || '#1a73e8';
  const replies = Array.isArray(c.replies) ? c.replies : [];
  const copyNote = c.copiedNote
    ? `复制自原始文档${c.copiedFromDocumentTitle ? `：${c.copiedFromDocumentTitle}` : ''}`
    : '';
  div.innerHTML = `
    <header>
      <span class="cp-avatar" style="background:${escape(color)}">${escape(initial)}</span>
      <div class="cp-head-text">
        <div class="cp-author">${escape(c.authorName || 'Unknown')}</div>
        <div class="cp-time">${escape(relTime(c.createdAt))}</div>
      </div>
      ${c.type === 'suggestion' ? '<span class="cp-type-badge">建议</span>' : ''}
      ${c.resolved ? '<span class="cp-resolved-badge">已解决</span>' : ''}
    </header>
    ${c.quotedText ? `<blockquote class="cp-quote">${escape(c.quotedText)}</blockquote>` : ''}
    <div class="cp-text">${escape(c.text || '')}</div>
    ${copyNote ? `<div class="cp-copy-note">${escape(copyNote)}</div>` : ''}
    ${replies.length ? `
      <div class="cp-replies">
        ${replies.map((r) => `
          <div class="cp-reply">
            <span class="cp-reply-avatar" style="background:${escape(r.authorColor || '#1a73e8')}">${escape((r.authorName || 'U').slice(0, 1).toUpperCase())}</span>
            <div>
              <div class="cp-reply-meta">${escape(r.authorName || 'Unknown')} · ${escape(relTime(r.createdAt))}</div>
              <div class="cp-reply-text">${escape(r.text || '')}</div>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    <div class="cp-actions">
      <button type="button" class="cp-action" data-comment-action="reply">回复</button>
      <button type="button" class="cp-action" data-comment-action="${c.resolved ? 'reopen' : 'resolve'}">${c.resolved ? '重新打开' : (c.type === 'suggestion' ? '接受建议' : '解决')}</button>
      ${!c.resolved && c.type === 'suggestion' ? '<button type="button" class="cp-action" data-comment-action="reject">拒绝建议</button>' : ''}
    </div>
    <form class="cp-reply-form" hidden>
      <textarea class="cp-reply-input" placeholder="回复..."></textarea>
      <div class="cp-form-actions">
        <button type="button" class="cp-secondary" data-comment-action="cancel-reply">取消</button>
        <button type="submit" class="cp-primary">回复</button>
      </div>
    </form>
  `;
  div.addEventListener('click', (event) => handleCommentCardClick(event, c));
  const form = div.querySelector('.cp-reply-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = form.querySelector('.cp-reply-input');
    const text = input.value.trim();
    if (!text) return;
    await API.replyComment({ fileId: ui.activeDocId, commentId: c.id, text });
    toast('回复已添加');
    await refreshCommentSurfaces(c.id);
  });
  return div;
}

async function refreshCommentSurfaces(activeCommentId = null) {
  ui.currentComments = null;
  if (!$('#comments-panel')?.hidden) await renderCommentsPanel();
  await renderCommentAnchors(activeCommentId);
  if (ui.reviewSuggestedEditsOpen) await syncReviewSuggestedEditsPanel();
}

async function reloadActiveDocument() {
  if (!ui.activeDocId) return;
  const result = await API.file(ui.activeDocId);
  ui.activeDoc = { ...(result.file || {}), content: result.file?.content || {} };
  $('#editor-title').value = ui.activeDoc.content.title || ui.activeDoc.name || '';
  renderEditorContent();
  renderOutline();
  renderPaperSuggestions();
  $('#paper-content').contentEditable = ui.editMode === 'viewing' ? 'false' : 'true';
  setSaved(true);
}

function ensureReviewSuggestedEditsPanel() {
  let panel = $('#review-suggested-edits-panel');
  if (panel) return panel;
  panel = document.createElement('aside');
  panel.id = 'review-suggested-edits-panel';
  panel.className = 'review-suggested-edits-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <header class="rse-header">
      <div>
        <h2>建议的修改</h2>
        <span id="rse-count">0 条建议</span>
      </div>
      <button type="button" class="icon-btn small" id="rse-close" aria-label="关闭建议修改" data-tooltip="关闭">
        <svg viewBox="0 0 24 24"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3 10.59 10.59 16.89 4.3z"/></svg>
      </button>
    </header>
    <label class="rse-preview-label" for="rse-preview">预览</label>
    <select id="rse-preview" class="rse-preview">
      <option value="suggestions">显示建议的修改</option>
      <option value="accepted">预览全部接受</option>
      <option value="rejected">预览全部拒绝</option>
    </select>
    <div id="rse-list" class="rse-list"></div>
    <footer class="rse-footer">
      <button type="button" class="rse-reject-all" id="rse-reject-all">全部拒绝</button>
      <button type="button" class="rse-accept-all" id="rse-accept-all">全部接受</button>
    </footer>
  `;
  document.body.appendChild(panel);
  $('#rse-close', panel).addEventListener('click', () => closeReviewSuggestedEdits());
  $('#rse-preview', panel).addEventListener('change', (event) => {
    ui.reviewSuggestedEditsPreview = event.target.value || 'suggestions';
    renderReviewSuggestedEditsPanel();
    const suggestions = (ui.currentComments || []).filter((comment) => comment.type === 'suggestion' && !comment.resolved && !comment.rejected);
    logSuggestedEditsUiEvent('suggested_edits_review_preview_changed', {
      preview: ui.reviewSuggestedEditsPreview,
      pendingCount: suggestions.length
    });
  });
  $('#rse-accept-all', panel).addEventListener('click', () => applyAllSuggestedEdits('accept'));
  $('#rse-reject-all', panel).addEventListener('click', () => applyAllSuggestedEdits('reject'));
  return panel;
}

async function openReviewSuggestedEdits() {
  ui.reviewSuggestedEditsOpen = true;
  ui.reviewSuggestedEditsPreview = 'suggestions';
  ensureReviewSuggestedEditsPanel().hidden = false;
  await syncReviewSuggestedEditsPanel();
  const suggestions = (ui.currentComments || []).filter((comment) => comment.type === 'suggestion' && !comment.resolved && !comment.rejected);
  await logSuggestedEditsUiEvent('suggested_edits_review_opened', { pendingCount: suggestions.length });
}

function closeReviewSuggestedEdits() {
  ui.reviewSuggestedEditsOpen = false;
  const restoreDocument = ui.reviewSuggestedEditsPreview !== 'suggestions';
  ui.reviewSuggestedEditsPreview = 'suggestions';
  const panel = $('#review-suggested-edits-panel');
  if (panel) panel.hidden = true;
  if (restoreDocument && ui.activeDoc) renderEditorContent();
}

async function currentOpenSuggestions() {
  if (!ui.activeDocId) return [];
  if (!Array.isArray(ui.currentComments)) {
    try {
      const result = await API.comments(ui.activeDocId);
      ui.currentComments = result.comments || [];
    } catch (e) {
      ui.currentComments = [];
    }
  }
  return (ui.currentComments || []).filter((comment) => comment.type === 'suggestion' && !comment.resolved && !comment.rejected);
}

async function syncReviewSuggestedEditsPanel() {
  ensureReviewSuggestedEditsPanel().hidden = !ui.reviewSuggestedEditsOpen;
  await currentOpenSuggestions();
  renderReviewSuggestedEditsPanel();
}

function renderReviewSuggestedEditsPanel() {
  const panel = ensureReviewSuggestedEditsPanel();
  const suggestions = (ui.currentComments || []).filter((comment) => comment.type === 'suggestion' && !comment.resolved && !comment.rejected);
  $('#rse-count', panel).textContent = suggestions.length ? `${suggestions.length} 条待处理建议` : '没有待处理建议';
  $('#rse-preview', panel).value = ui.reviewSuggestedEditsPreview || 'suggestions';
  const list = $('#rse-list', panel);
  list.innerHTML = '';
  if (!suggestions.length) {
    const empty = document.createElement('div');
    empty.className = 'rse-empty';
    empty.textContent = '当前文档没有待处理的建议修改。';
    list.appendChild(empty);
  } else {
    suggestions.forEach((comment, index) => list.appendChild(renderReviewSuggestionItem(comment, index, suggestions.length)));
  }
  const disabled = suggestions.length === 0;
  $('#rse-accept-all', panel).disabled = disabled;
  $('#rse-reject-all', panel).disabled = disabled;
  renderReviewSuggestedEditsDocumentPreview(suggestions);
}

function blocksForReviewSuggestedEditsPreview(blocks = [], suggestions = [], preview = 'suggestions') {
  if (preview === 'suggestions') return blocks;
  const byBlock = new Map();
  suggestions.forEach((comment) => {
    if (!comment.blockId) return;
    const text = preview === 'rejected'
      ? (typeof comment.beforeText === 'string' ? comment.beforeText : comment.quotedText)
      : (typeof comment.afterText === 'string' ? comment.afterText : comment.quotedText);
    if (typeof text === 'string') byBlock.set(comment.blockId, text);
  });
  return blocks.map((block) => {
    if (!byBlock.has(block.id)) return block;
    return { ...block, text: byBlock.get(block.id) };
  });
}

function renderReviewSuggestedEditsDocumentPreview(suggestions = []) {
  if (!ui.reviewSuggestedEditsOpen || !ui.activeDoc) return;
  const preview = ui.reviewSuggestedEditsPreview || 'suggestions';
  if (preview === 'suggestions') {
    renderEditorContent();
    return;
  }
  const blocks = blocksForReviewSuggestedEditsPreview(ui.activeDoc.content?.blocks || [], suggestions, preview);
  renderEditorContent({
    blocks,
    layout: ui.activeDoc.content?.layout,
    reviewSuggestedEditsPreview: preview
  });
}

async function logSuggestedEditsUiEvent(type, details = {}) {
  if (!ui.activeDocId) return;
  try {
    await API.logUiEvent({ type, fileId: ui.activeDocId, ...details });
  } catch (e) {
    console.warn('Unable to log UI event', type, e);
  }
}

function logUiEvent(type, details = {}) {
  if (!ui.activeDocId) return;
  API.logUiEvent({ type, fileId: ui.activeDocId, ...details }).catch((e) => {
    console.warn('Unable to log UI event', type, e);
  });
}

function renderReviewSuggestionItem(comment, index, total) {
  const item = document.createElement('article');
  item.className = 'rse-item';
  item.dataset.commentId = comment.id;
  const before = comment.beforeText || comment.quotedText || '';
  const after = comment.afterText || '';
  const preview = ui.reviewSuggestedEditsPreview || 'suggestions';
  const previewText = preview === 'rejected' ? before : (after || before);
  item.innerHTML = `
    <header>
      <span>${index + 1}/${total}</span>
      <strong>${escape(comment.authorName || 'Unknown')}</strong>
    </header>
    <blockquote>${escape(comment.quotedText || before || '建议修改')}</blockquote>
    <div class="rse-preview-text">${escape(previewText)}</div>
    <div class="rse-meta">${preview === 'accepted' ? '预览：接受后的文档' : preview === 'rejected' ? '预览：拒绝后的文档' : '预览：显示建议修改'}</div>
    <div class="rse-item-actions">
      <button type="button" data-rse-action="reject">拒绝</button>
      <button type="button" data-rse-action="accept">接受</button>
    </div>
  `;
  item.addEventListener('click', (event) => {
    const action = event.target.closest('[data-rse-action]')?.dataset.rseAction;
    if (!action) {
      focusCommentAnchor(comment);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    applySingleSuggestedEdit(comment, action);
  });
  return item;
}

async function applySingleSuggestedEdit(comment, action) {
  if (!ui.activeDocId || !comment?.id) return;
  if (action === 'accept') await API.resolveComment({ fileId: ui.activeDocId, commentId: comment.id });
  else await API.rejectComment({ fileId: ui.activeDocId, commentId: comment.id });
  await logSuggestedEditsUiEvent('suggested_edits_review_single_applied', {
    action,
    commentId: comment.id
  });
  toast(action === 'accept' ? '建议已接受' : '建议已拒绝');
  ui.reviewSuggestedEditsPreview = 'suggestions';
  await reloadActiveDocument();
  await refreshCommentSurfaces();
}

async function applyAllSuggestedEdits(action) {
  const suggestions = await currentOpenSuggestions();
  if (!suggestions.length) {
    toast('没有待处理建议');
    return;
  }
  const accept = action === 'accept';
  for (const suggestion of suggestions) {
    if (accept) await API.resolveComment({ fileId: ui.activeDocId, commentId: suggestion.id });
    else await API.rejectComment({ fileId: ui.activeDocId, commentId: suggestion.id });
  }
  await logSuggestedEditsUiEvent('suggested_edits_review_batch_applied', {
    action: accept ? 'accept' : 'reject',
    commentIds: suggestions.map((suggestion) => suggestion.id),
    commentCount: suggestions.length
  });
  toast(accept ? '已接受所有建议' : '已拒绝所有建议');
  ui.reviewSuggestedEditsPreview = 'suggestions';
  await reloadActiveDocument();
  await refreshCommentSurfaces();
}

async function handleCommentCardClick(event, comment) {
  const action = event.target.closest('[data-comment-action]')?.dataset.commentAction;
  if (!action) {
    focusCommentAnchor(comment);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const card = event.currentTarget;
  if (action === 'reply') {
    const form = card.querySelector('.cp-reply-form');
    form.hidden = false;
    setTimeout(() => form.querySelector('.cp-reply-input')?.focus(), 0);
    return;
  }
  if (action === 'cancel-reply') {
    card.querySelector('.cp-reply-form').hidden = true;
    return;
  }
  if (action === 'resolve') {
    await API.resolveComment({ fileId: ui.activeDocId, commentId: comment.id });
    toast(comment.type === 'suggestion' ? '建议已接受' : '评论已解决');
    await refreshCommentSurfaces();
    return;
  }
  if (action === 'reject') {
    await API.rejectComment({ fileId: ui.activeDocId, commentId: comment.id });
    toast('建议已拒绝');
    await reloadActiveDocument();
    await refreshCommentSurfaces();
    return;
  }
  if (action === 'reopen') {
    await API.reopenComment({ fileId: ui.activeDocId, commentId: comment.id });
    toast('评论已重新打开');
    ui.commentsType = null;
    $('#cp-filter-type').firstChild.textContent = '所有类型 ';
    await refreshCommentSurfaces(comment.id);
  }
}

async function renderCommentAnchors(activeCommentId = null) {
  const wrap = $('#paper-content');
  if (!wrap || !ui.activeDocId) return;
  $$('.pb.has-comment, .pb.active-comment', wrap).forEach((el) => {
    el.classList.remove('has-comment', 'active-comment');
    el.removeAttribute('data-comment-count');
  });
  let comments = ui.currentComments;
  if (!Array.isArray(comments)) {
    try {
      const r = await API.comments(ui.activeDocId);
      comments = r.comments || [];
      ui.currentComments = comments;
    } catch (e) { comments = []; }
  }
  renderCommentTextHighlights(comments);
  const counts = new Map();
  comments.filter((c) => !c.resolved && c.blockId).forEach((c) => {
    counts.set(c.blockId, (counts.get(c.blockId) || 0) + 1);
  });
  counts.forEach((count, blockId) => {
    const block = $(`.pb[data-id="${cssEscape(blockId)}"]`, wrap);
    if (!block) return;
    block.classList.add('has-comment');
    block.dataset.commentCount = String(count);
  });
  if (activeCommentId) {
    const comment = comments.find((c) => c.id === activeCommentId);
    if (comment?.blockId) {
      const block = $(`.pb[data-id="${cssEscape(comment.blockId)}"]`, wrap);
      block?.classList.add('active-comment');
    }
  }
  renderDocCommentCards(comments, activeCommentId);
}

function hasAnchorTop(target) {
  return Number.isFinite(Number(target?.anchorTop));
}

function getAnchoredTop(target, block, wrapRect) {
  const contentRect = $('#paper-content')?.getBoundingClientRect();
  if (hasAnchorTop(target) && contentRect) {
    return contentRect.top - wrapRect.top + Number(target.anchorTop);
  }
  return block.getBoundingClientRect().top - wrapRect.top;
}

function renderDocCommentCards(comments = [], activeCommentId = null) {
  const layer = $('#doc-comments-layer');
  const wrap = $('#paper-wrap');
  const paper = $('#paper');
  if (!layer || !wrap || !paper) return;
  layer.innerHTML = '';
  const visible = comments.filter((c) => !c.resolved && c.blockId);
  const draft = ui.commentDraftTarget?.blockId ? ui.commentDraftTarget : null;
  const hiddenByPanel = $('.editor-view')?.classList.contains('with-comments');
  wrap.classList.toggle('has-doc-comments', Boolean((visible.length || draft) && !hiddenByPanel));
  if (hiddenByPanel || (!visible.length && !draft)) {
    updatePaperQuickActions();
    return;
  }
  const wrapRect = wrap.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  const available = window.innerWidth - paperRect.right - 36;
  const width = Math.max(236, Math.min(420, available));
  const naturalLeft = Math.round(paperRect.left - wrapRect.left + paperRect.width + 18);
  const maxLeft = Math.max(0, Math.round(window.innerWidth - wrapRect.left - width - 16));
  const left = Math.min(naturalLeft, maxLeft);
  let nextTop = 34;
  const entries = visible
    .map((comment) => {
      const block = $(`.pb[data-id="${cssEscape(comment.blockId)}"]`, $('#paper-content'));
      if (!block) return null;
      return { type: 'comment', comment, top: Math.round(getAnchoredTop(comment, block, wrapRect)) };
    })
    .filter(Boolean);
  if (draft) {
    const block = $(`.pb[data-id="${cssEscape(draft.blockId)}"]`, $('#paper-content'));
    if (block) entries.push({ type: 'draft', target: draft, top: Math.round(getAnchoredTop(draft, block, wrapRect)) });
  }
  entries
    .sort((a, b) => a.top - b.top || (a.type === b.type ? 0 : a.type === 'draft' ? -1 : 1))
    .forEach((entry) => {
      const card = entry.type === 'draft'
        ? renderDocCommentDraftCard(entry.target)
        : renderDocCommentCard(entry.comment, entry.comment.id === activeCommentId);
      const top = entry.top;
      const y = Math.max(top, nextTop);
      card.style.left = `${left}px`;
      card.style.top = `${y}px`;
      card.style.width = `${width}px`;
      layer.appendChild(card);
      // Cascade the next card below this one using its REAL rendered height
      // (measured after append + width is applied, so text wrapping/replies/the
      // expanded active card are all accounted for). A static height estimate
      // under-counts tall cards and makes adjacent comments overlap.
      const heightEstimate = entry.type === 'draft' ? 178 : 104; // fallback only
      const realHeight = card.offsetHeight || heightEstimate;
      nextTop = y + realHeight + 10;
    });
  updatePaperQuickActions();
}

async function renderDocReactions() {
  const layer = $('#doc-reactions-layer');
  const wrap = $('#paper-wrap');
  const paper = $('#paper');
  if (!layer || !wrap || !paper || !ui.activeDocId) return;
  layer.innerHTML = '';
  let reactions = ui.currentReactions;
  if (!Array.isArray(reactions)) {
    try {
      const r = await API.reactions(ui.activeDocId);
      reactions = r.reactions || [];
      ui.currentReactions = reactions;
    } catch (e) { reactions = []; }
  }
  const grouped = new Map();
  reactions.filter((reaction) => reaction.blockId).forEach((reaction) => {
    const anchorKey = hasAnchorTop(reaction) ? Math.round(Number(reaction.anchorTop)) : 'block';
    const key = `${reaction.blockId}:${reaction.emoji}:${anchorKey}`;
    if (!grouped.has(key)) grouped.set(key, { blockId: reaction.blockId, anchorTop: reaction.anchorTop, emoji: reaction.emoji, count: 0 });
    grouped.get(key).count += 1;
  });
  const wrapRect = wrap.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  let groupIndex = 0;
  grouped.forEach((item) => {
    const block = $(`.pb[data-id="${cssEscape(item.blockId)}"]`, $('#paper-content'));
    if (!block) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'doc-reaction-chip';
    chip.textContent = item.count > 1 ? `${item.emoji} ${item.count}` : item.emoji;
    chip.setAttribute('aria-label', `${item.emoji} 回应 ${item.count} 个`);
    chip.style.left = `${Math.round(paperRect.left - wrapRect.left + paperRect.width - 112 + (groupIndex % 3) * 42)}px`;
    chip.style.top = `${Math.round(getAnchoredTop(item, block, wrapRect) + 24)}px`;
    chip.addEventListener('click', () => toast(`${item.emoji} 回应`));
    layer.appendChild(chip);
    groupIndex += 1;
  });
}

function renderDocCommentCard(comment, active = false) {
  const card = document.createElement('article');
  card.className = 'doc-comment-card' + (active ? ' active' : '') + (comment.type === 'suggestion' ? ' suggestion' : '');
  card.dataset.commentId = comment.id;
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const initial = (comment.authorName || 'U').slice(0, 1).toUpperCase();
  const copyNote = comment.copiedNote
    ? `复制自原始文档${comment.copiedFromDocumentTitle ? `：${comment.copiedFromDocumentTitle}` : ''}`
    : '';
  card.innerHTML = `
    <header class="dcc-head">
      <span class="dcc-avatar" style="background:${escape(comment.authorColor || '#1a73e8')}">${escape(initial)}</span>
      <div class="dcc-author">
        <strong>${escape(comment.authorName || 'Unknown')}</strong>
        <span>${comment.type === 'suggestion' ? '建议 · ' : ''}${escape(relTime(comment.createdAt))}</span>
      </div>
      <button type="button" class="dcc-resolve" data-comment-action="resolve" aria-label="${comment.type === 'suggestion' ? '接受建议' : '标为已解决'}" data-tooltip="${comment.type === 'suggestion' ? '接受建议' : '标为已解决'}">
        <svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      </button>
      ${!comment.resolved && comment.type === 'suggestion' ? `
        <button type="button" class="dcc-reject" data-comment-action="reject" aria-label="拒绝建议" data-tooltip="拒绝建议">
          <svg viewBox="0 0 24 24"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3 10.59 10.59 16.89 4.3z"/></svg>
        </button>
      ` : ''}
    </header>
    ${comment.quotedText ? `<blockquote class="dcc-quote">${escape(comment.quotedText)}</blockquote>` : ''}
    <div class="dcc-text">${escape(comment.text || '')}</div>
    ${copyNote ? `<div class="dcc-copy-note">${escape(copyNote)}</div>` : ''}
    ${replies.length ? `<div class="dcc-replies">${replies.length} 条回复</div>` : ''}
    <div class="dcc-actions">
      <button type="button" data-comment-action="reply">回复</button>
    </div>
    <form class="dcc-reply-form" hidden>
      <textarea placeholder="回复..."></textarea>
      <div>
        <button type="button" data-comment-action="cancel-reply">取消</button>
        <button type="submit">回复</button>
      </div>
    </form>
  `;
  card.addEventListener('click', (event) => handleDocCommentCardClick(event, comment));
  card.querySelector('.dcc-reply-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector('textarea');
    const text = input.value.trim();
    if (!text) return;
    await API.replyComment({ fileId: ui.activeDocId, commentId: comment.id, text });
    logUiEvent('comment_sidecard_reply_submitted', { commentId: comment.id, blockId: comment.blockId || '' });
    toast('回复已添加');
    await refreshCommentSurfaces(comment.id);
  });
  return card;
}

function renderDocCommentDraftCard(target) {
  const card = document.createElement('article');
  card.className = 'doc-comment-card doc-comment-draft active';
  card.dataset.blockId = target.blockId;
  const account = ui.account || {};
  const initial = (account.avatar || account.name || 'U').slice(0, 1).toUpperCase();
  card.innerHTML = `
    <header class="dcc-head">
      <span class="dcc-avatar" style="background:#1a73e8">${escape(initial)}</span>
      <div class="dcc-author">
        <strong>${escape(account.name || 'You')}</strong>
      </div>
    </header>
    <form class="dcc-draft-form">
      <textarea id="doc-comment-draft-input" placeholder='发表评论或用"@"添加他人'></textarea>
      <div class="dcc-draft-actions">
        <button type="button" data-comment-action="draft-cancel">取消</button>
        <button type="submit" class="dcc-draft-submit" disabled>评论</button>
      </div>
    </form>
  `;
  const form = card.querySelector('.dcc-draft-form');
  const input = card.querySelector('textarea');
  const submit = card.querySelector('.dcc-draft-submit');
  input.addEventListener('input', () => {
    submit.disabled = !input.value.trim();
  });
  card.querySelector('[data-comment-action="draft-cancel"]').addEventListener('click', () => closeCommentDraft());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    submit.disabled = true;
    await submitCommentDraft(text);
  });
  return card;
}

function closeCommentDraft() {
  ui.commentDraftTarget = null;
  renderDocCommentCards(ui.currentComments || [], ui.activeMarginCommentId);
  updatePaperQuickActions();
}

async function submitCommentDraft(text) {
  const target = ui.commentDraftTarget;
  if (!target?.blockId) return;
  const result = await API.addComment({
    fileId: ui.activeDocId,
    text,
    quotedText: target.quotedText || '',
    blockId: target.blockId,
    anchorTop: target.anchorTop,
    collapsed: target.collapsed,
    rangeStart: target.rangeStart,
    rangeEnd: target.rangeEnd
  });
  ui.commentDraftTarget = null;
  ui.currentComments = null;
  ui.activeMarginCommentId = result.comment?.id || null;
  logUiEvent('comment_sidecard_submitted', {
    commentId: result.comment?.id || '',
    blockId: target.blockId,
    anchorTop: target.anchorTop,
    collapsed: Boolean(target.collapsed),
    rangeStart: target.rangeStart,
    rangeEnd: target.rangeEnd
  });
  toast('评论已添加');
  await refreshCommentSurfaces(result.comment?.id);
}

async function handleDocCommentCardClick(event, comment) {
  const action = event.target.closest('[data-comment-action]')?.dataset.commentAction;
  ui.activeMarginCommentId = comment.id;
  if (!action) {
    focusCommentAnchor(comment);
    renderDocCommentCards(ui.currentComments || [], comment.id);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const card = event.currentTarget;
  if (action === 'reply') {
    const form = card.querySelector('.dcc-reply-form');
    form.hidden = false;
    logUiEvent('comment_sidecard_reply_opened', { commentId: comment.id, blockId: comment.blockId || '' });
    setTimeout(() => form.querySelector('textarea')?.focus(), 0);
    return;
  }
  if (action === 'cancel-reply') {
    card.querySelector('.dcc-reply-form').hidden = true;
    return;
  }
  if (action === 'resolve') {
    await API.resolveComment({ fileId: ui.activeDocId, commentId: comment.id });
    toast(comment.type === 'suggestion' ? '建议已接受' : '评论已解决');
    await refreshCommentSurfaces();
    return;
  }
  if (action === 'reject') {
    await API.rejectComment({ fileId: ui.activeDocId, commentId: comment.id });
    toast('建议已拒绝');
    await reloadActiveDocument();
    await refreshCommentSurfaces();
  }
}

function focusCommentAnchor(comment) {
  if (!comment?.blockId) return;
  ui.activeMarginCommentId = comment.id;
  const block = $(`.pb[data-id="${cssEscape(comment.blockId)}"]`, $('#paper-content'));
  if (!block) return;
  $$('.pb.active-comment', $('#paper-content')).forEach((el) => el.classList.remove('active-comment'));
  block.classList.add('active-comment');
  block.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function addCommentInteractive(target) {
  const commentTarget = typeof target === 'string' ? { quotedText: target, blockId: null } : target;
  if (!commentTarget?.blockId) { toast('请先在文档中选择要评论的位置'); return; }
  ui.commentTarget = commentTarget;
  ui.commentDraftTarget = { ...commentTarget };
  ui.activeMarginCommentId = null;
  await toggleCommentsPanel(false);
  logUiEvent('comment_sidecard_draft_opened', {
    blockId: commentTarget.blockId,
    anchorTop: commentTarget.anchorTop,
    collapsed: Boolean(commentTarget.collapsed),
    rangeStart: commentTarget.rangeStart,
    rangeEnd: commentTarget.rangeEnd
  });
  await renderCommentAnchors();
  setTimeout(() => $('#doc-comment-draft-input')?.focus(), 0);
}

function promptQuickComment() {
  const target = getQuickActionTarget();
  if (!target?.blockId) { toast('请先在文档中选择要评论的位置'); return; }
  ui.commentTarget = target;
  addCommentInteractive(target);
}

function showEmojiReactionPicker(anchor) {
  const target = getQuickActionTarget();
  if (!target?.blockId) { toast('请先在文档中选择回应位置'); return; }
  ui.commentTarget = target;
  closeFloatingMenus();
  const emojis = ['👍', '✅', '👀', '🎉', '❤️', '😂', '👏', '🙏'];
  const menu = document.createElement('div');
  menu.className = 'popup-menu floating-menu emoji-reaction-menu';
  menu.innerHTML = `
    <div class="emoji-reaction-title">表情符号回应</div>
    <div class="emoji-reaction-context">${escape(target.collapsed ? target.quotedText : `“${target.quotedText}”`)}</div>
    <div class="emoji-reaction-grid" role="listbox" aria-label="选择表情回应"></div>
  `;
  const grid = $('.emoji-reaction-grid', menu);
  emojis.forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-reaction-option';
    button.textContent = emoji;
    button.setAttribute('aria-label', `${emoji} 回应`);
    button.addEventListener('click', async () => {
      menu.remove();
      await addEmojiReaction(emoji, target);
    });
    grid.appendChild(button);
  });
  document.body.appendChild(menu);
  positionPopup(menu, anchor, { side: 'left' });
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!menu.contains(ev.target) && ev.target !== anchor) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 0);
}

async function addEmojiReaction(emoji, target = getQuickActionTarget()) {
  if (!target?.blockId) { toast('请先在文档中选择回应位置'); return; }
  await API.addReaction({
    fileId: ui.activeDocId,
    blockId: target.blockId,
    anchorTop: target.anchorTop,
    emoji,
    quotedText: target.quotedText || '',
    collapsed: target.collapsed,
    rangeStart: target.rangeStart,
    rangeEnd: target.rangeEnd
  });
  ui.currentReactions = null;
  await renderDocReactions();
  updatePaperQuickActions();
  toast(`${emoji} 回应已添加`);
}

function quickSuggestEdit() {
  setEditMode('suggesting');
  const target = getQuickActionTarget();
  if (target?.blockId) {
    const block = $(`.pb[data-id="${cssEscape(target.blockId)}"]`, $('#paper-content'));
    block?.classList.add('active-comment');
  }
}

function focusEditorEnd() {
  const wrap = $('#paper-content');
  const last = wrap.lastElementChild || wrap;
  const range = document.createRange();
  range.selectNodeContents(last);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  wrap.focus();
}

// ============================ Menus / dialogs ============================

function showRowMenu(anchorEl, file) {
  const menu = $('#row-menu');
  ui.rowMenuTargetId = file.id;
  $$('.menu-active').forEach((el) => el.classList.remove('menu-active'));
  const activeRow = anchorEl.closest('[data-file-id]');
  if (activeRow) activeRow.classList.add('menu-active');
  positionPopup(menu, anchorEl, { side: 'left' });
  $$('button', menu).forEach((btn) => {
    const action = btn.dataset.action;
    btn.hidden = false;
    btn.classList.toggle('danger', action === 'trash' || action === 'delete');

    if (file.trashed) {
      btn.hidden = !(action === 'restore' || action === 'delete');
      return;
    }

    if (action === 'restore' || action === 'delete') btn.hidden = true;
    if (file.type === 'folder') {
      btn.hidden = !['rename', 'share', 'organize', 'info', 'trash'].includes(action);
    } else {
      btn.hidden = ['organize', 'info'].includes(action);
    }
    btn.classList.toggle('section-start', file.type === 'folder' && (action === 'share' || action === 'trash'));
  });
  menu.hidden = false;
}

function hideMenus() {
  $('#row-menu').hidden = true;
  $$('.menu-active').forEach((el) => el.classList.remove('menu-active'));
}

function closeFloatingMenus() {
  $$('.popup-menu.floating-menu').forEach((menu) => menu.remove());
}

function positionPopup(menu, anchorEl, opts = {}) {
  const rect = anchorEl.getBoundingClientRect();
  menu.style.position = 'fixed';
  const side = opts.side || autoSide(anchorEl);
  if (side === 'submenu') {
    menu.style.top = `${Math.max(8, rect.top - 8)}px`;
    menu.style.left = `${Math.min(rect.right + 4, window.innerWidth - 280)}px`;
    menu.style.right = 'auto';
    return;
  }
  menu.style.top = `${rect.bottom + 4}px`;
  if (side === 'left') {
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.style.left = 'auto';
  } else {
    menu.style.left = `${Math.max(8, rect.left)}px`;
    menu.style.right = 'auto';
  }
}

function autoSide(anchor) {
  const rect = anchor.getBoundingClientRect();
  return (rect.left + rect.width / 2) > window.innerWidth / 2 ? 'left' : 'right';
}

function showFloatingMenu(anchor, items, opts = {}) {
  const className = String(opts.className || '');
  const isSubmenu = opts.side === 'submenu' || /\b\S+-submenu\b/.test(className);
  if (!isSubmenu) closeFloatingMenus();
  const menu = document.createElement('div');
  menu.className = 'popup-menu floating-menu';
  if (opts.className) menu.classList.add(...className.split(/\s+/).filter(Boolean));
  if (items.some((i) => i.checked != null)) menu.classList.add('has-checkmarks');
  items.forEach((item) => {
    if (item.divider) { const hr = document.createElement('hr'); hr.style.border = '0'; hr.style.borderTop = '1px solid var(--gd-border-soft)'; hr.style.margin = '4px 0'; menu.appendChild(hr); return; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    if (item.checked) b.classList.add('checked');
    if (item.keepOpen) b.classList.add('has-submenu');
    b.innerHTML = `<span class="menu-check">${item.checked ? '✓' : ''}</span><span class="menu-label">${escape(item.label)}</span>`;
    b.addEventListener('mouseenter', () => {
      if (!item.keepOpen && !menu.classList.contains('image-insert-submenu') && !menu.classList.contains('table-insert-submenu')) {
        $$('.image-insert-submenu').forEach((submenu) => submenu.remove());
        $$('.table-insert-submenu').forEach((submenu) => submenu.remove());
      }
      if (!item.keepOpen) return;
      $$('.menu-item.submenu-open', menu).forEach((el) => el.classList.remove('submenu-open'));
      b.classList.add('submenu-open');
      item.onHover?.(b, menu);
    });
    b.addEventListener('click', () => {
      item.onClick?.(b, menu);
      if (!item.keepOpen) menu.remove();
    });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  positionPopup(menu, anchor, { side: opts.side || autoSide(anchor) });
  menu.hidden = false;
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!menu.contains(ev.target) && ev.target !== anchor) { menu.remove(); document.removeEventListener('click', close); }
    });
  }, 0);
}

function applyListPreset(type, label) {
  applyBlockType(type);
  toast(`已应用${label}`);
}

function showChecklistPresetMenu(anchor) {
  showFloatingMenu(anchor, [
    { label: '勾选后给文本添加删除线', onClick: () => applyListPreset('todo', '核对清单') },
    { label: '勾选后不给文本添加删除线', onClick: () => applyListPreset('todo', '核对清单') }
  ], { className: 'list-preset-menu' });
}

function showBulletPresetMenu(anchor) {
  showFloatingMenu(anchor, [
    { label: '项目符号、空心、方形', onClick: () => applyListPreset('bullet', '项目符号列表') },
    { label: '带十字的菱形、3D 箭头、方形', onClick: () => applyListPreset('bullet', '项目符号列表') },
    { label: '复选框', onClick: () => applyListPreset('todo', '核对清单') },
    { label: '箭头、菱形、项目符号', onClick: () => applyListPreset('bullet', '项目符号列表') },
    { label: '星形、空心、方形', onClick: () => applyListPreset('bullet', '项目符号列表') },
    { label: '3D 箭头、空心圆、方块', onClick: () => applyListPreset('bullet', '项目符号列表') },
    { divider: true },
    { label: '核对清单菜单(H) >', onClick: () => showChecklistPresetMenu(anchor) }
  ], { className: 'list-preset-menu' });
}

function showNumberedPresetMenu(anchor) {
  showFloatingMenu(anchor, [
    { label: '带句点的十进制数、小写拉丁字母或小写罗马数字', onClick: () => applyListPreset('numbered', '编号列表') },
    { label: '带括号的十进制数、小写拉丁字母或小写罗马数字', onClick: () => applyListPreset('numbered', '编号列表') },
    { label: '十进制大纲', onClick: () => applyListPreset('numbered', '编号列表') },
    { label: '大写拉丁字母、小写拉丁字母、小写罗马数字', onClick: () => applyListPreset('numbered', '编号列表') },
    { label: '大写罗马数字、大写拉丁字母、十进制数', onClick: () => applyListPreset('numbered', '编号列表') },
    { label: '十进制零、小写拉丁字母、小写罗马数字', onClick: () => applyListPreset('numbered', '编号列表') }
  ], { className: 'list-preset-menu' });
}

function showListPresetMenu(anchor, type) {
  logUiEvent('toolbar_menu_opened', { action: `${type}_list_menu` });
  if (type === 'todo') return showChecklistPresetMenu(anchor);
  if (type === 'bullet') return showBulletPresetMenu(anchor);
  if (type === 'numbered') return showNumberedPresetMenu(anchor);
}

function showDownloadMenu(anchor, file = null) {
  const target = file || ui.activeDoc;
  if (!target?.id) { toast('请先打开一个文档'); return; }
  const side = anchor.closest?.('.popup-menu') ? 'submenu' : autoSide(anchor);
  if (side === 'submenu') $$('.download-submenu').forEach((submenu) => submenu.remove());
  showFloatingMenu(anchor, DOWNLOAD_FORMATS.map((format) => ({
    label: format.label,
    onClick: () => downloadDocument(target.id, format.id)
  })), { side, className: side === 'submenu' ? 'download-submenu' : 'download-menu' });
}

function downloadDocument(fileId, format = 'docx') {
  if (!fileId) { toast('请先打开一个文档'); return; }
  const url = `/api/documents/export?${new URLSearchParams({ fileId, format })}`;
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 0);
  const label = DOWNLOAD_FORMATS.find((item) => item.id === format)?.label || format;
  toast(`正在下载 ${label}`);
}

function showAppsMenu(anchor) {
  const apps = [
    { name: '账号', icon: '👤' }, { name: '搜索', icon: '🔍' }, { name: '地图', icon: '🗺' },
    { name: 'YouTube', icon: '▶️' }, { name: 'Gmail', icon: '✉️' }, { name: '云端硬盘', icon: '🛢' },
    { name: '日历', icon: '📅' }, { name: '相册', icon: '🖼' }, { name: '翻译', icon: '🌐' }
  ];
  const menu = document.createElement('div');
  menu.className = 'popup-menu apps-menu';
  const grid = document.createElement('div'); grid.className = 'apps-grid';
  apps.forEach((app) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="app-icon">${app.icon}</span><span class="app-name">${app.name}</span>`;
    b.addEventListener('click', () => { toast(`打开 ${app.name}（mock）`); menu.remove(); });
    grid.appendChild(b);
  });
  menu.appendChild(grid);
  document.body.appendChild(menu);
  positionPopup(menu, anchor, { side: autoSide(anchor) });
  menu.hidden = false;
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!menu.contains(ev.target) && ev.target !== anchor) { menu.remove(); document.removeEventListener('click', close); }
    });
  }, 0);
}

function showEditorMenu(anchor, kind) {
  const items = {
    file: [
      { label: '新建空白文档', onClick: async () => { const r = await API.createDocument({ name: '未命名文档', parentId: 'root' }); openEditor(r.document.id); } },
      { label: '从模版新建…', onClick: () => { renderHome().then(showTemplatesView); } },
      { label: '打开（⌘O）', onClick: () => showFilePicker() },
      { divider: true },
      { label: '创建副本', onClick: () => { if (!ui.activeDocId) return; promptMakeCopy({ id: ui.activeDocId, name: $('#editor-title').value, parentId: ui.activeDoc?.parentId }, { openAfter: true }); } },
      { label: '重命名', onClick: () => { $('#editor-title').focus(); $('#editor-title').select(); } },
      { label: '将文件移至…', onClick: () => promptMove({ id: ui.activeDocId, name: $('#editor-title').value, parentId: ui.activeDoc?.parentId }) },
      { label: '移至回收站', onClick: async () => { if (!ui.activeDocId) return; await API.trash(ui.activeDocId); toast('已移到回收站'); await renderHome(); } },
      { divider: true },
      { label: '下载  >', keepOpen: true, onHover: (button) => showDownloadMenu(button), onClick: (button) => showDownloadMenu(button) },
      { label: '版本历史  >', keepOpen: true, onHover: (button) => showVersionHistoryMenu(button), onClick: (button) => showVersionHistoryMenu(button) },
      { label: '打印（⌘P）', onClick: () => toast('打印（mock）') }
    ],
    edit: [
      { label: '撤销 ⌘Z', onClick: () => { document.execCommand('undo'); scheduleSave(); } },
      { label: '重做 ⌘Y', onClick: () => { document.execCommand('redo'); scheduleSave(); } },
      { divider: true },
      { label: '剪切 ⌘X', onClick: () => { document.execCommand('cut'); scheduleSave(); } },
      { label: '复制 ⌘C', onClick: () => { document.execCommand('copy'); } },
      { label: '粘贴 ⌘V', onClick: () => toast('请使用 ⌘V 粘贴') },
      { divider: true },
      { label: '查找和替换…', onClick: () => promptFindReplace() }
    ],
    view: [
      { label: '显示文档目录', onClick: () => toggleOutline(false) },
      { label: '隐藏文档目录', onClick: () => toggleOutline(true) },
      { label: '紧凑模式', onClick: () => { document.body.classList.toggle('compact'); toast('已切换紧凑模式'); } },
      { label: '全屏', onClick: () => toast('全屏（mock）') }
    ],
    insert: [
      { label: '图片(I)  >', keepOpen: true, onHover: (button) => showImageInsertMenu(button), onClick: (button) => showImageInsertMenu(button) },
      { label: '封面图片(V)  >', onClick: () => showImageSourceBoundary('封面图片', '封面图片是 Google 文档的新页面元素入口；此 mock 暂不扩展封面图片编辑器。') },
      { label: '表格(T)  >', keepOpen: true, onHover: (button) => showTableInsertMenu(button), onClick: (button) => showTableInsertMenu(button) },
      { label: '组成要素(U)  >', onClick: () => toast('组成要素（mock）') },
      { label: '智能条状标签(Z)  >', onClick: () => toast('智能条状标签（mock）') },
      { label: '电子签名  付费', onClick: () => toast('电子签名是付费功能') },
      { divider: true },
      { label: '链接(L)    ⌘K', onClick: () => $('#tb-link')?.click() },
      { label: '绘图(D)  >', onClick: () => toast('绘图子菜单（mock）') },
      { label: '图表(Q)  >', onClick: () => toast('图表子菜单（mock）') },
      { label: '符号(Y)  >', onClick: () => toast('符号子菜单（mock）') },
      { divider: true },
      { label: '标签页(F11)    Shift+F11', onClick: () => toast('已在当前文档使用默认标签页 1') },
      { label: '水平线(R)', onClick: () => insertHorizontalRuleBlock() },
      { label: '拆分(K)  >', onClick: () => toast('拆分子菜单（mock）') },
      { label: '书签(B)', onClick: () => toast('书签已添加（mock）') },
      { label: '页面元素已更新(P)  >', onClick: () => toast('页面元素（mock）') },
      { divider: true },
      { label: '评论(M)    ⌘+Option+M', onClick: () => promptAddComment() }
    ],
    format: [
      { label: '加粗 ⌘B', onClick: () => { document.execCommand('bold'); scheduleSave(); } },
      { label: '斜体 ⌘I', onClick: () => { document.execCommand('italic'); scheduleSave(); } },
      { label: '下划线 ⌘U', onClick: () => { document.execCommand('underline'); scheduleSave(); } },
      { label: '删除线', onClick: () => { document.execCommand('strikeThrough'); scheduleSave(); } },
      { divider: true },
      { label: '清除格式', onClick: () => { document.execCommand('removeFormat'); scheduleSave(); } }
    ],
    tools: [
      { label: '字数统计', onClick: () => openWordCountDialog() },
      { label: '查看建议修改', onClick: () => openReviewSuggestedEdits() },
      { label: '版本历史', onClick: () => openHistoryView() },
      { label: 'Workspace 工具列表', onClick: () => window.open('/api/workspace/tools', '_blank') }
    ],
    extensions: [
      { label: '附加组件（mock）', onClick: () => toast('附加组件 mock') },
      { label: 'Apps 脚本（mock）', onClick: () => toast('Apps 脚本 mock') }
    ],
    help: [
      { label: '帮助 ⌘?', onClick: () => toast('帮助中心（mock）') },
      { label: '更新动态', onClick: () => toast('更新动态：模版库 GA') },
      { label: '问题反馈', onClick: () => toast('反馈已记录') }
    ]
  };
  showFloatingMenu(anchor, items[kind] || [{ label: '（无选项）', onClick: () => {} }], { side: autoSide(anchor) });
}

function showVersionHistoryMenu(anchor) {
  const side = anchor.closest?.('.popup-menu') ? 'submenu' : autoSide(anchor);
  if (side === 'submenu') $$('.version-history-submenu').forEach((submenu) => submenu.remove());
  showFloatingMenu(anchor, [
    { label: '命名当前版本', onClick: () => promptNameVersion() },
    { label: '查看版本历史记录', onClick: () => openHistoryView() }
  ], { side, className: side === 'submenu' ? 'version-history-submenu' : 'version-history-menu' });
}

function toggleOutline(forceCollapsed) {
  if (typeof forceCollapsed === 'boolean') ui.outlineCollapsed = forceCollapsed;
  else ui.outlineCollapsed = !ui.outlineCollapsed;
  $('.editor-body').classList.toggle('outline-collapsed', ui.outlineCollapsed);
  $('#outline-panel').hidden = ui.outlineCollapsed;
  $('#outline-rail').hidden = !ui.outlineCollapsed;
}

function openDialog({ title, body, onConfirm, confirmLabel = '确定', cancelLabel = '取消', closeOnConfirm = true }) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = '';
  if (typeof body === 'string') $('#dialog-body').innerHTML = body;
  else if (body instanceof Node) $('#dialog-body').appendChild(body);
  $('#dialog-confirm').textContent = confirmLabel;
  $('#dialog-cancel').textContent = cancelLabel;
  $('#dialog-backdrop').hidden = false;
  $('#dialog-confirm').onclick = async () => {
    await onConfirm();
    if (closeOnConfirm) closeDialog();
  };
  $('#dialog-cancel').onclick = closeDialog;
}
function closeDialog() {
  clearFindReplaceHighlights();
  ui.findReplace = null;
  $('#dialog-backdrop').hidden = true;
  $('#dialog-confirm').textContent = '确定';
  $('#dialog-cancel').textContent = '取消';
}

function toast(message) {
  const el = $('#toast'); el.textContent = message;
  el.classList.add('show'); clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ============================ File picker ============================
const PICKER_SUBTITLES = {
  recent: '最近用过',
  drive: '我的云端硬盘',
  shared: '与我共享',
  starred: '已加星标',
  computer: '计算机',
  upload: '上传'
};

async function showFilePicker(tab = 'recent') {
  ui.pickerTab = tab;
  if (tab !== 'drive') {
    ui.pickerFolderId = 'root';
    ui.pickerBreadcrumbs = [];
  }
  $('#picker-backdrop').hidden = false;
  $$('#picker-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#picker-subtitle').textContent = PICKER_SUBTITLES[tab] || '';
  await renderPickerBody(tab);
}
function closeFilePicker() { $('#picker-backdrop').hidden = true; }

async function renderPickerBody(tab) {
  const body = $('#picker-body');
  const renderSeq = ++ui.pickerRenderSeq;
  body.innerHTML = '';
  if (tab === 'computer' || tab === 'upload') {
    body.innerHTML = '<div class="picker-empty"><svg viewBox="0 0 24 24"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4 7.5 7.5 0 0 0 4.61 9.05 6 6 0 0 0 6 21h13a5 5 0 0 0 .35-10.96zM14 13v4h-4v-4H7l5-5 5 5z" fill="#5f6368"/></svg><p>将文件拖到此处<br/>— 或 —</p><button type="button" class="picker-upload-btn">从设备选择文件</button></div>';
    return;
  }
  const params = tab === 'shared' ? { view: 'shared' }
    : tab === 'starred' ? { view: 'starred' }
    : tab === 'drive' ? { view: 'home', parentId: ui.pickerFolderId || 'root' }
    : { view: 'recent' };
  const data = await API.files({ ...params, sortBy: 'lastOpenedAt', sortDir: 'desc' });
  if (renderSeq !== ui.pickerRenderSeq) return;
  ui.pickerBreadcrumbs = data.breadcrumbs || [];
  renderPickerBreadcrumb(tab);
  const files = data.files.filter((f) => f.type === 'document' || tab === 'drive');
  ui.pickerFiles = tab === 'drive' ? files : [];
  if (!files.length) {
    body.innerHTML = '<p class="picker-empty-text">没有文件。</p>';
    return;
  }
  if (tab === 'drive') {
    renderPickerDriveList(body, files);
    return;
  }
  // group by date (当天 / 前一页 / 上一周 / 更早)
  const groups = { today: [], yesterday: [], week: [], earlier: [] };
  const now = Date.now();
  files.forEach((f) => {
    const ts = new Date(f.lastOpenedAt || f.modifiedAt).getTime();
    const dayDiff = (now - ts) / 86400000;
    if (dayDiff < 1) groups.today.push(f);
    else if (dayDiff < 2) groups.yesterday.push(f);
    else if (dayDiff < 7) groups.week.push(f);
    else groups.earlier.push(f);
  });
  [['today', '当天'], ['yesterday', '前一页'], ['week', '上一周'], ['earlier', '更早']].forEach(([k, label]) => {
    if (!groups[k].length) return;
    const head = document.createElement('div'); head.className = 'picker-group-label'; head.textContent = label;
    body.appendChild(head);
    const grid = document.createElement('div'); grid.className = 'picker-grid';
    groups[k].forEach((f) => grid.appendChild(renderPickerCard(f)));
    body.appendChild(grid);
  });
}

function renderPickerDriveList(body, files) {
  const table = document.createElement('table');
  table.className = 'picker-drive-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th class="pdt-name">名称 <span class="pdt-sort">↑</span></th>
        <th class="pdt-owner">所有者</th>
        <th class="pdt-modified">修改日期</th>
        <th class="pdt-size">文件大小</th>
        <th class="pdt-actions"></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');
  files.forEach((file) => tbody.appendChild(renderPickerDriveRow(file)));
  body.appendChild(table);
}

function renderPickerDriveRow(file) {
  const tr = document.createElement('tr');
  tr.dataset.fileId = file.id;
  tr.innerHTML = `
    <td class="pdt-name">
      <span class="pdt-icon ${file.type === 'folder' ? 'folder' : 'doc'}">${file.type === 'folder' ? '' : ''}</span>
      <span class="pdt-title">${escape(file.name)}</span>
    </td>
    <td class="pdt-owner">${escape(file.owner?.displayName || ui.account?.name || '')}</td>
    <td class="pdt-modified">${escape(formatDate(file.modifiedAt || file.lastOpenedAt || file.createdAt))}</td>
    <td class="pdt-size">—</td>
    <td class="pdt-actions"><button type="button" class="row-action" data-action="menu" aria-label="更多操作 (Alt+A)">⋮</button></td>
  `;
  tr.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    if (file.type === 'folder') {
      ui.pickerFolderId = file.id;
      renderPickerBody('drive');
    } else {
      closeFilePicker();
      openEditor(file.id);
    }
  });
  tr.querySelector('[data-action="menu"]').addEventListener('click', (event) => {
    event.stopPropagation();
    showRowMenu(event.currentTarget, file);
  });
  return tr;
}

function renderPickerBreadcrumb(tab) {
  const subtitle = $('#picker-subtitle');
  if (tab !== 'drive') {
    subtitle.textContent = PICKER_SUBTITLES[tab] || '';
    return;
  }
  const crumbs = ui.pickerBreadcrumbs.length
    ? ui.pickerBreadcrumbs
    : [{ id: 'root', name: PICKER_SUBTITLES.drive }];
  subtitle.innerHTML = '';
  crumbs.forEach((crumb, idx) => {
    if (idx) subtitle.appendChild(Object.assign(document.createElement('span'), { className: 'picker-crumb-sep', textContent: '›' }));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-crumb';
    btn.textContent = crumb.name;
    btn.addEventListener('click', async () => {
      ui.pickerFolderId = crumb.id || 'root';
      await renderPickerBody('drive');
    });
    subtitle.appendChild(btn);
  });
}

function renderPickerCard(file) {
  const card = document.createElement('div');
  card.className = 'picker-card';
  card.dataset.fileId = file.id;
  // big content preview thumbnail — drives off real document content
  const thumb = document.createElement('div');
  thumb.className = 'picker-card-thumb';
  if (file.type === 'folder') {
    thumb.innerHTML = '<div class="pdm-folder">📁</div>';
  } else {
    thumb.appendChild(renderDocMini(file));
  }
  // star indicator overlay (top-right of thumb)
  if (file.starred) {
    const star = document.createElement('span');
    star.className = 'pdm-star';
    star.textContent = '★';
    star.setAttribute('aria-label', '已加星标');
    thumb.appendChild(star);
  }
  const footer = document.createElement('div');
  footer.className = 'picker-card-footer';
  footer.innerHTML = `${file.type === 'folder' ? '' : docIconSvg()}<span class="picker-card-name">${escape(file.name)}</span>`;
  card.appendChild(thumb); card.appendChild(footer);
  card.addEventListener('click', () => {
    if (file.type === 'folder') {
      ui.pickerFolderId = file.id;
      renderPickerBody('drive');
    } else {
      closeFilePicker();
      openEditor(file.id);
    }
  });
  return card;
}

function renderDocMini(file) {
  const summary = file.contentSummary || {};
  const wrap = document.createElement('div');
  wrap.className = 'picker-doc-mini';
  // title with appropriate weight
  const title = document.createElement('div');
  title.className = 'pdm-title';
  if (summary.titleType === 'subtitle') title.classList.add('subtitle');
  title.textContent = summary.titleText || file.name || '';
  wrap.appendChild(title);
  // body lines
  (summary.body || []).forEach((b) => {
    const line = document.createElement('div');
    line.className = `pdm-line type-${b.type || 'paragraph'}`;
    line.textContent = b.text || '';
    wrap.appendChild(line);
  });
  // for nearly-empty docs, fall back to a few placeholder lines
  if (!(summary.body || []).length) {
    for (let i = 0; i < 3; i++) {
      const ln = document.createElement('div');
      ln.className = 'pdm-line empty';
      wrap.appendChild(ln);
    }
  }
  return wrap;
}

// ============================ Event wiring ============================

function bindGlobalEvents() {
  // topbar
  $('#menu-button').addEventListener('click', () => toast('主菜单（mock）'));
  $('#upgrade-button').addEventListener('click', () => toast('升级即可获享高级功能'));
  $('#apps-button').addEventListener('click', (e) => showAppsMenu(e.currentTarget));
  $('#account-button').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: `${ui.account.name} <${ui.account.email}>`, onClick: () => {} },
    { label: '管理 Google 账号', onClick: () => toast('账号管理 mock') },
    { label: '添加其他账号', onClick: () => toast('添加账号 mock') },
    { label: '退出登录', onClick: () => toast('已退出 mock') }
  ], { side: 'left' }));
  $('#home-brand').addEventListener('click', (e) => { e.preventDefault(); ui.currentFolderId = 'root'; renderHome('home'); });

  // search
  let st;
  $('#search-input').addEventListener('input', (e) => {
    ui.query = e.target.value;
    $('#search-clear').hidden = !ui.query;
    clearTimeout(st);
    st = setTimeout(() => renderHome(ui.filterView), 200);
  });
  $('#search-clear').addEventListener('click', () => { ui.query = ''; $('#search-input').value = ''; $('#search-clear').hidden = true; renderHome(ui.filterView); });
  $('#search-form').addEventListener('submit', (e) => e.preventDefault());

  // template strip
  $('#open-templates').addEventListener('click', showTemplatesView);
  $('#toggle-strip').addEventListener('click', () => {
    const sec = $('#template-section');
    const collapsed = sec.dataset.collapsed === 'true';
    sec.dataset.collapsed = (!collapsed).toString();
    $('#template-row').hidden = !collapsed ? false : true;
    if (sec.dataset.collapsed === 'true') {
      $('#template-row').hidden = true;
      $('#toggle-strip').setAttribute('aria-label', '显示所有模板');
    } else {
      $('#template-row').hidden = false;
      $('#toggle-strip').setAttribute('aria-label', '隐藏所有模板');
    }
  });

  // recent controls
  $('#owner-filter-btn').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '不限归属', onClick: () => { ui.ownerFilter = 'any'; $('#owner-filter-label').textContent = OWNER_LABELS.any; renderHome(ui.filterView); } },
    { label: '归我所有', onClick: () => { ui.ownerFilter = 'me'; $('#owner-filter-label').textContent = OWNER_LABELS.me; renderHome(ui.filterView); } },
    { label: '非我所有', onClick: () => { ui.ownerFilter = 'others'; $('#owner-filter-label').textContent = OWNER_LABELS.others; renderHome(ui.filterView); } }
  ], { side: 'right' }));

  $('#sort-btn').addEventListener('click', (e) => {
    const items = SORT_ORDER.map((key) => ({
      label: SORT_LABELS[key],
      checked: ui.sortBy === key,
      onClick: () => setSort(key, key === 'name' ? 'asc' : 'desc')
    }));
    showFloatingMenu(e.currentTarget, items, { side: 'left' });
  });

  async function setSort(by, dir) {
    ui.sortBy = by; if (dir) ui.sortDir = dir;
    $('#sort-label').textContent = SORT_LABELS[by] || by;
    await API.setSort(ui.sortBy, ui.sortDir);
    await renderHome(ui.filterView);
  }

  $('#layout-toggle').addEventListener('click', async () => {
    ui.layout = ui.layout === 'grid' ? 'list' : 'grid';
    syncLayoutToggle();
    await API.setLayout(ui.layout);
    renderFiles();
  });

  $('#file-picker-btn').addEventListener('click', () => showFilePicker());

  // row menu
  $('#row-menu').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !$('#row-menu').contains(button)) return;
    const action = button.dataset.action;
    const fileId = ui.rowMenuTargetId;
    const file = ui.files.find((f) => f.id === fileId) || ui.pickerFiles.find((f) => f.id === fileId);
    if (!file) return;
    if (action === 'download') {
      showDownloadMenu(button, file);
      return;
    }
    hideMenus();
    if (action === 'open') handleOpenFile(file);
    else if (action === 'rename') promptRename(file);
    else if (action === 'move') promptMove(file);
    else if (action === 'organize') promptMove(file);
    else if (action === 'duplicate') promptMakeCopy(file, { openAfter: false });
    else if (action === 'star') { await API.star(file.id, !file.starred); await renderHome(ui.filterView); }
    else if (action === 'share') promptShare(file);
    else if (action === 'info') toast(`${file.name} 文件夹 · ${relTime(file.modifiedAt)} 修改`);
    else if (action === 'trash') { await API.trash(file.id); toast('已移到回收站'); await renderHome(ui.filterView); }
    else if (action === 'restore') { await API.restore(file.id); toast('已还原'); await renderHome(ui.filterView); }
    else if (action === 'delete') {
      if (confirm(`永久删除「${file.name}」？此操作无法撤销。`)) {
        await API.remove(file.id); toast('已永久删除'); await renderHome(ui.filterView);
      }
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.popup-menu') && !event.target.closest('[data-action="menu"]')) hideMenus();
  });

  // templates view
  $('#templates-back').addEventListener('click', () => renderHome(ui.filterView));

  // editor topbar
  $('#editor-brand').addEventListener('click', async (e) => {
    e.preventDefault();
    if (ui.saveTimer) {
      clearTimeout(ui.saveTimer);
      const snap = snapshotEditor();
      await API.editDocument({ fileId: ui.activeDocId, title: snap.title, blocks: snap.blocks });
    }
    await renderHome(ui.filterView);
  });
  $('#editor-title').addEventListener('input', () => scheduleSave());
  $('#editor-star').addEventListener('click', async () => {
    if (!ui.activeDocId) return;
    const next = !ui.activeDoc.starred;
    await API.star(ui.activeDocId, next);
    ui.activeDoc.starred = next;
    syncStarButton();
    toast(next ? '已加星标' : '已取消星标');
  });
  $('#editor-folder').addEventListener('click', () => promptMove({ id: ui.activeDocId, name: $('#editor-title').value, parentId: ui.activeDoc?.parentId }));
  $('#editor-cloud').addEventListener('click', () => toast('所有更改已保存到云端硬盘'));
  $('#editor-history').addEventListener('click', () => openHistoryView());
  $('#editor-meet').addEventListener('click', () => toast('视频通话（mock）'));
  $('#editor-comment').addEventListener('click', () => toggleCommentsPanel());
  $('#cp-close').addEventListener('click', () => toggleCommentsPanel(false));
  $('#cp-bell').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '所有评论的通知', onClick: () => toast('已开启所有评论通知') },
    { label: '仅与您相关的评论', onClick: () => toast('已只接收与您相关的评论') },
    { label: '关闭通知', onClick: () => toast('已关闭评论通知') }
  ], { side: 'left' }));
  $$('.cp-tabs button[role="tab"]').forEach((btn) => btn.addEventListener('click', () => {
    $$('.cp-tabs button[role="tab"]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    ui.commentsTab = btn.dataset.cpTab;
    renderCommentsPanel();
  }));
  $('#cp-filter-type').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '所有类型', checked: !ui.commentsType, onClick: () => { ui.commentsType = null; $('#cp-filter-type').firstChild.textContent = '所有类型 '; renderCommentsPanel(); } },
    { label: '建议', checked: ui.commentsType === 'suggestion', onClick: () => { ui.commentsType = 'suggestion'; $('#cp-filter-type').firstChild.textContent = '建议 '; renderCommentsPanel(); } },
    { label: '评论', checked: ui.commentsType === 'comment', onClick: () => { ui.commentsType = 'comment'; $('#cp-filter-type').firstChild.textContent = '评论 '; renderCommentsPanel(); } },
    { label: '已解决', checked: ui.commentsType === 'resolved', onClick: () => { ui.commentsType = 'resolved'; $('#cp-filter-type').firstChild.textContent = '已解决 '; renderCommentsPanel(); } }
  ]));
  $('#cp-filter-tab').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '所有标签页', checked: !ui.commentsTabFilter, onClick: () => { ui.commentsTabFilter = null; $('#cp-filter-tab').firstChild.textContent = '所有标签页 '; renderCommentsPanel(); } },
    { label: '标签页 1', checked: ui.commentsTabFilter === 'tab1', onClick: () => { ui.commentsTabFilter = 'tab1'; $('#cp-filter-tab').firstChild.textContent = '标签页 1 '; renderCommentsPanel(); } }
  ]));
  $('#cp-learn-more').addEventListener('click', (e) => { e.preventDefault(); toast('帮助中心（mock）'); });

  // ---- History view ----
  $('#hv-back').addEventListener('click', () => setView('editor'));
  $('#hv-side-back').addEventListener('click', () => setView('editor'));
  $('#hv-print').addEventListener('click', () => window.print());
  $('#hv-restore-version').addEventListener('click', () => restoreHistoryVersion());
  $('#hv-zoom').addEventListener('click', (e) => showFloatingMenu(e.currentTarget,
    ['50%', '75%', '100%', '125%', '150%', '200%'].map((z) => ({ label: z, onClick: () => { e.currentTarget.firstChild.textContent = z + ' '; toast(`缩放 ${z}`); } }))
  ));
  $('#hv-pinyin').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '关闭', onClick: () => toast('输入工具已关闭') },
    { label: '拼音', onClick: () => toast('已切换到拼音输入') }
  ]));
  $('#hv-prev').addEventListener('click', () => moveHistorySelection(1));
  $('#hv-next').addEventListener('click', () => moveHistorySelection(-1));
  $('#hv-rail-filter').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '所有版本', checked: !ui.versionFilter, onClick: () => setHistoryVersionFilter(null) },
    { label: '已命名版本', checked: ui.versionFilter === 'named', onClick: () => setHistoryVersionFilter('named') }
  ]));
  $('#hv-show-diff').addEventListener('change', (e) => {
    ui.showDiff = e.target.checked;
    renderHistoryPaper();
  });
  $('#editor-share').addEventListener('click', () => promptShare(ui.activeDoc ? { id: ui.activeDocId, name: ui.activeDoc.name || ui.activeDoc.content.title } : null));
  $('#editor-avatar').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: `${ui.account.name} <${ui.account.email}>`, onClick: () => {} },
    { label: '退出登录', onClick: () => toast('退出 mock') }
  ], { side: 'left' }));

  $$('.editor-menu button').forEach((btn) => btn.addEventListener('click', (e) => showEditorMenu(e.currentTarget, btn.dataset.menu)));

  // formatting toolbar
  $$('#formatting-toolbar [data-format]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.format;
      if (['bold', 'italic', 'underline'].includes(cmd)) document.execCommand(cmd);
      else if (cmd === 'strike') document.execCommand('strikeThrough');
      scheduleSave();
    });
  });
  $$('#formatting-toolbar .tb-list-main[data-block]').forEach((btn) => btn.addEventListener('click', () => applyBlockType(btn.dataset.block)));
  $$('#formatting-toolbar [data-list-menu]').forEach((btn) => btn.addEventListener('click', (event) => {
    event.stopPropagation();
    showListPresetMenu(btn, btn.dataset.listMenu);
  }));
  $('#tb-undo').addEventListener('click', () => { document.execCommand('undo'); scheduleSave(); });
  $('#tb-redo').addEventListener('click', () => { document.execCommand('redo'); scheduleSave(); });
  $('#tb-style').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '普通文本', onClick: () => applyBlockType('paragraph') },
    { label: '标题', onClick: () => applyBlockType('heading1') },
    { label: '副标题', onClick: () => applyBlockType('subtitle') },
    { label: '标题 1', onClick: () => applyBlockType('heading1') },
    { label: '标题 2', onClick: () => applyBlockType('heading2') },
    { label: '标题 3', onClick: () => applyBlockType('heading3') }
  ]));
  $('#tb-font').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, ['Arial', 'Roboto', 'Georgia', 'Calibri', 'Times New Roman', 'Verdana'].map((f) => ({ label: f, onClick: () => { $('#tb-font').firstElementChild.textContent = f; toast(`字体改为 ${f}（mock 渲染）`); } }))));
  $('#tb-zoom').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, ['50%','75%','100%','125%','150%','200%'].map((z) => ({ label: z, onClick: () => { $('#tb-zoom').firstElementChild.textContent = z; toast(`缩放 ${z}`); } }))));
  $('#tb-search').addEventListener('click', () => promptFindReplace());
  $('#tb-print').addEventListener('click', () => { window.print(); });
  $('#tb-spell').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '检查拼写', onClick: () => toast('已检查（mock 无错）') },
    { label: '关闭拼写检查', onClick: () => toast('已关闭拼写检查') }
  ]));
  $('#tb-paint').addEventListener('click', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) { toast('请先选中要复制格式的文字'); return; }
    const node = sel.getRangeAt(0).startContainer;
    const block = node.nodeType === 1 ? node.closest('.pb') : node.parentElement?.closest('.pb');
    ui.paintFormatType = block?.dataset.type || 'paragraph';
    toast(`已复制格式（${ui.paintFormatType}），点击下个段落应用`);
  });
  $('#tb-color').addEventListener('click', (e) => showColorPicker(e.currentTarget, 'foreColor'));
  $('#tb-highlight').addEventListener('click', (e) => showColorPicker(e.currentTarget, 'backColor'));
  $('#tb-link').addEventListener('mousedown', (e) => e.preventDefault());
  $('#tb-link').addEventListener('click', () => promptInsertLink());
  $('#tb-comment-add').addEventListener('mousedown', (e) => e.preventDefault());
  $('#tb-comment-add').addEventListener('click', () => promptAddComment());
  $('#quick-add-comment').addEventListener('mousedown', (e) => e.preventDefault());
  $('#quick-add-comment').addEventListener('click', () => promptQuickComment());
  $('#quick-add-reaction').addEventListener('mousedown', (e) => e.preventDefault());
  $('#quick-add-reaction').addEventListener('click', (e) => showEmojiReactionPicker(e.currentTarget));
  $('#quick-suggest-edit').addEventListener('mousedown', (e) => e.preventDefault());
  $('#quick-suggest-edit').addEventListener('click', () => quickSuggestEdit());
  $('#tb-image').addEventListener('click', () => promptInsertImage());
  $('#tb-align').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '左对齐 (⌘+Shift+L)', onClick: () => { document.execCommand('justifyLeft'); scheduleSave(); } },
    { label: '居中对齐 (⌘+Shift+E)', onClick: () => { document.execCommand('justifyCenter'); scheduleSave(); } },
    { label: '右对齐 (⌘+Shift+R)', onClick: () => { document.execCommand('justifyRight'); scheduleSave(); } },
    { label: '两端对齐 (⌘+Shift+J)', onClick: () => { document.execCommand('justifyFull'); scheduleSave(); } }
  ]));
  $('#tb-linespace').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '单倍间距(S)', onClick: () => setLineHeight(1.0) },
    { label: '1.15', onClick: () => setLineHeight(1.15) },
    { label: '1.5', onClick: () => setLineHeight(1.5) },
    { label: '双倍间距(D)', onClick: () => setLineHeight(2.0) },
    { divider: true },
    { label: '添加段落前间距(B)', onClick: () => toast('已添加段落前间距（mock）') },
    { label: '添加段落后间距(A)', onClick: () => toast('已添加段落后间距（mock）') },
    { label: '自定义间距(C)', onClick: () => toast('自定义间距（mock）') },
    { divider: true },
    { label: '与下段同页(N)', onClick: () => toast('与下段同页（mock）') },
    { label: '段中不分页(T)', onClick: () => toast('段中不分页（mock）') },
    { label: '避免孤行(P)', onClick: () => toast('避免孤行（mock）') },
    { label: '在前面添加分页符(R)', onClick: () => toast('在前面添加分页符（mock）') }
  ]));
  $('#tb-indent-dec').addEventListener('click', () => { document.execCommand('outdent'); scheduleSave(); });
  $('#tb-indent-inc').addEventListener('click', () => { document.execCommand('indent'); scheduleSave(); });
  $('#tb-clearformat').addEventListener('click', () => { document.execCommand('removeFormat'); scheduleSave(); });
  $('#tb-input').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '关闭', checked: !ui.imeMode, onClick: () => { ui.imeMode = null; toast('输入工具已关闭'); } },
    { label: '拼音', checked: ui.imeMode === 'pinyin', onClick: () => { ui.imeMode = 'pinyin'; toast('已切换到拼音输入') } },
    { label: '手写', checked: ui.imeMode === 'handwrite', onClick: () => { ui.imeMode = 'handwrite'; toast('已切换到手写输入') } }
  ]));
  $('#tb-modes').addEventListener('click', (e) => showFloatingMenu(e.currentTarget, [
    { label: '编辑 — 直接编辑文档', checked: ui.editMode === 'editing', onClick: () => setEditMode('editing') },
    { label: '建议 — 修改记录会显示为建议', checked: ui.editMode === 'suggesting', onClick: () => setEditMode('suggesting') },
    { label: '查看 — 阅读或打印最终文档', checked: ui.editMode === 'viewing', onClick: () => setEditMode('viewing') }
  ]));
  $('#tb-collapse-toolbar').addEventListener('click', () => {
    const tb = $('#formatting-toolbar');
    tb.classList.toggle('collapsed');
    toast(tb.classList.contains('collapsed') ? '已收起菜单' : '已展开菜单');
  });
  $('#tb-size-dec').addEventListener('click', () => adjustFontSize(-1));
  $('#tb-size-inc').addEventListener('click', () => adjustFontSize(1));

  // outline panel
  $('#outline-collapse').addEventListener('click', () => toggleOutline(true));
  $('#outline-rail').addEventListener('click', () => toggleOutline(false));
  $('#outline-add').addEventListener('click', () => { applyBlockType('heading1'); toast('已为当前段落设为标题 1'); });

  // in-paper suggestions
  $('#paper-suggestions').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const sug = btn.dataset.suggest;
    if (sug === 'more') { showTemplatesView(); return; }
    const tpl = ui.templates.find((t) => t.id === sug);
    if (!tpl) return;
    // replace current content with template
    await fetch('/api/documents/edit', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ fileId: ui.activeDocId, title: tpl.content.title, blocks: tpl.content.blocks })
    });
    const fr = await API.file(ui.activeDocId);
    ui.activeDoc = { documentId: fr.file.id, content: fr.file.content, starred: fr.file.starred, parentId: fr.file.parentId };
    $('#editor-title').value = fr.file.content.title;
    renderEditorContent();
    renderOutline();
    renderPaperSuggestions();
    focusEditorEnd();
  });

  // paper editing
  $('#paper-content').addEventListener('input', handleEditorInput);
  $('#paper-content').addEventListener('keydown', handleEditorKeydown);
  $('#paper-content').addEventListener('pointerdown', handleImagePointerSelect, true);
  $('#paper-content').addEventListener('mousedown', handleImagePointerSelect, true);
  $('#paper-content').addEventListener('click', (event) => {
    const imageAction = event.target.closest('[data-image-action]');
    if (imageAction) {
      event.preventDefault();
      event.stopPropagation();
      const block = imageAction.closest('.pb.image-block');
      handleImageToolbarAction(imageAction.dataset.imageAction, block);
      return;
    }
    const imageBlock = imageBlockFromEvent(event);
    if (imageBlock) {
      event.preventDefault();
      event.stopPropagation();
      selectImageBlock(imageBlock);
      return;
    }
    if (isImageClearGuardActive()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    clearImageSelection();
  });
  document.addEventListener('selectionchange', () => {
    rememberCommentTarget();
    requestAnimationFrame(updatePaperQuickActions);
  });
  window.addEventListener('resize', () => {
    renderDocCommentCards(ui.currentComments || [], ui.activeMarginCommentId);
    renderDocReactions();
    updatePaperQuickActions();
  });
  $('#paper').addEventListener('click', (event) => {
    if (event.target.id === 'paper') {
      if (isImageClearGuardActive()) { event.preventDefault(); return; }
      clearImageSelection(); focusEditorEnd();
    }
  });
  $('#paper-wrap').addEventListener('click', (event) => {
    if (event.target.id === 'paper-wrap') {
      if (isImageClearGuardActive()) { event.preventDefault(); return; }
      clearImageSelection(); focusEditorEnd();
    }
  });

  // file picker
  $('#picker-close').addEventListener('click', closeFilePicker);
  $('#picker-backdrop').addEventListener('click', (e) => { if (e.target.id === 'picker-backdrop') closeFilePicker(); });
  $$('#picker-tabs button').forEach((b) => b.addEventListener('click', () => showFilePicker(b.dataset.tab)));

  // dialog
  $('#dialog-backdrop').addEventListener('click', (e) => { if (e.target.id === 'dialog-backdrop') closeDialog(); });
}

function handleEditorKeydown(event) {
  if (getSelectedImageBlock()) {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      removeSelectedImageBlock();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      clearImageSelection();
      $('#paper-content')?.focus();
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const block = sel.anchorNode.nodeType === 1 ? sel.anchorNode.closest('.pb') : sel.anchorNode.parentElement.closest('.pb');
    const newBlock = document.createElement('div');
    newBlock.className = 'pb';
    newBlock.dataset.id = `b-${Math.random().toString(36).slice(2, 8)}`;
    const carryType = ['bullet', 'numbered', 'todo'].includes(block?.dataset.type) ? block.dataset.type : 'paragraph';
    newBlock.dataset.type = carryType;
    newBlock.textContent = '';
    block.parentNode.insertBefore(newBlock, block.nextSibling);
    const r = document.createRange();
    r.setStart(newBlock, 0); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    scheduleSave();
  } else if (event.key === 'Backspace') {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const block = sel.anchorNode.nodeType === 1 ? sel.anchorNode.closest('.pb') : sel.anchorNode.parentElement.closest('.pb');
    if (block && block.textContent === '' && $$('.pb', $('#paper-content')).length > 1) {
      event.preventDefault();
      const prev = block.previousElementSibling;
      block.remove();
      if (prev) { const r = document.createRange(); r.selectNodeContents(prev); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
      scheduleSave();
    }
  }
}

// ============================ Dialogs (rename / move / share / find) ============================

function promptMakeCopy(file, options = {}) {
  if (!file?.id) return;
  fetch('/api/state').then((r) => r.json()).then((state) => {
    const liveFile = state.files.find((item) => item.id === file.id) || file;
    const folders = state.files.filter((item) => item.type === 'folder' && !item.trashed && item.id !== liveFile.id);
    const comments = Array.isArray(liveFile.comments) ? liveFile.comments : [];
    const hasResolved = comments.some((comment) => comment.resolved);
    const wrap = document.createElement('div');
    wrap.className = 'make-copy-dialog';
    wrap.innerHTML = `
      <label for="copy-name">名称</label>
      <input id="copy-name" type="text" value="${escape(`${liveFile.name || '未命名文档'} 副本`)}">
      <label for="copy-folder">文件夹</label>
      <select id="copy-folder"></select>
      <label class="mcd-check">
        <input id="copy-comments" type="checkbox">
        <span>复制评论和建议</span>
      </label>
      <label class="mcd-check mcd-nested">
        <input id="copy-resolved" type="checkbox" disabled>
        <span>包含已解决的评论和建议</span>
      </label>
    `;
    const folderSelect = $('#copy-folder', wrap);
    const rootOption = document.createElement('option');
    rootOption.value = 'root';
    rootOption.textContent = '我的云端硬盘';
    folderSelect.appendChild(rootOption);
    folders.forEach((folder) => {
      const opt = document.createElement('option');
      opt.value = folder.id;
      opt.textContent = describeFolderPath(folder, state.files);
      if (folder.id === liveFile.parentId) opt.selected = true;
      folderSelect.appendChild(opt);
    });
    const copyComments = $('#copy-comments', wrap);
    const copyResolved = $('#copy-resolved', wrap);
    copyComments.addEventListener('change', () => {
      copyResolved.disabled = !copyComments.checked || !hasResolved;
      if (copyResolved.disabled) copyResolved.checked = false;
    });
    openDialog({
      title: '复制文档',
      body: wrap,
      confirmLabel: '创建副本',
      closeOnConfirm: false,
      onConfirm: async () => {
        const name = $('#copy-name', wrap).value.trim();
        if (!name) { toast('请输入副本名称'); return; }
        const result = await API.duplicate(liveFile.id, {
          name,
          parentId: folderSelect.value || 'root',
          copyComments: copyComments.checked,
          includeResolvedComments: copyResolved.checked
        });
        closeDialog();
        toast('已创建副本');
        if (options.openAfter) openEditor(result.file.id);
        else await renderHome(ui.filterView);
      }
    });
    setTimeout(() => {
      const nameInput = $('#copy-name', wrap);
      nameInput?.focus();
      nameInput?.select();
    }, 0);
  });
}

function promptRename(file) {
  const input = document.createElement('input');
  input.type = 'text'; input.value = file.name;
  const wrap = document.createElement('div');
  wrap.appendChild(Object.assign(document.createElement('label'), { textContent: '新名称' }));
  wrap.appendChild(input);
  openDialog({
    title: '重命名',
    body: wrap,
    onConfirm: async () => {
      const name = input.value.trim(); if (!name) return;
      await API.rename(file.id, name); toast('已重命名'); await renderHome(ui.filterView);
    }
  });
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function promptMove(file) {
  fetch('/api/state').then((r) => r.json()).then((state) => {
    const folders = state.files.filter((f) => f.type === 'folder' && !f.trashed && f.id !== file.id);
    const select = document.createElement('select');
    const optionRoot = document.createElement('option');
    optionRoot.value = 'root'; optionRoot.textContent = '我的云端硬盘';
    select.appendChild(optionRoot);
    folders.forEach((folder) => {
      const opt = document.createElement('option');
      opt.value = folder.id;
      opt.textContent = describeFolderPath(folder, state.files);
      if (folder.id === file.parentId) opt.selected = true;
      select.appendChild(opt);
    });
    const wrap = document.createElement('div');
    wrap.appendChild(Object.assign(document.createElement('label'), { textContent: `将「${file.name || ''}」移动到` }));
    wrap.appendChild(select);
    openDialog({
      title: '移动到…', body: wrap,
      onConfirm: async () => { await API.move(file.id, select.value); toast('已移动'); await renderHome(ui.filterView); }
    });
  });
}

function describeFolderPath(folder, files) {
  const parts = [folder.name]; let cur = folder;
  while (cur && cur.parentId && cur.parentId !== 'root') {
    cur = files.find((f) => f.id === cur.parentId);
    if (cur) parts.unshift(cur.name);
  }
  return parts.join(' / ');
}

function promptShare(file) {
  if (!file) return;
  fetch('/api/state').then((r) => r.json()).then((state) => {
    const liveFile = state.files.find((f) => f.id === file.id) || file;
    showShareDialog(liveFile, state);
  });
}

// 受限链接的两种取值（与真实 Docs 对齐：受限 / 知道链接的任何人）
const LINK_ACCESS = [
  { id: 'restricted', label: '受限',           desc: '只有拥有访问权限的用户可以通过链接打开', icon: 'lock' },
  { id: 'anyone',     label: '知道链接的任何人', desc: '互联网上任何拥有此链接的人都可以查看',   icon: 'link' }
];
const SHARE_ROLES = [
  { id: 'viewer', label: '查看者' },
  { id: 'commenter', label: '评论者' },
  { id: 'editor', label: '编辑者' }
];

function showShareDialog(liveFile, state) {
  const people = state.people;
  liveFile.linkAccess = liveFile.linkAccess || 'restricted';
  liveFile.linkRole = liveFile.linkRole || 'viewer';
  ui.shareReturnView = ui.view;
  const owner = people.find((p) => p.id === liveFile.ownerId) || people[0];
  const pendingRecipients = [];

  const backdrop = $('#dialog-backdrop');
  backdrop.classList.add('share-modal-mode');
  backdrop.hidden = false;
  const dialog = backdrop.querySelector('.dialog');
  dialog.classList.add('share-dialog-v2');
  dialog.innerHTML = '';

  // header row
  const header = document.createElement('header');
  header.className = 'sd-header';
  header.innerHTML = `
    <h2 class="sd-title">共享"${escape(liveFile.name)}"</h2>
    <button type="button" class="icon-btn small" aria-label="详细了解共享" id="sd-help">
      <svg viewBox="0 0 24 24"><path d="M11 18h2v-2h-2zm1-16a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm0-14a3 3 0 0 0-3 3h2a1 1 0 1 1 1 1c-1.7 0-3 1.3-3 3v1h2v-1c0-.6.4-1 1-1a3 3 0 0 0 0-6z"/></svg>
    </button>
    <button type="button" class="icon-btn small" aria-label="共享设置" id="sd-settings">
      <svg viewBox="0 0 24 24"><path d="M19.4 13.5a7.8 7.8 0 0 0 .1-1.5 7.8 7.8 0 0 0-.1-1.5l2-1.5-2-3.5-2.4 1a7.2 7.2 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7.2 7.2 0 0 0 7 6L4.6 5 2.6 8.5l2 1.5A7.8 7.8 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.2 7.2 0 0 0 2.6 1.5L10 22h4l.4-2.5A7.2 7.2 0 0 0 17 18l2.4 1 2-3.5zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"/></svg>
    </button>
  `;
  dialog.appendChild(header);

  // search input row
  const inputWrap = document.createElement('div');
  inputWrap.className = 'sd-input-wrap';
  inputWrap.innerHTML = `
    <input type="text" id="sd-email-input" placeholder="添加人员、群组、聊天室和日历活动" autocomplete="off" />
    <div class="sd-suggest" id="sd-suggest" hidden></div>
  `;
  dialog.appendChild(inputWrap);

  // pending recipients chips area (shown when an existing person is picked or new email staged)
  const pendingArea = document.createElement('div');
  pendingArea.className = 'sd-pending';
  pendingArea.id = 'sd-pending';
  pendingArea.hidden = true;
  dialog.appendChild(pendingArea);

  // people with access section
  const section1 = document.createElement('section');
  section1.className = 'sd-section';
  section1.innerHTML = `<h3 class="sd-section-title">有访问权限的人</h3><div class="sd-people-list" id="sd-people"></div>`;
  dialog.appendChild(section1);

  // link access section
  const section2 = document.createElement('section');
  section2.className = 'sd-section';
  section2.innerHTML = `
    <h3 class="sd-section-title">常规访问权限</h3>
    <div class="sd-link-row" id="sd-link-row">
      <div class="sd-link-icon" id="sd-link-icon"></div>
      <div class="sd-link-info">
        <button type="button" class="sd-link-select" id="sd-link-select" aria-haspopup="true" aria-expanded="false">
          <span id="sd-link-label">受限</span>
          <svg viewBox="0 0 24 24" class="caret"><path d="M7 10l5 5 5-5z"/></svg>
        </button>
        <div class="sd-link-desc" id="sd-link-desc">只有拥有访问权限的用户可以通过链接打开</div>
      </div>
      <button type="button" class="sd-role-select sd-link-role" id="sd-link-role" aria-haspopup="true" aria-expanded="false">
        <span id="sd-link-role-label">查看者</span>
        <svg viewBox="0 0 24 24" class="caret"><path d="M7 10l5 5 5-5z"/></svg>
      </button>
    </div>
  `;
  dialog.appendChild(section2);

  // footer
  const footer = document.createElement('footer');
  footer.className = 'sd-footer';
  footer.innerHTML = `
    <button type="button" class="sd-copy-link" id="sd-copy-link">
      <svg viewBox="0 0 24 24"><path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8zm9-6h-4v1.9h4a3.1 3.1 0 1 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z"/></svg>
      <span>复制链接</span>
    </button>
    <button type="button" class="sd-done" id="sd-done">完成</button>
  `;
  dialog.appendChild(footer);

  // ---- render people list ----
  function renderPeople() {
    const list = $('#sd-people');
    list.innerHTML = '';
    list.appendChild(renderSharePerson(owner, '所有者', true));
    (liveFile.sharedWith || []).forEach((entry) => {
      const p = people.find((x) => x.id === entry.personId);
      if (p) list.appendChild(renderSharePerson(p, roleLabel(entry.role), false, entry, updateRecipientRole));
    });
  }
  renderPeople();
  syncLinkAccessUi();

  function pendingKey(item) {
    return (item.personId || item.email || '').toLowerCase();
  }

  function renderPending() {
    const area = $('#sd-pending');
    const done = $('#sd-done');
    area.hidden = pendingRecipients.length === 0;
    area.innerHTML = '';
    done.textContent = pendingRecipients.length ? '发送' : '完成';
    if (!pendingRecipients.length) return;
    pendingRecipients.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'sd-pending-row';
      const label = item.displayName || item.email;
      const email = item.email || '';
      row.innerHTML = `
        <span class="sd-ava" style="background:${escape(item.color || '#5f6368')}">${escape(item.initial || label.slice(0, 1).toUpperCase())}</span>
        <span class="sd-pending-text">
          <span class="sd-pending-name">${escape(label)}</span>
          <span class="sd-pending-email">${escape(email)}</span>
        </span>
        <button type="button" class="sd-role-select sd-pending-role" aria-haspopup="true" aria-expanded="false">
          <span>${escape(roleLabel(item.role))}</span><svg viewBox="0 0 24 24" class="caret"><path d="M7 10l5 5 5-5z"/></svg>
        </button>
        <button type="button" class="icon-btn small sd-pending-remove" aria-label="移除 ${escape(label)}">
          <svg viewBox="0 0 24 24"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/></svg>
        </button>
      `;
      const roleButton = row.querySelector('.sd-pending-role');
      roleButton.addEventListener('click', () => {
        showFloatingMenu(roleButton, SHARE_ROLES.map((role) => ({
          label: role.label,
          checked: role.id === item.role,
          onClick: () => {
            pendingRecipients[index].role = role.id;
            renderPending();
          }
        })), { side: 'left', className: 'share-role-menu' });
      });
      row.querySelector('.sd-pending-remove').addEventListener('click', () => {
        pendingRecipients.splice(index, 1);
        renderPending();
        renderSuggestions();
      });
      area.appendChild(row);
    });
  }

  function stageRecipient(item) {
    const key = pendingKey(item);
    if (!key || pendingRecipients.some((existing) => pendingKey(existing) === key)) return;
    pendingRecipients.push({ ...item, role: item.role || 'editor' });
    emailInput.value = '';
    suggest.hidden = true;
    suggest.innerHTML = '';
    renderPending();
    toast(`${item.displayName || item.email} 已添加`);
  }

  async function sendPendingRecipients() {
    if (!pendingRecipients.length) {
      closeShareDialog();
      return;
    }
    const toSend = pendingRecipients.splice(0, pendingRecipients.length);
    for (const item of toSend) {
      if (item.personId) await API.share({ fileId: liveFile.id, personId: item.personId, role: item.role });
      else await API.share({ fileId: liveFile.id, email: item.email, role: item.role });
    }
    const fresh = await (await fetch('/api/state')).json();
    const updated = fresh.files.find((f) => f.id === liveFile.id);
    if (updated) {
      liveFile.sharedWith = updated.sharedWith || [];
      liveFile.modifiedAt = updated.modifiedAt || liveFile.modifiedAt;
      liveFile.linkAccess = updated.linkAccess || liveFile.linkAccess;
      liveFile.linkRole = updated.linkRole || liveFile.linkRole;
    }
    Object.assign(state, fresh);
    people.length = 0;
    people.push(...(fresh.people || []));
    renderPending();
    renderPeople();
    renderSuggestions();
    toast('共享邀请已发送');
  }

  // ---- suggestions / input ----
  const emailInput = $('#sd-email-input');
  const suggest = $('#sd-suggest');
  function renderSuggestions() {
    const q = emailInput.value.toLowerCase().trim();
    if (!q) { suggest.hidden = true; suggest.innerHTML = ''; return; }
    suggest.hidden = false;
    suggest.innerHTML = '';
    const pendingIds = pendingRecipients.map((item) => item.personId).filter(Boolean);
    const pendingEmails = pendingRecipients.map((item) => item.email).filter(Boolean).map((email) => email.toLowerCase());
    const sharedIds = new Set((liveFile.sharedWith || []).map((e) => e.personId).concat([owner.id], pendingIds));
    const matches = people.filter((p) => !sharedIds.has(p.id) && (
      String(p.displayName || '').toLowerCase().includes(q) || String(p.email || '').toLowerCase().includes(q)
    )).slice(0, 5);
    matches.forEach((p) => {
      const item = document.createElement('button');
      item.type = 'button'; item.className = 'sd-suggest-item';
      item.innerHTML = `
        <span class="sd-ava" style="background:${escape(p.color || '#5f6368')}">${escape(p.initial || p.displayName.slice(0,1))}</span>
        <span class="sd-suggest-text">
          <div class="sd-suggest-name">${escape(p.displayName)}</div>
          <div class="sd-suggest-email">${escape(p.email)}</div>
        </span>`;
      item.addEventListener('click', () => addRecipient(p));
      suggest.appendChild(item);
    });
    if (q.includes('@') && !pendingEmails.includes(q) && !people.some((p) => String(p.email || '').toLowerCase() === q)) {
      const inv = document.createElement('button');
      inv.type = 'button'; inv.className = 'sd-suggest-item sd-suggest-new';
      inv.innerHTML = `
        <span class="sd-ava" style="background:#9aa0a6">${escape(q.slice(0,1).toUpperCase())}</span>
        <span class="sd-suggest-text">
          <div class="sd-suggest-name">将以新邮箱邀请</div>
          <div class="sd-suggest-email">${escape(q)}</div>
        </span>`;
      inv.addEventListener('click', () => addRecipientEmail(q));
      suggest.appendChild(inv);
    }
  }
  emailInput.addEventListener('input', renderSuggestions);
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && emailInput.value.trim().includes('@')) {
      e.preventDefault();
      addRecipientEmail(emailInput.value.trim());
    }
  });

  function addRecipient(person) {
    stageRecipient({
      personId: person.id,
      displayName: person.displayName,
      email: person.email,
      initial: person.initial,
      color: person.color,
      role: 'editor'
    });
  }
  function addRecipientEmail(email) {
    stageRecipient({
      email,
      displayName: email,
      initial: email.slice(0, 1).toUpperCase(),
      color: '#9aa0a6',
      role: 'editor'
    });
  }
  async function updateRecipientRole(personId, role, options = {}) {
    const result = await API.share({ fileId: liveFile.id, personId, role });
    liveFile.sharedWith = result.file.sharedWith || [];
    liveFile.modifiedAt = result.file.modifiedAt || liveFile.modifiedAt;
    renderPeople();
    if (!options.quiet) toast(`权限已更新为${roleLabel(role)}`);
  }

  // ---- link access ----
  function syncLinkAccessUi() {
    const cur = LINK_ACCESS.find((x) => x.id === (liveFile.linkAccess || 'restricted')) || LINK_ACCESS[0];
    const role = SHARE_ROLES.find((x) => x.id === (liveFile.linkRole || 'viewer')) || SHARE_ROLES[0];
    $('#sd-link-label').textContent = cur.label;
    $('#sd-link-desc').textContent = cur.desc;
    $('#sd-link-role-label').textContent = role.label;
    $('#sd-link-role').hidden = cur.id === 'restricted';
    const icon = $('#sd-link-icon');
    icon.classList.toggle('locked', cur.icon === 'lock');
    icon.innerHTML = cur.icon === 'lock'
      ? '<svg viewBox="0 0 24 24"><path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 1 1 6.2 0z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M11.99 2A10 10 0 0 0 2 12a10 10 0 0 0 19.99 0A10 10 0 0 0 11.99 2zm6.92 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04A14.04 14.04 0 0 1 13.91 8h-3.82A14.04 14.04 0 0 1 12 4.04zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38a16.51 16.51 0 0 0 0 4zm.82 2h2.95a15.65 15.65 0 0 0 1.38 3.56A7.99 7.99 0 0 1 5.08 16zm2.95-8H5.08a7.99 7.99 0 0 1 4.31-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96A14.04 14.04 0 0 1 10.09 16h3.82A14.04 14.04 0 0 1 12 19.96zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.25 5.56A15.65 15.65 0 0 0 15.96 16h2.95a8.03 8.03 0 0 1-4.31 3.56zM16.36 14a16.51 16.51 0 0 0 0-4h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2z"/></svg>';
  }
  $('#sd-link-select').addEventListener('click', (event) => {
    showFloatingMenu(event.currentTarget, LINK_ACCESS.map((o) => ({
      label: o.label,
      onClick: async () => {
        liveFile.linkAccess = o.id;
        const result = await API.share({ fileId: liveFile.id, linkAccess: o.id, linkRole: liveFile.linkRole || 'viewer' });
        liveFile.linkAccess = result.file.linkAccess || o.id;
        liveFile.linkRole = result.file.linkRole || liveFile.linkRole || 'viewer';
        syncLinkAccessUi();
      }
    })), { side: 'right', className: 'share-link-access-menu' });
  });
  $('#sd-link-role').addEventListener('click', (event) => {
    showFloatingMenu(event.currentTarget, SHARE_ROLES.map((role) => ({
      label: role.label,
      checked: role.id === (liveFile.linkRole || 'viewer'),
      onClick: async () => {
        liveFile.linkRole = role.id;
        const result = await API.share({ fileId: liveFile.id, linkAccess: liveFile.linkAccess || 'anyone', linkRole: role.id });
        liveFile.linkAccess = result.file.linkAccess || liveFile.linkAccess || 'anyone';
        liveFile.linkRole = result.file.linkRole || role.id;
        syncLinkAccessUi();
        toast(`链接权限已更新为${role.label}`);
      }
    })), { side: 'left', className: 'share-role-menu' });
  });

  $('#sd-help').addEventListener('click', () => toast('共享帮助（mock）'));
  $('#sd-settings').addEventListener('click', () => toast('共享设置（mock）'));
  $('#sd-copy-link').addEventListener('click', () => {
    const url = `http://127.0.0.1:3081/d/${liveFile.id}`;
    if (navigator.clipboard) navigator.clipboard.writeText(url);
    toast('链接已复制到剪贴板');
  });
  $('#sd-done').addEventListener('click', () => sendPendingRecipients());

  setTimeout(() => emailInput.focus(), 0);
}

function closeShareDialog() {
  const backdrop = $('#dialog-backdrop');
  backdrop.classList.remove('share-modal-mode');
  backdrop.hidden = true;
  // restore default dialog markup for other openDialog calls
  const dialog = backdrop.querySelector('.dialog');
  dialog.classList.remove('share-dialog-v2');
  dialog.innerHTML = `
    <header><h3 id="dialog-title">操作</h3></header>
    <div class="dialog-body" id="dialog-body"></div>
    <footer>
      <button type="button" id="dialog-cancel">取消</button>
      <button type="button" id="dialog-confirm" class="primary">确定</button>
    </footer>
  `;
  if (ui.shareReturnView === 'editor') {
    ui.shareReturnView = null;
    return;
  }
  ui.shareReturnView = null;
  renderHome(ui.filterView);
}

function roleLabel(role) { return { editor: '编辑者', commenter: '评论者', viewer: '查看者' }[role] || role; }

function renderSharePerson(person, roleText, isMe, entry, onRoleChange) {
  const row = document.createElement('div');
  row.className = 'sd-person-row';
  row.innerHTML = `
    <span class="sd-ava" style="background:${escape(person.color || '#5f6368')}">${escape(person.initial || person.displayName.slice(0,1))}</span>
    <div class="sd-person-text">
      <div class="sd-person-name">${escape(person.displayName)}${isMe ? ' <span class="you">(you)</span>' : ''}</div>
      <div class="sd-person-email">${escape(person.email || '')}</div>
    </div>
  `;
  if (isMe) {
    const role = document.createElement('span');
    role.className = 'sd-person-role';
    role.textContent = roleText;
    row.appendChild(role);
  } else {
    const role = document.createElement('button');
    role.type = 'button';
    role.className = 'sd-role-select sd-person-role-select';
    role.setAttribute('aria-haspopup', 'true');
    role.setAttribute('aria-expanded', 'false');
    role.innerHTML = `<span>${escape(roleText)}</span><svg viewBox="0 0 24 24" class="caret"><path d="M7 10l5 5 5-5z"/></svg>`;
    role.addEventListener('click', (event) => {
      event.stopPropagation();
      showFloatingMenu(role, SHARE_ROLES.map((opt) => ({
        label: opt.label,
        checked: opt.id === (entry?.role || 'editor'),
        onClick: () => onRoleChange?.(entry.personId, opt.id)
      })), { side: 'left', className: 'share-role-menu' });
    });
    row.appendChild(role);
  }
  return row;
}

function textBlocksForFindReplace() {
  return $$('.pb', $('#paper-content')).filter((block) => !['image', 'table', 'banner'].includes(block.dataset.type));
}

function clearFindReplaceHighlights() {
  $$('.find-match', $('#paper-content')).forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
  });
  $$('.find-active-block', $('#paper-content')).forEach((block) => block.classList.remove('find-active-block'));
}

function collectFindReplaceMatches(query, matchCase) {
  if (!query) return [];
  const needle = matchCase ? query : query.toLocaleLowerCase('zh-CN');
  const matches = [];
  textBlocksForFindReplace().forEach((block) => {
    const text = block.textContent || '';
    const haystack = matchCase ? text : text.toLocaleLowerCase('zh-CN');
    let start = 0;
    while (start <= haystack.length) {
      const idx = haystack.indexOf(needle, start);
      if (idx < 0) break;
      matches.push({ blockId: block.dataset.id, start: idx, end: idx + query.length });
      start = idx + Math.max(needle.length, 1);
    }
  });
  return matches;
}

function renderFindReplaceHighlights(state = ui.findReplace) {
  clearFindReplaceHighlights();
  if (!state?.query) return;
  state.matches = collectFindReplaceMatches(state.query, state.matchCase);
  if (state.activeIndex >= state.matches.length) state.activeIndex = Math.max(0, state.matches.length - 1);
  if (state.activeIndex < 0) state.activeIndex = 0;
  const byBlock = new Map();
  state.matches.forEach((match, idx) => {
    if (!byBlock.has(match.blockId)) byBlock.set(match.blockId, []);
    byBlock.get(match.blockId).push({ ...match, idx });
  });
  textBlocksForFindReplace().forEach((block) => {
    const text = block.textContent || '';
    const parts = byBlock.get(block.dataset.id);
    if (!parts?.length) {
      block.textContent = text;
      return;
    }
    const frag = document.createDocumentFragment();
    let cursor = 0;
    parts.forEach((match) => {
      if (match.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, match.start)));
      const mark = document.createElement('mark');
      mark.className = 'find-match' + (match.idx === state.activeIndex ? ' active' : '');
      mark.textContent = text.slice(match.start, match.end);
      frag.appendChild(mark);
      cursor = match.end;
      if (match.idx === state.activeIndex) block.classList.add('find-active-block');
    });
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    block.replaceChildren(frag);
  });
}

function updateFindReplaceStatus() {
  const state = ui.findReplace;
  const status = $('#fr-status');
  if (!status || !state) return;
  const count = state.matches?.length || 0;
  status.textContent = state.query ? (count ? `${Math.min(state.activeIndex + 1, count)} / ${count}` : '没有结果') : '';
  $$('.fr-requires-match').forEach((button) => { button.disabled = !count; });
  $('#dialog-confirm').disabled = !state.query || !count;
}

function refreshFindReplace() {
  const state = ui.findReplace;
  if (!state) return;
  renderFindReplaceHighlights(state);
  updateFindReplaceStatus();
  const active = $('.find-match.active', $('#paper-content'));
  active?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function moveFindReplace(delta) {
  const state = ui.findReplace;
  if (!state?.matches?.length) return;
  state.activeIndex = (state.activeIndex + delta + state.matches.length) % state.matches.length;
  refreshFindReplace();
}

async function saveFindReplaceEditor() {
  if (!ui.activeDocId) return;
  const snap = snapshotEditor();
  const result = await API.editDocument({ fileId: ui.activeDocId, title: snap.title, blocks: snap.blocks });
  ui.activeDoc = result.document;
  $('#editor-title').value = result.document.content.title || result.document.name;
  renderEditorContent();
  renderOutline();
  renderPaperSuggestions();
  setSaved(true);
}

async function replaceCurrentFindMatch() {
  const state = ui.findReplace;
  const match = state?.matches?.[state.activeIndex];
  if (!match) return;
  const block = $(`.pb[data-id="${cssEscape(match.blockId)}"]`, $('#paper-content'));
  if (!block) return;
  const text = block.textContent || '';
  block.textContent = `${text.slice(0, match.start)}${state.replace}${text.slice(match.end)}`;
  clearFindReplaceHighlights();
  await saveFindReplaceEditor();
  state.activeIndex = Math.min(state.activeIndex, collectFindReplaceMatches(state.query, state.matchCase).length - 1);
  refreshFindReplace();
  toast('已替换');
}

async function replaceAllFindMatches() {
  const state = ui.findReplace;
  if (!state?.query || !ui.activeDocId) return;
  clearFindReplaceHighlights();
  const needle = state.matchCase ? state.query : state.query.toLocaleLowerCase('zh-CN');
  let replacementCount = 0;
  textBlocksForFindReplace().forEach((block) => {
    const text = block.textContent || '';
    const haystack = state.matchCase ? text : text.toLocaleLowerCase('zh-CN');
    let cursor = 0;
    let searchFrom = 0;
    let nextText = '';
    let changed = false;
    while (searchFrom <= haystack.length) {
      const idx = haystack.indexOf(needle, searchFrom);
      if (idx < 0) break;
      changed = true;
      replacementCount += 1;
      nextText += text.slice(cursor, idx) + state.replace;
      cursor = idx + state.query.length;
      searchFrom = idx + Math.max(needle.length, 1);
    }
    if (changed) {
      block.textContent = nextText + text.slice(cursor);
    }
  });
  if (!replacementCount) {
    refreshFindReplace();
    toast('没有结果');
    return;
  }
  await saveFindReplaceEditor();
  try {
    await API.logUiEvent({
      type: 'find_replace_replace_all',
      fileId: ui.activeDocId,
      query: state.query,
      replaceText: state.replace,
      matchCase: state.matchCase,
      replacementCount
    });
  } catch (e) {
    console.warn('Unable to log UI event find_replace_replace_all', e);
  }
  state.activeIndex = 0;
  refreshFindReplace();
  toast(`已替换 ${replacementCount} 处`);
}

function promptFindReplace() {
  if (!ui.activeDocId) { toast('请先打开一个文档'); return; }
  const wrap = document.createElement('div');
  wrap.className = 'find-replace-dialog';
  wrap.innerHTML = `
    <label for="fr-find">查找</label>
    <div class="fr-input-row">
      <input id="fr-find" type="text" autocomplete="off">
      <span id="fr-status" class="fr-status" aria-live="polite"></span>
    </div>
    <label for="fr-replace">替换为</label>
    <input id="fr-replace" type="text" autocomplete="off">
    <label class="fr-check"><input id="fr-match-case" type="checkbox"> <span>区分大小写</span></label>
    <div class="fr-actions">
      <button type="button" class="fr-requires-match" id="fr-prev">上一项</button>
      <button type="button" class="fr-requires-match" id="fr-next">下一项</button>
      <button type="button" class="fr-requires-match" id="fr-replace-one">替换</button>
    </div>
  `;
  openDialog({
    title: '查找和替换',
    body: wrap,
    confirmLabel: '全部替换',
    cancelLabel: '完成',
    closeOnConfirm: false,
    onConfirm: replaceAllFindMatches
  });
  ui.findReplace = { query: '', replace: '', matchCase: false, matches: [], activeIndex: 0 };
  logUiEvent('find_replace_opened');
  const find = $('#fr-find');
  const replace = $('#fr-replace');
  const matchCase = $('#fr-match-case');
  const sync = () => {
    ui.findReplace.query = find.value;
    ui.findReplace.replace = replace.value;
    ui.findReplace.matchCase = matchCase.checked;
    ui.findReplace.activeIndex = 0;
    refreshFindReplace();
  };
  find.addEventListener('input', sync);
  replace.addEventListener('input', () => { ui.findReplace.replace = replace.value; });
  matchCase.addEventListener('change', sync);
  $('#fr-prev').addEventListener('click', () => moveFindReplace(-1));
  $('#fr-next').addEventListener('click', () => moveFindReplace(1));
  $('#fr-replace-one').addEventListener('click', () => replaceCurrentFindMatch());
  updateFindReplaceStatus();
  setTimeout(() => find.focus(), 0);
}

// ============================ utils ============================
function escape(text) {
  if (text == null) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}
function relTime(iso, prefix = '') {
  if (!iso) return '';
  const date = new Date(iso); const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const stamp = sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN');
  if (prefix) return `${prefix}${sameDay ? '' : ''} ${stamp}`.trim();
  return sameDay ? `今天 ${stamp}` : stamp;
}
