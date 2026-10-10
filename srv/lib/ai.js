'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('ai');

/**
 * AI feature (section 9, option A — "Order from text"), wrapped in one
 * swappable module so the provider can change without touching the caller.
 * Called only from the CAP server (AI-01); the browser never sees a key.
 *
 * Provider: Google Gemini, via its REST API directly (no SDK dependency —
 * consistent with this project's other thin REST clients, e.g.
 * srv/lib/sdm-client.js). Reads GEMINI_API_KEY at call time (not import
 * time), so isConfigured() reflects the current environment even in tests.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 15000;

function apiKey() {
  return process.env.GEMINI_API_KEY || '';
}

/** AI-02: the rest of the app must work fully with no key configured. */
function isConfigured() {
  return !!apiKey();
}

function unavailableError(detail) {
  return Object.assign(new Error(`The AI service is currently unavailable${detail ? `: ${detail}` : '.'}`), {
    code: 'AI_UNAVAILABLE',
    status: 502,
  });
}

/**
 * Call Gemini's generateContent with a JSON response schema and return the
 * parsed object. Throws AI_NOT_CONFIGURED if no key is set — callers should
 * check isConfigured() first to degrade gracefully instead of surfacing an
 * error (AI-02).
 *
 * @param {string} prompt
 * @param {object} schema — a Gemini responseSchema (OpenAPI-subset) object
 */
async function generateStructured(prompt, schema) {
  const key = apiKey();
  if (!key) {
    throw Object.assign(new Error('AI is not configured (no GEMINI_API_KEY set).'), { code: 'AI_NOT_CONFIGURED', status: 400 });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    LOG.error('Gemini request failed:', err.message);
    throw unavailableError(err.name === 'AbortError' ? 'timed out' : err.message);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    LOG.error(`Gemini returned ${res.status}:`, errText);
    throw unavailableError(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
    && data.candidates[0].content.parts[0].text;
  if (!text) {
    LOG.error('Gemini returned no text in its response:', JSON.stringify(data));
    throw unavailableError('empty response');
  }

  try {
    return JSON.parse(text);
  } catch {
    LOG.error('Gemini returned non-JSON text:', text);
    throw unavailableError('malformed response');
  }
}

const ORDER_EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    customerHint: {
      type: 'STRING',
      description: 'The customer company name or contact mentioned in the email. Empty string if none is mentioned.',
    },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          productHint: { type: 'STRING', description: 'The product name as written in the email' },
          quantity: { type: 'INTEGER' },
        },
        required: ['productHint', 'quantity'],
      },
    },
    deliveryNote: {
      type: 'STRING',
      description: 'Any delivery timing, shipping instruction, or other note that is not a customer or a product. Empty string if none.',
    },
  },
  required: ['items', 'customerHint', 'deliveryNote'],
};

/**
 * Extract a structured, UNVALIDATED draft order from free text (e.g. a
 * pasted customer email). The caller is responsible for matching
 * customerHint/productHint against real Northwind data before anything is
 * saved — this function only does the text → structure step; it never
 * sees or invents Northwind IDs.
 */
async function extractOrderFromText(text) {
  const prompt = 'Extract a structured sales order draft from this customer email.\n'
    + 'Identify the customer being referred to (company name or contact name), and each product mentioned with its quantity.\n'
    + 'Only extract what is explicitly stated in the text — never invent products, quantities or a customer that is not mentioned.\n'
    + "If no customer is mentioned, return an empty string for customerHint.\n"
    + "Put any delivery timing, shipping instruction, or other note that is not a customer or a product into deliveryNote (empty string if there is none).\n\n"
    + `Email:\n"""\n${text}\n"""`;

  return generateStructured(prompt, ORDER_EXTRACTION_SCHEMA);
}

module.exports = { isConfigured, generateStructured, extractOrderFromText };
