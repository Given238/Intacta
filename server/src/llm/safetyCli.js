/**
 * CLI: npm run safety:try "<text>" -- --kind context|broadcast|routine|voice_test|reply --lang id|en
 * Diagnoses one content safety decision: which tier decided, the raw classifier response,
 * any classifier error or timeout, and the final gate result. Spends one or two Gemini calls.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { z } = require('zod');
const safety = require('../services/contentSafety');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] || fallback : fallback;
};
const kind = flag('kind', 'context');
const language = flag('lang', 'id');
const text = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')).join(' ');

if (!text) {
  console.error('Usage: npm run safety:try "<text>" -- --kind context --lang id');
  process.exit(1);
}

const redact = (s) => {
  const key = process.env.GEMINI_API_KEY;
  return key ? String(s).split(key).join('[redacted]') : String(s);
};

async function rawClassifier() {
  const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
  const model = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_SAFETY_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0,
    maxOutputTokens: 64,
  });
  const schema = z.object({ safe: z.boolean(), category: z.enum(safety.CATEGORIES), confidence: z.number().min(0).max(1) });
  const start = Date.now();
  try {
    const out = await model.withStructuredOutput(schema, { includeRaw: true })
      .invoke(safety.classifierPrompt(text, { language, kind }));
    return { ms: Date.now() - start, parsed: out.parsed, tool_calls: out.raw?.tool_calls };
  } catch (err) {
    return { ms: Date.now() - start, error: redact(err.message).slice(0, 300) };
  }
}

(async () => {
  console.log('model:', process.env.GEMINI_SAFETY_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    '| key set:', Boolean(process.env.GEMINI_API_KEY), '| kind:', kind, '| lang:', language);
  console.log('tier 1:', JSON.stringify(safety.checkTier1(text, { kind })));
  const raw = await rawClassifier();
  console.log(`raw classifier, no timeout (${raw.ms} ms):`, JSON.stringify(raw.error ? { error: raw.error } : raw.parsed),
    raw.tool_calls ? `| tool_calls: ${JSON.stringify(raw.tool_calls)}` : '');
  console.log(`gate timeout: ${safety.CLASSIFIER_TIMEOUT_MS} ms`);
  const start = Date.now();
  const final = await safety.checkPatientFacingText(text, { language, kind });
  const decidedBy = final.reason === 'classifier' ? 'tier 2 (classifier)' : final.ok ? 'tier 1 + tier 2 pass, or tier 1 alone after a classifier failure (see [safety] warning above)' : 'tier 1';
  console.log(`final (${Date.now() - start} ms):`, JSON.stringify(final), '| decided by:', decidedBy);
})();
