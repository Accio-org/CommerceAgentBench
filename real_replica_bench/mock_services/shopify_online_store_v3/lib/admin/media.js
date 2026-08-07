'use strict';

// stagedUploads + productMedia + CDN backend.
//
// Phase A.7 of the v3 Admin GraphQL backbone. Replicates the
// ForgeFit upload flow (see scratch/docs/forgefit-build-log.zh-CN.md
// lines 825-924):
//   1) `stagedUploadsCreate(input)` mints a per-upload token + URL the
//      client `curl`s the bytes to (POST /__stage_upload/:token).
//   2) `productCreateMedia(productId, media)` binds the staged upload to
//      a product, mints a CDN URL, and returns a READY MediaImage node.
//      The mutation is deprecated upstream; we set a `__deprecationWarning`
//      that handleGraphqlQuery hoists into `extensions.warnings`.
//   3) `GET /cdn/shopify/s/files/1/0835/2533/7308/files/<name>` serves
//      the stored bytes with the real CDN cache headers.
//
// Binary blobs live in module-level Maps (`stagedBlobs`, `cdnBlobs`) —
// NEVER on `saved`. State JSON would explode if we tried to round-trip
// raw image bytes through it.

const crypto = require('crypto');

// Resolve the URL the upload bytes should be POSTed to. Priority:
//   1) MOCK_PUBLIC_HOST (full URL with protocol, no trailing slash) — for
//      reverse-proxy / container deployments.
//   2) PORT — assume 127.0.0.1:<PORT>.
//   3) Fall back to 127.0.0.1:3097 (v3 default).
// Captured at module load: PORT is the same for the lifetime of the
// process, and test runs (3098/3099) get the right value when require()d.
const PUBLIC_HOST = (() => {
  if (process.env.MOCK_PUBLIC_HOST) return String(process.env.MOCK_PUBLIC_HOST).replace(/\/+$/, '');
  const port = Number(process.env.PORT) || 3097;
  return `http://127.0.0.1:${port}`;
})();

// Faux GCS bucket the agent sees as `resourceUrl` — purely cosmetic, the
// client only ever POSTs to `url` (which points back at us).
const RESOURCE_URL_BASE = 'https://shopify-staged-uploads.storage.googleapis.com';
// Real-Shopify CDN path shape (extracted from the ForgeFit log:901).
const CDN_PATH_PREFIX = '/cdn/shopify/s/files/1/0835/2533/7308/files';

// Module-level binary stores. Not in `saved` — state JSON would explode.
const stagedBlobs = new Map();   // token → Buffer
const cdnBlobs = new Map();      // cdnPath ('/cdn/.../files/<name>') → { bytes: Buffer, contentType, filename }

function seed(_state) { /* no-op — slots are initialised in initialThemeState() */ }

function resetMediaBlobs() {
  stagedBlobs.clear();
  cdnBlobs.clear();
}

function findStagedByToken(token, store) {
  if (!token) return null;
  const list = (store.saved.stagedUploads || []);
  return list.find((s) => s.token === token) || null;
}

// Best-effort resolve a stagedUpload from the `originalSource` URL we
// returned in stagedUploadsCreate. Handles both the resourceUrl
// (shopify-staged-uploads.storage.googleapis.com/tmp/<filename>) and the
// raw upload URL (http://<host>/__stage_upload/<token>).
function findStagedBySource(source, store) {
  if (!source) return null;
  const list = (store.saved.stagedUploads || []);
  // Direct upload URL match.
  const tokMatch = String(source).match(/\/__stage_upload\/([0-9a-f]+)/i);
  if (tokMatch) {
    const hit = list.find((s) => s.token === tokMatch[1]);
    if (hit) return hit;
  }
  // resourceUrl match (`/tmp/<filename>`).
  const fnMatch = String(source).match(/\/tmp\/([^/?#]+)/);
  if (fnMatch) {
    const filename = decodeURIComponent(fnMatch[1]);
    // Most-recent wins when multiple uploads share a filename.
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].expectedFilename === filename) return list[i];
    }
  }
  return null;
}

function gidTail(value) {
  return String(value || '').split('/').pop();
}

