const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('./lib/admin');

const PORT = Number(process.env.PORT || 3062);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHOPIFY_MOCK_MODE = String(process.env.SHOPIFY_MOCK_MODE || 'ui').toLowerCase();
const UI_TOKEN = crypto.randomBytes(24).toString('base64url');
const BROWSER_COOKIE = 'shopify_v2_browser_nonce';
const browserNonces = new Set();
const NON_BROWSER_UA = /(curl|wget|python-requests|python-urllib|httpx|aiohttp|node-fetch|undici|axios|go-http-client|java|ruby|php|libwww|okhttp|postmanruntime)/i;
const BROWSER_UA = /(Mozilla|Chrome|Chromium|Safari|Firefox|Edg|OPR)/i;

// --- 1:1 real-DOM admin snapshots ----------------------------------------
// Captured from real Shopify (public/_pages/<name>.html + manifest.json).
// Map a route sub-path (e.g. "/products") to its snapshot file. Routes already
// implemented interactively by the theme/storefront app are excluded so static
// snapshots don't shadow real features.
const PAGES_DIR = path.join(PUBLIC_DIR, '_pages');
const SNAPSHOT_ROUTES = new Map();
function loadSnapshotRoutes() {
  SNAPSHOT_ROUTES.clear();
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(PAGES_DIR, 'manifest.json'), 'utf8'));
    for (const r of manifest) SNAPSHOT_ROUTES.set((r.path || '').replace(/\/$/, ''), `${r.name}.html`);
  } catch (e) { /* manifest not built yet */ }
}
loadSnapshotRoutes();
const SNAPSHOT_EXCLUDE = /^\/(themes|pages|online_store|online-store|content|storefront)\b|^\/settings\/(policies|legal|domains)\b/;
// Captured back-office list pages that live under an otherwise-excluded prefix
// but DO have a real 1:1 snapshot we want to serve. The broad exclude exists to
// keep the interactive theme/storefront app in charge; these specific Content
// list pages are back-office and were captured 1:1, so they override the exclude
// for their EXACT path only. Deeper interactive routes (e.g.
// /content/metaobjects/new) still fall through to the interactive app.
const SNAPSHOT_EXCLUDE_OVERRIDE = new Set([
  '/content/metaobjects',
  '/content/files',
  '/content/menus',
  // 在线商店 (Online Store) channel pages. These sit under the broad
  // /themes|/pages|/online_store exclude, so clicking "在线商店" in the nav
  // (→ /themes) used to drop to the generic Codex SPA ("编辑 Horizon" theme
  // editor) instead of the real page. Override the EXACT 在线商店 submenu routes
  // (主题 / 页面 / 偏好设置) only. NOTE: 主题 and 偏好设置 are a cross-origin
  // embedded app (online-store-web.shopifyapps.com) so their snapshots serve the
  // captured outer shell whose iframe points at a locally-rebuilt 1:1 inner page
  // (public/_embedded/<name>.html — see build pipeline). 页面 is native Polaris.
  // The deep interactive editor (/online-store/customize, /themes/<id>/editor)
  // and the page editors (/pages/new, /pages/<id>) still fall through to the
  // interactive app. blogs/blog_posts/menus are NOT overridden: they 404 /
  // fall back in real Shopify and are absent from the 在线商店 submenu.
  '/themes',
  '/pages',
  '/online_store/preferences',
  // Settings pages we captured 1:1 (the other ~19 settings routes already serve
  // 1:1; these were left on the generic SPA by the broad exclude). Serve 1:1 for
  // consistency. NOTE: real Shopify has no `/settings/policies` route (it 404s;
  // store policies live at `/settings/legal`, heading 政策) — so that path is NOT
  // overridden and stays on the SPA fallback.
  '/settings/legal',
  '/settings/domains',
]);
function adminSnapshotFile(pathname) {
  const m = pathname.match(/^\/store\/[^/]+(\/[^?]*)?$/);
  if (!m) return null;
  const sub = (m[1] || '').replace(/\/$/, '');
  if (SNAPSHOT_EXCLUDE_OVERRIDE.has(sub) && SNAPSHOT_ROUTES.has(sub)) return SNAPSHOT_ROUTES.get(sub);
  if (sub && SNAPSHOT_EXCLUDE.test(sub)) return null;
  if (SNAPSHOT_ROUTES.has(sub)) return SNAPSHOT_ROUTES.get(sub);
  // /products/<x>: the left-nav points 库存/转移/产品系列 at /products/inventory,
  // /products/transfers, … but those snapshots are keyed at the TOP level
  // (/inventory, /transfers, …) — alias to them. Any OTHER /products/<id> is a
  // product detail/edit page → serve the captured product form (the L2 adapter
  // prefills it from /api/admin/products/:id and PUTs on save). Without this the
  // section links 404 to the products-list snapshot and ids hit nothing.
  const pseg = sub.match(/^\/products\/([^/]+)$/);
  if (pseg && pseg[1] !== 'new') {
    if (SNAPSHOT_ROUTES.has('/' + pseg[1])) return SNAPSHOT_ROUTES.get('/' + pseg[1]);
    if (SNAPSHOT_ROUTES.has('/products/new')) return SNAPSHOT_ROUTES.get('/products/new');
  }
  // Longest-prefix fallback: deep/detail/sub-type URLs (e.g.
  // /discounts/new/amount-off-product, /products/123) render the nearest
  // captured page instead of dropping to a placeholder.
  let best = null;
  for (const [p, f] of SNAPSHOT_ROUTES) {
    if (p && sub.startsWith(p + '/') && (!best || p.length > best[0].length)) best = [p, f];
  }
  return best ? best[1] : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function verifierStateSnapshot(value) {
  return redactLargeStateValues(value);
}

function redactLargeStateValues(value) {
  if (typeof value === 'string') {
    if (value.length > 4096) {
      const prefix = value.startsWith('data:') ? 'data-url' : 'large-string';
      return `[${prefix} redacted ${value.length} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redactLargeStateValues);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactLargeStateValues(item);
    return out;
  }
  return value;
}

function now() {
  return new Date().toISOString();
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || fallback || `item-${Date.now()}`;
}

function numericId(prefix) {
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}${Date.now()}${random}`;
}

function gid(type, id) {
  return `gid://shopify/${type}/${id}`;
}

function initialThemeState() {
  return {
    themeId: '159103910101',
    themeName: 'Origin',
    storeName: '我的商店',
    template: '主页',
    previewPath: '/',
    previewMode: 'desktop',
    context: 'sections',
    marketContext: 'default',
    marketContexts: [
      { id: 'default', label: '商店默认值', group: 'primary', urlParam: '', icon: '⌂' },
      { id: 'us', label: '美国', group: 'custom', urlParam: 'us', icon: '◎' }
    ],
    currency: 'USD',
    themeAnalyticsRange: '30 天',
    themeImports: [],
    themes: [
      {
        id: '159103910101',
        name: 'Origin',
        role: 'current',
        version: '15.4.1',
        updatedText: '添加时间：5月18日 0:40',
        hero: 'Handcrafted products',
        screenshot: 'origin'
      },
      {
        id: '159066751189',
        name: 'Horizon',
        role: 'draft',
        version: '3.5.1',
        updatedText: '上次保存时间：昨天 13:32',
        hero: '2026 Mock Launch Collection',
        screenshot: 'horizon'
      },
      {
        id: '159067046101',
        name: 'Horizon',
        role: 'draft',
        version: '3.5.1',
        updatedText: '添加时间：5月16日 6:14',
        hero: 'Horizon draft',
        screenshot: 'horizon-alt'
      },
      {
        id: '159091949781',
        name: 'Horizon',
        role: 'draft',
        version: '3.5.1',
        updatedText: '添加时间：5月17日 11:20',
        hero: 'Horizon draft',
        screenshot: 'horizon-alt'
      },
      {
        id: '159103811797',
        name: 'Atelier',
        role: 'draft',
        version: '3.5.1',
        updatedText: '添加时间：5月18日 0:36',
        hero: 'Atelier storefront',
        screenshot: 'atelier'
      }
    ],
    themeSettings: {
      colorSchemes: [
        { id: 'scheme-1', label: '方案 1', background: '#f1f2eb', text: '#1b1b1b', accent: '#b49a83' },
        { id: 'scheme-2', label: '方案 2', background: '#111111', text: '#ffffff', accent: '#d8b998' },
        { id: 'scheme-3', label: '方案 3', background: '#ffffff', text: '#303030', accent: '#005bd3' },
        { id: 'scheme-4', label: '方案 4', background: '#f7f7f7', text: '#222222', accent: '#008060' },
        { id: 'scheme-5', label: '方案 5', background: '#fff4e5', text: '#2b2118', accent: '#c65f18' },
        { id: 'scheme-6', label: '方案 6', background: '#eef5ff', text: '#10243f', accent: '#005bd3' },
        { id: 'scheme-7', label: '方案 7', background: '#f8f0f6', text: '#27151f', accent: '#8a4567' }
      ],
      selectedScheme: 'scheme-1',
      logoText: '我的商店',
      faviconLabel: 'MS',
      typography: { body: 'Helvetica', headings: 'Helvetica', headingScale: 100 },
      pageLayout: { width: 1200, sectionSpacing: 40 },
      animations: { revealOnScroll: true, hoverLift: true },
      badges: { sale: true, soldOut: true },
      buttons: { style: 'solid', radius: 6 },
      cart: { type: '抽屉', showNote: true },
      drawerSidebar: { position: 'right', overlay: true },
      icons: { style: 'outline' },
      inputFields: { style: 'outline', radius: 8 },
      popovers: { animation: 'fade', shadow: true },
      price: { showCurrencyCode: true },
      productCard: { style: 'card', imageRatio: 'square', showVendor: false },
      collectionCard: { style: 'card', imageRatio: 'square', showProductCount: true },
      blogCard: { style: 'card', showDate: true, showAuthor: true },
      contentContainers: { style: 'outlined', radius: 8 },
      media: { style: 'rounded', radius: 8 },
      brandInformation: { slogan: 'Handcrafted products', shortDescription: 'A mock storefront for realistic Shopify workflows.' },
      socialMedia: { instagram: '', tiktok: '', youtube: '' },
      search: { predictive: true, showProducts: true },
      swatches: { shape: 'round' },
      variantPicker: { style: 'buttons' },
      customCss: '',
      themeStyle: 'default'
    },
    appEmbeds: {
      search: '',
      recommendations: [
        { id: 'shopify-forms', name: 'Shopify Forms', rating: '4.4', price: '免费', installed: false, enabled: false, placement: '弹出式注册表单' },
        { id: 'shopify-inbox', name: 'Shopify Inbox', rating: '4.7', price: '免费', installed: false, enabled: false, placement: '聊天气泡' }
      ]
    },
    themeAppBlocks: [
      { id: 'shop-button', name: 'Sign in with Shop Button', provider: 'Shop', installed: true, enabled: true, placement: 'Shop' }
    ],
    themeFiles: [
      {
        path: 'layout/theme.liquid',
        type: 'layout',
        updatedText: '5月18日',
        content: '<!doctype html>\n<html lang="{{ request.locale.iso_code }}">\n  <head>{{ content_for_header }}</head>\n  <body>\n    {% sections "header-group" %}\n    <main id="MainContent">{{ content_for_layout }}</main>\n    {% sections "footer-group" %}\n  </body>\n</html>'
      },
      {
        path: 'templates/index.json',
        type: 'template',
        updatedText: '5月18日',
        content: '{\n  "sections": {\n    "rich-heading": {"type": "rich-text"},\n    "featured-product": {"type": "featured-product-information"}\n  },\n  "order": ["rich-heading", "featured-product"]\n}'
      },
      {
        path: 'sections/main-collection-product-grid.liquid',
        type: 'section',
        updatedText: '5月18日',
        content: '<section class="collection-grid">\n  {% for product in collection.products %}\n    {{ product.title }} - {{ product.price | money }}\n  {% else %}\n    {{ "collections.general.no_matches" | t }}\n  {% endfor %}\n</section>'
      },
      {
        path: 'assets/base.css',
        type: 'asset',
        updatedText: '5月18日',
        content: ':root { --color-background: #f1f2eb; --color-foreground: #1b1b1b; }\n.product-card { border-radius: 8px; }'
      }
    ],
    themeDefaultContent: [
      { id: 'general.search.search', group: 'General', key: 'general.search.search', defaultValue: 'Search', value: '搜索' },
      { id: 'general.accessibility.skip_to_content', group: 'General', key: 'general.accessibility.skip_to_content', defaultValue: 'Skip to content', value: '跳到内容' },
      { id: 'products.product.sold_out', group: 'Products', key: 'products.product.sold_out', defaultValue: 'Sold out', value: '售罄' },
      { id: 'products.product.add_to_cart', group: 'Products', key: 'products.product.add_to_cart', defaultValue: 'Add to cart', value: '添加到购物车' },
      { id: 'collections.general.no_matches', group: 'Collections', key: 'collections.general.no_matches', defaultValue: 'No products found', value: '此产品系列目前没有产品。' },
      { id: 'cart.general.title', group: 'Cart', key: 'cart.general.title', defaultValue: 'Your cart', value: '您的购物车' },
      { id: 'newsletter.label', group: 'Forms', key: 'newsletter.label', defaultValue: 'Email', value: '电子邮件' }
    ],
    themeDownloads: [],
    themePublications: [],
    products: [
      { id: 'product-red', title: 'Ceramic Pour-Over Mug', price: '$24.00 USD', image: '/assets/prod-mug.svg', vendor: 'Atelier Goods', searchable: true, sku: 'MUG-001', reviewCount: 128, options: [{ name: '颜色', values: ['赤陶', '象牙白', '炭黑'] }] },
      { id: 'product-teal', title: 'Canvas Everyday Tote', price: '$38.00 USD', image: '/assets/prod-tote.svg', vendor: 'Atelier Goods', searchable: true, sku: 'TOTE-014', reviewCount: 86, options: [{ name: '颜色', values: ['原色', '藏青', '橄榄'] }] },
      { id: 'product-charcoal', title: 'Insulated Steel Bottle', price: '$32.00 USD', image: '/assets/prod-bottle.svg', vendor: 'Northbound', searchable: true, sku: 'BTL-500', reviewCount: 204, options: [{ name: '尺寸', values: ['500ml', '750ml'] }, { name: '颜色', values: ['雾灰', '松绿'] }] },
      { id: 'product-coral', title: 'Merino Wool Crew Socks', price: '$18.00 USD', image: '/assets/prod-socks.svg', vendor: 'Northbound', searchable: true, sku: 'SOCK-22', reviewCount: 57, options: [{ name: '尺寸', values: ['S', 'M', 'L'] }] },
      { id: 'product-teal-2', title: 'Soy Wax Candle', price: '$28.00 USD', image: '/assets/prod-candle.svg', vendor: 'Atelier Goods', searchable: true, sku: 'CDL-08', reviewCount: 142, options: [{ name: '香型', values: ['雪松', '海盐', '无花果'] }] },
      { id: 'product-charcoal-2', title: 'Linen Throw Blanket', price: '$64.00 USD', image: '/assets/prod-blanket.svg', vendor: 'Atelier Goods', searchable: true, sku: 'BLK-60', reviewCount: 39, options: [{ name: '颜色', values: ['燕麦', '石灰', '黛蓝'] }] },
      { id: 'product-red-2', title: 'Leather Card Holder', price: '$45.00 USD', image: '/assets/prod-cardholder.svg', vendor: 'Maker & Co.', searchable: true, sku: 'CARD-03', reviewCount: 73, options: [{ name: '颜色', values: ['棕', '黑'] }] },
      { id: 'product-teal-3', title: 'Bamboo Cutting Board', price: '$52.00 USD', image: '/assets/prod-board.svg', vendor: 'Maker & Co.', searchable: true, sku: 'BRD-30', reviewCount: 95, options: [{ name: '尺寸', values: ['中', '大'] }] }
    ],
    cartItems: [],
    collections: [
      { id: 'frontpage', numericId: '1001', title: '主页', handle: 'frontpage', subtitle: '8 个产品', descriptionHtml: '', productIds: ['product-red', 'product-teal', 'product-charcoal', 'product-coral', 'product-teal-2', 'product-charcoal-2', 'product-red-2', 'product-teal-3'], updatedText: '5月18日' },
      { id: 'all', numericId: '1002', title: '所有产品', handle: 'all', subtitle: '8 个产品', descriptionHtml: '', productIds: ['product-red', 'product-teal', 'product-charcoal', 'product-coral', 'product-teal-2', 'product-charcoal-2', 'product-red-2', 'product-teal-3'], updatedText: '5月18日' },
      { id: 'launch', numericId: '1003', title: '2026 Mock Launch Collection', handle: 'launch', subtitle: '精选发布产品', descriptionHtml: '精选发布产品', productIds: ['product-red', 'product-teal', 'product-charcoal', 'product-coral'], updatedText: '5月18日' }
    ],
    metaobjectDefinitions: [
      {
        id: 'lookbook-entry',
        handle: 'lookbook-entry',
        name: 'Lookbook entry',
        label: 'Lookbook entry',
        description: '可发布到店面的图文故事元对象。',
        entries: [
          { handle: 'launch-story', title: '2026 Launch Story', image: '/assets/prod-candle.svg', fields: { title: '2026 Launch Story', subtitle: 'Behind the new collection', body: 'A structured metaobject entry rendered through a theme template.', collection: '2026 Mock Launch Collection' } },
          { handle: 'materials-note', title: 'Materials Note', image: '/assets/prod-blanket.svg', fields: { title: 'Materials Note', subtitle: 'How the products are made', body: 'Reusable content can be surfaced without editing a page manually.', collection: '所有产品' } }
        ]
      },
      {
        id: 'faq-entry',
        handle: 'faq-entry',
        name: 'FAQ entry',
        label: 'FAQ entry',
        description: '常见问题元对象，可用于自定义内容模板。',
        entries: [
          { handle: 'shipping-window', title: 'Shipping window', image: '/assets/prod-board.svg', fields: { question: 'When will my order ship?', answer: 'Most mock orders ship within two business days.', topic: 'Shipping' } }
        ]
      }
    ],
    mediaLibrary: [
      { id: 'media-mug', name: 'ceramic-pour-over-mug.svg', kind: 'image', src: '/assets/prod-mug.svg', alt: '陶瓷手冲杯', uploadedText: '5月18日' },
      { id: 'media-tote', name: 'canvas-everyday-tote.svg', kind: 'image', src: '/assets/prod-tote.svg', alt: '帆布托特包', uploadedText: '5月18日' },
      { id: 'media-bottle', name: 'insulated-steel-bottle.svg', kind: 'image', src: '/assets/prod-bottle.svg', alt: '不锈钢保温瓶', uploadedText: '5月18日' },
      { id: 'media-socks', name: 'merino-wool-socks.svg', kind: 'image', src: '/assets/prod-socks.svg', alt: '美利奴羊毛袜', uploadedText: '5月18日' },
      { id: 'media-candle', name: 'soy-wax-candle.svg', kind: 'image', src: '/assets/prod-candle.svg', alt: '大豆蜡香薰', uploadedText: '5月18日' },
      { id: 'media-blanket', name: 'linen-throw-blanket.svg', kind: 'image', src: '/assets/prod-blanket.svg', alt: '亚麻毛毯', uploadedText: '5月18日' },
      { id: 'media-cardholder', name: 'leather-card-holder.svg', kind: 'image', src: '/assets/prod-cardholder.svg', alt: '皮革卡包', uploadedText: '5月18日' },
      { id: 'media-board', name: 'bamboo-cutting-board.svg', kind: 'image', src: '/assets/prod-board.svg', alt: '竹制砧板', uploadedText: '5月18日' }
    ],
    sections: [
      {
        id: 'announcement',
        type: 'announcement-bar',
        group: 'header',
        label: '公告栏',
        hidden: false,
        locked: false,
        settings: { text: 'Welcome to our store' },
        blocks: [{ id: 'announcement-text', type: 'announcement', label: '公告 - Welcome to our store' }]
      },
      {
        id: 'header',
        type: 'header',
        group: 'header',
        label: '标头',
        hidden: false,
        locked: false,
        settings: { logoText: '我的商店', menu: ['主页', '产品目录', '联系我们'] },
        blocks: []
      },
      {
        id: 'rich-heading',
        type: 'rich-text',
        group: 'template',
        label: '富文本',
        hidden: false,
        locked: false,
        settings: { heading: 'Handcrafted products', text: '', alignment: 'center', size: 'large' },
        blocks: [
          { id: 'rich-heading-title', type: 'heading', label: '标题 - Handcrafted products', settings: { text: 'Handcrafted products' } }
        ]
      },
      {
        id: 'featured-product',
        type: 'featured-product-information',
        group: 'template',
        label: '特色产品',
        hidden: false,
        locked: false,
        settings: {
          productId: 'product-red',
          heading: '特色产品',
          width: 'page',
          mediaPosition: 'left',
          equalColumns: true,
          limitDetailsWidth: false,
          gap: 48,
          colorScheme: 'scheme-1',
          description: 'Enter a description of your featured product. Make sure to mention what makes it special, and what sets it apart from the competition.',
          paddingTop: 40,
          paddingBottom: 40
        },
        // Real Shopify Origin theme home featured-product default blocks (live capture 2026-06-02):
        // 标题 / 价格 / 文本 / 多属性选择器 / Buy Button / 分享. Previously had 7 (extra vendor +
        // quantity_selector). The client-side seed in app.js featuredProductDefaultBlocks() mirrors
        // this list; keep them in sync.
        blocks: [
          { id: 'featured-product-title', type: 'product-title', label: '标题', settings: { headingSize: 'h2' } },
          { id: 'featured-product-price', type: 'product-price', label: '价格', settings: {} },
          { id: 'featured-product-text', type: 'text', label: '文本', settings: { text: 'Enter a description of your featured product. Make sure to mention what makes it special, and what sets it apart from the competition.' } },
          { id: 'featured-product-variant', type: 'variant-picker', label: '多属性选择器', settings: { pickerType: 'button', swatchShape: 'circle' } },
          { id: 'featured-product-buy', type: 'buy-buttons', label: 'Buy Button', settings: { showDynamicCheckout: true, showGiftCardRecipient: false } },
          { id: 'featured-product-share', type: 'share', label: '分享', settings: { shareLabel: '分享' } }
        ]
      },
      {
        id: 'image-banner',
        type: 'image-banner',
        group: 'template',
        label: '图片横幅',
        hidden: false,
        locked: false,
        settings: {
          heading: 'New essentials are here',
          text: 'Explore the latest products selected for the season.',
          buttonText: 'Shop all',
          buttonLink: '/collections/all',
          image: '/assets/product-teal.svg',
          layout: 'overlay',
          width: 'full',
          mediaPosition: 'left',
          contentPosition: 'center',
          textAlignment: 'left',
          imageHeight: 360,
          overlayOpacity: 32,
          colorScheme: 'scheme-1',
          paddingTop: 40,
          paddingBottom: 40,
          customCss: ''
        },
        blocks: [
          { id: 'image-banner-heading', type: 'heading', label: '标题 - New essentials are here', settings: { text: 'New essentials are here' } },
          { id: 'image-banner-text', type: 'text', label: '文本 - Explore the latest products selected for the season.', settings: { text: 'Explore the latest products selected for the season.' } },
          { id: 'image-banner-button', type: 'button', label: '按钮 - Shop all', settings: { text: 'Shop all', url: '/collections/all' } }
        ]
      },
      {
        id: 'reviews-rich-text',
        type: 'rich-text',
        group: 'template',
        label: '富文本',
        hidden: false,
        locked: false,
        settings: { eyebrow: 'THE REVIEWS', heading: 'Testimonials', text: '', alignment: 'center', size: 'medium' },
        blocks: [
          { id: 'reviews-title', type: 'heading', label: '标题 - Testimonials', settings: { text: 'Testimonials' } }
        ]
      },
      {
        id: 'multicolumn',
        type: 'multicolumn',
        group: 'template',
        label: '多列',
        hidden: false,
        locked: false,
        settings: {
          columns: [
            { heading: 'So soft', text: '“I really love how soft the leather is. It feels and smells like quality.” - John S.' },
            { heading: 'Wicked smart', text: "\"The bag is great. The way it adapts is so clever. I can't live without it.” - Jane K." },
            { heading: 'Elegant', text: '“Premium quality, as always. I adore the elegant yet simplistic design.” - Anne L.' }
          ]
        },
        blocks: [
          { id: 'multicolumn-1', type: 'column', label: '列 - So soft' },
          { id: 'multicolumn-2', type: 'column', label: '列 - Wicked smart' },
          { id: 'multicolumn-3', type: 'column', label: '列 - Elegant' }
        ]
      },
      {
        id: 'email-signup',
        type: 'email-signup',
        group: 'template',
        label: '电子邮件注册信息',
        hidden: false,
        locked: false,
        settings: {
          heading: 'Subscribe to our email list',
          text: ''
        },
        blocks: [
          { id: 'email-heading', type: 'heading', label: '标题 - Subscribe to our email list' },
          { id: 'email-form', type: 'email-signup', label: '电子邮件注册' }
        ]
      },
      {
        id: 'footer',
        type: 'footer',
        group: 'footer',
        label: '页脚',
        hidden: false,
        locked: false,
        settings: { copyright: '付款方式 © 2026, 我的商店 Powerd by Shopify', policies: ['隐私政策'] },
        blocks: []
      }
    ],
    collectionTemplate: {
      collectionId: 'frontpage',
      collectionTitle: '主页',
      collectionSubtitle: '应用到 1 个产品系列',
      sectionsSeeded: true,
      sections: [
        {
          id: 'collection-banner',
          type: 'collection-banner',
          group: 'template',
          label: '产品系列横幅',
          hidden: false,
          locked: false,
          settings: {
            heading: '',
            description: '',
            showDescription: true,
            collection: '主页'
          },
          blocks: []
        },
        {
          id: 'collection-product-grid',
          type: 'collection-product-grid',
          group: 'template',
          label: '产品网格',
          hidden: false,
          locked: false,
          settings: {
            sort: '精选',
            view: 'grid',
            columns: 4,
            productsPerPage: 8,
            showProductCount: true,
            filtersEnabled: true
          },
          blocks: []
        }
      ]
    },
    themeTemplates: {
      product: {
        label: '默认产品',
        previewPath: '/products/product-red',
        resourceId: 'product-red',
        resourceTitle: 'Ceramic Pour-Over Mug',
        sectionsSeeded: true,
        sections: [
          {
            id: 'product-main',
            type: 'product-main',
            group: 'template',
            label: '产品信息',
            hidden: false,
            locked: false,
            settings: { productId: 'product-red', mediaPosition: 'left', showVendor: true, showQuantitySelector: true, showShare: true, showDescription: true },
            blocks: []
          }
        ]
      },
      page: {
        label: '默认页面',
        previewPath: '/pages/contact-us',
        resourceId: 'contact-us',
        resourceTitle: '联系我们',
        sectionsSeeded: true,
        sections: [
          {
            id: 'page-main',
            type: 'page-main',
            group: 'template',
            label: '页面',
            hidden: false,
            locked: false,
            settings: { pageId: 'contact-us', heading: '', showTitle: true, showContent: true, width: 'page' },
            blocks: []
          }
        ]
      },
      blog: {
        label: '默认博客',
        previewPath: '/blogs/news',
        blogId: 'news',
        blogTitle: 'News',
        sectionsSeeded: true,
        sections: [
          {
            id: 'blog-main',
            type: 'blog-main',
            group: 'template',
            label: '博客文章',
            hidden: false,
            locked: false,
            settings: { heading: 'News', blogId: 'news', postsToShow: 6, layout: 'grid', showExcerpt: true, showDate: true },
            blocks: []
          }
        ]
      },
      article: {
        label: '默认博客文章',
        previewPath: '/blogs/news/template-preview',
        blogId: 'news',
        resourceId: '',
        resourceTitle: '',
        sectionsSeeded: true,
        sections: [
          {
            id: 'article-main',
            type: 'article-main',
            group: 'template',
            label: '博客文章',
            hidden: false,
            locked: false,
            settings: { articleId: '', heading: '', showAuthor: true, showDate: true, showExcerpt: true, showTags: true },
            blocks: []
          }
        ]
      },
      search: {
        label: '搜索',
        previewPath: '/search',
        sectionsSeeded: true,
        sections: [
          {
            id: 'search-main',
            type: 'search-main',
            group: 'template',
            label: '搜索结果',
            hidden: false,
            locked: false,
            settings: { heading: '搜索结果', query: '产品', productsToShow: 4, showSearchIcon: true, showProductCount: true },
            blocks: []
          }
        ]
      },
      cart: {
        label: '购物车',
        previewPath: '/cart',
        sectionsSeeded: true,
        sections: [
          {
            id: 'cart-main',
            type: 'cart-main',
            group: 'template',
            label: '购物车',
            hidden: false,
            locked: false,
            settings: { heading: '您的购物车', emptyText: '您的购物车目前为空', showVendor: true, showQuantity: true, showNote: true, showSubtotal: true, checkoutButtonText: '结账' },
            blocks: []
          }
        ]
      },
      giftCard: {
        label: '礼品卡',
        previewPath: '/gift_cards/mock-gift-card',
        sectionsSeeded: true,
        sections: [
          {
            id: 'gift-card-main',
            type: 'gift-card-main',
            group: 'template',
            label: '礼品卡',
            hidden: false,
            locked: false,
            settings: { heading: '您的礼品卡', subheading: '礼品卡可用于我的商店的任意商品。', balance: '$100.00 USD', code: 'MOCK-GIFT-2026', expiryText: '永不过期', showQr: true, showExpiration: true, buttonText: '访问在线商店' },
            blocks: []
          }
        ]
      },
      checkoutAccount: {
        label: '结账和客户账户',
        previewPath: '/checkout',
        sectionsSeeded: true,
        sections: [
          {
            id: 'checkout-main',
            type: 'checkout-main',
            group: 'template',
            label: '结账和客户账户',
            hidden: false,
            locked: false,
            settings: { heading: '结账', contactLabel: '联系方式', shippingLabel: '配送地址', buttonText: '继续付款', notice: '此结账页复用购物车中的商品和主题结账设置。', showOrderSummary: true, showCustomerAccount: true },
            blocks: []
          }
        ]
      },
      collectionList: {
        label: '产品系列列表',
        previewPath: '/collections',
        sectionsSeeded: true,
        sections: [
          {
            id: 'collection-list-main',
            type: 'collection-list',
            group: 'template',
            label: '产品系列列表',
            hidden: false,
            locked: false,
            settings: { heading: '产品系列列表', variant: 'grid' },
            blocks: [
              { id: 'collection-list-main-col-1', type: 'featured-collection', label: '产品系列 - 主页', settings: { collectionId: 'frontpage', collectionTitle: '主页' } },
              { id: 'collection-list-main-col-2', type: 'featured-collection', label: '产品系列 - 所有产品', settings: { collectionId: 'all', collectionTitle: '所有产品' } },
              { id: 'collection-list-main-col-3', type: 'featured-collection', label: '产品系列 - 2026 Mock Launch Collection', settings: { collectionId: 'launch', collectionTitle: '2026 Mock Launch Collection' } }
            ]
          }
        ]
      },
      password: {
        label: '密码',
        previewPath: '/password',
        sectionsSeeded: true,
        sections: [
          {
            id: 'password-main',
            type: 'password-main',
            group: 'template',
            label: '密码页',
            hidden: false,
            locked: false,
            settings: { heading: 'Opening soon', text: 'Be the first to know when we launch.', buttonText: 'Enter using password', showNewsletter: true },
            blocks: []
          }
        ]
      },
      notFound: {
        label: '404 页面',
        previewPath: '/404',
        sectionsSeeded: true,
        sections: [
          {
            id: 'not-found-main',
            type: 'not-found-main',
            group: 'template',
            label: '404 页面',
            hidden: false,
            locked: false,
            settings: { heading: '404', text: '找不到该页面。', buttonText: '继续购物', buttonLink: '/collections/all' },
            blocks: []
          }
        ]
      }
    },
    liveStore: {
      mode: 'published',
      heading: 'Browse our latest products',
      buttonText: 'Shop all',
      note: '裸前台 URL 使用独立 live state；主题编辑器保存后不会自动覆盖这里，除非通过 mock 的 publish/preview 链路。'
    },
    pages: [
      {
        id: 'privacy-choices',
        title: '您的隐私选项',
        handle: 'privacy-choices',
        visible: true,
        body: '正如我们的隐私政策中所述，我们通过您与我们和我们网站的互动收集个人信息，包括使用 Cookie 和类似技术。',
        seoTitle: '您的隐私选项',
        seoDescription: '',
        updatedText: '5月18日'
      },
      {
        id: 'contact-us',
        title: '联系我们',
        handle: 'contact-us',
        visible: true,
        body: '',
        seoTitle: '联系我们',
        seoDescription: '',
        updatedText: '5月18日'
      }
    ],
    preferences: {
      passwordProtected: false,
      b2bOnly: false,
      homepageTitle: '',
      metaDescription: '',
      socialImage: '',
      socialImageName: '',
      countryRedirect: true,
      languageRedirect: false,
      contactCaptcha: true,
      accountCaptcha: true,
      crawlerSignatures: []
    },
    policies: [
      {
        id: 'refund-policy',
        type: 'REFUND_POLICY',
        title: '退货和退款政策',
        handle: 'refund-policy',
        body: '',
        status: '未设置政策',
        showInFooter: false,
        updatedText: '未设置'
      },
      {
        id: 'privacy-policy',
        type: 'PRIVACY_POLICY',
        title: '隐私政策',
        handle: 'privacy-policy',
        body: '<p>我们会按照适用法律说明收集、使用和保护客户个人信息的方式。</p>',
        status: '已启用自动',
        showInFooter: true,
        updatedText: '5月28日'
      },
      {
        id: 'terms-of-service',
        type: 'TERMS_OF_SERVICE',
        title: '服务条款',
        handle: 'terms-of-service',
        body: '',
        status: '未设置政策',
        showInFooter: false,
        updatedText: '未设置'
      },
      {
        id: 'shipping-policy',
        type: 'SHIPPING_POLICY',
        title: '物流政策',
        handle: 'shipping-policy',
        body: '',
        status: '未设置政策',
        showInFooter: false,
        updatedText: '未设置'
      },
      {
        id: 'contact-information',
        type: 'CONTACT_INFORMATION',
        title: '联系信息',
        handle: 'contact-information',
        body: '',
        status: '警告必需',
        showInFooter: false,
        updatedText: '未设置'
      },
      {
        id: 'legal-notice',
        type: 'LEGAL_NOTICE',
        title: '法律声明',
        handle: 'legal-notice',
        body: '',
        status: '未设置政策',
        showInFooter: false,
        updatedText: '未设置'
      }
    ],
    returnRules: {
      enabled: false,
      windowDays: 30,
      returnShipping: 'customer',
      restockingFee: 'none',
      finalSaleTags: ['Final sale'],
      updatedText: '未设置'
    },
    domains: [
      {
        id: 'myshopify',
        host: 'i415x6-zf.myshopify.com',
        kind: 'myshopify',
        primary: true,
        status: '已连接',
        role: '预览域名',
        updatedText: '5月28日'
      }
    ],
    menus: [
      {
        id: 'footer-menu',
        title: '页脚菜单',
        handle: 'footer-menu',
        items: [
          { id: 'search', label: '搜索', link: '/search' },
          { id: 'privacy-choices', label: '您的隐私选项', link: '/pages/privacy-choices' }
        ]
      },
      {
        id: 'customer-account-main-menu',
        title: '客户账户主菜单',
        handle: 'customer-account-main-menu',
        items: [
          { id: 'orders', label: '订单', link: '/account/orders' },
          { id: 'profile', label: '个人资料', link: '/account/profile' }
        ]
      },
      {
        id: 'main-menu',
        title: '主菜单',
        handle: 'main-menu',
        items: [
          { id: 'home', label: '主页', link: '/' },
          { id: 'catalog', label: '产品目录', link: '/collections/all' },
          { id: 'contact', label: '联系我们', link: '/pages/contact-us' }
        ]
      }
    ],
    redirects: [],
    redirectImports: [],
    blogs: [
      {
        id: 'news',
        title: 'News',
        handle: 'news',
        commentPolicy: 'moderated',
        feedEnabled: true,
        seoTitle: 'News',
        seoDescription: '',
        updatedText: '5月28日'
      }
    ],
    blogArticles: [],
    storefrontSubmissions: [],
    newsletterSubscribers: []
  };
}

let saved = initialThemeState();
admin.seedAll(saved);
let draft = clone(saved);
let events = [];

// Out-of-band media storage. The editor used to inline uploaded images as base64 dataURLs
// in section/block settings, which exploded the /api/draft body (a single 600KB image →
// ~800KB base64; with nested template references the full state easily reaches 8+ MB and
// hit the readBody cap). Now the client POSTs each upload to /api/media which stores the
// bytes here in-memory and returns a /media/<id> URL; settings store the URL only, so
// state JSON stays in the tens-of-KB range. Map: id → {bytes:Buffer, contentType, filename}.
const mediaBlobs = new Map();
function resetMediaBlobs() { mediaBlobs.clear(); }

function isDirty() {
  return JSON.stringify(themeContentForDirty(saved)) !== JSON.stringify(themeContentForDirty(draft));
}

function themeContentForDirty(value) {
  const comparable = clone(value || {});
  for (const key of ['template', 'previewPath', 'previewMode', 'context', 'marketContext', 'adminSearchRecent', 'adminSearchLastQuery']) {
    delete comparable[key];
  }
  return comparable;
}

function pushEvent(type, details = {}) {
  const entry = { ts: now(), type, ...details };
  events.push(entry);
  if (events.length > 500) events.shift();
  return entry;
}

function commitAdminMutation(type, details) {
  draft = clone(saved);
  pushEvent(type, { dirty: false, ...details });
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function appendSharedStateList(key, item) {
  saved[key] = saved[key] || [];
  draft[key] = draft[key] || [];
  saved[key].push(item);
  draft[key].push(clone(item));
}

function productById(id) {
  return (saved.products || []).find((product) => product.id === id);
}

function productVariantId(product) {
  const index = (saved.products || []).findIndex((candidate) => candidate.id === product?.id);
  return 70000000000000 + Math.max(0, index);
}

function productByCartId(id) {
  const value = String(id || '').trim();
  return (saved.products || []).find((product) => product.id === value || String(productVariantId(product)) === value);
}

function normalizeCartQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(99, Math.floor(numeric)));
}

function normalizeCartLineQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(99, Math.floor(numeric)));
}

