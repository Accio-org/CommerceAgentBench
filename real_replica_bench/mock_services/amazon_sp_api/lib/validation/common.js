/**
 * lib/validation/common.js
 * Shared validation helpers for all SP-API mock namespaces.
 *
 * SP-API mandates x-amz-access-token header in production; our mock accepts
 * any/absent value — auth is not the unit under test (CCB convention).
 */

/** Known marketplace IDs (closed-set). Source: SP-API docs + fact sheet. */
export const KNOWN_MARKETPLACE_IDS = new Set([
  "ATVPDKIKX0DER", // US
  "A2EUQ1WTGCTBG2", // CA
  "A1AM78C64UM0Y8", // MX
  "A2Q3Y263D00KWC", // BR
  "A1F83G8C2ARO7P", // UK
  "A1PA6795UKMFR9", // DE
  "A13V1IB3VIYZZH", // FR
  "APJ6JRA9NG5V4",  // IT
  "A1RKKUPIHCS9HS", // ES
  "A1805IZSGTT6HS", // NL
  "A2NODRKZP88ZB9", // SE
  "A1C3SOZRARQ6R3", // PL
  "AMEN7PMS3EDWL",  // BE
  "A33AVAJ2PDY3EV", // TR
  "A2VIGQ35RCS4UG", // AE
  "A17E79C6D8DWNP", // SA
  "ARBP9OOSHTCHU",  // EG
  "A21TJRUUN4KGV",  // IN
  "A1VC38T7YXB528", // JP
  "A39IBJ37TRP1C6", // AU
  "A19VAU5U5O7RUS", // SG
]);

/** ISO 8601 validator (accepts YYYY-MM-DDTHH:MM:SSZ and variants). */
export function isISO8601(s) {
  if (typeof s !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s);
}

/** ISO 4217 currency code validator (3-char uppercase). */
export function isCurrencyCode(c) {
  if (typeof c !== "string") return false;
  return /^[A-Z]{3}$/.test(c);
}

/** Marketplace ID validator (known set). */
export function isMarketplaceId(id) {
  return KNOWN_MARKETPLACE_IDS.has(id);
}

/** ASIN validator — 10-char uppercase alphanumeric. */
export function isASIN(s) {
  if (typeof s !== "string") return false;
  return /^[A-Z0-9]{10}$/.test(s);
}

/** Seller SKU — loose validation, non-empty printable ASCII. */
export function isSKU(s) {
  if (typeof s !== "string" || s.length === 0) return false;
  return s.length <= 256;
}

/**
 * Closed-set enum assertion (per CLAUDE.md #10 server-side validation).
 * @param {*} v - value to check
 * @param {Set<string>|string[]} allowed - allowed values
 * @param {string} field - field name for error message
 * @throws {ValidationError}
 */
export function assertCloseSet(v, allowed, field) {
  const allowedSet = allowed instanceof Set ? allowed : new Set(allowed);
  if (!allowedSet.has(v)) {
    const sample = [...allowedSet].slice(0, 5).join(", ");
    throw new ValidationError(
      "InvalidParameterValue",
      `Value '${v}' is not valid for field '${field}'. Valid values: ${sample}${allowedSet.size > 5 ? ", ..." : ""}`,
      `Field: ${field}`
    );
  }
}

/**
 * Validate that required marketplace IDs are in our known set.
 * Returns { valid: boolean, badIds: string[] }.
 */
export function validateMarketplaceIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { valid: false, badIds: [] };
  }
  const badIds = ids.filter((id) => !isMarketplaceId(id));
  return { valid: badIds.length === 0, badIds };
}

/** Structured validation error — caught by central error handler in server.js. */
export class ValidationError extends Error {
  /**
   * @param {string} code - SP-API error code (e.g. "InvalidInput")
   * @param {string} message
   * @param {string} [details]
   * @param {number} [status] - HTTP status, default 400
   */
  constructor(code, message, details = undefined, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.spCode = code;
    this.spMessage = message;
    this.spDetails = details;
    this.httpStatus = status;
  }
}

/** 404 shorthand. */
export class NotFoundError extends ValidationError {
  constructor(message, details = undefined) {
    super("ResourceNotFound", message, details, 404);
  }
}
