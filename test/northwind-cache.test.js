'use strict';

/**
 * Unit tests for the Northwind master-data cache (MD-05, Should).
 */

describe('northwind-cache', () => {
  function freshCache(ttlMs) {
    jest.resetModules();
    process.env.NORTHWIND_CACHE_TTL_MS = String(ttlMs);
    return require('../srv/lib/northwind-cache');
  }

  afterEach(() => {
    delete process.env.NORTHWIND_CACHE_TTL_MS;
  });

  test('caches the result of the first call and reuses it for an identical (entity, query)', async () => {
    const cache = freshCache(30000);
    const fetchFn = jest.fn().mockResolvedValue(['row1']);

    const r1 = await cache.cached('Products', { SELECT: { from: 'Products' } }, fetchFn);
    const r2 = await cache.cached('Products', { SELECT: { from: 'Products' } }, fetchFn);

    expect(r1).toEqual(['row1']);
    expect(r2).toEqual(['row1']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('different queries for the same entity get independent cache entries', async () => {
    const cache = freshCache(30000);
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(['a'])
      .mockResolvedValueOnce(['b']);

    const r1 = await cache.cached('Products', { SELECT: { from: 'Products', where: ['x'] } }, fetchFn);
    const r2 = await cache.cached('Products', { SELECT: { from: 'Products', where: ['y'] } }, fetchFn);

    expect(r1).toEqual(['a']);
    expect(r2).toEqual(['b']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('different entity names with an identical query shape get independent cache entries', async () => {
    const cache = freshCache(30000);
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(['products'])
      .mockResolvedValueOnce(['customers']);

    const r1 = await cache.cached('Products', { SELECT: {} }, fetchFn);
    const r2 = await cache.cached('Customers', { SELECT: {} }, fetchFn);

    expect(r1).toEqual(['products']);
    expect(r2).toEqual(['customers']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('re-fetches once the TTL has expired', async () => {
    jest.useFakeTimers();
    const cache = freshCache(1000);
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(['fresh'])
      .mockResolvedValueOnce(['refreshed']);

    const r1 = await cache.cached('Products', { SELECT: {} }, fetchFn);
    jest.advanceTimersByTime(1001);
    const r2 = await cache.cached('Products', { SELECT: {} }, fetchFn);

    expect(r1).toEqual(['fresh']);
    expect(r2).toEqual(['refreshed']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  test('TTL=0 disables caching — every call re-fetches', async () => {
    const cache = freshCache(0);
    const fetchFn = jest.fn().mockResolvedValue(['row']);

    await cache.cached('Products', { SELECT: {} }, fetchFn);
    await cache.cached('Products', { SELECT: {} }, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
