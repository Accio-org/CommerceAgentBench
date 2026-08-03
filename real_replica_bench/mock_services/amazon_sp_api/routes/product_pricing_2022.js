/**
 * routes/product_pricing_2022.js
 * Product Pricing API v2022-05-01 — namespace /batches/products/pricing/2022-05-01
 *
 * Operations (2 total — both are batch-only; no single-item variants exist):
 *   POST /batches/products/pricing/2022-05-01/items/competitiveSummary   — getCompetitiveSummary
 *   POST /batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice — getFeaturedOfferExpectedPriceBatch
 *
 * Spec source: productPricing_2022-05-01.json swagger + fact sheet
 *   scratch/docs/api_alignment/amazon_spapi.md §Product Pricing API v2022-05-01
 *
 * Key alignment facts:
 *  1. Both are batch-only (no single-item GET endpoint).
 *  2. camelCase throughout — asin, marketplaceId, listingPrice, currencyCode, amount.
 *  3. FulfillmentType enum: "AFN" / "MFN" (NOT "Amazon"/"Merchant" — that's v0).
 *  4. getCompetitiveSummary lives HERE, not under /catalog/ (Wave 0 fabricated it wrongly).
 *  5. Batch responses use {responses: [{status, body}]} envelope.
 *  6. Rate limits are very low: 0.033 req/sec for both.
 *  7. lowestPricedOffersInputs is optional (0–5 per sub-request).
 *  8. MoneyType is camelCase: {amount: number, currencyCode: string}.
 */

import { randomUUID } from "crypto";
import { getPricingOffer } from "../lib/store.js";
import { jsonOk, jsonError } from "../lib/responses.js";
import { isASIN, isMarketplaceId } from "../lib/validation/common.js";
import {
  FULFILLMENT_TYPE_2022,
  COMPETITIVE_SUMMARY_INCLUDED_DATA,
  COMPETITIVE_SUMMARY_MAX_BATCH,
  FOEP_MAX_BATCH,
} from "../lib/validation/pricing.js";

// Rate limits per fact sheet (0.033 req/sec ≈ 1 request per ~30 seconds)
const RATE_LIMIT_COMP_SUMMARY = 0.033;
const RATE_LIMIT_FOEP = 0.033;

// ---------------------------------------------------------------------------
// Namespace descriptor
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Product Pricing",
  version: "2022-05-01",
  base: "/batches/products/pricing/2022-05-01",
  casing: "camelCase (distinct from v0 which is PascalCase)",
  wrapper: "{responses: [{status, body}]}",
};

// ---------------------------------------------------------------------------
// camelCase money helper — v2022-05-01 uses {amount, currencyCode} (lowercase)
// IMPORTANT: different from v0's {CurrencyCode, Amount} (PascalCase)
// ---------------------------------------------------------------------------

/**
 * Build a camelCase MoneyType for v2022-05-01.
 * @param {string} currencyCode
 * @param {number} amount
 * @returns {{ amount: number, currencyCode: string }}
 */
