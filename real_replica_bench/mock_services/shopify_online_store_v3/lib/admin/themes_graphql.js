'use strict';

// themes / theme(id).files / themeFilesUpsert — Phase A.8 of the v3 Admin
// GraphQL backbone.
//
// Mirrors the three GraphQL ops the ForgeFit theme-customisation script
// uses (see scratch/docs/forgefit-build-log.zh-CN.md:926-997 and 1192-1270):
//
//   1. `themes(first: N) { nodes { id name role } }` — lists the themes
//      slot from `state.draft.themes[]`. Our internal role values are the
//      lowercase Shopify storefront tags (`current` / `draft` / `demo` /
//      `development`); we map them to the Admin GraphQL `ThemeRole` enum
//      (`MAIN` / `UNPUBLISHED` / `DEMO` / `DEVELOPMENT`).
//   2. `theme(id: ID!) { files(filenames: [...]) { nodes { ... } } }` —
//      returns the (currently flat) `state.draft.themeFiles[]` list,
//      optionally filtered by exact filename match. Each node carries a
//      `body` union field; we materialise both `content` (for text) and
//      `contentBase64` (for binary) so the GraphQL response is correct
//      regardless of which fragment the query selected. Real Shopify
//      returns just one branch — JS-object form is upward-compatible.
//   3. `themeFilesUpsert(themeId, files: [{filename, body: {type,value}}])` —
//      writes each file into `state.draft.themeFiles[]`, replacing any
//      existing entry by exact `filename` match. Storage shape matches
//      the seed loader + CLI push:
//        { path, type, updatedText, content, size, contentType }
//      so the storefront renderer (`lib/storefront/render.js` →
//      `lib/storefront/theme_fs.js`) picks up the new files on the next
//      request — no cache invalidation needed because render reads state
//      live. Binary bodies (BASE64) are decoded to a Node Buffer and
//      stored as-is so `readThemeAsset` (used by GET /assets/<name>) can
//      stream the original bytes back out unchanged.
//
// The single-source-of-truth design: `themeFiles[]` is flat (no per-theme
// segregation). The renderer treats the `role: 'current'` theme as the
// active theme; an upsert against any other themeId still writes into the
// same flat list. When the backend grows per-theme scoping, that's where
// `filterThemeFiles(allFiles, themeId)` in render.js will switch on.

// Map our lowercase role → Admin GraphQL ThemeRole enum.
function themeRoleToGraphql(role) {
  switch (String(role || '').toLowerCase()) {
    case 'current':
    case 'main':
    case 'live':
    case 'published':
      return 'MAIN';
    case 'development':
    case 'dev':
      return 'DEVELOPMENT';
    case 'demo':
      return 'DEMO';
    case 'draft':
    case 'unpublished':
      return 'UNPUBLISHED';
    default:
      return 'UNPUBLISHED';
  }
}

// Extract the numeric tail of a gid or accept a bare id.
function gidTail(value) {
  return String(value || '').split('/').pop();
}

// Pick the "active" theme used as the implicit target when a query asks
// for files without a specific themeId match. Treats role: 'current' as
// authoritative, falling back to the first theme in the list.
function pickActiveTheme(themes) {
  if (!Array.isArray(themes) || themes.length === 0) return null;
  return themes.find((t) => t.role === 'current') || themes[0];
}

function listThemes(store) {
  const themes = store.draft?.themes || store.saved?.themes || [];
  return themes.map((t) => ({
    id: store.gid('OnlineStoreTheme', t.id),
    name: t.name,
    role: themeRoleToGraphql(t.role),
  }));
}

// Infer Shopify-style contentType from extension. Defaults match the
// real Admin GraphQL response (see forgefit log:956-969 — image/png for
// .png, application/x-liquid for .liquid, application/json for .json).
function contentTypeForFilename(filename) {
  const name = String(filename || '').toLowerCase();
  const ext = name.slice(name.lastIndexOf('.'));
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.liquid': return 'application/x-liquid';
    case '.json': return 'application/json';
    case '.js':
    case '.mjs': return 'application/javascript';
    case '.css': return 'text/css';
    case '.html': return 'text/html';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.txt': return 'text/plain';
    default: return 'text/plain';
  }
}

function isTextContentType(contentType) {
  const ct = String(contentType || '').toLowerCase();
  return ct.startsWith('text/')
    || ct === 'application/x-liquid'
    || ct === 'application/json'
    || ct === 'application/javascript'
    || ct.includes('+json')
    || ct.includes('xml');
}

