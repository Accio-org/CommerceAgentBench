const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
// makeMessage + now come from ./db so the message default shape stays a single
// source of truth shared with the SQLite seed loader.
const { makeMessage, now } = db;

const PORT = Number(process.env.PORT || 3071);
const PUBLIC_DIR = path.join(__dirname, 'public');
const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN || 'bench-verifier';
const GMAIL_MOCK_MODE = String(process.env.GMAIL_MOCK_MODE || 'ui').toLowerCase();
const UI_TOKEN = crypto.randomBytes(24).toString('base64url');
const BROWSER_COOKIE = 'gmail_mock_browser_nonce';
const browserNonces = new Set();
const NON_BROWSER_UA = /(curl|wget|python-requests|python-urllib|httpx|aiohttp|node-fetch|undici|axios|go-http-client|java|ruby|php|libwww|okhttp|postmanruntime)/i;
const BROWSER_UA = /(Mozilla|Chrome|Chromium|Safari|Firefox|Edg|OPR)/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// SQLite connection + in-memory working copy hydrated from it. The server
// mutates `state` with its existing logic and persist() writes the whole state
// back to the DB after each mutation (see the request handler below).
const dbConn = db.getDb();
let state = db.loadState(dbConn);
let currentRequestSource = 'system';

function persist() {
  db.persistState(dbConn, state);
}

function pushEvent(type, details = {}) {
  const entry = { ts: now(), type, source: currentRequestSource, ...details };
  // DB-only audit log: written straight to SQLite (append-only via rowid) and
  // never retained in the in-memory state. Full retention in the DB, O(1)
  // memory. Read it via verifier-only GET /api/events. NOTE: this audit log is a
  // mock/bench-internal trail — it is NOT part of the upstream Google Workspace
  // extension's MCP surface, so it intentionally never appears in tool results.
  db.appendEvent(dbConn, entry);
  return entry;
}

function requestSource(req, url) {
  if (url.pathname === '/mcp' || url.pathname.startsWith('/api/mcp/') || url.pathname.startsWith('/api/workspace/')) {
    return 'workspace';
  }
  if (String(req.headers['x-gmail-mock-ui'] || '') === '1') return 'ui';
  if (url.pathname.startsWith('/api/')) return 'api';
  return 'browser';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function hasVerifierToken(req) {
  return Boolean(VERIFIER_TOKEN) && String(req.headers['x-mock-verifier-token'] || '') === VERIFIER_TOKEN;
}

function mcpEnabled() {
  return GMAIL_MOCK_MODE === 'mcp' || GMAIL_MOCK_MODE === 'workspace' || process.env.GMAIL_MOCK_ENABLE_MCP === '1';
}

function cookieValue(req, name) {
  const header = req.headers.cookie || '';
  for (const item of header.split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}

function getBrowserNonce(req) {
  return cookieValue(req, BROWSER_COOKIE);
}

function hasValidBrowserNonce(req) {
  const nonce = getBrowserNonce(req);
  return Boolean(nonce && browserNonces.has(nonce));
}

function mintBrowserNonce(req, res) {
  let nonce = getBrowserNonce(req);
  if (!nonce || !browserNonces.has(nonce)) {
    nonce = crypto.randomBytes(24).toString('base64url');
    browserNonces.add(nonce);
  }
  res.setHeader('Set-Cookie', `${BROWSER_COOKIE}=${encodeURIComponent(nonce)}; Path=/; HttpOnly; SameSite=Lax`);
}

function classifyBrowserClient(req, { requireDocument = false } = {}) {
  const ua = req.headers['user-agent'] || '';
  const accept = req.headers.accept || '';
  if (NON_BROWSER_UA.test(ua)) return 'non-browser user-agent';
  if (!BROWSER_UA.test(ua)) return 'missing browser user-agent';
  if (requireDocument && !String(accept).includes('text/html')) return 'non-browser navigation headers';
  return '';
}

function denyPlain(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function denyNonBrowser(req, res, reason) {
  pushEvent('browser_required', { reason, method: req.method, path: req.url });
  return denyPlain(res, 403, 'Access denied: open the Gmail mock in a browser for UI-mode tasks.\n');
}

function denyMcp(req, res, surface) {
  pushEvent('mcp_blocked', { surface, method: req.method, path: req.url });
  return sendJson(res, 403, { error: 'mcp_disabled', message: 'MCP/Workspace surface is disabled for this Gmail UI task.' });
}

function hasUiToken(req) {
  return String(req.headers['x-gmail-mock-ui'] || '') === '1' && String(req.headers['x-ui-token'] || '') === UI_TOKEN;
}

function requireUiWrite(req, res) {
  if (hasVerifierToken(req)) return true;
  if (!hasValidBrowserNonce(req)) {
    pushEvent('browser_session_required', { method: req.method, path: req.url });
    sendJson(res, 403, { error: 'browser_session_required', message: 'Open the Gmail mock page in a browser first.' });
    return false;
  }
  if (!hasUiToken(req)) {
    pushEvent('ui_token_required', { method: req.method, path: req.url });
    sendJson(res, 403, { error: 'ui_token_required', message: 'Use the Gmail browser UI for this endpoint.' });
    return false;
  }
  return true;
}

function requireVerifierToken(req, res) {
  if (hasVerifierToken(req)) return true;
  pushEvent('verifier_endpoint_denied', { path: req.url });
  sendJson(res, 403, { error: 'verifier_token_required' });
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png'
  }[ext] || 'application/octet-stream';
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    res.writeHead(200, {
      'content-type': contentType(filePath),
      'cache-control': 'no-store'
    });
    res.end(data);
  });
}

function selectedMessages() {
  return state.messages.filter((message) => message.selected);
}

