/**
 * server.js — Amazon SP-API mock, Wave 3b
 *
 * Architecture:
 *   - Route Registry: each routes/*.js exports { namespace, routes[] }
 *   - Central store (lib/store.js) holds all entity state; routes read via
 *     exported accessors, write via mutate()
 *   - Bench control endpoints (bench/*.js) for verifier integration
 *   - /api/help auto-generated from route registry (lib/help.js)
 *   - Auth: x-amz-access-token accepted as any/absent value (CCB convention)
 *
 * Wave 0 namespaces:
 *   - Sellers v1:             GET /sellers/v1/marketplaceParticipations
 *                             GET /sellers/v1/account
 *   - Catalog Items v2022-04-01: GET /catalog/2022-04-01/items
 *                                GET /catalog/2022-04-01/items/{asin}
 *
 * Wave 1 namespaces:
 *   - Listings Items v2021-08-01
 *   - Product Pricing v0
 *   - Product Pricing v2022-05-01
 *   - Product Fees v0
 *
 * Wave 2 namespaces:
 *   - Orders v0:              10 endpoints
 *   - FBA Inventory v1:       1 endpoint (getInventorySummaries)
 *   - Feeds v2021-06-30:      6 endpoints
 *
 * Wave 3a namespaces:
 *   - Finances v0:            4 endpoints
 *
 * Wave 3b namespaces:
 *   - Reports v2021-06-30:    9 endpoints
 *
 * To add a new namespace (Wave N): create routes/<namespace>.js, import it
 * below, add to ROUTE_MODULES array — zero other changes needed.
 *
 * Feed document upload URL:    PUT /__bench/feed_documents/{feedDocumentId}/upload
 * Feed document download URL:  GET /__bench/feed_documents/{feedDocumentId}/download
 * Report document serving URL: GET /_documents/{reportDocumentId}
 *   (PUBLIC — no auth required, behaves like a pre-signed URL)
 *   Serves gzipped TSV by default; ?nocompress=1 returns plain UTF-8 TSV.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// --- lib imports ---
import { loadSeed, entityCounts } from "./lib/store.js";
import { handleError } from "./lib/responses.js";
import { buildHelp, registerNamespaces } from "./lib/help.js";

// --- route modules (Wave 0: Sellers + Catalog Items) ---
import * as sellers from "./routes/sellers.js";
import * as catalogItems from "./routes/catalog_items.js";

// --- route modules (Wave 1: Listings Items + Product Pricing v0/v2022 + Product Fees) ---
import * as listingsItems from "./routes/listings_items.js";
import * as productPricing from "./routes/product_pricing.js";
import * as productPricing2022 from "./routes/product_pricing_2022.js";
import * as productFees from "./routes/product_fees.js";

// --- route modules (Wave 2: Orders v0 + FBA Inventory v1 + Feeds v2021-06-30) ---
import * as orders from "./routes/orders.js";
import * as fbaInventory from "./routes/fba_inventory.js";
import * as feeds from "./routes/feeds.js";

// --- route modules (Wave 3a: Finances v0) ---
import * as finances from "./routes/finances.js";

// --- route modules (Wave 3b: Reports v2021-06-30) ---
import * as reports from "./routes/reports.js";

// --- Wave 2 store accessors for feed document upload handler ---
// --- Wave 3b store accessor for report document serving ---
import { mutate, getFeedDocument, getReportDocument } from "./lib/store.js";

// --- bench control handlers ---
import { handleHealth } from "./bench/health.js";
import { handleState } from "./bench/state.js";
import { handleSeed } from "./bench/seed.js";
import { handleAdvance } from "./bench/advance.js";
import { handleReset } from "./bench/reset.js";
import { handleAudit } from "./bench/audit.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MOCK_PORT = parseInt(process.env.MOCK_PORT ?? process.env.PORT ?? "4000", 10);
const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN ?? "bench-verifier";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Route registry & registration
// ---------------------------------------------------------------------------

/**
 * All namespace route modules, in import order.
 * Wave N: add import above, push here.
 * @type {Array<{ namespace: object, routes: object[] }>}
 */
const ROUTE_MODULES = [
  sellers,
  catalogItems,
  listingsItems,
  productPricing,
  productPricing2022,
  productFees,
  // Wave 2
  orders,
  fbaInventory,
  feeds,
  // Wave 3a
  finances,
  // Wave 3b
  reports,
];

// Register with help.js (auto-generates /api/help).
registerNamespaces(ROUTE_MODULES);

/**
 * Flat route table: { method, path, regex, paramNames, handler }
 * Built once at startup from ROUTE_MODULES.
 *
 * Pattern matching converts "/catalog/2022-04-01/items/:asin" to a RegExp
 * and extracts named path params.
 */
