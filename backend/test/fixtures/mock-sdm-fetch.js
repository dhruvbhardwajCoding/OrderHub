'use strict';
// Monkey-patches global.fetch to simulate a CMIS Browser Binding endpoint,
// so the real server can be exercised end-to-end in "sdm" mode without a
// real SAP BTP Document Management instance (see DECISIONS.md ADR 19 and
// section 8.1's "Access" note — DMS is not available on trial accounts).
//
// Used by `npm run demo:hybrid` (see package.json / README) to demo the
// invoiceStore "sdm" code path — folder creation, upload, download, and the
// DMS-05 "unreachable" error path — without any BTP credentials.
//
// Loaded via NODE_OPTIONS=--require, before cds-serve starts.

const store = new Map(); // objectId -> Buffer
const folders = new Set(['/invoices']); // pre-seed to exercise only the year-folder creation path
let nextId = 1;

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url.toString());

  if (u.pathname.endsWith('/oauth/token')) {
    return { ok: true, status: 200, json: async () => ({ access_token: 'mock-token', expires_in: 3600 }) };
  }

  if (options.method === 'GET' && u.searchParams.get('cmisselector') === 'object') {
    const path = u.searchParams.get('path');
    if (folders.has(path)) {
      return { ok: true, status: 200, json: async () => ({ succinctProperties: { 'cmis:objectId': `folder:${path}` } }) };
    }
    return { ok: false, status: 404, statusText: 'Not Found' };
  }

  if (options.method === 'GET' && u.searchParams.get('cmisselector') === 'content') {
    const objectId = u.searchParams.get('objectId');
    const buf = store.get(objectId);
    if (!buf) return { ok: false, status: 404, statusText: 'Not Found' };
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }

  if (options.method === 'POST' && options.body) {
    const action = options.body.get('cmisaction');
    if (action === 'createFolder') {
      const name = options.body.get('propertyValue[0]');
      const parentId = u.searchParams.get('objectId');
      const path = parentId === 'folder:/invoices' ? `/invoices/${name}` : `/${name}`;
      folders.add(path);
      console.log(`[mock-sdm] created folder ${path}`);
      return { ok: true, status: 201, json: async () => ({ succinctProperties: { 'cmis:objectId': `folder:${path}` } }) };
    }
    if (action === 'createDocument') {
      const name = options.body.get('propertyValue[0]');
      const description = options.body.get('propertyValue[2]');
      const media = options.body.get('media');
      const buf = Buffer.from(await media.arrayBuffer());
      const objectId = `doc-${nextId++}`;
      store.set(objectId, buf);
      console.log(`[mock-sdm] uploaded ${name} as ${objectId} (${buf.length} bytes), description="${description}"`);
      return { ok: true, status: 201, json: async () => ({ succinctProperties: { 'cmis:objectId': objectId } }) };
    }
  }

  throw new Error(`[mock-sdm] unexpected fetch: ${options.method || 'GET'} ${url}`);
};

console.log('[mock-sdm] fetch() patched for CMIS mock');
