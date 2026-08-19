/**
 * routes/catalog_items.js
 * Catalog Items API v2022-04-01 — namespace /catalog/2022-04-01
 *
 * Operations (2 total — the COMPLETE set for this API version, no others exist):
 *   GET /catalog/2022-04-01/items        — searchCatalogItems
 *   GET /catalog/2022-04-01/items/{asin} — getCatalogItem
 *
 * Spec source: catalogItems_2022-04-01.json swagger + fact sheet
 *   scratch/docs/api_alignment/amazon_spapi.md §Catalog Items API v2022-04-01
 *
 * Key alignment facts (enforced here):
 *   1. NO payload wrapper — response is the schema object directly.
 *   2. searchCatalogItems root: numberOfResults, pagination, refinements, items.
 *   3. Item.summaries[].itemName  (NOT productTitle / title / name)
 *   4. Item.summaries[].brand     (NOT brandName — brandName is only for BrandRefinement)
 *   5. Item.summaries[].color     (NOT colorByType / colorName)
 *   6. Pagination query param: pageToken (NOT nextToken); response has pagination.nextToken + pagination.previousToken
 *   7. marketplaceIds is REQUIRED, max 1 item.
 *   8. includedData is validated server-side as closed-set enum.
 *   9. No searchSuggestions, no categories, no competitiveSummary — those do not exist.
 *  10. Rate limit: 2 req/sec, burst 2.
 *  11. ASIN regex: ^[A-Z0-9]{10}$
 */

import { getCatalogItemByAsin, queryCatalog } from "../lib/store.js";
import { jsonOk, jsonError, parseArrayParam, parseIntParam } from "../lib/responses.js";
import { ValidationError, isASIN } from "../lib/validation/common.js";
import {
  VALID_INCLUDED_DATA,
  IDENTIFIERS_TYPES,
  CATALOG_MAX_PAGE_SIZE,
  CATALOG_DEFAULT_PAGE_SIZE,
  CATALOG_DEFAULT_INCLUDED_DATA,
} from "../lib/validation/catalog_items.js";
import { paginateCatalog, decodeCursor } from "../lib/pagination.js";

// Rate limit per fact sheet: 2 req/sec, burst 2.
const RATE_LIMIT = 2;

// ---------------------------------------------------------------------------
// Namespace descriptor (used by lib/help.js for /api/help auto-gen)
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Catalog Items",
  version: "2022-04-01",
  base: "/catalog/2022-04-01",
  casing: "camelCase",
  wrapper: "none (direct schema object)",
};

// ---------------------------------------------------------------------------
// includedData filter helper
// ---------------------------------------------------------------------------

/**
 * Project an Item from the store to only include sections named in includedData.
 * When a section is absent from includedData, the key is OMITTED entirely (not null/[]).
 * Default includedData is ["summaries"].
 *
 * @param {object} item - raw catalog item from store
 * @param {string[]} includedData - which sections to include
 * @returns {object} projected Item
 */
function projectItem(item, includedData) {
  const sections = new Set(includedData);
  const result = { asin: item.asin };

  // Each section: only add the key if the section is requested AND the item has data for it.
  if (sections.has("summaries") && Array.isArray(item.summaries)) {
    result.summaries = item.summaries;
  }
  if (sections.has("attributes") && item.attributes !== undefined) {
    result.attributes = item.attributes;
  }
  if (sections.has("classifications") && Array.isArray(item.classifications)) {
    result.classifications = item.classifications;
  }
  if (sections.has("dimensions") && Array.isArray(item.dimensions)) {
    result.dimensions = item.dimensions;
  }
  if (sections.has("identifiers") && Array.isArray(item.identifiers)) {
    result.identifiers = item.identifiers;
  }
  if (sections.has("images") && Array.isArray(item.images)) {
    result.images = item.images;
  }
  if (sections.has("productTypes") && Array.isArray(item.productTypes)) {
    result.productTypes = item.productTypes;
  }
  if (sections.has("relationships") && Array.isArray(item.relationships)) {
    result.relationships = item.relationships;
  }
  if (sections.has("salesRanks") && Array.isArray(item.salesRanks)) {
    result.salesRanks = item.salesRanks;
  }
  if (sections.has("vendorDetails") && Array.isArray(item.vendorDetails)) {
    result.vendorDetails = item.vendorDetails;
  }

  return result;
}

