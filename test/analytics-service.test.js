'use strict';

/**
 * Integration tests for AnalyticsService (AN-01, AN-02, AN-03). Exercises
 * the real cross-system join: local SalesOrders aggregated and merged with
 * Northwind customer/product/category master data.
 */

process.env.CDS_REQUIRES_AUTH_KIND = 'mocked';

const cds = require('@sap/cds');

jest.mock('../srv/lib/northwind', () => {
  const customers = {
    ALFKI: { CustomerID: 'ALFKI', CompanyName: 'Alfreds Futterkiste', Country: 'Germany' },
    ANTON: { CustomerID: 'ANTON', CompanyName: 'Antonio Moreno Taquería', Country: 'Mexico' },
  };
  const products = [
    { ProductID: 1, ProductName: 'Chai', UnitPrice: 18.0, UnitsInStock: 39, Discontinued: false, CategoryID: 1 },
    { ProductID: 3, ProductName: 'Aniseed Syrup', UnitPrice: 10.0, UnitsInStock: 13, Discontinued: false, CategoryID: 2 },
  ];
  const categories = [
    { CategoryID: 1, CategoryName: 'Beverages' },
    { CategoryID: 2, CategoryName: 'Condiments' },
  ];

  return {
    getCustomer: jest.fn(async (srv, id) => customers[id] || null),
    getCustomers: jest.fn(async (srv, ids) => ids.map((id) => customers[id]).filter(Boolean)),
    getProducts: jest.fn(async (srv, ids) => products.filter((p) => ids.includes(p.ProductID))),
    getCategories: jest.fn(async (srv, ids) => categories.filter((c) => ids.includes(c.CategoryID))),
    withTimeout: jest.fn((promise) => promise),
  };
});

const ALICE = { auth: { username: 'alice', password: 'alice' } }; // SalesRep

const ORDER_SVC = '/odata/v4/order';
const AN_SVC = '/odata/v4/analytics';

cds.env.requires.auth = {
  kind: 'mocked',
  users: { alice: { password: 'alice', roles: ['SalesRep'] } },
};
const { GET, POST } = cds.test(__dirname + '/..');

async function createConfirmedOrder(customerID, productID, quantity) {
  const { data } = await POST(`${ORDER_SVC}/SalesOrders`, { customerID, items: [{ productID, quantity, discount: 0 }] }, ALICE);
  await POST(`${ORDER_SVC}/SalesOrders(${data.ID})/OrderService.submit`, {}, ALICE);
  return data.ID;
}

describe('AnalyticsService', () => {

  test('getKPIs() on an empty database returns all zeros', async () => {
    const { status, data } = await GET(`${AN_SVC}/getKPIs()`, ALICE);
    expect(status).toBe(200);
    expect(data).toMatchObject({ orderCount: 0, revenue: 0, openApprovals: 0, invoicesSent: 0 });
  });

  describe('with a mix of confirmed, pending and small orders', () => {
    beforeAll(async () => {
      // Small orders auto-approve (<= APPROVAL_THRESHOLD) -> "confirmed" revenue
      await createConfirmedOrder('ALFKI', 1, 1); // Chai, 18 * 1.1 = 19.80
      await createConfirmedOrder('ANTON', 1, 1); // Chai, 19.80
      await createConfirmedOrder('ALFKI', 3, 1); // Aniseed Syrup, 10 * 1.1 = 11.00

      // Large order stays Submitted — must NOT count as confirmed revenue
      const { data } = await POST(`${ORDER_SVC}/SalesOrders`, {
        customerID: 'ALFKI', items: [{ productID: 1, quantity: 300, discount: 0 }],
      }, ALICE);
      await POST(`${ORDER_SVC}/SalesOrders(${data.ID})/OrderService.submit`, {}, ALICE);
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
});
