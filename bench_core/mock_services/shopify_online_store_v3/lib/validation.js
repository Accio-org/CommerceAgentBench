'use strict';

// Closed-set enum validation for the Shopify Admin back-office mock.
// RRB rule #10: every closed-set field is validated server-side; the write
// endpoint rejects illegal values with 400 instead of silently accepting.
// Enum values are grounded in the captured Admin UI + Shopify Admin API enums
// (see scratch/docs/api_alignment/shopify_admin_ui.md). Do not invent values.

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field || null;
    this.status = 400;
  }
}

// --- enum registries (single source of truth) ------------------------------
const ENUMS = {
  // Product status — Shopify ProductStatus (ACTIVE/DRAFT/ARCHIVED), lowercased
  product_status: ['active', 'draft', 'archived'],
  // WeightUnit — GRAMS/KILOGRAMS/OUNCES/POUNDS, UI short forms
  weight_unit: ['g', 'kg', 'oz', 'lb'],
  // Discount method (code vs automatic) and types from /discounts/new capture
  discount_method: ['code', 'automatic'],
  discount_type: ['amount_off_products', 'amount_off_order', 'buy_x_get_y', 'free_shipping'],
  discount_value_type: ['percentage', 'fixed_amount'],
  discount_status: ['active', 'scheduled', 'expired'],
  // Customer marketing consent state
  consent_state: ['subscribed', 'not_subscribed'],
  // Order / draft order financial + fulfillment status
  order_financial_status: ['pending', 'authorized', 'paid', 'partially_paid', 'refunded', 'voided'],
  order_fulfillment_status: ['unfulfilled', 'partially_fulfilled', 'fulfilled', 'restocked'],
  draft_order_status: ['open', 'invoice_sent', 'completed'],
  // Purchase order status
  purchase_order_status: ['draft', 'ordered', 'partially_received', 'received', 'closed'],
};

function isValidEnum(kind, value) {
  const set = ENUMS[kind];
  if (!set) throw new Error(`Unknown enum kind: ${kind}`);
  return set.includes(value);
}

// Throw if `value` is not in the named enum. Used by domain validators.
function assertEnum(kind, value, field) {
  if (value === undefined || value === null || value === '') return; // optional handled by caller
  if (!isValidEnum(kind, value)) {
    throw new ValidationError(
      `Invalid ${field || kind} '${value}'. Allowed: ${ENUMS[kind].join(', ')}`,
      field || kind,
    );
  }
}

function assertRequired(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ValidationError(`${field} is required.`, field);
  }
}

// Coerce/validate a money string or number → cents (integer). Rejects negatives.
function assertMoney(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required.`, field);
    return null;
  }
  const num = Number(String(value).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(num) || num < 0) {
    throw new ValidationError(`${field} must be a non-negative number.`, field);
  }
  return Math.round(num * 100);
}

function assertInt(value, field, { required = false, min = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required.`, field);
    return null;
  }
  const num = Number(value);
  if (!Number.isInteger(num)) {
    throw new ValidationError(`${field} must be an integer.`, field);
  }
  if (min !== null && num < min) {
    throw new ValidationError(`${field} must be ≥ ${min}.`, field);
  }
  return num;
}

module.exports = {
  ValidationError,
  ENUMS,
  isValidEnum,
  assertEnum,
  assertRequired,
  assertMoney,
  assertInt,
};
