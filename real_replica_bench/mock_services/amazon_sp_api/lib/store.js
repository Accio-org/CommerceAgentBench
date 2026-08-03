/**
 * lib/store.js
 * Central stateful store for the Amazon SP-API mock.
 *
 * All entity state lives here. Routes MUST NOT mutate Maps directly —
 * use mutate() for writes, loadSeed() for initialization.
 *
 * Wave 0 entities: marketplaces, sellers, catalog.
 * Wave 1 entities: listings, pricingOffers.
 *   - listings: keyed by composite "${sellerId}:${marketplaceId}:${sku}"
 *   - pricingOffers: keyed by composite "${asin}:${marketplaceId}" for competitive offers
 * Wave 2 entities: orders, orderItems, inventorySummaries, feeds, feedDocuments.
 *   - orders: keyed by AmazonOrderId (3-7-7 format)
 *   - orderItems: keyed by AmazonOrderId → array of OrderItem
 *   - inventorySummaries: keyed by "${sellerId}:${marketplaceId}:${sku}"
 *   - feeds: keyed by feedId
 *   - feedDocuments: keyed by feedDocumentId (covers both upload-slot and result docs)
 *
 * Wave 3a entities: financialEvents, financialEventGroups.
 *   - financialEvents: keyed by a synthetic eventId (uuid). Each record carries
 *     _postedDate, _orderId (optional), _groupId (optional) for query routing.
 *     The store holds per-event records with typed lists embedded; queryFinancialEvents()
 *     assembles them into the FinancialEvents object shape expected by routes.
 *   - financialEventGroups: keyed by FinancialEventGroupId (string).
 *     Each group record holds the group metadata + aggregated FinancialEvents lists.
 *
 * Wave 3b entities: reports, reportDocuments, reportSchedules.
 *   - reports: keyed by reportId (numeric string). Each record holds processingStatus,
 *     reportType, marketplaceIds, and internal _pollCount for deterministic state advance.
 *   - reportDocuments: keyed by reportDocumentId (amzn1.spdoc.* string). Each record
 *     holds _content (UTF-8 TSV string) + compressionAlgorithm + reportType.
 *   - reportSchedules: keyed by reportScheduleId (numeric string).
 *
 * Architecture note: mutate() is the single choke-point for all writes.
 * This makes audit logging, derived-state computation, and notification
 * dispatch pluggable — Wave 3 wires real notification dispatch in
 * publishNotifications() without touching any route handler.
 *
 * Cross-namespace coupling (Wave 2 architectural test):
 *   When an Order transitions to "Shipped" or "PartiallyShipped", the
 *   corresponding OrderItem(s) trigger inventory mutations via applyMutation
 *   to reduce fulfillableQuantity and increase reservedQuantity on the SKU.
 *   This is wired inside applyMutation("order", "update_status", ...).
 */

import { publish, resetNotifications, snapshotNotifications } from "./notifications.js";
import { ValidationError } from "./validation/common.js";

// ---------------------------------------------------------------------------
// Entity stores
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} marketplaceId → Marketplace */
const marketplaces = new Map();

/** @type {Map<string, object>} sellerId → Seller */
const sellers = new Map();

/**
 * ASIN → CatalogItem
 * @type {Map<string, object>}
 */
const catalog = new Map();

/**
 * Listings: composite key "${sellerId}:${marketplaceId}:${sku}" → ListingItem
 * Supports per-marketplace listings per SKU per seller.
 * @type {Map<string, object>}
 */
const listings = new Map();

/**
 * Competitive pricing offers: composite key "${asin}:${marketplaceId}" → PricingOffer[]
 * Holds buy-box and competitive offer data for Pricing v0 endpoints.
 * @type {Map<string, object>}
 */
const pricingOffers = new Map();

// ---------------------------------------------------------------------------
// Wave 2 Entity stores
// ---------------------------------------------------------------------------

/**
 * Orders: keyed by AmazonOrderId (3-7-7 format, e.g. "112-1234567-1234567")
 * @type {Map<string, object>}
 */
const orders = new Map();

/**
 * OrderItems: keyed by AmazonOrderId → array of OrderItem objects.
 * Each OrderItem has ASIN (uppercase), SellerSKU, OrderItemId, etc. per Orders v0 spec.
 * @type {Map<string, object[]>}
 */
const orderItems = new Map();

/**
 * FBA Inventory summaries: keyed by "${sellerId}:${marketplaceId}:${sku}".
 * Composite key matches real Amazon FC granularity.
 * @type {Map<string, object>}
 */
const inventorySummaries = new Map();

/**
 * Feeds: keyed by feedId (numeric-string, e.g. "348593495012345")
 * @type {Map<string, object>}
 */
const feeds = new Map();

/**
 * Feed documents: keyed by feedDocumentId (UUID-like string).
 * Covers both upload-slot documents (from createFeedDocument)
 * and result documents (created when a feed transitions to DONE).
 * @type {Map<string, object>}
 */
const feedDocuments = new Map();

// ---------------------------------------------------------------------------
// Wave 3a Entity stores — Finances API v0
// ---------------------------------------------------------------------------

/**
 * Financial event groups (settlement periods): keyed by FinancialEventGroupId.
 * Each record holds:
 *   { FinancialEventGroupId, ProcessingStatus, FundTransferStatus, OriginalTotal,
 *     ConvertedTotal, FundTransferDate, TraceId, AccountTail, BeginningBalance,
 *     FinancialEventGroupStart, FinancialEventGroupEnd,
 *     _shipmentEvents, _refundEvents, _serviceFeeEvents, _adjustmentEvents }
 * Money fields use { CurrencyCode, CurrencyAmount: <number> } per Finances v0 spec.
 * @type {Map<string, object>}
 */
const financialEventGroups = new Map();

/**
 * Financial events: keyed by synthetic eventId (assigned at seed/mutation time).
 * Each record is a "bundle" object:
 *   {
 *     _eventId: string,
 *     _orderId: string|null,   — set for shipment/refund events tied to an order
 *     _groupId: string|null,   — set for events belonging to a settlement group
 *     _postedDate: string,     — ISO 8601; used for PostedAfter/PostedBefore filtering
 *     ShipmentEventList: ShipmentEvent[],
 *     RefundEventList: ShipmentEvent[],  — same shape as ShipmentEvent (fact sheet)
 *     ServiceFeeEventList: ServiceFeeEvent[],
 *     AdjustmentEventList: AdjustmentEvent[],
 *   }
 * CurrencyAmount is always a NUMBER (never a string).
 * @type {Map<string, object>}
 */
const financialEvents = new Map();

// ---------------------------------------------------------------------------
// Wave 3b Entity stores — Reports API v2021-06-30
// ---------------------------------------------------------------------------

/**
 * Reports: keyed by reportId (numeric string, e.g. "12345678901234").
 * Each record holds:
 *   { reportId, reportType, marketplaceIds, processingStatus,
 *     createdTime, processingStartTime?, processingEndTime?,
 *     reportDocumentId?, dataStartTime?, dataEndTime?, reportScheduleId?,
 *     _pollCount: number }  ← internal poll counter for deterministic state advance
 * @type {Map<string, object>}
 */
const reports = new Map();

/**
 * Report documents: keyed by reportDocumentId (amzn1.spdoc.* string).
 * Each record holds:
 *   { reportDocumentId, reportType, compressionAlgorithm?, _content: string }
 * _content is the raw UTF-8 TSV string. Callers gzip it on the fly when serving.
 * @type {Map<string, object>}
 */
const reportDocuments = new Map();

/**
 * Report schedules: keyed by reportScheduleId (numeric string).
 * Each record holds:
 *   { reportScheduleId, reportType, marketplaceIds, period,
 *     createdTime, reportOptions?, nextReportCreationTime? }
 * @type {Map<string, object>}
 */
const reportSchedules = new Map();

/** Append-only audit log of all mutations (read-only from outside). */
const _auditLog = [];

/** Virtual clock for advance() — ms offset from real time. Wave 3 wires this fully. */
let _virtualTimeOffsetMs = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} entityType
 * @param {string} op
 * @param {unknown} payload
 * @returns {unknown} the resulting entity
 */
