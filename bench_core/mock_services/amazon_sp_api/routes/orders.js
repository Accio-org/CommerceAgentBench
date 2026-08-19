/**
 * routes/orders.js
 * Orders API v0 — namespace /orders/v0
 *
 * Operations (10 total — complete set per fact sheet):
 *   GET   /orders/v0/orders                                  — getOrders
 *   GET   /orders/v0/orders/{orderId}                        — getOrder
 *   GET   /orders/v0/orders/{orderId}/buyerInfo              — getOrderBuyerInfo
 *   GET   /orders/v0/orders/{orderId}/address                — getOrderAddress
 *   GET   /orders/v0/orders/{orderId}/orderItems             — getOrderItems
 *   GET   /orders/v0/orders/{orderId}/orderItems/buyerInfo   — getOrderItemsBuyerInfo
 *   GET   /orders/v0/orders/{orderId}/regulatedInfo          — getOrderRegulatedInfo
 *   PATCH /orders/v0/orders/{orderId}/regulatedInfo          — updateVerificationStatus
 *   POST  /orders/v0/orders/{orderId}/shipment               — updateShipmentStatus
 *   POST  /orders/v0/orders/{orderId}/shipmentConfirmation   — confirmShipment
 *
 * Spec source: ordersV0.json swagger + fact sheet
 *   scratch/docs/api_alignment/amazon_spapi.md §Orders API v0
 *
 * Critical alignment facts enforced here:
 *  1. ALL field names are PascalCase (AmazonOrderId, MarketplaceId, OrderStatus, etc.)
 *  2. Money.Amount is a STRING ("99.99") — NOT a number. Orders v0 trap.
 *  3. Response is wrapped: {"payload": ..., "errors": []} for all GET/PATCH.
 *  4. POST /shipmentConfirmation and POST /shipment return 200 with empty body {}.
 *  5. NextToken is PascalCase in both query param AND payload.NextToken.
 *  6. operationId for PATCH is updateVerificationStatus (NOT updateOrderRegulatedInfo).
 *  7. getOrderItems payload has AmazonOrderId + OrderItems[] (PascalCase).
 *  8. Cross-namespace: POST /shipment triggers inventory mutation in store.js.
 *  9. OrderItem.ASIN is uppercase field name.
 * 10. Rate limits per fact sheet (listed per handler below).
 */

import { randomUUID } from "crypto";
import {
  mutate,
  getOrder,
  getAllOrders,
  getOrderItems,
  queryOrders,
} from "../lib/store.js";
import {
  jsonOk,
  jsonError,
  noContent,
  wrapPayload,
  parseArrayParam,
  parseIntParam,
} from "../lib/responses.js";
import { ValidationError } from "../lib/validation/common.js";
import {
  ORDER_STATUSES,
  FULFILLMENT_CHANNELS,
  PAYMENT_METHODS,
  VERIFICATION_STATUSES,
  isValidOrderId,
} from "../lib/validation/orders.js";
import { paginate } from "../lib/pagination.js";

// Rate limits per fact sheet
const RL_GET_ORDERS = 0.0167;   // 1 req/min, burst 20
const RL_GET_ORDER = 0.5;        // burst 30
const RL_ORDER_ITEMS = 0.5;      // burst 30
const RL_WRITE = 0.5;            // shipment/regulated updates

// ---------------------------------------------------------------------------
// Namespace descriptor
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Orders",
  version: "v0",
  base: "/orders/v0",
  casing: "PascalCase",
  wrapper: '{"payload": ...}',
};

// ---------------------------------------------------------------------------
// Helper: strip internal _-prefixed fields from an Order before returning
// ---------------------------------------------------------------------------

/**
 * Project an order record to the public Order shape.
 * Strips internal fields (prefixed with _).
 * @param {object} order
 * @returns {object}
 */
