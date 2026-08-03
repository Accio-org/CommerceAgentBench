/**
 * routes/product_fees.js
 * Product Fees API v0 — namespace /products/fees/v0
 *
 * Operations (3 total):
 *   POST /products/fees/v0/listings/{SellerSKU}/feesEstimate  — getMyFeesEstimateForSKU
 *   POST /products/fees/v0/items/{Asin}/feesEstimate          — getMyFeesEstimateForASIN
 *   POST /products/fees/v0/feesEstimate                       — getMyFeesEstimates (batch)
 *
 * Spec source: productFeesV0.json swagger + fact sheet
 *   scratch/docs/api_alignment/amazon_spapi.md §Product Fees API v0
 *
 * Key alignment facts:
 *  1. All three ops are POST (read-only estimation, but price must be in the body).
 *  2. Single-item request body: {"FeesEstimateRequest": {...}} (PascalCase wrapper key).
 *  3. getMyFeesEstimates (batch): request AND response are BARE ARRAYS — no {payload: ...}.
 *  4. Single-item response: {payload: {FeesEstimateResult: {...}}} (standard wrapper).
 *  5. Amount is a NUMBER (float) — same as Pricing v0, different from Orders v0.
 *  6. PascalCase throughout: MarketplaceId, IsAmazonFulfilled, PriceToEstimateFees,
 *     ListingPrice, TotalFeesEstimate, FeeType, FeeAmount.
 *  7. Identifier in request is echoed back as SellerInputIdentifier in response.
 *  8. IsAmazonFulfilled changes fee structure (FBA vs MFN).
 *
 * Fee calculation model (deterministic, documented here for test reproducibility):
 *   ReferralFee = 15% × ListingPrice.Amount  (standard category rate)
 *   If IsAmazonFulfilled = true (FBA):
 *     FBAPerUnitFulfillmentFee = $3.50 base (standard size < 1 lb)
 *     FBAWeightHandlingFee = $0.10 × estimated_lbs (we use 1 lb default)
 *     TotalFeesEstimate = ReferralFee + FBAFees
 *   If IsAmazonFulfilled = false (MFN):
 *     VariableClosingFee = $0.00 (most categories)
 *     TotalFeesEstimate = ReferralFee
 */

import { randomUUID } from "crypto";
import { jsonOk, jsonError } from "../lib/responses.js";
import { isASIN, isMarketplaceId } from "../lib/validation/common.js";
import { OPTIONAL_FULFILLMENT_PROGRAM, ID_TYPE } from "../lib/validation/fees.js";

// Rate limits per fact sheet
const RATE_LIMIT_SKU = 1;
const RATE_LIMIT_ASIN = 1;
const RATE_LIMIT_BATCH = 0.5;

// ---------------------------------------------------------------------------
// Namespace descriptor
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Product Fees",
  version: "v0",
  base: "/products/fees/v0",
  casing: "PascalCase throughout",
  wrapper: "{payload: {FeesEstimateResult}} for single; bare array for batch",
};

// ---------------------------------------------------------------------------
// Fee calculation helpers
// ---------------------------------------------------------------------------

/**
 * Build a MoneyType in PascalCase (Fees v0 convention).
 * Amount is a NUMBER (not string) — same as Pricing v0.
 * @param {string} currencyCode
 * @param {number} amount
 * @returns {{ CurrencyCode: string, Amount: number }}
 */
function money(currencyCode, amount) {
  return { CurrencyCode: currencyCode, Amount: Number(parseFloat(amount).toFixed(2)) };
}

/**
 * Compute fee breakdown from a price and fulfillment mode.
 *
 * Model (documented in file header):
 *   ReferralFee = 15% × listingAmount
 *   If FBA: FBAFees = $3.50 + $0.10 × 1lb
 *   Total = ReferralFee + (IsAmazonFulfilled ? FBAFees : 0)
 *
 * @param {number} listingAmount - listing price (numeric)
 * @param {boolean} isAmazonFulfilled - FBA vs MFN
 * @param {string} currencyCode
 * @returns {{ TotalFeesEstimate: object, FeeDetailList: object[] }}
 */
