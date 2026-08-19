// Storefront drops — values exposed inside Liquid templates.
//
// Real Shopify exposes ~100 drops; we expose the practical subset used by Dawn
// and most third-party themes:
//   shop, settings, request, routes, template, page_title, page_description,
//   linklists, content_for_header, current_tags, current_page,
//   product, collection, page, cart, customer, blogs, articles, all_products,
//   collections, products, recommendations, search, predictive_search,
//   localization, paginate
//
// Each drop reads from the backend `state.draft` snapshot passed in at request
// time. Drops are plain objects (no Drop class needed for liquidjs) — we
// shape them to match Shopify's documented field surface as closely as the
// underlying state allows.
//
// IDs in the backend state come in two flavors:
//   * numeric strings ("product-red", "1001", "159103910101")
//   * gid strings ("gid://shopify/Product/1234")
// We surface stable .id (numeric where available) and .handle.

const { handleize, parseNumber } = require('./filters');

function productHandle(p) {
  if (!p) return '';
  return p.handle || handleize(p.title || p.id || 'product');
}
function collectionHandle(c) {
  if (!c) return '';
  return c.handle || handleize(c.title || c.id || 'collection');
}

function productImage(p) {
  if (!p) return null;
  return {
    src: p.image || (p.images && p.images[0]) || '',
    alt: p.imageAlt || p.title || '',
    width: 800,
    height: 800,
  };
}

function buildProductDrop(p, { allProducts } = {}) {
  if (!p) return null;
  const handle = productHandle(p);
  const priceCents = Math.round(parseNumber(p.price) * 100);
  const variants = Array.isArray(p.variants) && p.variants.length
    ? p.variants.map((v, i) => ({
        id: v.id || `${p.id}-v${i + 1}`,
        title: v.title || (v.option1 || `Default ${i + 1}`),
        price: Math.round(parseNumber(v.price ?? p.price) * 100),
        compare_at_price: v.compareAtPrice ? Math.round(parseNumber(v.compareAtPrice) * 100) : null,
        available: v.available !== false,
        sku: v.sku || p.sku || '',
        inventory_quantity: v.inventoryQuantity != null ? v.inventoryQuantity : 10,
        option1: v.option1 || null,
        option2: v.option2 || null,
        option3: v.option3 || null,
        featured_image: v.image ? { src: v.image, alt: v.title || '' } : null,
      }))
    : [{
        id: `${p.id}-default`,
        title: 'Default Title',
        price: priceCents,
        compare_at_price: null,
        available: true,
        sku: p.sku || '',
        inventory_quantity: 10,
        option1: 'Default',
        option2: null,
        option3: null,
        featured_image: null,
      }];
  const tags = Array.isArray(p.tags) ? p.tags : (p.tags ? String(p.tags).split(',').map(s => s.trim()) : []);
  const collectionsFor = (allProducts && allProducts.collections) || [];
  return {
    id: p.id,
    handle,
    title: p.title || '',
    vendor: p.vendor || 'Mock Vendor',
    type: p.type || p.productType || '',
    description: p.description || p.descriptionHtml || '',
    description_html: p.descriptionHtml || p.description || '',
    content: p.descriptionHtml || p.description || '',
    price: priceCents,
    price_min: priceCents,
    price_max: variants.reduce((m, v) => Math.max(m, v.price || 0), priceCents),
    compare_at_price: null,
    compare_at_price_min: 0,
    compare_at_price_max: 0,
    available: variants.some((v) => v.available),
    tags,
    options: Array.isArray(p.options) ? p.options.map((o) => o.name || o) : ['Title'],
    options_with_values: Array.isArray(p.options) ? p.options.map((o) => ({ name: o.name, values: o.values || [] })) : [{ name: 'Title', values: ['Default'] }],
    variants,
    selected_or_first_available_variant: variants[0],
    first_available_variant: variants[0],
    featured_image: productImage(p),
    featured_media: productImage(p),
    images: p.images ? p.images.map((src) => ({ src, alt: p.title })) : [productImage(p)].filter(Boolean),
    media: p.images ? p.images.map((src, i) => ({ id: `m-${i}`, src, alt: p.title, media_type: 'image', preview_image: { src } })) : [productImage(p)].filter(Boolean),
    url: `/products/${handle}`,
    collections: collectionsFor,
    metafields: {},
    requires_selling_plan: false,
    has_only_default_variant: variants.length === 1,
    sku: p.sku || '',
    published_at: p.publishedAt || new Date().toISOString(),
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: p.updatedAt || new Date().toISOString(),
  };
}

