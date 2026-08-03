/**
 * bench/advance.js
 * POST /__bench/advance — requires verifier token
 *
 * Body: { "ms": N }
 * Advances the virtual clock by N milliseconds.
 * Wave 0: records offset. Wave 3: triggers scheduled notification delivery.
 */

import { advanceTime, virtualNow } from "../lib/store.js";

/**
 * @param {Request} req
 * @param {{ verifierToken: string }} opts
 * @returns {Promise<Response>}
 */
export async function handleAdvance(req, { verifierToken }) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (!verifierToken || token !== verifierToken) {
    const status = token ? 403 : 401;
    return new Response(
      JSON.stringify({ errors: [{ code: "AccessDenied", message: "Invalid or missing verifier token." }] }),
      { status, headers: { "content-type": "application/json" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ errors: [{ code: "InvalidInput", message: "Body must be JSON: {ms: number}" }] }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const ms = typeof body?.ms === "number" ? body.ms : 0;
  advanceTime(ms);

  return new Response(
    JSON.stringify({ ok: true, advanced_ms: ms, virtual_now: virtualNow() }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
