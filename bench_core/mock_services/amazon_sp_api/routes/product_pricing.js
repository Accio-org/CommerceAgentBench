/**
 * routes/product_pricing.js
 * Product Pricing API v0 — namespace /products/pricing/v0 + /batches/products/pricing/v0
 *
 * Operations (6 total):
 *   GET  /products/pricing/v0/price                             — getPricing
 *   GET  /products/pricing/v0/competitivePrice                  — getCompetitivePricing
 *   GET  /products/pricing/v0/listings/{SellerSKU}/offers       — getListingOffers
 *   GET  /products/pricing/v0/items/{Asin}/offers               — getItemOffers
 *   POST /batches/products/pricing/v0/itemOffers                — getItemOffersBatch
 *   POST /batches/products/pricing/v0/listingOffers             — getListingOffersBatch
 *
 * Spec source: productPricingV0.json swagger + fact sheet
 *   scratch/docs/api_alignment/amazon_spapi.md §Product Pricing API v0
 *
 * CRITICAL casing alignment facts:
 *  1. payload is ARRAY for getPricing / getCompetitivePricing (one Price per ASIN/SKU).
 *  2. payload is SINGLE OBJECT (GetOffersResult) for getListingOffers / getItemOffers.
 *  3. MoneyType.Amount is a NUMBER (float) — NOT a string. Opposite of Orders v0.
 *  4. MIXED casing: MarketplaceId/ItemCondition/SellerSKU/ASIN are PascalCase;
 *     marketplaceId/sellerId/condition/belongsToRequester are camelCase in sub-objects.
 *  5. Path params use PascalCase: {SellerSKU} and {Asin}.
 *  6. MarketplaceId query param is SINGULAR string (not array like other namespaces).
 *  7. CompetitivePriceId values are strings "1" and "2" (not integers).
 *  8. Batch operations live under /batches/... prefix, not /products/pricing/v0/.
 *  9. Standard {payload: ..., errors: []} wrapper on all responses.
 */

import { randomUUID } from "crypto";
import {
  getPricingOffer,
  getPricingOfferBySKU,
  getCatalogItemByAsin,
  getListingBySMK,
} from "../lib/store.js";
import { jsonOk, jsonError, parseArrayParam } from "../lib/responses.js";
import { isASIN, isMarketplaceId } from "../lib/validation/common.js";
import {
  ITEM_CONDITION,
  ITEM_TYPE,
  CUSTOMER_TYPE,
  OFFER_TYPE_V0,
} from "../lib/validation/pricing.js";

// Rate limits per fact sheet
const RATE_LIMIT_GET_PRICING = 0.5;
const RATE_LIMIT_GET_COMP = 0.5;
const RATE_LIMIT_LISTING_OFFERS = 1;
const RATE_LIMIT_ITEM_OFFERS = 0.5;
const RATE_LIMIT_BATCH_ITEM = 0.1;
const RATE_LIMIT_BATCH_LISTING = 0.5;

// ---------------------------------------------------------------------------
// Namespace descriptor
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Product Pricing",
  version: "v0",
  base: "/products/pricing/v0",
  casing: "mixed (PascalCase-dominant with camelCase exceptions in sub-objects)",
  wrapper: "{payload: ..., errors: []}",
};

// ---------------------------------------------------------------------------
// Money helpers — PascalCase, Amount is a NUMBER (not string)
// ---------------------------------------------------------------------------

/**
 * Build a MoneyType for Pricing v0.
 * IMPORTANT: Amount must be a number (float), not a string.
 * @param {string} currencyCode
 * @param {number} amount
 * @returns {{ CurrencyCode: string, Amount: number }}
 */
function money(currencyCode, amount) {
  return { CurrencyCode: currencyCode, Amount: Number(amount) };
}

// ---------------------------------------------------------------------------
// Default offer generator — builds plausible offers from seed pricing data
// ---------------------------------------------------------------------------

/**
 * Build a synthetic Price entry (for getPricing payload array).
 * @param {string} asin
 * @param {string} marketplaceId
 * @param {string|null} sellerSKU
 * @param {string} itemType - "Asin" or "Sku"
 * @returns {object}
 */
