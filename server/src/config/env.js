'use strict';

require('dotenv').config();

const { z } = require('zod');

const envSchema = z.object({
  // Server
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database — connection string OR individual parts
  DATABASE_URL: z.string().optional(),
  DB_HOST:      z.string().default('localhost'),
  DB_PORT:      z.string().default('5432'),
  DB_NAME:      z.string().default('intacta'),
  DB_USER:      z.string().default('postgres'),
  DB_PASSWORD:  z.string().default(''),
  DATABASE_SSL: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean())
    .default('false'),

  // Auth
  JWT_SECRET:          z.string().min(1),
  JWT_EXPIRES_IN:      z.string().default('24h'),
  PAIRING_CODE_TTL_MIN: z.coerce.number().int().positive().default(10),

  // CORS / Socket.IO
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  API_ORIGIN:    z.string().default('http://localhost:3000'),

  // LLM
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL:   z.string().default('gemini-2.5-flash-lite'),
  GEMINI_STT_MODEL: z.string().optional(), // speech-to-text model; defaults to GEMINI_MODEL
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(1200),

  // Voice (all optional: /api/tts answers 503 when the key or the voice is missing)
  ELEVENLABS_API_KEY:   z.string().optional(),
  ELEVENLABS_MODEL_ID:  z.string().default('eleven_multilingual_v2'),
  ELEVENLABS_VOICE_ID_ID_FEMALE: z.string().optional(),
  ELEVENLABS_VOICE_ID_ID_MALE:   z.string().optional(),
  ELEVENLABS_VOICE_ID_EN_FEMALE: z.string().optional(),
  ELEVENLABS_VOICE_ID_EN_MALE:   z.string().optional(),
  ELEVENLABS_VOICE_ID_ID: z.string().optional(), // legacy, one voice per language
  ELEVENLABS_VOICE_ID_EN: z.string().optional(), // legacy
});

/**
 * Parse and validate. Fails fast with a descriptive message on any error.
 */
function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  — ${issue.path.join('.')}: ${issue.message}`
    );
    console.error('\n[env] Invalid environment configuration:\n' + lines.join('\n') + '\n');
    process.exit(1);
  }

  const env = result.data;

  // Production guardrails
  if (env.NODE_ENV === 'production') {
    const DEV_SECRET = 'intacta-dev-secret-change-in-production';

    if (env.JWT_SECRET === DEV_SECRET) {
      console.error('[env] FATAL: JWT_SECRET is set to the development default in production. Set a secure secret.');
      process.exit(1);
    }

    if (env.JWT_SECRET.length < 32) {
      console.error(
        `[env] FATAL: JWT_SECRET must be at least 32 characters in production (got ${env.JWT_SECRET.length}).`
      );
      process.exit(1);
    }
  }

  // GEMINI_API_KEY is required only when the LLM route is used
  if (!env.GEMINI_API_KEY) {
    console.warn(
      '[env] WARNING: GEMINI_API_KEY is not set. LLM responses will fall back to scripted responses.'
    );
  }

  return env;
}

const env = loadEnv();

module.exports = env;
