-- Post: signing in without a shared key. Each phone or computer that signs in to a mailbox gets a secret; only its SHA-256 is stored here
-- (at most 8 per mailbox, the oldest drop off). Safe to run more than once.
alter table public.post_alert_accounts add column if not exists session_hashes text[] not null default '{}';

-- A finished sign-in waits here (sealed with the function's key) until the app that started it collects it. Removed when collected, or after 30 minutes.
create table if not exists public.post_signins (
  handle text primary key,
  result_enc text not null,
  created_at timestamptz not null default now()
);
alter table public.post_signins enable row level security;
revoke all on public.post_signins from anon, authenticated;

notify pgrst, 'reload schema';
