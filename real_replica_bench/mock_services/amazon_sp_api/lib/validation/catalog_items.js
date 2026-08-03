/**
 * lib/validation/catalog_items.js
 * Closed-set constants for the Catalog Items v2022-04-01 namespace.
 *
 * Source: catalogItems_2022-04-01.json swagger (verified 2026-05-28) + fact sheet
 * scratch/docs/api_alignment/amazon_spapi.md §Catalog Items API v2022-04-01
 */

/**
 * Valid includedData values. Controls which top-level sections appear on Item.
 * If a value is not in this set, the request is rejected with 400 InvalidParameterValue.
 *
 * Source: fact sheet table — includedData query parameter.
 */
export const VALID_INCLUDED_DATA = new Set([
  "attributes",
  "classifications",
  "dimensions",
  "identifiers",
  "images",
  "productTypes",
  "relationships",
  "salesRanks",
  "summaries",
  "vendorDetails",
]);

/**
 * Valid identifiersType values (required when identifiers param is present).
 * Source: fact sheet table — identifiersType enum.
 */
export const IDENTIFIERS_TYPES = new Set([
  "ASIN",
  "EAN",
  "GTIN",
  "ISBN",
  "JAN",
  "MINSAN",
  "SKU",
  "UPC",
]);

/**
 * Valid itemClassification enum values for ItemSummaryByMarketplace.
 * Source: fact sheet §Schema details — Catalog Items v2022-04-01.
 */
export const ITEM_CLASSIFICATIONS = new Set([
  "BASE_PRODUCT",
  "OTHER",
  "PRODUCT_BUNDLE",
  "VARIATION_PARENT",
]);

/** Maximum page size for searchCatalogItems. Source: fact sheet. */
export const CATALOG_MAX_PAGE_SIZE = 20;

/** Default page size for searchCatalogItems. Source: fact sheet. */
export const CATALOG_DEFAULT_PAGE_SIZE = 10;

/** Default includedData when not specified. Source: fact sheet. */
export const CATALOG_DEFAULT_INCLUDED_DATA = ["summaries"];