function uniqueLabels(labels) {
  return [...new Set(labels.filter(Boolean))];
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function removeLabels(message, labels) {
  const blocked = new Set(labels);
  message.labels = message.labels.filter((label) => !blocked.has(label));
}

function addLabel(message, label) {
  message.labels = uniqueLabels([...message.labels, label]);
}

function labelIdFromName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const aliases = {
    inbox: 'inbox',
    sent: 'sent',
    drafts: 'drafts',
    draft: 'drafts',
    trash: 'trash',
    spam: 'spam',
    unread: 'unread',
    starred: 'starred',
    important: 'important',
    scheduled: 'scheduled',
    snoozed: 'snoozed',
    all: 'all'
  };
  if (aliases[lower]) return aliases[lower];
  const label = state.labels.find((item) => (
    item.id.toLowerCase() === lower || item.name.toLowerCase() === lower
  ));
  return label?.id || raw;
}

function workspaceLabelId(label) {
  const map = {
    inbox: 'INBOX',
    sent: 'SENT',
    drafts: 'DRAFT',
    trash: 'TRASH',
    spam: 'SPAM',
    unread: 'UNREAD',
    starred: 'STARRED',
    important: 'IMPORTANT',
    scheduled: 'SCHEDULED',
    snoozed: 'SNOOZED',
    all: 'ALL'
  };
  return map[label] || label;
}

function isInAllMail(message) {
  return !message.labels.includes('trash') && !message.labels.includes('spam');
}

function actualUnreadForLabel(labelId) {
  if (labelId === 'starred') return state.messages.filter((message) => message.starred && message.unread).length;
  if (labelId === 'important') return state.messages.filter((message) => message.important && message.unread).length;
  if (labelId === 'all') return state.messages.filter((message) => message.unread && isInAllMail(message)).length;
  if (labelId === 'drafts') return state.drafts.length;
  if (labelId === 'scheduled') return state.messages.filter((message) => message.labels.includes('scheduled')).length;
  return state.messages.filter((message) => message.labels.includes(labelId) && message.unread).length;
}

function recomputeCounts() {
  const labelOffsets = state.counterOffsets?.labels || {};
  state.labels.forEach((label) => {
    if (label.id === 'drafts') {
      label.unread = state.drafts.length;
      return;
    }
    label.unread = actualUnreadForLabel(label.id) + (labelOffsets[label.id] || 0);
  });

  const categoryOffsets = state.counterOffsets?.categories || {};
  state.categories.forEach((category) => {
    const actual = state.messages.filter((message) => (
      message.labels.includes('inbox') && message.category === category.id && message.unread
    )).length;
    category.unread = actual + (categoryOffsets[category.id] || 0);
  });
}

function actionMessageIds(ids = []) {
  return new Set(ids.length ? ids : selectedMessages().map((message) => message.id));
}

function applyMessageAction(action, ids = [], options = {}) {
  const selectedIds = actionMessageIds(ids);
  const affected = [];

  if (action === 'delete_forever') {
    const before = state.messages.length;
    state.messages = state.messages.filter((message) => !selectedIds.has(message.id));
    pushEvent('message_action', { action, ids: [...selectedIds], deleted: before - state.messages.length });
    recomputeCounts();
    return;
  }
  if (action === 'empty_trash') {
    const before = state.messages.length;
    state.messages = state.messages.filter((message) => !message.labels.includes('trash'));
    pushEvent('message_action', { action, deleted: before - state.messages.length });
    recomputeCounts();
    return;
  }
  if (action === 'empty_spam') {
    const before = state.messages.length;
    state.messages = state.messages.filter((message) => !message.labels.includes('spam'));
    pushEvent('message_action', { action, deleted: before - state.messages.length });
    recomputeCounts();
    return;
  }

  state.messages.forEach((message) => {
    if (!selectedIds.has(message.id)) return;
    affected.push(message.id);
    if (action === 'archive') removeLabels(message, ['inbox']);
    if (action === 'delete') message.labels = uniqueLabels([...message.labels.filter((label) => !['inbox', 'spam'].includes(label)), 'trash']);
    if (action === 'spam') message.labels = uniqueLabels([...message.labels.filter((label) => !['inbox', 'trash'].includes(label)), 'spam']);
    if (action === 'not_spam') {
      removeLabels(message, ['spam']);
      addLabel(message, 'inbox');
    }
    if (action === 'restore') {
      removeLabels(message, ['trash', 'spam']);
      addLabel(message, 'inbox');
    }
    if (action === 'snooze') {
      removeLabels(message, ['inbox']);
      addLabel(message, 'snoozed');
      message.snoozedUntil = options.until || '明天 08:00';
    }
    if (action === 'unsnooze') {
      removeLabels(message, ['snoozed']);
      addLabel(message, 'inbox');
      delete message.snoozedUntil;
    }
    if (action === 'move') {
      const targetLabel = String(options.targetLabel || 'inbox');
      if (targetLabel === 'trash') {
        message.labels = uniqueLabels([...message.labels.filter((label) => !['inbox', 'spam', 'snoozed'].includes(label)), 'trash']);
      } else if (targetLabel === 'spam') {
        message.labels = uniqueLabels([...message.labels.filter((label) => !['inbox', 'trash', 'snoozed'].includes(label)), 'spam']);
      } else {
        removeLabels(message, ['trash', 'spam', 'snoozed']);
        if (targetLabel === 'inbox') {
          addLabel(message, 'inbox');
          message.category = 'primary';
        } else {
          removeLabels(message, ['inbox']);
          addLabel(message, targetLabel);
        }
      }
    }
    if (action === 'label') addLabel(message, String(options.labelId || 'purchases'));
    if (action === 'remove_label') removeLabels(message, [String(options.labelId || '')]);
    if (action === 'category') message.category = String(options.category || 'primary');
    if (action === 'read') message.unread = false;
    if (action === 'unread') message.unread = true;
    if (action === 'star') message.starred = !message.starred;
    if (action === 'important') message.important = !message.important;
    if (action === 'mute') {
      message.muted = true;
      removeLabels(message, ['inbox']);
    }
    message.selected = false;
  });
  recomputeCounts();
  pushEvent('message_action', { action, ids: affected, ...options });
}

