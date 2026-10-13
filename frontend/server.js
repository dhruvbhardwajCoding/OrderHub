'use strict';

const express = require('express');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4004';

const app = express();

// manifest.json's dataSources and Component.js/SalesOrder.controller.js's
// fetch calls use relative paths (/odata/v4/*, /user-api/*) so the same
// built UI5 app works unchanged behind the production App Router (which
// proxies those same paths to the deployed backend) and here in local dev.
// This proxy is what makes that true locally: it forwards each request to
// the real backend and streams the response straight back, headers (incl.
// WWW-Authenticate, for the browser's native Basic Auth prompt) and status
// code untouched, so from the browser's perspective nothing changes versus
// the old direct cross-origin call.
function proxy(req, res) {
  const target = new URL(req.originalUrl, BACKEND_URL);
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    console.error('Proxy to backend failed:', err.message);
    res.status(502).json({ error: 'Backend unavailable' });
  });
  req.pipe(upstream);
}

app.use('/odata', proxy);
app.use('/user-api', proxy);

// The UI5 app itself — index.html's own resourceRoots ("orderhub": "./") is
// relative to wherever index.html is served from, so this just needs to be
// the webapp folder's contents served at the root of this origin.
app.use(express.static(path.join(__dirname, 'orderhub')));

app.listen(PORT, () => {
  console.log(`Northwind Order Hub frontend running at http://localhost:${PORT}`);
  console.log('Make sure the backend (cd ../backend && npm run watch) is running too.');
});
