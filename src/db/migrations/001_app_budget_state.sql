-- Frontend app budget sync state (matches BudgetMaster Expo app shape)
CREATE TABLE IF NOT EXISTS public.app_budget_state (
  client_user_id      TEXT PRIMARY KEY,
  budgets             JSONB NOT NULL DEFAULT '[]',
  active_budget_index INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_budget_state_updated
  ON public.app_budget_state(updated_at DESC);
