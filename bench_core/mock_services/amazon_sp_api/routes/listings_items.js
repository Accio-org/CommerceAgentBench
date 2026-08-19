/**
 * routes/listings_items.js
 * Listings Items API v2021-08-01 — namespace /listings/2021-08-01
 *
 * Operations (5 total — the COMPLETE set for this API version):
 *   GET    /listings/2021-08-01/items/{sellerId}/{sku}  — getListingsItem
 *   PUT    /listings/2021-08-01/items/{sellerId}/{sku}  — putListingsItem
 *   PATCH  /listings/2021-08-01/items/{sellerId}/{sku}  — patchListingsItem
 *   DELETE /listings/2021-08-01/items/{sellerId}/{sku}  — deleteListingsItem
 *   GET    /listings/2021-08-01/items/{sellerId}        — searchListingsItems
 *
 * Spec source: listingsItems_2021-08-01.json swagger + fact sheet
 *   scratch/docs/api_alignment/amazon_spapi.md §Listings Items API v2021-08-01
 *
 * Key alignment facts enforced here:
 *  1. NO payload wrapper — all responses are direct schema objects.
 *  2. PUT = full overwrite; PATCH = JSON Patch RFC 6902 + non-standard "merge".
 *  3. PATCH op enum: ["add", "replace", "merge", "delete"] — server-side validated.
 *     "move", "copy", "test" are RFC 6902 but NOT in this API — reject with 400.
 *  4. ListingsItemSubmissionResponse.status is a SCALAR ("ACCEPTED"/"INVALID"/"VALID").
 *  5. ItemSummaryByMarketplace.status is an ARRAY (["BUYABLE", "DISCOVERABLE"]).
 *  6. conditionType uses lowercase_underscore (new_new, used_like_new) — not PascalCase.
 *  7. searchListingsItems pagination: query param is "pageToken", response has
 *     pagination.nextToken / pagination.previousToken inside ItemSearchResults.
 *  8. All field names are camelCase in this namespace.
 *  9. marketplaceIds max 1 per call for single-item ops; multiple OK for search.
 * 10. Rate limit: 5 req/sec, burst 10 (or 5 for PATCH/DELETE/search per fact sheet).
 */

import { randomUUID } from "crypto";
import {
  mutate,
  getListingBySMK,
  listingKey,
  queryListings,
} from "../lib/store.js";
import { jsonOk, jsonError, parseArrayParam, parseIntParam } from "../lib/responses.js";
import { ValidationError, isMarketplaceId } from "../lib/validation/common.js";
import {
  PATCH_OPS,
  LISTINGS_INCLUDED_DATA,
  LISTINGS_PUT_INCLUDED_DATA,
  LISTINGS_DEFAULT_INCLUDED_DATA,
  LISTINGS_MAX_PAGE_SIZE,
  LISTINGS_DEFAULT_PAGE_SIZE,
  CONDITION_TYPES,
  SORT_BY,
  SORT_ORDER,
} from "../lib/validation/listings.js";
import { paginateCatalog, decodeCursor } from "../lib/pagination.js";

// Rate limits per fact sheet
const RATE_LIMIT_GET = 5;
const RATE_LIMIT_PUT = 5;
const RATE_LIMIT_PATCH = 5;
const RATE_LIMIT_DELETE = 5;
const RATE_LIMIT_SEARCH = 5;

// ---------------------------------------------------------------------------
// Namespace descriptor
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Listings Items",
  version: "2021-08-01",
  base: "/listings/2021-08-01",
  casing: "camelCase",
  wrapper: "none (direct schema object)",
};

// ---------------------------------------------------------------------------
// Helper: project a listing record to requested includedData sections
// ---------------------------------------------------------------------------

/**
 * Project a raw listing record to the Item shape with only requested sections.
 * When a section is absent from includedData, the key is OMITTED entirely.
 *
 * @param {object} record - raw listing from store
 * @param {string[]} includedData
 * @returns {object} projected Item
 */
