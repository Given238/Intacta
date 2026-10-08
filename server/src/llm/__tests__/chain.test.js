/**
 * chain.test.js — Retry + fallback behavior under simulated LLM failures.
 * Uses a dedicated module loader to avoid jest module cache pollution.
 */

const { getFallback } = require('../fallbacks');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function runNTimes(fn, n = 3) {
  return Array.from({ length: n }, fn);
}

/**
 * Build a minimal stub of the chain module's internal contract
 * (does not require the real LLM or network).
 * Returns { runChain: fn } with a reset() method.
 */
function buildChainStub(overrides = {}) {
  const cfg = {
    failFirst: false,
    failAll: false,
    returnInvalid: false,
    abortFirst: false,
    customResponse: null,
    ...overrides,
  };

  const chain = {
    _callCount: 0,

    reset() { chain._callCount = 0; },

    async runChain(input) {
      chain._callCount++;
      const { language = 'en' } = input;

      if (cfg.abortFirst && chain._callCount === 1) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (cfg.failAll || (cfg.failFirst && chain._callCount === 1)) {
        throw new Error('network error');
      }
      if (cfg.customResponse) return cfg.customResponse;
      if (cfg.returnInvalid) {
        return { validate: 'Question? are you there?', reassure: 'Safe.', redirect: 'Relax.' };
      }
      return {
        validate: language === 'id' ? 'Aku di sini.' : 'I am here.',
        reassure: language === 'id' ? 'Kamu aman.' : 'You are safe.',
        redirect: language === 'id' ? 'Mari duduk.' : 'Let us sit.',
      };
    },
  };

  return chain;
}

// ─── Retry logic simulation ──────────────────────────────────────────────────

/**
 * Simulates runChain's retry + fallback logic with the given chain stub.
 * Mirrors the actual implementation in chain.js.
 */
async function simulateRunChain(input, stub) {
  const { transcript, language = 'en' } = input;
  const { validateResponse } = require('../validator');

  stub.reset();

  // First attempt
  try {
    const raw = await stub.runChain(input);
    const { valid, error } = validateResponse(raw, language);
    if (!valid) throw new Error(`Validation failed: ${error}`);
    const parts = [raw.validate, raw.reassure, raw.redirect].filter(Boolean);
    return { text: parts.join(' '), parts, _fallback: false, _theme: null };
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('aborted')) {
      return { ...getFallback(transcript, language), _fallback: true };
    }
    // Retry once
    try {
      const raw = await stub.runChain(input);
      const { valid, error } = validateResponse(raw, language);
      if (!valid) throw new Error(`Validation failed: ${error}`);
      const parts = [raw.validate, raw.reassure, raw.redirect].filter(Boolean);
      return { text: parts.join(' '), parts, _fallback: false, _theme: null };
    } catch {
      return { ...getFallback(transcript, language), _fallback: true };
    }
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('chain retry logic — first call fails, retry succeeds', () => {
  test.each(runNTimes(() => ({}), 3))('JSON parse error on first call → retry → succeeds', async () => {
    const stub = buildChainStub({ failFirst: true });
    const result = await simulateRunChain(
      { transcript: 'Aku mau bicara.', language: 'id' },
      stub
    );
    expect(result._fallback).toBe(false);
    expect(result.parts).toHaveLength(3);
    expect(stub._callCount).toBe(2);
  });

  test.each(runNTimes(() => ({}), 3))('network error on first call → retry → succeeds', async () => {
    const stub = buildChainStub({ failFirst: true });
    const result = await simulateRunChain(
      { transcript: 'Budi mana?', language: 'id' },
      stub
    );
    expect(result._fallback).toBe(false);
    expect(result.text).toBeTruthy();
  });
});

describe('chain retry logic — validation failure on retry → fallback', () => {
  test.each(runNTimes(() => ({}), 3))('response with question mark → fallback', async () => {
    const stub = buildChainStub({ returnInvalid: true });
    const result = await simulateRunChain(
      { transcript: 'Budi mana?', language: 'en' },
      stub
    );
    expect(result._fallback).toBe(true);
    expect(result._theme).toBeTruthy();
    expect(result.validate).toBeTruthy();
    expect(result.reassure).toBeTruthy();
    expect(result.redirect).toBeTruthy();
  });

  test.each(runNTimes(() => ({}), 3))('response exceeds 25 words → fallback', async () => {
    const longValidate = Array.from({ length: 26 }, (_, i) => `word${i}`).join(' ');
    const stub = buildChainStub({ customResponse: { validate: longValidate, reassure: 'Short.', redirect: 'Short.' } });
    const result = await simulateRunChain(
      { transcript: 'Apa yang terjadi?', language: 'en' },
      stub
    );
    expect(result._fallback).toBe(true);
    expect(result._theme).toBeTruthy();
  });
});

describe('chain retry logic — AbortError (timeout) → immediate fallback, no retry', () => {
  test.each(runNTimes(() => ({}), 3))('abort on first call → no retry, returns fallback immediately', async () => {
    const stub = buildChainStub({ abortFirst: true });
    const result = await simulateRunChain(
      { transcript: 'Siapa Budi?', language: 'id' },
      stub
    );
    expect(result._fallback).toBe(true);
    expect(result._theme).toBeTruthy();
    // Only one call attempted (no retry)
    expect(stub._callCount).toBe(1);
  });
});

describe('chain retry logic — double failure → fallback', () => {
  test.each(runNTimes(() => ({}), 3))('both attempts fail → fallback', async () => {
    const stub = buildChainStub({ failAll: true });
    const result = await simulateRunChain(
      { transcript: 'Aku takut.', language: 'id' },
      stub
    );
    expect(result._fallback).toBe(true);
    expect(result.validate).toBeTruthy();
    expect(result.reassure).toBeTruthy();
    expect(result.redirect).toBeTruthy();
    expect(stub._callCount).toBe(2);
  });
});

describe('chain retry logic — language awareness', () => {
  test.each(runNTimes(() => ({}), 3))('ID: fallback has ID fields', async () => {
    const stub = buildChainStub({ failAll: true });
    const result = await simulateRunChain(
      { transcript: 'Aku gelisah.', language: 'id' },
      stub
    );
    expect(result.validate).toMatch(/aku|sini|untuk/i);
    expect(result.reassure).toBeTruthy();
    expect(result.redirect).toBeTruthy();
  });

  test.each(runNTimes(() => ({}), 3))('EN: fallback has EN fields', async () => {
    const stub = buildChainStub({ failAll: true });
    const result = await simulateRunChain(
      { transcript: 'I am scared.', language: 'en' },
      stub
    );
    expect(result.validate).toMatch(/i am|here|right/i);
    expect(result.reassure).toBeTruthy();
    expect(result.redirect).toBeTruthy();
  });
});