function saveDraft(payload) {
  const draft = {
    id: payload.id || id('draft'),
    to: String(payload.to || '').trim(),
    cc: String(payload.cc || '').trim(),
    bcc: String(payload.bcc || '').trim(),
    subject: String(payload.subject || '').trim(),
    body: String(payload.body || '').trim(),
    updatedAt: now()
  };
  const existing = state.drafts.findIndex((item) => item.id === draft.id);
  if (existing >= 0) state.drafts[existing] = draft;
  else state.drafts.push(draft);
  recomputeCounts();
  pushEvent('draft_saved', { id: draft.id, hasContent: !!(draft.to || draft.subject || draft.body) });
  return draft;
}

function sendMessage(payload) {
  const sent = makeMessage(`sent-${Date.now().toString(36)}`, {
    labels: ['sent'],
    from: state.account.email,
    fromEmail: state.account.email,
    to: String(payload.to || '').trim(),
    cc: String(payload.cc || '').trim(),
    bcc: String(payload.bcc || '').trim(),
    subject: String(payload.subject || '').trim() || '(无主题)',
    snippet: String(payload.body || '').trim().slice(0, 140),
    body: String(payload.body || '').trim(),
    date: '刚刚',
    fullDate: new Date().toLocaleString('zh-CN')
  });
  state.messages.unshift(sent);
  state.drafts = state.drafts.filter((draft) => draft.id !== payload.id);
  recomputeCounts();
  pushEvent('message_sent', { id: sent.id, to: sent.to, subject: sent.subject });
  return sent;
}

function scheduleMessage(payload) {
  const scheduled = makeMessage(id('scheduled'), {
    category: 'primary',
    labels: ['scheduled'],
    from: state.account.email,
    fromEmail: state.account.email,
    to: String(payload.to || '').trim(),
    cc: String(payload.cc || '').trim(),
    bcc: String(payload.bcc || '').trim(),
    subject: String(payload.subject || '').trim() || '(无主题)',
    snippet: String(payload.body || '').trim().slice(0, 140) || '定时发送的邮件',
    body: String(payload.body || '').trim(),
    date: String(payload.scheduledLabel || payload.scheduledAt || '已安排'),
    fullDate: String(payload.scheduledAt || new Date().toLocaleString('zh-CN')),
    scheduledAt: String(payload.scheduledAt || ''),
    unread: false
  });
  state.messages.unshift(scheduled);
  state.drafts = state.drafts.filter((draft) => draft.id !== payload.id);
  recomputeCounts();
  pushEvent('message_scheduled', {
    id: scheduled.id,
    to: scheduled.to,
    subject: scheduled.subject,
    scheduledAt: scheduled.scheduledAt,
    scheduledLabel: scheduled.date
  });
  return scheduled;
}

function deleteDraft(id) {
  const before = state.drafts.length;
  state.drafts = state.drafts.filter((draft) => draft.id !== id);
  recomputeCounts();
  pushEvent('draft_deleted', { id, deleted: state.drafts.length !== before });
}

function createLabel(payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Label name is required');
  const requestedParentId = String(payload.parentId || '').trim();
  const parent = requestedParentId ? state.labels.find((label) => label.id === requestedParentId && label.type === 'user') : null;
  const label = {
    id: `custom-${state.nextLabelId++}`,
    name,
    unread: 0,
    icon: 'tag',
    type: 'user',
    color: payload.color || '#5f6368',
    ...(parent ? { parentId: parent.id } : {})
  };
  state.labels.push(label);
  pushEvent('label_created', { id: label.id, name: label.name, parentId: label.parentId || '' });
  return label;
}

function saveFilter(payload) {
  const filter = {
    id: payload.id || `filter-${Date.now().toString(36)}`,
    from: String(payload.from || '').trim(),
    to: String(payload.to || '').trim(),
    subject: String(payload.subject || '').trim(),
    hasWords: String(payload.hasWords || '').trim(),
    doesntHave: String(payload.doesntHave || '').trim(),
    hasAttachment: !!payload.hasAttachment,
    actions: payload.actions || {},
    updatedAt: now()
  };
  const idx = state.filters.findIndex((item) => item.id === filter.id);
  if (idx >= 0) state.filters[idx] = filter;
  else state.filters.push(filter);
  pushEvent('filter_saved', { id: filter.id, from: filter.from, subject: filter.subject });
  return filter;
}

function unsubscribeSender(payload) {
  const email = String(payload.email || '').trim().toLowerCase();
  const subscription = state.subscriptions?.find((item) => item.email.toLowerCase() === email);
  if (!subscription) throw new Error('Subscription not found');
  subscription.unsubscribed = true;
  subscription.status = '退订请求已记录';
  subscription.updatedAt = now();
  pushEvent('subscription_unsubscribed', { email: subscription.email, name: subscription.name });
  return subscription;
}

function createTask(payload) {
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('Task title is required');
  const task = {
    id: id('task'),
    title,
    details: String(payload.details || '').trim(),
    due: String(payload.due || '').trim(),
    sourceMessageId: String(payload.sourceMessageId || '').trim(),
    completed: false,
    createdAt: now(),
    updatedAt: now()
  };
  state.tasks = state.tasks || [];
  state.tasks.unshift(task);
  pushEvent('task_created', { id: task.id, title: task.title, due: task.due });
  return task;
}

