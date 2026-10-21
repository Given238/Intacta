-- 007_content_safety.sql — content safety (services/contentSafety.js).
-- blocked_category is set when a stored context item or routine fails the safety rules on re-check
-- (rows saved before the check existed, or after a rule change). Such rows are never sent to the
-- patient or spoken; the portal shows them as "Blocked for safety" and they stay editable/deletable.
-- NULL = not blocked. Idempotent: migrate.js re-runs every file.

BEGIN;

ALTER TABLE context_items ADD COLUMN IF NOT EXISTS blocked_category VARCHAR(32);
ALTER TABLE routines      ADD COLUMN IF NOT EXISTS blocked_category VARCHAR(32);

COMMIT;
