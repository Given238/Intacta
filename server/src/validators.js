/**
 * validators.js — Zod schemas for Intacta REST input validation.
 */

const { z } = require('zod');

const TIME_24H = /^([01]\d|2[0-3]):([0-5]\d)$/;

const putContextSchema = z.object({
  patientId:    z.number({ invalid_type_error: 'patientId must be a number' }),
  visitor_name:  z.string().max(255).nullable().optional(),
  arrival_time:  z.string()
    .regex(TIME_24H, { message: 'arrival_time must be in HH:MM 24-hour format (e.g. 11:00)' })
    .nullable()
    .optional(),
  passive_cue:   z.string().max(1000).nullable().optional(),
});

const createRoutineSchema = z.object({
  patientId:    z.number({ invalid_type_error: 'patientId must be a number' }),
  trigger_time: z.string().regex(TIME_24H, { message: 'trigger_time must be in HH:MM 24-hour format' }),
  category:     z.enum(['meal', 'medication', 'hygiene', 'other']),
  audio_script: z.string().max(1000).nullable().optional(),
  display_text: z.string().max(255).nullable().optional(),
  is_active:    z.boolean().optional(),
});

const updateRoutineSchema = z.object({
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

module.exports = {
  putContextSchema,
  createRoutineSchema,
  updateRoutineSchema,
  validateBody,
  TIME_24H,
};
