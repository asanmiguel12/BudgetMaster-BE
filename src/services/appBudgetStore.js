const { pool } = require('../../config/database');

const DEFAULT_STATE = {
  budgets: [],
  activeBudgetIndex: 0,
};

function clampActiveIndex(budgets, index) {
  if (!budgets.length) return 0;
  return Math.max(0, Math.min(index, budgets.length - 1));
}

function normalizeState(state) {
  const budgets = Array.isArray(state?.budgets) ? state.budgets : [];
  return {
    budgets,
    activeBudgetIndex: clampActiveIndex(budgets, state?.activeBudgetIndex ?? 0),
  };
}

async function getUserState(clientUserId) {
  const { rows } = await pool.query(
    `SELECT budgets, active_budget_index AS "activeBudgetIndex"
     FROM public.app_budget_state
     WHERE client_user_id = $1`,
    [clientUserId]
  );

  if (!rows.length) return { ...DEFAULT_STATE };
  return normalizeState(rows[0]);
}

async function setUserState(clientUserId, state) {
  const next = normalizeState(state);

  await pool.query(
    `INSERT INTO public.app_budget_state (client_user_id, budgets, active_budget_index, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (client_user_id)
     DO UPDATE SET
       budgets = EXCLUDED.budgets,
       active_budget_index = EXCLUDED.active_budget_index,
       updated_at = NOW()`,
    [clientUserId, JSON.stringify(next.budgets), next.activeBudgetIndex]
  );

  return next;
}

module.exports = {
  getUserState,
  setUserState,
  clampActiveIndex,
};
