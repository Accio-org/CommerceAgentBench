/**
 * lib/validation/reports.js
 * Closed-set enum constants and validators for Reports API v2021-06-30.
 *
 * Field casing: camelCase (same era as Feeds v2021-06-30).
 * No `payload` wrapper — responses are direct schema objects.
 * Server-side validation is MANDATORY per CLAUDE.md rule #10.
 *
 * Source: scratch/docs/api_alignment/amazon_spapi.md §Reports API v2021-06-30
 */

/**
 * processingStatus enum — exactly 5 values (ALL_CAPS_SNAKE).
 * Terminal states: DONE, CANCELLED, FATAL.
 * Cancelable: only IN_QUEUE.
 * Source: fact sheet §getReport processingStatus field.
 */
export const PROCESSING_STATUSES = new Set([
  "CANCELLED",
  "DONE",
  "FATAL",
  "IN_PROGRESS",
  "IN_QUEUE",
]);

/** Terminal states where no further transitions occur. */
export const TERMINAL_STATUSES = new Set(["DONE", "CANCELLED", "FATAL"]);

/**
 * CLOSED SET of report types in scope for this mock.
 * ONLY these two types are implemented with real TSV generation.
 * Any other reportType → 400 InvalidInput (CLAUDE.md rule #10).
 *
 * Source: scratch/docs/api_alignment/amazon_spapi.md
 *   §GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2 (line ~1022)
 *   §GET_FBA_REIMBURSEMENTS_DATA (line ~1124)
 */
export const VALID_REPORT_TYPES = new Set([
  "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
  "GET_FBA_REIMBURSEMENTS_DATA",
]);

/**
 * Period enum for createReportSchedule.
 * Source: fact sheet §createReportSchedule.
 */
export const SCHEDULE_PERIODS = new Set([
  "PT5M",
  "PT15M",
  "PT30M",
  "PT1H",
  "PT2H",
  "PT4H",
  "PT8H",
  "PT12H",
  "P1D",
  "P2D",
  "P3D",
  "P7D",
  "P14D",
  "P15D",
  "P18D",
  "P30D",
]);

/**
 * Whether a reportType value is in the closed set.
 *
 * @param {string} reportType
 * @returns {boolean}
 */
export function isValidReportType(reportType) {
  return VALID_REPORT_TYPES.has(reportType);
}

/**
 * Auto-generate a numeric-string reportId (mimics Amazon's short numeric style).
 * @returns {string} e.g. "12345678901234"
 */
export function generateReportId() {
  return String(Math.floor(Math.random() * 900000000000000) + 100000000000000);
}

/**
 * Auto-generate a reportDocumentId in Amazon's amzn1.spdoc format.
 * @returns {string} e.g. "amzn1.spdoc.1.4.na.abc123.xyz789"
 */
export function generateReportDocumentId() {
  const hex1 = Math.random().toString(16).slice(2, 10);
  const hex2 = Math.random().toString(16).slice(2, 10);
  const hex3 = Math.random().toString(16).slice(2, 10);
  return `amzn1.spdoc.1.4.na.${hex1}${hex2}.${hex3}`;
}

/**
 * Auto-generate a reportScheduleId.
 * @returns {string}
 */
export function generateReportScheduleId() {
  return String(Math.floor(Math.random() * 900000000000) + 100000000000);
}

// ---------------------------------------------------------------------------
// TSV Column headers (exact, kebab-case, as specified in fact sheet)
// ---------------------------------------------------------------------------

/**
 * Settlement Report (GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2) — 24 columns.
 * Source: fact sheet line ~1034-1037.
 * Column order is EXACT per spec.
 */
export const SETTLEMENT_REPORT_COLUMNS = [
  "settlement-id",
  "settlement-start-date",
  "settlement-end-date",
  "deposit-date",
  "total-amount",
  "currency",
  "transaction-type",
  "order-id",
  "merchant-order-id",
  "adjustment-id",
  "shipment-id",
  "marketplace-name",
  "amount-type",
  "amount-description",
  "amount",
  "fulfillment-id",
  "posted-date",
  "posted-date-time",
  "order-item-code",
  "merchant-order-item-id",
  "merchant-adjustment-item-id",
  "sku",
  "quantity-purchased",
  "promotion-id",
];

/**
 * FBA Reimbursements Report (GET_FBA_REIMBURSEMENTS_DATA) — 18 columns.
 * Source: fact sheet line ~1132-1135.
 * Column order is EXACT per spec.
 */
export const REIMBURSEMENT_REPORT_COLUMNS = [
  "approval-date",
  "reimbursement-id",
  "case-id",
  "amazon-order-id",
  "reason",
  "sku",
  "fnsku",
  "asin",
  "product-name",
  "condition",
  "currency-unit",
  "amount-per-unit",
  "amount-total",
  "quantity-reimbursed-cash",
  "quantity-reimbursed-inventory",
  "quantity-reimbursed-total",
  "original-reimbursement-id",
  "original-reimbursement-type",
];
