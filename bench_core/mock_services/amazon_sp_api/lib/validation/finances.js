/**
 * lib/validation/finances.js
 * Closed-set enum constants and date-range validators for Finances API v0.
 *
 * Fact-sheet source: scratch/docs/api_alignment/amazon_spapi.md §Finances API v0
 *
 * Critical money-type reminder enforced at the route level:
 *   Finances v0 uses { CurrencyCode: "USD", CurrencyAmount: 29.99 }
 *   NOT { CurrencyCode: "USD", Amount: "29.99" } (Orders v0 trap).
 *   CurrencyAmount is a NUMBER, not a string. Negative = outflow from seller.
 */

import { isISO8601 } from "../validation/common.js";
import { ValidationError } from "../validation/common.js";

// ---------------------------------------------------------------------------
// AdjustmentType enum — used in AdjustmentEvent.AdjustmentType
// Source: fact sheet §AdjustmentEvent + Amazon SP-API docs
// ---------------------------------------------------------------------------

export const ADJUSTMENT_TYPES = new Set([
  "FBAInventoryReimbursement",
  "ReserveEvent",
  "PostageBilling",
  "PostageRefund",
  "LostOrDamagedReimbursement",
  "CanceledButPickedUpReimbursement",
  "ReimbursementClawback",
  "SellerRewards",
]);

// ---------------------------------------------------------------------------
// ChargeType enum — used in ChargeComponent.ChargeType
// Source: fact sheet §ChargeComponent schema
// ---------------------------------------------------------------------------

export const CHARGE_TYPES = new Set([
  "Principal",
  "Tax",
  "MarketplaceFacilitatorTax-Principal",
  "MarketplaceFacilitatorTax-Shipping",
  "MarketplaceFacilitatorTax-Other",
  "Discount",
  "TaxDiscount",
  "CODItemCharge",
  "CODItemTaxCharge",
  "CODOrderCharge",
  "CODOrderTaxCharge",
  "CODShippingCharge",
  "CODShippingTaxCharge",
  "ShippingCharge",
  "ShippingTax",
  "Goodwill",
  "Giftwrap",
  "GiftwrapTax",
  "RestockingFee",
  "ReturnShipping",
  "PointsFee",
  "GenericDeduction",
  "PaymentMethodFee",
  "ExportCharge",
  "SAFE-TReimbursement",
  "TCS-CGST",
  "TCS-SGST",
  "TCS-IGST",
  "TCS-UTGST",
]);

// ---------------------------------------------------------------------------
// FeeType enum — used in FeeComponent.FeeType (selection from fact sheet)
// ---------------------------------------------------------------------------

export const FEE_TYPES = new Set([
  "Commission",
  "FBAPerUnitFulfillmentFee",
  "FBAPerOrderFulfillmentFee",
  "FBAWeightBasedFee",
  "FixedClosingFee",
  "VariableClosingFee",
  "ShippingChargeback",
  "GiftwrapChargeback",
  "RefundCommission",
  "Subscription",
  "StorageRenewalBilling",
  "MonthlyInventoryStorageFee",
  "FBAInboundTransportationFee",
  "FBADisposalFee",
  "FBAReturnsProcessingFee",
  "FBAInventoryReimbursement",
]);

// ---------------------------------------------------------------------------
// Date-range validation for listFinancialEvents query params
//
// Rules from fact sheet (lines 640-641):
//   - PostedAfter must be at least 2 minutes before request time
//   - PostedBefore must be later than PostedAfter
//   - PostedBefore must be at least 2 minutes before request time
//   - Maximum span: 180 days
// ---------------------------------------------------------------------------

const TWO_MINUTES_MS = 2 * 60 * 1000;
const ONE_HUNDRED_EIGHTY_DAYS_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Validate and parse PostedAfter / PostedBefore query params for
 * listFinancialEvents. Returns parsed Date objects or throws ValidationError.
 *
 * @param {string|null} postedAfterStr
 * @param {string|null} postedBeforeStr
 * @returns {{ postedAfter: Date|null, postedBefore: Date|null }}
 * @throws {ValidationError}
 */
export function validateFinancialEventDateRange(postedAfterStr, postedBeforeStr) {
  const now = new Date();

  let postedAfter = null;
  let postedBefore = null;

  if (postedAfterStr) {
    if (!isISO8601(postedAfterStr)) {
      throw new ValidationError(
        "InvalidParameterValue",
        "PostedAfter is not a valid ISO 8601 date-time.",
        "PostedAfter: must be YYYY-MM-DDTHH:MM:SSZ"
      );
    }
    postedAfter = new Date(postedAfterStr);
    if (now - postedAfter < TWO_MINUTES_MS) {
      throw new ValidationError(
        "InvalidParameterValue",
        "PostedAfter must be at least 2 minutes before the current time.",
        "PostedAfter: too recent"
      );
    }
  }

  if (postedBeforeStr) {
    if (!isISO8601(postedBeforeStr)) {
      throw new ValidationError(
        "InvalidParameterValue",
        "PostedBefore is not a valid ISO 8601 date-time.",
        "PostedBefore: must be YYYY-MM-DDTHH:MM:SSZ"
      );
    }
    postedBefore = new Date(postedBeforeStr);
    if (now - postedBefore < TWO_MINUTES_MS) {
      throw new ValidationError(
        "InvalidParameterValue",
        "PostedBefore must be at least 2 minutes before the current time.",
        "PostedBefore: too recent"
      );
    }
  }

  if (postedAfter && postedBefore) {
    if (postedBefore <= postedAfter) {
      throw new ValidationError(
        "InvalidParameterValue",
        "PostedBefore must be later than PostedAfter.",
        "PostedBefore: must be after PostedAfter"
      );
    }
    const spanMs = postedBefore - postedAfter;
    if (spanMs > ONE_HUNDRED_EIGHTY_DAYS_MS) {
      throw new ValidationError(
        "InvalidParameterValue",
        "The date range between PostedAfter and PostedBefore cannot exceed 180 days.",
        "PostedAfter/PostedBefore: max span is 180 days"
      );
    }
  }

  return { postedAfter, postedBefore };
}
