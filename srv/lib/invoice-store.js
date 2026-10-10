'use strict';

/**
 * Invoice PDF storage, behind one interface with two implementations
 * (DMS-01): `local` keeps the PDF bytes in SQLite (the default under
 * `cds watch`); `sdm` uploads to SAP Document Management, Integration
 * Option and keeps only the CMIS object id locally. Switched entirely by
 * cds.requires.invoiceStore.kind — never by code changes.
 */

const cds = require('@sap/cds');
const LOG = cds.log('invoice-store');
const sdmClient = require('./sdm-client');

function kind() {
  return (cds.env.requires && cds.env.requires.invoiceStore && cds.env.requires.invoiceStore.kind) || 'local';
}

/**
 * @cap-js/sqlite returns a LargeBinary column as a Buffer when it was just
 * written in-memory (e.g. straight out of pdfmake), but as a Node Readable
 * stream when it comes back from an explicit-columns SELECT. Normalize both
 * (and null) into a single Buffer|null so callers never have to care.
 */
async function toBuffer(content) {
  if (content == null) return null;
  if (Buffer.isBuffer(content)) return content;
  const chunks = [];
  for await (const chunk of content) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Persist a newly generated invoice PDF.
 * @returns {Promise<{content: Buffer|null, dmsObjectId: string|null}>}
 *   Exactly one of the two is set, matching the Invoices.content /
 *   Invoices.dmsObjectId columns the caller writes.
 * @throws if the configured store can't take the write (DMS-05): the
 *   caller must not mark the invoice as created.
 */
async function saveInvoice(pdfBuffer, metadata) {
  if (kind() === 'sdm') {
    try {
      const dmsObjectId = await sdmClient.uploadInvoice(pdfBuffer, metadata);
      return { content: null, dmsObjectId };
    } catch (err) {
      LOG.error('Failed to store invoice PDF in Document Management:', err.message);
      throw new Error(`Could not store the invoice in Document Management: ${err.message}`);
    }
  }
  return { content: pdfBuffer, dmsObjectId: null };
}

/**
 * Fetch an invoice's PDF bytes, regardless of which store it lives in.
 * @param {{content: Buffer|null, dmsObjectId: string|null}} invoiceRow
 * @returns {Promise<Buffer>}
 * @throws if the PDF can't be retrieved (DMS-05) — caller shows a clear,
 *   retryable error rather than silently returning nothing.
 */
async function readInvoice(invoiceRow) {
  const local = await toBuffer(invoiceRow.content);
  if (local) return local;

  if (invoiceRow.dmsObjectId) {
    try {
      return await sdmClient.downloadInvoice(invoiceRow.dmsObjectId);
    } catch (err) {
      LOG.error('Failed to fetch invoice PDF from Document Management:', err.message);
      throw new Error(`Could not fetch the invoice from Document Management: ${err.message}`);
    }
  }

  throw new Error('Invoice has no stored PDF.');
}

module.exports = { saveInvoice, readInvoice, kind };
