const jwt = require('jsonwebtoken');
const { supabase } = require('../../config/supabase');
const logger = require('../utils/logger');

/**
 * Verifies the Supabase JWT sent in the Authorization header.
 * Attaches req.user = { id, email, role } on success.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify with Supabase JWT secret — fast, no network call
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user info to request
    req.user = {
      id:    decoded.sub,
      email: decoded.email,
      role:  decoded.role
    };

    next();
  } catch (err) {
    logger.warn('Auth failed', { error: err.message });

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
