// Add Product 表单逻辑
(function () {
  const toast = window.AdminAPI.toast;

  // ============ Rich Text Editor ============
  document.querySelectorAll('.rte-toolbar').forEach((tb) => {
    const editor = document.getElementById(tb.dataset.target);
    tb.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || !btn.dataset.cmd) return;
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = prompt('链接 URL');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      editor.focus();
    });
    tb.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', () => {
        document.execCommand(sel.dataset.cmd, false, sel.value);
        editor.focus();
        sel.selectedIndex = 0;
      });
    });
  });

  // ============ Media slots ============
  document.querySelectorAll('.media-slot').forEach((slot) => {
    const input = slot.querySelector('input[type=file]');
    const removeBtn = slot.querySelector('.remove-btn');

    // 点击 slot 主体 → 触发 file picker（避开 button、input、img/video）
    slot.addEventListener('click', (e) => {
      if (e.target.closest('.remove-btn')) return;
      if (e.target === input) return;
      e.preventDefault();
      input.click();
    });
    slot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });

    input.addEventListener('change', () => {
      const f = input.files[0];
      if (!f) return;
      // 移除旧预览
      slot.querySelectorAll('img, video, .media-slot__filename').forEach((n) => n.remove());
      if (f.type.startsWith('image/')) {
        const url = URL.createObjectURL(f);
        const img = document.createElement('img');
        img.src = url;
        slot.insertBefore(img, slot.firstChild);
      } else {
        const div = document.createElement('div');
        div.className = 'media-slot__filename';
        div.textContent = '🎬 ' + f.name;
        slot.appendChild(div);
      }
      slot.classList.add('with-image');
    });

    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        slot.querySelectorAll('img, video, .media-slot__filename').forEach((n) => n.remove());
        slot.classList.remove('with-image');
      });
    }
  });

  // ============ Variants ============
  const optionsContainer = document.getElementById('options-container');
  const variantsTable = document.getElementById('variants-table');
  const variantsTbody = document.getElementById('variants-tbody');
  let optionsState = []; // [{name: 'Size', values: ['S','M','L']}]

  function renderOptions() {
    optionsContainer.innerHTML = '';
    optionsState.forEach((opt, idx) => {
      const block = document.createElement('div');
      block.className = 'option-block';
      block.innerHTML = `
        <div class="option-row" style="margin-bottom:6px">
          <input class="input" placeholder="选项名（如 尺寸 / 颜色）" value="${escapeHtml(opt.name)}" data-name-idx="${idx}" />
          <button type="button" class="btn btn-tertiary" data-remove-opt="${idx}">移除</button>
        </div>
        <div class="option-row">
          <input class="input" placeholder="选项值（用逗号分隔，如 S, M, L）" value="${escapeHtml(opt.values.join(', '))}" data-values-idx="${idx}" />
        </div>
      `;
      optionsContainer.appendChild(block);
    });
    rebuildVariantsTable();
  }

  function rebuildVariantsTable() {
    const valid = optionsState.filter((o) => o.name && o.values.length);
    if (!valid.length) {
      variantsTable.style.display = 'none';
      return;
    }
    variantsTable.style.display = 'table';
    const combos = cartesian(valid.map((o) => o.values));
    variantsTbody.innerHTML = '';
    combos.forEach((c) => {
      const label = c.join(' / ');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(label)}</td>
        <td><input class="input" data-variant-key="${escapeHtml(label)}" data-variant-prop="price" placeholder="0.00" type="number" step="0.01" /></td>
        <td><input class="input" data-variant-key="${escapeHtml(label)}" data-variant-prop="sku" /></td>
        <td><input class="input" data-variant-key="${escapeHtml(label)}" data-variant-prop="quantity" type="number" /></td>
      `;
      variantsTbody.appendChild(tr);
    });
  }

  function cartesian(arrs) {
    return arrs.reduce(
      (acc, cur) => acc.flatMap((a) => cur.map((c) => [...a, c])),
      [[]]
    );
  }

  document.getElementById('btn-add-option').addEventListener('click', () => {
    if (optionsState.length >= 3) {
      toast('最多支持 3 个选项');
      return;
    }
    optionsState.push({ name: '', values: [] });
    renderOptions();
  });

  optionsContainer.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.nameIdx !== undefined) {
      optionsState[+t.dataset.nameIdx].name = t.value;
    } else if (t.dataset.valuesIdx !== undefined) {
      optionsState[+t.dataset.valuesIdx].values = t.value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    rebuildVariantsTable();
  });
  optionsContainer.addEventListener('click', (e) => {
    const r = e.target.closest('[data-remove-opt]');
    if (r) {
      optionsState.splice(+r.dataset.removeOpt, 1);
      renderOptions();
    }
  });

  // ============ Tag chips (collections, tags) ============
  function setupChips(inputId, chipsId) {
    const input = document.getElementById(inputId);
    const chips = document.getElementById(chipsId);
    const list = [];
    function render() {
      chips.innerHTML = list
        .map(
          (t, i) =>
            `<span class="tag-chip">${escapeHtml(t)}<button type="button" data-rm="${i}">×</button></span>`
        )
        .join('');
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value.trim();
        if (v && !list.includes(v)) {
          list.push(v);
          render();
        }
        input.value = '';
      } else if (e.key === 'Backspace' && !input.value && list.length) {
        list.pop();
        render();
      }
    });
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]');
      if (b) {
        list.splice(+b.dataset.rm, 1);
        render();
      }
    });
    return () => list.slice();
  }
  const getCollections = setupChips('f-collections-input', 'collections-chips');
  const getTags = setupChips('f-tags-input', 'tags-chips');

  // ============ Submit ============
  async function submit(asDraft) {
    const sessionId = await window.AdminAPI.ensureSession();
    document.getElementById('session-id').textContent = sessionId.slice(0, 8) + '…';

    const form = document.getElementById('product-form');
    const fd = new FormData();

    // Plain inputs
    const fields = [
      'title',
      'price',
      'compareAtPrice',
      'costPerItem',
      'sku',
      'barcode',
      'quantity',
      'weight',
      'weightUnit',
      'countryOfOrigin',
      'category',
      'productType',
      'vendor',
      'seoTitle',
      'seoDescription',
      'urlHandle',
    ];
    fields.forEach((name) => {
      const el = form.elements[name];
      if (el && el.value) fd.append(name, el.value);
    });

    // Checkboxes
    const chargeTax = document.getElementById('f-chargeTax').checked;
    if (chargeTax) fd.append('chargeTax', 'true');
    const trackQuantity = document.getElementById('f-trackQuantity').checked;
    if (trackQuantity) fd.append('trackQuantity', 'true');

    // Status (radio): if save-as-draft override
    const status = asDraft ? 'draft' : (form.elements['status'].value || 'draft');
    fd.append('status', status);

    // Description (HTML)
    const descHtml = document.getElementById('rte-description').innerHTML.trim();
    if (descHtml) fd.append('description', descHtml);

    // Sales channels (checkbox group → JSON)
    const channels = Array.from(document.querySelectorAll('[data-channel]:checked'))
      .map((c) => c.dataset.channel);
    if (channels.length) fd.append('salesChannels', JSON.stringify(channels));

    // Collections / tags
    const collections = getCollections();
    if (collections.length) fd.append('collections', JSON.stringify(collections));
    const tags = getTags();
    if (tags.length) fd.append('tags', JSON.stringify(tags));

    // Variants
    const validOptions = optionsState.filter((o) => o.name && o.values.length);
    if (validOptions.length) {
      const combos = cartesian(validOptions.map((o) => o.values));
      const variants = combos.map((c) => {
        const label = c.join(' / ');
        const v = { options: validOptions.map((o, i) => ({ name: o.name, value: c[i] })) };
        ['price', 'sku', 'quantity'].forEach((prop) => {
          const inp = document.querySelector(
            `[data-variant-key="${cssEscape(label)}"][data-variant-prop="${prop}"]`
          );
          if (inp && inp.value) v[prop] = inp.value;
        });
        return v;
      });
      fd.append('variants', JSON.stringify(variants));
    }

    // Media files
    document.querySelectorAll('.media-slot').forEach((slot) => {
      const input = slot.querySelector('input[type=file]');
      const f = input.files[0];
      if (f) fd.append(slot.dataset.name, f);
    });

    if (!form.elements['title'].value || !form.elements['price'].value || !form.elements['category'].value) {
      toast('请至少填写标题、价格和类目');
      return;
    }

    try {
      const uiToken = window.AdminAPI.getUiToken(sessionId);
      const r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'X-Session-Id': sessionId, 'X-Ui-Token': uiToken },
        credentials: 'same-origin',
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) {
        toast('提交失败：' + (data.error || r.status));
        return;
      }
      toast('已保存 ' + data.fieldsSaved + ' 个字段');
      setTimeout(() => {
        window.location.href = '/result.html?session=' + sessionId;
      }, 600);
    } catch (e) {
      toast('网络错误：' + e.message);
    }
  }

  document.getElementById('btn-submit').addEventListener('click', () => submit(false));
  document.getElementById('btn-submit-2').addEventListener('click', () => submit(false));
  document.getElementById('btn-save-draft').addEventListener('click', () => submit(true));
  document.getElementById('btn-save-draft-2').addEventListener('click', () => submit(true));

  // helpers
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function cssEscape(s) {
    return String(s).replace(/[\\"']/g, '\\$&');
  }
})();
