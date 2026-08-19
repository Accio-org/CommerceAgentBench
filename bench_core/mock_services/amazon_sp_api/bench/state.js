/**
 * bench/state.js
 * GET /__bench/state — requires verifier token
 *
 * Returns full store snapshot. Verifier reads this to score the task.
 */

import { snapshot } from "../lib/store.js";

/**
 * @param {Request} req
 * @param {{ verifierToken: string }} opts
 * @returns {Response}
 */
export function handleState(req, { verifierToken }) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (!verifierToken || token !== verifierToken) {
    const status = token ? 403 : 401;
    return new Response(
      JSON.stringify({ errors: [{ code: "AccessDenied", message: "Invalid or missing verifier token." }] }),
      { status, headers: { "content-type": "application/json" } }
    );
  }

  return new Response(JSON.stringify(snapshot()), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
