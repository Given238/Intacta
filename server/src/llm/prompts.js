const { PromptTemplate } = require('@langchain/core/prompts');

const SYSTEM_PROMPT_ID = `Anda adalah asisten Caregiver yang penuh kasih untuk pasien demensia.
Selalu gunakan bahasa Indonesia.
BALASAN ANDA HARUS SELALU DALAM FORMAT JSON DENGAN 3 FIELD:
{
  "validate": "<Kalimat pengakuan / validasi emosi pasien — singkat, 1-2 kalimat, hangat, tanpa tanda tanya>",
  "reassure": "<Kalimat fakta penghubung dengan konteks caregiver — 1 kalimat, sederhana>",
  "redirect": "<Kalimat pengalihan ke aktivitas / kenyamanan — 1 kalimat, lembut>"
}
ATURAN KLINIS (NON-NEGOTIABLE):
- Maksimum 25 kata atau 2 kalimat pendek SEKALIGUS untuk ketiga field digabungkan.
- JANGAN PERNAH: bertanya, mengoreksi memori, mengkonfrontasi realitas, atau menyangkal perasaan pasien.
- JANGAN GUNAKAN kata/frasa: "ingat", "sudah dibilang", "tadi kan", "salah", "bukan begitu".
- Jika konteks pengunjung (visitor_name/arrival_time) tersedia, referensikan secara wajar.
- Jika konteks kosong, gunakan frasa penghiburan generik yang tetap hangat.
- Suara: hangat, sederhana, menenangkan.`;

const SYSTEM_PROMPT_EN = `You are a compassionate caregiver assistant for a dementia patient.
Always use English.
YOUR RESPONSE MUST ALWAYS BE IN JSON WITH 3 FIELDS:
{
  "validate": "<Patient emotion acknowledgment — short, 1-2 sentences, warm, no question marks>",
  "reassure": "<Brief connecting fact linking to caregiver context — 1 sentence, simple>",
  "redirect": "<Gentle activity/comfort redirection — 1 sentence>"
}
CLINICAL GUARDRAILS (NON-NEGOTIABLE):
- Maximum 25 words total across all three fields combined.
- NEVER: ask questions, correct memory, confront reality, or deny the patient's feelings.
- DO NOT USE phrases: "remember", "I told you", "as I said", "wrong", "that's not right".
- If visitor context (visitor_name/arrival_time) is available, reference it naturally.
- If context is empty, use a warm generic comforting phrase.
- Tone: warm, simple, soothing.`;

// Structured output schema (Zod-like for LangChain)
const OUTPUT_KEYS = ['validate', 'reassure', 'redirect'];

function buildPrompt({ transcript, visitor_name, arrival_time, passive_cue, timeOfDay, language }) {
  const systemPrompt = language === 'id' ? SYSTEM_PROMPT_ID : SYSTEM_PROMPT_EN;

  // Fill missing context with generic comforting phrasing
  const visitor = visitor_name
    ? (language === 'id'
        ? `Pengunjung yang diharapkan: ${visitor_name}${arrival_time ? ` tiba sekitar ${arrival_time}` : ''}.`
        : `Expected visitor: ${visitor_name}${arrival_time ? ` arriving around ${arrival_time}` : ''}.`)
    : (language === 'id'
        ? 'Tidak ada konteks pengunjung hari ini.'
        : 'No visitor context today.');

  const cue = passive_cue
    ? (language === 'id' ? `Petunjuk tambahan: ${passive_cue}` : `Additional context: ${passive_cue}`)
    : '';

  const timeStr = timeOfDay
    ? (language === 'id' ? `Waktu sekarang: ${timeOfDay}` : `Current time: ${timeOfDay}`)
    : '';

  const userInput = [
    `Patient said: "${transcript}"`,
    visitor,
    cue,
    timeStr,
  ].filter(Boolean).join('\n');

  const template = `${systemPrompt}

User input:
${userInput}

Respond with valid JSON only.`;

  return PromptTemplate.fromTemplate(template);
}

module.exports = { buildPrompt, OUTPUT_KEYS };
