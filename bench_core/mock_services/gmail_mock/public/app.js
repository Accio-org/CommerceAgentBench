(function () {
  const els = {
    labelList: document.getElementById('label-list'),
    userLabelList: document.getElementById('user-label-list'),
    categoryTabs: document.getElementById('category-tabs'),
    messageList: document.getElementById('message-list'),
    messageTable: document.querySelector('.message-table'),
    detailView: document.getElementById('detail-view'),
    toolbar: document.getElementById('toolbar'),
    searchInput: document.getElementById('search-input'),
    searchButton: document.getElementById('search-button'),
    composeButton: document.getElementById('compose-button'),
    compose: document.getElementById('compose'),
    closeCompose: document.getElementById('close-compose'),
    minimizeCompose: document.getElementById('minimize-compose'),
    discardDraft: document.getElementById('discard-draft'),
    sendButton: document.getElementById('send-button'),
    sendOptionsButton: document.getElementById('send-options-button'),
    to: document.getElementById('to-field'),
    cc: document.getElementById('cc-field'),
    bcc: document.getElementById('bcc-field'),
    ccWrap: document.getElementById('cc-wrap'),
    bccWrap: document.getElementById('bcc-wrap'),
    ccButton: document.getElementById('cc-button'),
    bccButton: document.getElementById('bcc-button'),
    subject: document.getElementById('subject-field'),
    body: document.getElementById('body-field'),
    advancedButton: document.getElementById('advanced-search-button'),
    advanced: document.getElementById('advanced-search'),
    closeAdvanced: document.getElementById('close-advanced'),
    advancedApply: document.getElementById('advanced-apply'),
    advancedClear: document.getElementById('advanced-clear'),
    advFrom: document.getElementById('adv-from'),
    advTo: document.getElementById('adv-to'),
    advSubject: document.getElementById('adv-subject'),
    advHas: document.getElementById('adv-has'),
    advNot: document.getElementById('adv-not'),
    advLabel: document.getElementById('adv-label'),
    advAttachment: document.getElementById('adv-attachment'),
    notice: document.querySelector('.notice'),
    noticeEnable: document.getElementById('notice-enable'),
    noticeDismiss: document.getElementById('notice-dismiss'),
    noticeClose: document.getElementById('notice-close'),
    settingsButton: document.getElementById('settings-button'),
    createLabelButton: document.getElementById('create-label-button'),
    hideSidePanel: document.getElementById('hide-side-panel'),
    workspace: document.querySelector('.workspace'),
    companionPanel: document.getElementById('companion-panel'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    modalFooter: document.getElementById('modal-footer'),
    modalClose: document.getElementById('modal-close'),
    toast: document.getElementById('toast')
  };

  function svg(path, className = 'g-icon') {
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
  }

  const icons = {
    inbox: svg('M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 9h-4.3a4 4 0 0 1-7.4 0H4V6h16z'),
    star: svg('m12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.1-.6L12 2 9.1 8.7 2 9.3 7.4 14l-1.6 7z'),
    clock: svg('M12 2a10 10 0 1 0 .01 0zM13 7h-2v6l5 3 .9-1.5-3.9-2.3z'),
    important: svg('M5 3h11l3 9-3 9H5l3-9z'),
    send: svg('M2 21 23 12 2 3v7l15 2-15 2z'),
    draft: svg('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z'),
    tag: svg('M20.6 13.4 12.2 5H5v7.2l8.4 8.4a2 2 0 0 0 2.8 0l4.4-4.4a2 2 0 0 0 0-2.8zM7.5 9A1.5 1.5 0 1 1 9 7.5 1.5 1.5 0 0 1 7.5 9z'),
    all: svg('M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z'),
    spam: svg('M15.7 2H8.3L3 7.3v7.4L8.3 20h7.4l5.3-5.3V7.3zM11 6h2v7h-2zm0 9h2v2h-2z'),
    trash: svg('M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zm3-9h2v8H9zm4 0h2v8h-2zm2.5-6-1-1h-5l-1 1H5v2h14V4z'),
    caretDown: svg('m7 10 5 5 5-5z'),
    caretRight: svg('m10 7 5 5-5 5z'),
    scheduled: svg('M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11h5v-2h-4V6h-2v7z'),
    mail_manage: svg('M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9v-2H4V8l8 5 8-5v4h2V6a2 2 0 0 0-2-2zm-8 7L4 6h16zm7 5v-3h-2v3h-3v2h3v3h2v-3h3v-2z'),
    settings: svg('M19.4 13.5a7.8 7.8 0 0 0 .1-1.5 7.8 7.8 0 0 0-.1-1.5l2-1.5-2-3.5-2.4 1a7.2 7.2 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7.2 7.2 0 0 0 7 6L4.6 5l-2 3.5 2 1.5a7.8 7.8 0 0 0-.1 1.5c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.2 7.2 0 0 0 2.6 1.5L10 22h4l.4-2.5A7.2 7.2 0 0 0 17 18l2.4 1 2-3.5zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z'),
    primary: svg('M19 3H5a2 2 0 0 0-2 2v14h18V5a2 2 0 0 0-2-2zm0 10h-4.2a3 3 0 0 1-5.6 0H5V5h14z'),
    promotions: svg('M20.6 13.4 12.2 5H5v7.2l8.4 8.4a2 2 0 0 0 2.8 0l4.4-4.4a2 2 0 0 0 0-2.8z'),
    social: svg('M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.7 0-1.1.1 1.2.9 2.1 2 2.1 3.4V19h6v-2.5C23 14.2 18.3 13 16 13z'),
    archive: svg('M20.5 5 19 3H5L3.5 5 2 7v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7zM12 17 7 12h3V9h4v3h3zM5.1 5h13.8l.8 1H4.3z'),
    mail: svg('M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z'),
    more: svg('M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'),
    refresh: svg('M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3z'),
    back: svg('M20 11H7.8l5.6-5.6L12 4 4 12l8 8 1.4-1.4L7.8 13H20z'),
    print: svg('M19 8H5a3 3 0 0 0-3 3v6h4v4h12v-4h4v-6a3 3 0 0 0-3-3zM16 19H8v-5h8zm3-6a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM18 3H6v4h12z'),
    open: svg('M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14zM5 5h6v2H7v10h10v-4h2v6H5z'),
    reply: svg('M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z'),
    close: svg('m18.3 5.7-1.4-1.4L12 9.2 7.1 4.3 5.7 5.7l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z')
  };

  const PAGE_SIZE = 50;
  let state = null;
  let uiToken = null;
  let activeLabel = 'inbox';
  let activeCategory = 'primary';
  let pageIndex = 0;
  let search = '';
  let advanced = { from: '', to: '', subject: '', has: '', not: '', label: '', hasAttachment: false };
  let currentDraftId = null;
  let detailMessageId = null;
  let openMenuEl = null;
  let labelsExpanded = false;
  let expandedUserLabels = new Set(['label-work', 'label-work-ai']);
  let activeCompanionPanel = null;
  let draggedMessageId = null;
  let calendarCursor = new Date(2025, 5, 19);
  let taskDraftOpen = false;
  let noteDraftOpen = false;
  let calendarDraft = null;
  let contactPanelTab = 'thread';
  let contactSearch = '';
  let recipientMenuEl = null;

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function dateValue(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseDateValue(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function weekday(date) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  }

  function formatPanelDate(date) {
    return `${date.getMonth() + 1}月${date.getDate()}日（${weekday(date)}）`;
  }

  function formatScheduleDate(date) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function nextMonday(fromDate) {
    const date = new Date(fromDate);
    const offset = (8 - date.getDay()) % 7 || 7;
    date.setDate(date.getDate() + offset);
    return date;
  }

  function toIsoAt(date, time) {
    return `${dateValue(date)}T${time}:00+08:00`;
  }

  function colorForName(name) {
    const palette = ['#1a73e8', '#188038', '#d93025', '#f9ab00', '#9334e6', '#5f6368'];
    const total = String(name || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return palette[total % palette.length];
  }

  function contactAvatar(contact) {
    const letter = (contact.name || contact.email || '?').slice(0, 1).toUpperCase();
    const color = contact.color || colorForName(contact.name || contact.email);
    return `<span class="contact-avatar" style="--avatar-color:${escapeAttr(color)}">${escapeHtml(letter)}</span>`;
  }

  function allContacts() {
    const byEmail = new Map();
    (state.contacts || []).forEach((contact) => {
      if (!contact.email) return;
      byEmail.set(contact.email.toLowerCase(), contact);
    });
    state.messages.forEach((message) => {
      const email = message.fromEmail || message.from;
      if (!email || byEmail.has(String(email).toLowerCase())) return;
      byEmail.set(String(email).toLowerCase(), {
        id: `derived-${email}`,
        name: message.from || email,
        email,
        source: 'message',
        color: colorForName(message.from || email)
      });
    });
    return [...byEmail.values()];
  }

  function currentThreadContacts() {
    const message = detailMessageId ? state.messages.find((item) => item.id === detailMessageId) : messagesForView()[0];
    const contacts = [];
    if (message) {
      contacts.push({
        id: `thread-from-${message.id}`,
        name: message.from || message.fromEmail,
        email: message.fromEmail || message.from,
        source: 'conversation',
        color: colorForName(message.from || message.fromEmail)
      });
    }
    contacts.push({
      id: 'thread-self',
      name: state.account.displayName,
      email: state.account.email,
      source: 'account',
      color: '#d93025'
    });
    const seen = new Set();
    return contacts.filter((contact) => {
      const key = String(contact.email || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function richBodyHtml(message) {
    const raw = message.body || message.snippet || '';
    const paragraphs = raw.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    const safeParagraphs = (paragraphs.length ? paragraphs : [message.snippet || message.subject])
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
      .join('');
    const senderDomain = String(message.fromEmail || '').split('@')[1] || '';
    return `
      ${senderDomain ? `<div class="sender-domain">${escapeHtml(senderDomain)}</div>` : ''}
      <div class="message-prose">${safeParagraphs}</div>
      ${message.scheduledAt ? `<div class="scheduled-banner">${icons.scheduled}<span>这封邮件已安排在 ${escapeHtml(message.date)} 发送。</span></div>` : ''}
    `;
  }

  function showToast(text) {
    els.toast.textContent = text;
    els.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2400);
  }

  async function api(path, options) {
    const headers = {
      'content-type': 'application/json',
      'x-gmail-mock-ui': '1',
      ...(options?.headers || {})
    };
    if (uiToken) headers['x-ui-token'] = uiToken;
    const res = await fetch(path, {
      ...options,
      headers
    });
    if (!res.ok) throw new Error(`API ${path} failed`);
    return res.json();
  }

  async function loadSession() {
    const res = await fetch('/api/session', { headers: { 'x-gmail-mock-ui': '1' } });
    if (!res.ok) throw new Error(`API /api/session failed`);
    const session = await res.json();
    uiToken = session.uiToken || null;
    return session;
  }

  async function runAction(action, ids, options = {}) {
    state = await api('/api/action', {
      method: 'POST',
      body: JSON.stringify({ action, ids, ...options })
    });
    return state;
  }

  async function runCommand(command, ids = []) {
    state = await api('/api/command', {
      method: 'POST',
      body: JSON.stringify({ command, ids })
    });
    return state;
  }

  function showModal(title, bodyHtml, footerHtml = '') {
    els.modalTitle.textContent = title;
    els.modalBody.innerHTML = bodyHtml;
    els.modalFooter.innerHTML = footerHtml;
    els.modal.hidden = false;
  }

  function closeModal() {
    els.modal.hidden = true;
    els.modalBody.innerHTML = '';
    els.modalFooter.innerHTML = '';
  }

  function userLabels() {
    const labels = state.labels.filter((label) => label.type === 'user');
    return labels.sort((a, b) => labelDisplayName(a).localeCompare(labelDisplayName(b), 'zh-CN'));
  }

  function labelName(id) {
    return state.labels.find((label) => label.id === id)?.name || id;
  }

  function labelPath(id) {
    const label = state.labels.find((item) => item.id === id);
    if (!label) return [id];
    if (!label.parentId) return [label.name];
    return [...labelPath(label.parentId), label.name];
  }

  function labelDepth(label) {
    let depth = 0;
    let current = label;
    while (current?.parentId) {
      depth += 1;
      current = state.labels.find((item) => item.id === current.parentId);
    }
    return depth;
  }

  function labelDisplayName(label) {
    return labelPath(label.id).join('/');
  }

  function moveTargetLabels() {
    const systemTargets = ['inbox', 'purchases', 'spam', 'trash']
      .map((id) => state.labels.find((label) => label.id === id))
      .filter(Boolean)
      .map((label) => ({ id: label.id, name: label.name }));
    const customTargets = userLabels().map((label) => ({ id: label.id, name: labelDisplayName(label) }));
    return [...systemTargets, ...customTargets];
  }

  async function loadState() {
    state = await api('/api/ui/state');
    labelsExpanded = !!state.settings?.labelListExpanded;
    expandedUserLabels = new Set(state.settings?.expandedUserLabels || ['label-work', 'label-work-ai']);
    activeCompanionPanel = state.settings?.activeCompanionPanel || null;
    document.title = `收件箱 (${state.labels.find((label) => label.id === 'inbox')?.unread || 0}) - ${state.account.email} - Gmail Mock`;
    const avatar = document.querySelector('.avatar');
    if (avatar) {
      avatar.textContent = (state.account.displayName || state.account.email || '?').slice(0, 1).toUpperCase();
      avatar.setAttribute('aria-label', `Google 账号：${state.account.displayName} (${state.account.email})`);
    }
    const footer = document.querySelector('.footer');
    if (footer) {
      footer.querySelector('a').textContent = state.account.storageLabel;
      footer.querySelector('span:last-child').textContent = state.account.lastActivity;
    }
    render();
  }

  function selectedIds() {
    return state.messages.filter((message) => message.selected).map((message) => message.id);
  }

  function resetPaging() {
    pageIndex = 0;
  }

  function pageInfo(total) {
    if (!total) {
      pageIndex = 0;
      return { start: 0, end: 0, hasPrev: false, hasNext: false };
    }
    const maxIndex = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (pageIndex > maxIndex) pageIndex = maxIndex;
    const start = pageIndex * PAGE_SIZE + 1;
    const end = Math.min(total, start + PAGE_SIZE - 1);
    return {
      start,
      end,
      hasPrev: pageIndex > 0,
      hasNext: pageIndex < maxIndex
    };
  }

  function pageItems(items) {
    const info = pageInfo(items.length);
    if (!items.length) return [];
    return items.slice(info.start - 1, info.end);
  }

  function messageMatchesActiveLabel(message) {
    if (activeLabel === 'subscriptions' || activeLabel === 'manage-labels') return false;
    if (activeLabel === 'starred') return message.starred;
    if (activeLabel === 'important') return message.important;
    if (activeLabel === 'all') return !message.labels.includes('trash') && !message.labels.includes('spam');
    return message.labels.includes(activeLabel);
  }

  function messagesForView() {
    if (activeLabel === 'drafts') return [];
    const query = search.trim().toLowerCase();
    return state.messages.filter((message) => {
      if (!messageMatchesActiveLabel(message)) return false;
      if (activeLabel === 'inbox' && message.category !== activeCategory) return false;
      if (query) {
        const haystack = `${message.from} ${message.to || ''} ${message.subject} ${message.snippet}`.toLowerCase();
        if (!matchesSearchQuery(message, query, haystack)) return false;
      }
      if (advanced.from && !message.from.toLowerCase().includes(advanced.from.toLowerCase())) return false;
      if (advanced.to && !String(message.to || '').toLowerCase().includes(advanced.to.toLowerCase())) return false;
      if (advanced.subject && !message.subject.toLowerCase().includes(advanced.subject.toLowerCase())) return false;
      if (advanced.has) {
        const haystack = `${message.subject} ${message.snippet} ${message.body || ''}`.toLowerCase();
        if (!haystack.includes(advanced.has.toLowerCase())) return false;
      }
      if (advanced.not) {
        const haystack = `${message.subject} ${message.snippet} ${message.body || ''}`.toLowerCase();
        if (haystack.includes(advanced.not.toLowerCase())) return false;
      }
      if (advanced.label && !message.labels.includes(advanced.label)) return false;
      if (advanced.hasAttachment && !message.hasAttachment) return false;
      return true;
    });
  }

  function matchesSearchQuery(message, query, haystack) {
    if (query.startsWith('from:')) return message.from.toLowerCase().includes(query.slice(5).trim());
    if (query.startsWith('to:')) return String(message.to || '').toLowerCase().includes(query.slice(3).trim());
    if (query.startsWith('subject:')) return message.subject.toLowerCase().includes(query.slice(8).trim());
    if (query === 'has:attachment' || query === 'has:attachments') return message.hasAttachment;
    if (query === 'is:unread') return message.unread;
    if (query === 'is:read') return !message.unread;
    if (query === 'is:starred') return message.starred;
    if (query === 'is:important') return message.important;
    if (query === 'is:snoozed') return message.labels.includes('snoozed');
    if (query === 'in:trash') return message.labels.includes('trash');
    if (query === 'in:spam') return message.labels.includes('spam');
    if (query === 'in:sent') return message.labels.includes('sent');
    if (query.startsWith('label:')) {
      const name = query.slice(6).trim();
      return message.labels.some((id) => labelName(id).toLowerCase() === name || id === name);
    }
    return haystack.includes(query);
  }

  function viewCount() {
    if (activeLabel === 'subscriptions') return state.subscriptions?.length || 0;
    return activeLabel === 'drafts' ? state.drafts.length : messagesForView().length;
  }

  function closeActionMenu() {
    if (openMenuEl) openMenuEl.remove();
    openMenuEl = null;
  }

  function closeRecipientMenu() {
    if (recipientMenuEl) recipientMenuEl.remove();
    recipientMenuEl = null;
  }

  function currentRecipientQuery(input) {
    const value = input.value;
    const lastComma = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'));
    return value.slice(lastComma + 1).trim().toLowerCase();
  }

  function applyRecipient(input, contact) {
    const value = input.value;
    const lastComma = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'));
    const prefix = lastComma >= 0 ? `${value.slice(0, lastComma + 1)} ` : '';
    input.value = `${prefix}${contact.email}`;
    closeRecipientMenu();
    input.focus();
  }

  function showRecipientSuggestions(input) {
    closeRecipientMenu();
    const query = currentRecipientQuery(input);
    const contacts = allContacts()
      .filter((contact) => {
        const haystack = `${contact.name || ''} ${contact.email || ''}`.toLowerCase();
        return !query || haystack.includes(query);
      })
      .slice(0, 8);
    if (!contacts.length) return;
    const rect = input.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'recipient-suggestions';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.width = `${Math.max(rect.width, 320)}px`;
    contacts.forEach((contact) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `
        ${contactAvatar(contact)}
        <span><strong>${escapeHtml(contact.name || contact.email)}</strong><small>${escapeHtml(contact.email)}</small></span>
      `;
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        applyRecipient(input, contact);
      });
      menu.appendChild(button);
    });
    document.body.appendChild(menu);
    recipientMenuEl = menu;
  }

  function openActionMenu(anchor, items) {
    closeActionMenu();
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'action-menu';
    const estimatedHeight = Math.max(48, items.length * 34 + 16);
    const top = rect.bottom + estimatedHeight + 10 > window.innerHeight
      ? Math.max(8, rect.top - estimatedHeight - 6)
      : rect.bottom + 6;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
    menu.style.top = `${top}px`;
    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.addEventListener('click', async () => {
        closeActionMenu();
        await item.run();
      });
      menu.appendChild(button);
    });
    document.body.appendChild(menu);
    openMenuEl = menu;
  }

  function openMoveMenu(anchor, ids) {
    const targets = moveTargetLabels();
    openActionMenu(anchor, [
      { label: '延后到明天', run: async () => { await runAction('snooze', ids); showToast('已延后'); render(); } },
      ...targets.map((label) => ({
        label: `移至 ${label.name}`,
        run: async () => { await runAction('move', ids, { targetLabel: label.id }); showToast(`已移至${label.name}`); render(); }
      }))
    ]);
  }

  function openLabelMenu(anchor, ids) {
    const labels = userLabels();
    openActionMenu(anchor, [
      { label: '切换重要标记', run: async () => { await runAction('important', ids); showToast('重要标记已更新'); render(); } },
      ...labels.map((label) => ({
        label: `添加标签：${labelDisplayName(label)}`,
        run: async () => { await runAction('label', ids, { labelId: label.id }); showToast('标签已更新'); render(); }
      })),
      ...labels.map((label) => ({
        label: `移除标签：${labelDisplayName(label)}`,
        run: async () => { await runAction('remove_label', ids, { labelId: label.id }); showToast('标签已移除'); render(); }
      }))
    ]);
  }

  function openMoreMenu(anchor, ids) {
    openActionMenu(anchor, [
      { label: '标记为未读', run: async () => { await runAction('unread', ids); showToast('已标记为未读'); render(); } },
      { label: '切换星标', run: async () => { await runAction('star', ids); showToast('星标已更新'); render(); } },
      { label: '切换重要标记', run: async () => { await runAction('important', ids); showToast('重要标记已更新'); render(); } },
      { label: '静音', run: async () => { await runAction('mute', ids); showToast('会话已静音'); render(); } },
      { label: '添加到任务', run: async () => { await runCommand('add_to_tasks', ids); showToast('已添加到任务'); render(); } },
      { label: '打印', run: async () => { await runCommand('print', ids); showToast('已打开打印流程'); render(); } },
      { label: '过滤此类邮件', run: async () => { showFilterDialog(ids); } },
      { label: '举报钓鱼邮件', run: async () => { await runCommand('report_phishing', ids); showToast('已记录举报钓鱼邮件'); render(); } }
    ]);
  }

  function renderLabels() {
    els.labelList.innerHTML = '';
    els.userLabelList.innerHTML = '';
    const alwaysVisibleIds = ['inbox', 'starred', 'snoozed', 'sent', 'drafts', 'purchases'];
    const moreIds = ['important', 'scheduled', 'all', 'spam', 'trash', 'subscriptions', 'manage-labels'];

    const renderLabelButton = (label, parent, options = {}) => {
      const button = document.createElement('button');
      const depth = options.nested ? labelDepth(label) : 0;
      button.className = [
        'label-item',
        label.id === activeLabel ? 'active' : '',
        options.action ? 'action' : '',
        options.className || '',
        depth ? 'nested' : '',
        depth > 1 ? 'nested-level-2' : ''
      ].filter(Boolean).join(' ');
      button.type = 'button';
      const name = options.displayName || label.name;
      button.setAttribute('aria-label', label.unread ? `“${name}”中有 ${label.unread} 封未读邮件` : name);
      button.innerHTML = `<span class="label-icon" aria-hidden="true">${options.icon || icons[label.icon] || icons.draft}</span><span>${escapeHtml(name)}</span><span class="label-count">${label.unread || ''}</span>`;
      button.addEventListener('click', () => {
        if (label.id === 'subscriptions') {
          activeLabel = 'subscriptions';
          detailMessageId = null;
          runCommand('open_subscriptions', []).then(() => render()).catch((err) => showToast(err.message));
          return;
        }
        if (label.id === 'manage-labels') {
          runCommand('open_label_settings', []).then(() => showLabelManagementDialog()).catch((err) => showToast(err.message));
          return;
        }
        activeLabel = label.id;
        if (activeLabel !== 'inbox') activeCategory = 'primary';
        resetPaging();
        render();
      });
      if (!['subscriptions', 'manage-labels'].includes(label.id)) {
        button.addEventListener('dragover', (event) => {
          if (!draggedMessageId) return;
          event.preventDefault();
          button.classList.add('drag-over');
        });
        button.addEventListener('dragleave', () => {
          button.classList.remove('drag-over');
        });
        button.addEventListener('drop', async (event) => {
          if (!draggedMessageId) return;
          event.preventDefault();
          const id = draggedMessageId;
          draggedMessageId = null;
          button.classList.remove('drag-over');
          await runAction('move', [id], { targetLabel: label.id });
          showToast(`已移至${name}`);
          render();
        });
      }
      parent.appendChild(button);
    };

    alwaysVisibleIds.forEach((id) => {
      const label = state.labels.find((item) => item.id === id);
      if (label) renderLabelButton(label, els.labelList);
    });

    const toggleButton = document.createElement('button');
    toggleButton.className = 'label-item action';
    toggleButton.type = 'button';
    toggleButton.setAttribute('aria-expanded', labelsExpanded ? 'true' : 'false');
    toggleButton.setAttribute('aria-label', labelsExpanded ? '隐藏部分标签' : '显示更多标签');
    toggleButton.innerHTML = `<span class="label-icon" aria-hidden="true">${labelsExpanded ? icons.caretDown : icons.caretRight}</span><span>${labelsExpanded ? '隐藏部分标签' : '显示更多标签'}</span><span class="label-count"></span>`;
    toggleButton.addEventListener('click', async () => {
      labelsExpanded = !labelsExpanded;
      state = await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ settings: { labelListExpanded: labelsExpanded } })
      });
      render();
    });
    els.labelList.appendChild(toggleButton);

    if (labelsExpanded) {
      moreIds.forEach((id) => {
        const label = state.labels.find((item) => item.id === id);
        if (label) renderLabelButton(label, els.labelList);
      });
      const button = document.createElement('button');
      button.className = 'label-item action';
      button.type = 'button';
      button.setAttribute('aria-label', '创建新标签');
      button.innerHTML = '<span class="label-icon" aria-hidden="true">＋</span><span>创建新标签</span><span class="label-count"></span>';
      button.addEventListener('click', showCreateLabelDialog);
      els.labelList.appendChild(button);
    }

    const byParent = new Map();
    userLabels().forEach((label) => {
      const parentId = label.parentId || '';
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(label);
    });
    byParent.forEach((siblings) => {
      siblings.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    });

    const renderUserLabelNode = (label, depth = 0) => {
      const children = byParent.get(label.id) || [];
      const row = document.createElement('div');
      row.className = `label-tree-row depth-${Math.min(depth, 3)}`;
      row.style.setProperty('--tree-depth', depth);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'tree-toggle';
      toggle.disabled = !children.length;
      toggle.setAttribute('aria-label', children.length ? `${expandedUserLabels.has(label.id) ? '折叠' : '展开'} ${label.name}` : '');
      toggle.setAttribute('aria-expanded', children.length ? (expandedUserLabels.has(label.id) ? 'true' : 'false') : 'false');
      toggle.innerHTML = children.length ? (expandedUserLabels.has(label.id) ? icons.caretDown : icons.caretRight) : '<span aria-hidden="true"></span>';
      toggle.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (!children.length) return;
        if (expandedUserLabels.has(label.id)) expandedUserLabels.delete(label.id);
        else expandedUserLabels.add(label.id);
        state = await api('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ settings: { expandedUserLabels: [...expandedUserLabels] } })
        });
        render();
      });
      row.appendChild(toggle);
      renderLabelButton(label, row, {
        displayName: label.name,
        icon: icons[label.icon] || icons.tag,
        className: 'tree-label'
      });
      els.userLabelList.appendChild(row);
      if (expandedUserLabels.has(label.id)) {
        children.forEach((child) => renderUserLabelNode(child, depth + 1));
      }
    };
    (byParent.get('') || []).forEach((label) => renderUserLabelNode(label, 0));

    els.advLabel.innerHTML = '<option value="">所有邮件</option>';
    state.labels.forEach((label) => {
      const option = document.createElement('option');
      option.value = label.id;
      option.textContent = label.type === 'user' ? labelDisplayName(label) : label.name;
      els.advLabel.appendChild(option);
    });
  }

  function renderTabs() {
    els.categoryTabs.innerHTML = '';
    state.categories.forEach((category) => {
      const button = document.createElement('button');
      const selected = activeLabel === 'inbox' && activeCategory === category.id;
      button.type = 'button';
      button.className = 'tab-button';
      button.role = 'tab';
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.setAttribute('aria-label', category.unread ? `${category.name}，${category.unread}封新邮件` : category.name);
      const badge = category.id === 'primary' ? '' : (category.unread ? `<span class="category-badge">${category.unread} 个新会话</span>` : '');
      button.innerHTML = `<span class="category-icon" aria-hidden="true">${icons[category.id] || icons.tag}</span><span>${category.name}</span>${badge}<span class="tab-teaser">${category.teaser || ''}</span>`;
      button.addEventListener('click', () => {
        activeLabel = 'inbox';
        activeCategory = category.id;
        resetPaging();
        render();
      });
      els.categoryTabs.appendChild(button);
    });
  }

  function renderToolbar() {
    els.toolbar.classList.remove('toolbar-empty');
    if (activeLabel === 'subscriptions') {
      els.toolbar.classList.add('toolbar-empty');
      els.toolbar.innerHTML = '';
      return;
    }
    if (detailMessageId) {
      const message = state.messages.find((item) => item.id === detailMessageId);
      const ids = [detailMessageId];
      const inTrash = message?.labels.includes('trash');
      const inSpam = message?.labels.includes('spam');
      els.toolbar.innerHTML = `
        <button type="button" id="back-to-list" aria-label="返回到“收件箱”">←</button>
        ${inTrash ? '<button type="button" data-detail-action="restore" aria-label="移至收件箱">移至收件箱</button><button type="button" data-detail-action="delete_forever" aria-label="永久删除">永久删除</button>' : ''}
        ${inSpam ? '<button type="button" data-detail-action="not_spam" aria-label="不是垃圾邮件">不是垃圾邮件</button><button type="button" data-detail-action="delete_forever" aria-label="永久删除">永久删除</button>' : ''}
        ${!inTrash && !inSpam ? '<button type="button" data-detail-action="archive" aria-label="归档">归档</button><button type="button" data-detail-action="spam" aria-label="列为垃圾邮件">垃圾邮件</button><button type="button" data-detail-action="delete" aria-label="删除">删除</button>' : ''}
        <button type="button" data-detail-action="${message && message.unread ? 'read' : 'unread'}" aria-label="${message && message.unread ? '标记为已读' : '标记为未读'}">${message && message.unread ? '标记为已读' : '标记为未读'}</button>
        <button type="button" data-detail-action="${message?.labels.includes('snoozed') ? 'unsnooze' : 'snooze'}" aria-label="${message?.labels.includes('snoozed') ? '取消延后' : '延后'}">${message?.labels.includes('snoozed') ? '取消延后' : '延后'}</button>
        <button type="button" id="move-menu" aria-label="移至">移至</button>
        <button type="button" id="label-menu" aria-label="标签">标签</button>
        <button type="button" id="more-detail" aria-label="更多电子邮件选项">更多</button>
        <span class="label-count">第 1 个会话，共 ${messagesForView().length || state.messages.length} 个</span>
      `;
      els.toolbar.querySelector('#back-to-list').addEventListener('click', () => {
        detailMessageId = null;
        render();
      });
      els.toolbar.querySelectorAll('[data-detail-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const action = button.dataset.detailAction;
          await runAction(action, ids);
          if (['archive', 'delete', 'spam', 'restore', 'not_spam', 'delete_forever'].includes(action)) detailMessageId = null;
          showToast(action === 'unread' ? '已将会话标为未读' : '操作已记录');
          render();
        });
      });
      els.toolbar.querySelector('#move-menu').addEventListener('click', (event) => openMoveMenu(event.currentTarget, ids));
      els.toolbar.querySelector('#label-menu').addEventListener('click', (event) => openLabelMenu(event.currentTarget, ids));
      els.toolbar.querySelector('#more-detail').addEventListener('click', (event) => openMoreMenu(event.currentTarget, ids));
      return;
    }

    const ids = selectedIds();
    const total = viewCount();
    const allViewMessages = messagesForView();
    const viewMessages = pageItems(allViewMessages);
    const range = pageInfo(total);
    const rangeText = total ? `第 ${range.start} - ${range.end} 行，共 ${total} 行` : '第 0 - 0 行，共 0 行';
    if (activeLabel === 'drafts') {
      els.toolbar.innerHTML = `
        <button type="button" id="refresh-list" aria-label="刷新">刷新</button>
        <button type="button" id="more-list" aria-label="更多电子邮件选项">更多</button>
        <span class="label-count">${rangeText}</span>
      `;
      els.toolbar.querySelector('#refresh-list').addEventListener('click', async () => {
        await loadState();
        showToast('已刷新');
      });
      els.toolbar.querySelector('#more-list').addEventListener('click', async () => {
        await runCommand('open_more_menu', []);
        showToast('更多菜单已打开');
      });
      return;
    }
    if ((activeLabel === 'trash' || activeLabel === 'spam') && !ids.length) {
      els.toolbar.innerHTML = `
        <label class="select-wrap"><input id="select-visible" type="checkbox" aria-label="选择" /> <span></span></label>
        <button type="button" id="refresh-list" aria-label="刷新">刷新</button>
        <button type="button" data-empty="${activeLabel}" aria-label="${activeLabel === 'trash' ? '立即清空已删除邮件' : '删除所有垃圾邮件'}">${activeLabel === 'trash' ? '立即清空已删除邮件' : '删除所有垃圾邮件'}</button>
        <span class="label-count">${rangeText}</span>
      `;
    } else if (ids.length && activeLabel === 'trash') {
      els.toolbar.innerHTML = `
        <label class="select-wrap"><input id="select-visible" type="checkbox" aria-label="选择" checked /> <span>${ids.length} 项</span></label>
        <button type="button" data-action="restore" aria-label="移至收件箱">移至收件箱</button>
        <button type="button" data-action="delete_forever" aria-label="永久删除">永久删除</button>
        <button type="button" id="more-list" aria-label="更多电子邮件选项">更多</button>
        <span class="label-count">${rangeText}</span>
      `;
    } else if (ids.length && activeLabel === 'spam') {
      els.toolbar.innerHTML = `
        <label class="select-wrap"><input id="select-visible" type="checkbox" aria-label="选择" checked /> <span>${ids.length} 项</span></label>
        <button type="button" data-action="not_spam" aria-label="不是垃圾邮件">不是垃圾邮件</button>
        <button type="button" data-action="delete_forever" aria-label="永久删除">永久删除</button>
        <button type="button" id="more-list" aria-label="更多电子邮件选项">更多</button>
        <span class="label-count">${rangeText}</span>
      `;
    }
    else if (ids.length) {
      els.toolbar.innerHTML = `
        <label class="select-wrap"><input id="select-visible" type="checkbox" aria-label="选择" checked /> <span>${ids.length} 项</span></label>
        <button type="button" data-action="archive" aria-label="归档">归档</button>
        <button type="button" data-action="spam" aria-label="列为垃圾邮件">列为垃圾邮件</button>
        <button type="button" data-action="delete" aria-label="删除">删除</button>
        <button type="button" data-action="read" aria-label="标记为已读">标记为已读</button>
        <button type="button" data-action="snooze" aria-label="延后">延后</button>
        <button type="button" id="move-menu" aria-label="移至">移至</button>
        <button type="button" id="label-menu" aria-label="标签">标签</button>
        <button type="button" id="more-list" aria-label="更多电子邮件选项">更多</button>
        <span class="label-count">${rangeText}</span>
      `;
    } else {
      els.toolbar.innerHTML = `
        <label class="select-wrap"><input id="select-visible" type="checkbox" aria-label="选择" /> <span></span></label>
        <button type="button" id="refresh-list" aria-label="刷新">刷新</button>
        <button type="button" id="more-list" aria-label="更多电子邮件选项">更多</button>
        <span class="label-count">${rangeText}</span>
        <button type="button" id="prev-page" aria-label="较新" ${range.hasPrev ? '' : 'disabled'}>‹</button>
        <button type="button" id="next-page" aria-label="较旧" ${range.hasNext ? '' : 'disabled'}>›</button>
      `;
    }

    const selectVisible = els.toolbar.querySelector('#select-visible');
    if (selectVisible) selectVisible.addEventListener('change', (event) => {
      const idsToSelect = event.currentTarget.checked ? viewMessages.map((message) => message.id) : [];
      updateSelection(idsToSelect);
    });
    els.toolbar.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        await runAction(action, ids);
        showToast(action === 'delete' ? '已移至已删除邮件' : action === 'delete_forever' ? '已永久删除' : '操作已记录');
        render();
      });
    });
    els.toolbar.querySelectorAll('[data-empty]').forEach((button) => {
      button.addEventListener('click', async () => {
        await runAction(button.dataset.empty === 'trash' ? 'empty_trash' : 'empty_spam', []);
        showToast(button.dataset.empty === 'trash' ? '已删除邮件已清空' : '垃圾邮件已清空');
        render();
      });
    });
    const refresh = els.toolbar.querySelector('#refresh-list');
    if (refresh) {
      refresh.addEventListener('click', async () => {
        await loadState();
        showToast('已刷新');
      });
    }
    const move = els.toolbar.querySelector('#move-menu');
    if (move) move.addEventListener('click', (event) => openMoveMenu(event.currentTarget, ids));
    const label = els.toolbar.querySelector('#label-menu');
    if (label) label.addEventListener('click', (event) => openLabelMenu(event.currentTarget, ids));
    const more = els.toolbar.querySelector('#more-list');
    if (more) more.addEventListener('click', (event) => openMoreMenu(event.currentTarget, ids));
    const prevPage = els.toolbar.querySelector('#prev-page');
    if (prevPage) prevPage.addEventListener('click', () => {
      if (pageIndex > 0) pageIndex -= 1;
      render();
    });
    const nextPage = els.toolbar.querySelector('#next-page');
    if (nextPage) nextPage.addEventListener('click', () => {
      pageIndex += 1;
      render();
    });
  }

  function renderMessages() {
    if (activeLabel === 'subscriptions') {
      renderSubscriptions();
      return;
    }
    if (detailMessageId) {
      els.messageTable.hidden = true;
      els.detailView.hidden = false;
      renderDetail();
      return;
    }
    els.messageTable.hidden = false;
    els.detailView.hidden = true;
    if (activeLabel === 'drafts') {
      renderDraftRows();
      return;
    }
    const messages = pageItems(messagesForView());
    els.messageList.innerHTML = '';
    if (!messages.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" class="empty">没有符合条件的邮件</td>';
      els.messageList.appendChild(tr);
      return;
    }
    messages.forEach((message) => {
      const tr = document.createElement('tr');
      tr.className = `message-row ${message.unread ? 'unread' : ''} ${message.selected ? 'selected' : ''}`;
      tr.draggable = true;
      tr.setAttribute('aria-label', `${message.selected ? '已选择，' : ''}${message.unread ? '未读，' : ''}${message.from}，${message.subject}，${message.date}，${message.snippet}`);
      const subjectLabel = escapeAttr(message.subject);
      const readLabel = message.unread ? '标记为已读' : '标记为未读';
      tr.innerHTML = `
        <td class="message-check"><button type="button" class="row-grip" title="拖动" aria-label="拖动邮件：${subjectLabel}">${icons.more}</button><input type="checkbox" aria-label="${subjectLabel}" ${message.selected ? 'checked' : ''} /></td>
        <td class="message-star"><button type="button" aria-label="${message.starred ? '已加星标' : '未加星标'}：${subjectLabel}">${message.starred ? '★' : '☆'}</button></td>
        <td class="message-from">${escapeHtml(message.from)}</td>
        <td>${message.important ? `<span class="important-marker" title="重要">${icons.important}</span> ` : ''}<a href="#" class="subject">${escapeHtml(message.subject)}</a> <span class="snippet">- ${escapeHtml(message.snippet)}</span>${message.hasAttachment ? ' <span title="附件">📎</span>' : ''}</td>
        <td class="message-date">
          <span class="row-date-text">${escapeHtml(message.date)}</span>
          <span class="row-actions" aria-label="邮件快捷操作">
            <button type="button" data-row-action="archive" title="归档" aria-label="归档：${subjectLabel}">${icons.archive}</button>
            <button type="button" data-row-action="delete" title="删除" aria-label="删除：${subjectLabel}">${icons.trash}</button>
            <button type="button" data-row-action="${message.unread ? 'read' : 'unread'}" title="${readLabel}" aria-label="${readLabel}：${subjectLabel}">${icons.mail}</button>
            <button type="button" data-row-action="snooze" title="延后" aria-label="延后：${subjectLabel}">${icons.clock}</button>
          </span>
        </td>
      `;
      tr.addEventListener('dragstart', (event) => {
        draggedMessageId = message.id;
        tr.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', message.id);
        showToast('拖到左侧标签可移动邮件');
      });
      tr.addEventListener('dragend', () => {
        draggedMessageId = null;
        tr.classList.remove('dragging');
        document.querySelectorAll('.label-item.drag-over').forEach((item) => item.classList.remove('drag-over'));
      });
      tr.querySelector('input').addEventListener('change', (event) => {
        const ids = new Set(selectedIds());
        if (event.currentTarget.checked) ids.add(message.id);
        else ids.delete(message.id);
        updateSelection([...ids]);
      });
      tr.querySelector('.row-grip').addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await runCommand('drag_message_handle', [message.id]);
        showToast('按住并拖到左侧标签可移动邮件');
      });
      tr.querySelector('.message-star button').addEventListener('click', async () => {
        state = await api('/api/action', {
          method: 'POST',
          body: JSON.stringify({ action: 'star', ids: [message.id] })
        });
        render();
      });
      tr.querySelectorAll('[data-row-action]').forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const action = button.dataset.rowAction;
          await runAction(action, [message.id]);
          showToast(action === 'delete' ? '已移至已删除邮件' : action === 'archive' ? '已归档' : '操作已记录');
          render();
        });
      });
      tr.querySelector('.subject').addEventListener('click', (event) => {
        event.preventDefault();
        openDetail(message.id);
      });
      tr.addEventListener('click', (event) => {
        if (event.target.closest('input, button, a')) return;
        openDetail(message.id);
      });
      els.messageList.appendChild(tr);
    });
  }

  function renderSubscriptions() {
    els.messageTable.hidden = true;
    els.detailView.hidden = false;
    const rows = state.subscriptions || [];
    els.detailView.innerHTML = `
      <section class="subscriptions-view" aria-label="订阅">
        <h2>订阅</h2>
        <p>您退订后，发件人可能需要几天时间才能停止向您发送邮件</p>
        <div class="subscription-list">
          ${rows.map((item) => `
            <div class="subscription-row ${item.unsubscribed ? 'muted' : ''}">
              <div class="subscription-avatar" aria-hidden="true">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</div>
              <div class="subscription-sender">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.email)}</span>
              </div>
              <div class="subscription-recent">${escapeHtml(item.status || item.recent)}</div>
              <button type="button" data-subscription="${escapeHtml(item.email)}" ${item.unsubscribed ? 'disabled' : ''}>${item.unsubscribed ? '已退订' : '退订'}</button>
            </div>
          `).join('')}
        </div>
      </section>
    `;
    els.detailView.querySelectorAll('[data-subscription]').forEach((button) => {
      button.addEventListener('click', async () => {
        const email = button.dataset.subscription;
        const result = await api('/api/subscription', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
        state = result.state;
        showToast('退订请求已记录');
        render();
      });
    });
  }

  function renderDraftRows() {
    els.messageList.innerHTML = '';
    if (!state.drafts.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" class="empty">没有草稿</td>';
      els.messageList.appendChild(tr);
      return;
    }
    state.drafts.forEach((draft) => {
      const tr = document.createElement('tr');
      tr.className = 'message-row draft-row';
      const subject = draft.subject || '(无主题)';
      const snippet = draft.body || draft.to || '空草稿';
      tr.setAttribute('aria-label', `草稿，${subject}`);
      tr.innerHTML = `
        <td class="message-check"></td>
        <td class="message-star"><span aria-hidden="true">□</span></td>
        <td class="message-from draft-label">草稿</td>
        <td><a href="#" class="subject">${escapeHtml(subject)}</a> <span class="snippet">- ${escapeHtml(snippet)}</span></td>
        <td class="message-date">草稿</td>
      `;
      tr.querySelector('.subject').addEventListener('click', (event) => {
        event.preventDefault();
        openDraft(draft);
      });
      tr.addEventListener('click', (event) => {
        if (event.target.closest('input, button, a')) return;
        openDraft(draft);
      });
      els.messageList.appendChild(tr);
    });
  }

  async function openDetail(id) {
    detailMessageId = id;
    const message = state.messages.find((item) => item.id === id);
    if (message && message.unread) {
      state = await api('/api/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'read', ids: [id] })
      });
    }
    render();
  }

  function renderDetail() {
    const message = state.messages.find((item) => item.id === detailMessageId);
    if (!message) {
      detailMessageId = null;
      render();
      return;
    }
    const attachments = message.attachments || [];
    const visibleLabels = message.labels
      .filter((label) => !['sent', 'all'].includes(label))
      .map((label) => state.labels.find((item) => item.id === label)?.name || label);
    els.detailView.innerHTML = `
      <div class="detail-toolbar" aria-label="邮件详情工具">
        <button type="button" id="detail-print" aria-label="全部打印" title="打印">${icons.print}</button>
        <button type="button" id="detail-new-window" aria-label="在新窗口中查看" title="在新窗口中查看">${icons.open}</button>
      </div>
      <h2 class="detail-title">${escapeHtml(message.subject)}${visibleLabels.map((label) => `<span class="label-chip">${escapeHtml(label)}</span>`).join('')}</h2>
      <section class="message-card ${message.scheduledAt ? 'scheduled-message-card' : ''}" aria-label="邮件正文">
        <div class="sender-avatar" aria-hidden="true">${escapeHtml(message.from.slice(0, 1))}</div>
        <div>
          <div class="message-meta">
            <div>
              <h3>${escapeHtml(message.from)} <span class="snippet">${escapeHtml(message.fromEmail || message.from || '')}</span></h3>
              <p>发送至 我 <button type="button" id="show-details">显示详细信息</button></p>
            </div>
            <div class="detail-actions">
              <span>${escapeHtml(message.date)}</span>
              <button type="button" id="detail-star" aria-label="${message.starred ? '已加星标' : '未加星标'}">${message.starred ? '★' : '☆'}</button>
              <button type="button" id="detail-reply" aria-label="回复">${icons.reply}</button>
              <button type="button" id="detail-more" aria-label="更多邮件选项">${icons.more}</button>
            </div>
          </div>
          <div class="message-body">${richBodyHtml(message)}</div>
          ${attachments.length ? `<div class="attachment-list">${attachments.map((item) => `<span class="attachment-pill">附件：${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        </div>
      </section>
      <div class="reply-strip">
        <button type="button" id="reply-button">回复</button>
        <button type="button" id="forward-button">转发</button>
        <button type="button" id="emoji-button">添加表情符号回应</button>
      </div>
      <section class="inline-reply" id="inline-reply" aria-label="回复编辑器" hidden>
        <textarea id="reply-body" aria-label="回复正文"></textarea>
        <div class="reply-actions">
          <button class="send-button" id="send-reply" type="button">发送</button>
          <button type="button" id="save-reply">保存并关闭</button>
          <button type="button" id="discard-reply">舍弃回复</button>
        </div>
      </section>
    `;
    els.detailView.querySelector('#detail-star').addEventListener('click', async () => {
      state = await api('/api/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'star', ids: [message.id] })
      });
      render();
    });
    els.detailView.querySelector('#show-details').addEventListener('click', () => {
      showModal('邮件详细信息', `
        <dl class="details-list">
          <dt>发件人</dt><dd>${escapeHtml(message.from)} &lt;${escapeHtml(message.fromEmail || '')}&gt;</dd>
          <dt>收件人</dt><dd>${escapeHtml(message.to || state.account.email)}</dd>
          <dt>日期</dt><dd>${escapeHtml(message.fullDate || message.date)}</dd>
          <dt>主题</dt><dd>${escapeHtml(message.subject)}</dd>
        </dl>
      `);
    });
    els.detailView.querySelector('#detail-more').addEventListener('click', (event) => {
      event.stopPropagation();
      openMoreMenu(els.detailView.querySelector('#detail-more'), [message.id]);
    });
    els.detailView.querySelector('#detail-print').addEventListener('click', async () => {
      await runCommand('print_thread', [message.id]);
      showToast('已打开打印流程');
    });
    els.detailView.querySelector('#detail-new-window').addEventListener('click', async () => {
      await runCommand('open_thread_new_window', [message.id]);
      showToast('已在 mock 中记录新窗口查看');
    });
    const openReply = () => {
      const reply = els.detailView.querySelector('#inline-reply');
      reply.hidden = false;
      els.detailView.querySelector('#reply-body').focus();
    };
    els.detailView.querySelector('#detail-reply').addEventListener('click', openReply);
    els.detailView.querySelector('#reply-button').addEventListener('click', openReply);
    els.detailView.querySelector('#forward-button').addEventListener('click', () => {
      prefillCompose({
        subject: `Fwd: ${message.subject}`,
        body: `\n\n---------- 转发的邮件 ----------\nFrom: ${message.from}\nSubject: ${message.subject}\n\n${message.body || message.snippet}`
      });
    });
    els.detailView.querySelector('#emoji-button').addEventListener('click', () => {
      showToast('已打开表情回应选择器');
    });
    els.detailView.querySelector('#send-reply').addEventListener('click', async () => {
      const body = els.detailView.querySelector('#reply-body').value;
      const result = await api('/api/send', {
        method: 'POST',
        body: JSON.stringify({ to: message.from, subject: `Re: ${message.subject}`, body })
      });
      state = result.state;
      showToast('回复已发送');
      render();
    });
    els.detailView.querySelector('#save-reply').addEventListener('click', async () => {
      await api('/api/draft', {
        method: 'POST',
        body: JSON.stringify({ to: message.from, subject: `Re: ${message.subject}`, body: els.detailView.querySelector('#reply-body').value })
      });
      state = await api('/api/ui/state');
      showToast('草稿已保存');
      render();
    });
    els.detailView.querySelector('#discard-reply').addEventListener('click', () => {
      els.detailView.querySelector('#inline-reply').hidden = true;
      showToast('回复草稿已舍弃');
    });
  }

  function companionShell(title, body, options = {}) {
    return `
      <div class="companion-header">
        <div>
          ${options.eyebrow ? `<span class="companion-eyebrow">${escapeHtml(options.eyebrow)}</span>` : ''}
          <h2>${escapeHtml(title)}</h2>
        </div>
        <div class="companion-actions">
          ${options.search ? `<button type="button" data-companion-action="search" aria-label="搜索">${svg('M9.7 4.5a5.2 5.2 0 1 1 0 10.4 5.2 5.2 0 0 1 0-10.4m0-2a7.2 7.2 0 1 0 4.5 12.8l4.2 4.2 1.4-1.4-4.2-4.2A7.2 7.2 0 0 0 9.7 2.5z')}</button>` : ''}
          <button type="button" data-companion-action="open" aria-label="在新标签页中打开">${icons.open}</button>
          <button type="button" data-companion-action="close" aria-label="关闭">${icons.close}</button>
        </div>
      </div>
      ${body}
    `;
  }

  function calendarPanelHtml() {
    const currentDate = dateValue(calendarCursor);
    const events = (state.calendarEvents || []).filter((event) => event.date === currentDate);
    const message = detailMessageId ? state.messages.find((item) => item.id === detailMessageId) : null;
    const draftTitle = calendarDraft?.title ?? (message?.subject || '');
    const rows = Array.from({ length: 12 }, (_, index) => {
      const hour = index + 7;
      const label = hour < 12 ? `上午${hour}点` : hour === 12 ? '下午12点' : `下午${hour - 12}点`;
      return `<button type="button" class="calendar-slot" data-calendar-slot="${pad2(hour)}:00"><span>${label}</span></button>`;
    }).join('');
    return companionShell('日历', `
      <div class="calendar-strip">
        <button type="button" data-companion-action="today">今天</button>
        <button type="button" data-companion-action="prev" aria-label="前一天">${svg('m15.4 7.4-1.4-1.4L8 12l6 6 1.4-1.4L10.8 12z')}</button>
        <button type="button" data-companion-action="next" aria-label="次日">${svg('m8.6 16.6 1.4 1.4 6-6-6-6-1.4 1.4 4.6 4.6z')}</button>
        <button type="button" data-companion-action="options" aria-label="选项">${icons.more}</button>
      </div>
      <section class="calendar-day" aria-label="${escapeAttr(formatPanelDate(calendarCursor))}">
        <h3>${escapeHtml(formatPanelDate(calendarCursor))}</h3>
        <div class="calendar-events">
          ${events.map((event) => `
            <button type="button" class="calendar-event ${event.allDay ? 'all-day' : ''}" data-calendar-event="${escapeAttr(event.id)}" style="--event-color:${escapeAttr(event.color || '#1a73e8')}">
              ${escapeHtml(event.allDay ? event.title : `${event.start} ${event.title}`)}
            </button>
          `).join('')}
        </div>
        ${calendarDraft ? `
          <section class="calendar-editor" aria-label="新建活动">
            <input id="calendar-title" aria-label="添加标题" placeholder="添加标题" value="${escapeAttr(draftTitle)}" />
            <div class="calendar-time-fields" aria-label="活动时间">
              <label><span>日期</span><input id="calendar-date" aria-label="日期" type="date" value="${escapeAttr(currentDate)}" /></label>
              <label><span>开始时间</span><input id="calendar-start" aria-label="开始时间" type="time" value="${escapeAttr(calendarDraft.start)}" /></label>
              <label><span>结束时间</span><input id="calendar-end" aria-label="结束时间" type="time" value="${escapeAttr(calendarDraft.end || '')}" /></label>
            </div>
            <input id="calendar-guests" aria-label="添加邀请对象" placeholder="添加邀请对象" />
            <button type="button" id="calendar-meet" class="calendar-field-button">添加 Google Meet 视频会议</button>
            <input id="calendar-location" aria-label="添加地点" placeholder="添加地点" />
            <textarea id="calendar-description" aria-label="添加说明" placeholder="添加说明"></textarea>
            <div class="calendar-owner">${escapeHtml(state.account.displayName)} · 忙碌 · 默认的公开范围 · 通知 30 分钟前</div>
            <footer>
              <button type="button" id="calendar-cancel">取消</button>
              <button type="button" id="calendar-save" class="blue-action compact">保存</button>
            </footer>
          </section>
        ` : ''}
        <div class="time-grid" aria-label="点击空白时间段创建活动">${rows}</div>
      </section>
    `, { search: false });
  }

  function keepPanelHtml() {
    const notes = state.notes || [];
    return companionShell('记事', `
      <div class="quick-add keep-add">
        <button type="button" data-companion-action="new-note"><span aria-hidden="true">＋</span> 添加记事...</button>
        <button type="button" data-companion-action="new-list" aria-label="新建清单">${svg('M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z')}</button>
      </div>
      ${noteDraftOpen ? `
        <section class="note-editor">
          <input id="note-title" placeholder="标题" aria-label="标题" />
          <textarea id="note-body" placeholder="记事内容" aria-label="记事内容"></textarea>
          <footer>
            <button type="button" id="note-cancel">取消</button>
            <button type="button" id="note-save">完成</button>
          </footer>
        </section>
      ` : ''}
      <section class="note-list">
        ${notes.map((note) => `
          <article class="note-card">
            ${note.title ? `<strong>${escapeHtml(note.title)}</strong>` : ''}
            ${note.body ? `<p>${escapeHtml(note.body)}</p>` : ''}
          </article>
        `).join('')}
      </section>
      ${notes.length ? '' : `
        <section class="companion-empty compact-empty">
          <div class="keep-mark" aria-hidden="true">${svg('M9 21h6v-1H9zm3-19a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z')}</div>
          <h3>尚无记事</h3>
          <p>您在 Google Keep 中的记事将会显示在此处。</p>
        </section>
      `}
    `, { eyebrow: 'KEEP', search: true });
  }

  function tasksPanelHtml() {
    const tasks = state.tasks || [];
    const taskList = tasks.map((task) => `
      <article class="task-row ${task.completed ? 'completed' : ''}">
        <input type="checkbox" data-task-complete="${escapeAttr(task.id)}" aria-label="完成 ${escapeAttr(task.title)}" ${task.completed ? 'checked' : ''} />
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          ${task.details ? `<p>${escapeHtml(task.details)}</p>` : ''}
          ${task.due ? `<span class="task-date">${escapeHtml(task.due)}</span>` : ''}
        </div>
      </article>
    `).join('');
    return companionShell('我的任务', `
      <div class="tasks-title-row">
        <button type="button" data-companion-action="task-list" class="list-picker">我的任务 ${icons.caretDown}</button>
        <button type="button" data-companion-action="task-options" aria-label="列表选项">${icons.more}</button>
      </div>
      <button type="button" class="task-add" data-companion-action="add-task">${svg('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z')} 添加任务</button>
      ${taskDraftOpen ? `
        <section class="task-editor" aria-label="新创建的任务">
          <input id="task-title" aria-label="任务标题" placeholder="标题" />
          <textarea id="task-details" aria-label="任务说明" placeholder="详细信息"></textarea>
          <input id="task-due" type="hidden" />
          <div class="task-chip-row">
            <button type="button" data-task-due="今天">安排在今天</button>
            <button type="button" data-task-due="明天">安排在明天</button>
            <button type="button" data-task-due="选择日期/时间">添加日期/时间</button>
            <button type="button" data-task-due="重复">重复</button>
          </div>
          <footer>
            <button type="button" id="task-cancel">取消</button>
            <button type="button" id="task-save">保存</button>
          </footer>
        </section>
      ` : ''}
      <section class="task-list">${taskList}</section>
      ${tasks.length ? '' : `
        <section class="companion-empty compact-empty">
          <div class="tasks-mark" aria-hidden="true">${svg('M12 2a10 10 0 1 0 .01 0zM10 15.5 6.5 12l1.4-1.4 2.1 2.1 5.6-5.6L17 8.5z')}</div>
          <h3>还没有任务呢</h3>
          <p>添加待办事项，并追踪 Google Workspace 中的所有待办事项。</p>
        </section>
      `}
    `, { eyebrow: 'TASKS', search: false });
  }

  function contactsPanelHtml() {
    const source = contactPanelTab === 'thread' ? currentThreadContacts() : allContacts();
    const query = contactSearch.trim().toLowerCase();
    const contacts = source.filter((contact) => {
      const haystack = `${contact.name || ''} ${contact.email || ''}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    return companionShell('通讯录', `
      <div class="contacts-tabs" role="tablist">
        <button type="button" data-contact-tab="thread" aria-selected="${contactPanelTab === 'thread'}">在此会话中</button>
        <button type="button" data-contact-tab="contacts" aria-selected="${contactPanelTab === 'contacts'}">通讯录</button>
      </div>
      <label class="companion-search-line">
        ${svg('M9.7 4.5a5.2 5.2 0 1 1 0 10.4 5.2 5.2 0 0 1 0-10.4m0-2a7.2 7.2 0 1 0 4.5 12.8l4.2 4.2 1.4-1.4-4.2-4.2A7.2 7.2 0 0 0 9.7 2.5z')}
        <input id="contacts-search" aria-label="搜索联系人" placeholder="搜索" value="${escapeAttr(contactSearch)}" />
      </label>
      <section class="contact-list">
        ${contacts.map((contact) => `
          <article class="contact-row">
            ${contactAvatar(contact)}
            <div>
              <strong>${escapeHtml(contact.name || contact.email)}</strong>
              <span>${escapeHtml(contact.email)}</span>
            </div>
            <button type="button" data-prefill-contact="${escapeAttr(contact.email)}" aria-label="向 ${escapeAttr(contact.email)} 发送邮件">${icons.mail}</button>
          </article>
        `).join('')}
      </section>
      <button type="button" class="blue-action contacts-create" data-companion-action="create-contact">创建联系人</button>
    `, { search: true });
  }

  async function closeCompanionPanel() {
    activeCompanionPanel = null;
    state = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings: { activeCompanionPanel: null } })
    });
    renderCompanionPanel();
  }

  function showCreateContactDialog(prefill = {}) {
    showModal('创建联系人', `
      <label class="modal-field"><span>名字</span><input id="contact-name" value="${escapeAttr(prefill.name || '')}" /></label>
      <label class="modal-field"><span>电子邮件</span><input id="contact-email" value="${escapeAttr(prefill.email || '')}" /></label>
      <label class="modal-field"><span>电话</span><input id="contact-phone" /></label>
      <label class="modal-field stacked"><span>备注</span><textarea id="contact-notes"></textarea></label>
    `, '<button type="button" id="contact-cancel">取消</button><button type="button" id="contact-save">保存</button>');
    els.modalFooter.querySelector('#contact-cancel').addEventListener('click', closeModal);
    els.modalFooter.querySelector('#contact-save').addEventListener('click', async () => {
      const result = await api('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          name: els.modalBody.querySelector('#contact-name').value,
          email: els.modalBody.querySelector('#contact-email').value,
          phone: els.modalBody.querySelector('#contact-phone').value,
          notes: els.modalBody.querySelector('#contact-notes').value
        })
      });
      state = result.state;
      closeModal();
      contactPanelTab = 'contacts';
      showToast('联系人已保存');
      render();
    });
  }

  function renderCompanionPanel() {
    const panel = activeCompanionPanel;
    document.querySelectorAll('[data-panel]').forEach((button) => {
      button.classList.toggle('active', button.dataset.panel === panel);
      button.setAttribute('aria-selected', button.dataset.panel === panel ? 'true' : 'false');
    });
    if (!panel) {
      els.companionPanel.hidden = true;
      els.workspace.classList.remove('has-companion');
      els.companionPanel.innerHTML = '';
      els.companionPanel.onclick = null;
      return;
    }
    els.workspace.classList.add('has-companion');
    els.companionPanel.hidden = false;

    if (panel === 'calendar') {
      els.companionPanel.innerHTML = calendarPanelHtml();
    } else if (panel === 'keep') {
      els.companionPanel.innerHTML = keepPanelHtml();
    } else if (panel === 'tasks') {
      els.companionPanel.innerHTML = tasksPanelHtml();
    } else if (panel === 'contacts') {
      els.companionPanel.innerHTML = contactsPanelHtml();
    } else {
      els.companionPanel.innerHTML = companionShell('获取插件', `
        <section class="marketplace-panel">
          <div class="marketplace-loader" aria-hidden="true"></div>
          <h3>Google Workspace Marketplace</h3>
          <p>在 Gmail 中查找可搭配使用的应用和插件。</p>
          <button type="button" class="blue-action" data-companion-action="open-marketplace">浏览 Marketplace</button>
        </section>
      `, { search: false });
    }

    const contactsSearch = els.companionPanel.querySelector('#contacts-search');
    if (contactsSearch) {
      contactsSearch.addEventListener('input', () => {
        contactSearch = contactsSearch.value;
        renderCompanionPanel();
      });
      contactsSearch.focus({ preventScroll: true });
    }

    els.companionPanel.onclick = async (event) => {
      const target = event.target.closest('button, input[type="checkbox"]');
      if (!target) return;
      const action = target.dataset.companionAction;
      if (action === 'close') {
        await closeCompanionPanel();
        return;
      }
      if (action === 'open') {
        await runCommand(`companion_${panel}_open`, []);
        showToast('已记录在新标签页中打开');
        return;
      }
      if (action === 'search') {
        els.companionPanel.querySelector('input')?.focus();
        return;
      }
      if (panel === 'calendar') {
        if (action === 'today') calendarCursor = new Date(2025, 5, 19);
        if (action === 'prev') calendarCursor = addDays(calendarCursor, -1);
        if (action === 'next') calendarCursor = addDays(calendarCursor, 1);
        if (['today', 'prev', 'next'].includes(action)) {
          calendarDraft = null;
          renderCompanionPanel();
          return;
        }
        if (target.dataset.calendarSlot) {
          const [hour] = target.dataset.calendarSlot.split(':').map(Number);
          calendarDraft = {
            start: target.dataset.calendarSlot,
            end: `${pad2(Math.min(hour + 1, 23))}:00`,
            title: detailMessageId ? state.messages.find((item) => item.id === detailMessageId)?.subject || '' : ''
          };
          renderCompanionPanel();
          return;
        }
        if (target.dataset.calendarEvent) {
          const calendarEvent = (state.calendarEvents || []).find((item) => item.id === target.dataset.calendarEvent);
          if (calendarEvent) showModal(calendarEvent.title, `<p>${escapeHtml(formatPanelDate(calendarCursor))}</p><p>${escapeHtml(calendarEvent.allDay ? '全天' : `${calendarEvent.start} - ${calendarEvent.end}`)}</p>`);
          return;
        }
      }
      if (panel === 'keep') {
        if (action === 'new-note') {
          noteDraftOpen = true;
          renderCompanionPanel();
          return;
        }
      }
      if (panel === 'tasks') {
        if (action === 'add-task') {
          taskDraftOpen = true;
          renderCompanionPanel();
          return;
        }
        if (target.dataset.taskDue) {
          const dueInput = els.companionPanel.querySelector('#task-due');
          if (dueInput) {
            dueInput.value = target.dataset.taskDue;
            els.companionPanel.querySelectorAll('[data-task-due]').forEach((button) => button.classList.toggle('selected', button === target));
          }
          return;
        }
        if (target.dataset.taskComplete) {
          const result = await api('/api/task/update', {
            method: 'POST',
            body: JSON.stringify({ id: target.dataset.taskComplete, completed: target.checked })
          });
          state = result.state;
          render();
          return;
        }
      }
      if (panel === 'contacts') {
        if (target.dataset.contactTab) {
          contactPanelTab = target.dataset.contactTab;
          renderCompanionPanel();
          return;
        }
        if (action === 'create-contact') {
          showCreateContactDialog();
          return;
        }
        if (target.dataset.prefillContact) {
          prefillCompose({ to: target.dataset.prefillContact });
          return;
        }
      }
      if (action) {
        await runCommand(`companion_${panel}_${action}`, []);
        showToast(`${target.getAttribute('aria-label') || target.textContent.trim() || action} 已打开`);
      }
    };

    const calendarSave = els.companionPanel.querySelector('#calendar-save');
    if (calendarSave) {
      calendarSave.addEventListener('click', async () => {
        const eventDate = els.companionPanel.querySelector('#calendar-date').value || dateValue(calendarCursor);
        const eventStart = els.companionPanel.querySelector('#calendar-start').value || calendarDraft.start;
        const eventEnd = els.companionPanel.querySelector('#calendar-end').value || calendarDraft.end || eventStart;
        const result = await api('/api/calendar', {
          method: 'POST',
          body: JSON.stringify({
            title: els.companionPanel.querySelector('#calendar-title').value,
            date: eventDate,
            start: eventStart,
            end: eventEnd,
            guests: els.companionPanel.querySelector('#calendar-guests').value,
            location: els.companionPanel.querySelector('#calendar-location').value,
            description: els.companionPanel.querySelector('#calendar-description').value
          })
        });
        state = result.state;
        const parsedDate = parseDateValue(eventDate);
        if (parsedDate) calendarCursor = parsedDate;
        calendarDraft = null;
        showToast('活动已保存');
        render();
      });
      els.companionPanel.querySelector('#calendar-cancel').addEventListener('click', () => {
        calendarDraft = null;
        renderCompanionPanel();
      });
    }

    const taskSave = els.companionPanel.querySelector('#task-save');
    if (taskSave) {
      taskSave.addEventListener('click', async () => {
        const title = els.companionPanel.querySelector('#task-title').value.trim();
        if (!title) {
          els.companionPanel.querySelector('#task-title').focus();
          return;
        }
        const result = await api('/api/task', {
          method: 'POST',
          body: JSON.stringify({
            title,
            details: els.companionPanel.querySelector('#task-details').value,
            due: els.companionPanel.querySelector('#task-due').value,
            sourceMessageId: detailMessageId || ''
          })
        });
        state = result.state;
        taskDraftOpen = false;
        showToast('任务已添加');
        render();
      });
      els.companionPanel.querySelector('#task-cancel').addEventListener('click', () => {
        taskDraftOpen = false;
        renderCompanionPanel();
      });
      els.companionPanel.querySelector('#task-title').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') taskSave.click();
      });
      els.companionPanel.querySelector('#task-title').focus({ preventScroll: true });
    }

    const noteSave = els.companionPanel.querySelector('#note-save');
    if (noteSave) {
      noteSave.addEventListener('click', async () => {
        const result = await api('/api/note', {
          method: 'POST',
          body: JSON.stringify({
            title: els.companionPanel.querySelector('#note-title').value,
            body: els.companionPanel.querySelector('#note-body').value
          })
        });
        state = result.state;
        noteDraftOpen = false;
        showToast('记事已保存');
        render();
      });
      els.companionPanel.querySelector('#note-cancel').addEventListener('click', () => {
        noteDraftOpen = false;
        renderCompanionPanel();
      });
      els.companionPanel.querySelector('#note-title').focus({ preventScroll: true });
    }
  }

  async function updateSelection(ids) {
    state = await api('/api/select', {
      method: 'POST',
      body: JSON.stringify({ ids })
    });
    render();
  }

  function render() {
    closeActionMenu();
    els.categoryTabs.hidden = !!detailMessageId || activeLabel !== 'inbox';
    renderLabels();
    renderTabs();
    renderToolbar();
    renderMessages();
    renderCompanionPanel();
  }

  function openCompose() {
    els.compose.hidden = false;
    currentDraftId = null;
    els.to.value = '';
    els.cc.value = '';
    els.bcc.value = '';
    els.subject.value = '';
    els.body.value = '';
    els.ccWrap.hidden = true;
    els.bccWrap.hidden = true;
    els.to.focus();
  }

  function prefillCompose(payload) {
    openCompose();
    els.to.value = payload.to || '';
    els.cc.value = payload.cc || '';
    els.bcc.value = payload.bcc || '';
    els.subject.value = payload.subject || '';
    els.body.value = payload.body || '';
    els.ccWrap.hidden = !payload.cc;
    els.bccWrap.hidden = !payload.bcc;
  }

  function openDraft(draft) {
    els.compose.hidden = false;
    currentDraftId = draft.id;
    els.to.value = draft.to || '';
    els.cc.value = draft.cc || '';
    els.bcc.value = draft.bcc || '';
    els.subject.value = draft.subject || '';
    els.body.value = draft.body || '';
    els.ccWrap.hidden = !draft.cc;
    els.bccWrap.hidden = !draft.bcc;
    els.to.focus();
  }

  function composePayload() {
    return {
      id: currentDraftId,
      to: els.to.value,
      cc: els.cc.value,
      bcc: els.bcc.value,
      subject: els.subject.value,
      body: els.body.value
    };
  }

  function hasComposeContent() {
    const payload = composePayload();
    return !!(payload.to || payload.cc || payload.bcc || payload.subject || payload.body);
  }

  async function saveAndCloseCompose() {
    if (hasComposeContent()) {
      const result = await api('/api/draft', {
        method: 'POST',
        body: JSON.stringify(composePayload())
      });
      currentDraftId = result.draft.id;
      state = await api('/api/ui/state');
      showToast('草稿已保存');
    }
    els.compose.hidden = true;
    render();
  }

  async function sendCompose() {
    const payload = composePayload();
    if (!payload.to.trim()) {
      showToast('请先填写收件人');
      els.to.focus();
      return;
    }
    const result = await api('/api/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    state = result.state;
    els.compose.hidden = true;
    showToast('邮件已发送');
    render();
  }

  async function submitScheduledSend(option) {
    const result = await api('/api/schedule-send', {
      method: 'POST',
      body: JSON.stringify({
        ...composePayload(),
        scheduledAt: option.scheduledAt,
        scheduledLabel: option.label
      })
    });
    state = result.state;
    closeModal();
    els.compose.hidden = true;
    currentDraftId = null;
    activeLabel = 'scheduled';
    activeCategory = 'primary';
    detailMessageId = null;
    showToast(`邮件已安排在 ${option.label} 发送`);
    render();
  }

  function openScheduleSendDialog() {
    if (!composePayload().to.trim()) {
      showModal('错误', '<p class="modal-message">请指定至少一个收件人。</p>', '<button type="button" id="schedule-error-ok">确定</button>');
      els.modalFooter.querySelector('#schedule-error-ok').addEventListener('click', () => {
        closeModal();
        els.to.focus();
      });
      return;
    }
    const today = new Date();
    const tomorrow = addDays(today, 1);
    const monday = nextMonday(today);
    const options = [
      { title: '明天上午', subtitle: `${formatScheduleDate(tomorrow)} 08:00`, scheduledAt: toIsoAt(tomorrow, '08:00'), label: `${formatScheduleDate(tomorrow)} 08:00` },
      { title: '明天下午', subtitle: `${formatScheduleDate(tomorrow)} 13:00`, scheduledAt: toIsoAt(tomorrow, '13:00'), label: `${formatScheduleDate(tomorrow)} 13:00` },
      { title: '周一上午', subtitle: `${formatScheduleDate(monday)} 08:00`, scheduledAt: toIsoAt(monday, '08:00'), label: `${formatScheduleDate(monday)} 08:00` }
    ];
    showModal('定时发送', `
      <div class="schedule-dialog">
        <p>中国标准时间</p>
        ${options.map((option, index) => `
          <button type="button" class="schedule-option" data-schedule-index="${index}">
            <span>${escapeHtml(option.title)}</span>
            <strong>${escapeHtml(option.subtitle)}</strong>
          </button>
        `).join('')}
        <button type="button" class="schedule-option custom" id="schedule-custom">
          <span>${icons.clock}</span>
          <strong>选择日期和时间</strong>
        </button>
      </div>
    `);
    els.modalBody.querySelectorAll('[data-schedule-index]').forEach((button) => {
      button.addEventListener('click', () => submitScheduledSend(options[Number(button.dataset.scheduleIndex)]));
    });
    els.modalBody.querySelector('#schedule-custom').addEventListener('click', () => {
      const defaultDate = dateValue(tomorrow);
      els.modalBody.innerHTML = `
        <div class="schedule-dialog custom-time">
          <p>中国标准时间</p>
          <label class="modal-field"><span>日期</span><input id="custom-schedule-date" type="date" value="${defaultDate}" /></label>
          <label class="modal-field"><span>时间</span><input id="custom-schedule-time" type="time" value="08:00" /></label>
        </div>
      `;
      els.modalFooter.innerHTML = '<button type="button" id="schedule-back">返回</button><button type="button" id="schedule-save">安排发送</button>';
      els.modalFooter.querySelector('#schedule-back').addEventListener('click', openScheduleSendDialog);
      els.modalFooter.querySelector('#schedule-save').addEventListener('click', () => {
        const date = els.modalBody.querySelector('#custom-schedule-date').value;
        const time = els.modalBody.querySelector('#custom-schedule-time').value || '08:00';
        const [year, month, day] = date.split('-').map(Number);
        const labelDate = new Date(year, month - 1, day);
        submitScheduledSend({
          scheduledAt: `${date}T${time}:00+08:00`,
          label: `${formatScheduleDate(labelDate)} ${time}`
        });
      });
    });
  }

  function openSendOptionsMenu(anchor) {
    openActionMenu(anchor, [
      { label: '定时发送', run: async () => openScheduleSendDialog() },
      { label: '默认发送', run: async () => sendCompose() }
    ]);
  }

  function showCreateLabelDialog() {
    const parentOptions = userLabels().map((label) => (
      `<option value="${escapeHtml(label.id)}">${escapeHtml(labelDisplayName(label))}</option>`
    )).join('');
    showModal('新标签', `
      <label class="modal-field stacked"><span>请输入一个新的标签名称：</span><input id="new-label-name" aria-label="请输入一个新的标签名称：" /></label>
      <label class="modal-check"><input id="new-label-nested" type="checkbox" /> <span>将此标签嵌套到下面的标签内：</span></label>
      <label class="modal-field stacked parent-label-field">
        <span class="sr-only">父标签</span>
        <select id="new-label-parent" aria-label="将此标签嵌套到下面的标签内：" disabled>
          <option value=""></option>
          ${parentOptions}
        </select>
      </label>
    `, '<button type="button" id="create-label-cancel">取消</button><button type="button" id="create-label-save" disabled>创建</button>');
    const nameInput = els.modalBody.querySelector('#new-label-name');
    const nested = els.modalBody.querySelector('#new-label-nested');
    const parent = els.modalBody.querySelector('#new-label-parent');
    const save = els.modalFooter.querySelector('#create-label-save');
    const updateCreateState = () => {
      parent.disabled = !nested.checked;
      save.disabled = !nameInput.value.trim();
    };
    nameInput.focus();
    nameInput.addEventListener('input', updateCreateState);
    nested.addEventListener('change', updateCreateState);
    els.modalFooter.querySelector('#create-label-cancel').addEventListener('click', closeModal);
    save.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) {
        showToast('请填写标签名称');
        return;
      }
      const parentId = nested.checked ? parent.value : '';
      const result = await api('/api/label', {
        method: 'POST',
        body: JSON.stringify({ name, parentId })
      });
      state = result.state;
      closeModal();
      showToast('标签已创建');
      render();
    });
  }

  function showLabelManagementDialog() {
    const rows = userLabels().map((label) => `
      <tr>
        <td>${escapeHtml(label.name)}</td>
        <td>${escapeHtml(label.parentId ? labelPath(label.parentId).join('/') : '')}</td>
        <td>${label.unread || 0}</td>
      </tr>
    `).join('');
    showModal('标签设置', `
      <table class="label-settings-table">
        <thead><tr><th>标签</th><th>父标签</th><th>未读</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">没有用户标签</td></tr>'}</tbody>
      </table>
    `, '<button type="button" id="label-settings-new">创建新标签</button><button type="button" id="label-settings-close">关闭</button>');
    els.modalFooter.querySelector('#label-settings-new').addEventListener('click', showCreateLabelDialog);
    els.modalFooter.querySelector('#label-settings-close').addEventListener('click', closeModal);
  }

  function showSettingsDialog() {
    const settings = state.settings || {};
    showModal('快速设置', `
      <label class="modal-field"><span>显示密度</span><select id="setting-density"><option>默认</option><option>宽松</option><option>紧凑</option></select></label>
      <label class="modal-field"><span>收件箱类型</span><select id="setting-inbox"><option>默认</option><option>重要优先</option><option>未读优先</option></select></label>
      <label class="modal-field"><span>阅读窗格</span><select id="setting-pane"><option>不拆分</option><option>右侧</option><option>底部</option></select></label>
      <label class="modal-check"><input id="setting-notifications" type="checkbox" ${settings.desktopNotifications ? 'checked' : ''} /> <span>桌面通知</span></label>
    `, '<button type="button" id="settings-see-all">查看所有设置</button><button type="button" id="settings-save">保存</button>');
    els.modalBody.querySelector('#setting-density').value = settings.density || '默认';
    els.modalBody.querySelector('#setting-inbox').value = settings.inboxType || '默认';
    els.modalBody.querySelector('#setting-pane').value = settings.readingPane || '不拆分';
    els.modalFooter.querySelector('#settings-see-all').addEventListener('click', async () => {
      await runCommand('open_full_settings');
      showToast('已打开所有设置（mock）');
    });
    els.modalFooter.querySelector('#settings-save').addEventListener('click', async () => {
      state = await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          settings: {
            density: els.modalBody.querySelector('#setting-density').value,
            inboxType: els.modalBody.querySelector('#setting-inbox').value,
            readingPane: els.modalBody.querySelector('#setting-pane').value,
            desktopNotifications: els.modalBody.querySelector('#setting-notifications').checked
          }
        })
      });
      closeModal();
      showToast('设置已保存');
      render();
    });
  }

  function showFilterDialog(ids = []) {
    const first = ids.length ? state.messages.find((message) => message.id === ids[0]) : null;
    showModal('创建过滤器', `
      <label class="modal-field"><span>发件人</span><input id="filter-from" value="${escapeHtml(first?.fromEmail || first?.from || '')}" /></label>
      <label class="modal-field"><span>收件人</span><input id="filter-to" /></label>
      <label class="modal-field"><span>主题</span><input id="filter-subject" value="${escapeHtml(first?.subject || '')}" /></label>
      <label class="modal-field"><span>包含字词</span><input id="filter-has" /></label>
      <label class="modal-field"><span>不包含</span><input id="filter-not" /></label>
      <label class="modal-check"><input id="filter-attachment" type="checkbox" ${first?.hasAttachment ? 'checked' : ''} /> <span>含附件</span></label>
      <label class="modal-check"><input id="filter-archive" type="checkbox" /> <span>跳过收件箱（归档）</span></label>
      <label class="modal-check"><input id="filter-read" type="checkbox" /> <span>标记为已读</span></label>
      <label class="modal-check"><input id="filter-star" type="checkbox" /> <span>加星标</span></label>
      <label class="modal-check"><input id="filter-important" type="checkbox" /> <span>始终标为重要</span></label>
    `, '<button type="button" id="filter-cancel">取消</button><button type="button" id="filter-save">创建过滤器</button>');
    els.modalFooter.querySelector('#filter-cancel').addEventListener('click', closeModal);
    els.modalFooter.querySelector('#filter-save').addEventListener('click', async () => {
      const result = await api('/api/filter', {
        method: 'POST',
        body: JSON.stringify({
          from: els.modalBody.querySelector('#filter-from').value,
          to: els.modalBody.querySelector('#filter-to').value,
          subject: els.modalBody.querySelector('#filter-subject').value,
          hasWords: els.modalBody.querySelector('#filter-has').value,
          doesntHave: els.modalBody.querySelector('#filter-not').value,
          hasAttachment: els.modalBody.querySelector('#filter-attachment').checked,
          actions: {
            archive: els.modalBody.querySelector('#filter-archive').checked,
            markRead: els.modalBody.querySelector('#filter-read').checked,
            star: els.modalBody.querySelector('#filter-star').checked,
            alwaysImportant: els.modalBody.querySelector('#filter-important').checked
          }
        })
      });
      state = result.state;
      closeModal();
      showToast('过滤器已创建');
      render();
    });
  }

  function bindEvents() {
    els.searchInput.addEventListener('input', () => {
      search = els.searchInput.value;
      els.searchButton.disabled = !search.trim();
      resetPaging();
      renderMessages();
      renderToolbar();
    });
    document.querySelector('.search').addEventListener('submit', (event) => {
      event.preventDefault();
      search = els.searchInput.value;
      resetPaging();
      render();
    });
    els.composeButton.addEventListener('click', openCompose);
    els.closeCompose.addEventListener('click', saveAndCloseCompose);
    els.minimizeCompose.addEventListener('click', saveAndCloseCompose);
    els.discardDraft.addEventListener('click', async () => {
      if (currentDraftId) {
        state = await api('/api/draft/delete', {
          method: 'POST',
          body: JSON.stringify({ id: currentDraftId })
        });
        currentDraftId = null;
      }
      els.compose.hidden = true;
      showToast('草稿已舍弃');
      render();
    });
    els.sendButton.addEventListener('click', sendCompose);
    els.sendOptionsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openSendOptionsMenu(event.currentTarget);
    });
    [els.to, els.cc, els.bcc].forEach((input) => {
      input.addEventListener('input', () => showRecipientSuggestions(input));
      input.addEventListener('focus', () => showRecipientSuggestions(input));
      input.addEventListener('click', () => showRecipientSuggestions(input));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeRecipientMenu();
      });
    });
    els.ccButton.addEventListener('click', () => {
      els.ccWrap.hidden = false;
      els.cc.focus();
    });
    els.bccButton.addEventListener('click', () => {
      els.bccWrap.hidden = false;
      els.bcc.focus();
    });
    els.advancedButton.addEventListener('click', () => {
      els.advanced.hidden = false;
      els.advFrom.focus();
    });
    els.closeAdvanced.addEventListener('click', () => {
      els.advanced.hidden = true;
    });
    els.advancedClear.addEventListener('click', () => {
      els.advFrom.value = '';
      els.advTo.value = '';
      els.advSubject.value = '';
      els.advHas.value = '';
      els.advNot.value = '';
      els.advLabel.value = '';
      els.advAttachment.checked = false;
      advanced = { from: '', to: '', subject: '', has: '', not: '', label: '', hasAttachment: false };
      els.advanced.hidden = true;
      resetPaging();
      render();
    });
    els.advancedApply.addEventListener('click', () => {
      advanced = {
        from: els.advFrom.value.trim(),
        to: els.advTo.value.trim(),
        subject: els.advSubject.value.trim(),
        has: els.advHas.value.trim(),
        not: els.advNot.value.trim(),
        label: els.advLabel.value,
        hasAttachment: els.advAttachment.checked
      };
      els.advanced.hidden = true;
      resetPaging();
      render();
    });
    els.modalClose.addEventListener('click', closeModal);
    els.settingsButton.addEventListener('click', showSettingsDialog);
    els.createLabelButton.addEventListener('click', showCreateLabelDialog);
    els.noticeEnable.addEventListener('click', async () => {
      state = await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ settings: { desktopNotifications: true } })
      });
      els.notice.hidden = true;
      showToast('桌面通知已启用');
    });
    els.noticeDismiss.addEventListener('click', async () => {
      await runCommand('dismiss_desktop_notification_prompt');
      els.notice.hidden = true;
      showToast('已关闭通知提示');
    });
    els.noticeClose.addEventListener('click', async () => {
      await runCommand('close_desktop_notification_prompt');
      els.notice.hidden = true;
    });
    els.hideSidePanel.addEventListener('click', async () => {
      activeCompanionPanel = null;
      state = await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ settings: { activeCompanionPanel: null } })
      });
      renderCompanionPanel();
      showToast('侧边栏面板已隐藏');
    });
    document.querySelectorAll('[data-panel]').forEach((button) => {
      button.addEventListener('click', async () => {
        const panel = button.dataset.panel;
        activeCompanionPanel = activeCompanionPanel === panel ? null : panel;
        state = await api('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ settings: { activeCompanionPanel } })
        });
        await runCommand(activeCompanionPanel ? `open_${activeCompanionPanel}` : 'close_companion_panel', []);
        render();
      });
    });
    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', async () => {
        await runCommand(button.dataset.command, detailMessageId ? [detailMessageId] : selectedIds());
        showToast(`${button.getAttribute('aria-label') || button.dataset.command} 已打开`);
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        els.advanced.hidden = true;
        closeModal();
        closeActionMenu();
        closeRecipientMenu();
      }
      if (event.key.toLowerCase() === 'c' && !event.metaKey && !event.ctrlKey && document.activeElement === document.body) {
        openCompose();
      }
    });
    document.addEventListener('click', (event) => {
      if (recipientMenuEl && !recipientMenuEl.contains(event.target) && !event.target.closest('#to-field, #cc-field, #bcc-field')) {
        closeRecipientMenu();
      }
      if (!openMenuEl) return;
      if (openMenuEl.contains(event.target) || event.target.closest('#toolbar, .compose-actions')) return;
      closeActionMenu();
    });
  }

  bindEvents();
  loadSession().then(loadState).catch((err) => {
    showToast(err.message);
  });
})();
