'use strict';

// Admin back-office API layer for the Shopify mock.
//
// `seedAll(state)` enriches/initialises the admin entity collections on the
// shared `saved` state. `handle(req,res,url,store,io)` dispatches every
// `/api/admin/*` route to its domain module; on success it sends JSON and
// returns true, so server.js can `if (await admin.handle(...)) return;` before
// its existing handlers. Unmatched `/api/admin/*` paths 404 (never fall through
// to the SPA static server). Domain modules are added to DOMAINS as waves land.

const { ValidationError } = require('../validation');

const products = require('./products');
const onlineStore = require('./online_store');

const DOMAINS = [products, onlineStore];

const ALL_ROUTES = DOMAINS.flatMap((d) => d.routes || []);

function seedAll(state) {
  for (const d of DOMAINS) {
    if (typeof d.seed === 'function') d.seed(state);
  }
}

async function handle(req, res, url, store, io) {
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/admin/')) return false;

  for (const route of ALL_ROUTES) {
    if (route.method !== req.method) continue;
    let match = null;
    if (route.path) {
      if (route.path !== pathname) continue;
    } else if (route.pattern) {
      match = route.pattern.exec(pathname);
      if (!match) continue;
    } else {
      continue;
    }

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      body = await io.readBody(req);
    }
    const ctx = {
      body,
      query: Object.fromEntries(url.searchParams.entries()),
      store,
      req,
      url,
    };
    try {
      const result = route.handler(ctx, match);
      io.sendJson(res, result.status, result.body);
    } catch (e) {
      if (e instanceof ValidationError) {
        io.sendJson(res, 400, { ok: false, error: e.message, field: e.field });
      } else {
        io.sendJson(res, 500, { ok: false, error: e.message });
      }
    }
    return true;
  }

  io.sendJson(res, 404, { ok: false, error: `No admin route for ${req.method} ${pathname}` });
  return true;
}

// Canonical, verifier-facing snapshot of all graded admin entities + counts.
function benchState(store) {
  const s = store.saved;
  return {
    counts: {
      products: (s.products || []).length,
      orders: (s.orders || []).length,
      draftOrders: (s.draftOrders || []).length,
      customers: (s.customers || []).length,
      discounts: (s.discounts || []).length,
      purchaseOrders: (s.purchaseOrders || []).length,
    },
    products: (s.products || []).map(products.productView),
    orders: s.orders || [],
    draftOrders: s.draftOrders || [],
    customers: s.customers || [],
    discounts: s.discounts || [],
    purchaseOrders: s.purchaseOrders || [],
  };
}

// GraphQL Admin shim helpers (shared state with the UI + REST + MCP surfaces).
function listProductNodes(store) {
  return (store.saved.products || []).map((p) => ({
    id: store.gid('Product', p.id),
    title: p.title,
    handle: p.handle || p.id,
    status: (p.status || 'active').toUpperCase(),
    vendor: p.vendor || '',
    totalInventory: p.inventoryQuantity || 0,
  }));
}

module.exports = {
  seedAll, handle, benchState, DOMAINS,
  createProductFromGraphql: products.createProductFromGraphql,
  listProductNodes,
};
