'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('analytics-service');

const { getCustomers, getProducts, getCategories, withTimeout } = require('./lib/northwind');
const { round2 } = require('./lib/calculations');
const { ORDER_STATUS } = require('./lib/constants');

// "Revenue" = orders a manager has actually approved — New/Submitted orders
// aren't confirmed business yet, and Cancelled orders never happened.
// Decision recorded in DECISIONS.md.
const CONFIRMED_STATUSES = [ORDER_STATUS.APPROVED, ORDER_STATUS.INVOICED];

module.exports = class AnalyticsService extends cds.ApplicationService {
  async init() {
    const db = await cds.connect.to('db');
    const northwind = await cds.connect.to('northwind_metadata');

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  getKPIs — AN-01
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('getKPIs', async () => {
      const [orderCountRes, revenueRes, openApprovalsRes, invoicesSentRes] = await Promise.all([
        db.run(SELECT.from('orderhub.SalesOrders').columns('count(1) as c')),
        db.run(
          SELECT.from('orderhub.SalesOrders')
            .columns('sum(grossAmount) as s')
            .where({ status: { in: CONFIRMED_STATUSES } })
        ),
        db.run(
          SELECT.from('orderhub.SalesOrders').columns('count(1) as c').where({ status: ORDER_STATUS.SUBMITTED })
        ),
        db.run(SELECT.from('orderhub.Invoices').columns('count(1) as c').where({ mailStatus: 'SENT' })),
      ]);

      return {
        orderCount: Number(orderCountRes[0]?.c) || 0,
        revenue: round2(Number(revenueRes[0]?.s) || 0),
        openApprovals: Number(openApprovalsRes[0]?.c) || 0,
        invoicesSent: Number(invoicesSentRes[0]?.c) || 0,
      };
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  getRevenueByCountry — AN-02
     *  Local SalesOrders can't $expand into remote Northwind Customers
     *  (section 6), so the join happens here: aggregate revenue per
     *  customerID locally, then batch-fetch those customers' Country from
     *  Northwind and re-aggregate by country.
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('getRevenueByCountry', async (req) => {
      const orders = await db.run(
        SELECT.from('orderhub.SalesOrders')
          .columns('customerID', 'grossAmount')
          .where({ status: { in: CONFIRMED_STATUSES } })
      );
      if (orders.length === 0) return [];

      const revenueByCustomer = new Map();
      for (const o of orders) {
        revenueByCustomer.set(o.customerID, (revenueByCustomer.get(o.customerID) || 0) + Number(o.grossAmount));
      }

      let customers;
      try {
        customers = await withTimeout(
          getCustomers(northwind, [...revenueByCustomer.keys()]),
          'reading customers for analytics'
        );
      } catch (err) {
        LOG.error('getRevenueByCountry: Northwind lookup failed', err.message);
        return req.reject(err.status || 502, err.message);
      }
      const countryByCustomer = new Map(customers.map((c) => [c.CustomerID, c.Country]));

      const revenueByCountry = new Map();
      for (const [customerID, revenue] of revenueByCustomer) {
        const country = countryByCustomer.get(customerID) || 'Unknown';
        revenueByCountry.set(country, (revenueByCountry.get(country) || 0) + revenue);
      }

      return [...revenueByCountry.entries()]
        .map(([country, revenue]) => ({ country, revenue: round2(revenue) }))
        .sort((a, b) => b.revenue - a.revenue);
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  getRevenueByCategory — AN-02
     *  Same cross-system join problem, one level deeper: item → product →
     *  category all live in Northwind, order confirmation lives locally.
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('getRevenueByCategory', async (req) => {
      const items = await db.run(
        SELECT.from('orderhub.SalesOrderItems')
          .columns('productID', 'netAmount')
          .where({ 'parent.status': { in: CONFIRMED_STATUSES } })
      );
      if (items.length === 0) return [];

      const revenueByProduct = new Map();
      for (const i of items) {
        revenueByProduct.set(i.productID, (revenueByProduct.get(i.productID) || 0) + Number(i.netAmount));
      }

      let products, categories;
      try {
        products = await withTimeout(
          getProducts(northwind, [...revenueByProduct.keys()]),
          'reading products for analytics'
        );
        const categoryIDs = [...new Set(products.map((p) => p.CategoryID).filter((id) => id != null))];
        categories = await withTimeout(getCategories(northwind, categoryIDs), 'reading categories for analytics');
      } catch (err) {
        LOG.error('getRevenueByCategory: Northwind lookup failed', err.message);
        return req.reject(err.status || 502, err.message);
      }

      const categoryIdByProduct = new Map(products.map((p) => [p.ProductID, p.CategoryID]));
      const nameByCategory = new Map(categories.map((c) => [c.CategoryID, c.CategoryName]));

      const revenueByCategory = new Map();
      for (const [productID, revenue] of revenueByProduct) {
        const categoryID = categoryIdByProduct.get(productID);
        const category = (categoryID != null && nameByCategory.get(categoryID)) || 'Uncategorized';
        revenueByCategory.set(category, (revenueByCategory.get(category) || 0) + revenue);
      }

      return [...revenueByCategory.entries()]
        .map(([category, revenue]) => ({ category, revenue: round2(revenue) }))
        .sort((a, b) => b.revenue - a.revenue);
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  getTopCustomers — AN-03 (Should)
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('getTopCustomers', async (req) => {
      const top = Number(req.data.top) > 0 ? Math.floor(Number(req.data.top)) : 5;

      const orders = await db.run(
        SELECT.from('orderhub.SalesOrders')
          .columns('customerID', 'grossAmount')
          .where({ status: { in: CONFIRMED_STATUSES } })
      );
      if (orders.length === 0) return [];

      const statsByCustomer = new Map();
      for (const o of orders) {
        const s = statsByCustomer.get(o.customerID) || { orderCount: 0, revenue: 0 };
        s.orderCount += 1;
        s.revenue += Number(o.grossAmount);
        statsByCustomer.set(o.customerID, s);
      }

      const ranked = [...statsByCustomer.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, top);

      let customers;
      try {
        customers = await withTimeout(
          getCustomers(northwind, ranked.map(([id]) => id)),
          'reading customers for analytics'
        );
      } catch (err) {
        LOG.error('getTopCustomers: Northwind lookup failed', err.message);
        return req.reject(err.status || 502, err.message);
      }
      const byId = new Map(customers.map((c) => [c.CustomerID, c]));

      return ranked.map(([customerID, stats]) => {
        const c = byId.get(customerID);
        return {
          customerID,
          customerName: c?.CompanyName || customerID,
          country: c?.Country || 'Unknown',
          orderCount: stats.orderCount,
          revenue: round2(stats.revenue),
        };
      });
    });

    await super.init();
  }
};
