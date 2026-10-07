'use strict';

const { TAX_RATE } = require('./constants');

/**
 * Round a number to two decimal places (banker's-safe).
 */
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate the net amount for a single line item.
 *
 * @param {number} unitPrice  – product unit price
 * @param {number} quantity   – ordered quantity
 * @param {number} [discount] – discount percentage (0-25)
 * @returns {number} item net amount rounded to 2 decimals
 */
function calculateItemNetAmount(unitPrice, quantity, discount = 0) {
  return round2(unitPrice * quantity * (1 - discount / 100));
}

/**
 * Calculate the aggregated totals for an order.
 *
 * @param {Array<{netAmount: number}>} items – line items with netAmount
 * @param {number} [taxRate] – tax rate as decimal (default from constants)
 * @returns {{ netAmount: number, taxAmount: number, grossAmount: number }}
 */
function calculateOrderTotals(items, taxRate = TAX_RATE) {
  const netAmount = round2(
    items.reduce((sum, item) => sum + (item.netAmount || 0), 0)
  );
  const taxAmount   = round2(netAmount * taxRate);
  const grossAmount = round2(netAmount + taxAmount);

  return { netAmount, taxAmount, grossAmount };
}

module.exports = {
  round2,
  calculateItemNetAmount,
  calculateOrderTotals,
};
