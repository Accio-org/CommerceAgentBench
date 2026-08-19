// HTTP integration for the storefront renderer.
//
// Mounts these routes on top of the v3 mock backend (which already serves the
// admin SPA + /api/*):
//
//   GET /                          → renderStorefront(route=index)
//   GET /products/:handle          → renderStorefront(route=product)
//   GET /collections               → renderStorefront(route=collection, handle=all)
//   GET /collections/:handle       → renderStorefront(route=collection)
//   GET /pages/:handle             → renderStorefront(route=page)
//   GET /cart                      → renderStorefront(route=cart)
//   GET /search                    → renderStorefront(route=search, query=?q=)
//   GET /assets/<name>             → readThemeAsset (with public/assets/ fallback)
//
// Any URL with `?preview_theme_id=N` switches the rendering theme to N.
//
// The exported `handleStorefront(req, res, url, getState)` returns true if it
// took responsibility for the response, false otherwise.

const fs = require('fs');
const path = require('path');
const { renderStorefront, readThemeAsset, pickTheme } = require('./render');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
  '.liquid': 'text/html; charset=utf-8',
};

function contentTypeFor(name) {
  const ext = path.extname(name).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function routeFor(url) {
  const { pathname } = url;
  if (pathname === '/' || pathname === '/index') return { type: 'index' };
  if (pathname === '/cart' || pathname === '/cart/' || pathname === '/cart/index') return { type: 'cart' };
  if (pathname === '/search') return { type: 'search', query: url.searchParams.get('q') || '' };
  if (pathname === '/collections' || pathname === '/collections/') return { type: 'collection', handle: 'all' };
  const m = pathname.match(/^\/(products|collections|pages)\/([^/]+)\/?$/);
  if (m) return { type: m[1].slice(0, -1), handle: decodeURIComponent(m[2]) };
  if (pathname === '/404') return { type: '404' };
  return null;
}

function isStorefrontPath(url) {
  return !!routeFor(url);
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

async function handleStorefront(req, res, url, getState, { publicAssetsDir } = {}) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  // /assets/<name>: theme asset first, then public/assets/ fallback.
  if (url.pathname.startsWith('/assets/')) {
    const name = url.pathname.slice('/assets/'.length).split('?')[0];
    if (!name) return false;
    const state = await getState();
    const previewThemeId = url.searchParams.get('preview_theme_id');
    const themeAsset = readThemeAsset({ draft: state.draft, name, previewThemeId });
    if (themeAsset != null) {
      send(res, 200, { 'content-type': contentTypeFor(name), 'cache-control': 'public, max-age=60' }, themeAsset);
      return true;
    }
    if (publicAssetsDir) {
      const safe = path.normalize(decodeURIComponent(name)).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(publicAssetsDir, safe);
      if (filePath.startsWith(publicAssetsDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        send(res, 200, { 'content-type': contentTypeFor(name), 'cache-control': 'public, max-age=60' }, fs.readFileSync(filePath));
        return true;
      }
    }
    send(res, 404, { 'content-type': 'text/plain' }, `Asset not found: ${name}`);
    return true;
  }

  const route = routeFor(url);
  if (!route) return false;

  const state = await getState();
  if (!state || !state.draft) {
    send(res, 500, { 'content-type': 'text/plain' }, 'Storefront state unavailable.');
    return true;
  }
  const previewThemeId = url.searchParams.get('preview_theme_id');

  try {
    const { html, templateName } = await renderStorefront({
      draft: state.draft,
      url,
      route,
      assetBase: '/assets',
      previewThemeId,
    });
    const status = templateName === '404' ? 404 : 200;
    send(res, status, { 'content-type': 'text/html; charset=utf-8', 'x-shopify-stage': 'storefront-mock' }, html);
  } catch (err) {
    send(res, 500, { 'content-type': 'text/html; charset=utf-8' }, `<!doctype html><html><body><h1>Storefront render error</h1><pre>${escapeHtml(err.stack || err.message)}</pre></body></html>`);
  }
  return true;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
  handleStorefront,
  isStorefrontPath,
  routeFor,
  pickTheme,
};
