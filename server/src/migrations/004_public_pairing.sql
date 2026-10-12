-- Migration: 004_public_pairing.sql
-- Code-only pairing (CLAUDE.md §Pairing Flow): POST /api/devices/pair is public and may
-- create a caregiver with no login yet, so email/password_hash become nullable
-- (UNIQUE on email still holds; Postgres allows many NULLs).
-- code_used_at marks a pairing code as consumed (single use) so a reused code
-- gets a clear "already used" error instead of "invalid".
-- Idempotent: migrate.js re-runs every file.

BEGIN;

ALTER TABLE caregivers ALTER COLUMN email         DROP NOT NULL;
ALTER TABLE caregivers ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS code_used_at TIMESTAMPTZ;

COMMIT;
