sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/BusyIndicator",
    "orderhub/model/formatter"
], function (Controller, JSONModel, Fragment, MessageBox, MessageToast, BusyIndicator, formatter) {
    "use strict";

    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Relative on purpose — see Component.js's BACKEND_URL comment. Keep in
    // sync with that and with manifest.json's dataSources.
    var BACKEND_URL = "";

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
            this.byId("btnContinueDraft").setVisible(false);
            this.byId("btnEdit").setVisible(false);
            this.byId("btnDelete").setVisible(false);
            this.byId("btnSubmit").setVisible(false);
            this.byId("btnApprove").setVisible(false);
            this.byId("btnCancel").setVisible(false);

            var oView = this.getView();
            // SO-08: SalesOrders' key is now (ID, IsActiveEntity) — always bind
            // to the active instance here; drafts get their own route/view
            // (orderDraft). HasDraftEntity is only ever read imperatively
            // (oContext.getProperty in _updateButtonVisibility below), never
            // from a declarative XML binding, so autoExpandSelect's
            // view-binding-based inference never picks it up on its own
            // (verified live — it's missing from the auto-generated $select
            // otherwise) and needs this explicit entry.
            oView.bindElement({
                path: "/SalesOrders(ID=" + sOrderID + ",IsActiveEntity=true)",
                parameters: {
                    $expand: "items,invoice",
                    $select: "HasDraftEntity"
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
            var bIsBillingClerk = oUserModel.getProperty("/roles/BillingClerk") === true;

            // SO-08: a leftover draft (started via Edit, never saved or
            // discarded) takes priority over the plain Edit entry point —
            // only one of the two is ever shown.
            var bHasDraft = !!oContext.getProperty("HasDraftEntity");
            this.byId("btnContinueDraft").setVisible(bHasDraft && bIsSalesRep);
            this.byId("btnEdit").setVisible(sStatus === "New" && bIsSalesRep && !bHasDraft);

            // Alice (SalesRep): Delete (when New) + Submit (when New) + Cancel (when New or Submitted)
            // Bob (SalesManager): Approve (when Submitted) + Cancel (when New or Submitted)
            this.byId("btnDelete").setVisible(sStatus === "New" && bIsSalesRep);
            this.byId("btnSubmit").setVisible(sStatus === "New" && bIsSalesRep);
            this.byId("btnApprove").setVisible(sStatus === "Submitted" && bIsSalesManager);
            this.byId("btnCancel").setVisible(
                (sStatus === "New" || sStatus === "Submitted") && (bIsSalesRep || bIsSalesManager)
            );

            // Carol (BillingClerk): Create Invoice (when Approved), View/Send (when Invoiced)
            var bHasInvoice = !!oContext.getProperty("invoice/ID");
            this.byId("btnCreateInvoice").setVisible(sStatus === "Approved" && bIsBillingClerk);
            this.byId("btnViewInvoice").setVisible(sStatus === "Invoiced" && bIsBillingClerk && bHasInvoice);
            this.byId("btnSendInvoice").setVisible(sStatus === "Invoiced" && bIsBillingClerk && bHasInvoice);
            this.byId("invoicePanel").setVisible(bHasInvoice && (bIsBillingClerk || bIsSalesManager || bIsSalesRep));
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

        onContinueDraft: function () {
            var oContext = this.getView().getBindingContext();
            this.getOwnerComponent().getRouter().navTo("orderDraft", { orderID: oContext.getProperty("ID") });
        },

        onEdit: function () {
            var that = this;
            BusyIndicator.show(0);
            var oContext = this.getView().getBindingContext();
            var sOrderID = oContext.getProperty("ID");
            var oAction = oContext.getModel().bindContext("OrderService.draftEdit(...)", oContext);
            oAction.setParameter("PreserveChanges", true);
            oAction.execute().then(function () {
                BusyIndicator.hide();
                that.getOwnerComponent().getRouter().navTo("orderDraft", { orderID: sOrderID });
            }).catch(function (oError) {
                BusyIndicator.hide();
                MessageBox.error(oError.message || "Could not start editing this order.");
            });
        },

        onDelete: function () {
            var that = this;
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            MessageBox.confirm(oBundle.getText("confirmDelete"), {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        BusyIndicator.show(0);
                        var oContext = that.getView().getBindingContext();
                        oContext.delete().then(function () {
                            BusyIndicator.hide();
                            MessageToast.show(oBundle.getText("orderDeleted"));
                            that.getOwnerComponent().getRouter().navTo("salesOrders", {}, true);
                        }).catch(function (oError) {
                            BusyIndicator.hide();
                            MessageBox.error(oError.message || oBundle.getText("deleteFailed"));
                        });
                    }
                }
            });
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
        },

        onCreateInvoice: function () {
            var that = this;
            BusyIndicator.show(0);
            var oContext = this.getView().getBindingContext();
            var oAction = oContext.getModel().bindContext("OrderService.createInvoice(...)", oContext);
            oAction.execute().then(function () {
                BusyIndicator.hide();
                MessageToast.show(that.getView().getModel("i18n").getResourceBundle().getText("invoiceCreated"));
                that.getView().getBindingContext().refresh();
                setTimeout(function () { that._updateButtonVisibility(); }, 300);
            }).catch(function (oError) {
                BusyIndicator.hide();
                MessageBox.error(oError.message || "Failed to create invoice");
            });
        },

        onViewInvoice: function () {
            var oContext = this.getView().getBindingContext();
            var sInvoiceID = oContext.getProperty("invoice/ID");
            if (sInvoiceID) {
                var sUrl = BACKEND_URL + "/odata/v4/order/Invoices(" + sInvoiceID + ")/content";
                window.open(sUrl, "_blank");
            } else {
                MessageBox.error("Invoice not found.");
            }
        },

        onSendInvoice: function () {
            var oContext = this.getView().getBindingContext();
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            // Northwind customers have no email address on file — default the
            // recipient to a test address the clerk can review/override before sending.
            var sCustomerID = oContext.getProperty("customerID");
            var sInvoiceNo = oContext.getProperty("invoice/invoiceNo");
            var sOrderNo = oContext.getProperty("orderNo");

            var oDialogModel = new JSONModel({
                to: sCustomerID ? (sCustomerID + "@example.test") : "",
                subject: oBundle.getText("sendInvoiceDefaultSubject", [sInvoiceNo, sOrderNo]),
                message: oBundle.getText("sendInvoiceDefaultMessage", [sInvoiceNo, sOrderNo])
            });
            this.getView().setModel(oDialogModel, "sendInvoice");

            this._getSendInvoiceDialog().then(function (oDialog) {
                oDialog.open();
            });
        },

        _getSendInvoiceDialog: function () {
            var oView = this.getView();
            if (!this._pSendInvoiceDialog) {
                this._pSendInvoiceDialog = Fragment.load({
                    id: oView.getId(),
                    name: "orderhub.fragments.SendInvoiceDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            return this._pSendInvoiceDialog;
        },

        onSendInvoiceDialogCancel: function () {
            this._getSendInvoiceDialog().then(function (oDialog) {
                oDialog.close();
            });
        },

        onSendInvoiceConfirm: function () {
            var that = this;
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            var oDialogModel = this.getView().getModel("sendInvoice");
            var sEmail = (oDialogModel.getProperty("/to") || "").trim();

            if (!EMAIL_RE.test(sEmail)) {
                MessageBox.error(oBundle.getText("invalidEmail"));
                return;
            }

            this._getSendInvoiceDialog().then(function (oDialog) {
                BusyIndicator.show(0);
                var oContext = that.getView().getBindingContext();
                var oAction = oContext.getModel().bindContext("OrderService.sendInvoice(...)", oContext);
                oAction.setParameter("email", sEmail);
                oAction.execute().then(function () {
                    BusyIndicator.hide();
                    oDialog.close();
                    MessageToast.show(oBundle.getText("invoiceEmailSent"));
                    oContext.refresh();
                }).catch(function (oError) {
                    BusyIndicator.hide();
                    oDialog.close();
                    MessageBox.error(oError.message || oBundle.getText("invoiceEmailFailed"));
                    oContext.refresh(); // Refresh to update mailStatus to FAILED
                });
            });
        }
    });
});
