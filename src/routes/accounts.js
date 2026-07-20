const express = require('express');
const { param, body, validationResult } = require('express-validator');
const { supabase }     = require('../../config/supabase');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /accounts — all accounts for user
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select(`
        id, name, official_name, type, subtype, mask,
        balance_current, balance_available, balance_limit,
        iso_currency_code, is_hidden, updated_at,
        plaid_items ( institution_name, status )
      `)
      .eq('user_id', req.user.id)
      .order('type');

    if (error) return next(error);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /accounts/summary — total net worth, broken down by type
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('type, balance_current')
      .eq('user_id', req.user.id)
      .eq('is_hidden', false);

    if (error) return next(error);

    const summary = data.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + (a.balance_current || 0);
      return acc;
    }, {});

    const netWorth =
      (summary.depository || 0) +
      (summary.investment  || 0) -
      (summary.credit      || 0) -
      (summary.loan        || 0);

    res.json({ ...summary, net_worth: parseFloat(netWorth.toFixed(2)) });
  } catch (err) { next(err); }
});

// PATCH /accounts/:id — hide/show account
router.patch('/:id',
  authenticate,
  param('id').isUUID(),
  body('is_hidden').optional().isBoolean(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { data, error } = await supabase
        .from('accounts')
        .update({ is_hidden: req.body.is_hidden })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select()
        .single();

      if (error) return next(error);
      res.json(data);
    } catch (err) { next(err); }
  }
);

module.exports = router;
