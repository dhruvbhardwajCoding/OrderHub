/* checksum : cb1235924cb8d8b88b2dee579ea3572e */
@cds.external : true
@cds.persistence.skip : true
entity NorthwindModel.Category_Sales_for_1997 {
  key CategoryName : String not null;
  CategorySales : Decimal;
};

@cds.external : true
@cds.persistence.skip : true
entity NorthwindModel.Product_Sales_for_1997 {
  key CategoryName : String not null;
  key ProductName : String not null;
  ProductSales : Decimal;
};

@cds.external : true
service northwind_metadata {
  @cds.external : true
  @cds.persistence.skip : true
  entity Categories {
    key CategoryID : Integer not null;
    CategoryName : String;
    Description : String;
    Picture : LargeBinary;
    Products : Association to many Products {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity CustomerDemographics {
    key CustomerTypeID : String not null;
    CustomerDesc : String;
    Customers : Association to many Customers {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Customers {
    key CustomerID : String not null;
    CompanyName : String;
    ContactName : String;
    ContactTitle : String;
    Address : String;
    City : String;
    Region : String;
    PostalCode : String;
    Country : String;
    Phone : String;
    Fax : String;
    Orders : Association to many Orders {  };
    CustomerDemographics : Association to many CustomerDemographics {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Employees {
    key EmployeeID : Integer not null;
    LastName : String;
    FirstName : String;
    Title : String;
    TitleOfCourtesy : String;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    BirthDate : DateTime;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    HireDate : DateTime;
    Address : String;
    City : String;
    Region : String;
    PostalCode : String;
    Country : String;
    HomePhone : String;
    Extension : String;
    Photo : LargeBinary;
    Notes : String;
    ReportsTo : Integer;
    PhotoPath : String;
    Employees1 : Association to many Employees {  };
    Employee1 : Association to one Employees {  };
    Orders : Association to many Orders {  };
    Territories : Association to many Territories {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Order_Details {
    key OrderID : Integer not null;
    key ProductID : Integer not null;
    UnitPrice : Decimal not null;
    Quantity : Integer not null;
    @odata.Type : 'Edm.Single'
    Discount : Double not null;
    Order : Association to one Orders {  };
    Product : Association to one Products {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Orders {
    key OrderID : Integer not null;
    CustomerID : String;
    EmployeeID : Integer;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    OrderDate : DateTime;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    RequiredDate : DateTime;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    ShippedDate : DateTime;
    ShipVia : Integer;
    Freight : Decimal;
    ShipName : String;
    ShipAddress : String;
    ShipCity : String;
    ShipRegion : String;
    ShipPostalCode : String;
    ShipCountry : String;
    Customer : Association to one Customers {  };
    Employee : Association to one Employees {  };
    Order_Details : Association to many Order_Details {  };
    Shipper : Association to one Shippers {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Products {
    key ProductID : Integer not null;
    ProductName : String;
    SupplierID : Integer;
    CategoryID : Integer;
    QuantityPerUnit : String;
    UnitPrice : Decimal;
    UnitsInStock : Integer;
    UnitsOnOrder : Integer;
    ReorderLevel : Integer;
    Discontinued : Boolean not null;
    Category : Association to one Categories {  };
    Order_Details : Association to many Order_Details {  };
    Supplier : Association to one Suppliers {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Regions {
    key RegionID : Integer not null;
    RegionDescription : String;
    Territories : Association to many Territories {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Shippers {
    key ShipperID : Integer not null;
    CompanyName : String;
    Phone : String;
    Orders : Association to many Orders {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Suppliers {
    key SupplierID : Integer not null;
    CompanyName : String;
    ContactName : String;
    ContactTitle : String;
    Address : String;
    City : String;
    Region : String;
    PostalCode : String;
    Country : String;
    Phone : String;
    Fax : String;
    HomePage : String;
    Products : Association to many Products {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Territories {
    key TerritoryID : String not null;
    TerritoryDescription : String;
    RegionID : Integer not null;
    Region : Association to one Regions {  };
    Employees : Association to many Employees {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Alphabetical_list_of_products {
    key ProductID : Integer not null;
    key ProductName : String not null;
    SupplierID : Integer;
    CategoryID : Integer;
    QuantityPerUnit : String;
    UnitPrice : Decimal;
    UnitsInStock : Integer;
    UnitsOnOrder : Integer;
    ReorderLevel : Integer;
    key Discontinued : Boolean not null;
    key CategoryName : String not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Category_Sales_for_1997 {
    key CategoryName : String not null;
    CategorySales : Decimal;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Current_Product_Lists {
    key ProductID : Integer not null;
    key ProductName : String not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Customer_and_Suppliers_by_Cities {
    City : String;
    key CompanyName : String not null;
    ContactName : String;
    key Relationship : String not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Invoices {
    ShipName : String;
    ShipAddress : String;
    ShipCity : String;
    ShipRegion : String;
    ShipPostalCode : String;
    ShipCountry : String;
    CustomerID : String;
    key CustomerName : String not null;
    Address : String;
    City : String;
    Region : String;
    PostalCode : String;
    Country : String;
    key Salesperson : String not null;
    key OrderID : Integer not null;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    OrderDate : DateTime;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    RequiredDate : DateTime;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    ShippedDate : DateTime;
    key ShipperName : String not null;
    key ProductID : Integer not null;
    key ProductName : String not null;
    key UnitPrice : Decimal not null;
    key Quantity : Integer not null;
    @odata.Type : 'Edm.Single'
    key Discount : Double not null;
    ExtendedPrice : Decimal;
    Freight : Decimal;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Order_Details_Extendeds {
    key OrderID : Integer not null;
    key ProductID : Integer not null;
    key ProductName : String not null;
    key UnitPrice : Decimal not null;
    key Quantity : Integer not null;
    @odata.Type : 'Edm.Single'
    key Discount : Double not null;
    ExtendedPrice : Decimal;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Order_Subtotals {
    key OrderID : Integer not null;
    Subtotal : Decimal;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Orders_Qries {
    key OrderID : Integer not null;
    CustomerID : String;
    EmployeeID : Integer;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    OrderDate : DateTime;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    RequiredDate : DateTime;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    ShippedDate : DateTime;
    ShipVia : Integer;
    Freight : Decimal;
    ShipName : String;
    ShipAddress : String;
    ShipCity : String;
    ShipRegion : String;
    ShipPostalCode : String;
    ShipCountry : String;
    key CompanyName : String not null;
    Address : String;
    City : String;
    Region : String;
    PostalCode : String;
    Country : String;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Product_Sales_for_1997 {
    key CategoryName : String not null;
    key ProductName : String not null;
    ProductSales : Decimal;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Products_Above_Average_Prices {
    key ProductName : String not null;
    UnitPrice : Decimal;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Products_by_Categories {
    key CategoryName : String not null;
    key ProductName : String not null;
    QuantityPerUnit : String;
    UnitsInStock : Integer;
    key Discontinued : Boolean not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Sales_by_Categories {
    key CategoryID : Integer not null;
    key CategoryName : String not null;
    key ProductName : String not null;
    ProductSales : Decimal;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Sales_Totals_by_Amounts {
    SaleAmount : Decimal;
    key OrderID : Integer not null;
    key CompanyName : String not null;
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    ShippedDate : DateTime;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Summary_of_Sales_by_Quarters {
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    ShippedDate : DateTime;
    key OrderID : Integer not null;
    Subtotal : Decimal;
  };

  @cds.external : true
  @cds.persistence.skip : true
  entity Summary_of_Sales_by_Years {
    @odata.Precision : 0
    @odata.Type : 'Edm.DateTimeOffset'
    ShippedDate : DateTime;
    key OrderID : Integer not null;
    Subtotal : Decimal;
  };
};

