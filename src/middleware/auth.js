const jwt = require('jsonwebtoken');
const { getAdminClient } = require('../../config/supabaseAuth');
const logger = require('../utils/logger');

/**
 * Verifies Supabase access tokens.
 * Newer Supabase projects sign JWTs with ES256 — use auth.getUser().
 * Falls back to HS256 JWT_SECRET verify for older projects.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const admin = getAdminClient();
    if (admin) {
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (!error && user) {
        req.user = { id: user.id, email: user.email, role: user.role };
        return next();
      }
      if (error) {
        logger.warn('Supabase getUser failed', { error: error.message });
      }
    }

    // Fallback: legacy HS256 JWT secret
    if (process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = { id: decoded.sub, email: decoded.email, role: decoded.role };
        return next();
      } catch (jwtErr) {
        if (jwtErr.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Token expired' });
        }
      }
    }

    if (!admin && !process.env.JWT_SECRET) {
      return res.status(503).json({
        error: 'Auth not configured. Set SUPABASE_SERVICE_ROLE_KEY or JWT_SECRET in .env',
      });
    }

    return res.status(401).json({ error: 'Invalid token' });
  } catch (err) {
    logger.warn('Auth failed', { error: err.message });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
