/* RRB L2 — products domain adapter.
 *
 * LIST (/products): render real /api/admin/products into a 1:1 IndexTable by
 * stamping the captured real row template (public/_inject/tpl/products_row.html)
 * — using setHTMLUnsafe so the declarative shadow DOM inside each Polaris cell
 * widget (s-thumbnail / s-internal-badge / s-internal-text) is re-parsed. The
 * served snapshot is the empty-state (the real store has 0 products); when the
 * API has rows we hide the empty-state and inject the captured table scaffold.
 *
 * FORM (/products/new, /products/:id): added in the form-adapter wave.
 */
(function () {
  'use strict';
  const C = window.RRB;
  if (!C) return;

  // status -> [badge tone, label]; tone classes exist in the badge shadow sheet.
  const BADGE = {
    active: ['success', '已上架'],
    draft: ['info', '草稿'],
    archived: ['info', '已归档'],
  };

  // The badge/inventory widgets bake their tone into the shadow's inner class,
  // and the script that maps the `tone` attribute is stripped — so set BOTH the
  // host attr/slot-text AND the shadow inner class.
  function setToneWidget(host, innerSel, tone, text) {
    if (!host) return;
    host.setAttribute('tone', tone);
    host.textContent = text; // light-DOM slot text (shadowRoot is separate, untouched)
    const inner = host.shadowRoot && host.shadowRoot.querySelector(innerSel);
    if (inner) inner.className = inner.className.replace(/tone-[a-z]+/, 'tone-' + tone);
  }

  function setThumb(thumb, p) {
    if (!thumb) return;
    thumb.setAttribute('alt', p.title || '');
    if (p.image && thumb.shadowRoot) {
      const box = thumb.shadowRoot.querySelector('.thumbnail');
      if (box) {
        const img = document.createElement('img');
        img.src = p.image;
        img.alt = p.title || '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
        box.replaceChildren(img);
      }
    }
  }

  function fillRow(row, p, prefix) {
    const id = p.id;
    const gid = 'gid://shopify/Product/' + id;
    const at = (n) => row.querySelector('[aria-colindex="' + n + '"]');

    // col1 — selection checkbox (unique id+label) + accessible gid label
    const cb = at(1) && at(1).querySelector('input.Polaris-Checkbox__Input');
    const lbl = at(1) && at(1).querySelector('label.Polaris-Choice');
    const uid = 'rrb-cb-' + id;
    if (cb) cb.id = uid;
    if (lbl) lbl.setAttribute('for', uid);
    const a11y = at(1) && at(1).querySelector('.Polaris-Choice__Label .Polaris-Text--visuallyHidden');
    if (a11y) a11y.textContent = '选择 ' + gid;

    // col2 — thumbnail
    setThumb(at(2) && at(2).querySelector('s-thumbnail'), p);

    // col3 — title + link
    const a = at(3) && (at(3).querySelector('a[data-primary-link="true"]') || at(3).querySelector('a'));
    if (a) {
      a.setAttribute('href', prefix + '/products/' + id);
      const t = a.querySelector('._LineClamp_i51pb_8') || a.querySelector('span');
      if (t) t.textContent = p.title || '';
    }

    // col4 — status badge
    const [tone, text] = BADGE[p.status] || BADGE.active;
    setToneWidget(at(4) && at(4).querySelector('s-internal-badge'), '.badge', tone, text);

    // col5 — inventory (critical when 0, otherwise default)
    const qty = Number(p.inventoryQuantity || 0);
    setToneWidget(at(5) && at(5).querySelector('s-internal-text'), '.text',
      qty <= 0 ? 'critical' : 'auto', qty + ' 件库存');

    // col6 — category
    const cat = at(6) && at(6).querySelector('._Wrapper_i51pb_1');
    if (cat) cat.textContent = p.category || '未分类';

    // col8 — product type (empty cell in the template → inject the span shape)
    const typeCell = at(8) && at(8).querySelector('.Polaris-Table-TableCell__TableCellContent');
    if (typeCell) {
      typeCell.textContent = '';
      if (p.productType) {
        const w = document.createElement('span'); w.className = 'Polaris-Text--root';
        const i = document.createElement('span'); i.className = '_Wrapper_i51pb_1';
        i.textContent = p.productType; w.appendChild(i); typeCell.appendChild(w);
      }
    }

    // col9 — vendor
    const vend = at(9) && at(9).querySelector('._Wrapper_i51pb_1');
    if (vend) vend.textContent = p.vendor || '';
  }

  async function renderList() {
    const data = await C.apiGet('/api/admin/products').catch(() => null);
    if (!data || !Array.isArray(data.products) || !data.products.length) return; // keep empty-state
    const [scaffoldHtml, rowHtml] = await Promise.all([
      fetch('/_inject/tpl/products_table.html').then((r) => r.text()),
      fetch('/_inject/tpl/products_row.html').then((r) => r.text()),
    ]);
    // The served page is the empty-state, whose header has NO primary action
    // (its 添加产品 CTA lives in the body). Swap the whole Polaris-Page for the
    // captured with-data page (header with 添加产品/导出/更多操作 + filter + table).
    const oldPage = document.querySelector('.Polaris-Page');
    if (!oldPage) return;
    const holder = document.createElement('div');
    holder.setHTMLUnsafe(scaffoldHtml);
    const newPage = holder.firstElementChild;
    if (!newPage) return;
    oldPage.replaceWith(newPage);

    const tbody = newPage.querySelector('.Polaris-Table-TableBody');
    if (!tbody) return;
    const prefix = C.storePrefix();
    const scratch = document.createElement('div');
    for (const p of data.products) {
      scratch.setHTMLUnsafe(rowHtml);
      const row = scratch.firstElementChild;
      if (!row) continue;
      fillRow(row, p, prefix);
      tbody.appendChild(row);
    }
  }

  C.register({
    test: (sub) => /^\/products\/?$/.test(sub),
    init: () => renderList().catch((e) => console.error('[RRB products list]', e)),
  });

  // =========================================================================
  // FORM: /products/new (create) and /products/:id (edit)
  // =========================================================================

  // Real new-product status options; backend enum is active/draft/archived.
  const STATUS_OPTIONS = [['active', '已上架'], ['draft', '草稿'], ['archived', '已归档']];
  const WEIGHT_UNIT = { POUNDS: 'lb', OUNCES: 'oz', KILOGRAMS: 'kg', GRAMS: 'g' };
  // Read-only mirror of server.js state.collections (~L272) so the 产品系列 picker
  // can list collections WITHOUT a new endpoint (admin Collections CRUD was
  // intentionally reverted — do not rebuild it; keep this in sync with the seed).
  const COLLECTIONS = [
    { id: 'frontpage', title: '主页' },
    { id: 'all', title: '所有产品' },
    { id: 'launch', title: '2026 Mock Launch Collection' },
  ];
  const TYPE_SUGGESTIONS = ['T 恤', '配饰', '家居用品', '电子产品', '美妆个护', '食品饮料'];
  const VENDOR_SUGGESTIONS = ['我的商店', 'Acme', 'Studio Goods'];
  // 类别 options come from the real Shopify Standard Product Taxonomy subset baked
  // at public/_inject/categories.json (lazily fetched on first open).
  let CATEGORIES = null;
  function loadCategories() {
    if (CATEGORIES) return Promise.resolve(CATEGORIES);
    return fetch('/_inject/categories.json').then((r) => r.json())
      .then((d) => { CATEGORIES = (d && d.categories) || []; return CATEGORIES; })
      .catch(() => { CATEGORIES = []; return CATEGORIES; });
  }

  // 类别 — progressive Shopify-taxonomy picker (drill-down + search). Real Shopify reveals the
  // top-level categories first and drills into children one level at a time (it does NOT show 主类+
  // 子类 together — that flat full-path list was the bug). We build a tree from the flat full-path
  // list (real Shopify Standard Product Taxonomy subset in categories.json) and navigate it; typing
  // in the search box flattens to matching full paths (real does this too).
  let CAT_TREE = null;
  function buildCatTree(paths) {
    const root = { name: '', full: '', children: {} };
    for (const path of paths) {
      const parts = String(path).split('>').map((s) => s.trim()).filter(Boolean);
      let node = root, full = '';
      for (const part of parts) {
        full = full ? full + ' > ' + part : part;
        if (!node.children[part]) node.children[part] = { name: part, full, children: {} };
        node = node.children[part];
      }
    }
    return root;
  }
  function openCategoryPicker(host) {
    document.getElementById('rrb-menu')?.remove();
    const anchor = visibleAnchor(host) || host;
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'rrb-menu';
    menu.style.cssText = 'position:absolute;z-index:100000;background:#fff;border-radius:12px;'
      + 'box-shadow:0 4px 16px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.08);padding:6px;min-width:'
      + Math.max(280, Math.round(r.width)) + 'px;max-height:380px;overflow:auto;'
      + 'font:13px/1.4 -apple-system,system-ui,sans-serif;color:#303030;';
    menu.style.left = (r.left + window.scrollX) + 'px';
    menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
    const search = document.createElement('input');
    search.type = 'text'; search.placeholder = '搜索类别';
    search.style.cssText = 'width:100%;box-sizing:border-box;margin:2px 0 6px;padding:7px 10px;'
      + 'border:1px solid #8a8a8a;border-radius:8px;font:13px/1.4 inherit;outline:none;';
    const crumb = document.createElement('div');
    crumb.style.cssText = 'display:none;align-items:center;gap:6px;padding:4px 8px 6px;color:#616161;flex-wrap:wrap;';
    const listWrap = document.createElement('div');
    menu.appendChild(search); menu.appendChild(crumb); menu.appendChild(listWrap);

    const selected = host.dataset.rrbValue || '';
    let stack = [CAT_TREE];
    function select(full) { host.dataset.rrbValue = full; setPickerValueText(host, full); menu.remove(); }
    function childrenOf(node) { return Object.keys(node.children).map((k) => node.children[k]); }
    function row(label, opts) {
      opts = opts || {};
      const it = document.createElement('div');
      it.className = 'rrb-menu-item';
      it.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;cursor:pointer;';
      const check = document.createElement('span');
      check.textContent = opts.checked ? '✓' : '';
      check.style.cssText = 'width:14px;flex:0 0 14px;';
      const text = document.createElement('span');
      text.textContent = label; text.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      it.appendChild(check); it.appendChild(text);
      if (opts.chevron) { const c = document.createElement('span'); c.textContent = '›'; c.style.cssText = 'flex:0 0 14px;color:#8a8a8a;font-size:16px;text-align:right;'; it.appendChild(c); }
      it.onmouseenter = () => { it.style.background = '#f1f1f1'; };
      it.onmouseleave = () => { it.style.background = ''; };
      return it;
    }
    function renderCrumb() {
      crumb.replaceChildren();
      if (stack.length <= 1) { crumb.style.display = 'none'; return; }
      crumb.style.display = 'flex';
      const back = document.createElement('span');
      back.textContent = '← 返回'; back.style.cssText = 'cursor:pointer;color:#0057d9;';
      back.onclick = (e) => { e.stopPropagation(); stack.pop(); renderLevel(); };
      crumb.appendChild(back);
      const cur = stack[stack.length - 1];
      const path = document.createElement('span'); path.textContent = cur.full; path.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
      crumb.appendChild(path);
    }
    function renderLevel() {
      renderCrumb();
      listWrap.replaceChildren();
      const cur = stack[stack.length - 1];
      if (stack.length > 1) {
        const selRow = row('使用"' + cur.name + '"', { checked: selected === cur.full });
        selRow.onclick = (e) => { e.stopPropagation(); select(cur.full); };
        listWrap.appendChild(selRow);
      }
      const kids = childrenOf(cur);
      if (!kids.length) { return; }
      for (const child of kids) {
        const hasKids = Object.keys(child.children).length > 0;
        const it = row(child.name, { chevron: hasKids, checked: selected === child.full });
        it.onclick = (e) => { e.stopPropagation(); if (hasKids) { stack.push(child); renderLevel(); } else select(child.full); };
        listWrap.appendChild(it);
      }
    }
    function renderSearch(q) {
      crumb.style.display = 'none';
      listWrap.replaceChildren();
      const matches = (CATEGORIES || []).filter((p) => String(p).toLowerCase().includes(q));
      if (!matches.length) { const e = document.createElement('div'); e.textContent = '无结果'; e.style.cssText = 'padding:8px 12px;color:#616161;'; listWrap.appendChild(e); return; }
      for (const full of matches.slice(0, 60)) {
        const it = row(full, { checked: selected === full });
        it.onclick = (e) => { e.stopPropagation(); select(full); };
        listWrap.appendChild(it);
      }
    }
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      if (q) renderSearch(q); else { stack = [CAT_TREE]; renderLevel(); }
    });
    renderLevel();
    document.body.appendChild(menu);
    setTimeout(() => search.focus(), 0);
    setTimeout(() => {
      const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close, true); } };
      document.addEventListener('click', close, true);
    }, 0);
  }
  function wireCategoryPicker() {
    const host = pickerHost('类别');
    if (!host) return;
    host.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      loadCategories().then((cs) => { if (!CAT_TREE) CAT_TREE = buildCatTree(cs); openCategoryPicker(host); });
    }, true);
  }

  // --- visible-rect helpers ------------------------------------------------
  // Picker hosts (s-internal-*-picker-field) are display:contents → 0×0 boxes, so
  // anchoring a menu to the HOST pins it to the top-left corner (the status-dropdown
  // bug). Resolve the visible inner control to anchor under instead.
  function rectOf(el) { const r = el && el.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? r : null; }
  // Query a host INCLUDING its own shadow root. C.$/deepQuery only descend into
  // DESCENDANTS' shadow roots, but the picker control box (._BorderGradient) and the
  // multi-picker text input live in the HOST's own shadow — so look there first.
  function deepIn(host, sel) {
    if (!host) return null;
    if (host.shadowRoot) { const x = host.shadowRoot.querySelector(sel); if (x) return x; }
    const l = host.querySelector(sel); if (l) return l;
    return C.$(sel, host);
  }
  function visibleAnchor(host) {
    if (!host) return null;
    if (rectOf(host)) return host;
    const sels = ['._BorderGradient_1cpz2_1', 's-internal-single-picker-field-value', 's-clickable-chip', 'input', 'button'];
    for (const s of sels) { const el = deepIn(host, s); if (el && rectOf(el)) return el; }
    if (host.shadowRoot) { for (const el of host.shadowRoot.querySelectorAll('*')) { if (rectOf(el)) return el; } }
    for (const el of host.querySelectorAll('*')) { if (rectOf(el)) return el; }
    return host;
  }

  // Shopify-popover-style menu anchored under a field's VISIBLE control. Supports an
  // optional search box (opts.search) + free-text custom values (opts.allowCustom);
  // opts.selected gets a ✓.
  function openMenu(anchorEl, options, onPick, opts) {
    opts = opts || {};
    document.getElementById('rrb-menu')?.remove();
    const anchor = visibleAnchor(anchorEl) || anchorEl;
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'rrb-menu';
    menu.style.cssText = 'position:absolute;z-index:100000;background:#fff;border-radius:12px;'
      + 'box-shadow:0 4px 16px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.08);padding:6px;min-width:'
      + Math.max(220, Math.round(r.width)) + 'px;max-height:340px;overflow:auto;'
      + 'font:13px/1.4 -apple-system,system-ui,sans-serif;color:#303030;';
    menu.style.left = (r.left + window.scrollX) + 'px';
    menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
    let filter = null;
    if (opts.search) {
      filter = document.createElement('input');
      filter.type = 'text';
      filter.placeholder = opts.searchPlaceholder || '搜索';
      filter.style.cssText = 'width:100%;box-sizing:border-box;margin:2px 0 6px;padding:7px 10px;'
        + 'border:1px solid #8a8a8a;border-radius:8px;font:13px/1.4 inherit;outline:none;';
      menu.appendChild(filter);
    }
    const listWrap = document.createElement('div');
    menu.appendChild(listWrap);
    function renderItems(items) {
      listWrap.replaceChildren();
      if (!items.length) {
        const e = document.createElement('div');
        e.textContent = opts.emptyText || '无结果';
        e.style.cssText = 'padding:8px 12px;color:#616161;';
        listWrap.appendChild(e); return;
      }
      for (const [val, label] of items) {
        const it = document.createElement('div');
        it.className = 'rrb-menu-item';
        it.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;cursor:pointer;';
        const check = document.createElement('span');
        check.textContent = (opts.selected != null && String(opts.selected) === String(val)) ? '✓' : '';
        check.style.cssText = 'width:14px;flex:0 0 14px;';
        const text = document.createElement('span');
        text.textContent = label; text.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;';
        it.appendChild(check); it.appendChild(text);
        it.onmouseenter = () => { it.style.background = '#f1f1f1'; };
        it.onmouseleave = () => { it.style.background = ''; };
        it.onclick = (e) => { e.stopPropagation(); onPick(val, label); menu.remove(); };
        listWrap.appendChild(it);
      }
    }
    const all = options.slice();
    renderItems(all);
    if (filter) {
      filter.addEventListener('input', () => {
        const q = filter.value.trim().toLowerCase();
        renderItems(q ? all.filter(([, l]) => String(l).toLowerCase().includes(q)) : all);
      });
      if (opts.allowCustom) {
        filter.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); const v = filter.value.trim(); if (v) { onPick(v, v); menu.remove(); } }
        });
      }
    }
    document.body.appendChild(menu);
    if (filter) setTimeout(() => filter.focus(), 0);
    setTimeout(() => {
      const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close, true); } };
      document.addEventListener('click', close, true);
    }, 0);
    return menu;
  }

  // Multi-select popover (checkbox rows, stays open). Mutates selSet, calls onChange.
  function openMultiMenu(anchorEl, options, selSet, onChange) {
    document.getElementById('rrb-menu')?.remove();
    const anchor = visibleAnchor(anchorEl) || anchorEl;
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'rrb-menu';
    menu.style.cssText = 'position:absolute;z-index:100000;background:#fff;border-radius:12px;'
      + 'box-shadow:0 4px 16px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.08);padding:6px;min-width:'
      + Math.max(220, Math.round(r.width)) + 'px;max-height:340px;overflow:auto;'
      + 'font:13px/1.4 -apple-system,system-ui,sans-serif;color:#303030;';
    menu.style.left = (r.left + window.scrollX) + 'px';
    menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
    for (const [val, label] of options) {
      const it = document.createElement('div');
      it.className = 'rrb-menu-item';
      it.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;cursor:pointer;';
      const box = document.createElement('span');
      box.textContent = selSet.has(String(val)) ? '☑' : '☐';
      box.style.cssText = 'width:14px;flex:0 0 14px;';
      const t = document.createElement('span'); t.textContent = label; t.style.flex = '1';
      it.appendChild(box); it.appendChild(t);
      it.onmouseenter = () => { it.style.background = '#f1f1f1'; };
      it.onmouseleave = () => { it.style.background = ''; };
      it.onclick = (e) => { e.stopPropagation(); const k = String(val); if (selSet.has(k)) selSet.delete(k); else selSet.add(k); box.textContent = selSet.has(k) ? '☑' : '☐'; onChange(); };
      menu.appendChild(it);
    }
    document.body.appendChild(menu);
    setTimeout(() => {
      const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close, true); } };
      document.addEventListener('click', close, true);
    }, 0);
    return menu;
  }

  // --- picker helpers ------------------------------------------------------
  function pickerHost(label) {
    return C.$('s-internal-single-picker-field[label="' + label + '"]')
      || C.$('s-internal-multi-picker-field[label="' + label + '"]');
  }
  function setPickerValueText(host, text) {
    if (!host) return;
    // 状态 keeps a light <s-internal-single-picker-field-value>; the empty pickers
    // (类别/类型/厂商) show their text via a `.placeholder` span in the host's shadow.
    const v = host.querySelector('s-internal-single-picker-field-value');
    if (v) { v.textContent = text; v.style.color = '#303030'; return; }
    const ph = host.shadowRoot && host.shadowRoot.querySelector('.placeholder, #empty-text');
    if (ph) { ph.textContent = text; ph.style.color = '#303030'; ph.style.opacity = '1'; }
  }
  // Read the slotted display text of a single-picker-field by its label (fallback).
  function pickerText(label) {
    const host = C.$('s-internal-single-picker-field[label="' + label + '"]');
    const v = host && host.querySelector('s-internal-single-picker-field-value');
    const t = v && v.textContent.trim();
    return (!t || t === '无') ? '' : t;
  }

  function chipEl(label, onRemove) {
    const chip = document.createElement('span');
    chip.className = 'rrb-chip';
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:#e3e3e3;border-radius:8px;'
      + 'padding:3px 8px;margin:2px 6px 2px 0;font:13px/1.4 -apple-system,system-ui,sans-serif;color:#303030;';
    const t = document.createElement('span'); t.textContent = label; chip.appendChild(t);
    const x = document.createElement('span'); x.textContent = '×'; x.className = 'rrb-chip-remove';
    x.style.cssText = 'cursor:pointer;font-weight:600;color:#616161;';
    x.onclick = (e) => { e.stopPropagation(); onRemove(); };
    chip.appendChild(x);
    return chip;
  }

  // 状态 / 类别 / 类型 / 厂商 — single-value pickers (value stored on host.dataset).
  function wireSinglePicker(label, getOptions, dataKey, opts) {
    const host = pickerHost(label);
    if (!host) return;
    opts = opts || {};
    host.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      Promise.resolve(getOptions()).then((options) => {
        openMenu(host, options, (val, lbl) => {
          host.dataset[dataKey] = val;
          setPickerValueText(host, lbl);
        }, { search: opts.search, searchPlaceholder: opts.searchPlaceholder, allowCustom: opts.allowCustom, selected: host.dataset[dataKey] });
      });
    }, true);
  }

  // 产品系列 — multi-select of existing collections, rendered as chips.
  function renderCollectionChips(host) {
    const addChip = deepIn(host, 's-clickable-chip');
    const container = (addChip && addChip.parentNode) || host;
    const sel = new Set(JSON.parse(host.dataset.rrbCollections || '[]'));
    container.querySelectorAll('.rrb-chip').forEach((c) => c.remove());
    for (const id of sel) {
      const c = COLLECTIONS.find((x) => x.id === id); if (!c) continue;
      const chip = chipEl(c.title, () => {
        const s = new Set(JSON.parse(host.dataset.rrbCollections || '[]')); s.delete(id);
        host.dataset.rrbCollections = JSON.stringify([...s]); renderCollectionChips(host);
      });
      if (addChip && addChip.parentNode) addChip.parentNode.insertBefore(chip, addChip); else host.appendChild(chip);
    }
  }
  function wireCollectionsPicker() {
    const host = pickerHost('产品系列');
    if (!host) return;
    if (!host.dataset.rrbCollections) host.dataset.rrbCollections = '[]';
    const open = (e) => {
      e.preventDefault(); e.stopPropagation();
      const sel = new Set(JSON.parse(host.dataset.rrbCollections || '[]'));
      openMultiMenu(host, COLLECTIONS.map((c) => [c.id, c.title]), sel, () => {
        host.dataset.rrbCollections = JSON.stringify([...sel]); renderCollectionChips(host);
      });
    };
    host.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.rrb-chip-remove')) return;
      open(e);
    }, true);
  }

  // 标记 — free-text tags via the captured input, rendered as chips.
  function renderTagChips(host) {
    const addChip = deepIn(host, 's-clickable-chip');
    const container = (addChip && addChip.parentNode) || host;
    const tags = JSON.parse(host.dataset.rrbTags || '[]');
    container.querySelectorAll('.rrb-chip').forEach((c) => c.remove());
    for (const tag of tags) {
      const chip = chipEl(tag, () => {
        const t = new Set(JSON.parse(host.dataset.rrbTags || '[]')); t.delete(tag);
        host.dataset.rrbTags = JSON.stringify([...t]); renderTagChips(host);
      });
      if (addChip && addChip.parentNode) addChip.parentNode.insertBefore(chip, addChip); else host.appendChild(chip);
    }
  }
  // The captured 标记 text input is buried in nested shadow we can't reach, so open
  // our own small input popover under the field (Enter/comma adds a tag chip).
  function openTagInput(host) {
    document.getElementById('rrb-menu')?.remove();
    const anchor = visibleAnchor(host) || host;
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'rrb-menu';
    menu.style.cssText = 'position:absolute;z-index:100000;background:#fff;border-radius:12px;'
      + 'box-shadow:0 4px 16px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.08);padding:8px;min-width:'
      + Math.max(220, Math.round(r.width)) + 'px;font:13px/1.4 -apple-system,system-ui,sans-serif;';
    menu.style.left = (r.left + window.scrollX) + 'px';
    menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.placeholder = '输入标记后按回车';
    inp.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #8a8a8a;border-radius:8px;font:13px/1.4 inherit;outline:none;';
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = inp.value.trim(); if (!v) return;
        const t = new Set(JSON.parse(host.dataset.rrbTags || '[]')); t.add(v);
        host.dataset.rrbTags = JSON.stringify([...t]); renderTagChips(host); inp.value = '';
      }
    });
    menu.appendChild(inp);
    document.body.appendChild(menu);
    setTimeout(() => inp.focus(), 0);
    setTimeout(() => {
      const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close, true); } };
      document.addEventListener('click', close, true);
    }, 0);
  }
  function wireTagsPicker() {
    const host = pickerHost('标记');
    if (!host) return;
    if (!host.dataset.rrbTags) host.dataset.rrbTags = '[]';
    host.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.rrb-chip-remove')) return;
      e.preventDefault(); e.stopPropagation(); openTagInput(host);
    }, true);
  }

  // --- description (inert TinyMCE iframe → editable + synced) ---------------
  // The srcdoc iframe may not have parsed its <body> yet when the defer scripts run,
  // so applying contentEditable can silently no-op. Retry on load + a short poll.
  function applyDescriptionEditable(ifr) {
    const doc = ifr.contentDocument;
    if (!doc || !doc.body) return false;
    // designMode is a DOCUMENT-level flag → survives the srcdoc body being replaced after a
    // late load (contentEditable on a specific body element does not). Set both, idempotently.
    try { doc.designMode = 'on'; } catch (er) { /* noop */ }
    try { doc.body.contentEditable = 'true'; doc.body.style.outline = 'none'; doc.body.removeAttribute('aria-hidden'); } catch (er) { /* noop */ }
    // Sync listener on the DOCUMENT (survives body replacement); attach once per document.
    if (!doc.__rrbSync) {
      doc.__rrbSync = true;
      const sync = () => { try { const ta = C.byName('descriptionHtml'); if (ta) C.setNativeValue(ta, doc.body.innerHTML); } catch (er) { /* noop */ } };
      doc.addEventListener('input', sync, true);
      doc.addEventListener('blur', sync, true);
    }
    return doc.designMode === 'on' || doc.body.isContentEditable;
  }
  // The mock captured an OLD TinyMCE toolbar; real Shopify now uses a custom rich-text
  // toolbar. Replace the captured toolbar with one rebuilt 1:1 from the real editor
  // (real class names + real icon SVGs in tpl/description_toolbar.html + the captured
  // CSS modules in description_toolbar.css), and wire its buttons to execCommand.
  // Clicking a PARENT-document toolbar button makes the parent the active document, so
  // execCommand on the iframe is ignored. Re-focus the iframe window + restore the range
  // captured on mousedown, then execCommand.
  function descExec(ifr, cmd, val, range) {
    try {
      const d = ifr.contentDocument;
      if (ifr.contentWindow) ifr.contentWindow.focus();
      if (range) { const sel = d.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
      d.execCommand(cmd, false, val == null ? null : val);
      if (C.byName('descriptionHtml')) C.setNativeValue(C.byName('descriptionHtml'), d.body.innerHTML);
    } catch (er) { /* noop */ }
  }
  function setFormatLabel(btn, text) { const l = btn.querySelector('.rrb-tb-label'); if (l) l.textContent = text; }
  function toggleCodeView(ifr) {
    const d = ifr.contentDocument; if (!d || !d.body) return;
    if (d.body.dataset.rrbCode === '1') { d.body.innerHTML = d.body.textContent || ''; d.body.dataset.rrbCode = '0'; }
    else { d.body.textContent = d.body.innerHTML; d.body.dataset.rrbCode = '1'; }
    if (C.byName('descriptionHtml')) C.setNativeValue(C.byName('descriptionHtml'), d.body.dataset.rrbCode === '1' ? (d.body.textContent || '') : d.body.innerHTML);
  }
  // small command popover (text rows / color swatches)
  function openCmdMenu(anchor, items) {
    document.getElementById('rrb-menu')?.remove();
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'rrb-menu'; menu.className = 'rrb-tb-menu';
    menu.style.cssText = 'position:absolute;z-index:100000;background:#fff;border-radius:12px;'
      + 'box-shadow:0 4px 16px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.08);padding:6px;min-width:180px;'
      + 'font:13px/1.4 -apple-system,system-ui,sans-serif;color:#303030;';
    menu.style.left = (r.left + window.scrollX) + 'px';
    menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'rrb-menu-item';
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;cursor:pointer;';
      row.onmouseenter = () => { row.style.background = '#f1f1f1'; };
      row.onmouseleave = () => { row.style.background = ''; };
      if (it.swatch) { const sw = document.createElement('span'); sw.style.cssText = 'width:16px;height:16px;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1);background:' + it.swatch; row.appendChild(sw); }
      const t = document.createElement('span'); t.textContent = it.label; row.appendChild(t);
      row.onclick = (e) => { e.stopPropagation(); it.run(); menu.remove(); };
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    setTimeout(() => { const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close, true); } }; document.addEventListener('click', close, true); }, 0);
  }
  function wireToolbarButton(btn, ifr) {
    const cmd = btn.getAttribute('data-rrb-cmd');
    let saved = null;
    const capture = () => { try { const sel = ifr.contentDocument.getSelection(); saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null; } catch (er) { saved = null; } };
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); capture(); }, true); // keep selection
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const R = saved;
      switch (cmd) {
        case 'bold': descExec(ifr, 'bold', null, R); break;
        case 'italic': descExec(ifr, 'italic', null, R); break;
        case 'underline': descExec(ifr, 'underline', null, R); break;
        case 'format': openCmdMenu(btn, [
          { label: '段落', run: () => { descExec(ifr, 'formatBlock', 'p', R); setFormatLabel(btn, '段落'); } },
          { label: '标题 1', run: () => { descExec(ifr, 'formatBlock', 'h1', R); setFormatLabel(btn, '标题 1'); } },
          { label: '标题 2', run: () => { descExec(ifr, 'formatBlock', 'h2', R); setFormatLabel(btn, '标题 2'); } },
          { label: '标题 3', run: () => { descExec(ifr, 'formatBlock', 'h3', R); setFormatLabel(btn, '标题 3'); } },
        ]); break;
        case 'color': openCmdMenu(btn, [['默认', '#303030'], ['红', '#d72c0d'], ['绿', '#0a7a3b'], ['蓝', '#0057d9'], ['紫', '#5b2a86']].map(([l, c]) => ({ label: l, swatch: c, run: () => descExec(ifr, 'foreColor', c, R) }))); break;
        case 'align': openCmdMenu(btn, [
          { label: '左对齐', run: () => descExec(ifr, 'justifyLeft', null, R) },
          { label: '居中', run: () => descExec(ifr, 'justifyCenter', null, R) },
          { label: '右对齐', run: () => descExec(ifr, 'justifyRight', null, R) },
          { label: '两端对齐', run: () => descExec(ifr, 'justifyFull', null, R) },
        ]); break;
        case 'link': { const url = window.prompt('链接 URL'); if (url) descExec(ifr, 'createLink', url, R); break; }
        case 'more': openCmdMenu(btn, [
          { label: '项目符号列表', run: () => descExec(ifr, 'insertUnorderedList', null, R) },
          { label: '编号列表', run: () => descExec(ifr, 'insertOrderedList', null, R) },
          { label: '减少缩进', run: () => descExec(ifr, 'outdent', null, R) },
          { label: '增加缩进', run: () => descExec(ifr, 'indent', null, R) },
          { label: '清除格式', run: () => descExec(ifr, 'removeFormat', null, R) },
        ]); break;
        case 'code': toggleCodeView(ifr); break;
        default: break; // ai / image / video / table — present for 1:1, no offline action
      }
    }, true);
  }
  function installRealToolbar(ifr) {
    if (document.querySelector('.rrb-desc-toolbar')) return true;
    // The mock's captured toolbar (_Toolbar_1iing_3) collapsed 链接/图片/视频/表格 into the
    // overflow at capture time; replace the whole bar with our rebuilt full one (all
    // buttons inline in real's order). Find the captured toolbar container.
    const oldBar = C.$('._Toolbar_1iing_3')
      || (() => { const ai = C.$('._AutowriteButton_cju2s_3') || C.$('[aria-label="生成文本"]'); return ai && ai.closest('[class*=_Toolbar_1iing]'); })();
    if (!oldBar) return false;
    if (!document.getElementById('rrb-desc-toolbar-css')) {
      const link = document.createElement('link');
      link.id = 'rrb-desc-toolbar-css'; link.rel = 'stylesheet'; link.href = '/_inject/description_toolbar.css';
      document.head.appendChild(link);
    }
    fetch('/_inject/tpl/description_toolbar.html').then((r) => r.text()).then((html) => {
      const holder = document.createElement('div');
      if (holder.setHTMLUnsafe) holder.setHTMLUnsafe(html); else holder.innerHTML = html;
      const bar = holder.firstElementChild; if (!bar) return;
      oldBar.replaceWith(bar);
      for (const btn of bar.querySelectorAll('[data-rrb-cmd]')) wireToolbarButton(btn, ifr);
    }).catch(() => { /* keep the captured toolbar on failure */ });
    return true;
  }
  function wireDescriptionEditor() {
    const ifr = C.$('#product-description-ro_ifr');
    if (!ifr) { return; }
    applyDescriptionEditable(ifr);
    // re-assert through the settle window: a late srcdoc load/body-replacement resets designMode.
    ifr.addEventListener('load', () => applyDescriptionEditable(ifr));
    let n = 0;
    const t = setInterval(() => { applyDescriptionEditable(ifr); if (++n > 30) clearInterval(t); }, 400);
    const area = C.$('.tox-edit-area') || ifr.parentNode;
    if (area) area.addEventListener('click', () => { try { ifr.contentWindow.focus(); ifr.contentDocument.body.focus(); } catch (er) { /* noop */ } }, true);
    // Replace the old captured TinyMCE toolbar with the rebuilt real one (retry until present).
    if (!installRealToolbar(ifr)) {
      let m = 0;
      const tt = setInterval(() => { if (installRealToolbar(ifr) || ++m > 25) clearInterval(tt); }, 200);
    }
  }

  // --- media upload (wire the captured drop-zone → thumbnail grid) ----------
  const uploadedMedia = [];
  function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result || '');
      r.onerror = () => resolve('');
      r.readAsDataURL(file);
    });
  }
  function ingestFiles(files) {
    const list = [...(files || [])];
    if (!list.length) return;
    Promise.all(list.map((f) => readFileAsDataUrl(f).then((src) => ({ src, name: f.name })))).then((items) => {
      for (const it of items) if (it.src) uploadedMedia.push(it);
      renderMediaTiles();
    });
  }
  function wireMediaUpload() {
    const input = C.$('#file-input') || C.$('input[type=file]');
    if (input) {
      input.addEventListener('change', () => ingestFiles(input.files), true);
      // Real Shopify's <input type=file> is visually hidden — the drop-zone placeholder is the
      // visible click target. The capture left it as a visible native control (w:253); hide it 1:1
      // AND so it can't be a competing/overlapping click target. pointer-events:none blocks DIRECT
      // pointer clicks while programmatic input.click() still opens the native picker.
      input.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;'
        + 'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);border:0;white-space:nowrap;pointer-events:none;';
    }
    // The placeholder ("上传新文件"/"选择现有文件") lives INSIDE the drop zone, and both got a
    // capture-phase click handler — so ONE user click fired input.click() TWICE (drop-zone +
    // placeholder). Chrome treats two synchronous .click()s as a non-genuine gesture and suppresses
    // the native file dialog (the "upload still doesn't work" bug). Guard: at most one open/gesture.
    let opening = false;
    const openPicker = (e) => {
      if (!input) return;
      if (e && (e.target === input || (input.contains && input.contains(e.target)))) return;
      if (e && e.target && e.target.closest && e.target.closest('#rrb-media-grid')) return; // tile/remove click
      if (opening) return;
      opening = true;
      setTimeout(() => { opening = false; }, 400);
      input.click();
    };
    const ph = C.$('._DropZonePlaceholder_1oych_1') || C.$('[class*=_DropZonePlaceholder]');
    if (ph) { ph.style.cursor = 'pointer'; ph.addEventListener('click', openPicker, true); }
    const dz = C.$('s-internal-drop-zone') || (input && input.closest && input.closest('s-internal-drop-zone'));
    if (dz) {
      dz.style.cursor = 'pointer';
      dz.addEventListener('click', openPicker, true);
      dz.addEventListener('dragover', (e) => { e.preventDefault(); }, true);
      dz.addEventListener('drop', (e) => { e.preventDefault(); ingestFiles(e.dataTransfer && e.dataTransfer.files); }, true);
    }
  }
  function renderMediaTiles() {
    const ph = C.$('._DropZonePlaceholder_1oych_1');
    const dz = C.$('s-internal-drop-zone');
    const mount = (ph && ph.parentNode) || (dz && dz.parentNode);
    if (!mount) return;
    let grid = document.getElementById('rrb-media-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.id = 'rrb-media-grid';
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;padding:12px;';
      mount.insertBefore(grid, mount.firstChild);
    }
    grid.replaceChildren();
    uploadedMedia.forEach((m, i) => {
      const tile = document.createElement('div');
      tile.style.cssText = 'position:relative;border:1px solid #e3e3e3;border-radius:10px;overflow:hidden;aspect-ratio:1/1;background:#fff;';
      const img = document.createElement('img');
      img.src = m.src; img.alt = m.name || '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      tile.appendChild(img);
      if (i === 0) {
        const b = document.createElement('span');
        b.textContent = '封面图片';
        b.style.cssText = 'position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.7);color:#fff;font:11px/1.4 -apple-system,system-ui,sans-serif;padding:2px 6px;border-radius:6px;';
        tile.appendChild(b);
      }
      const rm = document.createElement('span');
      rm.textContent = '×';
      rm.style.cssText = 'position:absolute;top:4px;right:6px;cursor:pointer;background:rgba(255,255,255,.92);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.2);';
      rm.onclick = () => { uploadedMedia.splice(i, 1); renderMediaTiles(); };
      tile.appendChild(rm);
      grid.appendChild(tile);
    });
  }

  // --- progressive disclosure: pricing / inventory / shipping collapsibles --------
  // Real Shopify shows compact "pill" buttons (原价/单价/单件成本/SKU/条码/原产国/HS 编码) that, on
  // click, REMOVE the pills row and reveal the full labeled inputs inside a Polaris-Collapsible.
  // The captured snapshot has the pills + an EMPTY closed collapsible (#product_variant_collapsible_*)
  // because the content is React-lazy-rendered (never rendered while closed at capture). We inject the
  // real captured fragment on first click, open the collapsible, and hide the pills row → 1:1 with real.
  // compareAtPrice/costPerItem/sku/barcode then persist via collect() (read by name); the shipping
  // 原产国/HS 编码 fields are cosmetic (the backend does not store them).
  const COLLAPSIBLE_TPL = {
    product_variant_collapsible_pricing: 'collapsible_pricing.html',
    product_variant_collapsible_inventory: 'collapsible_inventory.html',
    product_variant_collapsible_shipping: 'collapsible_shipping.html',
  };
  // The summary pills (_BasePillButton) AND the chevron toggle (_CollapsibleButton) all carry
  // aria-controls=<ac>; they sit in sibling containers inside one InlineStack row:
  //   row ─ [pills container: _BasePill…]  ─ [box: _CollapsibleButton chevron]
  // Real Shopify keeps the chevron in BOTH states and just swaps pills↔body. So we hide ONLY
  // the pills container (never the chevron) and toggle the body open/closed via the chevron.
  function controllersFor(ac) { return C.$$('button[aria-controls="' + ac + '"]'); }
  function isChevron(b) { return /_CollapsibleButton/.test(typeof b.className === 'string' ? b.className : ''); }
  function chevronFor(ac) { return controllersFor(ac).find(isChevron); }
  function pillsContainerFor(ac) {
    const pills = controllersFor(ac).filter((b) => !isChevron(b));
    if (!pills.length) return null;
    let node = pills[0];
    while (node.parentElement && !pills.every((p) => node.contains(p))) node = node.parentElement;
    return node; // the pills' common ancestor — excludes the chevron (a separate sibling box)
  }
  function setChevronExpanded(ac, expanded) {
    const chev = chevronFor(ac);
    if (!chev) return;
    chev.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    chev.setAttribute('data-state', expanded ? 'open' : 'closed');
    const icon = chev.querySelector('s-internal-icon') || chev.querySelector('svg');
    if (icon) icon.style.transform = expanded ? 'rotate(180deg)' : '';
  }
  function isCollapsibleOpen(ac) {
    const col = C.$('#' + ac);
    return !!col && col.getAttribute('aria-hidden') === 'false';
  }
  function wireCollapsibleFields(ac, col) {
    if (ac === 'product_variant_collapsible_pricing') {
      const prof = col.querySelector('#rrb-profit');
      const marg = col.querySelector('#rrb-margin');
      const recompute = () => {
        if (!prof || !marg) return;
        const price = parseFloat(C.readName('price'));
        const cost = parseFloat(C.readName('costPerItem'));
        if (isFinite(price) && isFinite(cost)) {
          const p = price - cost;
          prof.textContent = '$' + p.toFixed(2);
          marg.textContent = price > 0 ? (p / price * 100).toFixed(1) + '%' : '--';
          prof.style.color = ''; marg.style.color = '';
        } else { prof.textContent = '--'; marg.textContent = '--'; }
      };
      const costI = col.querySelector('#PricingCardUnitCost'); if (costI) costI.addEventListener('input', recompute, true);
      const priceI = C.byName('price'); if (priceI) priceI.addEventListener('input', recompute, true);
      recompute();
    }
    if (ac === 'product_variant_collapsible_shipping') {
      const sel = col.querySelector('#ShippingCardCountryOfOrigin');
      const lbl = col.querySelector('.Polaris-Select__SelectedOption');
      if (sel && lbl) sel.addEventListener('change', () => { const o = sel.options[sel.selectedIndex]; lbl.textContent = o ? o.textContent : '选择'; }, true);
    }
  }
  // Inject the rebuilt real fragment ONCE; content is retained across collapse/expand (real does too).
  function ensureCollapsibleContent(ac) {
    const col = C.$('#' + ac);
    if (!col) return Promise.resolve(null);
    if (col.dataset.rrbFilled) return Promise.resolve(col);
    col.dataset.rrbFilled = '1';
    const tpl = COLLAPSIBLE_TPL[ac];
    if (!tpl) return Promise.resolve(col);
    return fetch('/_inject/tpl/' + tpl).then((r) => r.text()).then((html) => {
      col.innerHTML = html;
      wireCollapsibleFields(ac, col);
      return col;
    }).catch(() => col);
  }
  function openCollapsible(ac) {
    return ensureCollapsibleContent(ac).then((col) => {
      if (!col) return null;
      col.classList.remove('Polaris-Collapsible--isFullyClosed');
      col.setAttribute('aria-hidden', 'false');
      col.style.maxHeight = 'none'; col.style.overflow = 'visible';
      const pc = pillsContainerFor(ac); if (pc) pc.style.display = 'none';
      setChevronExpanded(ac, true);
      return col;
    });
  }
  function closeCollapsible(ac) {
    const col = C.$('#' + ac);
    if (col) {
      col.setAttribute('aria-hidden', 'true');
      col.style.maxHeight = '0px'; col.style.overflow = 'hidden';
    }
    const pc = pillsContainerFor(ac); if (pc) pc.style.display = '';
    setChevronExpanded(ac, false);
  }
  function toggleCollapsible(ac) { if (isCollapsibleOpen(ac)) closeCollapsible(ac); else openCollapsible(ac); }
  function wireCollapsibles() {
    for (const ac of Object.keys(COLLAPSIBLE_TPL)) {
      for (const btn of controllersFor(ac)) {
        const chev = isChevron(btn);
        btn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (chev) toggleCollapsible(ac); else openCollapsible(ac);
        }, true);
      }
      closeCollapsible(ac); // deterministic closed default (pills visible) regardless of served/warm state
    }
  }

  // 包装 (shipping package template) picker. Its DISPLAY is already pixel-1:1 with real
  // ("商店默认 • 样品箱 - …"), and a fresh store genuinely has only the default package — so
  // "只有默认" is faithful. The control was just captured INERT. Wire a delegated click (robust to
  // shadow DOM / re-render) that opens a faithful menu: the default package (✓) + an 添加包裹尺寸
  // entry that, like real Shopify, points to package settings (out of scope here → toast).
  const PACKAGE_LABEL = '商店默认 • 样品箱 - 8.6 × 5.4 × 1.6 英寸，0 lb';
  function wirePackaging() {
    document.addEventListener('click', (e) => {
      if (document.getElementById('rrb-menu')) return; // let the open menu's own handler run
      for (const el of e.composedPath()) {
        if (el.nodeType !== 1) continue;
        const t = (el.textContent || '').trim();
        // The length guard is CRITICAL: without it a high form container (whose textContent
        // transitively includes the packaging field) matches too, and we'd intercept EVERY click
        // in the form — including 保存 ("点不了"). The real package label is ~30 chars; a container
        // is hundreds. Only the tight packaging control passes.
        if (t.length <= 80 && /样品箱/.test(t) && /商店默认/.test(t)) {
          e.preventDefault(); e.stopImmediatePropagation();
          const anchor = (el.closest && el.closest('button')) || el;
          openMenu(anchor, [['default', PACKAGE_LABEL], ['__add__', '添加包裹尺寸']], (val) => {
            if (val === '__add__') C.toast('请在 设置 › 配送与交付 中管理包裹尺寸');
          }, { selected: 'default' });
          return;
        }
      }
    }, true);
  }

  // =========================================================================
  // 多属性 (product options → variants). Real Shopify renders this editor in a
  // CLOSED shadow root we can't capture, so it's rebuilt from the known Shopify
  // pattern: up to 3 options (name + values) → one variant row per combination,
  // each with its own 价格/可用/SKU. Persisted to the backend (options/variants).
  // =========================================================================
  const OPTION_SUGGESTIONS = ['尺寸', '颜色', '材质', '款式', '容量', '重量', '口味'];
  let productOptions = []; // [{name, values:[], editing:bool}]
  const variantEdits = {}; // combo title -> {price, quantity, sku} (preserved across re-render)
  let _refocus = null;     // selector to focus after a re-render (keeps the add-value input active)

  function mk(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  function effectiveOptions() { return productOptions.filter((o) => o.name.trim() && o.values.length); }
  function variantCombos() {
    const opts = effectiveOptions();
    if (!opts.length) return [];
    let combos = [[]];
    for (const o of opts) { const next = []; for (const c of combos) for (const v of o.values) next.push(c.concat(v)); combos = next; }
    return combos.map((vals) => ({ title: vals.join(' / '), optionValues: vals }));
  }
  function readVariantInputs() {
    const host = document.getElementById('rrb-variants'); if (!host) return;
    for (const row of host.querySelectorAll('[data-rrb-variant]')) {
      const t = row.getAttribute('data-rrb-variant');
      const g = (f) => { const el = row.querySelector('[data-vf="' + f + '"]'); return el ? el.value : ''; };
      variantEdits[t] = { price: g('price'), quantity: g('qty'), sku: g('sku') };
    }
  }
  function chip(label, onRemove) {
    const c = mk('span', 'display:inline-flex;align-items:center;gap:6px;background:#e3e3e3;border-radius:8px;padding:3px 8px;margin:0 6px 6px 0;font:13px/1.4 -apple-system,system-ui,sans-serif;color:#303030;');
    c.appendChild(mk('span', null, label));
    const x = mk('span', 'cursor:pointer;font-weight:600;color:#616161;', '×'); x.onclick = onRemove; c.appendChild(x);
    return c;
  }
  function optionEditor(opt, idx) {
    const box = mk('div', 'border:1px solid #c9cccf;border-radius:12px;padding:12px;margin:0 0 12px;');
    // name
    box.appendChild(mk('div', 'font:500 13px/20px -apple-system,system-ui,sans-serif;color:#303030;margin-bottom:4px;', '选项名称'));
    const name = mk('input', 'width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #8a8a8a;border-radius:8px;font:13px/1.4 inherit;outline:none;margin-bottom:12px;');
    name.value = opt.name; name.setAttribute('list', 'rrb-opt-names'); name.placeholder = '例如 尺寸、颜色、材质';
    name.oninput = () => { opt.name = name.value; };
    box.appendChild(name);
    // values
    box.appendChild(mk('div', 'font:500 13px/20px -apple-system,system-ui,sans-serif;color:#303030;margin-bottom:4px;', '选项值'));
    const chips = mk('div', 'display:flex;flex-wrap:wrap;align-items:center;');
    opt.values.forEach((v, vi) => chips.appendChild(chip(v, () => { opt.values.splice(vi, 1); renderVariants(); })));
    box.appendChild(chips);
    // Add-value row: text input + an explicit 添加 button. Real Shopify tokenizes values on
    // Enter/comma; KEEP that, but also expose a click target so a browser agent never NEEDS to
    // synthesize a keypress (the user asked whether an agent could even add values — the prior
    // Enter-only input was hard to drive headlessly). 完成 also commits a still-typed value.
    const addRow = mk('div', 'display:flex;gap:8px;align-items:center;');
    const addVal = mk('input', 'flex:1;min-width:0;box-sizing:border-box;padding:7px 10px;border:1px solid #8a8a8a;border-radius:8px;font:13px/1.4 inherit;outline:none;');
    addVal.id = 'rrb-addval-' + idx; addVal.placeholder = '输入选项值（回车或点"添加"）';
    const commitVal = () => {
      const v = addVal.value.trim();
      if (!v) return false;
      if (!opt.values.includes(v)) opt.values.push(v);
      addVal.value = ''; _refocus = '#rrb-addval-' + idx; renderVariants(); return true;
    };
    addVal.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitVal(); } };
    const addBtn = mk('button', 'flex:0 0 auto;background:#f1f1f1;border:1px solid #8a8a8a;border-radius:8px;color:#303030;cursor:pointer;font:500 13px/20px inherit;padding:7px 14px;', '添加');
    addBtn.type = 'button'; addBtn.onclick = () => commitVal();
    addRow.appendChild(addVal); addRow.appendChild(addBtn);
    box.appendChild(addRow);
    // actions
    const actions = mk('div', 'display:flex;justify-content:space-between;margin-top:12px;');
    const del = mk('button', 'background:transparent;border:none;color:#8e1f0b;cursor:pointer;font:500 13px/20px inherit;padding:6px 0;', '删除');
    del.type = 'button'; del.onclick = () => { productOptions.splice(idx, 1); renderVariants(); };
    const done = mk('button', 'background:#303030;border:none;color:#fff;border-radius:8px;cursor:pointer;font:500 13px/20px inherit;padding:7px 14px;', '完成');
    done.type = 'button';
    done.onclick = () => {
      if (!opt.name.trim()) { name.style.borderColor = '#e51c00'; name.focus(); return; }
      commitVal(); // a value still typed in the box counts — don't force 回车/添加 first
      if (!opt.values.length) { addVal.style.borderColor = '#e51c00'; addVal.focus(); return; }
      opt.editing = false; renderVariants();
    };
    actions.appendChild(del); actions.appendChild(done);
    box.appendChild(actions);
    return box;
  }
  function optionSummary(opt) {
    const row = mk('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid #e3e3e3;border-radius:12px;padding:10px 12px;margin:0 0 12px;');
    const left = mk('div', 'min-width:0;');
    left.appendChild(mk('div', 'font:600 13px/20px -apple-system,system-ui,sans-serif;color:#303030;margin-bottom:6px;', opt.name));
    const vals = mk('div', 'display:flex;flex-wrap:wrap;');
    opt.values.forEach((v) => { const c = mk('span', 'display:inline-flex;align-items:center;background:#f1f1f1;border-radius:8px;padding:3px 8px;margin:0 6px 4px 0;font:13px/1.4 inherit;color:#303030;', v); vals.appendChild(c); });
    left.appendChild(vals); row.appendChild(left);
    const edit = mk('button', 'background:transparent;border:none;color:#0057d9;cursor:pointer;font:500 13px/20px inherit;padding:2px 0;flex:0 0 auto;', '编辑');
    edit.type = 'button'; edit.onclick = () => { opt.editing = true; renderVariants(); };
    row.appendChild(edit);
    return row;
  }
  function variantTable(combos) {
    const defPrice = C.readName('price') || '';
    const wrap = mk('div', 'border:1px solid #e3e3e3;border-radius:12px;overflow:hidden;margin-top:4px;');
    const head = mk('div', 'display:grid;grid-template-columns:1.4fr 1fr 0.8fr 1.2fr;gap:8px;padding:8px 12px;background:#f6f6f7;border-bottom:1px solid #e3e3e3;font:500 12px/16px -apple-system,system-ui,sans-serif;color:#616161;');
    ['变体', '价格', '可用', 'SKU'].forEach((t) => head.appendChild(mk('div', null, t)));
    wrap.appendChild(head);
    combos.forEach((c) => {
      const saved = variantEdits[c.title] || {};
      const row = mk('div', 'display:grid;grid-template-columns:1.4fr 1fr 0.8fr 1.2fr;gap:8px;padding:8px 12px;border-bottom:1px solid #f1f1f1;align-items:center;');
      row.setAttribute('data-rrb-variant', c.title);
      row.appendChild(mk('div', 'font:500 13px/20px -apple-system,system-ui,sans-serif;color:#303030;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', c.title));
      const inCss = 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #8a8a8a;border-radius:8px;font:13px/1.4 inherit;outline:none;';
      const price = mk('input', inCss); price.setAttribute('data-vf', 'price'); price.inputMode = 'decimal'; price.placeholder = defPrice || '0.00'; price.value = saved.price != null ? saved.price : '';
      const qty = mk('input', inCss); qty.setAttribute('data-vf', 'qty'); qty.inputMode = 'numeric'; qty.placeholder = '0'; qty.value = saved.quantity != null ? saved.quantity : '';
      const sku = mk('input', inCss); sku.setAttribute('data-vf', 'sku'); sku.placeholder = ''; sku.value = saved.sku != null ? saved.sku : '';
      [price, qty, sku].forEach((i) => row.appendChild(i));
      wrap.appendChild(row);
    });
    return wrap;
  }
  function renderVariants() {
    const host = document.getElementById('rrb-variants'); if (!host) return;
    readVariantInputs();
    host.replaceChildren();
    productOptions.forEach((opt, idx) => host.appendChild(opt.editing ? optionEditor(opt, idx) : optionSummary(opt)));
    if (productOptions.length < 3 && !productOptions.some((o) => o.editing)) {
      const add = mk('button', 'display:inline-flex;align-items:center;gap:6px;background:transparent;border:none;color:#0057d9;cursor:pointer;font:500 13px/20px -apple-system,system-ui,sans-serif;padding:8px 0;');
      add.type = 'button';
      add.appendChild(mk('span', 'font-size:16px;line-height:1;', '⊕'));
      add.appendChild(mk('span', null, productOptions.length ? '添加其他选项' : '添加尺寸或颜色等选项'));
      add.onclick = () => { productOptions.push({ name: '', values: [], editing: true }); _refocus = null; renderVariants(); };
      host.appendChild(add);
    }
    const combos = variantCombos();
    if (combos.length) host.appendChild(variantTable(combos));
    if (_refocus) { const el = host.querySelector(_refocus); if (el) el.focus(); _refocus = null; }
  }
  function wireVariants() {
    const h2 = C.$$('h2').find((e) => (e.textContent || '').trim() === '多属性');
    if (!h2) return;
    let card = h2;
    for (let i = 0; i < 8 && card; i++) { card = card.parentElement; if (card && /Polaris-LegacyCard|_CardWrapper/.test(typeof card.className === 'string' ? card.className : '')) break; }
    if (!card) return;
    // datalist of common option names
    if (!document.getElementById('rrb-opt-names')) {
      const dl = document.createElement('datalist'); dl.id = 'rrb-opt-names';
      OPTION_SUGGESTIONS.forEach((s) => { const o = document.createElement('option'); o.value = s; dl.appendChild(o); });
      document.body.appendChild(dl);
    }
    // mount point: the block stack inside the card body (not the header)
    let mount = null;
    for (const s of card.querySelectorAll('.Polaris-BlockStack')) { if (!s.closest('.Polaris-LegacyCard__Header')) { mount = s; break; } }
    mount = mount || card;
    if (!document.getElementById('rrb-variants')) {
      const holder = mk('div', 'padding:0 4px 4px;');
      holder.id = 'rrb-variants';
      mount.appendChild(holder);
    }
    // Hide the inert captured trigger (an <s-internal-button>添加尺寸或颜色等选项</s-internal-button>).
    // It sits in a different LegacyCard instance than the 多属性 h2 we located, so scope the hide
    // GLOBALLY (deep-walk, shadow-piercing). The label is unique — the only other element with it is
    // our own 0-option button inside #rrb-variants, which host.contains() excludes. Climb to the
    // tight ⊕+text row (parent chain with ≤2 children) before hiding so the whole control disappears.
    const host = document.getElementById('rrb-variants');
    const deepEls = (root) => { const o = []; (function w(r) { for (const el of r.querySelectorAll('*')) { o.push(el); if (el.shadowRoot) w(el.shadowRoot); } })(root); return o; };
    for (const e of deepEls(document.body)) {
      if (host && host.contains(e)) continue;
      if (e.childElementCount === 0 && (e.textContent || '').trim() === '添加尺寸或颜色等选项') {
        let row = e;
        while (row.parentElement && row.parentElement.childElementCount <= 2 && !(host && host.contains(row.parentElement))) row = row.parentElement;
        row.style.display = 'none';
      }
    }
    renderVariants();
  }
  function collectVariants() {
    readVariantInputs();
    const opts = effectiveOptions().map((o) => ({ name: o.name.trim(), values: o.values.slice() }));
    const combos = variantCombos();
    const variants = combos.map((c) => {
      const e = variantEdits[c.title] || {};
      return { title: c.title, optionValues: c.optionValues, price: e.price || '', quantity: e.quantity || '', sku: e.sku || '' };
    });
    return { options: opts, variants };
  }

  // Make the (statically-disabled) save buttons clickable; the dirty-state JS is gone.
  function enableSaveButtons() {
    for (const b of C.$$('button')) {
      const al = b.getAttribute && b.getAttribute('aria-label');
      const txt = (b.textContent || '').trim();
      if (al === '保存' || txt === '保存' || txt === '保存产品') {
        b.removeAttribute('aria-disabled');
        b.removeAttribute('disabled');
        if (b.classList) { b.classList.remove('_Disabled_10jvh_38', 'Polaris-Button--disabled'); }
        b.tabIndex = 0;
      }
    }
  }

  // The captured contextual save bar froze the 保存 (primary) button's _BorderGradient_ wrapper
  // WITHOUT its active state, so a missing CSS-variable cascade leaves it translucent
  // (rgba(255,255,255,.22)) — dark text on the dark-teal bar then looks greyed / un-clickable,
  // which the user reported as "保存点不了". The button IS wired and fires on click; only the
  // LOOK is wrong. Real active state (captured from live admin): 保存 wrapper = solid white pill,
  // 放弃 wrapper = subtle rgba(255,255,255,.08). Force the real computed result directly — the
  // variable cascade is deep + fragile, and matching the pixels is what fidelity requires.
  function styleSaveBar() {
    for (const b of C.$$('button')) {
      const cls = typeof b.className === 'string' ? b.className : '';
      if (!/_ContextualButton_/.test(cls)) continue;
      const wrap = b.parentElement;
      if (!wrap || !/_BorderGradient_/.test(typeof wrap.className === 'string' ? wrap.className : '')) continue;
      if (/_Primary_/.test(cls)) wrap.style.setProperty('background', 'rgb(255, 255, 255)', 'important');
      else if (/_Secondary_/.test(cls)) wrap.style.setProperty('background', 'rgba(255, 255, 255, 0.08)', 'important');
    }
  }

  // THE real "保存点了没反应": the capture froze Shopify's **Sidekick** AI panel (id=sidekick,
  // role=dialog, aria-label=Sidekick) in its OPEN state. Offline its remote content never loads, so it
  // renders as an INVISIBLE `position:fixed` overlay (z-index 100) covering the right ~356px of the
  // viewport — and with pointer-events:auto it EATS every click there. The top contextual 保存 is left of
  // it (worked in every test), but the bottom PageActions 保存 sits UNDER it, so a click on the bottom
  // save button never reaches the button (composedPath has Sidekick, not the button) → no listener can
  // fire → "no reaction". Real Shopify shows the product form with Sidekick CLOSED by default; hide the
  // captured-open panel (it's empty + non-functional offline anyway). This also frees the right portion
  // of the right-hand column (状态/发布/…) whose controls were partly under the same overlay.
  function neutralizeSidekick() {
    const sk = document.getElementById('sidekick')
      || C.$('[role="dialog"][aria-label="Sidekick"]')
      || C.$('._Sidebar_s04ss_5');
    if (sk) sk.style.setProperty('display', 'none', 'important');
  }

  // Read the description from the LIVE editor body at save time (robust against any
  // srcdoc-load race that would leave the hidden textarea stale); fall back to it.
  function readDescription() {
    const ifr = C.$('#product-description-ro_ifr');
    if (ifr && ifr.contentDocument && ifr.contentDocument.body) {
      const html = ifr.contentDocument.body.innerHTML;
      if (html && html.replace(/<br\s*\/?>/gi, '').trim()) return html;
    }
    return C.readName('descriptionHtml') || '';
  }

  function collect() {
    const statusHost = pickerHost('状态');
    const catHost = pickerHost('类别');
    const typeHost = pickerHost('类型');
    const vendorHost = pickerHost('厂商');
    const collHost = pickerHost('产品系列');
    const tagHost = pickerHost('标记');
    const wu = C.readName('weightUnit');
    return {
      title: C.readName('title') || '',
      description: readDescription(),
      price: C.readName('price') || '',
      compareAtPrice: C.readName('compareAtPrice') || '',
      costPerItem: C.readName('costPerItem') || C.readName('cost') || '',
      sku: C.readName('sku') || '',
      barcode: C.readName('barcode') || '',
      quantity: C.readName('inventoryLevels[0]') ?? '',
      weight: C.readName('weight') || '',
      weightUnit: WEIGHT_UNIT[wu] || wu || 'kg',
      status: (statusHost && statusHost.dataset.rrbStatus) || 'active',
      category: (catHost && catHost.dataset.rrbValue) || '',
      vendor: (vendorHost && vendorHost.dataset.rrbValue) || pickerText('厂商'),
      productType: (typeHost && typeHost.dataset.rrbValue) || pickerText('类型'),
      collections: collHost ? JSON.parse(collHost.dataset.rrbCollections || '[]') : [],
      tags: tagHost ? JSON.parse(tagHost.dataset.rrbTags || '[]') : [],
      image: uploadedMedia[0] ? uploadedMedia[0].src : '',
      media: uploadedMedia.map((m) => ({ src: m.src, alt: m.name || '' })),
      ...collectVariants(), // options + variants (多属性)
    };
  }

  // Real Shopify shows a CRITICAL BANNER at the top + an inline field ring + scrolls to it when a
  // save is rejected. The old code only fired a transient bottom toast (and in English, straight
  // from the backend) — easy to miss, so a rejected save looked like "保存点击了没反应". Localize +
  // surface prominently.
  const FIELD_LABELS = { price: '价格', title: '标题', compareAtPrice: '原价', costPerItem: '单件成本', sku: 'SKU', barcode: '条码', inventoryQuantity: '数量' };
  function localizeSaveError(b) {
    if (!b) return '保存失败,请重试';
    const f = b.field;
    if (f && FIELD_LABELS[f]) {
      if (/required|empty|missing/i.test(b.error || '')) return FIELD_LABELS[f] + '不能为空';
      if (/invalid|number|valid|positive/i.test(b.error || '')) return FIELD_LABELS[f] + '无效,请重新输入';
      return FIELD_LABELS[f] + '：' + (b.error || '无效');
    }
    return b.error || '保存失败,请重试';
  }
  function clearSaveError() {
    const b = document.getElementById('rrb-save-error'); if (b) b.remove();
    for (const el of C.$$('.rrb-field-error-ring')) el.classList.remove('rrb-field-error-ring');
  }
  function showSaveError(body) {
    const msg = localizeSaveError(body);
    clearSaveError();
    const banner = document.createElement('div');
    banner.id = 'rrb-save-error';
    banner.className = 'rrb-save-error';
    banner.innerHTML = '<span style="flex:0 0 auto;line-height:20px;">⚠️</span><span><strong>无法保存此产品</strong><br>'
      + String(msg).replace(/</g, '&lt;') + '</span>';
    const anchor = C.$('[name=title]');
    const mount = (anchor && anchor.closest('.Polaris-Card, ._Card, .Polaris-LegacyCard, .Polaris-Box')) || C.$('.Polaris-Page');
    if (mount && mount.parentNode) mount.parentNode.insertBefore(banner, mount);
    else { const f = C.$('form[method="post"]') || document.body; f.insertBefore(banner, f.firstChild); }
    let focusEl = null;
    if (body && body.field) { const el = C.byName(body.field); if (el) { (el.closest('.Polaris-TextField') || el).classList.add('rrb-field-error-ring'); focusEl = el; } }
    (focusEl || banner).scrollIntoView({ behavior: 'smooth', block: 'center' });
    C.toast(msg, { error: true });
  }

  // De-dupe: clicking save can fire BOTH the document click handler and the form submit → two POSTs.
  // Set the flag synchronously before the async fetch so the second trigger in the same gesture bails.
  let saving = false;
  function save(editId) {
    if (saving) return;
    saving = true;
    clearSaveError();
    const body = collect();
    const path = editId ? '/api/admin/products/' + editId : '/api/admin/products';
    const method = editId ? C.apiPut : C.apiPost;
    method(path, body).then(({ status, body }) => {
      if (status === 200 && body.ok) {
        C.toast('产品已保存');
        setTimeout(() => C.goto('/products'), 650); // keep `saving` true through the redirect
      } else {
        saving = false;
        showSaveError(body);
      }
    }).catch(() => { saving = false; showSaveError({ error: '保存失败,请重试' }); });
  }

  function wireSave(editId) {
    const onSave = (e) => { if (e) { e.preventDefault(); e.stopImmediatePropagation(); } save(editId); };
    const form = C.$('form[autocomplete="off"][method="post"]') || document.querySelector('form[method="post"]');
    if (form) form.addEventListener('submit', onSave, true);
    document.addEventListener('click', (e) => {
      for (const el of e.composedPath()) {
        if (el.nodeType !== 1) continue;
        const cls = typeof el.className === 'string' ? el.className : '';
        const al = el.getAttribute && el.getAttribute('aria-label');
        const txt = (el.textContent || '').trim();
        const isSave = (/_ContextualButton_/.test(cls) && /_Primary_/.test(cls))
          || (el.matches && el.matches('.Polaris-PageActions button.Polaris-Button--variantPrimary'))
          || ((al === '保存' || txt === '保存' || txt === '保存产品') && el.tagName === 'BUTTON');
        if (isSave) { onSave(e); return; }
      }
    }, true);
  }

  async function prefill(editId) {
    const res = await C.apiGet('/api/admin/products/' + editId).catch(() => null);
    const p = res && res.product;
    if (!p) return;
    const set = (name, val) => { const el = C.byName(name); if (el && val != null) C.setNativeValue(el, val); };
    set('title', p.title);
    set('price', p.priceAmount != null ? (p.priceAmount / 100).toFixed(2) : '');
    set('inventoryLevels[0]', p.inventoryQuantity != null ? String(p.inventoryQuantity) : '');
    set('weight', p.weight != null ? String(p.weight) : '');
    // compareAtPrice / costPerItem / sku / barcode inputs only exist AFTER the pricing/inventory
    // collapsible is expanded (real Shopify lazy-renders them) — so expand first, then fill.
    if (p.compareAtPriceAmount != null || p.costAmount != null) {
      openCollapsible('product_variant_collapsible_pricing').then(() => {
        if (p.compareAtPriceAmount != null) set('compareAtPrice', (p.compareAtPriceAmount / 100).toFixed(2));
        if (p.costAmount != null) set('costPerItem', (p.costAmount / 100).toFixed(2));
      });
    }
    if ((p.sku && p.sku.length) || (p.barcode && p.barcode.length)) {
      openCollapsible('product_variant_collapsible_inventory').then(() => {
        if (p.sku) set('sku', p.sku);
        if (p.barcode) set('barcode', p.barcode);
      });
    }
    // description → editor body + hidden textarea
    if (p.descriptionHtml != null) {
      const ifr = C.$('#product-description-ro_ifr');
      if (ifr && ifr.contentDocument && ifr.contentDocument.body) ifr.contentDocument.body.innerHTML = p.descriptionHtml || '<br>';
      const ta = C.byName('descriptionHtml'); if (ta) C.setNativeValue(ta, p.descriptionHtml || '');
    }
    // status
    const statusHost = pickerHost('状态');
    if (statusHost) {
      statusHost.dataset.rrbStatus = p.status || 'active';
      const lbl = (STATUS_OPTIONS.find((o) => o[0] === (p.status || 'active')) || [])[1];
      if (lbl) setPickerValueText(statusHost, lbl);
    }
    // category / type / vendor
    const catHost = pickerHost('类别'); if (catHost && p.category) { catHost.dataset.rrbValue = p.category; setPickerValueText(catHost, p.category); }
    const typeHost = pickerHost('类型'); if (typeHost && p.productType) { typeHost.dataset.rrbValue = p.productType; setPickerValueText(typeHost, p.productType); }
    const vendorHost = pickerHost('厂商'); if (vendorHost && p.vendor) { vendorHost.dataset.rrbValue = p.vendor; setPickerValueText(vendorHost, p.vendor); }
    // collections / tags
    const collHost = pickerHost('产品系列'); if (collHost && Array.isArray(p.collectionIds)) { collHost.dataset.rrbCollections = JSON.stringify(p.collectionIds); renderCollectionChips(collHost); }
    const tagHost = pickerHost('标记'); if (tagHost && Array.isArray(p.tags)) { tagHost.dataset.rrbTags = JSON.stringify(p.tags); renderTagChips(tagHost); }
    // media
    if (Array.isArray(p.media) && p.media.length) { uploadedMedia.length = 0; for (const m of p.media) uploadedMedia.push({ src: m.src || m, name: m.alt || '' }); renderMediaTiles(); }
    else if (p.image) { uploadedMedia.length = 0; uploadedMedia.push({ src: p.image, name: p.title || '' }); renderMediaTiles(); }
    // 多属性 options/variants
    if (Array.isArray(p.options) && p.options.length) {
      productOptions = p.options.map((o) => ({ name: o.name || '', values: (o.values || []).slice(), editing: false }));
      Object.keys(variantEdits).forEach((k) => delete variantEdits[k]);
      (p.variants || []).forEach((v) => {
        variantEdits[v.title] = {
          price: v.priceAmount != null ? (v.priceAmount / 100).toFixed(2) : '',
          quantity: v.inventoryQuantity != null ? String(v.inventoryQuantity) : '',
          sku: v.sku || '',
        };
      });
      renderVariants();
    }
  }

  // Load the product-form fidelity CSS (pill look + inventory sticky-overlay fix + save banner).
  function ensureFormCss() {
    if (document.getElementById('rrb-product-form-css')) return;
    const link = document.createElement('link');
    link.id = 'rrb-product-form-css'; link.rel = 'stylesheet'; link.href = '/_inject/product_form.css';
    document.head.appendChild(link);
  }

  function initForm(sub) {
    // /products/<x> also covers section aliases (e.g. /products/inventory →
    // inventory snapshot) where products.js is still injected. Only run form
    // wiring when the product form is actually present.
    if (!C.byName('title')) return;
    ensureFormCss();
    neutralizeSidekick(); // hide the captured-open Sidekick overlay that eats clicks on the bottom 保存
    enableSaveButtons();
    styleSaveBar(); // 保存 must render as a solid white pill (captured greyed → looked "点不了")
    const statusHost = pickerHost('状态');
    if (statusHost && !statusHost.dataset.rrbStatus) statusHost.dataset.rrbStatus = 'active';
    wireSinglePicker('状态', () => STATUS_OPTIONS, 'rrbStatus');
    wireCategoryPicker(); // 类别 = progressive taxonomy drill-down (not the flat full-path list)
    wireSinglePicker('类型', () => TYPE_SUGGESTIONS.map((t) => [t, t]), 'rrbValue', { search: true, searchPlaceholder: '输入或搜索类型', allowCustom: true });
    wireSinglePicker('厂商', () => VENDOR_SUGGESTIONS.map((t) => [t, t]), 'rrbValue', { search: true, searchPlaceholder: '输入或搜索厂商', allowCustom: true });
    wireCollectionsPicker();
    wireTagsPicker();
    wireDescriptionEditor();
    wireMediaUpload();
    wireCollapsibles(); // 价格/库存/运输 pills → expand into real inputs (1:1 with real Shopify)
    wirePackaging(); // 包装 picker was inert → open a faithful menu (default package + 添加包裹尺寸)
    wireVariants(); // 多属性: add options → variant matrix (rebuilt; real editor is closed-shadow)
    const m = sub.match(/^\/products\/([^/]+)$/);
    const editId = m && m[1] !== 'new' ? m[1] : null;
    wireSave(editId);
    if (editId) prefill(editId).catch((e) => console.error('[RRB products prefill]', e));
  }

  C.register({
    test: (sub) => /^\/products\/[^/]+$/.test(sub),
    init: (_C, sub) => initForm(sub),
  });
})();
