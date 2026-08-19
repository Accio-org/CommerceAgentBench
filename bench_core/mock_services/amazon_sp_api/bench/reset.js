/**
 * bench/reset.js
 * POST /__bench/reset — requires verifier token
 *
 * Clears all store state (marketplaces, sellers, catalog, audit log, notifications).
 * After reset the store is empty — caller must POST /__bench/seed to repopulate.
 */

import { reset, entityCounts } from "../lib/store.js";

/**
 * @param {Request} req
 * @param {{ verifierToken: string }} opts
 * @returns {Response}
 */
export function handleReset(req, { verifierToken }) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (!verifierToken || token !== verifierToken) {
    const status = token ? 403 : 401;
    return new Response(
      JSON.stringify({ errors: [{ code: "AccessDenied", message: "Invalid or missing verifier token." }] }),
      { status, headers: { "content-type": "application/json" } }
    );
  }

  reset();
  const counts = entityCounts();
  return new Response(
    JSON.stringify({ ok: true, message: "Store cleared.", counts }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
