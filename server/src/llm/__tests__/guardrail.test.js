/**
 * guardrail.test.js — Clinical guardrail suite for Intacta LLM.
 * Tests validator, word cap, banned phrases (whole-word/phrase patterns), and the fallback library.
 * Each case runs 3x as specified.
 */

const { validateResponse, countWords, hasQuestion, hasBannedPhrase } = require('../validator');
const { getFallback, detectTheme, THEMES } = require('../fallbacks');

// ─── Test helpers ───────────────────────────────────────────────────────────

function expectValid(response, lang = 'en') {
  const { valid, error } = validateResponse(response, lang);
  expect(valid).toBe(true);
  expect(error).toBeUndefined();
}

function expectInvalid(response, lang = 'en', reason = null) {
  const { valid, error } = validateResponse(response, lang);
  expect(valid).toBe(false);
  if (reason) expect(error.toLowerCase()).toContain(reason.toLowerCase());
}

// ─── Utterances ─────────────────────────────────────────────────────────────

const ID_UTTERANCES = {
  visitor:       'Budi mana?',
  visitorFull:   'Aku mau pulang, Budi sudah lama sekali belum datang.',
  anxiety:       'Aku takut, sesuatu rusak.',
  anxietyMixed:  'Takut, ada yang hilang di sini.',
  disorientation:'Kamu siapa? Kenapa aku di sini?',
  confusion:     'Apa yang terjadi? Kapan mereka datang?',
  noise:         'Aaa... zzz... hmm...',
  empty:         '',
  accusation:    'Kamu mencuri barang saya!',
  accusationMix: 'Kamu salah, bukan begitu! Sudah dibilang berkali-kali.',
};

const EN_UTTERANCES = {
  visitor:       "Where's Budi?",
  visitorFull:   "I want to go home. Budi hasn't come yet.",
  anxiety:       "I'm scared, something is wrong.",
  anxietyMixed:  "I'm worried, I think I lost something.",
  disorientation:"Who are you? Where am I?",
  confusion:     "When is my family coming? What time is it?",
  noise:         "Umm... zzz... aaa...",
  empty:         '',
  accusation:    "You stole my things!",
  accusationMix: "You remember wrong! I told you already.",
};

const ID_BANNED = [
  { field: 'validate', text: 'Ingat, kamu sudah di sini.' },
  { field: 'reassure', text: 'Sudah dibilang, Budi datang.' },
  { field: 'redirect', text: 'Bukan begitu yang kamu rasakan.' },
];

const EN_BANNED = [
  { field: 'validate', text: 'Remember, you have been here.' },
  { field: 'reassure', text: 'I told you, Budi is coming.' },
  { field: 'redirect', text: "That's not right." },
];

// ─── Run N times helper ─────────────────────────────────────────────────────

function runNTimes(fn, n = 3) {
  return Array.from({ length: n }, fn);
}

// ─── Validator: structure ────────────────────────────────────────────────────

describe('validator — structure', () => {
  const valid = { validate: 'Aku di sini.', reassure: 'Kamu aman.', redirect: 'Mari duduk.' };

  test.each(runNTimes(() => ({}), 3))('rejects non-object response', () => {
    expectInvalid(null);
    expectInvalid('just a string');
    expectInvalid([]);
  });

  test.each(runNTimes(() => ({}), 3))('rejects missing fields', () => {
    expectInvalid({ validate: 'a', reassure: 'b' }); // missing redirect
    expectInvalid({ validate: 'a', redirect: 'c' }); // missing reassure
    expectInvalid({ reassure: 'b', redirect: 'c' }); // missing validate
  });

  test.each(runNTimes(() => ({}), 3))('accepts valid 3-field object', () => {
    expectValid(valid);
    expectValid({ validate: 'Hi.', reassure: 'All good.', redirect: 'Relax.' });
  });
});

// ─── Validator: question marks ───────────────────────────────────────────────

