/**
 * lib/validation/orders.js
 * Closed-set enum constants for Orders v0 namespace.
 *
 * All enums are PascalCase or ALL_CAPS per Orders v0 field-casing convention.
 * Server-side validation is mandatory per CLAUDE.md rule #10.
 */

/** OrderStatus enum — `OrderStatus` field on Order object. */
export const ORDER_STATUSES = new Set([
  "PendingAvailability",
  "Pending",
  "Unshipped",
  "PartiallyShipped",
  "Shipped",
  "InvoiceUnconfirmed",
  "Canceled",
  "Unfulfillable",
]);

/** FulfillmentChannel enum — `FulfillmentChannel` on Order and filter param. */
export const FULFILLMENT_CHANNELS = new Set(["AFN", "MFN"]);

/** PaymentMethod enum — `PaymentMethod` on Order and filter param. */
export const PAYMENT_METHODS = new Set(["COD", "CVS", "Other"]);

/**
 * ShipmentServiceLevelCategory enum.
 * From swagger ordersV0.json ShipmentServiceLevelCategory schema.
 */
export const SHIPMENT_SERVICE_LEVEL_CATEGORIES = new Set([
  "Expedited",
  "FreeEconomy",
  "NextDay",
  "SameDay",
  "SecondDay",
  "Scheduled",
  "Standard",
]);

/** OrderType enum — `OrderType` on Order object. */
export const ORDER_TYPES = new Set([
  "StandardOrder",
  "LongLeadTimeOrder",
  "Preorder",
  "BackOrder",
  "SourcingOnDemandOrder",
]);

/**
 * VerificationStatus enum for updateVerificationStatus PATCH body.
 * Source: ordersV0.json UpdateVerificationStatusRequest.regulatedOrderVerificationStatus.
 * Note: operationId is updateVerificationStatus (NOT updateOrderRegulatedInfo).
 */
export const VERIFICATION_STATUSES = new Set([
  "Pending",
  "Approved",
  "Rejected",
  "Expired",
  "Cancelled",
]);

/** ElectronicInvoiceStatus filter enum for getOrders. */
export const ELECTRONIC_INVOICE_STATUSES = new Set([
  "NotRequired",
  "NotFound",
  "Processing",
  "Errored",
  "Accepted",
]);

/** ShipmentStatus for updateShipmentStatus (POST /orders/{orderId}/shipment). */
export const SHIPMENT_STATUSES = new Set([
  "PickedUp",
  "OutForDelivery",
  "Delivered",
  "Returned",
  "Shipped",
  "ReadyForPickup",
]);

/**
 * Validate that a string is a well-formed Amazon Order ID (3-7-7 format).
 * Example: "112-1234567-1234567"
 * @param {string} id
 * @returns {boolean}
 */
export function isValidOrderId(id) {
  return typeof id === "string" && /^\d{3}-\d{7}-\d{7}$/.test(id);
}