function projectListing(record, includedData) {
  const sections = new Set(includedData);
  const result = { sku: record.sku };

  if (sections.has("summaries") && Array.isArray(record.summaries)) {
    result.summaries = record.summaries;
  }
  if (sections.has("attributes") && record.attributes !== undefined) {
    result.attributes = record.attributes;
  }
  if (sections.has("issues") && Array.isArray(record.issues)) {
    result.issues = record.issues;
  }
  if (sections.has("offers") && Array.isArray(record.offers)) {
    result.offers = record.offers;
  }
  if (sections.has("fulfillmentAvailability") && Array.isArray(record.fulfillmentAvailability)) {
    result.fulfillmentAvailability = record.fulfillmentAvailability;
  }
  if (sections.has("procurement") && Array.isArray(record.procurement)) {
    result.procurement = record.procurement;
  }
  if (sections.has("relationships") && Array.isArray(record.relationships)) {
    result.relationships = record.relationships;
  }
  if (sections.has("productTypes") && Array.isArray(record.productTypes)) {
    result.productTypes = record.productTypes;
  }

  return result;
}

/**
 * Build a minimal ItemSummaryByMarketplace from a listing record + marketplace.
 * Used when constructing new/updated listings.
 *
 * @param {object} record
 * @param {string} marketplaceId
 * @returns {object}
 */
function buildSummary(record, marketplaceId) {
  return {
    marketplaceId,
    productType: record.productType || "GENERIC",
    conditionType: record.conditionType || "new_new",
    // status is always an ARRAY in ItemSummaryByMarketplace (fact sheet #4)
    status: record.status || ["DISCOVERABLE"],
    ...(record.asin ? { asin: record.asin } : {}),
    ...(record.itemName ? { itemName: record.itemName } : {}),
    ...(record.fnSku ? { fnSku: record.fnSku } : {}),
    createdDate: record._createdDate || new Date().toISOString(),
    lastUpdatedDate: record._lastUpdatedDate || new Date().toISOString(),
  };
}

/**
 * Build the standard ListingsItemSubmissionResponse.
 * status is a SCALAR ("ACCEPTED"/"INVALID"/"VALID") — different from summary status.
 *
 * @param {string} sku
 * @param {string} status
 * @param {object[]} [issues]
 * @param {object} [identifiers]
 * @returns {object}
 */