function upsertSharedCartItem(productId, quantity) {
  const qty = normalizeCartQuantity(quantity);
  saved.cartItems = saved.cartItems || [];
  draft.cartItems = draft.cartItems || [];
  const savedLine = saved.cartItems.find((line) => line.productId === productId);
  if (savedLine) savedLine.quantity = normalizeCartQuantity(normalizeCartQuantity(savedLine.quantity) + qty);
  else saved.cartItems.push({ id: `cart-${productId}`, productId, quantity: qty });
  const draftLine = draft.cartItems.find((line) => line.productId === productId);
  if (draftLine) draftLine.quantity = normalizeCartQuantity(normalizeCartQuantity(draftLine.quantity) + qty);
  else draft.cartItems.push({ id: `cart-${productId}`, productId, quantity: qty });
  return saved.cartItems.find((line) => line.productId === productId);
}

function setSharedCartItemQuantity(productId, quantity) {
  const qty = normalizeCartLineQuantity(quantity);
  saved.cartItems = saved.cartItems || [];
  draft.cartItems = draft.cartItems || [];
  if (qty <= 0) {
    saved.cartItems = saved.cartItems.filter((line) => line.productId !== productId);
    draft.cartItems = draft.cartItems.filter((line) => line.productId !== productId);
    return null;
  }
  const savedLine = saved.cartItems.find((line) => line.productId === productId);
  if (savedLine) savedLine.quantity = qty;
  else saved.cartItems.push({ id: `cart-${productId}`, productId, quantity: qty });
  const draftLine = draft.cartItems.find((line) => line.productId === productId);
  if (draftLine) draftLine.quantity = qty;
  else draft.cartItems.push({ id: `cart-${productId}`, productId, quantity: qty });
  return saved.cartItems.find((line) => line.productId === productId);
}