describe('validator — no question marks', () => {
  test.each(runNTimes(() => ({}), 3))('rejects validate with ?', () => {
    expectInvalid({ validate: 'Apakah kamu baik?', reassure: 'Kamu aman.', redirect: 'Tenang.' }, 'id', '?');
    expectInvalid({ validate: 'Are you okay?', reassure: 'You are safe.', redirect: 'Relax.' }, 'en', '?');
  });

  test.each(runNTimes(() => ({}), 3))('rejects reassure with ?', () => {
    expectInvalid({ validate: 'Aku di sini.', reassure: 'Budi datang?', redirect: 'Mari duduk.' }, 'id', '?');
    expectInvalid({ validate: 'I am here.', reassure: "Is Budi coming?", redirect: 'Relax.' }, 'en', '?');
  });

  test.each(runNTimes(() => ({}), 3))('rejects redirect with ?', () => {
    expectInvalid({ validate: 'Tenang.', reassure: 'Aman.', redirect: 'Mau kopi?' }, 'id', '?');
    expectInvalid({ validate: 'Calm.', reassure: 'Safe.', redirect: "Would you like tea?" }, 'en', '?');
  });
});

// ─── Validator: banned phrases ───────────────────────────────────────────────

describe('validator — banned phrases', () => {
  test.each(runNTimes(() => ({}), 3))('ID: rejects all banned phrases', () => {
    for (const item of ID_BANNED) {
      const response = { validate: 'A.', reassure: 'B.', redirect: 'C.' };
      response[item.field] = item.text;
      expectInvalid(response, 'id', 'banned phrase');
    }
  });

  test.each(runNTimes(() => ({}), 3))('EN: rejects all banned phrases', () => {
    for (const item of EN_BANNED) {
      const response = { validate: 'A.', reassure: 'B.', redirect: 'C.' };
      response[item.field] = item.text;
      expectInvalid(response, 'en', 'banned phrase');
    }
  });

  test.each(runNTimes(() => ({}), 3))('case-insensitive detection', () => {
    expectInvalid({ validate: 'INGAT kamu.', reassure: 'Aman.', redirect: 'Duduk.' }, 'id', 'banned phrase');
    expectInvalid({ validate: 'I TOLD YOU.', reassure: 'Safe.', redirect: 'Relax.' }, 'en', 'banned phrase');
  });
});

// ─── Validator: word cap ─────────────────────────────────────────────────────

