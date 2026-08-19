/* CCB L2 interaction runtime (shared).
 *
 * The served admin pages are real Shopify DOM with all scripts stripped, so the
 * Polaris React/Web-Component behaviour is gone. This runtime + the per-domain
 * adapters (loaded right after, also `defer`) re-wire just enough behaviour to
 * make lists render from, and forms write to, the validated /api/admin/* backend
 * — keeping UI ⇄ REST ⇄ GraphQL ⇄ MCP on the same `saved` state.
 *
 * Everything is additive and defensive: any failure logs and leaves the pristine
 * 1:1 snapshot untouched. Web components are inert here, so we pierce shadow DOM
 * by hand (`$`/`$$`/`byName`) and write native inputs via the prototype setter.
 */
(function () {
  'use strict';
  if (window.CCB) return;

  // --- shadow-piercing queries --------------------------------------------
  function deepQuery(root, sel, all) {
    const acc = all ? [] : null;
    const here = root.querySelectorAll(sel);
    if (all) here.forEach((n) => acc.push(n));
    else if (here.length) return here[0];
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const sub = deepQuery(el.shadowRoot, sel, all);
        if (all) sub.forEach((n) => acc.push(n));
        else if (sub) return sub;
      }
    }
    return all ? acc : null;
  }
  const $ = (sel, root) => deepQuery(root || document, sel, false);
  const $$ = (sel, root) => deepQuery(root || document, sel, true);

  // Find a named <input>/<textarea>/<select> anywhere, including across shadow.
  function byName(name, root) {
    root = root || document;
    for (const el of root.querySelectorAll('input,textarea,select')) {
      if (el.getAttribute('name') === name) return el;
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const x = byName(name, el.shadowRoot);
        if (x) return x;
      }
    }
    return null;
  }

  // Read a named control's value (null if absent). Handles checkbox.
  function readName(name) {
    const el = byName(name);
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  }

  // Write via the native prototype setter so any (re-wired) listeners fire.
  function setNativeValue(el, val) {
    if (!el) return;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, val); else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // --- backend helpers ----------------------------------------------------
  function storePrefix() {
    const m = location.pathname.match(/^\/store\/[^/]+/);
    return m ? m[0] : '';
  }
  function routeSub() {
    const sub = location.pathname.slice(storePrefix().length);
    return sub || '/';
  }
  function apiGet(path) {
    return fetch(path, { headers: { accept: 'application/json' } }).then((r) => r.json());
  }
  function apiSend(method, path, body) {
    return fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  }
  const apiPost = (path, body) => apiSend('POST', path, body);
  const apiPut = (path, body) => apiSend('PUT', path, body);
  function goto(sub) { location.assign(storePrefix() + sub); }

  // --- minimal Polaris-ish toast (bottom-center dark pill) ----------------
  function toast(message, opts) {
    opts = opts || {};
    let host = document.getElementById('ccb-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ccb-toast-host';
      host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'background:' + (opts.error ? '#e51c00' : '#1a1a1a') + ';color:#fff;padding:10px 16px;border-radius:8px;font:500 13px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);max-width:80vw;';
    host.appendChild(el);
    setTimeout(() => el.remove(), opts.duration || 2600);
  }

  // --- adapter registry ---------------------------------------------------
  const adapters = [];
  function run(a) {
    try {
      const sub = routeSub();
      if (a.test(sub)) a.init(CCB, sub);
    } catch (e) { console.error('[CCB] adapter error', e); }
  }

  const CCB = {
    $, $$, byName, readName, setNativeValue,
    apiGet, apiPost, apiPut, storePrefix, routeSub, goto, toast,
    register(a) { adapters.push(a); run(a); },
  };
  window.CCB = CCB;
})();
