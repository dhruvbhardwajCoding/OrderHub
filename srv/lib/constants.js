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
};
