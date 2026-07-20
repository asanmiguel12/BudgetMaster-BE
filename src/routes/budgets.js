const express = require('express');
const { param, body, validationResult } = require('express-validator');
const { supabase }     = require('../../config/supabase');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /budgets — list budgets with current spending progress
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { data: budgets, error } = await supabase
      .from('budgets')
      .select('*, categories ( id, name, icon, color )')
      .eq('user_id', req.user.id)
      .order('created_at');

    if (error) return next(error);

    // Calculate spent amount for current period for each budget
    const now   = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year  = now.getFullYear();
    const startOfMonth = `${year}-${month}-01`;
    const endOfMonth   = new Date(year, now.getMonth() + 1, 0).toISOString().slice(0, 10);

    const budgetsWithProgress = await Promise.all(
      budgets.map(async (budget) => {
        const { data: txns } = await supabase
          .from('transactions')
          .select('amount')
          .eq('user_id', req.user.id)
          .eq('category_id', budget.category_id)
          .eq('pending', false)
          .gte('date', startOfMonth)
          .lte('date', endOfMonth)
          .lt('amount', 0);  // expenses only

        const spent = txns
          ? Math.abs(txns.reduce((s, t) => s + parseFloat(t.amount), 0))
          : 0;

        return {
          ...budget,
          spent:      parseFloat(spent.toFixed(2)),
          remaining:  parseFloat((budget.amount - spent).toFixed(2)),
          percentage: budget.amount > 0
            ? parseFloat(((spent / budget.amount) * 100).toFixed(1))
            : 0
        };
      })
    );

    res.json(budgetsWithProgress);
  } catch (err) { next(err); }
});

// POST /budgets
router.post('/',
  authenticate,
  body('category_id').isUUID(),
  body('name').notEmpty().isString(),
  body('amount').isFloat({ min: 0.01 }),
  body('period').optional().isIn(['weekly', 'monthly', 'yearly']),
  body('start_date').isISO8601(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { category_id, name, amount, period, start_date, end_date } = req.body;

    try {
      const { data, error } = await supabase
        .from('budgets')
        .insert({
          user_id: req.user.id,
          category_id, name, amount,
          period: period || 'monthly',
          start_date, end_date
        })
        .select('*, categories(*)')
        .single();

      if (error) return next(error);
      res.status(201).json(data);
    } catch (err) { next(err); }
  }
);

// PATCH /budgets/:id
router.patch('/:id',
  authenticate,
  param('id').isUUID(),
  body('amount').optional().isFloat({ min: 0.01 }),
  body('name').optional().isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, amount, end_date } = req.body;

    try {
      const { data, error } = await supabase
        .from('budgets')
        .update({ name, amount, end_date })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select()
        .single();

      if (error || !data) return res.status(404).json({ error: 'Budget not found' });
      res.json(data);
    } catch (err) { next(err); }
  }
);

// DELETE /budgets/:id
router.delete('/:id', authenticate, param('id').isUUID(), async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('budgets')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) return next(error);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
