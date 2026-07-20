-- ============================================================
-- Budget App — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- Enable UUID extension (already on by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── users ────────────────────────────────────────────────────
-- Mirrors auth.users; we keep a public profile for app data
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT UNIQUE NOT NULL,
  full_name   TEXT,
  avatar_url  TEXT,
  currency    TEXT NOT NULL DEFAULT 'USD',
  timezone    TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── plaid_items ──────────────────────────────────────────────
-- One row per bank connection (Plaid "Item")
CREATE TABLE IF NOT EXISTS public.plaid_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plaid_item_id     TEXT UNIQUE NOT NULL,
  plaid_access_token TEXT NOT NULL,          -- store encrypted in prod!
  institution_id    TEXT,
  institution_name  TEXT,
  status            TEXT NOT NULL DEFAULT 'active',  -- active | error | revoked
  error_code        TEXT,
  cursor            TEXT,                    -- Plaid transactions sync cursor
  last_synced_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── accounts ─────────────────────────────────────────────────
-- Bank accounts pulled from Plaid
CREATE TABLE IF NOT EXISTS public.accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plaid_item_id   UUID NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  plaid_account_id TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  official_name   TEXT,
  type            TEXT NOT NULL,             -- depository | credit | loan | investment
  subtype         TEXT,                      -- checking | savings | credit card …
  mask            TEXT,                      -- last 4 digits
  balance_current NUMERIC(12,2),
  balance_available NUMERIC(12,2),
  balance_limit   NUMERIC(12,2),
  iso_currency_code TEXT DEFAULT 'USD',
  is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── categories ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,  -- NULL = system default
  name        TEXT NOT NULL,
  icon        TEXT,
  color       TEXT,
  is_income   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed system categories (user_id = NULL means shared)
INSERT INTO public.categories (name, icon, color, is_income) VALUES
  ('Food & Dining',      '🍔', '#FF6B6B', false),
  ('Shopping',           '🛍️', '#4ECDC4', false),
  ('Transportation',     '🚗', '#45B7D1', false),
  ('Housing',            '🏠', '#96CEB4', false),
  ('Entertainment',      '🎬', '#FFEAA7', false),
  ('Health & Fitness',   '💪', '#DDA0DD', false),
  ('Bills & Utilities',  '💡', '#98D8C8', false),
  ('Travel',             '✈️', '#F7DC6F', false),
  ('Education',          '📚', '#BB8FCE', false),
  ('Personal Care',      '💅', '#F1948A', false),
  ('Gifts & Donations',  '🎁', '#85C1E9', false),
  ('Business',           '💼', '#82E0AA', false),
  ('Other',              '📦', '#BDC3C7', false),
  ('Salary',             '💰', '#2ECC71', true),
  ('Freelance',          '💻', '#27AE60', true),
  ('Investment',         '📈', '#1ABC9C', true),
  ('Other Income',       '💵', '#16A085', true)
ON CONFLICT DO NOTHING;

-- ── transactions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id          UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  plaid_transaction_id TEXT UNIQUE,          -- NULL for manual transactions
  category_id         UUID REFERENCES public.categories(id),
  amount              NUMERIC(12,2) NOT NULL,  -- negative = expense, positive = income
  currency_code       TEXT DEFAULT 'USD',
  name                TEXT NOT NULL,           -- merchant / description
  merchant_name       TEXT,
  pending             BOOLEAN NOT NULL DEFAULT FALSE,
  date                DATE NOT NULL,
  datetime            TIMESTAMPTZ,
  payment_channel     TEXT,                    -- online | in store | other
  location            JSONB,                   -- {address, city, region, country, lat, lon}
  plaid_category      TEXT[],                  -- raw Plaid categories array
  notes               TEXT,                    -- user note
  is_recurring        BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── budgets ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budgets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category_id   UUID NOT NULL REFERENCES public.categories(id),
  name          TEXT NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  period        TEXT NOT NULL DEFAULT 'monthly',   -- monthly | weekly | yearly
  start_date    DATE NOT NULL,
  end_date      DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── notifications (push notification tokens) ─────────────────
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL,   -- ios | android | web
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, token)
);

-- ── notification_charges (iOS bank push notifications) ─────
-- Captures charges parsed from bank app notifications forwarded by iOS
CREATE TABLE IF NOT EXISTS public.notification_charges (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount            NUMERIC(12,2),             -- negative = charge (NULL if parse failed)
  currency_code     TEXT NOT NULL DEFAULT 'USD',
  merchant_name     TEXT,
  raw_title         TEXT,
  raw_body          TEXT NOT NULL,
  source_app        TEXT,                      -- e.g. "Chase", "Bank of America"
  notification_id   TEXT,                      -- iOS id for dedup
  charged_at        DATE,
  parse_status      TEXT NOT NULL DEFAULT 'failed',  -- parsed | partial | failed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, notification_id)
);

-- ── webhook_events (audit log) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source        TEXT NOT NULL,   -- plaid
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  processed     BOOLEAN NOT NULL DEFAULT FALSE,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transactions_user_date     ON public.transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account       ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category      ON public.transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_pending       ON public.transactions(user_id, pending);
CREATE INDEX IF NOT EXISTS idx_accounts_user              ON public.accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_plaid_items_user           ON public.plaid_items(user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_user               ON public.budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_charges_user  ON public.notification_charges(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_charges_date  ON public.notification_charges(user_id, charged_at DESC);

-- ── Row Level Security ───────────────────────────────────────
ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plaid_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_charges ENABLE ROW LEVEL SECURITY;

-- Users can only see/edit their own rows
DROP POLICY IF EXISTS "users: own row" ON public.users;
CREATE POLICY "users: own row"         ON public.users        FOR ALL USING (auth.uid() = id);
DROP POLICY IF EXISTS "plaid_items: own rows" ON public.plaid_items;
CREATE POLICY "plaid_items: own rows"  ON public.plaid_items  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "accounts: own rows" ON public.accounts;
CREATE POLICY "accounts: own rows"     ON public.accounts     FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "transactions: own rows" ON public.transactions;
CREATE POLICY "transactions: own rows" ON public.transactions FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "budgets: own rows" ON public.budgets;
CREATE POLICY "budgets: own rows"      ON public.budgets      FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_tokens: own rows" ON public.push_tokens;
CREATE POLICY "push_tokens: own rows"  ON public.push_tokens  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notification_charges: own rows" ON public.notification_charges;
CREATE POLICY "notification_charges: own rows" ON public.notification_charges
  FOR ALL USING (auth.uid() = user_id);

-- Categories: see system defaults OR own custom ones
DROP POLICY IF EXISTS "categories: system + own" ON public.categories;
CREATE POLICY "categories: system + own" ON public.categories
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);
DROP POLICY IF EXISTS "categories: own insert" ON public.categories;
CREATE POLICY "categories: own insert"   ON public.categories
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "categories: own update" ON public.categories;
CREATE POLICY "categories: own update"   ON public.categories
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "categories: own delete" ON public.categories;
CREATE POLICY "categories: own delete"   ON public.categories
  FOR DELETE USING (auth.uid() = user_id);

-- ── Auto-update updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON public.accounts;
CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_plaid_items_updated_at ON public.plaid_items;
CREATE TRIGGER trg_plaid_items_updated_at
  BEFORE UPDATE ON public.plaid_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── Auto-create user profile on signup ───────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