function clearSharedCartItems() {
  saved.cartItems = [];
  draft.cartItems = [];
}

function cartLineByReference(reference) {
  const value = String(reference || '').trim();
  if (!value) return null;
  return (saved.cartItems || []).find((line) => {
    const product = productById(line.productId);
    return line.id === value || line.productId === value || `${line.productId}:mock` === value || (product && String(productVariantId(product)) === value);
  });
}

function moneyCents(price) {
  const match = String(price || '').replace(/,/g, '').match(/[\d.]+/);
  return Math.round((match ? Number(match[0]) : 0) * 100);
}

function cartLinePayload(line) {
  const product = productById(line.productId);
  if (!product) return null;
  const quantity = normalizeCartQuantity(line.quantity);
  const cents = moneyCents(product.price);
  const variantId = productVariantId(product);
  return {
    id: variantId,
    key: `${product.id}:mock`,
    product_id: variantId,
    variant_id: variantId,
    title: product.title,
    product_title: product.title,
    variant_title: null,
    vendor: product.vendor || 'Mock Store',
    quantity,
    price: cents,
    final_price: cents,
    line_price: cents * quantity,
    final_line_price: cents * quantity,
    sku: product.sku || '',
    grams: 0,
    handle: product.id,
    url: `/products/${product.id}`,
    image: product.image,
    featured_image: {
      url: product.image,
      alt: product.title,
      aspect_ratio: 1
    },
    requires_shipping: true,
    gift_card: false,
    properties: {},
    variant_options: ['Default Title'],
    options_with_values: [{ name: 'Title', value: 'Default Title' }]
  };
}

