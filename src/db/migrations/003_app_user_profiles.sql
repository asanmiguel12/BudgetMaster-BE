CREATE TABLE IF NOT EXISTS public.app_user_profiles (
  client_user_id  TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  email           TEXT,
  currency        TEXT NOT NULL DEFAULT 'USD',
  timezone        TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_user_profiles_email
  ON public.app_user_profiles(email);
