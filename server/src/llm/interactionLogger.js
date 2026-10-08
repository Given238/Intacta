const { query } = require('../db/query');

async function logInteraction({ patientId, transcript, aiResponse, source = 'voice', latencyMs }) {
  const result = await query(
    `INSERT INTO interaction_logs (patient_id, transcript, ai_response, source, latency_ms)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [patientId, transcript, JSON.stringify(aiResponse), source, latencyMs]
  );
  return result.rows[0];
}

module.exports = { logInteraction };
