/**
 * CLI: npm run llm:try "..." -- --lang id|en
 * Prints result + latency; p50/p95 over 30 runs.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { getStructuredModel } = require('./model');
const { buildPrompt } = require('./prompts');
const { validateResponse } = require('./validator');
const { getFallback } = require('./fallbacks');

const args = process.argv.slice(2);
const langFlagIdx  = args.indexOf('--lang');
const benchmarkIdx = args.indexOf('--benchmark');
const language = langFlagIdx !== -1 ? args[langFlagIdx + 1] || 'en' : 'en';
const isBenchmark = benchmarkIdx !== -1;
const transcript = args
  .filter((a, i) => i !== langFlagIdx && i !== langFlagIdx + 1 && a !== '--lang' && i !== benchmarkIdx)
  .join(' ').replace(/^"|"$/g, '');

if (!transcript) {
  console.error('Usage: npm run llm:try "<utterance>" -- --lang id|en');
  process.exit(1);
}

const TIMEOUT_MS = 1200;

async function singleRun() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();

  try {
    const model = getStructuredModel();
    const prompt = buildPrompt({ transcript, visitor_name: null, arrival_time: null, passive_cue: null, timeOfDay: null, language });
    const chain = prompt.pipe(model);
    const raw = await chain.invoke({}, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const parsed = typeof raw === 'object' && raw !== null ? raw : JSON.parse((raw?.content || String(raw)).trim());
    const { valid, error } = validateResponse(parsed, language);
    if (!valid) throw new Error(`Validation failed: ${error}`);
    const parts = [parsed.validate, parsed.reassure, parsed.redirect].filter(Boolean);
    return { latencyMs, result: { text: parts.join(' '), parts, _fallback: false } };
  } catch (err) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    if (err.name === 'AbortError' || err.message?.includes('aborted')) {
      console.warn('  → LLM timeout — fallback');
    }
    return { latencyMs, result: { ...getFallback(transcript, language), _fallback: true } };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const RUNS = isBenchmark ? 30 : 1;

  if (isBenchmark) {
    console.log(`\nRunning ${RUNS} benchmark runs for: "${transcript}" [${language}]\n`);
    const results = [];
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`Run ${i + 1}/${RUNS}... `);
      const { latencyMs, result } = await singleRun();
      results.push(latencyMs);
      console.log(`${latencyMs}ms ${result._fallback ? '(fallback)' : '(llm)'}`);
    }
    results.sort((a, b) => a - b);
    const p50 = results[Math.floor(RUNS * 0.50)];
    const p95 = results[Math.floor(RUNS * 0.95)];
    const avg  = Math.round(results.reduce((s, v) => s + v, 0) / RUNS);
    console.log(`\nResults over ${RUNS} runs:`);
    console.log(`  p50: ${p50}ms`);
    console.log(`  p95: ${p95}ms`);
    console.log(`  avg: ${avg}ms`);
  } else {
    console.log(`\nLLM Try: "${transcript}" [${language}]\n`);
    const { latencyMs, result } = await singleRun();
    console.log(`Latency: ${latencyMs}ms`);
    console.log(`Fallback: ${result._fallback}`);
    if (result._theme) console.log(`Theme: ${result._theme}`);
    console.log(`\ntext: ${result.text}`);
    console.log(`parts: ${JSON.stringify(result.parts)}`);
  }
}

main().catch(err => {
  console.error('CLI error:', err.message);
  process.exit(1);
});
