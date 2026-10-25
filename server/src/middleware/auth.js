const jwt = require('jsonwebtoken');
const { isSessionActive, sessionFromPayload, SessionCheckError } = require('../services/sessionService');

function bearer(req) {
  const authHeader = req.headers.authorization;
  return authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
}

/**
 * Caregiver JWT: signature + expiry, then the session must not be revoked (logout, migration 010).
 * 401 {code: invalid_token | session_revoked}; 503 when the revocation check cannot run (fail closed, not logged out).
 * Sets req.caregiverId and req.session {caregiverId, patientId, sessionId, exp}.
 */
function authenticate(req, res, next) {
  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header', code: 'invalid_token' });
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'invalid_token' });
  }
  return isSessionActive(token, payload).then((active) => {
    if (!active) return res.status(401).json({ error: 'Session ended (logged out)', code: 'session_revoked' });
    req.session = sessionFromPayload(token, payload);
    req.caregiverId = payload.caregiverId;
    return next();
  }, (err) => {
    console.error('authenticate: session check failed:', err.message);
    const status = err instanceof SessionCheckError ? 503 : 500;
    return res.status(status).json({ error: 'Could not verify the session', code: 'auth_unavailable' });
  });
}

/** For public routes: no header → anonymous; a header that is present must be valid. */
function optionalAuthenticate(req, res, next) {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, next);
}

/**
 * Logout only: a correctly signed token is enough, even if it is expired or already revoked, so a repeated or
 * delayed (offline) logout still answers 200. Sets req.session.
 */
function authenticateForLogout(req, res, next) {
  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header', code: 'invalid_token' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    req.session = sessionFromPayload(token, payload);
    req.caregiverId = payload.caregiverId;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token', code: 'invalid_token' });
  }
}

module.exports = authenticate;
module.exports.optionalAuthenticate = optionalAuthenticate;
module.exports.authenticateForLogout = authenticateForLogout;
