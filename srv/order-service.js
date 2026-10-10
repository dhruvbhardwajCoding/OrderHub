'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('order-service');

const { calculateItemNetAmount, calculateOrderTotals } = require('./lib/calculations');
const { generateOrderNumber }                          = require('./lib/order-number');
const {
  getCustomer, getProducts, withTimeout,
  getAllCustomers, getAllProducts,
}                                                       = require('./lib/northwind');
const northwindCache                                   = require('./lib/northwind-cache');
const { generateInvoicePdf }                           = require('./lib/pdf');
const { sendInvoiceEmail }                             = require('./lib/mailer');
const invoiceStore                                     = require('./lib/invoice-store');
const ai                                               = require('./lib/ai');
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
      SalesOrders, Invoices,
      Customers, Products, Categories, Suppliers, Shippers,
    } = this.entities;

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  NORTHWIND READ DELEGATION
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    const delegateToNorthwind = (entity) => {
      // Matches the remote Northwind entity set name 1:1 for all 5 delegated
      // entities below (none are renamed in the projection).
      const resource = entity.name.split('.').pop();

      this.on('READ', entity, async (req) => {
        try {
          if (req.query.SELECT.one) {
            // Key-based single-entity read (e.g. /Customers('ALFKI')), used by
            // the create-order flow. CAP's CQN translation handles this
            // correctly — the key ends up in SELECT.from.ref[0].where — so
            // just delegate the already-correct query as-is.
            return await northwindCache.cached(entity.name, req.query, () =>
              withTimeout(northwind.run(req.query), `reading ${entity.name}`)
            );
          }

          // Collection read (list/search screens). @sap/cds 8.9's default
          // "odata_new_parser" feature does not populate SELECT.where/.search
          // in req.query for a custom READ handler on an
          // @cds.persistence.skip entity — $filter and $search are silently
          // dropped, even though $orderby/$top/$skip/$count ARE present.
          // Forwarding the client's original OData query string straight to
          // Northwind sidesteps that gap entirely: Northwind is itself a
          // real OData V4 service and parses $filter/$search/$orderby/$top/
          // $skip/$count identically — this is a true proxy, not a
          // reimplementation of OData query parsing.
          const rawUrl = req._?.req?.url;
          if (!rawUrl) {
            // Defensive fallback for any call path without a raw HTTP
            // request (shouldn't happen for the OData adapter in practice).
            return await northwindCache.cached(entity.name, req.query, () =>
              withTimeout(northwind.run(req.query), `reading ${entity.name}`)
            );
          }
          const path = `/${resource}${rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : ''}`;

          // MD-05 (Should): cache master-data reads for a configurable time
          // instead of hitting Northwind on every request.
          return await northwindCache.cached(entity.name, path, () =>
            // MD-04 (Must): never let a slow/hung Northwind call hang the
            // request indefinitely — time it out with a readable error.
            withTimeout(northwind.send({ method: 'GET', path }), `reading ${entity.name}`)
          );
        } catch (err) {
          LOG.error(`Northwind READ failed for ${entity.name}:`, err.message);
          req.reject(err.status || 502, err.message || 'Northwind service is currently unavailable. Please try again later.');
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
     *  SALES ORDER — DELETE guard (SO-01)
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    // @restrict grants DELETE to SalesRep with no status condition — CAP's
    // declarative @restrict can't express "only while New" (it has no access
    // to the row being deleted), so that's enforced here instead, the same
    // way the UPDATE guard above handles "only while New" for edits. Once an
    // order has been submitted it's live in the approval/billing workflow;
    // deleting it would also orphan any Invoice already pointing at it via
    // `Invoices.order` (a plain Association, not owned by SalesOrders, so it
    // is not cascade-deleted).
    this.before('DELETE', SalesOrders, async (req) => {
      const ID = req.params[0];
      if (!ID) return;

      const order = await db.run(
        SELECT.one.from('orderhub.SalesOrders').columns('status').where({ ID })
      );
      if (order && order.status !== ORDER_STATUS.NEW) {
        return req.reject(409, `Cannot delete an order in '${order.status}' status. Only 'New' orders can be deleted.`);
      }
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  INVOICE MEDIA STREAM — lazy backfill from Document Management
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    // GET /Invoices(ID)/content requests exactly 3 columns — content, ID,
    // and a `$mediaContentType` alias — which is how we tell this apart from
    // a normal entity read (DMS-03: the browser only ever talks to this
    // service, never to Document Management directly).
    //
    // In `sdm` mode the PDF bytes aren't in SQLite at all; this `before`
    // handler runs ahead of the generic DB-backed stream handler and, the
    // first time a stored invoice is requested, fetches the bytes from
    // Document Management and writes them into `content` so the already-
    // working generic handler serves them exactly like local mode. Later
    // requests for the same invoice are then served straight from SQLite —
    // a deliberate read-through cache: invoices never change once created,
    // so re-fetching the same bytes from DMS on every view buys nothing.
    this.before('READ', Invoices, async (req) => {
      const columns = req.query.SELECT && req.query.SELECT.columns;
      const isContentStream = columns && columns.some((c) => c.as === '$mediaContentType');
      if (!isContentStream) return;

      const where = req.query.SELECT.from.ref[0].where;
      const idVal = where && where[2] && where[2].val;
      if (!idVal) return;

      const row = await db.run(
        SELECT.one.from('orderhub.Invoices').columns('ID', 'content', 'dmsObjectId').where({ ID: idVal })
      );
      if (!row || row.content || !row.dmsObjectId) return; // already local, or nothing to backfill

      try {
        const buffer = await invoiceStore.readInvoice(row);
        await db.run(UPDATE('orderhub.Invoices').set({ content: buffer }).where({ ID: idVal }));
      } catch (err) {
        return req.reject(502, err.message);
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

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  BOUND ACTION — createInvoice
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('createInvoice', SalesOrders, async (req) => {
      if (!req.user.is('BillingClerk')) return req.reject(403, 'Forbidden');
      const ID = extractKey(req);
      const order = await db.run(
        SELECT.one.from('orderhub.SalesOrders').where({ ID })
      );
      if (!order) return req.reject(404, 'Order not found.');

      // Idempotency: if already invoiced, return the existing invoice
      if (order.status === ORDER_STATUS.INVOICED) {
          const existingInvoice = await db.run(SELECT.one.from('orderhub.Invoices').where({ order_ID: ID }));
          if (existingInvoice) return existingInvoice;
      }

      assertTransition(order.status, ORDER_STATUS.INVOICED, req);

      // We need order items for the PDF
      const orderWithItems = await db.run(
          SELECT.one.from('orderhub.SalesOrders', so => {
              so('*'), so.items('*')
          }).where({ ID })
      );

      // Generate invoice number
      const year = new Date().getFullYear();
      const countRes = await db.run(SELECT.from('orderhub.Invoices').columns('count(1) as c'));
      const count = countRes[0] ? countRes[0].c : 0;
      const invoiceNo = `INV-${year}-${String(count + 1).padStart(5, '0')}`;
      const invoiceDate = new Date().toISOString();

      // Fetch the Northwind customer for the Bill-To block (best-effort; snapshot still has the name)
      let customer = null;
      try {
        customer = await getCustomer(northwind, order.customerID);
      } catch (err) {
        LOG.warn(`Could not fetch customer ${order.customerID} for invoice PDF: ${err.message}`);
      }

      // Generate PDF
      let pdfBuffer;
      try {
          pdfBuffer = await generateInvoicePdf(orderWithItems, invoiceNo, customer);
      } catch (err) {
          return req.reject(500, `Failed to generate PDF: ${err.message}`);
      }

      // Store the PDF (local SQLite or Document Management, per DMS-01). If the
      // configured store can't take the write, the invoice is NOT marked as
      // created (DMS-05) — the clerk sees a clear error and can retry.
      let stored;
      try {
          stored = await invoiceStore.saveInvoice(pdfBuffer, {
              invoiceNo, orderNo: order.orderNo, customerID: order.customerID, invoiceDate, year,
          });
      } catch (err) {
          return req.reject(502, err.message);
      }

      const invoiceData = {
          invoiceNo: invoiceNo,
          order_ID: ID,
          content: stored.content,
          dmsObjectId: stored.dmsObjectId,
          mailStatus: 'PENDING'
      };

      await db.run(INSERT.into('orderhub.Invoices').entries(invoiceData));

      await db.run(
        UPDATE('orderhub.SalesOrders')
          .set({ status: ORDER_STATUS.INVOICED, modifiedAt: new Date().toISOString() })
          .where({ ID })
      );

      LOG.info(`Invoice ${invoiceNo} created for order ${order.orderNo}`);
      return db.run(SELECT.one.from('orderhub.Invoices').where({ order_ID: ID }));
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  BOUND ACTION — sendInvoice
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('sendInvoice', SalesOrders, async (req) => {
      if (!req.user.is('BillingClerk')) return req.reject(403, 'Forbidden');
      const ID = extractKey(req);
      const order = await db.run(
        SELECT.one.from('orderhub.SalesOrders').where({ ID })
      );
      if (!order) return req.reject(404, 'Order not found.');

      // @cap-js/sqlite excludes LargeBinary (media) columns from a plain
      // SELECT * by default — `content` must be requested explicitly, or it
      // comes back as `undefined` rather than the actual PDF bytes.
      const invoice = await db.run(
        SELECT.one.from('orderhub.Invoices')
          .columns('ID', 'invoiceNo', 'content', 'dmsObjectId')
          .where({ order_ID: ID })
      );
      if (!invoice) return req.reject(400, 'Invoice not found. Create invoice first.');

      let customer;
      try {
        customer = await getCustomer(northwind, order.customerID);
      } catch (err) {
        return req.reject(err.status || 502, err.message);
      }
      
      // Northwind customers carry no Email field at all. The UI pre-fills a
      // <customerID>@example.test placeholder in the send dialog and lets the
      // clerk edit it before sending — req.data.email carries that override.
      // Fall back to a real Northwind email if one ever exists, for API callers
      // that don't go through the dialog.
      const email = (req.data.email && req.data.email.trim()) || customer.Email;

      // req.reject() throws, which rolls back the whole ambient transaction —
      // including any db.run() write made earlier in this same handler. To make
      // the FAILED marker survive that rollback, persist it in a transaction
      // detached from the current request context via cds.spawn(). (A plain
      // `cds.tx()` here would try to open a second transaction on the same
      // single-connection SQLite pool while this one is still open, and deadlock.)
      const markFailed = () => {
        cds.spawn({}, async (tx) => {
          await tx.run(UPDATE('orderhub.Invoices').set({ mailStatus: 'FAILED', modifiedAt: new Date().toISOString() }).where({ ID: invoice.ID }));
        });
      };

      if (!email) {
          markFailed();
          return req.reject(400, 'Customer has no usable email address.');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          markFailed();
          return req.reject(400, `'${email}' is not a valid email address.`);
      }

      try {
          const pdfBuffer = await invoiceStore.readInvoice(invoice);
          await sendInvoiceEmail(pdfBuffer, email, invoice.invoiceNo);
          await db.run(UPDATE('orderhub.Invoices').set({
              mailStatus: 'SENT',
              sentTo: email,
              sentAt: new Date().toISOString(),
              modifiedAt: new Date().toISOString()
          }).where({ ID: invoice.ID }));
          LOG.info(`Invoice ${invoice.invoiceNo} sent to ${email}`);
      } catch (error) {
          LOG.error(`Failed to send email for invoice ${invoice.invoiceNo}:`, error.message);
          markFailed();
          return req.reject(500, `Failed to send email: ${error.message}`);
      }

      return db.run(SELECT.one.from('orderhub.Invoices').where({ ID: invoice.ID }));
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  FUNCTION — proposeOrderFromText (AI-01, AI-02)
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    this.on('proposeOrderFromText', async (req) => {
      // AI-02: the rest of the app works fully with no AI key configured —
      // the UI disables the feature instead of showing an error.
      if (!ai.isConfigured()) {
        return { aiAvailable: false, customerHint: '', customerStatus: 'not_found', items: [], deliveryNote: '' };
      }

      const text = (req.data.text || '').trim();
      if (!text) return req.reject(400, 'Please paste some text to extract an order from.');

      let extraction;
      try {
        extraction = await ai.extractOrderFromText(text);
      } catch (err) {
        LOG.error('AI order extraction failed:', err.message);
        return req.reject(err.status || 502, err.message);
      }

      // The model only ever proposes text hints — every customer and
      // product is matched against live Northwind data here, server-side,
      // before any of it is shown for the clerk to confirm (section 9:
      // "every customer and product matched against Northwind before
      // anything is saved").
      let customers, products;
      try {
        [customers, products] = await Promise.all([
          withTimeout(getAllCustomers(northwind), 'reading customers for AI matching'),
          withTimeout(getAllProducts(northwind), 'reading products for AI matching'),
        ]);
      } catch (err) {
        return req.reject(err.status || 502, err.message);
      }

      const customerMatch = matchEntity(extraction.customerHint, customers, 'CompanyName', 'CustomerID');
      const items = (extraction.items || []).map((item) => {
        const m = matchEntity(item.productHint, products, 'ProductName', 'ProductID');
        const product = products.find((p) => p.ProductID === m.id);
        return {
          productHint: item.productHint,
          quantity: item.quantity,
          matchStatus: m.status,
          productID: m.id,
          productName: m.name,
          unitPrice: product ? product.UnitPrice : null,
          unitsInStock: product ? product.UnitsInStock : null,
        };
      });

      LOG.info(`AI order proposal: customer ${customerMatch.status}, ${items.length} item(s)`);

      return {
        aiAvailable: true,
        customerHint: extraction.customerHint || '',
        customerStatus: customerMatch.status,
        customerID: customerMatch.id,
        customerName: customerMatch.name,
        items,
        deliveryNote: extraction.deliveryNote || '',
      };
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

/**
 * Match a free-text hint (from the AI assistant) against real Northwind
 * records by a case-insensitive substring match on `nameField`. Never
 * trusts the model's own idea of an ID — this is the only thing that
 * decides whether a hint maps to a real customer/product (AI-01).
 *
 * @returns {{status: 'matched'|'ambiguous'|'not_found', id: *, name: string|null}}
 */
function matchEntity(hint, candidates, nameField, idField) {
  const trimmed = (hint || '').trim().toLowerCase();
  if (!trimmed) return { status: 'not_found', id: null, name: null };

  const matches = candidates.filter((c) => (c[nameField] || '').toLowerCase().includes(trimmed));
  if (matches.length === 0) return { status: 'not_found', id: null, name: null };
  if (matches.length === 1) return { status: 'matched', id: matches[0][idField], name: matches[0][nameField] };
  return { status: 'ambiguous', id: matches[0][idField], name: matches[0][nameField] };
}
