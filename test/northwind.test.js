'use strict';

/**
 * Unit tests for the Northwind helper's timeout (MD-04) and error handling.
 */

describe('northwind lib', () => {
  function freshNorthwind(timeoutMs) {
    jest.resetModules();
    if (timeoutMs != null) process.env.NORTHWIND_TIMEOUT_MS = String(timeoutMs);
    return require('../srv/lib/northwind');
  }

  afterEach(() => {
    delete process.env.NORTHWIND_TIMEOUT_MS;
    jest.useRealTimers();
  });

  describe('withTimeout()', () => {
    test('resolves normally when the promise settles before the timeout', async () => {
      const { withTimeout } = freshNorthwind(1000);
      const result = await withTimeout(Promise.resolve('ok'), 'testing');
      expect(result).toBe('ok');
    });

    test('rejects with a 504 NORTHWIND_TIMEOUT error when the promise takes too long', async () => {
      jest.useFakeTimers();
      const { withTimeout } = freshNorthwind(100);
      const neverResolves = new Promise(() => {});

      const pending = withTimeout(neverResolves, 'reading products');
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'NORTHWIND_TIMEOUT',
        status: 504,
        message: expect.stringContaining('reading products'),
      });
      jest.advanceTimersByTime(101);
      await assertion;
    });

    test('propagates the original rejection when the promise fails before the timeout', async () => {
      const { withTimeout } = freshNorthwind(1000);
      await expect(withTimeout(Promise.reject(new Error('boom')), 'x')).rejects.toThrow('boom');
    });
  });

  describe('getCustomer() / getProducts() / getCustomers() / getCategories()', () => {
    function mockSrv(entities, runImpl) {
      return { entities, run: jest.fn(runImpl) };
    }

    test('getCustomer() wraps a failed Northwind call as a 502 NORTHWIND_UNAVAILABLE error', async () => {
      const { getCustomer } = freshNorthwind(1000);
      const srv = mockSrv({ Customers: 'Customers' }, async () => { throw new Error('connection reset'); });

      await expect(getCustomer(srv, 'ALFKI')).rejects.toMatchObject({
        code: 'NORTHWIND_UNAVAILABLE',
        status: 502,
      });
    });

    test('getCustomer() returns null when Northwind finds nothing', async () => {
      const { getCustomer } = freshNorthwind(1000);
      const srv = mockSrv({ Customers: 'Customers' }, async () => undefined);
      await expect(getCustomer(srv, 'ZZZZZ')).resolves.toBeNull();
    });

    test('a timeout surfaces as 504, not 502, through getProducts()', async () => {
      jest.useFakeTimers();
      const { getProducts } = freshNorthwind(100);
      const srv = mockSrv({ Products: 'Products' }, () => new Promise(() => {}));

      const pending = getProducts(srv, [1, 2]);
      const assertion = expect(pending).rejects.toMatchObject({ code: 'NORTHWIND_TIMEOUT', status: 504 });
      jest.advanceTimersByTime(101);
      await assertion;
    });

    test('getProducts()/getCustomers()/getCategories() short-circuit on an empty id list without calling Northwind', async () => {
      const { getProducts, getCustomers, getCategories } = freshNorthwind(1000);
      const srv = mockSrv({ Products: 'Products', Customers: 'Customers', Categories: 'Categories' }, async () => { throw new Error('should not be called'); });

      await expect(getProducts(srv, [])).resolves.toEqual([]);
      await expect(getCustomers(srv, [])).resolves.toEqual([]);
      await expect(getCategories(srv, [])).resolves.toEqual([]);
      expect(srv.run).not.toHaveBeenCalled();
    });

    test('getCustomers() and getCategories() return the rows Northwind provides', async () => {
      const { getCustomers, getCategories } = freshNorthwind(1000);
      const customers = [{ CustomerID: 'ALFKI' }, { CustomerID: 'ANATR' }];
      const categories = [{ CategoryID: 1, CategoryName: 'Beverages' }];

      const custSrv = mockSrv({ Customers: 'Customers' }, async () => customers);
      const catSrv = mockSrv({ Categories: 'Categories' }, async () => categories);

      await expect(getCustomers(custSrv, ['ALFKI', 'ANATR'])).resolves.toEqual(customers);
      await expect(getCategories(catSrv, [1])).resolves.toEqual(categories);
    });
  });
});
