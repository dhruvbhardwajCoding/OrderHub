sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "orderhub/model/CustomerGeoData",
    "sap/ui/core/UIComponent"
], function (Controller, JSONModel, Filter, FilterOperator, CustomerGeoData, UIComponent) {
    "use strict";

    return Controller.extend("orderhub.controller.CustomerMap", {
        onInit: function () {
            this._oCustomerModel = new JSONModel({ customers: [], selectedCustomerID: "" });
            this.getView().setModel(this._oCustomerModel, "customers");

            var oRouter = UIComponent.getRouterFor(this);
            if (oRouter) {
                oRouter.getRoute("customerMap").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            this._loadCustomers();
        },

        _loadCustomers: function () {
            var oModel = this.getView().getModel();
            if (!oModel) return;

            var oList = this.byId("customerList");
            var that = this;

            var oListBinding = oModel.bindList("/Customers");
            oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                var aCustomers = aContexts.map(function (oContext) {
                    var sCustomerID = oContext.getProperty("CustomerID");
                    var oGeo = CustomerGeoData.getCoordinates(sCustomerID);
                    return {
                        CustomerID: sCustomerID,
                        CompanyName: oContext.getProperty("CompanyName"),
                        ContactName: oContext.getProperty("ContactName"),
                        City: oContext.getProperty("City") || "",
                        Country: oContext.getProperty("Country") || "",
                        Phone: oContext.getProperty("Phone") || "",
                        lat: oGeo ? oGeo.lat : null,
                        lng: oGeo ? oGeo.lng : null
                    };
                });

                that._oCustomerModel.setProperty("/customers", aCustomers);

                // Bind the list to the local JSON model
                oList.bindItems({
                    path: "customers>/customers",
                    template: new sap.m.StandardListItem({
                        title: "{customers>CompanyName}",
                        description: "{customers>City}, {customers>Country}",
                        icon: "sap-icon://customer",
                        type: "Active"
                    })
                });

                // Show all customers on the map
                that._showAllCustomersOnMap(aCustomers);

            }).catch(function (oError) {
                // Handle Northwind service unavailability gracefully
                sap.m.MessageToast.show("Could not load customers. Northwind service may be unavailable.");
            });
        },

        _showAllCustomersOnMap: function (aCustomers) {
            // Build markers for all customers that have coordinates
            var aMarkers = [];
            aCustomers.forEach(function (c) {
                if (c.lat && c.lng) {
                    aMarkers.push(
                        "markers=" + c.lat + "," + c.lng
                    );
                }
            });

            // Use OpenStreetMap via an iframe with a centered world view
            var sMapHtml = '<div id="osmMapDiv" style="width:100%;height:100%;position:relative;">' +
                '<iframe ' +
                    'width="100%" height="100%" frameborder="0" scrolling="no" ' +
                    'src="https://www.openstreetmap.org/export/embed.html?bbox=-180,-60,180,80&layer=mapnik" ' +
                    'style="border:0;">' +
                '</iframe>' +
                '<div style="position:absolute;top:10px;left:10px;right:10px;background:rgba(255,255,255,0.92);border-radius:8px;padding:8px 12px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.15);max-height:80%;overflow-y:auto;">' +
                    '<div style="font-weight:bold;margin-bottom:6px;color:#0854a0;">📍 Customer Locations (' + aMarkers.length + ' mapped)</div>' +
                    this._buildCustomerLocationHtml(aCustomers) +
                '</div>' +
            '</div>';

            var oPage = this.byId("detailPage");
            if (oPage) {
                oPage.removeAllContent();
                oPage.addContent(new sap.ui.core.HTML({
                    content: sMapHtml,
                    sanitizeContent: false
                }));
            }
        },

        _buildCustomerLocationHtml: function (aCustomers) {
            var html = '';
            var grouped = {};

            // Group customers by country
            aCustomers.forEach(function (c) {
                if (c.lat && c.lng) {
                    var key = c.Country || "Unknown";
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(c);
                }
            });

            // Sort countries
            var countries = Object.keys(grouped).sort();
            countries.forEach(function (country) {
                html += '<div style="margin-top:4px;">';
                html += '<span style="font-weight:600;color:#333;">🌍 ' + country + '</span>';
                grouped[country].forEach(function (c) {
                    html += '<div style="margin-left:16px;color:#555;padding:1px 0;">';
                    html += '• ' + c.CompanyName + ' <span style="color:#888;">(' + c.City + ')</span>';
                    html += '</div>';
                });
                html += '</div>';
            });

            return html;
        },

        _showCustomerOnMap: function (oCustomer) {
            var oPage = this.byId("detailPage");
            if (!oPage) return;

            if (!oCustomer.lat || !oCustomer.lng) {
                var sMapHtml = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f0f0f0;">' +
                    '<div style="text-align:center;color:#666;">' +
                    '<span style="font-size:48px;">📍</span><br/>' +
                    '<span style="font-size:16px;font-weight:bold;">' + oCustomer.CompanyName + '</span><br/>' +
                    '<span>Location not available</span>' +
                    '</div></div>';
                
                oPage.removeAllContent();
                oPage.addContent(new sap.ui.core.HTML({ content: sMapHtml, sanitizeContent: false }));
                return;
            }

            var fLat = oCustomer.lat;
            var fLng = oCustomer.lng;
            var sName = oCustomer.CompanyName;
            var sCity = oCustomer.City;
            var sCountry = oCustomer.Country;

            // Zoom to customer location on OpenStreetMap
            var sBbox = (fLng - 0.05) + "," + (fLat - 0.03) + "," + (fLng + 0.05) + "," + (fLat + 0.03);
            var sMarker = fLat + "," + fLng;

            var sMapHtml = '<div style="width:100%;height:100%;position:relative;">' +
                '<iframe ' +
                    'width="100%" height="100%" frameborder="0" scrolling="no" ' +
                    'src="https://www.openstreetmap.org/export/embed.html?bbox=' + sBbox + '&layer=mapnik&marker=' + sMarker + '" ' +
                    'style="border:0;">' +
                '</iframe>' +
                '<div style="position:absolute;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.95);border-radius:10px;padding:10px 20px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.2);">' +
                    '<div style="font-weight:bold;font-size:14px;color:#0854a0;">' + sName + '</div>' +
                    '<div style="font-size:12px;color:#666;">' + sCity + ', ' + sCountry + '</div>' +
                    '<div style="font-size:11px;color:#999;margin-top:2px;">📍 ' + fLat.toFixed(4) + ', ' + fLng.toFixed(4) + '</div>' +
                '</div>' +
            '</div>';

            oPage.removeAllContent();
            oPage.addContent(new sap.ui.core.HTML({
                content: sMapHtml,
                sanitizeContent: false
            }));
        },

        onSearchCustomers: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            var oList = this.byId("customerList");
            var oBinding = oList.getBinding("items");

            if (!oBinding) return;

            var aFilters = [];
            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("CompanyName", FilterOperator.Contains, sQuery),
                        new Filter("City", FilterOperator.Contains, sQuery),
                        new Filter("Country", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }
            oBinding.filter(aFilters);
        },

        onCustomerSelect: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var oCtx = oItem.getBindingContext("customers");
            var oCustomer = oCtx.getObject();

            this._oCustomerModel.setProperty("/selectedCustomerID", oCustomer.CustomerID);
            this._showCustomerOnMap(oCustomer);
        },

        onViewCustomerDetails: function () {
            var sCustomerID = this._oCustomerModel.getProperty("/selectedCustomerID");
            if (sCustomerID) {
                var oRouter = UIComponent.getRouterFor(this);
                oRouter.navTo("customerDetail", { customerID: sCustomerID });
            }
        }
    });
});
