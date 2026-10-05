-- Post (the mail app): instant new-mail alerts. Microsoft calls the `post-alerts` edge function when mail arrives; the function decides
-- whether it deserves an alert (people yes, newsletters no, your work hours respected) and sends a Web Push to the "Post alerts"
-- home-screen web app. These tables are server-only (no policies, no grants): the function uses the service role. Safe to run more than once.

-- One row per mailbox being watched. The refresh token is stored encrypted (AES-GCM, key in the function's secrets), never in clear text.
create table if not exists public.post_alert_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  label text not null default '',
  provider text not null default 'microsoft' check (provider in ('microsoft')),
  refresh_token_enc text not null,
  client_state text not null,
  subscription_id text,
  subscription_expires_at timestamptz,
  inbox_folder_id text,
  mode text not null default 'people' check (mode in ('people', 'all', 'vips', 'off')),
  vips text[] not null default '{}',
  quiet jsonb,
  tz text not null default 'Europe/Oslo',
  last_alert_at timestamptz,
  created_at timestamptz not null default now()
);

-- Messages already announced, so a retry from Microsoft never alerts twice.
create table if not exists public.post_alert_seen (
  account_id uuid not null references public.post_alert_accounts (id) on delete cascade,
  message_id text not null,
  seen_at timestamptz not null default now(),
  primary key (account_id, message_id)
);

-- The phones (home-screen web app) that receive alerts.
create table if not exists public.post_alert_devices (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  lang text not null default 'en',
  created_at timestamptz not null default now()
);

alter table public.post_alert_accounts enable row level security;
alter table public.post_alert_seen enable row level security;
alter table public.post_alert_devices enable row level security;
revoke all on public.post_alert_accounts, public.post_alert_seen, public.post_alert_devices from anon, authenticated;

notify pgrst, 'reload schema';
