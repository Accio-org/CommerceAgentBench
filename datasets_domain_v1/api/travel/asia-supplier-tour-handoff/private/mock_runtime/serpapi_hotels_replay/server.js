// serpapi_hotels_replay — read-only mock of SerpAPI's google_hotels engine.
//
// Used by v2 commerce/sourcing tasks that need real-shape hotel candidate
// data (multi-OTA prices, amenities, excluded_amenities, nearby_places,
// reviews_breakdown, hotel_class) without hitting the live network.
//
// Endpoints (discover via /api/help):
//   GET /health                           → 200 {"ok": true}
//   GET /api/help                         → top-level discovery
//   GET /api/datasets                     → list all datasets with metadata
//   GET /api/datasets/<id>                → raw google_hotels response JSON
//   GET /api/datasets/<id>/help           → response shape description
//
// Snapshots and metadata live under ./snapshots/. manifest.json enumerates
// the dataset catalog. No authentication, GET-only.
//
// Pre-loads every snapshot into memory at boot. The harness's
// scrub_mock_runtime_materials step (real_replica_bench/cli.py:389)
// deletes private/<task_id>/mock_runtime/ shortly after launch — anything
// we need at request time must be resident before that scrub fires.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4501);
const SNAPSHOT_DIR = join(__dirname, "snapshots");
const MANIFEST_PATH = join(SNAPSHOT_DIR, "manifest.json");

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
const datasetsById = new Map();
for (const d of manifest.datasets) datasetsById.set(d.id, d);

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
      console.error(`[serpapi_hotels_replay] failed to load ${fn}: ${err.message}`);
      missingCount++;
    }
  }
}

console.log(
  `[serpapi_hotels_replay] loaded ${manifest.datasets.length} manifest entries, ` +
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
    "Read-only mock of Google Hotels data via SerpAPI's google_hotels engine. " +
    "Returns frozen snapshots of hotel/vacation-rental search results for " +
    "specific (city, check_in, check_out) tuples — used by commerce/sourcing " +
    "trip-planning audit tasks.",
  endpoints: [
    {
      path: "/datasets",
      summary:
        "List all available hotel-search datasets with metadata (city, dates, currency, guest count, underlying SerpAPI params).",
    },
    {
      path: "/datasets/<id>",
      summary:
        "Fetch the raw SerpAPI google_hotels response JSON for a specific dataset (one search result).",
    },
    {
      path: "/datasets/<id>/help",
      summary: "Describe the response shape for a given dataset.",
    },
  ],
  notes: [
    "All endpoints are GET-only. No authentication. No body parsing.",
    "Each dataset's response carries the SerpAPI google_hotels schema: search_metadata, search_parameters, properties[], ads[], brands[], serpapi_pagination.",
    "properties[] entries are the candidate hotels; each has rate_per_night, total_rate, prices[] (multi-OTA), amenities[], excluded_amenities[], nearby_places[], reviews_breakdown[], gps_coordinates, hotel_class.",
    "For Chinese-locale properties (e.g. shenzhen_huaqiang, yiwu_market) Google Hotels does not surface OTA prices in the listing-level response — agent must rely on hotel_class, reviews_breakdown, nearby_places, amenities for those datasets.",
    "When the agent's task requires comparing pre-tax vs post-tax pricing, use rate_per_night.before_taxes_fees / rate_per_night.lowest (and the corresponding total_rate fields).",
    "When property amenities[] and excluded_amenities[] conflict, the disambiguation rule must come from the task's authoritative source (policy doc / task.md spec) — this mock returns SerpAPI's data verbatim.",
  ],
};

const RESPONSE_SHAPE = {
  search_metadata: { id: "string", status: "string", "...": "SerpAPI bookkeeping" },
  search_parameters: { engine: "google_hotels", q: "string", check_in_date: "YYYY-MM-DD", check_out_date: "YYYY-MM-DD", "...": "echoed input" },
  search_information: { total_results: "integer" },
  properties: [
    {
      type: "'hotel' | 'vacation rental'",
      name: "string",
      property_token: "string (use to fetch single-property detail)",
      gps_coordinates: { latitude: "float", longitude: "float" },
      hotel_class: "string e.g. '5-star hotel' (may be absent on vacation rentals)",
      extracted_hotel_class: "integer 1-5 (may be absent)",
      check_in_time: "string e.g. '3:00 PM'",
      check_out_time: "string e.g. '12:00 PM'",
      rate_per_night: {
        lowest: "string formatted '$N'",
        extracted_lowest: "float (numeric)",
        before_taxes_fees: "string '$N' (when separately disclosed)",
        extracted_before_taxes_fees: "float (when separately disclosed)",
      },
      total_rate: { lowest: "string", extracted_lowest: "float", "...": "same shape as rate_per_night" },
      prices: [
        {
          source: "string OTA name e.g. 'Agoda', 'Booking.com'",
          rate_per_night: { lowest: "string", extracted_lowest: "float", "...": "same as rate_per_night" },
          num_guests: "integer",
          free_cancellation: "boolean (when present)",
          free_cancellation_until_date: "string e.g. 'Sep 19' (when present)",
          free_cancellation_until_time: "string (when present)",
        },
      ],
      overall_rating: "float (Google rating)",
      reviews: "integer (Google review count)",
      ratings: [{ stars: "1-5 integer", count: "integer" }],
      reviews_breakdown: [
        {
          name: "string e.g. 'Service' / 'Property' / 'Bar' / 'Breakfast' / 'Dining' / 'Fitness' / 'Nature'",
          total_mentioned: "integer",
          positive: "integer",
          negative: "integer",
          neutral: "integer",
        },
      ],
      location_rating: "float",
      amenities: ["string e.g. 'Free Wi-Fi', 'Pool'"],
      excluded_amenities: ["string e.g. 'Not wheelchair accessible', 'No Wi-Fi'"],
      nearby_places: [
        { name: "string", transportations: [{ type: "'Taxi' | 'Public transport' | 'Walking'", duration: "string e.g. '15 min'" }] },
      ],
      essential_info: ["string (vacation rentals only) e.g. 'Sleeps 6', '3 bedrooms'"],
      images: [{ thumbnail: "string url", original_image: "string url" }],
    },
  ],
  ads: ["array of sponsored property entries (when present)"],
  brands: ["array of {id, name, children: [...]} for brand-filter input"],
  serpapi_pagination: { current_from: "integer", current_to: "integer", next_page_token: "string" },
};

function datasetHelp(dsId) {
  const ds = datasetsById.get(dsId);
  if (!ds) return null;
  return {
    dataset_id: dsId,
    metadata: ds,
    response_shape: RESPONSE_SHAPE,
    notes: [
      "Agent typically reads payload.properties[] for hotel candidates.",
      "payload.ads[] is sponsored — not always relevant to selection.",
      "Use property_token to call SerpAPI's property-details endpoint for richer per-property data (this mock does not stub property-detail fetches).",
    ],
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
        return notFound(`unknown dataset: ${dsId}. GET /api/datasets to list.`);
      const data = snapshotPayloads.get(dsId);
      if (!data) return notFound(`snapshot payload not loaded: ${dsId}`);
      return json(data);
    }

    if (path.startsWith("/api/")) return notFound(`no such endpoint: ${path}`);
    return notFound(`unknown path: ${path}`);
  },
});

console.log(
  `[serpapi_hotels_replay] listening on http://${server.hostname}:${server.port}`,
);
