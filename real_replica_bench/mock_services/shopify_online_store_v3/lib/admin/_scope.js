'use strict';

// Resolves the effective accessScopes for an incoming Admin GraphQL request.
//
// Resolution order:
//   1. If `authorization` header present → look up `saved.authTokens[token].scopes`.
//      If token unknown → empty scope set (will reject any scoped mutation).
//   2. Else fall back to `saved.appInstallation.accessScopes` (last-known-good).
//      This keeps `bin/shopify-bench` and non-auth smoke tests working.
function resolveScopes(saved, headers = {}) {
  const auth = headers.authorization || headers.Authorization || '';
  const m = /^bearer\s+(.+)$/i.exec(auth);
  if (m) {
    const entry = (saved.authTokens || {})[m[1].trim()];
    if (entry && Array.isArray(entry.scopes)) {
      return new Set(entry.scopes.map((s) => (typeof s === 'string' ? s : s?.handle)).filter(Boolean));
    }
    return new Set();
  }
  return new Set(((saved.appInstallation && saved.appInstallation.accessScopes) || []).map((s) => (typeof s === 'string' ? s : s?.handle)).filter(Boolean));
}

// Shopify-shape "access denied" GraphQL error.
// Real CLI output (from a live store missing write_publications, captured Tier
// 1B at .tmp/real-shopify-responses/05_publications.real.json):
//   {
//     "message": "Access denied for publications field. Required access: `read_publications` access scope.",
//     "locations": [{"line": 1, "column": 3}],
//     "extensions": {
//       "code": "ACCESS_DENIED",
//       "documentation": "https://shopify.dev/api/usage/access-scopes",
//       "requiredAccess": "`read_publications` access scope."
//     },
//     "path": ["publications"]
//   }
// Note `requiredAccess` is the BACKTICKED scope name followed by " access
// scope." — NOT just the bare handle. The `locations` line/col is hard-coded
// to {1,3}: real Shopify computes the field's literal source-doc position,
// but we don't parse the GraphQL document, so {1,3} (the typical opening of
// a top-level query) is the best stable approximation.
function accessDeniedError(fieldName, requiredScope) {
  return {
    message: `Access denied for ${fieldName} field. Required access: \`${requiredScope}\` access scope.`,
    locations: [{ line: 1, column: 3 }],
    extensions: {
      code: 'ACCESS_DENIED',
      documentation: 'https://shopify.dev/api/usage/access-scopes',
      requiredAccess: `\`${requiredScope}\` access scope.`
    },
    path: [fieldName]
  };
}

// `locations` field has a documented Shopify quirk (Tier 1B, 07_locations.real.json):
//   - message ends with `field.` (no "Required access" tail)
//   - extensions has NO `requiredAccess` key
// All other fields use accessDeniedError. We mirror the quirk only when
// rejecting the `locations` field so byte-level diffing against the captured
// real responses matches.
function accessDeniedErrorStripped(fieldName) {
  return {
    message: `Access denied for ${fieldName} field.`,
    locations: [{ line: 1, column: 3 }],
    extensions: { code: 'ACCESS_DENIED', documentation: 'https://shopify.dev/api/usage/access-scopes' },
    path: [fieldName]
  };
}

// Use as: `if (!requireScope(scopes, 'productSet', 'write_products', errors)) return null;`
// Pushes an error to `errors` and returns false when missing; returns true to proceed.
function requireScope(scopes, fieldName, requiredScope, errors) {
  if (scopes.has(requiredScope)) return true;
  errors.push(accessDeniedError(fieldName, requiredScope));
  return false;
}

// `locations`-quirk variant of requireScope (see accessDeniedErrorStripped).
function requireScopeStripped(scopes, fieldName, requiredScope, errors) {
  if (scopes.has(requiredScope)) return true;
  errors.push(accessDeniedErrorStripped(fieldName));
  return false;
}

module.exports = { resolveScopes, accessDeniedError, accessDeniedErrorStripped, requireScope, requireScopeStripped };
