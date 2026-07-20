const express = require('express');
const { param, body, query, validationResult } = require('express-validator');
const { supabase }     = require('../../config/supabase');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /transactions — paginated, filtered list
// Query params: account_id, category_id, start_date, end_date,
//               pending, search, page, limit, sort
router.get('/', authenticate, async (req, res, next) => {
  try {
    const {
      account_id, category_id,
      start_date, end_date,
      pending, search,
      page = 1, limit = 50,
      sort = 'date:desc'
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
    const from     = (pageNum - 1) * pageSize;
    const to       = from + pageSize - 1;

    let q = supabase
      .from('transactions')
      .select(`
        id, amount, currency_code, name, merchant_name, pending,
        date, datetime, payment_channel, notes, is_recurring,
        location, plaid_category,
        accounts ( id, name, mask, type ),
        categories ( id, name, icon, color )
      `, { count: 'exact' })
      .eq('user_id', req.user.id)
      .range(from, to);

    if (account_id)  q = q.eq('account_id', account_id);
    if (category_id) q = q.eq('category_id', category_id);
    if (start_date)  q = q.gte('date', start_date);
    if (end_date)    q = q.lte('date', end_date);
    if (pending !== undefined) q = q.eq('pending', pending === 'true');
    if (search)      q = q.ilike('name', `%${search}%`);

    // sort: field:direction
    const [sortField, sortDir] = sort.split(':');
    const validFields = ['date', 'amount', 'name'];
    if (validFields.includes(sortField)) {
      q = q.order(sortField, { ascending: sortDir === 'asc' });
    }

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

// GET /transactions/spending — monthly spending breakdown by category
router.get('/spending', authenticate, async (req, res, next) => {
  const { year, month } = req.query;
  const now = new Date();
  const y = parseInt(year)  || now.getFullYear();
  const m = parseInt(month) || now.getMonth() + 1;

  const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate   = new Date(y, m, 0).toISOString().slice(0, 10);

  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('amount, categories ( id, name, icon, color, is_income )')
      .eq('user_id', req.user.id)
      .eq('pending', false)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) return next(error);

    // Group by category
    const grouped = {};
    for (const tx of data) {
      const cat   = tx.categories;
      const key   = cat?.id || 'uncategorized';
      if (!grouped[key]) {
        grouped[key] = {
          category_id:   key,
          category_name: cat?.name || 'Uncategorized',
          icon:          cat?.icon,
          color:         cat?.color,
          is_income:     cat?.is_income || false,
          total:         0,
          count:         0
        };
      }
      grouped[key].total += tx.amount;
      grouped[key].count += 1;
    }

    const result = Object.values(grouped)
      .map(g => ({ ...g, total: parseFloat(g.total.toFixed(2)) }))
      .sort((a, b) => a.total - b.total);

    const totalExpenses = result
      .filter(g => !g.is_income && g.total < 0)
      .reduce((s, g) => s + g.total, 0);

    const totalIncome = result
      .filter(g => g.is_income || g.total > 0)
      .reduce((s, g) => s + g.total, 0);

    res.json({
      period: { year: y, month: m, start_date: startDate, end_date: endDate },
      total_expenses: parseFloat(totalExpenses.toFixed(2)),
      total_income:   parseFloat(totalIncome.toFixed(2)),
      net:            parseFloat((totalIncome + totalExpenses).toFixed(2)),
      breakdown:      result
    });
  } catch (err) { next(err); }
});

// GET /transactions/:id
router.get('/:id', authenticate, param('id').isUUID(), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*, accounts(*), categories(*)')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Transaction not found' });
    res.json(data);
  } catch (err) { next(err); }
});

// POST /transactions — create a manual transaction
router.post('/',
  authenticate,
  body('account_id').isUUID(),
  body('amount').isNumeric(),
  body('name').notEmpty().isString(),
  body('date').isISO8601(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { account_id, category_id, amount, name, date, notes } = req.body;

    try {
      // Verify account belongs to user
      const { data: account } = await supabase
        .from('accounts')
        .select('id')
        .eq('id', account_id)
        .eq('user_id', req.user.id)
        .single();

      if (!account) return res.status(404).json({ error: 'Account not found' });

      const { data, error } = await supabase
        .from('transactions')
        .insert({
          user_id: req.user.id,
          account_id, category_id,
          amount, name, date, notes,
          pending: false
        })
        .select()
        .single();

      if (error) return next(error);
      res.status(201).json(data);
    } catch (err) { next(err); }
  }
);

// PATCH /transactions/:id — update category, notes, etc.
router.patch('/:id',
  authenticate,
  param('id').isUUID(),
  body('category_id').optional().isUUID(),
  body('notes').optional().isString(),
  body('is_recurring').optional().isBoolean(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { category_id, notes, is_recurring } = req.body;

    try {
      const { data, error } = await supabase
        .from('transactions')
        .update({ category_id, notes, is_recurring })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select()
        .single();

      if (error || !data) return res.status(404).json({ error: 'Transaction not found' });
      res.json(data);
    } catch (err) { next(err); }
  }
);

// DELETE /transactions/:id — manual transactions only
router.delete('/:id', authenticate, param('id').isUUID(), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .is('plaid_transaction_id', null) // only manual ones
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Transaction not found or not deletable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
