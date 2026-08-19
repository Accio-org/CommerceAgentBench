// Result 页：展示 score + 内嵌 Verifier
(function () {
  const toast = window.AdminAPI.toast;
  const params = new URLSearchParams(location.search);
  let sessionId = params.get('session');

  async function init() {
    if (!sessionId) {
      sessionId = await window.AdminAPI.ensureSession();
    } else {
      window.AdminAPI.setSessionCache(sessionId);
    }
    document.getElementById('session-id').textContent = sessionId;
    await load();
  }

  async function load() {
    const uiToken = window.AdminAPI.getUiToken(sessionId);
    const uiHeaders = uiToken ? { 'X-Ui-Token': uiToken } : {};
    // /api/state and /api/verify are verifier-only; they'll 403 from the UI
    // without a verifier token, so degrade to {fields:{}} for display purposes.
    const [score, state] = await Promise.all([
      fetch('/api/score/' + sessionId, { headers: uiHeaders, credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : { total: 0, filled: 0, completion: 0, requiredFilled: 0, requiredTotal: 0, status: 'unknown' }),
      fetch('/api/state/' + sessionId, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : { fields: {}, page: 'product' })
        .catch(() => ({ fields: {}, page: 'product' })),
    ]);

    const page = state.page || score.page || 'product';
    const fieldsResp = await fetch('/api/fields?page=' + encodeURIComponent(page), { credentials: 'same-origin' }).then((r) => r.json());
    const fields = fieldsResp.fields || fieldsResp;

    const pageEl = document.getElementById('session-page');
    if (pageEl) pageEl.textContent = '· ' + (page === 'theme' ? '在线商店定制' : '添加产品');
    const backBtn = document.getElementById('back-to-form');
    if (backBtn) backBtn.href = page === 'theme' ? '/online-store/customize' : '/products/new';

    renderSummary(score);
    renderSections(score, fields, state);
    window._lastState = state;
    window._lastFields = fields;
  }

  function renderSummary(score) {
    const html = `
      <div class="summary-card">
        <div class="summary-label">总字段数</div>
        <div class="summary-value">${score.total}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">已填字段</div>
        <div class="summary-value">${score.filled}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">完成率</div>
        <div class="summary-value">${(score.completion * 100).toFixed(1)}%</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">必填完成</div>
        <div class="summary-value">${score.requiredFilled} / ${score.requiredTotal}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">状态</div>
        <div class="summary-value" style="font-size:14px">${score.status}</div>
      </div>
    `;
    document.getElementById('summary-cards').innerHTML = html;
  }

  function renderSections(score, fields, state) {
    const sections = {};
    fields.forEach((f) => {
      if (!sections[f.section]) sections[f.section] = [];
      sections[f.section].push(f);
    });

    const root = document.getElementById('sections');
    root.innerHTML = '';

    Object.keys(sections).forEach((sec) => {
      const items = sections[sec];
      const sectionEl = document.createElement('section');
      sectionEl.className = 'result-section';
      const rows = items
        .map((f) => {
          const stored = state.fields[f.name];
          const value = stored ? stored.value : null;
          const filePath = stored ? stored.filePath : null;
          let valHtml = '<span class="value empty">（空）</span>';
          if (filePath) {
            valHtml = `<a class="value" href="/${filePath}" target="_blank">📎 ${escape(value || filePath)}</a>`;
          } else if (value) {
            if (f.type === 'html') {
              valHtml = `<div class="value" style="border:1px solid var(--p-color-border-secondary);padding:8px;border-radius:4px;background:#fff">${value}</div>`;
            } else if (f.type === 'json') {
              try {
                valHtml = `<pre class="value" style="font-size:11px;background:#f6f6f7;padding:6px 8px;border-radius:4px;font-family:ui-monospace,monospace;white-space:pre-wrap">${escape(JSON.stringify(JSON.parse(value), null, 2))}</pre>`;
              } catch {
                valHtml = `<span class="value">${escape(value)}</span>`;
              }
            } else {
              valHtml = `<span class="value">${escape(value)}</span>`;
            }
          }
          const tag = stored
            ? '<span class="tag tag-success">已填</span>'
            : f.required
            ? '<span class="tag tag-required">必填</span>'
            : '<span class="tag tag-empty">空</span>';
          return `
            <div class="field-row-result">
              <div class="name">${escape(f.label)}<br><span class="muted" style="font-size:11px">${escape(f.name)}</span></div>
              <div>${valHtml}</div>
              <div style="text-align:right">${tag}</div>
            </div>
          `;
        })
        .join('');
      sectionEl.innerHTML = `<h3>${escape(sec)}（${items.length}）</h3>${rows}`;
      root.appendChild(sectionEl);
    });
  }

  // Verifier
  document.getElementById('btn-verify').addEventListener('click', async () => {
    const text = document.getElementById('expected-input').value.trim();
    if (!text) {
      toast('请输入 expected JSON');
      return;
    }
    let expected;
    try {
      expected = JSON.parse(text);
    } catch (e) {
      toast('JSON 解析失败：' + e.message);
      return;
    }
    const r = await fetch('/api/verify/' + sessionId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected }),
    });
    const data = await r.json();
    renderVerifyResult(data);
  });

  document.getElementById('btn-fill-actual').addEventListener('click', () => {
    const fields = window._lastFields || [];
    const state = window._lastState || { fields: {} };
    const obj = {};
    fields.forEach((f) => {
      const s = state.fields[f.name];
      if (s && (s.value || s.filePath)) {
        obj[f.name] = s.value || s.filePath;
      }
    });
    document.getElementById('expected-input').value = JSON.stringify(obj, null, 2);
  });

  function renderVerifyResult(data) {
    document.getElementById('verify-summary').innerHTML = `
      <strong>accuracy: ${(data.accuracy * 100).toFixed(1)}%</strong>
      （${data.matchedFields} / ${data.expectedFields} 匹配）
    `;
    const rows = data.details
      .map(
        (d) => `
      <div class="field-row-result">
        <div class="name">${escape(d.label || d.name)}<br><span class="muted" style="font-size:11px">${escape(d.name)}</span></div>
        <div>
          <div style="font-size:11px;color:var(--p-color-text-subdued)">期望：</div>
          <div class="value">${escape(typeof d.expected === 'object' ? JSON.stringify(d.expected) : String(d.expected ?? ''))}</div>
          <div style="font-size:11px;color:var(--p-color-text-subdued);margin-top:4px">实际：</div>
          <div class="value">${escape(d.actual ?? '（空）')}</div>
        </div>
        <div style="text-align:right">
          <span class="tag ${d.match ? 'tag-success' : 'tag-required'}">${d.match ? '✓' : '✗'}</span>
        </div>
      </div>`
      )
      .join('');
    document.getElementById('verify-result').innerHTML = `
      <div class="result-section" style="margin-top:14px"><h3>逐字段对比</h3>${rows}</div>
    `;
  }

  document.getElementById('btn-refresh').addEventListener('click', load);

  function escape(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  init();
})();