// Classify file path into the seed-loader bucket so the storefront tooling
// (`pull`, `push`, sidebar) treats upserts and seeds uniformly.
function typeOfPath(p) {
  const path = String(p || '');
  if (path.startsWith('layout/')) return 'layout';
  if (path.startsWith('templates/')) return 'template';
  if (path.startsWith('sections/')) return 'section';
  if (path.startsWith('snippets/')) return 'snippet';
  if (path.startsWith('assets/')) return 'asset';
  if (path.startsWith('config/')) return 'config';
  if (path.startsWith('locales/')) return 'locale';
  return 'asset';
}

// Build the `body` union shape. We expose BOTH possible fragment fields
// (`content` and `contentBase64`); GraphQL clients only see the field
// they selected via `... on OnlineStoreThemeFileBodyText/Base64` inline
// fragments, so providing both is forward-compatible.
//
// For binary files the upsert path stores `content` as a base64 string
// with `contentEncoding: 'base64'` (so JSON-based state cloning survives
// it — Buffer would be mangled by JSON.parse(JSON.stringify(...))). Here
// we surface the base64 string directly; text content gets reflected as
// both `content` and `contentBase64` for completeness.
function buildFileBody(file) {
  const body = {};
  if (file.contentEncoding === 'base64' && typeof file.content === 'string') {
    body.contentBase64 = file.content;
    body.content = null;
  } else if (Buffer.isBuffer(file.content)) {
    body.contentBase64 = file.content.toString('base64');
    body.content = null;
  } else if (typeof file.content === 'string') {
    body.content = file.content;
    body.contentBase64 = Buffer.from(file.content, 'utf8').toString('base64');
  } else if (file.content == null) {
    body.content = '';
    body.contentBase64 = '';
  } else {
    const s = String(file.content);
    body.content = s;
    body.contentBase64 = Buffer.from(s, 'utf8').toString('base64');
  }
  return body;
}

function fileNode(file) {
  const ct = file.contentType || contentTypeForFilename(file.path);
  // Size: bytes for binary; UTF-8 byte length for text. Stored size
  // wins when present (set on upsert), otherwise compute on the fly.
  let size = file.size;
  if (size == null) {
    if (file.contentEncoding === 'base64' && typeof file.content === 'string') {
      try { size = Buffer.from(file.content, 'base64').length; } catch { size = 0; }
    } else if (Buffer.isBuffer(file.content)) size = file.content.length;
    else if (typeof file.content === 'string') size = Buffer.byteLength(file.content, 'utf8');
    else size = 0;
  }
  // Shopify returns size as a string (UnsignedInt64 → JSON string in the
  // upstream schema; see forgefit log:957 `"size": "1966092"`).
  return {
    filename: file.path,
    size: String(size),
    contentType: ct,
    body: buildFileBody(file),
  };
}

// theme(id: ID!) { files(filenames: [...]) { ... } }
//   - `themeId`: the gid the client passed (we tolerate raw numeric ids
//     too). If it doesn't match any theme, we fall back to the active
//     theme — real Shopify would 404, but our flat themeFiles list is
//     shared across themes so this matches the storefront's pickTheme
//     behaviour and keeps unrelated tasks moving.
//   - `filenameFilter`: optional array of exact filenames. Real Shopify
//     ignores nonexistent names rather than erroring, so we do the same.
function getTheme(themeId, filenameFilter, store) {
  const themes = store.draft?.themes || store.saved?.themes || [];
  const tail = gidTail(themeId);
  const found = themes.find((t) => t.id === tail || t.id === String(themeId)) || pickActiveTheme(themes);
  if (!found) {
    return { id: themeId, name: '', role: 'UNPUBLISHED', files: { nodes: [], userErrors: [] } };
  }
  const allFiles = store.draft?.themeFiles || store.saved?.themeFiles || [];
  let files = allFiles;
  if (Array.isArray(filenameFilter) && filenameFilter.length > 0) {
    const set = new Set(filenameFilter.map((f) => String(f)));
    files = files.filter((f) => set.has(f.path));
  }
  const nodes = files.map(fileNode);
  return {
    id: store.gid('OnlineStoreTheme', found.id),
    name: found.name,
    role: themeRoleToGraphql(found.role),
    files: {
      nodes,
      // Edges form is rare for theme.files but provide for completeness.
      edges: nodes.map((node, i) => ({ cursor: Buffer.from(String(i)).toString('base64'), node })),
      userErrors: [],
    },
  };
}

