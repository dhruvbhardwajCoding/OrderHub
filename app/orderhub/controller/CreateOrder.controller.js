sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/BusyIndicator"
], function (Controller, JSONModel, Fragment, MessageBox, MessageToast, BusyIndicator) {
    "use strict";

    return Controller.extend("orderhub.controller.CreateOrder", {

        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createOrder").attachPatternMatched(this._onPatternMatched, this);

            var oOrderModel = new JSONModel({
                customerID: "",
                customerName: "",
                city: "",
                country: "",
                items: []
            });
            this.getView().setModel(oOrderModel, "orderModel");
        },

        _onPatternMatched: function (oEvent) {
            var sCustomerID = oEvent.getParameter("arguments").customerID;
            var oOrderModel = this.getView().getModel("orderModel");
            
            // Reset items
            oOrderModel.setProperty("/items", []);
            
            var oModel = this.getView().getModel();
            var oContextBinding = oModel.bindContext("/Customers('" + sCustomerID + "')");
            oContextBinding.requestObject().then(function (oData) {
                oOrderModel.setProperty("/customerID", oData.CustomerID);
                oOrderModel.setProperty("/customerName", oData.CompanyName);
                oOrderModel.setProperty("/city", oData.City);
                oOrderModel.setProperty("/country", oData.Country);
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
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (oSelectedItem) {
                var oContext = oSelectedItem.getBindingContext();
                var sProductID = oContext.getProperty("ProductID");
                var sProductName = oContext.getProperty("ProductName");
                var sUnitPrice = oContext.getProperty("UnitPrice");

                var oOrderModel = this.getView().getModel("orderModel");
                var aItems = oOrderModel.getProperty("/items");
                
                aItems.push({
                    productID: sProductID,
                    productName: sProductName,
                    unitPrice: sUnitPrice,
                    quantity: 1,
                    discount: 0
                });
                
                oOrderModel.setProperty("/items", aItems);
            }
        },

        onRemoveProduct: function (oEvent) {
            var oItem = oEvent.getSource().getParent();
            var sPath = oItem.getBindingContext("orderModel").getPath();
            var iIndex = parseInt(sPath.split("/").pop(), 10);
            
            var oOrderModel = this.getView().getModel("orderModel");
            var aItems = oOrderModel.getProperty("/items");
            
            aItems.splice(iIndex, 1);
            oOrderModel.setProperty("/items", aItems);
        },

        _validateOrder: function (aItems) {
            if (!aItems || aItems.length === 0) {
                MessageBox.error(this.getView().getModel("i18n").getResourceBundle().getText("errorNoItems") || "Add at least one item.");
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

        onSaveOrder: function () {
            var that = this;
            var oOrderModel = this.getView().getModel("orderModel");
            var oData = oOrderModel.getData();
            
            if (!this._validateOrder(oData.items)) {
                return;
            }
            
            var aPayloadItems = oData.items.map(function (item) {
                return {
                    productID: parseInt(item.productID, 10),
                    quantity: parseInt(item.quantity, 10),
                    discount: parseFloat(item.discount)
                };
            });
            
            var oPayload = {
                customerID: oData.customerID,
                currency_code: "USD",
                items: aPayloadItems
            };

            BusyIndicator.show(0);
            var oModel = this.getView().getModel();
            var oListBinding = oModel.bindList("/SalesOrders");
            var oContext = oListBinding.create(oPayload);
            
            oContext.created().then(function () {
                BusyIndicator.hide();
                MessageToast.show("Order created successfully.");
                that.getOwnerComponent().getRouter().navTo("salesOrder", { orderID: oContext.getProperty("ID") });
            }).catch(function (oError) {
                BusyIndicator.hide();
                MessageBox.error(oError.message || "Failed to create order.");
            });
        },

        onSubmitOrder: function () {
            var that = this;
            var oOrderModel = this.getView().getModel("orderModel");
            var oData = oOrderModel.getData();
            
            if (!this._validateOrder(oData.items)) {
                return;
            }
            
            var aPayloadItems = oData.items.map(function (item) {
                return {
                    productID: parseInt(item.productID, 10),
                    quantity: parseInt(item.quantity, 10),
                    discount: parseFloat(item.discount)
                };
            });
            
            var oPayload = {
                customerID: oData.customerID,
                currency_code: "USD",
                items: aPayloadItems
            };

            BusyIndicator.show(0);
            var oModel = this.getView().getModel();
            var oListBinding = oModel.bindList("/SalesOrders");
            var oContext = oListBinding.create(oPayload);
            
            oContext.created().then(function () {
                var oAction = oModel.bindContext("OrderService.submit(...)", oContext);
                return oAction.execute();
            }).then(function () {
                BusyIndicator.hide();
                MessageToast.show("Order submitted successfully.");
                that.getOwnerComponent().getRouter().navTo("salesOrder", { orderID: oContext.getProperty("ID") });
            }).catch(function (oError) {
                BusyIndicator.hide();
                MessageBox.error(oError.message || "Failed to submit order.");
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
