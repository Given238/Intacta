-- 006_routine_scheduler.sql — once-a-day firing for the routine scheduler (services/routineScheduler.js).
-- last_fired_on is the Asia/Jakarta calendar date on which the routine was delivered (or logged as missed).
-- trigger_time stays a plain TIME: it is wall-clock time in Asia/Jakarta, never converted.
-- Idempotent: migrate.js re-runs every file.

BEGIN;

ALTER TABLE routines ADD COLUMN IF NOT EXISTS last_fired_on DATE;

COMMIT;
