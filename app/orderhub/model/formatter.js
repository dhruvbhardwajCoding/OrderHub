sap.ui.define([], function () {
    "use strict";

    return {
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