function applyMutation(entityType, op, payload, ctx = {}) {
  switch (entityType) {
    case "marketplace": {
      if (op === "upsert") {
        marketplaces.set(payload.id, payload);
        return payload;
      }
      break;
    }
    case "seller": {
      if (op === "upsert") {
        sellers.set(payload.sellerId, payload);
        return payload;
      }
      break;
    }
    case "catalog": {
      if (op === "upsert") {
        catalog.set(payload.asin, payload);
        return payload;
      }
      if (op === "delete") {
        catalog.delete(payload.asin);
        return payload;
      }
      break;
    }

    // --- Wave 1: Listings Items ---
    case "listing": {
      const key = payload._storeKey;
      if (!key) {
        console.warn("[store] listing mutation missing _storeKey");
        return payload;
      }
      if (op === "create" || op === "replace") {
        // PUT: full overwrite of the listing record
        const ts = new Date().toISOString();
        const existing = listings.get(key);
        const record = {
          ...payload,
          _createdDate: existing ? existing._createdDate : ts,
          _lastUpdatedDate: ts,
        };
        listings.set(key, record);
        return record;
      }
      if (op === "patch") {
        // PATCH: apply JSON Patch-style operations to the listing's attributes
        const existing = listings.get(key);
        if (!existing) return null; // caller must 404 check before calling mutate
        const ts = new Date().toISOString();
        const patches = payload.patches || [];
        // Apply patches to a shallow clone of existing
        let updated = { ...existing, attributes: { ...(existing.attributes || {}) } };
        for (const patch of patches) {
          updated = applyJsonPatchOp(updated, patch);
        }
        updated._lastUpdatedDate = ts;
        // Carry over new productType if provided
        if (payload.productType) updated.productType = payload.productType;
        listings.set(key, updated);
        return updated;
      }
      if (op === "delete") {
        const existed = listings.has(key);
        listings.delete(key);
        return { ...payload, existed };
      }
      break;
    }

    // --- Wave 1: Pricing Offers ---
    case "pricing_offer": {
      const key = payload._storeKey;
      if (!key) {
        console.warn("[store] pricing_offer mutation missing _storeKey");
        return payload;
      }
      if (op === "replace" || op === "upsert") {
        pricingOffers.set(key, payload);
        return payload;
      }
      if (op === "patch") {
        const existing = pricingOffers.get(key) || {};
        const merged = { ...existing, ...payload };
        pricingOffers.set(key, merged);
        return merged;
      }
      if (op === "delete") {
        pricingOffers.delete(key);
        return payload;
      }
      break;
    }

    // -----------------------------------------------------------------------
    // Wave 2: Orders v0
    // -----------------------------------------------------------------------
    case "order": {
      const orderId = payload.AmazonOrderId;
      if (!orderId) {
        console.warn("[store] order mutation missing AmazonOrderId");
        return payload;
      }

      if (op === "create") {
        // Seed or system-level create — full order object
        const ts = new Date().toISOString();
        const record = {
          ...payload,
          _createdDate: ts,
          _lastUpdatedDate: ts,
        };
        orders.set(orderId, record);
        // If items are embedded in payload._orderItems, extract them
        if (Array.isArray(payload._orderItems)) {
          orderItems.set(orderId, [...payload._orderItems]);
        }
        return record;
      }

      if (op === "update_status") {
        // Transition OrderStatus (e.g. Unshipped → Shipped) triggered by shipment endpoints.
        // payload = { AmazonOrderId, OrderStatus, _shippedItems: [{SellerSKU, QuantityShipped}] }
        const existing = orders.get(orderId);
        if (!existing) return null;
        const ts = new Date().toISOString();
        const updated = {
          ...existing,
          OrderStatus: payload.OrderStatus,
          LastUpdateDate: ts,
          _lastUpdatedDate: ts,
        };
        if (payload.NumberOfItemsShipped !== undefined) {
          updated.NumberOfItemsShipped = payload.NumberOfItemsShipped;
        }
        if (payload.NumberOfItemsUnshipped !== undefined) {
          updated.NumberOfItemsUnshipped = payload.NumberOfItemsUnshipped;
        }
        orders.set(orderId, updated);

        // Cross-namespace coupling: Shipped/PartiallyShipped → reduce FBA inventory
        if (
          (payload.OrderStatus === "Shipped" || payload.OrderStatus === "PartiallyShipped") &&
          Array.isArray(payload._shippedItems)
        ) {
          const sellerId = existing._sellerId || "A2BENCH00001";
          const marketplaceId = existing.MarketplaceId || "ATVPDKIKX0DER";
          for (const si of payload._shippedItems) {
            const sku = si.SellerSKU;
            const qty = si.QuantityShipped || 0;
            if (sku && qty > 0) {
              // Use recursive applyMutation to reduce inventory — single choke-point maintained
              applyMutation(
                "inventory",
                "adjust_qty",
                {
                  _storeKey: `${sellerId}:${marketplaceId}:${sku}`,
                  fulfillableDelta: -qty,
                  reservedDelta: qty,
                  _reason: `Order ${orderId} shipped qty=${qty}`,
                },
                ctx
              );
            }
          }
        }
        return updated;
      }

      if (op === "update_regulated") {
        // PATCH updateVerificationStatus
        const existing = orders.get(orderId);
        if (!existing) return null;
        const ts = new Date().toISOString();
        const updated = {
          ...existing,
          _regulatedStatus: payload.regulatedOrderVerificationStatus,
          LastUpdateDate: ts,
          _lastUpdatedDate: ts,
        };
        orders.set(orderId, updated);
        return updated;
      }
      break;
    }

    // -----------------------------------------------------------------------
    // Wave 2: FBA Inventory v1
    // -----------------------------------------------------------------------
    case "inventory": {
      const key = payload._storeKey;
      if (!key) {
        console.warn("[store] inventory mutation missing _storeKey");
        return payload;
      }

      if (op === "create") {
        // Full upsert from seed or bench/seed endpoint
        const ts = new Date().toISOString();
        const record = {
          ...payload,
          _createdDate: ts,
          lastUpdatedTime: payload.lastUpdatedTime || ts,
        };
        inventorySummaries.set(key, record);
        return record;
      }

      if (op === "adjust_qty") {
        // Delta adjustment — used by cross-namespace coupling when orders ship.
        // payload: { _storeKey, fulfillableDelta, reservedDelta, _reason }
        const existing = inventorySummaries.get(key);
        if (!existing) {
          // No inventory record — silently skip (FBA item may not be tracked)
          return payload;
        }
        const ts = new Date().toISOString();
        // Clone inventoryDetails if present
        const details = existing.inventoryDetails
          ? { ...existing.inventoryDetails }
          : null;

        if (details) {
          const fulfillableDelta = payload.fulfillableDelta || 0;
          const reservedDelta = payload.reservedDelta || 0;

          details.fulfillableQuantity = Math.max(
            0,
            (details.fulfillableQuantity || 0) + fulfillableDelta
          );

          if (details.reservedQuantity) {
            details.reservedQuantity = {
              ...details.reservedQuantity,
              totalReservedQuantity: Math.max(
                0,
                (details.reservedQuantity.totalReservedQuantity || 0) + reservedDelta
              ),
              pendingCustomerOrderQuantity: Math.max(
                0,
                (details.reservedQuantity.pendingCustomerOrderQuantity || 0) + reservedDelta
              ),
            };
          }
        }

        // Recompute totalQuantity
        const fulfillable = details ? (details.fulfillableQuantity || 0) : (existing.totalQuantity || 0);
        const inboundWorking = details ? (details.inboundWorkingQuantity || 0) : 0;
        const inboundShipped = details ? (details.inboundShippedQuantity || 0) : 0;
        const inboundReceiving = details ? (details.inboundReceivingQuantity || 0) : 0;
        const reserved = details
          ? ((details.reservedQuantity && details.reservedQuantity.totalReservedQuantity) || 0)
          : 0;
        const unfulfillable = details
          ? ((details.unfulfillableQuantity && details.unfulfillableQuantity.totalUnfulfillableQuantity) || 0)
          : 0;
        const researching = details
          ? ((details.researchingQuantity && details.researchingQuantity.totalResearchingQuantity) || 0)
          : 0;

        const totalQuantity =
          fulfillable + inboundWorking + inboundShipped + inboundReceiving +
          reserved + unfulfillable + researching;

        const updated = {
          ...existing,
          lastUpdatedTime: ts,
          totalQuantity,
          ...(details ? { inventoryDetails: details } : {}),
        };
        inventorySummaries.set(key, updated);
        return updated;
      }

      if (op === "delete") {
        inventorySummaries.delete(key);
        return payload;
      }
      break;
    }

    // -----------------------------------------------------------------------
    // Wave 2: Feeds v2021-06-30
    // -----------------------------------------------------------------------
    case "feed": {
      if (op === "submit") {
        // createFeed: payload is the CreateFeedSpecification + generated feedId
        const feedId = payload.feedId;
        if (!feedId) {
          console.warn("[store] feed submit missing feedId");
          return payload;
        }
        const ts = new Date().toISOString();
        const record = {
          feedId,
          feedType: payload.feedType,
          marketplaceIds: payload.marketplaceIds || [],
          inputFeedDocumentId: payload.inputFeedDocumentId,
          feedOptions: payload.feedOptions || null,
          createdTime: ts,
          processingStatus: "IN_QUEUE",
          processingStartTime: null,
          processingEndTime: null,
          resultFeedDocumentId: null,
        };
        feeds.set(feedId, record);
        return record;
      }

      if (op === "transition_state") {
        // payload: { feedId, processingStatus, resultFeedDocumentId? }
        const feedId = payload.feedId;
        const existing = feeds.get(feedId);
        if (!existing) return null;
        const ts = new Date().toISOString();
        const updated = { ...existing, processingStatus: payload.processingStatus };

        if (payload.processingStatus === "IN_PROGRESS" && !existing.processingStartTime) {
          updated.processingStartTime = ts;
        }
        if (
          payload.processingStatus === "DONE" ||
          payload.processingStatus === "FATAL" ||
          payload.processingStatus === "CANCELLED"
        ) {
          updated.processingEndTime = ts;
          if (payload.processingStatus === "DONE" && payload.resultFeedDocumentId) {
            updated.resultFeedDocumentId = payload.resultFeedDocumentId;
          }
        }
        feeds.set(feedId, updated);
        return updated;
      }

      if (op === "cancel") {
        // DELETE /feeds/{feedId} — only if IN_QUEUE
        const feedId = payload.feedId;
        const existing = feeds.get(feedId);
        if (!existing) return null;
        const ts = new Date().toISOString();
        const updated = {
          ...existing,
          processingStatus: "CANCELLED",
          processingEndTime: ts,
        };
        feeds.set(feedId, updated);
        return updated;
      }
      break;
    }

    // -----------------------------------------------------------------------
    // Wave 2: Feed Documents
    // -----------------------------------------------------------------------
    case "feed_document": {
      const docId = payload.feedDocumentId;
      if (!docId) {
        console.warn("[store] feed_document mutation missing feedDocumentId");
        return payload;
      }

      if (op === "create_upload_slot") {
        // POST /feeds/2021-06-30/documents — creates an upload slot
        const record = {
          feedDocumentId: docId,
          url: payload.url,
          contentType: payload.contentType || null,
          _docType: "upload",
          _uploadedContent: null,
        };
        feedDocuments.set(docId, record);
        return record;
      }

      if (op === "create_result_doc") {
        // Created internally when a feed reaches DONE
        const record = {
          feedDocumentId: docId,
          url: payload.url,
          compressionAlgorithm: payload.compressionAlgorithm || undefined,
          _docType: "result",
          _content: payload._content || null,
        };
        feedDocuments.set(docId, record);
        return record;
      }

      if (op === "store_upload") {
        // Invoked when PUT /__bench/feed_documents/:id/upload is called
        const existing = feedDocuments.get(docId);
        if (!existing) return null;
        const updated = { ...existing, _uploadedContent: payload._content };
        feedDocuments.set(docId, updated);
        return updated;
      }
      break;
    }

    // -----------------------------------------------------------------------
    // Wave 3: Finances API v0 — Financial Event Groups
    // -----------------------------------------------------------------------
    case "financial_event_group": {
      const groupId = payload.FinancialEventGroupId;
      if (!groupId) {
        console.warn("[store] financial_event_group mutation missing FinancialEventGroupId");
        return payload;
      }
      if (op === "upsert") {
        financialEventGroups.set(groupId, { ...payload });
        return payload;
      }
      break;
    }

    // -----------------------------------------------------------------------
    // Wave 3a: Finances API v0 — Financial Events (per-bundle records)
    // -----------------------------------------------------------------------
    case "financial_event": {
      const eventId = payload._eventId;
      if (!eventId) {
        console.warn("[store] financial_event mutation missing _eventId");
        return payload;
      }
      if (op === "upsert") {
        financialEvents.set(eventId, { ...payload });
        return payload;
      }
      break;
    }

    // -----------------------------------------------------------------------
    // Wave 3b: Reports API v2021-06-30 — Reports
    // -----------------------------------------------------------------------
    case "report": {
      if (op === "submit") {
        // createReport: payload is the CreateReportSpecification + generated reportId.
        const reportId = payload.reportId;
        if (!reportId) {
          console.warn("[store] report submit missing reportId");
          return payload;
        }
        const ts = new Date().toISOString();
        const record = {
          reportId,
          reportType: payload.reportType,
          marketplaceIds: payload.marketplaceIds || [],
          dataStartTime: payload.dataStartTime || null,
          dataEndTime: payload.dataEndTime || null,
          reportOptions: payload.reportOptions || null,
          reportScheduleId: payload.reportScheduleId || null,
          createdTime: ts,
          processingStatus: "IN_QUEUE",
          processingStartTime: null,
          processingEndTime: null,
          reportDocumentId: null,
          _pollCount: 0,   // internal counter for deterministic poll-count state advance
        };
        reports.set(reportId, record);
        return record;
      }

      if (op === "transition_state") {
        // Advance processingStatus. Called from advancePollState() in routes/reports.js.
        // payload: { reportId, processingStatus, reportDocumentId?, _pollCount? }
        const reportId = payload.reportId;
        const existing = reports.get(reportId);
        if (!existing) return null;
        const ts = new Date().toISOString();
        const updated = {
          ...existing,
          processingStatus: payload.processingStatus,
          _pollCount: payload._pollCount ?? existing._pollCount,
        };
        if (payload.processingStatus === "IN_PROGRESS" && !existing.processingStartTime) {
          updated.processingStartTime = ts;
        }
        if (
          payload.processingStatus === "DONE" ||
          payload.processingStatus === "FATAL" ||
          payload.processingStatus === "CANCELLED"
        ) {
          updated.processingEndTime = ts;
          if (payload.processingStatus === "DONE" && payload.reportDocumentId) {
            updated.reportDocumentId = payload.reportDocumentId;
          }
        }
        reports.set(reportId, updated);
        return updated;
      }

      if (op === "cancel") {
        // DELETE /reports/{reportId} — only if IN_QUEUE
        const reportId = payload.reportId;
        const existing = reports.get(reportId);
        if (!existing) return null;
        const ts = new Date().toISOString();
        const updated = {
          ...existing,
          processingStatus: "CANCELLED",
          processingEndTime: ts,
        };
        reports.set(reportId, updated);
        return updated;
      }

      if (op === "seed_direct") {
        // Direct seed load (bypasses state machine — for pre-DONE seeded reports).
        const reportId = payload.reportId;
        if (!reportId) {
          console.warn("[store] report seed_direct missing reportId");
          return payload;
        }
        reports.set(reportId, { ...payload });
        return payload;
      }
      break;
    }

    // -----------------------------------------------------------------------
    // Wave 3b: Reports API v2021-06-30 — Report Documents
    // -----------------------------------------------------------------------
    case "report_document": {
      const docId = payload.reportDocumentId;
      if (!docId) {
        console.warn("[store] report_document mutation missing reportDocumentId");
        return payload;
      }

      if (op === "create") {
        // Created when a report transitions to DONE (routes/reports.js advancePollState).
        const record = {
          reportDocumentId: docId,
          reportType: payload.reportType || null,
          compressionAlgorithm: payload.compressionAlgorithm || "GZIP",
          _content: payload._content || null,
        };
        reportDocuments.set(docId, record);
        return record;
      }

      if (op === "seed_direct") {
        // Direct seed load (for pre-built seeded documents).
        reportDocuments.set(docId, { ...payload });
        return payload;
      }
      break;
    }

    // -----------------------------------------------------------------------
    // Wave 3b: Reports API v2021-06-30 — Report Schedules
    // -----------------------------------------------------------------------
    case "report_schedule": {
      if (op === "create") {
        const schedId = payload.reportScheduleId;
        if (!schedId) {
          console.warn("[store] report_schedule mutation missing reportScheduleId");
          return payload;
        }
        const ts = new Date().toISOString();
        const record = {
          reportScheduleId: schedId,
          reportType: payload.reportType,
          marketplaceIds: payload.marketplaceIds || [],
          reportOptions: payload.reportOptions || null,
          period: payload.period,
          createdTime: ts,
          nextReportCreationTime: payload.nextReportCreationTime || null,
        };
        reportSchedules.set(schedId, record);
        return record;
      }

      if (op === "cancel") {
        const schedId = payload.reportScheduleId;
        if (!schedId) {
          console.warn("[store] report_schedule cancel missing reportScheduleId");
          return payload;
        }
        reportSchedules.delete(schedId);
        return payload;
      }

      if (op === "seed_direct") {
        const schedId = payload.reportScheduleId;
        if (!schedId) return payload;
        reportSchedules.set(schedId, { ...payload });
        return payload;
      }
      break;
    }

    default:
      console.warn(`[store] applyMutation: unknown entityType '${entityType}'`);
  }
  return payload;
}

