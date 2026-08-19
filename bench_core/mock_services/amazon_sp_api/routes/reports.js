/**
 * routes/reports.js
 * Reports API v2021-06-30 — namespace /reports/2021-06-30
 *
 * Operations (9 total — complete set for this namespace):
 *   GET    /reports/2021-06-30/reports                               — getReports       → 200
 *   POST   /reports/2021-06-30/reports                               — createReport     → 202
 *   GET    /reports/2021-06-30/reports/{reportId}                    — getReport        → 200
 *   DELETE /reports/2021-06-30/reports/{reportId}                    — cancelReport     → 200 (empty)
 *   GET    /reports/2021-06-30/schedules                             — getReportSchedules → 200
 *   POST   /reports/2021-06-30/schedules                             — createReportSchedule → 201
 *   GET    /reports/2021-06-30/schedules/{reportScheduleId}          — getReportSchedule  → 200
 *   DELETE /reports/2021-06-30/schedules/{reportScheduleId}          — cancelReportSchedule → 200 (empty)
 *   GET    /reports/2021-06-30/documents/{reportDocumentId}          — getReportDocument → 200
 *
 * Spec source: scratch/docs/api_alignment/amazon_spapi.md §Reports API v2021-06-30
 *
 * Critical alignment facts enforced here:
 *  1. NO `payload` wrapper — responses are direct schema objects (same as Feeds 2021-06-30).
 *  2. camelCase throughout (reportId, reportType, processingStatus, reportDocumentId, etc.).
 *  3. processingStatus enum: exactly 5 values ALL_CAPS (CANCELLED/DONE/FATAL/IN_PROGRESS/IN_QUEUE).
 *  4. createReport returns 202 Accepted (NOT 200).
 *  5. reportDocumentId only present on the wire when processingStatus === "DONE".
 *  6. reportType is a CLOSED SET — 400 on unknown value (CLAUDE.md rule #10).
 *  7. ASYNC STATE MACHINE — DETERMINISTIC POLL-COUNT, NOT wall-clock:
 *       createReport: writes IN_QUEUE.
 *       1st getReport poll: IN_QUEUE → IN_PROGRESS (increments _pollCount to 1).
 *       2nd getReport poll: IN_PROGRESS → DONE (generates TSV document, increments _pollCount to 2).
 *       CANCELLED reports never advance.
 *     This is intentional mock convenience — no sleeps, fully deterministic, test-friendly.
 *  8. Document serving: GET /_documents/{reportDocumentId} is a PUBLIC path (no auth).
 *     getReportDocument returns { reportDocumentId, url, compressionAlgorithm: "GZIP" }.
 *     url = "${origin}/_documents/${reportDocumentId}" derived from the incoming request.
 *     Actual bytes served are gzip-compressed (Bun.gzipSync); ?nocompress=1 returns plain UTF-8 TSV.
 *  9. cancelReport: only IN_QUEUE reports can be cancelled; 400 if not IN_QUEUE.
 * 10. TSV report content generated at DONE transition (not at createReport).
 */

import {
  mutate,
  getReport,
  getAllReports,
  queryReports,
  getReportDocument,
  getReportSchedule,
  getAllReportSchedules,
} from "../lib/store.js";
import {
  jsonOk,
  jsonError,
  parseIntParam,
} from "../lib/responses.js";
import {
  PROCESSING_STATUSES,
  TERMINAL_STATUSES,
  VALID_REPORT_TYPES,
  isValidReportType,
  generateReportId,
  generateReportDocumentId,
  generateReportScheduleId,
  SETTLEMENT_REPORT_COLUMNS,
  REIMBURSEMENT_REPORT_COLUMNS,
} from "../lib/validation/reports.js";
import { paginate } from "../lib/pagination.js";

// Rate limits per fact sheet
const RL_GET_REPORTS = 0.0222;          // burst 10 (using feeds analogy; spec says varies)
const RL_CREATE_REPORT = 0.0167;        // burst 15 (fact sheet)
const RL_GET_REPORT = 2;                // burst 15 (fact sheet)
const RL_CANCEL_REPORT = 2;             // burst 15
const RL_GET_REPORT_SCHEDULES = 0.0222; // burst 10
const RL_CREATE_REPORT_SCHEDULE = 0.0222;
const RL_GET_REPORT_SCHEDULE = 0.0222;
const RL_CANCEL_REPORT_SCHEDULE = 0.0222;
const RL_GET_REPORT_DOCUMENT = 0.0167;  // burst 15 (fact sheet)

