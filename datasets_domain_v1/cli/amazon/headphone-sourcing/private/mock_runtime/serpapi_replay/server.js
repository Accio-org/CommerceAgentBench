// serpapi_replay — read-only mock of SerpAPI's amazon + amazon_product engines.
//
// Endpoints (discover via /api/help):
//   GET /api/help
//   GET /api/categories
//   GET /api/categories/help
//   GET /api/products?category=<X>
//   GET /api/products/help
//   GET /api/products/<asin>
//   GET /api/products/_/help    (underscore is a literal placeholder)
//
// No authentication; closed snapshot data; agent free to call any path.
// Errors return { error, hint } pointing back to /api/help so an agent can
// self-correct without us leaking endpoint names in the task prompt.
//
// Health: GET /health → 200 {"ok": true}

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4500);
const SNAPSHOT_DIR = join(__dirname, "snapshots");
const SEARCH_DIR = join(SNAPSHOT_DIR, "search");
const PRODUCT_DIR = join(SNAPSHOT_DIR, "products");

// ---------- Load snapshots once at startup ----------
function loadSearch() {
  const byCategory = {};                       // category -> [list-mode rows]
  const productSummaryByAsin = new Map();      // asin -> {asin, title, brand, price, rating, reviews, bought_last_month, in_categories}
  if (!existsSync(SEARCH_DIR)) {
    console.error(`[warn] search dir missing: ${SEARCH_DIR}`);
    return { byCategory, productSummaryByAsin };
  }
  for (const fn of readdirSync(SEARCH_DIR).filter((f) => f.endsWith(".json"))) {
    const slug = fn.replace(/\.json$/, "");
    const data = JSON.parse(readFileSync(join(SEARCH_DIR, fn), "utf-8"));
    const organic = (data.payload && data.payload.organic_results) || [];
    const rows = [];
    for (const r of organic) {
      const asin = r.asin;
      if (!asin) continue;
      // Brand: parse from title first token (search has no brand field)
      const brand = (r.title || "").split(/\s+/)[0] || "";
      const row = {
        asin,
        title: r.title,
        brand,
        price: r.extracted_price ?? null,
        rating: r.rating ?? null,
        reviews: r.reviews ?? null,
        bought_last_month: r.bought_last_month || null,
      };
      rows.push(row);

      const existing = productSummaryByAsin.get(asin);
      if (existing) {
        existing.in_categories.push(slug);
      } else {
        productSummaryByAsin.set(asin, { ...row, in_categories: [slug] });
      }
    }
    byCategory[slug] = rows;
  }
  return { byCategory, productSummaryByAsin };
}

function loadProducts() {
  const byAsin = new Map();
  if (!existsSync(PRODUCT_DIR)) {
    console.error(`[warn] product dir missing: ${PRODUCT_DIR}`);
    return byAsin;
  }
  for (const fn of readdirSync(PRODUCT_DIR).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(PRODUCT_DIR, fn), "utf-8"));
    const asin = (data._meta && data._meta.asin) || fn.replace(/\.json$/, "");
    byAsin.set(asin, data.payload || {});
  }
  return byAsin;
}

const { byCategory, productSummaryByAsin } = loadSearch();
const productDetails = loadProducts();
const categories = Object.keys(byCategory).sort();

console.log(
  `[serpapi_replay] loaded categories=${categories.length} ` +
    `unique_asins=${productSummaryByAsin.size} ` +
    `detail_asins=${productDetails.size} port=${PORT}`,
);

// ---------- Helpers ----------
function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function notFound(msg) {
  return json(
    { error: msg, hint: "GET /api/help to discover endpoints" },
    404,
  );
}

function badRequest(msg) {
  return json(
    { error: msg, hint: "GET /api/help to discover endpoints" },
    400,
  );
}

// ---------- /api/help (hierarchical discovery) ----------
const TOP_LEVEL_HELP = {
  base_url: `http://127.0.0.1:${PORT}/api`,
  description:
    "Read-only mock of an Amazon-like product API. Snapshots are frozen at build time.",
  endpoints: [
    {
      path: "/categories",
      summary: "List the product subcategories known to this API.",
    },
    {
      path: "/products",
      summary:
        "List products in a given subcategory. Returns short rows (asin, title, brand, price, rating, reviews).",
    },
    {
      path: "/products/<asin>",
      summary:
        "Full product detail for a single ASIN — specs, about_item bullets, reviews summary, related products, etc.",
    },
  ],
  usage:
    "Call <endpoint>/help (e.g. /api/products/help) for parameters and response shape.",
  notes: [
    "All endpoints are GET-only. No authentication. No body parsing.",
    "Snapshots reflect Amazon US data captured via SerpAPI's amazon and amazon_product engines.",
  ],
};

const CATEGORIES_HELP = {
  method: "GET",
  path: "/api/categories",
  params: {},
  returns: { categories: ["string", "..."] },
  example_curl: `curl http://127.0.0.1:${PORT}/api/categories`,
  example_response: { categories: categories.slice(0, 3).concat(["..."]) },
};

