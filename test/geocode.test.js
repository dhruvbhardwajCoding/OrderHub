'use strict';

/**
 * Unit tests for the Nominatim geocoding client (MAP-02), against a mocked
 * fetch — section 10's "Geocoding" rule: max 1 request/second, a custom
 * User-Agent, results cached (tested in analytics-service.test.js's
 * getCustomerLocations tests).
 */

describe('geocode', () => {
  let geocode;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    jest.resetModules();
    geocode = require('../srv/lib/geocode');

    global.fetch = jest.fn(async (url, options) => {
      fetchCalls.push({ url: url.toString(), options });
      return {
        ok: true,
        status: 200,
        json: async () => [{ lat: '52.5200', lon: '13.4050' }],
      };
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('geocodeAddress() builds a query from the address parts and sends a custom User-Agent', async () => {
    const result = await geocode.geocodeAddress({
      Address: 'Obere Str. 57', City: 'Berlin', Region: null, PostalCode: '12209', Country: 'Germany',
    });

    expect(result).toEqual({ latitude: 52.52, longitude: 13.405 });
    expect(fetchCalls).toHaveLength(1);

    const url = new URL(fetchCalls[0].url);
    expect(url.hostname).toBe('nominatim.openstreetmap.org');
    expect(url.searchParams.get('q')).toBe('Obere Str. 57, Berlin, 12209, Germany');
    expect(url.searchParams.get('format')).toBe('json');
    expect(fetchCalls[0].options.headers['User-Agent']).toMatch(/.+/); // a real UA, not empty/missing
  });

  test('geocodeAddress() falls back from a full address to city+country when the precise address has no match', async () => {
    // Mirrors what Nominatim actually does with Northwind's fictional street
    // addresses: "Obere Str. 57, Berlin, 12209, Germany" finds nothing, but
    // "Berlin, Germany" resolves cleanly (verified against the real service).
    global.fetch = jest.fn(async (url) => {
      const q = new URL(url.toString()).searchParams.get('q');
      if (q.includes('Obere Str. 57')) return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => [{ lat: '52.52', lon: '13.405' }] };
    });

    const result = await geocode.geocodeAddress({
      Address: 'Obere Str. 57', City: 'Berlin', PostalCode: '12209', Country: 'Germany',
    });

    expect(result).toEqual({ latitude: 52.52, longitude: 13.405 });
    expect(global.fetch.mock.calls.length).toBeGreaterThan(1); // had to fall back at least once
  }, 10000);

  test('geocodeAddress() returns null once every fallback level is exhausted', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
    const result = await geocode.geocodeAddress({
      Address: 'Nowhere St', City: 'Nowhereville', PostalCode: '00000', Country: 'Nowhereland',
    });
    expect(result).toBeNull();
    // 4 fallback levels: full address, city+region+postal+country, city+country, country
    expect(global.fetch).toHaveBeenCalledTimes(4);
  }, 10000);

  test('geocodeAddress() returns null (does not throw) on a network failure', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    await expect(geocode.geocodeAddress({ City: 'Berlin' })).resolves.toBeNull();
  }, 10000);

  test('geocodeAddress() returns null (does not throw) on a non-OK HTTP response', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));
    await expect(geocode.geocodeAddress({ City: 'Berlin' })).resolves.toBeNull();
  }, 10000);

  test('geocodeAddress() returns null for an address with no usable parts, without calling fetch', async () => {
    const result = await geocode.geocodeAddress({});
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('geocodeAddress() throttles to roughly 1 request/second', async () => {
    const start = Date.now();
    await geocode.geocodeAddress({ City: 'Berlin' });
    await geocode.geocodeAddress({ City: 'Munich' });
    const elapsed = Date.now() - start;

    expect(fetchCalls).toHaveLength(2);
    expect(elapsed).toBeGreaterThanOrEqual(1000);
  }, 10000);

  test('scheduleBackgroundGeocode() geocodes each customer and persists results via cds.spawn', async () => {
    const cds = require('@sap/cds');
    const spawnedWork = [];
    const txRun = jest.fn(async () => {});
    Object.defineProperty(cds, 'spawn', {
      configurable: true,
      value: jest.fn((opts, fn) => { spawnedWork.push(fn({ run: txRun })); }),
    });

    geocode.scheduleBackgroundGeocode([
      { CustomerID: 'ALFKI', City: 'Berlin', Country: 'Germany' },
    ]);

    // scheduleBackgroundGeocode defers its loop via setImmediate
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await Promise.all(spawnedWork);

    expect(cds.spawn).toHaveBeenCalled();
    expect(txRun).toHaveBeenCalled();
  }, 10000);
});
