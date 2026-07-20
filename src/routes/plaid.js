const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const plaid = require('../services/plaidService');
const { supabase } = require('../../config/supabase');

const router = express.Router();

// POST /plaid/link-token — Step 1: create a Link token for the frontend
router.post('/link-token', authenticate, async (req, res, next) => {
  try {
    const linkToken = await plaid.createLinkToken(req.user.id);
    res.json({ link_token: linkToken });
  } catch (err) { next(err); }
});

// POST /plaid/exchange — Step 2: exchange the public token after user connects bank
router.post('/exchange',
  authenticate,
  body('public_token').notEmpty().isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const item = await plaid.exchangePublicToken(req.body.public_token, req.user.id);
      res.status(201).json(item);
    } catch (err) { next(err); }
  }
);

// GET /plaid/items — list all connected banks
router.get('/items', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('plaid_items')
      .select('id, institution_name, institution_id, status, error_code, last_synced_at, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return next(error);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /plaid/items/:id/sync — manually trigger a transaction sync
router.post('/items/:id/sync',
  authenticate,
  param('id').isUUID(),
  async (req, res, next) => {
    try {
      // Verify ownership
      const { data: item, error } = await supabase
        .from('plaid_items')
        .select('id')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .single();

      if (error || !item) return res.status(404).json({ error: 'Item not found' });

      const stats = await plaid.syncTransactions(req.params.id, req.user.id);
      res.json(stats);
    } catch (err) { next(err); }
  }
);

// POST /plaid/balances/refresh — refresh all account balances
router.post('/balances/refresh', authenticate, async (req, res, next) => {
  try {
    await plaid.refreshBalances(req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /plaid/items/:id — disconnect a bank
router.delete('/items/:id',
  authenticate,
  param('id').isUUID(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      await plaid.removeItem(req.params.id, req.user.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

module.exports = router;