// ---------------------------------------------------------------------------
// Namespace descriptor
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Reports",
  version: "2021-06-30",
  base: "/reports/2021-06-30",
  casing: "camelCase",
  wrapper: "none (direct schema object, no payload wrapper)",
};

// ---------------------------------------------------------------------------
// TSV generators — fact-sheet-exact column headers + realistic data
// ---------------------------------------------------------------------------

/**
 * Generate a Settlement Report TSV (GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2).
 *
 * Format: 24 kebab-case columns, tab-separated.
 * First row = settlement-level total (only date/currency/total-amount populated).
 * Subsequent rows = per-transaction line items.
 *
 * Source: fact sheet §Settlement Report, lines ~1034-1122.
 * Realistic values — does NOT need to cross-foot with the Finances seed.
 *
 * @returns {string} UTF-8 TSV content
 */
function generateSettlementReportTsv() {
  const cols = SETTLEMENT_REPORT_COLUMNS;
  const header = cols.join("\t");

  const settlementId = "58901234567";
  const startDate = "05/01/2026 00:00:00";
  const endDate   = "05/14/2026 23:59:59";
  const depositDate = "05/16/2026 12:00:00";
  const totalAmount = "1523.87";
  const currency = "USD";
  const marketplaceName = "amazon.com";

  // Helper to build a row (24 columns); empty string for absent columns.
  const row = (cells) => cells.join("\t");

  // Row 0: settlement-level total — only date/currency/total-amount populated, rest blank.
  // Per spec: "Only populated on the first row of the file; blank thereafter."
  const row0 = row([
    settlementId, startDate, endDate, depositDate,
    totalAmount, currency,  // total-amount + currency
    "", "", "", "", "", "",  // transaction-type through marketplace-name
    "", "", "",              // amount-type, amount-description, amount
    "",                      // fulfillment-id
    "", "",                  // posted-date, posted-date-time
    "", "", "",              // order-item-code, merchant-order-item-id, merchant-adjustment-item-id
    "", "", "",              // sku, quantity-purchased, promotion-id
  ]);

  // Row 1: Order — Principal (keyboard sale)
  const row1 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "Order", "112-3456789-1234567", "", "", "TBC-SHIP-001", marketplaceName,
    "ItemPrice", "Principal", "89.99",
    "AFN", "05/03/2026", "2026-05-03 14:22:11 UTC",
    "58901234000001", "", "",
    "BP-KB-2026-SG", "1", "",
  ]);

  // Row 2: Order — Tax
  const row2 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "Order", "112-3456789-1234567", "", "", "TBC-SHIP-001", marketplaceName,
    "ItemPrice", "Tax", "7.19",
    "AFN", "05/03/2026", "2026-05-03 14:22:11 UTC",
    "58901234000001", "", "",
    "BP-KB-2026-SG", "1", "",
  ]);

  // Row 3: Order — Commission (fee, negative)
  const row3 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "Order", "112-3456789-1234567", "", "", "TBC-SHIP-001", marketplaceName,
    "ItemFees", "Commission", "-13.50",
    "AFN", "05/03/2026", "2026-05-03 14:22:11 UTC",
    "58901234000001", "", "",
    "BP-KB-2026-SG", "1", "",
  ]);

  // Row 4: Order — FBAPerUnitFulfillmentFee (negative)
  const row4 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "Order", "112-3456789-1234567", "", "", "TBC-SHIP-001", marketplaceName,
    "ItemFees", "FBAPerUnitFulfillmentFee", "-4.80",
    "AFN", "05/03/2026", "2026-05-03 14:22:11 UTC",
    "58901234000001", "", "",
    "BP-KB-2026-SG", "1", "",
  ]);

  // Row 5: Another order — USB-C Hub
  const row5 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "Order", "113-9876543-6543219", "", "", "TBC-SHIP-002", marketplaceName,
    "ItemPrice", "Principal", "49.99",
    "AFN", "05/06/2026", "2026-05-06 09:11:42 UTC",
    "58901234000002", "", "",
    "BP-HUB-7C", "1", "",
  ]);

  // Row 6: Order — Commission for Hub
  const row6 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "Order", "113-9876543-6543219", "", "", "TBC-SHIP-002", marketplaceName,
    "ItemFees", "Commission", "-7.50",
    "AFN", "05/06/2026", "2026-05-06 09:11:42 UTC",
    "58901234000002", "", "",
    "BP-HUB-7C", "1", "",
  ]);

  // Row 7: MarketplaceFacilitatorTax
  const row7 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "Order", "113-9876543-6543219", "", "", "TBC-SHIP-002", marketplaceName,
    "MarketplaceFacilitatorTax", "MarketplaceFacilitatorTax-Principal", "-4.00",
    "AFN", "05/06/2026", "2026-05-06 09:11:42 UTC",
    "58901234000002", "", "",
    "BP-HUB-7C", "1", "",
  ]);

  // Row 8: Refund — Principal (negative means refund to customer)
  const row8 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "Refund", "112-0000001-0000001", "", "", "", marketplaceName,
    "ItemPrice", "Principal", "-29.99",
    "AFN", "05/08/2026", "2026-05-08 11:00:00 UTC",
    "", "", "",
    "BP-MOUSE-RGB", "1", "",
  ]);

  // Row 9: Refund — RefundCommission (positive — Amazon returns the commission)
  const row9 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "Refund", "112-0000001-0000001", "", "", "", marketplaceName,
    "ItemFees", "RefundCommission", "4.50",
    "AFN", "05/08/2026", "2026-05-08 11:00:00 UTC",
    "", "", "",
    "BP-MOUSE-RGB", "1", "",
  ]);

  // Row 10: Current reserve amount
  const row10 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "current-reserve-amount", "", "", "", "", marketplaceName,
    "current-reserve-amount", "Current Reserve Amount", "-125.50",
    "", "05/14/2026", "2026-05-14 00:00:00 UTC",
    "", "", "",
    "", "", "",
  ]);

  // Row 11: Previous reserve balance
  const row11 = row([
    settlementId, startDate, endDate, depositDate,
    "", currency,
    "previous-reserve-amount-balance", "", "", "", "", marketplaceName,
    "previous-reserve-amount-balance", "Previous Reserve Amount Balance", "98.75",
    "", "05/14/2026", "2026-05-14 00:00:00 UTC",
    "", "", "",
    "", "", "",
  ]);

  return [header, row0, row1, row2, row3, row4, row5, row6, row7, row8, row9, row10, row11].join("\n");
}