// stagedUploadsCreate(input: [StagedUploadInput!]!)
//   Returns { stagedTargets:[{url,resourceUrl,parameters}], userErrors:[] }
//
// For each entry we mint a random token, append a row to
// saved.stagedUploads, and hand back a URL pointing at our own
// /__stage_upload/<token> endpoint so the bytes round-trip locally.
function createStagedUploads(input, store) {
  const inputs = Array.isArray(input) ? input : (input ? [input] : []);
  const stagedTargets = [];
  store.saved.stagedUploads = store.saved.stagedUploads || [];
  for (const entry of inputs) {
    if (!entry) continue;
    const filename = String(entry.filename || `upload-${Date.now()}`);
    const mimeType = String(entry.mimeType || 'application/octet-stream');
    const resource = String(entry.resource || 'IMAGE');
    const fileSize = entry.fileSize !== undefined ? String(entry.fileSize) : '0';
    const httpMethod = String(entry.httpMethod || 'POST').toUpperCase();
    const token = crypto.randomBytes(16).toString('hex');
    const url = `${PUBLIC_HOST}/__stage_upload/${token}`;
    const resourceUrl = `${RESOURCE_URL_BASE}/tmp/${encodeURIComponent(filename)}`;
    const parameters = [
      { name: 'key', value: `tmp/${filename}` },
      { name: 'x-goog-meta-token', value: token },
      { name: 'Content-Type', value: mimeType },
    ];
    const record = {
      id: `staged-upload-${token}`,
      token,
      resource,
      expectedFilename: filename,
      mimeType,
      fileSize,
      httpMethod,
      url,
      parameters,
      uploadedAt: null,
      bytes: null,
      cdnUrl: null,
    };
    store.saved.stagedUploads.push(record);
    stagedTargets.push({ url, resourceUrl, parameters });
  }
  store.pushEvent('admin_graphql_staged_uploads_create', { count: stagedTargets.length });
  return { stagedTargets, userErrors: [] };
}

// Multipart/form-data extractor for the single `file` part GCS expects.
// Real-Shopify uploads come from `curl --form file=@local.png ...`; bytes-only
// posts (Content-Type: image/png with the binary as body) also work for
// scripted tests. We try multipart first; on any failure fall back to raw.
function extractMultipartFile(buffer, contentType) {
  const ct = String(contentType || '');
  const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return null;
  const boundary = (boundaryMatch[1] || boundaryMatch[2] || '').trim();
  if (!boundary) return null;
  const delim = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from('\r\n');
  const dblCrlf = Buffer.from('\r\n\r\n');
  let cursor = 0;
  let lastFile = null;
  while (cursor < buffer.length) {
    const start = buffer.indexOf(delim, cursor);
    if (start === -1) break;
    const next = buffer.indexOf(delim, start + delim.length);
    if (next === -1) break;
    const headerEnd = buffer.indexOf(dblCrlf, start);
    if (headerEnd === -1 || headerEnd > next) { cursor = next; continue; }
    const header = buffer.slice(start + delim.length + crlf.length, headerEnd).toString('utf8');
    const bodyStart = headerEnd + dblCrlf.length;
    // Strip the trailing CRLF before the next boundary delimiter.
    const bodyEnd = next - crlf.length;
    const part = buffer.slice(bodyStart, bodyEnd);
    // Recognise the file part (Content-Disposition: form-data; name="file"; filename=...)
    if (/name="?file"?/i.test(header) || /filename=/i.test(header)) {
      const fnMatch = header.match(/filename="?([^";\r\n]+)"?/i);
      const ctMatch = header.match(/^Content-Type:\s*([^\r\n;]+)/im);
      lastFile = {
        bytes: part,
        filename: fnMatch ? fnMatch[1] : null,
        contentType: ctMatch ? ctMatch[1].trim() : null,
      };
    }
    cursor = next;
  }
  return lastFile;
}

// POST /__stage_upload/:token receives the bytes the client `curl`ed to the
// URL we returned in stagedUploadsCreate. Stores them in `stagedBlobs` and
// updates the staged-upload record (uploadedAt + bytes count). Returns the
// sentinel response { status, body, contentType } that handleApi shapes
// into an HTTP reply (matching GCS' 204 No Content on success).
//
// `buf` is the full request body as a Buffer (handleApi reads it off the
// IncomingMessage stream — we don't depend on a Fetch-style req here so the
// Node http server keeps working alongside Bun).
function handleStagedUpload(token, buf, contentType, store) {
  const staged = findStagedByToken(token, store);
  if (!staged) {
    return { status: 404, body: JSON.stringify({ ok: false, error: 'unknown staged upload token', token }), contentType: 'application/json' };
  }
  const ct = String(contentType || '');
  let payload;
  if (ct.toLowerCase().includes('multipart/form-data')) {
    payload = extractMultipartFile(buf, ct);
  }
  const bytes = payload && payload.bytes ? payload.bytes : buf;
  const detectedFilename = payload && payload.filename;
  const detectedContentType = payload && payload.contentType;
  stagedBlobs.set(token, {
    bytes,
    contentType: detectedContentType || staged.mimeType || 'application/octet-stream',
    filename: detectedFilename || staged.expectedFilename,
  });
  staged.uploadedAt = store.now();
  staged.bytes = bytes.length;
  store.pushEvent('admin_staged_upload_received', { token, bytes: bytes.length, filename: staged.expectedFilename });
  // GCS returns 204 No Content on a successful staged upload — match that.
  return { status: 204, body: '', contentType: null };
}

