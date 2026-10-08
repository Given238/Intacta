/**
 * fallbacks.js — Themed fallback scripts (FR-4.3.5).
 * Used when LLM fails, times out, or double-rejects.
 * Theme is auto-detected from transcript keywords.
 */

const THEMES = {
  visitor: {
    id: {
      validate: 'Aku tahu kamu mengharapkan seseorang hari ini.',
      reassure: 'Orang-orang yang sayang padamu selalu datang.',
      redirect: 'Mari kita duduk bersama dengan nyaman sambil menunggu.',
    },
    en: {
      validate: 'I know you were expecting someone today.',
      reassure: 'The people who love you always come.',
      redirect: "Let's sit together comfortably while we wait.",
    },
  },
  anxiety: {
    id: {
      validate: 'Aku di sini陪着 kamu.',
      reassure: 'Kamu aman di sini, bersama aku.',
      redirect: 'Boleh cerita apa yang kamu rasakan? Saya dengarkan.',
    },
    en: {
      validate: "I'm right here with you.",
      reassure: 'You are safe here, with me.',
      redirect: 'Would you like to tell me how you feel? I am listening.',
    },
  },
  disorientation: {
    id: {
      validate: 'Tidak apa-apa merasa bingung.',
      reassure: 'Kamu di tempat yang aman.',
      redirect: 'Mari kita nikmati waktu bersama ini.',
    },
    en: {
      validate: "It's okay to feel a little mixed up.",
      reassure: 'You are in a safe and comfortable place.',
      redirect: "Let's enjoy this moment together.",
    },
  },
  generic: {
    id: {
      validate: 'Aku di sini untuk kamu.',
      reassure: 'Kamu tidak sendiri hari ini.',
      redirect: 'Mari kita nikmati waktu bersama.',
    },
    en: {
      validate: 'I am right here with you.',
      reassure: 'You are not alone today.',
      redirect: "Let's spend this time together.",
    },
  },
};

const VISITOR_KEYWORDS_ID  = ['mana', 'pulang', 'tunggu', 'datang', 'orang', 'keluarga', 'anak', 'suami', 'istri', 'cucu'];
const ANXIETY_KEYWORDS_ID  = ['takut', 'khawatir', 'resah', 'gelisah', 'rusak', 'hilang', 'sakit', 'paran'];
const ANXIETY_KEYWORDS_EN  = ['afraid', 'scared', 'worried', 'nervous', 'anxious', 'lost', 'hurt'];
const CONFUSION_KEYWORDS   = ['siapa', 'apa', 'kapan', 'where', 'who', 'when', 'what', 'kenapa', 'why'];
const NOISE_KEYWORDS       = ['aaa', 'zzz', 'zzz', 'hmm', 'mmm', '???', '...', 'eh', 'uh', 'um'];

function detectTheme(transcript, language = 'en') {
  const lower = String(transcript || '').toLowerCase();

  if (language === 'id') {
    if (VISITOR_KEYWORDS_ID.some(k => lower.includes(k))) return 'visitor';
    if (ANXIETY_KEYWORDS_ID.some(k => lower.includes(k))) return 'anxiety';
  }
  if (ANXIETY_KEYWORDS_EN.some(k => lower.includes(k))) return 'anxiety';
  if (CONFUSION_KEYWORDS.some(k => lower.includes(k)))   return 'disorientation';
  if (NOISE_KEYWORDS.some(k => lower.includes(k)))       return 'generic';

  return 'generic';
}

function getFallback(transcript, language = 'en') {
  const theme = detectTheme(transcript, language);
  const scripts = THEMES[theme]?.[language] ?? THEMES.generic[language] ?? THEMES.generic.en;
  return { ...scripts, _theme: theme };
}

module.exports = { getFallback, detectTheme, THEMES };