function buildSubmissionResponse(sku, status, issues = [], identifiers = undefined) {
  const resp = {
    sku,
    status,
    submissionId: randomUUID(),
    issues,
  };
  if (identifiers) resp.identifiers = identifiers;
  return resp;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /listings/2021-08-01/items/{sellerId}/{sku} — getListingsItem
 *
 * Required: sellerId (path), sku (path), marketplaceIds (query, max 1)
 * Optional: includedData, issueLocale
 *
 * Response: direct Item object (no payload wrapper)
 */
async function handleGetListingsItem(req, pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const { sellerId, sku } = pathParams;

  // --- marketplaceIds (required, max 1) ---
  const marketplaceIds = parseArrayParam(sp.get("marketplaceIds"));
  if (marketplaceIds.length === 0) {
    return jsonError(400, "MissingParameter", "marketplaceIds is required.", "marketplaceIds: required", RATE_LIMIT_GET);
  }
  if (marketplaceIds.length > 1) {
    return jsonError(400, "InvalidParameterValue", "marketplaceIds may contain at most 1 marketplace ID for getListingsItem.", "marketplaceIds: max 1 item", RATE_LIMIT_GET);
  }
  const marketplaceId = marketplaceIds[0];
  if (!isMarketplaceId(marketplaceId)) {
    return jsonError(400, "InvalidParameterValue", `Marketplace '${marketplaceId}' is not recognized.`, "marketplaceIds: unknown marketplace", RATE_LIMIT_GET);
  }

  // --- includedData (optional, closed-set) ---
  const includedDataRaw = parseArrayParam(sp.get("includedData"));
  const includedData = includedDataRaw.length > 0 ? includedDataRaw : [...LISTINGS_DEFAULT_INCLUDED_DATA];
  for (const d of includedData) {
    if (!LISTINGS_INCLUDED_DATA.has(d)) {
      return jsonError(400, "InvalidParameterValue", `includedData value '${d}' is not valid. Valid values: ${[...LISTINGS_INCLUDED_DATA].join(", ")}`, "includedData: invalid enum value", RATE_LIMIT_GET);
    }
  }

  // Fetch the listing
  const record = getListingBySMK(sellerId, marketplaceId, sku);
  if (!record) {
    return jsonError(404, "ResourceNotFound", `Listing with SKU '${sku}' not found in marketplace '${marketplaceId}' for seller '${sellerId}'.`, undefined, RATE_LIMIT_GET);
  }

  // Ensure summaries reflect the current record state (build if missing)
  const enrichedRecord = {
    ...record,
    summaries: record.summaries && record.summaries.length > 0
      ? record.summaries
      : [buildSummary(record, marketplaceId)],
  };

  const projected = projectListing(enrichedRecord, includedData);
  return jsonOk(projected, { rateLimit: RATE_LIMIT_GET });
}

/**
 * PUT /listings/2021-08-01/items/{sellerId}/{sku} — putListingsItem
 *
 * Full overwrite (create or replace). Required: marketplaceIds (query), productType + attributes (body).
 *
 * Response: direct ListingsItemSubmissionResponse (no payload wrapper)
 */
async function handlePutListingsItem(req, pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const { sellerId, sku } = pathParams;

  // --- marketplaceIds (required, max 1) ---
  const marketplaceIds = parseArrayParam(sp.get("marketplaceIds"));
  if (marketplaceIds.length === 0) {
    return jsonError(400, "MissingParameter", "marketplaceIds is required.", "marketplaceIds: required", RATE_LIMIT_PUT);
  }
  if (marketplaceIds.length > 1) {
    return jsonError(400, "InvalidParameterValue", "marketplaceIds may contain at most 1 marketplace ID for putListingsItem.", undefined, RATE_LIMIT_PUT);
  }
  const marketplaceId = marketplaceIds[0];
  if (!isMarketplaceId(marketplaceId)) {
    return jsonError(400, "InvalidParameterValue", `Marketplace '${marketplaceId}' is not recognized.`, undefined, RATE_LIMIT_PUT);
  }

  // --- mode ---
  const mode = sp.get("mode") ?? null;
  const isDryRun = mode === "VALIDATION_PREVIEW";

  // --- Request body ---
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body is not valid JSON.", undefined, RATE_LIMIT_PUT);
  }

  // productType is required in PUT body
  if (!body || typeof body.productType !== "string" || body.productType.trim() === "") {
    return jsonError(400, "MissingParameter", "productType is required in the request body.", "productType: required", RATE_LIMIT_PUT);
  }
  // attributes is required
  if (!body.attributes || typeof body.attributes !== "object") {
    return jsonError(400, "MissingParameter", "attributes is required in the request body.", "attributes: required", RATE_LIMIT_PUT);
  }

  // Validate conditionType if provided in attributes
  if (body.attributes.conditionType) {
    const ct = Array.isArray(body.attributes.conditionType)
      ? body.attributes.conditionType[0]?.value
      : body.attributes.conditionType;
    if (ct && !CONDITION_TYPES.has(ct)) {
      return jsonError(400, "InvalidParameterValue", `conditionType '${ct}' is not valid.`, "conditionType: invalid enum value", RATE_LIMIT_PUT);
    }
  }

  if (isDryRun) {
    // VALIDATION_PREVIEW: validate but don't persist
    return jsonOk(buildSubmissionResponse(sku, "VALID"), { rateLimit: RATE_LIMIT_PUT });
  }

  // Build the listing record for the store
  const ts = new Date().toISOString();
  const key = listingKey(sellerId, marketplaceId, sku);
  const conditionType = body.attributes.conditionType
    ? (Array.isArray(body.attributes.conditionType)
        ? body.attributes.conditionType[0]?.value
        : body.attributes.conditionType) || "new_new"
    : "new_new";

  const record = {
    _storeKey: key,
    sellerId,
    marketplaceId,
    sku,
    productType: body.productType.trim(),
    requirements: body.requirements || "LISTING",
    attributes: body.attributes,
    conditionType,
    // Build a summary entry reflecting this marketplace + productType
    summaries: [{
      marketplaceId,
      productType: body.productType.trim(),
      conditionType,
      status: ["DISCOVERABLE"],
      createdDate: ts,
      lastUpdatedDate: ts,
    }],
    issues: [],
    offers: [],
    fulfillmentAvailability: [{ fulfillmentChannelCode: "DEFAULT", quantity: 0 }],
  };

  const result = mutate("listing", "replace", record, {
    actor: sellerId,
    marketplaceId,
    requestId: randomUUID(),
  });

  const issues = [];
  const status = result.ok ? "ACCEPTED" : "INVALID";
  return jsonOk(buildSubmissionResponse(sku, status, issues), { rateLimit: RATE_LIMIT_PUT });
}

