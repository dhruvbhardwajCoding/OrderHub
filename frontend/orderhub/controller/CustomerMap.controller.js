sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/UIComponent",
    "sap/ui/core/Fragment",
    "sap/ui/core/Item",
    "sap/m/MessageToast",
    "orderhub/model/formatter"
], function (Controller, JSONModel, UIComponent, Fragment, Item, MessageToast, formatter) {
    "use strict";

    // Matches the legend in the view's footer and the revenue bands
    // AnalyticsService.getCustomerLocations() computes server-side (MAP-04).
    var BAND_COLORS = {
        High: "#D04040",
        Medium: "#E9730C",
        Low: "#0854A0"
    };

    return Controller.extend("orderhub.controller.CustomerMap", {
        formatter: formatter,

        onInit: function () {
            this._oMapModel = new JSONModel({
                allCustomers: [],
                customers: [],
                visibleCount: 0,
                busy: false
            });
            this.getView().setModel(this._oMapModel, "map");

            var oRouter = UIComponent.getRouterFor(this);
            if (oRouter) {
                oRouter.getRoute("customerMap").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            this._loadLocations();
        },

        // Customers, their coordinates, order counts and revenue bands all
        // come from AnalyticsService.getCustomerLocations() — a single
        // server-aggregated call, not per-customer client-side joins
        // (same principle as the dashboard: section 7.3).
        _loadLocations: function () {
            var that = this;
            var oAnalyticsModel = this.getOwnerComponent().getModel("analytics");
            if (!oAnalyticsModel) return;

            this._oMapModel.setProperty("/busy", true);
            oAnalyticsModel.bindList("/getCustomerLocations()").requestContexts(0, 1000)
                .then(function (aContexts) {
                    var aCustomers = aContexts.map(function (oContext) { return oContext.getObject(); });
                    that._oMapModel.setProperty("/allCustomers", aCustomers);
                    that._populateCountryFilter(aCustomers);
                    that._applyFilters();
                    that._oMapModel.setProperty("/busy", false);
                })
                .catch(function () {
                    that._oMapModel.setProperty("/busy", false);
                    MessageToast.show(that._text("mapLoadError"));
                });
        },

        _populateCountryFilter: function (aCustomers) {
            var oSelect = this.byId("countrySelect");
            var aExisting = oSelect.getItems();
            for (var i = aExisting.length - 1; i > 0; i--) {
                oSelect.removeItem(aExisting[i]);
                aExisting[i].destroy();
            }

            var aCountries = Array.from(new Set(
                aCustomers.map(function (c) { return c.country; }).filter(Boolean)
            )).sort();

            aCountries.forEach(function (sCountry) {
                oSelect.addItem(new Item({ key: sCountry, text: sCountry }));
            });
        },

        onFilterChange: function () {
            this._applyFilters();
        },

        _applyFilters: function () {
            var aAll = this._oMapModel.getProperty("/allCustomers");
            var sQuery = (this.byId("searchField").getValue() || "").toLowerCase();
            var sCountry = this.byId("countrySelect").getSelectedKey();
            var sBand = this.byId("bandSelect").getSelectedKey();

            var aFiltered = aAll.filter(function (c) {
                if (sQuery) {
                    var sName = (c.customerName || "").toLowerCase();
                    var sCity = (c.city || "").toLowerCase();
                    if (sName.indexOf(sQuery) === -1 && sCity.indexOf(sQuery) === -1) return false;
                }
                if (sCountry && c.country !== sCountry) return false;
                if (sBand && c.revenueBand !== sBand) return false;
                return true;
            });

            this._oMapModel.setProperty("/customers", aFiltered);
            this._oMapModel.setProperty("/visibleCount", aFiltered.length);

            var oMap = this.byId("map");
            oMap.setMarkers(aFiltered.map(function (c) {
                return {
                    customerID: c.customerID,
                    lat: c.latitude,
                    lng: c.longitude,
                    color: BAND_COLORS[c.revenueBand] || BAND_COLORS.Low,
                    label: c.customerName
                };
            }));
            oMap.fitToMarkers();
        },

        onSpotPress: function (oEvent) {
            var sCustomerID = oEvent.getParameter("customerID");
            var oDomRef = oEvent.getParameter("domRef");
            var oCustomer = this._findCustomer(sCustomerID);
            if (!oCustomer || !oDomRef) return;

            this._openPopover(oCustomer, oDomRef);
        },

        onListItemPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("map");
            var oCustomer = oCtx.getObject();
            // A list row has no map marker DOM to anchor to — open near the list item itself.
            this._openPopover(oCustomer, oEvent.getSource().getDomRef());
        },

        _findCustomer: function (sCustomerID) {
            var aAll = this._oMapModel.getProperty("/allCustomers");
            return aAll.filter(function (c) { return c.customerID === sCustomerID; })[0];
        },

        _openPopover: function (oCustomer, oDomRef) {
            var that = this;
            this.getView().setModel(new JSONModel(oCustomer), "spot");

            if (!this._pPopover) {
                this._pPopover = Fragment.load({
                    id: this.getView().getId(),
                    name: "orderhub.fragments.CustomerSpotPopover",
                    controller: this
                }).then(function (oPopover) {
                    that.getView().addDependent(oPopover);
                    return oPopover;
                });
            }
            this._pPopover.then(function (oPopover) {
                oPopover.openBy(oDomRef);
            });
        },

        onOpenCustomerFromPopover: function () {
            var sCustomerID = this.getView().getModel("spot").getProperty("/customerID");
            this._closePopover();
            UIComponent.getRouterFor(this).navTo("customerDetail", { customerID: sCustomerID });
        },

        onNewOrderFromPopover: function () {
            var sCustomerID = this.getView().getModel("spot").getProperty("/customerID");
            this._closePopover();
            UIComponent.getRouterFor(this).navTo("createOrder", { customerID: sCustomerID });
        },

        _closePopover: function () {
            if (this._pPopover) {
                this._pPopover.then(function (oPopover) { oPopover.close(); });
            }
        },

        _text: function (sKey) {
            return this.getView().getModel("i18n").getResourceBundle().getText(sKey);
        }
    });
});
