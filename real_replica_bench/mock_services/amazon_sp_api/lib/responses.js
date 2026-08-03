/**
 * lib/responses.js
 * Standard response helpers for SP-API wire format.
 *
 * SP-API mandates these response headers on every call:
 *   content-type: application/json
 *   x-amzn-RequestId: <uuid>
 *   x-amzn-RateLimit-Limit: <rps>   (documented per-endpoint rate, even though we don't throttle)
 */

import { randomUUID } from "crypto";
import { ValidationError } from "./validation/common.js";

/**
 * Emit a successful JSON response.
 *
 * @param {unknown} body - full response body (already assembled by caller)
 * @param {{ status?: number, rateLimit?: number|string }} [opts]
 * @returns {Response}
 */
export function jsonOk(body, opts = {}) {
  const status = opts.status ?? 200;
  const headers = {
    "content-type": "application/json",
    "x-amzn-RequestId": randomUUID(),
    ...(opts.rateLimit !== undefined
      ? { "x-amzn-RateLimit-Limit": String(opts.rateLimit) }
      : {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Emit a 204 No Content response (empty body).
 *
 * Used by Orders v0 write operations whose ONLY documented success response is
 * 204 with no body: updateVerificationStatus (PATCH .../regulatedInfo),
 * updateShipmentStatus (POST .../shipment), confirmShipment
 * (POST .../shipmentConfirmation).
 * Source of truth: amzn/selling-partner-api-models ordersV0.json — each of
 * these operations declares responses {"204": ...} and NO 200.
 *
 * @param {{ rateLimit?: number|string }} [opts]
 * @returns {Response}
 */
export function noContent(opts = {}) {
  const headers = {
    "x-amzn-RequestId": randomUUID(),
    ...(opts.rateLimit !== undefined
      ? { "x-amzn-RateLimit-Limit": String(opts.rateLimit) }
      : {}),
  };
  return new Response(null, { status: 204, headers });
}

/**
 * Emit an SP-API error response.
 *
 * Shape: { "errors": [{ "code": "...", "message": "...", "details": "..." }] }
 * (On error, `payload` is omitted — per fact sheet §"Error Shape".)
 *
 * @param {number} status - HTTP status code
 * @param {string} code - SP-API error code (e.g. "InvalidInput", "ResourceNotFound")
 * @param {string} message - human-readable error message
 * @param {string} [details] - optional additional detail string
 * @param {number|string} [rateLimit] - optional rate limit header value
 * @returns {Response}
 */
export function jsonError(status, code, message, details = undefined, rateLimit = undefined) {
  const body = {
    errors: [
      {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    ],
  };
  const headers = {
    "content-type": "application/json",
    "x-amzn-RequestId": randomUUID(),
    ...(rateLimit !== undefined ? { "x-amzn-RateLimit-Limit": String(rateLimit) } : {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Convert a ValidationError to a JSON error Response.
 * @param {ValidationError} err
 * @returns {Response}
 */
export function validationErrorToResponse(err) {
  return jsonError(err.httpStatus, err.spCode, err.spMessage, err.spDetails);
}

/**
 * Central error handler — wraps any thrown error into a proper SP-API
 * error response. Called from the Bun.serve fetch() catch path.
 *
 * @param {unknown} err
 * @returns {Response}
 */
export function handleError(err) {
  if (err instanceof ValidationError) {
    return validationErrorToResponse(err);
  }
  console.error("[mock] Unhandled error:", err);
  return jsonError(500, "InternalFailure", "An internal server error occurred.", String(err));
}

/**
 * Wrap a payload in the standard SP-API success envelope.
 * Used by Sellers v1 namespace (and Orders v0, Finances v0 in future waves).
 *
 * Shape: { "payload": <inner> }
 * (errors[] is omitted on success — per fact sheet §"Error Shape".)
 *
 * @param {unknown} inner - the payload object
 * @returns {{ payload: unknown }}
 */
export function wrapPayload(inner) {
  return { payload: inner };
}

/**
 * Parse query string values that can be comma-separated arrays.
 * SP-API clients may send ?marketplaceIds=A,B or ?marketplaceIds=A&marketplaceIds=B.
 *
 * @param {string|string[]|null|undefined} val
 * @returns {string[]}
 */
export function parseArrayParam(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse a boolean query parameter.
 * Accepts "true"/"1" as true, anything else (including absent) as false.
 * @param {string|null|undefined} val
 * @returns {boolean}
 */
export function parseBoolParam(val) {
  return val === "true" || val === "1";
}

/**
 * Parse integer query param with a default.
 * @param {string|null|undefined} val
 * @param {number} defaultVal
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number}
 */
export function parseIntParam(val, defaultVal, min = undefined, max = undefined) {
  if (!val) return defaultVal;
  const n = parseInt(val, 10);
  if (isNaN(n)) return defaultVal;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}
