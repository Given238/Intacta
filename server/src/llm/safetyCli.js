/**
 * CLI: npm run safety:try "<text>" -- --kind context|broadcast|routine|voice_test|reply --lang id|en
 * Diagnoses one content safety decision: the model, the raw classifier verdict (no timeout), any classifier
 * error, and the final gate result (4 s timeout, one retry, fail closed). Spends one to three Gemini calls.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
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

(async () => {
  console.log('model:', safety.safetyModel(), '| key set:', Boolean(process.env.GEMINI_API_KEY),
    '| kind:', kind, '| lang:', language, '| safety_version:', safety.SAFETY_VERSION);
  const clean = safety.sanitize(text);
  let start = Date.now();
  try {
    const raw = await safety.geminiClassifier(clean, { language, kind }, undefined);
    console.log(`raw classifier, no timeout (${Date.now() - start} ms):`, JSON.stringify(raw));
    console.log('decision rule:', JSON.stringify((({ verdict: _v, ...r }) => r)(safety.decide(raw, kind))));
  } catch (err) {
    console.log(`raw classifier ERROR (${Date.now() - start} ms):`, redact(err.message).slice(0, 300));
  }
  start = Date.now();
  try {
    const final = await safety.checkPatientFacingText(text, { language, kind });
    console.log(`gate (${Date.now() - start} ms, timeout ${safety.CLASSIFIER_TIMEOUT_MS} ms × 2):`, JSON.stringify(final));
  } catch (err) {
    console.log(`gate (${Date.now() - start} ms): REFUSED, ${err.code || err.name}: ${redact(err.message).slice(0, 200)}`);
  }
})();
