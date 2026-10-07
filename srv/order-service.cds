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
    };

  entity SalesOrderItems as projection on orderhub.SalesOrderItems;
}

// ─── Authorisation ───────────────────────────────────────────────

// SalesOrders CRUD + action permissions
annotate OrderService.SalesOrders with @(restrict: [
  { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'submit', 'cancel'],
    to: 'SalesRep' },
  { grant: ['READ', 'approve', 'cancel'],
    to: 'SalesManager' },
  { grant: ['READ'],
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

// Prevent direct status / calculated-field mutation via PATCH
annotate OrderService.SalesOrders with {
  status    @readonly;
  orderNo   @readonly;
  netAmount @readonly;
  taxAmount @readonly;
  grossAmount @readonly;
};
