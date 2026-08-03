/**
 * lib/validation/pricing.js
 * Closed-set constants for Product Pricing v0 and v2022-05-01 namespaces.
 *
 * Source: productPricingV0.json + productPricing_2022-05-01.json (verified 2026-05-28)
 * + fact sheet scratch/docs/api_alignment/amazon_spapi.md
 *
 * CRITICAL casing traps:
 *   - Pricing v0: PascalCase dominant (MarketplaceId, ItemCondition, SellerSKU)
 *     with mixed-case exceptions (marketplaceId in GetOffersResult, condition camelCase)
 *   - Pricing v2022-05-01: camelCase throughout
 *   - FulfillmentType: "AFN"/"MFN" in v2022-05-01; "Amazon"/"Merchant" in v0
 */

// ---- Pricing v0 enums (PascalCase-dominant namespace) ----------------------

/**
 * ItemCondition enum for Pricing v0 query params and GetOffersResult.
 * PascalCase values: New, Used, Collectible, Refurbished, Club.
 * Source: ConditionType definition in productPricingV0.json + fact sheet.
 */
export const ITEM_CONDITION = new Set([
  "New",
  "Used",
  "Collectible",
  "Refurbished",
  "Club",
]);

/**
 * ItemType enum for getPricing / getCompetitivePricing.
 * Determines whether Asins or Skus param is used.
 */
export const ITEM_TYPE = new Set(["Asin", "Sku"]);

/**
 * CustomerType enum for getCompetitivePricing / getListingOffers / getItemOffers.
 */
export const CUSTOMER_TYPE = new Set(["Consumer", "Business"]);

/**
 * OfferType enum for getPricing.
 */
export const OFFER_TYPE_V0 = new Set(["B2C", "B2B"]);

/**
 * FulfillmentChannelType enum (Pricing v0 — different from v2022-05-01!).
 * Source: FulfillmentChannelType definition in productPricingV0.json.
 */
export const FULFILLMENT_CHANNEL_TYPE = new Set(["Amazon", "Merchant"]);

/**
 * Price.status values for getPricing / getCompetitivePricing.
 */
export const PRICE_STATUS = new Set(["Success", "ClientError", "ServiceError"]);

// ---- Pricing v2022-05-01 enums (camelCase namespace) -----------------------

/**
 * FulfillmentType enum for v2022-05-01.
 * AFN = Amazon Fulfillment Network (FBA), MFN = Merchant Fulfillment Network.
 * NOT "Amazon"/"Merchant" — that's the v0 spelling.
 * Source: fact sheet §Critical structural facts #4.
 */
export const FULFILLMENT_TYPE_2022 = new Set(["AFN", "MFN"]);

/**
 * includedData enum for getCompetitiveSummary sub-requests.
 * Source: CompetitiveSummaryIncludedData definition + fact sheet.
 */
export const COMPETITIVE_SUMMARY_INCLUDED_DATA = new Set([
  "featuredBuyingOptions",
  "referencePrices",
  "lowestPricedOffers",
  "similarItems",
]);

/**
 * buyingOptionType enum (only "New" currently).
 * Source: FeaturedBuyingOption.buyingOptionType in swagger.
 */
export const BUYING_OPTION_TYPE = new Set(["New"]);

/**
 * resultStatus values for FeaturedOfferExpectedPriceResult.
 * Not an enum in swagger — values from description text only.
 * Source: fact sheet §Critical structural facts #5 for v2022-05-01.
 */
export const FOEP_RESULT_STATUS = [
  "VALID_FOEP",
  "NO_COMPETING_OFFER",
  "OFFER_NOT_ELIGIBLE",
  "OFFER_NOT_FOUND",
];

/**
 * Max batch sizes.
 */
export const COMPETITIVE_SUMMARY_MAX_BATCH = 20;
export const FOEP_MAX_BATCH = 40;
