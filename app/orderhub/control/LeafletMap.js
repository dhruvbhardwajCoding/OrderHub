sap.ui.define([
    "sap/ui/core/Control",
    "sap/ui/core/ResizeHandler"
], function (Control, ResizeHandler) {
    "use strict";

    /**
     * LeafletMap — a real UI5 control (properties, events, a renderer) that
     * wraps the Leaflet library to render customers on OpenStreetMap tiles.
     *
     * sap.ui.mdc.Geomap is marked experimental and needs a custom
     * GeomapDelegate; this is the spec's accepted fallback #2 instead
     * ("Your own UI5 control, with properties, aggregations and a renderer,
     * that wraps a map library. A raw <div> with Leaflet in a controller
     * does not count.") — see DECISIONS.md for the full rationale.
     *
     * Markers aren't a UI5 aggregation (Leaflet's own objects aren't UI5
     * controls) — set them via setMarkers([{ customerID, lat, lng, color,
     * label }, ...]). Clicking a marker fires `spotPress` with the
     * customer's data and the marker's own DOM element (so the caller can
     * anchor a real sap.m.ResponsivePopover to it, per the section 7.4
     * wireframe).
     */
    return Control.extend("orderhub.control.LeafletMap", {
        metadata: {
            properties: {
                width:     { type: "sap.ui.core.CSSSize", defaultValue: "100%" },
                height:    { type: "sap.ui.core.CSSSize", defaultValue: "500px" },
                centerLat: { type: "float", defaultValue: 20 },
                centerLng: { type: "float", defaultValue: 0 },
                zoom:      { type: "int", defaultValue: 2 }
            },
            events: {
                spotPress: {
                    parameters: {
                        customerID: { type: "string" },
                        domRef: { type: "object" }
                    }
                }
            },
            // Declared explicitly (sap.ui.core.Element normally provides this
            // implicitly) because XMLTemplateProcessor failed to resolve a
            // <layoutData> child on this control without it — reproduced
            // live: identical markup worked on a sibling sap.m.VBox in the
            // same view but not here.
            aggregations: {
                layoutData: { type: "sap.ui.core.LayoutData", multiple: false }
            }
        },

        renderer: {
            apiVersion: 2,
            render: function (oRm, oControl) {
                oRm.openStart("div", oControl);
                oRm.style("width", oControl.getWidth());
                oRm.style("height", oControl.getHeight());
                oRm.openEnd();
                oRm.openStart("div", oControl.getId() + "-canvas");
                oRm.style("width", "100%");
                oRm.style("height", "100%");
                oRm.openEnd();
                oRm.close("div");
                oRm.close("div");
            }
        },

        init: function () {
            this._oMap = null;
            this._aMarkerLayers = [];
            this._aMarkerData = [];
        },

        exit: function () {
            this._destroyMap();
        },

        _destroyMap: function () {
            if (this._sResizeListenerId) {
                ResizeHandler.deregister(this._sResizeListenerId);
                this._sResizeListenerId = null;
            }
            if (this._oMap) {
                this._oMap.remove();
                this._oMap = null;
            }
            this._aMarkerLayers = [];
        },

        onAfterRendering: function () {
            // Every render() call produces a brand-new DOM subtree, so any
            // previous Leaflet instance is now bound to a detached node —
            // always tear down and rebuild against the current one.
            this._destroyMap();

            var sCanvasId = this.getId() + "-canvas";
            this._oMap = window.L.map(sCanvasId, {
                attributionControl: true,
                scrollWheelZoom: true
            }).setView([this.getCenterLat(), this.getCenterLng()], this.getZoom());

            window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors",
                maxZoom: 19
            }).addTo(this._oMap);

            this._renderMarkers();

            // The map sits in a Grid column inside a collapsible side-nav and
            // a pinnable DynamicPageHeader — either can change this control's
            // width/height well after Leaflet has already measured its
            // container, leaving tiles misaligned/gray until it re-measures.
            var that = this;
            this._sResizeListenerId = ResizeHandler.register(this, function () {
                if (that._oMap) that._oMap.invalidateSize();
            });
        },

        /**
         * @param {Array<{customerID:string, lat:number, lng:number, color?:string, label?:string}>} aMarkers
         */
        setMarkers: function (aMarkers) {
            this._aMarkerData = aMarkers || [];
            this._renderMarkers();
            return this;
        },

        /** Fit the map's viewport to the current markers, if any. */
        fitToMarkers: function () {
            if (!this._oMap || !this._aMarkerLayers.length) return this;
            var oGroup = window.L.featureGroup(this._aMarkerLayers);
            this._oMap.fitBounds(oGroup.getBounds().pad(0.15));
            return this;
        },

        _renderMarkers: function () {
            if (!this._oMap) return; // not rendered yet — setMarkers() before first render is fine

            var that = this;
            this._aMarkerLayers.forEach(function (oLayer) { that._oMap.removeLayer(oLayer); });
            this._aMarkerLayers = [];

            this._aMarkerData.forEach(function (oData) {
                if (oData.lat == null || oData.lng == null) return;

                var oMarker = window.L.circleMarker([oData.lat, oData.lng], {
                    radius: 8,
                    color: "#fff",
                    weight: 2,
                    fillColor: oData.color || "#0854a0",
                    fillOpacity: 0.9
                }).addTo(that._oMap);

                if (oData.label) oMarker.bindTooltip(oData.label);

                oMarker.on("click", function () {
                    that.fireSpotPress({
                        customerID: oData.customerID,
                        domRef: oMarker.getElement()
                    });
                });

                that._aMarkerLayers.push(oMarker);
            });
        }
    });
});
