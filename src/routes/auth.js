const express    = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../../config/supabase');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /auth/me — fetch current user profile
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, avatar_url, currency, timezone, created_at')
      .eq('id', req.user.id)
      .single();

    if (error) return next(error);
    res.json(data);
  } catch (err) { next(err); }
});

// PATCH /auth/me — update profile
router.patch('/me',
  authenticate,
  body('full_name').optional().isString().trim(),
  body('currency').optional().isISO4217(),
  body('timezone').optional().isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { full_name, currency, timezone, avatar_url } = req.body;

    try {
      const { data, error } = await supabase
        .from('users')
        .update({ full_name, currency, timezone, avatar_url })
        .eq('id', req.user.id)
        .select()
        .single();

      if (error) return next(error);
      res.json(data);
    } catch (err) { next(err); }
  }
);

// POST /auth/push-token — register device push token
router.post('/push-token',
  authenticate,
  body('token').notEmpty(),
  body('platform').isIn(['ios', 'android', 'web']),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { token, platform } = req.body;

    try {
      const { error } = await supabase
        .from('push_tokens')
        .upsert({ user_id: req.user.id, token, platform }, { onConflict: 'user_id,token' });

      if (error) return next(error);
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

// DELETE /auth/push-token — remove device token on logout
router.delete('/push-token', authenticate, async (req, res, next) => {
  const { token } = req.body;
  try {
    await supabase
      .from('push_tokens')
      .delete()
      .eq('user_id', req.user.id)
      .eq('token', token);

    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
