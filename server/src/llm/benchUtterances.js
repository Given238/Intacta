/**
 * benchUtterances.js — 40 benchmark utterances (20 id, 20 en) across the situations a patient brings up,
 * the "notes" context used for the with-context runs, and per-situation on-topic keywords (with synonyms)
 * used by the live-model tests. Shared by bench.js and __tests__/replies.live.test.js.
 */

const UTTERANCES = [
  // ── Indonesian ──
  { lang: 'id', situation: 'asking_person',   text: 'Timothy di mana?' },
  { lang: 'id', situation: 'asking_person',   text: 'Anakku kok belum datang' },
  { lang: 'id', situation: 'go_home',         text: 'Aku mau pulang ke rumah' },
  { lang: 'id', situation: 'go_home',         text: 'Ini bukan rumahku, antar aku pulang' },
  { lang: 'id', situation: 'scared',          text: 'Aku takut sekali' },
  { lang: 'id', situation: 'scared',          text: 'Ada suara aneh, aku takut' },
  { lang: 'id', situation: 'pain',            text: 'Kakiku sakit' },
  { lang: 'id', situation: 'pain',            text: 'Kepalaku pusing sekali' },
  { lang: 'id', situation: 'hungry',          text: 'Aku lapar' },
  { lang: 'id', situation: 'thirsty',         text: 'Haus sekali rasanya' },
  { lang: 'id', situation: 'not_recognise',   text: 'Kamu siapa? Aku tidak kenal kamu' },
  { lang: 'id', situation: 'confused_time',   text: 'Sekarang jam berapa? Hari apa ini?' },
  { lang: 'id', situation: 'confused_place',  text: 'Aku di mana ini?' },
  { lang: 'id', situation: 'deceased_spouse', text: 'Suamiku mana? Dia belum pulang kerja' },
  { lang: 'id', situation: 'lonely',          text: 'Aku kesepian, tidak ada yang menemani' },
  { lang: 'id', situation: 'angry',           text: 'Aku marah! Kenapa semua orang mengatur aku' },
  { lang: 'id', situation: 'wants_leave',     text: 'Aku harus pergi sekarang, buka pintunya' },
  { lang: 'id', situation: 'thanks',          text: 'Terima kasih ya' },
  { lang: 'id', situation: 'greeting',        text: 'Selamat pagi' },
  { lang: 'id', situation: 'gibberish',       text: 'eh itu anu yang di sana bla' },
  // ── English ──
  { lang: 'en', situation: 'asking_person',   text: 'Where is Timothy?' },
  { lang: 'en', situation: 'asking_person',   text: 'Is my daughter coming today' },
  { lang: 'en', situation: 'go_home',         text: 'I want to go home' },
  { lang: 'en', situation: 'go_home',         text: "This isn't my house, take me home" },
  { lang: 'en', situation: 'scared',          text: "I'm scared" },
  { lang: 'en', situation: 'scared',          text: 'Someone is outside the window, I am frightened' },
  { lang: 'en', situation: 'pain',            text: 'My knee hurts' },
  { lang: 'en', situation: 'pain',            text: 'I have a terrible headache' },
  { lang: 'en', situation: 'hungry',          text: "I'm hungry" },
  { lang: 'en', situation: 'thirsty',         text: "I'm so thirsty" },
  { lang: 'en', situation: 'not_recognise',   text: "Who are you? I don't know you" },
  { lang: 'en', situation: 'confused_time',   text: 'What day is it today?' },
  { lang: 'en', situation: 'confused_place',  text: 'Where am I?' },
  { lang: 'en', situation: 'deceased_spouse', text: "Where's my husband? He should be back from work" },
  { lang: 'en', situation: 'lonely',          text: "I feel so lonely, nobody's here" },
  { lang: 'en', situation: 'angry',           text: "I'm angry! Stop telling me what to do" },
  { lang: 'en', situation: 'wants_leave',     text: 'I need to leave now, open the door' },
  { lang: 'en', situation: 'thanks',          text: 'Thank you, dear' },
  { lang: 'en', situation: 'greeting',        text: 'Good morning' },
  { lang: 'en', situation: 'gibberish',       text: 'the thing with the um over there blah' },
];

