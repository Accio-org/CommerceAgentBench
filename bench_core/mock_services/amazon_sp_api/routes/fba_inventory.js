/**
 * routes/fba_inventory.js
 * FBA Inventory API v1 — namespace /fba/inventory/v1
 *
 * Operations (1 production endpoint; 3 sandbox-only ops are NOT implemented):
 *   GET /fba/inventory/v1/summaries  — getInventorySummaries
 *
 * Sandbox-only ops NOT implemented (use /__bench/seed for injection):
 *   POST   /fba/inventory/v1/items          — createInventoryItem
 *   DELETE /fba/inventory/v1/items/{sku}    — deleteInventoryItem
 *   POST   /fba/inventory/v1/items/inventory — addInventory
 *
 * Spec source: fbaInventory.json swagger + fact sheet
 *   scratch/docs/api_alignment/amazon_spapi.md §FBA Inventory API v1
 *
 * Critical alignment facts enforced here:
 *  1. Field casing: camelCase everywhere (asin, fnSku, sellerSku, inventoryDetails).
 *     This is the OPPOSITE of Orders v0 (PascalCase).
 *  2. pagination is a SIBLING of payload, NOT nested inside it:
 *     { "payload": {...}, "pagination": {"nextToken": "..."}, "errors": [] }
 *  3. nextToken is camelCase in both query param and pagination.nextToken.
 *  4. When details=false, inventoryDetails is COMPLETELY OMITTED (key absent).
 *  5. granularityType only valid value: "Marketplace" (server-side validated).
 *  6. marketplaceIds max 1 item (real Amazon restriction).
 *  7. researchingQuantity and unfulfillableQuantity are NESTED OBJECTS, not integers.
 *  8. Rate limit: 2 req/sec, burst 2.
 */

import {
  queryInventorySummaries,
  getAllOrders,
} from "../lib/store.js";
import {
  jsonOk,
  jsonError,
  parseArrayParam,
  parseBoolParam,
} from "../lib/responses.js";
import { ValidationError } from "../lib/validation/common.js";
import { GRANULARITY_TYPES } from "../lib/validation/fba_inventory.js";
import { paginate } from "../lib/pagination.js";

const RATE_LIMIT = 2;
const DEFAULT_PAGE_SIZE = 50;
const MAX_SELLER_SKUS = 50;

// ---------------------------------------------------------------------------
// Namespace descriptor
// ---------------------------------------------------------------------------

export const namespace = {
  name: "FBA Inventory",
  version: "v1",
  base: "/fba/inventory/v1",
  casing: "camelCase",
  wrapper: '{"payload": ..., "pagination": {...}, "errors": []}',
};

// ---------------------------------------------------------------------------
// Helper: project an inventory summary to the wire shape
// ---------------------------------------------------------------------------

/**
 * Project a stored inventory record to the InventorySummary wire shape.
 * When includeDetails=false, inventoryDetails is omitted entirely.
 *
 * @param {object} inv - raw inventory record from store
 * @param {boolean} includeDetails - whether to include inventoryDetails
 * @returns {object} InventorySummary
 */