function buildPriceEntry(asin, marketplaceId, sellerSKU, itemType) {
  const pricingData = getPricingOffer(asin, marketplaceId);
  const currencyCode = marketplaceId === "A1PA6795UKMFR9" ? "EUR"
    : marketplaceId === "A1F83G8C2ARO7P" ? "GBP" : "USD";

  // Fall back to seeded data if available, else synthesize
  const basePrice = pricingData?.listingPrice ?? 29.99;

  const priceEntry = {
    status: "Success",
    ...(itemType === "Asin" ? { ASIN: asin } : { SellerSKU: sellerSKU }),
    Product: {
      Identifiers: {
        MarketplaceASIN: {
          MarketplaceId: marketplaceId,
          ASIN: asin,
        },
        ...(sellerSKU ? { SKUIdentifier: { MarketplaceId: marketplaceId, SellerId: "A2BENCH00001", SellerSKU: sellerSKU } } : {}),
      },
      Offers: [
        {
          BuyingPrice: {
            ListingPrice: money(currencyCode, basePrice),
            Shipping: money(currencyCode, 0.00),
          },
          RegularPrice: money(currencyCode, basePrice),
          FulfillmentChannel: "Amazon",
          ItemCondition: "New",
          ItemSubCondition: "New",
          ...(sellerSKU ? { SellerSKU: sellerSKU } : {}),
        },
      ],
    },
  };

  return priceEntry;
}

/**
 * Build a synthetic GetOffersResult for getListingOffers / getItemOffers.
 * Note: payload here is a SINGLE OBJECT (not array).
 * Mixed casing: marketplaceId (camelCase) coexists with ItemCondition (PascalCase).
 * @param {string} asin
 * @param {string} marketplaceId
 * @param {string|null} sellerSKU
 * @param {string} itemCondition - e.g. "New"
 * @returns {object}
 */
