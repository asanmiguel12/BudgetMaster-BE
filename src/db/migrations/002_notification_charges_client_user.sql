-- Allow dev testing with X-User-Id before Supabase auth is wired
ALTER TABLE public.notification_charges
  ADD COLUMN IF NOT EXISTS client_user_id TEXT;

ALTER TABLE public.notification_charges
  ALTER COLUMN user_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_charges_client_dedup
  ON public.notification_charges(client_user_id, notification_id)
  WHERE client_user_id IS NOT NULL AND notification_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_charges_client
  ON public.notification_charges(client_user_id, created_at DESC);
