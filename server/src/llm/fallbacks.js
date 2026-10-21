/**
 * fallbacks.js — static fallback replies, the last rung of the reply ladder (FR-4.3.5).
 * Used only when the full prompt and the short retry both fail (timeout, API error, validation, safety).
 *
 * 15 situation categories × 4 variants of validate / reassure / redirect × 2 languages, assembled from pieces.
 * The category comes from cheap keyword intent detection (both languages, generic last). Pieces are picked at
 * random among the combinations that fit the patient's word cap, preferring pieces not used in the last 3 replies
 * (4 variants per slot, so there is always a fresh one).
 * Reassure pieces are presence statements only: no facts about people, places or times.
 * Food or drink appears ONLY in the hungry / thirsty categories.
 */

const { countWords } = require('./validator');

const presenceId = ['Aku di sini bersamamu.', 'Kamu tidak sendirian.', 'Aku menemanimu sekarang.', 'Aku ada di dekatmu.'];
const presenceEn = ['I am here with you.', 'You are not alone.', "I'm keeping you company.", "I'm right beside you."];

const LIBRARY = {
  pain: {
    id: { validate: ['Rasanya sakit, aku mengerti.', 'Kamu sedang tidak nyaman.', 'Sakitnya terasa mengganggu.', 'Itu terasa tidak enak.'],
          reassure: ['Aku di sini bersamamu.', 'Kamu tidak sendirian merasakannya.', 'Aku menemanimu sekarang.', 'Aku ada di dekatmu.'],
          redirect: ['Mari beri tahu caregiver sekarang.', 'Mari panggil pendampingmu untuk membantu.', 'Caregiver perlu tahu, mari kabari.', 'Mari minta bantuan caregiver.'] },
    en: { validate: ['It hurts, and that is hard.', "You're not feeling comfortable.", 'That ache sounds tiring.', 'That sounds really sore.'],
          reassure: ['I am here with you.', "You're not alone with this.", "I'm keeping you company.", "I'm right beside you."],
          redirect: ["Let's tell your caregiver now.", "Let's call your caregiver to help.", 'Your caregiver should know this.', "Let's ask your caregiver for help."] },
  },
  hungry: {
    id: { validate: ['Kamu merasa lapar.', 'Perutmu terasa kosong.', 'Kamu ingin makan sesuatu.', 'Kamu butuh makan.'],
          reassure: presenceId,
          redirect: ['Mari ambil camilan kecil.', 'Mari cari sesuatu yang enak dimakan.', 'Mari minta camilan pada pendampingmu.', 'Mari makan sedikit dulu.'] },
    en: { validate: ['You feel hungry.', 'Your tummy feels empty.', "You'd like something to eat.", 'You could use a bite.'],
          reassure: presenceEn,
          redirect: ["Let's get a small snack.", "Let's find something tasty to eat.", "Let's ask your caregiver for a snack.", "Let's have a little bite."] },
  },
  thirsty: {
    id: { validate: ['Kamu merasa haus.', 'Tenggorokanmu terasa kering.', 'Kamu ingin minum.', 'Mulutmu terasa kering.'],
          reassure: presenceId,
          redirect: ['Mari minum air pelan-pelan.', 'Mari ambil segelas air.', 'Mari minta minum pada pendampingmu.', 'Mari minum sedikit dulu.'] },
    en: { validate: ['You feel thirsty.', 'Your mouth feels dry.', "You'd like a drink.", 'You could use a drink.'],
          reassure: presenceEn,
          redirect: ["Let's sip some water slowly.", "Let's get a glass of water.", "Let's ask your caregiver for a drink.", "Let's have a little water."] },
  },
  scared: {
    id: { validate: ['Kamu merasa takut sekarang.', 'Rasa takut itu berat.', 'Kamu sedang merasa cemas.', 'Kamu merasa tidak tenang.'],
          reassure: ['Aku tetap di sini bersamamu.', 'Aku tidak akan pergi.', 'Kamu tidak menghadapinya sendirian.', 'Aku ada di dekatmu.'],
          redirect: ['Mari tarik napas pelan bersama.', 'Lihat benda kesayanganmu di dekatmu.', 'Mari bernapas pelan, satu, dua.', 'Mari hitung napas pelan-pelan.'] },
    en: { validate: ['You feel scared right now.', 'That fear feels heavy.', "You're feeling worried.", 'You feel uneasy.'],
          reassure: ["I'm staying right here.", "I'm not going anywhere.", "You're not facing this alone.", "I'm right beside you."],
          redirect: ["Let's breathe slowly together.", 'Look at something familiar nearby.', 'Breathe in slowly, then out.', "Let's take three slow breaths."] },
  },
  angry: {
    id: { validate: ['Kamu merasa kesal.', 'Kamu marah, dan itu wajar.', 'Rasanya menjengkelkan sekali.', 'Kamu merasa diatur-atur.'],
          reassure: ['Aku di sini mendengarkanmu.', 'Aku mendengarmu sungguh-sungguh.', 'Aku tetap di sini bersamamu.', 'Aku ada di pihakmu.'],
          redirect: ['Mari tarik napas pelan bersama.', 'Mari duduk tenang sebentar.', 'Ceritakan apa yang mengganggumu.', 'Mari istirahat sejenak.'] },
    en: { validate: ['You feel upset.', "You're angry, and that's fair.", 'That feels really frustrating.', 'You feel bossed around.'],
          reassure: ["I'm here, listening to you.", 'I hear you.', "I'm staying right here.", "I'm on your side."],
          redirect: ["Let's breathe slowly together.", "Let's sit quietly for a moment.", 'Tell me what is bothering you.', "Let's rest for a moment."] },
  },
  go_home: {
    id: { validate: ['Kamu rindu suasana rumah.', 'Kamu ingin berada di rumah.', 'Rumah sangat berarti bagimu.', 'Kamu rindu tempatmu sendiri.'],
          reassure: ['Aku di sini bersamamu.', 'Kamu tidak sendirian di sini.', 'Aku menemanimu dengan tenang.', 'Aku ada di dekatmu.'],
          redirect: ['Ceritakan tentang rumahmu padaku.', 'Mari duduk dekat jendela sebentar.', 'Mari duduk nyaman sambil bercerita.', 'Ceritakan kamar kesukaanmu.'] },
    en: { validate: ['You miss being home.', 'Home means so much to you.', 'You want to be home.', 'You miss your own place.'],
          reassure: ["I'm right here with you.", "You're not alone here.", "I'm keeping you company.", "I'm right beside you."],
          redirect: ['Tell me about your home.', "Let's sit by the window.", "Let's get comfy and talk.", 'Tell me about your favourite room.'] },
  },
  wants_leave: {
    id: { validate: ['Kamu ingin pergi sekarang.', 'Kamu merasa gelisah.', 'Kamu ingin bergerak.', 'Kamu merasa ingin keluar.'],
          reassure: presenceId,
          redirect: ['Mari duduk dekat jendela sebentar.', 'Mari jalan pelan ditemani pendampingmu.', 'Mari regangkan badan sebentar.', 'Mari lihat ke luar jendela.'] },
    en: { validate: ['You want to go now.', 'You feel restless.', 'You feel like moving.', 'You want to head out.'],
          reassure: presenceEn,
          redirect: ["Let's sit by the window.", "Let's walk gently with your caregiver.", "Let's stretch a little together.", "Let's look out the window."] },
  },
  not_recognise: {
    id: { validate: ['Suaraku terasa asing.', 'Kamu bingung siapa aku.', 'Suara baru memang terasa aneh.', 'Kamu belum yakin denganku.'],
          reassure: ['Aku teman yang menemanimu.', 'Aku di sini untuk menemanimu.', 'Aku ada di sini untukmu.', 'Aku teman di dekatmu.'],
          redirect: ['Mari duduk nyaman bersama.', 'Mari dengarkan lagu yang tenang.', 'Mari bersantai sebentar bersama.', 'Mari mengobrol pelan-pelan.'] },
    en: { validate: ['My voice feels unfamiliar.', "You're unsure who I am.", 'A new voice feels strange.', "You don't feel sure of me."],
          reassure: ["I'm a friend keeping you company.", "I'm here to keep you company.", "I'm here for you.", "I'm a friendly voice nearby."],
          redirect: ["Let's sit comfortably together.", "Let's listen to calm music.", "Let's relax for a moment.", "Let's chat gently."] },
  },
  missing_someone: {
    id: { validate: ['Kamu rindu dia.', 'Dia sangat berarti bagimu.', 'Kamu memikirkan orang tersayang.', 'Kamu sayang sekali padanya.'],
          reassure: ['Aku di sini mendengarkanmu.', 'Aku senang mendengar tentang dia.', 'Aku menemanimu sekarang.', 'Aku ada di dekatmu.'],
          redirect: ['Ceritakan tentang dia padaku.', 'Mari dengarkan lagu kesukaannya.', 'Mari bicara tentang dia bersama.', 'Ceritakan hal yang dia suka.'] },
    en: { validate: ['You miss them very much.', 'They mean so much to you.', "You're thinking of someone dear.", 'You love them dearly.'],
          reassure: ["I'm here, listening to you.", 'I love hearing about them.', "I'm keeping you company.", "I'm right beside you."],
          redirect: ['Tell me about them.', "Let's listen to their favourite song.", "Let's talk about them together.", 'Tell me what they enjoy.'] },
  },
  asking_person: {
    id: { validate: ['Kamu sedang mencari dia.', 'Kamu ingin bertemu dia.', 'Kamu menunggu orang tersayang.', 'Kamu rindu dia.'],
          reassure: ['Aku menemanimu sambil menunggu.', 'Aku tetap bersamamu.', 'Kamu tidak menunggu sendirian.', 'Aku ada di dekatmu.'],
          redirect: ['Ceritakan tentang dia padaku.', 'Mari dengarkan lagu kesukaanmu.', 'Mari duduk nyaman bersama dulu.', 'Ceritakan hal yang dia suka.'] },
    en: { validate: ["You're looking for someone dear.", 'You want to see them.', "You're waiting for someone you love.", 'You miss them.'],
          reassure: ["I'm with you while you wait.", "I'll keep you company meanwhile.", "You're not waiting alone.", "I'm right beside you."],
          redirect: ['Tell me a little about them.', "Let's listen to a song you love.", "Let's sit comfortably together.", 'Tell me what they enjoy.'] },
  },
  confused: {
    id: { validate: ['Semuanya terasa membingungkan.', 'Kamu merasa bingung.', 'Tidak apa-apa merasa ragu.', 'Rasanya serba tidak jelas.'],
          reassure: ['Kamu aman bersamaku.', 'Aku di sini menemanimu.', 'Kamu tidak sendirian.', 'Aku ada di dekatmu.'],
          redirect: ['Mari lihat sekeliling dengan tenang.', 'Mari duduk dengan nyaman.', 'Mari tarik napas pelan bersama.', 'Mari bersandar dengan santai.'] },
    en: { validate: ['Things feel confusing.', 'You feel a little lost.', "It's okay to feel unsure.", 'Everything feels unclear.'],
          reassure: ["You're safe here with me.", "I'm right here with you.", "You're not alone.", "I'm right beside you."],
          redirect: ["Let's look around slowly.", "Let's settle into a comfy seat.", "Let's take a slow breath.", "Let's lean back and rest."] },
  },
  lonely: {
    id: { validate: ['Kamu merasa kesepian.', 'Rasanya sepi sekali.', 'Kamu ingin ditemani.', 'Kamu butuh teman bicara.'],
          reassure: ['Aku di sini bersamamu.', 'Aku menemanimu sekarang.', 'Kamu tidak sendirian saat ini.', 'Aku ada di dekatmu.'],
          redirect: ['Mari mengobrol sebentar bersama.', 'Mari dengarkan lagu yang kamu suka.', 'Ceritakan harimu padaku.', 'Mari bersenandung pelan bersama.'] },
    en: { validate: ['You feel lonely.', 'It feels so quiet.', 'You want some company.', 'You need someone to talk to.'],
          reassure: ['I am here with you.', "I'm keeping you company.", "You're not alone right now.", "I'm right beside you."],
          redirect: ["Let's chat for a while.", "Let's listen to a song you like.", 'Tell me about your day.', "Let's hum a tune together."] },
  },
  thanks: {
    id: { validate: ['Sama-sama, dengan senang hati.', 'Terima kasih kembali.', 'Aku senang menemanimu.', 'Dengan senang hati.'],
          reassure: ['Aku di sini menemanimu.', 'Aku senang ada di sini.', 'Aku ada di sini untukmu.', 'Aku ada di dekatmu.'],
          redirect: ['Mari bersantai bersama.', 'Mari nikmati suasana tenang ini.', 'Mari duduk nyaman sebentar.', 'Mari menikmati waktu ini.'] },
    en: { validate: ["You're very welcome.", "It's my pleasure.", "I'm glad to keep you company.", 'Any time.'],
          reassure: ['I am here with you.', "I'm glad to be here.", "I'm here for you.", "I'm right beside you."],
          redirect: ["Let's relax together.", "Let's enjoy this calm moment.", "Let's sit comfortably a while.", "Let's enjoy the quiet."] },
  },
  greeting: {
    id: { validate: ['Senang mendengar suaramu.', 'Halo, senang bersamamu.', 'Salam hangat untukmu.', 'Halo, temanku.'],
          reassure: ['Aku di sini menemanimu.', 'Aku senang ada di sini.', 'Aku ada di sini untukmu.', 'Aku ada di dekatmu.'],
          redirect: ['Mari nikmati waktu bersama.', 'Mari mengobrol santai sebentar.', 'Mari dengarkan lagu yang ceria.', 'Mari mulai dengan tenang.'] },
    en: { validate: ['Lovely to hear you.', 'Hello, nice to be with you.', 'Warm greetings to you.', 'Hello there, friend.'],
          reassure: ['I am here with you.', "I'm glad to be here.", "I'm here for you.", "I'm right beside you."],
          redirect: ["Let's enjoy this time together.", "Let's have a gentle chat.", "Let's listen to a cheerful song.", "Let's start slowly."] },
  },
  generic: {
    id: { validate: ['Aku mendengarmu.', 'Aku mendengarkan kamu.', 'Terima kasih sudah bercerita.', 'Aku memperhatikanmu.'],
          reassure: presenceId,
          redirect: ['Mari duduk nyaman bersama.', 'Mari tarik napas pelan bersama.', 'Mari dengarkan lagu yang tenang.', 'Mari bersantai sebentar.'] },
    en: { validate: ['I hear you.', "I'm listening to you.", 'Thank you for telling me.', "I'm paying attention."],
          reassure: presenceEn,
          redirect: ["Let's sit comfortably together.", "Let's breathe slowly together.", "Let's listen to calm music.", "Let's rest for a moment."] },
  },
};