describe('validator — word cap (≤25 words)', () => {
  test.each(runNTimes(() => ({}), 3))('accepts ≤25 words total', () => {
    expectValid({ validate: 'Aku di sini.', reassure: 'Kamu aman.', redirect: 'Mari duduk.' });
    expectValid({ validate: 'It is okay to feel confused.', reassure: 'You are in a safe place.', redirect: 'I am here with you.' });
  });

  test.each(runNTimes(() => ({}), 3))('rejects >25 words total', () => {
    // Use 26 space-separated English words to clearly exceed the limit
    const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(' ');
    expectInvalid({ validate: 'Short.', reassure: 'Short.', redirect: long }, 'en', 'exceeds limit');
    expectInvalid({ validate: long, reassure: 'Short.', redirect: 'Short.' }, 'id', 'exceeds limit');
  });

  test.each(runNTimes(() => ({}), 3))('countWords helper is accurate', () => {
    expect(countWords('Aku di sini')).toBe(3);
    expect(countWords('It is okay to feel a little mixed up sometimes.')).toBe(10);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});

// ─── Validator: whole-word / phrase patterns (no substring false positives) ──

describe('validator — quizzing and correcting patterns', () => {
  const ok = (text, lang) => expectValid({ validate: text, reassure: lang === 'id' ? 'Aku di sini.' : 'I am here.', redirect: lang === 'id' ? 'Mari duduk.' : 'Let us sit.' }, lang);
  const bad = (text, lang) => expectInvalid({ validate: text, reassure: 'B.', redirect: 'C.' }, lang, 'banned phrase');

  test.each(runNTimes(() => ({}), 3))('validating phrases pass', () => {
    ok('Tidak salah kok merasa begitu.', 'id');
    ok('Pengingat makan malam jam 6.', 'id');       // "ingat" inside a word
    ok('Aku ingat lagu itu indah.', 'id');           // not a quiz
    ok('It is not wrong to feel this way.', 'en');
    ok('Let us listen to a song you love.', 'en');
  });

  test.each(runNTimes(() => ({}), 3))('quizzing and correcting are banned (ID)', () => {
    for (const t of ['Kamu lupa ya.', 'Sudah kubilang tadi.', 'Sudah dibilang.', 'Tadi kan sudah.', 'Apa kamu ingat dia.',
      'Ingat tidak.', 'Bukan begitu.', 'Kamu salah.', 'Sebenarnya dia sudah pergi.']) bad(t, 'id');
  });

  test.each(runNTimes(() => ({}), 3))('quizzing and correcting are banned (EN)', () => {
    for (const t of ['You forgot again.', 'I told you.', 'As I said.', 'Do you remember her.', "That's wrong.",
      'Actually, he is out.', 'You are wrong.']) bad(t, 'en');
  });

  test.each(runNTimes(() => ({}), 3))('stray non-Latin characters are rejected', () => {
    const { valid, rule } = validateResponse({ validate: 'Aku di sini陪着 kamu.', reassure: 'B.', redirect: 'C.' }, 'id');
    expect(valid).toBe(false);
    expect(rule).toBe('foreign_script');
  });
});

// ─── Fallback: situation detection ──────────────────────────────────────────

describe('fallback — situation detection', () => {
  test.each(runNTimes(() => ({}), 3))('ID utterances', () => {
    expect(detectTheme(ID_UTTERANCES.visitor, 'id')).toBe('asking_person');
    expect(detectTheme(ID_UTTERANCES.visitorFull, 'id')).toBe('go_home');
    expect(detectTheme(ID_UTTERANCES.anxiety, 'id')).toBe('scared');
    expect(detectTheme(ID_UTTERANCES.anxietyMixed, 'id')).toBe('scared');
    expect(detectTheme(ID_UTTERANCES.disorientation, 'id')).toBe('not_recognise');
  });

  test.each(runNTimes(() => ({}), 3))('EN utterances', () => {
    expect(detectTheme(EN_UTTERANCES.visitor, 'en')).toBe('asking_person');
    expect(detectTheme(EN_UTTERANCES.anxiety, 'en')).toBe('scared');
    expect(detectTheme(EN_UTTERANCES.disorientation, 'en')).toBe('not_recognise');
    expect(detectTheme('Where am I?', 'en')).toBe('confused');
  });

  test.each(runNTimes(() => ({}), 3))('falls back to generic for noise/empty', () => {
    expect(detectTheme(ID_UTTERANCES.noise, 'id')).toBe('generic');
    expect(detectTheme(EN_UTTERANCES.noise, 'en')).toBe('generic');
    expect(detectTheme(ID_UTTERANCES.empty, 'id')).toBe('generic');
  });
});

// ─── Fallback: every piece and every combination obeys the guardrails ───────

describe('fallback — library structure', () => {
  const LANGS = ['id', 'en'];
  const SLOTS = ['validate', 'reassure', 'redirect'];

  test.each(runNTimes(() => ({}), 3))('≥12 categories, ≥3 variants per slot (4 here), both languages', () => {
    expect(Object.keys(THEMES).length).toBeGreaterThanOrEqual(12);
    expect(Object.keys(THEMES)).toContain('generic');
    for (const theme of Object.values(THEMES)) {
      for (const lang of LANGS) for (const slot of SLOTS) {
        expect(theme[lang][slot].length).toBeGreaterThanOrEqual(3);
        for (const piece of theme[lang][slot]) expect(typeof piece).toBe('string');
      }
    }
  });

  test.each(runNTimes(() => ({}), 3))('every combination passes the validator (≤25 words, no ?, no banned phrase)', () => {
    for (const theme of Object.values(THEMES)) {
      for (const lang of LANGS) {
        const s = theme[lang];
        for (const v of s.validate) for (const r of s.reassure) for (const d of s.redirect) {
          expectValid({ validate: v, reassure: r, redirect: d }, lang);
          expect(hasQuestion(v + r + d)).toBe(false);
        }
      }
    }
  });

  test.each(runNTimes(() => ({}), 3))('returns _theme metadata', () => {
    expect(getFallback(ID_UTTERANCES.visitor, 'id')._theme).toBe('asking_person');
    expect(getFallback(ID_UTTERANCES.anxiety, 'id')._theme).toBe('scared');
    expect(getFallback(EN_UTTERANCES.disorientation, 'en')._theme).toBe('not_recognise');
  });
});

// ─── Fallback: missing context → generic comforting (FR-4.3.5) ─────────────────

describe('fallback — FR-4.3.5: missing params never throw', () => {
  test.each(runNTimes(() => ({}), 3))('works with null/undefined/empty context', () => {
    expect(() => getFallback(null, 'id')).not.toThrow();
    expect(() => getFallback(undefined, 'en')).not.toThrow();
    expect(() => getFallback('', 'id')).not.toThrow();
    expect(() => getFallback(123, 'en')).not.toThrow();
  });
});
