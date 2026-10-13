sap.ui.define(["sap/ui/core/format/NumberFormat"], function (NumberFormat) {
    "use strict";

    // NumericContent truncates to 4 characters, so 21699.02 rendered as "2169".
    // Split a short-style number ("21.7K") into the value and scale parts it supports.
    var oShortFormat = NumberFormat.getFloatInstance({ style: "short", maxFractionDigits: 1 });
    function splitShort(fValue) {
        var aMatch = /^([\d.,-]+)\s*(\D*)$/.exec(oShortFormat.format(Number(fValue) || 0));
        return aMatch ? [aMatch[1], aMatch[2]] : [String(fValue), ""];
    }

    return {
        compactValue: function (fValue) {
            return splitShort(fValue)[0];
        },

        compactScale: function (fValue) {
            return splitShort(fValue)[1];
        },

        statusState: function (sStatus) {
            switch (sStatus) {
                case "New":
                    return "None";
                case "Submitted":
                    return "Warning";
                case "Approved":
                    return "Success";
                case "Invoiced":
                    return "Information";
                case "Cancelled":
                    return "Error";
                default:
                    return "None";
            }
        },

        // SO-08: the Sales Orders list shows drafts alongside active orders
        // (an unsaved draft's own `status` defaults to "New" just like a
        // real New order, so the list needs its own text/state that shows
        // "Draft" instead — duplicating statusState's switch rather than
        // calling it, since a formatter referenced as ".formatter.xyz" in
        // XML isn't guaranteed to run with `this` bound to this module).
        orderListStatusText: function (bIsActiveEntity, sStatus, sDraftLabel) {
            return bIsActiveEntity === false ? sDraftLabel : sStatus;
        },

        orderListStatusState: function (bIsActiveEntity, sStatus) {
            if (bIsActiveEntity === false) return "Warning";
            switch (sStatus) {
                case "New":
                    return "None";
                case "Submitted":
                    return "Warning";
                case "Approved":
                    return "Success";
                case "Invoiced":
                    return "Information";
                case "Cancelled":
                    return "Error";
                default:
                    return "None";
            }
        },

        statusIcon: function (sStatus) {
            switch (sStatus) {
                case "New":
                    return "sap-icon://document";
                case "Submitted":
                    return "sap-icon://pending";
                case "Approved":
                    return "sap-icon://accept";
                case "Cancelled":
                    return "sap-icon://decline";
                default:
                    return "sap-icon://document";
            }
        },

        formatCurrency: function (value, currency) {
            if (!value) {
                return "";
            }
            var oCurrencyFormat = sap.ui.core.format.NumberFormat.getCurrencyInstance();
            return oCurrencyFormat.format(value, currency || "USD");
        },

        discontinuedState: function (bDiscontinued) {
            return bDiscontinued ? "Error" : "Success";
        },

        discontinuedText: function (bDiscontinued) {
            return bDiscontinued ? "Yes" : "No";
        },

        formatDate: function (sDate) {
            if (!sDate) {
                return "";
            }
            var oDateFormat = sap.ui.core.format.DateFormat.getDateInstance({ style: "medium" });
            return oDateFormat.format(new Date(sDate));
        },

        submitVisible: function (sStatus, bIsSalesRep) {
            return sStatus === 'New' && bIsSalesRep === true;
        },

        approveVisible: function (sStatus, bIsSalesManager) {
            return sStatus === 'Submitted' && bIsSalesManager === true;
        },

        cancelVisible: function (sStatus, bIsSalesRep, bIsSalesManager) {
            return (sStatus === 'New' || sStatus === 'Submitted') && (bIsSalesRep === true || bIsSalesManager === true);
        },

        mailStatusState: function (sMailStatus) {
            switch (sMailStatus) {
                case "SENT":
                    return "Success";
                case "FAILED":
                    return "Error";
                case "PENDING":
                    return "Warning";
                default:
                    return "None";
            }
        },

        inViewTitle: function (sTemplate, iCount) {
            return (sTemplate || "In view ({0})").replace("{0}", iCount != null ? iCount : 0);
        },

        matchStatusState: function (sStatus) {
            switch (sStatus) {
                case "matched":
                    return "Success";
                case "ambiguous":
                    return "Warning";
                case "not_found":
                    return "Error";
                default:
                    return "None";
            }
        },

        stockWarningVisible: function (iQuantity, iUnitsInStock) {
            return iUnitsInStock != null && Number(iQuantity) > Number(iUnitsInStock);
        },

        // SO-08: the draft editor's items are real OData rows, which don't
        // carry unitsInStock (not a SalesOrderItems field) — the controller
        // fetches it once into a flat {productID: unitsInStock} JSON model
        // and this does the same comparison as stockWarningVisible, but via
        // a lookup in that map instead of a value already on the row.
        stockWarningVisibleByLookup: function (iQuantity, iProductID, oStockMap) {
            if (!oStockMap || iProductID == null) return false;
            var iUnitsInStock = oStockMap[iProductID];
            return iUnitsInStock != null && Number(iQuantity) > Number(iUnitsInStock);
        },

        matchStatusIcon: function (sStatus) {
            switch (sStatus) {
                case "matched":
                    return "sap-icon://accept";
                case "ambiguous":
                    return "sap-icon://alert";
                case "not_found":
                    return "sap-icon://decline";
                default:
                    return "sap-icon://question-mark";
            }
        }
    };
});
