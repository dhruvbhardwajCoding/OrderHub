sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/BusyIndicator",
    "orderhub/model/formatter"
], function (Controller, MessageBox, MessageToast, BusyIndicator, formatter) {
    "use strict";

    return Controller.extend("orderhub.controller.SalesOrder", {
        formatter: formatter,

        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("salesOrder").attachPatternMatched(this._onPatternMatched, this);
        },

        _onPatternMatched: function (oEvent) {
            var that = this;
            var sOrderID = oEvent.getParameter("arguments").orderID;

            // Hide all buttons initially
            this.byId("btnSubmit").setVisible(false);
            this.byId("btnApprove").setVisible(false);
            this.byId("btnCancel").setVisible(false);

            var oView = this.getView();
            oView.bindElement({
                path: "/SalesOrders(" + sOrderID + ")",
                parameters: {
                    $expand: "items"
                },
                events: {
                    dataReceived: function () {
                        that._updateButtonVisibility();
                    }
                }
            });

            // Also update when user model is ready (async fetch)
            var oUserModel = this.getOwnerComponent().getModel("user");
            oUserModel.attachPropertyChange(function () {
                that._updateButtonVisibility();
            });

            // Delayed check in case data is already cached
            setTimeout(function () {
                that._updateButtonVisibility();
            }, 500);
        },

        _updateButtonVisibility: function () {
            var oContext = this.getView().getBindingContext();
            if (!oContext) {
                return;
            }

            var sStatus = oContext.getProperty("status");
            if (!sStatus) {
                return;
            }

            var oUserModel = this.getOwnerComponent().getModel("user");
            var bIsSalesRep = oUserModel.getProperty("/roles/SalesRep") === true;
            var bIsSalesManager = oUserModel.getProperty("/roles/SalesManager") === true;

            // Alice (SalesRep): Submit (when New) + Cancel (when New or Submitted)
            // Bob (SalesManager): Approve (when Submitted) + Cancel (when New or Submitted)
            this.byId("btnSubmit").setVisible(sStatus === "New" && bIsSalesRep);
            this.byId("btnApprove").setVisible(sStatus === "Submitted" && bIsSalesManager);
            this.byId("btnCancel").setVisible(
                (sStatus === "New" || sStatus === "Submitted") && (bIsSalesRep || bIsSalesManager)
            );
        },

        onNavBack: function () {
            var oHistory = sap.ui.core.routing.History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();
            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("salesOrders", {}, true);
            }
        },

        onSubmit: function () {
            var that = this;
            MessageBox.confirm(this.getView().getModel("i18n").getResourceBundle().getText("confirmSubmit") || "Confirm submit?", {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        BusyIndicator.show(0);
                        var oContext = that.getView().getBindingContext();
                        var oAction = oContext.getModel().bindContext("OrderService.submit(...)", oContext);
                        oAction.execute().then(function () {
                            BusyIndicator.hide();
                            MessageToast.show(that.getView().getModel("i18n").getResourceBundle().getText("orderSubmitted") || "Order submitted");
                            that.getView().getBindingContext().refresh();
                            // Update buttons after status change
                            setTimeout(function () { that._updateButtonVisibility(); }, 300);
                        }).catch(function (oError) {
                            BusyIndicator.hide();
                            MessageBox.error(oError.message || "Submission failed");
                        });
                    }
                }
            });
        },

        onApprove: function () {
            var that = this;
            MessageBox.confirm(this.getView().getModel("i18n").getResourceBundle().getText("confirmApprove") || "Confirm approve?", {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        BusyIndicator.show(0);
                        var oContext = that.getView().getBindingContext();
                        var oAction = oContext.getModel().bindContext("OrderService.approve(...)", oContext);
                        oAction.execute().then(function () {
                            BusyIndicator.hide();
                            MessageToast.show(that.getView().getModel("i18n").getResourceBundle().getText("orderApproved") || "Order approved");
                            that.getView().getBindingContext().refresh();
                            // Update buttons after status change
                            setTimeout(function () { that._updateButtonVisibility(); }, 300);
                        }).catch(function (oError) {
                            BusyIndicator.hide();
                            MessageBox.error(oError.message || "Approval failed");
                        });
                    }
                }
            });
        },

        onCancel: function () {
            var that = this;
            MessageBox.confirm(this.getView().getModel("i18n").getResourceBundle().getText("confirmCancel") || "Confirm cancel?", {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        BusyIndicator.show(0);
                        var oContext = that.getView().getBindingContext();
                        var oAction = oContext.getModel().bindContext("OrderService.cancel(...)", oContext);
                        oAction.execute().then(function () {
                            BusyIndicator.hide();
                            MessageToast.show(that.getView().getModel("i18n").getResourceBundle().getText("orderCancelled") || "Order cancelled");
                            that.getView().getBindingContext().refresh();
                            // Update buttons after status change
                            setTimeout(function () { that._updateButtonVisibility(); }, 300);
                        }).catch(function (oError) {
                            BusyIndicator.hide();
                            MessageBox.error(oError.message || "Cancellation failed");
                        });
                    }
                }
            });
        }
    });
});
