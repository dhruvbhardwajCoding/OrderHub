using { orderhub } from '../db/schema';

/**
 * AnalyticsService — read-only aggregated views for the dashboard (AN-01,
 * AN-02, AN-03). Revenue figures combine local SalesOrders (the source of
 * truth for money) with live Northwind master data (customer country,
 * product category) — CDS can't $expand a local composition into a remote
 * OData service, so the aggregation happens here in the handler instead of
 * in the UI (section 6: "Local orders cannot $expand into remote Northwind
 * entities out of the box... explain how you handle this").
 *
 * The UI must read these exposed views/functions, not sum SalesOrders rows
 * itself (section 7.3).
 */
service AnalyticsService @(path: '/odata/v4/analytics')
                         @(requires: 'authenticated-user') {

  type DashboardKPIs {
    orderCount    : Integer;
    revenue       : Decimal(15,2);
    openApprovals : Integer;
    invoicesSent  : Integer;
  }

  type RevenueByCountry {
    country : String;
    revenue : Decimal(15,2);
  }

  type RevenueByCategory {
    category : String;
    revenue  : Decimal(15,2);
  }

  type TopCustomer {
    customerID   : String;
    customerName : String;
    country      : String;
    orderCount   : Integer;
    revenue      : Decimal(15,2);
  }

  function getKPIs()                      returns DashboardKPIs;
  function getRevenueByCountry()          returns array of RevenueByCountry;
  function getRevenueByCategory()         returns array of RevenueByCategory;
  function getTopCustomers(top: Integer)  returns array of TopCustomer;
}
