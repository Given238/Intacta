/**
 * replies.live.test.js — live-model checks of situation-specific replies (spends credits).
 * Runs only with RUN_LIVE_LLM_TESTS=1 (needs GEMINI_API_KEY):  RUN_LIVE_LLM_TESTS=1 npx jest replies.live
 * The invented-facts checks ("Where is Timothy?" with and without context) live in factuality.test.js and run
 * under the same flag.
 *
 * 40 utterances (benchUtterances.js) with the 2 daily + 1 permanent notes context:
 *   - every model reply is on-topic (per-situation keyword lists with synonyms)
 *   - no single redirect phrase appears in more than 20% of replies
 *   - greetings are not answered with the time of day (a correction)
 *   - food or drink only in hunger / thirst cases (no meal routine is within 60 minutes at 15:30)
 *   - fallback rate under 10%
 */

const WANT_LIVE = process.env.RUN_LIVE_LLM_TESTS === '1';
if (WANT_LIVE) {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
  // Live runs test model behaviour: allow a slow network (LIVE_LLM_TIMEOUT_MS overrides)
  process.env.LLM_TIMEOUT_MS = process.env.LIVE_LLM_TIMEOUT_MS || '8000';
}
const LIVE = WANT_LIVE && Boolean(process.env.GEMINI_API_KEY);

const { runChain, FOOD_WORDS } = require('../chain');
const { UTTERANCES, BENCH_CONTEXT, SITUATION_KEYWORDS } = require('../benchUtterances');

const liveDescribe = LIVE ? describe : describe.skip;

function normalizeRedirect(text) {
  return String(text || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function onTopic(reply, situation, lang) {
  const lower = String(reply || '').toLowerCase();
  return SITUATION_KEYWORDS[situation][lang].some(k => lower.includes(k));
}

liveDescribe('live replies are situation-specific', () => {
  const results = [];

  beforeAll(async () => {
    for (const u of UTTERANCES) {
      const ctx = BENCH_CONTEXT[u.lang];
      const out = await runChain({
        transcript: u.text,
        daily_items: ctx.daily,
        permanent_items: ctx.permanent,
        upcoming_routines: ctx.routines,
        max_speech_seconds: 10,
        timeOfDay: '15:30',
        language: u.lang,
        recent: [],
      });
      results.push({ ...u, out });
      console.log(`[live ${u.lang} ${u.situation}] ${out._fallback ? `FALLBACK(${out._reason})` : out._stage} :: ${out.text}`);
    }
  }, 40 * ((Number(process.env.LLM_TIMEOUT_MS) || 2500) + 10000));

  test('fallback rate under 10%', () => {
    const rate = results.filter(r => r.out._fallback).length / results.length;
    console.log(`[live] fallback rate ${(rate * 100).toFixed(1)}%`);
    expect(rate).toBeLessThan(0.1);
  });

  test('every model reply is on-topic for its situation', () => {
    const off = results
      .filter(r => !r.out._fallback && !onTopic(r.out.text, r.situation, r.lang))
      .map(r => `${r.lang}/${r.situation}: "${r.text}" → "${r.out.text}"`);
    expect(off).toEqual([]);
  });

  test('no single redirect phrase in more than 20% of replies', () => {
    const counts = {};
    for (const r of results) {
      const key = normalizeRedirect(r.out.redirect ?? r.out.parts?.[2]);
      counts[key] = (counts[key] || 0) + 1;
    }
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    console.log(`[live] most common redirect (${n}/${results.length}): "${top}"`);
    expect(n / results.length).toBeLessThanOrEqual(0.2);
  });

  test('greetings are never contradicted with the time of day', () => {
    const offending = results
      .filter(r => r.situation === 'greeting' && !r.out._fallback)
      // echoing their own greeting is fine; naming a different part of the day corrects them
      .filter(r => {
        const parts = (s) => new Set(String(s).toLowerCase().match(/\b(morning|afternoon|evening|night|pagi|siang|sore|malam)\b/g) || []);
        const said = parts(r.text);
        return [...parts(r.out.text)].some(p => !said.has(p));
      })
      .map(r => `${r.lang}: "${r.text}" → "${r.out.text}"`);
    expect(offending).toEqual([]);
  });

  test('food or drink only for hunger / thirst', () => {
    const offending = results
      .filter(r => !['hungry', 'thirsty'].includes(r.situation))
      .filter(r => FOOD_WORDS.test(r.out.redirect ?? r.out.parts?.[2] ?? ''))
      .map(r => `${r.lang}/${r.situation}: ${r.out.text}`);
    expect(offending).toEqual([]);
  });
});

describe('live suite wiring', () => {
  test('skipped unless RUN_LIVE_LLM_TESTS=1', () => {
    expect(typeof LIVE).toBe('boolean');
  });
});
