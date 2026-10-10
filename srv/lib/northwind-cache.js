'use strict';

/**
 * In-memory TTL cache for Northwind master-data reads (MD-05, Should).
 * Keyed by entity name + the exact CQN query, so different $filter/$top/
 * $orderby combinations are cached independently. TTL is configurable per
 * deployment; set to 0 to disable caching entirely.
 *
 * Only used for the plain read-delegation entities (Customers, Products,
 * Categories, Suppliers, Shippers) — order creation's own Northwind lookups
 * (getCustomer/getProducts in northwind.js) deliberately bypass this cache,
 * since stock levels, prices and discontinued flags must stay fresh for
 * validation to mean anything (see DECISIONS.md).
 */

const TTL_MS = Number(process.env.NORTHWIND_CACHE_TTL_MS ?? 30000);

const store = new Map(); // key -> { value, expiresAt }

function keyFor(entityName, query) {
  return `${entityName}:${JSON.stringify(query)}`;
}

/**
 * Return the cached result for (entityName, query) if still fresh,
 * otherwise call fetchFn(), cache its result, and return it.
 */
async function cached(entityName, query, fetchFn) {
  if (TTL_MS <= 0) return fetchFn();

  const key = keyFor(entityName, query);
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await fetchFn();
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/** @private exposed for tests only */
function _clear() {
  store.clear();
}

module.exports = { cached, TTL_MS, _clear };
