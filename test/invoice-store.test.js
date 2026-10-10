'use strict';

/**
 * Unit tests for the invoice-store facade (DMS-01): dispatch between
 * `local` and `sdm`, and the stream/Buffer normalization that fixed the
 * previously-silent "content column excluded by default" bug (see
 * DECISIONS.md ADR 16/19).
 */

const cds = require('@sap/cds');
const { Readable } = require('stream');

jest.mock('../srv/lib/sdm-client', () => ({
  uploadInvoice: jest.fn(),
  downloadInvoice: jest.fn(),
}));
const sdmClient = require('../srv/lib/sdm-client');
const invoiceStore = require('../srv/lib/invoice-store');

describe('invoice-store', () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete cds.env.requires.invoiceStore;
  });

  describe('kind()', () => {
    test('defaults to "local" when unconfigured', () => {
      expect(invoiceStore.kind()).toBe('local');
    });

    test('reads cds.requires.invoiceStore.kind', () => {
      cds.env.requires.invoiceStore = { kind: 'sdm' };
      expect(invoiceStore.kind()).toBe('sdm');
    });
  });

  describe('saveInvoice()', () => {
    test('local mode stores the PDF bytes directly, no dmsObjectId', async () => {
      const pdf = Buffer.from('pdf-bytes');
      const result = await invoiceStore.saveInvoice(pdf, { invoiceNo: 'INV-1' });

      expect(result).toEqual({ content: pdf, dmsObjectId: null });
      expect(sdmClient.uploadInvoice).not.toHaveBeenCalled();
    });

    test('sdm mode uploads to Document Management and keeps only the object id', async () => {
      cds.env.requires.invoiceStore = { kind: 'sdm' };
      sdmClient.uploadInvoice.mockResolvedValue('doc-123');

      const pdf = Buffer.from('pdf-bytes');
      const metadata = { invoiceNo: 'INV-1', orderNo: 'SO-1', customerID: 'ALFKI', invoiceDate: 'd', year: 2026 };
      const result = await invoiceStore.saveInvoice(pdf, metadata);

      expect(result).toEqual({ content: null, dmsObjectId: 'doc-123' });
      expect(sdmClient.uploadInvoice).toHaveBeenCalledWith(pdf, metadata);
    });

    test('sdm mode failure (DMS-05): the caller gets a clear error and nothing is marked saved', async () => {
      cds.env.requires.invoiceStore = { kind: 'sdm' };
      sdmClient.uploadInvoice.mockRejectedValue(new Error('network unreachable'));

      await expect(invoiceStore.saveInvoice(Buffer.from('x'), { invoiceNo: 'INV-1' }))
        .rejects.toThrow(/Could not store the invoice in Document Management/);
    });
  });

  describe('readInvoice()', () => {
    test('returns a Buffer as-is', async () => {
      const pdf = Buffer.from('pdf-bytes');
      const result = await invoiceStore.readInvoice({ content: pdf, dmsObjectId: null });
      expect(result).toBe(pdf);
    });

    test('converts a Readable stream (what @cap-js/sqlite returns for explicit-column selects) into a Buffer', async () => {
      const stream = Readable.from([Buffer.from('pdf-'), Buffer.from('bytes')]);
      const result = await invoiceStore.readInvoice({ content: stream, dmsObjectId: null });
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('pdf-bytes');
    });

    test('falls back to Document Management when content is empty but dmsObjectId is set', async () => {
      sdmClient.downloadInvoice.mockResolvedValue(Buffer.from('from-dms'));
      const result = await invoiceStore.readInvoice({ content: null, dmsObjectId: 'doc-123' });
      expect(result.toString()).toBe('from-dms');
      expect(sdmClient.downloadInvoice).toHaveBeenCalledWith('doc-123');
    });

    test('Document Management failure surfaces a clear, retryable error (DMS-05)', async () => {
      sdmClient.downloadInvoice.mockRejectedValue(new Error('timeout'));
      await expect(invoiceStore.readInvoice({ content: null, dmsObjectId: 'doc-123' }))
        .rejects.toThrow(/Could not fetch the invoice from Document Management/);
    });

    test('throws when the invoice has neither local content nor a dmsObjectId', async () => {
      await expect(invoiceStore.readInvoice({ content: null, dmsObjectId: null }))
        .rejects.toThrow(/no stored PDF/);
    });
  });
});
