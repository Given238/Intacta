/**
 * fallbackLibrary.test.js — the static fallback library (last rung of the reply ladder).
 * Right category, no repeats across the last 3 replies, every reply passes the validator and the safety check,
 * food/drink only in the hungry/thirsty categories, the patient's word cap is honoured.
 */

const { getFallback, detectIntent, LIBRARY, CATEGORIES, resetHistory } = require('../fallbacks');
const { validateResponse, countWords } = require('../validator');
const { checkTier1 } = require('../../services/contentSafety');
const { FOOD_WORDS } = require('../chain');
const { UTTERANCES } = require('../benchUtterances');

const SLOTS = ['validate', 'reassure', 'redirect'];
const EXPECTED = { confused_time: 'confused', confused_place: 'confused', deceased_spouse: 'missing_someone', gibberish: 'generic' };

beforeEach(() => resetHistory());

describe('intent detection', () => {
  it.each(UTTERANCES.map(u => [u.lang, u.text, EXPECTED[u.situation] || u.situation]))('%s %p → %s', (_lang, text, category) => {
    expect(detectIntent(text)).toBe(category);
  });

  it('has at least 12 situation categories, generic last', () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(12);
    expect(CATEGORIES[CATEGORIES.length - 1]).toBe('generic');
  });
});

describe('every reply obeys the guardrails', () => {
  it.each(CATEGORIES.flatMap(c => [[c, 'id'], [c, 'en']]))('%s / %s: all 64 combinations validate and are safe', (category, lang) => {
    const set = LIBRARY[category][lang];
    for (const v of set.validate) for (const r of set.reassure) for (const d of set.redirect) {
      expect(validateResponse({ validate: v, reassure: r, redirect: d }, lang)).toEqual({ valid: true });
      expect(checkTier1(`${v} ${r} ${d}`, { kind: 'reply' }).ok).toBe(true);
    }
  });

  it('fits a 15-word cap (the lowest the slider can give) in every category', () => {
    for (const category of CATEGORIES) {
      for (const lang of ['id', 'en']) {
        const fb = getFallback(UTTERANCES.find(u => u.lang === lang)?.text, lang, { maxWords: 15 });
        expect(countWords(fb.validate) + countWords(fb.reassure) + countWords(fb.redirect)).toBeLessThanOrEqual(15);
        const set = LIBRARY[category][lang];
        const shortest = Math.min(...set.validate.map(countWords)) + Math.min(...set.reassure.map(countWords)) + Math.min(...set.redirect.map(countWords));
        expect(shortest).toBeLessThanOrEqual(15);
      }
    }
  });

  it('food or drink appears only in the hungry / thirsty categories', () => {
    for (const category of CATEGORIES) {
      for (const lang of ['id', 'en']) {
        const all = SLOTS.flatMap(s => LIBRARY[category][lang][s]).join(' ');
        if (category === 'hungry' || category === 'thirsty') expect(FOOD_WORDS.test(LIBRARY[category][lang].redirect.join(' '))).toBe(true);
        else expect({ category, lang, food: FOOD_WORDS.test(all) }).toEqual({ category, lang, food: false });
      }
    }
  });

  it('no tea anywhere (the old copyable redirect)', () => {
    const all = JSON.stringify(LIBRARY);
    expect(all).not.toMatch(/\b(teh|tea)\b/i);
  });

  it('reassure pieces are presence statements: no times, names or places', () => {
    for (const category of CATEGORIES) for (const lang of ['id', 'en']) {
      for (const piece of LIBRARY[category][lang].reassure) {
        expect(piece).not.toMatch(/\d/);
        expect(piece).not.toMatch(/\b(timothy|budi|jam|pukul|o'clock|datang|pulang|coming|arrive)\b/i);
      }
    }
  });
});

describe('selection: random, never repeating the last 3 replies', () => {
  it('with a history key: no piece repeats anything from the last 3 replies (100 rounds, every category)', () => {
    for (const u of UTTERANCES) {
      const seen = [];
      for (let i = 0; i < 12; i++) {
        const fb = getFallback(u.text, u.lang, { historyKey: `${u.lang}:${u.text}` });
        const pieces = [fb.validate, fb.reassure, fb.redirect];
        for (const prev of seen.slice(-3)) for (const p of pieces) expect(prev).not.toContain(p);
        seen.push(pieces);
      }
    }
  });

  it('even at the 15-word floor, no piece repeats the previous reply', () => {
    const seen = [];
    for (let i = 0; i < 100; i++) {
      const fb = getFallback('Aku takut sekali', 'id', { historyKey: 7, maxWords: 15 });
      const pieces = [fb.validate, fb.reassure, fb.redirect];
      expect(countWords(pieces.join(' '))).toBeLessThanOrEqual(15);
      for (const prev of seen.slice(-1)) for (const p of pieces) expect(prev).not.toContain(p);
      seen.push(pieces);
    }
  });

  it('with recent reply texts: never reuses a piece found in them', () => {
    for (let i = 0; i < 50; i++) {
      const a = getFallback("I'm scared", 'en');
      const b = getFallback("I'm scared", 'en', { recent: [[a.validate, a.reassure, a.redirect].join(' ')] });
      expect([b.validate, b.reassure, b.redirect].some(p => [a.validate, a.reassure, a.redirect].includes(p))).toBe(false);
    }
  });

  it('is randomised (several different replies over 30 draws)', () => {
    const texts = new Set(Array.from({ length: 30 }, () => {
      const fb = getFallback('I feel so lonely', 'en');
      return `${fb.validate} ${fb.reassure} ${fb.redirect}`;
    }));
    expect(texts.size).toBeGreaterThan(5);
  });

  it('still answers when every piece was used recently', () => {
    const everything = SLOTS.flatMap(s => LIBRARY.generic.en[s]).join(' ');
    const fb = getFallback('hmm', 'en', { recent: [everything] });
    expect(fb._theme).toBe('generic');
    expect(validateResponse(fb, 'en').valid).toBe(true);
  });
});