function money2022(currencyCode, amount) {
  return { amount: Number(amount), currencyCode };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /batches/products/pricing/2022-05-01/items/competitiveSummary — getCompetitiveSummary
 *
 * Body: { requests: CompetitiveSummaryRequest[] }
 * Each request: { uri, method, asin, marketplaceId, includedData[], lowestPricedOffersInputs? }
 *
 * Response: { responses: [{ status, body: CompetitiveSummaryResponseBody }] }
 *
 * Note: getCompetitiveSummary lives HERE, not under /catalog/ (confirmed from swagger path).
 */
async function handleGetCompetitiveSummary(req, _pathParams) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body is not valid JSON.", undefined, RATE_LIMIT_COMP_SUMMARY);
  }
  if (!body || !Array.isArray(body.requests)) {
    return jsonError(400, "InvalidInput", "Request body must have a 'requests' array.", undefined, RATE_LIMIT_COMP_SUMMARY);
  }
  if (body.requests.length > COMPETITIVE_SUMMARY_MAX_BATCH) {
    return jsonError(400, "InvalidParameterValue", `At most ${COMPETITIVE_SUMMARY_MAX_BATCH} requests per batch.`, undefined, RATE_LIMIT_COMP_SUMMARY);
  }
  if (body.requests.length === 0) {
    return jsonError(400, "MissingParameter", "requests array must not be empty.", undefined, RATE_LIMIT_COMP_SUMMARY);
  }

  const responses = body.requests.map((item) => {
    // All fields here are camelCase
    if (!item.asin || !isASIN(item.asin)) {
      return {
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "InvalidInput", message: `asin '${item.asin}' is invalid.` }] },
      };
    }
    if (!item.marketplaceId || !isMarketplaceId(item.marketplaceId)) {
      return {
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "InvalidParameterValue", message: `marketplaceId '${item.marketplaceId}' is not recognized.` }] },
      };
    }
    if (!Array.isArray(item.includedData) || item.includedData.length === 0) {
      return {
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "MissingParameter", message: "includedData must contain at least one value." }] },
      };
    }
    // Validate includedData enum
    for (const d of item.includedData) {
      if (!COMPETITIVE_SUMMARY_INCLUDED_DATA.has(d)) {
        return {
          status: { statusCode: 400, reasonPhrase: "Bad Request" },
          body: { errors: [{ code: "InvalidParameterValue", message: `includedData value '${d}' is not valid. Valid values: ${[...COMPETITIVE_SUMMARY_INCLUDED_DATA].join(", ")}` }] },
        };
      }
    }

    const pricingData = getPricingOffer(item.asin, item.marketplaceId);
    const currencyCode = item.marketplaceId === "A1PA6795UKMFR9" ? "EUR"
      : item.marketplaceId === "A1F83G8C2ARO7P" ? "GBP" : "USD";
    const basePrice = pricingData?.listingPrice ?? 29.99;
    const competitorPrice = pricingData?.competitorPrice ?? (basePrice * 0.97);

    const sections = new Set(item.includedData);
    // Build response body — camelCase throughout
    const responseBody = {
      asin: item.asin,
      marketplaceId: item.marketplaceId,
    };

    if (sections.has("featuredBuyingOptions")) {
      responseBody.featuredBuyingOptions = [
        {
          // "New" is currently the only buyingOptionType value
          buyingOptionType: "New",
          segmentedFeaturedOffers: [
            {
              segment: {
                customerMembership: "NON_PRIME",
                segmentDetails: {},
              },
              featuredOfferPrice: {
                listingPrice: money2022(currencyCode, competitorPrice),
                shipping: money2022(currencyCode, 0.00),
              },
              points: null,
            },
          ],
        },
      ];
    }

    if (sections.has("referencePrices")) {
      responseBody.referencePrices = [
        {
          name: "CompetitivePriceThreshold",
          price: money2022(currencyCode, competitorPrice * 1.05),
        },
        {
          name: "WasPrice",
          price: money2022(currencyCode, basePrice),
        },
      ];
    }

    if (sections.has("lowestPricedOffers")) {
      // Use lowestPricedOffersInputs from the request if provided (optional filter)
      const inputs = Array.isArray(item.lowestPricedOffersInputs) && item.lowestPricedOffersInputs.length > 0
        ? item.lowestPricedOffersInputs
        : [{ condition: "New", fulfillmentType: "AFN" }];

      responseBody.lowestPricedOffers = inputs.slice(0, 5).map((input) => ({
        lowestPricedOffersInput: {
          condition: input.condition || "New",
          // FulfillmentType is AFN/MFN here (NOT Amazon/Merchant — that's v0)
          fulfillmentType: FULFILLMENT_TYPE_2022.has(input.fulfillmentType) ? input.fulfillmentType : "AFN",
        },
        offers: [
          {
            offerIdentifier: {
              asin: item.asin,
              marketplaceId: item.marketplaceId,
              fulfillmentType: FULFILLMENT_TYPE_2022.has(input.fulfillmentType) ? input.fulfillmentType : "AFN",
            },
            condition: input.condition || "New",
            listingPrice: money2022(currencyCode, competitorPrice),
          },
        ],
      }));
    }

    if (sections.has("similarItems")) {
      responseBody.similarItems = { items: [] };
    }

    return {
      status: { statusCode: 200, reasonPhrase: "OK" },
      body: responseBody,
    };
  });

  return jsonOk({ responses }, { rateLimit: RATE_LIMIT_COMP_SUMMARY });
}

