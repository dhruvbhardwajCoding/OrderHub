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
      SalesOrders, SalesOrderItems, Invoices,
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

    // SO-08: this same validation/pricing logic now runs at two points —
    // CREATE (a non-draft POST, or activating a brand-new draft) and UPDATE
    // (activating an edited draft) — so it lives in one shared function,
    // validateAndPrice(), instead of being duplicated. See that function's
    // own comment below for why `isNew` is the only thing that differs.
    this.before('CREATE', SalesOrders, (req) => validateAndPrice(req, { isNew: true, northwind, db }));

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

      // SO-08: this UPDATE is draft activation of an edited order — CAP
      // merges the draft's full deep data (including `items`) into
      // req.data for this event, so the same validation/pricing CREATE
      // uses applies here too. A plain PATCH of a top-level field (e.g.
      // from an API caller, not the draft flow) won't carry `items` and
      // is left alone — there's nothing to re-price.
      if (req.data.items) {
        await validateAndPrice(req, { isNew: false, northwind, db });
      }
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  SALES ORDER — EDIT guard (SO-08)
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    // EDIT (draftEdit) copies the active order into a new draft for
    // editing. Same "only while New" rule as UPDATE above — an order
    // that's already Submitted/Approved/etc. shouldn't be editable via
    // a draft any more than via a direct PATCH.
    this.before('EDIT', SalesOrders, async (req) => {
      const ID = extractKey(req);
      const order = await db.run(
        SELECT.one.from('orderhub.SalesOrders').columns('status').where({ ID })
      );
      if (!order) return req.reject(404, 'Order not found.');
      if (order.status !== ORDER_STATUS.NEW) {
        return req.reject(409, `Cannot edit an order in '${order.status}' status. Only 'New' orders can be edited.`);
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
      // SO-08: req.params[0] is now {ID, IsActiveEntity} — passing that
      // object straight into where({ID}) (the old code) would silently
      // match no row at all, turning this guard into a no-op. extractKey()
      // (already used by the bound actions below) pulls out the plain ID.
      const key = req.params[0];
      if (key && typeof key === 'object' && key.IsActiveEntity === false) {
        // Discarding a draft never touches the active order and is always
        // allowed — the EDIT guard above already ensures a draft can only
        // exist for an active order that was New when editing started.
        return;
      }

      const ID = extractKey(req);
      if (!ID) return;

      const order = await db.run(
        SELECT.one.from('orderhub.SalesOrders').columns('status').where({ ID })
      );
      if (order && order.status !== ORDER_STATUS.NEW) {
        return req.reject(409, `Cannot delete an order in '${order.status}' status. Only 'New' orders can be deleted.`);
      }
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  NEW DRAFT (SO-08) — starting a new order
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    // Starting a draft (POST /SalesOrders) only needs a valid customer —
    // full item/pricing validation happens once, at activation, via
    // validateAndPrice() (the CREATE handler above). This just gives the
    // draft editor a customer name to show immediately, and catches a bad
    // customerID up front rather than only when the clerk tries to save.
    this.before('NEW', SalesOrders.drafts, async (req) => {
      const data = req.data;
      if (!data.customerID) return req.reject(400, 'Customer ID is required.');

      let customer;
      try {
        customer = await getCustomer(northwind, data.customerID);
      } catch (err) {
        return req.reject(err.status || 502, err.message);
      }
      if (!customer) return req.reject(400, `Customer '${data.customerID}' not found in Northwind.`);

      data.customerName = customer.CompanyName;
      data.currency_code = data.currency_code || DEFAULT_CURRENCY;
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  DRAFT ITEMS (SO-08) — product name/price + live totals
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    // Draft items deliberately don't get quantity/discount bounds enforced
    // here — the draft is allowed to be incomplete or invalid while the
    // clerk is still editing; validateAndPrice() enforces those bounds once,
    // at activation. This only fills in what the editor UI needs to *show*
    // (product name/price) and keeps a running netAmount/header total so
    // the numbers on screen stay honest while editing.
    async function fillDraftItemProduct(req) {
      const data = req.data;
      if (data.productID == null) return;

      const [product] = await getProducts(northwind, [data.productID]);
      if (!product) return req.reject(400, `Product with ID '${data.productID}' not found in Northwind.`);

      data.productName = product.ProductName;
      data.unitPrice    = product.UnitPrice;
      if (data.discount == null) data.discount = 0;
      data.netAmount = calculateItemNetAmount(product.UnitPrice, data.quantity || 0, data.discount || 0);
    }

    this.before('NEW', SalesOrderItems.drafts, fillDraftItemProduct);

    // Empirically (checked live, not documented anywhere obvious): an OData
    // PATCH against a *child* draft entity (SalesOrderItems, not the draft
    // root SalesOrders) dispatches as CAP event 'UPDATE', not 'PATCH' — the
    // event-name remap in CAP's OData adapter that turns UPDATE into PATCH
    // only triggers for the draft root itself.
    this.before('UPDATE', SalesOrderItems.drafts, async (req) => {
      // productID changed (or this is a brand-new line from the item
      // dialog, keyed by productID on its first edit) — re-fetch product
      // data. Otherwise, a quantity/discount-only edit still needs
      // netAmount recomputed, but doesn't need another Northwind round trip.
      if (req.data.productID != null) {
        return fillDraftItemProduct(req);
      }
      if (req.data.quantity != null || req.data.discount != null) {
        const current = await db.run(
          SELECT.one.from(SalesOrderItems.drafts).columns('unitPrice', 'quantity', 'discount').where({ ID: extractKey(req) })
        );
        if (!current) return;
        const quantity = req.data.quantity ?? current.quantity;
        const discount = req.data.discount ?? current.discount;
        req.data.netAmount = calculateItemNetAmount(current.unitPrice, quantity, discount);
      }
    });

    // After an item is added/edited/removed on a draft, recompute the
    // draft order's header totals from whatever items now exist. Runs as
    // one `after` handler shared by NEW/UPDATE/DELETE rather than duplicated
    // per event; the parent order's ID is stashed on `req` in `before`
    // since DELETE carries no body and an edit only carries changed fields.
    async function recomputeDraftTotals(orderID) {
      if (!orderID) return;
      const items = await db.run(SELECT.from(SalesOrderItems.drafts).columns('netAmount').where({ parent_ID: orderID }));
      // netAmount round-trips through SQLite as a Decimal; coerce
      // defensively so summing never falls into string concatenation.
      const totals = calculateOrderTotals(items.map((i) => ({ netAmount: Number(i.netAmount) || 0 })));
      await db.run(
        UPDATE(SalesOrders.drafts)
          .set({ netAmount: totals.netAmount, taxAmount: totals.taxAmount, grossAmount: totals.grossAmount })
          .where({ ID: orderID })
      );
    }

    this.before(['NEW', 'UPDATE', 'DELETE'], SalesOrderItems.drafts, async (req) => {
      req._parentOrderID = req.data && req.data.parent_ID;
      if (!req._parentOrderID) {
        const ID = req.event === 'DELETE' ? extractDeleteKey(req) : extractKey(req);
        if (!ID) return;
        const row = await db.run(SELECT.one.from(SalesOrderItems.drafts).columns('parent_ID').where({ ID }));
        if (row) req._parentOrderID = row.parent_ID;
      }
    });

    this.after(['NEW', 'UPDATE', 'DELETE'], SalesOrderItems.drafts, async (_result, req) => {
      await recomputeDraftTotals(req._parentOrderID);
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  WORKFLOW ACTIONS ON A DRAFT KEY (SO-08) — clear error, not a 501
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    // Without these, calling e.g. submit on a draft key (IsActiveEntity=
    // false) falls through to CAP's generic "no handler for submit on
    // ...drafts" 501 — already blocked either way, since these actions are
    // only ever registered against the active SalesOrders entity below, but
    // that's not a message a user should see. Same outcome, clearer reason.
    for (const action of ['submit', 'approve', 'cancel', 'createInvoice', 'sendInvoice']) {
      this.on(action, SalesOrders.drafts, (req) => req.reject(409, 'Save or discard the draft before doing this.'));
    }

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
 * SO-08: validate and price a sales order, shared between CREATE (a
 * non-draft POST, or activating a brand-new draft) and UPDATE (activating
 * an edited draft). Both run this exact same logic — the same customer/
 * product/discontinued/quantity/discount checks and the same snapshot +
 * totals math — so it lives in one place instead of two copies that could
 * drift apart.
 *
 * `isNew` is the only thing that differs between the two call sites:
 * a brand-new order gets a generated order number and starts as 'New';
 * an edited order keeps both as they already are.
 *
 * @param {object} req - the CREATE or UPDATE request; req.data is mutated
 *   in place with snapshotted names/prices and computed totals, exactly as
 *   the original CREATE-only handler did.
 * @param {{isNew: boolean, northwind: object, db: object}} ctx
 */
async function validateAndPrice(req, { isNew, northwind, db }) {
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

  if (isNew) {
    /* --- defaults -------------------------------------------- */
    data.status        = ORDER_STATUS.NEW;
    data.currency_code = data.currency_code || DEFAULT_CURRENCY;

    /* --- generate order number -------------------------------- */
    data.orderNo = await generateOrderNumber(db);
  }

  LOG.info(isNew ? 'Sales order prepared' : 'Sales order re-priced on edit', {
    orderNo:  data.orderNo,
    customer: data.customerID,
    items:    data.items.length,
    gross:    data.grossAmount,
  });
}

/**
 * Extract the entity key (ID) from a bound-action request.
 */
function extractKey(req) {
  const p = req.params[0];
  return typeof p === 'object' ? p.ID : p;
}

/**
 * Extract the entity key (ID) from a DELETE request. req.params is empty
 * for a DELETE targeting a composition child's own entity set (verified
 * live — e.g. DELETE /SalesOrderItems(ID=..,IsActiveEntity=false), unlike
 * a bound action or a DELETE on the draft root, both of which do populate
 * it), so this falls back to parsing the CQN where-clause directly — the
 * same pattern the invoice content-stream handler above already uses.
 */
function extractDeleteKey(req) {
  const fromParams = extractKey(req);
  if (fromParams) return fromParams;
  const ref = req.query.DELETE && req.query.DELETE.from && req.query.DELETE.from.ref;
  const where = ref && ref[0] && ref[0].where;
  const idEntry = where && where.find((w) => w && w.val !== undefined);
  return idEntry && idEntry.val;
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
