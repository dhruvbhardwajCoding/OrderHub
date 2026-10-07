sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/UIComponent",
    "sap/ui/core/routing/History"
], function (Controller, UIComponent, History) {
    "use strict";

    return Controller.extend("orderhub.controller.CustomerDetail", {
        onInit: function () {
            var oRouter = UIComponent.getRouterFor(this);
            oRouter.getRoute("customerDetail").attachPatternMatched(this._onPatternMatched, this);
        },

        _onPatternMatched: function (oEvent) {
            var sCustomerID = oEvent.getParameter("arguments").customerID;
            this.getView().bindElement({
                path: "/Customers('" + sCustomerID + "')",
                parameters: { }
            });
        },

        onNavBack: function () {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                var oRouter = UIComponent.getRouterFor(this);
                oRouter.navTo("customerMap", {}, true);
            }
        },

        onCreateOrder: function () {
            var oCtx = this.getView().getBindingContext();
            var sCustomerID = oCtx.getProperty("CustomerID");
            var oRouter = UIComponent.getRouterFor(this);
            
            oRouter.navTo("createOrder", {
                customerID: sCustomerID
            });
        }
    });
});
