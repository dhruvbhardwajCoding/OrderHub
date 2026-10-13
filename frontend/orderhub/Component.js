sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "sap/ui/model/json/JSONModel"
], function (UIComponent, Device, JSONModel) {
    "use strict";

    // Relative on purpose: locally, frontend/server.js proxies /user-api
    // (and /odata) to the real backend; in production, the App Router does
    // the same proxying from the same origin. Keep in sync with
    // manifest.json's dataSources and the invoice download URL in
    // SalesOrder.controller.js.
    var BACKEND_URL = "";

    return UIComponent.extend("orderhub.Component", {
        metadata: {
            manifest: "json"
        },

        init: function () {
            // call the base component's init function
            UIComponent.prototype.init.apply(this, arguments);

            // enable routing
            this.getRouter().initialize();

            // set the device model
            var oDeviceModel = new JSONModel(Device);
            oDeviceModel.setDefaultBindingMode("OneWay");
            this.setModel(oDeviceModel, "device");

            // set the user model
            var oUserModel = new JSONModel({ user: "", roles: {}, aiAvailable: false });
            this.setModel(oUserModel, "user");

            // Fetch current user with credentials (enables Basic auth prompt)
            fetch(BACKEND_URL + "/user-api/currentUser", { credentials: "include" })
                .then(function (res) {
                    if (res.status === 401) {
                        // Browser should have shown a Basic auth prompt.
                        // If user dismissed it, retry won't help — just log.
                        console.warn("User not authenticated");
                        return null;
                    }
                    return res.json();
                })
                .then(function (data) {
                    if (data) {
                        oUserModel.setData(data);
                    }
                })
                .catch(function (err) {
                    console.error("Failed to load user info", err);
                });
        }
    });
});
