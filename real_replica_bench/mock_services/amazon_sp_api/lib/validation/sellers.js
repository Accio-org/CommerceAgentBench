/**
 * lib/validation/sellers.js
 * Closed-set constants for the Sellers v1 namespace.
 *
 * Source: sellers.json swagger (verified 2026-05-28) + fact sheet
 * scratch/docs/api_alignment/amazon_spapi.md §Sellers API v1
 */

/**
 * Valid businessType values for the Account schema.
 * Source: sellers.json swagger Account.businessType enum.
 */
export const BUSINESS_TYPES = new Set([
  "CHARITY",
  "CRAFTSMAN",
  "NATURAL_PERSON_COMPANY",
  "PUBLIC_LISTED",
  "PRIVATE_LIMITED",
  "SOLE_PROPRIETORSHIP",
  "STATE_OWNED",
  "INDIVIDUAL",
]);

/**
 * Valid sellingPlan values for the Account schema.
 * Exactly two values per spec.
 */
export const SELLING_PLANS = new Set([
  "PROFESSIONAL",
  "INDIVIDUAL",
]);
