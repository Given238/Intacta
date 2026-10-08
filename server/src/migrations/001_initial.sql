-- Migration: 001_initial.sql
-- Intacta Phase 1: Core tables (caregivers, patients, devices, daily_contexts, routines, audit_logs)
-- Reference: CLAUDE.md §Database Schema Keys

BEGIN;

-- ── Caregivers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caregivers (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(255),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_caregivers_email ON caregivers(email);

-- ── Patients ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
    id           SERIAL PRIMARY KEY,
    caregiver_id INTEGER NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    language     VARCHAR(5)   NOT NULL DEFAULT 'en'
                              CHECK (language IN ('id', 'en')),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_caregiver_id ON patients(caregiver_id);

-- ── Devices ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
    id              SERIAL PRIMARY KEY,
    device_uid      VARCHAR(255) UNIQUE,  -- terminal's own UUID / stable identifier
    patient_id      INTEGER REFERENCES patients(id) ON DELETE SET NULL,
    token_hash      VARCHAR(255) NOT NULL DEFAULT '',
    pairing_code    VARCHAR(255),
    code_expires_at TIMESTAMPTZ,
    last_seen_at    TIMESTAMPTZ,
    battery         INTEGER      DEFAULT 100 CHECK (battery BETWEEN 0 AND 100),
    is_online       BOOLEAN     DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_devices_patient_id      ON devices(patient_id);
CREATE INDEX IF NOT EXISTS idx_devices_pairing_code    ON devices(pairing_code) WHERE pairing_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devices_token_hash      ON devices(token_hash) WHERE token_hash != '';
CREATE INDEX IF NOT EXISTS idx_devices_device_uid      ON devices(device_uid) WHERE device_uid IS NOT NULL;

-- ── Daily Contexts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_contexts (
    id            SERIAL PRIMARY KEY,
    patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    context_date  DATE    NOT NULL DEFAULT CURRENT_DATE,
    visitor_name  VARCHAR(255),
    arrival_time  VARCHAR(5)  CHECK (arrival_time IS NULL OR arrival_time ~ '^\d{2}:\d{2}$'),
    passive_cue   TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (patient_id, context_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_contexts_patient_id ON daily_contexts(patient_id);
CREATE INDEX IF NOT EXISTS idx_daily_contexts_date       ON daily_contexts(context_date);

-- ── Routines ─────────────────────────────────────────────────────────────────
CREATE TYPE routine_category AS ENUM ('meal', 'medication', 'hygiene', 'other');

CREATE TABLE IF NOT EXISTS routines (
    id           SERIAL PRIMARY KEY,
    patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    trigger_time TIME    NOT NULL,
    category     routine_category NOT NULL,
    audio_script TEXT,
    display_text VARCHAR(255),
    is_active    BOOLEAN DEFAULT true,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routines_patient_id ON routines(patient_id);
CREATE INDEX IF NOT EXISTS idx_routines_trigger_time ON routines(trigger_time) WHERE is_active = true;

-- ── Audit Logs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
    id          SERIAL PRIMARY KEY,
    caregiver_id INTEGER REFERENCES caregivers(id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    payload     JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_caregiver_id ON audit_logs(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at   ON audit_logs(created_at);

COMMIT;
