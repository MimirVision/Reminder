-- Ledger: the recurrence engine in the database, so tasks are created even when no browser is open.
-- It implements exactly the rules in apps/ledger/src/lib/recurrence.ts; supabase/tests/parity.test.ts compares the two.
-- Safe to run more than once.

-- The due date of one period under a due-date rule.
create or replace function public.ledger_due_date(rule jsonb, p_start date, p_end date) returns date
language plpgsql immutable set search_path = public as $$
declare
  src date; mi integer; first_day date; dim integer; d date; wd integer;
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
    d := d + case extract(isodow from d)::integer when 6 then 2 when 7 then 1 else 0 end;
  elsif rule->>'adjust' = 'previous_business_day' then
    d := d - case extract(isodow from d)::integer when 6 then 1 when 7 then 2 else 0 end;
  end if;
  return d;
end $$;

-- Every period from the one containing the start date up to the last one starting on or before p_through (and the end date).
create or replace function public.ledger_periods(
  p_unit text, p_interval integer, p_anchor integer, p_start date, p_end date, p_rule jsonb, p_through date
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
    due_date := public.ledger_due_date(p_rule, s, e);
    return next;
    n := n + 1;
    s := e + 1;
  end loop;
end $$;

-- Creates every occurrence that should exist by today and does not. Idempotent: (schedule, period) is unique, an
-- existing occurrence is never changed, and a per-workspace lock keeps two runs from racing. A failing schedule is
-- recorded in the run and does not stop the others. Catches up on any number of missed days.
create or replace function public.ledger_generate_for(p_workspace uuid, p_trigger text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ws record; sc record; today date; total integer := 0; c integer; errs jsonb := '[]'::jsonb; run bigint;
begin
  select * into ws from public.ledger_workspaces where id = p_workspace;
  if not found then raise exception 'ledger: workspace not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger-generate:' || p_workspace::text, 0));
  today := (now() at time zone ws.timezone)::date;
  insert into public.ledger_generation_runs (workspace_id, trigger) values (p_workspace, p_trigger) returning id into run;
  -- Schedules of archived clients stop producing tasks; their history stays.
  for sc in select s.* from public.ledger_schedules s join public.ledger_clients c on c.id = s.client_id
            where s.workspace_id = p_workspace and s.auto_generate and c.status = 'active' order by s.created_at, s.id loop
    begin
      insert into public.ledger_occurrences (workspace_id, client_id, schedule_id, title, description, task_type,
        period_key, period_start, period_end, due_date, scheduled_due_date, priority)
      select sc.workspace_id, sc.client_id, sc.id, sc.title, sc.description, sc.task_type,
        p.period_key, p.period_start, p.period_end, p.due_date, p.due_date, sc.default_priority
      from public.ledger_periods(sc.unit, sc.interval_count, sc.anchor_month, sc.start_date, sc.end_date, sc.due_rule, today + sc.lead_days) p
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
  -- Keep the run log short.
  delete from public.ledger_generation_runs where workspace_id = p_workspace and id not in (
    select id from public.ledger_generation_runs where workspace_id = p_workspace order by started_at desc, id desc limit 100);
  return total;
end $$;
revoke all on function public.ledger_generate_for(uuid, text) from public, anon, authenticated;

-- Called by the app when it opens and from Settings. Safe to call any number of times.
create or replace function public.ledger_generate() returns integer
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select id into ws from public.ledger_workspaces where owner_id = auth.uid();
  if ws is null then raise exception 'ledger: no workspace'; end if;
  return public.ledger_generate_for(ws, 'app');
end $$;
revoke all on function public.ledger_generate() from public, anon;
grant execute on function public.ledger_generate() to authenticated;

-- The nightly run for every workspace.
create or replace function public.ledger_generate_all() returns integer
language plpgsql security definer set search_path = public as $$
declare w record; total integer := 0;
begin
  for w in select id from public.ledger_workspaces loop
    begin
      total := total + public.ledger_generate_for(w.id, 'cron');
    exception when others then
      raise warning 'ledger: generation failed for workspace %: %', w.id, sqlerrm;
    end;
  end loop;
  return total;
end $$;
revoke all on function public.ledger_generate_all() from public, anon, authenticated;

