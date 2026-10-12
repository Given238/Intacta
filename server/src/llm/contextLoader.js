const { loadContextSnapshot } = require('../services/contextService');
const { getSettings } = require('../services/settingsService');

/**
 * Everything the LLM pipeline needs for one patient: language, today's daily
 * items, permanent items and max_speech_seconds. Returns null when the patient does not exist.
 * strict_validation is deliberately not loaded: guardrails are always enforced.
 */
async function loadPatientContext(patientId) {
  const [snapshot, settings] = await Promise.all([
    loadContextSnapshot(patientId),
    getSettings(patientId),
  ]);
  if (!snapshot) return null;
  return {
    language:           snapshot.language,
    daily_items:        snapshot.daily.map(i => i.text),
    permanent_items:    snapshot.permanent.map(i => i.text),
    max_speech_seconds: settings ? settings.max_speech_seconds : null,
  };
}

module.exports = { loadPatientContext };
