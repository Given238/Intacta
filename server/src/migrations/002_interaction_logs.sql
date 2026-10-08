-- Migration: 002_interaction_logs.sql
-- Intacta Phase 2: Interaction logging

BEGIN;

CREATE TABLE IF NOT EXISTS interaction_logs (
    id           SERIAL PRIMARY KEY,
    patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    transcript   TEXT NOT NULL,
    ai_response  JSONB NOT NULL,
    source       VARCHAR(20) NOT NULL DEFAULT 'voice',
    latency_ms   INTEGER NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interaction_logs_patient_id ON interaction_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_interaction_logs_created_at ON interaction_logs(created_at);

COMMIT;
