const jwt = require('jsonwebtoken');
const { getAdminClient } = require('../../config/supabaseAuth');
const db = require('../db/repository');
const logger = require('../utils/logger');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    if (process.env.JWT_SECRET) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { id: decoded.sub, email: decoded.email, role: decoded.role };
      return next();
    }

    const admin = getAdminClient();
    if (admin) {
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      req.user = { id: user.id, email: user.email, role: user.role };
      return next();
    }

    return res.status(503).json({
      error: 'Auth not configured. Set JWT_SECRET or SUPABASE_SERVICE_ROLE_KEY in .env',
    });
  } catch (err) {
    logger.warn('Auth failed', { error: err.message });
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
