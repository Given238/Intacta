/**
 * validator.js — Clinical guardrail validator for LLM output.
 * Enforces: no '?', no quizzing/correcting phrases (whole-word / phrase patterns, both languages), ≤25 words total,
 * no empty parts, Latin script only. Returns { valid, error?, rule? }.
 * rule: not_object | empty_field | question | banned_phrase | foreign_script | word_cap
 *
 * Banned patterns target quizzing and correcting, not single words: "tidak salah kok merasa begitu" (validating)
 * passes, "kamu salah" (correcting) does not. A sentence that opens with "Ingat," / "Remember," (an order to recall)
 * is banned too.
 */

const MAX_WORDS = 25;

// Phrase patterns, matched on lowercase text with letter boundaries on both sides
const BANNED_PATTERNS = {
  id: [
    '(kamu|kau|engkau|anda|ibu|bapak) (sudah |sampai )?lupa', 'lupa ya', 'masa lupa', 'jangan lupa',
    'sudah (ku|aku |saya )?(bilang|bilangin|katakan|kasih tahu|beri tahu|jelaskan)', 'sudah dibilang(in)?',
    '(kan|bukankah) sudah (ku|di|aku |saya )?(bilang|katakan|kasih tahu)', 'tadi kan', 'tadi sudah',
    '(apa|apakah) (kamu|kau|anda|ibu|bapak) (masih )?ingat', '(kamu|kau|anda) (masih )?ingat (tidak|nggak|gak|kan)',
    'ingat (tidak|nggak|gak|kan)', 'coba ingat\\w*', 'ingat-ingat', 'ingat lagi',
    'bukan begitu', '(kamu|kau|anda|ibu|bapak|itu) salah', 'salah ingat', 'keliru', 'sebenarnya', 'faktanya',
  ],
  en: [
    'you (forgot|forget|have forgotten|\'ve forgotten)', 'don\'t you remember', 'do you (still )?remember',
    'you (should |must )?remember', 'try to remember', 'remember (that|when|what|who)',
    'i (already |have |\'ve )?told you', 'as i (said|told you|mentioned)', 'like i said',
    '(that\'s|that is|you\'re|you are) (wrong|mistaken|not right|not true|confused about)', 'not right',
    'actually', 'in fact', 'as you know', 'as you should know',
  ],
};
// A sentence that opens with an order to recall
const RECALL_OPENERS = { id: /^(ingat|ingatlah)\b/, en: /^remember\b/ };

const COMPILED = Object.fromEntries(Object.entries(BANNED_PATTERNS).map(([lang, list]) => [
  lang,
  list.map(src => new RegExp(`(?:^|[^a-z\\u00c0-\\u024f])(?:${src})(?=$|[^a-z\\u00c0-\\u024f])`)),
]));

// Anything outside Latin letters, digits, punctuation and typographic quotes/dashes (e.g. stray CJK characters)
const FOREIGN_SCRIPT = /[^\u0000-ɏḀ-ỿ‐-‧\s]/u;

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function hasQuestion(text) {
  return /[?？]/.test(text || '');
}

function normalizeForMatch(text) {
  return String(text || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
}

function hasBannedPhrase(text, lang) {
  const key = lang === 'id' ? 'id' : 'en';
  const lower = normalizeForMatch(text);
  if (COMPILED[key].some(re => re.test(lower))) return true;
  const sentences = lower.split(/[.!;:,\n]+/).map(s => s.trim()).filter(Boolean);
  return sentences.some(s => RECALL_OPENERS[key].test(s));
}

function validateResponse(response, lang = 'en') {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { valid: false, error: 'Response is not an object', rule: 'not_object' };
  }

  for (const key of ['validate', 'reassure', 'redirect']) {
    if (!response[key] || typeof response[key] !== 'string' || !response[key].trim()) {
      return { valid: false, error: `Missing or invalid field: ${key}`, rule: 'empty_field' };
    }
    if (hasQuestion(response[key])) {
      return { valid: false, error: `Field '${key}' contains '?' — no questions allowed`, rule: 'question' };
    }
    if (hasBannedPhrase(response[key], lang)) {
      return { valid: false, error: `Field '${key}' contains a banned phrase (${lang}): no quizzing or correcting`, rule: 'banned_phrase' };
    }
    if (FOREIGN_SCRIPT.test(response[key])) {
      return { valid: false, error: `Field '${key}' contains characters outside the Latin script`, rule: 'foreign_script' };
    }
  }

  const totalWords = ['validate', 'reassure', 'redirect']
    .reduce((sum, key) => sum + countWords(response[key]), 0);

  if (totalWords > MAX_WORDS) {
    return { valid: false, error: `Total word count ${totalWords} exceeds limit of ${MAX_WORDS}`, rule: 'word_cap' };
  }

  return { valid: true };
}

/** Plain-language rejection reason for the retry prompt. */
function describeRule(rule, lang = 'en') {
  const id = lang === 'id';
  const map = {
    question:       id ? 'ada tanda tanya. Jangan bertanya.' : 'it contained a question mark. Do not ask anything.',
    banned_phrase:  id ? 'ada frasa yang menguji ingatan atau mengoreksi.' : 'it quizzed memory or corrected the person.',
    word_cap:       id ? 'terlalu panjang.' : 'it was too long.',
    patient_cap:    id ? 'terlalu panjang.' : 'it was too long.',
    empty_field:    id ? 'ada bagian yang kosong.' : 'a part was empty.',
    foreign_script: id ? 'ada huruf asing.' : 'it contained foreign characters.',
    food_offer:     id ? 'menawarkan makanan atau minuman padahal pasien tidak lapar atau haus.' : 'it offered food or drink although the person is not hungry or thirsty.',
    time_contradiction: id ? 'membantah waktu yang disebut pasien. Jangan sebut waktu lain.' : 'it contradicted the time of day the person named. Do not name another time.',
    safety:         id ? 'menyebut hal yang menyedihkan atau menakutkan.' : 'it mentioned something distressing or frightening.',
    empty:          id ? 'balasan kosong.' : 'the reply was empty.',
    not_object:     id ? 'bukan JSON.' : 'it was not JSON.',
  };
  return map[rule] || (id ? 'tidak memenuhi aturan.' : 'it broke the rules.');
}

module.exports = { validateResponse, countWords, hasQuestion, hasBannedPhrase, describeRule, MAX_WORDS, BANNED_PATTERNS };
