'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('northwind');

/**
 * Fetch a single customer from the Northwind remote service.
 *
 * @param {object} srv        – connected Northwind CDS service
 * @param {string} customerID – e.g. "ALFKI"
 * @returns {Promise<object|null>} customer record or null
 */
async function getCustomer(srv, customerID) {
  try {
    const { Customers } = srv.entities;
    const customer = await srv.run(
      SELECT.one.from(Customers).where({ CustomerID: customerID })
    );
    return customer || null;
  } catch (err) {
    LOG.error('Failed to read customer from Northwind', err.stack || err);
    throw Object.assign(
      new Error('Northwind service is currently unavailable. Please try again later.'),
      { code: 'NORTHWIND_UNAVAILABLE', status: 502 }
    );
  }
}

/**
 * Fetch one or more products by their IDs from the Northwind remote service.
 *
 * @param {object}   srv        – connected Northwind CDS service
 * @param {number[]} productIDs – e.g. [1, 14, 2]
 * @returns {Promise<object[]>} array of product records
 */
async function getProducts(srv, productIDs) {
  try {
    const { Products } = srv.entities;
    const products = await srv.run(
      SELECT.from(Products).where({ ProductID: { in: productIDs } })
    );
    return products || [];
  } catch (err) {
    LOG.error('Failed to read products from Northwind', err.stack || err);
    throw Object.assign(
      new Error('Northwind service is currently unavailable. Please try again later.'),
      { code: 'NORTHWIND_UNAVAILABLE', status: 502 }
    );
  }
}

module.exports = { getCustomer, getProducts };
