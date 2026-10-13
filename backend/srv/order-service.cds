using { northwind_metadata as northwind } from './external/northwind-metadata';
using { orderhub } from '../db/schema';

/**
 * OrderService — the primary API consumed by the SAPUI5 frontend.
 *
 * Read-only projections expose Northwind master data.
 * Transactional entities (SalesOrders, SalesOrderItems) are owned
 * by this application and persisted in SQLite.
 */
service OrderService @(path: '/odata/v4/order')
                     @(requires: 'authenticated-user') {

  // ─── Northwind master-data projections (read-only) ───────────

  @readonly entity Customers as projection on northwind.Customers
    excluding { Orders, CustomerDemographics };

  @readonly entity Products as projection on northwind.Products
    excluding { Order_Details, Category, Supplier };

  @readonly entity Categories as projection on northwind.Categories
    excluding { Picture, Products };

  @readonly entity Suppliers as projection on northwind.Suppliers
    excluding { Products };

  @readonly entity Shippers as projection on northwind.Shippers
    excluding { Orders };

  // ─── Transactional entities ──────────────────────────────────

  entity SalesOrders as projection on orderhub.SalesOrders
    actions {
      @(requires: 'SalesRep')
      action submit()  returns SalesOrders;
      @(requires: 'SalesManager')
      action approve() returns SalesOrders;
      action cancel()  returns SalesOrders;
      @(requires: 'BillingClerk')
      action createInvoice() returns Invoices;
      @(requires: 'BillingClerk')
      action sendInvoice(email: String(255)) returns Invoices;
    };

  entity SalesOrderItems as projection on orderhub.SalesOrderItems;
  entity Invoices as projection on orderhub.Invoices;

  // ─── AI assistant (AI-01, AI-02) ──────────────────────────────
  // "Order from text" (section 9, option A): paste a customer email,
  // get a structured draft order matched against live Northwind data
  // before anything is saved. Never called from the browser directly —
  // the model only sees the pasted text, never Northwind data or keys.

  type ProposedOrderItem {
    productHint   : String;
    quantity      : Integer;
    matchStatus   : String enum { matched; ambiguous; not_found };
    productID     : Integer;
    productName   : String;
    unitPrice     : Decimal(15,2);
    unitsInStock  : Integer; // SO-09: lets the UI warn before the order is even saved
  }

  type ProposedOrder {
    aiAvailable    : Boolean; // false if no AI key is configured (AI-02) — items/customer are empty in that case
    customerHint   : String;
    customerStatus : String enum { matched; ambiguous; not_found };
    customerID     : String;
    customerName   : String;
    items          : array of ProposedOrderItem;
    deliveryNote   : String;
  }

  // An action (POST body), not a function: the pasted text is free-form —
  // potentially long, with arbitrary punctuation and line breaks — and
  // OData functions take their parameters URL-encoded in the request path,
  // which is the wrong fit here (same reason sendInvoice's `email` is an
  // action parameter, not a function one).
  @(requires: 'SalesRep')
  action proposeOrderFromText(text: String) returns ProposedOrder;
}

// ─── Draft editing (SO-08) ─────────────────────────────────────────
// SalesOrderItems is a composition child of SalesOrders, so it becomes
// draft-enabled automatically — no separate annotation needed.
annotate OrderService.SalesOrders with @odata.draft.enabled;

// ─── Authorisation ───────────────────────────────────────────────

// SalesOrders CRUD + action permissions
annotate OrderService.SalesOrders with @(restrict: [
  { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'submit', 'cancel'],
    to: 'SalesRep' },
  { grant: ['READ', 'approve', 'cancel'],
    to: 'SalesManager' },
  { grant: ['READ', 'createInvoice', 'sendInvoice'],
    to: 'BillingClerk',
    where: 'status = ''Approved'' or status = ''Invoiced''' }
]);

// Action permissions are now inline

// SalesOrderItems follow parent permissions (Composition)
annotate OrderService.SalesOrderItems with @(restrict: [
  { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'], to: 'SalesRep' },
  { grant: ['READ'],                                to: 'SalesManager' },
  { grant: ['READ'],                                to: 'BillingClerk' }
]);

// Invoices permissions
annotate OrderService.Invoices with @(restrict: [
  { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'], to: 'BillingClerk' },
  { grant: ['READ'],                               to: 'SalesRep' },
  { grant: ['READ'],                               to: 'SalesManager' }
]);

// Prevent direct status / calculated-field mutation via PATCH
annotate OrderService.SalesOrders with {
  status    @readonly;
  orderNo   @readonly;
  netAmount @readonly;
  taxAmount @readonly;
  grossAmount @readonly;
};