function projectOrder(order) {
  const out = {};
  for (const [k, v] of Object.entries(order)) {
    if (k.startsWith("_")) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Project an OrderItem record to the public shape.
 * @param {object} item
 * @returns {object}
 */
function projectOrderItem(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (k.startsWith("_")) continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /orders/v0/orders — getOrders
 * Required: MarketplaceIds.
 * All query params documented in fact sheet lines 349-371.
 *
 * Rate limit: 0.0167 req/sec, burst 20.
 */
async function handleGetOrders(req, _pathParams) {
  const url = new URL(req.url);
  const q = url.searchParams;

  // MarketplaceIds is required
  const marketplaceIds = parseArrayParam(q.getAll("MarketplaceIds").concat(
    (q.get("MarketplaceIds") || "").split(",").filter(Boolean)
  ));
  // Better: collect all values regardless of comma vs repeated
  const marketplaceIdsAll = [];
  for (const v of q.getAll("MarketplaceIds")) {
    for (const part of v.split(",")) {
      if (part.trim()) marketplaceIdsAll.push(part.trim());
    }
  }
  if (marketplaceIdsAll.length === 0) {
    return jsonError(
      400,
      "MissingParameter",
      "MarketplaceIds is required.",
      "MarketplaceIds: required parameter is missing",
      RL_GET_ORDERS
    );
  }

  const nextToken = q.get("NextToken") || null;

  // When NextToken is supplied, ignore other criteria (per Amazon spec)
  if (nextToken) {
    const allOrders = getAllOrders().map(projectOrder);
    const limit = parseIntParam(q.get("MaxResultsPerPage"), 100, 1, 100);
    const { items, NextToken: outToken } = paginate(allOrders, {}, limit, nextToken, "NextToken");
    const responsePayload = {
      Orders: items,
      ...(outToken ? { NextToken: outToken } : {}),
    };
    return jsonOk(wrapPayload(responsePayload), { rateLimit: RL_GET_ORDERS });
  }

  const filters = {
    MarketplaceIds: marketplaceIdsAll,
  };

  // Date filters
  const createdAfter = q.get("CreatedAfter");
  const createdBefore = q.get("CreatedBefore");
  const lastUpdatedAfter = q.get("LastUpdatedAfter");
  const lastUpdatedBefore = q.get("LastUpdatedBefore");
  if (createdAfter) filters.CreatedAfter = createdAfter;
  if (createdBefore) filters.CreatedBefore = createdBefore;
  if (lastUpdatedAfter) filters.LastUpdatedAfter = lastUpdatedAfter;
  if (lastUpdatedBefore) filters.LastUpdatedBefore = lastUpdatedBefore;

  // OrderStatuses — validate enum values
  const orderStatusesRaw = [];
  for (const v of q.getAll("OrderStatuses")) {
    for (const part of v.split(",")) {
      if (part.trim()) orderStatusesRaw.push(part.trim());
    }
  }
  if (orderStatusesRaw.length > 0) {
    for (const s of orderStatusesRaw) {
      if (!ORDER_STATUSES.has(s)) {
        return jsonError(
          400,
          "InvalidInput",
          `Invalid OrderStatus value: '${s}'.`,
          `OrderStatuses: must be one of ${[...ORDER_STATUSES].join(", ")}`,
          RL_GET_ORDERS
        );
      }
    }
    filters.OrderStatuses = orderStatusesRaw;
  }

  // FulfillmentChannels
  const fcRaw = [];
  for (const v of q.getAll("FulfillmentChannels")) {
    for (const part of v.split(",")) {
      if (part.trim()) fcRaw.push(part.trim());
    }
  }
  if (fcRaw.length > 0) {
    for (const fc of fcRaw) {
      if (!FULFILLMENT_CHANNELS.has(fc)) {
        return jsonError(
          400,
          "InvalidInput",
          `Invalid FulfillmentChannel: '${fc}'.`,
          `FulfillmentChannels: must be AFN or MFN`,
          RL_GET_ORDERS
        );
      }
    }
    filters.FulfillmentChannels = fcRaw;
  }

  // PaymentMethods
  const pmRaw = [];
  for (const v of q.getAll("PaymentMethods")) {
    for (const part of v.split(",")) {
      if (part.trim()) pmRaw.push(part.trim());
    }
  }
  if (pmRaw.length > 0) {
    for (const pm of pmRaw) {
      if (!PAYMENT_METHODS.has(pm)) {
        return jsonError(
          400,
          "InvalidInput",
          `Invalid PaymentMethod: '${pm}'.`,
          `PaymentMethods: must be COD, CVS, or Other`,
          RL_GET_ORDERS
        );
      }
    }
    filters.PaymentMethods = pmRaw;
  }

  const buyerEmail = q.get("BuyerEmail");
  if (buyerEmail) filters.BuyerEmail = buyerEmail;

  const sellerOrderId = q.get("SellerOrderId");
  if (sellerOrderId) filters.SellerOrderId = sellerOrderId;

  const amazonOrderIds = [];
  for (const v of q.getAll("AmazonOrderIds")) {
    for (const part of v.split(",")) {
      if (part.trim()) amazonOrderIds.push(part.trim());
    }
  }
  if (amazonOrderIds.length > 0) {
    filters.AmazonOrderIds = amazonOrderIds;
  }

  const limit = parseIntParam(q.get("MaxResultsPerPage"), 100, 1, 100);
  const filteredOrders = queryOrders(filters).map(projectOrder);

  const { items, NextToken: outToken } = paginate(filteredOrders, filters, limit, null, "NextToken");

  const responsePayload = {
    Orders: items,
    ...(outToken ? { NextToken: outToken } : {}),
    LastUpdatedBefore: new Date().toISOString(),
    CreatedBefore: new Date().toISOString(),
  };

  return jsonOk(wrapPayload(responsePayload), { rateLimit: RL_GET_ORDERS });
}

/**
 * GET /orders/v0/orders/{orderId} — getOrder
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleGetOrder(_req, { orderId }) {
  if (!isValidOrderId(orderId)) {
    return jsonError(
      400,
      "InvalidInput",
      `Invalid orderId format: '${orderId}'. Must be XXX-XXXXXXX-XXXXXXX.`,
      "orderId: must match 3-7-7 digit pattern",
      RL_GET_ORDER
    );
  }
  const order = getOrder(orderId);
  if (!order) {
    return jsonError(404, "ResourceNotFound", `Order '${orderId}' not found.`, undefined, RL_GET_ORDER);
  }
  return jsonOk(wrapPayload(projectOrder(order)), { rateLimit: RL_GET_ORDER });
}

/**
 * GET /orders/v0/orders/{orderId}/buyerInfo — getOrderBuyerInfo
 * Returns a restricted data subset: BuyerInfo, BuyerTaxInformation.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleGetOrderBuyerInfo(_req, { orderId }) {
  if (!isValidOrderId(orderId)) {
    return jsonError(400, "InvalidInput", `Invalid orderId: '${orderId}'.`, undefined, RL_GET_ORDER);
  }
  const order = getOrder(orderId);
  if (!order) {
    return jsonError(404, "ResourceNotFound", `Order '${orderId}' not found.`, undefined, RL_GET_ORDER);
  }
  // Fact sheet: BuyerInfo + BuyerTaxInformation subset
  const payload = {
    AmazonOrderId: order.AmazonOrderId,
    BuyerEmail: order.BuyerInfo?.BuyerEmail,
    BuyerName: order.BuyerInfo?.BuyerName,
    BuyerCounty: order.BuyerInfo?.BuyerCounty,
    BuyerTaxInfo: order.BuyerInfo?.BuyerTaxInfo,
    PurchaseOrderNumber: order.PurchaseOrderNumber,
    ...(order.BuyerTaxInformation ? { BuyerTaxInformation: order.BuyerTaxInformation } : {}),
  };
  return jsonOk(wrapPayload(payload), { rateLimit: RL_GET_ORDER });
}

/**
 * GET /orders/v0/orders/{orderId}/address — getOrderAddress
 * Returns ShippingAddress for the order.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleGetOrderAddress(_req, { orderId }) {
  if (!isValidOrderId(orderId)) {
    return jsonError(400, "InvalidInput", `Invalid orderId: '${orderId}'.`, undefined, RL_GET_ORDER);
  }
  const order = getOrder(orderId);
  if (!order) {
    return jsonError(404, "ResourceNotFound", `Order '${orderId}' not found.`, undefined, RL_GET_ORDER);
  }
  const payload = {
    AmazonOrderId: order.AmazonOrderId,
    ShippingAddress: order.ShippingAddress || null,
  };
  return jsonOk(wrapPayload(payload), { rateLimit: RL_GET_ORDER });
}

/**
 * GET /orders/v0/orders/{orderId}/orderItems — getOrderItems
 * Returns OrderItems array with pagination.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleGetOrderItems(req, { orderId }) {
  if (!isValidOrderId(orderId)) {
    return jsonError(400, "InvalidInput", `Invalid orderId: '${orderId}'.`, undefined, RL_ORDER_ITEMS);
  }
  const order = getOrder(orderId);
  if (!order) {
    return jsonError(404, "ResourceNotFound", `Order '${orderId}' not found.`, undefined, RL_ORDER_ITEMS);
  }
  const url = new URL(req.url);
  const nextToken = url.searchParams.get("NextToken") || null;

  const items = (getOrderItems(orderId) || []).map(projectOrderItem);

  // OrderItems uses small default page size (50)
  const limit = 50;
  const { items: page, NextToken: outToken } = paginate(items, { orderId }, limit, nextToken, "NextToken");

  const payload = {
    AmazonOrderId: orderId,
    OrderItems: page,
    ...(outToken ? { NextToken: outToken } : {}),
  };
  return jsonOk(wrapPayload(payload), { rateLimit: RL_ORDER_ITEMS });
}

/**
 * GET /orders/v0/orders/{orderId}/orderItems/buyerInfo — getOrderItemsBuyerInfo
 * Returns buyer-specific fields on each OrderItem.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleGetOrderItemsBuyerInfo(_req, { orderId }) {
  if (!isValidOrderId(orderId)) {
    return jsonError(400, "InvalidInput", `Invalid orderId: '${orderId}'.`, undefined, RL_ORDER_ITEMS);
  }
  const order = getOrder(orderId);
  if (!order) {
    return jsonError(404, "ResourceNotFound", `Order '${orderId}' not found.`, undefined, RL_ORDER_ITEMS);
  }
  const items = (getOrderItems(orderId) || []).map((item) => {
    const projected = projectOrderItem(item);
    // Return buyer-relevant fields only
    return {
      ASIN: projected.ASIN,
      OrderItemId: projected.OrderItemId,
      BuyerInfo: projected.BuyerInfo || {},
      BuyerRequestedCancel: projected.BuyerRequestedCancel || null,
    };
  });
  const payload = {
    AmazonOrderId: orderId,
    OrderItems: items,
  };
  return jsonOk(wrapPayload(payload), { rateLimit: RL_ORDER_ITEMS });
}

/**
 * GET /orders/v0/orders/{orderId}/regulatedInfo — getOrderRegulatedInfo
 * Returns regulated info for orders with HasRegulatedItems=true.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleGetOrderRegulatedInfo(_req, { orderId }) {
  if (!isValidOrderId(orderId)) {
    return jsonError(400, "InvalidInput", `Invalid orderId: '${orderId}'.`, undefined, RL_GET_ORDER);
  }
  const order = getOrder(orderId);
  if (!order) {
    return jsonError(404, "ResourceNotFound", `Order '${orderId}' not found.`, undefined, RL_GET_ORDER);
  }
  const payload = {
    AmazonOrderId: order.AmazonOrderId,
    HasRegulatedItems: order.HasRegulatedItems || false,
    RegulatedInformation: order._regulatedInfo || null,
    RequiresDosageLabel: order._requiresDosageLabel || false,
    RegulatedOrderVerificationStatus: {
      Status: order._regulatedStatus || "Approved",
      RequiresMerchantAction: false,
      ValidRejectionReasons: [],
      ExternalReviewUrl: null,
    },
  };
  return jsonOk(wrapPayload(payload), { rateLimit: RL_GET_ORDER });
}

/**
 * PATCH /orders/v0/orders/{orderId}/regulatedInfo — updateVerificationStatus
 * NOTE: operationId is updateVerificationStatus, NOT updateOrderRegulatedInfo.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleUpdateVerificationStatus(req, { orderId }) {
  if (!isValidOrderId(orderId)) {
    return jsonError(400, "InvalidInput", `Invalid orderId: '${orderId}'.`, undefined, RL_WRITE);
  }
  const order = getOrder(orderId);
  if (!order) {
    return jsonError(404, "ResourceNotFound", `Order '${orderId}' not found.`, undefined, RL_WRITE);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body must be valid JSON.", undefined, RL_WRITE);
  }

  const verificationStatus = body.regulatedOrderVerificationStatus;
  if (!verificationStatus) {
    return jsonError(
      400,
      "MissingParameter",
      "regulatedOrderVerificationStatus is required.",
      "body: missing regulatedOrderVerificationStatus",
      RL_WRITE
    );
  }

  if (!VERIFICATION_STATUSES.has(verificationStatus)) {
    return jsonError(
      400,
      "InvalidInput",
      `Invalid regulatedOrderVerificationStatus: '${verificationStatus}'.`,
      `Must be one of: ${[...VERIFICATION_STATUSES].join(", ")}`,
      RL_WRITE
    );
  }

  mutate(
    "order",
    "update_regulated",
    { AmazonOrderId: orderId, regulatedOrderVerificationStatus: verificationStatus },
    { actor: "api", requestId: randomUUID() }
  );

  // updateVerificationStatus returns 204 No Content (empty body) — its ONLY
  // documented success response in ordersV0.json (no 200). See lib/responses.noContent.
  return noContent({ rateLimit: RL_WRITE });
}

/**
 * POST /orders/v0/orders/{orderId}/shipment — updateShipmentStatus
 * Transitions OrderStatus to Shipped or PartiallyShipped, triggers inventory mutation.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleUpdateShipmentStatus(req, { orderId }) {
  if (!isValidOrderId(orderId)) {
    return jsonError(400, "InvalidInput", `Invalid orderId: '${orderId}'.`, undefined, RL_WRITE);
  }
  const order = getOrder(orderId);
  if (!order) {
    return jsonError(404, "ResourceNotFound", `Order '${orderId}' not found.`, undefined, RL_WRITE);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body must be valid JSON.", undefined, RL_WRITE);
  }

  // Determine new status from shipmentStatus or default to Shipped
  // Real SP-API updateShipmentStatus accepts PickedUp/OutForDelivery/Delivered etc.
  // We map to order-level status: if carrier picked up → Shipped
  const newOrderStatus = "Shipped";

  // Extract SKU quantities from body for cross-namespace coupling
  // Body shape: { marketplaceId, shipmentStatus, orderItems?: [{orderItemId, quantity}] }
  const shippedItems = [];
  const orderItemsList = getOrderItems(orderId) || [];

  if (Array.isArray(body.orderItems)) {
    for (const bi of body.orderItems) {
      const matched = orderItemsList.find(
        (oi) => oi.OrderItemId === bi.orderItemId
      );
      if (matched && matched.SellerSKU) {
        shippedItems.push({
          SellerSKU: matched.SellerSKU,
          QuantityShipped: bi.quantity || matched.QuantityOrdered || 1,
        });
      }
    }
  } else {
    // No explicit item list — ship all items
    for (const oi of orderItemsList) {
      if (oi.SellerSKU) {
        shippedItems.push({
          SellerSKU: oi.SellerSKU,
          QuantityShipped: oi.QuantityOrdered || 1,
        });
      }
    }
  }

  mutate(
    "order",
    "update_status",
    {
      AmazonOrderId: orderId,
      OrderStatus: newOrderStatus,
      NumberOfItemsShipped: shippedItems.reduce((s, i) => s + i.QuantityShipped, 0),
      NumberOfItemsUnshipped: 0,
      _shippedItems: shippedItems,
    },
    { actor: "api", requestId: randomUUID() }
  );

  // updateShipmentStatus returns 204 No Content — its ONLY documented success
  // response in ordersV0.json (no 200).
  return noContent({ rateLimit: RL_WRITE });
}

/**
 * POST /orders/v0/orders/{orderId}/shipmentConfirmation — confirmShipment
 * Confirms shipment with package/carrier details. Also transitions to Shipped.
 * Rate limit: 0.5 req/sec, burst 30.
 */
async function handleConfirmShipment(req, { orderId }) {
  if (!isValidOrderId(orderId)) {
    return jsonError(400, "InvalidInput", `Invalid orderId: '${orderId}'.`, undefined, RL_WRITE);
  }
  const order = getOrder(orderId);
  if (!order) {
    return jsonError(404, "ResourceNotFound", `Order '${orderId}' not found.`, undefined, RL_WRITE);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body must be valid JSON.", undefined, RL_WRITE);
  }

  // Extract SellerSKU + QuantityShipped from body.packageReferenceId items
  const shippedItems = [];
  const orderItemsList = getOrderItems(orderId) || [];

  if (body.packageDetail && Array.isArray(body.packageDetail.orderItems)) {
    for (const pi of body.packageDetail.orderItems) {
      const matched = orderItemsList.find(
        (oi) => oi.OrderItemId === pi.orderItemId
      );
      if (matched && matched.SellerSKU) {
        shippedItems.push({
          SellerSKU: matched.SellerSKU,
          QuantityShipped: pi.quantity || matched.QuantityOrdered || 1,
        });
      }
    }
  }

  if (shippedItems.length === 0) {
    // Default: ship all items
    for (const oi of orderItemsList) {
      if (oi.SellerSKU) {
        shippedItems.push({
          SellerSKU: oi.SellerSKU,
          QuantityShipped: oi.QuantityOrdered || 1,
        });
      }
    }
  }

  mutate(
    "order",
    "update_status",
    {
      AmazonOrderId: orderId,
      OrderStatus: "Shipped",
      NumberOfItemsShipped: shippedItems.reduce((s, i) => s + i.QuantityShipped, 0),
      NumberOfItemsUnshipped: 0,
      _shippedItems: shippedItems,
    },
    { actor: "api", requestId: randomUUID() }
  );

  // confirmShipment returns 204 No Content — its ONLY documented success
  // response in ordersV0.json (no 200).
  return noContent({ rateLimit: RL_WRITE });
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "GET",
    path: "/orders/v0/orders",
    handler: handleGetOrders,
    help: {
      description:
        "Returns orders created or updated during the specified time frame. Requires MarketplaceIds. Rate: 0.0167 req/sec, burst 20.",
      params: [
        { name: "MarketplaceIds", in: "query", required: true },
        { name: "CreatedAfter", in: "query" },
        { name: "CreatedBefore", in: "query" },
        { name: "LastUpdatedAfter", in: "query" },
        { name: "LastUpdatedBefore", in: "query" },
        { name: "OrderStatuses", in: "query" },
        { name: "FulfillmentChannels", in: "query" },
        { name: "PaymentMethods", in: "query" },
        { name: "BuyerEmail", in: "query" },
        { name: "SellerOrderId", in: "query" },
        { name: "MaxResultsPerPage", in: "query" },
        { name: "NextToken", in: "query" },
        { name: "AmazonOrderIds", in: "query" },
      ],
    },
  },
  {
    method: "GET",
    path: "/orders/v0/orders/:orderId",
    handler: handleGetOrder,
    help: {
      description: "Returns the order indicated by the specified order ID. Rate: 0.5 req/sec.",
      params: [{ name: "orderId", in: "path", required: true }],
    },
  },
  {
    method: "GET",
    path: "/orders/v0/orders/:orderId/buyerInfo",
    handler: handleGetOrderBuyerInfo,
    help: {
      description: "Returns buyer information for the order. Rate: 0.5 req/sec.",
      params: [{ name: "orderId", in: "path", required: true }],
    },
  },
  {
    method: "GET",
    path: "/orders/v0/orders/:orderId/address",
    handler: handleGetOrderAddress,
    help: {
      description: "Returns the shipping address for the order. Rate: 0.5 req/sec.",
      params: [{ name: "orderId", in: "path", required: true }],
    },
  },
  {
    method: "GET",
    path: "/orders/v0/orders/:orderId/orderItems",
    handler: handleGetOrderItems,
    help: {
      description:
        "Returns detailed order item information for the order. Rate: 0.5 req/sec.",
      params: [
        { name: "orderId", in: "path", required: true },
        { name: "NextToken", in: "query" },
      ],
    },
  },
  {
    method: "GET",
    path: "/orders/v0/orders/:orderId/orderItems/buyerInfo",
    handler: handleGetOrderItemsBuyerInfo,
    help: {
      description:
        "Returns buyer information for the order items. Rate: 0.5 req/sec.",
      params: [{ name: "orderId", in: "path", required: true }],
    },
  },
  {
    method: "GET",
    path: "/orders/v0/orders/:orderId/regulatedInfo",
    handler: handleGetOrderRegulatedInfo,
    help: {
      description: "Returns regulated information for the order. Rate: 0.5 req/sec.",
      params: [{ name: "orderId", in: "path", required: true }],
    },
  },
  {
    method: "PATCH",
    path: "/orders/v0/orders/:orderId/regulatedInfo",
    handler: handleUpdateVerificationStatus,
    help: {
      description:
        "Updates the verification status (regulatedOrderVerificationStatus) for an order. operationId: updateVerificationStatus. Rate: 0.5 req/sec.",
      params: [{ name: "orderId", in: "path", required: true }],
    },
  },
  {
    method: "POST",
    path: "/orders/v0/orders/:orderId/shipment",
    handler: handleUpdateShipmentStatus,
    help: {
      description:
        "Updates the shipment status for an order. Triggers cross-namespace FBA inventory reduction. Rate: 0.5 req/sec.",
      params: [{ name: "orderId", in: "path", required: true }],
    },
  },
  {
    method: "POST",
    path: "/orders/v0/orders/:orderId/shipmentConfirmation",
    handler: handleConfirmShipment,
    help: {
      description:
        "Confirms shipment details for an order. Transitions OrderStatus to Shipped. Rate: 0.5 req/sec.",
      params: [{ name: "orderId", in: "path", required: true }],
    },
  },
];
