-- Post: setup that lives in the database, so nothing has to be typed into Supabase's Secrets page, and the 6-hourly renewal needs no Cron form.
-- Safe to run more than once.
--
--   select post_setup('<Application (client) ID from Azure>', 'you@outlook.com');   -- once
--   select post_allow('you@yourfirm.no');                                            -- to let another mailbox sign in
--
-- Server-only (no policies, no grants): only the edge function (service role) and you in the SQL editor can read it.
create table if not exists public.post_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.post_config enable row level security;
revoke all on public.post_config from anon, authenticated;

-- Why a mailbox is not getting new-mail alerts (Microsoft refused the subscription). The mailbox itself still works; the schedule tries again.
alter table public.post_alert_accounts add column if not exists sub_error text;
alter table public.post_alert_accounts add column if not exists sub_error_at timestamptz;

-- Lets one more mailbox sign in to Post's server.
create or replace function public.post_allow(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare
  em text := lower(trim(coalesce(p_email, '')));
  cur text;
begin
  if em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'That does not look like an email address: %', p_email;
  end if;
  select value into cur from public.post_config where key = 'allowed_emails';
  if cur is null or cur = '' then
    cur := em;
  elsif not (em = any (string_to_array(cur, ','))) then
    cur := cur || ',' || em;
  end if;
  insert into public.post_config (key, value) values ('allowed_emails', cur)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return 'These mailboxes can sign in: ' || cur;
end $$;
revoke all on function public.post_allow(text) from public, anon, authenticated;

-- Stores your Microsoft Application (client) ID and, optionally, the first mailbox that may sign in.
create or replace function public.post_setup(p_client_id text, p_email text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  cid text := lower(trim(coalesce(p_client_id, '')));
  msg text;
begin
  if cid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That does not look like an Application (client) ID. It is 36 characters, like 11111111-2222-3333-4444-555555555555.';
  end if;
  insert into public.post_config (key, value) values ('ms_client_id', cid)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  if coalesce(trim(p_email), '') <> '' then
    msg := public.post_allow(p_email);
  else
    msg := coalesce((select 'These mailboxes can sign in: ' || value from public.post_config where key = 'allowed_emails'),
                    'No mailbox may sign in yet: run select post_allow(''you@outlook.com'');');
  end if;
  return 'Post is set up with client ID ' || cid || '. ' || msg;
end $$;
revoke all on function public.post_setup(text, text) from public, anon, authenticated;

-- Renewal without a Cron form. Microsoft's alert subscriptions last under 3 days for personal accounts, so every 6 hours the database asks the
-- function to renew whatever is about to lapse. The function writes its own address and a renewal key into post_config the first time it runs.
create or replace function public.post_cron_renew() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  u text;
  k text;
begin
  select value into u from public.post_config where key = 'function_url';
  select value into k from public.post_config where key = 'cron_key';
  if u is null or k is null then return; end if;
  perform net.http_post(url := u, headers := jsonb_build_object('Content-Type', 'application/json', 'x-alerts-key', k), body := '{"op":"renew"}'::jsonb);
end $$;
revoke all on function public.post_cron_renew() from public, anon, authenticated;

-- Schedule it when this project has the pg_cron and pg_net extensions (Supabase does). If not, Post still renews alerts every time it is opened.
do $$
begin
  begin create extension if not exists pg_net; exception when others then null; end;
  begin create extension if not exists pg_cron; exception when others then null; end;
  perform cron.schedule('post-alerts-renew', '0 */6 * * *', 'select public.post_cron_renew()');
exception when others then
  raise notice 'Post: could not schedule the 6-hourly alert renewal (%). Alerts still renew whenever Post is opened.', sqlerrm;
end $$;

notify pgrst, 'reload schema';
