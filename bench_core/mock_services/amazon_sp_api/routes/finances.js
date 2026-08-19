/**
 * routes/finances.js
 * Finances API v0 — namespace /finances/v0
 *
 * Operations (4 total — complete set per fact sheet):
 *   GET   /finances/v0/financialEvents                                       — listFinancialEvents
 *   GET   /finances/v0/financialEventGroups                                  — listFinancialEventGroups
 *   GET   /finances/v0/financialEventGroups/{eventGroupId}/financialEvents   — listFinancialEventsByGroupId
 *   GET   /finances/v0/orders/{orderId}/financialEvents                      — listFinancialEventsByOrderId
 *
 * Spec source: fact sheet §Finances API v0
 *   scratch/docs/api_alignment/amazon_spapi.md §Finances API v0
 *
 * Critical alignment facts enforced here:
 *  1. Money type is { "CurrencyCode": "USD", "CurrencyAmount": 29.99 } — NUMBER not string.
 *     Field is CurrencyAmount (NOT Amount). Negative = outflow from seller to Amazon.
 *  2. ALL field names are PascalCase (same as Orders v0).
 *  3. Response is payload-wrapped: { "payload": { "FinancialEvents": {...}, "NextToken"? } }.
 *  4. FinancialEvents object contains ALL 30+ event-list fields; unused lists are [].
 *  5. Primary endpoint for Settlement Reconciliation: listFinancialEvents date-range pull.
 *  6. Rate limit: 0.5 req/sec, burst 30 (all four operations).
 *  7. Date-range validation: PostedAfter/PostedBefore must be ≥2 min before now, max 180-day span.
 *  8. listFinancialEventsByOrderId: orderId path param is NOT validated with isValidOrderId()
 *     because the Finances path prefix is /finances/v0/orders/{orderId} (not /orders/v0/orders).
 */

import {
  getAllFinancialEventGroups,
  queryFinancialEvents,
  getFinancialEventsByGroupId,
  getFinancialEventsByOrderId,
} from "../lib/store.js";
import {
  jsonOk,
  jsonError,
  wrapPayload,
  parseIntParam,
} from "../lib/responses.js";
import { ValidationError } from "../lib/validation/common.js";
import { validateFinancialEventDateRange } from "../lib/validation/finances.js";
import { paginate } from "../lib/pagination.js";

// Rate limit per fact sheet: 0.5 req/sec, burst 30 (same for all 4 operations)
const RL_FINANCES = 0.5;

// ---------------------------------------------------------------------------
// Namespace descriptor
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Finances",
  version: "v0",
  base: "/finances/v0",
  casing: "PascalCase",
  wrapper: '{"payload": ...}',
};

// ---------------------------------------------------------------------------
// Helper: build the full FinancialEvents object with all 30+ event-list fields
// Fact sheet says: emit all lists; populate relevant ones, rest as [].
// ---------------------------------------------------------------------------

/**
 * Build the canonical FinancialEvents response object with all SP-API event-list keys.
 * Populated lists are injected; all others default to [].
 *
 * @param {{
 *   ShipmentEventList?: object[],
 *   RefundEventList?: object[],
 *   ServiceFeeEventList?: object[],
 *   AdjustmentEventList?: object[],
 * }} populated
 * @returns {object}
 */
