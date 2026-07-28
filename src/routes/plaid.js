const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const plaid = require('../services/plaidService');
const db = require('../db/repository');

const router = express.Router();

router.use(authenticate);

router.post('/link-token', async (req, res, next) => {
  try {
    const link_token = await plaid.createLinkToken(req.user.id);
    res.json({ link_token });
  } catch (err) { next(err); }
});

router.post('/exchange',
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

// Sandbox: connect test bank without Plaid Link UI (Apple Pay charges flow here)
router.post('/sandbox/connect', async (req, res, next) => {
  try {
    const item = await plaid.connectSandboxBank(req.user.id, req.body?.institution_id);
    res.status(201).json({
      item,
      message: 'Sandbox bank connected. Transactions will sync automatically.',
    });
  } catch (err) { next(err); }
});

router.get('/items', async (req, res, next) => {
  try {
    const items = await db.listPlaidItems(req.user.id);
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/accounts', async (req, res, next) => {
  try {
    const accounts = await db.getAccountsForUser(req.user.id);
    res.json(accounts);
  } catch (err) { next(err); }
});

router.post('/items/:id/sync', param('id').isUUID(), async (req, res, next) => {
  try {
    const item = await db.getPlaidItemById(req.params.id, req.user.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const stats = await plaid.syncTransactions(req.params.id, req.user.id);
    res.json(stats);
  } catch (err) { next(err); }
});

router.post('/balances/refresh', async (req, res, next) => {
  try {
    await plaid.refreshBalances(req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/items/:id', param('id').isUUID(), async (req, res, next) => {
  try {
    await plaid.removeItem(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
