'use strict';

const js = require('@eslint/js');

// Backend only — the frontend moved to ../frontend/ (its own package, its
// own eslint.config.js) when the two were decoupled into separately-run
// services. srv/, test/, and root config files are Node.js CommonJS
// (require/module.exports).
module.exports = [
  js.configs.recommended,

  {
    ignores: ['node_modules/**', 'db.sqlite*', 'gen/**', '@cds-models/**', 'test/fixtures/mock-sdm-fetch.js'],
  },

  {
    files: ['srv/**/*.js', 'test/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        AbortController: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setImmediate: 'readonly',
        // CAP's CQN query builders (SELECT, INSERT, UPDATE, DELETE) are
        // injected as real globals by @sap/cds at runtime.
        SELECT: 'readonly',
        INSERT: 'readonly',
        UPDATE: 'readonly',
        DELETE: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },

  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
  },
];
