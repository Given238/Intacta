-- Migration: 009_care_team.sql
-- Several caregivers per patient (Part D): everyone who pairs a device to a patient joins its care team,
-- so a second phone gets its OWN caregiver instead of the first caregiver's login.
-- patients.caregiver_id stays (the caregiver who created the patient); access = owner OR team member.
-- paired_at orders the team: the most recently paired caregiver is the name shown on the terminal.
-- The caregiver name is shown to the patient, so it carries a stored content-safety verdict like
-- context_items / routines (name_safety_version, name_safety_verdict).
-- Idempotent: migrate.js re-runs every file.

BEGIN;

CREATE TABLE IF NOT EXISTS patient_caregivers (
    patient_id   INTEGER     NOT NULL REFERENCES patients(id)   ON DELETE CASCADE,
    caregiver_id INTEGER     NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
    paired_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (patient_id, caregiver_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_caregivers_caregiver ON patient_caregivers(caregiver_id);

-- Every existing patient's creator is on its team
INSERT INTO patient_caregivers (patient_id, caregiver_id, paired_at)
SELECT id, caregiver_id, COALESCE(created_at, NOW()) FROM patients
ON CONFLICT (patient_id, caregiver_id) DO NOTHING;

ALTER TABLE caregivers ADD COLUMN IF NOT EXISTS name_safety_version INTEGER;
ALTER TABLE caregivers ADD COLUMN IF NOT EXISTS name_safety_verdict VARCHAR(10);

COMMIT;