function buildCollectionDrop(c, allProducts) {
  if (!c) return null;
  const handle = collectionHandle(c);
  const products = (c.productIds || [])
    .map((pid) => allProducts.find((p) => String(p.id) === String(pid)))
    .filter(Boolean)
    .map((p) => buildProductDrop(p));
  return {
    id: c.numericId || c.id,
    handle,
    title: c.title || '',
    description: c.descriptionHtml || c.description || '',
    description_html: c.descriptionHtml || c.description || '',
    products,
    products_count: products.length,
    all_products_count: products.length,
    all_tags: [...new Set(products.flatMap((p) => p.tags || []))],
    all_types: [...new Set(products.map((p) => p.type).filter(Boolean))],
    all_vendors: [...new Set(products.map((p) => p.vendor).filter(Boolean))],
    url: `/collections/${handle}`,
    image: c.image ? { src: c.image, alt: c.title } : null,
    featured_image: c.image ? { src: c.image, alt: c.title } : null,
    default_sort_by: c.defaultSortBy || 'manual',
    sort_options: [
      { name: 'Featured', value: 'manual' },
      { name: 'Best selling', value: 'best-selling' },
      { name: 'Alphabetically, A-Z', value: 'title-ascending' },
      { name: 'Price, low to high', value: 'price-ascending' },
      { name: 'Price, high to low', value: 'price-descending' },
    ],
    next_product: null,
    previous_product: null,
    published_at: c.publishedAt || new Date().toISOString(),
  };
}

function buildPageDrop(p) {
  if (!p) return null;
  return {
    id: p.id,
    handle: p.handle || handleize(p.title || ''),
    title: p.title || '',
    content: p.bodyHtml || p.body || p.content || '',
    body: p.bodyHtml || p.body || p.content || '',
    author: p.author || '',
    published_at: p.publishedAt || new Date().toISOString(),
    template_suffix: p.templateSuffix || '',
    url: `/pages/${p.handle || handleize(p.title || '')}`,
  };
}

function buildShopDrop(state) {
  const theme = state.themes && state.themes.find((t) => t.role === 'current') || (state.themes && state.themes[0]) || {};
  const productsCount = (state.products || []).length;
  return {
    id: 1,
    name: state.storeName || 'Mock Store',
    description: state.themeSettings?.brandInformation?.shortDescription || 'A mock storefront.',
    domain: state.shopDomain || 'rrb-mock.myshopify.com',
    permanent_domain: state.shopDomain || 'rrb-mock.myshopify.com',
    email: state.shopEmail || 'owner@rrb-mock.example',
    url: '',
    secure_url: '',
    currency: state.currency || 'USD',
    money_format: '${{amount}}',
    money_with_currency_format: '${{amount}} USD',
    enabled_payment_types: ['visa', 'master', 'american_express'],
    enabled_currencies: [{ iso_code: state.currency || 'USD', name: 'United States dollar', symbol: '$' }],
    locale: state.locale || 'en',
    published_locales: ['en', 'zh-CN'],
    types: [...new Set((state.products || []).map((p) => p.type).filter(Boolean))],
    vendors: [...new Set((state.products || []).map((p) => p.vendor).filter(Boolean))],
    products_count: productsCount,
    collections_count: (state.collections || []).length,
    customer_accounts_enabled: false,
    metafields: {},
    theme_id: theme.id,
    accepts_gift_cards: false,
    password_message: '',
    privacy_policy: { body: '', title: 'Privacy Policy', url: '/policies/privacy-policy' },
    refund_policy: { body: '', title: 'Refund Policy', url: '/policies/refund-policy' },
    shipping_policy: { body: '', title: 'Shipping Policy', url: '/policies/shipping-policy' },
    terms_of_service: { body: '', title: 'Terms of Service', url: '/policies/terms-of-service' },
  };
}

