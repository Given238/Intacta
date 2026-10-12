-- Migration: 003_figma_model.sql
-- Phase 3b: context_items (replaces daily_contexts usage), routine title/days,
-- patient_settings, device name. Idempotent: migrate.js re-runs every file.

BEGIN;

-- ── Context items (daily | permanent) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS context_items (
    id            SERIAL PRIMARY KEY,
    patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    scope         VARCHAR(10) NOT NULL CHECK (scope IN ('daily', 'permanent')),
    text          VARCHAR(200) NOT NULL CHECK (length(btrim(text)) > 0),
    context_date  DATE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    CHECK ((scope = 'daily' AND context_date IS NOT NULL)
        OR (scope = 'permanent' AND context_date IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_context_items_patient_scope
    ON context_items(patient_id, scope, context_date);

-- Carry over today's legacy daily_contexts rows once (table is kept, no longer used)
INSERT INTO context_items (patient_id, scope, text, context_date, created_at)
SELECT dc.patient_id, 'daily',
       left(concat_ws('. ',
         CASE WHEN dc.visitor_name IS NOT NULL
              THEN dc.visitor_name || COALESCE(' arrives around ' || dc.arrival_time, '') END,
         dc.passive_cue), 200),
       dc.context_date, dc.updated_at
FROM daily_contexts dc
WHERE dc.context_date = CURRENT_DATE
  AND (dc.visitor_name IS NOT NULL OR dc.passive_cue IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM context_items ci
    WHERE ci.patient_id = dc.patient_id AND ci.scope = 'daily' AND ci.context_date = dc.context_date
  );

-- ── Routines: title + days (0 = Sun .. 6 = Sat) ───────────────────────────────
ALTER TABLE routines ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE routines ADD COLUMN IF NOT EXISTS days SMALLINT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}';

DO $$ BEGIN
    ALTER TABLE routines ADD CONSTRAINT routines_days_valid
        CHECK (cardinality(days) BETWEEN 1 AND 7 AND days <@ '{0,1,2,3,4,5,6}'::SMALLINT[]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Patient settings (one row per patient) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_settings (
    patient_id          INTEGER PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    strict_validation   BOOLEAN       NOT NULL DEFAULT true,
    max_speech_seconds  INTEGER       NOT NULL DEFAULT 10   CHECK (max_speech_seconds BETWEEN 0 AND 15),
    voice_id            TEXT,
    playback_speed      NUMERIC(3,2)  NOT NULL DEFAULT 1.00 CHECK (playback_speed BETWEEN 0.85 AND 1.00),
    volume_db           INTEGER       NOT NULL DEFAULT 65   CHECK (volume_db BETWEEN 60 AND 70),
    updated_at          TIMESTAMPTZ   DEFAULT NOW()
);

-- ── Caregivers / devices ─────────────────────────────────────────────────────
ALTER TABLE caregivers ADD COLUMN IF NOT EXISTS name  VARCHAR(255);
ALTER TABLE caregivers ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE devices    ADD COLUMN IF NOT EXISTS name      TEXT;
ALTER TABLE devices    ADD COLUMN IF NOT EXISTS battery   INTEGER DEFAULT 100;
ALTER TABLE devices    ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;

COMMIT;