-- Pause or resume a schedule, keeping the pause as history. Runs with the caller's rights, so RLS applies.
create or replace function public.ledger_set_paused(p_schedule uuid, p_paused boolean, p_on date) returns void
language plpgsql set search_path = public as $$
declare sc record;
begin
  select * into sc from public.ledger_schedules where id = p_schedule for update;
  if not found then raise exception 'ledger: schedule not found'; end if;
  if sc.status = 'ended' then raise exception 'ledger: this schedule has ended'; end if;
  if p_paused then
    if exists (select 1 from public.ledger_schedule_pauses where schedule_id = p_schedule and resumed_on is null) then return; end if;
    insert into public.ledger_schedule_pauses (workspace_id, schedule_id, paused_from) values (sc.workspace_id, p_schedule, p_on);
    update public.ledger_schedules set status = 'paused' where id = p_schedule;
  else
    update public.ledger_schedule_pauses set resumed_on = greatest(p_on, paused_from) where schedule_id = p_schedule and resumed_on is null;
    update public.ledger_schedules set status = 'active' where id = p_schedule;
  end if;
end $$;
revoke all on function public.ledger_set_paused(uuid, boolean, date) from public, anon;
grant execute on function public.ledger_set_paused(uuid, boolean, date) to authenticated;

-- End a schedule on a date. Optionally cancels open tasks for periods that start after it; completed work is never touched.
create or replace function public.ledger_end_schedule(p_schedule uuid, p_end date, p_cancel_later boolean) returns integer
language plpgsql set search_path = public as $$
declare sc record; c integer := 0;
begin
  select * into sc from public.ledger_schedules where id = p_schedule for update;
  if not found then raise exception 'ledger: schedule not found'; end if;
  if p_end < sc.start_date then raise exception 'ledger: the end date is before the schedule starts'; end if;
  update public.ledger_schedule_pauses set resumed_on = greatest(p_end, paused_from) where schedule_id = p_schedule and resumed_on is null;
  update public.ledger_schedules set end_date = p_end, status = 'ended' where id = p_schedule;
  if p_cancel_later then
    update public.ledger_occurrences set status = 'cancelled'
    where schedule_id = p_schedule and period_start > p_end and status in ('todo', 'in_progress', 'waiting');
    get diagnostics c = row_count;
  end if;
  return c;
end $$;
revoke all on function public.ledger_end_schedule(uuid, date, boolean) from public, anon;
grant execute on function public.ledger_end_schedule(uuid, date, boolean) to authenticated;

-- After a schedule is edited: bring its open tasks due on or after p_from in line with it. Completed and cancelled
-- tasks, tasks due earlier, a title or note someone changed on the task itself, and a due date moved by hand are left alone.
create or replace function public.ledger_apply_schedule(p_schedule uuid, p_from date, p_old_title text, p_old_description text) returns integer
language plpgsql set search_path = public as $$
declare sc record; c integer;
begin
  select * into sc from public.ledger_schedules where id = p_schedule;
  if not found then raise exception 'ledger: schedule not found'; end if;
  update public.ledger_occurrences o set
    title = case when o.title = p_old_title then sc.title else o.title end,
    description = case when o.description = p_old_description then sc.description else o.description end,
    task_type = sc.task_type,
    due_date = case when o.scheduled_due_date is null or o.due_date = o.scheduled_due_date
      then public.ledger_due_date(sc.due_rule, o.period_start, o.period_end) else o.due_date end,
    scheduled_due_date = public.ledger_due_date(sc.due_rule, o.period_start, o.period_end)
  where o.schedule_id = p_schedule and o.status in ('todo', 'in_progress', 'waiting') and o.due_date >= p_from;
  get diagnostics c = row_count;
  return c;
end $$;
revoke all on function public.ledger_apply_schedule(uuid, date, text, text) from public, anon;
grant execute on function public.ledger_apply_schedule(uuid, date, text, text) to authenticated;

-- Erase everything in the caller's workspace (Settings > Erase all data; used to clear demo data). Asks for the
-- workspace id as a typed confirmation.
create or replace function public.ledger_erase_workspace(p_confirm uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select id into ws from public.ledger_workspaces where owner_id = auth.uid();
  if ws is null or ws <> p_confirm then raise exception 'ledger: confirmation does not match'; end if;
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

-- Nightly generation at 02:10 UTC via pg_cron, when the project has it (Supabase does). The app also generates every
-- time it opens, so a missed night is caught up either way.
do $$
begin
  begin create extension if not exists pg_cron; exception when others then null; end;
  perform cron.schedule('ledger-generate', '10 2 * * *', 'select public.ledger_generate_all()');
exception when others then
  raise notice 'Ledger: could not schedule nightly generation (%). Tasks are still generated whenever Ledger is opened.', sqlerrm;
end $$;

notify pgrst, 'reload schema';
