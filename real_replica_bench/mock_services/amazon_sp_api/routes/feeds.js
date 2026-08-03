/**
 * routes/feeds.js
 * Feeds API v2021-06-30 — namespace /feeds/2021-06-30
 *
 * Operations (6 total — complete set for this namespace):
 *   GET    /feeds/2021-06-30/feeds                    — getFeeds        → 200
 *   POST   /feeds/2021-06-30/feeds                    — createFeed      → 202 (not 200!)
 *   GET    /feeds/2021-06-30/feeds/{feedId}           — getFeed         → 200
 *   DELETE /feeds/2021-06-30/feeds/{feedId}           — cancelFeed      → 200 (empty body)
 *   POST   /feeds/2021-06-30/documents                — createFeedDocument → 201 (not 200!)
 *   GET    /feeds/2021-06-30/documents/{feedDocumentId} — getFeedDocument → 200
 *
 * Spec source: feeds_2021-06-30.json swagger + fact sheet
 *   scratch/docs/api_alignment/amazon_spapi.md §Feeds API v2021-06-30
 *
 * Critical alignment facts enforced here:
 *  1. NO `payload` wrapper — responses are direct Feed/GetFeedsResponse/FeedDocument objects.
 *  2. camelCase throughout (feedId, feedType, processingStatus, feedDocumentId, resultFeedDocumentId).
 *  3. processingStatus enum: exactly 5 values ALL_CAPS (CANCELLED/DONE/FATAL/IN_PROGRESS/IN_QUEUE).
 *  4. createFeed returns 202 Accepted (NOT 200 OK).
 *  5. createFeedDocument returns 201 Created (NOT 200 OK).
 *  6. cancelFeed returns 200 with EMPTY body (no payload object).
 *  7. NO encryptionDetails field (2021-06-30 removed it; only in old 2020-09-04).
 *  8. getFeeds: when nextToken supplied, CANNOT be combined with other filters.
 *  9. cancelFeed: only IN_QUEUE feeds can be cancelled; 400 if not IN_QUEUE.
 * 10. Async state machine: createFeed → IN_QUEUE → (800ms) IN_PROGRESS → (1500ms) DONE.
 * 11. Mock upload URL: http://127.0.0.1:<port>/__bench/feed_documents/<id>/upload
 */

import { randomUUID } from "crypto";
import {
  mutate,
  getFeed,
  getAllFeeds,
  queryFeeds,
  getFeedDocument,
} from "../lib/store.js";
import {
  jsonOk,
  jsonError,
  parseArrayParam,
  parseIntParam,
} from "../lib/responses.js";
import { ValidationError } from "../lib/validation/common.js";
import {
  PROCESSING_STATUSES,
  TERMINAL_STATUSES,
  isValidFeedType,
  generateFeedId,
  generateFeedDocumentId,
} from "../lib/validation/feeds.js";
import { paginate } from "../lib/pagination.js";

// Rate limits per fact sheet
const RL_GET_FEEDS = 0.0222;         // burst 10
const RL_CREATE_FEED = 0.0083;       // burst 15
const RL_GET_FEED = 2;               // burst 15
const RL_CANCEL_FEED = 2;            // burst 15
const RL_CREATE_FEED_DOC = 0.5;      // burst 15
const RL_GET_FEED_DOC = 0.0222;      // burst 10

// Mock async delays (ms) — fast enough for smoke tests, visible enough to test IN_QUEUE/IN_PROGRESS
const DELAY_TO_IN_PROGRESS_MS = 800;
const DELAY_TO_DONE_MS = 1500;

// ---------------------------------------------------------------------------
// Namespace descriptor
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Feeds",
  version: "2021-06-30",
  base: "/feeds/2021-06-30",
  casing: "camelCase",
  wrapper: "none (direct schema object, no payload wrapper)",
};

// ---------------------------------------------------------------------------
// Helper: get mock port from environment
// ---------------------------------------------------------------------------