/**
 * Generate an FBA Reimbursements Report TSV (GET_FBA_REIMBURSEMENTS_DATA).
 *
 * Format: 18 kebab-case columns, tab-separated.
 * Source: fact sheet §FBA Reimbursements Report, lines ~1124-1179.
 * Realistic values — uses seeded order IDs and SKUs where natural.
 *
 * @returns {string} UTF-8 TSV content
 */
function generateReimbursementReportTsv() {
  const cols = REIMBURSEMENT_REPORT_COLUMNS;
  const header = cols.join("\t");

  // Helper to build a row (18 columns).
  const row = (cells) => cells.join("\t");

  // Row 1: Damaged at warehouse — keyboard
  const row1 = row([
    "2026-05-03T10:15:00+00:00",
    "9876543210",
    "",                        // case-id: blank (Amazon initiated)
    "",                        // amazon-order-id: blank (warehouse, not tied to order)
    "Damaged_Warehouse",
    "BP-KB-2026-SG",
    "X001BPKB001",
    "B0BENCH001",
    "BenchPro Wireless Ergonomic Keyboard",
    "New",
    "USD",
    "89.99",
    "89.99",
    "1",                       // quantity-reimbursed-cash
    "0",                       // quantity-reimbursed-inventory
    "1",                       // quantity-reimbursed-total
    "",                        // original-reimbursement-id
    "",                        // original-reimbursement-type
  ]);

  // Row 2: Lost warehouse — USB-C Hub (Amazon-initiated proactive)
  const row2 = row([
    "2026-05-07T14:30:00+00:00",
    "9876543211",
    "",
    "",
    "Lost_Warehouse",
    "BP-HUB-7C",
    "X001BPHUB001",
    "B0BENCH002",
    "BenchPro USB-C Hub 7-in-1",
    "New",
    "USD",
    "49.99",
    "49.99",
    "1",
    "0",
    "1",
    "",
    "",
  ]);

  // Row 3: Customer Service Issue — Mouse (with a support case)
  const row3 = row([
    "2026-05-10T08:00:00+00:00",
    "9876543212",
    "C12345678",              // case-id present
    "112-3456789-1234567",   // amazon-order-id
    "Customer Service Issue",
    "BP-MOUSE-RGB",
    "X001BPMOU001",
    "B0BENCH003",
    "BenchPro Silent RGB Mouse",
    "New",
    "USD",
    "34.99",
    "34.99",
    "1",
    "0",
    "1",
    "",
    "",
  ]);

  // Row 4: Inventory reimbursement (reimbursed as inventory, not cash)
  const row4 = row([
    "2026-05-12T16:45:00+00:00",
    "9876543213",
    "",
    "",
    "Lost_Inbound",
    "BP-MON-27QHD",
    "X001BPMON001",
    "B0BENCH005",
    "BenchPro 27-inch QHD Monitor",
    "New",
    "USD",
    "0.00",
    "0.00",
    "0",                 // quantity-reimbursed-cash: 0
    "1",                 // quantity-reimbursed-inventory: 1 (unit returned to FBA)
    "1",
    "",
    "",
  ]);

  return [header, row1, row2, row3, row4].join("\n");
}

