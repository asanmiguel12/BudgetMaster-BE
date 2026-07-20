const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { supabase }     = require('../../config/supabase');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /categories — system defaults + user's custom ones
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .or(`user_id.is.null,user_id.eq.${req.user.id}`)
      .order('is_income')
      .order('name');

    if (error) return next(error);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /categories — create custom category
router.post('/',
  authenticate,
  body('name').notEmpty().trim(),
  body('icon').optional().isString(),
  body('color').optional().isString(),
  body('is_income').optional().isBoolean(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { data, error } = await supabase
        .from('categories')
        .insert({
          user_id:   req.user.id,
          name:      req.body.name,
          icon:      req.body.icon,
          color:     req.body.color,
          is_income: req.body.is_income || false
        })
        .select()
        .single();

      if (error) return next(error);
      res.status(201).json(data);
    } catch (err) { next(err); }
  }
);

// DELETE /categories/:id — custom categories only
router.delete('/:id', authenticate, param('id').isUUID(), async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);  // prevents deleting system categories

    if (error) return next(error);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