function buildSettingsDrop(themeSettings, settingsData) {
  // Real theme settings come from `config/settings_data.json` (current values)
  // overlaid on `config/settings_schema.json` defaults. We pass through the
  // computed values directly so `{{ settings.X }}` works.
  if (settingsData && settingsData.current && typeof settingsData.current === 'object') {
    return settingsData.current;
  }
  return themeSettings || {};
}

function buildLinklistsDrop(menus) {
  const map = {};
  // Backend menus use `label`/`link` on items; Shopify Liquid expects
  // `title`/`url`. Map both shapes so themes work either way.
  for (const menu of menus || []) {
    const handle = menu.handle || handleize(menu.title || '');
    if (!handle) continue;
    map[handle] = {
      handle,
      title: menu.title || handle,
      levels: menu.levels || 1,
      links: (menu.items || []).map((item) => ({
        title: item.title || item.label || '',
        url: item.url || item.link || '/',
        active: false,
        type: item.type || 'http',
        object: null,
        levels: 0,
        links: [],
        child_active: false,
      })),
    };
  }
  // Ensure baseline menus exist so Dawn-style themes don't crash.
  if (!map['main-menu']) {
    map['main-menu'] = {
      handle: 'main-menu',
      title: 'Main menu',
      levels: 1,
      links: [
        { title: '主页', url: '/', active: false, type: 'http', object: null, levels: 0, links: [], child_active: false },
        { title: '所有产品', url: '/collections/all', active: false, type: 'http', object: null, levels: 0, links: [], child_active: false },
      ],
    };
  }
  if (!map['footer']) {
    map['footer'] = { handle: 'footer', title: 'Footer', levels: 1, links: [] };
  }
  return map;
}

function buildRoutesDrop() {
  return {
    root_url: '/',
    account_url: '/account',
    account_login_url: '/account/login',
    account_logout_url: '/account/logout',
    account_register_url: '/account/register',
    account_recover_url: '/account/recover',
    account_addresses_url: '/account/addresses',
    cart_url: '/cart',
    cart_add_url: '/cart/add',
    cart_change_url: '/cart/change',
    cart_clear_url: '/cart/clear',
    cart_update_url: '/cart/update',
    collections_url: '/collections',
    all_products_collection_url: '/collections/all',
    search_url: '/search',
    predictive_search_url: '/search/suggest',
    product_recommendations_url: '/recommendations/products',
    storefront_login_url: '/account/login',
  };
}

function buildCartDrop(state) {
  const items = (state.cartItems || []).map((it, i) => {
    const product = (state.products || []).find((p) => String(p.id) === String(it.productId));
    const priceCents = product ? Math.round(parseNumber(product.price) * 100) : 0;
    return {
      id: it.id || `cart-${i}`,
      product_id: product?.id,
      variant_id: it.variantId || `${product?.id}-default`,
      key: `${product?.id}:default`,
      quantity: it.quantity || 1,
      title: product?.title || 'Item',
      product_title: product?.title || 'Item',
      variant_title: it.variantTitle || 'Default',
      vendor: product?.vendor || '',
      sku: product?.sku || '',
      url: product ? `/products/${productHandle(product)}` : '/cart',
      image: product ? productImage(product) : null,
      price: priceCents,
      line_price: priceCents * (it.quantity || 1),
      original_price: priceCents,
      final_price: priceCents,
      final_line_price: priceCents * (it.quantity || 1),
      properties: {},
      gift_card: false,
      taxable: true,
      requires_shipping: true,
      grams: 100,
    };
  });
  const totalPrice = items.reduce((s, i) => s + i.final_line_price, 0);
  return {
    token: 'cart-mock-token',
    note: '',
    attributes: {},
    items,
    item_count: items.reduce((s, i) => s + i.quantity, 0),
    items_count: items.length,
    items_subtotal_price: totalPrice,
    original_total_price: totalPrice,
    total_discount: 0,
    total_price: totalPrice,
    total_weight: items.reduce((s, i) => s + i.grams * i.quantity, 0),
    cart_level_discount_applications: [],
    discount_applications: [],
    requires_shipping: true,
    currency: state.currency || 'USD',
    empty: items.length === 0,
  };
}