/**
 * Generate TSV content for a given reportType.
 * Returns the raw UTF-8 TSV string.
 *
 * @param {string} reportType
 * @returns {string}
 */
function generateReportTsv(reportType) {
  if (reportType === "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2") {
    return generateSettlementReportTsv();
  }
  if (reportType === "GET_FBA_REIMBURSEMENTS_DATA") {
    return generateReimbursementReportTsv();
  }
  // Fallback (should not reach here — reportType is closed-set validated before call)
  return `report-type\tdata\n${reportType}\t(no data)`;
}

// ---------------------------------------------------------------------------
// Async state machine — DETERMINISTIC POLL-COUNT (NOT wall-clock)
// ---------------------------------------------------------------------------
//
// Mock convenience: transitions are driven by how many times getReport is polled.
// This is deterministic, needs no sleeps, and is test-friendly.
//
// Transition rules:
//   createReport: store writes IN_QUEUE, _pollCount=0.
//   getReport (any call): if not in terminal state, increment _pollCount.
//     _pollCount becomes 1 (was IN_QUEUE): transition to IN_PROGRESS.
//     _pollCount becomes 2 (was IN_PROGRESS): transition to DONE, generate document.
//   CANCELLED reports never advance (guard in handler).
//
// The fact sheet blesses this: "Mock can fast-forward by returning DONE on
// the first or second getReport poll." (line ~908)

/**
 * Advance report state machine by one poll step.
 * Called at the start of handleGetReport for non-terminal reports.
 *
 * @param {object} report - current stored report record
 * @returns {object} the (possibly updated) report record after transition
 */
function advancePollState(report) {
  // Terminal states never advance
  if (TERMINAL_STATUSES.has(report.processingStatus)) return report;

  const newPollCount = (report._pollCount || 0) + 1;

  if (newPollCount === 1 && report.processingStatus === "IN_QUEUE") {
    // IN_QUEUE → IN_PROGRESS on 1st poll
    const { entity } = mutate("report", "transition_state", {
      reportId: report.reportId,
      processingStatus: "IN_PROGRESS",
      _pollCount: newPollCount,
    });
    return entity || report;
  }

  if (newPollCount === 2 && report.processingStatus === "IN_PROGRESS") {
    // IN_PROGRESS → DONE on 2nd poll — generate TSV document now
    const reportDocumentId = generateReportDocumentId();
    const tsvContent = generateReportTsv(report.reportType);

    mutate("report_document", "create", {
      reportDocumentId,
      reportType: report.reportType,
      _content: tsvContent,
      compressionAlgorithm: "GZIP",
    });

    const { entity } = mutate("report", "transition_state", {
      reportId: report.reportId,
      processingStatus: "DONE",
      reportDocumentId,
      _pollCount: newPollCount,
    });
    return entity || report;
  }

  // Unexpected poll (e.g. if somehow _pollCount jumped): just increment counter
  const { entity } = mutate("report", "transition_state", {
    reportId: report.reportId,
    processingStatus: report.processingStatus,
    _pollCount: newPollCount,
  });
  return entity || report;
}