function updateTask(payload) {
  state.tasks = state.tasks || [];
  const task = state.tasks.find((item) => item.id === payload.id);
  if (!task) throw new Error('Task not found');
  if ('completed' in payload) task.completed = !!payload.completed;
  if ('title' in payload) task.title = String(payload.title || '').trim() || task.title;
  if ('details' in payload) task.details = String(payload.details || '').trim();
  if ('due' in payload) task.due = String(payload.due || '').trim();
  task.updatedAt = now();
  pushEvent('task_updated', { id: task.id, completed: task.completed });
  return task;
}

function createCalendarEvent(payload) {
  const title = String(payload.title || '').trim() || '无标题';
  const event = {
    id: id('cal'),
    title,
    date: String(payload.date || '').trim(),
    start: String(payload.start || '').trim(),
    end: String(payload.end || '').trim(),
    guests: String(payload.guests || '').trim(),
    location: String(payload.location || '').trim(),
    description: String(payload.description || '').trim(),
    meet: !!payload.meet,
    allDay: !!payload.allDay,
    color: payload.color || '#1a73e8',
    createdAt: now()
  };
  state.calendarEvents = state.calendarEvents || [];
  state.calendarEvents.push(event);
  pushEvent('calendar_event_created', { id: event.id, title: event.title, date: event.date, start: event.start });
  return event;
}

function createNote(payload) {
  const title = String(payload.title || '').trim();
  const body = String(payload.body || '').trim();
  if (!title && !body) throw new Error('Note content is required');
  const note = {
    id: id('note'),
    title,
    body,
    pinned: !!payload.pinned,
    createdAt: now(),
    updatedAt: now()
  };
  state.notes = state.notes || [];
  state.notes.unshift(note);
  pushEvent('note_created', { id: note.id, title: note.title });
  return note;
}

function createContact(payload) {
  const email = String(payload.email || '').trim();
  if (!email) throw new Error('Contact email is required');
  const name = String(payload.name || '').trim() || email.split('@')[0];
  state.contacts = state.contacts || [];
  const existing = state.contacts.find((item) => item.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    existing.name = name;
    existing.phone = String(payload.phone || existing.phone || '').trim();
    existing.notes = String(payload.notes || existing.notes || '').trim();
    existing.updatedAt = now();
    pushEvent('contact_updated', { id: existing.id, email: existing.email });
    return existing;
  }
  const contact = {
    id: id('contact'),
    name,
    email,
    phone: String(payload.phone || '').trim(),
    notes: String(payload.notes || '').trim(),
    source: payload.source || 'manual',
    color: payload.color || '#1a73e8',
    createdAt: now(),
    updatedAt: now()
  };
  state.contacts.push(contact);
  pushEvent('contact_created', { id: contact.id, email: contact.email, name: contact.name });
  return contact;
}

function normalizeMessageForWorkspace(message, includeBody = false) {
  const labels = uniqueLabels([
    ...message.labels,
    message.unread ? 'unread' : '',
    message.starred ? 'starred' : '',
    message.important ? 'important' : ''
  ]).filter(Boolean).map(workspaceLabelId);
  return {
    id: message.id,
    threadId: message.threadId || message.id,
    labelIds: labels,
    snippet: message.snippet,
    subject: message.subject,
    from: `${message.from} <${message.fromEmail || message.from}>`,
    to: message.to,
    date: message.fullDate || message.date,
    ...(includeBody ? { body: message.body || message.snippet || '' } : {})
  };
}

function workspaceAttachmentObjects(message) {
  return (message.attachments || []).map((filename, index) => ({
    filename,
    mimeType: filename.endsWith('.csv') ? 'text/csv' : 'application/octet-stream',
    attachmentId: filename,
    size: 1024 + index
  }));
}

function toolContent(payload, pretty = true) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, pretty ? 2 : 0)
      }
    ]
  };
}

function toolError(message, details) {
  return toolContent(details ? { error: message, details } : { error: message }, false);
}

function normalizeDraftForWorkspace(draft) {
  return {
    id: draft.id,
    message: {
      id: draft.id,
      threadId: draft.threadId || draft.id,
      labelIds: ['DRAFT'],
      to: draft.to,
      cc: draft.cc || '',
      bcc: draft.bcc || '',
      subject: draft.subject || '(无主题)',
      body: draft.body || ''
    },
    updatedAt: draft.updatedAt
  };
}

function matchesGmailQuery(message, query) {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  return terms.every((term) => {
    if (term.startsWith('from:')) return String(message.fromEmail || message.from).toLowerCase().includes(term.slice(5));
    if (term.startsWith('to:')) return String(message.to || '').toLowerCase().includes(term.slice(3));
    if (term.startsWith('subject:')) return String(message.subject || '').toLowerCase().includes(term.slice(8));
    if (term === 'is:unread') return !!message.unread;
    if (term === 'is:read') return !message.unread;
    if (term === 'is:starred') return !!message.starred;
    if (term === 'is:important') return !!message.important;
    if (term === 'has:attachment' || term === 'has:attachments') return !!message.hasAttachment;
    if (term.startsWith('label:')) return message.labels.includes(labelIdFromName(term.slice(6)));
    if (term.startsWith('in:')) {
      const label = labelIdFromName(term.slice(3));
      if (label === 'all') return isInAllMail(message);
      return message.labels.includes(label);
    }
    const haystack = `${message.from} ${message.fromEmail || ''} ${message.to || ''} ${message.subject} ${message.snippet} ${message.body || ''}`.toLowerCase();
    return haystack.includes(term);
  });
}

