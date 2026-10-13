sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox"
], function (Controller, MessageBox) {
    "use strict";

    // SO-08: this screen's only job now is to create a draft and hand off
    // to the real editor (OrderDraft) — it used to hold its own form and
    // save/submit logic, which is now OrderDraft's job (bound to the draft
    // itself, saving as you type, rather than one JSON model held locally
    // and posted in one shot at the end).
    return Controller.extend("orderhub.controller.CreateOrder", {

        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createOrder").attachPatternMatched(this._onPatternMatched, this);
        },

        _onPatternMatched: function (oEvent) {
            var that = this;
            var sCustomerID = oEvent.getParameter("arguments").customerID;
            var oModel = this.getView().getModel();

            // AI assistant (AI-01/AI-02): a draft proposed from pasted email
            // text is handed off here via a one-shot stash on the component
            // rather than a new backend endpoint — order creation still goes
            // through the same draft-then-activate flow as a manually built
            // order, just pre-filled.
            var oComponent = this.getOwnerComponent();
            var oAiDraft = oComponent._aiDraftItems;
            var aSeedItems = [];
            if (oAiDraft && oAiDraft.customerID === sCustomerID) {
                delete oComponent._aiDraftItems;
                aSeedItems = oAiDraft.items || [];
            }

            var oListBinding = oModel.bindList("/SalesOrders");
            var oContext = oListBinding.create({ customerID: sCustomerID, currency_code: "USD" });

            oContext.created().then(function () {
                var sOrderID = oContext.getProperty("ID");

                // Individual item POSTs, not a deep insert with the order
                // itself — a deep-inserted item's product name/price are
                // only filled in at activation (verified live), so adding
                // each AI-seeded item as its own request means the draft
                // editor can show them correctly right away instead of
                // blank until the clerk's first edit triggers a refresh.
                var oItemsBinding = oModel.bindList("/SalesOrders(ID=" + sOrderID + ",IsActiveEntity=false)/items");
                var aCreated = aSeedItems.map(function (oItem) {
                    return oItemsBinding.create({
                        productID: oItem.productID,
                        quantity: oItem.quantity,
                        discount: oItem.discount || 0
                    }).created();
                });

                return Promise.all(aCreated).then(function () {
                    that.getOwnerComponent().getRouter().navTo("orderDraft", { orderID: sOrderID }, true);
                });
            }).catch(function (oError) {
                MessageBox.error(oError.message || "Failed to start the order.");
            });
        }
    });
});