function computeFees(listingAmount, isAmazonFulfilled, currencyCode) {
  const referralFeeAmount = listingAmount * 0.15;
  const fbaFeeAmount = isAmazonFulfilled ? 3.50 + 0.10 * 1 : 0;
  const totalAmount = referralFeeAmount + fbaFeeAmount;

  const feeDetails = [
    {
      FeeType: "ReferralFee",
      FeeAmount: money(currencyCode, referralFeeAmount),
      FeePromotion: money(currencyCode, 0.00),
      TaxAmount: money(currencyCode, 0.00),
      FinalFee: money(currencyCode, referralFeeAmount),
    },
  ];

  if (isAmazonFulfilled) {
    feeDetails.push({
      FeeType: "FBAFees",
      FeeAmount: money(currencyCode, fbaFeeAmount),
      FeePromotion: money(currencyCode, 0.00),
      TaxAmount: money(currencyCode, 0.00),
      FinalFee: money(currencyCode, fbaFeeAmount),
      IncludedFeeDetailList: [
        {
          FeeType: "FBAPerUnitFulfillmentFee",
          FeeAmount: money(currencyCode, 3.50),
          FinalFee: money(currencyCode, 3.50),
        },
        {
          FeeType: "FBAWeightHandlingFee",
          FeeAmount: money(currencyCode, 0.10),
          FinalFee: money(currencyCode, 0.10),
        },
      ],
    });
  }

  return {
    TotalFeesEstimate: money(currencyCode, totalAmount),
    FeeDetailList: feeDetails,
  };
}

/**
 * Validate the FeesEstimateRequest sub-object.
 * Returns { valid: true } or { valid: false, error: { code, message, details } }
 *
 * @param {object|undefined} feesEstimateRequest
 * @returns {{ valid: boolean, code?: string, message?: string, details?: string }}
 */
function validateFeesEstimateRequest(feesEstimateRequest) {
  if (!feesEstimateRequest || typeof feesEstimateRequest !== "object") {
    return { valid: false, code: "MissingParameter", message: "FeesEstimateRequest is required." };
  }
  if (!feesEstimateRequest.MarketplaceId) {
    return { valid: false, code: "MissingParameter", message: "FeesEstimateRequest.MarketplaceId is required." };
  }
  if (!isMarketplaceId(feesEstimateRequest.MarketplaceId)) {
    return { valid: false, code: "InvalidParameterValue", message: `FeesEstimateRequest.MarketplaceId '${feesEstimateRequest.MarketplaceId}' is not recognized.` };
  }
  if (!feesEstimateRequest.Identifier) {
    return { valid: false, code: "MissingParameter", message: "FeesEstimateRequest.Identifier is required." };
  }
  if (!feesEstimateRequest.PriceToEstimateFees) {
    return { valid: false, code: "MissingParameter", message: "FeesEstimateRequest.PriceToEstimateFees is required." };
  }
  if (!feesEstimateRequest.PriceToEstimateFees.ListingPrice) {
    return { valid: false, code: "MissingParameter", message: "PriceToEstimateFees.ListingPrice is required." };
  }
  if (typeof feesEstimateRequest.PriceToEstimateFees.ListingPrice.Amount !== "number") {
    return { valid: false, code: "InvalidParameterValue", message: "ListingPrice.Amount must be a number." };
  }
  if (feesEstimateRequest.OptionalFulfillmentProgram &&
      !OPTIONAL_FULFILLMENT_PROGRAM.has(feesEstimateRequest.OptionalFulfillmentProgram)) {
    return {
      valid: false,
      code: "InvalidParameterValue",
      message: `OptionalFulfillmentProgram '${feesEstimateRequest.OptionalFulfillmentProgram}' is not valid. Valid values: ${[...OPTIONAL_FULFILLMENT_PROGRAM].join(", ")}`,
    };
  }
  return { valid: true };
}

/**
 * Build a FeesEstimateResult object.
 * @param {string} marketplaceId
 * @param {string} idType - "SellerSKU" or "ASIN"
 * @param {string} idValue - the SKU or ASIN
 * @param {string} sellerId
 * @param {boolean} isAmazonFulfilled
 * @param {object} priceToEstimateFees
 * @param {string} identifier - echo from request
 * @param {string|undefined} optionalFulfillmentProgram
 * @returns {object}
 */
