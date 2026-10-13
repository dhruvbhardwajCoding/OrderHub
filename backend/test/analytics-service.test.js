'use strict';

/**
 * Integration tests for AnalyticsService (AN-01, AN-02, AN-03). Exercises
 * the real cross-system join: local SalesOrders aggregated and merged with
 * Northwind customer/product/category master data.
 */

process.env.CDS_REQUIRES_AUTH_KIND = 'mocked';

const cds = require('@sap/cds');

const CUSTOMERS = {
  ALFKI: { CustomerID: 'ALFKI', CompanyName: 'Alfreds Futterkiste', ContactName: 'Maria Anders', City: 'Berlin', Country: 'Germany' },
  ANTON: { CustomerID: 'ANTON', CompanyName: 'Antonio Moreno Taquería', ContactName: 'Antonio Moreno', City: 'México D.F.', Country: 'Mexico' },
  BERGS: { CustomerID: 'BERGS', CompanyName: 'Berglunds snabbköp', ContactName: 'Christina Berglund', City: 'Luleå', Country: 'Sweden' },
};

jest.mock('../srv/lib/northwind', () => {
  const products = [
    { ProductID: 1, ProductName: 'Chai', UnitPrice: 18.0, UnitsInStock: 39, Discontinued: false, CategoryID: 1 },
    { ProductID: 3, ProductName: 'Aniseed Syrup', UnitPrice: 10.0, UnitsInStock: 13, Discontinued: false, CategoryID: 2 },
  ];
  const categories = [
    { CategoryID: 1, CategoryName: 'Beverages' },
    { CategoryID: 2, CategoryName: 'Condiments' },
  ];

  return {
    getCustomer: jest.fn(async (srv, id) => global.__CUSTOMERS__[id] || null),
    getCustomers: jest.fn(async (srv, ids) => ids.map((id) => global.__CUSTOMERS__[id]).filter(Boolean)),
    getAllCustomers: jest.fn(async () => Object.values(global.__CUSTOMERS__)),
    getProducts: jest.fn(async (srv, ids) => products.filter((p) => ids.includes(p.ProductID))),
    getCategories: jest.fn(async (srv, ids) => categories.filter((c) => ids.includes(c.CategoryID))),
    withTimeout: jest.fn((promise) => promise),
  };
});
global.__CUSTOMERS__ = CUSTOMERS;

jest.mock('../srv/lib/geocode', () => ({
  scheduleBackgroundGeocode: jest.fn(),
}));
const { scheduleBackgroundGeocode } = require('../srv/lib/geocode');

const ALICE = { auth: { username: 'alice', password: 'alice' } }; // SalesRep

const ORDER_SVC = '/odata/v4/order';
const AN_SVC = '/odata/v4/analytics';

cds.env.requires.auth = {
  kind: 'mocked',
  users: { alice: { password: 'alice', roles: ['SalesRep'] } },
};
const { GET, POST } = cds.test(__dirname + '/..');

// SO-08: SalesOrders' key is now (ID, IsActiveEntity) and POST only creates
// a draft — activate it before submit() so it becomes a real, numbered order.
const orderUrl = (id, active = true) => `${ORDER_SVC}/SalesOrders(ID=${id},IsActiveEntity=${active})`;

async function createConfirmedOrder(customerID, productID, quantity) {
  const { data: draft } = await POST(`${ORDER_SVC}/SalesOrders`, { customerID, items: [{ productID, quantity, discount: 0 }] }, ALICE);
  const { data } = await POST(`${orderUrl(draft.ID, false)}/OrderService.draftActivate`, {}, ALICE);
  await POST(`${orderUrl(data.ID)}/OrderService.submit`, {}, ALICE);
  return data.ID;
}

