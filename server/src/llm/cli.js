/**
 * CLI: npm run llm:try "..." -- --lang id|en
 * Prints result + latency; p50/p95 over 30 runs.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { runChain } = require('./chain');

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

// Same pipeline as POST /api/respond (validator, retry, timeout, fallback)
async function singleRun() {
  const start = Date.now();
  const result = await runChain({ transcript, daily_items: [], permanent_items: [], timeOfDay: null, language });
  return { latencyMs: Date.now() - start, result };
}

// LLM replies carry text/parts; fallback scripts carry validate/reassure/redirect
function replyFields(result) {
  const parts = Array.isArray(result.parts)
    ? result.parts
    : [result.validate, result.reassure, result.redirect].filter(Boolean);
  return { text: result.text ?? parts.join(' '), parts };
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
    const { text, parts } = replyFields(result);
    console.log(`\ntext: ${text}`);
    console.log(`parts: ${JSON.stringify(parts)}`);
  }
}

main().catch(err => {
  console.error('CLI error:', err.message);
  process.exit(1);
});
