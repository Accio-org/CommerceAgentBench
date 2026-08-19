/**
 * bench/audit.js
 * GET /__bench/audit — requires verifier token
 *
 * Returns the audit log. Optional query params:
 *   entityType  — filter by entity type ('marketplace', 'seller', 'catalog', etc.)
 *   since       — ISO 8601 timestamp; return only entries after this point
 */

import { auditLog } from "../lib/store.js";

/**
 * @param {Request} req
 * @param {{ verifierToken: string }} opts
 * @returns {Response}
 */
export function handleAudit(req, { verifierToken }) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (!verifierToken || token !== verifierToken) {
    const status = token ? 403 : 401;
    return new Response(
      JSON.stringify({ errors: [{ code: "AccessDenied", message: "Invalid or missing verifier token." }] }),
      { status, headers: { "content-type": "application/json" } }
    );
  }

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType") ?? undefined;
  const since = url.searchParams.get("since") ?? undefined;

  const entries = auditLog({ entityType, since });

  return new Response(
    JSON.stringify({ count: entries.length, entries }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
