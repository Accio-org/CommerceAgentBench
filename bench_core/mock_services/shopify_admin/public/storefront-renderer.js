// Shopify Storefront Renderer — 仿 Dawn / Sense 视觉
// 输入：formState (35+ 字段) + fileBlobUrls + opts(device)
// 输出：含 data-shopify-editor-section/-block 标签的完整 storefront HTML
// 关键能力：
//   1. sectionsConfig 控制 sections 启用/排序（动态 sections panel）
//   2. products JSON 字段驱动产品列表（每个产品独立可编辑）
(function () {
  const SCHEME_KEY = {
    'Light & Bright': 'light-bright',
    'Bold & Modern':  'bold-modern',
    'Warm & Earthy':  'warm-earthy',
    'Cool & Clean':   'cool-clean',
    'Dark Luxe':      'dark-luxe',
  };

  // Theme 预设：每个 theme 独立的字重、圆角、间距、默认字体、letter-spacing
  const THEME_PRESETS = {
    'Dawn':    { weight: 600, radius: 4,  spacing: 1.0, fontHeading: 'Inter',              letterSpacing: '-0.01em', textTransform: 'none' },
    'Sense':   { weight: 400, radius: 24, spacing: 1.05, fontHeading: 'Cormorant Garamond', letterSpacing: '0',       textTransform: 'none' },
    'Refresh': { weight: 700, radius: 0,  spacing: 0.95, fontHeading: 'Manrope',            letterSpacing: '-0.025em', textTransform: 'none' },
    'Studio':  { weight: 800, radius: 0,  spacing: 1.15, fontHeading: 'Bebas Neue',         letterSpacing: '0.04em',  textTransform: 'uppercase' },
    'Crave':   { weight: 700, radius: 12, spacing: 1.0, fontHeading: 'DM Serif Display',   letterSpacing: '-0.01em', textTransform: 'none' },
  };

  const DEFAULT_SECTIONS_CONFIG = [
    { id: 'announcement',    type: 'announcement',    enabled: true },
    { id: 'hero',            type: 'hero',            enabled: true },
    { id: 'product-list',    type: 'product-list',    enabled: true },
    { id: 'image-with-text', type: 'image-with-text', enabled: true },
    { id: 'multicolumn',     type: 'multicolumn',     enabled: true },
    { id: 'rich-text',       type: 'rich-text',       enabled: true },
    { id: 'newsletter',      type: 'newsletter',      enabled: true },
  ];

  // 主题模板预设 — 影响起始 sectionsConfig + theme + colorScheme + headerLayout
  const TEMPLATES = {
    classic: {
      key: 'classic',
      name: 'Dawn Classic',
      tagline: '经典零售范式',
      description: '大图 hero + 多产品网格 + 价值主张多栏。适合 SKU 多、强调促销与上架的电商。',
      theme: 'Dawn',
      colorScheme: 'Light & Bright',
      headerLayout: 'left',
      fontHeading: 'Inter',
      fontBody: 'Inter',
      sectionsConfig: [
        { id: 'announcement',    type: 'announcement',    enabled: true },
        { id: 'hero',            type: 'hero',            enabled: true },
        { id: 'product-list',    type: 'product-list',    enabled: true },
        { id: 'image-with-text', type: 'image-with-text', enabled: true },
        { id: 'multicolumn',     type: 'multicolumn',     enabled: true },
        { id: 'rich-text',       type: 'rich-text',       enabled: true },
        { id: 'newsletter',      type: 'newsletter',      enabled: true },
      ],
    },
    editorial: {
      key: 'editorial',
      name: 'Crave Editorial',
      tagline: '杂志感故事品牌',
      description: '大字标题 + 精选单品 + 图文故事 + 评价多栏 + 大图横幅。适合工艺/小众/单品爆款品牌。',
      theme: 'Crave',
      colorScheme: 'Warm & Earthy',
      headerLayout: 'center',
      fontHeading: 'DM Serif Display',
      fontBody: 'Lato',
      sectionsConfig: [
        { id: 'announcement',     type: 'announcement',     enabled: true },
        { id: 'rich-text',        type: 'rich-text',        enabled: true },
        { id: 'featured-product', type: 'featured-product', enabled: true },
        { id: 'image-with-text',  type: 'image-with-text',  enabled: true },
        { id: 'rich-text_2',      type: 'rich-text',        enabled: true },
        { id: 'multicolumn',      type: 'multicolumn',      enabled: true },
        { id: 'image-banner',     type: 'image-banner',     enabled: true },
      ],
    },
  };

  function normalizeSectionsConfig(arr) {
    return (arr || []).map((s) => ({
      id: s.id || s.type,
      type: s.type || s.id,
      enabled: s.enabled !== false,
    }));
  }

  const DEFAULT_PRODUCTS = [
    { title: '经典棉质 T 恤', price: 29.99, image: '👕' },
    { title: '复古牛仔裤',   price: 89.00, image: '👖' },
    { title: '运动连帽衫',   price: 79.50, image: '🧥' },
    { title: '简约腕表',     price: 199.00, image: '⌚' },
    { title: '帆布托特包',   price: 34.99, image: '👜' },
    { title: '皮革钱包',     price: 49.99, image: '👛' },
    { title: '纯棉袜子三双', price: 12.99, image: '🧦' },
    { title: '羊毛围巾',     price: 24.99, image: '🧣' },
  ];

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escAttr(s) { return esc(s); }
  function dataEditor(obj) {
    return `data-shopify-editor-section='${JSON.stringify(obj).replace(/'/g, '&#39;')}'`;
  }
  function dataBlock(obj) {
    return `data-shopify-editor-block='${JSON.stringify(obj).replace(/'/g, '&#39;')}'`;
  }
  function getFile(fileMap, name) { return (fileMap && fileMap[name]) || ''; }

  function parseJsonField(v) {
    try { return JSON.parse(v || '[]'); } catch { return []; }
  }
  function getProducts(v) {
    const arr = parseJsonField(v.products);
    return arr.length ? arr : DEFAULT_PRODUCTS;
  }
  function getSectionsConfig(v) {
    const arr = parseJsonField(v.sectionsConfig);
    return normalizeSectionsConfig(arr.length ? arr : DEFAULT_SECTIONS_CONFIG);
  }
  function formatPrice(p) {
    const n = typeof p === 'number' ? p : parseFloat(p);
    if (!isFinite(n)) return '¥0.00';
    return '¥' + n.toFixed(2);
  }
  function isUrl(s) { return typeof s === 'string' && /^(https?:|blob:|data:|\/)/i.test(s); }

  /* ============= announcement-bar ============= */
  function renderAnnouncement(v, _files, instanceId) {
    const id = instanceId || 'announcement';
    const text = (v.announcementText || '').trim();
    if (!text) {
      return `<div class="shopify-section announcement-section" id="shopify-section-${id}" ${dataEditor({id,type:'announcement-bar',disabled:true})}></div>`;
    }
    const link = (v.announcementLink || '').trim();
    const inner = link
      ? `<span class="announcement-bar__link">${esc(text)} →</span>`
      : esc(text);
    return `
      <div class="shopify-section announcement-section" id="shopify-section-${id}" ${dataEditor({id,type:'announcement-bar',disabled:false})}>
        <div class="announcement-bar">${inner}</div>
      </div>
    `;
  }

  /* ============= header ============= */
  function renderHeader(v, files) {
    const storeName = v.storeName || '您的商店';
    const layout = v.headerLayout || 'left';
    let menu = parseJsonField(v.menuItems);
    if (!menu.length) menu = [{label:'首页'},{label:'产品'},{label:'关于'},{label:'联系'}];

    const logoUrl = getFile(files, 'logo');
    const logoHTML = logoUrl
      ? `<img src="${escAttr(logoUrl)}" alt="${escAttr(storeName)}" /><span class="header__store-name">${esc(storeName)}</span>`
      : `<span class="header__store-name">${esc(storeName)}</span>`;

    const navHTML = menu.filter(m => m.label).map((m, i) =>
      `<span class="header__nav-item" ${dataBlock({id:'header__menu_'+i,domId:'menu-'+i,contentFor:'blocks'})}>${esc(m.label || '')}</span>`
    ).join('');

    return `
      <div class="shopify-section header-wrapper" id="shopify-section-header" ${dataEditor({id:'header',type:'header',disabled:false})}>
        <div class="header page-width" data-layout="${escAttr(layout)}">
          <div class="header__logo" ${dataBlock({id:'header__logo',domId:'logo',contentFor:'blocks'})}>${logoHTML}</div>
          <nav class="header__nav" ${dataBlock({id:'header__menu',domId:'menu',contentFor:'blocks'})}>${navHTML}</nav>
          <div class="header__icons">
            <span class="header__icon" title="搜索"><svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a7 7 0 105.7 11l3.6 3.6 1.4-1.4-3.6-3.6A7 7 0 009 2zm0 2a5 5 0 110 10 5 5 0 010-10z"/></svg></span>
            <span class="header__icon" title="账号"><svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M10 4a3 3 0 100 6 3 3 0 000-6zm0 8c-3 0-6 1.5-6 4v1h12v-1c0-2.5-3-4-6-4z"/></svg></span>
            <span class="header__icon header__cart" title="购物车"><svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M3 3h2l1 2h11l-2 8H7L4 4H3V3zm4 13a2 2 0 100 4 2 2 0 000-4zm9 0a2 2 0 100 4 2 2 0 000-4z"/></svg><span class="header__cart-badge">0</span></span>
          </div>
        </div>
      </div>
    `;
  }

  /* ============= hero (image-banner) ============= */
  function renderHero(v, files, instanceId) {
    const heading = v.heroHeading || '欢迎光临';
    const subheading = v.heroSubheading || v.slogan || '';
    const ctaText = v.heroCTAText || '立即购买';
    const heroUrl = getFile(files, 'heroImage');

    const mediaHTML = heroUrl
      ? `<img class="hero__media" src="${escAttr(heroUrl)}" alt="" /><div class="hero__overlay" style="--hero-overlay-end:0.45"></div>`
      : `${heroFallbackSVG()}<div class="hero__overlay" style="--hero-overlay-end:0.32"></div>`;

    const subHtml = subheading
      ? `<p class="hero__subheading" ${dataBlock({id:'hero__subheading',domId:'hero-sub',contentFor:'blocks'})}>${esc(subheading)}</p>`
      : '';

    const id = instanceId || 'hero';
    return `
      <div class="shopify-section hero-wrapper" id="shopify-section-${id}" ${dataEditor({id,type:'image-banner',disabled:false})}>
        <div class="hero" style="--hero-min-height: var(--section-height-medium); --hero-vertical-alignment: center; --hero-horizontal-alignment: center; --hero-text-align: center;">
          ${mediaHTML}
          <div class="hero__container">
            <div class="hero__content">
              <h2 class="hero__heading h1" ${dataBlock({id:id+'__heading',domId:id+'-h',contentFor:'blocks'})}>${esc(heading)}</h2>
              ${subHtml}
              <div class="hero__buttons">
                <span class="button" ${dataBlock({id:id+'__button',domId:id+'-btn',contentFor:'blocks'})}>${esc(ctaText)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function heroFallbackSVG() {
    return `<svg class="hero__media-svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgb(var(--color-accent-rgb))" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="rgb(var(--color-accent-rgb))" stop-opacity="1"/>
        </linearGradient>
        <radialGradient id="heroSpot" cx="35%" cy="40%" r="55%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.35)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#heroGrad)"/>
      <rect width="1600" height="900" fill="url(#heroSpot)"/>
      <path d="M0,650 Q400,540 800,640 T1600,650 L1600,900 L0,900 Z" fill="rgba(255,255,255,0.18)"/>
      <path d="M0,740 Q400,650 800,740 T1600,740 L1600,900 L0,900 Z" fill="rgba(255,255,255,0.12)"/>
      <circle cx="1180" cy="280" r="80" fill="rgba(255,255,255,0.22)"/>
      <circle cx="280" cy="220" r="100" fill="rgba(255,255,255,0.14)"/>
      <circle cx="1340" cy="180" r="42" fill="rgba(255,255,255,0.3)"/>
    </svg>`;
  }

  /* ============= product-list (featured-collection) ============= */
  function renderProductList(v, _files, instanceId) {
    const heading = (v.featuredCollection || '').trim() || '人气产品';
    const products = getProducts(v);

    const cards = products.map((p, i) => {
      let mediaHtml;
      const img = (p.image || '').toString().trim();
      if (isUrl(img)) {
        mediaHtml = `<img src="${escAttr(img)}" alt="${escAttr(p.title || '')}" />`;
      } else {
        mediaHtml = productPlaceholder(i);
      }
      return `
        <div class="product-card" ${dataBlock({id:'product-card-'+i,domId:'pcard-'+i,contentFor:'blocks'})}>
          <div class="product-card__media">${mediaHtml}</div>
          <h3 class="product-card__title">${esc(p.title || '产品标题')}</h3>
          <span class="product-card__price">${formatPrice(p.price)}</span>
        </div>
      `;
    }).join('');

    const id = instanceId || 'product-list';
    return `
      <div class="shopify-section ui-test-product-list" id="shopify-section-${id}" ${dataEditor({id,type:'featured-collection',disabled:false})}>
        <div class="product-list color-scheme-1">
          <div class="product-list__inner">
            <div class="product-list__header">
              <h2 class="product-list__heading h2" ${dataBlock({id:id+'__heading',domId:id+'-h',contentFor:'blocks'})}>${esc(heading)}</h2>
              <span class="product-list__view-all">查看全部</span>
            </div>
            <div class="product-grid" style="--columns:4">${cards}</div>
          </div>
        </div>
      </div>
    `;
  }

  function productPlaceholder(seed) {
    const palettes = [['#fde68a','#f59e0b'],['#bfdbfe','#3b82f6'],['#fecaca','#ef4444'],['#bbf7d0','#10b981'],['#ddd6fe','#8b5cf6'],['#fed7aa','#f97316'],['#a7f3d0','#14b8a6'],['#fbcfe8','#ec4899']];
    const c = palettes[seed % palettes.length];
    return `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg" class="empty-product-svg">
      <defs><linearGradient id="pg-${seed}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c[0]}"/><stop offset="100%" stop-color="${c[1]}"/></linearGradient></defs>
      <rect width="200" height="250" fill="url(#pg-${seed})"/>
      <circle cx="100" cy="100" r="36" fill="rgba(255,255,255,0.32)"/>
      <rect x="44" y="150" width="112" height="60" rx="6" fill="rgba(255,255,255,0.25)"/>
    </svg>`;
  }

  /* ============= image-with-text ============= */
  function renderImageWithText(v, files, instanceId) {
    const id = instanceId || 'image-with-text';
    const heading = v.storeName || '我们的故事';
    const body = v.businessDescription || '在这里讲述您的品牌故事 — 您是谁、做什么、为何与众不同。这段文字会引起客户共鸣，让他们记住您的品牌。';
    const heroUrl = getFile(files, 'heroImage');

    const mediaHtml = heroUrl
      ? `<img src="${escAttr(heroUrl)}" alt="" style="width:100%;height:100%;object-fit:cover" />`
      : `<svg viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
          <defs><linearGradient id="iwt-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="rgb(var(--color-accent-rgb))" stop-opacity="0.3"/><stop offset="100%" stop-color="rgb(var(--color-accent-rgb))" stop-opacity="0.7"/></linearGradient></defs>
          <rect width="400" height="500" fill="url(#iwt-grad)"/>
          <circle cx="200" cy="200" r="80" fill="rgba(255,255,255,0.4)"/>
          <rect x="120" y="280" width="160" height="140" rx="8" fill="rgba(255,255,255,0.3)"/>
        </svg>`;

    return `
      <div class="shopify-section" id="shopify-section-${id}" ${dataEditor({id,type:'image-with-text',disabled:false})}>
        <div class="image-with-text color-scheme-3">
          <div class="image-with-text__inner">
            <div class="image-with-text__grid" data-image-position="left">
              <div class="image-with-text__media" ${dataBlock({id:id+'__media',domId:id+'-media',contentFor:'blocks'})}>${mediaHtml}</div>
              <div class="image-with-text__content">
                <h2 class="image-with-text__heading h2" ${dataBlock({id:id+'__heading',domId:id+'-h',contentFor:'blocks'})}>${esc(heading)}</h2>
                <p class="image-with-text__body" ${dataBlock({id:id+'__body',domId:id+'-body',contentFor:'blocks'})}>${esc(body)}</p>
                <span class="button-secondary" ${dataBlock({id:id+'__button',domId:id+'-btn',contentFor:'blocks'})}>了解更多</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ============= multicolumn ============= */
  function renderMulticolumn(v, _files, instanceId) {
    const id = instanceId || 'multicolumn';
    const items = [
      { icon: '🚚', heading: v.valueProp1 || '快速发货', text: '订单确认后 24 小时内发出' },
      { icon: '⭐', heading: v.valueProp2 || '品质保证', text: '严选好物 · 正品承诺' },
      { icon: '↩️', heading: v.valueProp3 || '7 天无忧退换', text: '不满意，原价退款' },
    ];
    const cols = items.map((it, i) => `
      <div class="multicolumn__item" ${dataBlock({id:'mc__col_'+i,domId:'mc-col-'+i,contentFor:'blocks'})}>
        <div class="multicolumn__icon">${it.icon}</div>
        <h3 class="multicolumn__item-heading">${esc(it.heading)}</h3>
        <p class="multicolumn__item-text">${esc(it.text)}</p>
      </div>
    `).join('');

    return `
      <div class="shopify-section" id="shopify-section-${id}" ${dataEditor({id,type:'multicolumn',disabled:false})}>
        <div class="multicolumn color-scheme-1">
          <div class="multicolumn__inner">
            <h2 class="multicolumn__heading h2">为什么选择我们</h2>
            <div class="multicolumn__grid" style="--columns:3">${cols}</div>
          </div>
        </div>
      </div>
    `;
  }

  /* ============= rich-text ============= */
  // 形态：
  //   simple    — h2 中等标题 + 正文（classic 模板）
  //   headline  — hxl 巨标，无正文（editorial 第一个 rich-text，类似 shopify6 "Handcrafted products"）
  //   testimony — eyebrow 小标 + h0 巨标（editorial 第二个 rich-text，类似 shopify6 "THE REVIEWS / Testimonials"）
  function renderRichText(v, _files, instanceId, variant) {
    const id = instanceId || 'rich-text';
    const body = (v.richTextContent || '').trim();
    const tpl = v.themeTemplate || 'classic';
    const v2 = variant || (tpl === 'editorial' ? (instanceId && /(_|-)?2$/.test(instanceId) ? 'testimony' : 'headline') : 'simple');

    if (v2 === 'headline') {
      const heading = body || 'Handcrafted products';
      return `
        <div class="shopify-section" id="shopify-section-${id}" ${dataEditor({id,type:'rich-text',disabled:false})}>
          <div class="rich-text rich-text--headline color-scheme-1">
            <div class="rich-text__container rich-text__container--center">
              <h2 class="rich-text__heading hxl" ${dataBlock({id:id+'__heading',domId:id+'-h',contentFor:'blocks'})}>${esc(heading)}</h2>
            </div>
          </div>
        </div>
      `;
    }
    if (v2 === 'testimony') {
      return `
        <div class="shopify-section" id="shopify-section-${id}" ${dataEditor({id,type:'rich-text',disabled:false})}>
          <div class="rich-text rich-text--testimony color-scheme-3">
            <div class="rich-text__container rich-text__container--center">
              <p class="rich-text__eyebrow" ${dataBlock({id:id+'__eyebrow',domId:id+'-e',contentFor:'blocks'})}>THE REVIEWS</p>
              <h2 class="rich-text__heading h0" ${dataBlock({id:id+'__heading',domId:id+'-h',contentFor:'blocks'})}>Testimonials</h2>
            </div>
          </div>
        </div>
      `;
    }
    // simple
    if (!body) {
      return `<div class="shopify-section" id="shopify-section-${id}" ${dataEditor({id,type:'rich-text',disabled:true})}></div>`;
    }
    return `
      <div class="shopify-section" id="shopify-section-${id}" ${dataEditor({id,type:'rich-text',disabled:false})}>
        <div class="rich-text color-scheme-4">
          <div class="rich-text__container">
            <h2 class="rich-text__heading h2" ${dataBlock({id:id+'__heading',domId:id+'-h',contentFor:'blocks'})}>了解我们的承诺</h2>
            <p class="rich-text__body" ${dataBlock({id:id+'__body',domId:id+'-body',contentFor:'blocks'})}>${esc(body)}</p>
          </div>
        </div>
      </div>
    `;
  }

  /* ============= featured-product (单品精选) ============= */
  function renderFeaturedProduct(v, files, instanceId) {
    const id = instanceId || 'featured-product';
    const products = getProducts(v);
    const p = products[0] || { title: '产品标题示例', price: 19.99, image: '' };
    const img = (p.image || '').toString().trim();
    const heroUrl = getFile(files, 'heroImage');

    let mediaHtml;
    if (isUrl(img)) {
      mediaHtml = `<img src="${escAttr(img)}" alt="${escAttr(p.title || '')}" />`;
    } else if (heroUrl) {
      mediaHtml = `<img src="${escAttr(heroUrl)}" alt="${escAttr(p.title || '')}" />`;
    } else {
      mediaHtml = featuredProductPlaceholder();
    }

    const desc = (v.businessDescription || '').trim() ||
      'Enter a description of your featured product. Make sure to mention what makes it special, and what sets it apart from the competition.';

    return `
      <div class="shopify-section section-featured-product" id="shopify-section-${id}" ${dataEditor({id,type:'featured-product',disabled:false})}>
        <div class="featured-product color-scheme-1">
          <div class="featured-product__inner">
            <div class="featured-product__media" ${dataBlock({id:id+'__media',domId:id+'-media',contentFor:'blocks'})}>${mediaHtml}</div>
            <div class="featured-product__info">
              <h2 class="featured-product__title h2" ${dataBlock({id:id+'__title',domId:id+'-t',contentFor:'blocks'})}>${esc(p.title || '产品标题示例')}</h2>
              <div class="featured-product__price" ${dataBlock({id:id+'__price',domId:id+'-p',contentFor:'blocks'})}>
                <span class="price-item">${formatPrice(p.price)}</span>
              </div>
              <p class="featured-product__text" ${dataBlock({id:id+'__text',domId:id+'-text',contentFor:'blocks'})}>${esc(desc)}</p>
              <div class="featured-product__buy">
                <button class="button button--primary" type="button" ${dataBlock({id:id+'__buy',domId:id+'-buy',contentFor:'blocks'})}>添加到购物车</button>
              </div>
              <div class="featured-product__share">
                <button class="featured-product__share-btn" type="button">
                  <svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.6 8.1v2.2a1.1 1.1 0 0 0 1.1 1.1h7.6a1.1 1.1 0 0 0 1.1-1.1V8.1"/><path d="M6.5 1.1V8" stroke-width="1.4"/><path d="m3.4 4.7 3.1-3.1 3.1 3.1"/></svg>
                  分享
                </button>
                <a class="featured-product__details" href="#">查看完整详细信息 →</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function featuredProductPlaceholder() {
    return `<svg class="featured-product__placeholder-svg" viewBox="0 0 448 448" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <rect width="448" height="448" fill="#F2F2F2"/>
      <path d="m354.5 165-33-36a60 60 0 0 0-32-18l-21-4-8-1c-1.5-.3-3.5-.3-5 0l-15 3a73 73 0 0 1-27 0l-15-3c-1.5-.3-3.5-.3-5 0l-8 1-21 4a60 60 0 0 0-32 18l-33 36a8 8 0 0 0 .5 11l32 30a8 8 0 0 0 11-.3l9.5-9.5c2-2 5 0 5 2v137a8 8 0 0 0 8 8h128a8 8 0 0 0 8-8V198c0-2.5 3-4 5-2l9.5 9.5a8 8 0 0 0 11 .3l32-30a8 8 0 0 0 .5-11Z" fill="#DD6A5A"/>
      <path d="M252 106l-14 3a74 74 0 0 1-27 0l-14-3a30 30 0 0 0-8 0c1.4 19 17 33 36 33s35-14 36-33a30 30 0 0 0-8 0Z" fill="#C03D37"/>
      <path d="M232 119h-17a1.6 1.6 0 0 0-1.5 1.6v8a1.5 1.5 0 0 0 1.5 1.5h17a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.6Z" fill="#fff"/>
    </svg>`;
  }

  /* ============= image-banner (大图横幅+浮窗) ============= */
  function renderImageBanner(v, files, instanceId) {
    const id = instanceId || 'image-banner';
    const heading = v.heroHeading || '图片横幅';
    const sub = v.heroSubheading || v.slogan || '为客户提供有关模板中的横幅图片或内容的详细信息。';
    const cta = v.heroCTAText || '按钮标签';
    const heroUrl = getFile(files, 'heroImage');

    const mediaHtml = heroUrl
      ? `<img class="image-banner__media-img" src="${escAttr(heroUrl)}" alt="" />`
      : imageBannerPlaceholderSVG();

    return `
      <div class="shopify-section section-image-banner" id="shopify-section-${id}" ${dataEditor({id,type:'image-banner',disabled:false})}>
        <div class="image-banner">
          <div class="image-banner__media">${mediaHtml}</div>
          <div class="image-banner__container">
            <div class="image-banner__box color-scheme-1">
              <h2 class="image-banner__heading h1" ${dataBlock({id:id+'__heading',domId:id+'-h',contentFor:'blocks'})}>${esc(heading)}</h2>
              <p class="image-banner__text" ${dataBlock({id:id+'__text',domId:id+'-text',contentFor:'blocks'})}>${esc(sub)}</p>
              <div class="image-banner__buttons" ${dataBlock({id:id+'__buttons',domId:id+'-buttons',contentFor:'blocks'})}>
                <span class="button button--primary">${esc(cta)}</span>
                <span class="button button--primary">${esc(cta)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function imageBannerPlaceholderSVG() {
    // 仿 shopify6 的米色海岸 + 草坪线插画
    return `<svg class="image-banner__media-svg" viewBox="0 0 1300 730" preserveAspectRatio="xMaxYMid slice" xmlns="http://www.w3.org/2000/svg">
      <rect width="1300" height="410" fill="#E8BE9E"/>
      <rect y="410" width="1300" height="320" fill="#5BA7B1"/>
      <path d="M474 410c28-39 73-89 142-120 113-50 194-3 266-52 41-28 81-90 80-238h338v410H474Z" fill="#EDAB8E"/>
      <path d="M1174 0c-4 45-17 110-52 180-69 137-182 205-230 230h408V0h-126Z" fill="#EA9A81"/>
      <path d="M126 410c124 0 213-14 242-66 38-70-74-158-34-262 15-41 49-66 74-82H0v410h126Z" fill="#EDAB8E"/>
      <path d="M126 410c-68-117-69-250-2-334 36-44 83-65 116-76H0v410h126Z" fill="#EA9A81"/>
      <path d="M0 478c15 2 39 5 68 0 42-8 48-26 84-34 45-9 57 15 114 14 9-.2 18-1 25-2 36-7 62-18 68-21 22-10 66-17 157-.4 67-3 134-6 202-9 6-.7 18-2 33-2 57-1 91 12 158 16 17 1 29 .8 43-1 24-4 34-15 78-12 71 4 89 33 158 38 45 2 83-7 108-16v-36H0v68Z" fill="#63B5B1"/>
      <path d="M576 186c35 0 64-28 64-64s-28-64-64-64-64 28-64 64 28 64 64 64Z" fill="#EAD1C1"/>
      <circle cx="576" cy="122" r="48" fill="#fff"/>
    </svg>`;
  }

  /* ============= newsletter ============= */
  function renderNewsletter(v, _files, instanceId) {
    const id = instanceId || 'newsletter';
    const heading = '订阅我们的新闻通讯';
    const text = v.newsletterText || '订阅以获取新品和独家优惠';
    return `
      <div class="shopify-section" id="shopify-section-${id}" ${dataEditor({id,type:'email-signup',disabled:false})}>
        <div class="newsletter color-scheme-3">
          <div class="newsletter__container">
            <h2 class="newsletter__heading h2" ${dataBlock({id:id+'__heading',domId:id+'-h',contentFor:'blocks'})}>${esc(heading)}</h2>
            <p>${esc(text)}</p>
            <form class="newsletter__form" onsubmit="return false;">
              <input class="newsletter__input" type="email" placeholder="电子邮件地址" />
              <button class="newsletter__button" type="submit">订阅 →</button>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  /* ============= footer ============= */
  function renderFooter(v) {
    const storeName = v.storeName || '您的商店';
    const email = v.footerEmail || 'contact@example.com';

    return `
      <div class="shopify-section footer-wrapper" id="shopify-section-footer" ${dataEditor({id:'footer',type:'footer',disabled:false})}>
        <footer class="footer">
          <div class="footer__simple">
            <span class="footer__brand-name">${esc(storeName)}</span>
            <a href="mailto:${escAttr(email)}" class="footer__email">${esc(email)}</a>
          </div>
          <div class="footer__copyright">© ${new Date().getFullYear()} ${esc(storeName)} · 由 Shopify 提供技术支持</div>
        </footer>
      </div>
    `;
  }

  /* ============= compose ============= */
  const SECTION_RENDERERS = {
    'announcement':     renderAnnouncement,
    'hero':             renderHero,
    'product-list':     renderProductList,
    'featured-product': renderFeaturedProduct,
    'image-with-text':  renderImageWithText,
    'multicolumn':      renderMulticolumn,
    'rich-text':        renderRichText,
    'image-banner':     renderImageBanner,
    'newsletter':       renderNewsletter,
  };

  function render(values, files, opts) {
    const v = values || {};
    const f = files || {};
    const scheme = SCHEME_KEY[v.colorScheme] || 'light-bright';
    const themeName = v.theme || 'Dawn';
    const preset = THEME_PRESETS[themeName] || THEME_PRESETS.Dawn;
    // 用户显式选了 fontHeading 优先；否则用 theme 预设
    const fontH = v.fontHeading || preset.fontHeading;
    const fontB = v.fontBody || 'Inter';
    const accent = (v.brandColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.brandColor))
      ? hexToRgb(v.brandColor) : null;
    const accentStyle = accent ? `--color-accent-rgb: ${accent}; --color-button-rgb: ${accent};` : '';
    const themeStyle = `
      --font-heading-weight: ${preset.weight};
      --font-heading-letter-spacing: ${preset.letterSpacing};
      --font-heading-transform: ${preset.textTransform};
      --button-radius: ${preset.radius}px;
      --media-radius: ${preset.radius}px;
      --card-radius: ${preset.radius}px;
      --section-padding-block: ${Math.round(80 * preset.spacing)}px;
    `;
    const device = (opts && opts.device) || 'desktop';

    const cfg = getSectionsConfig(v);
    // announcement 永远紧贴 header 之上（多实例时取第一个 announcement-type instance）
    const announcementInst = cfg.find((s) => s.type === 'announcement' && s.enabled !== false);
    const announcementHtml = announcementInst ? renderAnnouncement(v, f, announcementInst.id) : '';

    const sameTypeCount = {};
    const tplKey = v.themeTemplate || 'classic';
    const mainSections = cfg
      .filter((s) => s.type !== 'announcement' && s.enabled !== false)
      .map((s) => {
        sameTypeCount[s.type] = (sameTypeCount[s.type] || 0) + 1;
        const num = sameTypeCount[s.type];
        const fn = SECTION_RENDERERS[s.type];
        let html = '';
        if (s.type === 'rich-text') {
          // editorial 模板下：第一个 rich-text 用 headline 形态，第二个起用 testimony 形态
          let variant;
          if (tplKey === 'editorial') variant = num === 1 ? 'headline' : 'testimony';
          else variant = 'simple';
          html = fn ? fn(v, f, s.id, variant) : '';
        } else {
          html = fn ? fn(v, f, s.id) : '';
        }
        if (num > 1 && html) {
          // 给 outer .shopify-section 加 multi-instance 标记
          html = html.replace(
            /(<div class="shopify-section[^"]*")/,
            `$1 data-instance-of="${s.type}" data-instance-num="${num}"`
          );
        }
        return html;
      })
      .join('');

    const inner = `
      ${announcementHtml}
      ${renderHeader(v, f)}
      <main class="storefront-main">${mainSections}</main>
      ${renderFooter(v)}
    `;
    return `<div class="storefront" data-scheme="${scheme}" data-theme="${escAttr(themeName)}" data-template="${escAttr(tplKey)}" data-device="${device}" style="--font-heading-family: '${escAttr(fontH)}', system-ui, sans-serif; --font-body-family: '${escAttr(fontB)}', system-ui, sans-serif; ${themeStyle} ${accentStyle}">${inner}</div>`;
  }

  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return `${r}, ${g}, ${b}`;
  }

  window.StorefrontRenderer = {
    render,
    DEFAULT_SECTIONS_CONFIG,
    DEFAULT_PRODUCTS,
    THEME_PRESETS,
    TEMPLATES,
    SECTION_TYPES: Object.keys(SECTION_RENDERERS),
  };
})();