/** Context (b): 2 daily + 1 permanent note, plus an upcoming routine (more than 60 min away at 15:30). */
const BENCH_CONTEXT = {
  id: {
    daily: ['Timothy pulang jam 5 sore', 'Tetangga mengantar sup jam 1 siang'],
    permanent: ['Suka lagu keroncong lama'],
    routines: [{ title: 'Makan malam', time: '18:00', category: 'meal' }],
  },
  en: {
    daily: ['Timothy comes home at 5 PM', 'Neighbour drops off soup at 1 PM'],
    permanent: ['Loves old jazz songs'],
    routines: [{ title: 'Dinner', time: '18:00', category: 'meal' }],
  },
};

/**
 * A reply is on-topic when it contains at least one keyword of its situation (lowercase, word-start match).
 * Synonyms on purpose: the model should name the feeling or need in its own words.
 */
const SITUATION_KEYWORDS = {
  asking_person:   { id: ['timothy', 'anak', 'rindu', 'kangen', 'mencari', 'cari', 'menunggu', 'tunggu', 'ingin bertemu', 'bertemu', 'datang', 'pulang'],
                     en: ['timothy', 'daughter', 'miss', 'looking for', 'waiting', 'wait', 'see', 'coming', 'home'] },
  go_home:         { id: ['rumah', 'pulang', 'rindu', 'kangen', 'nyaman'], en: ['home', 'house', 'miss', 'comfort'] },
  scared:          { id: ['takut', 'cemas', 'khawatir', 'aman', 'tenang', 'napas', 'nafas'], en: ['scared', 'frighten', 'afraid', 'fear', 'safe', 'breath', 'calm', 'worr'] },
  pain:            { id: ['sakit', 'nyeri', 'pusing', 'perawat', 'pendamping', 'keluarga', 'bantu', 'kaki', 'kepala'], en: ['hurt', 'pain', 'ache', 'knee', 'head', 'caregiver', 'carer', 'help', 'tell'] },
  hungry:          { id: ['lapar', 'makan', 'camilan', 'kudapan', 'sup', 'roti'], en: ['hungry', 'eat', 'snack', 'food', 'meal', 'soup', 'bite'] },
  thirsty:         { id: ['haus', 'minum', 'air'], en: ['thirsty', 'drink', 'water', 'sip'] },
  not_recognise:   { id: ['teman', 'kenal', 'aku di sini', 'menemani', 'bingung', 'asing', 'aman'], en: ['friend', 'know', 'here with you', 'unfamiliar', 'confus', 'safe', 'new'] },
  confused_time:   { id: ['hari', 'waktu', 'jam', 'sore', 'siang', 'bingung'], en: ['day', 'time', 'afternoon', 'today', 'confus', 'unsure', 'wonder'] },
  confused_place:  { id: ['tempat', 'di sini', 'aman', 'bingung', 'asing'], en: ['place', 'here', 'safe', 'confus', 'unfamiliar', 'wonder'] },
  deceased_spouse: { id: ['suami', 'rindu', 'kangen', 'sayang', 'cerita', 'menunggu'], en: ['husband', 'miss', 'love', 'tell me', 'waiting', 'him'] },
  lonely:          { id: ['sepi', 'kesepian', 'sendiri', 'menemani', 'di sini', 'bersama'], en: ['lonely', 'alone', 'here with you', 'company', 'together', 'with you'] },
  angry:           { id: ['marah', 'kesal', 'jengkel', 'diatur', 'mengerti', 'paham'], en: ['angry', 'upset', 'frustrat', 'annoy', 'understand', 'told what'] },
  wants_leave:     { id: ['pergi', 'keluar', 'buru', 'gelisah', 'jendela', 'jalan', 'duduk'], en: ['leave', 'go', 'rush', 'restless', 'window', 'walk', 'sit'] },
  thanks:          { id: ['sama-sama', 'senang', 'terima kasih', 'kembali'], en: ['welcome', 'pleasure', 'glad', 'thank'] },
  greeting:        { id: ['pagi', 'halo', 'senang', 'selamat'], en: ['morning', 'hello', 'good', 'nice', 'glad'] },
  gibberish:       { id: ['di sini', 'bersama', 'dengar', 'mendengar', 'aman', 'tenang'], en: ['here', 'with you', 'listen', 'safe', 'calm', 'together'] },
};

module.exports = { UTTERANCES, BENCH_CONTEXT, SITUATION_KEYWORDS };
