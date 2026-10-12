sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "orderhub/model/formatter"
], function (Controller, Filter, FilterOperator, formatter) {
    "use strict";

    return Controller.extend("orderhub.controller.Products", {
        formatter: formatter,

        onInit: function () {
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query");
            var oFilter = new Filter("ProductName", FilterOperator.Contains, sQuery);
            var oTable = this.byId("productsTable");
            var oBinding = oTable.getBinding("items");
            
            if (sQuery) {
                oBinding.filter([oFilter]);
            } else {
                oBinding.filter([]);
            }
        }
    });
});