/**
 * Apply a single JSON Patch-style operation to a listing record.
 * Supports: add, replace, merge, delete (Amazon's extended RFC 6902 subset).
 * Path must start with "/attributes/" for safety in this mock.
 *
 * @param {object} record - existing listing record (will be shallow-cloned internally)
 * @param {{ op: string, path: string, value?: unknown }} patch
 * @returns {object} updated record
 */
function applyJsonPatchOp(record, patch) {
  const { op, path, value } = patch;
  // Parse path — e.g. "/attributes/list_price" or "/attributes/item_name/0/value"
  // We support arbitrary depth within attributes for the mock.
  const parts = path.replace(/^\//, "").split("/");
  if (parts.length === 0) return record;

  let obj = { ...record };

  if (parts[0] === "attributes") {
    // Clone attributes so we don't mutate original
    obj.attributes = { ...(obj.attributes || {}) };
    const attrKey = parts[1];
    if (!attrKey) return obj;

    if (parts.length === 2) {
      // Direct attribute key
      if (op === "delete") {
        delete obj.attributes[attrKey];
      } else {
        // add / replace / merge — store value directly
        obj.attributes[attrKey] = value;
      }
    } else {
      // Deep path within an attribute value (e.g. /attributes/item_name/0/value)
      // Clone the attribute array/object
      const current = Array.isArray(obj.attributes[attrKey])
        ? [...obj.attributes[attrKey]]
        : { ...(obj.attributes[attrKey] || {}) };
      obj.attributes[attrKey] = deepPatchSet(current, parts.slice(2), op, value);
    }
  }
  // Non-attributes paths are ignored in this mock (they'd require full schema knowledge)

  return obj;
}

/**
 * Recursively set/delete a value at a deep path in obj.
 * @param {unknown} obj
 * @param {string[]} pathParts
 * @param {string} op
 * @param {unknown} value
 * @returns {unknown}
 */
function deepPatchSet(obj, pathParts, op, value) {
  if (pathParts.length === 0) {
    return op === "delete" ? undefined : value;
  }
  const [head, ...rest] = pathParts;
  if (Array.isArray(obj)) {
    const idx = parseInt(head, 10);
    if (isNaN(idx)) return obj;
    const clone = [...obj];
    if (op === "delete" && rest.length === 0) {
      clone.splice(idx, 1);
    } else {
      clone[idx] = deepPatchSet(clone[idx], rest, op, value);
    }
    return clone;
  }
  if (obj && typeof obj === "object") {
    const clone = { ...obj };
    if (op === "delete" && rest.length === 0) {
      delete clone[head];
    } else {
      clone[head] = deepPatchSet(clone[head], rest, op, value);
    }
    return clone;
  }
  // Primitive at intermediate path — can't traverse further
  return obj;
}

/**
 * Compute derived state after a mutation.
 * Wave 0: no-op stub. Wave 1+ will recompute inventory summaries, etc.
 */
function computeDerived(entityType, op, entity) {
  return {};
}

/**
 * Publish notification events triggered by a mutation.
 * Wave 0: delegates to notifications.js publish() which is a stub.
 */
function publishNotifications(entityType, op, entity, derived) {
  // Maps entityType to the primary SP-API notification type.
  // Wave 1 listing mutations trigger multiple notification types.
  // Wave 3 will wire real subscribers; for now publish() is a stub that queues events.
  switch (entityType) {
    case "catalog":
      return publish("ITEM_PRODUCT_TYPE_CHANGE", { entityType, op, entity, derived });
    case "listing": {
      // Listing status/issues change on create, replace, patch, delete
      const triggered1 = publish("LISTINGS_ITEM_STATUS_CHANGE", { entityType, op, entity, derived });
      const triggered2 = publish("LISTINGS_ITEM_ISSUES_CHANGE", { entityType, op, entity, derived });
      // Offer change when a listing price mutates
      const triggered3 = publish("ANY_OFFER_CHANGED", { entityType, op, entity, derived });
      return [...triggered1, ...triggered2, ...triggered3];
    }
    case "pricing_offer":
      return publish("ANY_OFFER_CHANGED", { entityType, op, entity, derived });
    case "inventory":
      return publish("FBA_INVENTORY_AVAILABILITY_CHANGES", { entityType, op, entity, derived });
    case "order": {
      // ORDER_STATUS_CHANGE on any status mutation
      const orderEvents = publish("ORDER_STATUS_CHANGE", { entityType, op, entity, derived });
      // Deprecated ORDER_CHANGE retained for compatibility
      const legacyEvents = publish("ORDER_CHANGE", { entityType, op, entity, derived });
      return [...orderEvents, ...legacyEvents];
    }
    case "feed": {
      // FEED_PROCESSING_FINISHED when feed reaches DONE or FATAL
      if (
        entity &&
        (entity.processingStatus === "DONE" || entity.processingStatus === "FATAL")
      ) {
        return publish("FEED_PROCESSING_FINISHED", { entityType, op, entity, derived });
      }
      return [];
    }
    case "feed_document":
      return [];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Central mutation method. All routes MUST go through this for any write.
 *
 * @param {string} entityType - 'marketplace' | 'seller' | 'catalog' | (Wave 1+: 'listing' | 'inventory' | 'order' | 'feed' | 'report')
 * @param {string} op - 'upsert' | 'delete' | 'append' | etc.
 * @param {unknown} payload - the data to apply
 * @param {{ actor?: string, marketplaceId?: string, requestId?: string, timestamp?: string }} [ctx]
 * @returns {{ ok: boolean, entity: unknown, derived: Record<string, unknown>, eventsTriggered: string[] }}
 */
export function mutate(entityType, op, payload, ctx = {}) {
  const ts = ctx.timestamp ?? new Date().toISOString();
  const auditEntry = {
    ts,
    entityType,
    op,
    payload: typeof payload === "object" && payload !== null ? { ...payload } : payload,
    ctx: { ...ctx },
  };
  _auditLog.push(auditEntry);
  // Keep audit log bounded (last 10k entries); oldest entries dropped.
  if (_auditLog.length > 10000) _auditLog.shift();

  const entity = applyMutation(entityType, op, payload, ctx);
  const derived = computeDerived(entityType, op, entity);
  const eventsTriggered = publishNotifications(entityType, op, entity, derived);

  return { ok: true, entity, derived, eventsTriggered };
}

/**
 * Reset all store state. Called by POST /__bench/reset.
 */
export function reset() {
  marketplaces.clear();
  sellers.clear();
  catalog.clear();
  listings.clear();
  pricingOffers.clear();
  // Wave 2
  orders.clear();
  orderItems.clear();
  inventorySummaries.clear();
  feeds.clear();
  feedDocuments.clear();
  // Wave 3a
  financialEventGroups.clear();
  financialEvents.clear();
  // Wave 3b
  reports.clear();
  reportDocuments.clear();
  reportSchedules.clear();
  _auditLog.splice(0, _auditLog.length);
  _virtualTimeOffsetMs = 0;
  resetNotifications();
}

/**
 * Advance virtual time by ms. Wave 0: stub.
 * @param {number} ms
 */
export function advanceTime(ms) {
  _virtualTimeOffsetMs += ms;
}

/** Return current virtual wall-clock time as ISO 8601 string. */
export function virtualNow() {
  return new Date(Date.now() + _virtualTimeOffsetMs).toISOString();
}

/**
 * Return a JSON-serializable snapshot of all store state.
 * Used by GET /__bench/state for verifier scoring.
 */
export function snapshot() {
  return {
    marketplaces: Object.fromEntries(marketplaces),
    sellers: Object.fromEntries(sellers),
    catalog: Object.fromEntries(catalog),
    listings: Object.fromEntries(listings),
    pricingOffers: Object.fromEntries(pricingOffers),
    // Wave 2
    orders: Object.fromEntries(orders),
    orderItems: Object.fromEntries(orderItems),
    inventorySummaries: Object.fromEntries(inventorySummaries),
    feeds: Object.fromEntries(feeds),
    feedDocuments: Object.fromEntries(feedDocuments),
    // Wave 3a
    financialEventGroups: Object.fromEntries(financialEventGroups),
    financialEvents: Object.fromEntries(financialEvents),
    // Wave 3b — _content is large; snapshot includes it (verifier may need it).
    reports: Object.fromEntries(reports),
    reportDocuments: Object.fromEntries(reportDocuments),
    reportSchedules: Object.fromEntries(reportSchedules),
    counts: {
      marketplaces: marketplaces.size,
      sellers: sellers.size,
      catalog: catalog.size,
      listings: listings.size,
      pricingOffers: pricingOffers.size,
      orders: orders.size,
      orderItems: orderItems.size,
      inventorySummaries: inventorySummaries.size,
      feeds: feeds.size,
      feedDocuments: feedDocuments.size,
      financialEventGroups: financialEventGroups.size,
      financialEvents: financialEvents.size,
      reports: reports.size,
      reportDocuments: reportDocuments.size,
      reportSchedules: reportSchedules.size,
    },
    virtualTimeOffsetMs: _virtualTimeOffsetMs,
    auditLogLength: _auditLog.length,
    notifications: snapshotNotifications(),
  };
}

/**
 * Return the raw audit log (optionally filtered).
 *
 * @param {{ entityType?: string, since?: string }} [filter]
 * @returns {unknown[]}
 */
export function auditLog(filter = {}) {
  let entries = _auditLog;
  if (filter.entityType) {
    entries = entries.filter((e) => e.entityType === filter.entityType);
  }
  if (filter.since) {
    const sinceTs = filter.since;
    entries = entries.filter((e) => e.ts >= sinceTs);
  }
  return entries;
}

/**
 * Load and validate a seed JSON object into the store.
 * Resets existing state first, then populates from seed.
 *
 * @param {Record<string, unknown>} seed
 * @throws {ValidationError} on invalid seed structure
 */
export function loadSeed(seed) {
  if (typeof seed !== "object" || seed === null) {
    throw new ValidationError("InvalidInput", "Seed must be a JSON object.", "seed: not an object");
  }

  reset(); // clear everything first

  // Load marketplaces
  if (Array.isArray(seed.marketplaces)) {
    for (const mp of seed.marketplaces) {
      if (!mp.id) throw new ValidationError("InvalidInput", "Seed marketplace missing 'id'.");
      mutate("marketplace", "upsert", mp, { actor: "seed" });
    }
  }

  // Load sellers
  if (Array.isArray(seed.sellers)) {
    for (const seller of seed.sellers) {
      if (!seller.sellerId) throw new ValidationError("InvalidInput", "Seed seller missing 'sellerId'.");
      mutate("seller", "upsert", seller, { actor: "seed" });
    }
  }

  // Load catalog items
  if (Array.isArray(seed.catalog)) {
    for (const item of seed.catalog) {
      if (!item.asin) throw new ValidationError("InvalidInput", "Seed catalog item missing 'asin'.");
      mutate("catalog", "upsert", item, { actor: "seed" });
    }
  }

  // Load Wave 1: listings
  // Seed format: array of { sellerId, marketplaceId, sku, productType, attributes, ... }
  if (Array.isArray(seed.listings)) {
    for (const item of seed.listings) {
      const { sellerId, marketplaceId, sku } = item;
      if (!sellerId || !marketplaceId || !sku) {
        throw new ValidationError(
          "InvalidInput",
          "Seed listing missing sellerId, marketplaceId, or sku."
        );
      }
      const key = `${sellerId}:${marketplaceId}:${sku}`;
      mutate("listing", "create", { ...item, _storeKey: key }, { actor: "seed" });
    }
  }

  // Load Wave 1: pricingOffers
  // Seed format: array of { asin, marketplaceId, offers[], competitivePrices[] }
  if (Array.isArray(seed.pricingOffers)) {
    for (const po of seed.pricingOffers) {
      const { asin, marketplaceId } = po;
      if (!asin || !marketplaceId) {
        throw new ValidationError(
          "InvalidInput",
          "Seed pricingOffer missing asin or marketplaceId."
        );
      }
      const key = `${asin}:${marketplaceId}`;
      mutate("pricing_offer", "upsert", { ...po, _storeKey: key }, { actor: "seed" });
    }
  }

  // Load Wave 2: orders
  // Seed format: array of Order objects with optional _orderItems array
  if (Array.isArray(seed.orders)) {
    for (const order of seed.orders) {
      if (!order.AmazonOrderId) {
        throw new ValidationError("InvalidInput", "Seed order missing 'AmazonOrderId'.");
      }
      mutate("order", "create", order, { actor: "seed" });
    }
  }

  // Load Wave 2: inventorySummaries
  // Seed format: array of { sellerId, marketplaceId, sellerSku, ... }
  if (Array.isArray(seed.inventorySummaries)) {
    for (const inv of seed.inventorySummaries) {
      const { sellerId, marketplaceId, sellerSku } = inv;
      if (!sellerId || !marketplaceId || !sellerSku) {
        throw new ValidationError(
          "InvalidInput",
          "Seed inventorySummary missing sellerId, marketplaceId, or sellerSku."
        );
      }
      const key = `${sellerId}:${marketplaceId}:${sellerSku}`;
      mutate("inventory", "create", { ...inv, _storeKey: key }, { actor: "seed" });
    }
  }

  // Load Wave 2: feeds
  if (Array.isArray(seed.feeds)) {
    for (const feed of seed.feeds) {
      if (!feed.feedId) {
        throw new ValidationError("InvalidInput", "Seed feed missing 'feedId'.");
      }
      // Load directly without going through 'submit' (no async state-machine)
      feeds.set(feed.feedId, { ...feed });
    }
  }

  // Load Wave 2: feedDocuments
  if (Array.isArray(seed.feedDocuments)) {
    for (const doc of seed.feedDocuments) {
      if (!doc.feedDocumentId) {
        throw new ValidationError("InvalidInput", "Seed feedDocument missing 'feedDocumentId'.");
      }
      feedDocuments.set(doc.feedDocumentId, { ...doc });
    }
  }

  // Load Wave 3: financialEventGroups
  if (Array.isArray(seed.financialEventGroups)) {
    for (const group of seed.financialEventGroups) {
      if (!group.FinancialEventGroupId) {
        throw new ValidationError(
          "InvalidInput",
          "Seed financialEventGroup missing 'FinancialEventGroupId'."
        );
      }
      mutate("financial_event_group", "upsert", group, { actor: "seed" });
    }
  }

  // Load Wave 3a: financialEvents (per-bundle records)
  if (Array.isArray(seed.financialEvents)) {
    for (const evt of seed.financialEvents) {
      if (!evt._eventId) {
        throw new ValidationError(
          "InvalidInput",
          "Seed financialEvent missing '_eventId'."
        );
      }
      mutate("financial_event", "upsert", evt, { actor: "seed" });
    }
  }

  // Load Wave 3b: reports
  // Seed format: array of report objects (direct load — bypasses state machine).
  if (Array.isArray(seed.reports)) {
    for (const report of seed.reports) {
      if (!report.reportId) {
        throw new ValidationError("InvalidInput", "Seed report missing 'reportId'.");
      }
      // Use seed_direct to load pre-built reports without going through 'submit'
      mutate("report", "seed_direct", { ...report, _pollCount: report._pollCount ?? 0 }, { actor: "seed" });
    }
  }

  // Load Wave 3b: reportDocuments
  if (Array.isArray(seed.reportDocuments)) {
    for (const doc of seed.reportDocuments) {
      if (!doc.reportDocumentId) {
        throw new ValidationError("InvalidInput", "Seed reportDocument missing 'reportDocumentId'.");
      }
      mutate("report_document", "seed_direct", { ...doc }, { actor: "seed" });
    }
  }

  // Load Wave 3b: reportSchedules
  if (Array.isArray(seed.reportSchedules)) {
    for (const sched of seed.reportSchedules) {
      if (!sched.reportScheduleId) {
        throw new ValidationError("InvalidInput", "Seed reportSchedule missing 'reportScheduleId'.");
      }
      mutate("report_schedule", "seed_direct", { ...sched }, { actor: "seed" });
    }
  }

  console.log(
    `[store] loadSeed complete: ${marketplaces.size} marketplaces, ${sellers.size} sellers, ` +
    `${catalog.size} catalog items, ${listings.size} listings, ${pricingOffers.size} pricing offers, ` +
    `${orders.size} orders, ${inventorySummaries.size} inventory summaries, ` +
    `${feeds.size} feeds, ${feedDocuments.size} feed documents, ` +
    `${financialEventGroups.size} financial event groups, ${financialEvents.size} financial event bundles, ` +
    `${reports.size} reports, ${reportDocuments.size} report documents, ${reportSchedules.size} report schedules`
  );
}

// ---------------------------------------------------------------------------
// Read accessors (used by route handlers — read-only views of Maps)
// ---------------------------------------------------------------------------

/** Return all marketplace entries as an array. */
export function getMarketplaces() {
  return [...marketplaces.values()];
}

/** Return marketplace by ID, or undefined. */
export function getMarketplace(id) {
  return marketplaces.get(id);
}

/** Return all sellers as array. */
export function getSellers() {
  return [...sellers.values()];
}

/** Return seller by ID, or undefined. */
export function getSeller(id) {
  return sellers.get(id);
}

/** Return all catalog items as array. */
export function getCatalogItems() {
  return [...catalog.values()];
}

/** Return a single catalog item by ASIN, or undefined. */
export function getCatalogItemByAsin(asin) {
  return catalog.get(asin);
}

/**
 * Query catalog items with optional filters.
 * Filters operate on the fact-sheet-aligned summaries array.
 *
 * @param {{ keywords?: string[], marketplaceId?: string, identifiers?: string[], identifiersType?: string, brandNames?: string[], classificationIds?: string[] }} filters
 * @returns {object[]}
 */
export function queryCatalog(filters = {}) {
  let items = [...catalog.values()];

  // Filter by marketplaceId (Catalog Items max 1 marketplace ID per request)
  if (filters.marketplaceId) {
    const mid = filters.marketplaceId;
    items = items.filter(
      (item) =>
        Array.isArray(item.summaries) &&
        item.summaries.some((s) => s.marketplaceId === mid)
    );
  }

  // Filter by keyword search against itemName + brand + asin
  if (filters.keywords && filters.keywords.length > 0) {
    const kws = filters.keywords.map((k) => k.toLowerCase());
    items = items.filter((item) => {
      const summaries = Array.isArray(item.summaries) ? item.summaries : [];
      return kws.some((kw) =>
        (item.asin || "").toLowerCase().includes(kw) ||
        summaries.some(
          (s) =>
            (s.itemName || "").toLowerCase().includes(kw) ||
            (s.brand || "").toLowerCase().includes(kw)
        )
      );
    });
  }

  // Filter by identifiers (ASIN, EAN, UPC, etc.)
  if (filters.identifiers && filters.identifiers.length > 0) {
    const ids = new Set(filters.identifiers.map((i) => i.toUpperCase()));
    const idType = (filters.identifiersType || "ASIN").toUpperCase();
    items = items.filter((item) => {
      if (idType === "ASIN") return ids.has(item.asin.toUpperCase());
      // For other identifier types, check item.identifiers array
      if (!Array.isArray(item.identifiers)) return false;
      return item.identifiers.some(
        (byMkt) =>
          Array.isArray(byMkt.identifiers) &&
          byMkt.identifiers.some(
            (ident) =>
              ident.identifierType === idType && ids.has((ident.identifier || "").toUpperCase())
          )
      );
    });
  }

  // Filter by brandNames
  if (filters.brandNames && filters.brandNames.length > 0) {
    const brands = new Set(filters.brandNames.map((b) => b.toLowerCase()));
    items = items.filter(
      (item) =>
        Array.isArray(item.summaries) &&
        item.summaries.some((s) => brands.has((s.brand || "").toLowerCase()))
    );
  }

  // Filter by classificationIds
  if (filters.classificationIds && filters.classificationIds.length > 0) {
    const classIds = new Set(filters.classificationIds);
    items = items.filter(
      (item) =>
        Array.isArray(item.summaries) &&
        item.summaries.some(
          (s) =>
            s.browseClassification &&
            classIds.has(s.browseClassification.classificationId)
        )
    );
  }

  return items;
}

/**
 * Entity count summary for health endpoint.
 * @returns {Record<string, number>}
 */
export function entityCounts() {
  return {
    marketplaces: marketplaces.size,
    sellers: sellers.size,
    catalog: catalog.size,
    listings: listings.size,
    pricingOffers: pricingOffers.size,
    orders: orders.size,
    inventorySummaries: inventorySummaries.size,
    feeds: feeds.size,
    feedDocuments: feedDocuments.size,
    // Wave 3a
    financialEventGroups: financialEventGroups.size,
    financialEvents: financialEvents.size,
    // Wave 3b
    reports: reports.size,
    reportDocuments: reportDocuments.size,
    reportSchedules: reportSchedules.size,
  };
}

// ---------------------------------------------------------------------------
// Wave 1 read accessors — Listings
// ---------------------------------------------------------------------------

/**
 * Build the composite store key for a listing.
 * @param {string} sellerId
 * @param {string} marketplaceId
 * @param {string} sku
 * @returns {string}
 */
export function listingKey(sellerId, marketplaceId, sku) {
  return `${sellerId}:${marketplaceId}:${sku}`;
}

/**
 * Get a single listing by composite key.
 * @param {string} key
 * @returns {object|undefined}
 */
export function getListing(key) {
  return listings.get(key);
}

/**
 * Get a listing by (sellerId, marketplaceId, sku).
 * @param {string} sellerId
 * @param {string} marketplaceId
 * @param {string} sku
 * @returns {object|undefined}
 */
export function getListingBySMK(sellerId, marketplaceId, sku) {
  return listings.get(listingKey(sellerId, marketplaceId, sku));
}

/**
 * Query listings for a seller, optionally filtering by marketplace.
 * @param {string} sellerId
 * @param {{ marketplaceIds?: string[], identifiers?: string[], createdAfter?: string, createdBefore?: string, lastUpdatedAfter?: string, lastUpdatedBefore?: string, withIssueSeverity?: string[] }} filters
 * @returns {object[]}
 */
export function queryListings(sellerId, filters = {}) {
  let items = [];
  // Collect all listings for this seller (prefix match on key)
  for (const [key, item] of listings.entries()) {
    if (!key.startsWith(sellerId + ":")) continue;
    items.push(item);
  }

  // Filter by marketplaceId
  if (filters.marketplaceIds && filters.marketplaceIds.length > 0) {
    const mids = new Set(filters.marketplaceIds);
    items = items.filter((item) => mids.has(item.marketplaceId));
  }

  // Filter by date ranges
  if (filters.createdAfter) {
    items = items.filter((item) => (item._createdDate || "") >= filters.createdAfter);
  }
  if (filters.createdBefore) {
    items = items.filter((item) => (item._createdDate || "") <= filters.createdBefore);
  }
  if (filters.lastUpdatedAfter) {
    items = items.filter((item) => (item._lastUpdatedDate || "") >= filters.lastUpdatedAfter);
  }
  if (filters.lastUpdatedBefore) {
    items = items.filter((item) => (item._lastUpdatedDate || "") <= filters.lastUpdatedBefore);
  }

  // Filter by withIssueSeverity
  if (filters.withIssueSeverity && filters.withIssueSeverity.length > 0) {
    const severities = new Set(filters.withIssueSeverity);
    items = items.filter(
      (item) =>
        Array.isArray(item.issues) &&
        item.issues.some((issue) => severities.has(issue.severity))
    );
  }

  return items;
}

// ---------------------------------------------------------------------------
// Wave 1 read accessors — Pricing Offers
// ---------------------------------------------------------------------------

/**
 * Build the composite store key for pricing offers.
 * @param {string} asin
 * @param {string} marketplaceId
 * @returns {string}
 */
export function pricingOfferKey(asin, marketplaceId) {
  return `${asin}:${marketplaceId}`;
}

/**
 * Get pricing offer data by ASIN + marketplace.
 * @param {string} asin
 * @param {string} marketplaceId
 * @returns {object|undefined}
 */
export function getPricingOffer(asin, marketplaceId) {
  return pricingOffers.get(pricingOfferKey(asin, marketplaceId));
}

/**
 * Get all pricing offers as an array.
 * @returns {object[]}
 */
export function getAllPricingOffers() {
  return [...pricingOffers.values()];
}

/**
 * Find pricing offer by SellerSKU + marketplace.
 * Scans listings to find the ASIN associated with a seller's SKU, then looks up offers.
 * @param {string} sellerId
 * @param {string} sellerSKU
 * @param {string} marketplaceId
 * @returns {object|undefined}
 */
export function getPricingOfferBySKU(sellerId, sellerSKU, marketplaceId) {
  // Find the listing to get its ASIN
  const key = listingKey(sellerId, marketplaceId, sellerSKU);
  const listing = listings.get(key);
  if (!listing || !listing.asin) return undefined;
  return getPricingOffer(listing.asin, marketplaceId);
}

// ---------------------------------------------------------------------------
// Wave 2 read accessors — Orders v0
// ---------------------------------------------------------------------------

/**
 * Get an order by AmazonOrderId.
 * @param {string} orderId
 * @returns {object|undefined}
 */
export function getOrder(orderId) {
  return orders.get(orderId);
}

/**
 * Get all orders as an array.
 * @returns {object[]}
 */
export function getAllOrders() {
  return [...orders.values()];
}

/**
 * Get order items for a given AmazonOrderId.
 * @param {string} orderId
 * @returns {object[]|undefined}
 */
export function getOrderItems(orderId) {
  return orderItems.get(orderId);
}

/**
 * Query orders with optional filters.
 * All date comparisons are string-lexicographic (ISO 8601 strings sort correctly).
 *
 * @param {{
 *   MarketplaceIds?: string[],
 *   CreatedAfter?: string,
 *   CreatedBefore?: string,
 *   LastUpdatedAfter?: string,
 *   LastUpdatedBefore?: string,
 *   OrderStatuses?: string[],
 *   FulfillmentChannels?: string[],
 *   PaymentMethods?: string[],
 *   BuyerEmail?: string,
 *   SellerOrderId?: string,
 *   AmazonOrderIds?: string[],
 * }} filters
 * @returns {object[]}
 */
export function queryOrders(filters = {}) {
  let result = [...orders.values()];

  // MarketplaceIds filter
  if (filters.MarketplaceIds && filters.MarketplaceIds.length > 0) {
    const mids = new Set(filters.MarketplaceIds);
    result = result.filter((o) => mids.has(o.MarketplaceId));
  }

  // CreatedAfter / CreatedBefore
  if (filters.CreatedAfter) {
    result = result.filter((o) => (o.PurchaseDate || "") >= filters.CreatedAfter);
  }
  if (filters.CreatedBefore) {
    result = result.filter((o) => (o.PurchaseDate || "") <= filters.CreatedBefore);
  }

  // LastUpdatedAfter / LastUpdatedBefore
  if (filters.LastUpdatedAfter) {
    result = result.filter((o) => (o.LastUpdateDate || "") >= filters.LastUpdatedAfter);
  }
  if (filters.LastUpdatedBefore) {
    result = result.filter((o) => (o.LastUpdateDate || "") <= filters.LastUpdatedBefore);
  }

  // OrderStatuses
  if (filters.OrderStatuses && filters.OrderStatuses.length > 0) {
    const statuses = new Set(filters.OrderStatuses);
    result = result.filter((o) => statuses.has(o.OrderStatus));
  }

  // FulfillmentChannels
  if (filters.FulfillmentChannels && filters.FulfillmentChannels.length > 0) {
    const channels = new Set(filters.FulfillmentChannels);
    result = result.filter((o) => channels.has(o.FulfillmentChannel));
  }

  // PaymentMethods
  if (filters.PaymentMethods && filters.PaymentMethods.length > 0) {
    const methods = new Set(filters.PaymentMethods);
    result = result.filter((o) => methods.has(o.PaymentMethod));
  }

  // BuyerEmail
  if (filters.BuyerEmail) {
    const email = filters.BuyerEmail.toLowerCase();
    result = result.filter(
      (o) =>
        o.BuyerInfo &&
        o.BuyerInfo.BuyerEmail &&
        o.BuyerInfo.BuyerEmail.toLowerCase() === email
    );
  }

  // SellerOrderId
  if (filters.SellerOrderId) {
    result = result.filter((o) => o.SellerOrderId === filters.SellerOrderId);
  }

  // AmazonOrderIds — direct ID list lookup
  if (filters.AmazonOrderIds && filters.AmazonOrderIds.length > 0) {
    const ids = new Set(filters.AmazonOrderIds);
    result = result.filter((o) => ids.has(o.AmazonOrderId));
  }

  // Sort by PurchaseDate descending (most recent first)
  result.sort((a, b) => {
    const ta = a.PurchaseDate || "";
    const tb = b.PurchaseDate || "";
    return tb.localeCompare(ta);
  });

  return result;
}

// ---------------------------------------------------------------------------
// Wave 2 read accessors — FBA Inventory v1
// ---------------------------------------------------------------------------

/**
 * Build the composite store key for an inventory summary.
 * @param {string} sellerId
 * @param {string} marketplaceId
 * @param {string} sku
 * @returns {string}
 */
export function inventorySummaryKey(sellerId, marketplaceId, sku) {
  return `${sellerId}:${marketplaceId}:${sku}`;
}

/**
 * Get an inventory summary by composite key.
 * @param {string} key
 * @returns {object|undefined}
 */
export function getInventorySummary(key) {
  return inventorySummaries.get(key);
}

/**
 * Query inventory summaries for a seller + marketplace with optional SKU filters.
 *
 * @param {string} sellerId
 * @param {string} marketplaceId
 * @param {{
 *   sellerSkus?: string[],
 *   startDateTime?: string,
 * }} filters
 * @returns {object[]}
 */
export function queryInventorySummaries(sellerId, marketplaceId, filters = {}) {
  const prefix = `${sellerId}:${marketplaceId}:`;
  let result = [];

  for (const [key, inv] of inventorySummaries.entries()) {
    if (!key.startsWith(prefix)) continue;
    result.push(inv);
  }

  // Filter by sellerSkus list
  if (filters.sellerSkus && filters.sellerSkus.length > 0) {
    const skuSet = new Set(filters.sellerSkus.map((s) => s.toLowerCase()));
    result = result.filter((inv) => skuSet.has((inv.sellerSku || "").toLowerCase()));
  }

  // Filter by startDateTime — only items updated at/after this time
  if (filters.startDateTime) {
    result = result.filter((inv) => (inv.lastUpdatedTime || "") >= filters.startDateTime);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Wave 2 read accessors — Feeds v2021-06-30
// ---------------------------------------------------------------------------

/**
 * Get a feed by feedId.
 * @param {string} feedId
 * @returns {object|undefined}
 */
export function getFeed(feedId) {
  return feeds.get(feedId);
}

/**
 * Get all feeds as an array.
 * @returns {object[]}
 */
export function getAllFeeds() {
  return [...feeds.values()];
}

/**
 * Query feeds with optional filters.
 *
 * @param {{
 *   feedTypes?: string[],
 *   marketplaceIds?: string[],
 *   processingStatuses?: string[],
 *   createdSince?: string,
 *   createdUntil?: string,
 * }} filters
 * @returns {object[]}
 */
export function queryFeeds(filters = {}) {
  let result = [...feeds.values()];

  if (filters.feedTypes && filters.feedTypes.length > 0) {
    const types = new Set(filters.feedTypes);
    result = result.filter((f) => types.has(f.feedType));
  }

  if (filters.marketplaceIds && filters.marketplaceIds.length > 0) {
    const mids = new Set(filters.marketplaceIds);
    result = result.filter(
      (f) =>
        Array.isArray(f.marketplaceIds) &&
        f.marketplaceIds.some((mid) => mids.has(mid))
    );
  }

  if (filters.processingStatuses && filters.processingStatuses.length > 0) {
    const statuses = new Set(filters.processingStatuses);
    result = result.filter((f) => statuses.has(f.processingStatus));
  }

  if (filters.createdSince) {
    result = result.filter((f) => (f.createdTime || "") >= filters.createdSince);
  }

  if (filters.createdUntil) {
    result = result.filter((f) => (f.createdTime || "") <= filters.createdUntil);
  }

  // Sort newest first
  result.sort((a, b) => {
    const ta = a.createdTime || "";
    const tb = b.createdTime || "";
    return tb.localeCompare(ta);
  });

  return result;
}

/**
 * Get a feed document by feedDocumentId.
 * @param {string} docId
 * @returns {object|undefined}
 */
export function getFeedDocument(docId) {
  return feedDocuments.get(docId);
}

// ---------------------------------------------------------------------------
// Wave 3 read accessors — Finances API v0
// ---------------------------------------------------------------------------

/**
 * Get all financial event groups as an array.
 * @returns {object[]}
 */
export function getAllFinancialEventGroups() {
  return [...financialEventGroups.values()];
}

/**
 * Get a financial event group by its ID.
 * @param {string} groupId
 * @returns {object|undefined}
 */
export function getFinancialEventGroup(groupId) {
  return financialEventGroups.get(groupId);
}

/**
 * Get all financial event bundle records as an array.
 * @returns {object[]}
 */
export function getAllFinancialEvents() {
  return [...financialEvents.values()];
}

/**
 * Query financial event bundles with optional date-range filters.
 * Merges all matching bundles into a single FinancialEvents composite:
 *   { ShipmentEventList, RefundEventList, ServiceFeeEventList, AdjustmentEventList }
 *
 * @param {{ postedAfter?: Date|null, postedBefore?: Date|null }} filters
 * @returns {{ ShipmentEventList: object[], RefundEventList: object[], ServiceFeeEventList: object[], AdjustmentEventList: object[] }}
 */
export function queryFinancialEvents(filters = {}) {
  let bundles = [...financialEvents.values()];

  // Filter by PostedAfter / PostedBefore (string-lexicographic ISO 8601 comparison)
  if (filters.postedAfter) {
    const after = filters.postedAfter.toISOString();
    bundles = bundles.filter((b) => (b._postedDate || "") >= after);
  }
  if (filters.postedBefore) {
    const before = filters.postedBefore.toISOString();
    bundles = bundles.filter((b) => (b._postedDate || "") <= before);
  }

  // Merge all matching bundles into a single composite event-lists object
  const result = {
    ShipmentEventList: [],
    RefundEventList: [],
    ServiceFeeEventList: [],
    AdjustmentEventList: [],
  };

  for (const b of bundles) {
    if (Array.isArray(b.ShipmentEventList))   result.ShipmentEventList.push(...b.ShipmentEventList);
    if (Array.isArray(b.RefundEventList))     result.RefundEventList.push(...b.RefundEventList);
    if (Array.isArray(b.ServiceFeeEventList)) result.ServiceFeeEventList.push(...b.ServiceFeeEventList);
    if (Array.isArray(b.AdjustmentEventList)) result.AdjustmentEventList.push(...b.AdjustmentEventList);
  }

  return result;
}

/**
 * Get the aggregated financial events for a specific event group.
 * Returns the merged event-lists object, or null if groupId not found.
 *
 * @param {string} groupId
 * @returns {{ ShipmentEventList: object[], RefundEventList: object[], ServiceFeeEventList: object[], AdjustmentEventList: object[] } | null}
 */
export function getFinancialEventsByGroupId(groupId) {
  const group = financialEventGroups.get(groupId);
  if (!group) return null;

  // Collect all financial event bundles tagged to this groupId
  const bundles = [...financialEvents.values()].filter((b) => b._groupId === groupId);

  const result = {
    ShipmentEventList: [],
    RefundEventList: [],
    ServiceFeeEventList: [],
    AdjustmentEventList: [],
  };

  for (const b of bundles) {
    if (Array.isArray(b.ShipmentEventList))   result.ShipmentEventList.push(...b.ShipmentEventList);
    if (Array.isArray(b.RefundEventList))     result.RefundEventList.push(...b.RefundEventList);
    if (Array.isArray(b.ServiceFeeEventList)) result.ServiceFeeEventList.push(...b.ServiceFeeEventList);
    if (Array.isArray(b.AdjustmentEventList)) result.AdjustmentEventList.push(...b.AdjustmentEventList);
  }

  return result;
}

/**
 * Get the aggregated financial events for a specific Amazon Order ID.
 * Returns the merged event-lists object, or null if no events found for orderId.
 *
 * @param {string} orderId
 * @returns {{ ShipmentEventList: object[], RefundEventList: object[], ServiceFeeEventList: object[], AdjustmentEventList: object[] } | null}
 */
export function getFinancialEventsByOrderId(orderId) {
  const bundles = [...financialEvents.values()].filter((b) => b._orderId === orderId);
  if (bundles.length === 0) return null;

  const result = {
    ShipmentEventList: [],
    RefundEventList: [],
    ServiceFeeEventList: [],
    AdjustmentEventList: [],
  };

  for (const b of bundles) {
    if (Array.isArray(b.ShipmentEventList))   result.ShipmentEventList.push(...b.ShipmentEventList);
    if (Array.isArray(b.RefundEventList))     result.RefundEventList.push(...b.RefundEventList);
    if (Array.isArray(b.ServiceFeeEventList)) result.ServiceFeeEventList.push(...b.ServiceFeeEventList);
    if (Array.isArray(b.AdjustmentEventList)) result.AdjustmentEventList.push(...b.AdjustmentEventList);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Wave 3b read accessors — Reports API v2021-06-30
// ---------------------------------------------------------------------------

/**
 * Get a report by reportId.
 * @param {string} reportId
 * @returns {object|undefined}
 */
export function getReport(reportId) {
  return reports.get(reportId);
}

/**
 * Get all reports as an array.
 * @returns {object[]}
 */
export function getAllReports() {
  return [...reports.values()];
}

/**
 * Query reports with optional filters.
 *
 * @param {{
 *   reportTypes?: string[],
 *   marketplaceIds?: string[],
 *   processingStatuses?: string[],
 *   createdSince?: string,
 *   createdUntil?: string,
 * }} filters
 * @returns {object[]}
 */
export function queryReports(filters = {}) {
  let result = [...reports.values()];

  if (filters.reportTypes && filters.reportTypes.length > 0) {
    const types = new Set(filters.reportTypes);
    result = result.filter((r) => types.has(r.reportType));
  }

  if (filters.marketplaceIds && filters.marketplaceIds.length > 0) {
    const mids = new Set(filters.marketplaceIds);
    result = result.filter(
      (r) =>
        Array.isArray(r.marketplaceIds) &&
        r.marketplaceIds.some((mid) => mids.has(mid))
    );
  }

  if (filters.processingStatuses && filters.processingStatuses.length > 0) {
    const statuses = new Set(filters.processingStatuses);
    result = result.filter((r) => statuses.has(r.processingStatus));
  }

  if (filters.createdSince) {
    result = result.filter((r) => (r.createdTime || "") >= filters.createdSince);
  }

  if (filters.createdUntil) {
    result = result.filter((r) => (r.createdTime || "") <= filters.createdUntil);
  }

  // Sort newest first
  result.sort((a, b) => {
    const ta = a.createdTime || "";
    const tb = b.createdTime || "";
    return tb.localeCompare(ta);
  });

  return result;
}

/**
 * Get a report document by reportDocumentId.
 * @param {string} reportDocumentId
 * @returns {object|undefined}
 */
export function getReportDocument(reportDocumentId) {
  return reportDocuments.get(reportDocumentId);
}

/**
 * Get a report schedule by reportScheduleId.
 * @param {string} reportScheduleId
 * @returns {object|undefined}
 */
export function getReportSchedule(reportScheduleId) {
  return reportSchedules.get(reportScheduleId);
}

/**
 * Get all report schedules as an array.
 * @returns {object[]}
 */
export function getAllReportSchedules() {
  return [...reportSchedules.values()];
}
