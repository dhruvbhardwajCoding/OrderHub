sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "orderhub/model/formatter"
], function (Controller, Filter, FilterOperator, formatter) {
    "use strict";

    return Controller.extend("orderhub.controller.SalesOrders", {
        formatter: formatter,

        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("salesOrders").attachPatternMatched(this._onPatternMatched, this);
        },

        _onPatternMatched: function () {
            this._applyRoleFilters();
        },

        _applyRoleFilters: function (sQuery) {
            var aFilters = [];
            
            // Search filter
            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("orderNo", FilterOperator.Contains, sQuery),
                        new Filter("customerName", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }

            // Role filter
            var oUserModel = this.getOwnerComponent().getModel("user");
            if (oUserModel && oUserModel.getProperty("/roles/SalesManager") === true && oUserModel.getProperty("/roles/SalesRep") !== true) {
                // If strictly a SalesManager (Bob), filter out 'New' and 'Cancelled'
                aFilters.push(new Filter({
                    filters: [
                        new Filter("status", FilterOperator.EQ, "Submitted"),
                        new Filter("status", FilterOperator.EQ, "Approved")
                    ],
                    and: false
                }));
            }

            var oTable = this.byId("ordersTable");
            if (oTable) {
                var oBinding = oTable.getBinding("items");
                if (oBinding) {
                    // Combine search and role filters using AND
                    var oFinalFilter = aFilters.length > 0 ? new Filter(aFilters, true) : [];
                    oBinding.filter(oFinalFilter, "Application");
                }
            }
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query");
            this._applyRoleFilters(sQuery);
        },

        onOrderSelect: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var oContext = oItem.getBindingContext();
            var sID = oContext.getProperty("ID");
            this.getOwnerComponent().getRouter().navTo("salesOrder", {
                orderID: sID
            });
        }
    });
});
