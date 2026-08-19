// Theme Editor — Sections panel (动态增删/重排) + Inspector + Live Storefront Preview
(function () {
  const toast = window.AdminAPI.toast;

  /* ===== 选项常量 ===== */
  const OPTIONS = {
    industry: ['服装鞋包','食品饮料','家居家具','电子数码','美妆个护','健康保健','运动户外','玩具母婴','艺术手工','宠物用品','其他'],
    businessType: ['B2C 零售','B2B 批发','D2C 直销','订阅服务','数字商品'],
    brandTone: ['专业稳重','活力时尚','优雅高端','朴实自然','极简现代','复古怀旧'],
    fontHeading: ['Inter','Playfair Display','DM Serif Display','Bebas Neue','Cormorant Garamond','Manrope','Space Grotesk'],
    fontBody: ['Inter','Manrope','Lato','Source Sans 3','Nunito Sans','Work Sans'],
  };
  const THEMES = [
    { value: 'Dawn',    desc: '极简' },
    { value: 'Sense',   desc: '健康' },
    { value: 'Refresh', desc: '现代' },
    { value: 'Studio',  desc: '艺术' },
    { value: 'Crave',   desc: '美食' },
  ];
  const COLOR_SCHEMES = [
    { value: 'Light & Bright', heroBg: 'linear-gradient(135deg,#dbeafe,#eff6ff)', accent: '#2c6ecb', bg: '#fff', text: '#202223' },
    { value: 'Bold & Modern',  heroBg: 'linear-gradient(135deg,#fde047,#facc15)', accent: '#000', bg: '#fff', text: '#1a1a1a' },
    { value: 'Warm & Earthy',  heroBg: 'linear-gradient(135deg,#fed7aa,#fdba74)', accent: '#ea580c', bg: '#fef7ed', text: '#451a03' },
    { value: 'Cool & Clean',   heroBg: 'linear-gradient(135deg,#a7f3d0,#5eead4)', accent: '#0d9488', bg: '#f0fdfa', text: '#134e4a' },
    { value: 'Dark Luxe',      heroBg: 'linear-gradient(135deg,#1f1f1f,#3f3f46)', accent: '#d4af37', bg: '#0f0f0f', text: '#f5f5f5' },
  ];
  const HEADER_LAYOUT = [
    { value: 'left',   name: '居左', preview: 'L · · · 🛒' },
    { value: 'center', name: '居中', preview: '· · L · ·' },
    { value: 'right',  name: '居右', preview: '· · · · L' },
  ];
  const PUBLISH_STATUS = [
    { value: 'published', name: '发布到在线商店', desc: '客户可立即访问' },
    { value: 'draft',     name: '保存为草稿',     desc: '稍后再发布' },
  ];

  /* ===== Section schemas =====
   * 9 page sections（其中 header/footer 是 fixed，不参与 sectionsConfig）
   * 7 non-fixed sections 由 sectionsConfig 数组 [{id, enabled}] 控制顺序和启用
   */
  const SECTION_SCHEMAS = {
    'header':            { name: 'Header',           icon: '⊞', fixed: true,  fields: ['storeName','logo','slogan','menuItems','headerLayout'] },
    'announcement':      { name: '公告栏',           icon: '📢', fixed: false, fields: ['announcementText'] },
    'hero':              { name: '图像横幅',         icon: '🖼️', fixed: false, fields: ['heroImage','heroHeading','heroSubheading','heroCTAText'] },
    'product-list':      { name: '推荐产品系列',     icon: '🛍️', fixed: false, fields: ['featuredCollection','products'] },
    'featured-product':  { name: '精选单品',         icon: '⭐', fixed: false, fields: ['products','businessDescription','heroImage'] },
    'image-with-text':   { name: '图文',             icon: '🪟', fixed: false, fields: ['businessDescription'] },
    'multicolumn':       { name: '多栏',             icon: '⫴', fixed: false, fields: ['valueProp1','valueProp2','valueProp3'] },
    'rich-text':         { name: '富文本',           icon: '📝', fixed: false, fields: ['richTextContent'] },
    'image-banner':      { name: '图像横幅(浮窗)',   icon: '🌅', fixed: false, fields: ['heroImage','heroHeading','heroSubheading','heroCTAText'] },
    'newsletter':        { name: '邮件订阅',         icon: '✉️', fixed: false, fields: ['newsletterText'] },
    'footer':            { name: 'Footer',           icon: '⊟', fixed: true,  fields: ['footerEmail'] },
  };
  const THEME_SECTIONS = [
    { id: 'theme-settings', name: '主题与配色', icon: '🎨', virtual: true, fields: ['theme','colorScheme','fontHeading','fontBody','brandColor'] },
    { id: 'business-info',  name: '业务信息',   icon: '🏢', virtual: true, fields: ['industry','businessType','targetAudience','businessDescription','brandTone'] },
  ];
  const PUBLISH_SECTIONS = [
    { id: 'publish', name: '发布', icon: '🚀', virtual: true, fields: ['publishStatus','agreement'] },
  ];

  function getSectionSchema(idOrType) {
    if (SECTION_SCHEMAS[idOrType]) return SECTION_SCHEMAS[idOrType];
    const virt = THEME_SECTIONS.find((s) => s.id === idOrType) || PUBLISH_SECTIONS.find((s) => s.id === idOrType);
    if (virt) return virt;
    // instance id（如 hero_2）→ 通过 cfg 找 type
    const inst = getSectionsConfig().find((c) => c.id === idOrType);
    if (inst && SECTION_SCHEMAS[inst.type]) return SECTION_SCHEMAS[inst.type];
    return null;
  }

  /* ===== state ===== */
  let SESSION_ID = null;
  let FIELDS = [];
  const fieldByName = {};
  const formState = {};
  const fileObjects = {};
  const fileBlobUrls = {};
  let currentSection = 'theme-settings';
  let currentDevice = 'desktop';

  /* ===== sectionsConfig & products helpers ===== */
  function getSectionsConfig() {
    let cfg = [];
    try { cfg = JSON.parse(formState.sectionsConfig || '[]'); } catch {}
    if (!cfg.length) cfg = (window.StorefrontRenderer.DEFAULT_SECTIONS_CONFIG || []).slice();
    // normalize：补齐 type 字段（兼容旧数据）
    return cfg.map((c) => ({
      id: c.id || c.type,
      type: c.type || c.id,
      enabled: c.enabled !== false,
    }));
  }
  function sectionTypeFor(idOrType) {
    if (SECTION_SCHEMAS[idOrType]) return idOrType;  // 直接是 type
    const inst = getSectionsConfig().find((c) => c.id === idOrType);
    return inst ? inst.type : idOrType;
  }
  function setSectionsConfig(cfg) {
    formState.sectionsConfig = JSON.stringify(cfg);
    renderSectionsPanel();
    renderPreview();
  }
  function getProducts() {
    let arr = [];
    try { arr = JSON.parse(formState.products || '[]'); } catch {}
    if (!arr.length) arr = (window.StorefrontRenderer.DEFAULT_PRODUCTS || []).slice();
    return arr;
  }
  function setProducts(arr) {
    formState.products = JSON.stringify(arr);
    renderInspector(currentSection);
    renderPreview();
  }

  /* ===== init ===== */
  async function init() {
    SESSION_ID = await window.AdminAPI.ensureSession('theme');
    const fieldsResp = await fetch('/api/fields?page=theme').then((r) => r.json());
    FIELDS = fieldsResp.fields || fieldsResp;
    FIELDS.forEach((f) => { fieldByName[f.name] = f; });

    bindTemplatePicker();
    bindTopbar();
    bindSidekick();
    bindGlobalClicks();

    // 首次进入：未选模板时显示 picker overlay；选了之后才进入编辑器
    if (!formState.themeTemplate) {
      showTemplatePicker({ initial: true });
      return;
    }
    renderSectionsPanel();
    renderInspector(currentSection);
    renderPreview();
  }

  /* ===== Template Picker ===== */
  function bindTemplatePicker() {
    const overlay = document.getElementById('te-template-picker');
    if (!overlay) return;
    // card 点击 / cta 点击 → 选模板
    overlay.querySelectorAll('[data-template]').forEach((card) => {
      card.addEventListener('click', (e) => {
        // 点 cta 按钮也由这里捕获（冒泡）
        const key = card.getAttribute('data-template');
        if (e.target.closest('[data-template-cta]')) {
          e.stopPropagation();
        }
        applyTemplate(key);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          applyTemplate(card.getAttribute('data-template'));
        }
      });
    });
    // 关闭按钮（仅切换模式可用）
    const closeBtn = document.getElementById('tp-close');
    if (closeBtn) closeBtn.addEventListener('click', hideTemplatePicker);
    // 顶部「切换模板」按钮
    const swBtn = document.getElementById('btn-switch-template');
    if (swBtn) swBtn.addEventListener('click', () => showTemplatePicker({ initial: false }));
    // 点 overlay 关闭（仅切换模式）
    const overlayBg = overlay.querySelector('.te-template-picker__overlay');
    if (overlayBg) overlayBg.addEventListener('click', () => {
      if (formState.themeTemplate) hideTemplatePicker();
    });
    // ESC 关闭（仅切换模式）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.hidden && formState.themeTemplate) {
        hideTemplatePicker();
      }
    });
  }

  function showTemplatePicker(opts) {
    const overlay = document.getElementById('te-template-picker');
    if (!overlay) return;
    const closeBtn = document.getElementById('tp-close');
    // 初次进入：不允许关闭（必须选一个）；切换模式：允许
    if (closeBtn) closeBtn.hidden = !!(opts && opts.initial);
    // 高亮当前已选
    const cur = formState.themeTemplate || '';
    overlay.querySelectorAll('.te-template-card').forEach((c) => {
      c.classList.toggle('is-selected', c.getAttribute('data-template') === cur);
    });
    overlay.hidden = false;
  }
  function hideTemplatePicker() {
    const overlay = document.getElementById('te-template-picker');
    if (overlay) overlay.hidden = true;
  }

  function applyTemplate(key) {
    const TEMPLATES = (window.StorefrontRenderer && window.StorefrontRenderer.TEMPLATES) || {};
    const tpl = TEMPLATES[key];
    if (!tpl) { toast('未知模板：' + key); return; }

    // 同模板再点 → 仅关闭 picker
    if (formState.themeTemplate === key) {
      hideTemplatePicker();
      return;
    }
    // 已选过且要换 → 二次确认
    if (formState.themeTemplate && formState.themeTemplate !== key && !confirmReplace(tpl)) {
      return; // 用户取消，什么都不改
    }

    formState.themeTemplate = key;
    formState.theme         = tpl.theme;
    formState.colorScheme   = tpl.colorScheme;
    formState.headerLayout  = tpl.headerLayout;
    formState.fontHeading   = tpl.fontHeading;
    formState.fontBody      = tpl.fontBody;
    const SCHEMES = COLOR_SCHEMES.find((s) => s.value === tpl.colorScheme);
    if (SCHEMES) formState.brandColor = SCHEMES.accent;
    formState.sectionsConfig = JSON.stringify(tpl.sectionsConfig);

    hideTemplatePicker();
    currentSection = 'theme-settings';
    renderSectionsPanel();
    renderInspector(currentSection);
    renderPreview();
    toast(`已应用「${tpl.name}」模板`);
  }

  function confirmReplace(tpl) {
    return confirm(
      `切换到「${tpl.name}」会重置：\n` +
      `· sections 配置（你已增删的分区会丢失）\n` +
      `· 主题 / 配色 / Header 布局 / 字体 / 品牌主色\n\n` +
      `已填写的 hero、产品、文案等内容会保留。是否继续？`
    );
  }

  /* ===== Sections panel ===== */
  function renderSectionsPanel() {
    const pageEl = document.getElementById('te-page-sections');
    const themeEl = document.getElementById('te-theme-sections');
    const pubEl = document.getElementById('te-publish-sections');
    const cfg = getSectionsConfig();

    const rows = [];
    // 顶部固定 Header
    rows.push(makeSectionRow('header', SECTION_SCHEMAS.header, { fixed: true, enabled: true, name: 'Header' }));
    // 中间动态 sections（按 instance id）
    cfg.forEach((c, idx) => {
      const schema = SECTION_SCHEMAS[c.type];
      if (!schema) return;
      // 同 type 多实例：第 2 个起在名称后加 #n
      const sameTypeBefore = cfg.slice(0, idx).filter((x) => x.type === c.type).length;
      const displayName = sameTypeBefore > 0 ? `${schema.name} ${sameTypeBefore + 1}` : schema.name;
      rows.push(makeSectionRow(c.id, schema, {
        enabled: c.enabled !== false,
        idx, total: cfg.length,
        name: displayName,
      }));
    });
    // 添加分区按钮
    rows.push(makeAddSectionWrap(cfg));
    // 底部固定 Footer
    rows.push(makeSectionRow('footer', SECTION_SCHEMAS.footer, { fixed: true, enabled: true, name: 'Footer' }));

    pageEl.innerHTML = rows.join('');
    themeEl.innerHTML = THEME_SECTIONS.map((s) => makeSimpleRow(s.id, s)).join('');
    pubEl.innerHTML = PUBLISH_SECTIONS.map((s) => makeSimpleRow(s.id, s)).join('');

    // 绑定行为
    document.querySelectorAll('.te-section-row[data-section]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.te-section-act, .te-section-actions')) return;
        selectSection(row.dataset.section);
      });
    });
    document.querySelectorAll('.te-section-act').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.act;
        const id = btn.dataset.section;
        if (action === 'toggle') toggleSection(id);
        else if (action === 'up') moveSection(id, -1);
        else if (action === 'down') moveSection(id, 1);
        else if (action === 'delete') deleteSection(id);
      });
    });
    const addBtn = document.getElementById('te-add-section-btn');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('te-add-menu');
        if (menu) menu.classList.toggle('open');
      });
    }
    document.querySelectorAll('.te-add-menu-item').forEach((it) => {
      it.addEventListener('click', () => addSection(it.dataset.sectionType));
    });
  }

  function makeSectionRow(id, schema, opts) {
    const requiredCount = (schema.fields || []).filter((n) => fieldByName[n] && fieldByName[n].required).length;
    const isFixed = !!opts.fixed;
    const enabled = opts.enabled !== false;
    const displayName = opts.name || schema.name;
    const cls = [
      'te-section-row',
      currentSection === id ? 'active' : '',
      isFixed ? 'te-section-fixed' : '',
      !enabled ? 'disabled' : '',
    ].filter(Boolean).join(' ');

    let actions = '';
    if (!isFixed) {
      const upDis = opts.idx === 0 ? 'disabled' : '';
      const downDis = opts.idx === opts.total - 1 ? 'disabled' : '';
      actions = `
        <div class="te-section-actions">
          <button class="te-section-act" data-act="toggle" data-section="${id}" title="${enabled ? '隐藏' : '显示'}">${enabled ? '👁' : '⊘'}</button>
          <button class="te-section-act" data-act="up" data-section="${id}" title="上移" ${upDis}>↑</button>
          <button class="te-section-act" data-act="down" data-section="${id}" title="下移" ${downDis}>↓</button>
          <button class="te-section-act danger" data-act="delete" data-section="${id}" title="删除">🗑</button>
        </div>
      `;
    } else {
      actions = `<div class="te-section-actions"><span style="font-size:10px;color:#6d7175;padding:0 4px">固定</span></div>`;
    }

    return `
      <li>
        <div class="${cls}" data-section="${id}">
          <span class="te-section-grip">${isFixed ? '·' : '⋮⋮'}</span>
          <div class="te-section-main">
            <span class="te-section-icon">${schema.icon}</span>
            <span class="te-section-name">${escape(displayName)}</span>
            ${requiredCount ? `<span class="te-section-required" title="${requiredCount} 必填">${requiredCount}</span>` : ''}
          </div>
          ${actions}
        </div>
      </li>
    `;
  }

  function makeSimpleRow(id, schema) {
    const cls = ['te-section-row', currentSection === id ? 'active' : ''].filter(Boolean).join(' ');
    const requiredCount = (schema.fields || []).filter((n) => fieldByName[n] && fieldByName[n].required).length;
    return `
      <li>
        <div class="${cls}" data-section="${id}">
          <span class="te-section-grip">·</span>
          <div class="te-section-main">
            <span class="te-section-icon">${schema.icon}</span>
            <span class="te-section-name">${escape(schema.name)}</span>
            ${requiredCount ? `<span class="te-section-required" title="${requiredCount} 必填">${requiredCount}</span>` : ''}
          </div>
        </div>
      </li>
    `;
  }

  function makeAddSectionWrap(_cfg) {
    // 始终显示所有 7 种 non-fixed section type，可重复添加（多实例）
    const types = Object.keys(SECTION_SCHEMAS).filter((t) => !SECTION_SCHEMAS[t].fixed);
    const items = types.map((type) => `
      <button class="te-add-menu-item" data-section-type="${type}">
        <span class="te-section-icon">${SECTION_SCHEMAS[type].icon}</span>
        <span>${escape(SECTION_SCHEMAS[type].name)}</span>
      </button>
    `).join('');
    return `
      <li>
        <div class="te-add-section-wrap">
          <button class="te-add-section-btn" id="te-add-section-btn">+ 添加分区</button>
          <div class="te-add-menu" id="te-add-menu">${items}</div>
        </div>
      </li>
    `;
  }

  function selectSection(id) {
    currentSection = id;
    document.querySelectorAll('.te-section-row').forEach((b) => {
      b.classList.toggle('active', b.dataset.section === id);
    });
    renderInspector(id);
    highlightStorefrontSection(id);
  }
  function highlightStorefrontSection(id) {
    document.querySelectorAll('.storefront .shopify-section').forEach((el) => el.classList.remove('editor-selected'));
    const el = document.getElementById('shopify-section-' + id);
    if (el) {
      el.classList.add('editor-selected');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* sections 增删/排序 */
  function toggleSection(id) {
    const cfg = getSectionsConfig().slice();
    const item = cfg.find((c) => c.id === id);
    if (!item) return;
    item.enabled = item.enabled === false;
    setSectionsConfig(cfg);
    toast(item.enabled !== false ? '已显示分区' : '已隐藏分区');
  }
  function moveSection(id, delta) {
    const cfg = getSectionsConfig().slice();
    const idx = cfg.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= cfg.length) return;
    [cfg[idx], cfg[newIdx]] = [cfg[newIdx], cfg[idx]];
    setSectionsConfig(cfg);
  }
  function deleteSection(id) {
    if (!confirm('确认删除此分区？删除后可在「+ 添加分区」中重新加入。')) return;
    const cfg = getSectionsConfig().filter((c) => c.id !== id);
    setSectionsConfig(cfg);
    if (currentSection === id) selectSection('theme-settings');
    toast('已删除分区');
  }
  function addSection(type) {
    if (!SECTION_SCHEMAS[type]) return;
    const cfg = getSectionsConfig().slice();
    // 生成唯一 instance id
    let id = type;
    let n = 2;
    while (cfg.find((c) => c.id === id)) { id = `${type}_${n++}`; }
    cfg.push({ id, type, enabled: true });
    setSectionsConfig(cfg);
    selectSection(id);
    toast('已添加分区');
    const menu = document.getElementById('te-add-menu');
    if (menu) menu.classList.remove('open');
  }

  function bindGlobalClicks() {
    // 点击外部关闭 add-menu
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#te-add-menu, #te-add-section-btn')) {
        const menu = document.getElementById('te-add-menu');
        if (menu) menu.classList.remove('open');
      }
    });
  }

  /* ===== Inspector ===== */
  function renderInspector(sectionId) {
    const schema = getSectionSchema(sectionId);
    const titleEl = document.getElementById('inspector-title');
    const contentEl = document.getElementById('inspector-content');
    titleEl.textContent = schema ? schema.name : '主题设置';
    if (!schema) {
      contentEl.innerHTML = '<div class="te-inspector-tip">从左侧选择一个分区开始编辑。</div>';
      return;
    }
    const tip = sectionTip(sectionId);
    const fields = (schema.fields || []).map((n) => fieldByName[n]).filter(Boolean);
    contentEl.innerHTML = `
      ${tip ? `<div class="te-inspector-tip">${tip}</div>` : ''}
      ${fields.map(renderField).join('')}
    `;
    bindInspector();
  }

  function sectionTip(id) {
    const type = sectionTypeFor(id);
    const tips = {
      'header': 'Header 是商店各页面的顶部，含 logo、菜单和图标。',
      'announcement': '公告栏显示在 Header 上方，常用于优惠活动。',
      'hero': '图像横幅是访客打开店铺的第一眼。',
      'product-list': '在下方"产品列表"中可以添加/编辑/删除每个产品。',
      'featured-product': '单品精选 — 突出产品列表中的第 1 个产品（左图右信息）。共享 products[0] 作为内容来源，businessDescription 作为产品描述。',
      'image-with-text': '左图右文版块，用于展示品牌故事。',
      'multicolumn': '多栏版块（3 列），常用于价值主张或服务承诺。',
      'rich-text': '居中富文本块，用于品牌宣言、专题介绍。在 Editorial 模板下，第一个 rich-text 显示为大字标题（hxl），第二个起显示为 eyebrow + h0 双层标题。',
      'image-banner': '大图横幅 + 内容浮窗。共享 heroImage / heroHeading 等字段，但视觉上比 hero 更"图形化"，含两个 CTA 按钮。',
      'newsletter': '邮件订阅入口，捕获访客的邮箱。',
      'footer': '页脚含联系方式、社交媒体、菜单链接。',
      'theme-settings': '影响整个商店的全局设置：主题、配色、字体、品牌色。',
      'business-info': 'Sidekick 用这些信息生成更精准的设计建议。也用于"我们的故事"图文版块。',
      'publish': '完成定制后选择发布或保存为草稿。',
    };
    let tip = tips[type] || '';
    // 多实例提示
    if (id !== type && SECTION_SCHEMAS[type]) {
      tip = `<strong>多实例：</strong>这是「${SECTION_SCHEMAS[type].name}」的另一个实例。所有同类型实例共享下方字段值（mock 中字段为单一来源）。<br><br>` + tip;
    }
    return tip;
  }

  function renderField(f) {
    const required = f.required ? '<span class="te-required">*</span>' : '';
    const labelHtml = `<label class="te-field-label">${escape(f.label)}${required}</label>`;
    let inputHtml = '';
    switch (f.name) {
      case 'theme':         inputHtml = visualRadios(f.name, THEMES.map((t) => ({value:t.value,name:t.value,desc:t.desc})), 'cols-5'); break;
      case 'colorScheme':   inputHtml = colorSchemeRadios(f.name); break;
      case 'headerLayout':  inputHtml = visualRadios(f.name, HEADER_LAYOUT.map((h) => ({value:h.value,name:h.name,preview:h.preview})), 'cols-3'); break;
      case 'publishStatus': inputHtml = visualRadios(f.name, PUBLISH_STATUS.map((p) => ({value:p.value,name:p.name,desc:p.desc})), 'cols-2'); break;
      case 'menuItems':     inputHtml = menuItemsEditor(); break;
      case 'products':      inputHtml = productsEditor(); break;
      case 'logo':
      case 'favicon':
      case 'heroImage':     inputHtml = fileUpload(f); break;
      case 'brandColor':    inputHtml = colorInput(f); break;
      default:
        if (f.type === 'select')        inputHtml = selectInput(f);
        else if (f.type === 'textarea') inputHtml = textareaInput(f);
        else if (f.type === 'checkbox') return checkboxInput(f);
        else                            inputHtml = textInput(f);
    }
    return `<div class="te-field" data-field="${f.name}">${labelHtml}${inputHtml}</div>`;
  }

  function textInput(f) {
    const v = formState[f.name] || '';
    return `<input type="text" class="te-input" data-name="${f.name}" value="${escape(v)}" placeholder="${escape(f.label)}" />`;
  }
  function textareaInput(f) {
    const v = formState[f.name] || '';
    return `<textarea class="te-textarea" data-name="${f.name}" placeholder="${escape(f.label)}">${escape(v)}</textarea>`;
  }
  function selectInput(f) {
    const opts = OPTIONS[f.name] || [];
    const v = formState[f.name] || '';
    return `<select class="te-select" data-name="${f.name}">
      <option value="">— 请选择 —</option>
      ${opts.map((o) => `<option value="${escape(o)}" ${o===v?'selected':''}>${escape(o)}</option>`).join('')}
    </select>`;
  }
  function checkboxInput(f) {
    const checked = formState[f.name] === 'true';
    const required = f.required ? '<span class="te-required">*</span>' : '';
    return `
      <div class="te-field" data-field="${f.name}">
        <label class="te-checkbox-row">
          <input type="checkbox" data-name="${f.name}" ${checked?'checked':''} />
          <span><strong>${escape(f.label)}</strong>${required}<br><span class="te-field-help">勾选即视为已阅读 Shopify 主题服务条款</span></span>
        </label>
      </div>
    `;
  }

  function visualRadios(name, items, cols) {
    const v = formState[name] || '';
    return `<div class="te-visual-radios ${cols||''}">
      ${items.map((it) => `
        <label class="te-visual-card ${v===it.value?'checked':''}" data-radio-card="${name}" data-radio-value="${escape(it.value)}">
          <input type="radio" name="te-radio-${name}" data-name="${name}" value="${escape(it.value)}" ${v===it.value?'checked':''} />
          <div class="te-visual-thumb" style="${visualThumbStyle(it)}">${it.preview || (it.name || '').slice(0,1)}</div>
          <div class="te-visual-name">${escape(it.name)}</div>
          ${it.desc ? `<div class="te-visual-meta">${escape(it.desc)}</div>` : ''}
        </label>
      `).join('')}
    </div>`;
  }
  function visualThumbStyle(it) {
    if (it.preview) return 'background:#f1f1f1;color:#202223;font-size:13px';
    return 'background:linear-gradient(135deg,#1c004f,#7126ff);color:#fff';
  }
  function colorSchemeRadios(name) {
    const v = formState[name] || '';
    return `<div class="te-visual-radios cols-2" style="grid-template-columns:1fr 1fr">
      ${COLOR_SCHEMES.map((c) => `
        <label class="te-visual-card ${v===c.value?'checked':''}" data-radio-card="${name}" data-radio-value="${escape(c.value)}">
          <input type="radio" name="te-radio-${name}" data-name="${name}" value="${escape(c.value)}" ${v===c.value?'checked':''} />
          <div class="te-visual-thumb" style="background:${c.heroBg};color:${c.text};font-size:11px">${escape(c.value.split(' ')[0])}</div>
          <div class="te-visual-name">${escape(c.value)}</div>
          <div class="te-visual-meta">
            <span class="te-color-dot" style="background:${c.bg}"></span>
            <span class="te-color-dot" style="background:${c.text}"></span>
            <span class="te-color-dot" style="background:${c.accent}"></span>
          </div>
        </label>
      `).join('')}
    </div>`;
  }

  function fileUpload(f) {
    const url = fileBlobUrls[f.name];
    const fileName = (fileObjects[f.name] && fileObjects[f.name].name) || formState[f.name] || '';
    const placeholder = f.name === 'favicon' ? '🔖' : f.name === 'logo' ? '🏪' : '🖼️';
    return `
      <div class="te-file-upload" data-file-field="${f.name}">
        <div class="te-file-thumb" style="${url?`background-image:url(${url})`:''}">${url?'':placeholder}</div>
        <div class="te-file-meta">
          <strong>${escape(fileName) || '未上传'}</strong>
          <span>建议 ${f.name==='heroImage'?'1500×900':f.name==='logo'?'400×100':'64×64'}，PNG/JPG/WebP</span>
          <div class="te-file-buttons">
            <label class="te-file-btn">
              选择文件<input type="file" data-name="${f.name}" accept="image/*" />
            </label>
            <button type="button" class="te-file-btn danger" data-clear-file="${f.name}">移除</button>
          </div>
        </div>
      </div>
    `;
  }

  function colorInput(f) {
    const v = formState[f.name] || '#7126ff';
    return `<div class="te-color-input">
      <input type="color" data-color-picker="${f.name}" value="${escape(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)?v:'#7126ff')}" />
      <input type="text" class="te-input" data-name="${f.name}" value="${escape(v)}" placeholder="#7126ff" style="max-width:140px" />
      <span class="te-field-help">用于按钮和强调色</span>
    </div>`;
  }

  function menuItemsEditor() {
    let items = [];
    try { items = JSON.parse(formState.menuItems || '[]'); } catch {}
    if (!items.length) items = [{label:''}];
    const rows = items.map(menuRowHtml).join('');
    return `<div class="te-menu-editor">
      <div class="te-menu-list" id="menu-list">${rows}</div>
      <button type="button" class="te-menu-add" id="menu-add">+ 添加菜单项</button>
    </div>`;
  }
  function menuRowHtml(it, i) {
    return `<div class="te-menu-row">
      <input type="text" data-menu-label="${i}" value="${escape(it.label||'')}" placeholder="名称（如：首页）" />
      <button type="button" class="btn-remove" data-menu-remove="${i}" title="删除">×</button>
    </div>`;
  }

  function productsEditor() {
    const products = getProducts();
    const rows = products.map(productRowHtml).join('');
    return `<div class="te-field-help" style="margin-bottom:8px">编辑产品标题、价格和图片。预览中"推荐产品系列"会实时同步。</div>
      <div class="te-products-editor" id="products-list">${rows}</div>
      <button type="button" class="te-product-add" id="products-add">+ 添加产品</button>`;
  }
  function productRowHtml(p, i) {
    const img = (p.image || '').toString();
    const hasImg = /^(https?:|blob:|data:|\/)/i.test(img);
    return `<div class="te-product-row" data-product-idx="${i}">
      <div class="te-product-thumb-box ${hasImg ? 'has-image' : ''}" data-product-pick="${i}" tabindex="0" role="button" title="点击选择图片">
        <input type="file" accept="image/*" hidden data-product-file="${i}" />
        ${hasImg
          ? `<img src="${escape(img)}" alt="" />`
          : `<div class="te-product-thumb-empty">
               <svg width="24" height="24" viewBox="0 0 20 20" fill="#8c9196"><path d="M2 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4zm2 0v7.586l2.293-2.293a1 1 0 0 1 1.414 0L10 11.586l3.293-3.293a1 1 0 0 1 1.414 0L16 9.586V4H4zm0 12v-.586l3-3 2.293 2.293a1 1 0 0 0 1.414 0L14 11.414 16 13.414V16H4zM13 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>
               <div class="te-product-thumb-hint">选择图片</div>
             </div>`}
      </div>
      <div class="te-product-info">
        <input class="te-input" type="text" data-product-title="${i}" value="${escape(p.title || '')}" placeholder="产品标题" />
        <input class="te-input" type="number" step="0.01" data-product-price="${i}" value="${escape(p.price != null ? p.price : '')}" placeholder="价格" />
        ${hasImg ? `<button type="button" class="te-product-clear-btn" data-product-clear="${i}">移除图片</button>` : ''}
      </div>
      <div class="te-product-actions">
        <button type="button" class="te-product-act" data-product-up="${i}" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="te-product-act" data-product-down="${i}" title="下移">↓</button>
        <button type="button" class="te-product-act danger" data-product-remove="${i}" title="删除">×</button>
      </div>
    </div>`;
  }

  /* ===== Inspector 内部事件绑定 ===== */
  function bindInspector() {
    document.querySelectorAll('#inspector-content [data-name]').forEach((el) => {
      if (el.matches('input[type="file"]')) return;
      if (el.matches('input[type="color"]')) return;
      if (el.matches('input[type="checkbox"]')) {
        el.addEventListener('change', () => {
          formState[el.dataset.name] = el.checked ? 'true' : '';
          renderPreview();
        });
        return;
      }
      if (el.matches('input[type="radio"]')) {
        // radio 的 click 由 [data-radio-card] handler 接管（支持取消选中），这里不绑 change
        return;
      }
      el.addEventListener('input', () => {
        formState[el.dataset.name] = el.value;
        renderPreview();
      });
    });

    // color picker
    document.querySelectorAll('#inspector-content [data-color-picker]').forEach((picker) => {
      const name = picker.getAttribute('data-color-picker');
      const txt = document.querySelector(`#inspector-content [data-name="${name}"]`);
      picker.addEventListener('input', () => {
        if (txt) txt.value = picker.value;
        formState[name] = picker.value;
        renderPreview();
      });
      if (txt) txt.addEventListener('input', () => {
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(txt.value)) picker.value = txt.value;
        renderPreview();
      });
    });

    // file uploads
    document.querySelectorAll('#inspector-content input[type="file"]').forEach((input) => {
      input.addEventListener('change', () => {
        const name = input.dataset.name;
        const f = input.files && input.files[0];
        if (!f) return;
        if (fileBlobUrls[name]) URL.revokeObjectURL(fileBlobUrls[name]);
        fileObjects[name] = f;
        fileBlobUrls[name] = URL.createObjectURL(f);
        formState[name] = f.name;
        renderInspector(currentSection);
        renderPreview();
      });
    });
    document.querySelectorAll('#inspector-content [data-clear-file]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-clear-file');
        if (fileBlobUrls[name]) { URL.revokeObjectURL(fileBlobUrls[name]); delete fileBlobUrls[name]; }
        delete fileObjects[name];
        delete formState[name];
        renderInspector(currentSection);
        renderPreview();
      });
    });

    // menu items editor
    const menuList = document.getElementById('menu-list');
    if (menuList) {
      menuList.addEventListener('input', syncMenu);
      menuList.addEventListener('click', (e) => {
        if (e.target.matches('[data-menu-remove]')) {
          e.target.closest('.te-menu-row').remove();
          syncMenu();
        }
      });
      const addBtn = document.getElementById('menu-add');
      if (addBtn) addBtn.addEventListener('click', () => {
        const items = currentMenuItems();
        items.push({label:''});
        formState.menuItems = JSON.stringify(items);
        renderInspector(currentSection);
      });
    }

    // visual-card radios — 点击切换 / 已选再点取消
    document.querySelectorAll('#inspector-content [data-radio-card]').forEach((card) => {
      card.addEventListener('click', (e) => {
        const name = card.getAttribute('data-radio-card');
        const value = card.getAttribute('data-radio-value');
        e.preventDefault();
        if (formState[name] === value) {
          // 已选中 → 取消
          formState[name] = '';
          document.querySelectorAll(`#inspector-content input[data-name="${name}"]`).forEach((inp) => {
            inp.checked = false;
            const c = inp.closest('.te-visual-card');
            if (c) c.classList.remove('checked');
          });
          renderPreview();
          return;
        }

        // 切换选中
        formState[name] = value;

        // 联动：colorScheme → 自动重置 brandColor 为该 scheme 的 accent
        let needRerenderInspector = false;
        if (name === 'colorScheme') {
          const scheme = COLOR_SCHEMES.find((s) => s.value === value);
          if (scheme) {
            formState.brandColor = scheme.accent;
            needRerenderInspector = true;
            toast('已根据配色方案重置品牌主色');
          }
        }
        // 联动：theme → 自动重置 fontHeading 为该 theme 的 preset 字体
        if (name === 'theme') {
          const presets = (window.StorefrontRenderer && window.StorefrontRenderer.THEME_PRESETS) || {};
          const p = presets[value];
          if (p && p.fontHeading) {
            formState.fontHeading = p.fontHeading;
            needRerenderInspector = true;
            toast('已根据主题重置标题字体');
          }
        }

        if (needRerenderInspector) {
          renderInspector(currentSection);
        } else {
          document.querySelectorAll(`#inspector-content input[data-name="${name}"]`).forEach((inp) => {
            inp.checked = (inp.value === value);
            const c = inp.closest('.te-visual-card');
            if (c) c.classList.toggle('checked', inp.checked);
          });
        }
        renderPreview();
      });
    });

    // products editor
    const productsList = document.getElementById('products-list');
    if (productsList) {
      productsList.addEventListener('input', syncProducts);
      productsList.addEventListener('click', (e) => {
        // 上传按钮 → 触发 file picker
        const pickBtn = e.target.closest('[data-product-pick]');
        if (pickBtn) {
          const i = +pickBtn.getAttribute('data-product-pick');
          const fileInput = productsList.querySelector(`input[type="file"][data-product-file="${i}"]`);
          if (fileInput) fileInput.click();
          return;
        }
        // 清除图片
        const clearBtn = e.target.closest('[data-product-clear]');
        if (clearBtn) {
          const i = +clearBtn.getAttribute('data-product-clear');
          const arr = getProducts().slice();
          if (arr[i]) arr[i].image = '';
          setProducts(arr);
          return;
        }
        // 上下移动 / 删除
        const btn = e.target.closest('[data-product-remove],[data-product-up],[data-product-down]');
        if (!btn) return;
        const arr = currentProductsFromForm();
        if (btn.hasAttribute('data-product-remove')) {
          const i = +btn.getAttribute('data-product-remove');
          arr.splice(i, 1);
          setProducts(arr);
        } else if (btn.hasAttribute('data-product-up')) {
          const i = +btn.getAttribute('data-product-up');
          if (i > 0) { [arr[i-1], arr[i]] = [arr[i], arr[i-1]]; setProducts(arr); }
        } else if (btn.hasAttribute('data-product-down')) {
          const i = +btn.getAttribute('data-product-down');
          if (i < arr.length-1) { [arr[i], arr[i+1]] = [arr[i+1], arr[i]]; setProducts(arr); }
        }
      });
      // 文件选择 → FileReader 转 DataURL → 写入 products[i].image
      productsList.addEventListener('change', (e) => {
        const fileInput = e.target.closest('input[type="file"][data-product-file]');
        if (!fileInput) return;
        const i = +fileInput.getAttribute('data-product-file');
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) {
          toast('图片过大（>4MB），请压缩后再传');
          fileInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const arr = getProducts().slice();
          while (arr.length <= i) arr.push({ title: '', price: 0, image: '' });
          arr[i].image = String(reader.result);
          setProducts(arr);
        };
        reader.readAsDataURL(file);
      });
      const addBtn = document.getElementById('products-add');
      if (addBtn) addBtn.addEventListener('click', () => {
        const arr = currentProductsFromForm();
        arr.push({ title: '新产品', price: 0, image: '' });
        setProducts(arr);
      });
    }
  }
  function currentMenuItems() {
    const rows = document.querySelectorAll('#menu-list .te-menu-row');
    return Array.from(rows).map((r) => ({
      label: (r.querySelector('[data-menu-label]') || {}).value || '',
    }));
  }
  function syncMenu() {
    const items = currentMenuItems().filter((x) => x.label);
    formState.menuItems = JSON.stringify(items);
    renderPreview();
  }
  function currentProductsFromForm() {
    const arr = getProducts().slice();
    document.querySelectorAll('#products-list .te-product-row').forEach((r) => {
      const i = +r.getAttribute('data-product-idx');
      while (arr.length <= i) arr.push({ title: '', price: 0, image: '' });
      const titleEl = r.querySelector('[data-product-title]');
      const priceEl = r.querySelector('[data-product-price]');
      if (titleEl) arr[i].title = titleEl.value;
      if (priceEl) arr[i].price = priceEl.value !== '' ? parseFloat(priceEl.value) : 0;
    });
    return arr;
  }
  function syncProducts() {
    const arr = currentProductsFromForm();
    formState.products = JSON.stringify(arr);
    renderPreview();
  }

  /* ===== Preview ===== */
  function renderPreview() {
    const root = document.getElementById('storefront-root');
    const html = window.StorefrontRenderer.render(formState, fileBlobUrls, { device: currentDevice });
    root.innerHTML = html;
    const badge = document.getElementById('te-theme-name-badge');
    if (badge) badge.innerHTML = `主题：<strong>${escape(formState.theme || 'Dawn')}</strong>`;

    // 让 storefront 中每个 section 可点击 → 切换 inspector
    document.querySelectorAll('#storefront-root .shopify-section').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('a[href]:not([href="#"])')) return;
        e.preventDefault();
        e.stopPropagation();
        const id = el.id.replace(/^shopify-section-/, '');
        // 兼容 fixed (header/footer) 和动态 instance id
        if (id) selectSection(id);
      });
      el.addEventListener('mouseenter', () => el.classList.add('editor-hover'));
      el.addEventListener('mouseleave', () => el.classList.remove('editor-hover'));
    });
    // 选中态高亮（按 instance id；header/footer 也可被选）
    const sel = document.getElementById('shopify-section-' + currentSection);
    if (sel) sel.classList.add('editor-selected');
  }

  /* ===== Topbar ===== */
  function bindTopbar() {
    document.querySelectorAll('.te-device').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.te-device').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentDevice = btn.dataset.device;
        document.getElementById('te-preview-frame').setAttribute('data-device', currentDevice);
        renderPreview();
      });
    });
    document.getElementById('btn-save').addEventListener('click', submit);
    document.getElementById('btn-discard').addEventListener('click', () => {
      if (!confirm('放弃所有未保存的更改？')) return;
      location.reload();
    });
    document.getElementById('btn-preview').addEventListener('click', () => {
      const w = window.open('', '_blank');
      if (!w) return toast('浏览器拦截了弹出窗口');
      w.document.write(`
        <!doctype html><html><head><meta charset="utf-8" /><title>预览 · ${escape(formState.storeName||'您的商店')}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@400;600;700;800&family=DM+Serif+Display&family=Bebas+Neue&family=Cormorant+Garamond:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=Lato:wght@400;700&family=Source+Sans+3:wght@400;600;700&family=Nunito+Sans:wght@400;600;700&family=Work+Sans:wght@400;500;600;700&display=swap" />
        <link rel="stylesheet" href="/storefront.css" /></head>
        <body style="margin:0">${window.StorefrontRenderer.render(formState, fileBlobUrls, { device: 'desktop' })}</body></html>
      `);
      w.document.close();
    });
  }

  /* ===== Sidekick popover ===== */
  function bindSidekick() {
    const popover = document.getElementById('sidekick-popover');
    const close = () => popover.classList.remove('open');
    const open = () => popover.classList.add('open');
    document.getElementById('open-sidekick').addEventListener('click', () => popover.classList.toggle('open'));
    document.getElementById('close-sidekick').addEventListener('click', close);

    function showTip(html) {
      const tip = document.getElementById('sk-tip');
      tip.style.display = 'block';
      tip.innerHTML = html;
    }

    document.getElementById('sk-describe').addEventListener('click', () => {
      const desc = (document.getElementById('sk-input').value || '').trim();
      if (!desc) {
        showTip('💡 请先在下方输入框描述您的业务。');
        document.getElementById('sk-input').focus();
        return;
      }
      autoFillFromDescription(desc);
      open();
    });
    document.getElementById('sk-send').addEventListener('click', () => document.getElementById('sk-describe').click());
    document.getElementById('sk-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('sk-describe').click();
      }
    });
    document.getElementById('sk-pick').addEventListener('click', () => {
      const t = THEMES[Math.floor(Math.random()*THEMES.length)];
      const c = COLOR_SCHEMES[Math.floor(Math.random()*COLOR_SCHEMES.length)];
      formState.theme = t.value;
      formState.colorScheme = c.value;
      renderInspector(currentSection);
      renderPreview();
      showTip(`🎨 已为您挑选 <strong>${t.value}</strong> 主题 + <strong>${c.value}</strong> 配色。`);
    });
    document.getElementById('sk-edit').addEventListener('click', () => {
      selectSection('header');
      showTip('🛠️ 已切换到 Header section，您可以从这里开始编辑。');
    });
  }

  function autoFillFromDescription(desc) {
    const lower = desc.toLowerCase();
    const map = [
      ['咖啡|茶|烘焙|餐|零食|饮料|食品', '食品饮料', 'Crave',  'Warm & Earthy',
        [{title:'手冲咖啡豆 250g',price:88,image:''},{title:'冷萃浓缩液',price:48,image:''},{title:'手作司康 6 件',price:68,image:''},{title:'巧克力松露',price:128,image:''},{title:'茶包礼盒',price:158,image:''},{title:'蜂蜜柠檬',price:38,image:''},{title:'奶酪拼盘',price:188,image:''},{title:'有机果干',price:58,image:''}]],
      ['服装|衣|鞋|包|时装|裙', '服装鞋包', 'Studio', 'Bold & Modern',
        [{title:'经典牛仔外套',price:399,image:''},{title:'纯棉 T 恤',price:99,image:''},{title:'阔腿西装裤',price:299,image:''},{title:'帆布运动鞋',price:259,image:''},{title:'真皮托特包',price:599,image:''},{title:'丝巾',price:159,image:''},{title:'珍珠耳环',price:189,image:''},{title:'墨镜',price:229,image:''}]],
      ['美妆|护肤|化妆|香水', '美妆个护', 'Sense', 'Cool & Clean',
        [{title:'保湿精华 30ml',price:259,image:''},{title:'氨基酸洗面奶',price:118,image:''},{title:'香氛护手霜',price:88,image:''},{title:'天然唇膏',price:138,image:''},{title:'面膜 5 片',price:158,image:''},{title:'香水 50ml',price:489,image:''},{title:'磨砂膏',price:178,image:''},{title:'眼霜',price:299,image:''}]],
      ['家居|家具|沙发|灯|床|装饰', '家居家具', 'Refresh', 'Light & Bright',
        [{title:'北欧落地灯',price:899,image:''},{title:'纯棉床品四件套',price:599,image:''},{title:'手工陶瓷花瓶',price:299,image:''},{title:'实木相框',price:159,image:''},{title:'编织地毯',price:1299,image:''},{title:'香薰蜡烛',price:188,image:''},{title:'榻榻米坐垫',price:399,image:''},{title:'墙面挂画',price:259,image:''}]],
    ];
    let pick = ['其他', 'Dawn', 'Light & Bright', null];
    for (const [pat, ind, th, sc, prods] of map) {
      if (new RegExp(pat).test(lower)) { pick = [ind, th, sc, prods]; break; }
    }
    const [industry, theme, colorScheme, prods] = pick;

    Object.assign(formState, {
      industry, theme, colorScheme,
      businessDescription: desc,
      fontHeading: theme === 'Crave' ? 'DM Serif Display' : theme === 'Sense' ? 'Cormorant Garamond' : 'Inter',
      fontBody: 'Inter',
    });
    if (!formState.storeName) formState.storeName = industry === '食品饮料' ? '甄选好味' : industry === '美妆个护' ? '净颜美研' : industry === '服装鞋包' ? '简衣志' : '我的商店';
    if (!formState.slogan) formState.slogan = '精选好物 · 用心交付';
    if (!formState.heroHeading) formState.heroHeading = '为您甄选 · 每一件都值得';
    if (!formState.heroSubheading) formState.heroSubheading = '免邮活动 · 立即开启您的购物之旅';
    if (!formState.heroCTAText) formState.heroCTAText = '立即购买';
    if (!formState.heroCTALink) formState.heroCTALink = '/collections/all';
    if (!formState.featuredCollection) formState.featuredCollection = '人气产品';
    if (!formState.valueProp1) formState.valueProp1 = '全国免邮';
    if (!formState.valueProp2) formState.valueProp2 = '正品保证';
    if (!formState.valueProp3) formState.valueProp3 = '7 天无忧退换';
    if (!formState.announcementText) formState.announcementText = '欢迎光临 · 全场满 ¥299 包邮';
    if (!formState.newsletterText) formState.newsletterText = '订阅以获取新品和独家优惠';
    if (prods && !formState.products) formState.products = JSON.stringify(prods);

    renderInspector(currentSection);
    renderPreview();
    document.getElementById('sk-tip').style.display = 'block';
    document.getElementById('sk-tip').innerHTML = `✨ 已根据描述生成：行业=<strong>${industry}</strong>、主题=<strong>${theme}</strong>、配色=<strong>${colorScheme}</strong>，并填入推荐 Hero 文案 / 价值主张 / 公告文字${prods?' / 产品列表':''}。`;
    toast('已自动填充推荐值');
  }

  /* ===== Submit ===== */
  async function submit() {
    // 确保 sectionsConfig 有值（让 verify 时可见用户实际分区状态）
    if (!formState.sectionsConfig) formState.sectionsConfig = JSON.stringify(getSectionsConfig());
    if (!formState.products) formState.products = JSON.stringify(getProducts());

    const fd = new FormData();
    FIELDS.forEach((f) => {
      if (f.type === 'file') return;
      const v = formState[f.name];
      if (v !== undefined && v !== null && v !== '') fd.set(f.name, String(v));
    });
    Object.keys(fileObjects).forEach((name) => fd.set(name, fileObjects[name]));

    try {
      const uiToken = window.AdminAPI.getUiToken(SESSION_ID);
      const r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'X-Session-Id': SESSION_ID, 'X-Ui-Token': uiToken },
        credentials: 'same-origin',
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) return toast('提交失败：' + (data.error || r.status));
      toast('已保存 ' + data.fieldsSaved + ' 个字段');
      setTimeout(() => { location.href = '/result.html?session=' + SESSION_ID; }, 600);
    } catch (e) {
      toast('网络错误：' + e.message);
    }
  }

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
