-- 008_safety_verdicts.sql — stored content safety verdicts (services/contentSafety.js, classifier only).
-- safety_version: the SAFETY_VERSION the row was screened with (NULL = never screened by the classifier,
--   e.g. rows saved under the old keyword rules). Rows older than the current version are re-screened on
--   server start and lazily on read; until then they are never used in prompts or spoken.
-- safety_verdict: 'allow' | 'block'. safety_score: patient_distress_0_to_10 (highest over the fields).
-- context_items.sensitive: a distressing but factual note (category sensitive_fact): kept as background,
--   and the assistant is told never to mention or hint at it.
-- Idempotent: migrate.js re-runs every file.

BEGIN;

ALTER TABLE context_items ADD COLUMN IF NOT EXISTS safety_version SMALLINT;
ALTER TABLE context_items ADD COLUMN IF NOT EXISTS safety_verdict VARCHAR(8);
ALTER TABLE context_items ADD COLUMN IF NOT EXISTS safety_score   REAL;
ALTER TABLE context_items ADD COLUMN IF NOT EXISTS sensitive      BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE routines ADD COLUMN IF NOT EXISTS safety_version SMALLINT;
ALTER TABLE routines ADD COLUMN IF NOT EXISTS safety_verdict VARCHAR(8);
ALTER TABLE routines ADD COLUMN IF NOT EXISTS safety_score   REAL;

COMMIT;
