/**
 * lib/validation/fees.js
 * Closed-set constants for Product Fees API v0 namespace.
 *
 * Source: productFeesV0.json (verified 2026-05-28) + fact sheet
 * scratch/docs/api_alignment/amazon_spapi.md §Product Fees API v0
 *
 * Casing: PascalCase throughout (IsAmazonFulfilled, MarketplaceId, ListingPrice, etc.)
 */

import { KNOWN_MARKETPLACE_IDS } from "./common.js";

/**
 * IdType enum for batch getMyFeesEstimates request/response.
 * Source: IdType definition in productFeesV0.json.
 */
export const ID_TYPE = new Set(["ASIN", "SellerSKU"]);

/**
 * OptionalFulfillmentProgram enum.
 * Source: OptionalFulfillmentProgram definition in productFeesV0.json + fact sheet.
 */
export const OPTIONAL_FULFILLMENT_PROGRAM = new Set([
  "FBA_CORE",
  "FBA_SNL",
  "FBA_EFN",
]);

/**
 * FeesEstimateResult.Status values.
 * PascalCase — "Success", not "SUCCESS".
 * Source: fact sheet §Critical structural facts #5.
 */
export const FEE_ESTIMATE_STATUS = new Set(["Success", "ClientError", "ServiceError"]);

/**
 * Known FeeType values for FeeDetail (not enumerated in swagger; realistic mock values).
 * Source: fact sheet §Critical structural facts #7.
 */
export const FEE_TYPES = ["ReferralFee", "VariableClosingFee", "FBAFees",
  "FBAPerUnitFulfillmentFee", "FBAWeightHandlingFee"];

// Re-export for use in product_fees.js route
export { KNOWN_MARKETPLACE_IDS };