// ---------------------------------------------------------------------------
// Helper: project a Report object to the wire shape (strip internal _ fields)
// ---------------------------------------------------------------------------

/**
 * Project a stored report record to the Reports API schema shape.
 * Omits internal _ fields. Only includes reportDocumentId when DONE.
 *
 * @param {object} report
 * @returns {object}
 */
function projectReport(report) {
  const out = {
    reportId: report.reportId,
    reportType: report.reportType,
    processingStatus: report.processingStatus,
    createdTime: report.createdTime,
  };
  if (Array.isArray(report.marketplaceIds) && report.marketplaceIds.length > 0) {
    out.marketplaceIds = report.marketplaceIds;
  }
  if (report.dataStartTime) out.dataStartTime = report.dataStartTime;
  if (report.dataEndTime) out.dataEndTime = report.dataEndTime;
  if (report.reportScheduleId) out.reportScheduleId = report.reportScheduleId;
  if (report.processingStartTime) out.processingStartTime = report.processingStartTime;
  if (report.processingEndTime) out.processingEndTime = report.processingEndTime;
  // reportDocumentId only present when DONE
  if (report.processingStatus === "DONE" && report.reportDocumentId) {
    out.reportDocumentId = report.reportDocumentId;
  }
  return out;
}

/**
 * Project a stored report schedule to the wire shape.
 *
 * @param {object} schedule
 * @returns {object}
 */
function projectReportSchedule(schedule) {
  const out = {
    reportScheduleId: schedule.reportScheduleId,
    reportType: schedule.reportType,
    period: schedule.period,
    createdTime: schedule.createdTime,
  };
  if (Array.isArray(schedule.marketplaceIds) && schedule.marketplaceIds.length > 0) {
    out.marketplaceIds = schedule.marketplaceIds;
  }
  if (schedule.reportOptions) out.reportOptions = schedule.reportOptions;
  if (schedule.nextReportCreationTime) out.nextReportCreationTime = schedule.nextReportCreationTime;
  return out;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /reports/2021-06-30/reports — getReports
 * Returns list of reports matching filters.
 * Rate limit: 0.0222 req/sec, burst 10.
 */
async function handleGetReports(req, _pathParams) {
  const url = new URL(req.url);
  const q = url.searchParams;

  const nextToken = q.get("nextToken") || null;

  if (nextToken) {
    const allReports = getAllReports().map(projectReport);
    const pageSize = parseIntParam(q.get("pageSize"), 10, 1, 100);
    const { items, nextToken: outToken } = paginate(allReports, {}, pageSize, nextToken, "nextToken");
    return jsonOk(
      { reports: items, ...(outToken ? { nextToken: outToken } : {}) },
      { rateLimit: RL_GET_REPORTS }
    );
  }

  // Build filters
  const reportTypes = [];
  for (const v of q.getAll("reportTypes")) {
    for (const part of v.split(",")) {
      if (part.trim()) reportTypes.push(part.trim());
    }
  }

  const marketplaceIds = [];
  for (const v of q.getAll("marketplaceIds")) {
    for (const part of v.split(",")) {
      if (part.trim()) marketplaceIds.push(part.trim());
    }
  }

  const processingStatuses = [];
  for (const v of q.getAll("processingStatuses")) {
    for (const part of v.split(",")) {
      if (part.trim()) processingStatuses.push(part.trim());
    }
  }

  // Validate processingStatuses enum
  for (const s of processingStatuses) {
    if (!PROCESSING_STATUSES.has(s)) {
      return jsonError(
        400,
        "InvalidInput",
        `Invalid processingStatus: '${s}'.`,
        `processingStatuses must be one of: ${[...PROCESSING_STATUSES].join(", ")}`,
        RL_GET_REPORTS
      );
    }
  }

  const createdSince = q.get("createdSince") || null;
  const createdUntil = q.get("createdUntil") || null;
  const pageSize = parseIntParam(q.get("pageSize"), 10, 1, 100);

  const filters = {
    ...(reportTypes.length > 0 ? { reportTypes } : {}),
    ...(marketplaceIds.length > 0 ? { marketplaceIds } : {}),
    ...(processingStatuses.length > 0 ? { processingStatuses } : {}),
    ...(createdSince ? { createdSince } : {}),
    ...(createdUntil ? { createdUntil } : {}),
  };

  const allFiltered = queryReports(filters).map(projectReport);
  const { items, nextToken: outToken } = paginate(allFiltered, filters, pageSize, null, "nextToken");

  return jsonOk(
    { reports: items, ...(outToken ? { nextToken: outToken } : {}) },
    { rateLimit: RL_GET_REPORTS }
  );
}

/**
 * POST /reports/2021-06-30/reports — createReport
 * Returns 202 Accepted with just { reportId } (NO payload wrapper).
 * Writes initial IN_QUEUE status; advances via poll-count on getReport.
 * Rate limit: 0.0167 req/sec, burst 15.
 */
async function handleCreateReport(req, _pathParams) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body must be valid JSON.", undefined, RL_CREATE_REPORT);
  }

  // reportType: required + closed-set validation (CLAUDE.md #10)
  if (!body.reportType) {
    return jsonError(
      400,
      "MissingParameter",
      "reportType is required.",
      "reportType: required field missing",
      RL_CREATE_REPORT
    );
  }
  if (!isValidReportType(body.reportType)) {
    return jsonError(
      400,
      "InvalidInput",
      `reportType '${body.reportType}' is not supported. Valid types: ${[...VALID_REPORT_TYPES].join(", ")}`,
      "reportType: must be one of the supported report types",
      RL_CREATE_REPORT
    );
  }

  // marketplaceIds: required, non-empty array
  if (!Array.isArray(body.marketplaceIds) || body.marketplaceIds.length === 0) {
    return jsonError(
      400,
      "MissingParameter",
      "marketplaceIds is required and must be a non-empty array.",
      "marketplaceIds: required field missing or empty",
      RL_CREATE_REPORT
    );
  }

  const reportId = generateReportId();

  mutate("report", "submit", {
    reportId,
    reportType: body.reportType,
    marketplaceIds: body.marketplaceIds,
    dataStartTime: body.dataStartTime || null,
    dataEndTime: body.dataEndTime || null,
    reportOptions: body.reportOptions || null,
  });

  // 202 Accepted — CreateReportResponse is just { reportId }
  return jsonOk({ reportId }, { status: 202, rateLimit: RL_CREATE_REPORT });
}

