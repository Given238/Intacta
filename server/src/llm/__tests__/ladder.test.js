/**
 * ladder.test.js — the reply ladder with a mocked model:
 *   full prompt → short retry (with the rejection reason) → static library; food/drink rule; inputs reach the
 *   prompt; reasons and stats; GET /api/health/llm.
 */

jest.mock('../model', () => ({ getStructuredModel: jest.fn() }));

const { RunnableLambda } = require('@langchain/core/runnables');
const { getStructuredModel } = require('../model');
const { runChain, foodAllowed } = require('../chain');
const stats = require('../fallbackStats');
const { resetHistory, LIBRARY } = require('../fallbacks');

/** Model stub: answers each call with the next item (an object, or an Error to throw). Records the prompts. */
function scriptModel(...answers) {
  const prompts = [];
  let i = 0;
  getStructuredModel.mockImplementation(() => RunnableLambda.from(async (promptValue) => {
    prompts.push(String(promptValue?.value ?? promptValue?.toString?.() ?? promptValue));
    const answer = answers[Math.min(i++, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  }));
  return prompts;
}

const GOOD_EN = { validate: 'You miss Timothy.', reassure: 'Timothy comes home at 5 PM.', redirect: "Let's listen to a song you love." };
const QUESTION = { validate: 'Are you looking for Timothy?', reassure: 'I am here.', redirect: "Let's sit." };
const apiError = (status) => Object.assign(new Error(`[GoogleGenerativeAI Error]: [${status} Not Found] model gone`), { status });

let warn;
beforeEach(() => {
  stats.reset();
  resetHistory();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('the ladder', () => {
  it('1. a good first reply is used as is (stage full)', async () => {
    const prompts = scriptModel(GOOD_EN);
    const out = await runChain({ transcript: 'Where is Timothy?', daily_items: ['Timothy comes home at 5 PM'], language: 'en' });
    expect(out).toMatchObject({ _fallback: false, _stage: 'full', text: `${GOOD_EN.validate} ${GOOD_EN.reassure} ${GOOD_EN.redirect}` });
    expect(prompts).toHaveLength(1);
  });

  it('2. a rejected first reply → one SHORT retry that names the rejection reason', async () => {
    const prompts = scriptModel(QUESTION, GOOD_EN);
    const out = await runChain({ transcript: 'Where is Timothy?', daily_items: ['Timothy comes home at 5 PM'], language: 'en' });
    expect(out).toMatchObject({ _fallback: false, _stage: 'retry' });
    expect(prompts).toHaveLength(2);
    expect(prompts[1].length).toBeLessThan(prompts[0].length);
    expect(prompts[1]).toMatch(/rejected because it contained a question mark/);
  });

  it('3. both fail → static library reply, marked _fallback with the reason', async () => {
    scriptModel(QUESTION, QUESTION);
    const out = await runChain({ transcript: "I'm scared", language: 'en' });
    expect(out).toMatchObject({ _fallback: true, _stage: 'static', _reason: 'validation:question', _theme: 'scared' });
    expect(LIBRARY.scared.en.validate).toContain(out.validate);
    expect(out.text).toBe(out.parts.join(' '));
    expect(warn).toHaveBeenCalledWith('[llm] fallback:', expect.stringContaining('"reason":"validation:question"'));
  });

  it('a non-retryable API error (404) skips the retry', async () => {
    const prompts = scriptModel(apiError(404), GOOD_EN);
    const out = await runChain({ transcript: 'Hello', language: 'en' });
    expect(out).toMatchObject({ _fallback: true, _reason: 'api_error:404' });
    expect(prompts).toHaveLength(1);
  });

  it('a 503 is retried', async () => {
    const prompts = scriptModel(apiError(503), GOOD_EN);
    const out = await runChain({ transcript: 'Where is Timothy?', daily_items: ['Timothy comes home at 5 PM'], language: 'en' });
    expect(out._stage).toBe('retry');
    expect(prompts).toHaveLength(2);
  });

  it('an unsafe reply (distressing fact) goes down the ladder with reason safety', async () => {
    scriptModel({ validate: 'You miss him.', reassure: 'He died in 2015.', redirect: "Let's sit." });
    const out = await runChain({ transcript: "Where's my husband", language: 'en' });
    expect(out).toMatchObject({ _fallback: true, _reason: 'safety' });
  });

  it('the patient cap (never below 15 words) rejects a long reply', async () => {
    const long = { validate: 'You are missing your son very much right now.', reassure: 'I am right here with you all afternoon.', redirect: "Let's listen to a song you love." };
    scriptModel(long, long);
    const out = await runChain({ transcript: 'Where is my son', language: 'en', max_speech_seconds: 1 });
    expect(out).toMatchObject({ _fallback: true, _reason: 'validation:patient_cap' });
    expect(out.text.split(/\s+/).length).toBeLessThanOrEqual(15);
  });
});

describe('food or drink only when it fits', () => {
  const TEA = { validate: 'You feel uneasy.', reassure: 'I am here with you.', redirect: "Let's have a cup of tea." };

  it('rejects a tea redirect when the person is not hungry or thirsty', async () => {
    scriptModel(TEA, TEA);
    const out = await runChain({ transcript: "I'm scared", language: 'en', timeOfDay: '15:30' });
    expect(out).toMatchObject({ _fallback: true, _reason: 'validation:food_offer' });
    expect(out.redirect).not.toMatch(/\b(tea|snack|drink|water|eat)\b/i);
  });

  it('allows it when the person mentions hunger or thirst', async () => {
    scriptModel({ ...TEA, validate: 'You feel hungry.' });
    const out = await runChain({ transcript: "I'm hungry", language: 'en' });
    expect(out._fallback).toBe(false);
  });

  it('allows it when a meal routine is within 60 minutes', () => {
    expect(foodAllowed("I'm bored", [{ title: 'Dinner', time: '18:00', category: 'meal' }], '17:15')).toBe(true);
    expect(foodAllowed("I'm bored", [{ title: 'Dinner', time: '18:00', category: 'meal' }], '15:30')).toBe(false);
    expect(foodAllowed("I'm bored", [{ title: 'Pills', time: '16:00', category: 'medication' }], '15:30')).toBe(false);
    expect(foodAllowed('Aku haus', [], null)).toBe(true);
  });

  it('the prompt tells the model whether food may be offered', async () => {
    const prompts = scriptModel(GOOD_EN);
    await runChain({ transcript: 'Where is Timothy?', language: 'en' });
    expect(prompts[0]).toMatch(/Food or drink may be offered: no/);
  });
});

describe('prompt inputs', () => {
  it('recent exchanges, upcoming routines, time of day and the notes are passed as delimited data', async () => {
    const prompts = scriptModel(GOOD_EN);
    await runChain({
      transcript: 'Where is Timothy?',
      daily_items: ['Timothy comes home at 5 PM'],
      permanent_items: ['Loves old jazz songs'],
      upcoming_routines: [{ title: 'Dinner', time: '18:00', category: 'meal' }],
      recent: [{ transcript: 'Hello', reply: 'Lovely to hear you. I am here with you.' }],
      timeOfDay: '15:30',
      language: 'en',
    });
    const p = prompts[0];
    expect(p).toMatch(/<<<PATIENT\nWhere is Timothy\?\nPATIENT>>>/);
    expect(p).toMatch(/<<<ROUTINES\n- 18:00 Dinner\nROUTINES>>>/);
    expect(p).toMatch(/<<<RECENT\n- Hello → Lovely to hear you\. I am here with you\.\nRECENT>>>/);
    expect(p).toMatch(/do not reuse their openings or redirects/);
    expect(p).toMatch(/Current time: 15:30 \(afternoon\)/);
  });

  it('Indonesian prompt is in Indonesian', async () => {
    const prompts = scriptModel({ validate: 'Kamu mencari Timothy.', reassure: 'Timothy pulang jam 5 sore.', redirect: 'Mari duduk bersama.' });
    await runChain({ transcript: 'Timothy di mana?', daily_items: ['Timothy pulang jam 5 sore'], language: 'id', timeOfDay: '09:00' });
    expect(prompts[0]).toMatch(/Jawab HANYA dalam bahasa Indonesia/);
    expect(prompts[0]).toMatch(/Waktu sekarang: 09:00 \(pagi\)/);
  });
});

describe('observability', () => {
  it('records every result; summary gives the fallback rate and top reasons', async () => {
    scriptModel(GOOD_EN);
    await runChain({ transcript: 'Where is Timothy?', language: 'en' });
    scriptModel(QUESTION, QUESTION);
    await runChain({ transcript: 'Hello', language: 'en' });
    await runChain({ transcript: 'Hello', language: 'en' });
    const s = stats.summary();
    expect(s).toMatchObject({ total: 3, fallbacks: 2, fallback_rate: 0.667, top_reasons: [{ reason: 'validation:question', count: 2 }] });
    expect(typeof s.p50_ms).toBe('number');
  });

  it('events older than an hour drop out', () => {
    const now = Date.now();
    stats.record({ fallback: true, reason: 'timeout', latencyMs: 10 }, now - 2 * 60 * 60 * 1000);
    stats.record({ fallback: false, latencyMs: 10 }, now);
    expect(stats.summary(now)).toMatchObject({ total: 1, fallbacks: 0 });
  });

  it('GET /api/health/llm returns the last-hour summary (behind the caregiver JWT)', () => {
    const router = require('../../routes/health');
    const layer = router.stack.find(l => l.route?.path === '/llm');
    const [auth, handler] = layer.route.stack.map(s => s.handle);
    expect(auth.name).toBe('authenticate');
    stats.record({ fallback: true, reason: 'timeout', latencyMs: 2500 });
    const res = { json: jest.fn(), status: jest.fn(() => res) };
    handler({}, res);
    expect(res.json).toHaveBeenCalledWith({ llm: expect.objectContaining({ total: 1, fallback_rate: 1, top_reasons: [{ reason: 'timeout', count: 1 }] }) });
  });
});
