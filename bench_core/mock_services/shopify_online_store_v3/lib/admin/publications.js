'use strict';

// Publications + currentAppInstallation admin domain.
//
// Backs the three GraphQL ops the ForgeFit publish flow needs (see
// scratch/docs/forgefit-build-log.zh-CN.md:998-1116):
//
//   1. `publications(first: N)` — lists the three seeded sales channels
//      (在线商店 / Shop / POS) as `Publication` nodes.
//   2. `publishablePublish(id: ID!, input: [PublicationInput!]!)` — appends
//      to `saved.publishedResources`, dedup'd by (resourceId, publicationId).
//      Idempotent — re-publishing the same pair is a no-op (the ForgeFit
//      script publishes 8 resources in one batch).
//   3. `currentAppInstallation { id accessScopes { handle } launchUrl }` —
//      introspection of the per-request access-scope set. Scope resolution
//      prefers the Authorization-bound token (`saved.authTokens`) and falls
//      back to `saved.appInstallation.accessScopes` for unauth callers.
//
// Phase A.6 intentionally does NOT scope-gate these reads/writes —
// `currentAppInstallation` IS the introspection mechanism, and the publish
// write-gating is Phase B/D once the agent-visible `shopify store auth` CLI
// is wired. The state slots used here were seeded by initialThemeState() in
// Phase A.1.

const { resolveScopes } = require('./_scope');

// ---- seed: state slots are already created by initialThemeState() in
// server.js (publications/publishedResources/appInstallation/authTokens).
// Nothing to add here — kept for the DOMAINS contract.
function seed() {}

// Tail of a gid or a raw numeric id. `gid://shopify/Publication/pub-x` → `pub-x`.
function gidTail(value) {
  return String(value || '').split('/').pop();
}

// ---- listPublications: returns `Publication` nodes for the GraphQL
// `publications` query. Shape matches the real Admin GraphQL surface (see
// forgefit-build-log:1054-1072 for a sample response).
function listPublications(store) {
  const list = store.saved.publications || [];
  return list.map((pub) => ({
    id: store.gid('Publication', pub.id),
    name: pub.name,
    supportsFuturePublishing: !!pub.supportsFuturePublishing,
    autoPublish: !!pub.autoPublish,
  }));
}

// Resolve a publication by either numeric/string id, gid, or display name.
function findPublication(rawId, store) {
  const tail = gidTail(rawId);
  if (!tail) return null;
  const pubs = store.saved.publications || [];
  return pubs.find((p) => p.id === tail || p.id === rawId || p.name === rawId) || null;
}

// Build the `resourcePublications.nodes` list for a single resource — every
// (resourceId, publicationId) pair currently recorded in `saved.publishedResources`.
function resourcePublicationNodes(resourceId, store) {
  const records = (store.saved.publishedResources || []).filter((r) => r.resourceId === resourceId);
  return records.map((r) => {
    const pub = findPublication(r.publicationId, store);
    return {
      publication: {
        id: store.gid('Publication', pub ? pub.id : gidTail(r.publicationId)),
        name: pub ? pub.name : '',
      },
      publishDate: r.publishedAt,
      isPublished: true,
    };
  });
}

// ---- publishResource: implements the `publishablePublish` mutation.
// `rawResourceId` is the gid of the resource being published
// (Product/Collection/etc.). `rawInputs` is the [PublicationInput!]! list, each
// `{publicationId}`. The dispatcher in server.js already normalises the legacy
// `{id, publicationIds}` variable shape into this form.
//
// Returns the Shopify `Publishable` shape with `publishable`, `shop`, and
// `userErrors`. Idempotent: re-publishing the same pair is a no-op.
function publishResource(rawResourceId, rawInputs, store) {
  const resourceId = String(rawResourceId || '');
  if (!resourceId) {
    return {
      publishable: null,
      shop: null,
      userErrors: [{ field: ['id'], message: 'Resource id is required.', code: 'REQUIRED' }],
    };
  }
  const inputs = Array.isArray(rawInputs) ? rawInputs : [];

  store.saved.publishedResources = store.saved.publishedResources || [];
  const userErrors = [];

  for (let i = 0; i < inputs.length; i++) {
    const entry = inputs[i] || {};
    const rawPubId = entry.publicationId;
    const pub = findPublication(rawPubId, store);
    if (!pub) {
      userErrors.push({
        field: ['input', String(i), 'publicationId'],
        message: 'Publication not found.',
        code: 'NOT_FOUND',
      });
      continue;
    }
    // Dedup by (resourceId, publicationId) — re-publishing is a no-op.
    const dup = store.saved.publishedResources.find(
      (r) => r.resourceId === resourceId && r.publicationId === pub.id,
    );
    if (dup) continue;
    store.saved.publishedResources.push({
      resourceId,
      publicationId: pub.id,
      publishedAt: store.now(),
    });
  }

  if (userErrors.length) {
    return { publishable: null, shop: null, userErrors };
  }

  store.pushEvent('admin_publishable_publish_valid', {
    resourceId,
    publicationIds: inputs.map((e) => gidTail(e && e.publicationId)).filter(Boolean),
  });

  const nodes = resourcePublicationNodes(resourceId, store);
  return {
    publishable: {
      publishedOnPublication: nodes.length > 0,
      publicationCount: nodes.length,
      resourcePublications: { nodes },
    },
    shop: {
      id: store.gid('Shop', '83525337308'),
      publicationCount: (store.saved.publishedResources || []).length,
    },
    userErrors: [],
  };
}

// ---- currentAppInstallation: returns the per-request introspection node.
// Scope set is resolved by `resolveScopes(saved, headers)` — prefers the
// Authorization-bound token, falls back to `saved.appInstallation.accessScopes`.
function currentAppInstallation(store, headers = {}) {
  const scopes = resolveScopes(store.saved, headers);
  const install = store.saved.appInstallation || { id: 'app-installation-default' };
  return {
    id: store.gid('AppInstallation', install.id || 'app-installation-default'),
    accessScopes: Array.from(scopes).map((handle) => ({ handle })),
    launchUrl: 'https://mock-shopify-cli/launch',
  };
}

module.exports = {
  seed,
  listPublications,
  publishResource,
  currentAppInstallation,
};
