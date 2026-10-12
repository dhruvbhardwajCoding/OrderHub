'use strict';

/**
 * Centralized business-rule constants.
 *
 * Values that may vary per deployment are read from environment
 * variables with sensible defaults. All other modules should import
 * these constants rather than hard-coding magic numbers.
 */

const APPROVAL_THRESHOLD = Number(process.env.APPROVAL_THRESHOLD) || 5000;
const TAX_RATE           = Number(process.env.TAX_RATE) || 0.10;   // 10 %

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 999;
const MIN_DISCOUNT = 0;
const MAX_DISCOUNT = 25;   // percent

const DEFAULT_CURRENCY = 'USD';

/**
 * Customer-map revenue band thresholds (MAP-04, Should). A customer's
 * confirmed (Approved/Invoiced) order revenue decides the colour of its
 * spot on the map: >= HIGH is "High revenue", >= MEDIUM is "Medium",
 * anything else (including zero orders) is "Low or no orders".
 */
const REVENUE_BAND_HIGH_THRESHOLD   = Number(process.env.REVENUE_BAND_HIGH_THRESHOLD)   || 5000;
const REVENUE_BAND_MEDIUM_THRESHOLD = Number(process.env.REVENUE_BAND_MEDIUM_THRESHOLD) || 1000;

/** Canonical status values — keep in sync with db/schema.cds */
const ORDER_STATUS = Object.freeze({
  NEW:        'New',
  SUBMITTED:  'Submitted',
  APPROVED:   'Approved',
  INVOICED:   'Invoiced',
  CANCELLED:  'Cancelled',
});

/**
 * Allowed status transitions.
 * Key = current status → Value = array of reachable statuses.
 */
const VALID_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.NEW]:       [ORDER_STATUS.SUBMITTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.SUBMITTED]: [ORDER_STATUS.APPROVED,  ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.APPROVED]:  [ORDER_STATUS.INVOICED],   // Phase 3
  [ORDER_STATUS.INVOICED]:  [],                         // terminal
  [ORDER_STATUS.CANCELLED]: [],                         // terminal
});

module.exports = {
  APPROVAL_THRESHOLD,
  TAX_RATE,
  MIN_QUANTITY,
  MAX_QUANTITY,
  MIN_DISCOUNT,
  MAX_DISCOUNT,
  DEFAULT_CURRENCY,
  ORDER_STATUS,
  VALID_TRANSITIONS,
  REVENUE_BAND_HIGH_THRESHOLD,
  REVENUE_BAND_MEDIUM_THRESHOLD,
};