function buildRequestDrop(url, theme) {
  return {
    host: url.host,
    origin: url.origin,
    path: url.pathname,
    page_type: theme.pageType || 'index',
    locale: { iso_code: 'en' },
    design_mode: false,
    visual_preview_mode: false,
  };
}

function buildAllProducts(state) {
  return (state.products || []).map((p) => buildProductDrop(p));
}
function buildAllCollections(state) {
  return (state.collections || []).map((c) => buildCollectionDrop(c, state.products || []));
}

function buildContextFor({ route, state, settingsData, url }) {
  const allCollections = buildAllCollections(state);
  const allProducts = buildAllProducts(state);
  const allProductsByHandle = {};
  for (const p of allProducts) allProductsByHandle[p.handle] = p;

  let product = null;
  let collection = null;
  let page = null;
  let pageTitle = state.storeName || 'Shopify Mock';
  let pageDescription = state.themeSettings?.brandInformation?.shortDescription || '';
  let templateName = 'index';

  if (route.type === 'product') {
    product = allProductsByHandle[route.handle];
    if (!product) {
      // Try by id (numeric).
      product = allProducts.find((p) => String(p.id) === route.handle);
    }
    if (product) {
      pageTitle = product.title;
      pageDescription = (product.description || '').slice(0, 160);
      templateName = 'product';
    } else {
      templateName = '404';
    }
  } else if (route.type === 'collection') {
    collection = allCollections.find((c) => c.handle === route.handle);
    if (collection) {
      pageTitle = collection.title;
      pageDescription = (collection.description || '').slice(0, 160);
      templateName = 'collection';
    } else {
      templateName = '404';
    }
  } else if (route.type === 'page') {
    page = (state.pages || []).map(buildPageDrop).find((p) => p && p.handle === route.handle) || null;
    if (page) {
      pageTitle = page.title;
      templateName = 'page';
    } else {
      templateName = '404';
    }
  } else if (route.type === 'cart') {
    pageTitle = '购物车';
    templateName = 'cart';
  } else if (route.type === 'search') {
    pageTitle = '搜索';
    templateName = 'search';
  } else if (route.type === '404') {
    templateName = '404';
    pageTitle = 'Not Found';
  }

  const ctx = {
    shop: buildShopDrop(state),
    settings: buildSettingsDrop(state.themeSettings, settingsData),
    request: buildRequestDrop(url, { pageType: templateName }),
    routes: buildRoutesDrop(),
    template: templateName,
    page_title: pageTitle,
    page_description: pageDescription,
    cart: buildCartDrop(state),
    customer: null,
    linklists: buildLinklistsDrop(state.menus || []),
    all_products: allProductsByHandle,
    collections: Object.fromEntries(allCollections.map((c) => [c.handle, c])),
    products: allProducts,
    powered_by_link: '<a href="https://www.shopify.com">Shopify</a>',
    canonical_url: `${url.origin}${url.pathname}`,
    current_page: 1,
    current_tags: [],
    paginate: null,
    section: null,
    block: null,
    forloop: null,
    handle: route.handle || '',
    product,
    collection,
    page,
    article: null,
    blog: null,
    blogs: {},
    search: route.type === 'search' ? { performed: !!route.query, terms: route.query || '', results: [], results_count: 0 } : null,
    recommendations: { performed: false, products: [], products_count: 0 },
    localization: { language: { iso_code: 'en', endonym_name: 'English' }, country: { iso_code: 'US', name: 'United States', currency: { iso_code: 'USD' } } },
    content_for_header: '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    template_name: templateName,
  };
  return { ctx, templateName };
}

module.exports = {
  buildContextFor,
  buildShopDrop,
  buildProductDrop,
  buildCollectionDrop,
  buildPageDrop,
  buildCartDrop,
  buildSettingsDrop,
  buildLinklistsDrop,
  buildRoutesDrop,
  buildRequestDrop,
  productHandle,
  collectionHandle,
};