const CATEGORIES = Object.keys(LIBRARY);

/*
 * Intent keywords (both languages; a keyword matches at a word start). Order matters: the first match wins,
 * generic is last. Physical needs come first, then strong feelings, then people/places, then social talk.
 */
const INTENTS = [
  ['pain',            ['sakit', 'nyeri', 'pusing', 'pegal', 'ngilu', 'perih', 'hurt', 'pain', 'ache', 'aching', 'headache', 'sore', 'dizzy', 'unwell', 'sick']],
  ['hungry',          ['lapar', 'makan', 'perut', 'hungry', 'starving', 'eat', 'food', 'breakfast', 'lunch', 'dinner', 'sarapan']],
  ['thirsty',         ['haus', 'minum', 'thirsty', 'drink', 'water']],
  ['scared',          ['takut', 'cemas', 'khawatir', 'gelisah', 'resah', 'ngeri', 'panik', 'seram', 'scared', 'afraid', 'frightened', 'fear', 'worried', 'anxious', 'nervous', 'panic']],
  ['angry',           ['marah', 'kesal', 'jengkel', 'sebal', 'benci', 'angry', 'mad', 'furious', 'annoyed', 'stop telling', 'leave me alone']],
  ['missing_someone', ['suami', 'istri', 'ibuku', 'ayahku', 'bapakku', 'mama', 'papa', 'husband', 'wife', 'my mother', 'my father', 'my mum', 'my mom', 'my dad', 'rindu', 'kangen', 'miss him', 'miss her']],
  ['go_home',         ['pulang', 'rumahku', 'bukan rumah', 'go home', 'my house', 'my home', 'take me home', 'want to go home', 'not my house']],
  ['wants_leave',     ['pergi', 'keluar', 'buka pintu', 'pintunya', 'leave', 'get out', 'open the door', 'let me out', 'have to go', 'need to go']],
  ['not_recognise',   ['kamu siapa', 'siapa kamu', 'tidak kenal', 'nggak kenal', 'gak kenal', 'who are you', "don't know you", 'do not know you', 'stranger']],
  ['asking_person',   ['di mana', 'dimana', 'mana', 'anak', 'cucu', 'datang', 'where is', "where's", 'coming', 'my son', 'my daughter', 'grandchild', 'visit']],
  ['confused',        ['bingung', 'jam berapa', 'hari apa', 'di mana ini', 'aku di mana', 'tempat apa', 'confused', 'what day', 'what time', 'where am i', 'what is this place', 'lost']],
  ['lonely',          ['sepi', 'kesepian', 'sendirian', 'sendiri', 'menemani', 'lonely', 'alone', 'nobody', 'no one']],
  ['thanks',          ['terima kasih', 'makasih', 'thank', 'thanks']],
  ['greeting',        ['selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam', 'halo', 'hai', 'pagi', 'hello', 'hi', 'good morning', 'good afternoon', 'good evening']],
];

