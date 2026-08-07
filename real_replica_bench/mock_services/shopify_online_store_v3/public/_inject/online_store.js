/* RRB L2 adapter — 在线商店 embedded pages (偏好设置 + 主题).
 *
 * Runs INSIDE the /_embedded/<page>.html iframe (same origin as the mock, so it
 * can fetch /api/* and drive its own DOM). The captured pages are real Shopify
 * DOM with scripts stripped → the Polaris controls are inert. This adapter
 * re-animates just enough to make them operable against the validated
 * /api/admin/online_store/* backend (which shares the `saved` state the verifier
 * reads). Self-contained: depends on nothing else loading in the iframe.
 *
 * 偏好设置: 6 toggle switches (button.Online-Store-UI-Switch_*) + the 主页标题 /
 *   元描述 fields → GET reflect, click/change → PUT, server validates.
 * 主题: theme-editor anchors get target="_top" (else they'd load the admin editor
 *   inside this small iframe); the inert "..." action menus are re-animated into a
 *   lightweight 发布模板 popover → POST .../themes/<id>/publish.
 */
(function () {
  'use strict';
  const apiGet = (p) => fetch(p, { headers: { accept: 'application/json' } }).then((r) => r.json());
  const apiSend = (m, p, b) => fetch(p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const apiPut = (p, b) => apiSend('PUT', p, b);
  const apiPost = (p, b) => apiSend('POST', p, b);

  function toast(message, opts) {
    opts = opts || {};
    if (window.RRB && window.RRB.toast) return window.RRB.toast(message, opts);
    let host = document.getElementById('rrb-toast-host');
    if (!host) { host = document.createElement('div'); host.id = 'rrb-toast-host'; host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'background:' + (opts.error ? '#e51c00' : '#1a1a1a') + ';color:#fff;padding:10px 16px;border-radius:8px;font:500 13px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);';
    host.appendChild(el);
    setTimeout(() => el.remove(), opts.duration || 2400);
  }

  const path = location.pathname;
  if (/preferences/.test(path)) initPreferences();
  else if (/themes/.test(path)) initThemes();

  // ---------------- 偏好设置 ----------------
  function fieldFor(aria) {
    aria = aria || '';
    if (/联系表单|评论/.test(aria)) return 'contactCaptcha';
    if (/登录|创建账户|密码恢复/.test(aria)) return 'accountCaptcha';
    if (/B2B/.test(aria)) return 'b2bOnly';
    if (/语言/.test(aria)) return 'languageRedirect';
    if (/国家|地区/.test(aria)) return 'countryRedirect';
    if (/密码|访客/.test(aria)) return 'passwordProtected';
    return null;
  }

  function setCounter(max, len) {
    const re = new RegExp('已使用\\s*\\d+/' + max + ' 个字符');
    const node = [...document.querySelectorAll('p,span')].find((n) => n.children.length === 0 && re.test(n.textContent));
    if (node) node.textContent = node.textContent.replace(/已使用\s*\d+/, '已使用 ' + len);
  }

  async function initPreferences() {
    const switches = [...document.querySelectorAll('button[class*="Online-Store-UI-Switch_"]')];
    let onClass = 'Online-Store-UI-Switch--on_1b3gf';
    for (const b of switches) for (const c of b.classList) if (/^Online-Store-UI-Switch--on_/.test(c)) onClass = c;
    const setTog = (b, on) => { b.classList.toggle(onClass, on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); };

    let p = {};
    try { p = (await apiGet('/api/admin/online_store/preferences')).preferences || {}; } catch (e) { /* keep captured defaults */ }

    for (const b of switches) {
      const f = fieldFor(b.getAttribute('aria-label'));
      if (!f) continue;
      setTog(b, !!p[f]);
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        const next = !b.classList.contains(onClass);
        setTog(b, next);
        const res = await apiPut('/api/admin/online_store/preferences', { [f]: next });
        if (res && res.status === 200) toast('已保存'); else { setTog(b, !next); toast('保存失败', { error: true }); }
      });
    }

    const title = document.querySelector('input[maxlength="70"]');
    const meta = document.querySelector('textarea[maxlength="320"]') || document.querySelector('textarea');
    wireText(title, 'homepageTitle', 70, p.homepageTitle || '');
    wireText(meta, 'metaDescription', 320, p.metaDescription || '');
  }

  function wireText(el, field, max, val) {
    if (!el) return;
    el.value = val; setCounter(max, val.length);
    el.addEventListener('input', () => setCounter(max, el.value.length));
    el.addEventListener('change', async () => {
      const res = await apiPut('/api/admin/online_store/preferences', { [field]: el.value });
      if (res && res.status === 200) toast('已保存'); else toast('保存失败', { error: true });
    });
  }

  // ---------------- 主题 ----------------
  function initThemes() {
    // editor / admin links must navigate the TOP window, not this iframe.
    for (const a of document.querySelectorAll('a[href^="/store/"]')) a.setAttribute('target', '_top');
    // re-animate the inert "..." action menus → 发布模板.
    for (const btn of document.querySelectorAll('s-internal-button')) {
      if (!/模板操作/.test(btn.getAttribute('accessibilitylabel') || '')) continue;
      const id = themeIdNear(btn);
      if (!id) continue;
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openThemeMenu(btn, id); });
    }
  }

  function themeIdNear(btn) {
    let el = btn;
    for (let i = 0; i < 9 && el; i++, el = el.parentElement) {
      const a = el.querySelector && el.querySelector('a[href*="/themes/"][href*="/editor"]');
      if (a) { const m = (a.getAttribute('href') || '').match(/\/themes\/([^/]+)\/editor/); if (m) return m[1]; }
    }
    return null;
  }

  function openThemeMenu(anchorEl, id) {
    const existing = document.getElementById('rrb-theme-menu'); if (existing) { existing.remove(); return; }
    const r = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'rrb-theme-menu';
    menu.style.cssText = 'position:fixed;z-index:99999;background:#fff;border:1px solid #e3e3e3;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.18);padding:6px;min-width:170px;font:500 13px/1.4 -apple-system,system-ui,sans-serif;';
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, r.right - 170) + 'px';
    const item = document.createElement('button');
    item.type = 'button'; item.textContent = '发布模板';
    item.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;border:0;background:none;border-radius:6px;cursor:pointer;color:#303030;';
    item.addEventListener('mouseenter', () => { item.style.background = '#f1f1f1'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
    item.addEventListener('click', async () => {
      menu.remove();
      const res = await apiPost('/api/admin/online_store/themes/' + id + '/publish', {});
      if (res && res.status === 200) toast('已设为当前模板'); else toast('发布失败', { error: true });
    });
    menu.appendChild(item);
    document.body.appendChild(menu);
    setTimeout(() => { document.addEventListener('click', function h() { menu.remove(); document.removeEventListener('click', h); }); }, 0);
  }
})();