/**
 * POST /batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice — getFeaturedOfferExpectedPriceBatch
 *
 * Body: { requests: FeaturedOfferExpectedPriceRequest[] }
 * Each request: { uri, method, marketplaceId, sku, segment? }
 *
 * Response: { responses: [{ status, body: FeaturedOfferExpectedPriceResponse }] }
 */
async function handleGetFeaturedOfferExpectedPriceBatch(req, _pathParams) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body is not valid JSON.", undefined, RATE_LIMIT_FOEP);
  }
  if (!body || !Array.isArray(body.requests)) {
    return jsonError(400, "InvalidInput", "Request body must have a 'requests' array.", undefined, RATE_LIMIT_FOEP);
  }
  if (body.requests.length > FOEP_MAX_BATCH) {
    return jsonError(400, "InvalidParameterValue", `At most ${FOEP_MAX_BATCH} requests per batch.`, undefined, RATE_LIMIT_FOEP);
  }
  if (body.requests.length === 0) {
    return jsonError(400, "MissingParameter", "requests array must not be empty.", undefined, RATE_LIMIT_FOEP);
  }

  const responses = body.requests.map((item) => {
    if (!item.marketplaceId || !isMarketplaceId(item.marketplaceId)) {
      return {
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "InvalidParameterValue", message: `marketplaceId '${item.marketplaceId}' is not recognized.` }] },
      };
    }
    if (!item.sku) {
      return {
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "MissingParameter", message: "sku is required." }] },
      };
    }

    const currencyCode = item.marketplaceId === "A1PA6795UKMFR9" ? "EUR"
      : item.marketplaceId === "A1F83G8C2ARO7P" ? "GBP" : "USD";

    // Look up listing for ASIN (if available)
    // Note: sku field in v2022-05-01 is camelCase (lowercase sku)
    const asin = "B0BENCH001"; // default for smoke test purposes; real impl would look up from listings

    const foepPrice = 24.99;
    const competitorPrice = 25.50;

    const responseBody = {
      offerIdentifier: {
        marketplaceId: item.marketplaceId,
        asin,
        sku: item.sku,
        // fulfillmentType is AFN/MFN (v2022-05-01 casing)
        fulfillmentType: "MFN",
      },
      featuredOfferExpectedPriceResults: [
        {
          // resultStatus values from description text (not swagger enum)
          resultStatus: "VALID_FOEP",
          featuredOfferExpectedPrice: {
            listingPrice: money2022(currencyCode, foepPrice),
            points: null,
          },
          competingFeaturedOffer: {
            condition: "New",
            // AFN = Amazon Fulfillment Network (FBA)
            fulfillmentType: "AFN",
            listingPrice: money2022(currencyCode, competitorPrice),
            shippingOption: {},
          },
          currentFeaturedOffer: null,
        },
      ],
    };

    return {
      status: { statusCode: 200, reasonPhrase: "OK" },
      body: responseBody,
    };
  });

  return jsonOk({ responses }, { rateLimit: RATE_LIMIT_FOEP });
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "POST",
    path: "/batches/products/pricing/2022-05-01/items/competitiveSummary",
    handler: handleGetCompetitiveSummary,
    help: {
      description: "Batch competitive summary for ASINs. camelCase throughout. FulfillmentType: AFN|MFN (not Amazon|Merchant). Max 20 sub-requests. includedData enum: featuredBuyingOptions, referencePrices, lowestPricedOffers, similarItems.",
      params: [],
    },
  },
  {
    method: "POST",
    path: "/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice",
    handler: handleGetFeaturedOfferExpectedPriceBatch,
    help: {
      description: "Batch Featured Offer Expected Price (FOEP). Each request requires marketplaceId + sku. Max 40 sub-requests. resultStatus values: VALID_FOEP, NO_COMPETING_OFFER, OFFER_NOT_ELIGIBLE, OFFER_NOT_FOUND.",
      params: [],
    },
  },
];