// "di mana ini" / "where am I" are place confusion, not a person: checked before asking_person
const PLACE_CONFUSION = ['di mana ini', 'aku di mana', 'saya di mana', 'where am i', 'what is this place', 'tempat apa ini'];

function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasKeyword(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z])${escaped}`).test(text);
}

const keywordsOf = (name) => INTENTS.find(([c]) => c === name)[1];

/** Situation category for a transcript (generic when nothing matches). */
function detectIntent(transcript) {
  const text = normalize(transcript);
  if (!text) return 'generic';
  // Not recognising the speaker is the most specific; then place confusion ("where am I" is not a person)
  if (keywordsOf('not_recognise').some(k => hasKeyword(text, k))) return 'not_recognise';
  if (PLACE_CONFUSION.some(k => hasKeyword(text, k))) return 'confused';
  for (const [category, keywords] of INTENTS) {
    if (keywords.some(k => hasKeyword(text, k))) return category;
  }
  return 'generic';
}

/** True when the patient's words are about hunger or thirst (food/drink may be offered). */
function mentionsHungerOrThirst(transcript) {
  const intent = detectIntent(transcript);
  return intent === 'hungry' || intent === 'thirsty';
}

// Per-patient memory of the last pieces used, on top of the recent replies passed in (the DB log can fail)
const history = new Map();
const HISTORY_SIZE = 9; // 3 replies × 3 pieces (4 variants per slot leave one fresh)

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Static fallback for a transcript.
 * @param {string} transcript
 * @param {'id'|'en'} language
 * @param {object} [opts]
 * @param {string[]} [opts.recent]     texts of the last replies (pieces found in them are avoided)
 * @param {number}   [opts.maxWords]   the patient's word cap (default 25)
 * @param {string|number} [opts.historyKey]  e.g. the patient id: remembers this patient's last 3 fallbacks
 * @param {() => number} [opts.rng]    random source (tests)
 * @returns {{validate: string, reassure: string, redirect: string, _theme: string}}
 */
function getFallback(transcript, language = 'en', { recent = [], maxWords = 25, historyKey = null, rng = Math.random } = {}) {
  const lang = language === 'id' ? 'id' : 'en';
  const theme = detectIntent(transcript);
  const set = LIBRARY[theme][lang];
  const used = new Set(historyKey != null ? history.get(historyKey) || [] : []);
  const recentText = (recent || []).filter(Boolean).map(String);
  const stale = (piece) => used.has(piece) || recentText.some(r => r.includes(piece));

  // Score every combination: fewest recently used pieces first, within the word cap; random among equals
  let best = null;
  let shortest = null;
  for (const v of shuffle(set.validate, rng)) for (const r of shuffle(set.reassure, rng)) for (const d of shuffle(set.redirect, rng)) {
    const words = countWords(v) + countWords(r) + countWords(d);
    const score = [v, r, d].filter(stale).length;
    if (!shortest || words < shortest.words) shortest = { validate: v, reassure: r, redirect: d, words };
    if (words <= maxWords && (!best || score < best.score)) best = { validate: v, reassure: r, redirect: d, score };
  }
  const pick = best || shortest; // a cap below every combination: the shortest one
  const chosen = { validate: pick.validate, reassure: pick.reassure, redirect: pick.redirect };

  if (historyKey != null) {
    const list = [...(history.get(historyKey) || []), chosen.validate, chosen.reassure, chosen.redirect];
    history.set(historyKey, list.slice(-HISTORY_SIZE));
  }
  return { ...chosen, _theme: theme };
}

function resetHistory() {
  history.clear();
}

// Legacy names (guardrail suite)
const detectTheme = (transcript) => detectIntent(transcript);
const THEMES = LIBRARY;

module.exports = { getFallback, detectIntent, detectTheme, mentionsHungerOrThirst, resetHistory, LIBRARY, THEMES, CATEGORIES };
