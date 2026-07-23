const express = require('express');
const { param, body, query, validationResult } = require('express-validator');
const { frontendAuth } = require('../middleware/frontendAuth');
const { parseBankNotification } = require('../utils/notificationParser');
const store = require('../services/notificationChargeStore');

const router = express.Router();

router.use(frontendAuth);

router.post('/',
  body('body').notEmpty().isString().trim(),
  body('title').optional().isString().trim(),
  body('source_app').optional().isString().trim(),
  body('notification_id').optional().isString().trim(),
  body('amount').optional().isNumeric(),
  body('merchant_name').optional().isString().trim(),
  body('charged_at').optional().isISO8601(),
  body('currency_code').optional().isString().isLength({ min: 3, max: 3 }),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      title, body: rawBody, source_app, notification_id,
      amount: overrideAmount, merchant_name: overrideMerchant,
      charged_at: overrideDate, currency_code = 'USD'
    } = req.body;

    try {
      if (notification_id) {
        const existing = await store.findDuplicate(
          req.clientUserId, req.user.id, notification_id, req.user.dev
        );
        if (existing) {
          return res.status(200).json({ duplicate: true, id: existing.id });
        }
      }

      const parsed = parseBankNotification({
        title,
        body: rawBody,
        amount: overrideAmount
      });

      const row = {
        amount: parsed.amount,
        currency_code,
        merchant_name: overrideMerchant || parsed.merchant_name,
        raw_title: title || null,
        raw_body: rawBody,
        source_app: source_app || null,
        notification_id: notification_id || null,
        charged_at: overrideDate?.slice(0, 10) || parsed.charged_at,
        parse_status: parsed.parse_status
      };

      if (overrideAmount != null && parsed.amount == null) {
        row.amount = -Math.abs(Number(overrideAmount));
        row.parse_status = row.merchant_name ? 'parsed' : 'partial';
      }

      const data = await store.insertCharge(req.clientUserId, req.user.id, row, req.user.dev);
      res.status(201).json(data);
    } catch (err) { next(err); }
  }
);

router.get('/', async (req, res, next) => {
  try {
    const result = await store.listCharges(req.clientUserId, req.user.id, req.user.dev, req.query);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/summary', async (req, res, next) => {
  const { start_date, end_date } = req.query;
  const now = new Date();
  const start = start_date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const end   = end_date   || now.toISOString().slice(0, 10);

  try {
    const summary = await store.getSummary(req.clientUserId, req.user.id, req.user.dev, start, end);
    res.json(summary);
  } catch (err) { next(err); }
});

router.get('/:id', param('id').isUUID(), async (req, res, next) => {
  try {
    const data = await store.getChargeById(req.clientUserId, req.user.id, req.user.dev, req.params.id);
    if (!data) return res.status(404).json({ error: 'Charge not found' });
    res.json(data);
  } catch (err) { next(err); }
});

router.patch('/:id',
  param('id').isUUID(),
  body('amount').optional().isNumeric(),
  body('merchant_name').optional().isString().trim(),
  body('charged_at').optional().isISO8601(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const updates = {};
    if (req.body.amount != null) updates.amount = -Math.abs(Number(req.body.amount));
    if (req.body.merchant_name != null) updates.merchant_name = req.body.merchant_name;
    if (req.body.charged_at != null) updates.charged_at = req.body.charged_at.slice(0, 10);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (updates.amount != null || updates.merchant_name) {
      updates.parse_status = 'parsed';
    }

    try {
      const data = await store.updateCharge(
        req.clientUserId, req.user.id, req.user.dev, req.params.id, updates
      );
      if (!data) return res.status(404).json({ error: 'Charge not found' });
      res.json(data);
    } catch (err) { next(err); }
  }
);

router.delete('/:id', param('id').isUUID(), async (req, res, next) => {
  try {
    const data = await store.deleteCharge(req.clientUserId, req.user.id, req.user.dev, req.params.id);
    if (!data) return res.status(404).json({ error: 'Charge not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
