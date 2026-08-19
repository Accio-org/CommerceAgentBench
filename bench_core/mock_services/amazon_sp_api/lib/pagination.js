/**
 * lib/pagination.js
 * Opaque cursor pagination utilities shared by all SP-API namespaces.
 *
 * Cursor encodes {offset, filters} as base64url JSON. Real SP-API says tokens
 * expire in ~30s for FBA Inventory; our mock keeps them valid indefinitely.
 *
 * Casing note from fact sheet:
 *   PascalCase namespaces (Orders v0, Finances v0): use "NextToken"
 *   camelCase namespaces (Reports, FBA Inventory): use "nextToken"
 *   Catalog Items v2022-04-01: query param is "pageToken", response tokens are
 *     "pagination.nextToken" and "pagination.previousToken"
 *
 * Mutual-exclusivity rule (Catalog Items): when pageToken is supplied it
 * encodes the filters, so callers MUST NOT re-pass filter params alongside it.
 * This module enforces that by embedding filters in the cursor; routes are
 * responsible for ignoring re-passed filters when a cursor is present.
 */

import { ValidationError } from "./validation/common.js";

/**
 * Encode pagination state to an opaque base64url cursor string.
 * @param {{ offset: number, filters: Record<string, unknown> }} state
 * @returns {string}
 */
export function encodeCursor(state) {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

/**
 * Decode an opaque cursor back to pagination state.
 * @param {string} cursor
 * @returns {{ offset: number, filters: Record<string, unknown> }}
 * @throws {ValidationError} on invalid cursor
 */
export function decodeCursor(cursor) {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
    if (typeof decoded.offset !== "number") throw new Error("missing offset");
    return decoded;
  } catch {
    throw new ValidationError(
      "InvalidInput",
      "The pagination token is invalid or has expired.",
      "pageToken/nextToken: malformed cursor"
    );
  }
}

/**
 * Paginate an already-filtered array of items (generic, PascalCase-token namespaces).
 *
 * @param {unknown[]} items - full filtered item list (caller applies filters before paginating)
 * @param {Record<string, unknown>} filters - original filter snapshot (frozen in cursor)
 * @param {number} limit - page size
 * @param {string|null|undefined} cursor - opaque token from request; null/undefined = first page
 * @param {string} tokenKey - "NextToken" (PascalCase) or "nextToken" (camelCase)
 * @returns {{ items: unknown[], [tokenKey]: string|undefined }}
 */
export function paginate(items, filters, limit, cursor, tokenKey = "NextToken") {
  const offset = cursor ? decodeCursor(cursor).offset : 0;
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < items.length;
  return {
    items: page,
    [tokenKey]: hasMore ? encodeCursor({ offset: nextOffset, filters }) : undefined,
  };
}

/**
 * Paginate for Catalog Items v2022-04-01 — returns both nextToken and previousToken
 * in a `pagination` object as required by ItemSearchResults schema.
 *
 * @param {unknown[]} items - full filtered item list
 * @param {Record<string, unknown>} filters - filter snapshot encoded in cursor
 * @param {number} limit - page size (max 20, default 10)
 * @param {string|null|undefined} pageToken - opaque cursor from prior response
 * @returns {{ page: unknown[], pagination: { nextToken?: string, previousToken?: string } | undefined, total: number }}
 */
export function paginateCatalog(items, filters, limit, pageToken) {
  const offset = pageToken ? decodeCursor(pageToken).offset : 0;
  const page = items.slice(offset, offset + limit);

  const nextOffset = offset + limit;
  const hasNext = nextOffset < items.length;
  const hasPrev = offset > 0;

  const paginationObj = {};
  if (hasNext) paginationObj.nextToken = encodeCursor({ offset: nextOffset, filters });
  if (hasPrev) paginationObj.previousToken = encodeCursor({ offset: Math.max(0, offset - limit), filters });

  const pagination = (hasNext || hasPrev) ? paginationObj : undefined;

  return { page, pagination, total: items.length };
}
