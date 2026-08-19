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
// numbers with 400 (RRB rule #10 — the write endpoint is the source of truth).
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

// Helpers shared by productSet / productVariantsBulk*.
function gidTail(value) {
  return String(value || '').split('/').pop();
}

function mapGqlOptionValueNames(values) {
  return (Array.isArray(values) ? values : [])
    .map((v) => (typeof v === 'string' ? v : (v && v.name)))
    .filter(Boolean)
    .map(String);
}

function findProductByGid(productGid, store) {
  const tail = gidTail(productGid);
  if (!tail) return null;
  return (store.saved.products || []).find((p) => p.id === tail || p.handle === tail) || null;
}

// Mint an inventoryItem entry for `variant` (in-place mutation of variant.inventoryItemId).
// Records both saved + draft via appendSharedStateList. Returns the inventoryItem record.
function ensureInventoryItem(product, variant, gqlVariant, store) {
  store.saved.inventoryItems = store.saved.inventoryItems || [];
  if (variant.inventoryItemId) {
    const existing = store.saved.inventoryItems.find((x) => x.id === variant.inventoryItemId);
    if (existing) {
      if (gqlVariant && gqlVariant.inventoryItem) {
        if (gqlVariant.inventoryItem.tracked !== undefined) existing.tracked = !!gqlVariant.inventoryItem.tracked;
        if (gqlVariant.inventoryItem.sku !== undefined) existing.sku = String(gqlVariant.inventoryItem.sku);
      }
      if (gqlVariant && gqlVariant.sku !== undefined) existing.sku = String(gqlVariant.sku) || existing.sku;
      return existing;
    }
  }
  const tracked = !!(gqlVariant && gqlVariant.inventoryItem && gqlVariant.inventoryItem.tracked === true);
  const invItem = {
    id: `inv-item-${store.numericId('')}`,
    productId: product.id,
    variantId: variant.numericId || variant.title || '',
    sku: variant.sku || '',
    tracked,
  };
  store.appendSharedStateList('inventoryItems', invItem);
  variant.inventoryItemId = invItem.id;
  return invItem;
}

// Money scalar in Shopify Admin GraphQL is a bare decimal string ("189.00"),
// distinct from the internal `price` display string ("$189.00 USD") used by the admin SPA.
function moneyScalar(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2);
}

// GraphQL ProductVariant node (used in productSet/Variants*Bulk* return shapes and the products query).
function variantReturnNode(variant, store) {
  const invItem = variant.inventoryItemId
    ? (store.saved.inventoryItems || []).find((x) => x.id === variant.inventoryItemId)
    : null;
  return {
    id: variant.numericId ? store.gid('ProductVariant', variant.numericId) : null,
    title: variant.title || '',
    price: moneyScalar(variant.priceAmount),
    sku: variant.sku || '',
    inventoryItem: invItem ? { id: store.gid('InventoryItem', invItem.id), tracked: !!invItem.tracked } : null,
  };
}

function productMediaNodesFor(productId, store) {
  return (store.saved.productMedia || [])
    .filter((m) => m.productId === productId)
    .map((m) => ({
      id: m.id,
      alt: m.alt || '',
      status: m.status || 'READY',
      mediaContentType: m.mediaContentType || 'IMAGE',
      image: m.image || null,
    }));
}

function totalInventoryFor(product, store) {
  const variants = product.variants || [];
  if (!variants.length) return product.inventoryQuantity || 0;
  return variants.reduce((sum, v) => {
    if (!v.inventoryItemId) return sum;
    const levels = (store.saved.inventoryLevels || []).filter((l) => l.inventoryItemId === v.inventoryItemId);
    return sum + levels.reduce((s, l) => s + (Number(l.available) || 0), 0);
  }, 0);
}

// Full GraphQL Product node — used by productSet/Variants*Bulk* return shapes and the upgraded products query.
function productFullNode(product, store) {
  return {
    id: store.gid('Product', product.id),
    title: product.title,
    handle: product.handle || product.id,
    status: (product.status || 'active').toUpperCase(),
    vendor: product.vendor || '',
    productType: product.productType || '',
    tags: product.tags || [],
    totalInventory: totalInventoryFor(product, store),
    variants: { nodes: (product.variants || []).map((v) => variantReturnNode(v, store)) },
    media: { nodes: productMediaNodesFor(product.id, store) },
  };
}

