sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/ui/core/BusyIndicator",
    "sap/ui/Device",
    "orderhub/model/formatter"
], function (Controller, UIComponent, JSONModel, Fragment, MessageBox, BusyIndicator, Device, formatter) {
    "use strict";

    return Controller.extend("orderhub.controller.App", {
        formatter: formatter,

        onInit: function () {
            this.oRouter = UIComponent.getRouterFor(this);
            this.getView().setModel(new JSONModel({ text: "", proposed: null }), "ai");
            // An expanded side nav takes most of a narrow screen; start collapsed there.
            if (this._isNarrow()) {
                this.byId("toolPage").setSideExpanded(false);
            }
        },

        // Width-based, not Device.system.phone: that checks the user agent, so a
        // narrowed desktop browser would still get the expanded nav.
        _isNarrow: function () {
            return Device.resize.width < 1024;
        },

        onSideNavItemSelect: function (oEvent) {
            var sKey = oEvent.getParameter("item").getKey();
            this.oRouter.navTo(sKey);
            if (this._isNarrow()) {
                this.byId("toolPage").setSideExpanded(false);
            }
        },

        onMenuButtonPress: function () {
            var oToolPage = this.byId("toolPage");
            var bSideExpanded = oToolPage.getSideExpanded();
            oToolPage.setSideExpanded(!bSideExpanded);
        },

        onOpenAiAssistant: function () {
            this.getView().getModel("ai").setData({ text: "", proposed: null });
            this._getAiDialog().then(function (oDialog) {
                oDialog.open();
            });
        },

        _getAiDialog: function () {
            var oView = this.getView();
            if (!this._pAiDialog) {
                this._pAiDialog = Fragment.load({
                    id: oView.getId(),
                    name: "orderhub.fragments.AIAssistantDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            return this._pAiDialog;
        },

        onAiDialogClose: function () {
            this._getAiDialog().then(function (oDialog) {
                oDialog.close();
            });
        },

        onAiPropose: function () {
            var that = this;
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            var oAiModel = this.getView().getModel("ai");
            var sText = (oAiModel.getProperty("/text") || "").trim();

            if (!sText) {
                MessageBox.error(oBundle.getText("aiEmptyTextError"));
                return;
            }

            function statusText(sStatus) {
                switch (sStatus) {
                    case "matched": return oBundle.getText("aiMatchMatched");
                    case "ambiguous": return oBundle.getText("aiMatchAmbiguous");
                    case "not_found": return oBundle.getText("aiMatchNotFound");
                    default: return sStatus;
                }
            }

            BusyIndicator.show(0);
            var oModel = this.getView().getModel();
            var oOperation = oModel.bindContext("/proposeOrderFromText(...)");
            oOperation.setParameter("text", sText);
            oOperation.execute().then(function () {
                return oOperation.getBoundContext().requestObject();
            }).then(function (oResult) {
                BusyIndicator.hide();

                if (!oResult.aiAvailable) {
                    MessageBox.error(oBundle.getText("aiNotConfiguredTooltip"));
                    return;
                }

                oResult.customerStatusText = statusText(oResult.customerStatus);
                oResult.items = (oResult.items || []).map(function (oItem) {
                    return Object.assign({}, oItem, { matchStatusText: statusText(oItem.matchStatus) });
                });
                oResult.canCreateDraft = oResult.customerStatus === "matched"
                    && oResult.items.some(function (oItem) { return oItem.matchStatus === "matched"; });

                oAiModel.setProperty("/proposed", oResult);
            }).catch(function (oError) {
                BusyIndicator.hide();
                MessageBox.error(oError.message || that.getView().getModel("i18n").getResourceBundle().getText("aiProposeFailed"));
            });
        },

        onAiCreateDraftOrder: function () {
            var oAiModel = this.getView().getModel("ai");
            var oProposed = oAiModel.getProperty("/proposed");
            if (!oProposed || !oProposed.customerID) {
                return;
            }

            var aItems = oProposed.items
                .filter(function (oItem) { return oItem.matchStatus === "matched"; })
                .map(function (oItem) {
                    return {
                        productID: oItem.productID,
                        productName: oItem.productName,
                        unitPrice: oItem.unitPrice,
                        unitsInStock: oItem.unitsInStock,
                        quantity: oItem.quantity,
                        discount: 0
                    };
                });

            this.getOwnerComponent()._aiDraftItems = {
                customerID: oProposed.customerID,
                items: aItems
            };

            this._getAiDialog().then(function (oDialog) {
                oDialog.close();
            });
            this.oRouter.navTo("createOrder", { customerID: oProposed.customerID });
        }
    });
});
