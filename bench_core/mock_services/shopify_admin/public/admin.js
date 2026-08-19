// 公共 JS - 处理 session、ui token、toast、路由跳转
//
// Server requires X-Ui-Token on /api/submit (and /api/score for non-verifier
// callers). The token is issued by /api/session and /api/reset and is
// per-session; cache it in sessionStorage keyed by sessionId so a hard reload
// of result.html still has access to it.
(function () {
  function getCurrentPage() {
    return document.body.getAttribute('data-page') || 'product';
  }
  function sessionKey(page) {
    return 'shopify_admin_session_' + (page || getCurrentPage());
  }
  function uiTokenKey(sessionId) {
    return 'shopify_admin_ui_token_' + sessionId;
  }

  function getSessionFromCache(page) {
    return localStorage.getItem(sessionKey(page));
  }
  function setSessionCache(id, page) {
    localStorage.setItem(sessionKey(page), id);
  }
  function clearSessionCache(page) {
    localStorage.removeItem(sessionKey(page));
  }

  function storeUiToken(sessionId, token) {
    if (sessionId && token) sessionStorage.setItem(uiTokenKey(sessionId), token);
  }
  function getUiToken(sessionId) {
    return sessionId ? (sessionStorage.getItem(uiTokenKey(sessionId)) || '') : '';
  }

  async function ensureSession(page) {
    const p = page || getCurrentPage();
    let id = getSessionFromCache(p);
    if (id && getUiToken(id)) return id;
    // Either no cached session, or we lost the ui token (e.g. sessionStorage
    // cleared) — re-fetch /api/session so the server hands back a fresh token.
    const r = await fetch('/api/session?page=' + encodeURIComponent(p), { credentials: 'same-origin' });
    const data = await r.json();
    id = data.sessionId;
    setSessionCache(id, p);
    storeUiToken(id, data.uiToken);
    return id;
  }

  function toast(msg, ms) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms || 2200);
  }

  // Inject session id span on load (skip when there's no page binding, e.g. result page)
  const page = document.body.getAttribute('data-page');
  if (page) {
    ensureSession(page).then((id) => {
      const span = document.getElementById('session-id');
      if (span) span.textContent = id.slice(0, 8) + '…';
    });
  }

  document.addEventListener('click', async (e) => {
    if (e.target.id === 'reset-session') {
      e.preventDefault();
      if (!confirm('重置会话会归档当前数据，是否继续？')) return;
      const p = getCurrentPage();
      const r = await fetch('/api/reset?page=' + encodeURIComponent(p), { method: 'POST', credentials: 'same-origin' });
      const data = await r.json();
      setSessionCache(data.sessionId, p);
      storeUiToken(data.sessionId, data.uiToken);
      toast('已重置，新会话 ' + data.sessionId.slice(0, 8));
      setTimeout(() => location.reload(), 800);
    }
  });

  // export
  window.AdminAPI = {
    ensureSession,
    setSessionCache,
    clearSessionCache,
    storeUiToken,
    getUiToken,
    getCurrentPage,
    toast,
  };
})();
