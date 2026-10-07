namespace orderhub;

using { cuid, managed, Currency } from '@sap/cds/common';

/**
 * Order status lifecycle:
 *   New → Submitted → Approved → Invoiced (Phase 3)
 *   New → Cancelled
 *   Submitted → Cancelled
 */
type OrderStatus : String enum {
  New;
  Submitted;
  Approved;
  Invoiced;   // Phase 3: invoice generation
  Cancelled;
};

/**
 * Sales Orders — transactional entity owned by our application.
 * Customer data is snapshotted at creation time so historical
 * orders remain accurate even if Northwind master data changes.
 */
entity SalesOrders : cuid, managed {
  orderNo      : String(15)    @readonly;
  customerID   : String(5)     @mandatory;
  customerName : String(100);
  status       : OrderStatus   default 'New';
  netAmount    : Decimal(15,2) @readonly;
  taxAmount    : Decimal(15,2) @readonly;
  grossAmount  : Decimal(15,2) @readonly;
  currency     : Currency;
  items        : Composition of many SalesOrderItems
                   on items.parent = $self;
}

/**
 * Sales Order Items — line items within a sales order.
 * Product data is snapshotted at creation time.
 */
entity SalesOrderItems : cuid {
  parent       : Association to SalesOrders;
  productID    : Integer       @mandatory;
  productName  : String(100);
  unitPrice    : Decimal(15,2);
  quantity     : Integer       @mandatory;
  discount     : Decimal(5,2)  default 0;
  netAmount    : Decimal(15,2) @readonly;
}