const ROUTE_TABLE = buildRouteTable(ROUTE_MODULES);

/**
 * Build the flat route lookup table from namespace modules.
 * @param {typeof ROUTE_MODULES} modules
 */
function buildRouteTable(modules) {
  const table = [];
  for (const mod of modules) {
    for (const route of mod.routes) {
      const { regex, paramNames } = pathToRegex(route.path);
      table.push({
        method: route.method.toUpperCase(),
        path: route.path,
        regex,
        paramNames,
        handler: route.handler,
      });
    }
  }
  return table;
}

/**
 * Convert an Express-style path (e.g. "/catalog/2022-04-01/items/:asin")
 * to a RegExp + list of param names.
 *
 * @param {string} path
 * @returns {{ regex: RegExp, paramNames: string[] }}
 */
function pathToRegex(path) {
  const paramNames = [];
  const escaped = path
    .replace(/\./g, "\\.")          // escape literal dots in version strings (2022-04-01)
    .replace(/-/g, "\\-")           // escape literal hyphens
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";             // capture group for path param value
    });
  return { regex: new RegExp(`^${escaped}$`), paramNames };
}

// ---------------------------------------------------------------------------
// Policies — served statically from policies/*.json
// ---------------------------------------------------------------------------

const MARKETPLACES_POLICY = JSON.parse(
  readFileSync(join(__dirname, "policies/marketplaces.json"), "utf-8")
);

// ---------------------------------------------------------------------------
// Boot: load default seed
// ---------------------------------------------------------------------------

function bootSeed() {
  try {
    const seed = JSON.parse(
      readFileSync(join(__dirname, "seeds/default.json"), "utf-8")
    );
    loadSeed(seed);
  } catch (err) {
    console.error("[mock] Failed to load default seed:", err);
  }
}

bootSeed();

// ---------------------------------------------------------------------------
// Request dispatch
// ---------------------------------------------------------------------------

/**
 * Match an incoming (method, pathname) against the route table.
 * Returns { handler, pathParams } or null.
 */
function matchRoute(method, pathname) {
  for (const entry of ROUTE_TABLE) {
    if (entry.method !== method) continue;
    const m = pathname.match(entry.regex);
    if (!m) continue;
    const pathParams = {};
    entry.paramNames.forEach((name, i) => {
      pathParams[name] = decodeURIComponent(m[i + 1]);
    });
    return { handler: entry.handler, pathParams };
  }
  return null;
}

/**
 * Main Bun.serve fetch handler.
 * Handles:
 *   - /__bench/* — bench control (no SP-API casing rules apply)
 *   - /api/help, /api/policies/* — utility endpoints
 *   - SP-API routes from ROUTE_TABLE
 */
