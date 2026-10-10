'use strict';

/**
 * Unit tests for the Gemini AI client (AI-01, AI-02), against a mocked
 * fetch. Must stay deterministic even when a developer's own .env has a
 * real GEMINI_API_KEY in it (CAP loads .env into process.env on startup) —
 * hence clearing these vars in beforeEach, not just afterEach.
 */

describe('ai', () => {
  let ai;

  function freshAi(envOverrides) {
    jest.resetModules();
    Object.assign(process.env, envOverrides);
    const freshAiModule = require('../srv/lib/ai');
    // jest.resetModules() also evicts @sap/cds from the registry, and
    // re-requiring it reloads .env — which can re-inject a developer's own
    // real GEMINI_API_KEY right after beforeEach cleared it. Strip it back
    // out unless this specific test asked for a key.
    if (!('GEMINI_API_KEY' in envOverrides)) {
      delete process.env.GEMINI_API_KEY;
    }
    return freshAiModule;
  }

  function clearAiEnv() {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.AI_TIMEOUT_MS;
  }

  beforeEach(clearAiEnv);

  afterEach(() => {
    delete global.fetch;
    clearAiEnv();
  });

  describe('isConfigured()', () => {
    test('is false with no GEMINI_API_KEY', () => {
      ai = freshAi({});
      expect(ai.isConfigured()).toBe(false);
    });

    test('is true once GEMINI_API_KEY is set', () => {
      ai = freshAi({ GEMINI_API_KEY: 'test-key' });
      expect(ai.isConfigured()).toBe(true);
    });
  });

  describe('generateStructured()', () => {
    test('throws AI_NOT_CONFIGURED (400) when no key is set, without calling fetch', async () => {
      ai = freshAi({});
      global.fetch = jest.fn();

      await expect(ai.generateStructured('prompt', {})).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', status: 400 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('posts the prompt and schema to the configured model, and parses the JSON response', async () => {
      ai = freshAi({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-test-model' });
      let capturedUrl, capturedBody;
      global.fetch = jest.fn(async (url, options) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ hello: 'world' }) }] } }],
          }),
        };
      });

      const result = await ai.generateStructured('extract this', { type: 'OBJECT' });

      expect(result).toEqual({ hello: 'world' });
      expect(capturedUrl).toContain('gemini-test-model');
      expect(capturedUrl).toContain('key=test-key');
      expect(capturedBody.contents[0].parts[0].text).toBe('extract this');
      expect(capturedBody.generationConfig.responseMimeType).toBe('application/json');
      expect(capturedBody.generationConfig.responseSchema).toEqual({ type: 'OBJECT' });
    });

    test('wraps a network failure as AI_UNAVAILABLE (502)', async () => {
      ai = freshAi({ GEMINI_API_KEY: 'test-key' });
      global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });

      await expect(ai.generateStructured('p', {})).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', status: 502 });
    });

    test('wraps a non-OK HTTP response as AI_UNAVAILABLE', async () => {
      ai = freshAi({ GEMINI_API_KEY: 'test-key' });
      global.fetch = jest.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }));

      await expect(ai.generateStructured('p', {})).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', status: 502 });
    });

    test('wraps a response with no text as AI_UNAVAILABLE', async () => {
      ai = freshAi({ GEMINI_API_KEY: 'test-key' });
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }));

      await expect(ai.generateStructured('p', {})).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    });

    test('wraps a non-JSON text response as AI_UNAVAILABLE rather than throwing a raw parse error', async () => {
      ai = freshAi({ GEMINI_API_KEY: 'test-key' });
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }),
      }));

      await expect(ai.generateStructured('p', {})).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    });
  });

  describe('extractOrderFromText()', () => {
    test('sends the email text embedded in the prompt and returns the parsed extraction', async () => {
      ai = freshAi({ GEMINI_API_KEY: 'test-key' });
      let capturedBody;
      global.fetch = jest.fn(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    customerHint: 'Alfreds',
                    items: [{ productHint: 'Chai', quantity: 20 }],
                    deliveryNote: 'next week',
                  }),
                }],
              },
            }],
          }),
        };
      });

      const result = await ai.extractOrderFromText('Please send 20 Chai to Alfreds, delivery next week');

      expect(result.customerHint).toBe('Alfreds');
      expect(result.items).toEqual([{ productHint: 'Chai', quantity: 20 }]);
      expect(capturedBody.contents[0].parts[0].text).toContain('Please send 20 Chai to Alfreds');
    });
  });
});
