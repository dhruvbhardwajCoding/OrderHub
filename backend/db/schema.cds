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
  invoice      : Association to one Invoices on invoice.order = $self;
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

/**
 * Invoices — generated PDFs and email tracking.
 * Associated 1:1 with SalesOrders.
 */
entity Invoices : cuid, managed {
  invoiceNo   : String(20) @readonly;
  order       : Association to SalesOrders;
  content     : LargeBinary @Core.MediaType: 'application/pdf';
  dmsObjectId : String(255);
  sentTo      : String(255);
  sentAt      : DateTime;
  mailStatus  : String(20); // 'PENDING', 'SENT', 'FAILED'
}

/**
 * CustomerGeo — geocoded customer coordinates, cached so Nominatim is
 * called at most once per customer (MAP-02; section 10's "Geocoding"
 * rule: max 1 request/second, custom User-Agent, cached here).
 */
entity CustomerGeo {
  key customerID : String(5);
  latitude       : Decimal(9,6);
  longitude      : Decimal(9,6);
  geocodedAt     : Timestamp;
  failed         : Boolean default false; // true if Nominatim found nothing — don't retry forever
}
