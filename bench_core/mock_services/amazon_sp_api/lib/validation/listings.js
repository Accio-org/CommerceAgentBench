/**
 * lib/validation/listings.js
 * Closed-set constants for the Listings Items API v2021-08-01 namespace.
 *
 * Source: listingsItems_2021-08-01.json swagger (verified 2026-05-28) + fact sheet
 * scratch/docs/api_alignment/amazon_spapi.md §Listings Items API v2021-08-01
 *
 * Casing note (CLAUDE.md rule #10): all enum values here match the API exactly.
 * This namespace is camelCase throughout.
 */

/**
 * Valid PATCH op values per the Amazon-extended JSON Patch spec.
 * RFC 6902 standard: add, replace, remove (Amazon spells it "delete"), test, move, copy.
 * Amazon's Listings Items API subset: add, replace, merge, delete.
 * NOT allowed: move, copy, test (they exist in RFC 6902 but not in this API).
 */
export const PATCH_OPS = new Set(["add", "replace", "merge", "delete"]);

/**
 * Scalar status for ListingsItemSubmissionResponse (PUT/PATCH/DELETE responses).
 * This is a SCALAR string — different from the ARRAY status in ItemSummaryByMarketplace.
 */
export const SUBMISSION_STATUS = new Set(["ACCEPTED", "INVALID", "VALID"]);

/**
 * Array status values for ItemSummaryByMarketplace.status[] (GET response).
 * Note: this is an ARRAY of these strings, not a scalar.
 */
export const SUMMARY_STATUS = new Set(["BUYABLE", "DISCOVERABLE"]);

/**
 * conditionType enum for ItemSummaryByMarketplace.
 * Lowercase with underscores (different from Pricing v0 which uses PascalCase).
 * Source: fact sheet §Critical structural facts #6 + swagger conditionType definition.
 */
export const CONDITION_TYPES = new Set([
  "new_new",
  "new_open_box",
  "new_oem",
  "refurbished_refurbished",
  "used_like_new",
  "used_very_good",
  "used_good",
  "used_acceptable",
  "collectible_like_new",
  "collectible_very_good",
  "collectible_good",
  "collectible_acceptable",
  "club_club",
]);

/**
 * includedData enum for getListingsItem / searchListingsItems query param.
 * Source: fact sheet §Query parameters for getListingsItem.
 */
export const LISTINGS_INCLUDED_DATA = new Set([
  "summaries",
  "attributes",
  "issues",
  "offers",
  "fulfillmentAvailability",
  "procurement",
  "relationships",
  "productTypes",
]);

/**
 * includedData enum for putListingsItem / patchListingsItem (narrower set).
 * Source: fact sheet §Query parameters for putListingsItem.
 */
export const LISTINGS_PUT_INCLUDED_DATA = new Set(["identifiers", "issues"]);

/**
 * requirements enum for putListingsItem request body.
 * Source: fact sheet §Request body (ListingsItemPutRequest).
 */
export const LISTING_REQUIREMENTS = new Set([
  "LISTING",
  "LISTING_PRODUCT_ONLY",
  "LISTING_OFFER_ONLY",
]);

/**
 * Default includedData for getListingsItem (fact sheet: "default summaries").
 */
export const LISTINGS_DEFAULT_INCLUDED_DATA = ["summaries"];

/**
 * Max page size for searchListingsItems.
 * Source: swagger pageSize maximum.
 */
export const LISTINGS_MAX_PAGE_SIZE = 20;

/**
 * Default page size for searchListingsItems.
 */
export const LISTINGS_DEFAULT_PAGE_SIZE = 10;

/**
 * Issue severity enum.
 * Source: fact sheet §Issue schema.
 */
export const ISSUE_SEVERITIES = new Set(["ERROR", "WARNING", "INFO"]);

/**
 * withIssueSeverity filter enum (same values as ISSUE_SEVERITIES).
 */
export const WITH_ISSUE_SEVERITY = new Set(["ERROR", "WARNING", "INFO"]);

/**
 * sortBy enum for searchListingsItems.
 * Source: fact sheet §Query parameters for searchListingsItems.
 */
export const SORT_BY = new Set(["sku", "createdDate", "lastUpdatedDate"]);

/**
 * sortOrder enum for searchListingsItems.
 */
export const SORT_ORDER = new Set(["ASC", "DESC"]);

/**
 * identifiersType enum for searchListingsItems.
 * Source: fact sheet §Query parameters for searchListingsItems.
 */
export const LISTINGS_IDENTIFIER_TYPES = new Set([
  "ASIN",
  "EAN",
  "FNSKU",
  "GTIN",
  "ISBN",
  "JAN",
  "MINSAN",
  "SKU",
  "UPC",
]);
