-- Ledger v4: meetings. A meeting has a day and a time of day (wall-clock time in the workspace's time zone), may
-- belong to a client, and shows in the calendar's time grid. Unlike tasks it is never "done" or overdue.
-- Additive only. Safe to run more than once.

create table if not exists public.ledger_meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  client_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  meeting_date date not null check (meeting_date between '2000-01-01' and '2100-12-31'),
  start_time time not null,
  end_time time not null,
  location text not null default '' check (char_length(location) <= 500),
  notes text not null default '' check (char_length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A meeting without a client is fine (an internal one); with a client it must be a client in the same workspace.
  foreign key (client_id, workspace_id) references public.ledger_clients (id, workspace_id) on delete restrict,
  constraint ledger_meetings_times check (end_time > start_time)
);
create index if not exists ledger_meetings_workspace_date on public.ledger_meetings (workspace_id, meeting_date);
create index if not exists ledger_meetings_client on public.ledger_meetings (client_id);

drop trigger if exists ledger_meetings_touch on public.ledger_meetings;
create trigger ledger_meetings_touch before update on public.ledger_meetings for each row execute function public.ledger_touch();

-- History: meetings show in a client's activity.
alter table public.ledger_activity drop constraint if exists ledger_activity_entity_check;
alter table public.ledger_activity add constraint ledger_activity_entity_check
  check (entity in ('occurrence', 'schedule', 'client', 'review', 'meeting'));

create or replace function public.ledger_log_meeting() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.ledger_log(new.workspace_id, 'meeting', new.id, new.client_id, 'created',
      jsonb_build_object('title', new.title, 'date', new.meeting_date, 'start', to_char(new.start_time, 'HH24:MI')));
  elsif tg_op = 'DELETE' then
    perform public.ledger_log(old.workspace_id, 'meeting', old.id, old.client_id, 'deleted', jsonb_build_object('title', old.title, 'date', old.meeting_date));
    return old;
  elsif (new.meeting_date, new.start_time) is distinct from (old.meeting_date, old.start_time) then
    perform public.ledger_log(new.workspace_id, 'meeting', new.id, new.client_id, 'rescheduled',
      jsonb_build_object('title', new.title, 'from', old.meeting_date, 'to', new.meeting_date, 'start', to_char(new.start_time, 'HH24:MI')));
  end if;
  return new;
end $$;
drop trigger if exists ledger_meetings_log on public.ledger_meetings;
create trigger ledger_meetings_log after insert or update or delete on public.ledger_meetings for each row execute function public.ledger_log_meeting();

alter table public.ledger_meetings enable row level security;
revoke all on public.ledger_meetings from anon;
revoke all on public.ledger_meetings from authenticated;
grant select, insert, update, delete on public.ledger_meetings to authenticated;
drop policy if exists ledger_meetings_select on public.ledger_meetings;
create policy ledger_meetings_select on public.ledger_meetings for select to authenticated using (public.ledger_owns(workspace_id));
drop policy if exists ledger_meetings_insert on public.ledger_meetings;
create policy ledger_meetings_insert on public.ledger_meetings for insert to authenticated with check (public.ledger_owns(workspace_id));
drop policy if exists ledger_meetings_update on public.ledger_meetings;
create policy ledger_meetings_update on public.ledger_meetings for update to authenticated using (public.ledger_owns(workspace_id)) with check (public.ledger_owns(workspace_id));
drop policy if exists ledger_meetings_delete on public.ledger_meetings;
create policy ledger_meetings_delete on public.ledger_meetings for delete to authenticated using (public.ledger_owns(workspace_id));

-- Erase all data now includes meetings.
create or replace function public.ledger_erase_workspace(p_confirm uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select id into ws from public.ledger_workspaces where owner_id = auth.uid();
  if ws is null or ws <> p_confirm then raise exception 'ledger: confirmation does not match'; end if;
  delete from public.ledger_meetings where workspace_id = ws;
  delete from public.ledger_reviews where workspace_id = ws;
  delete from public.ledger_occurrences where workspace_id = ws;
  delete from public.ledger_schedule_pauses where workspace_id = ws;
  delete from public.ledger_schedules where workspace_id = ws;
  delete from public.ledger_clients where workspace_id = ws;
  delete from public.ledger_activity where workspace_id = ws;
  delete from public.ledger_generation_runs where workspace_id = ws;
end $$;
revoke all on function public.ledger_erase_workspace(uuid) from public, anon;
grant execute on function public.ledger_erase_workspace(uuid) to authenticated;

create or replace function public.ledger_schema_version() returns integer language sql immutable as $$ select 4 $$;
grant execute on function public.ledger_schema_version() to authenticated;

notify pgrst, 'reload schema';
