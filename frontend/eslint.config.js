'use strict';

const js = require('@eslint/js');

// server.js: plain Node/CommonJS. orderhub/: browser-side SAPUI5
// (sap.ui.define AMD modules, global `sap`/`jQuery`).
module.exports = [
  js.configs.recommended,

  {
    ignores: ['node_modules/**'],
  },

  {
    files: ['server.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
      },
    },
  },

  {
    files: ['orderhub/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        sap: 'readonly',
        jQuery: 'readonly',
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