function workspaceToolSchemas() {
  return [
    { name: 'gmail.search', description: 'Search for emails in Gmail using query parameters.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' }, pageToken: { type: 'string' }, labelIds: { type: 'array', items: { type: 'string' } }, includeSpamTrash: { type: 'boolean' } } } },
    { name: 'gmail.get', description: 'Get the full content of a specific email message.', inputSchema: { type: 'object', properties: { messageId: { type: 'string' }, format: { type: 'string', enum: ['minimal', 'full', 'raw', 'metadata'] } }, required: ['messageId'] } },
    { name: 'gmail.downloadAttachment', description: 'Downloads an attachment from a Gmail message to a local file.', inputSchema: { type: 'object', properties: { messageId: { type: 'string' }, attachmentId: { type: 'string' }, localPath: { type: 'string' } }, required: ['messageId', 'attachmentId', 'localPath'] } },
    { name: 'gmail.modify', description: 'Modify a Gmail message.', inputSchema: { type: 'object', properties: { messageId: { type: 'string' }, addLabelIds: { type: 'array', items: { type: 'string' }, maxItems: 100 }, removeLabelIds: { type: 'array', items: { type: 'string' }, maxItems: 100 } }, required: ['messageId'] } },
    { name: 'gmail.batchModify', description: 'Bulk modify up to 1,000 Gmail messages at once.', inputSchema: { type: 'object', properties: { messageIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1000 }, addLabelIds: { type: 'array', items: { type: 'string' }, maxItems: 100 }, removeLabelIds: { type: 'array', items: { type: 'string' }, maxItems: 100 } }, required: ['messageIds'] } },
    { name: 'gmail.modifyThread', description: 'Modify labels on all messages in a Gmail thread.', inputSchema: { type: 'object', properties: { threadId: { type: 'string' }, addLabelIds: { type: 'array' }, removeLabelIds: { type: 'array' } } } },
    { name: 'gmail.send', description: 'Send an email message.', inputSchema: { type: 'object', properties: { to: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, subject: { type: 'string' }, body: { type: 'string' }, cc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, bcc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, isHtml: { type: 'boolean' } }, required: ['to', 'subject', 'body'] } },
    { name: 'gmail.createDraft', description: 'Create a draft email message.', inputSchema: { type: 'object', properties: { to: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, subject: { type: 'string' }, body: { type: 'string' }, cc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, bcc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, isHtml: { type: 'boolean' }, threadId: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
    { name: 'gmail.sendDraft', description: 'Send a previously created draft email.', inputSchema: { type: 'object', properties: { draftId: { type: 'string' } }, required: ['draftId'] } },
    { name: 'gmail.listLabels', description: "List all Gmail labels in the user's mailbox.", inputSchema: { type: 'object', properties: {} } },
    { name: 'gmail.createLabel', description: 'Create a new Gmail label. Labels help organize emails into categories.', inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1 }, labelListVisibility: { type: 'string', enum: ['labelShow', 'labelHide', 'labelShowIfUnread'] }, messageListVisibility: { type: 'string', enum: ['show', 'hide'] } }, required: ['name'] } },
    { name: 'calendar.list', description: "List all of the user's calendars.", inputSchema: { type: 'object', properties: {} } },
    { name: 'calendar.createEvent', description: 'Create a new event in a calendar.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, date: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, guests: { type: 'string' }, location: { type: 'string' }, description: { type: 'string' } }, required: ['title'] } },
    { name: 'calendar.listEvents', description: 'List events from a calendar.', inputSchema: { type: 'object', properties: { date: { type: 'string' } } } },
    { name: 'calendar.getEvent', description: 'Get the details of a specific calendar event.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'people.getMe', description: 'Get the authenticated user profile.', inputSchema: { type: 'object', properties: {} } },
    { name: 'people.getUserProfile', description: "Get a user's profile information.", inputSchema: { type: 'object', properties: { email: { type: 'string' } } } }
  ];
}

function applyWorkspaceLabelChange(message, addLabelIds = [], removeLabelIds = []) {
  removeLabelIds.map(labelIdFromName).forEach((label) => {
    if (label === 'unread') message.unread = false;
    else if (label === 'starred') message.starred = false;
    else if (label === 'important') message.important = false;
    else removeLabels(message, [label]);
  });
  addLabelIds.map(labelIdFromName).forEach((label) => {
    if (label === 'unread') message.unread = true;
    else if (label === 'starred') message.starred = true;
    else if (label === 'important') message.important = true;
    else addLabel(message, label);
  });
}