async function fetch(req) {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method.toUpperCase();

  try {
    // ----------------------------------------------------------------
    // Bench control endpoints
    // ----------------------------------------------------------------
    if (pathname === "/__bench/health" && method === "GET") {
      return handleHealth(req);
    }
    if (pathname === "/__bench/state" && method === "GET") {
      return handleState(req, { verifierToken: VERIFIER_TOKEN });
    }
    if (pathname === "/__bench/seed" && method === "POST") {
      return handleSeed(req, { verifierToken: VERIFIER_TOKEN });
    }
    if (pathname === "/__bench/advance" && method === "POST") {
      return handleAdvance(req, { verifierToken: VERIFIER_TOKEN });
    }
    if (pathname === "/__bench/reset" && method === "POST") {
      return handleReset(req, { verifierToken: VERIFIER_TOKEN });
    }
    if (pathname === "/__bench/audit" && method === "GET") {
      return handleAudit(req, { verifierToken: VERIFIER_TOKEN });
    }

    // ----------------------------------------------------------------
    // Feed document upload/download (Wave 2 mock-local S3 substitute)
    // Agents PUT feed content to /__bench/feed_documents/{id}/upload
    // Agents GET result content from /__bench/feed_documents/{id}/download
    // ----------------------------------------------------------------
    const feedUploadMatch = pathname.match(/^\/__bench\/feed_documents\/([^/]+)\/upload$/);
    if (feedUploadMatch && method === "PUT") {
      const feedDocumentId = decodeURIComponent(feedUploadMatch[1]);
      const doc = getFeedDocument(feedDocumentId);
      if (!doc) {
        return new Response(
          JSON.stringify({ errors: [{ code: "ResourceNotFound", message: `Feed document '${feedDocumentId}' not found.` }] }),
          { status: 404, headers: { "content-type": "application/json" } }
        );
      }
      const content = await req.text();
      mutate("feed_document", "store_upload", {
        feedDocumentId,
        _content: content,
      });
      return new Response("", { status: 200 });
    }

    const feedDownloadMatch = pathname.match(/^\/__bench\/feed_documents\/([^/]+)\/download$/);
    if (feedDownloadMatch && method === "GET") {
      const feedDocumentId = decodeURIComponent(feedDownloadMatch[1]);
      const doc = getFeedDocument(feedDocumentId);
      if (!doc) {
        return new Response(
          JSON.stringify({ errors: [{ code: "ResourceNotFound", message: `Feed document '${feedDocumentId}' not found.` }] }),
          { status: 404, headers: { "content-type": "application/json" } }
        );
      }
      const content = doc._content || doc._uploadedContent || "";
      return new Response(content, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    // ----------------------------------------------------------------
    // Report document serving — Wave 3b PUBLIC path (no auth).
    // This is the "pre-signed URL" target that getReportDocument points to.
    // GET /_documents/{reportDocumentId}[?nocompress=1]
    //   Without ?nocompress=1 → gzip-compressed TSV (application/octet-stream)
    //   With    ?nocompress=1 → plain UTF-8 TSV (text/tab-separated-values)
    // ----------------------------------------------------------------
    const reportDocMatch = pathname.match(/^\/_documents\/([^/]+)$/);
    if (reportDocMatch && method === "GET") {
      const reportDocumentId = decodeURIComponent(reportDocMatch[1]);
      const doc = getReportDocument(reportDocumentId);
      if (!doc) {
        return new Response(
          JSON.stringify({ errors: [{ code: "ResourceNotFound", message: `Report document '${reportDocumentId}' not found.` }] }),
          { status: 404, headers: { "content-type": "application/json" } }
        );
      }
      const tsvContent = doc._content || "";
      const noCompress = url.searchParams.get("nocompress") === "1";
      if (noCompress) {
        // Plain UTF-8 TSV — useful for smoke tests and agents that skip decompression
        return new Response(tsvContent, {
          status: 200,
          headers: { "content-type": "text/tab-separated-values; charset=utf-8" },
        });
      } else {
        // Gzip the TSV content — agents must gunzip before parsing
        const encoder = new TextEncoder();
        const tsvBytes = encoder.encode(tsvContent);
        const gzipped = Bun.gzipSync(tsvBytes);
        return new Response(gzipped, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }
    }

    // ----------------------------------------------------------------
    // Utility / policy endpoints
    // ----------------------------------------------------------------
    if (pathname === "/api/help" && method === "GET") {
      return new Response(JSON.stringify(buildHelp()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (pathname === "/api/policies/marketplaces" && method === "GET") {
      return new Response(JSON.stringify(MARKETPLACES_POLICY), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // ----------------------------------------------------------------
    // SP-API routes (from ROUTE_TABLE)
    // ----------------------------------------------------------------
    const match = matchRoute(method, pathname);
    if (match) {
      return await match.handler(req, match.pathParams);
    }

    // 404 — unknown path
    return new Response(
      JSON.stringify({
        errors: [
          {
            code: "ResourceNotFound",
            message: `No route for ${method} ${pathname}`,
            details: "See GET /api/help for available endpoints.",
          },
        ],
      }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

const counts = entityCounts();
const help = buildHelp();
console.log(
  `[mock] Amazon SP-API v0.5.0-wave3b listening on :${MOCK_PORT} ` +
  `(namespaces=${help.coverage.namespaces} endpoints=${help.coverage.endpoints} ` +
  `entities=marketplaces:${counts.marketplaces},sellers:${counts.sellers},` +
  `catalog:${counts.catalog},listings:${counts.listings},pricingOffers:${counts.pricingOffers},` +
  `orders:${counts.orders},inventorySummaries:${counts.inventorySummaries},` +
  `feeds:${counts.feeds},feedDocuments:${counts.feedDocuments},` +
  `financialEventGroups:${counts.financialEventGroups},financialEvents:${counts.financialEvents},` +
  `reports:${counts.reports},reportDocuments:${counts.reportDocuments},reportSchedules:${counts.reportSchedules})`
);

// ---------------------------------------------------------------------------
// Bun.serve
// ---------------------------------------------------------------------------
//
// NOTE: export the server config object (NOT the result of Bun.serve(...)).
// Bun's module loader auto-serves a default export that exposes `fetch`, so
// `export default Bun.serve({...})` binds the port twice (once explicitly, once
// via the loader) and crashes with EADDRINUSE on bun 1.3.5 (the workstation
// image runtime). Exporting the plain {port, fetch} config serves exactly once
// across bun versions.

export default { port: MOCK_PORT, fetch };