function cartPayload() {
  const items = (saved.cartItems || []).map(cartLinePayload).filter(Boolean);
  const total = items.reduce((sum, item) => sum + item.final_line_price, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  return {
    token: 'mock-cart-token',
    note: null,
    attributes: {},
    original_total_price: total,
    total_price: total,
    total_discount: 0,
    total_weight: 0,
    item_count: itemCount,
    items,
    requires_shipping: items.length > 0,
    currency: saved.currency || 'USD',
    items_subtotal_price: total,
    cart_level_discount_applications: []
  };
}

function cartAjaxAction(pathname) {
  const match = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?cart(?:\/(add|change|update|clear))?\.js$/.exec(pathname);
  return match ? (match[1] || 'get') : '';
}

function cartError(res, description, status = 422) {
  return sendJson(res, status, { status, message: 'Cart Error', description });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function toolModeEnabled() {
  return SHOPIFY_MOCK_MODE === 'tool' || SHOPIFY_MOCK_MODE === 'mcp' || SHOPIFY_MOCK_MODE === 'cli';
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

function isVerifierRequest(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return Boolean(auth && token === adminStore.verifierToken);
}

function hasUiToken(req) {
  return String(req.headers['x-ui-token'] || '') === UI_TOKEN;
}

function denyInternalApi(res, error, message) {
  return sendJson(res, 403, { ok: false, error, message });
}

function requireBrowserStateAccess(req, res) {
  if (toolModeEnabled() || isVerifierRequest(req)) return true;
  if (!hasValidBrowserNonce(req)) {
    pushEvent('browser_session_required', { method: req.method, path: req.url });
    denyInternalApi(res, 'browser_session_required', 'Open the Shopify mock page in a browser first.');
    return false;
  }
  return true;
}

function requireUiWrite(req, res) {
  if (toolModeEnabled() || isVerifierRequest(req)) return true;
  if (!hasValidBrowserNonce(req)) {
    pushEvent('browser_session_required', { method: req.method, path: req.url });
    denyInternalApi(res, 'browser_session_required', 'Open the Shopify mock page in a browser first.');
    return false;
  }
  if (!hasUiToken(req)) {
    pushEvent('ui_token_required', { method: req.method, path: req.url });
    denyInternalApi(res, 'ui_token_required', 'Use the Shopify browser UI for this endpoint.');
    return false;
  }
  return true;
}

function denyNonBrowser(req, res, reason) {
  pushEvent('browser_required', { reason, method: req.method, path: req.url });
  res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Access denied: open the Shopify mock in a browser for UI-mode tasks.\n');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    const type = String(req.headers['content-type'] || '');
    req.on('data', (chunk) => {
      raw += chunk;
      // Raised from 5MB → 20MB 2026-06-02: the theme editor inlines uploaded images as
      // base64 dataURLs in section/block settings (e.g. collage tile images at ~600KB each
      // → ~800KB base64). With multiple uploads + nested template references the full
      // /api/draft body can exceed 8MB. Long-term fix: a separate /api/media endpoint that
      // stores blobs and returns URLs (so settings only hold the URL, not the data).
      if (raw.length > 20 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      if (type.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        if (raw.includes('=')) return resolve(Object.fromEntries(new URLSearchParams(raw)));
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
    '.svg': 'image/svg+xml; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  }[ext] || 'application/octet-stream';
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    res.writeHead(200, { 'content-type': contentType(filePath) });
    res.end(data);
  });
}

// --- L2 interaction injection ---------------------------------------------
// When serving a 1:1 snapshot we inject a small runtime + the matched per-domain
// adapter that wires the captured (script-stripped) DOM to the validated
// /api/admin/* backend, so UI ⇄ REST ⇄ GraphQL ⇄ MCP share `saved` state.
// Injection is ADDITIVE: if /_inject/* is missing the page still renders the
// pristine static snapshot. Files live under public/_inject/.
const INJECT_DIR = path.join(PUBLIC_DIR, '_inject');
// Which per-domain L2 adapter (if any) owns this admin route.
function injectDomainFor(pathname) {
  const m = pathname && pathname.match(/^\/store\/[^/]+(\/[^?]*)?$/);
  const sub = m ? (m[1] || '').replace(/\/$/, '') : '';
  if (/^\/products(\/|$)/.test(sub)) return 'products';
  // future waves: customers, discounts, draft_orders, purchase_orders, ...
  return null;
}
function injectTagsFor(pathname) {
  if (!fs.existsSync(path.join(INJECT_DIR, 'runtime.js'))) return '';
  const tags = ['<script src="/_inject/runtime.js" defer></script>'];
  const dom = injectDomainFor(pathname);
  if (dom && fs.existsSync(path.join(INJECT_DIR, `${dom}.js`))) {
    tags.push(`<script src="/_inject/${dom}.js" defer></script>`);
  }
  return tags.join('');
}
function injectIntoBody(html, pathname) {
  const tags = injectTagsFor(pathname);
  if (!tags) return html;
  // Inject before the LAST </body>: some snapshots (e.g. product/new) embed a
  // TinyMCE iframe whose srcdoc contains an earlier literal </body>; injecting at
  // the first one would put our scripts inside the inert iframe markup.
  const idx = html.toLowerCase().lastIndexOf('</body>');
  return idx === -1 ? html + tags : html.slice(0, idx) + tags + html.slice(idx);
}

// The /apps landing was captured mid-load (a stuck "开发应用" dialog + per-card
// activity spinners), so its installed-apps list never rendered and the dark
// _AppFrame chrome shows through the empty content area (the "black screen").
// The Apps module is intentionally out of scope this phase — rather than build
// it, we replace the broken #AppFrameMain content with this clean, static,
// non-interactive placeholder that just lists the installed apps. The captured
// 1:1 nav + top bar are left untouched. (Injected in sendSnapshot for apps.html.)
// The captured frame is collapsed/dark in this mid-load snapshot, and the nav is
// nested inside #AppFrameMain — so we can't reflow it. Instead: (1) repaint the
// dark _AppFrame chrome light and drop the full-screen dark backdrops, leaving
// the real 1:1 nav (240px) + top bar (56px) intact; (2) lay our placeholder as a
// fixed panel over the content region (top:56 left:240 → right/bottom), which is
// independent of the broken inner layout and opaquely covers any leftover spinner
// /modal layers underneath.
const APPS_PLACEHOLDER_CSS =
  // NOTE: `.Polaris-Frame__DarkOverlay` here is #AppFrameBevel — a STRUCTURAL
  // wrapper around the nav + main, NOT a scrim. Do NOT display:none it (that
  // blanks the whole frame). Just repaint the dark chrome light; the modal scrim
  // (.Polaris-Backdrop/.backdrop) and the stuck dialog are hidden so they don't
  // dim the nav, and the fixed placeholder below covers the content region.
  '.Polaris-Frame,[class*=_AppFrame_],#AppFrameBevel{background:#f1f1f1 !important;}'
  + '.Polaris-Backdrop,.backdrop,.modal.stacked-root,.modal.stacked{display:none !important;}'
  + '.ccb-apps-ph{position:fixed;top:56px;left:240px;right:0;bottom:0;z-index:9000;'
  + 'overflow:auto;background:#f1f1f1;padding:28px 16px 64px;'
  + "font-family:Inter,-apple-system,'Helvetica Neue',Arial,sans-serif;color:#303030;}"
  + '.ccb-apps-ph *{box-sizing:border-box;}'
  + '.ccb-apps-ph .ph-inner{max-width:998px;margin:0 auto;}'
  + '.ccb-apps-ph h1{font-size:20px;line-height:1.4;font-weight:650;margin:0 0 2px;}'
  + '.ccb-apps-ph .ph-sub{color:#616161;font-size:13px;margin:0 0 20px;}'
  + '.ccb-apps-ph .ph-card{background:#fff;border:1px solid #e3e3e3;border-radius:12px;'
  + 'box-shadow:0 1px 0 rgba(0,0,0,.04);overflow:hidden;}'
  + '.ccb-apps-ph .ph-card h2{font-size:14px;font-weight:650;margin:0;padding:14px 16px;border-bottom:1px solid #ebebeb;}'
  + '.ccb-apps-ph .ph-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f3f3f3;}'
  + '.ccb-apps-ph .ph-row:last-child{border-bottom:0;}'
  + '.ccb-apps-ph .ph-ico{width:38px;height:38px;border-radius:9px;display:flex;flex:0 0 auto;'
  + 'align-items:center;justify-content:center;font-weight:700;font-size:15px;}'
  + '.ccb-apps-ph .ph-name{font-weight:600;font-size:13px;line-height:1.3;}'
  + '.ccb-apps-ph .ph-meta{color:#8a8a8a;font-size:12px;line-height:1.3;}'
  + '.ccb-apps-ph .ph-note{color:#8a8a8a;font-size:12px;margin-top:14px;}';
const APPS_PLACEHOLDER_HTML =
  '<div class="ccb-apps-ph"><div class="ph-inner">'
  + '<h1>应用</h1>'
  + '<p class="ph-sub">管理已安装到此商店的应用。</p>'
  + '<div class="ph-card"><h2>已安装</h2>'
  + '<div class="ph-row"><div class="ph-ico" style="background:#eafaf0;color:#0c8a4b">S</div>'
  + '<div><div class="ph-name">SimGym</div><div class="ph-meta">销售渠道</div></div></div>'
  + '<div class="ph-row"><div class="ph-ico" style="background:#eaf2ff;color:#0a6cff">M</div>'
  + '<div><div class="ph-name">Messaging</div><div class="ph-meta">销售渠道</div></div></div>'
  + '<div class="ph-row"><div class="ph-ico" style="background:#f3edff;color:#6b3df5">C</div>'
  + '<div><div class="ph-name">Collective</div><div class="ph-meta">应用</div></div></div>'
  + '</div>'
  + '<p class="ph-note">此 mock 环境暂未实现应用安装与第三方应用，本页仅列出已安装应用。</p>'
  + '</div></div>';

// Serve a 1:1 admin snapshot. Settings pages need the route-lazy modal CSS chunk
// (`_Container_1kf47`/`_SettingsNavContainer`/`_ModalLayer` …) that Shopify
// code-splits per route and that isn't in the global polaris.css bundle — without
// it the settings modal collapses to a single-column flow. Inject the link.
// Then inject the L2 runtime + matched domain adapter before </body>.
function sendSnapshot(res, snapFile, pathname) {
  const filePath = path.join(PAGES_DIR, snapFile);
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    // Hide the Sidekick AI chat sidebar on EVERY snapshot. Several pages
    // (home/marketing/product_new/settings_legal/settings_domains) were captured
    // with it open, rendering a dark non-functional panel on the right. Collapse
    // it globally, hash-agnostically (the chat lives in _SidebarContainer_*).
    let headInject = '<style>'
      + '[class*=_ChatLayout_]{display:none !important;}'
      + '[class*=_SidebarContainer_]:has([class*=_ChatLayout_]){display:none !important;}'
      // the chat sidebar's fixed dark backdrop (pointer-events:none, so it isn't
      // hit-tested — it shows as a ~360px black strip down the right edge).
      + '.Polaris-Frame__SidebarBackground{display:none !important;}'
      // with the chat open, the main content reserved ~360px on the right
      // (padding-inline-end); zero it so the page fills the full width.
      + '.Polaris-Frame__Main{padding-inline-end:0 !important;}'
      + '[class*=_chatOpen_]{inset-inline-end:0 !important;}'
      + '</style>';
    if (/^settings/.test(snapFile)) {
      // settings.css = the route-lazy modal CSS chunk Shopify code-splits per
      // route and that isn't in the global polaris.css bundle — without it the
      // settings modal collapses to a single column. Plus the settings-nav
      // list-style reset (the captured chunk omits it → default disc bullets).
      headInject += '<link rel="stylesheet" href="/_polaris/settings.css">'
        + '<style>'
        + '[class*=_SettingsNavContainer] ul,[class*=_SettingsNavContainer] li{list-style:none !important;}'
        + '</style>';
    }
    if (snapFile === 'apps.html') {
      headInject += '<style>' + APPS_PLACEHOLDER_CSS + '</style>';
    }
    html = html.replace(/<\/head>/i, headInject + '</head>');
    html = injectIntoBody(html, pathname);
    if (snapFile === 'apps.html') {
      // Drop the clean placeholder in as the FIRST child of the content area; the
      // CSS above hides every other (broken, mid-load) child of #AppFrameMain.
      html = html.replace(/(<main[^>]*id="AppFrameMain"[^>]*>)/i, `$1${APPS_PLACEHOLDER_HTML}`);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

function sendRedirect(res, location) {
  res.writeHead(301, {
    location,
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8'
  });
  res.end(`Redirecting to ${location}`);
}

function matchingSavedRedirect(pathname) {
  return (saved.redirects || []).find((redirect) => (redirect.from || redirect.path) === pathname);
}

function storefrontRedirectLocation(target, sourceUrl) {
  const value = String(target || '/');
  if (!sourceUrl?.searchParams?.has('preview_theme_id') && !sourceUrl?.searchParams?.has('oseid')) return value;
  if (/^(mailto:|tel:|#)/i.test(value)) return value;

  const baseOrigin = sourceUrl?.origin || 'http://127.0.0.1';
  let next;
  try {
    next = new URL(value, baseOrigin);
  } catch {
    return value;
  }
  if (/^https?:\/\//i.test(value) && next.origin !== baseOrigin) return value;

  ['preview_theme_id', 'oseid'].forEach((key) => {
    if (sourceUrl.searchParams.has(key) && !next.searchParams.has(key)) {
      next.searchParams.set(key, sourceUrl.searchParams.get(key));
    }
  });
  return /^https?:\/\//i.test(value) ? next.toString() : `${next.pathname}${next.search}${next.hash}`;
}

function graphQlUserError(field, message, code = 'INVALID') {
  return { field: Array.isArray(field) ? field : [field], message, code };
}

function pageNode(page) {
  return {
    id: gid('Page', page.numericId || page.id),
    title: page.title,
    handle: page.handle,
    body: page.body || '',
    isPublished: Boolean(page.visible),
    templateSuffix: page.templateSuffix || page.template || ''
  };
}

function articleNode(article) {
  return {
    id: gid('Article', article.numericId || article.id),
    title: article.title,
    handle: article.handle,
    body: article.body || '',
    summary: article.excerpt || '',
    isPublished: Boolean(article.visible),
    author: article.author || '林予菁',
    tags: article.tags || '',
    blog: {
      id: gid('Blog', article.blogId || 'news'),
      title: article.blog || 'News',
      handle: article.blogId || slugify(article.blog || 'News', 'news')
    }
  };
}

function productNode(product) {
  return {
    id: gid('Product', product.id),
    title: product.title,
    handle: product.id,
    vendor: product.vendor || 'Mock Store',
    featuredMedia: { id: gid('MediaImage', product.id), preview: { image: { url: product.image } } }
  };
}

function collectionNode(collection) {
  const products = (saved.products || []).filter((product) => (collection.productIds || []).includes(product.id));
  return {
    id: gid('Collection', collection.numericId || collection.id || collection.handle),
    title: collection.title,
    handle: collection.handle || collection.id,
    descriptionHtml: collection.descriptionHtml || '',
    updatedAt: now(),
    productsCount: { count: products.length, precision: 'EXACT' },
    products: connection(products.map(productNode))
  };
}

function catalogPrice(product) {
  const cents = moneyCents(product.price);
  return {
    amount: (cents / 100).toFixed(2),
    currencyCode: saved.currency || 'USD'
  };
}

function catalogProduct(product) {
  const variantId = productVariantId(product);
  return {
    id: gid('Product', product.id),
    handle: product.id,
    title: product.title,
    description: product.description || product.subtitle || '',
    url: `/products/${product.id}`,
    vendor: product.vendor || 'Mock Store',
    merchant: { name: saved.storeName || '我的商店' },
    media: product.image ? [{ type: 'image', url: product.image, altText: product.title }] : [],
    priceRange: {
      minVariantPrice: catalogPrice(product),
      maxVariantPrice: catalogPrice(product)
    },
    variants: [
      {
        id: gid('ProductVariant', variantId),
        title: 'Default Title',
        sku: product.sku || `${product.id.toUpperCase()}-DEFAULT`,
        availableForSale: product.availableForSale !== false,
        price: catalogPrice(product)
      }
    ]
  };
}

function catalogProductMatches(product, value) {
  const raw = String(value || '').split('/').pop();
  return product.id === raw
    || product.handle === raw
    || product.title === value
    || gid('Product', product.id) === value
    || gid('ProductVariant', productVariantId(product)) === value;
}

function findCatalogProduct(value) {
  return (saved.products || []).find((product) => catalogProductMatches(product, value));
}

function catalogSearchResults(args = {}) {
  const catalogArgs = args.catalog || args;
  const query = String(catalogArgs.query || catalogArgs.search || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(20, Number(catalogArgs.limit || catalogArgs.first || 10)));
  const products = (saved.products || []).filter((product) => {
    if (!query) return true;
    const haystack = [product.title, product.id, product.vendor, product.price].join(' ').toLowerCase();
    return haystack.includes(query);
  }).slice(0, limit);
  return {
    query,
    products: products.map(catalogProduct),
    totalCount: products.length
  };
}

function catalogLookupResults(args = {}) {
  const catalogArgs = args.catalog || args;
  const ids = catalogArgs.ids || catalogArgs.productIds || catalogArgs.product_ids || [];
  const values = Array.isArray(ids) ? ids : [ids || catalogArgs.id || catalogArgs.productId || catalogArgs.product_id];
  const products = values.map(findCatalogProduct).filter(Boolean);
  return {
    products: products.map(catalogProduct),
    totalCount: products.length
  };
}

function mcpToolResult(id, structuredContent) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent
    }
  };
}

function mcpError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function handleMcpRequest(body = {}) {
  const id = body.id ?? null;
  if (body.jsonrpc && body.jsonrpc !== '2.0') return mcpError(id, -32600, 'Invalid JSON-RPC version.');
  if (body.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'shopify-online-store-v2-mock', version: '0.1.0' },
        capabilities: { tools: {} }
      }
    };
  }
  if (body.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'search_catalog',
            description: 'Search the mock Shopify storefront catalog.',
            inputSchema: {
              type: 'object',
              properties: {
                catalog: {
                  type: 'object',
                  properties: {
                    query: { type: 'string' },
                    limit: { type: 'number' }
                  }
                }
              }
            }
          },
          {
            name: 'lookup_catalog',
            description: 'Lookup mock catalog products by product or variant ID.',
            inputSchema: {
              type: 'object',
              properties: {
                catalog: {
                  type: 'object',
                  properties: { ids: { type: 'array', items: { type: 'string' } } }
                }
              }
            }
          },
          {
            name: 'get_product',
            description: 'Fetch one mock Shopify product by product or variant ID.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                productId: { type: 'string' }
              }
            }
          }
        ]
      }
    };
  }
  if (body.method === 'tools/call') {
    const { name, arguments: args = {} } = body.params || {};
    if (name === 'search_catalog') {
      return mcpToolResult(id, { catalog: catalogSearchResults(args) });
    }
    if (name === 'lookup_catalog') {
      return mcpToolResult(id, { catalog: catalogLookupResults(args) });
    }
    if (name === 'get_product') {
      const product = findCatalogProduct(args.id || args.productId || args.product_id || args.catalog?.id);
      if (!product) return mcpToolResult(id, { product: null, userErrors: [{ message: 'Product was not found.' }] });
      return mcpToolResult(id, { product: catalogProduct(product), userErrors: [] });
    }
    return mcpError(id, -32602, `Unknown tool: ${name || ''}`);
  }
  return mcpError(id, -32601, `Unsupported MCP method: ${body.method || ''}`);
}

function blogNode(blog) {
  return {
    id: gid('Blog', blog.numericId || blog.id || blog.handle),
    title: blog.title,
    handle: blog.handle || slugify(blog.title, 'news'),
    templateSuffix: blog.templateSuffix || '',
    commentPolicy: String(blog.commentPolicy || 'moderated').toUpperCase(),
    feedEnabled: blog.feedEnabled !== false,
    seoTitle: blog.seoTitle || blog.title,
    seoDescription: blog.seoDescription || ''
  };
}

function defaultPolicies() {
  return [
    { id: 'refund-policy', type: 'REFUND_POLICY', title: '退货和退款政策', handle: 'refund-policy', body: '', status: '未设置政策', showInFooter: false, updatedText: '未设置' },
    { id: 'privacy-policy', type: 'PRIVACY_POLICY', title: '隐私政策', handle: 'privacy-policy', body: '<p>我们会按照适用法律说明收集、使用和保护客户个人信息的方式。</p>', status: '已启用自动', showInFooter: true, updatedText: '5月28日' },
    { id: 'terms-of-service', type: 'TERMS_OF_SERVICE', title: '服务条款', handle: 'terms-of-service', body: '', status: '未设置政策', showInFooter: false, updatedText: '未设置' },
    { id: 'shipping-policy', type: 'SHIPPING_POLICY', title: '物流政策', handle: 'shipping-policy', body: '', status: '未设置政策', showInFooter: false, updatedText: '未设置' },
    { id: 'contact-information', type: 'CONTACT_INFORMATION', title: '联系信息', handle: 'contact-information', body: '', status: '警告必需', showInFooter: false, updatedText: '未设置' },
    { id: 'legal-notice', type: 'LEGAL_NOTICE', title: '法律声明', handle: 'legal-notice', body: '', status: '未设置政策', showInFooter: false, updatedText: '未设置' }
  ];
}

