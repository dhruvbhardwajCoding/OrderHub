'use strict';

/**
 * Unit tests for the CMIS Browser Binding client (DMS-02), against a mocked
 * fetch — there is no SAP BTP Document Management instance available to this
 * assessment (see DECISIONS.md ADR 19 and section 8.1's "Access" note).
 */

const cds = require('@sap/cds');
const sdmClient = require('../srv/lib/sdm-client');

const CREDS = {
  url: 'https://ecm.example.com',
  repositoryId: 'repo-1',
  uaa: { url: 'https://uaa.example.com', clientid: 'client-1', clientsecret: 'secret-1' },
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  };
}

describe('sdm-client', () => {
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    cds.env.requires.sdm = { credentials: CREDS };
    sdmClient._resetTokenCache();

    global.fetch = jest.fn(async (url, options) => {
      fetchCalls.push({ url: url.toString(), options });

      if (url.toString().includes('/oauth/token')) {
        return jsonResponse({ access_token: 'tok-123', expires_in: 3600 });
      }

      const u = new URL(url.toString());

      // Folder/document lookup by path -> always "not found" so create is exercised
      if (options.method === 'GET' && u.searchParams.get('cmisselector') === 'object') {
        return jsonResponse({}, 404);
      }

      if (options.method === 'POST' && options.body) {
        const action = options.body.get ? options.body.get('cmisaction') : null;
        if (action === 'createFolder') {
          const name = options.body.get('propertyValue[0]');
          return jsonResponse({ succinctProperties: { 'cmis:objectId': `folder-${name}` } }, 201);
        }
        if (action === 'createDocument') {
          return jsonResponse({ succinctProperties: { 'cmis:objectId': 'doc-999' } }, 201);
        }
      }

      if (u.searchParams.get('cmisselector') === 'content') {
        const buf = Buffer.from('pdf-bytes');
        return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  afterEach(() => {
    delete global.fetch;
    delete cds.env.requires.sdm;
  });

  test('isConfigured() is false without credentials', () => {
    delete cds.env.requires.sdm;
    expect(sdmClient.isConfigured()).toBe(false);
  });

  test('isConfigured() is true with full credentials', () => {
    expect(sdmClient.isConfigured()).toBe(true);
  });

  test('uploadInvoice() creates missing /invoices/<year> folders, then uploads the document', async () => {
    const objectId = await sdmClient.uploadInvoice(Buffer.from('pdf-bytes'), {
      invoiceNo: 'INV-2026-00001', orderNo: 'SO-2026-00001', customerID: 'ALFKI',
      invoiceDate: '2026-10-09T00:00:00Z', year: 2026,
    });

    expect(objectId).toBe('doc-999');

    const folderCalls = fetchCalls.filter(c => c.options.body && c.options.body.get && c.options.body.get('cmisaction') === 'createFolder');
    expect(folderCalls).toHaveLength(2); // "invoices", then "2026"
    expect(folderCalls[0].options.body.get('propertyValue[0]')).toBe('invoices');
    expect(folderCalls[1].options.body.get('propertyValue[0]')).toBe('2026');

    const docCall = fetchCalls.find(c => c.options.body && c.options.body.get && c.options.body.get('cmisaction') === 'createDocument');
    expect(docCall.options.body.get('propertyValue[0]')).toBe('INV-2026-00001.pdf');
    expect(docCall.options.body.get('propertyValue[1]')).toBe('cmis:document');
    expect(docCall.options.body.get('propertyValue[2]')).toMatch(/orderNo=SO-2026-00001/);
    expect(docCall.options.body.get('propertyValue[2]')).toMatch(/customerID=ALFKI/);
  });

  test('uploadInvoice() authenticates once and reuses the cached token', async () => {
    await sdmClient.uploadInvoice(Buffer.from('a'), { invoiceNo: 'INV-1', orderNo: 'SO-1', customerID: 'X', invoiceDate: 'd', year: 2026 });
    await sdmClient.uploadInvoice(Buffer.from('b'), { invoiceNo: 'INV-2', orderNo: 'SO-2', customerID: 'Y', invoiceDate: 'd', year: 2026 });

    const tokenCalls = fetchCalls.filter(c => c.url.includes('/oauth/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  test('uploadInvoice() throws a clear error when not configured', async () => {
    delete cds.env.requires.sdm;
    await expect(sdmClient.uploadInvoice(Buffer.from('x'), { invoiceNo: 'INV-1', orderNo: 'SO-1', customerID: 'X', invoiceDate: 'd', year: 2026 }))
      .rejects.toThrow(/not configured/);
  });

  test('uploadInvoice() wraps a network failure as SdmUnavailableError (DMS-05)', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    await expect(sdmClient.uploadInvoice(Buffer.from('x'), { invoiceNo: 'INV-1', orderNo: 'SO-1', customerID: 'X', invoiceDate: 'd', year: 2026 }))
      .rejects.toThrow(sdmClient.SdmUnavailableError);
  });

  test('uploadInvoice() wraps an HTTP error response as SdmUnavailableError', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.toString().includes('/oauth/token')) return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      return { ok: false, status: 500, statusText: 'Internal Server Error' };
    });
    await expect(sdmClient.uploadInvoice(Buffer.from('x'), { invoiceNo: 'INV-1', orderNo: 'SO-1', customerID: 'X', invoiceDate: 'd', year: 2026 }))
      .rejects.toThrow(sdmClient.SdmUnavailableError);
  });

  test('downloadInvoice() returns a Buffer of the document bytes', async () => {
    const buffer = await sdmClient.downloadInvoice('doc-999');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString()).toBe('pdf-bytes');
  });

  test('downloadInvoice() throws a clear error when not configured', async () => {
    delete cds.env.requires.sdm;
    await expect(sdmClient.downloadInvoice('doc-999')).rejects.toThrow(/not configured/);
  });
});
