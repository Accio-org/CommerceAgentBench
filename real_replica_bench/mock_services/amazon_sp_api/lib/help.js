/**
 * lib/help.js
 * Auto-generation of /api/help from the route registry.
 *
 * Route files export { namespace, routes }. server.js passes all loaded
 * namespaces here at startup. /api/help is then auto-derived — no manual
 * edits needed when adding Wave 1+ routes.
 */

/** @type {Array<{ namespace: object, routes: object[] }>} */
let _registeredNamespaces = [];

/** Bench control endpoint metadata (static). */
const BENCH_CONTROL = [
  { method: "GET", path: "/__bench/health", auth: null, description: "Service health + entity counts" },
  { method: "GET", path: "/__bench/state", auth: "Bearer MOCK_VERIFIER_TOKEN", description: "Full store snapshot for verifier scoring" },
  { method: "POST", path: "/__bench/seed", auth: "Bearer MOCK_VERIFIER_TOKEN", description: "Load seed JSON, reset + repopulate store" },
  { method: "POST", path: "/__bench/advance", auth: "Bearer MOCK_VERIFIER_TOKEN", description: "Advance virtual clock by N ms (Wave 3+)" },
  { method: "POST", path: "/__bench/reset", auth: "Bearer MOCK_VERIFIER_TOKEN", description: "Reset store to empty (preserves no data)" },
  { method: "GET", path: "/__bench/audit", auth: "Bearer MOCK_VERIFIER_TOKEN", description: "Return audit log (filter by entityType, since)" },
];

/** Policy endpoint metadata (static). */
const POLICY_ENDPOINTS = [
  { method: "GET", path: "/api/policies/marketplaces", description: "Marketplace metadata (id, country, currency, domain)" },
  { method: "GET", path: "/api/help", description: "This help document" },
];

/**
 * Register a batch of namespaces. Called by server.js at startup.
 * @param {Array<{ namespace: object, routes: object[] }>} namespaceModules
 */
export function registerNamespaces(namespaceModules) {
  _registeredNamespaces = namespaceModules;
}

/**
 * Build and return the /api/help payload.
 * @returns {object}
 */
export function buildHelp() {
  let totalEndpoints = 0;

  const namespaces = _registeredNamespaces.map(({ namespace, routes }) => {
    totalEndpoints += routes.length;
    return {
      name: namespace.name,
      version: namespace.version,
      base: namespace.base,
      casing: namespace.casing,
      wrapper: namespace.wrapper,
      endpoints: routes.map((r) => ({
        method: r.method,
        path: r.path,
        description: r.help?.description ?? "",
        params: r.help?.params ?? [],
      })),
    };
  });

  return {
    service: "Amazon Selling Partner API mock",
    version: "0.1.0-wave0",
    coverage: {
      namespaces: namespaces.length,
      endpoints: totalEndpoints,
    },
    namespaces,
    bench_control: BENCH_CONTROL,
    policies: POLICY_ENDPOINTS,
    note: "Auth (x-amz-access-token / AWS Sigv4) is not validated — any/absent value accepted. Rate limits are emitted as x-amzn-RateLimit-Limit headers but not enforced.",
  };
}
