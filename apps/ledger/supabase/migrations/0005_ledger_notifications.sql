-- Ledger v5: notifications. Each device you turn notifications on for (phone, PC) is stored here so the `ledger-notify`
-- edge function can reach it with Ledger closed. Tasks, schedules and meetings can choose their own earlier reminders.
-- Additive only. Safe to run more than once.

-- Days before the due date (tasks, and schedules for the tasks they create) or minutes before a meeting.
-- null = the default from Settings; an empty list = no notifications for this one.
create or replace function public.ledger_notify_ok(v smallint[], max_value integer) returns boolean language sql immutable as $$
  select v is null or (cardinality(v) <= 4 and array_position(v, null) is null
    and not exists (select 1 from unnest(v) x where x < 0 or x > max_value))
$$;

alter table public.ledger_occurrences add column if not exists notify_days smallint[];
alter table public.ledger_schedules add column if not exists notify_days smallint[];
alter table public.ledger_meetings add column if not exists notify_minutes smallint[];
alter table public.ledger_occurrences drop constraint if exists ledger_occurrences_notify_days;
alter table public.ledger_occurrences add constraint ledger_occurrences_notify_days check (public.ledger_notify_ok(notify_days, 60));
alter table public.ledger_schedules drop constraint if exists ledger_schedules_notify_days;
alter table public.ledger_schedules add constraint ledger_schedules_notify_days check (public.ledger_notify_ok(notify_days, 60));
alter table public.ledger_meetings drop constraint if exists ledger_meetings_notify_minutes;
alter table public.ledger_meetings add constraint ledger_meetings_notify_minutes check (public.ledger_notify_ok(notify_minutes, 10080));

-- A browser's Web Push subscription. The keys only let a sender encrypt to that browser; they are not a login.
create table if not exists public.ledger_push_devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  label text not null default '' check (char_length(label) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, endpoint)
);
drop trigger if exists ledger_push_devices_touch on public.ledger_push_devices;
create trigger ledger_push_devices_touch before update on public.ledger_push_devices for each row execute function public.ledger_touch();

alter table public.ledger_push_devices enable row level security;
revoke all on public.ledger_push_devices from anon;
revoke all on public.ledger_push_devices from authenticated;
grant select, insert, update, delete on public.ledger_push_devices to authenticated;
drop policy if exists ledger_push_devices_select on public.ledger_push_devices;
create policy ledger_push_devices_select on public.ledger_push_devices for select to authenticated using (public.ledger_owns(workspace_id));
drop policy if exists ledger_push_devices_insert on public.ledger_push_devices;
create policy ledger_push_devices_insert on public.ledger_push_devices for insert to authenticated with check (public.ledger_owns(workspace_id));
drop policy if exists ledger_push_devices_update on public.ledger_push_devices;
create policy ledger_push_devices_update on public.ledger_push_devices for update to authenticated using (public.ledger_owns(workspace_id)) with check (public.ledger_owns(workspace_id));
drop policy if exists ledger_push_devices_delete on public.ledger_push_devices;
create policy ledger_push_devices_delete on public.ledger_push_devices for delete to authenticated using (public.ledger_owns(workspace_id));

-- What the edge function has already announced, so overlapping or repeated runs never notify twice. Server only:
-- row level security is on with no policies, so only the service role (the function) reads or writes it.
create table if not exists public.ledger_push_sent (
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  key text not null check (char_length(key) <= 200),
  sent_at timestamptz not null default now(),
  primary key (workspace_id, key)
);
create index if not exists ledger_push_sent_age on public.ledger_push_sent (sent_at);
alter table public.ledger_push_sent enable row level security;
revoke all on public.ledger_push_sent from anon;
revoke all on public.ledger_push_sent from authenticated;

-- When the scheduled check last ran, so Settings can tell whether the schedule is set up. One row, server only.
create table if not exists public.ledger_notify_status (
  id boolean primary key default true check (id),
  last_run timestamptz
);
alter table public.ledger_notify_status enable row level security;
revoke all on public.ledger_notify_status from anon;
revoke all on public.ledger_notify_status from authenticated;

create or replace function public.ledger_schema_version() returns integer language sql immutable as $$ select 5 $$;
grant execute on function public.ledger_schema_version() to authenticated;

notify pgrst, 'reload schema';
