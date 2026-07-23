const express = require('express');
const { frontendAuth } = require('../middleware/frontendAuth');
const {
  getUserState,
  setUserState,
  clampActiveIndex,
} = require('../services/appBudgetStore');

const router = express.Router();

router.use(frontendAuth);

router.get('/', async (req, res, next) => {
  try {
    const state = await getUserState(req.clientUserId);
    res.json(state);
  } catch (err) {
    next(err);
  }
});

router.put('/sync', async (req, res, next) => {
  try {
    const { budgets, activeBudgetIndex } = req.body ?? {};
    if (!Array.isArray(budgets)) {
      return res.status(400).json({ error: 'budgets must be an array' });
    }

    const nextState = await setUserState(req.clientUserId, {
      budgets,
      activeBudgetIndex: clampActiveIndex(budgets, activeBudgetIndex ?? 0),
    });

    res.json(nextState);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { budget } = req.body ?? {};
    if (!budget?.id) {
      return res.status(400).json({ error: 'budget with id is required' });
    }

    const state = await getUserState(req.clientUserId);
    const nextBudgets = [...state.budgets, budget];
    const nextState = await setUserState(req.clientUserId, {
      budgets: nextBudgets,
      activeBudgetIndex: nextBudgets.length - 1,
    });

    res.status(201).json(nextState);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const state = await getUserState(req.clientUserId);
    const index = state.budgets.findIndex((b) => b.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: 'budget not found' });
    }

    const nextBudgets = state.budgets.map((b, i) =>
      i === index ? { ...b, ...req.body, id: b.id } : b
    );

    const nextState = await setUserState(req.clientUserId, {
      budgets: nextBudgets,
      activeBudgetIndex: state.activeBudgetIndex,
    });

    res.json(nextState);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const state = await getUserState(req.clientUserId);
    const nextBudgets = state.budgets.filter((b) => b.id !== req.params.id);
    const nextState = await setUserState(req.clientUserId, {
      budgets: nextBudgets,
      activeBudgetIndex: clampActiveIndex(nextBudgets, state.activeBudgetIndex),
    });

    res.json(nextState);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/transactions', async (req, res, next) => {
  try {
    const { transaction } = req.body ?? {};
    if (!transaction?.id) {
      return res.status(400).json({ error: 'transaction with id is required' });
    }

    const state = await getUserState(req.clientUserId);
    const index = state.budgets.findIndex((b) => b.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: 'budget not found' });
    }

    const nextBudgets = state.budgets.map((b, i) =>
      i === index
        ? { ...b, transactions: [transaction, ...(b.transactions || [])] }
        : b
    );

    const nextState = await setUserState(req.clientUserId, {
      budgets: nextBudgets,
      activeBudgetIndex: state.activeBudgetIndex,
    });

    res.status(201).json(nextState);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