/**
 * GET /reports/2021-06-30/reports/{reportId} — getReport
 * DETERMINISTIC POLL-COUNT state machine: each call advances the state by one step.
 * Rate limit: 2 req/sec, burst 15.
 */
async function handleGetReport(_req, { reportId }) {
  const report = getReport(reportId);
  if (!report) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Report '${reportId}' not found.`,
      undefined,
      RL_GET_REPORT
    );
  }

  // Advance state machine (deterministic poll-count — see module header comment).
  // CANCELLED/DONE/FATAL reports are NOT advanced.
  const advanced = advancePollState(report);

  return jsonOk(projectReport(advanced), { rateLimit: RL_GET_REPORT });
}

/**
 * DELETE /reports/2021-06-30/reports/{reportId} — cancelReport
 * Only cancels IN_QUEUE reports. Returns 200 with empty body.
 * Rate limit: 2 req/sec, burst 15.
 */
async function handleCancelReport(_req, { reportId }) {
  const report = getReport(reportId);
  if (!report) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Report '${reportId}' not found.`,
      undefined,
      RL_CANCEL_REPORT
    );
  }

  if (report.processingStatus !== "IN_QUEUE") {
    return jsonError(
      400,
      "InvalidInput",
      `Report '${reportId}' cannot be cancelled because its processingStatus is '${report.processingStatus}'. Only IN_QUEUE reports can be cancelled.`,
      "cancelReport: report must be in IN_QUEUE state",
      RL_CANCEL_REPORT
    );
  }

  mutate("report", "cancel", { reportId });

  // Empty body per spec
  return jsonOk({}, { rateLimit: RL_CANCEL_REPORT });
}

/**
 * GET /reports/2021-06-30/schedules — getReportSchedules
 * Rate limit: 0.0222 req/sec, burst 10.
 */
