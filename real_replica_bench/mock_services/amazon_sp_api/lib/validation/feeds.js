/**
 * lib/validation/feeds.js
 * Closed-set enum constants for Feeds v2021-06-30 namespace.
 *
 * Field casing: camelCase throughout (same era as Reports v2021-06-30).
 * No `payload` wrapper — responses are direct schema objects.
 * Server-side validation is mandatory per CLAUDE.md rule #10.
 */

/**
 * processingStatus enum — exactly 5 values (ALL_CAPS_SNAKE).
 * Terminal states: DONE, CANCELLED, FATAL.
 * Cancelable: only IN_QUEUE.
 * Source: feeds_2021-06-30.json swagger `Feed.processingStatus`.
 */
export const PROCESSING_STATUSES = new Set([
  "CANCELLED",
  "DONE",
  "FATAL",
  "IN_PROGRESS",
  "IN_QUEUE",
]);

/** Terminal states where no further transitions occur. */
export const TERMINAL_STATUSES = new Set(["DONE", "CANCELLED", "FATAL"]);

/**
 * Known/closed-set feed type values (common product/pricing/inventory feeds).
 * The full list on Amazon is open-ended, but we validate the minimum 6 closed-set
 * types plus accept unknown types as valid (Amazon has hundreds of feed types).
 *
 * Source: developer-docs.amazon.com/sp-api/docs/feed-type-values (2026-05-29).
 * Note: Product/Pricing/Inventory category page was not captured by WebFetch —
 * these values are from historical MWS/SP-API docs and sandbox examples.
 */
export const KNOWN_FEED_TYPES = new Set([
  // Product/Catalog feeds
  "POST_PRODUCT_DATA",
  "POST_PRODUCT_RELATIONSHIP_DATA",
  "POST_PRODUCT_IMAGE_DATA",
  "POST_PRODUCT_OVERRIDES_DATA",
  // Pricing feed
  "POST_PRODUCT_PRICING_DATA",
  // Inventory feed
  "POST_INVENTORY_AVAILABILITY_DATA",
  // Flat-file variants
  "POST_FLAT_FILE_LISTINGS_DATA",
  "POST_FLAT_FILE_INVLOADER_DATA",
  "POST_FLAT_FILE_PRICEANDQUANTITYONLY_UPDATE_DATA",
  // FBA feeds
  "POST_FULFILLMENT_ORDER_REQUEST_DATA",
  "POST_FULFILLMENT_ORDER_CANCELLATION_REQUEST_DATA",
  "POST_FBA_INBOUND_CARTON_CONTENTS",
  "POST_FLAT_FILE_FBA_CREATE_REMOVAL",
  "POST_FLAT_FILE_FULFILLMENT_ORDER_REQUEST_DATA",
  "POST_FLAT_FILE_FULFILLMENT_ORDER_CANCELLATION_REQUEST_DATA",
  // Order feeds
  "POST_FLAT_FILE_ORDER_ACKNOWLEDGEMENT_DATA",
  "POST_FLAT_FILE_PAYMENT_ADJUSTMENT_DATA",
  "POST_FLAT_FILE_FULFILLMENT_DATA",
  "POST_ORDER_ACKNOWLEDGEMENT_DATA",
  "POST_PAYMENT_ADJUSTMENT_DATA",
  "POST_ORDER_FULFILLMENT_DATA",
  "POST_EXPECTED_SHIP_DATE_SOD",
  "POST_EXPECTED_SHIP_DATE_SOD_FLAT_FILE",
  "POST_INVOICE_CONFIRMATION_DATA",
  // Invoicing
  "UPLOAD_VAT_INVOICE",
  // Listings
  "JSON_LISTINGS_FEED",
  // Easy Ship
  "POST_EASYSHIP_DOCUMENTS",
]);

/**
 * Whether a feedType value is acceptable.
 * Per Amazon spec, feedType is an open string — we accept KNOWN_FEED_TYPES
 * AND any other non-empty string (Amazon has many more feed types not enumerated here).
 *
 * @param {string} feedType
 * @returns {boolean}
 */
export function isValidFeedType(feedType) {
  return typeof feedType === "string" && feedType.length > 0;
}

/**
 * Auto-generate a numeric-string feedId (mimics Amazon's short numeric style).
 * @returns {string} e.g. "348593495012345"
 */
export function generateFeedId() {
  // 15-digit random-ish string
  return String(Math.floor(Math.random() * 900000000000000) + 100000000000000);
}

/**
 * Auto-generate a UUID-like feedDocumentId (mimics Amazon's UUID style).
 * @returns {string} e.g. "3d4e42b5-1d6e-44e8-a89c-2abfca0625bb"
 */
export function generateFeedDocumentId() {
  // UUID v4 format
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