const PRODUCTS_LIST_HELP = {
  method: "GET",
  path: "/api/products",
  params: {
    category: {
      required: true,
      type: "string",
      description:
        "One of the values returned by /api/categories. Returns 400 if absent or unknown.",
    },
  },
  returns: {
    category: "string (echo of the input)",
    count: "integer",
    products: [
      {
        asin: "string (10-char Amazon ASIN)",
        title: "string",
        brand: "string (first token of title — search data has no brand field)",
        price: "number | null (USD)",
        rating: "number | null (0-5)",
        reviews: "integer | null (review count)",
        bought_last_month: "string | null (e.g. '10K+ bought in past month')",
      },
    ],
  },
  example_curl: `curl 'http://127.0.0.1:${PORT}/api/products?category=bone_conduction'`,
};

const PRODUCT_DETAIL_HELP = {
  method: "GET",
  path: "/api/products/<asin>",
  params: {
    asin: {
      required: true,
      type: "string (path param)",
      description: "10-character Amazon ASIN. Returns 404 if not in snapshot.",
    },
  },
  returns: {
    asin: "string",
    product_results: {
      title: "string",
      rating: "number",
      reviews: "integer",
      badges: "string[] (may be absent)",
      "...": "see live response for full field set",
    },
    item_specifications: {
      brand: "string",
      ear_placement: "string (e.g. 'Open Ear')",
      form_factor: "string (e.g. 'True Wireless', 'Open Ear')",
      earpiece_shape: "string (e.g. 'Open_ear', 'ear hooks')",
      audio_driver_type:
        "string (e.g. 'Bone Conduction Driver', 'Dynamic Driver')",
      "...": "more spec fields",
    },
    product_details: {
      brand_name: "string",
      model_name: "string",
      best_sellers_rank: "array",
      water_resistance_level: "string",
      battery_average_life: "string",
      "...": "many more detail fields",
    },
    about_item: ["string (5-6 bullet points of product selling points)"],
    reviews_information: {
      summary: {
        text: "string (overall review prose)",
        insights: [
          {
            title: "string (e.g. 'Sound quality')",
            sentiment: "string ('positive' | 'mixed' | 'negative')",
            mentions: {
              total: "integer",
              positive: "integer",
              negative: "integer",
            },
            summary: "string",
            examples: [{ snippet: "string", link: "string" }],
          },
        ],
      },
    },
    related_products: [{ asin: "string", title: "string", "...": "..." }],
    bought_together: "array | null (often absent)",
    videos: "array",
    sponsored_brands: "array",
  },
  example_curl: `curl http://127.0.0.1:${PORT}/api/products/B0D2HKCMBP`,
  note:
    "Detail data is independent from search list — some fields like price live in purchase_options.single_offer.extracted_price, not product_results.",
};

// ---------- Router ----------
const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // health
    if (path === "/health") return json({ ok: true });

    // /api/help — top-level discovery
    if (path === "/api/help") return json(TOP_LEVEL_HELP);

    // /api/categories and /api/categories/help
    if (path === "/api/categories/help") return json(CATEGORIES_HELP);
    if (path === "/api/categories") return json({ categories });

    // /api/products/help — list-mode help
    if (path === "/api/products/help") return json(PRODUCTS_LIST_HELP);

    // /api/products/_/help — detail-mode help (underscore is literal placeholder)
    if (path === "/api/products/_/help") return json(PRODUCT_DETAIL_HELP);

    // /api/products — list mode (requires ?category=)
    if (path === "/api/products") {
      const cat = url.searchParams.get("category");
      if (!cat) {
        return badRequest(
          "missing required query parameter: category. GET /api/products/help for details.",
        );
      }
      if (!(cat in byCategory)) {
        return badRequest(
          `unknown category=${JSON.stringify(cat)}. Known categories: ${categories.join(", ")}`,
        );
      }
      const products = byCategory[cat];
      return json({ category: cat, count: products.length, products });
    }

    // /api/products/<asin>/help — same as /api/products/_/help
    let m = path.match(/^\/api\/products\/([^\/]+)\/help$/);
    if (m) return json(PRODUCT_DETAIL_HELP);

    // /api/products/<asin> — detail mode
    m = path.match(/^\/api\/products\/([^\/]+)$/);
    if (m) {
      const asin = m[1];
      if (asin === "_") {
        return badRequest(
          "underscore is a placeholder. GET /api/products/_/help for the request shape.",
        );
      }
      const detail = productDetails.get(asin);
      if (!detail) {
        const summary = productSummaryByAsin.get(asin);
        if (summary) {
          return json(
            {
              error: `ASIN ${asin} appears in search results but no detail snapshot is available in this mock.`,
              partial_summary: summary,
              hint: "Detail coverage is partial. Try a different ASIN or fall back to the /api/products list fields.",
            },
            404,
          );
        }
        return notFound(`unknown ASIN: ${asin}`);
      }
      return json({ asin, ...detail });
    }

    // any other /api/ path
    if (path.startsWith("/api/")) {
      return notFound(`no such endpoint: ${path}`);
    }

    return notFound(`unknown path: ${path}`);
  },
});

console.log(`[serpapi_replay] listening on http://${server.hostname}:${server.port}`);