async function handleGetReportSchedules(req, _pathParams) {
  const url = new URL(req.url);
  const q = url.searchParams;

  const reportTypes = [];
  for (const v of q.getAll("reportTypes")) {
    for (const part of v.split(",")) {
      if (part.trim()) reportTypes.push(part.trim());
    }
  }

  let schedules = getAllReportSchedules();

  if (reportTypes.length > 0) {
    const typeSet = new Set(reportTypes);
    schedules = schedules.filter((s) => typeSet.has(s.reportType));
  }

  return jsonOk(
    { reportSchedules: schedules.map(projectReportSchedule) },
    { rateLimit: RL_GET_REPORT_SCHEDULES }
  );
}

/**
 * POST /reports/2021-06-30/schedules — createReportSchedule
 * Returns 201 Created with { reportScheduleId }.
 * Rate limit: 0.0222 req/sec, burst 10.
 */
async function handleCreateReportSchedule(req, _pathParams) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body must be valid JSON.", undefined, RL_CREATE_REPORT_SCHEDULE);
  }

  if (!body.reportType) {
    return jsonError(400, "MissingParameter", "reportType is required.", undefined, RL_CREATE_REPORT_SCHEDULE);
  }
  if (!isValidReportType(body.reportType)) {
    return jsonError(
      400,
      "InvalidInput",
      `reportType '${body.reportType}' is not supported.`,
      undefined,
      RL_CREATE_REPORT_SCHEDULE
    );
  }

  if (!body.period) {
    return jsonError(400, "MissingParameter", "period is required.", undefined, RL_CREATE_REPORT_SCHEDULE);
  }

  if (!Array.isArray(body.marketplaceIds) || body.marketplaceIds.length === 0) {
    return jsonError(
      400,
      "MissingParameter",
      "marketplaceIds is required and must be a non-empty array.",
      undefined,
      RL_CREATE_REPORT_SCHEDULE
    );
  }

  const reportScheduleId = generateReportScheduleId();

  mutate("report_schedule", "create", {
    reportScheduleId,
    reportType: body.reportType,
    marketplaceIds: body.marketplaceIds,
    reportOptions: body.reportOptions || null,
    period: body.period,
    nextReportCreationTime: body.nextReportCreationTime || null,
  });

  return jsonOk({ reportScheduleId }, { status: 201, rateLimit: RL_CREATE_REPORT_SCHEDULE });
}

/**
 * GET /reports/2021-06-30/schedules/{reportScheduleId} — getReportSchedule
 * Rate limit: 0.0222 req/sec.
 */
async function handleGetReportSchedule(_req, { reportScheduleId }) {
  const schedule = getReportSchedule(reportScheduleId);
  if (!schedule) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Report schedule '${reportScheduleId}' not found.`,
      undefined,
      RL_GET_REPORT_SCHEDULE
    );
  }
  return jsonOk(projectReportSchedule(schedule), { rateLimit: RL_GET_REPORT_SCHEDULE });
}

/**
 * DELETE /reports/2021-06-30/schedules/{reportScheduleId} — cancelReportSchedule
 * Returns 200 with empty body.
 * Rate limit: 0.0222 req/sec.
 */
async function handleCancelReportSchedule(_req, { reportScheduleId }) {
  const schedule = getReportSchedule(reportScheduleId);
  if (!schedule) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Report schedule '${reportScheduleId}' not found.`,
      undefined,
      RL_CANCEL_REPORT_SCHEDULE
    );
  }

  mutate("report_schedule", "cancel", { reportScheduleId });

  return jsonOk({}, { rateLimit: RL_CANCEL_REPORT_SCHEDULE });
}

/**
 * GET /reports/2021-06-30/documents/{reportDocumentId} — getReportDocument
 *
 * Returns { reportDocumentId, url, compressionAlgorithm: "GZIP" }.
 * The url is a public /_documents/{id} path derived from the incoming request origin.
 * Client should GET that URL (no auth required — it's a "pre-signed" URL).
 *
 * Rate limit: 0.0167 req/sec, burst 15.
 */