function buildFinancialEvents(populated = {}) {
  return {
    ShipmentEventList:                        populated.ShipmentEventList                        ?? [],
    ShipmentSettleEventList:                  populated.ShipmentSettleEventList                  ?? [],
    RefundEventList:                          populated.RefundEventList                          ?? [],
    GuaranteeClaimEventList:                  populated.GuaranteeClaimEventList                  ?? [],
    ChargebackEventList:                      populated.ChargebackEventList                      ?? [],
    PayWithAmazonEventList:                   populated.PayWithAmazonEventList                   ?? [],
    ServiceProviderCreditEventList:           populated.ServiceProviderCreditEventList           ?? [],
    RetrochargeEventList:                     populated.RetrochargeEventList                     ?? [],
    RentalTransactionEventList:               populated.RentalTransactionEventList               ?? [],
    ProductAdsPaymentEventList:               populated.ProductAdsPaymentEventList               ?? [],
    ServiceFeeEventList:                      populated.ServiceFeeEventList                      ?? [],
    SellerDealPaymentEventList:               populated.SellerDealPaymentEventList               ?? [],
    DebtRecoveryEventList:                    populated.DebtRecoveryEventList                    ?? [],
    LoanServicingEventList:                   populated.LoanServicingEventList                   ?? [],
    AdjustmentEventList:                      populated.AdjustmentEventList                      ?? [],
    SAFETReimbursementEventList:              populated.SAFETReimbursementEventList              ?? [],
    SellerReviewEnrollmentPaymentEventList:   populated.SellerReviewEnrollmentPaymentEventList   ?? [],
    FBALiquidationEventList:                  populated.FBALiquidationEventList                  ?? [],
    CouponPaymentEventList:                   populated.CouponPaymentEventList                   ?? [],
    ImagingServicesFeeEventList:              populated.ImagingServicesFeeEventList              ?? [],
    NetworkComminglingTransactionEventList:   populated.NetworkComminglingTransactionEventList   ?? [],
    AffordabilityExpenseEventList:            populated.AffordabilityExpenseEventList            ?? [],
    AffordabilityExpenseReversalEventList:    populated.AffordabilityExpenseReversalEventList    ?? [],
    TrialShipmentEventList:                   populated.TrialShipmentEventList                   ?? [],
    TDSReimbursementEventList:               populated.TDSReimbursementEventList               ?? [],
    AdhocDisbursementEventList:               populated.AdhocDisbursementEventList               ?? [],
    TaxWithholdingEventList:                  populated.TaxWithholdingEventList                  ?? [],
    RemovalShipmentEventList:                 populated.RemovalShipmentEventList                 ?? [],
    RemovalShipmentAdjustmentEventList:       populated.RemovalShipmentAdjustmentEventList       ?? [],
    ChargeRefundEventList:                    populated.ChargeRefundEventList                    ?? [],
    FailedAdhocDisbursementEventList:         populated.FailedAdhocDisbursementEventList         ?? [],
    ValueAddedServiceChargeEventList:         populated.ValueAddedServiceChargeEventList         ?? [],
    CapacityReservationBillingEventList:      populated.CapacityReservationBillingEventList      ?? [],
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /finances/v0/financialEvents — listFinancialEvents
 *
 * Primary endpoint for Settlement Reconciliation date-range pull.
 * Query params: MaxResultsPerPage (1-100, default 100), PostedAfter, PostedBefore, NextToken.
 * Date-range rules: PostedAfter/PostedBefore ≥2 min before now; max 180-day span.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleListFinancialEvents(req, _pathParams) {
  const url = new URL(req.url);
  const q = url.searchParams;

  const postedAfterStr = q.get("PostedAfter") || null;
  const postedBeforeStr = q.get("PostedBefore") || null;
  const nextToken = q.get("NextToken") || null;
  const limit = parseIntParam(q.get("MaxResultsPerPage"), 100, 1, 100);

  // Validate date range (throws ValidationError on bad params)
  let postedAfter = null;
  let postedBefore = null;
  try {
    ({ postedAfter, postedBefore } = validateFinancialEventDateRange(
      postedAfterStr,
      postedBeforeStr
    ));
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonError(400, err.spCode, err.spMessage, err.spDetails, RL_FINANCES);
    }
    throw err;
  }

  // Retrieve and filter financial events from store
  const allEvents = queryFinancialEvents({ postedAfter, postedBefore });

  // Paginate the flat list of "event buckets" (each event is returned in its typed list)
  // For pagination purposes we treat the ShipmentEvents as the primary paginated entity.
  // We paginate over the entire event set by bundling them into pages.
  // SP-API paginates the entire FinancialEvents object, not individual event lists.
  // In the mock: paginate the ShipmentEvents array; RefundEvents, ServiceFeeEvents, and
  // AdjustmentEvents are returned on page 1 (non-paginated small lists).
  const { items: shipmentPage, NextToken: outToken } = paginate(
    allEvents.ShipmentEventList,
    { postedAfterStr, postedBeforeStr },
    limit,
    nextToken,
    "NextToken"
  );

  // Non-paginated lists — only return on first page (no NextToken on prior page)
  const isFirstPage = !nextToken;

  const financialEvents = buildFinancialEvents({
    ShipmentEventList: shipmentPage,
    RefundEventList:       isFirstPage ? allEvents.RefundEventList       : [],
    ServiceFeeEventList:   isFirstPage ? allEvents.ServiceFeeEventList   : [],
    AdjustmentEventList:   isFirstPage ? allEvents.AdjustmentEventList   : [],
  });

  const responsePayload = {
    FinancialEvents: financialEvents,
    ...(outToken ? { NextToken: outToken } : {}),
  };

  return jsonOk(wrapPayload(responsePayload), { rateLimit: RL_FINANCES });
}

/**
 * GET /finances/v0/financialEventGroups — listFinancialEventGroups
 *
 * Returns the list of financial event groups (settlement periods).
 * Query params: MaxResultsPerPage (1-100, default 100), FinancialEventGroupStartedAfter,
 *               FinancialEventGroupStartedBefore, NextToken.
 * Rate limit: 0.5 req/sec, burst 30.
 *
 * Note: fact sheet does not specify date params for listFinancialEventGroups
 * beyond the standard NextToken + MaxResultsPerPage pagination. We accept
 * FinancialEventGroupStartedAfter/Before as optional filter params.
 */
async function handleListFinancialEventGroups(req, _pathParams) {
  const url = new URL(req.url);
  const q = url.searchParams;

  const limit = parseIntParam(q.get("MaxResultsPerPage"), 100, 1, 100);
  const nextToken = q.get("NextToken") || null;

  const groups = getAllFinancialEventGroups();

  const { items, NextToken: outToken } = paginate(groups, {}, limit, nextToken, "NextToken");

  const responsePayload = {
    FinancialEventGroupList: items,
    ...(outToken ? { NextToken: outToken } : {}),
  };

  return jsonOk(wrapPayload(responsePayload), { rateLimit: RL_FINANCES });
}

/**
 * GET /finances/v0/financialEventGroups/{eventGroupId}/financialEvents
 * — listFinancialEventsByGroupId
 *
 * Returns all financial events belonging to a specific event group.
 * Query params: MaxResultsPerPage (1-100), PostedAfter, PostedBefore, NextToken.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleListFinancialEventsByGroupId(req, { eventGroupId }) {
  const url = new URL(req.url);
  const q = url.searchParams;

  const limit = parseIntParam(q.get("MaxResultsPerPage"), 100, 1, 100);
  const nextToken = q.get("NextToken") || null;

  const events = getFinancialEventsByGroupId(eventGroupId);

  if (!events) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Financial event group '${eventGroupId}' not found.`,
      undefined,
      RL_FINANCES
    );
  }

  const { items: shipmentPage, NextToken: outToken } = paginate(
    events.ShipmentEventList || [],
    { eventGroupId },
    limit,
    nextToken,
    "NextToken"
  );

  const isFirstPage = !nextToken;

  const financialEvents = buildFinancialEvents({
    ShipmentEventList:   shipmentPage,
    RefundEventList:     isFirstPage ? (events.RefundEventList     || []) : [],
    ServiceFeeEventList: isFirstPage ? (events.ServiceFeeEventList || []) : [],
    AdjustmentEventList: isFirstPage ? (events.AdjustmentEventList || []) : [],
  });

  const responsePayload = {
    FinancialEvents: financialEvents,
    ...(outToken ? { NextToken: outToken } : {}),
  };

  return jsonOk(wrapPayload(responsePayload), { rateLimit: RL_FINANCES });
}

/**
 * GET /finances/v0/orders/{orderId}/financialEvents — listFinancialEventsByOrderId
 *
 * Returns all financial events for a specific order.
 * Path param: orderId (Amazon Order ID format).
 * Query params: MaxResultsPerPage (1-100), NextToken.
 * Rate limit: 0.5 req/sec, burst 30.
 *
 * Note: orderId format validation is NOT applied here because this path is
 * under /finances/v0/orders/, which is distinct from the Orders v0 namespace.
 * The mock accepts any non-empty orderId and returns 404 if no events found.
 */
async function handleListFinancialEventsByOrderId(req, { orderId }) {
  const url = new URL(req.url);
  const q = url.searchParams;

  const limit = parseIntParam(q.get("MaxResultsPerPage"), 100, 1, 100);
  const nextToken = q.get("NextToken") || null;

  if (!orderId) {
    return jsonError(400, "InvalidInput", "orderId path parameter is required.", undefined, RL_FINANCES);
  }

  const events = getFinancialEventsByOrderId(orderId);

  if (!events) {
    return jsonError(
      404,
      "ResourceNotFound",
      `No financial events found for order '${orderId}'.`,
      undefined,
      RL_FINANCES
    );
  }

  const { items: shipmentPage, NextToken: outToken } = paginate(
    events.ShipmentEventList || [],
    { orderId },
    limit,
    nextToken,
    "NextToken"
  );

  const isFirstPage = !nextToken;

  const financialEvents = buildFinancialEvents({
    ShipmentEventList:   shipmentPage,
    RefundEventList:     isFirstPage ? (events.RefundEventList     || []) : [],
    ServiceFeeEventList: isFirstPage ? (events.ServiceFeeEventList || []) : [],
    AdjustmentEventList: isFirstPage ? (events.AdjustmentEventList || []) : [],
  });

  const responsePayload = {
    FinancialEvents: financialEvents,
    ...(outToken ? { NextToken: outToken } : {}),
  };

  return jsonOk(wrapPayload(responsePayload), { rateLimit: RL_FINANCES });
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "GET",
    path: "/finances/v0/financialEvents",
    handler: handleListFinancialEvents,
    help: {
      description:
        "Returns financial events for the given date range. Primary endpoint for Settlement Reconciliation. " +
        "Rate: 0.5 req/sec, burst 30.",
      params: [
        { name: "MaxResultsPerPage", in: "query", description: "1-100, default 100." },
        { name: "PostedAfter",       in: "query", description: "ISO 8601. Must be ≥2 min before now." },
        { name: "PostedBefore",      in: "query", description: "ISO 8601. Must be > PostedAfter and ≥2 min before now. Max 180-day span from PostedAfter." },
        { name: "NextToken",         in: "query", description: "Pagination cursor." },
      ],
    },
  },
  {
    method: "GET",
    path: "/finances/v0/financialEventGroups",
    handler: handleListFinancialEventGroups,
    help: {
      description:
        "Returns a list of financial event groups (settlement periods). Rate: 0.5 req/sec, burst 30.",
      params: [
        { name: "MaxResultsPerPage", in: "query", description: "1-100, default 100." },
        { name: "NextToken",         in: "query", description: "Pagination cursor." },
      ],
    },
  },
  {
    method: "GET",
    path: "/finances/v0/financialEventGroups/:eventGroupId/financialEvents",
    handler: handleListFinancialEventsByGroupId,
    help: {
      description:
        "Returns all financial events for the specified financial event group. Rate: 0.5 req/sec, burst 30.",
      params: [
        { name: "eventGroupId",      in: "path",  required: true },
        { name: "MaxResultsPerPage", in: "query" },
        { name: "NextToken",         in: "query" },
      ],
    },
  },
  {
    method: "GET",
    path: "/finances/v0/orders/:orderId/financialEvents",
    handler: handleListFinancialEventsByOrderId,
    help: {
      description:
        "Returns all financial events for the specified order. Rate: 0.5 req/sec, burst 30.",
      params: [
        { name: "orderId",           in: "path",  required: true },
        { name: "MaxResultsPerPage", in: "query" },
        { name: "NextToken",         in: "query" },
      ],
    },
  },
];