function ensureServerPolicies() {
  if (!Array.isArray(saved.policies)) saved.policies = [];
  const existing = new Map(saved.policies.map((policy) => [policy.type || policy.id, policy]));
  saved.policies = defaultPolicies().map((policy) => ({ ...policy, ...(existing.get(policy.type) || existing.get(policy.id) || {}) }));
  return saved.policies;
}

function policyNode(policy) {
  return {
    id: gid('ShopPolicy', policy.type || policy.id),
    type: policy.type,
    title: policy.title,
    handle: policy.handle,
    body: policy.body || '',
    url: `/policies/${policy.handle}`,
    createdAt: policy.createdAt || now(),
    updatedAt: policy.updatedAt || policy.createdAt || now()
  };
}

function updatePolicyFromGraphql(input = {}) {
  const type = String(input.type || input.policyType || '').trim().toUpperCase();
  const rawId = rawGidId(input.id || '');
  const errors = [];
  if (!type) errors.push(graphQlUserError('shopPolicy.type', 'Type is required.', 'REQUIRED'));
  if (input.body === undefined || input.body === null) errors.push(graphQlUserError('shopPolicy.body', 'Body is required.', 'REQUIRED'));
  if (errors.length) return { shopPolicy: null, userErrors: errors };
  const index = ensureServerPolicies().findIndex((policy) => policy.type === type || policy.id === rawId || policy.type === rawId);
  if (index < 0) {
    return { shopPolicy: null, userErrors: [graphQlUserError('shopPolicy.type', 'Shop policy was not found.', 'NOT_FOUND')] };
  }
  const old = saved.policies[index];
  const body = input.body === undefined ? old.body : String(input.body || '').trim();
  const title = input.title === undefined ? old.title : String(input.title || old.title).trim();
  const next = {
    ...old,
    title,
    body,
    showInFooter: input.showInFooter === undefined ? old.showInFooter : Boolean(input.showInFooter),
    status: body ? (old.type === 'PRIVACY_POLICY' ? '已启用自动' : '已设置政策') : (old.type === 'CONTACT_INFORMATION' ? '警告必需' : '未设置政策'),
    updatedText: body ? '刚刚通过 GraphQL 编辑' : '未设置',
    updatedAt: now()
  };
  saved.policies[index] = next;
  commitAdminMutation('admin_graphql_shop_policy_update', { type: next.type });
  return { shopPolicy: policyNode(next), userErrors: [] };
}

function ensureServerMetaobjectDefinitions() {
  if (!Array.isArray(saved.metaobjectDefinitions)) saved.metaobjectDefinitions = [];
  saved.metaobjectDefinitions.forEach((definition) => {
    definition.handle = definition.handle || slugify(definition.name || definition.id, 'metaobject');
    if (!Array.isArray(definition.entries)) definition.entries = [];
  });
  return saved.metaobjectDefinitions;
}

function metaobjectDefinitionKey(definition) {
  return definition?.handle || definition?.id || slugify(definition?.name || 'metaobject', 'metaobject');
}

function metaobjectFieldKeys(definition) {
  const keys = [];
  const addKey = (key) => {
    const normalized = String(key || '').trim();
    if (normalized && !keys.includes(normalized)) keys.push(normalized);
  };
  (definition.fields || definition.fieldDefinitions || []).forEach((field) => addKey(field.key || field.name || field));
  (definition.entries || []).forEach((entry) => Object.keys(entry.fields || {}).forEach(addKey));
  if (!keys.length) ['title', 'body'].forEach(addKey);
  return keys;
}

function findMetaobjectDefinitionIndex(value) {
  const raw = rawGidId(value);
  return ensureServerMetaobjectDefinitions().findIndex((definition) => {
    const stableId = definition.numericId || definition.id || definition.handle;
    return value === gid('MetaobjectDefinition', stableId)
      || raw === String(definition.numericId || '')
      || raw === String(definition.id || '')
      || raw === String(definition.handle || '')
      || value === definition.handle;
  });
}

function metaobjectDefinitionNode(definition) {
  const fields = metaobjectFieldKeys(definition);
  return {
    id: gid('MetaobjectDefinition', definition.numericId || definition.id || definition.handle),
    name: definition.name || definition.label || definition.handle,
    type: definition.handle,
    description: definition.description || '',
    fieldDefinitions: fields.map((key) => ({ key, name: key, type: { name: 'single_line_text_field' } })),
    metaobjectsCount: (definition.entries || []).length
  };
}

function metaobjectNode(definition, entry) {
  const fields = Object.entries(entry.fields || {}).map(([key, value]) => ({ key, value: String(value ?? '') }));
  return {
    id: gid('Metaobject', entry.numericId || `${definition.handle}-${entry.handle}`),
    handle: entry.handle,
    type: definition.handle,
    displayName: entry.title || entry.fields?.title || entry.handle,
    updatedAt: entry.updatedAt || now(),
    fields,
    field: ({ key } = {}) => fields.find((field) => field.key === key) || null
  };
}

function findMetaobjectEntryReference(value, type = '') {
  const raw = rawGidId(value);
  for (const definition of ensureServerMetaobjectDefinitions()) {
    if (type && definition.handle !== type && definition.id !== type) continue;
    const entryIndex = (definition.entries || []).findIndex((entry) => {
      const stableId = entry.numericId || `${definition.handle}-${entry.handle}`;
      return value === gid('Metaobject', stableId)
        || raw === String(entry.numericId || '')
        || raw === String(stableId)
        || raw === String(entry.handle || '')
        || value === entry.handle;
    });
    if (entryIndex >= 0) return { definition, entry: definition.entries[entryIndex], entryIndex };
  }
  return null;
}

function normalizeCommentPolicy(value) {
  const raw = String(value || 'MODERATED').toLowerCase();
  if (raw === 'open' || raw === 'closed' || raw === 'moderated') return raw;
  return 'moderated';
}

function blogKey(blog) {
  return blog?.handle || blog?.id || slugify(blog?.title || 'News', 'news');
}

function rawGidId(value) {
  return String(value || '').split('/').pop();
}

function findBlogIndex(value) {
  const raw = rawGidId(value);
  return (saved.blogs || []).findIndex((blog) => {
    const graphId = gid('Blog', blog.numericId || blog.id || blog.handle);
    return graphId === value || blog.numericId === raw || blog.id === raw || blog.handle === raw;
  });
}

function syncServerBlogReferences(oldBlog, nextBlog) {
  const oldHandle = blogKey(oldBlog);
  const nextHandle = blogKey(nextBlog);
  saved.blogArticles = (saved.blogArticles || []).map((article) => {
    const articleHandle = article.blogId || slugify(article.blog || 'News', 'news');
    if (articleHandle !== oldHandle && article.blog !== oldBlog.title) return article;
    return { ...article, blog: nextBlog.title, blogId: nextHandle };
  });
  saved.menus = (saved.menus || []).map((menu) => ({
    ...menu,
    items: mapMenuItemsDeep(menu.items || [], (item) => {
      if (item.link === `/blogs/${oldHandle}`) return { ...item, link: `/blogs/${nextHandle}` };
      if (item.link?.startsWith(`/blogs/${oldHandle}/`)) return { ...item, link: item.link.replace(`/blogs/${oldHandle}/`, `/blogs/${nextHandle}/`) };
      return item;
    })
  }));
  if (saved.themeTemplates?.blog?.blogId === oldHandle) {
    saved.themeTemplates.blog.blogId = nextHandle;
    saved.themeTemplates.blog.blogTitle = nextBlog.title;
    saved.themeTemplates.blog.previewPath = `/blogs/${nextHandle}`;
    const section = saved.themeTemplates.blog.sections.find((item) => item.type === 'blog-main');
    if (section) section.settings.blogId = nextHandle;
  }
  if (saved.themeTemplates?.article?.blogId === oldHandle) saved.themeTemplates.article.blogId = nextHandle;
  if (saved.previewPath === `/blogs/${oldHandle}`) saved.previewPath = `/blogs/${nextHandle}`;
  if (saved.previewPath?.startsWith(`/blogs/${oldHandle}/`)) saved.previewPath = saved.previewPath.replace(`/blogs/${oldHandle}/`, `/blogs/${nextHandle}/`);
}

function redirectNode(redirect) {
  return {
    id: gid('UrlRedirect', redirect.numericId || redirect.id),
    path: redirect.from || redirect.path,
    target: redirect.to || redirect.target
  };
}

function findRedirectIndex(value) {
  const raw = rawGidId(value);
  return (saved.redirects || []).findIndex((redirect) => {
    const stableId = redirect.numericId || redirect.id || redirect.from || redirect.path;
    return value === gid('UrlRedirect', stableId)
      || raw === String(redirect.numericId || '')
      || raw === String(redirect.id || '')
      || raw === String(redirect.from || redirect.path || '')
      || value === redirect.from
      || value === redirect.path;
  });
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseRedirectCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: ['CSV is empty.'] };
  const first = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase().replace(/\s+/g, ' ').trim());
  const hasHeader = first.some((cell) => ['redirect from', 'from', 'path', 'source'].includes(cell)) && first.some((cell) => ['redirect to', 'to', 'target'].includes(cell));
  const fromIndex = hasHeader ? first.findIndex((cell) => ['redirect from', 'from', 'path', 'source'].includes(cell)) : 0;
  const toIndex = hasHeader ? first.findIndex((cell) => ['redirect to', 'to', 'target'].includes(cell)) : 1;
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const errors = [];
  const rows = dataLines.map((line, index) => {
    const cells = splitCsvLine(line);
    const path = cells[fromIndex]?.trim() || '';
    const target = cells[toIndex]?.trim() || '';
    const rowNumber = index + (hasHeader ? 2 : 1);
    if (!path.startsWith('/')) errors.push(graphQlUserError(['urlRedirects', String(index), 'path'], `Row ${rowNumber}: Path must start with /.`, 'INVALID'));
    if (!target) errors.push(graphQlUserError(['urlRedirects', String(index), 'target'], `Row ${rowNumber}: Target is required.`, 'REQUIRED'));
    return { path, target };
  }).filter((row) => row.path || row.target);
  return { rows, errors };
}

function csvFromDataUrl(url) {
  const value = String(url || '');
  if (value.startsWith('data:text/csv;base64,')) return Buffer.from(value.slice('data:text/csv;base64,'.length), 'base64').toString('utf8');
  if (value.startsWith('data:text/csv,')) return decodeURIComponent(value.slice('data:text/csv,'.length));
  return '';
}

function redirectImportNode(item) {
  const count = (item.rows || []).length;
  return {
    id: gid('UrlRedirectImport', item.numericId || item.id),
    url: item.url || item.sourceUrl || '',
    status: item.status || (item.submittedAt ? 'COMPLETED' : 'CREATED'),
    count,
    errorCount: item.failedCount || 0,
    createdCount: item.createdCount || 0,
    updatedCount: item.updatedCount || 0
  };
}

function mapMenuItemsDeep(items = [], mapper) {
  return (items || []).map((item) => mapper({
    ...item,
    items: mapMenuItemsDeep(item.items || [], mapper)
  }));
}

function countMenuItems(items = []) {
  return (items || []).reduce((total, item) => total + 1 + countMenuItems(item.items || []), 0);
}

function menuItemNode(item, index = 0) {
  return {
    id: gid('MenuItem', item.numericId || item.id || `${item.label || 'item'}-${index}`),
    title: item.label || item.title || '',
    url: item.link || item.url || '',
    type: item.type || 'HTTP',
    resourceId: item.resourceId || null,
    items: (item.items || []).map(menuItemNode)
  };
}

function menuNode(menu) {
  return {
    id: gid('Menu', menu.numericId || menu.id || menu.handle),
    title: menu.title,
    handle: menu.handle,
    items: (menu.items || []).map(menuItemNode),
    itemCount: countMenuItems(menu.items || [])
  };
}

function menuKey(menu) {
  return menu?.handle || menu?.id || slugify(menu?.title || 'menu', 'menu');
}

function findMenuIndex(value) {
  const raw = rawGidId(value);
  return (saved.menus || []).findIndex((menu) => {
    const graphId = gid('Menu', menu.numericId || menu.id || menu.handle);
    return graphId === value || menu.numericId === raw || menu.id === raw || menu.handle === raw;
  });
}

function normalizeMenuItems(items = []) {
  return (items || []).map((item, index) => ({
    id: item.id ? rawGidId(item.id) : `item-${Date.now()}-${index}`,
    numericId: item.numericId,
    label: String(item.title || item.label || '').trim(),
    link: String(item.url || item.link || '').trim(),
    type: item.type || 'HTTP',
    resourceId: item.resourceId || null,
    items: normalizeMenuItems(item.items || [])
  })).filter((item) => item.label || item.link);
}

function createMenuFromGraphql(input = {}) {
  const title = String(input.title || '').trim();
  const handle = slugify(input.handle || title, `menu-${Date.now()}`);
  const errors = [];
  if (!title) errors.push(graphQlUserError('title', 'Title is required.', 'REQUIRED'));
  if (!handle) errors.push(graphQlUserError('handle', 'Handle is required.', 'REQUIRED'));
  if ((saved.menus || []).some((menu) => menuKey(menu) === handle)) errors.push(graphQlUserError('handle', 'Handle has already been taken.', 'TAKEN'));
  if (errors.length) return { menu: null, userErrors: errors };
  const menu = {
    id: handle,
    numericId: numericId('5120'),
    title,
    handle,
    items: normalizeMenuItems(input.items || []),
    updatedText: '刚刚'
  };
  saved.menus.push(menu);
  commitAdminMutation('admin_graphql_menu_create', { handle });
  return { menu: menuNode(menu), userErrors: [] };
}

function updateMenuFromGraphql(id, input = {}) {
  const index = findMenuIndex(id || input.id);
  if (index < 0) {
    return { menu: null, userErrors: [graphQlUserError('id', 'Menu was not found.', 'NOT_FOUND')] };
  }
  const oldMenu = saved.menus[index];
  const title = String(input.title || oldMenu.title || '').trim();
  const handle = input.handle === undefined ? menuKey(oldMenu) : slugify(input.handle || title, menuKey(oldMenu));
  const errors = [];
  if (!title) errors.push(graphQlUserError('title', 'Title is required.', 'REQUIRED'));
  if (saved.menus.some((menu, menuIndex) => menuIndex !== index && menuKey(menu) === handle)) errors.push(graphQlUserError('handle', 'Handle has already been taken.', 'TAKEN'));
  if (errors.length) return { menu: null, userErrors: errors };
  const next = {
    ...oldMenu,
    title,
    handle,
    id: handle,
    items: normalizeMenuItems(input.items || oldMenu.items || []),
    updatedText: '刚刚'
  };
  saved.menus[index] = next;
  commitAdminMutation('admin_graphql_menu_update', { handle });
  return { menu: menuNode(next), userErrors: [] };
}

function deleteMenuFromGraphql(id) {
  const index = findMenuIndex(id);
  if (index < 0) {
    return { deletedMenuId: null, userErrors: [graphQlUserError('id', 'Menu was not found.', 'NOT_FOUND')] };
  }
  const menu = saved.menus[index];
  const protectedHandles = new Set(['main-menu', 'footer-menu', 'customer-account-main-menu']);
  if (protectedHandles.has(menuKey(menu))) {
    return { deletedMenuId: null, userErrors: [graphQlUserError('id', 'Default storefront menus cannot be deleted in this mock.', 'INVALID')] };
  }
  const deletedMenuId = gid('Menu', menu.numericId || menu.id || menu.handle);
  saved.menus.splice(index, 1);
  commitAdminMutation('admin_graphql_menu_delete', { handle: menuKey(menu) });
  return { deletedMenuId, userErrors: [] };
}

function domainNode(domain) {
  const host = domain.host || domain.name;
  return {
    id: gid('Domain', domain.numericId || domain.id || host),
    host,
    url: `https://${host}`,
    sslEnabled: domain.status === '已连接',
    localization: null,
    marketWebPresence: null,
    primary: Boolean(domain.primary)
  };
}

