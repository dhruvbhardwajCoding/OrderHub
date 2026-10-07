sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/UIComponent",
    "orderhub/model/formatter"
], function (Controller, JSONModel, UIComponent, formatter) {
    "use strict";

    return Controller.extend("orderhub.controller.Dashboard", {
        formatter: formatter,

        onInit: function () {
            var oDashboardModel = new JSONModel({
                totalOrders: 0,
                pendingApprovals: 0,
                totalRevenue: "0.00"
            });
            this.getView().setModel(oDashboardModel, "dashboard");

            var oRouter = UIComponent.getRouterFor(this);
            if (oRouter) {
                oRouter.getRoute("dashboard").attachPatternMatched(this._loadDashboardData, this);
            }
        },

        _loadDashboardData: function () {
            var oModel = this.getView().getModel();
            if (!oModel) return;

            var oDashboardModel = this.getView().getModel("dashboard");

            var oListBindingTotal = oModel.bindList("/SalesOrders", null, null, null, { $count: true });
            oListBindingTotal.requestContexts(0, 1).then(function () {
                var count = oListBindingTotal.getCount();
                if (count !== undefined) {
                    oDashboardModel.setProperty("/totalOrders", count);
                }
            });

            var oListBindingPending = oModel.bindList("/SalesOrders", null, null, [
                new sap.ui.model.Filter("status", sap.ui.model.FilterOperator.EQ, "Submitted")
            ], { $count: true });
            
            oListBindingPending.requestContexts(0, 1).then(function () {
                var count = oListBindingPending.getCount();
                if (count !== undefined) {
                    oDashboardModel.setProperty("/pendingApprovals", count);
                }
            });
        },

        onOrderPress: function (oEvent) {
            var oItem = oEvent.getSource();
            var oCtx = oItem.getBindingContext();
            var sOrderID = oCtx.getProperty("ID"); // Using ID assuming it is the key
            var oRouter = UIComponent.getRouterFor(this);
            if (oRouter && sOrderID) {
                 oRouter.navTo("salesOrder", {
                     orderID: sOrderID
                 });
            }
        }
    });
});
