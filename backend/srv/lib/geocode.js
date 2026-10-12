'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('geocode');

/**
 * Geocoding via Nominatim (MAP-02), following section 10's "Geocoding"
 * rule: max 1 request/second, a custom User-Agent, results cached in
 * CustomerGeo so each customer is ever geocoded at most once.
 */

const USER_AGENT = process.env.GEOCODE_USER_AGENT || 'NorthwindOrderHub/1.0 (intern assessment project)';
const MIN_INTERVAL_MS = 1100; // Nominatim allows 1/s; pad slightly for clock skew

let lastRequestAt = 0;

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

/** One throttled Nominatim free-text search. @returns {Promise<{latitude,longitude}|null>} */
async function queryNominatim(query) {
  await throttle();

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (err) {
    LOG.error('Nominatim request failed:', err.message);
    return null;
  }
  if (!res.ok) {
    LOG.error(`Nominatim returned ${res.status} for "${query}"`);
    return null;
  }

  const results = await res.json();
  if (!results || !results.length) return null;
  return { latitude: Number(results[0].lat), longitude: Number(results[0].lon) };
}

/**
 * Geocode one address via Nominatim. Rate-limited internally, so callers
 * never need to throttle themselves.
 *
 * Northwind's street-level addresses frequently don't resolve as-is — it's
 * fictional test data overlaid on real-world OSM data, and Nominatim's
 * free-text search wants a fairly exact match (confirmed empirically:
 * "Obere Str. 57, Berlin, 12209, Germany" returns nothing, even though
 * "Berlin, Germany" alone resolves cleanly). So this tries progressively
 * less specific queries — full address, then city+region+postal+country,
 * then city+country, then country alone — and keeps the first hit. Every
 * attempt is itself a real, throttled Nominatim request, so a customer
 * that only resolves at the country level still costs up to 4 seconds of
 * background time, not 1 — acceptable for a one-time background fill.
 *
 * @returns {Promise<{latitude:number, longitude:number}|null>}
 */
async function geocodeAddress({ Address, City, Region, PostalCode, Country }) {
  const candidates = [
    [Address, City, Region, PostalCode, Country],
    [City, Region, PostalCode, Country],
    [City, Country],
    [Country],
  ]
    .map((parts) => parts.filter(Boolean).join(', '))
    .filter((q) => q);
  const queries = [...new Set(candidates)]; // drop duplicate fallback levels

  for (const query of queries) {
    const result = await queryNominatim(query);
    if (result) return result;
  }
  return null;
}

/** Persist one geocode result (or a recorded failure) in its own short-lived transaction. */
function saveResult(customerID, coords) {
  cds.spawn({}, async (tx) => {
    await tx.run(
      INSERT.into('orderhub.CustomerGeo').entries(
        coords
          ? { customerID, latitude: coords.latitude, longitude: coords.longitude, geocodedAt: new Date().toISOString(), failed: false }
          : { customerID, geocodedAt: new Date().toISOString(), failed: true }
      )
    );
  });
}

const scheduledCustomerIDs = new Set();

/**
 * Geocode Northwind customers missing from CustomerGeo, one at a time,
 * respecting Nominatim's rate limit. Detached from the caller (via
 * setImmediate) so a map page load never blocks on however many
 * customers still need geocoding — it returns immediately and the map
 * simply shows more spots on the next refresh. Each result is written in
 * its own short cds.spawn transaction (not one long-lived one spanning
 * the whole throttled loop) so @cap-js/sqlite's single-connection pool
 * isn't monopolized for the run's full, possibly multi-minute duration.
 *
 * @param {object[]} customers — Northwind customer records needing geocoding
 */
function scheduleBackgroundGeocode(customers) {
  const toProcess = customers.filter((c) => !scheduledCustomerIDs.has(c.CustomerID));
  if (!toProcess.length) return;
  toProcess.forEach((c) => scheduledCustomerIDs.add(c.CustomerID));

  setImmediate(async () => {
    for (const customer of toProcess) {
      try {
        const coords = await geocodeAddress(customer);
        saveResult(customer.CustomerID, coords);
      } catch (err) {
        LOG.error(`Background geocode failed for ${customer.CustomerID}:`, err.message);
      } finally {
        scheduledCustomerIDs.delete(customer.CustomerID);
      }
    }
  });
}

module.exports = { geocodeAddress, scheduleBackgroundGeocode };
