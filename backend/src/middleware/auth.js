const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Required-auth middleware. Sets req.userId, req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.userId = payload.sub;
    req.user = { id: payload.sub, email: payload.email, name: payload.name, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional-auth: sets req.userId if token valid, but does not block.
 */
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), config.jwt.secret);
      req.userId = payload.sub;
      req.user = { id: payload.sub, email: payload.email, name: payload.name, role: payload.role };
    } catch {}
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