function mediaFileKind(file = {}) {
  const mime = String(file.mimeType || '');
  const name = String(file.name || '').toLowerCase();
  if (String(file.kind || '').toLowerCase() === 'video' || mime.startsWith('video/') || /\.(mp4|mov|webm)$/.test(name)) return 'VIDEO';
  if (String(file.kind || '').toLowerCase() === 'pdf' || /\.pdf$/.test(name)) return 'GENERIC_FILE';
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name) || file.src) return 'MEDIA_IMAGE';
  return 'GENERIC_FILE';
}

function fileGraphqlType(file = {}) {
  const kind = mediaFileKind(file);
  if (kind === 'MEDIA_IMAGE') return 'MediaImage';
  if (kind === 'VIDEO') return 'Video';
  return 'GenericFile';
}

function fileNode(file) {
  const url = file.url || file.src || `/cdn/shop/files/${encodeURIComponent(file.name || file.id || 'file')}`;
  const node = {
    id: gid(fileGraphqlType(file), file.numericId || file.id || file.name),
    alt: file.alt || '',
    createdAt: file.createdAt || now(),
    updatedAt: file.updatedAt || file.createdAt || now(),
    fileStatus: 'READY',
    mimeType: file.mimeType || (mediaFileKind(file) === 'MEDIA_IMAGE' ? 'image/svg+xml' : 'application/octet-stream'),
    preview: { image: { url, altText: file.alt || file.name || '' } },
    url
  };
  if (mediaFileKind(file) === 'MEDIA_IMAGE') {
    return { ...node, image: { url, altText: file.alt || file.name || '' } };
  }
  return node;
}

function findFileIndex(value) {
  const raw = rawGidId(value);
  return (saved.mediaLibrary || []).findIndex((file) => {
    const stableId = file.numericId || file.id || file.name;
    return value === gid(fileGraphqlType(file), stableId)
      || value === gid('File', stableId)
      || raw === String(file.numericId || '')
      || raw === String(file.id || '')
      || raw === String(file.name || '');
  });
}

function connection(nodes) {
  return {
    edges: nodes.map((node, index) => ({ cursor: Buffer.from(String(index)).toString('base64'), node })),
    nodes,
    pageInfo: { hasNextPage: false, hasPreviousPage: false }
  };
}

function createPageFromGraphql(input = {}) {
  const title = String(input.title || '').trim();
  if (!title) {
    return { page: null, userErrors: [graphQlUserError('page.title', 'Title is required.', 'REQUIRED')] };
  }
  const handle = slugify(input.handle || title, `page-${Date.now()}`);
  const page = {
    id: handle,
    numericId: numericId('1025'),
    title,
    handle,
    visible: input.isPublished !== false,
    body: input.body || '',
    seoTitle: input.seoTitle || title,
    seoDescription: input.seoDescription || '',
    templateSuffix: input.templateSuffix || '',
    updatedText: '刚刚'
  };
  saved.pages.push(page);
  commitAdminMutation('admin_graphql_page_create', { handle });
  return { page: pageNode(page), userErrors: [] };
}

function createArticleFromGraphql(input = {}, blog = {}) {
  const title = String(input.title || '').trim();
  if (!title) {
    return { article: null, userErrors: [graphQlUserError('article.title', 'Title is required.', 'REQUIRED')] };
  }
  const handle = slugify(input.handle || title, `article-${Date.now()}`);
  const existingBlog = blog.id ? saved.blogs?.[findBlogIndex(blog.id)] : (saved.blogs || []).find((candidate) => blog.handle && blogKey(candidate) === blog.handle);
  const blogTitle = blog.title || existingBlog?.title || blog.handle || 'News';
  const blogId = existingBlog ? blogKey(existingBlog) : slugify(String(blog.handle || blog.id || blogTitle).split('/').pop(), 'news');
  saved.blogs = saved.blogs || [];
  if (!saved.blogs.some((candidate) => candidate.id === blogId || candidate.handle === blogId)) {
    saved.blogs.push({
      id: blogId,
      numericId: numericId('3072'),
      title: blogTitle,
      handle: blogId,
      commentPolicy: 'moderated',
      feedEnabled: true,
      seoTitle: blogTitle,
      seoDescription: '',
      updatedText: '刚刚'
    });
  }
  const article = {
    id: handle,
    numericId: numericId('2048'),
    title,
    handle,
    body: input.body || input.bodyHtml || '',
    excerpt: input.summary || input.excerpt || '',
    seoTitle: input.seoTitle || title,
    seoDescription: input.seoDescription || '',
    visible: input.isPublished === true || Boolean(input.publishDate),
    author: input.author?.name || input.author || '林予菁',
    blog: blogTitle,
    blogId,
    tags: Array.isArray(input.tags) ? input.tags.join(', ') : (input.tags || ''),
    image: input.image?.src || input.image || '',
    updatedText: '刚刚'
  };
  saved.blogArticles.push(article);
  commitAdminMutation('admin_graphql_article_create', { handle });
  return { article: articleNode(article), userErrors: [] };
}

function createBlogFromGraphql(input = {}) {
  const title = String(input.title || '').trim();
  if (!title) {
    return { blog: null, userErrors: [graphQlUserError('blog.title', 'Title is required.', 'REQUIRED')] };
  }
  const handle = slugify(input.handle || title, `blog-${Date.now()}`);
  saved.blogs = saved.blogs || [];
  if (saved.blogs.some((blog) => blogKey(blog) === handle)) {
    return { blog: null, userErrors: [graphQlUserError('blog.handle', 'Handle has already been taken.', 'TAKEN')] };
  }
  const blog = {
    id: handle,
    numericId: numericId('3072'),
    title,
    handle,
    templateSuffix: input.templateSuffix || '',
    commentPolicy: normalizeCommentPolicy(input.commentPolicy),
    feedEnabled: input.feedEnabled !== false,
    seoTitle: input.seoTitle || title,
    seoDescription: input.seoDescription || '',
    updatedText: '刚刚'
  };
  saved.blogs.push(blog);
  commitAdminMutation('admin_graphql_blog_create', { handle });
  return { blog: blogNode(blog), userErrors: [] };
}

function createCollectionFromGraphql(input = {}) {
  const title = String(input.title || '').trim();
  if (!title) {
    return { collection: null, userErrors: [graphQlUserError('input.title', 'Title is required.', 'REQUIRED')] };
  }
  saved.collections = saved.collections || [];
  const handle = slugify(input.handle || title, `collection-${Date.now()}`);
  if (saved.collections.some((collection) => (collection.handle || collection.id) === handle)) {
    return { collection: null, userErrors: [graphQlUserError('input.handle', 'Handle has already been taken.', 'TAKEN')] };
  }
  const productIds = Array.isArray(input.products)
    ? input.products.map((id) => String(id).split('/').pop()).filter((id) => (saved.products || []).some((product) => product.id === id))
    : [];
  const collection = {
    id: handle,
    numericId: numericId('5120'),
    title,
    handle,
    subtitle: `${productIds.length} 个产品`,
    descriptionHtml: input.descriptionHtml || input.description || '',
    productIds,
    image: input.image?.src || input.image || '',
    updatedText: '刚刚'
  };
  saved.collections.push(collection);
  commitAdminMutation('admin_graphql_collection_create', { handle });
  return { collection: collectionNode(collection), userErrors: [] };
}

function updateBlogFromGraphql(id, input = {}) {
  const index = findBlogIndex(id || input.id);
  if (index < 0) {
    return { blog: null, userErrors: [graphQlUserError('id', 'Blog was not found.', 'NOT_FOUND')] };
  }
  const oldBlog = saved.blogs[index];
  const title = input.title === undefined ? oldBlog.title : String(input.title || '').trim();
  if (!title) {
    return { blog: null, userErrors: [graphQlUserError('blog.title', 'Title is required.', 'REQUIRED')] };
  }
  const handle = input.handle === undefined ? blogKey(oldBlog) : slugify(input.handle || title, blogKey(oldBlog));
  if (saved.blogs.some((blog, blogIndex) => blogIndex !== index && blogKey(blog) === handle)) {
    return { blog: null, userErrors: [graphQlUserError('blog.handle', 'Handle has already been taken.', 'TAKEN')] };
  }
  const next = {
    ...oldBlog,
    title,
    handle,
    id: handle,
    templateSuffix: input.templateSuffix === undefined ? oldBlog.templateSuffix : input.templateSuffix,
    commentPolicy: input.commentPolicy === undefined ? oldBlog.commentPolicy : normalizeCommentPolicy(input.commentPolicy),
    feedEnabled: input.feedEnabled === undefined ? oldBlog.feedEnabled !== false : input.feedEnabled !== false,
    seoTitle: input.seoTitle === undefined ? oldBlog.seoTitle : input.seoTitle,
    seoDescription: input.seoDescription === undefined ? oldBlog.seoDescription : input.seoDescription,
    updatedText: '刚刚'
  };
  saved.blogs[index] = next;
  syncServerBlogReferences(oldBlog, next);
  commitAdminMutation('admin_graphql_blog_update', { handle });
  return { blog: blogNode(next), userErrors: [] };
}

function deleteBlogFromGraphql(id) {
  const index = findBlogIndex(id);
  if (index < 0) {
    return { deletedBlogId: null, userErrors: [graphQlUserError('id', 'Blog was not found.', 'NOT_FOUND')] };
  }
  const blog = saved.blogs[index];
  const handle = blogKey(blog);
  const articleCount = (saved.blogArticles || []).filter((article) => (article.blogId || slugify(article.blog || 'News', 'news')) === handle).length;
  if (articleCount > 0 || saved.blogs.length <= 1) {
    return { deletedBlogId: null, userErrors: [graphQlUserError('id', 'Blog contains articles or is the only blog.', 'INVALID')] };
  }
  const deletedBlogId = gid('Blog', blog.numericId || blog.id || blog.handle);
  saved.blogs.splice(index, 1);
  commitAdminMutation('admin_graphql_blog_delete', { handle });
  return { deletedBlogId, userErrors: [] };
}

function createRedirectFromGraphql(input = {}) {
  const from = String(input.path || input.from || '').trim();
  const to = String(input.target || input.to || '').trim();
  const errors = [];
  if (!from.startsWith('/')) errors.push(graphQlUserError('urlRedirect.path', 'Path must start with /.', 'INVALID'));
  if (!to) errors.push(graphQlUserError('urlRedirect.target', 'Target is required.', 'REQUIRED'));
  if (errors.length) return { urlRedirect: null, userErrors: errors };
  const redirect = {
    id: `redirect-${Date.now()}`,
    numericId: numericId('4096'),
    from,
    to,
    updatedText: '刚刚'
  };
  saved.redirects.push(redirect);
  commitAdminMutation('admin_graphql_url_redirect_create', { path: from, target: to });
  return { urlRedirect: redirectNode(redirect), userErrors: [] };
}

function deleteRedirectFromGraphql(id) {
  const index = findRedirectIndex(id);
  if (index < 0) {
    return { deletedUrlRedirectId: null, userErrors: [graphQlUserError('id', 'URL redirect was not found.', 'NOT_FOUND')] };
  }
  const redirect = saved.redirects[index];
  const deletedUrlRedirectId = gid('UrlRedirect', redirect.numericId || redirect.id || redirect.from);
  saved.redirects.splice(index, 1);
  commitAdminMutation('admin_graphql_url_redirect_delete', { deletedUrlRedirectId });
  return { deletedUrlRedirectId, userErrors: [] };
}

function createRedirectImportFromGraphql(input = {}) {
  const url = String(input.url || input.sourceUrl || '').trim();
  const csv = input.csv || csvFromDataUrl(url);
  const parsed = parseRedirectCsv(csv);
  const importJob = {
    id: `redirect-import-${Date.now()}`,
    numericId: numericId('9216'),
    url,
    rows: parsed.rows,
    errors: parsed.errors,
    status: parsed.errors.length ? 'FAILED' : 'CREATED',
    failedCount: parsed.errors.length,
    createdCount: 0,
    updatedCount: 0,
    updatedText: '刚刚'
  };
  saved.redirectImports = saved.redirectImports || [];
  saved.redirectImports.unshift(importJob);
  commitAdminMutation('admin_graphql_url_redirect_import_create', { count: parsed.rows.length, errors: parsed.errors.length });
  return { urlRedirectImport: redirectImportNode(importJob), userErrors: parsed.errors };
}

function submitRedirectImportFromGraphql(id) {
  const raw = rawGidId(id);
  const importJob = (saved.redirectImports || []).find((item) => item.id === raw || item.numericId === raw || gid('UrlRedirectImport', item.numericId || item.id) === id);
  if (!importJob) {
    return { urlRedirectImport: null, userErrors: [graphQlUserError('id', 'URL redirect import was not found.', 'NOT_FOUND')] };
  }
  if (importJob.errors?.length) {
    importJob.status = 'FAILED';
    return { urlRedirectImport: redirectImportNode(importJob), userErrors: importJob.errors };
  }
  saved.redirects = saved.redirects || [];
  let createdCount = 0;
  let updatedCount = 0;
  (importJob.rows || []).forEach((row, index) => {
    const existing = saved.redirects.find((redirect) => (redirect.from || redirect.path) === row.path);
    if (existing) {
      existing.to = row.target;
      existing.updatedText = '刚刚通过 GraphQL 导入更新';
      existing.importId = importJob.id;
      updatedCount += 1;
    } else {
      saved.redirects.push({
        id: `${importJob.id}-${index}`,
        numericId: numericId('4096'),
        from: row.path,
        to: row.target,
        updatedText: '刚刚通过 GraphQL 导入创建',
        importId: importJob.id
      });
      createdCount += 1;
    }
  });
  importJob.status = 'COMPLETED';
  importJob.submittedAt = now();
  importJob.createdCount = createdCount;
  importJob.updatedCount = updatedCount;
  commitAdminMutation('admin_graphql_url_redirect_import_submit', { count: importJob.rows.length, createdCount, updatedCount });
  return { urlRedirectImport: redirectImportNode(importJob), userErrors: [] };
}

function createFilesFromGraphql(input = []) {
  const fileInputs = Array.isArray(input) ? input : [input];
  const created = [];
  const errors = [];
  saved.mediaLibrary = saved.mediaLibrary || [];
  fileInputs.forEach((fileInput, index) => {
    const source = String(fileInput.originalSource || fileInput.source || fileInput.url || '').trim();
    const filename = String(fileInput.filename || fileInput.name || source.split('/').pop() || '').trim();
    if (!source && !filename) {
      errors.push(graphQlUserError(['files', String(index), 'originalSource'], 'File source or filename is required.', 'REQUIRED'));
      return;
    }
    const name = filename || `uploaded-file-${Date.now()}-${index}`;
    const mimeType = fileInput.mimeType || (/\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? 'image/svg+xml' : 'application/octet-stream');
    const media = {
      id: `media-graphql-${Date.now()}-${index}`,
      numericId: numericId('6144'),
      name,
      kind: mediaFileKind({ name, mimeType, src: source }) === 'MEDIA_IMAGE' ? 'image' : 'file',
      src: source || '/assets/product-coral.svg',
      url: source || `/cdn/shop/files/${encodeURIComponent(name)}`,
      alt: fileInput.alt || fileInput.altText || name,
      mimeType,
      uploadedText: '刚刚通过 GraphQL 上传',
      createdAt: now(),
      updatedAt: now()
    };
    saved.mediaLibrary.unshift(media);
    created.push(fileNode(media));
  });
  if (created.length) commitAdminMutation('admin_graphql_file_create', { count: created.length });
  return { files: created, userErrors: errors };
}

