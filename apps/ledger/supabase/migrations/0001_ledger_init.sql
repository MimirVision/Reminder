-- Ledger: tables, constraints, row level security and history.
--
-- Ledger shares a Supabase project with Home Memory and Post but nothing else. Every object it creates is named
-- ledger_*, it never alters another app's tables, and it has no foreign keys to auth.users: a person's Ledger data
-- is tied to their user id, so deleting a Home Memory account can neither delete Ledger data nor be blocked by it.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------------------------------------------
-- Workspaces: one per person for now. Every other row belongs to a workspace.
create table if not exists public.ledger_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique,
  name text not null default 'My workspace' check (char_length(btrim(name)) between 1 and 100),
  timezone text not null default 'Europe/Oslo' check (char_length(timezone) between 1 and 64),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A due-date rule is a small JSON object (see src/lib/types.ts DueRule). Checked here so a bad rule can never be stored.
create or replace function public.ledger_due_rule_ok(rule jsonb, unit text) returns boolean
language plpgsql immutable set search_path = public as $$
begin
  if jsonb_typeof(rule) <> 'object' then return false; end if;
  if coalesce(rule->>'adjust', 'none') not in ('none', 'next_business_day', 'previous_business_day') then return false; end if;
  case rule->>'kind'
    when 'month_offset' then
      return rule->>'from' in ('start', 'end')
        and jsonb_typeof(rule->'months') = 'number' and (rule->>'months')::numeric between 0 and 24 and (rule->>'months')::numeric % 1 = 0
        and (rule->>'day' = 'last' or (jsonb_typeof(rule->'day') = 'number' and (rule->>'day')::numeric between 1 and 31 and (rule->>'day')::numeric % 1 = 0));
    when 'days_after_end' then
      return jsonb_typeof(rule->'days') = 'number' and (rule->>'days')::numeric between 0 and 366 and (rule->>'days')::numeric % 1 = 0;
    when 'weekday' then
      return unit = 'week' and jsonb_typeof(rule->'weekday') = 'number' and (rule->>'weekday')::numeric between 1 and 7 and (rule->>'weekday')::numeric % 1 = 0;
    else
      return false;
  end case;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.ledger_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  reference text check (reference is null or char_length(btrim(reference)) between 1 and 50),
  status text not null default 'active' check (status in ('active', 'archived')),
  notes text not null default '' check (char_length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index if not exists ledger_clients_workspace on public.ledger_clients (workspace_id);
create unique index if not exists ledger_clients_reference on public.ledger_clients (workspace_id, lower(reference)) where reference is not null;

-- ---------------------------------------------------------------------------------------------------------------
-- Recurring schedules: rules. They never are tasks themselves; ledger_occurrences holds the tasks they produce.
create table if not exists public.ledger_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  client_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  task_type text not null default 'other' check (task_type in ('bookkeeping', 'vat', 'payroll', 'reporting', 'annual', 'tax', 'follow_up', 'other')),
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly', 'custom')),
  unit text not null check (unit in ('week', 'month')),
  interval_count integer not null check (interval_count between 1 and 52),
  anchor_month integer not null default 1 check (anchor_month between 1 and 12),
  due_rule jsonb not null,
  start_date date not null check (start_date between '2000-01-01' and '2100-12-31'),
  end_date date check (end_date is null or end_date between '2000-01-01' and '2100-12-31'),
  generate_from date not null default current_date,
  lead_days integer not null default 21 check (lead_days between 0 and 366),
  reminder_days integer check (reminder_days is null or reminder_days between 0 and 366),
  auto_generate boolean not null default true,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  default_priority text not null default 'normal' check (default_priority in ('low', 'normal', 'high', 'urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (client_id, workspace_id) references public.ledger_clients (id, workspace_id) on delete restrict,
  constraint ledger_schedules_dates check (end_date is null or end_date >= start_date),
  constraint ledger_schedules_month_interval check (unit = 'week' or interval_count <= 24),
  constraint ledger_schedules_frequency check (
    frequency = 'custom'
    or (frequency = 'weekly' and unit = 'week' and interval_count = 1)
    or (frequency = 'monthly' and unit = 'month' and interval_count = 1)
    or (frequency = 'quarterly' and unit = 'month' and interval_count = 3)
    or (frequency = 'yearly' and unit = 'month' and interval_count = 12)),
  constraint ledger_schedules_due_rule check (public.ledger_due_rule_ok(due_rule, unit))
);
create index if not exists ledger_schedules_workspace on public.ledger_schedules (workspace_id);
create index if not exists ledger_schedules_client on public.ledger_schedules (client_id);

-- Pauses are kept as history: periods due inside a pause are neither created nor reported missing, now or later.
create table if not exists public.ledger_schedule_pauses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  schedule_id uuid not null,
  paused_from date not null,
  resumed_on date,
  created_at timestamptz not null default now(),
  foreign key (schedule_id, workspace_id) references public.ledger_schedules (id, workspace_id) on delete cascade,
  check (resumed_on is null or resumed_on >= paused_from)
);
create unique index if not exists ledger_pauses_one_open on public.ledger_schedule_pauses (schedule_id) where resumed_on is null;

-- ---------------------------------------------------------------------------------------------------------------
-- Occurrences: the actual tasks. One-off tasks have no schedule; schedule tasks are identified by (schedule, period),
-- which is what makes generation idempotent.
create table if not exists public.ledger_occurrences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  client_id uuid not null,
  schedule_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  task_type text not null default 'other' check (task_type in ('bookkeeping', 'vat', 'payroll', 'reporting', 'annual', 'tax', 'follow_up', 'other')),
  period_key text check (period_key is null or period_key ~ '^[MW][0-9]{1,2}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  period_start date,
  period_end date,
  due_date date not null check (due_date between '2000-01-01' and '2100-12-31'),
  scheduled_due_date date,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  tags text[] not null default '{}' check (cardinality(tags) <= 20 and char_length(array_to_string(tags, ',')) <= 600),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.ledger_clients (id, workspace_id) on delete restrict,
  foreign key (schedule_id, workspace_id) references public.ledger_schedules (id, workspace_id) on delete restrict,
  constraint ledger_occurrences_period check ((schedule_id is null) = (period_key is null)),
  constraint ledger_occurrences_period_dates check (period_end is null or period_start is null or period_end >= period_start),
  constraint ledger_occurrences_schedule_period unique (schedule_id, period_key)
);
create index if not exists ledger_occurrences_workspace_due on public.ledger_occurrences (workspace_id, due_date);
create index if not exists ledger_occurrences_open on public.ledger_occurrences (workspace_id, due_date) where status in ('todo', 'in_progress', 'waiting');
create index if not exists ledger_occurrences_client on public.ledger_occurrences (client_id);
create index if not exists ledger_occurrences_schedule on public.ledger_occurrences (schedule_id);

-- Review decisions for expected occurrences that do not exist ("checked, nothing to do" or an explained exception).
create table if not exists public.ledger_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  schedule_id uuid not null,
  period_key text not null check (period_key ~ '^[MW][0-9]{1,2}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  status text not null check (status in ('reviewed', 'exception')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (schedule_id, workspace_id) references public.ledger_schedules (id, workspace_id) on delete cascade,
  unique (schedule_id, period_key),
  constraint ledger_reviews_exception_note check (status <> 'exception' or char_length(btrim(note)) > 0)
);
create index if not exists ledger_reviews_workspace on public.ledger_reviews (workspace_id);

-- History, written only by triggers.
create table if not exists public.ledger_activity (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  entity text not null check (entity in ('occurrence', 'schedule', 'client', 'review')),
  entity_id uuid not null,
  client_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists ledger_activity_workspace on public.ledger_activity (workspace_id, created_at desc);
create index if not exists ledger_activity_entity on public.ledger_activity (entity_id, created_at desc);
create index if not exists ledger_activity_client on public.ledger_activity (client_id, created_at desc);

-- Each generation run, so a failure or a missed night is visible in the app.
create table if not exists public.ledger_generation_runs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.ledger_workspaces (id) on delete cascade,
  trigger text not null check (trigger in ('cron', 'app', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb
);
create index if not exists ledger_runs_workspace on public.ledger_generation_runs (workspace_id, started_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Integrity triggers.

create or replace function public.ledger_touch() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.ledger_workspace_guard() returns trigger language plpgsql set search_path = public as $$
begin
  perform now() at time zone new.timezone; -- raises for an unknown timezone
  if tg_op = 'UPDATE' and new.owner_id <> old.owner_id then raise exception 'ledger: a workspace cannot change owner'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ledger_workspaces_guard on public.ledger_workspaces;
create trigger ledger_workspaces_guard before insert or update on public.ledger_workspaces for each row execute function public.ledger_workspace_guard();

drop trigger if exists ledger_clients_touch on public.ledger_clients;
create trigger ledger_clients_touch before update on public.ledger_clients for each row execute function public.ledger_touch();
drop trigger if exists ledger_reviews_touch on public.ledger_reviews;
create trigger ledger_reviews_touch before update on public.ledger_reviews for each row execute function public.ledger_touch();

-- How often a schedule repeats defines its periods, so it cannot change once tasks exist for them.
create or replace function public.ledger_schedule_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.workspace_id <> old.workspace_id then raise exception 'ledger: a schedule cannot move to another workspace'; end if;
  if (new.unit, new.interval_count, new.anchor_month, new.start_date, new.client_id)
       is distinct from (old.unit, old.interval_count, old.anchor_month, old.start_date, old.client_id)
     and exists (select 1 from public.ledger_occurrences o where o.schedule_id = old.id) then
    raise exception 'ledger: the client, start date and how often a schedule repeats cannot change once it has tasks. End it and create a new schedule instead.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ledger_schedules_guard on public.ledger_schedules;
create trigger ledger_schedules_guard before update on public.ledger_schedules for each row execute function public.ledger_schedule_guard();

create or replace function public.ledger_occurrence_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.schedule_id, new.period_key, new.workspace_id) is distinct from (old.schedule_id, old.period_key, old.workspace_id) then
      raise exception 'ledger: the schedule and period of a task cannot change';
    end if;
    new.updated_at := now();
  end if;
  if new.schedule_id is not null
     and not exists (select 1 from public.ledger_schedules s where s.id = new.schedule_id and s.client_id = new.client_id) then
    raise exception 'ledger: a schedule task must belong to the schedule''s client';
  end if;
  if new.status = 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists ledger_occurrences_guard on public.ledger_occurrences;
create trigger ledger_occurrences_guard before insert or update on public.ledger_occurrences for each row execute function public.ledger_occurrence_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- History triggers. They run as the table owner so the activity table needs no write access for users.

create or replace function public.ledger_log(ws uuid, ent text, eid uuid, cid uuid, act text, det jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.ledger_activity (workspace_id, entity, entity_id, client_id, action, details, actor_id)
  values (ws, ent, eid, cid, act, coalesce(det, '{}'::jsonb), auth.uid());
$$;
revoke all on function public.ledger_log(uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.ledger_log_occurrence() returns trigger language plpgsql security definer set search_path = public as $$
declare changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform public.ledger_log(new.workspace_id, 'occurrence', new.id, new.client_id,
      case when new.schedule_id is null then 'created' else 'generated' end,
      jsonb_build_object('title', new.title, 'due', new.due_date, 'period', new.period_key));
  elsif tg_op = 'DELETE' then
    perform public.ledger_log(old.workspace_id, 'occurrence', old.id, old.client_id, 'deleted', jsonb_build_object('title', old.title, 'due', old.due_date));
    return old;
  else
    if new.status is distinct from old.status then
      perform public.ledger_log(new.workspace_id, 'occurrence', new.id, new.client_id, 'status', jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status));
    end if;
    if new.due_date is distinct from old.due_date then
      perform public.ledger_log(new.workspace_id, 'occurrence', new.id, new.client_id, 'rescheduled', jsonb_build_object('title', new.title, 'from', old.due_date, 'to', new.due_date));
    end if;
    if new.title is distinct from old.title then changed := array_append(changed, 'title'); end if;
    if new.description is distinct from old.description then changed := array_append(changed, 'notes'); end if;
    if new.priority is distinct from old.priority then changed := array_append(changed, 'priority'); end if;
    if new.tags is distinct from old.tags then changed := array_append(changed, 'tags'); end if;
    if new.task_type is distinct from old.task_type then changed := array_append(changed, 'type'); end if;
    if new.client_id is distinct from old.client_id then changed := array_append(changed, 'client'); end if;
    if cardinality(changed) > 0 then
      perform public.ledger_log(new.workspace_id, 'occurrence', new.id, new.client_id, 'edited', jsonb_build_object('title', new.title, 'fields', to_jsonb(changed)));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ledger_occurrences_log on public.ledger_occurrences;
create trigger ledger_occurrences_log after insert or update or delete on public.ledger_occurrences for each row execute function public.ledger_log_occurrence();

create or replace function public.ledger_log_schedule() returns trigger language plpgsql security definer set search_path = public as $$
declare changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform public.ledger_log(new.workspace_id, 'schedule', new.id, new.client_id, 'created', jsonb_build_object('title', new.title));
  elsif tg_op = 'DELETE' then
    perform public.ledger_log(old.workspace_id, 'schedule', old.id, old.client_id, 'deleted', jsonb_build_object('title', old.title));
    return old;
  else
    if new.status is distinct from old.status then
      perform public.ledger_log(new.workspace_id, 'schedule', new.id, new.client_id,
        case new.status when 'paused' then 'paused' when 'ended' then 'ended' else 'resumed' end,
        jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status, 'end', new.end_date));
    end if;
    if new.title is distinct from old.title then changed := array_append(changed, 'title'); end if;
    if new.description is distinct from old.description then changed := array_append(changed, 'notes'); end if;
    if new.due_rule is distinct from old.due_rule then changed := array_append(changed, 'due date rule'); end if;
    if new.end_date is distinct from old.end_date and new.status = old.status then changed := array_append(changed, 'end date'); end if;
    if new.lead_days is distinct from old.lead_days then changed := array_append(changed, 'creation lead time'); end if;
    if new.default_priority is distinct from old.default_priority then changed := array_append(changed, 'priority'); end if;
    if new.auto_generate is distinct from old.auto_generate then changed := array_append(changed, 'automatic creation'); end if;
    if new.task_type is distinct from old.task_type then changed := array_append(changed, 'type'); end if;
    if cardinality(changed) > 0 then
      perform public.ledger_log(new.workspace_id, 'schedule', new.id, new.client_id, 'edited', jsonb_build_object('title', new.title, 'fields', to_jsonb(changed)));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ledger_schedules_log on public.ledger_schedules;
create trigger ledger_schedules_log after insert or update or delete on public.ledger_schedules for each row execute function public.ledger_log_schedule();

create or replace function public.ledger_log_client() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.ledger_log(new.workspace_id, 'client', new.id, new.id, 'created', jsonb_build_object('name', new.name));
  elsif new.status is distinct from old.status then
    perform public.ledger_log(new.workspace_id, 'client', new.id, new.id, case new.status when 'archived' then 'archived' else 'reactivated' end, jsonb_build_object('name', new.name));
  elsif (new.name, new.reference, new.notes) is distinct from (old.name, old.reference, old.notes) then
    perform public.ledger_log(new.workspace_id, 'client', new.id, new.id, 'edited', jsonb_build_object('name', new.name));
  end if;
  return new;
end $$;
drop trigger if exists ledger_clients_log on public.ledger_clients;
create trigger ledger_clients_log after insert or update on public.ledger_clients for each row execute function public.ledger_log_client();

create or replace function public.ledger_log_review() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; cid uuid;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select client_id into cid from public.ledger_schedules where id = r.schedule_id;
  perform public.ledger_log(r.workspace_id, 'review', r.schedule_id, cid,
    case when tg_op = 'DELETE' then 'review_cleared' else r.status end,
    jsonb_build_object('period', r.period_key, 'note', r.note));
  return r;
end $$;
drop trigger if exists ledger_reviews_log on public.ledger_reviews;
create trigger ledger_reviews_log after insert or update or delete on public.ledger_reviews for each row execute function public.ledger_log_review();

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security: a person sees and changes only rows in their own workspace.

create or replace function public.ledger_owns(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ledger_workspaces w where w.id = ws and w.owner_id = auth.uid());
$$;
revoke all on function public.ledger_owns(uuid) from public, anon;
grant execute on function public.ledger_owns(uuid) to authenticated;

alter table public.ledger_workspaces enable row level security;
alter table public.ledger_clients enable row level security;
alter table public.ledger_schedules enable row level security;
alter table public.ledger_schedule_pauses enable row level security;
alter table public.ledger_occurrences enable row level security;
alter table public.ledger_reviews enable row level security;
alter table public.ledger_activity enable row level security;
alter table public.ledger_generation_runs enable row level security;

-- Nothing in Ledger is for signed-out visitors.
revoke all on public.ledger_workspaces, public.ledger_clients, public.ledger_schedules, public.ledger_schedule_pauses,
  public.ledger_occurrences, public.ledger_reviews, public.ledger_activity, public.ledger_generation_runs from anon;
revoke all on public.ledger_workspaces, public.ledger_clients, public.ledger_schedules, public.ledger_schedule_pauses,
  public.ledger_occurrences, public.ledger_reviews, public.ledger_activity, public.ledger_generation_runs from authenticated;
grant select, update on public.ledger_workspaces to authenticated;
grant select on public.ledger_activity, public.ledger_generation_runs to authenticated;
grant select, insert, update, delete on public.ledger_clients, public.ledger_schedules, public.ledger_occurrences, public.ledger_reviews to authenticated;
grant select, insert, update on public.ledger_schedule_pauses to authenticated;

drop policy if exists ledger_workspaces_select on public.ledger_workspaces;
create policy ledger_workspaces_select on public.ledger_workspaces for select to authenticated using (owner_id = auth.uid());
drop policy if exists ledger_workspaces_update on public.ledger_workspaces;
create policy ledger_workspaces_update on public.ledger_workspaces for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['ledger_clients', 'ledger_schedules', 'ledger_schedule_pauses', 'ledger_occurrences', 'ledger_reviews'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ledger_owns(workspace_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.ledger_owns(workspace_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.ledger_owns(workspace_id)) with check (public.ledger_owns(workspace_id))', t || '_update', t);
  end loop;
  foreach t in array array['ledger_clients', 'ledger_schedules', 'ledger_reviews'] loop
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.ledger_owns(workspace_id))', t || '_delete', t);
  end loop;
end $$;

-- Only one-off tasks can be deleted. A schedule's task is cancelled instead, so its period stays accounted for.
drop policy if exists ledger_occurrences_delete on public.ledger_occurrences;
create policy ledger_occurrences_delete on public.ledger_occurrences for delete to authenticated
  using (public.ledger_owns(workspace_id) and schedule_id is null);

drop policy if exists ledger_activity_select on public.ledger_activity;
create policy ledger_activity_select on public.ledger_activity for select to authenticated using (public.ledger_owns(workspace_id));
drop policy if exists ledger_runs_select on public.ledger_generation_runs;
create policy ledger_runs_select on public.ledger_generation_runs for select to authenticated using (public.ledger_owns(workspace_id));

-- The signed-in person's workspace, created the first time they open Ledger.
create or replace function public.ledger_my_workspace() returns public.ledger_workspaces
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w public.ledger_workspaces;
begin
  if me is null then raise exception 'ledger: not signed in'; end if;
  insert into public.ledger_workspaces (owner_id) values (me) on conflict (owner_id) do nothing;
  select * into w from public.ledger_workspaces where owner_id = me;
  return w;
end $$;
revoke all on function public.ledger_my_workspace() from public, anon;
grant execute on function public.ledger_my_workspace() to authenticated;
