/**
 * bench/health.js
 * GET /__bench/health — no auth required
 *
 * Returns service health + entity counts. Used by start_mock_services.sh
 * to confirm the server is ready before test execution begins.
 */

import { entityCounts } from "../lib/store.js";
import { buildHelp } from "../lib/help.js";

const startTime = Date.now();

/**
 * @param {Request} _req
 * @returns {Response}
 */
export function handleHealth(_req) {
  const counts = entityCounts();
  const help = buildHelp();
  return new Response(
    JSON.stringify({
      status: "ok",
      uptime_ms: Date.now() - startTime,
      loaded: {
        namespaces: help.coverage.namespaces,
        endpoints: help.coverage.endpoints,
        entities_by_type: counts,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}