// productSet: create OR update a product + variants + options + media in one mutation.
// Idempotent on handle when no input.id is provided (matches real Shopify semantics).
function productSetFromGraphql(input, store) {
  const i = input || {};
  // Resolve existing record (by id first, then by handle for the no-id upsert path).
  let existing = null;
  if (i.id) existing = findProductByGid(i.id, store);
  if (!existing && i.handle) {
    existing = (store.saved.products || []).find((p) => p.handle === i.handle) || null;
  }

  // Map GraphQL ProductSetInput → our buildProduct body (status lower-cased; first variant carries price).
  const firstVariant = Array.isArray(i.variants) && i.variants[0] ? i.variants[0] : {};
  const status = i.status ? String(i.status).toLowerCase() : (existing ? existing.status : 'active');

  let mappedOptions;
  if (Array.isArray(i.productOptions)) {
    mappedOptions = i.productOptions.map((o) => ({
      name: o && o.name ? String(o.name) : '',
      values: mapGqlOptionValueNames(o && o.values),
    }));
  }
  let mappedVariants;
  if (Array.isArray(i.variants)) {
    mappedVariants = i.variants.map((v) => {
      const ov = Array.isArray(v && v.optionValues) ? mapGqlOptionValueNames(v.optionValues) : [];
      const qty = v && v.inventoryQuantities && v.inventoryQuantities[0] && v.inventoryQuantities[0].quantity;
      return {
        title: v && v.title,
        optionValues: ov,
        price: v && v.price,
        sku: v && v.sku,
        quantity: qty,
      };
    });
  }

  const body = {
    title: i.title != null ? i.title : (existing ? existing.title : undefined),
    description: i.descriptionHtml != null ? i.descriptionHtml : i.description,
    vendor: i.vendor,
    productType: i.productType,
    status,
    tags: i.tags,
    urlHandle: i.handle,
    price: firstVariant.price != null ? firstVariant.price : i.price,
    sku: firstVariant.sku,
  };
  if (mappedOptions !== undefined) body.options = mappedOptions;
  if (mappedVariants !== undefined) body.variants = mappedVariants;

  try {
    const product = buildProduct(body, store, existing);

    // Mint / preserve per-variant numericId + inventoryItem refs.
    (product.variants || []).forEach((variant, idx) => {
      const prev = existing && (existing.variants || [])[idx];
      if (!variant.numericId) variant.numericId = (prev && prev.numericId) || store.numericId('');
      if (prev && prev.inventoryItemId && !variant.inventoryItemId) variant.inventoryItemId = prev.inventoryItemId;
      const gqlVariant = Array.isArray(i.variants) ? i.variants[idx] : null;
      ensureInventoryItem(product, variant, gqlVariant, store);
    });

    // Persist the product (replace in place when updating, append when creating).
    const products = store.saved.products || [];
    const pidx = products.findIndex((p) => p.id === product.id);
    if (pidx !== -1) {
      products[pidx] = product;
      const draftList = store.draft.products || [];
      const didx = draftList.findIndex((x) => x.id === product.id);
      if (didx !== -1) draftList[didx] = store.clone(product);
      else if (store.draft.products) store.draft.products.push(store.clone(product));
    } else {
      store.appendSharedStateList('products', product);
    }

    // Append productMedia entries (status READY immediately — the mock skips Shopify's PROCESSING queue).
    if (Array.isArray(i.files)) {
      i.files.forEach((f) => {
        if (!f || !f.originalSource) return;
        const mediaRecord = {
          id: store.gid('MediaImage', store.numericId('')),
          productId: product.id,
          alt: f.alt || '',
          status: 'READY',
          mediaContentType: f.contentType || 'IMAGE',
          image: { url: f.originalSource, originalSrc: f.originalSource },
        };
        store.appendSharedStateList('productMedia', mediaRecord);
      });
    }

    store.pushEvent(existing ? 'admin_product_set_updated_valid' : 'admin_product_set_created_valid', {
      id: product.id, title: product.title, status: product.status,
    });

    return { product: productFullNode(product, store), userErrors: [] };
  } catch (e) {
    if (e instanceof V.ValidationError) {
      return { product: null, userErrors: [{ field: e.field ? [e.field] : null, message: e.message }] };
    }
    throw e;
  }
}

