-- 005_voice_gender.sql — voice choice by gender (ElevenLabs voice IDs stay in env, never in the DB).
-- Idempotent: migrate.js re-runs every file.

BEGIN;

ALTER TABLE patient_settings ADD COLUMN IF NOT EXISTS voice_gender VARCHAR(6) NOT NULL DEFAULT 'female';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_settings_voice_gender_check') THEN
    ALTER TABLE patient_settings
      ADD CONSTRAINT patient_settings_voice_gender_check CHECK (voice_gender IN ('female', 'male'));
  END IF;
END $$;

COMMIT;
