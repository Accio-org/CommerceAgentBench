'use strict';

// Products admin domain — list / create / get / update.
// Records are stored in `saved.products` (the SAME list the storefront,
// catalog GraphQL, and MCP shim read), so a product created in the admin is
// immediately visible everywhere. Each record is a SUPERSET: it carries the
// fields the storefront consumers need (id/title/price/image/vendor) plus the
// full admin field set captured from /products/new (ax=1519).

const V = require('../validation');

const CURRENCY = 'USD';

function priceDisplay(cents) {
  if (cents === null || cents === undefined) return '';
  return `$${(cents / 100).toFixed(2)} ${CURRENCY}`;
}

// Public, serializable view of an admin product (for list / detail / state).
function productView(p) {
  return {
    id: p.id,
    handle: p.handle || p.id,
    title: p.title,
    status: p.status || 'active',
    vendor: p.vendor || '',
    productType: p.productType || '',
    category: p.category || '',
    tags: p.tags || [],
    collectionIds: p.collectionIds || [],
    priceAmount: p.priceAmount ?? null,
    price: p.price || '',
    compareAtPriceAmount: p.compareAtPriceAmount ?? null,
    costAmount: p.costAmount ?? null,
    chargeTax: Boolean(p.chargeTax),
    sku: p.sku || '',
    barcode: p.barcode || '',
    trackQuantity: Boolean(p.trackQuantity),
    inventoryQuantity: p.inventoryQuantity ?? 0,
    weight: p.weight ?? null,
    weightUnit: p.weightUnit || 'kg',
    countryOfOrigin: p.countryOfOrigin || '',
    seoTitle: p.seoTitle || '',
    seoDescription: p.seoDescription || '',
    image: p.image || '',
    media: p.media || [],
    salesChannels: p.salesChannels || [],
    description: p.description || '',
    // 多属性 (variants): options = [{name, values[]}]; variants = one row per combination.
    options: (p.options || []).map((o) => ({ name: o.name, values: (o.values || []).slice() })),
    variants: (p.variants || []).map((v) => ({
      title: v.title || '',
      optionValues: (v.optionValues || []).slice(),
      priceAmount: v.priceAmount ?? null,
      price: v.price || priceDisplay(v.priceAmount),
      sku: v.sku || '',
      inventoryQuantity: v.inventoryQuantity ?? 0,
    })),
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,
  };
}

// Build + validate 多属性 options/variants from a create/update body. Options are free-text
// (name + >=1 value, max 3 options); each variant carries its own price/qty/SKU (price defaults to
// the product price). Server-side validation rejects empty option names / valueless options / bad
// numbers with 400 (CCB rule #10 — the write endpoint is the source of truth).
function buildOptionsVariants(body, base, productPriceCents) {
  let options = base ? (base.options || []) : [];
  if (body.options !== undefined) {
    if (!Array.isArray(body.options)) throw new V.ValidationError('options must be an array.', 'options');
    options = body.options.map((o) => {
      const name = o && o.name !== undefined ? String(o.name).trim() : '';
      if (!name) throw new V.ValidationError('option name is required.', 'options');
      const values = (Array.isArray(o && o.values) ? o.values : []).map((x) => String(x).trim()).filter(Boolean);
      if (!values.length) throw new V.ValidationError(`option "${name}" needs at least one value.`, 'options');
      return { name, values };
    });
    if (options.length > 3) throw new V.ValidationError('a product can have at most 3 options.', 'options');
  }
  let variants = base ? (base.variants || []) : [];
  if (body.variants !== undefined) {
    if (!Array.isArray(body.variants)) throw new V.ValidationError('variants must be an array.', 'variants');
    variants = body.variants.map((v, i) => {
      const vc = V.assertMoney(v && v.price, `variants[${i}].price`);
      const vq = V.assertInt(v && v.quantity, `variants[${i}].quantity`, { min: 0 });
      const optionValues = Array.isArray(v && v.optionValues) ? v.optionValues.map(String)
        : (v && v.optionValues && typeof v.optionValues === 'object' ? Object.values(v.optionValues).map(String) : []);
      const title = v && v.title !== undefined && String(v.title).trim() ? String(v.title).trim() : optionValues.join(' / ');
      const priceAmount = vc !== null ? vc : (productPriceCents ?? 0);
      return { title, optionValues, priceAmount, price: priceDisplay(priceAmount), sku: v && v.sku !== undefined ? String(v.sku) : '', inventoryQuantity: vq !== null ? vq : 0 };
    });
  }
  return { options, variants };
}