function projectInventorySummary(inv, includeDetails) {
  const out = {
    asin: inv.asin,                  // lowercase — FBA Inventory casing rule
    fnSku: inv.fnSku,
    sellerSku: inv.sellerSku,
    condition: inv.condition,
    lastUpdatedTime: inv.lastUpdatedTime,
    productName: inv.productName,
    totalQuantity: inv.totalQuantity || 0,
    stores: inv.stores || [],
  };

  if (includeDetails && inv.inventoryDetails) {
    out.inventoryDetails = inv.inventoryDetails;
  }
  // When includeDetails=false: inventoryDetails key is COMPLETELY ABSENT

  return out;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /fba/inventory/v1/summaries — getInventorySummaries
 *
 * Required query params: granularityType, granularityId, marketplaceIds
 * Optional: details, startDateTime, sellerSkus, sellerSku, nextToken
 *
 * Rate limit: 2 req/sec, burst 2.
 */
async function handleGetInventorySummaries(req, _pathParams) {
  const url = new URL(req.url);
  const q = url.searchParams;

  // --- Required params ---
  const granularityType = q.get("granularityType");
  if (!granularityType) {
    return jsonError(
      400,
      "MissingParameter",
      "granularityType is required.",
      "granularityType: required parameter is missing",
      RATE_LIMIT
    );
  }

  // Server-side validate granularityType enum (only "Marketplace" is valid in prod)
  if (!GRANULARITY_TYPES.has(granularityType)) {
    return jsonError(
      400,
      "InvalidInput",
      `Invalid granularityType: '${granularityType}'. Only 'Marketplace' is supported.`,
      `granularityType must be one of: ${[...GRANULARITY_TYPES].join(", ")}`,
      RATE_LIMIT
    );
  }

  const granularityId = q.get("granularityId");
  if (!granularityId) {
    return jsonError(
      400,
      "MissingParameter",
      "granularityId is required.",
      "granularityId: required parameter is missing",
      RATE_LIMIT
    );
  }

  // marketplaceIds — max 1 item
  const marketplaceIdsRaw = [];
  for (const v of q.getAll("marketplaceIds")) {
    for (const part of v.split(",")) {
      if (part.trim()) marketplaceIdsRaw.push(part.trim());
    }
  }
  if (marketplaceIdsRaw.length === 0) {
    return jsonError(
      400,
      "MissingParameter",
      "marketplaceIds is required.",
      "marketplaceIds: required parameter is missing",
      RATE_LIMIT
    );
  }
  if (marketplaceIdsRaw.length > 1) {
    return jsonError(
      400,
      "InvalidInput",
      "marketplaceIds accepts a maximum of 1 marketplace ID.",
      "marketplaceIds: max 1 item",
      RATE_LIMIT
    );
  }

  const marketplaceId = marketplaceIdsRaw[0];

  // --- Optional params ---
  const details = parseBoolParam(q.get("details"));
  const startDateTime = q.get("startDateTime") || null;
  const nextToken = q.get("nextToken") || null;

  // sellerSkus (array, max 50) vs sellerSku (single — ignored if sellerSkus set)
  const sellerSkusRaw = [];
  for (const v of q.getAll("sellerSkus")) {
    for (const part of v.split(",")) {
      if (part.trim()) sellerSkusRaw.push(part.trim());
    }
  }
  const sellerSku = q.get("sellerSku") || null;

  let sellerSkus = [];
  if (sellerSkusRaw.length > 0) {
    if (sellerSkusRaw.length > MAX_SELLER_SKUS) {
      return jsonError(
        400,
        "InvalidInput",
        `sellerSkus accepts a maximum of ${MAX_SELLER_SKUS} SKUs.`,
        `sellerSkus: ${sellerSkusRaw.length} provided, max ${MAX_SELLER_SKUS}`,
        RATE_LIMIT
      );
    }
    sellerSkus = sellerSkusRaw;
  } else if (sellerSku) {
    // Single SKU — treat as 1-item array
    sellerSkus = [sellerSku];
  }

  // Use granularityId as a stand-in for sellerId (single-seller mock)
  // The real mock's inventory is keyed by sellerId:marketplaceId:sku
  // We look up the default seller from the store
  const DEFAULT_SELLER_ID = "A2BENCH00001";

  const filters = {
    ...(sellerSkus.length > 0 ? { sellerSkus } : {}),
    ...(startDateTime ? { startDateTime } : {}),
  };

  // When nextToken is supplied, decode pagination state
  let offset = 0;
  let cachedFilters = filters;
  if (nextToken) {
    try {
      const { decodeCursor } = await import("../lib/pagination.js");
      const decoded = decodeCursor(nextToken);
      offset = decoded.offset;
      // Use encoded filters to ignore re-passed params (token overrides)
      if (decoded.filters) cachedFilters = decoded.filters;
    } catch {
      return jsonError(
        400,
        "InvalidInput",
        "The pagination token is invalid or has expired.",
        "nextToken: malformed cursor",
        RATE_LIMIT
      );
    }
  }

  const allSummaries = queryInventorySummaries(DEFAULT_SELLER_ID, marketplaceId, cachedFilters);
  const projected = allSummaries.map((inv) => projectInventorySummary(inv, details));

  // Paginate — using generic paginate() with camelCase tokenKey
  const { encodeCursor } = await import("../lib/pagination.js");
  const page = projected.slice(offset, offset + DEFAULT_PAGE_SIZE);
  const nextOffset = offset + DEFAULT_PAGE_SIZE;
  const hasMore = nextOffset < projected.length;
  const outToken = hasMore
    ? encodeCursor({ offset: nextOffset, filters: cachedFilters })
    : undefined;

  // FBA Inventory response shape:
  // { "payload": { "granularity": {...}, "inventorySummaries": [...] }, "pagination": {...}, "errors": [] }
  // Note: pagination is a SIBLING of payload, NOT inside payload.
  const responseBody = {
    payload: {
      granularity: {
        granularityType,
        granularityId,
      },
      inventorySummaries: page,
    },
    ...(outToken ? { pagination: { nextToken: outToken } } : { pagination: {} }),
    errors: [],
  };

  return jsonOk(responseBody, { rateLimit: RATE_LIMIT });
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "GET",
    path: "/fba/inventory/v1/summaries",
    handler: handleGetInventorySummaries,
    help: {
      description:
        "Returns a list of inventory summaries. granularityType, granularityId, marketplaceIds required. " +
        "pagination is a SIBLING of payload (not nested). nextToken is camelCase. " +
        "When details=true, inventoryDetails is included per summary. Rate: 2 req/sec.",
      params: [
        { name: "granularityType", in: "query", required: true, description: "Only 'Marketplace' is valid in production" },
        { name: "granularityId", in: "query", required: true, description: "Marketplace ID" },
        { name: "marketplaceIds", in: "query", required: true, description: "Max 1 item" },
        { name: "details", in: "query", description: "boolean; includes inventoryDetails when true" },
        { name: "startDateTime", in: "query" },
        { name: "sellerSkus", in: "query", description: "Max 50 SKUs" },
        { name: "sellerSku", in: "query", description: "Single SKU; ignored if sellerSkus is set" },
        { name: "nextToken", in: "query", description: "Pagination token (camelCase)" },
      ],
    },
  },
];
