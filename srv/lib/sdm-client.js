'use strict';

/**
 * Minimal CMIS Browser Binding client for SAP Document Management Service,
 * Integration Option (DMS-02). Talks straight to the service's REST API
 * rather than pulling in the @cap-js/sdm plugin — see DECISIONS.md ADR 19
 * for why.
 *
 * Credentials come from cds.requires.sdm.credentials, matching the shape of
 * a Document Management, Integration Option service key:
 *   { url, repositoryId, uaa: { url, clientid, clientsecret } }
 * `cds bind` (or VCAP_SERVICES in production) fills this in; see
 * .env.example for the local/manual override via env vars.
 */

const cds = require('@sap/cds');
const LOG = cds.log('sdm-client');

let cachedToken = null; // { value, expiresAt }

function config() {
  const creds = cds.env.requires && cds.env.requires.sdm && cds.env.requires.sdm.credentials;
  if (!creds || !creds.url || !creds.repositoryId || !creds.uaa || !creds.uaa.clientid) {
    return null;
  }
  return creds;
}

/** Thrown for any failure talking to Document Management — callers treat this as DMS-05 "unreachable". */
class SdmUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'SdmUnavailableError';
    this.cause = cause;
  }
}

async function getAccessToken(creds) {
  const SAFETY_MARGIN_MS = 30_000;
  if (cachedToken && cachedToken.expiresAt > Date.now() + SAFETY_MARGIN_MS) {
    return cachedToken.value;
  }

  const tokenUrl = `${creds.uaa.url.replace(/\/$/, '')}/oauth/token`;
  const basic = Buffer.from(`${creds.uaa.clientid}:${creds.uaa.clientsecret}`).toString('base64');

  let res;
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
  } catch (err) {
    throw new SdmUnavailableError(`Could not reach SDM authentication endpoint: ${err.message}`, err);
  }
  if (!res.ok) {
    throw new SdmUnavailableError(`SDM authentication failed (${res.status} ${res.statusText})`);
  }

  const json = await res.json();
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

/**
 * One CMIS Browser Binding call against the repository root.
 * @param {object} creds
 * @param {{method?: string, query?: object, formData?: FormData}} opts
 */
async function cmisCall(creds, { method = 'GET', query = {}, formData } = {}) {
  const token = await getAccessToken(creds);
  const url = new URL(`${creds.url.replace(/\/$/, '')}/browser/${creds.repositoryId}/root`);
  for (const [key, value] of Object.entries(query)) {
    if (value != null) url.searchParams.set(key, String(value));
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
  } catch (err) {
    throw new SdmUnavailableError(`Could not reach Document Management: ${err.message}`, err);
  }
  return res;
}

/** Look up an object's CMIS id by its repository path. Returns null if it doesn't exist. */
async function resolveObjectId(creds, path) {
  const res = await cmisCall(creds, { query: { cmisselector: 'object', succinct: 'true', path } });
  if (res.status === 404) return null;
  if (!res.ok) throw new SdmUnavailableError(`SDM path lookup failed for '${path}' (${res.status})`);
  const json = await res.json();
  return json.succinctProperties['cmis:objectId'];
}

/** Ensure `/invoices/<year>` exists under the repository root, creating missing segments. Returns the final folder's objectId. */
async function ensureFolder(creds, segments) {
  let parentId = null; // root
  let currentPath = '';

  for (const name of segments) {
    currentPath += `/${name}`;
    let objectId = await resolveObjectId(creds, currentPath);

    if (!objectId) {
      const form = new FormData();
      form.set('cmisaction', 'createFolder');
      form.set('propertyId[0]', 'cmis:name');
      form.set('propertyValue[0]', name);
      form.set('propertyId[1]', 'cmis:objectTypeId');
      form.set('propertyValue[1]', 'cmis:folder');
      form.set('succinct', 'true');

      const res = await cmisCall(creds, {
        method: 'POST',
        query: parentId ? { objectId: parentId } : {},
        formData: form,
      });
      if (!res.ok) throw new SdmUnavailableError(`SDM could not create folder '${currentPath}' (${res.status})`);
      const json = await res.json();
      objectId = json.succinctProperties['cmis:objectId'];
    }

    parentId = objectId;
  }

  return parentId;
}

/**
 * Upload an invoice PDF to /invoices/<year>/<invoiceNo>.pdf (DMS-02), tagging
 * it with the order number, customer ID and invoice date as a CMIS
 * description (DMS-04) so it can be identified directly in the repository.
 *
 * @returns {Promise<string>} the new document's CMIS object id
 */
async function uploadInvoice(pdfBuffer, { invoiceNo, orderNo, customerID, invoiceDate, year }) {
  const creds = config();
  if (!creds) throw new SdmUnavailableError('Document Management is not configured (missing sdm credentials).');

  try {
    const folderId = await ensureFolder(creds, ['invoices', String(year)]);

    const form = new FormData();
    form.set('cmisaction', 'createDocument');
    form.set('propertyId[0]', 'cmis:name');
    form.set('propertyValue[0]', `${invoiceNo}.pdf`);
    form.set('propertyId[1]', 'cmis:objectTypeId');
    form.set('propertyValue[1]', 'cmis:document');
    form.set('propertyId[2]', 'cmis:description');
    form.set('propertyValue[2]', `orderNo=${orderNo};customerID=${customerID};invoiceDate=${invoiceDate}`);
    form.set('succinct', 'true');
    form.set('media', new Blob([pdfBuffer], { type: 'application/pdf' }), `${invoiceNo}.pdf`);

    const res = await cmisCall(creds, { method: 'POST', query: { objectId: folderId }, formData: form });
    if (!res.ok) throw new SdmUnavailableError(`SDM document upload failed (${res.status} ${res.statusText})`);

    const json = await res.json();
    const objectId = json.succinctProperties['cmis:objectId'];
    LOG.info(`Uploaded ${invoiceNo}.pdf to Document Management as ${objectId}`);
    return objectId;
  } catch (err) {
    if (err instanceof SdmUnavailableError) throw err;
    throw new SdmUnavailableError(`Document Management upload failed: ${err.message}`, err);
  }
}

/** Download a document's bytes by CMIS object id. */
async function downloadInvoice(objectId) {
  const creds = config();
  if (!creds) throw new SdmUnavailableError('Document Management is not configured (missing sdm credentials).');

  const res = await cmisCall(creds, { query: { objectId, cmisselector: 'content' } });
  if (!res.ok) throw new SdmUnavailableError(`SDM document download failed (${res.status} ${res.statusText})`);

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  uploadInvoice,
  downloadInvoice,
  isConfigured: () => !!config(),
  SdmUnavailableError,
  /** @private exposed for tests only */
  _resetTokenCache: () => { cachedToken = null; },
};
