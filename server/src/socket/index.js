const jwt    = require('jsonwebtoken');
const { query } = require('../db/query');

function setupSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication error: token missing'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.caregiverId = payload.caregiverId;
      next();
    } catch {
      return next(new Error('Authentication error: invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (caregiver ${socket.caregiverId})`);

    socket.on('join_patient', async (patientId) => {
      if (!patientId) return;
      const result = await query(
        'SELECT id FROM patients WHERE id = $1 AND caregiver_id = $2',
        [patientId, socket.caregiverId]
      );
      if (result.rows.length === 0) {
        socket.emit('error', { message: 'Patient not found or access denied' });
        return;
      }
      const room = `patient:${patientId}`;
      socket.join(room);
      socket.emit('joined_patient', { patientId });
    });

    socket.on('context:update', async (data, ack) => {
      const { patientId, visitor_name, arrival_time, passive_cue } = data;
      if (!patientId) {
        socket.emit('error', { message: 'patientId is required' });
        if (ack) ack({ success: false, error: 'patientId is required' });
        return;
      }
      try {
        const result = await query(
          `INSERT INTO daily_contexts (patient_id, context_date, visitor_name, arrival_time, passive_cue, updated_at)
           VALUES ($1, CURRENT_DATE, $2, $3, $4, NOW())
           ON CONFLICT (patient_id, context_date) DO UPDATE
             SET visitor_name = EXCLUDED.visitor_name,
                 arrival_time = EXCLUDED.arrival_time,
                 passive_cue  = EXCLUDED.passive_cue,
                 updated_at   = NOW()
           RETURNING *`,
          [patientId, visitor_name || null, arrival_time || null, passive_cue || null]
        );
        const context = result.rows[0];
        io.to(`patient:${patientId}`).volatile.emit('context:sync', { payload: context, updated_at: context.updated_at });
        if (ack) ack({ success: true, context });
      } catch (err) {
        console.error('context:update error:', err.message);
        socket.emit('error', { message: 'Failed to persist context update' });
        if (ack) ack({ success: false, error: 'Database error' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
}

module.exports = setupSocket;