describe('AnalyticsService', () => {

  test('getKPIs() on an empty database returns all zeros', async () => {
    const { status, data } = await GET(`${AN_SVC}/getKPIs()`, ALICE);
    expect(status).toBe(200);
    expect(data).toMatchObject({ orderCount: 0, revenue: 0, openApprovals: 0, invoicesSent: 0 });
  });

  // SO-08: AnalyticsService reads orderhub.SalesOrders directly — drafts
  // live in a separate shadow table and were never wired into this read —
  // so creating one (never activating it) must not move any KPI number.
  test('a draft (not yet activated) does not affect KPIs', async () => {
    const before = (await GET(`${AN_SVC}/getKPIs()`, ALICE)).data;
    await POST(`${ORDER_SVC}/SalesOrders`, { customerID: 'ALFKI', items: [{ productID: 1, quantity: 1, discount: 0 }] }, ALICE);
    const after = (await GET(`${AN_SVC}/getKPIs()`, ALICE)).data;
    expect(after).toEqual(before);
  });

  describe('with a mix of confirmed, pending and small orders', () => {
    beforeAll(async () => {
      // Small orders auto-approve (<= APPROVAL_THRESHOLD) -> "confirmed" revenue
      await createConfirmedOrder('ALFKI', 1, 1); // Chai, 18 * 1.1 = 19.80
      await createConfirmedOrder('ANTON', 1, 1); // Chai, 19.80
      await createConfirmedOrder('ALFKI', 3, 1); // Aniseed Syrup, 10 * 1.1 = 11.00

      // Large order stays Submitted — must NOT count as confirmed revenue
      const { data: draft } = await POST(`${ORDER_SVC}/SalesOrders`, {
        customerID: 'ALFKI', items: [{ productID: 1, quantity: 300, discount: 0 }],
      }, ALICE);
      const { data } = await POST(`${orderUrl(draft.ID, false)}/OrderService.draftActivate`, {}, ALICE);
      await POST(`${orderUrl(data.ID)}/OrderService.submit`, {}, ALICE);
    });

    test('getKPIs() counts all orders but only sums confirmed revenue', async () => {
      const { data } = await GET(`${AN_SVC}/getKPIs()`, ALICE);
      expect(data.orderCount).toBe(4);
      expect(data.revenue).toBeCloseTo(19.8 + 19.8 + 11.0, 2);
      expect(data.openApprovals).toBe(1);
    });

    test('getRevenueByCountry() aggregates confirmed orders by Northwind customer country', async () => {
      const { status, data } = await GET(`${AN_SVC}/getRevenueByCountry()`, ALICE);
      expect(status).toBe(200);

      const byCountry = Object.fromEntries(data.value.map((r) => [r.country, r.revenue]));
      expect(byCountry.Germany).toBeCloseTo(19.8 + 11.0, 2); // ALFKI's two confirmed orders
      expect(byCountry.Mexico).toBeCloseTo(19.8, 2); // ANTON's one confirmed order
    });

    test('getRevenueByCategory() aggregates confirmed order items by Northwind product category', async () => {
      const { data } = await GET(`${AN_SVC}/getRevenueByCategory()`, ALICE);
      const byCategory = Object.fromEntries(data.value.map((r) => [r.category, r.revenue]));

      // Category revenue uses item netAmount (pre-tax), not order grossAmount.
      expect(byCategory.Beverages).toBeCloseTo(18 + 18, 2); // two Chai items
      expect(byCategory.Condiments).toBeCloseTo(10, 2); // one Aniseed Syrup item
    });

    test('getRevenueByCategory() excludes items from a Submitted (not yet approved) order', async () => {
      const { data } = await GET(`${AN_SVC}/getRevenueByCategory()`, ALICE);
      const beverages = data.value.find((r) => r.category === 'Beverages');
      // 300 * 18 = 5400 from the Submitted order must NOT be included
      expect(beverages.revenue).toBeLessThan(100);
    });

    test('getTopCustomers(top=1) returns only the single highest-revenue customer', async () => {
      const { status, data } = await GET(`${AN_SVC}/getTopCustomers(top=1)`, ALICE);
      expect(status).toBe(200);
      expect(data.value).toHaveLength(1);
      expect(data.value[0].customerID).toBe('ALFKI'); // 19.80 + 11.00 > ANTON's 19.80
      expect(data.value[0].orderCount).toBe(2);
    });

    test('getTopCustomers() defaults to 5 when top is omitted', async () => {
      const { status, data } = await GET(`${AN_SVC}/getTopCustomers()`, ALICE);
      expect(status).toBe(200);
      expect(data.value.length).toBeLessThanOrEqual(5);
      expect(data.value.map((c) => c.customerID).sort()).toEqual(['ALFKI', 'ANTON']);
    });
  });

  describe('getCustomerLocations() (MAP-01, MAP-02, MAP-03, MAP-04)', () => {
    beforeAll(async () => {
      const db = await cds.connect.to('db');
      await db.run(INSERT.into('orderhub.CustomerGeo').entries([
        { customerID: 'ALFKI', latitude: 52.52, longitude: 13.405, geocodedAt: new Date().toISOString(), failed: false },
        { customerID: 'ANTON', latitude: 19.4326, longitude: -99.1332, geocodedAt: new Date().toISOString(), failed: false },
        // BERGS deliberately left uncached — exercises the "schedule geocoding" path.
      ]));
      // One confirmed order for ALFKI so its revenue band is computable.
      await createConfirmedOrder('ALFKI', 1, 1); // Chai, 19.80
    });

    test('returns only customers with a cached (non-failed) geocode result', async () => {
      const { status, data } = await GET(`${AN_SVC}/getCustomerLocations()`, ALICE);
      expect(status).toBe(200);

      const ids = data.value.map((c) => c.customerID).sort();
      expect(ids).toEqual(['ALFKI', 'ANTON']);
      expect(ids).not.toContain('BERGS');
    });

    test('includes coordinates, order count and revenue band for each located customer', async () => {
      const { data } = await GET(`${AN_SVC}/getCustomerLocations()`, ALICE);
      const alfki = data.value.find((c) => c.customerID === 'ALFKI');

      expect(alfki.latitude).toBeCloseTo(52.52, 2);
      expect(alfki.longitude).toBeCloseTo(13.405, 2);
      expect(alfki.customerName).toBe('Alfreds Futterkiste');
      expect(alfki.orderCount).toBeGreaterThanOrEqual(1);
      expect(['High', 'Medium', 'Low']).toContain(alfki.revenueBand);
    });

    test('schedules background geocoding for customers with no cached result yet', async () => {
      await GET(`${AN_SVC}/getCustomerLocations()`, ALICE);
      expect(scheduleBackgroundGeocode).toHaveBeenCalled();
      const scheduled = scheduleBackgroundGeocode.mock.calls[0][0];
      expect(scheduled.map((c) => c.CustomerID)).toContain('BERGS');
      expect(scheduled.map((c) => c.CustomerID)).not.toContain('ALFKI');
    });
  });
});
