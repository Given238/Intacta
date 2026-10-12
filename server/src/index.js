require('dotenv').config();
const http       = require('http');
const express    = require('express');
const cors       = require('cors');
const { Server } = require('socket.io');

const authRoutes      = require('./routes/auth');
const contextItemsRoutes = require('./routes/contextItems');
const settingsRoutes  = require('./routes/settings');
const caregiverRoutes = require('./routes/caregiver');
const patientRoutes   = require('./routes/patient');
const deviceRoutes    = require('./routes/device');
const routinesRoutes  = require('./routes/routines');
const respondRoutes   = require('./routes/respond');
const devicesRoutes  = require('./routes/devices');
const ttsRoutes      = require('./routes/tts');
const setupSocket    = require('./socket');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.set('io', io);

app.use(cors());
app.use(express.json());

const pool = require('./config/db');

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok', db: 'connected' });
  } catch {
    return res.status(503).json({ status: 'degraded', db: 'disconnected' });
  }
});

app.use('/api/auth',     authRoutes);
app.use('/api/context-items', contextItemsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/caregiver', caregiverRoutes);
app.use('/api/routines', routinesRoutes);
app.use('/api/respond',  respondRoutes);
app.use('/api/devices',  devicesRoutes);
app.use('/api/device',   deviceRoutes);
app.use('/api',          ttsRoutes);
app.use('/api',          patientRoutes);

app.use((req, res) => { res.status(404).json({ error: 'Not found' }); });
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

setupSocket(io);

const PORT = parseInt(process.env.PORT, 10) || 3000;
server.listen(PORT, () => {
  console.log(`Intacta server running on port ${PORT}`);
});

module.exports = { app, server, io };
