const jwt = require('jsonwebtoken');
const { getAdminClient } = require('../../config/supabaseAuth');
const logger = require('../utils/logger');

/**
 * Auth for Expo budget routes.
 * Prefer Supabase getUser (ES256). Fall back to HS256 JWT_SECRET, then X-User-Id in dev.
 */
async function frontendAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const devUserId = req.headers['x-user-id'];
  const allowDevHeader = process.env.ALLOW_DEV_USER_HEADER !== 'false';

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];

    try {
      const admin = getAdminClient();
      if (admin) {
        const { data: { user }, error } = await admin.auth.getUser(token);
        if (!error && user) {
          req.user = { id: user.id, email: user.email, role: user.role };
          req.clientUserId = user.id;
          return next();
        }
        if (error) {
          logger.warn('frontendAuth getUser failed', { error: error.message });
        }
      }

      if (process.env.JWT_SECRET) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          req.user = {
            id: decoded.sub,
            email: decoded.email,
            role: decoded.role,
          };
          req.clientUserId = decoded.sub;
          return next();
        } catch (jwtErr) {
          if (jwtErr.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
          }
        }
      }

      return res.status(401).json({ error: 'Invalid token' });
    } catch (err) {
      logger.warn('frontendAuth failed', { error: err.message });
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