function getMockPort() {
  return parseInt(process.env.MOCK_PORT ?? process.env.PORT ?? "4000", 10);
}

/**
 * Generate a mock presigned URL for a feed document upload.
 * @param {string} feedDocumentId
 * @returns {string}
 */
function mockUploadUrl(feedDocumentId) {
  return `http://127.0.0.1:${getMockPort()}/__bench/feed_documents/${feedDocumentId}/upload`;
}

/**
 * Generate a mock URL for downloading a feed result document.
 * @param {string} feedDocumentId
 * @returns {string}
 */
function mockDownloadUrl(feedDocumentId) {
  return `http://127.0.0.1:${getMockPort()}/__bench/feed_documents/${feedDocumentId}/download`;
}

// ---------------------------------------------------------------------------
// Helper: project a Feed object to the wire shape (strip internal fields)
// ---------------------------------------------------------------------------

/**
 * Project a stored feed record to the Feed API schema shape.
 * Omits internal _ fields. Only includes resultFeedDocumentId when status=DONE.
 *
 * @param {object} feed
 * @returns {object}
 */
function projectFeed(feed) {
  const out = {
    feedId: feed.feedId,
    feedType: feed.feedType,
    processingStatus: feed.processingStatus,
    createdTime: feed.createdTime,
  };
  if (Array.isArray(feed.marketplaceIds) && feed.marketplaceIds.length > 0) {
    out.marketplaceIds = feed.marketplaceIds;
  }
  if (feed.processingStartTime) out.processingStartTime = feed.processingStartTime;
  if (feed.processingEndTime) out.processingEndTime = feed.processingEndTime;
  // resultFeedDocumentId only present when DONE
  if (feed.processingStatus === "DONE" && feed.resultFeedDocumentId) {
    out.resultFeedDocumentId = feed.resultFeedDocumentId;
  }
  return out;
}

/**
 * Project a feed document to the FeedDocument API schema shape.
 * No encryptionDetails (2021-06-30 removed it).
 *
 * @param {object} doc
 * @returns {object}
 */
function projectFeedDocument(doc) {
  const out = {
    feedDocumentId: doc.feedDocumentId,
    url: doc.url,
  };
  // compressionAlgorithm only present for compressed docs
  if (doc.compressionAlgorithm) {
    out.compressionAlgorithm = doc.compressionAlgorithm;
  }
  // NOTE: NO encryptionDetails — that field is 2020-09-04 only
  return out;
}

// ---------------------------------------------------------------------------
// Async state machine: transition IN_QUEUE → IN_PROGRESS → DONE|FATAL
// ---------------------------------------------------------------------------

/**
 * Schedule async feed processing transitions.
 * Called after createFeed writes the initial IN_QUEUE record.
 *
 * Wave 2: uses real setTimeout. Wave 3 can replace with virtual clock.
 *
 * @param {string} feedId - the feed to transition
 */
function scheduleFeedProcessing(feedId) {
  // Transition 1: IN_QUEUE → IN_PROGRESS
  setTimeout(() => {
    const feed = getFeed(feedId);
    if (!feed || feed.processingStatus !== "IN_QUEUE") return;
    mutate("feed", "transition_state", { feedId, processingStatus: "IN_PROGRESS" });
  }, DELAY_TO_IN_PROGRESS_MS);

  // Transition 2: IN_PROGRESS → DONE (with result document)
  setTimeout(() => {
    const feed = getFeed(feedId);
    if (!feed || feed.processingStatus !== "IN_PROGRESS") return;

    // Create a result document
    const resultDocId = generateFeedDocumentId();
    const resultContent = generateResultDocumentContent(feed.feedType);
    mutate("feed_document", "create_result_doc", {
      feedDocumentId: resultDocId,
      url: mockDownloadUrl(resultDocId),
      _docType: "result",
      _content: resultContent,
    });

    mutate("feed", "transition_state", {
      feedId,
      processingStatus: "DONE",
      resultFeedDocumentId: resultDocId,
    });
  }, DELAY_TO_DONE_MS);
}