async function handleGetReportDocument(req, { reportDocumentId }) {
  const doc = getReportDocument(reportDocumentId);
  if (!doc) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Report document '${reportDocumentId}' not found.`,
      undefined,
      RL_GET_REPORT_DOCUMENT
    );
  }

  // Derive origin from the incoming request so this works on any port/host.
  // The /_documents/ path is served by the public handler in server.js (no auth).
  const origin = new URL(req.url).origin;
  const url = `${origin}/_documents/${reportDocumentId}`;

  const out = {
    reportDocumentId: doc.reportDocumentId,
    url,
  };
  // compressionAlgorithm is only present when the document is compressed
  if (doc.compressionAlgorithm) {
    out.compressionAlgorithm = doc.compressionAlgorithm;
  }

  return jsonOk(out, { rateLimit: RL_GET_REPORT_DOCUMENT });
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "GET",
    path: "/reports/2021-06-30/reports",
    handler: handleGetReports,
    help: {
      description:
        "Returns a list of reports. When nextToken is supplied, other filters are ignored. Rate: 0.0222 req/sec.",
      params: [
        { name: "reportTypes", in: "query" },
        { name: "marketplaceIds", in: "query" },
        { name: "processingStatuses", in: "query", description: `enum: ${[...PROCESSING_STATUSES].join("|")}` },
        { name: "createdSince", in: "query" },
        { name: "createdUntil", in: "query" },
        { name: "pageSize", in: "query", description: "1-100, default 10" },
        { name: "nextToken", in: "query" },
      ],
    },
  },
  {
    method: "POST",
    path: "/reports/2021-06-30/reports",
    handler: handleCreateReport,
    help: {
      description:
        "Creates a report. Returns 202 Accepted with { reportId }. Starts deterministic poll-count state machine: IN_QUEUE → IN_PROGRESS (1st getReport) → DONE (2nd getReport). reportType is a closed set. Rate: 0.0167 req/sec.",
      params: [],
    },
  },
  {
    method: "GET",
    path: "/reports/2021-06-30/reports/:reportId",
    handler: handleGetReport,
    help: {
      description:
        "Returns a report by reportId. Each call advances state machine by 1 poll step (IN_QUEUE→IN_PROGRESS on 1st, IN_PROGRESS→DONE+doc on 2nd). Rate: 2 req/sec.",
      params: [{ name: "reportId", in: "path", required: true }],
    },
  },
  {
    method: "DELETE",
    path: "/reports/2021-06-30/reports/:reportId",
    handler: handleCancelReport,
    help: {
      description:
        "Cancels a report. Only IN_QUEUE reports can be cancelled. Returns 200 empty body. Rate: 2 req/sec.",
      params: [{ name: "reportId", in: "path", required: true }],
    },
  },
  {
    method: "GET",
    path: "/reports/2021-06-30/schedules",
    handler: handleGetReportSchedules,
    help: {
      description: "Returns all report schedules, optionally filtered by reportTypes. Rate: 0.0222 req/sec.",
      params: [{ name: "reportTypes", in: "query" }],
    },
  },
  {
    method: "POST",
    path: "/reports/2021-06-30/schedules",
    handler: handleCreateReportSchedule,
    help: {
      description:
        "Creates a report schedule. Returns 201 Created with { reportScheduleId }. Rate: 0.0222 req/sec.",
      params: [],
    },
  },
  {
    method: "GET",
    path: "/reports/2021-06-30/schedules/:reportScheduleId",
    handler: handleGetReportSchedule,
    help: {
      description: "Returns a report schedule by ID. Rate: 0.0222 req/sec.",
      params: [{ name: "reportScheduleId", in: "path", required: true }],
    },
  },
  {
    method: "DELETE",
    path: "/reports/2021-06-30/schedules/:reportScheduleId",
    handler: handleCancelReportSchedule,
    help: {
      description: "Cancels a report schedule. Returns 200 empty body. Rate: 0.0222 req/sec.",
      params: [{ name: "reportScheduleId", in: "path", required: true }],
    },
  },
  {
    method: "GET",
    path: "/reports/2021-06-30/documents/:reportDocumentId",
    handler: handleGetReportDocument,
    help: {
      description:
        "Returns { reportDocumentId, url, compressionAlgorithm: 'GZIP' }. The url points to /_documents/{id} (public, no auth). GET that URL with ?nocompress=1 for plain TSV or without for gzipped bytes. Rate: 0.0167 req/sec.",
      params: [{ name: "reportDocumentId", in: "path", required: true }],
    },
  },
];