function productVariantsBulkCreateFromGraphql(input, store) {
  const i = input || {};
  const product = findProductByGid(i.productId, store);
  if (!product) {
    return { product: null, productVariants: [], userErrors: [{ field: ['productId'], message: 'Product not found' }] };
  }
  const created = [];
  try {
    (i.variants || []).forEach((v, idx) => {
      const priceCents = V.assertMoney(v && v.price, `variants[${idx}].price`);
      const ov = Array.isArray(v && v.optionValues) ? mapGqlOptionValueNames(v.optionValues) : [];
      const title = v && v.title ? String(v.title) : (ov.join(' / ') || 'Default Title');
      const variant = {
        title,
        optionValues: ov,
        priceAmount: priceCents !== null ? priceCents : (product.priceAmount || 0),
        price: priceDisplay(priceCents !== null ? priceCents : (product.priceAmount || 0)),
        sku: v && v.sku !== undefined ? String(v.sku) : '',
        inventoryQuantity: 0,
        numericId: store.numericId(''),
      };
      ensureInventoryItem(product, variant, v, store);
      product.variants = product.variants || [];
      product.variants.push(variant);
      created.push(variant);
    });
  } catch (e) {
    if (e instanceof V.ValidationError) {
      return { product: null, productVariants: [], userErrors: [{ field: e.field ? [e.field] : null, message: e.message }] };
    }
    throw e;
  }
  // Mirror to draft so /api/state stays consistent.
  const draftList = store.draft.products || [];
  const didx = draftList.findIndex((x) => x.id === product.id);
  if (didx !== -1) draftList[didx] = store.clone(product);
  store.pushEvent('admin_product_variants_bulk_created_valid', { id: product.id, count: created.length });
  return {
    product: productFullNode(product, store),
    productVariants: created.map((v) => variantReturnNode(v, store)),
    userErrors: [],
  };
}

function productVariantsBulkUpdateFromGraphql(input, store) {
  const i = input || {};
  const product = findProductByGid(i.productId, store);
  if (!product) {
    return { product: null, productVariants: [], userErrors: [{ field: ['productId'], message: 'Product not found' }] };
  }
  const updated = [];
  try {
    (i.variants || []).forEach((v, idx) => {
      const vTail = gidTail(v && v.id);
      const variant = (product.variants || []).find((x) => x.numericId === vTail);
      if (!variant) {
        throw new V.ValidationError(`Variant ${v && v.id} not found.`, `variants[${idx}].id`);
      }
      if (v && v.price !== undefined) {
        const priceCents = V.assertMoney(v.price, `variants[${idx}].price`);
        if (priceCents !== null) {
          variant.priceAmount = priceCents;
          variant.price = priceDisplay(priceCents);
        }
      }
      if (v && v.sku !== undefined) variant.sku = String(v.sku);
      if (v && v.title !== undefined) variant.title = String(v.title);
      if (v && v.inventoryItem && variant.inventoryItemId) {
        const invItem = (store.saved.inventoryItems || []).find((x) => x.id === variant.inventoryItemId);
        if (invItem) {
          if (v.inventoryItem.tracked !== undefined) invItem.tracked = !!v.inventoryItem.tracked;
          if (v.inventoryItem.sku !== undefined) invItem.sku = String(v.inventoryItem.sku);
        }
      }
      updated.push(variant);
    });
  } catch (e) {
    if (e instanceof V.ValidationError) {
      return { product: null, productVariants: [], userErrors: [{ field: e.field ? [e.field] : null, message: e.message }] };
    }
    throw e;
  }
  const draftList = store.draft.products || [];
  const didx = draftList.findIndex((x) => x.id === product.id);
  if (didx !== -1) draftList[didx] = store.clone(product);
  store.pushEvent('admin_product_variants_bulk_updated_valid', { id: product.id, count: updated.length });
  return {
    product: productFullNode(product, store),
    productVariants: updated.map((v) => variantReturnNode(v, store)),
    userErrors: [],
  };
}

// Full-shape product nodes for the upgraded GraphQL products query.
function listFullProductNodes(store) {
  return (store.saved.products || []).map((p) => productFullNode(p, store));
}

module.exports = {
  seed, routes, productView, createProduct, createProductFromGraphql,
  productSetFromGraphql, productVariantsBulkCreateFromGraphql, productVariantsBulkUpdateFromGraphql,
  listFullProductNodes,
};
