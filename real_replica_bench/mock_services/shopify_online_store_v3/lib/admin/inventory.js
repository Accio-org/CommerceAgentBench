'use strict';

// Inventory + locations admin domain — items, levels, locations.
// Used by GraphQL ops: locations, inventoryItemUpdate, inventorySetQuantities.
//
// Phase A.5: replicates the ForgeFit log:619-668 3-error cascade for
// inventorySetQuantities so a RRB task can train an agent to recover:
//   #1  ignoreCompareQuantity → unknown-field rejection (the agent must drop it)
//   #2  any quantities[i] missing changeFromQuantity → MISSING_ARGUMENT
//   #3  the inventorySetQuantities field NOT carrying @idempotent(key:"...")
//       → DIRECTIVE_REQUIRED.
// Once the agent satisfies all three, the happy path applies the quantities
// and the idempotency key is cached so a replay returns the same result.

// ---- Module-level idempotency cache (replays return the same result without
// re-applying changes). Cleared on /api/reset via resetIdempotencyCache().
const inventoryIdempotencyCache = new Map();

function resetIdempotencyCache() {
  inventoryIdempotencyCache.clear();
}

function gidTail(value) {
  return String(value || '').split('/').pop();
}

// ---- seed: ensure the default Shop location exists (A.1 already does this;
// this is a safety net for fresh installs or post-reset paths).
function seed(state) {
  state.locations = state.locations || [];
  if (!state.locations.some((l) => l.id === 'shop-location')) {
    state.locations.push({
      id: 'shop-location',
      name: 'Shop location',
      address: { country: 'SG' },
      isPrimary: true,
    });
  }
  state.inventoryItems = state.inventoryItems || [];
  state.inventoryLevels = state.inventoryLevels || [];
}

// ---- listLocations: returns Location nodes for the GraphQL `locations` query.
function listLocations(store) {
  const list = store.saved.locations || [];
  return list.map((loc) => ({
    id: store.gid('Location', loc.id),
    name: loc.name || '',
    address: { country: (loc.address && loc.address.country) || 'SG' },
  }));
}

// ---- Resolve an InventoryItem by either numeric id or gid.
function findInventoryItem(rawId, store) {
  const tail = gidTail(rawId);
  if (!tail) return null;
  const items = store.saved.inventoryItems || [];
  return items.find((x) => x.id === tail || x.id === rawId) || null;
}

function findLocation(rawId, store) {
  const tail = gidTail(rawId);
  if (!tail) return null;
  const locs = store.saved.locations || [];
  return locs.find((x) => x.id === tail || x.id === rawId) || null;
}

// ---- inventoryItemUpdate: flip `tracked` (and/or sku) on an existing item.
function updateInventoryItem(rawId, input, store) {
  const inv = findInventoryItem(rawId, store);
  if (!inv) {
    return {
      inventoryItem: null,
      userErrors: [{
        field: ['id'],
        message: 'Inventory item not found.',
        code: 'NOT_FOUND',
      }],
    };
  }
  const ip = input || {};
  if (ip.tracked !== undefined) inv.tracked = !!ip.tracked;
  if (ip.sku !== undefined) inv.sku = String(ip.sku);
  store.pushEvent('admin_inventory_item_updated_valid', {
    id: inv.id, tracked: inv.tracked, sku: inv.sku,
  });
  return {
    inventoryItem: {
      id: store.gid('InventoryItem', inv.id),
      tracked: !!inv.tracked,
      sku: inv.sku || '',
    },
    userErrors: [],
  };
}

// ---- checkSetQuantitiesPreconditions: the ForgeFit 3-error cascade.
// Returns null on OK, or a fully-formed { inventoryAdjustmentGroup:null, userErrors:[...] }
// on rejection. Order matches the log so the agent sees the same recovery
// sequence: drop ignoreCompareQuantity → add changeFromQuantity → add directive.
function checkSetQuantitiesPreconditions(query, input) {
  const ip = input || {};

  // Error #1 — unknown field on InventorySetQuantitiesInput.
  if (Object.prototype.hasOwnProperty.call(ip, 'ignoreCompareQuantity')) {
    return {
      inventoryAdjustmentGroup: null,
      userErrors: [{
        field: ['input', 'ignoreCompareQuantity'],
        message: 'Variable $input of type InventorySetQuantitiesInput! was provided invalid value for ignoreCompareQuantity (Field is not defined on InventorySetQuantitiesInput)',
        code: 'INVALID',
      }],
    };
  }

  // Error #2 — every quantities[i] must include changeFromQuantity.
  const quantities = Array.isArray(ip.quantities) ? ip.quantities : [];
  for (let i = 0; i < quantities.length; i++) {
    const q = quantities[i] || {};
    if (!Object.prototype.hasOwnProperty.call(q, 'changeFromQuantity')) {
      return {
        inventoryAdjustmentGroup: null,
        userErrors: [{
          field: ['input', 'quantities', String(i), 'changeFromQuantity'],
          message: 'InventoryQuantityInput must include the following argument: changeFromQuantity.',
          code: 'MISSING_ARGUMENT',
        }],
      };
    }
  }

  // Error #3 — the @idempotent directive must appear on the inventorySetQuantities
  // field with a `key:` argument. Real Shopify returns this as a top-level error;
  // we model it as a userError because the dispatcher already encodes happy/sad
  // shape in a single response.
  const directiveRe = /inventorySetQuantities\s*\([^)]*\)\s*@idempotent\s*\(\s*key\s*:\s*"([^"]+)"\s*\)/;
  if (!directiveRe.test(String(query || ''))) {
    return {
      inventoryAdjustmentGroup: null,
      userErrors: [{
        field: null,
        message: 'The @idempotent directive is required for this mutation but was not provided.',
        code: 'DIRECTIVE_REQUIRED',
      }],
    };
  }

  return null;
}