// themeFilesUpsert(themeId, files: [{filename, body: {type, value}}])
function themeFilesUpsert(themeId, files, store) {
  const userErrors = [];
  const upserted = [];
  if (!Array.isArray(files)) files = [];
  // Resolve the target theme so we can stamp its updatedText. The flat
  // themeFiles list is shared, but we still want the theme card to
  // reflect "just edited".
  const themes = store.draft?.themes || store.saved?.themes || [];
  const tail = gidTail(themeId);
  const target = themes.find((t) => t.id === tail || t.id === String(themeId)) || pickActiveTheme(themes);

  // Mutate the canonical `saved.themeFiles` list — the same slot the
  // storefront's pickTheme cares about after `commitAdminMutation`
  // refreshes `draft` from `saved`. (publications.js follows the same
  // pattern: mutate saved, then commitAdminMutation.)
  const saved = store.saved;
  if (!Array.isArray(saved.themeFiles)) saved.themeFiles = [];

  for (let i = 0; i < files.length; i += 1) {
    const input = files[i] || {};
    const filename = String(input.filename || '').trim();
    if (!filename) {
      userErrors.push({ field: ['files', String(i), 'filename'], message: 'Filename is required.', code: 'INVALID' });
      continue;
    }
    const bodyInput = input.body || {};
    const bodyType = String(bodyInput.type || '').toUpperCase();
    const bodyValue = bodyInput.value;
    if (bodyValue == null) {
      userErrors.push({ field: ['files', String(i), 'body', 'value'], message: 'Body value is required.', code: 'INVALID' });
      continue;
    }
    let content;
    let size;
    let contentEncoding = null; // 'base64' marks binary; absent = text
    if (bodyType === 'BASE64') {
      // Validate the base64 string by round-tripping through Buffer.
      let buf;
      try { buf = Buffer.from(String(bodyValue), 'base64'); }
      catch (err) {
        userErrors.push({ field: ['files', String(i), 'body', 'value'], message: `Invalid base64: ${err.message}`, code: 'INVALID' });
        continue;
      }
      size = buf.length;
      const contentTypeProbe = contentTypeForFilename(filename);
      if (isTextContentType(contentTypeProbe)) {
        // Text-classified file delivered as BASE64 → decode to a
        // utf-8 string so the storefront renderer (which expects
        // text for liquid/json/css/js) can use it directly.
        content = buf.toString('utf8');
        size = Buffer.byteLength(content, 'utf8');
      } else {
        // True binary — store the base64 STRING (not a Buffer), so
        // JSON-based state cloning survives the round-trip. ThemeFs
        // decodes back to a Buffer when this content is served.
        content = buf.toString('base64');
        contentEncoding = 'base64';
      }
    } else if (bodyType === 'URL') {
      // Real Shopify supports URL body type (fetch from URL); we don't.
      userErrors.push({ field: ['files', String(i), 'body', 'type'], message: 'URL body type is not supported by the mock.', code: 'INVALID' });
      continue;
    } else {
      // TEXT (default).
      content = String(bodyValue);
      size = Buffer.byteLength(content, 'utf8');
    }
    const contentType = contentTypeForFilename(filename);

    const next = {
      path: filename,
      type: typeOfPath(filename),
      updatedText: '刚刚通过 Admin GraphQL themeFilesUpsert',
      content,
      size,
      contentType,
    };
    if (contentEncoding) next.contentEncoding = contentEncoding;
    const idx = saved.themeFiles.findIndex((f) => f.path === filename);
    if (idx >= 0) saved.themeFiles[idx] = { ...saved.themeFiles[idx], ...next };
    else saved.themeFiles.push(next);
    upserted.push({ filename });
  }

  if (target && upserted.length > 0) {
    target.updatedText = `刚刚通过 Admin API 写入 ${upserted.length} 个文件`;
  }

  // Hook the dirty-tracking pipeline if available so verifier diffs
  // notice the change. The store wrapper (server.js adminStore) exposes
  // `commitAdminMutation` for this; older paths just bump events.
  if (typeof store.commitAdminMutation === 'function') {
    try { store.commitAdminMutation('themeFilesUpsert', { count: upserted.length, files: upserted.map((f) => f.filename) }); }
    catch { /* non-fatal */ }
  }
  if (typeof store.pushEvent === 'function') {
    try { store.pushEvent('graphql_theme_files_upsert', { dirty: typeof store.isDirty === 'function' ? store.isDirty() : undefined, files: upserted.map((f) => f.filename) }); }
    catch { /* non-fatal */ }
  }

  return { upsertedThemeFiles: upserted, userErrors };
}

module.exports = {
  listThemes,
  getTheme,
  themeFilesUpsert,
  themeRoleToGraphql,
  contentTypeForFilename,
  // exported for tests
  buildFileBody,
};