function updateFilesFromGraphql(input = []) {
  const fileInputs = Array.isArray(input) ? input : [input];
  const updated = [];
  const errors = [];
  saved.mediaLibrary = saved.mediaLibrary || [];
  fileInputs.forEach((fileInput, index) => {
    const id = fileInput.id || fileInput.fileId;
    const fileIndex = findFileIndex(id);
    if (fileIndex < 0) {
      errors.push(graphQlUserError(['files', String(index), 'id'], `File id ${JSON.stringify(id)} does not exist.`, 'FILE_DOES_NOT_EXIST'));
      return;
    }
    const existing = saved.mediaLibrary[fileIndex];
    const next = {
      ...existing,
      alt: fileInput.alt === undefined ? existing.alt : fileInput.alt,
      updatedAt: now(),
      uploadedText: '刚刚通过 GraphQL 编辑'
    };
    if (fileInput.originalSource || fileInput.source || fileInput.url) {
      const source = fileInput.originalSource || fileInput.source || fileInput.url;
      next.src = source;
      next.url = source;
    }
    if (fileInput.filename || fileInput.name) {
      next.name = fileInput.filename || fileInput.name;
    }
    saved.mediaLibrary[fileIndex] = next;
    updated.push(fileNode(next));
  });
  if (updated.length) commitAdminMutation('admin_graphql_file_update', { count: updated.length });
  return { files: updated, userErrors: errors };
}

function deleteFilesFromGraphql(input = []) {
  const ids = Array.isArray(input) ? input : [input];
  const deletedFileIds = [];
  const errors = [];
  saved.mediaLibrary = saved.mediaLibrary || [];
  ids.forEach((id, index) => {
    const fileIndex = findFileIndex(id);
    if (fileIndex < 0) {
      errors.push(graphQlUserError(['fileIds', String(index)], `File id ${JSON.stringify(id)} does not exist.`, 'FILE_DOES_NOT_EXIST'));
      return;
    }
    const [file] = saved.mediaLibrary.splice(fileIndex, 1);
    deletedFileIds.push(gid(fileGraphqlType(file), file.numericId || file.id || file.name));
  });
  if (deletedFileIds.length) commitAdminMutation('admin_graphql_file_delete', { count: deletedFileIds.length });
  return { deletedFileIds, userErrors: errors };
}

function createMetaobjectDefinitionFromGraphql(input = {}) {
  const name = String(input.name || input.displayNameKey || '').trim();
  const handle = slugify(input.type || input.handle || name, `metaobject-${Date.now()}`);
  const errors = [];
  if (!name) errors.push(graphQlUserError('definition.name', 'Name is required.', 'REQUIRED'));
  if (findMetaobjectDefinitionIndex(handle) >= 0) errors.push(graphQlUserError('definition.type', 'Type has already been taken.', 'TAKEN'));
  if (errors.length) return { metaobjectDefinition: null, userErrors: errors };
  const fields = (input.fieldDefinitions || input.fields || []).map((field) => ({
    key: slugify(field.key || field.name, 'field').replace(/-/g, '_'),
    name: field.name || field.key || 'Field',
    type: field.type || 'single_line_text_field'
  }));
  const definition = {
    id: handle,
    numericId: numericId('7168'),
    handle,
    name,
    label: name,
    description: input.description || '',
    fields,
    entries: [],
    updatedText: '刚刚'
  };
  ensureServerMetaobjectDefinitions().push(definition);
  commitAdminMutation('admin_graphql_metaobject_definition_create', { handle });
  return { metaobjectDefinition: metaobjectDefinitionNode(definition), userErrors: [] };
}

function normalizeMetaobjectFields(fields = []) {
  if (Array.isArray(fields)) {
    return Object.fromEntries(fields.map((field) => [field.key, String(field.value ?? '')]).filter(([key]) => key));
  }
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, String(value ?? '')]));
}

function createMetaobjectFromGraphql(input = {}) {
  const type = String(input.type || '').trim();
  const definition = ensureServerMetaobjectDefinitions().find((candidate) => candidate.handle === type || candidate.id === type);
  if (!definition) return { metaobject: null, userErrors: [graphQlUserError('metaobject.type', 'Metaobject definition was not found.', 'NOT_FOUND')] };
  const fields = normalizeMetaobjectFields(input.fields || {});
  const title = input.displayName || fields.title || fields.name || input.handle || 'Metaobject entry';
  const handle = slugify(input.handle || title, `entry-${Date.now()}`);
  if ((definition.entries || []).some((entry) => entry.handle === handle)) {
    return { metaobject: null, userErrors: [graphQlUserError('metaobject.handle', 'Handle has already been taken.', 'TAKEN')] };
  }
  const entry = {
    numericId: numericId('8192'),
    handle,
    title,
    image: input.image || fields.image || '',
    fields,
    updatedText: '刚刚通过 GraphQL 创建',
    updatedAt: now()
  };
  definition.entries = definition.entries || [];
  definition.entries.push(entry);
  definition.updatedText = '刚刚';
  commitAdminMutation('admin_graphql_metaobject_create', { type, handle });
  return { metaobject: metaobjectNode(definition, entry), userErrors: [] };
}

function updateMetaobjectFromGraphql(id, input = {}) {
  const ref = findMetaobjectEntryReference(id, input.type);
  if (!ref) return { metaobject: null, userErrors: [graphQlUserError('id', 'Metaobject was not found.', 'NOT_FOUND')] };
  const nextFields = { ...(ref.entry.fields || {}), ...normalizeMetaobjectFields(input.fields || {}) };
  const nextHandle = input.handle ? slugify(input.handle, ref.entry.handle) : ref.entry.handle;
  if ((ref.definition.entries || []).some((entry, index) => index !== ref.entryIndex && entry.handle === nextHandle)) {
    return { metaobject: null, userErrors: [graphQlUserError('metaobject.handle', 'Handle has already been taken.', 'TAKEN')] };
  }
  const next = {
    ...ref.entry,
    handle: nextHandle,
    title: input.displayName || nextFields.title || ref.entry.title || nextHandle,
    image: input.image === undefined ? ref.entry.image : input.image,
    fields: nextFields,
    updatedText: '刚刚通过 GraphQL 编辑',
    updatedAt: now()
  };
  ref.definition.entries[ref.entryIndex] = next;
  ref.definition.updatedText = '刚刚';
  commitAdminMutation('admin_graphql_metaobject_update', { type: ref.definition.handle, handle: next.handle });
  return { metaobject: metaobjectNode(ref.definition, next), userErrors: [] };
}

function deleteMetaobjectFromGraphql(id) {
  const ref = findMetaobjectEntryReference(id);
  if (!ref) return { deletedId: null, userErrors: [graphQlUserError('id', 'Metaobject was not found.', 'NOT_FOUND')] };
  const deletedId = gid('Metaobject', ref.entry.numericId || `${ref.definition.handle}-${ref.entry.handle}`);
  ref.definition.entries.splice(ref.entryIndex, 1);
  ref.definition.updatedText = '刚刚';
  commitAdminMutation('admin_graphql_metaobject_delete', { type: ref.definition.handle, deletedId });
  return { deletedId, userErrors: [] };
}