/**
 * Validate includedData array — all values must be in the closed set.
 * @param {string[]} data
 * @throws {ValidationError}
 */
function validateIncludedData(data) {
  for (const d of data) {
    if (!VALID_INCLUDED_DATA.has(d)) {
      const valid = [...VALID_INCLUDED_DATA].join(", ");
      throw new ValidationError(
        "InvalidParameterValue",
        `includedData value '${d}' is not valid. Valid values: ${valid}`,
        "includedData: invalid enum value"
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /catalog/2022-04-01/items — searchCatalogItems
 *
 * Required: marketplaceIds (max 1)
 * Optional: identifiers, identifiersType, includedData, locale, sellerId,
 *           keywords, brandNames, classificationIds, pageSize, pageToken, keywordsLocale
 *
 * Response: direct ItemSearchResults (no payload wrapper)
 *   { numberOfResults, pagination?, refinements?, items[] }
 */
async function handleSearchCatalogItems(req, _pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  // --- marketplaceIds (required, max 1) ---
  const marketplaceIds = parseArrayParam(sp.get("marketplaceIds"));
  if (marketplaceIds.length === 0) {
    return jsonError(
      400,
      "MissingParameter",
      "marketplaceIds is required.",
      "marketplaceIds: required parameter is missing",
      RATE_LIMIT
    );
  }
  if (marketplaceIds.length > 1) {
    return jsonError(
      400,
      "InvalidParameterValue",
      "marketplaceIds may contain at most 1 marketplace ID for this operation.",
      "marketplaceIds: max 1 item",
      RATE_LIMIT
    );
  }
  const marketplaceId = marketplaceIds[0];

  // --- includedData (optional, closed-set enum) ---
  const includedDataRaw = parseArrayParam(sp.get("includedData"));
  const includedData = includedDataRaw.length > 0 ? includedDataRaw : [...CATALOG_DEFAULT_INCLUDED_DATA];
  try {
    validateIncludedData(includedData);
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonError(400, err.spCode, err.spMessage, err.spDetails, RATE_LIMIT);
    }
    throw err;
  }

  // --- identifiers / identifiersType ---
  const identifiers = parseArrayParam(sp.get("identifiers"));
  const identifiersType = sp.get("identifiersType") ?? null;
  if (identifiers.length > 0 && !identifiersType) {
    return jsonError(
      400,
      "MissingParameter",
      "identifiersType is required when identifiers is provided.",
      "identifiersType: required when identifiers present",
      RATE_LIMIT
    );
  }
  if (identifiers.length > 20) {
    return jsonError(400, "InvalidParameterValue", "identifiers may contain at most 20 values.", undefined, RATE_LIMIT);
  }
  if (identifiersType && !IDENTIFIERS_TYPES.has(identifiersType)) {
    const valid = [...IDENTIFIERS_TYPES].join(", ");
    return jsonError(
      400,
      "InvalidParameterValue",
      `identifiersType '${identifiersType}' is not valid. Valid values: ${valid}`,
      "identifiersType: invalid enum value",
      RATE_LIMIT
    );
  }
  if (identifiersType === "SKU" && !sp.get("sellerId")) {
    return jsonError(
      400,
      "MissingParameter",
      "sellerId is required when identifiersType is SKU.",
      "sellerId: required when identifiersType=SKU",
      RATE_LIMIT
    );
  }

  // --- keywords ---
  const keywords = parseArrayParam(sp.get("keywords"));
  if (identifiers.length > 0 && keywords.length > 0) {
    return jsonError(
      400,
      "InvalidParameterValue",
      "identifiers and keywords are mutually exclusive.",
      "Cannot combine identifiers with keywords",
      RATE_LIMIT
    );
  }
  if (keywords.length > 20) {
    return jsonError(400, "InvalidParameterValue", "keywords may contain at most 20 values.", undefined, RATE_LIMIT);
  }

  // --- brandNames / classificationIds (mutually exclusive with identifiers) ---
  const brandNames = parseArrayParam(sp.get("brandNames"));
  const classificationIds = parseArrayParam(sp.get("classificationIds"));
  if (identifiers.length > 0 && (brandNames.length > 0 || classificationIds.length > 0)) {
    return jsonError(
      400,
      "InvalidParameterValue",
      "brandNames and classificationIds cannot be combined with identifiers.",
      "Cannot combine filter params with identifiers",
      RATE_LIMIT
    );
  }

  // --- pageSize ---
  const pageSize = parseIntParam(sp.get("pageSize"), CATALOG_DEFAULT_PAGE_SIZE, 1, CATALOG_MAX_PAGE_SIZE);

  // --- pageToken ---
  const pageToken = sp.get("pageToken") ?? null;

  // ----------------------------------------------------------------
  // Query the store
  // ----------------------------------------------------------------
  // When pageToken is present, it encodes the original filters — use them
  // from the cursor rather than re-reading params (real SP-API behavior).
  let queryFilters;
  if (pageToken) {
    try {
      const cursorState = decodeCursor(pageToken);
      queryFilters = cursorState.filters;
    } catch {
      return jsonError(400, "InvalidInput", "The pageToken is invalid or has expired.", undefined, RATE_LIMIT);
    }
  } else {
    queryFilters = {
      marketplaceId,
      identifiers: identifiers.length > 0 ? identifiers : undefined,
      identifiersType: identifiersType || undefined,
      keywords: keywords.length > 0 ? keywords : undefined,
      brandNames: brandNames.length > 0 ? brandNames : undefined,
      classificationIds: classificationIds.length > 0 ? classificationIds : undefined,
    };
  }

  const allMatched = queryCatalog(queryFilters);

  // Paginate
  const { page, pagination, total } = paginateCatalog(allMatched, queryFilters, pageSize, pageToken);

  // Project each item to only include requested sections
  const projectedItems = page.map((item) => projectItem(item, includedData));

  // Build refinements for keyword searches
  let refinements;
  if (keywords.length > 0 && allMatched.length > 0) {
    // Aggregate brands from all matched items' summaries
    const brandCounts = new Map();
    const classifCounts = new Map();
    for (const item of allMatched) {
      if (!Array.isArray(item.summaries)) continue;
      for (const s of item.summaries) {
        if (s.brand) {
          brandCounts.set(s.brand, (brandCounts.get(s.brand) ?? 0) + 1);
        }
        if (s.browseClassification) {
          const key = s.browseClassification.classificationId;
          const display = s.browseClassification.displayName;
          const existing = classifCounts.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            classifCounts.set(key, { count: 1, displayName: display });
          }
        }
      }
    }
    refinements = {
      brands: [...brandCounts.entries()]
        .map(([brandName, numberOfResults]) => ({ numberOfResults, brandName }))
        .sort((a, b) => b.numberOfResults - a.numberOfResults),
      classifications: [...classifCounts.entries()]
        .map(([classificationId, { count, displayName }]) => ({
          numberOfResults: count,
          displayName,
          classificationId,
        }))
        .sort((a, b) => b.numberOfResults - a.numberOfResults),
    };
  }

  // Build response — direct ItemSearchResults (no payload wrapper)
  const responseBody = {
    numberOfResults: total,
    ...(pagination ? { pagination } : {}),
    ...(refinements ? { refinements } : {}),
    items: projectedItems,
  };

  return jsonOk(responseBody, { rateLimit: RATE_LIMIT });
}

/**
 * GET /catalog/2022-04-01/items/{asin} — getCatalogItem
 *
 * Required: asin (path param), marketplaceIds (query, one or more)
 * Optional: includedData, locale
 *
 * Response: direct Item object (no payload wrapper)
 */
async function handleGetCatalogItem(req, pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const { asin } = pathParams;

  // Validate ASIN format
  if (!isASIN(asin)) {
    return jsonError(
      400,
      "InvalidParameterValue",
      `ASIN '${asin}' is invalid. ASINs must match ^[A-Z0-9]{10}$.`,
      "asin: invalid format",
      RATE_LIMIT
    );
  }

  // --- marketplaceIds (required) ---
  const marketplaceIds = parseArrayParam(sp.get("marketplaceIds"));
  if (marketplaceIds.length === 0) {
    return jsonError(
      400,
      "MissingParameter",
      "marketplaceIds is required.",
      "marketplaceIds: required parameter is missing",
      RATE_LIMIT
    );
  }

  // --- includedData (optional, closed-set) ---
  const includedDataRaw = parseArrayParam(sp.get("includedData"));
  const includedData = includedDataRaw.length > 0 ? includedDataRaw : [...CATALOG_DEFAULT_INCLUDED_DATA];
  try {
    validateIncludedData(includedData);
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonError(400, err.spCode, err.spMessage, err.spDetails, RATE_LIMIT);
    }
    throw err;
  }

  // Look up item
  const item = getCatalogItemByAsin(asin);
  if (!item) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Item with ASIN '${asin}' not found.`,
      undefined,
      RATE_LIMIT
    );
  }

  // Filter summaries (and other per-marketplace sections) to only requested marketplaces
  const mids = new Set(marketplaceIds);
  const filteredItem = filterItemByMarketplaces(item, mids);

  // Project to requested sections
  const projected = projectItem(filteredItem, includedData);

  // Response: direct Item object (no payload wrapper)
  return jsonOk(projected, { rateLimit: RATE_LIMIT });
}

/**
 * Filter per-marketplace arrays in an item to only include entries for
 * the requested marketplace IDs.
 * If none of the requested marketplaces match, we still return the item
 * (with empty arrays) — the caller asked for it specifically.
 *
 * @param {object} item
 * @param {Set<string>} mids - requested marketplace IDs
 * @returns {object}
 */
function filterItemByMarketplaces(item, mids) {
  const filtered = { ...item };

  const sectionArrays = [
    "summaries", "classifications", "dimensions", "identifiers",
    "images", "productTypes", "relationships", "salesRanks", "vendorDetails",
  ];
  for (const section of sectionArrays) {
    if (Array.isArray(item[section])) {
      filtered[section] = item[section].filter((entry) => mids.has(entry.marketplaceId));
    }
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Route registry — shape required by server.js and lib/help.js
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "GET",
    path: "/catalog/2022-04-01/items",
    handler: handleSearchCatalogItems,
    help: {
      description:
        "Search for items in the Amazon catalog. Required: marketplaceIds (max 1). Returns ItemSearchResults with numberOfResults, pagination, refinements, items.",
      params: [
        { name: "marketplaceIds", type: "string[]", required: true, note: "Max 1 item" },
        { name: "identifiers", type: "string[]", required: false, note: "Max 20; mutually exclusive with keywords" },
        { name: "identifiersType", type: "string enum", required: false, note: "Required if identifiers present. Values: ASIN, EAN, GTIN, ISBN, JAN, MINSAN, SKU, UPC" },
        { name: "includedData", type: "string[]", required: false, note: "Default: summaries. Values: attributes, classifications, dimensions, identifiers, images, productTypes, relationships, salesRanks, summaries, vendorDetails" },
        { name: "locale", type: "string", required: false },
        { name: "sellerId", type: "string", required: false, note: "Required if identifiersType=SKU" },
        { name: "keywords", type: "string[]", required: false, note: "Max 20; mutually exclusive with identifiers" },
        { name: "brandNames", type: "string[]", required: false },
        { name: "classificationIds", type: "string[]", required: false },
        { name: "pageSize", type: "integer", required: false, note: "Max 20, default 10" },
        { name: "pageToken", type: "string", required: false, note: "Pagination token from pagination.nextToken or pagination.previousToken" },
        { name: "keywordsLocale", type: "string", required: false },
      ],
    },
  },
  {
    method: "GET",
    path: "/catalog/2022-04-01/items/:asin",
    handler: handleGetCatalogItem,
    help: {
      description:
        "Retrieves details for an item in the Amazon catalog. Path param: asin (10-char ^[A-Z0-9]{10}$). Required query: marketplaceIds. Returns direct Item object.",
      params: [
        { name: "asin", type: "string", required: true, note: "Path parameter. Must match ^[A-Z0-9]{10}$" },
        { name: "marketplaceIds", type: "string[]", required: true },
        { name: "includedData", type: "string[]", required: false, note: "Default: summaries" },
        { name: "locale", type: "string", required: false },
      ],
    },
  },
];