// GET /cdn/shopify/s/files/1/0835/2533/7308/files/:filename
// Serves the bytes previously bound by productCreateMedia. The query string
// (?v=<timestamp>) is ignored.
function serveCdnFile(cdnPath) {
  const blob = cdnBlobs.get(cdnPath);
  if (!blob) return { status: 404, body: JSON.stringify({ ok: false, error: 'cdn file not found', path: cdnPath }), contentType: 'application/json', headers: {} };
  return {
    status: 200,
    body: blob.bytes,
    contentType: blob.contentType || 'application/octet-stream',
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Mock-Filename': blob.filename || '',
    },
  };
}

// productCreateMedia(productId, media: [CreateMediaInput!]!)
//   Returns { product:{id,media:{nodes}}, media:[<new>], userErrors:[],
//             __deprecationWarning:'…' }
// The deprecation warning gets hoisted into `extensions.warnings` by
// handleGraphqlQuery (real-Shopify behaviour for this op).
function productCreateMedia(productGid, media, store) {
  const productTail = gidTail(productGid);
  const product = (store.saved.products || []).find((p) => p.id === productTail || p.handle === productTail);
  if (!product) {
    return {
      product: null,
      media: [],
      userErrors: [{ field: ['productId'], message: 'Product not found', code: 'NOT_FOUND' }],
      __deprecationWarning: 'productCreateMedia is deprecated. Use productUpdate or productSet instead.',
    };
  }
  const mediaInputs = Array.isArray(media) ? media : (media ? [media] : []);
  store.saved.productMedia = store.saved.productMedia || [];
  const created = [];
  for (const m of mediaInputs) {
    if (!m || !m.originalSource) continue;
    const staged = findStagedBySource(m.originalSource, store);
    let cdnFullUrl = m.originalSource;
    let mediaStatus = 'READY';
    // When the source resolves to a staged upload whose bytes are present,
    // mint a CDN URL and stash the bytes for later /cdn/... GETs.
    if (staged && stagedBlobs.has(staged.token)) {
      const blob = stagedBlobs.get(staged.token);
      const filename = staged.expectedFilename || blob.filename || `media-${store.numericId('')}`;
      const v = Math.floor(Date.now() / 1000);
      const cdnPath = `${CDN_PATH_PREFIX}/${filename}`;
      cdnBlobs.set(cdnPath, { bytes: blob.bytes, contentType: blob.contentType, filename });
      cdnFullUrl = `${PUBLIC_HOST}${cdnPath}?v=${v}`;
      staged.cdnUrl = cdnFullUrl;
    } else if (staged && !stagedBlobs.has(staged.token)) {
      // Staged target exists but bytes never arrived — return PROCESSING
      // (shopify's real "queued" state) instead of READY.
      mediaStatus = 'PROCESSING';
    }
    const record = {
      id: store.gid('MediaImage', store.numericId('media')),
      productId: product.id,
      alt: m.alt != null ? String(m.alt) : '',
      status: mediaStatus,
      mediaContentType: String(m.mediaContentType || 'IMAGE'),
      image: { url: cdnFullUrl, originalSrc: cdnFullUrl },
      sourceStagedUploadId: staged ? staged.id : null,
    };
    store.appendSharedStateList('productMedia', record);
    created.push(record);
  }
  store.pushEvent('admin_graphql_product_create_media', { productId: product.id, count: created.length });
  const allForProduct = (store.saved.productMedia || []).filter((x) => x.productId === product.id);
  const nodeOf = (rec) => ({
    id: rec.id,
    alt: rec.alt || '',
    status: rec.status || 'READY',
    mediaContentType: rec.mediaContentType || 'IMAGE',
    image: rec.image || null,
  });
  return {
    product: {
      id: store.gid('Product', product.id),
      media: { nodes: allForProduct.map(nodeOf) },
    },
    media: created.map(nodeOf),
    userErrors: [],
    __deprecationWarning: 'productCreateMedia is deprecated. Use productUpdate or productSet instead.',
  };
}

module.exports = {
  seed,
  createStagedUploads,
  handleStagedUpload,
  serveCdnFile,
  productCreateMedia,
  resetMediaBlobs,
  // exposed for tests / debugging only
  _stagedBlobs: stagedBlobs,
  _cdnBlobs: cdnBlobs,
  CDN_PATH_PREFIX,
};