function handleGraphqlQuery(query = '', variables = {}) {
  const data = {};
  const normalized = query.replace(/\s+/g, ' ');
  const inlineMetaobjectType = /metaobjects\s*\([^)]*type:\s*"([^"]+)"/.exec(query)?.[1];
  if (/fileCreate\s*\(/.test(normalized)) {
    data.fileCreate = createFilesFromGraphql(variables.files || variables.file || variables.input || []);
  }
  if (/fileUpdate\s*\(/.test(normalized)) {
    data.fileUpdate = updateFilesFromGraphql(variables.files || variables.input || []);
  }
  if (/fileDelete\s*\(/.test(normalized)) {
    data.fileDelete = deleteFilesFromGraphql(variables.fileIds || variables.ids || variables.input || []);
  }
  if (/metaobjectDefinitionCreate\s*\(/.test(normalized)) {
    data.metaobjectDefinitionCreate = createMetaobjectDefinitionFromGraphql(variables.definition || variables.input || {});
  }
  if (/metaobjectCreate\s*\(/.test(normalized)) {
    data.metaobjectCreate = createMetaobjectFromGraphql(variables.metaobject || variables.input || {});
  }
  if (/metaobjectUpdate\s*\(/.test(normalized)) {
    data.metaobjectUpdate = updateMetaobjectFromGraphql(variables.id, variables.metaobject || variables.input || {});
  }
  if (/metaobjectDelete\s*\(/.test(normalized)) {
    data.metaobjectDelete = deleteMetaobjectFromGraphql(variables.id);
  }
  if (/shopPolicyUpdate\s*\(/.test(normalized)) {
    data.shopPolicyUpdate = updatePolicyFromGraphql(variables.policy || variables.shopPolicy || variables.input || {});
  }
  if (/pageCreate\s*\(/.test(normalized)) {
    data.pageCreate = createPageFromGraphql(variables.page || variables.input || {});
  }
  if (/articleCreate\s*\(/.test(normalized)) {
    data.articleCreate = createArticleFromGraphql(variables.article || variables.input || {}, variables.blog || {});
  }
  if (/blogCreate\s*\(/.test(normalized)) {
    data.blogCreate = createBlogFromGraphql(variables.blog || variables.input || {});
  }
  if (/collectionCreate\s*\(/.test(normalized)) {
    data.collectionCreate = createCollectionFromGraphql(variables.input || variables.collection || {});
  }
  if (/productCreate\s*\(/.test(normalized)) {
    data.productCreate = admin.createProductFromGraphql(variables.input || variables.product || {}, adminStore);
  }
  if (/\bproducts\s*\(/.test(normalized) && !/productCreate/.test(normalized)) {
    data.products = { edges: admin.listProductNodes(adminStore).map((node) => ({ node })) };
  }
  if (/blogUpdate\s*\(/.test(normalized)) {
    data.blogUpdate = updateBlogFromGraphql(variables.id, variables.blog || variables.input || {});
  }
  if (/blogDelete\s*\(/.test(normalized)) {
    data.blogDelete = deleteBlogFromGraphql(variables.id);
  }
  if (/menuCreate\s*\(/.test(normalized)) {
    data.menuCreate = createMenuFromGraphql(variables.menu || variables.input || variables || {});
  }
  if (/menuUpdate\s*\(/.test(normalized)) {
    data.menuUpdate = updateMenuFromGraphql(variables.id, variables.menu || variables.input || variables || {});
  }
  if (/menuDelete\s*\(/.test(normalized)) {
    data.menuDelete = deleteMenuFromGraphql(variables.id);
  }
  if (/urlRedirectCreate\s*\(/.test(normalized)) {
    data.urlRedirectCreate = createRedirectFromGraphql(variables.urlRedirect || variables.input || {});
  }
  if (/urlRedirectDelete\s*\(/.test(normalized)) {
    data.urlRedirectDelete = deleteRedirectFromGraphql(variables.id);
  }
  if (/urlRedirectImportCreate\s*\(/.test(normalized)) {
    data.urlRedirectImportCreate = createRedirectImportFromGraphql({ url: variables.url, csv: variables.csv, ...(variables.input || {}) });
  }
  if (/urlRedirectImportSubmit\s*\(/.test(normalized)) {
    data.urlRedirectImportSubmit = submitRedirectImportFromGraphql(variables.id);
  }
  if (/\bpages\s*\(/.test(normalized) || /\bpages\s*\{/.test(normalized)) {
    data.pages = connection(saved.pages.map(pageNode));
  }
  if (/\barticles\s*\(/.test(normalized) || /\barticles\s*\{/.test(normalized)) {
    data.articles = connection(saved.blogArticles.map(articleNode));
  }
  if (/\bblogs\s*\(/.test(normalized) || /\bblogs\s*\{/.test(normalized)) {
    data.blogs = connection((saved.blogs || []).map(blogNode));
  }
  if (/\bcollections\s*\(/.test(normalized) || /\bcollections\s*\{/.test(normalized)) {
    data.collections = connection((saved.collections || []).map(collectionNode));
  }
  if (/\burlRedirects\s*\(/.test(normalized) || /\burlRedirects\s*\{/.test(normalized)) {
    data.urlRedirects = connection(saved.redirects.map(redirectNode));
  }
  if (/\burlRedirectImports\s*\(/.test(normalized) || /\burlRedirectImports\s*\{/.test(normalized)) {
    data.urlRedirectImports = connection((saved.redirectImports || []).map(redirectImportNode));
  }
  if (/\bfiles\s*\(/.test(normalized) || /\bfiles\s*\{/.test(normalized)) {
    data.files = connection((saved.mediaLibrary || []).map(fileNode));
  }
  if (/\bmetaobjectDefinitions\s*\(/.test(normalized) || /\bmetaobjectDefinitions\s*\{/.test(normalized)) {
    data.metaobjectDefinitions = connection(ensureServerMetaobjectDefinitions().map(metaobjectDefinitionNode));
  }
  if (/\bmetaobjects\s*\(/.test(normalized) || /\bmetaobjects\s*\{/.test(normalized)) {
    const type = variables.type || inlineMetaobjectType || '';
    const definitions = ensureServerMetaobjectDefinitions().filter((definition) => !type || definition.handle === type || definition.id === type);
    data.metaobjects = connection(definitions.flatMap((definition) => (definition.entries || []).map((entry) => metaobjectNode(definition, entry))));
  }
  if (/\bmenus\s*\(/.test(normalized) || /\bmenus\s*\{/.test(normalized)) {
    data.menus = connection((saved.menus || []).map(menuNode));
  }
  if (/\bdomains\s*\(/.test(normalized) || /\bdomains\s*\{/.test(normalized)) {
    data.domains = connection((saved.domains || []).map(domainNode));
  }
  if (/\bshopPolicies\s*\(/.test(normalized) || /\bshopPolicies\s*\{/.test(normalized)) {
    data.shopPolicies = ensureServerPolicies().map(policyNode);
  }
  if (/shop\s*\{/.test(normalized)) {
    const primaryDomain = (saved.domains || []).find((domain) => domain.primary) || (saved.domains || [])[0];
    data.shop = {
      name: saved.storeName,
      myshopifyDomain: (saved.domains || []).find((domain) => domain.kind === 'myshopify')?.host || 'i415x6-zf.myshopify.com',
      primaryDomain: primaryDomain ? domainNode(primaryDomain) : null,
      shopPolicies: ensureServerPolicies().map(policyNode)
    };
  }
  if (!Object.keys(data).length) {
    return { errors: [{ message: 'This Shopify mock GraphQL endpoint supports fileCreate, fileUpdate, fileDelete, metaobjectDefinitionCreate, metaobjectCreate, metaobjectUpdate, metaobjectDelete, shopPolicyUpdate, pageCreate, articleCreate, blogCreate, collectionCreate, blogUpdate, blogDelete, menuCreate, menuUpdate, menuDelete, urlRedirectCreate, urlRedirectDelete, urlRedirectImportCreate, urlRedirectImportSubmit, files, metaobjectDefinitions, metaobjects, pages, blogs, articles, collections, menus, urlRedirects, urlRedirectImports, shopPolicies, domains, and shop.' }] };
  }
  return { data };
}

// State API handed to the admin back-office layer (lib/admin). Getters keep it
// pointed at the live module bindings even after /api/reset reassigns them.
const adminStore = {
  get saved() { return saved; },
  get draft() { return draft; },
  get events() { return events; },
  clone, now, numericId, gid, slugify, moneyCents,
  pushEvent, appendSharedStateList, commitAdminMutation, isDirty,
  verifierToken: process.env.MOCK_VERIFIER_TOKEN || 'bench-verifier',
};

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'shopify_online_store_v2', dirty: isDirty(), mode: toolModeEnabled() ? 'tool' : 'ui' });
  }
  // Admin back-office API (/api/admin/*). Returns true once it has responded.
  if (await admin.handle(req, res, url, adminStore, { readBody, sendJson })) return;
  // Verifier-facing canonical state snapshot (token-gated, CCB convention).
  if (req.method === 'GET' && url.pathname === '/__bench/state') {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!auth) return sendJson(res, 401, { ok: false, error: 'Missing Authorization header' });
    if (token !== adminStore.verifierToken) return sendJson(res, 403, { ok: false, error: 'Invalid verifier token' });
    return sendJson(res, 200, { ok: true, dirty: isDirty(), state: admin.benchState(adminStore), events });
  }
  if (req.method === 'POST' && /^\/admin\/api\/[^/]+\/graphql\.json$/.test(url.pathname)) {
    const body = await readBody(req);
    const result = handleGraphqlQuery(body.query || '', body.variables || {});
    return sendJson(res, result.errors ? 400 : 200, result);
  }
  if (req.method === 'POST' && (url.pathname === '/api/ucp/mcp' || url.pathname === '/api/mcp')) {
    if (!toolModeEnabled()) {
      pushEvent('mcp_blocked', { method: req.method, path: req.url });
      return denyInternalApi(res, 'mcp_disabled', 'MCP surface is disabled for this Shopify UI task.');
    }
    const body = await readBody(req);
    return sendJson(res, 200, handleMcpRequest(body));
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    if (!requireBrowserStateAccess(req, res)) return;
    if (isVerifierRequest(req)) {
      return sendJson(res, 200, {
        ok: true,
        dirty: isDirty(),
        saved: verifierStateSnapshot(saved),
        draft: verifierStateSnapshot(draft),
        events: verifierStateSnapshot(events),
        uiToken: null
      });
    }
    return sendJson(res, 200, { ok: true, dirty: isDirty(), saved, draft, events, uiToken: toolModeEnabled() ? null : UI_TOKEN });
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    return sendJson(res, 200, events);
  }
  const ajaxCartAction = cartAjaxAction(url.pathname);
  if (ajaxCartAction) {
    if (ajaxCartAction === 'get') {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return sendJson(res, 200, cartPayload());
    }
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    const body = await readBody(req);
    if (ajaxCartAction === 'add') {
      const items = Array.isArray(body.items) && body.items.length ? body.items : [{ id: body.id || body.productId, quantity: body.quantity || 1 }];
      const added = [];
      for (const item of items) {
        const product = productByCartId(item.id || item.productId);
        if (!product) return cartError(res, 'Cannot find variant.');
        const line = upsertSharedCartItem(product.id, item.quantity || 1);
        added.push(cartLinePayload(line));
      }
      pushEvent('storefront_cart_ajax_add', { dirty: isDirty(), itemCount: cartPayload().item_count, items: added.map((item) => item.key) });
      return sendJson(res, 200, { items: added });
    }
    if (ajaxCartAction === 'change') {
      let line = cartLineByReference(body.id);
      if (!line && body.line) line = (saved.cartItems || [])[Number(body.line) - 1] || null;
      if (!line) return cartError(res, 'Cannot find line item.');
      const quantity = normalizeCartLineQuantity(body.quantity);
      setSharedCartItemQuantity(line.productId, quantity);
      pushEvent('storefront_cart_ajax_change', { dirty: isDirty(), productId: line.productId, quantity, itemCount: cartPayload().item_count });
      return sendJson(res, 200, cartPayload());
    }
    if (ajaxCartAction === 'update') {
      const updates = body.updates || {};
      for (const [reference, quantity] of Object.entries(body)) {
        const bracket = /^updates\[(.+)\]$/.exec(reference);
        if (bracket) updates[bracket[1]] = quantity;
      }
      for (const [reference, quantity] of Object.entries(updates)) {
        const line = cartLineByReference(reference) || (saved.cartItems || [])[Number(reference) - 1] || null;
        if (line) setSharedCartItemQuantity(line.productId, quantity);
      }
      pushEvent('storefront_cart_ajax_update', { dirty: isDirty(), itemCount: cartPayload().item_count });
      return sendJson(res, 200, cartPayload());
    }
    if (ajaxCartAction === 'clear') {
      clearSharedCartItems();
      pushEvent('storefront_cart_ajax_clear', { dirty: isDirty(), itemCount: 0 });
      return sendJson(res, 200, cartPayload());
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/storefront/contact') {
    const body = await readBody(req);
    const email = String(body.email || '').trim();
    const message = String(body.message || '').trim();
    const errors = [];
    if (!email || !validEmail(email)) errors.push({ field: 'email', message: '请输入有效的电子邮件地址。' });
    if (!message) errors.push({ field: 'message', message: '请输入评论。' });
    if (errors.length) return sendJson(res, 400, { ok: false, errors });
    const submission = {
      id: `contact-${Date.now()}`,
      name: String(body.name || '').trim(),
      email,
      phone: String(body.phone || '').trim(),
      message,
      sourcePath: String(body.sourcePath || ''),
      preview: Boolean(body.preview),
      createdAt: now()
    };
    appendSharedStateList('storefrontSubmissions', submission);
    pushEvent('storefront_contact_submitted', { dirty: isDirty(), email, sourcePath: submission.sourcePath });
    return sendJson(res, 200, { ok: true, submission });
  }
  if (req.method === 'POST' && url.pathname === '/api/storefront/newsletter') {
    const body = await readBody(req);
    const email = String(body.email || '').trim();
    if (!email || !validEmail(email)) {
      return sendJson(res, 400, { ok: false, errors: [{ field: 'email', message: '请输入有效的电子邮件地址。' }] });
    }
    const subscriber = {
      id: `newsletter-${Date.now()}`,
      email,
      sourcePath: String(body.sourcePath || ''),
      preview: Boolean(body.preview),
      createdAt: now()
    };
    const existing = (saved.newsletterSubscribers || []).find((item) => item.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      pushEvent('storefront_newsletter_duplicate', { dirty: isDirty(), email, sourcePath: subscriber.sourcePath });
      return sendJson(res, 200, { ok: true, duplicate: true, subscriber: existing });
    }
    appendSharedStateList('newsletterSubscribers', subscriber);
    pushEvent('storefront_newsletter_subscribed', { dirty: isDirty(), email, sourcePath: subscriber.sourcePath });
    return sendJson(res, 200, { ok: true, subscriber });
  }
  if (req.method === 'POST' && url.pathname === '/api/storefront/cart/add') {
    const body = await readBody(req);
    const productId = String(body.productId || '').trim();
    const product = productById(productId);
    if (!product) {
      return sendJson(res, 404, { ok: false, errors: [{ field: 'productId', message: '找不到此产品。' }] });
    }
    const quantity = normalizeCartQuantity(body.quantity);
    const line = upsertSharedCartItem(productId, quantity);
    pushEvent('storefront_cart_add', {
      dirty: isDirty(),
      productId,
      quantity,
      totalQuantity: line.quantity,
      sourcePath: String(body.sourcePath || ''),
      preview: Boolean(body.preview)
    });
    return sendJson(res, 200, { ok: true, line, cartItems: saved.cartItems });
  }
  if (req.method === 'POST' && url.pathname === '/api/draft') {
    if (!requireUiWrite(req, res)) return;
    const body = await readBody(req);
    if (!body || !body.draft || !Array.isArray(body.draft.sections)) {
      return sendJson(res, 400, { ok: false, error: 'draft.sections is required' });
    }
    draft = clone(body.draft);
    const reason = body.reason || 'ui_change';
    pushEvent('draft_updated', { dirty: isDirty(), reason });
    if (/^(theme_|app_|media_|page_|menu_|preferences_|policies_|blog_|redirect_|market_)/.test(reason)) {
      pushEvent(reason, { dirty: isDirty() });
    }
    return sendJson(res, 200, { ok: true, dirty: isDirty(), draft });
  }
  if (req.method === 'POST' && url.pathname === '/api/save') {
    if (!requireUiWrite(req, res)) return;
    saved = clone(draft);
    pushEvent('ui_save_valid', {
      dirty: false,
      sectionOrder: saved.sections.map((s) => s.id),
      collectionSectionOrder: saved.collectionTemplate?.sections?.map((s) => s.id) || [],
      selectedScheme: saved.themeSettings?.selectedScheme,
      enabledAppEmbeds: (saved.appEmbeds?.recommendations || []).filter((app) => app.enabled).map((app) => app.id),
      themeFileCount: saved.themeFiles?.length || 0,
      themeDownloadCount: saved.themeDownloads?.length || 0,
      themePublicationCount: saved.themePublications?.length || 0,
      previewPath: saved.previewPath,
      marketContext: saved.marketContext || 'default',
      templateSectionOrder: Object.fromEntries(Object.entries(saved.themeTemplates || {}).map(([key, template]) => [key, (template.sections || []).map((section) => section.id)]))
    });
    return sendJson(res, 200, { ok: true, dirty: false, saved, draft });
  }
  if (req.method === 'POST' && url.pathname === '/api/discard') {
    if (!requireUiWrite(req, res)) return;
    draft = clone(saved);
    pushEvent('discarded_changes', { dirty: false });
    return sendJson(res, 200, { ok: true, dirty: false, draft });
  }
  if (req.method === 'POST' && url.pathname === '/api/reset') {
    if (!requireUiWrite(req, res)) return;
    saved = initialThemeState();
    admin.seedAll(saved);
    draft = clone(saved);
    events = [];
    resetMediaBlobs();
    pushEvent('reset', { dirty: false });
    return sendJson(res, 200, { ok: true, dirty: false, saved, draft });
  }
  // POST /api/media — accepts JSON {filename, contentType, dataBase64}, stores the bytes in
  // `mediaBlobs`, and returns {ok, id, url, contentType, filename, bytes}. The client puts the
  // returned url in section/block settings.image (etc.) instead of inlining a dataURL. See the
  // mediaBlobs comment near its declaration for context.
  if (req.method === 'POST' && url.pathname === '/api/media') {
    if (!requireUiWrite(req, res)) return;
    const body = await readBody(req);
    if (!body || typeof body.dataBase64 !== 'string') {
      return sendJson(res, 400, { ok: false, error: 'dataBase64 is required' });
    }
    let bytes;
    try {
      bytes = Buffer.from(body.dataBase64, 'base64');
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: 'invalid base64' });
    }
    const contentType = String(body.contentType || 'application/octet-stream');
    const filename = String(body.filename || `upload-${Date.now()}`);
    const id = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    mediaBlobs.set(id, { bytes, contentType, filename });
    pushEvent('media_uploaded', { id, contentType, bytes: bytes.length, filename });
    return sendJson(res, 200, { ok: true, id, url: `/media/${id}`, contentType, filename, bytes: bytes.length });
  }
  // GET /media/:id — serves the stored blob with correct Content-Type. Long Cache-Control because
  // the id is unique per upload (immutable). 404 with JSON when the id isn't known (e.g. server
  // restart cleared the in-memory map and a stale URL is still in state).
  if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
    const id = url.pathname.slice('/media/'.length);
    const blob = mediaBlobs.get(id);
    if (!blob) return sendJson(res, 404, { ok: false, error: 'media not found', id });
    res.writeHead(200, {
      'Content-Type': blob.contentType,
      'Content-Length': blob.bytes.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Mock-Filename': blob.filename,
    });
    return res.end(blob.bytes);
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (!toolModeEnabled() && !isVerifierRequest(req)) {
      const p = url.pathname;
      const internalApi = p === '/api/state'
        || p === '/api/draft'
        || p === '/api/save'
        || p === '/api/discard'
        || p === '/api/reset'
        || p === '/api/media'
        || p === '/api/mcp'
        || p === '/api/ucp/mcp';
      const isAsset = req.method === 'GET' && /\.(js|css|map|png|jpe?g|svg|ico|gif|woff2?|ttf)$/i.test(p);
      const isDoc = req.method === 'GET'
        && p !== '/health'
        && !p.startsWith('/api/')
        && !p.startsWith('/__bench/')
        && !p.startsWith('/media/')
        && !isAsset;
      if (internalApi || isDoc || isAsset) {
        const reason = classifyBrowserClient(req, { requireDocument: isDoc });
        if (reason) return denyNonBrowser(req, res, reason);
      }
      if (isDoc) mintBrowserNonce(req, res);
    }

    const apiHandled = await handleApi(req, res, url);
    if (apiHandled !== false) return;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    }

    const redirect = matchingSavedRedirect(url.pathname);
    if (redirect) {
      const location = storefrontRedirectLocation(redirect.to || redirect.target || '/', url);
      pushEvent('storefront_redirect_hit', { from: url.pathname, to: location });
      return sendRedirect(res, location);
    }

    // 1:1 real-DOM admin snapshots take priority for captured admin routes
    // (home + back-office sections). Theme/content/storefront routes are
    // excluded above and fall through to the interactive app below.
    const snapFile = adminSnapshotFile(url.pathname);
    if (snapFile) return sendSnapshot(res, snapFile, url.pathname);

    if (url.pathname === '/' || /^\/store\/[^/]+\/?$/.test(url.pathname) || url.pathname === '/online-store/customize' || url.pathname === '/themes/customize') {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/themes$/.test(url.pathname) || url.pathname === '/themes') {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/pages(\/new|\/[^/]+)?$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/online_store\/preferences$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/settings\/(policies|legal)$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/settings\/domains$/.test(url.pathname) || /^\/store\/[^/]+\/online_store\/domains$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/content\/menus(\/new|\/[^/]+)?$/.test(url.pathname) || /^\/store\/[^/]+\/online_store\/menus(\/new|\/[^/]+)?$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/content\/metaobjects(\/new|\/[^/]+(\/new|\/[^/]+)?)?$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/content\/files$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/content\/articles(\/new|\/[^/]+)?$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/online_store\/blog_posts(\/new|\/[^/]+)?$/.test(url.pathname) || /^\/store\/[^/]+\/online_store\/blogs(\/new|\/[^/]+)?$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/content\/redirects(\/new)?$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/themes\/[^/]+\/editor$/.test(url.pathname) || /^\/themes\/[^/]+\/editor$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/store\/[^/]+\/themes\/[^/]+\/(code|default-content)$/.test(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (url.pathname === '/storefront' || url.pathname === '/storefront/preview') {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (/^\/pages\/[^/]+$/.test(url.pathname) || /^\/policies\/[^/]+$/.test(url.pathname) || url.pathname === '/collections' || /^\/collections\/[^/]+$/.test(url.pathname) || /^\/products\/[^/]+$/.test(url.pathname) || /^\/gift_cards\/[^/]+$/.test(url.pathname) || /^\/metaobjects\/[^/]+\/[^/]+$/.test(url.pathname) || /^\/blogs\/[^/]+(\/[^/]+)?$/.test(url.pathname) || ['/search', '/cart', '/checkout', '/password', '/404'].includes(url.pathname)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    // Embedded 在线商店 inner pages (主题/偏好设置 — the cross-origin online-store-web
    // app rebuilt locally and loaded by the outer shell's iframe). Inject the L2
    // runtime + online_store adapter so the captured (inert) Polaris toggles/inputs
    // become operable against /api/admin/online_store/*. Served same-origin → the
    // iframe loads with no CORS; injection is additive (static 1:1 page if missing).
    if (/^\/_embedded\/[a-z0-9_]+\.html$/i.test(url.pathname)) {
      const embRel = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      const embPath = path.join(PUBLIC_DIR, embRel);
      if (embPath.startsWith(path.join(PUBLIC_DIR, '_embedded')) && fs.existsSync(embPath)) {
        let html = fs.readFileSync(embPath, 'utf8');
        let tags = '';
        if (fs.existsSync(path.join(INJECT_DIR, 'runtime.js'))) tags += '<script src="/_inject/runtime.js" defer></script>';
        if (fs.existsSync(path.join(INJECT_DIR, 'online_store.js'))) tags += '<script src="/_inject/online_store.js" defer></script>';
        if (tags) { const idx = html.toLowerCase().lastIndexOf('</body>'); html = idx === -1 ? html + tags : html.slice(0, idx) + tags + html.slice(idx); }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
    }

    const normalized = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, normalized);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return sendJson(res, 403, { ok: false, error: 'Forbidden' });
    }
    return sendFile(res, filePath);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

const LISTEN_HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, LISTEN_HOST, () => {
  console.log(`shopify_online_store_v2 mock listening on http://${LISTEN_HOST}:${PORT}/online-store/customize`);
});