function buildFeesEstimateResult(
  marketplaceId, idType, idValue, sellerId,
  isAmazonFulfilled, priceToEstimateFees, identifier, optionalFulfillmentProgram
) {
  const listingPrice = priceToEstimateFees.ListingPrice;
  const currencyCode = listingPrice.CurrencyCode || "USD";
  const { TotalFeesEstimate, FeeDetailList } = computeFees(
    listingPrice.Amount,
    isAmazonFulfilled,
    currencyCode
  );

  return {
    Status: "Success",
    FeesEstimateIdentifier: {
      MarketplaceId: marketplaceId,
      ...(sellerId ? { SellerId: sellerId } : {}),
      IdType: idType,
      IdValue: idValue,
      IsAmazonFulfilled: isAmazonFulfilled,
      PriceToEstimateFees: priceToEstimateFees,
      // Identifier from request is echoed back as SellerInputIdentifier
      SellerInputIdentifier: identifier,
      ...(optionalFulfillmentProgram ? { OptionalFulfillmentProgram: optionalFulfillmentProgram } : {}),
    },
    FeesEstimate: {
      TimeOfFeesEstimation: new Date().toISOString(),
      TotalFeesEstimate,
      FeeDetailList,
    },
    Error: null,
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /products/fees/v0/listings/{SellerSKU}/feesEstimate — getMyFeesEstimateForSKU
 *
 * Path param: SellerSKU (PascalCase)
 * Body: { "FeesEstimateRequest": { MarketplaceId, IsAmazonFulfilled, PriceToEstimateFees, Identifier, ... } }
 * (Note the single-key PascalCase wrapper — body is NOT the FeesEstimateRequest directly)
 *
 * Response: { payload: { FeesEstimateResult: {...} } } (standard wrapper)
 */
async function handleGetMyFeesEstimateForSKU(req, pathParams) {
  const { SellerSKU } = pathParams;

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body is not valid JSON.", undefined, RATE_LIMIT_SKU);
  }

  // Body is {"FeesEstimateRequest": {...}} — the PascalCase one-field wrapper
  if (!body || !body.FeesEstimateRequest) {
    return jsonError(400, "MissingParameter", "Request body must have a 'FeesEstimateRequest' key.", "FeesEstimateRequest: required PascalCase wrapper key", RATE_LIMIT_SKU);
  }

  const fer = body.FeesEstimateRequest;
  const validation = validateFeesEstimateRequest(fer);
  if (!validation.valid) {
    return jsonError(400, validation.code, validation.message, validation.details, RATE_LIMIT_SKU);
  }

  const isAmazonFulfilled = fer.IsAmazonFulfilled === true;
  const result = buildFeesEstimateResult(
    fer.MarketplaceId,
    "SellerSKU",
    SellerSKU,
    "A2BENCH00001",
    isAmazonFulfilled,
    fer.PriceToEstimateFees,
    fer.Identifier,
    fer.OptionalFulfillmentProgram
  );

  return jsonOk({ payload: { FeesEstimateResult: result } }, { rateLimit: RATE_LIMIT_SKU });
}

/**
 * POST /products/fees/v0/items/{Asin}/feesEstimate — getMyFeesEstimateForASIN
 *
 * Path param: Asin (PascalCase)
 * Body: same {"FeesEstimateRequest": {...}} shape
 * Response: same {payload: {FeesEstimateResult: {...}}} but IdType = "ASIN"
 */
async function handleGetMyFeesEstimateForASIN(req, pathParams) {
  const { Asin } = pathParams;

  if (!isASIN(Asin)) {
    return jsonError(400, "InvalidParameterValue", `Asin '${Asin}' is invalid. Must match ^[A-Z0-9]{10}$.`, undefined, RATE_LIMIT_ASIN);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body is not valid JSON.", undefined, RATE_LIMIT_ASIN);
  }

  if (!body || !body.FeesEstimateRequest) {
    return jsonError(400, "MissingParameter", "Request body must have a 'FeesEstimateRequest' key.", undefined, RATE_LIMIT_ASIN);
  }

  const fer = body.FeesEstimateRequest;
  const validation = validateFeesEstimateRequest(fer);
  if (!validation.valid) {
    return jsonError(400, validation.code, validation.message, validation.details, RATE_LIMIT_ASIN);
  }

  const isAmazonFulfilled = fer.IsAmazonFulfilled === true;
  const result = buildFeesEstimateResult(
    fer.MarketplaceId,
    "ASIN",
    Asin,
    "A2BENCH00001",
    isAmazonFulfilled,
    fer.PriceToEstimateFees,
    fer.Identifier,
    fer.OptionalFulfillmentProgram
  );

  return jsonOk({ payload: { FeesEstimateResult: result } }, { rateLimit: RATE_LIMIT_ASIN });
}

/**
 * POST /products/fees/v0/feesEstimate — getMyFeesEstimates (batch)
 *
 * Request body is a BARE ARRAY (not {"requests": [...]} — a raw JSON array).
 * Each element: { FeesEstimateRequest: {...}, IdType: "ASIN"|"SellerSKU", IdValue: "..." }
 *
 * Response is also a BARE ARRAY — NOT wrapped in {payload: ...}.
 * Each element is a FeesEstimateResult (same fields as single-item FeesEstimateResult).
 */
async function handleGetMyFeesEstimates(req, _pathParams) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body is not valid JSON.", undefined, RATE_LIMIT_BATCH);
  }

  // Request body must be a bare array — NOT an object with requests key
  if (!Array.isArray(body)) {
    return jsonError(400, "InvalidInput", "getMyFeesEstimates request body must be a bare JSON array (not wrapped in an object).", "Expected: [{...}, {...}] not {requests: [...]}", RATE_LIMIT_BATCH);
  }
  if (body.length === 0) {
    return jsonError(400, "MissingParameter", "Request array must not be empty.", undefined, RATE_LIMIT_BATCH);
  }

  // Build response array — also a bare array
  const responseArray = body.map((item) => {
    // Validate IdType and IdValue
    if (!item.IdType || !ID_TYPE.has(item.IdType)) {
      return {
        Status: "ClientError",
        FeesEstimateIdentifier: {
          IdType: item.IdType || "unknown",
          IdValue: item.IdValue || "unknown",
          IsAmazonFulfilled: false,
          SellerInputIdentifier: item.FeesEstimateRequest?.Identifier || "unknown",
        },
        FeesEstimate: null,
        Error: { code: "InvalidParameterValue", message: `IdType '${item.IdType}' is not valid. Valid values: ${[...ID_TYPE].join(", ")}` },
      };
    }
    if (!item.IdValue) {
      return {
        Status: "ClientError",
        FeesEstimateIdentifier: {
          IdType: item.IdType,
          IdValue: "",
          IsAmazonFulfilled: false,
          SellerInputIdentifier: item.FeesEstimateRequest?.Identifier || "unknown",
        },
        FeesEstimate: null,
        Error: { code: "MissingParameter", message: "IdValue is required." },
      };
    }

    const fer = item.FeesEstimateRequest || {};
    const validation = validateFeesEstimateRequest(fer);
    if (!validation.valid) {
      return {
        Status: "ClientError",
        FeesEstimateIdentifier: {
          MarketplaceId: fer.MarketplaceId || "unknown",
          IdType: item.IdType,
          IdValue: item.IdValue,
          IsAmazonFulfilled: false,
          SellerInputIdentifier: fer.Identifier || "unknown",
        },
        FeesEstimate: null,
        Error: { code: validation.code, message: validation.message },
      };
    }

    const isAmazonFulfilled = fer.IsAmazonFulfilled === true;
    // The batch response shape is flat FeesEstimateResult (NOT nested inside payload.FeesEstimateResult)
    return buildFeesEstimateResult(
      fer.MarketplaceId,
      item.IdType,
      item.IdValue,
      "A2BENCH00001",
      isAmazonFulfilled,
      fer.PriceToEstimateFees,
      fer.Identifier,
      fer.OptionalFulfillmentProgram
    );
  });

  // Response is a bare array — no {payload: ...} wrapper
  return jsonOk(responseArray, { rateLimit: RATE_LIMIT_BATCH });
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "POST",
    path: "/products/fees/v0/listings/:SellerSKU/feesEstimate",
    handler: handleGetMyFeesEstimateForSKU,
    help: {
      description: "Estimate fees for a listing by SKU. Body: {FeesEstimateRequest: {MarketplaceId, PriceToEstimateFees: {ListingPrice: {CurrencyCode, Amount: number}}, Identifier, IsAmazonFulfilled?, OptionalFulfillmentProgram?}}. Amount is a NUMBER. Returns {payload: {FeesEstimateResult: {...}}}.",
      params: [
        { name: "SellerSKU", type: "string", required: true, note: "Path param — PascalCase" },
      ],
    },
  },
  {
    method: "POST",
    path: "/products/fees/v0/items/:Asin/feesEstimate",
    handler: handleGetMyFeesEstimateForASIN,
    help: {
      description: "Estimate fees for a listing by ASIN. Same body as SKU variant but path param is Asin. IdType in response will be 'ASIN'.",
      params: [
        { name: "Asin", type: "string", required: true, note: "Path param — PascalCase; must match ^[A-Z0-9]{10}$" },
      ],
    },
  },
  {
    method: "POST",
    path: "/products/fees/v0/feesEstimate",
    handler: handleGetMyFeesEstimates,
    help: {
      description: "Batch fee estimation. Request body is a BARE JSON ARRAY (not {requests:[...]}). Each element: {FeesEstimateRequest: {...}, IdType: ASIN|SellerSKU, IdValue: string}. Response is also a BARE ARRAY — no {payload:...} wrapper.",
      params: [],
    },
  },
];