/**
 * Generate a minimal feed processing result document body.
 * Real Amazon returns XML for most feed types.
 *
 * @param {string} feedType
 * @returns {string} result document content
 */
function generateResultDocumentContent(feedType) {
  const ts = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">
  <Header>
    <DocumentVersion>1.01</DocumentVersion>
    <MerchantIdentifier>A2BENCH00001</MerchantIdentifier>
  </Header>
  <MessageType>ProcessingReport</MessageType>
  <Message>
    <MessageID>1</MessageID>
    <ProcessingReport>
      <DocumentTransactionID>1001</DocumentTransactionID>
      <StatusCode>Complete</StatusCode>
      <ProcessingSummary>
        <MessagesProcessed>1</MessagesProcessed>
        <MessagesSuccessful>1</MessagesSuccessful>
        <MessagesWithError>0</MessagesWithError>
        <MessagesWithWarning>0</MessagesWithWarning>
      </ProcessingSummary>
      <Result>
        <MessageID>1</MessageID>
        <ResultCode>Success</ResultCode>
        <ResultMessageCode>8541</ResultMessageCode>
        <ResultDescription>Feed processed successfully (${feedType}) at ${ts}.</ResultDescription>
      </Result>
    </ProcessingReport>
  </Message>
</AmazonEnvelope>`;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /feeds/2021-06-30/feeds — getFeeds
 *
 * Returns list of feeds matching filters. When nextToken is supplied,
 * other filter params are IGNORED (real Amazon behavior).
 *
 * Rate limit: 0.0222 req/sec, burst 10.
 */
async function handleGetFeeds(req, _pathParams) {
  const url = new URL(req.url);
  const q = url.searchParams;

  const nextToken = q.get("nextToken") || null;

  // When nextToken is supplied, ignore other filters per spec
  if (nextToken) {
    const allFeeds = getAllFeeds().map(projectFeed);
    const pageSize = parseIntParam(q.get("pageSize"), 10, 1, 100);
    const { items, nextToken: outToken } = paginate(allFeeds, {}, pageSize, nextToken, "nextToken");
    const responseBody = {
      feeds: items,
      ...(outToken ? { nextToken: outToken } : {}),
    };
    return jsonOk(responseBody, { rateLimit: RL_GET_FEEDS });
  }

  // Build filters
  const feedTypes = [];
  for (const v of q.getAll("feedTypes")) {
    for (const part of v.split(",")) {
      if (part.trim()) feedTypes.push(part.trim());
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
        `processingStatuses: must be one of ${[...PROCESSING_STATUSES].join(", ")}`,
        RL_GET_FEEDS
      );
    }
  }

  const createdSince = q.get("createdSince") || null;
  const createdUntil = q.get("createdUntil") || null;
  const pageSize = parseIntParam(q.get("pageSize"), 10, 1, 100);

  const filters = {
    ...(feedTypes.length > 0 ? { feedTypes } : {}),
    ...(marketplaceIds.length > 0 ? { marketplaceIds } : {}),
    ...(processingStatuses.length > 0 ? { processingStatuses } : {}),
    ...(createdSince ? { createdSince } : {}),
    ...(createdUntil ? { createdUntil } : {}),
  };

  const allFiltered = queryFeeds(filters).map(projectFeed);
  const { items, nextToken: outToken } = paginate(allFiltered, filters, pageSize, null, "nextToken");

  const responseBody = {
    feeds: items,
    ...(outToken ? { nextToken: outToken } : {}),
  };

  return jsonOk(responseBody, { rateLimit: RL_GET_FEEDS });
}

/**
 * POST /feeds/2021-06-30/feeds — createFeed
 * Returns 202 Accepted (not 200).
 * Starts async state machine: IN_QUEUE → IN_PROGRESS → DONE.
 *
 * Rate limit: 0.0083 req/sec, burst 15.
 */
async function handleCreateFeed(req, _pathParams) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body must be valid JSON.", undefined, RL_CREATE_FEED);
  }

  // Validate required fields
  if (!body.feedType) {
    return jsonError(
      400,
      "MissingParameter",
      "feedType is required.",
      "feedType: required field missing",
      RL_CREATE_FEED
    );
  }

  if (!isValidFeedType(body.feedType)) {
    return jsonError(
      400,
      "InvalidInput",
      `Invalid feedType: '${body.feedType}'.`,
      "feedType must be a non-empty string",
      RL_CREATE_FEED
    );
  }

  if (!Array.isArray(body.marketplaceIds) || body.marketplaceIds.length === 0) {
    return jsonError(
      400,
      "MissingParameter",
      "marketplaceIds is required and must be a non-empty array.",
      "marketplaceIds: required field missing or empty",
      RL_CREATE_FEED
    );
  }

  if (!body.inputFeedDocumentId) {
    return jsonError(
      400,
      "MissingParameter",
      "inputFeedDocumentId is required.",
      "inputFeedDocumentId: required field missing",
      RL_CREATE_FEED
    );
  }

  const feedId = generateFeedId();

  mutate("feed", "submit", {
    feedId,
    feedType: body.feedType,
    marketplaceIds: body.marketplaceIds,
    inputFeedDocumentId: body.inputFeedDocumentId,
    feedOptions: body.feedOptions || null,
  });

  // Schedule async state transitions
  scheduleFeedProcessing(feedId);

  // 202 Accepted — CreateFeedResponse is just { feedId }
  return jsonOk({ feedId }, { status: 202, rateLimit: RL_CREATE_FEED });
}

/**
 * GET /feeds/2021-06-30/feeds/{feedId} — getFeed
 * Rate limit: 2 req/sec, burst 15.
 */
async function handleGetFeed(_req, { feedId }) {
  const feed = getFeed(feedId);
  if (!feed) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Feed '${feedId}' not found.`,
      undefined,
      RL_GET_FEED
    );
  }
  return jsonOk(projectFeed(feed), { rateLimit: RL_GET_FEED });
}

