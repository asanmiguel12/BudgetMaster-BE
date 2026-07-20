const express = require('express');
const { param, body, query, validationResult } = require('express-validator');
const { supabase } = require('../../config/supabase');
const { authenticate } = require('../middleware/auth');
const { parseBankNotification } = require('../utils/notificationParser');

const router = express.Router();

// POST /notification-charges — ingest an iOS bank notification
// iOS forwards title/body from a bank push (via Shortcuts or the app).
router.post('/',
  authenticate,
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
        const { data: existing } = await supabase
          .from('notification_charges')
          .select('id')
          .eq('user_id', req.user.id)
          .eq('notification_id', notification_id)
          .maybeSingle();

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
        user_id: req.user.id,
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

      const { data, error } = await supabase
        .from('notification_charges')
        .insert(row)
        .select()
        .single();

      if (error) return next(error);
      res.status(201).json(data);
    } catch (err) { next(err); }
  }
);

// GET /notification-charges — list saved charges
router.get('/', authenticate, async (req, res, next) => {
  try {
    const {
      start_date, end_date, source_app, parse_status,
      page = 1, limit = 50
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
    const from     = (pageNum - 1) * pageSize;
    const to       = from + pageSize - 1;

    let q = supabase
      .from('notification_charges')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (start_date)   q = q.gte('charged_at', start_date);
    if (end_date)     q = q.lte('charged_at', end_date);
    if (source_app)   q = q.eq('source_app', source_app);
    if (parse_status) q = q.eq('parse_status', parse_status);

    const { data, error, count } = await q;
    if (error) return next(error);

    res.json({
      data,
      pagination: {
        total: count,
        page:  pageNum,
        limit: pageSize,
        pages: Math.ceil(count / pageSize)
      }
    });
  } catch (err) { next(err); }
});

// GET /notification-charges/summary — totals for a date range
router.get('/summary', authenticate, async (req, res, next) => {
  const { start_date, end_date } = req.query;
  const now = new Date();
  const start = start_date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const end   = end_date   || now.toISOString().slice(0, 10);

  try {
    const { data, error } = await supabase
      .from('notification_charges')
      .select('amount, parse_status')
      .eq('user_id', req.user.id)
      .gte('charged_at', start)
      .lte('charged_at', end)
      .not('amount', 'is', null);

    if (error) return next(error);

    const total = data.reduce((sum, row) => sum + Number(row.amount), 0);

    res.json({
      period: { start_date: start, end_date: end },
      count: data.length,
      total_charges: parseFloat(total.toFixed(2)),
      failed_parse_count: data.filter(r => r.parse_status === 'failed').length
    });
  } catch (err) { next(err); }
});

// GET /notification-charges/:id
router.get('/:id', authenticate, param('id').isUUID(), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('notification_charges')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Charge not found' });
    res.json(data);
  } catch (err) { next(err); }
});

// PATCH /notification-charges/:id — fix amount/merchant after failed parse
router.patch('/:id',
  authenticate,
  param('id').isUUID(),
  body('amount').optional().isNumeric(),
  body('merchant_name').optional().isString().trim(),
  body('charged_at').optional().isISO8601(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const updates = {};
    if (req.body.amount != null) {
      updates.amount = -Math.abs(Number(req.body.amount));
    }
    if (req.body.merchant_name != null) updates.merchant_name = req.body.merchant_name;
    if (req.body.charged_at != null)    updates.charged_at = req.body.charged_at.slice(0, 10);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (updates.amount != null || updates.merchant_name) {
      updates.parse_status = 'parsed';
    }

    try {
      const { data, error } = await supabase
        .from('notification_charges')
        .update(updates)
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select()
        .single();

      if (error || !data) return res.status(404).json({ error: 'Charge not found' });
      res.json(data);
    } catch (err) { next(err); }
  }
);

// DELETE /notification-charges/:id
router.delete('/:id', authenticate, param('id').isUUID(), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('notification_charges')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Charge not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