function callWorkspaceTool(name, args = {}) {
  const tool = String(name || '').trim();
  if (!workspaceToolSchemas().some((item) => item.name === tool)) {
    throw new Error(`Unsupported Workspace tool: ${tool}`);
  }
  if (tool === 'gmail.search') {
    const maxResults = Math.min(Number(args.maxResults || args.limit || 100), 100);
    const labelFilters = (args.labelIds || []).map(labelIdFromName);
    const messages = state.messages
      .filter((message) => matchesGmailQuery(message, args.query || args.q || ''))
      .filter((message) => args.includeSpamTrash ? true : !message.labels.includes('spam') && !message.labels.includes('trash'))
      .filter((message) => !labelFilters.length || labelFilters.every((label) => {
        if (label === 'unread') return message.unread;
        if (label === 'starred') return message.starred;
        if (label === 'important') return message.important;
        return message.labels.includes(label);
      }))
      .slice(0, maxResults)
      .map((message) => ({ id: message.id, threadId: message.threadId || message.id }));
    pushEvent('workspace_tool_call', { tool, query: args.query || args.q || '', resultCount: messages.length });
    return toolContent({ messages, nextPageToken: undefined, resultSizeEstimate: messages.length });
  }
  if (tool === 'gmail.get') {
    const messageId = String(args.messageId || args.id || '').trim();
    const format = String(args.format || 'full');
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) throw new Error('Message not found');
    pushEvent('workspace_tool_call', { tool, id: messageId });
    if (format === 'metadata' || format === 'full') {
      return toolContent({
        ...normalizeMessageForWorkspace(message, format === 'full'),
        body: format === 'full' ? (message.body || message.snippet || '') : (message.snippet || ''),
        attachments: format === 'full' ? workspaceAttachmentObjects(message) : []
      });
    }
    return toolContent({
      id: message.id,
      threadId: message.threadId || message.id,
      labelIds: normalizeMessageForWorkspace(message).labelIds,
      snippet: message.snippet,
      raw: format === 'raw' ? Buffer.from(message.body || message.snippet || '').toString('base64url') : undefined
    });
  }
  if (tool === 'gmail.downloadAttachment') {
    const messageId = String(args.messageId || '').trim();
    const attachmentId = String(args.attachmentId || args.attachment || '').trim();
    const localPath = String(args.localPath || '').trim();
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) throw new Error('Message not found');
    if (!(message.attachments || []).includes(attachmentId)) throw new Error('Attachment not found');
    if (!path.isAbsolute(localPath)) throw new Error('localPath must be an absolute path.');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, `Mock attachment placeholder for ${attachmentId}\n`);
    pushEvent('workspace_tool_call', { tool, messageId, attachmentId, localPath });
    return toolContent({ message: `Attachment downloaded successfully to ${localPath}`, path: localPath }, false);
  }
  if (tool === 'gmail.modify') {
    const messageId = String(args.messageId || args.id || '').trim();
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) throw new Error('Message not found');
    applyWorkspaceLabelChange(message, args.addLabelIds || [], args.removeLabelIds || []);
    recomputeCounts();
    pushEvent('workspace_tool_call', { tool, id: messageId, addLabelIds: args.addLabelIds || [], removeLabelIds: args.removeLabelIds || [] });
    return toolContent(normalizeMessageForWorkspace(message, true));
  }
  if (tool === 'gmail.batchModify') {
    const ids = (args.messageIds || []).slice(0, 1000).map(String);
    const addLabelIds = args.addLabelIds || [];
    const removeLabelIds = args.removeLabelIds || [];
    if (!addLabelIds.length && !removeLabelIds.length) {
      return toolContent({ status: 'noop', message: 'No labels to add or remove were provided. No action taken.' }, false);
    }
    const messages = state.messages.filter((message) => ids.includes(message.id));
    messages.forEach((message) => applyWorkspaceLabelChange(message, addLabelIds, removeLabelIds));
    recomputeCounts();
    pushEvent('workspace_tool_call', { tool, ids, modified: messages.length });
    return toolContent({ modifiedCount: ids.length, addLabelIds, removeLabelIds, status: 'success' });
  }
  if (tool === 'gmail.modifyThread') {
    const threadId = String(args.threadId || args.id || '').trim();
    const addLabelIds = args.addLabelIds || [];
    const removeLabelIds = args.removeLabelIds || [];
    if (!addLabelIds.length && !removeLabelIds.length) {
      return toolContent({ status: 'noop', message: 'No labels to add or remove were provided. No action taken.' }, false);
    }
    const messages = state.messages.filter((message) => (message.threadId || message.id) === threadId);
    if (!messages.length) throw new Error('Thread not found');
    messages.forEach((message) => applyWorkspaceLabelChange(message, addLabelIds, removeLabelIds));
    recomputeCounts();
    pushEvent('workspace_tool_call', { tool, threadId, modified: messages.length });
    return toolContent({ id: threadId, messages: messages.map((message) => normalizeMessageForWorkspace(message, false)) });
  }
  if (tool === 'gmail.send') {
    if (!String(args.to || '').trim()) throw new Error('Recipient is required');
    const message = sendMessage({ ...args, to: Array.isArray(args.to) ? args.to.join(', ') : args.to, cc: Array.isArray(args.cc) ? args.cc.join(', ') : args.cc, bcc: Array.isArray(args.bcc) ? args.bcc.join(', ') : args.bcc });
    pushEvent('workspace_tool_call', { tool, id: message.id, to: message.to });
    return toolContent({ id: message.id, threadId: message.threadId || message.id, labelIds: ['SENT'], status: 'sent' });
  }
  if (tool === 'gmail.createDraft') {
    const draft = saveDraft({ ...args, to: Array.isArray(args.to) ? args.to.join(', ') : args.to, cc: Array.isArray(args.cc) ? args.cc.join(', ') : args.cc, bcc: Array.isArray(args.bcc) ? args.bcc.join(', ') : args.bcc });
    if (args.threadId) draft.threadId = String(args.threadId);
    pushEvent('workspace_tool_call', { tool, id: draft.id });
    return toolContent({ id: draft.id, message: { id: draft.id, threadId: draft.threadId || draft.id, labelIds: ['DRAFT'] }, status: 'draft_created' });
  }
  if (tool === 'gmail.sendDraft') {
    const draftId = String(args.draftId || '').trim();
    const draft = state.drafts.find((item) => item.id === draftId);
    if (!draft) throw new Error('Draft not found');
    const message = sendMessage(draft);
    pushEvent('workspace_tool_call', { tool, draftId, messageId: message.id });
    return toolContent({ id: message.id, threadId: message.threadId || message.id, labelIds: ['SENT'], status: 'sent' });
  }
  if (tool === 'gmail.listLabels') {
    const labels = state.labels.map((label) => ({
      id: workspaceLabelId(label.id),
      name: label.name,
      type: label.type,
      messageListVisibility: 'show',
      labelListVisibility: 'labelShow'
    }));
    pushEvent('workspace_tool_call', { tool, resultCount: labels.length });
    return toolContent({ labels });
  }
  if (tool === 'gmail.createLabel') {
    const label = createLabel(args);
    recomputeCounts();
    pushEvent('workspace_tool_call', { tool, id: label.id, name: label.name });
    return toolContent({
      id: label.id,
      name: label.name,
      type: 'user',
      messageListVisibility: args.messageListVisibility || 'show',
      labelListVisibility: args.labelListVisibility || 'labelShow',
      status: 'created'
    });
  }
  if (tool === 'calendar.list') {
    return { calendars: [{ id: 'primary', summary: state.account.email, primary: true }] };
  }
  if (tool === 'calendar.createEvent') {
    const event = createCalendarEvent({
      title: args.title || args.summary,
      date: args.date || String(args.start || '').slice(0, 10),
      start: args.startTime || args.start || '',
      end: args.endTime || args.end || '',
      guests: Array.isArray(args.guests) ? args.guests.join(', ') : (args.guests || ''),
      location: args.location || '',
      description: args.description || ''
    });
    pushEvent('workspace_tool_call', { tool, id: event.id, title: event.title });
    return { event };
  }
  if (tool === 'calendar.listEvents') {
    const date = String(args.date || '').trim();
    const events = (state.calendarEvents || []).filter((event) => !date || event.date === date);
    return { events };
  }
  if (tool === 'calendar.getEvent') {
    const event = (state.calendarEvents || []).find((item) => item.id === args.id);
    if (!event) throw new Error('Calendar event not found');
    return { event };
  }
  if (tool === 'people.getMe') {
    return { profile: { displayName: state.account.displayName, name: state.account.displayName, email: state.account.email } };
  }
  if (tool === 'people.getUserProfile') {
    const email = String(args.email || state.account.email).toLowerCase();
    const contact = (state.contacts || []).find((item) => item.email.toLowerCase() === email);
    if (!contact && email !== state.account.email.toLowerCase()) throw new Error('User profile not found');
    return { profile: contact || { displayName: state.account.displayName, name: state.account.displayName, email: state.account.email } };
  }
  throw new Error(`Unsupported Workspace tool: ${tool}`);
}

