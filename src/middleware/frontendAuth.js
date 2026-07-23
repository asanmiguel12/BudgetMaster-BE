const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Authenticates frontend requests.
 * - Production: Supabase Bearer JWT (preferred)
 * - Development: X-User-Id header (Expo app default today)
 */
function frontendAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const devUserId = req.headers['x-user-id'];
  const allowDevHeader = process.env.ALLOW_DEV_USER_HEADER !== 'false';

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      return res.status(503).json({
        error: 'JWT auth not configured. Set JWT_SECRET in .env or use X-User-Id in development.',
      });
    }

    try {
      const decoded = jwt.verify(token, jwtSecret);
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role,
      };
      req.clientUserId = decoded.sub;
      return next();
    } catch (err) {
      logger.warn('JWT auth failed', { error: err.message });
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  if (allowDevHeader && devUserId) {
    req.clientUserId = String(devUserId);
    req.user = { id: req.clientUserId, dev: true };
    return next();
  }

  return res.status(401).json({
    error: 'Missing auth. Send Authorization: Bearer <token> or X-User-Id header.',
  });
}

module.exports = { frontendAuth };
