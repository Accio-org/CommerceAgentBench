/**
 * lib/notifications.js
 * Notifications pub/sub framework — Wave 0 stub.
 *
 * Wave 3 will wire real dispatch to subscriptions/destinations.
 * The full SP-API Notifications API v1 covers:
 *   POST /notifications/v1/subscriptions/{notificationType}
 *   GET  /notifications/v1/subscriptions/{notificationType}
 *   GET  /notifications/v1/subscriptions/{notificationType}/{subscriptionId}
 *   DELETE /notifications/v1/subscriptions/{notificationType}/{subscriptionId}
 *   POST /notifications/v1/destinations
 *   GET  /notifications/v1/destinations
 *   GET  /notifications/v1/destinations/{destinationId}
 *   DELETE /notifications/v1/destinations/{destinationId}
 *
 * All are stubbed here; only publish() is called internally by mutate().
 */

/** subscriptionId → { eventType, destinationId, payloadFilter, createdTime } */
const subscriptions = new Map();

/** destinationId → { name, resourceSpecification: {sqs?, eventBridge?}, createdTime } */
const destinations = new Map();

/**
 * Pending delivery queue — destinationId → Array<{ eventType, payload, ts, scheduledAt }>
 * Wave 3: drain this queue on advance() or via background timer.
 */
const pendingByDestination = new Map();

/**
 * Publish an event to all matching subscriptions.
 * Wave 0: stub — returns empty array (no subscriptions exist yet).
 *
 * @param {string} eventType - e.g. "ANY_OFFER_CHANGED", "ITEM_SALES_DATA", etc.
 * @param {Record<string, unknown>} payload
 * @returns {string[]} - list of destinationIds events were queued to
 */
export function publish(eventType, payload) {
  const triggered = [];
  for (const [, sub] of subscriptions) {
    if (sub.eventType !== eventType && sub.eventType !== "ANY") continue;
    const destId = sub.destinationId;
    if (!pendingByDestination.has(destId)) pendingByDestination.set(destId, []);
    pendingByDestination.get(destId).push({
      eventType,
      payload,
      ts: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
    });
    triggered.push(destId);
  }
  return triggered;
}

/**
 * Deliver pending events for a destination since a cursor.
 * Wave 0: stub — returns [].
 */
export function deliver(destId, sinceCursor = null) {
  return [];
}

/**
 * Subscribe to notifications.
 * Wave 0: stub — returns a subscriptionId.
 */
export function subscribe(eventType, destinationId, payloadFilter = null) {
  const subId = `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  subscriptions.set(subId, {
    eventType,
    destinationId,
    payloadFilter,
    createdTime: new Date().toISOString(),
  });
  return subId;
}

/**
 * Unsubscribe.
 * Wave 0: stub.
 */
export function unsubscribe(subscriptionId) {
  return subscriptions.delete(subscriptionId);
}

/**
 * Register a destination.
 * Wave 0: stub.
 */
export function createDestination(name, resourceSpecification) {
  const destId = `dest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  destinations.set(destId, { name, resourceSpecification, createdTime: new Date().toISOString() });
  return { destinationId: destId, name, resourceSpecification };
}

/** List all destinations. */
export function listDestinations() {
  return [...destinations.values()];
}

/** List all subscriptions (optionally by eventType). */
export function listSubscriptions(eventType = null) {
  const all = [...subscriptions.entries()].map(([id, sub]) => ({ subscriptionId: id, ...sub }));
  if (eventType) return all.filter((s) => s.eventType === eventType);
  return all;
}

/** Reset notification state (called by store.reset()). */
export function resetNotifications() {
  subscriptions.clear();
  destinations.clear();
  pendingByDestination.clear();
}

/** Snapshot notification state (called by store.snapshot()). */
export function snapshotNotifications() {
  return {
    subscriptions: Object.fromEntries(subscriptions),
    destinations: Object.fromEntries(destinations),
    pendingQueueSizes: Object.fromEntries(
      [...pendingByDestination.entries()].map(([k, v]) => [k, v.length])
    ),
  };
}
