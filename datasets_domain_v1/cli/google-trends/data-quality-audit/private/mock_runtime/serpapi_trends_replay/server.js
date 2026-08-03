// serpapi_trends_replay — read-only mock of Google Trends data via SerpAPI's
// google_trends engine. Returns frozen snapshots covering multi-brand
// timeseries, GEO_MAP, single-query 5-year timeseries, DMA-level distribution,
// and one edge case (sparse query). Each dataset's metadata indicates its
// channel (shopping vs web), date range, and query list; the agent uses this
// metadata to pick the right dataset for a given task.
//
// Endpoints (discover via /api/help):
//   GET /health                           → 200 {"ok": true}
//   GET /api/help                         → top-level discovery
//   GET /api/datasets                     → list all datasets with metadata
//   GET /api/datasets/<id>                → raw Google Trends response JSON
//   GET /api/datasets/<id>/help           → response shape description
//
// Snapshots and metadata live under ./snapshots/. manifest.json enumerates the
// dataset catalog. No authentication, GET-only.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4500);
const SNAPSHOT_DIR = join(__dirname, "snapshots");
const MANIFEST_PATH = join(SNAPSHOT_DIR, "manifest.json");

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
const datasetsById = new Map();
for (const d of manifest.datasets) datasetsById.set(d.id, d);

// Pre-load every snapshot into memory at boot. The harness's
// scrub_mock_runtime_materials step deletes private/<task_id>/mock_runtime/
// shortly after launch — anything we need at request time must already be
// resident before that scrub fires.
const snapshotPayloads = new Map();
let loadedCount = 0, missingCount = 0;
if (existsSync(SNAPSHOT_DIR)) {
  for (const fn of readdirSync(SNAPSHOT_DIR)) {
    if (!fn.endsWith(".json") || fn === "manifest.json") continue;
    const dsId = fn.replace(/\.json$/, "");
    try {
      snapshotPayloads.set(dsId, JSON.parse(readFileSync(join(SNAPSHOT_DIR, fn), "utf-8")));
      loadedCount++;
    } catch (err) {
      console.error(`[serpapi_trends_replay] failed to load ${fn}: ${err.message}`);
      missingCount++;
    }
  }
}

console.log(
  `[serpapi_trends_replay] loaded ${manifest.datasets.length} manifest entries, ` +
  `${loadedCount} snapshot payloads in memory (${missingCount} failures), port=${PORT}`,
);

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function notFound(msg) {
  return json({ error: msg, hint: "GET /api/help to discover endpoints" }, 404);
}

const TOP_LEVEL_HELP = {
  base_url: `http://127.0.0.1:${PORT}/api`,
  description:
    "Read-only mock of Google Trends data via SerpAPI's google_trends engine. " +
    "Returns frozen snapshots of category-level (multi-brand) and single-query trend data.",
  endpoints: [
    {
      path: "/datasets",
      summary:
        "List all available trend datasets with metadata (channel, queries, date range, type).",
    },
    {
      path: "/datasets/<id>",
      summary:
        "Fetch the raw Google Trends response JSON for a specific dataset.",
    },
    {
      path: "/datasets/<id>/help",
      summary: "Describe the response shape for a given dataset.",
    },
  ],
  notes: [
    "All datasets are GET-only. No authentication. No body parsing.",
    "Each dataset's metadata field 'channel' is either 'shopping' (gprop=froogle) or 'web' (general search).",
    "When picking a dataset, match the channel and queries to your task's actual question.",
    "Trend values are normalized 0-100 within each dataset's API call. They are NOT comparable across datasets.",
    "Cross-call comparisons (e.g. shopping vs web channel for the same brand) require comparing distributions/rankings, not raw averages.",
  ],
};

const HELP_BY_TYPE = {
  multi_brand_timeseries: {
    response_shape: {
      search_metadata: {
        id: "string",
        status: "string",
        "...": "SerpAPI bookkeeping",
      },
      search_parameters: {
        engine: "google_trends",
        "...": "echoed input parameters",
      },
      interest_over_time: {
        timeline_data: [
          {
            date: "string (e.g. 'May 18 - 24, 2025')",
            timestamp: "string (epoch seconds)",
            partial_data:
              "boolean (true on the most recent in-progress week; otherwise omitted)",
            values: [
              {
                query: "string",
                value: "string",
                extracted_value: "integer 0-100",
              },
            ],
          },
        ],
      },
    },
    notes: [
      "Each timeline_data entry has one values[] item per query, in the same order as metadata.queries.",
      "Filter out partial_data:true entries before computing aggregates.",
      "Multi-query calls share a single normalization basis: the maximum value across all queries and weeks is mapped to 100.",
    ],
  },
  multi_brand_geo_map: {
    response_shape: {
      compared_breakdown_by_region: [
        {
          geo: "string (e.g. 'US-CA')",
          location: "string (e.g. 'California')",
          max_value_index: "integer (0-based index of the leading query in this region)",
          values: [
            {
              query: "string",
              value: "string (e.g. '99%')",
              extracted_value: "integer (per-region share, brands sum to ~100)",
            },
          ],
        },
      ],
    },
    notes: [
      "values[] is per-state share of the combined query interest in that state. Sums close to 100 within each location.",
      "max_value_index points at the brand with the largest share in that location.",
    ],
  },
  single_query_timeseries: {
    response_shape: {
      interest_over_time: {
        timeline_data: [
          {
            date: "string",
            values: [{ extracted_value: "integer 0-100" }],
          },
        ],
      },
    },
    notes: [
      "Single query: values[] always has length 1.",
      "Values normalized to this single query's peak (=100) over its whole timeline.",
    ],
  },
  single_query_dma_map: {
    response_shape: {
      interest_by_region: [
        {
          geo: "string (DMA code)",
          location: "string (e.g. 'New York NY')",
          extracted_value: "integer 0-100",
        },
      ],
    },
    notes: [
      "DMA = Designated Market Area (US TV market unit, ~211 total).",
      "Small-population DMAs can score 100 due to within-query normalization (sample-size artifact); apply DMA TV-household weighting before drawing conclusions about absolute volume.",
    ],
  },
};

function datasetHelp(dsId) {
  const ds = datasetsById.get(dsId);
  if (!ds) return null;
  return {
    dataset_id: dsId,
    metadata: ds,
    ...(HELP_BY_TYPE[ds.type] || {
      response_shape: "see /api/datasets/<id> response",
    }),
  };
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health") return json({ ok: true });
    if (path === "/api/help") return json(TOP_LEVEL_HELP);

    if (path === "/api/datasets") {
      return json({
        count: manifest.datasets.length,
        datasets: manifest.datasets,
      });
    }

    let m = path.match(/^\/api\/datasets\/([^\/]+)\/help$/);
    if (m) {
      const help = datasetHelp(m[1]);
      if (!help) return notFound(`unknown dataset: ${m[1]}`);
      return json(help);
    }

    m = path.match(/^\/api\/datasets\/([^\/]+)$/);
    if (m) {
      const dsId = m[1];
      const ds = datasetsById.get(dsId);
      if (!ds)
        return notFound(
          `unknown dataset: ${dsId}. GET /api/datasets to list.`,
        );
      const data = snapshotPayloads.get(dsId);
      if (!data) return notFound(`snapshot payload not loaded: ${dsId}`);
      return json(data);
    }

    if (path.startsWith("/api/")) return notFound(`no such endpoint: ${path}`);
    return notFound(`unknown path: ${path}`);
  },
});

console.log(
  `[serpapi_trends_replay] listening on http://${server.hostname}:${server.port}`,
);
