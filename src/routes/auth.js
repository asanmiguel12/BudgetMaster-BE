const express = require('express');
const { body, validationResult } = require('express-validator');
const { getAdminClient, getAnonClient } = require('../../config/supabaseAuth');
const db = require('../db/repository');
const plaid = require('../services/plaidService');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function formatUser(user, profile) {
  return {
    id: user.id,
    email: user.email,
    full_name: profile?.full_name || user.user_metadata?.full_name || null,
    avatar_url: profile?.avatar_url || user.user_metadata?.avatar_url || null,
    currency: profile?.currency || 'USD',
    timezone: profile?.timezone || 'America/Los_Angeles',
    created_at: profile?.created_at || user.created_at,
  };
}

// POST /auth/register
router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').optional().isString().trim(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const admin = getAdminClient();
    const anon = getAnonClient();
    if (!admin || !anon) {
      return res.status(503).json({
        error: 'Supabase auth not configured. Set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY.',
      });
    }

    const { email, password, name } = req.body;

    try {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name || null },
      });

      if (createErr) {
        return res.status(400).json({ error: createErr.message });
      }

      let signInData;
      let signInErr;
      ({ data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
        email,
        password,
      }));

      if (signInErr) {
        // User was created; retry once in case Supabase needs a moment to propagate.
        await new Promise((resolve) => setTimeout(resolve, 500));
        ({ data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
          email,
          password,
        }));
      }

      if (signInErr) {
        return res.status(201).json({
          user: formatUser(created.user, null),
          message: 'Account created. Sign in with your email and password.',
        });
      }

      const profile = await db.getUserProfile(created.user.id);
      res.status(201).json({
        token: signInData.session.access_token,
        user: formatUser(signInData.user, profile),
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const anon = getAnonClient();
    if (!anon) {
      return res.status(503).json({
        error: 'Supabase auth not configured. Set SUPABASE_ANON_KEY in .env',
      });
    }

    const { email, password } = req.body;

    try {
      const { data, error } = await anon.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: error.message });

      const profile = await db.getUserProfile(data.user.id);
      res.json({
        token: data.session.access_token,
        user: formatUser(data.user, profile),
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const profile = await db.getUserProfile(req.user.id);
    if (!profile) return res.status(404).json({ error: 'User profile not found' });
    res.json({ user: profile });
  } catch (err) {
    next(err);
  }
});

// PATCH /auth/me
router.patch('/me',
  authenticate,
  body('full_name').optional().isString().trim(),
  body('currency').optional().isString().isLength({ min: 3, max: 3 }),
  body('timezone').optional().isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { full_name, currency, timezone, avatar_url } = req.body;

    try {
      const { pool } = require('../../config/database');
      const { rows } = await pool.query(
        `UPDATE public.users
         SET full_name = COALESCE($2, full_name),
             currency = COALESCE($3, currency),
             timezone = COALESCE($4, timezone),
             avatar_url = COALESCE($5, avatar_url),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, email, full_name, avatar_url, currency, timezone, created_at`,
        [req.user.id, full_name, currency, timezone, avatar_url]
      );

      if (!rows[0]) return res.status(404).json({ error: 'User not found' });
      res.json({ user: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /auth/me — disconnect Plaid, wipe app data, delete the Auth user.
// public.users and its children cascade from auth.users.
router.delete('/me', authenticate, async (req, res, next) => {
  const admin = getAdminClient();
  if (!admin) {
    return res.status(503).json({
      error: 'Supabase auth not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env',
    });
  }

  const userId = req.user.id;

  try {
    await plaid.disconnectAllItems(userId);
    await db.deleteUserAppData(userId);

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
