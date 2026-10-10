'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('northwind');

/** How long to wait for Northwind before giving up (MD-04). Configurable per deployment. */
const TIMEOUT_MS = Number(process.env.NORTHWIND_TIMEOUT_MS) || 8000;

function unavailableError(err) {
  LOG.error('Northwind service call failed', err.stack || err);
  return Object.assign(
    new Error('Northwind service is currently unavailable. Please try again later.'),
    { code: 'NORTHWIND_UNAVAILABLE', status: 502 }
  );
}

function timeoutError(label) {
  return Object.assign(
    new Error(`Northwind service timed out${label ? ` while ${label}` : ''}. Please try again later.`),
    { code: 'NORTHWIND_TIMEOUT', status: 504 }
  );
}

/**
 * Race a promise against a configurable timeout (MD-04: "Handle Northwind
 * being slow or down: timeout, readable error in the UI, no server crash").
 * A slow/hung Northwind call rejects with a clear message and a 504 instead
 * of leaving the request (and the UI's busy indicator) hanging forever.
 */
async function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(label)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Run a CQN query against the connected Northwind service, with a timeout and a uniform, UI-safe error. */
async function run(srv, query, label) {
  try {
    return await withTimeout(srv.run(query), label);
  } catch (err) {
    if (err.code === 'NORTHWIND_TIMEOUT') throw err;
    throw unavailableError(err);
  }
}

/**
 * Fetch a single customer from the Northwind remote service.
 *
 * @param {object} srv        – connected Northwind CDS service
 * @param {string} customerID – e.g. "ALFKI"
 * @returns {Promise<object|null>} customer record or null
 */
async function getCustomer(srv, customerID) {
  const { Customers } = srv.entities;
  const customer = await run(srv, SELECT.one.from(Customers).where({ CustomerID: customerID }), 'reading a customer');
  return customer || null;
}

/**
 * Fetch one or more customers by their IDs (e.g. for analytics joins).
 *
 * @param {object}   srv         – connected Northwind CDS service
 * @param {string[]} customerIDs – e.g. ["ALFKI", "ANATR"]
 * @returns {Promise<object[]>} array of customer records
 */
async function getCustomers(srv, customerIDs) {
  if (!customerIDs || customerIDs.length === 0) return [];
  const { Customers } = srv.entities;
  const customers = await run(srv, SELECT.from(Customers).where({ CustomerID: { in: customerIDs } }), 'reading customers');
  return customers || [];
}

/**
 * Fetch one or more products by their IDs from the Northwind remote service.
 *
 * @param {object}   srv        – connected Northwind CDS service
 * @param {number[]} productIDs – e.g. [1, 14, 2]
 * @returns {Promise<object[]>} array of product records
 */
async function getProducts(srv, productIDs) {
  if (!productIDs || productIDs.length === 0) return [];
  const { Products } = srv.entities;
  const products = await run(srv, SELECT.from(Products).where({ ProductID: { in: productIDs } }), 'reading products');
  return products || [];
}

/**
 * Fetch one or more categories by their IDs (e.g. for analytics joins).
 *
 * @param {object}   srv         – connected Northwind CDS service
 * @param {number[]} categoryIDs – e.g. [1, 2, 3]
 * @returns {Promise<object[]>} array of category records
 */
async function getCategories(srv, categoryIDs) {
  if (!categoryIDs || categoryIDs.length === 0) return [];
  const { Categories } = srv.entities;
  const categories = await run(srv, SELECT.from(Categories).where({ CategoryID: { in: categoryIDs } }), 'reading categories');
  return categories || [];
}

module.exports = { getCustomer, getCustomers, getProducts, getCategories, withTimeout, TIMEOUT_MS };
