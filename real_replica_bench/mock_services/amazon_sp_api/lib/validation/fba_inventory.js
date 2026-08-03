/**
 * lib/validation/fba_inventory.js
 * Closed-set enum constants for FBA Inventory v1 namespace.
 *
 * Field casing: camelCase (not PascalCase like Orders v0).
 * Server-side validation is mandatory per CLAUDE.md rule #10.
 */

/**
 * granularityType enum — only `Marketplace` is a valid production value.
 * The swagger lists others but Amazon's developer docs note that `Marketplace`
 * is the only supported production value; `Country` and others are sandbox-only.
 */
export const GRANULARITY_TYPES = new Set(["Marketplace"]);

/**
 * condition enum for InventorySummary.condition.
 * PascalCase compound (e.g. NewItem, UsedItem, CollectibleNewItem).
 * Source: fbaInventory.json swagger `InventorySummary.condition` enum.
 */
export const INVENTORY_CONDITIONS = new Set([
  "NewItem",
  "NewWithWarranty",
  "NewOEM",
  "NewOpenBox",
  "UsedLikeNew",
  "UsedVeryGood",
  "UsedGood",
  "UsedAcceptable",
  "UsedPoor",
  "UsedRefurbished",
  "CollectibleLikeNew",
  "CollectibleVeryGood",
  "CollectibleGood",
  "CollectibleAcceptable",
  "CollectiblePoor",
  "RefurbishedWithWarranty",
  "Refurbished",
  "Club",
]);

/**
 * Build the composite inventory store key.
 * @param {string} sellerId
 * @param {string} marketplaceId
 * @param {string} sku
 * @returns {string}
 */
export function inventoryKey(sellerId, marketplaceId, sku) {
  return `${sellerId}:${marketplaceId}:${sku}`;
}
