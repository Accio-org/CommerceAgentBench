/**
 * routes/sellers.js
 * Sellers API v1 — namespace /sellers/v1
 *
 * Operations (2 total — the complete set for this namespace):
 *   GET /sellers/v1/marketplaceParticipations  — getMarketplaceParticipations
 *   GET /sellers/v1/account                    — getAccount
 *
 * Spec source: sellers.json swagger + fact sheet
 *   scratch/docs/api_alignment/amazon_spapi.md §Sellers API v1
 *
 * Key alignment facts (enforced here):
 *   1. Both endpoints use { "payload": ..., "errors": [] } wrapper — camelCase fields.
 *   2. getMarketplaceParticipations payload is a BARE ARRAY (not an object).
 *   3. getAccount payload is a single Account object.
 *   4. Account uses "marketplaceParticipationList" (NOT "marketplaceParticipations").
 *   5. MarketplaceParticipation has all three fields: marketplace, participation, storeName.
 *   6. Rate limit for both: 0.016 req/sec.
 *   7. Both endpoints take NO query parameters and NO path parameters.
 */

import { getSellers } from "../lib/store.js";
import { jsonOk, jsonError, wrapPayload } from "../lib/responses.js";
import { BUSINESS_TYPES, SELLING_PLANS } from "../lib/validation/sellers.js";

// Rate limit per fact sheet: 0.016 req/sec (≈ 1 req per 62s), burst 15.
const RATE_LIMIT = 0.016;

// ---------------------------------------------------------------------------
// Namespace descriptor (used by lib/help.js for /api/help auto-gen)
// ---------------------------------------------------------------------------

export const namespace = {
  name: "Sellers",
  version: "v1",
  base: "/sellers/v1",
  casing: "camelCase",
  wrapper: '{"payload": ...}',
};

// ---------------------------------------------------------------------------
// Handler helpers
// ---------------------------------------------------------------------------

/**
 * Build a MarketplaceParticipation entry from store data.
 * Required fields: marketplace, participation, storeName
 *
 * @param {object} mp - marketplace participation entry from seed
 * @returns {object}
 */
function buildMarketplaceParticipation(mp) {
  return {
    marketplace: {
      id: mp.marketplace.id,
      name: mp.marketplace.name,
      countryCode: mp.marketplace.countryCode,
      defaultCurrencyCode: mp.marketplace.defaultCurrencyCode,
      defaultLanguageCode: mp.marketplace.defaultLanguageCode,
      domainName: mp.marketplace.domainName,
    },
    participation: {
      isParticipating: mp.participation.isParticipating,
      hasSuspendedListings: mp.participation.hasSuspendedListings,
    },
    storeName: mp.storeName,
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /sellers/v1/marketplaceParticipations
 * Returns all marketplace participations for the (single-seller) mock account.
 *
 * Response payload: BARE ARRAY of MarketplaceParticipation (not an object).
 */
async function handleGetMarketplaceParticipations(req, _pathParams) {
  const sellers = getSellers();

  if (sellers.length === 0) {
    // No sellers seeded — return empty array (not an error)
    return jsonOk(wrapPayload([]), { rateLimit: RATE_LIMIT });
  }

  // Wave 0: single seller mock — use the first seller's participation list
  const seller = sellers[0];
  const participationList = Array.isArray(seller.marketplaceParticipationList)
    ? seller.marketplaceParticipationList.map(buildMarketplaceParticipation)
    : [];

  // payload is a bare array per fact sheet
  return jsonOk(wrapPayload(participationList), { rateLimit: RATE_LIMIT });
}

/**
 * GET /sellers/v1/account
 * Returns the Account object for the (single-seller) mock account.
 *
 * Response payload: single Account object.
 * Required Account fields: businessType, sellingPlan, marketplaceParticipationList
 * Optional: business, primaryContact
 */
async function handleGetAccount(req, _pathParams) {
  const sellers = getSellers();

  if (sellers.length === 0) {
    return jsonError(404, "ResourceNotFound", "No seller account found.", undefined, RATE_LIMIT);
  }

  const seller = sellers[0];

  // Build Account object — field names match fact sheet exactly
  const account = {
    businessType: seller.businessType,
    sellingPlan: seller.sellingPlan,
    marketplaceParticipationList: Array.isArray(seller.marketplaceParticipationList)
      ? seller.marketplaceParticipationList.map(buildMarketplaceParticipation)
      : [],
  };

  // Optional nested objects — include only if present in seed
  if (seller.business) {
    account.business = seller.business;
  }
  if (seller.primaryContact) {
    account.primaryContact = seller.primaryContact;
  }

  return jsonOk(wrapPayload(account), { rateLimit: RATE_LIMIT });
}

// ---------------------------------------------------------------------------
// Route registry — shape required by server.js and lib/help.js
// ---------------------------------------------------------------------------

export const routes = [
  {
    method: "GET",
    path: "/sellers/v1/marketplaceParticipations",
    handler: handleGetMarketplaceParticipations,
    help: {
      description:
        "Returns a list of marketplaces that the seller submitting the request can sell in, and information about the seller's participation in those marketplaces.",
      params: [],
    },
  },
  {
    method: "GET",
    path: "/sellers/v1/account",
    handler: handleGetAccount,
    help: {
      description:
        "Returns information about the seller account. Includes businessType, sellingPlan, marketplaceParticipationList, and optional business/primaryContact details.",
      params: [],
    },
  },
];