// ---- setInventoryQuantities: happy path + idempotency replay.
// Pre-call wrapper in server.js handles Errors #1/#2/#3; we only see input that
// passed those checks. We still defend against missing items/locations per-entry
// (push to userErrors but don't abort — matches real Shopify partial-success).
function setInventoryQuantities(input, idempotencyKey, store) {
  // Idempotency: replay cached result if same key was seen before.
  if (idempotencyKey && inventoryIdempotencyCache.has(idempotencyKey)) {
    return inventoryIdempotencyCache.get(idempotencyKey);
  }

  const ip = input || {};
  const name = ip.name === 'on_hand' ? 'on_hand' : 'available';
  const reason = ip.reason || 'correction';
  const referenceDocumentUri = ip.referenceDocumentUri || '';
  const quantities = Array.isArray(ip.quantities) ? ip.quantities : [];

  const userErrors = [];
  const changes = [];

  store.saved.inventoryLevels = store.saved.inventoryLevels || [];

  for (let i = 0; i < quantities.length; i++) {
    const q = quantities[i] || {};
    const inv = findInventoryItem(q.inventoryItemId, store);
    const loc = findLocation(q.locationId, store);
    if (!inv) {
      userErrors.push({
        field: ['input', 'quantities', String(i), 'inventoryItemId'],
        message: `Inventory item ${q.inventoryItemId} not found.`,
        code: 'NOT_FOUND',
      });
      continue;
    }
    if (!loc) {
      userErrors.push({
        field: ['input', 'quantities', String(i), 'locationId'],
        message: `Location ${q.locationId} not found.`,
        code: 'NOT_FOUND',
      });
      continue;
    }

    // Find or create the level row.
    let level = store.saved.inventoryLevels.find(
      (l) => l.inventoryItemId === inv.id && l.locationId === loc.id,
    );
    if (!level) {
      level = {
        id: `inv-lvl-${store.numericId('')}`,
        inventoryItemId: inv.id,
        locationId: loc.id,
        available: 0,
        on_hand: 0,
        committed: 0,
        reserved: 0,
      };
      store.appendSharedStateList('inventoryLevels', level);
    }

    const newQty = Number(q.quantity) || 0;
    const priorAvailable = Number(level.available) || 0;
    const priorOnHand = Number(level.on_hand) || 0;

    // Per the log:680-691 pattern, a fresh set from 0 emits BOTH `available`
    // and `on_hand` deltas equal to the new quantity. Keep available and on_hand
    // in lock-step regardless of which `name` the caller picked — matches the
    // log's symmetric +100 +100 pairs.
    level.available = newQty;
    level.on_hand = newQty;

    changes.push({
      name: 'available',
      delta: newQty - priorAvailable,
      quantityAfterChange: level.available,
      item: { id: store.gid('InventoryItem', inv.id) },
      location: { id: store.gid('Location', loc.id) },
    });
    changes.push({
      name: 'on_hand',
      delta: newQty - priorOnHand,
      quantityAfterChange: level.on_hand,
      item: { id: store.gid('InventoryItem', inv.id) },
      location: { id: store.gid('Location', loc.id) },
    });
  }

  // Re-order changes to mirror the log: all `available` first, then all `on_hand`.
  changes.sort((a, b) => (a.name === b.name ? 0 : a.name === 'available' ? -1 : 1));

  const result = {
    inventoryAdjustmentGroup: {
      id: store.gid('InventoryAdjustmentGroup', `iag-${store.numericId('')}`),
      reason,
      referenceDocumentUri,
      changes,
    },
    userErrors,
  };

  store.pushEvent('admin_inventory_set_quantities_valid', {
    name,
    reason,
    referenceDocumentUri,
    count: quantities.length,
    idempotencyKey: idempotencyKey || null,
  });

  if (idempotencyKey) inventoryIdempotencyCache.set(idempotencyKey, result);
  return result;
}

module.exports = {
  seed,
  listLocations,
  updateInventoryItem,
  setInventoryQuantities,
  checkSetQuantitiesPreconditions,
  resetIdempotencyCache,
};
