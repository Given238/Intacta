/**
 * bench.js — fallback/latency benchmark on the real model (spends credits).
 *   npm run llm:bench -- [--timeout <ms>] [--out <file.json>] [--concurrency <n>] [--label <name>]
 * 40 utterances (20 id, 20 en) × 2 contexts: (a) empty, (b) 2 daily + 1 permanent note.
 * Prints fallback rate, top reasons and p50/p95 latency; --out writes every result (utterance, reply, reason).
 * --timeout overrides LLM_TIMEOUT_MS for this run only.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
if (flag('timeout')) process.env.LLM_TIMEOUT_MS = flag('timeout');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { runChain, TIMEOUT_MS } = require('./chain');
const { wordCapFor } = require('./prompts');
const { UTTERANCES, BENCH_CONTEXT } = require('./benchUtterances');

const CONCURRENCY = Number(flag('concurrency', 3));
const OUT = flag('out');
const LABEL = flag('label', 'run');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const jobs = [];
  for (const u of UTTERANCES) {
    for (const ctx of ['empty', 'notes']) {
      const c = BENCH_CONTEXT[u.lang];
      jobs.push({
        ...u,
        ctx,
        input: {
          transcript: u.text,
          daily_items: ctx === 'notes' ? c.daily : [],
          permanent_items: ctx === 'notes' ? c.permanent : [],
          max_speech_seconds: 10, // the default setting
          timeOfDay: '15:30',
          language: u.lang,
          recent: [],
          upcoming_routines: ctx === 'notes' ? c.routines : [],
        },
      });
    }
  }

  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const t0 = Date.now();
      let out;
      try {
        out = await runChain(job.input);
      } catch (err) {
        out = { _fallback: true, _reason: `crash:${err.message}` };
      }
      const r = {
        lang: job.lang, situation: job.situation, ctx: job.ctx, utterance: job.text,
        fallback: !!out._fallback, reason: out._reason || null, latency_ms: Date.now() - t0, reply: out.text || null,
        theme: out._theme || null,
      };
      results.push(r);
      process.stdout.write(`${r.fallback ? 'F' : '.'}`);
    }
  }
  console.log(`[bench:${LABEL}] ${jobs.length} calls, LLM_TIMEOUT_MS=${TIMEOUT_MS}, word cap @10s=${wordCapFor(10)}, model=${process.env.GEMINI_MODEL}`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('');

  const fallbacks = results.filter(r => r.fallback);
  const counts = {};
  for (const r of fallbacks) counts[r.reason] = (counts[r.reason] || 0) + 1;
  const lat = results.map(r => r.latency_ms).sort((a, b) => a - b);
  const summary = {
    label: LABEL,
    calls: results.length,
    llm_timeout_ms: TIMEOUT_MS,
    word_cap_at_10s: wordCapFor(10),
    fallback_rate: Number((fallbacks.length / results.length).toFixed(3)),
    fallbacks: fallbacks.length,
    top_reasons: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5),
    p50_ms: percentile(lat, 50),
    p95_ms: percentile(lat, 95),
    by_ctx: Object.fromEntries(['empty', 'notes'].map(c => {
      const rs = results.filter(r => r.ctx === c);
      return [c, Number((rs.filter(r => r.fallback).length / rs.length).toFixed(3))];
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (OUT) {
    require('fs').writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));
    console.log(`wrote ${OUT}`);
  }
}

main().catch(err => {
  console.error('bench failed:', err.message);
  process.exit(1);
});