/**
 * PATCH /listings/2021-08-01/items/{sellerId}/{sku} — patchListingsItem
 *
 * Partial update using JSON Patch (RFC 6902) + Amazon "merge" extension.
 * Required: marketplaceIds (query), productType + patches (body).
 *
 * Response: direct ListingsItemSubmissionResponse (no payload wrapper)
 */
async function handlePatchListingsItem(req, pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const { sellerId, sku } = pathParams;

  // --- marketplaceIds (required, max 1) ---
  const marketplaceIds = parseArrayParam(sp.get("marketplaceIds"));
  if (marketplaceIds.length === 0) {
    return jsonError(400, "MissingParameter", "marketplaceIds is required.", undefined, RATE_LIMIT_PATCH);
  }
  if (marketplaceIds.length > 1) {
    return jsonError(400, "InvalidParameterValue", "marketplaceIds may contain at most 1 marketplace ID for patchListingsItem.", undefined, RATE_LIMIT_PATCH);
  }
  const marketplaceId = marketplaceIds[0];
  if (!isMarketplaceId(marketplaceId)) {
    return jsonError(400, "InvalidParameterValue", `Marketplace '${marketplaceId}' is not recognized.`, undefined, RATE_LIMIT_PATCH);
  }

  // --- Request body ---
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body is not valid JSON.", undefined, RATE_LIMIT_PATCH);
  }

  // productType is required in PATCH body (Amazon requirement)
  if (!body || typeof body.productType !== "string" || body.productType.trim() === "") {
    return jsonError(400, "MissingParameter", "productType is required in the PATCH request body.", "productType: required", RATE_LIMIT_PATCH);
  }
  // patches array is required and must have at least 1 element
  if (!Array.isArray(body.patches) || body.patches.length === 0) {
    return jsonError(400, "MissingParameter", "patches array is required and must contain at least one operation.", "patches: required non-empty array", RATE_LIMIT_PATCH);
  }

  // Validate each patch operation
  for (let i = 0; i < body.patches.length; i++) {
    const patch = body.patches[i];
    if (!patch || typeof patch.op !== "string") {
      return jsonError(400, "InvalidInput", `patches[${i}].op is required.`, undefined, RATE_LIMIT_PATCH);
    }
    // Server-side closed-set validation per CLAUDE.md rule #10
    if (!PATCH_OPS.has(patch.op)) {
      return jsonError(
        400,
        "InvalidInput",
        `patches[${i}].op '${patch.op}' is not a valid operation. Valid values: ${[...PATCH_OPS].join(", ")}`,
        `patches[${i}].op: invalid enum value (move/copy/test are RFC 6902 but not in this API)`,
        RATE_LIMIT_PATCH
      );
    }
    if (!patch.path || typeof patch.path !== "string") {
      return jsonError(400, "InvalidInput", `patches[${i}].path is required.`, undefined, RATE_LIMIT_PATCH);
    }
    // "delete" does not require a value; all others require value
    if (patch.op !== "delete" && patch.value === undefined) {
      return jsonError(400, "InvalidInput", `patches[${i}].value is required when op is '${patch.op}'.`, undefined, RATE_LIMIT_PATCH);
    }
  }

  // --- mode ---
  const mode = sp.get("mode") ?? null;
  const isDryRun = mode === "VALIDATION_PREVIEW";

  if (isDryRun) {
    return jsonOk(buildSubmissionResponse(sku, "VALID"), { rateLimit: RATE_LIMIT_PATCH });
  }

  // Check listing exists
  const existing = getListingBySMK(sellerId, marketplaceId, sku);
  if (!existing) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Listing with SKU '${sku}' not found in marketplace '${marketplaceId}' for seller '${sellerId}'.`,
      undefined,
      RATE_LIMIT_PATCH
    );
  }

  const key = listingKey(sellerId, marketplaceId, sku);
  const result = mutate(
    "listing",
    "patch",
    { _storeKey: key, productType: body.productType.trim(), patches: body.patches },
    { actor: sellerId, marketplaceId, requestId: randomUUID() }
  );

  // After patch, update the summaries to reflect new productType / lastUpdatedDate
  if (result.entity) {
    const updated = result.entity;
    // Rebuild summaries with updated productType + timestamp
    const now = new Date().toISOString();
    const existingSummaries = updated.summaries || [];
    const updatedSummaries = existingSummaries.map((s) =>
      s.marketplaceId === marketplaceId
        ? { ...s, productType: body.productType.trim(), lastUpdatedDate: now }
        : s
    );
    if (!updatedSummaries.some((s) => s.marketplaceId === marketplaceId)) {
      updatedSummaries.push({
        marketplaceId,
        productType: body.productType.trim(),
        conditionType: updated.conditionType || "new_new",
        status: ["DISCOVERABLE"],
        createdDate: updated._createdDate || now,
        lastUpdatedDate: now,
      });
    }
    // Persist the updated summaries via another replace (keeps audit log clean)
    mutate(
      "listing",
      "replace",
      { ...updated, summaries: updatedSummaries },
      { actor: sellerId, marketplaceId, requestId: randomUUID() }
    );
  }

  const status = result.ok ? "ACCEPTED" : "INVALID";
  return jsonOk(buildSubmissionResponse(sku, status), { rateLimit: RATE_LIMIT_PATCH });
}

/**
 * DELETE /listings/2021-08-01/items/{sellerId}/{sku} — deleteListingsItem
 *
 * Required: marketplaceIds (query, max 1).
 *
 * Response: direct ListingsItemSubmissionResponse (no payload wrapper)
 */
async function handleDeleteListingsItem(req, pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const { sellerId, sku } = pathParams;

  // --- marketplaceIds (required, max 1) ---
  const marketplaceIds = parseArrayParam(sp.get("marketplaceIds"));
  if (marketplaceIds.length === 0) {
    return jsonError(400, "MissingParameter", "marketplaceIds is required.", undefined, RATE_LIMIT_DELETE);
  }
  if (marketplaceIds.length > 1) {
    return jsonError(400, "InvalidParameterValue", "marketplaceIds may contain at most 1 marketplace ID for deleteListingsItem.", undefined, RATE_LIMIT_DELETE);
  }
  const marketplaceId = marketplaceIds[0];
  if (!isMarketplaceId(marketplaceId)) {
    return jsonError(400, "InvalidParameterValue", `Marketplace '${marketplaceId}' is not recognized.`, undefined, RATE_LIMIT_DELETE);
  }

  const key = listingKey(sellerId, marketplaceId, sku);
  const result = mutate("listing", "delete", { _storeKey: key, sku, sellerId, marketplaceId }, {
    actor: sellerId,
    marketplaceId,
    requestId: randomUUID(),
  });

  // If the listing didn't exist, still return ACCEPTED (idempotent delete)
  return jsonOk(buildSubmissionResponse(sku, "ACCEPTED"), { rateLimit: RATE_LIMIT_DELETE });
}

/**
 * GET /listings/2021-08-01/items/{sellerId} — searchListingsItems
 *
 * Required: marketplaceIds (query; multiple OK for search).
 * Optional: includedData, identifiers, identifiersType, createdAfter/Before,
 *           lastUpdatedAfter/Before, withIssueSeverity, pageSize, pageToken, sortBy, sortOrder.
 *
 * Response: direct ItemSearchResults (no payload wrapper)
 *   { numberOfResults, pagination?, items[] }
 */
async function handleSearchListingsItems(req, pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const { sellerId } = pathParams;

  // --- marketplaceIds (required) ---
  const marketplaceIds = parseArrayParam(sp.get("marketplaceIds"));
  if (marketplaceIds.length === 0) {
    return jsonError(400, "MissingParameter", "marketplaceIds is required.", undefined, RATE_LIMIT_SEARCH);
  }
  for (const mid of marketplaceIds) {
    if (!isMarketplaceId(mid)) {
      return jsonError(400, "InvalidParameterValue", `Marketplace '${mid}' is not recognized.`, undefined, RATE_LIMIT_SEARCH);
    }
  }

  // --- includedData ---
  const includedDataRaw = parseArrayParam(sp.get("includedData"));
  const includedData = includedDataRaw.length > 0 ? includedDataRaw : [...LISTINGS_DEFAULT_INCLUDED_DATA];
  for (const d of includedData) {
    if (!LISTINGS_INCLUDED_DATA.has(d)) {
      return jsonError(400, "InvalidParameterValue", `includedData value '${d}' is not valid.`, undefined, RATE_LIMIT_SEARCH);
    }
  }

  // --- sortBy / sortOrder ---
  const sortBy = sp.get("sortBy") ?? null;
  const sortOrder = sp.get("sortOrder") ?? "ASC";
  if (sortBy && !SORT_BY.has(sortBy)) {
    return jsonError(400, "InvalidParameterValue", `sortBy '${sortBy}' is not valid. Valid values: ${[...SORT_BY].join(", ")}`, undefined, RATE_LIMIT_SEARCH);
  }
  if (!SORT_ORDER.has(sortOrder)) {
    return jsonError(400, "InvalidParameterValue", `sortOrder '${sortOrder}' is not valid.`, undefined, RATE_LIMIT_SEARCH);
  }

  // --- pageSize ---
  const pageSize = parseIntParam(sp.get("pageSize"), LISTINGS_DEFAULT_PAGE_SIZE, 1, LISTINGS_MAX_PAGE_SIZE);

  // --- pageToken (distinct from NextToken) ---
  const pageToken = sp.get("pageToken") ?? null;

  // Build query filters (use from cursor if resuming)
  let queryFilters;
  if (pageToken) {
    try {
      const cursorState = decodeCursor(pageToken);
      queryFilters = cursorState.filters;
    } catch {
      return jsonError(400, "InvalidInput", "The pageToken is invalid or has expired.", undefined, RATE_LIMIT_SEARCH);
    }
  } else {
    queryFilters = {
      marketplaceIds,
      createdAfter: sp.get("createdAfter") ?? undefined,
      createdBefore: sp.get("createdBefore") ?? undefined,
      lastUpdatedAfter: sp.get("lastUpdatedAfter") ?? undefined,
      lastUpdatedBefore: sp.get("lastUpdatedBefore") ?? undefined,
    };
    const withIssueSeverity = parseArrayParam(sp.get("withIssueSeverity"));
    if (withIssueSeverity.length > 0) queryFilters.withIssueSeverity = withIssueSeverity;
  }

  // Query the store
  let matched = queryListings(sellerId, queryFilters);

  // Sort
  if (sortBy) {
    const sortKey = sortBy === "sku" ? "sku"
      : sortBy === "createdDate" ? "_createdDate"
      : "_lastUpdatedDate";
    matched = [...matched].sort((a, b) => {
      const va = a[sortKey] || "";
      const vb = b[sortKey] || "";
      return sortOrder === "DESC" ? vb.localeCompare(va) : va.localeCompare(vb);
    });
  }

  // Paginate using the same paginateCatalog utility (it handles pageToken correctly)
  const { page, pagination, total } = paginateCatalog(matched, queryFilters, pageSize, pageToken);

  // Project each item
  const projectedItems = page.map((record) => {
    // Ensure summaries are present in the record before projecting
    const enriched = {
      ...record,
      summaries: record.summaries && record.summaries.length > 0
        ? record.summaries
        : [buildSummary(record, record.marketplaceId)],
    };
    return projectListing(enriched, includedData);
  });

  const responseBody = {
    numberOfResults: total,
    ...(pagination ? { pagination } : {}),
    items: projectedItems,
  };

  return jsonOk(responseBody, { rateLimit: RATE_LIMIT_SEARCH });
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "GET",
    path: "/listings/2021-08-01/items/:sellerId/:sku",
    handler: handleGetListingsItem,
    help: {
      description: "Get a single listing item. Returns direct Item object (no payload wrapper). Required: marketplaceIds (max 1). Optional: includedData (default: summaries), issueLocale.",
      params: [
        { name: "sellerId", type: "string", required: true, note: "Path parameter — selling partner identifier" },
        { name: "sku", type: "string", required: true, note: "Path parameter — seller SKU (URL-encode special chars)" },
        { name: "marketplaceIds", type: "string[]", required: true, note: "Max 1 marketplace ID" },
        { name: "includedData", type: "string[]", required: false, note: "Default: summaries. Values: summaries, attributes, issues, offers, fulfillmentAvailability, procurement, relationships, productTypes" },
        { name: "issueLocale", type: "string", required: false, note: "BCP 47 e.g. en_US" },
      ],
    },
  },
  {
    method: "PUT",
    path: "/listings/2021-08-01/items/:sellerId/:sku",
    handler: handlePutListingsItem,
    help: {
      description: "Create or fully replace a listing item. Body: {productType (required), requirements, attributes (required)}. Returns ListingsItemSubmissionResponse with scalar status (ACCEPTED/INVALID/VALID).",
      params: [
        { name: "sellerId", type: "string", required: true, note: "Path parameter" },
        { name: "sku", type: "string", required: true, note: "Path parameter" },
        { name: "marketplaceIds", type: "string[]", required: true, note: "Max 1 marketplace ID" },
        { name: "includedData", type: "string[]", required: false, note: "Default: issues. Values: identifiers, issues" },
        { name: "mode", type: "string", required: false, note: "VALIDATION_PREVIEW for dry-run" },
        { name: "issueLocale", type: "string", required: false },
      ],
    },
  },
  {
    method: "PATCH",
    path: "/listings/2021-08-01/items/:sellerId/:sku",
    handler: handlePatchListingsItem,
    help: {
      description: "Partial update via JSON Patch (RFC 6902 + Amazon 'merge'). Body: {productType (required), patches: [{op, path, value?}]}. op enum: add, replace, merge, delete (move/copy/test rejected). Returns ListingsItemSubmissionResponse.",
      params: [
        { name: "sellerId", type: "string", required: true, note: "Path parameter" },
        { name: "sku", type: "string", required: true, note: "Path parameter" },
        { name: "marketplaceIds", type: "string[]", required: true, note: "Max 1 marketplace ID" },
        { name: "mode", type: "string", required: false, note: "VALIDATION_PREVIEW for dry-run" },
      ],
    },
  },
  {
    method: "DELETE",
    path: "/listings/2021-08-01/items/:sellerId/:sku",
    handler: handleDeleteListingsItem,
    help: {
      description: "Delete a listing item. Returns ListingsItemSubmissionResponse with status=ACCEPTED. Idempotent — deleting a nonexistent SKU still returns ACCEPTED.",
      params: [
        { name: "sellerId", type: "string", required: true, note: "Path parameter" },
        { name: "sku", type: "string", required: true, note: "Path parameter" },
        { name: "marketplaceIds", type: "string[]", required: true, note: "Max 1 marketplace ID" },
        { name: "issueLocale", type: "string", required: false },
      ],
    },
  },
  {
    method: "GET",
    path: "/listings/2021-08-01/items/:sellerId",
    handler: handleSearchListingsItems,
    help: {
      description: "Search listings for a seller. Required: marketplaceIds (multiple OK). Returns ItemSearchResults {numberOfResults, pagination?, items[]}. Pagination: query param is pageToken (not NextToken), response uses pagination.nextToken/previousToken.",
      params: [
        { name: "sellerId", type: "string", required: true, note: "Path parameter" },
        { name: "marketplaceIds", type: "string[]", required: true, note: "Multiple OK" },
        { name: "includedData", type: "string[]", required: false, note: "Default: summaries" },
        { name: "pageSize", type: "integer", required: false, note: "Max 20, default 10" },
        { name: "pageToken", type: "string", required: false, note: "From pagination.nextToken in previous response" },
        { name: "sortBy", type: "string", required: false, note: "Values: sku, createdDate, lastUpdatedDate" },
        { name: "sortOrder", type: "string", required: false, note: "Values: ASC, DESC" },
        { name: "createdAfter", type: "string", required: false },
        { name: "createdBefore", type: "string", required: false },
        { name: "lastUpdatedAfter", type: "string", required: false },
        { name: "lastUpdatedBefore", type: "string", required: false },
      ],
    },
  },
];