function buildOffersResult(asin, marketplaceId, sellerSKU, itemCondition) {
  const pricingData = getPricingOffer(asin, marketplaceId);
  const currencyCode = marketplaceId === "A1PA6795UKMFR9" ? "EUR"
    : marketplaceId === "A1F83G8C2ARO7P" ? "GBP" : "USD";
  const basePrice = pricingData?.listingPrice ?? 29.99;
  const competitorPrice = pricingData?.competitorPrice ?? (basePrice * 0.97);

  return {
    // marketplaceId is camelCase in GetOffersResult (fact sheet §Critical structural facts #4)
    marketplaceId,
    ...(asin && !sellerSKU ? { ASIN: asin } : {}),
    ...(sellerSKU ? { SKU: sellerSKU } : {}),
    // ItemCondition is PascalCase
    ItemCondition: itemCondition,
    status: "Success",
    Identifier: {
      MarketplaceId: marketplaceId,
      ...(sellerSKU ? { SellerSKU: sellerSKU } : { ASIN: asin }),
      ItemCondition: itemCondition,
    },
    Summary: {
      TotalOfferCount: 3,
      NumberOfOffers: [
        { condition: "new", fulfillmentChannel: "Amazon", OfferCount: 2 },
        { condition: "new", fulfillmentChannel: "Merchant", OfferCount: 1 },
      ],
      LowestPrices: [
        {
          condition: "new",
          fulfillmentChannel: "Amazon",
          ListingPrice: money(currencyCode, competitorPrice),
          Shipping: money(currencyCode, 0.00),
        },
      ],
      BuyBoxPrices: [
        {
          condition: "New",
          LandedPrice: money(currencyCode, competitorPrice),
          ListingPrice: money(currencyCode, competitorPrice),
          Shipping: money(currencyCode, 0.00),
        },
      ],
    },
    Offers: [
      {
        SubCondition: "New",
        ListingPrice: money(currencyCode, competitorPrice),
        Shipping: money(currencyCode, 0.00),
        ShippingTime: { maximumHours: 24, minimumHours: 12, availabilityType: "NOW" },
        IsFulfilledByAmazon: true,
        IsBuyBoxWinner: true,
        IsFeaturedMerchant: true,
      },
      {
        SubCondition: "New",
        ListingPrice: money(currencyCode, basePrice),
        Shipping: money(currencyCode, 3.99),
        ShippingTime: { maximumHours: 72, minimumHours: 24, availabilityType: "NOW" },
        IsFulfilledByAmazon: false,
        IsBuyBoxWinner: false,
        IsFeaturedMerchant: false,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /products/pricing/v0/price — getPricing
 *
 * Required: MarketplaceId (singular), ItemType (Asin or Sku)
 * Required (either/or): Asins (if ItemType=Asin) or Skus (if ItemType=Sku)
 * Optional: ItemCondition, OfferType
 *
 * Response: { payload: Price[], errors: [] } — payload is an ARRAY
 */
async function handleGetPricing(req, _pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  // MarketplaceId — singular, PascalCase, required
  const marketplaceId = sp.get("MarketplaceId");
  if (!marketplaceId) {
    return jsonError(400, "MissingParameter", "MarketplaceId is required.", "MarketplaceId: required", RATE_LIMIT_GET_PRICING);
  }
  if (!isMarketplaceId(marketplaceId)) {
    return jsonError(400, "InvalidParameterValue", `MarketplaceId '${marketplaceId}' is not recognized.`, undefined, RATE_LIMIT_GET_PRICING);
  }

  // ItemType — required
  const itemType = sp.get("ItemType");
  if (!itemType) {
    return jsonError(400, "MissingParameter", "ItemType is required.", "ItemType: required (Asin or Sku)", RATE_LIMIT_GET_PRICING);
  }
  if (!ITEM_TYPE.has(itemType)) {
    return jsonError(400, "InvalidParameterValue", `ItemType '${itemType}' is not valid. Valid values: ${[...ITEM_TYPE].join(", ")}`, undefined, RATE_LIMIT_GET_PRICING);
  }

  // Asins / Skus
  const asins = parseArrayParam(sp.get("Asins"));
  const skus = parseArrayParam(sp.get("Skus"));
  if (itemType === "Asin" && asins.length === 0) {
    return jsonError(400, "MissingParameter", "Asins is required when ItemType=Asin.", undefined, RATE_LIMIT_GET_PRICING);
  }
  if (itemType === "Sku" && skus.length === 0) {
    return jsonError(400, "MissingParameter", "Skus is required when ItemType=Sku.", undefined, RATE_LIMIT_GET_PRICING);
  }
  if (asins.length > 20 || skus.length > 20) {
    return jsonError(400, "InvalidParameterValue", "At most 20 identifiers may be specified.", undefined, RATE_LIMIT_GET_PRICING);
  }

  // Optional: ItemCondition, OfferType
  const itemConditionParam = sp.get("ItemCondition");
  if (itemConditionParam && !ITEM_CONDITION.has(itemConditionParam)) {
    return jsonError(400, "InvalidParameterValue", `ItemCondition '${itemConditionParam}' is not valid. Valid values: ${[...ITEM_CONDITION].join(", ")}`, undefined, RATE_LIMIT_GET_PRICING);
  }
  const offerType = sp.get("OfferType") ?? "B2C";
  if (!OFFER_TYPE_V0.has(offerType)) {
    return jsonError(400, "InvalidParameterValue", `OfferType '${offerType}' is not valid.`, undefined, RATE_LIMIT_GET_PRICING);
  }

  // Build payload array — one entry per requested identifier
  const ids = itemType === "Asin" ? asins : skus;
  const payload = ids.map((id) => {
    if (itemType === "Asin") {
      // Try to resolve ASIN from catalog
      const catalogItem = getCatalogItemByAsin(id);
      if (!catalogItem) {
        return { status: "ClientError", ASIN: id };
      }
      return buildPriceEntry(id, marketplaceId, null, "Asin");
    } else {
      // SKU — look up listing to find ASIN
      const listing = getListingBySMK("A2BENCH00001", marketplaceId, id);
      const asin = listing?.asin || "UNKNOWN";
      return buildPriceEntry(asin, marketplaceId, id, "Sku");
    }
  });

  return jsonOk({ payload, errors: [] }, { rateLimit: RATE_LIMIT_GET_PRICING });
}

/**
 * GET /products/pricing/v0/competitivePrice — getCompetitivePricing
 *
 * Similar to getPricing but adds CompetitivePricing section.
 * Required: MarketplaceId, ItemType; Required (either/or): Asins or Skus.
 * Optional: CustomerType
 *
 * Response: { payload: Price[], errors: [] } — payload is an ARRAY
 */
async function handleGetCompetitivePricing(req, _pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const marketplaceId = sp.get("MarketplaceId");
  if (!marketplaceId) {
    return jsonError(400, "MissingParameter", "MarketplaceId is required.", undefined, RATE_LIMIT_GET_COMP);
  }
  if (!isMarketplaceId(marketplaceId)) {
    return jsonError(400, "InvalidParameterValue", `MarketplaceId '${marketplaceId}' is not recognized.`, undefined, RATE_LIMIT_GET_COMP);
  }

  const itemType = sp.get("ItemType");
  if (!itemType || !ITEM_TYPE.has(itemType)) {
    return jsonError(400, itemType ? "InvalidParameterValue" : "MissingParameter", itemType ? `ItemType '${itemType}' is not valid.` : "ItemType is required.", undefined, RATE_LIMIT_GET_COMP);
  }

  const asins = parseArrayParam(sp.get("Asins"));
  const skus = parseArrayParam(sp.get("Skus"));
  if (itemType === "Asin" && asins.length === 0) {
    return jsonError(400, "MissingParameter", "Asins is required when ItemType=Asin.", undefined, RATE_LIMIT_GET_COMP);
  }
  if (itemType === "Sku" && skus.length === 0) {
    return jsonError(400, "MissingParameter", "Skus is required when ItemType=Sku.", undefined, RATE_LIMIT_GET_COMP);
  }
  if (asins.length > 20 || skus.length > 20) {
    return jsonError(400, "InvalidParameterValue", "At most 20 identifiers may be specified.", undefined, RATE_LIMIT_GET_COMP);
  }

  const customerType = sp.get("CustomerType") ?? "Consumer";
  if (!CUSTOMER_TYPE.has(customerType)) {
    return jsonError(400, "InvalidParameterValue", `CustomerType '${customerType}' is not valid.`, undefined, RATE_LIMIT_GET_COMP);
  }

  const currencyCode = marketplaceId === "A1PA6795UKMFR9" ? "EUR"
    : marketplaceId === "A1F83G8C2ARO7P" ? "GBP" : "USD";

  const ids = itemType === "Asin" ? asins : skus;
  const payload = ids.map((id) => {
    const asinVal = itemType === "Asin" ? id : (getListingBySMK("A2BENCH00001", marketplaceId, id)?.asin || "UNKNOWN");
    const pricingData = getPricingOffer(asinVal, marketplaceId);
    const basePrice = pricingData?.listingPrice ?? 29.99;
    const competitorPrice = pricingData?.competitorPrice ?? (basePrice * 0.97);

    return {
      status: "Success",
      ...(itemType === "Asin" ? { ASIN: id } : { SellerSKU: id }),
      Product: {
        Identifiers: {
          MarketplaceASIN: { MarketplaceId: marketplaceId, ASIN: asinVal },
        },
        CompetitivePricing: {
          CompetitivePrices: [
            {
              // CompetitivePriceId values are STRINGS "1" and "2" (not integers)
              CompetitivePriceId: "1",
              Price: {
                LandedPrice: money(currencyCode, competitorPrice),
                ListingPrice: money(currencyCode, competitorPrice),
                Shipping: money(currencyCode, 0.00),
              },
              // condition and belongsToRequester are camelCase (mixed-casing in same object)
              condition: "New",
              belongsToRequester: true,
            },
          ],
          NumberOfOfferListings: [
            { condition: "New", fulfillmentChannel: "Amazon", Count: 3 },
            { condition: "New", fulfillmentChannel: "Merchant", Count: 2 },
          ],
        },
      },
    };
  });

  return jsonOk({ payload, errors: [] }, { rateLimit: RATE_LIMIT_GET_COMP });
}

/**
 * GET /products/pricing/v0/listings/{SellerSKU}/offers — getListingOffers
 *
 * Path param: SellerSKU (PascalCase)
 * Required: MarketplaceId (query singular), ItemCondition (PascalCase enum)
 * Optional: CustomerType
 *
 * Response: { payload: GetOffersResult, errors: [] } — payload is a SINGLE OBJECT
 */
async function handleGetListingOffers(req, pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  // Path param is PascalCase SellerSKU
  const { SellerSKU } = pathParams;

  const marketplaceId = sp.get("MarketplaceId");
  if (!marketplaceId) {
    return jsonError(400, "MissingParameter", "MarketplaceId is required.", undefined, RATE_LIMIT_LISTING_OFFERS);
  }
  if (!isMarketplaceId(marketplaceId)) {
    return jsonError(400, "InvalidParameterValue", `MarketplaceId '${marketplaceId}' is not recognized.`, undefined, RATE_LIMIT_LISTING_OFFERS);
  }

  const itemCondition = sp.get("ItemCondition");
  if (!itemCondition) {
    return jsonError(400, "MissingParameter", "ItemCondition is required.", undefined, RATE_LIMIT_LISTING_OFFERS);
  }
  if (!ITEM_CONDITION.has(itemCondition)) {
    return jsonError(400, "InvalidParameterValue", `ItemCondition '${itemCondition}' is not valid. Valid values: ${[...ITEM_CONDITION].join(", ")}`, undefined, RATE_LIMIT_LISTING_OFFERS);
  }

  const customerType = sp.get("CustomerType") ?? "Consumer";
  if (!CUSTOMER_TYPE.has(customerType)) {
    return jsonError(400, "InvalidParameterValue", `CustomerType '${customerType}' is not valid.`, undefined, RATE_LIMIT_LISTING_OFFERS);
  }

  // Look up listing to find ASIN
  const listing = getListingBySMK("A2BENCH00001", marketplaceId, SellerSKU);
  const asin = listing?.asin || `B0BENCH001`; // fall back to a known ASIN for test data

  const payload = buildOffersResult(asin, marketplaceId, SellerSKU, itemCondition);
  return jsonOk({ payload, errors: [] }, { rateLimit: RATE_LIMIT_LISTING_OFFERS });
}

/**
 * GET /products/pricing/v0/items/{Asin}/offers — getItemOffers
 *
 * Path param: Asin (PascalCase)
 * Required: MarketplaceId (query singular), ItemCondition
 * Optional: CustomerType
 *
 * Response: { payload: GetOffersResult, errors: [] } — payload is a SINGLE OBJECT
 */
async function handleGetItemOffers(req, pathParams) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  // Path param is PascalCase Asin (not {asin})
  const { Asin } = pathParams;

  if (!isASIN(Asin)) {
    return jsonError(400, "InvalidParameterValue", `Asin '${Asin}' is invalid. Must match ^[A-Z0-9]{10}$.`, undefined, RATE_LIMIT_ITEM_OFFERS);
  }

  const marketplaceId = sp.get("MarketplaceId");
  if (!marketplaceId) {
    return jsonError(400, "MissingParameter", "MarketplaceId is required.", undefined, RATE_LIMIT_ITEM_OFFERS);
  }
  if (!isMarketplaceId(marketplaceId)) {
    return jsonError(400, "InvalidParameterValue", `MarketplaceId '${marketplaceId}' is not recognized.`, undefined, RATE_LIMIT_ITEM_OFFERS);
  }

  const itemCondition = sp.get("ItemCondition");
  if (!itemCondition) {
    return jsonError(400, "MissingParameter", "ItemCondition is required.", undefined, RATE_LIMIT_ITEM_OFFERS);
  }
  if (!ITEM_CONDITION.has(itemCondition)) {
    return jsonError(400, "InvalidParameterValue", `ItemCondition '${itemCondition}' is not valid. Valid values: ${[...ITEM_CONDITION].join(", ")}`, undefined, RATE_LIMIT_ITEM_OFFERS);
  }

  const customerType = sp.get("CustomerType") ?? "Consumer";
  if (!CUSTOMER_TYPE.has(customerType)) {
    return jsonError(400, "InvalidParameterValue", `CustomerType '${customerType}' is not valid.`, undefined, RATE_LIMIT_ITEM_OFFERS);
  }

  // Check catalog exists (optional — provide synthetic data even if not in catalog)
  const payload = buildOffersResult(Asin, marketplaceId, null, itemCondition);
  return jsonOk({ payload, errors: [] }, { rateLimit: RATE_LIMIT_ITEM_OFFERS });
}

/**
 * POST /batches/products/pricing/v0/itemOffers — getItemOffersBatch
 *
 * Body: { requests: ItemOffersRequest[] }
 * Each request: { uri, method, MarketplaceId, ItemCondition, CustomerType?, Asin }
 *
 * Response: { responses: [{headers, status, body}] }
 */
async function handleGetItemOffersBatch(req, _pathParams) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body is not valid JSON.", undefined, RATE_LIMIT_BATCH_ITEM);
  }
  if (!body || !Array.isArray(body.requests)) {
    return jsonError(400, "InvalidInput", "Request body must have a 'requests' array.", undefined, RATE_LIMIT_BATCH_ITEM);
  }

  const responses = body.requests.map((item) => {
    const reqId = randomUUID();
    // Validate required fields per batch item
    if (!item.Asin || !isASIN(item.Asin)) {
      return {
        headers: { "x-amzn-RequestId": reqId },
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "InvalidInput", message: `Asin '${item.Asin}' is invalid.` }] },
      };
    }
    if (!item.MarketplaceId || !isMarketplaceId(item.MarketplaceId)) {
      return {
        headers: { "x-amzn-RequestId": reqId },
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "InvalidParameterValue", message: `MarketplaceId '${item.MarketplaceId}' is not recognized.` }] },
      };
    }
    const itemCondition = item.ItemCondition || "New";
    if (!ITEM_CONDITION.has(itemCondition)) {
      return {
        headers: { "x-amzn-RequestId": reqId },
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "InvalidParameterValue", message: `ItemCondition '${itemCondition}' is not valid.` }] },
      };
    }

    const offersResult = buildOffersResult(item.Asin, item.MarketplaceId, null, itemCondition);
    return {
      headers: { "x-amzn-RequestId": reqId, "Date": new Date().toUTCString() },
      status: { statusCode: 200, reasonPhrase: "OK" },
      body: offersResult,
    };
  });

  return jsonOk({ responses }, { rateLimit: RATE_LIMIT_BATCH_ITEM });
}