// Build a validated product record from a create/update body.
function buildProduct(body, store, existing) {
  V.assertRequired(body.title, 'title');
  V.assertEnum('product_status', body.status, 'status');
  V.assertEnum('weight_unit', body.weightUnit, 'weightUnit');

  const priceCents = V.assertMoney(body.price, 'price', { required: !existing });
  const compareCents = V.assertMoney(body.compareAtPrice, 'compareAtPrice');
  const costCents = V.assertMoney(body.costPerItem, 'costPerItem');
  const qty = V.assertInt(body.quantity, 'quantity', { min: 0 });

  const base = existing || {};
  const title = body.title !== undefined ? String(body.title).trim() : base.title;
  const handle = (body.urlHandle && String(body.urlHandle).trim())
    || base.handle
    || store.slugify(title, `product-${store.numericId('')}`);
  const id = base.id || handle;

  const toArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

  const resolvedPriceCents = priceCents !== null ? priceCents : (base.priceAmount ?? 0);
  const { options, variants } = buildOptionsVariants(body, base, resolvedPriceCents);

  return {
    ...base,
    id,
    handle,
    title,
    options,
    variants,
    status: body.status || base.status || 'active',
    description: body.description !== undefined ? String(body.description) : (base.description || ''),
    vendor: body.vendor !== undefined ? String(body.vendor) : (base.vendor || ''),
    productType: body.productType !== undefined ? String(body.productType) : (base.productType || ''),
    category: body.category !== undefined ? String(body.category) : (base.category || ''),
    tags: body.tags !== undefined ? toArray(body.tags) : (base.tags || []),
    collectionIds: body.collections !== undefined ? toArray(body.collections) : (base.collectionIds || []),
    priceAmount: resolvedPriceCents,
    price: priceDisplay(resolvedPriceCents),
    compareAtPriceAmount: compareCents !== null ? compareCents : (base.compareAtPriceAmount ?? null),
    costAmount: costCents !== null ? costCents : (base.costAmount ?? null),
    chargeTax: body.chargeTax !== undefined ? Boolean(body.chargeTax) : Boolean(base.chargeTax),
    sku: body.sku !== undefined ? String(body.sku) : (base.sku || ''),
    barcode: body.barcode !== undefined ? String(body.barcode) : (base.barcode || ''),
    trackQuantity: body.trackQuantity !== undefined ? Boolean(body.trackQuantity) : Boolean(base.trackQuantity),
    inventoryQuantity: qty !== null ? qty : (base.inventoryQuantity ?? 0),
    weight: body.weight !== undefined && body.weight !== '' ? Number(body.weight) : (base.weight ?? null),
    weightUnit: body.weightUnit || base.weightUnit || 'kg',
    countryOfOrigin: body.countryOfOrigin !== undefined ? String(body.countryOfOrigin) : (base.countryOfOrigin || ''),
    seoTitle: body.seoTitle !== undefined ? String(body.seoTitle) : (base.seoTitle || ''),
    seoDescription: body.seoDescription !== undefined ? String(body.seoDescription) : (base.seoDescription || ''),
    image: body.image !== undefined ? String(body.image) : (base.image || ''),
    media: body.media !== undefined ? (Array.isArray(body.media) ? body.media : []) : (base.media || []),
    salesChannels: body.salesChannels !== undefined ? toArray(body.salesChannels) : (base.salesChannels || ['online_store']),
    searchable: true,
    availableForSale: (body.status || base.status || 'active') === 'active',
    createdAt: base.createdAt || store.now(),
    updatedAt: store.now(),
  };
}

