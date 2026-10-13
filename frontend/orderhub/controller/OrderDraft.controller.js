sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "orderhub/model/formatter"
], function (Controller, JSONModel, Fragment, MessageBox, MessageToast, formatter) {
    "use strict";

    // SO-08: one screen for both "new order" and "edit order" — bound
    // directly to the draft, so every quantity/discount edit and every
    // add/remove of a product is saved to the server as you type (the v4
    // model's $auto group batches and sends it), not just at the end. The
    // draft editor never writes the active order itself; Save / Save &
    // Submit call OrderService.draftActivate, which is where the server's
    // validateAndPrice() (same logic CreateOrder's one-shot POST used to
    // run inline) actually runs.
    return Controller.extend("orderhub.controller.OrderDraft", {
        formatter: formatter,

        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("orderDraft").attachPatternMatched(this._onPatternMatched, this);
            this.getView().setModel(new JSONModel({ busy: false, stock: {} }), "draftUi");
        },

        _onPatternMatched: function (oEvent) {
            var that = this;
            var sOrderID = oEvent.getParameter("arguments").orderID;
            this._sOrderID = sOrderID;

            var oView = this.getView();
            // HasActiveEntity is only ever read imperatively (onDiscard,
            // below), never from a declarative XML binding, so it needs an
            // explicit $select — same issue, same fix, as SalesOrder
            // .controller.js's HasDraftEntity (verified live there first).
            oView.bindElement({
                path: "/SalesOrders(ID=" + sOrderID + ",IsActiveEntity=false)",
                parameters: {
                    $expand: "items",
                    $select: "HasActiveEntity"
                },
                events: {
                    dataReceived: function () {
                        that._refreshStockMap();
                    }
                }
            });
        },

        _headerContext: function () {
            return this.getView().getBindingContext();
        },

        // Draft items don't carry unitsInStock (not a SalesOrderItems
        // field) — fetched once per product on load/add so the warning
        // badge (formatter.stockWarningVisibleByLookup) has something to
        // look up. Re-fetches every known product each call rather than
        // tracking what's missing — item counts here are small (section 8's
        // "25 items" scale), so this stays cheap.
        _refreshStockMap: function () {
            var oHeaderContext = this._headerContext();
            if (!oHeaderContext) return;

            var aItems = oHeaderContext.getObject().items || [];
            var aProductIDs = aItems.map(function (i) { return i.productID; })
                .filter(function (id, idx, arr) { return id != null && arr.indexOf(id) === idx; });
            if (!aProductIDs.length) return;

            var oModel = this.getView().getModel();
            var oDraftUi = this.getView().getModel("draftUi");
            var aRequests = aProductIDs.map(function (iProductID) {
                return oModel.bindContext("/Products(" + iProductID + ")").requestObject()
                    .then(function (oProduct) {
                        return { id: iProductID, stock: oProduct.UnitsInStock };
                    })
                    .catch(function () { return null; });
            });

            Promise.all(aRequests).then(function (aResults) {
                var oStock = {};
                aResults.forEach(function (r) { if (r) oStock[r.id] = r.stock; });
                oDraftUi.setProperty("/stock", oStock);
            });
        },

        onAddProduct: function () {
            var oView = this.getView();
            if (!this._pProductSelectDialog) {
                this._pProductSelectDialog = Fragment.load({
                    id: oView.getId(),
                    name: "orderhub.fragments.ProductSelectDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pProductSelectDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        onProductSearch: function (oEvent) {
            var sValue = oEvent.getParameter("value");
            var aFilters = [
                new sap.ui.model.Filter("Discontinued", sap.ui.model.FilterOperator.EQ, false)
            ];
            if (sValue) {
                aFilters.push(new sap.ui.model.Filter("ProductName", sap.ui.model.FilterOperator.Contains, sValue));
            }
            var oBinding = oEvent.getSource().getBinding("items");
            oBinding.filter(aFilters, "Application");
        },

        onProductSelectConfirm: function (oEvent) {
            var that = this;
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (!oSelectedItem) return;

            var oProductContext = oSelectedItem.getBindingContext();
            var sProductID = oProductContext.getProperty("ProductID");

            var oItemsBinding = this.byId("itemsTable").getBinding("items");
            var oNewContext = oItemsBinding.create({
                productID: sProductID,
                quantity: 1,
                discount: 0
            });

            oNewContext.created().then(function () {
                that._refreshStockMap();
                return that._refreshHeaderTotals();
            }).catch(function (oError) {
                MessageBox.error(oError.message || "Could not add the product.");
            });
        },

        onRemoveProduct: function (oEvent) {
            var that = this;
            var oItem = oEvent.getSource().getParent();
            var oContext = oItem.getBindingContext();
            oContext.delete().then(function () {
                return that._refreshHeaderTotals();
            }).catch(function (oError) {
                MessageBox.error(oError.message || "Could not remove the product.");
            });
        },

        onItemChange: function () {
            // The Input's own two-way binding already sent the PATCH (v4
            // model, $auto group) — this only needs to refresh the header
            // totals the server recomputed as a side effect of that PATCH.
            this._refreshHeaderTotals();
        },

        _refreshHeaderTotals: function () {
            var oHeaderContext = this._headerContext();
            if (!oHeaderContext) return Promise.resolve();
            return oHeaderContext.requestSideEffects(["netAmount", "taxAmount", "grossAmount"]);
        },

        _validateItems: function (aItems) {
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            if (!aItems || aItems.length === 0) {
                MessageBox.error(oBundle.getText("errorNoItems"));
                return false;
            }
            for (var i = 0; i < aItems.length; i++) {
                var q = parseFloat(aItems[i].quantity);
                var d = parseFloat(aItems[i].discount);
                if (isNaN(q) || !Number.isInteger(q) || q < 1 || q > 999) {
                    MessageBox.error("Quantity must be an integer between 1 and 999.");
                    return false;
                }
                if (isNaN(d) || d < 0 || d > 25) {
                    MessageBox.error("Discount must be between 0 and 25%.");
                    return false;
                }
            }
            return true;
        },

        onDiscard: function () {
            var that = this;
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            MessageBox.confirm(oBundle.getText("confirmDiscard"), {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) return;

                    var oDraftUi = that.getView().getModel("draftUi");
                    oDraftUi.setProperty("/busy", true);

                    var oHeaderContext = that._headerContext();
                    var bHadActiveOrder = !!oHeaderContext.getProperty("HasActiveEntity");
                    var sOrderID = that._sOrderID;

                    oHeaderContext.delete().then(function () {
                        oDraftUi.setProperty("/busy", false);
                        MessageToast.show(oBundle.getText("draftDiscarded"));
                        if (bHadActiveOrder) {
                            that.getOwnerComponent().getRouter().navTo("salesOrder", { orderID: sOrderID }, true);
                        } else {
                            that.getOwnerComponent().getRouter().navTo("salesOrders", {}, true);
                        }
                    }).catch(function (oError) {
                        oDraftUi.setProperty("/busy", false);
                        MessageBox.error(oError.message || "Failed to discard the draft.");
                    });
                }
            });
        },

        onSave: function () {
            var that = this;
            var oHeaderContext = this._headerContext();
            if (!this._validateItems(oHeaderContext.getObject().items)) {
                return;
            }

            var oDraftUi = this.getView().getModel("draftUi");
            oDraftUi.setProperty("/busy", true);
            var sOrderID = this._sOrderID;
            var oModel = this.getView().getModel();

            var oActivate = oModel.bindContext("OrderService.draftActivate(...)", oHeaderContext);
            oActivate.execute().then(function () {
                oDraftUi.setProperty("/busy", false);
                MessageToast.show(that.getView().getModel("i18n").getResourceBundle().getText("draftSaved"));
                that.getOwnerComponent().getRouter().navTo("salesOrder", { orderID: sOrderID }, true);
            }).catch(function (oError) {
                // Activation failed validation (e.g. a product went
                // discontinued, an invalid quantity) — stay on the draft so
                // the clerk can fix it, rather than losing their place.
                oDraftUi.setProperty("/busy", false);
                MessageBox.error(oError.message || "Could not save the order.");
            });
        },

        onSaveAndSubmit: function () {
            var that = this;
            var oHeaderContext = this._headerContext();
            if (!this._validateItems(oHeaderContext.getObject().items)) {
                return;
            }

            var oDraftUi = this.getView().getModel("draftUi");
            oDraftUi.setProperty("/busy", true);
            var sOrderID = this._sOrderID;
            var oModel = this.getView().getModel();

            var oActivate = oModel.bindContext("OrderService.draftActivate(...)", oHeaderContext);
            oActivate.execute().then(function () {
                // Activation merges the draft into the active row under the
                // same ID; the draft row (and oHeaderContext) is now gone,
                // so bind fresh to the active instance before calling submit.
                var oActiveBinding = oModel.bindContext("/SalesOrders(ID=" + sOrderID + ",IsActiveEntity=true)");
                return oActiveBinding.requestObject().then(function () {
                    var oSubmit = oModel.bindContext("OrderService.submit(...)", oActiveBinding.getBoundContext());
                    return oSubmit.execute();
                });
            }).then(function () {
                oDraftUi.setProperty("/busy", false);
                MessageToast.show(that.getView().getModel("i18n").getResourceBundle().getText("orderSubmitted"));
                that.getOwnerComponent().getRouter().navTo("salesOrder", { orderID: sOrderID }, true);
            }).catch(function (oError) {
                oDraftUi.setProperty("/busy", false);
                MessageBox.error(oError.message || "Could not save and submit the order.");
            });
        },

        onNavBack: function () {
            var oHistory = sap.ui.core.routing.History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();
            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("salesOrders", {}, true);
            }
        }
    });
});
