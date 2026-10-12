/**
 * validators.js — Zod schemas for Intacta REST input validation.
 */

const { z } = require('zod');

const TIME_24H = /^([01]\d|2[0-3]):([0-5]\d)$/;

const patientIdField = z.number({ invalid_type_error: 'patientId must be a number' }).int().positive();

// ── Context items ────────────────────────────────────────────────────────────
const CONTEXT_SCOPES = ['daily', 'permanent'];
const contextTextField = z.string().trim()
  .min(1, { message: 'text must not be empty' })
  .max(200, { message: 'text must be at most 200 characters' });

const createContextItemSchema = z.object({
  patientId: patientIdField,
  scope:     z.enum(CONTEXT_SCOPES),
  text:      contextTextField,
});

const updateContextItemSchema = z.object({ text: contextTextField });

// ── Settings ─────────────────────────────────────────────────────────────────
const putSettingsSchema = z.object({
  patientId:          patientIdField,
  strict_validation:  z.boolean().optional(),
  max_speech_seconds: z.number().int().min(0).max(15).optional(),
  voice_id:           z.string().max(100).nullable().optional(),
  playback_speed:     z.number().min(0.85).max(1.0).optional(),
  volume_db:          z.number().int().min(60).max(70).optional(),
}).refine(
  (b) => Object.keys(b).some((k) => k !== 'patientId'),
  { message: 'at least one setting is required' }
);

// ── Caregiver profile ────────────────────────────────────────────────────────
const updateCaregiverSchema = z.object({
  name:  z.string().trim().min(1).max(100).nullable().optional(),
  email: z.string().trim().toLowerCase().email({ message: 'email must be a valid address' }).max(255).nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'name or email is required' });

// ── Routines ─────────────────────────────────────────────────────────────────
const daysField = z.array(z.number().int().min(0).max(6))
  .min(1, { message: 'days must contain at least one day (0=Sun..6=Sat)' })
  .max(7)
  .refine((d) => new Set(d).size === d.length, { message: 'days must not repeat' });
const titleField = z.string().trim().min(1).max(100).nullable();

const createRoutineSchema = z.object({
  patientId:    patientIdField,
  title:        titleField.optional(),
  days:         daysField.optional(),
  trigger_time: z.string().regex(TIME_24H, { message: 'trigger_time must be in HH:MM 24-hour format' }),
  category:     z.enum(['meal', 'medication', 'hygiene', 'other']),
  audio_script: z.string().max(1000).nullable().optional(),
  display_text: z.string().max(255).nullable().optional(),
  is_active:    z.boolean().optional(),
});

const updateRoutineSchema = z.object({
  title:        titleField.optional(),
  days:         daysField.optional(),
  trigger_time: z.string().regex(TIME_24H, { message: 'trigger_time must be in HH:MM 24-hour format' }).optional(),
  category:     z.enum(['meal', 'medication', 'hygiene', 'other']).optional(),
  audio_script: z.string().max(1000).nullable().optional(),
  display_text: z.string().max(255).nullable().optional(),
  is_active:    z.boolean().optional(),
});

/**
 * Wrap an Express route handler to validate body with a Zod schema.
 * Returns 400 with { errors: [{ path, message }] } on validation failure.
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        path:    e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', errors });
    }
    req.body = result.data;
    next();
  };
}

// ── Query strings ────────────────────────────────────────────────────────────
const patientQuerySchema = z.object({
  patientId: z.coerce.number({ invalid_type_error: 'patientId must be a number' }).int().positive(),
});

const contextItemsQuerySchema = patientQuerySchema.extend({
  scope: z.enum(CONTEXT_SCOPES).optional(),
});

const interactionsQuerySchema = patientQuerySchema.extend({
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
});

/** Like validateBody, for req.query. Parsed values land on req.validQuery. */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        path:    e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', errors });
    }
    req.validQuery = result.data;
    next();
  };
}

module.exports = {
  createContextItemSchema,
  updateContextItemSchema,
  putSettingsSchema,
  updateCaregiverSchema,
  patientQuerySchema,
  contextItemsQuerySchema,
  interactionsQuerySchema,
  validateQuery,
  createRoutineSchema,
  updateRoutineSchema,
  validateBody,
  TIME_24H,
};
