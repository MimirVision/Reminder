-- Ledger v3: checklists in tasks (and templates on schedules), "waiting since", client contact details and a document
-- list per client, and due dates that skip Norwegian public holidays. Additive only: existing rows keep their values.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------------------------------------------
-- Checklists: [{ "id": "…", "text": "…", "done": false }], at most 50 items of up to 300 characters.
create or replace function public.ledger_checklist_ok(items jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare it jsonb;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 50 then return false; end if;
  for it in select * from jsonb_array_elements(items) loop
    -- coalesce: a missing key gives NULL, which must count as invalid, not as "no problem".
    if coalesce(jsonb_typeof(it) <> 'object'
       or jsonb_typeof(it->'id') <> 'string' or char_length(it->>'id') not between 1 and 64
       or jsonb_typeof(it->'text') <> 'string' or char_length(btrim(it->>'text')) not between 1 and 300
       or jsonb_typeof(it->'done') <> 'boolean', true) then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- Documents to collect from a client: [{ "id", "text", "received": bool, "requestedOn": date?, "receivedOn": date? }].
create or replace function public.ledger_documents_ok(items jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare it jsonb;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 100 then return false; end if;
  for it in select * from jsonb_array_elements(items) loop
    if coalesce(jsonb_typeof(it) <> 'object'
       or jsonb_typeof(it->'id') <> 'string' or char_length(it->>'id') not between 1 and 64
       or jsonb_typeof(it->'text') <> 'string' or char_length(btrim(it->>'text')) not between 1 and 300
       or jsonb_typeof(it->'received') <> 'boolean'
       or (it ? 'requestedOn' and jsonb_typeof(it->'requestedOn') <> 'null' and (it->>'requestedOn') !~ '^\d{4}-\d{2}-\d{2}$')
       or (it ? 'receivedOn' and jsonb_typeof(it->'receivedOn') <> 'null' and (it->>'receivedOn') !~ '^\d{4}-\d{2}-\d{2}$'), true) then
      return false;
    end if;
  end loop;
  return true;
end $$;

alter table public.ledger_occurrences add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.ledger_occurrences add column if not exists waiting_since timestamptz;
alter table public.ledger_schedules add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.ledger_clients add column if not exists contact_name text not null default '';
alter table public.ledger_clients add column if not exists contact_email text not null default '';
alter table public.ledger_clients add column if not exists contact_phone text not null default '';
alter table public.ledger_clients add column if not exists documents jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ledger_occurrences_checklist') then
    alter table public.ledger_occurrences add constraint ledger_occurrences_checklist check (public.ledger_checklist_ok(checklist));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ledger_schedules_checklist') then
    alter table public.ledger_schedules add constraint ledger_schedules_checklist check (public.ledger_checklist_ok(checklist));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ledger_clients_contact') then
    alter table public.ledger_clients add constraint ledger_clients_contact check (
      char_length(contact_name) <= 200 and char_length(contact_email) <= 200 and char_length(contact_phone) <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ledger_clients_documents') then
    alter table public.ledger_clients add constraint ledger_clients_documents check (public.ledger_documents_ok(documents));
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- The occurrence guard, now also keeping "waiting since": set when a task becomes waiting, kept while it stays
-- waiting, cleared when it leaves. A restored backup may bring its own value.
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
  if new.status <> 'waiting' then
    new.waiting_since := null;
  elsif tg_op = 'INSERT' then
    new.waiting_since := coalesce(new.waiting_since, now());
  elsif old.status <> 'waiting' then
    new.waiting_since := now();
  else
    new.waiting_since := coalesce(old.waiting_since, new.waiting_since, now());
  end if;
  return new;
end $$;

-- History: a changed checklist template or client contact details are recorded as edits. Ticking items in a task is
-- everyday work and is not logged one by one.
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
    if new.checklist is distinct from old.checklist then changed := array_append(changed, 'checklist'); end if;
    if cardinality(changed) > 0 then
      perform public.ledger_log(new.workspace_id, 'schedule', new.id, new.client_id, 'edited', jsonb_build_object('title', new.title, 'fields', to_jsonb(changed)));
    end if;
  end if;
  return new;
end $$;

create or replace function public.ledger_log_client() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.ledger_log(new.workspace_id, 'client', new.id, new.id, 'created', jsonb_build_object('name', new.name));
  elsif new.status is distinct from old.status then
    perform public.ledger_log(new.workspace_id, 'client', new.id, new.id, case new.status when 'archived' then 'archived' else 'reactivated' end, jsonb_build_object('name', new.name));
  elsif (new.name, new.reference, new.notes, new.contact_name, new.contact_email, new.contact_phone)
        is distinct from (old.name, old.reference, old.notes, old.contact_name, old.contact_email, old.contact_phone) then
    perform public.ledger_log(new.workspace_id, 'client', new.id, new.id, 'edited', jsonb_build_object('name', new.name));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Public holidays. A workspace setting chooses the calendar ('NO' for Norway, the default, or 'none'); business-day
-- adjustment then skips holidays as well as weekends. Mirrors src/lib/holidays.ts.

-- Easter Sunday (Gregorian, the anonymous algorithm).
create or replace function public.ledger_easter(y integer) returns date
language plpgsql immutable set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
begin
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  return make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

create or replace function public.ledger_is_holiday(d date, cal text) returns boolean
language plpgsql immutable set search_path = public as $$
declare off integer;
begin
  if coalesce(cal, 'NO') <> 'NO' then return false; end if;
  if (extract(month from d), extract(day from d)) in ((1, 1), (5, 1), (5, 17), (12, 25), (12, 26)) then return true; end if;
  off := d - public.ledger_easter(extract(year from d)::integer);
  -- Maundy Thursday, Good Friday, Easter Sunday and Monday, Ascension Day, Whit Sunday and Monday.
  return off in (-3, -2, 0, 1, 39, 49, 50);
end $$;

create or replace function public.ledger_is_business_day(d date, cal text) returns boolean
language sql immutable set search_path = public as $$
  select extract(isodow from d) < 6 and not public.ledger_is_holiday(d, cal);
$$;

-- The due date of one period under a due-date rule, with a holiday calendar for business-day adjustment.
drop function if exists public.ledger_due_date(jsonb, date, date);
create or replace function public.ledger_due_date(rule jsonb, p_start date, p_end date, p_cal text default 'none') returns date
language plpgsql immutable set search_path = public as $$
declare
  src date; mi integer; first_day date; dim integer; d date; wd integer; n integer := 0;
begin
  case rule->>'kind'
    when 'month_offset' then
      src := case when rule->>'from' = 'start' then p_start else p_end end;
      mi := extract(year from src)::integer * 12 + extract(month from src)::integer - 1 + (rule->>'months')::integer;
      first_day := make_date(mi / 12, mi % 12 + 1, 1);
      dim := (first_day + interval '1 month')::date - first_day;
      d := first_day + (case when rule->>'day' = 'last' then dim else least((rule->>'day')::integer, dim) end) - 1;
    when 'days_after_end' then
      d := p_end + (rule->>'days')::integer;
    when 'weekday' then
      wd := (rule->>'weekday')::integer;
      d := p_start + (((wd - extract(isodow from p_start)::integer) % 7) + 7) % 7;
    else
      raise exception 'ledger: unknown due-date rule %', rule->>'kind';
  end case;
  if rule->>'adjust' = 'next_business_day' then
    while not public.ledger_is_business_day(d, p_cal) and n < 14 loop d := d + 1; n := n + 1; end loop;
  elsif rule->>'adjust' = 'previous_business_day' then
    while not public.ledger_is_business_day(d, p_cal) and n < 14 loop d := d - 1; n := n + 1; end loop;
  end if;
  return d;
end $$;

drop function if exists public.ledger_periods(text, integer, integer, date, date, jsonb, date);
create or replace function public.ledger_periods(
  p_unit text, p_interval integer, p_anchor integer, p_start date, p_end date, p_rule jsonb, p_through date, p_cal text default 'none'
) returns table (period_key text, period_start date, period_end date, due_date date)
language plpgsql immutable set search_path = public as $$
declare
  s date; e date; last_start date; i integer; n integer := 0;
begin
  last_start := case when p_end is not null and p_end < p_through then p_end else p_through end;
  if p_unit = 'week' then
    s := p_start - (extract(isodow from p_start)::integer - 1);
  else
    i := extract(year from p_start)::integer * 12 + extract(month from p_start)::integer - 1;
    i := i - (((i - (p_anchor - 1)) % p_interval) + p_interval) % p_interval;
    s := make_date(i / 12, i % 12 + 1, 1);
  end if;
  while s <= last_start and n < 5000 loop
    if p_unit = 'week' then
      e := s + 7 * p_interval - 1;
    else
      e := (s + make_interval(months => p_interval))::date - 1;
    end if;
    period_key := case when p_unit = 'week' then 'W' else 'M' end || p_interval || ':' || to_char(s, 'YYYY-MM-DD');
    period_start := s;
    period_end := e;
    due_date := public.ledger_due_date(p_rule, s, e, p_cal);
    return next;
    n := n + 1;
    s := e + 1;
  end loop;
end $$;

drop function if exists public.ledger_calendar(uuid);

-- Generation, now with the holiday calendar and the schedule's checklist copied (unticked) into each new task.
create or replace function public.ledger_generate_for(p_workspace uuid, p_trigger text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ws record; sc record; today date; total integer := 0; c integer; errs jsonb := '[]'::jsonb; run bigint; cal text;
begin
  select * into ws from public.ledger_workspaces where id = p_workspace;
  if not found then raise exception 'ledger: workspace not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger-generate:' || p_workspace::text, 0));
  today := (now() at time zone ws.timezone)::date;
  cal := coalesce(ws.settings->>'holidays', 'NO');
  insert into public.ledger_generation_runs (workspace_id, trigger) values (p_workspace, p_trigger) returning id into run;
  -- Schedules of archived clients stop producing tasks; their history stays.
  for sc in select s.* from public.ledger_schedules s join public.ledger_clients c on c.id = s.client_id
            where s.workspace_id = p_workspace and s.auto_generate and c.status = 'active' order by s.created_at, s.id loop
    begin
      insert into public.ledger_occurrences (workspace_id, client_id, schedule_id, title, description, task_type,
        period_key, period_start, period_end, due_date, scheduled_due_date, priority, checklist)
      select sc.workspace_id, sc.client_id, sc.id, sc.title, sc.description, sc.task_type,
        p.period_key, p.period_start, p.period_end, p.due_date, p.due_date, sc.default_priority,
        coalesce((select jsonb_agg(jsonb_set(x, '{done}', 'false'::jsonb)) from jsonb_array_elements(sc.checklist) x), '[]'::jsonb)
      from public.ledger_periods(sc.unit, sc.interval_count, sc.anchor_month, sc.start_date, sc.end_date, sc.due_rule, today + sc.lead_days, cal) p
      where p.due_date >= sc.generate_from
        and p.due_date >= sc.start_date
        and p.due_date - sc.lead_days <= today
        and not exists (
          select 1 from public.ledger_schedule_pauses z
          where z.schedule_id = sc.id and z.paused_from <= p.due_date and (z.resumed_on is null or p.due_date < z.resumed_on))
      order by p.period_start
      on conflict (schedule_id, period_key) do nothing;
      get diagnostics c = row_count;
      total := total + c;
    exception when others then
      errs := errs || jsonb_build_object('scheduleId', sc.id, 'message', sqlerrm);
    end;
  end loop;
  update public.ledger_generation_runs set finished_at = now(), created_count = total, errors = errs where id = run;
  delete from public.ledger_generation_runs where workspace_id = p_workspace and id not in (
    select id from public.ledger_generation_runs where workspace_id = p_workspace order by started_at desc, id desc limit 100);
  return total;
end $$;
revoke all on function public.ledger_generate_for(uuid, text) from public, anon, authenticated;

-- After a schedule is edited (see 0002), with the holiday calendar.
create or replace function public.ledger_apply_schedule(p_schedule uuid, p_from date, p_old_title text, p_old_description text) returns integer
language plpgsql set search_path = public as $$
declare sc record; c integer; cal text;
begin
  select * into sc from public.ledger_schedules where id = p_schedule;
  if not found then raise exception 'ledger: schedule not found'; end if;
  -- Read with the caller's rights: RLS shows them their own workspace only.
  select coalesce(settings->>'holidays', 'NO') into cal from public.ledger_workspaces where id = sc.workspace_id;
  update public.ledger_occurrences o set
    title = case when o.title = p_old_title then sc.title else o.title end,
    description = case when o.description = p_old_description then sc.description else o.description end,
    task_type = sc.task_type,
    due_date = case when o.scheduled_due_date is null or o.due_date = o.scheduled_due_date
      then public.ledger_due_date(sc.due_rule, o.period_start, o.period_end, cal) else o.due_date end,
    scheduled_due_date = public.ledger_due_date(sc.due_rule, o.period_start, o.period_end, cal)
  where o.schedule_id = p_schedule and o.status in ('todo', 'in_progress', 'waiting') and o.due_date >= p_from;
  get diagnostics c = row_count;
  return c;
end $$;
revoke all on function public.ledger_apply_schedule(uuid, date, text, text) from public, anon;
grant execute on function public.ledger_apply_schedule(uuid, date, text, text) to authenticated;

-- Lets the app tell whether this file has been run, so it can switch the features above on.
create or replace function public.ledger_schema_version() returns integer language sql immutable as $$ select 3 $$;
grant execute on function public.ledger_schema_version() to authenticated;

notify pgrst, 'reload schema';
