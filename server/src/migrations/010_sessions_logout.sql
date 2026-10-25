-- Migration: 010_sessions_logout.sql
-- Logout = revoke the session + leave the care team.
-- caregiver_sessions: one row per caregiver JWT. id = the JWT's jti (tokens issued from now on), or
--   'legacy:<sha256 of the token>' for tokens issued before this migration (no jti; a row is written only when
--   such a token logs out, so it works as a denylist). expires_at = the token's exp. revoked_at set on logout.
--   patient_id NULL = an email/password login (not scoped to one patient: counts for every patient of the caregiver).
-- patient_caregivers.left_at: the caregiver left the care team (logout, or every session expired). Left members do not
--   count on the terminal and lose team access; nothing else is deleted. Pairing again clears it.
-- Additive only (new table, column, indexes). Idempotent: migrate.js re-runs every file.

BEGIN;

CREATE TABLE IF NOT EXISTS caregiver_sessions (
    id           TEXT        PRIMARY KEY,
    caregiver_id INTEGER     NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
    patient_id   INTEGER     REFERENCES patients(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_caregiver_sessions_caregiver ON caregiver_sessions(caregiver_id, patient_id);

ALTER TABLE patient_caregivers ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

COMMIT;
