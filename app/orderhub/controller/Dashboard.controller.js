sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/UIComponent",
    "sap/m/MessageToast",
    "orderhub/model/formatter"
], function (Controller, JSONModel, UIComponent, MessageToast, formatter) {
    "use strict";

    return Controller.extend("orderhub.controller.Dashboard", {
        formatter: formatter,

        onInit: function () {
            var oDashboardModel = new JSONModel({
                orderCount: 0,
                revenue: 0,
                openApprovals: 0,
                invoicesSent: 0,
                revenueByCountry: [],
                revenueByCategory: [],
                topCustomers: [],
                busy: false
            });
            this.getView().setModel(oDashboardModel, "dashboard");

            // The Panel around each chart already shows a header — suppress
            // VizFrame's own default "Title" placeholder and keep a compact
            // bottom legend instead of relying on XML vizProperties binding
            // (a plain JS object doesn't survive XML attribute binding
            // syntax cleanly).
            var oChartProperties = {
                title: { visible: false },
                legend: { visible: true, position: "bottom" },
                plotArea: { dataLabel: { visible: false } }
            };
            this.byId("revenueByCountryChart").setVizProperties(oChartProperties);
            this.byId("revenueByCategoryChart").setVizProperties(oChartProperties);

            var oRouter = UIComponent.getRouterFor(this);
            if (oRouter) {
                oRouter.getRoute("dashboard").attachPatternMatched(this._loadDashboardData, this);
            }
        },

        // All KPI values and chart/table data come from AnalyticsService
        // (an aggregated, server-side CAP service) — never computed here by
        // summing SalesOrders rows in the browser (section 7.3).
        _loadDashboardData: function () {
            var that = this;
            var oAnalyticsModel = this.getOwnerComponent().getModel("analytics");
            var oDashboardModel = this.getView().getModel("dashboard");
            if (!oAnalyticsModel || !oDashboardModel) {
                return;
            }

            oDashboardModel.setProperty("/busy", true);

            // Unbound OData V4 functions: a scalar result uses bindContext()
            // with a literal, already-resolved path and requestObject(); a
            // collection result uses bindList() the same way. The "(...)"
            // deferred-parameter syntax (+ setParameter + execute()) is for
            // actions, not functions, and ODataListBinding doesn't even
            // have setParameter() — both of those were wrong here.
            var pKPIs = oAnalyticsModel.bindContext("/getKPIs()").requestObject();

            var pRevenueByCountry = oAnalyticsModel.bindList("/getRevenueByCountry()")
                .requestContexts(0, 100)
                .then(function (aContexts) {
                    return aContexts.map(function (oContext) { return oContext.getObject(); });
                });

            var pRevenueByCategory = oAnalyticsModel.bindList("/getRevenueByCategory()")
                .requestContexts(0, 100)
                .then(function (aContexts) {
                    return aContexts.map(function (oContext) { return oContext.getObject(); });
                });

            var pTopCustomers = oAnalyticsModel.bindList("/getTopCustomers(top=5)")
                .requestContexts(0, 5)
                .then(function (aContexts) {
                    return aContexts.map(function (oContext) { return oContext.getObject(); });
                });

            Promise.all([pKPIs, pRevenueByCountry, pRevenueByCategory, pTopCustomers])
                .then(function (aResults) {
                    var oKPIs = aResults[0] || {};
                    oDashboardModel.setData({
                        orderCount: oKPIs.orderCount || 0,
                        revenue: Number(oKPIs.revenue) || 0,
                        openApprovals: oKPIs.openApprovals || 0,
                        invoicesSent: oKPIs.invoicesSent || 0,
                        revenueByCountry: aResults[1] || [],
                        revenueByCategory: aResults[2] || [],
                        topCustomers: aResults[3] || [],
                        busy: false
                    });
                })
                .catch(function () {
                    oDashboardModel.setProperty("/busy", false);
                    MessageToast.show(
                        that.getView().getModel("i18n").getResourceBundle().getText("dashboardLoadError")
                    );
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
        },

        onTopCustomerPress: function (oEvent) {
            var oItem = oEvent.getSource();
            var oCtx = oItem.getBindingContext("dashboard");
            var sCustomerID = oCtx && oCtx.getProperty("customerID");
            var oRouter = UIComponent.getRouterFor(this);
            if (oRouter && sCustomerID) {
                oRouter.navTo("customerDetail", {
                    customerID: sCustomerID
                });
            }
        }
    });
});
