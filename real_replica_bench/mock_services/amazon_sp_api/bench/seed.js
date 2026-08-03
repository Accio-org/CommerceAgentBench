/**
 * bench/seed.js
 * POST /__bench/seed — requires verifier token
 *
 * Body: seed JSON. Resets the store and populates from the seed.
 * Returns { ok: true, counts: { marketplaces, sellers, catalog } }.
 */

import { loadSeed, entityCounts } from "../lib/store.js";
import { ValidationError } from "../lib/validation/common.js";

/**
 * @param {Request} req
 * @param {{ verifierToken: string }} opts
 * @returns {Promise<Response>}
 */
export async function handleSeed(req, { verifierToken }) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (!verifierToken || token !== verifierToken) {
    const status = token ? 403 : 401;
    return new Response(
      JSON.stringify({ errors: [{ code: "AccessDenied", message: "Invalid or missing verifier token." }] }),
      { status, headers: { "content-type": "application/json" } }
    );
  }

  let seed;
  try {
    seed = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ errors: [{ code: "InvalidInput", message: "Request body must be valid JSON." }] }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  try {
    loadSeed(seed);
  } catch (err) {
    if (err instanceof ValidationError) {
      return new Response(
        JSON.stringify({ errors: [{ code: err.spCode, message: err.spMessage }] }),
        { status: err.httpStatus, headers: { "content-type": "application/json" } }
      );
    }
    throw err;
  }

  const counts = entityCounts();
  return new Response(
    JSON.stringify({ ok: true, counts }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