// Enrich the minimal seed products with admin fields so the list page is real.
function seed(state) {
  const seedDefaults = [
    { productType: 'T 恤', status: 'active', inventoryQuantity: 24, sku: 'TEE-RED-01' },
  ];
  (state.products || []).forEach((p, i) => {
    if (p.status === undefined) p.status = 'active';
    if (p.productType === undefined) p.productType = i === 0 ? 'T 恤' : '示例产品';
    if (p.inventoryQuantity === undefined) p.inventoryQuantity = [24, 12, 8, 0, 16, 4, 30, 6][i] ?? 10;
    if (p.priceAmount === undefined) p.priceAmount = store_moneyCents(p.price);
    if (p.salesChannels === undefined) p.salesChannels = ['online_store'];
    if (p.searchable === undefined) p.searchable = true;
  });
  void seedDefaults;
}

// local money parse for seed (avoids needing store at seed time)
function store_moneyCents(price) {
  const m = String(price || '').replace(/,/g, '').match(/[\d.]+/);
  return Math.round((m ? Number(m[0]) : 0) * 100);
}

// Shared create logic used by the REST route, the GraphQL shim, and any other
// tool surface, so they all run the same validation and emit the same event.
function createProduct(body, store) {
  const product = buildProduct(body || {}, store, null);
  if ((store.saved.products || []).some((x) => x.id === product.id)) {
    product.id = `${product.id}-${store.numericId('')}`.replace(/[^a-z0-9-]/gi, '');
    product.handle = product.id;
  }
  store.appendSharedStateList('products', product);
  store.pushEvent('admin_product_created_valid', {
    id: product.id, title: product.title, status: product.status, price: product.price,
  });
  return product;
}

const routes = [
  {
    method: 'GET',
    path: '/api/admin/products',
    handler: (ctx) => {
      const items = (ctx.store.saved.products || []).map(productView);
      return { status: 200, body: { ok: true, products: items, count: items.length } };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/products\/([^/]+)$/,
    handler: (ctx, m) => {
      const p = (ctx.store.saved.products || []).find((x) => x.id === m[1] || x.handle === m[1]);
      if (!p) return { status: 404, body: { ok: false, error: 'Product not found' } };
      return { status: 200, body: { ok: true, product: productView(p) } };
    },
  },
  {
    method: 'POST',
    path: '/api/admin/products',
    handler: (ctx) => {
      const product = createProduct(ctx.body || {}, ctx.store);
      return { status: 200, body: { ok: true, product: productView(product) } };
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/admin\/products\/([^/]+)$/,
    handler: (ctx, m) => {
      const list = ctx.store.saved.products || [];
      const idx = list.findIndex((x) => x.id === m[1] || x.handle === m[1]);
      if (idx === -1) return { status: 404, body: { ok: false, error: 'Product not found' } };
      const updated = buildProduct(ctx.body || {}, ctx.store, list[idx]);
      list[idx] = updated;
      // mirror into draft so isDirty()/storefront preview stay consistent
      const draftList = ctx.store.draft.products || [];
      const didx = draftList.findIndex((x) => x.id === updated.id);
      if (didx !== -1) draftList[didx] = ctx.store.clone(updated);
      ctx.store.pushEvent('admin_product_updated_valid', { id: updated.id, title: updated.title, status: updated.status });
      return { status: 200, body: { ok: true, product: productView(updated) } };
    },
  },
];

// Map a Shopify Admin GraphQL ProductInput → our create body (status uppercased
// in GraphQL; price lives on the first variant).
function createProductFromGraphql(input, store) {
  const i = input || {};
  const firstVariant = Array.isArray(i.variants) && i.variants[0] ? i.variants[0] : {};
  const body = {
    title: i.title,
    description: i.descriptionHtml != null ? i.descriptionHtml : i.description,
    vendor: i.vendor,
    productType: i.productType,
    status: i.status ? String(i.status).toLowerCase() : 'active',
    tags: i.tags,
    price: firstVariant.price != null ? firstVariant.price : i.price,
    sku: firstVariant.sku,
    image: i.image,
  };
  try {
    const product = createProduct(body, store);
    return {
      product: { id: store.gid('Product', product.id), title: product.title, handle: product.handle, status: (product.status || 'active').toUpperCase() },
      userErrors: [],
    };
  } catch (e) {
    // Shopify returns validation failures as userErrors at HTTP 200, not a fault.
    if (e instanceof V.ValidationError) {
      return { product: null, userErrors: [{ field: e.field ? [e.field] : null, message: e.message }] };
    }
    throw e;
  }
}

module.exports = { seed, routes, productView, createProduct, createProductFromGraphql };