/**
 * POST /batches/products/pricing/v0/listingOffers — getListingOffersBatch
 *
 * Body: { requests: ListingOffersRequest[] }
 * Each request: { uri, method, MarketplaceId, ItemCondition, CustomerType?, SellerSKU }
 *
 * Response: { responses: [{headers, status, body}] }
 */
async function handleGetListingOffersBatch(req, _pathParams) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body is not valid JSON.", undefined, RATE_LIMIT_BATCH_LISTING);
  }
  if (!body || !Array.isArray(body.requests)) {
    return jsonError(400, "InvalidInput", "Request body must have a 'requests' array.", undefined, RATE_LIMIT_BATCH_LISTING);
  }

  const responses = body.requests.map((item) => {
    const reqId = randomUUID();
    if (!item.SellerSKU) {
      return {
        headers: { "x-amzn-RequestId": reqId },
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "MissingParameter", message: "SellerSKU is required." }] },
      };
    }
    if (!item.MarketplaceId || !isMarketplaceId(item.MarketplaceId)) {
      return {
        headers: { "x-amzn-RequestId": reqId },
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "InvalidParameterValue", message: `MarketplaceId '${item.MarketplaceId}' is not recognized.` }] },
      };
    }
    const itemCondition = item.ItemCondition || "New";
    if (!ITEM_CONDITION.has(itemCondition)) {
      return {
        headers: { "x-amzn-RequestId": reqId },
        status: { statusCode: 400, reasonPhrase: "Bad Request" },
        body: { errors: [{ code: "InvalidParameterValue", message: `ItemCondition '${itemCondition}' is not valid.` }] },
      };
    }

    // Look up listing for ASIN
    const listing = getListingBySMK("A2BENCH00001", item.MarketplaceId, item.SellerSKU);
    const asin = listing?.asin || "B0BENCH001";
    const offersResult = buildOffersResult(asin, item.MarketplaceId, item.SellerSKU, itemCondition);
    return {
      headers: { "x-amzn-RequestId": reqId, "Date": new Date().toUTCString() },
      status: { statusCode: 200, reasonPhrase: "OK" },
      body: offersResult,
    };
  });

  return jsonOk({ responses }, { rateLimit: RATE_LIMIT_BATCH_LISTING });
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "GET",
    path: "/products/pricing/v0/price",
    handler: handleGetPricing,
    help: {
      description: "Get pricing for up to 20 ASINs or seller SKUs. Required: MarketplaceId (singular), ItemType (Asin|Sku). Returns payload as ARRAY. Amount is a number (not string).",
      params: [
        { name: "MarketplaceId", type: "string", required: true, note: "PascalCase; singular (not array)" },
        { name: "ItemType", type: "string", required: true, note: "Values: Asin, Sku" },
        { name: "Asins", type: "string[]", required: false, note: "Required when ItemType=Asin; up to 20" },
        { name: "Skus", type: "string[]", required: false, note: "Required when ItemType=Sku; up to 20" },
        { name: "ItemCondition", type: "string", required: false, note: "Values: New, Used, Collectible, Refurbished, Club" },
        { name: "OfferType", type: "string", required: false, note: "Values: B2C, B2B (default B2C)" },
      ],
    },
  },
  {
    method: "GET",
    path: "/products/pricing/v0/competitivePrice",
    handler: handleGetCompetitivePricing,
    help: {
      description: "Get competitive pricing for ASINs or SKUs. Required: MarketplaceId, ItemType. Returns payload as ARRAY with CompetitivePricing section. CompetitivePriceId values are strings '1'/'2'.",
      params: [
        { name: "MarketplaceId", type: "string", required: true },
        { name: "ItemType", type: "string", required: true, note: "Values: Asin, Sku" },
        { name: "Asins", type: "string[]", required: false },
        { name: "Skus", type: "string[]", required: false },
        { name: "CustomerType", type: "string", required: false, note: "Values: Consumer, Business (default Consumer)" },
      ],
    },
  },
  {
    method: "GET",
    path: "/products/pricing/v0/listings/:SellerSKU/offers",
    handler: handleGetListingOffers,
    help: {
      description: "Get offers for a seller's listing by SKU. Path param is PascalCase {SellerSKU}. payload is a SINGLE OBJECT (GetOffersResult), not an array.",
      params: [
        { name: "SellerSKU", type: "string", required: true, note: "Path param — PascalCase" },
        { name: "MarketplaceId", type: "string", required: true, note: "Singular string (not array)" },
        { name: "ItemCondition", type: "string", required: true, note: "Values: New, Used, Collectible, Refurbished, Club" },
        { name: "CustomerType", type: "string", required: false, note: "Values: Consumer, Business" },
      ],
    },
  },
  {
    method: "GET",
    path: "/products/pricing/v0/items/:Asin/offers",
    handler: handleGetItemOffers,
    help: {
      description: "Get offers for an item by ASIN. Path param is PascalCase {Asin}. payload is a SINGLE OBJECT (GetOffersResult), not an array.",
      params: [
        { name: "Asin", type: "string", required: true, note: "Path param — PascalCase; must match ^[A-Z0-9]{10}$" },
        { name: "MarketplaceId", type: "string", required: true },
        { name: "ItemCondition", type: "string", required: true, note: "Values: New, Used, Collectible, Refurbished, Club" },
        { name: "CustomerType", type: "string", required: false },
      ],
    },
  },
  {
    method: "POST",
    path: "/batches/products/pricing/v0/itemOffers",
    handler: handleGetItemOffersBatch,
    help: {
      description: "Batch getItemOffers. Body: {requests: [{uri, method, Asin, MarketplaceId, ItemCondition, CustomerType?}]}. Response: {responses: [{headers, status, body}]}.",
      params: [],
    },
  },
  {
    method: "POST",
    path: "/batches/products/pricing/v0/listingOffers",
    handler: handleGetListingOffersBatch,
    help: {
      description: "Batch getListingOffers. Body: {requests: [{uri, method, SellerSKU, MarketplaceId, ItemCondition, CustomerType?}]}. Response: {responses: [{headers, status, body}]}.",
      params: [],
    },
  },
];
