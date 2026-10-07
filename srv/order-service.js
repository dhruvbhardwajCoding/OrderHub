'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('order-service');

const { calculateItemNetAmount, calculateOrderTotals } = require('./lib/calculations');
const { generateOrderNumber }                          = require('./lib/order-number');
const { getCustomer, getProducts }                     = require('./lib/northwind');
const {
  ORDER_STATUS,
  VALID_TRANSITIONS,
  MIN_QUANTITY, MAX_QUANTITY,
  MIN_DISCOUNT, MAX_DISCOUNT,
  DEFAULT_CURRENCY,
  APPROVAL_THRESHOLD,
} = require('./lib/constants');

module.exports = class OrderService extends cds.ApplicationService {

  async init() {

    /* ── service connections ─────────────────────────────────── */
    const northwind = await cds.connect.to('northwind_metadata');
    const db        = await cds.connect.to('db');

    const {
      SalesOrders, SalesOrderItems,
      Customers, Products, Categories, Suppliers, Shippers,
    } = this.entities;

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  NORTHWIND READ DELEGATION
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    const delegateToNorthwind = (entity) => {
      this.on('READ', entity, async (req) => {
        try {
          return await northwind.run(req.query);
        } catch (err) {
          LOG.error(`Northwind READ failed for ${entity.name}:`, err.message);
          req.reject(502, 'Northwind service is currently unavailable. Please try again later.');
        }
      });
    };

    delegateToNorthwind(Customers);
    delegateToNorthwind(Products);
    delegateToNorthwind(Categories);
    delegateToNorthwind(Suppliers);
    delegateToNorthwind(Shippers);

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  SALES ORDER — CREATE
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.before('CREATE', SalesOrders, async (req) => {
      const data = req.data;

      /* --- basic payload checks -------------------------------- */
      if (!data.customerID) {
        return req.reject(400, 'Customer ID is required.');
      }
      if (!data.items || data.items.length === 0) {
        return req.reject(400, 'At least one order item is required.');
      }

      /* --- validate customer via Northwind ---------------------- */
      let customer;
      try {
        customer = await getCustomer(northwind, data.customerID);
      } catch (err) {
        return req.reject(err.status || 502, err.message);
      }
      if (!customer) {
        return req.reject(400, `Customer '${data.customerID}' not found in Northwind.`);
      }

      /* --- validate products via Northwind ---------------------- */
      const productIDs = data.items.map((i) => i.productID);
      let products;
      try {
        products = await getProducts(northwind, productIDs);
      } catch (err) {
        return req.reject(err.status || 502, err.message);
      }
      const productMap = new Map(products.map((p) => [p.ProductID, p]));

      for (const item of data.items) {
        const product = productMap.get(item.productID);

        if (!product) {
          return req.reject(400, `Product with ID '${item.productID}' not found in Northwind.`);
        }
        if (product.Discontinued) {
          return req.reject(400, `Product '${product.ProductName}' (ID ${item.productID}) is discontinued and cannot be ordered.`);
        }

        /* quantity validation */
        if (item.quantity == null || item.quantity < MIN_QUANTITY || item.quantity > MAX_QUANTITY) {
          return req.reject(400, `Quantity must be between ${MIN_QUANTITY} and ${MAX_QUANTITY}. Received: ${item.quantity}`);
        }

        /* discount validation */
        const discount = item.discount ?? 0;
        if (discount < MIN_DISCOUNT || discount > MAX_DISCOUNT) {
          return req.reject(400, `Discount must be between ${MIN_DISCOUNT}% and ${MAX_DISCOUNT}%. Received: ${discount}%`);
        }

        /* stock warning (non-blocking) */
        if (item.quantity > (product.UnitsInStock ?? 0)) {
          req.warn(
            200,
            `Quantity ${item.quantity} exceeds available stock (${product.UnitsInStock}) for '${product.ProductName}'.`
          );
        }

        /* snapshot product data & calculate item amount */
        item.productName = product.ProductName;
        item.unitPrice   = product.UnitPrice;
        item.discount    = discount;
        item.netAmount   = calculateItemNetAmount(product.UnitPrice, item.quantity, discount);
      }

      /* --- snapshot customer data ------------------------------- */
      data.customerName = customer.CompanyName;

      /* --- calculate order totals ------------------------------- */
      const totals     = calculateOrderTotals(data.items);
      data.netAmount   = totals.netAmount;
      data.taxAmount   = totals.taxAmount;
      data.grossAmount = totals.grossAmount;

      /* --- defaults -------------------------------------------- */
      data.status        = ORDER_STATUS.NEW;
      data.currency_code = data.currency_code || DEFAULT_CURRENCY;

      /* --- generate order number -------------------------------- */
      data.orderNo = await generateOrderNumber(db);

      LOG.info('Sales order prepared', {
        orderNo:  data.orderNo,
        customer: data.customerID,
        items:    data.items.length,
        gross:    data.grossAmount,
      });
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  SALES ORDER — UPDATE guard
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.before('UPDATE', SalesOrders, async (req) => {
      const ID = req.data.ID;
      if (!ID) return;

      const order = await db.run(
        SELECT.one.from('orderhub.SalesOrders').columns('status').where({ ID })
      );
      if (order && order.status !== ORDER_STATUS.NEW) {
        return req.reject(403, `Cannot edit an order in '${order.status}' status. Only 'New' orders can be modified.`);
      }
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  BOUND ACTION — submit
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('submit', SalesOrders, async (req) => {
      const ID = extractKey(req);
      const order = await db.run(
        SELECT.one.from('orderhub.SalesOrders').where({ ID })
      );
      if (!order) return req.reject(404, 'Order not found.');

      assertTransition(order.status, ORDER_STATUS.SUBMITTED, req);

      // Auto-approve orders at or below threshold
      let targetStatus = ORDER_STATUS.SUBMITTED;
      if (order.grossAmount <= APPROVAL_THRESHOLD) {
        targetStatus = ORDER_STATUS.APPROVED;
        LOG.info(`Order ${order.orderNo} auto-approved (${order.grossAmount} <= ${APPROVAL_THRESHOLD})`);
      }

      await db.run(
        UPDATE('orderhub.SalesOrders')
          .set({ status: targetStatus, modifiedAt: new Date().toISOString() })
          .where({ ID })
      );

      LOG.info(`Order ${order.orderNo} → ${targetStatus}`);
      return db.run(SELECT.one.from('orderhub.SalesOrders').where({ ID }));
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  BOUND ACTION — approve
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('approve', SalesOrders, async (req) => {
      const ID = extractKey(req);
      const order = await db.run(
        SELECT.one.from('orderhub.SalesOrders').where({ ID })
      );
      if (!order) return req.reject(404, 'Order not found.');

      assertTransition(order.status, ORDER_STATUS.APPROVED, req);

      await db.run(
        UPDATE('orderhub.SalesOrders')
          .set({ status: ORDER_STATUS.APPROVED, modifiedAt: new Date().toISOString() })
          .where({ ID })
      );

      LOG.info(`Order ${order.orderNo} approved`);
      return db.run(SELECT.one.from('orderhub.SalesOrders').where({ ID }));
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  BOUND ACTION — cancel
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('cancel', SalesOrders, async (req) => {
      const ID = extractKey(req);
      const order = await db.run(
        SELECT.one.from('orderhub.SalesOrders').where({ ID })
      );
      if (!order) return req.reject(404, 'Order not found.');

      assertTransition(order.status, ORDER_STATUS.CANCELLED, req);

      // SalesRep can only cancel their own orders
      const userRoles = req.user?.roles || {};
      if (userRoles.SalesRep && !userRoles.SalesManager && order.createdBy !== req.user.id) {
        return req.reject(403, 'You can only cancel your own orders.');
      }

      await db.run(
        UPDATE('orderhub.SalesOrders')
          .set({ status: ORDER_STATUS.CANCELLED, modifiedAt: new Date().toISOString() })
          .where({ ID })
      );

      LOG.info(`Order ${order.orderNo} cancelled`);
      return db.run(SELECT.one.from('orderhub.SalesOrders').where({ ID }));
    });

    /* ── finish initialisation ────────────────────────────────── */
    await super.init();
  }
};

/* ═══════════════════════════════════════════════════════════════
 *  PRIVATE HELPERS
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Extract the entity key (ID) from a bound-action request.
 */
function extractKey(req) {
  const p = req.params[0];
  return typeof p === 'object' ? p.ID : p;
}

/**
 * Assert that a status transition is valid; reject the request otherwise.
 */
function assertTransition(currentStatus, targetStatus, req) {
  const allowed = VALID_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    req.reject(
      409,
      `Cannot transition from '${currentStatus}' to '${targetStatus}'. Allowed: ${allowed.join(', ') || 'none'}.`
    );
  }
}