/**
 * DELETE /feeds/2021-06-30/feeds/{feedId} — cancelFeed
 * Only cancels feeds in IN_QUEUE state. Returns 200 with empty body.
 * Rate limit: 2 req/sec, burst 15.
 */
async function handleCancelFeed(_req, { feedId }) {
  const feed = getFeed(feedId);
  if (!feed) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Feed '${feedId}' not found.`,
      undefined,
      RL_CANCEL_FEED
    );
  }

  if (feed.processingStatus !== "IN_QUEUE") {
    return jsonError(
      400,
      "InvalidInput",
      `Feed '${feedId}' cannot be cancelled because its processingStatus is '${feed.processingStatus}'. Only IN_QUEUE feeds can be cancelled.`,
      "cancelFeed: feed must be in IN_QUEUE state",
      RL_CANCEL_FEED
    );
  }

  mutate("feed", "cancel", { feedId });

  // Empty body per swagger — return empty JSON object
  return jsonOk({}, { rateLimit: RL_CANCEL_FEED });
}

/**
 * POST /feeds/2021-06-30/documents — createFeedDocument
 * Returns 201 Created (not 200, not 202).
 * Rate limit: 0.5 req/sec, burst 15.
 */
async function handleCreateFeedDocument(req, _pathParams) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "InvalidInput", "Request body must be valid JSON.", undefined, RL_CREATE_FEED_DOC);
  }

  // contentType is required
  if (!body.contentType) {
    return jsonError(
      400,
      "MissingParameter",
      "contentType is required.",
      "contentType: required field missing",
      RL_CREATE_FEED_DOC
    );
  }

  const feedDocumentId = generateFeedDocumentId();
  const uploadUrl = mockUploadUrl(feedDocumentId);

  mutate("feed_document", "create_upload_slot", {
    feedDocumentId,
    url: uploadUrl,
    contentType: body.contentType,
  });

  // 201 Created — CreateFeedDocumentResponse: { feedDocumentId, url }
  // NOTE: no encryptionDetails (2021-06-30 removed it)
  return jsonOk(
    { feedDocumentId, url: uploadUrl },
    { status: 201, rateLimit: RL_CREATE_FEED_DOC }
  );
}

/**
 * GET /feeds/2021-06-30/documents/{feedDocumentId} — getFeedDocument
 * Returns FeedDocument (for both upload-slot and result docs).
 * Rate limit: 0.0222 req/sec, burst 10.
 */
async function handleGetFeedDocument(_req, { feedDocumentId }) {
  const doc = getFeedDocument(feedDocumentId);
  if (!doc) {
    return jsonError(
      404,
      "ResourceNotFound",
      `Feed document '${feedDocumentId}' not found.`,
      undefined,
      RL_GET_FEED_DOC
    );
  }
  return jsonOk(projectFeedDocument(doc), { rateLimit: RL_GET_FEED_DOC });
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "GET",
    path: "/feeds/2021-06-30/feeds",
    handler: handleGetFeeds,
    help: {
      description:
        "Returns a list of feeds. When nextToken is supplied, other filters are ignored. Rate: 0.0222 req/sec.",
      params: [
        { name: "feedTypes", in: "query" },
        { name: "marketplaceIds", in: "query" },
        { name: "pageSize", in: "query", description: "1-100, default 10" },
        { name: "processingStatuses", in: "query" },
        { name: "createdSince", in: "query" },
        { name: "createdUntil", in: "query" },
        { name: "nextToken", in: "query" },
      ],
    },
  },
  {
    method: "POST",
    path: "/feeds/2021-06-30/feeds",
    handler: handleCreateFeed,
    help: {
      description:
        "Creates a feed. Returns 202 Accepted with feedId. Starts async IN_QUEUE → IN_PROGRESS → DONE state machine. For JSON_LISTINGS_FEED, upload application/json to the feed document URL before createFeed: {header:{sellerId,version:\"2.0\",issueLocale?},messages:[{messageId,sku,operationType:\"PATCH\",productType,patches:[{op:\"replace\",path:\"/attributes/purchasable_offer\",value:[...]}]}]}. Rate: 0.0083 req/sec.",
      params: [],
    },
  },
  {
    method: "GET",
    path: "/feeds/2021-06-30/feeds/:feedId",
    handler: handleGetFeed,
    help: {
      description: "Returns a feed by feedId. Rate: 2 req/sec.",
      params: [{ name: "feedId", in: "path", required: true }],
    },
  },
  {
    method: "DELETE",
    path: "/feeds/2021-06-30/feeds/:feedId",
    handler: handleCancelFeed,
    help: {
      description:
        "Cancels a feed. Only IN_QUEUE feeds can be cancelled. Returns 200 empty body. Rate: 2 req/sec.",
      params: [{ name: "feedId", in: "path", required: true }],
    },
  },
  {
    method: "POST",
    path: "/feeds/2021-06-30/documents",
    handler: handleCreateFeedDocument,
    help: {
      description:
        "Creates a feed document upload slot. POST body requires contentType, usually application/json for JSON_LISTINGS_FEED. Returns 201 Created with feedDocumentId and url; PUT the feed body to that url. NO encryptionDetails (2021-06-30 removed it). Rate: 0.5 req/sec.",
      params: [],
    },
  },
  {
    method: "GET",
    path: "/feeds/2021-06-30/documents/:feedDocumentId",
    handler: handleGetFeedDocument,
    help: {
      description:
        "Returns a feed document (upload-slot or result doc). Rate: 0.0222 req/sec.",
      params: [{ name: "feedDocumentId", in: "path", required: true }],
    },
  },
];