function mcpToolResult(result) {
  if (result && Array.isArray(result.content)) return result;
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  };
}

async function handleMcp(req, res) {
  const body = await readBody(req);
  const idValue = body.id ?? null;
  try {
    if (body.method === 'initialize') {
      return sendJson(res, 200, {
        jsonrpc: '2.0',
        id: idValue,
        result: {
          protocolVersion: body.params?.protocolVersion || '2025-06-18',
          serverInfo: { name: 'gmail_mock_workspace', version: '0.1.0' },
          capabilities: { tools: {} }
        }
      });
    }
    if (body.method === 'tools/list') {
      return sendJson(res, 200, { jsonrpc: '2.0', id: idValue, result: { tools: workspaceToolSchemas() } });
    }
    if (body.method === 'tools/call') {
      const result = callWorkspaceTool(body.params?.name, body.params?.arguments || {});
      return sendJson(res, 200, { jsonrpc: '2.0', id: idValue, result: mcpToolResult(result) });
    }
    return sendJson(res, 200, { jsonrpc: '2.0', id: idValue, error: { code: -32601, message: 'Method not found' } });
  } catch (err) {
    return sendJson(res, 200, { jsonrpc: '2.0', id: idValue, error: { code: -32000, message: err.message } });
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'gmail_mock', mode: mcpEnabled() ? 'mcp' : 'ui' });
  }
  if (req.method === 'GET' && url.pathname === '/api/session') {
    if (!hasValidBrowserNonce(req) && !hasVerifierToken(req)) {
      pushEvent('browser_session_required', { method: req.method, path: req.url });
      return sendJson(res, 403, { error: 'browser_session_required', message: 'Open the Gmail mock page in a browser first.' });
    }
    return sendJson(res, 200, { uiToken: UI_TOKEN, account: clone(state.account || {}) });
  }
  if (req.method === 'GET' && url.pathname === '/api/ui/state') {
    if (currentRequestSource !== 'ui' || !hasValidBrowserNonce(req) || !hasUiToken(req)) {
      pushEvent('ui_state_denied', { path: url.pathname });
      return sendJson(res, 403, { error: 'ui_request_required' });
    }
    return sendJson(res, 200, clone(state));
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    if (!requireVerifierToken(req, res)) return;
    return sendJson(res, 200, clone(state));
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    if (!requireVerifierToken(req, res)) return;
    const l = url.searchParams.get('limit');
    const o = url.searchParams.get('offset');
    const limit = l != null && l !== '' && !Number.isNaN(Number(l)) ? Number(l) : null;
    const offset = o != null && o !== '' && !Number.isNaN(Number(o)) ? Number(o) : 0;
    return sendJson(res, 200, {
      events: db.getEvents(dbConn, { limit, offset }),
      total: db.countEvents(dbConn)
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/workspace/tools') {
    if (!mcpEnabled()) return denyMcp(req, res, 'workspace_tools');
    return sendJson(res, 200, { tools: workspaceToolSchemas() });
  }
  if (req.method === 'POST' && url.pathname === '/api/workspace/call') {
    if (!mcpEnabled()) return denyMcp(req, res, 'workspace_call');
    const body = await readBody(req);
    const result = callWorkspaceTool(body.name || body.tool, body.arguments || body.args || {});
    return sendJson(res, 200, { result, state: clone(state) });
  }
  if (req.method === 'GET' && url.pathname === '/api/mcp/tools') {
    if (!mcpEnabled()) return denyMcp(req, res, 'mcp_tools');
    return sendJson(res, 200, { tools: workspaceToolSchemas() });
  }
  if (req.method === 'POST' && url.pathname === '/api/mcp/call') {
    if (!mcpEnabled()) return denyMcp(req, res, 'mcp_call');
    const body = await readBody(req);
    const result = callWorkspaceTool(body.name || body.tool, body.arguments || body.args || {});
    return sendJson(res, 200, mcpToolResult(result));
  }
  if (req.method === 'POST' && url.pathname === '/api/reset') {
    if (!requireVerifierToken(req, res)) return;
    db.resetDb(dbConn);
    state = db.loadState(dbConn);
    pushEvent('reset');
    recomputeCounts();
    return sendJson(res, 200, clone(state));
  }
  if (req.method !== 'GET' && !requireUiWrite(req, res)) return;
  if (req.method === 'POST' && url.pathname === '/api/select') {
    const body = await readBody(req);
    const selectedIds = new Set(body.ids || []);
    state.messages.forEach((message) => {
      message.selected = selectedIds.has(message.id);
    });
    pushEvent('selection_changed', { ids: [...selectedIds] });
    return sendJson(res, 200, clone(state));
  }
  if (req.method === 'POST' && url.pathname === '/api/action') {
    const body = await readBody(req);
    applyMessageAction(body.action, body.ids || [], {
      targetLabel: body.targetLabel,
      labelId: body.labelId,
      until: body.until,
      category: body.category
    });
    return sendJson(res, 200, clone(state));
  }
  if (req.method === 'POST' && url.pathname === '/api/draft') {
    const body = await readBody(req);
    return sendJson(res, 200, { draft: saveDraft(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/draft/delete') {
    const body = await readBody(req);
    deleteDraft(body.id);
    return sendJson(res, 200, clone(state));
  }
  if (req.method === 'POST' && url.pathname === '/api/send') {
    const body = await readBody(req);
    return sendJson(res, 200, { message: sendMessage(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/schedule-send') {
    const body = await readBody(req);
    return sendJson(res, 200, { message: scheduleMessage(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/task') {
    const body = await readBody(req);
    return sendJson(res, 200, { task: createTask(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/task/update') {
    const body = await readBody(req);
    return sendJson(res, 200, { task: updateTask(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/calendar') {
    const body = await readBody(req);
    return sendJson(res, 200, { event: createCalendarEvent(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/note') {
    const body = await readBody(req);
    return sendJson(res, 200, { note: createNote(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/contact') {
    const body = await readBody(req);
    return sendJson(res, 200, { contact: createContact(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/label') {
    const body = await readBody(req);
    return sendJson(res, 200, { label: createLabel(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/filter') {
    const body = await readBody(req);
    return sendJson(res, 200, { filter: saveFilter(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/subscription') {
    const body = await readBody(req);
    return sendJson(res, 200, { subscription: unsubscribeSender(body), state: clone(state) });
  }
  if (req.method === 'POST' && url.pathname === '/api/settings') {
    const body = await readBody(req);
    state.settings = { ...state.settings, ...(body.settings || {}) };
    pushEvent('settings_saved', { settings: state.settings });
    return sendJson(res, 200, clone(state));
  }
  if (req.method === 'POST' && url.pathname === '/api/command') {
    const body = await readBody(req);
    pushEvent('ui_command', {
      command: String(body.command || ''),
      ids: Array.isArray(body.ids) ? body.ids : [],
      details: body.details || {}
    });
    return sendJson(res, 200, clone(state));
  }
  return sendJson(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const previousRequestSource = currentRequestSource;
  currentRequestSource = requestSource(req, url);
  try {
    if (!hasVerifierToken(req) && !mcpEnabled()) {
      const p = url.pathname;
      const isDoc = req.method === 'GET' && (p === '/' || p.endsWith('.html'));
      const isAsset = req.method === 'GET' && /\.(js|css|map|png|jpe?g|svg|ico|gif|woff2?|ttf)$/i.test(p);
      if (p.startsWith('/api/') || p === '/mcp' || isDoc || isAsset) {
        const reason = classifyBrowserClient(req, { requireDocument: isDoc });
        if (reason && p !== '/health') return denyNonBrowser(req, res, reason);
      }
      if (isDoc) mintBrowserNonce(req, res);
    }
    if (url.pathname === '/mcp' && req.method === 'POST') {
      if (!mcpEnabled()) {
        denyMcp(req, res, 'mcp');
        return;
      }
      await handleMcp(req, res);
      persist();
      return;
    }
    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      // Write the (possibly mutated) in-memory state back to SQLite. Only POSTs
      // mutate; GET reads (/api/state, /api/ui/state, /api/events, /health) are skipped. Persisting a
      // read-only POST tool call (e.g. gmail.search) is a harmless no-op write.
      if (req.method === 'POST') persist();
      return;
    }
    const filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    return sendFile(res, filePath);
  } catch (err) {
    sendJson(res, 500, { error: 'server_error', message: err.message });
  } finally {
    currentRequestSource = previousRequestSource;
  }
});

// Bind 0.0.0.0 by default so the host-side verifier can reach the mock through
// docker -p (a 127.0.0.1-only listener inside the container is unreachable via
// published ports). Override with GMAIL_MOCK_HOST if needed.
const LISTEN_HOST = process.env.GMAIL_MOCK_HOST || '0.0.0.0';
server.listen(PORT, LISTEN_HOST, () => {
  recomputeCounts();
  console.log(`gmail_mock listening on http://${LISTEN_HOST}:${PORT}`);
});
