'use strict';

const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 8080;

const app = express();

// The UI5 app itself — index.html's own resourceRoots ("orderhub": "./") is
// relative to wherever index.html is served from, so this just needs to be
// the webapp folder's contents served at the root of this origin.
app.use(express.static(path.join(__dirname, 'orderhub')));

app.listen(PORT, () => {
  console.log(`Northwind Order Hub frontend running at http://localhost:${PORT}`);
  console.log('Make sure the backend (cd ../backend && npm run watch) is running too.');
});
