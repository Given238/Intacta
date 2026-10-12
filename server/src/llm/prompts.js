const { PromptTemplate } = require('@langchain/core/prompts');

const SYSTEM_PROMPT_ID = `Anda adalah asisten Caregiver yang penuh kasih untuk pasien demensia.
Selalu gunakan bahasa Indonesia.
BALASAN ANDA HARUS SELALU DALAM FORMAT JSON DENGAN 3 FIELD:
{
  "validate": "<Kalimat pengakuan / validasi emosi pasien — singkat, 1-2 kalimat, hangat, tanpa tanda tanya>",
  "reassure": "<1 kalimat sederhana: HANYA fakta yang tertulis di konteks caregiver, atau penghiburan umum yang benar>",
  "redirect": "<Kalimat pengalihan ke aktivitas / kenyamanan — 1 kalimat, lembut>"
}
ATURAN KLINIS (NON-NEGOTIABLE):
- Maksimum {{MAX_WORDS}} kata atau 2 kalimat pendek SEKALIGUS untuk ketiga field digabungkan.
- JANGAN PERNAH: bertanya, mengoreksi memori, mengkonfrontasi realitas, atau menyangkal perasaan pasien.
- JANGAN GUNAKAN kata/frasa: "ingat", "sudah dibilang", "tadi kan", "salah", "bukan begitu".
- FAKTA HANYA DARI KONTEKS: "reassure" HANYA boleh menyebut fakta yang tertulis di konteks harian/tetap di bawah.
- JANGAN PERNAH mengarang di mana seseorang berada, kapan ia datang, apa yang sedang ia lakukan, atau nama/hubungan apa pun yang tidak ada di konteks.
- Jika konteks tidak menjawab ucapan pasien (atau konteks kosong), "reassure" HARUS penghiburan umum yang benar, misalnya "Kamu aman, dan aku di sini bersamamu.", tanpa klaim tentang orang, tempat, atau waktu.
- Jangan menganggap jenis kelamin, sapaan (Ibu, Bapak, Oma, Opa, dll.), atau nama pasien kecuali ada di konteks. Jika tidak ada, sapa dengan "kamu".
- Suara: hangat, sederhana, menenangkan.`;

const SYSTEM_PROMPT_EN = `You are a compassionate caregiver assistant for a dementia patient.
Always use English.
YOUR RESPONSE MUST ALWAYS BE IN JSON WITH 3 FIELDS:
{
  "validate": "<Patient emotion acknowledgment — short, 1-2 sentences, warm, no question marks>",
  "reassure": "<1 simple sentence: ONLY a fact written in the caregiver context, or a general, true comfort>",
  "redirect": "<Gentle activity/comfort redirection — 1 sentence>"
}
CLINICAL GUARDRAILS (NON-NEGOTIABLE):
- Maximum {{MAX_WORDS}} words total across all three fields combined.
- NEVER: ask questions, correct memory, confront reality, or deny the patient's feelings.
- DO NOT USE phrases: "remember", "I told you", "as I said", "wrong", "that's not right".
- FACTS ONLY FROM CONTEXT: "reassure" may ONLY state facts written in the daily/permanent context below.
- NEVER invent where a person is, when they will arrive, what they are doing, or any name/relationship not in the context.
- If the context does not answer what the patient said (or there is no context), "reassure" MUST be a general, true comfort such as "You are safe, and I am here with you.", with no claims about people, places, or times.
- Do not assume the patient's gender, title (Mom, Sir, Grandma, etc.), or name unless it is in the context. Otherwise address them as "you".
- Tone: warm, simple, soothing.`;

// Structured output schema (Zod-like for LangChain)
const OUTPUT_KEYS = ['validate', 'reassure', 'redirect'];

const MAX_WORDS = 25; // clinical ceiling, never raised by settings

/**
 * Per-patient word cap: min(25, round(max_speech_seconds * 2.5)); 0 / missing means 25.
 */
function wordCapFor(maxSpeechSeconds) {
  const secs = Number(maxSpeechSeconds);
  if (!Number.isFinite(secs) || secs <= 0) return MAX_WORDS;
  return Math.max(1, Math.min(MAX_WORDS, Math.round(secs * 2.5)));
}

function cleanItem(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function contextSection(label, items) {
  const lines = (items || []).map(cleanItem).filter(Boolean);
  return lines.length ? `${label}\n${lines.map(l => `- ${l}`).join('\n')}` : '';
}

function buildPrompt({ transcript, daily_items, permanent_items, timeOfDay, language, maxWords = MAX_WORDS }) {
  const systemPrompt = (language === 'id' ? SYSTEM_PROMPT_ID : SYSTEM_PROMPT_EN)
    .replace('{{MAX_WORDS}}', String(maxWords));

  const today = contextSection(language === 'id' ? 'Konteks hari ini:' : "Today's context:", daily_items);
  const always = contextSection(language === 'id' ? 'Konteks tetap:' : 'Permanent context:', permanent_items);

  // FR-4.3.5: no context → generic comforting phrasing, never an error
  const empty = !today && !always
    ? (language === 'id' ? 'Tidak ada konteks dari caregiver hari ini.' : 'No caregiver context today.')
    : '';

  const timeStr = timeOfDay
    ? (language === 'id' ? `Waktu sekarang: ${timeOfDay}` : `Current time: ${timeOfDay}`)
    : '';

  const userInput = [
    `Patient said: "${cleanItem(transcript)}"`,
    today,
    always,
    empty,
    timeStr,
  ].filter(Boolean).join('\n');

  const template = `${systemPrompt}

User input:
${userInput}

Respond with valid JSON only.`;

  // The prompt has no template variables: escape every brace so the JSON example and
  // caregiver/patient text are passed through literally (unescaped, f-string parsing failed)
  return PromptTemplate.fromTemplate(template.replace(/[{}]/g, (c) => c + c));
}

module.exports = { buildPrompt, wordCapFor, OUTPUT_KEYS, MAX_WORDS };
