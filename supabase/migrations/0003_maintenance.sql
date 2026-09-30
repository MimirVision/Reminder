-- Recurring house maintenance. Completing a task records history and schedules the next occurrence.
-- No "overdue" state on purpose: a task is either coming up or due, never red (docs/DESIGN.md principle 7).

create table public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  template_key text,
  title text not null,
  notes text,
  zone text not null default 'house' check (zone in ('house', 'garden', 'other')),
  -- interval: every N months after it was last done. seasonal: a yearly window (e.g. Sep-Oct).
  schedule text not null check (schedule in ('interval', 'seasonal')),
  interval_months integer check (interval_months between 1 and 240),
  window_start_month integer check (window_start_month between 1 and 12),
  window_end_month integer check (window_end_month between 1 and 12),
  next_due_at date not null,
  due_until date,
  last_done_at date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, template_key),
  check (
    (schedule = 'interval' and interval_months is not null)
    or (schedule = 'seasonal' and window_start_month is not null and window_end_month is not null)
  )
);
create index maintenance_tasks_due_idx on public.maintenance_tasks (household_id, next_due_at) where active;

create table public.maintenance_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.maintenance_tasks (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  done_at date not null default current_date,
  done_by uuid default auth.uid() references auth.users (id),
  cost_nok numeric(12, 2),
  note text,
  created_at timestamptz not null default now()
);
create index maintenance_events_task_idx on public.maintenance_events (task_id, done_at desc);

-- Start and end date of the window whose start is `start_year`-`start_month`-01.
create function public.season_window(p_start_month int, p_end_month int, p_start_year int)
returns table (window_start date, window_end date)
language sql immutable as $$
  select make_date(p_start_year, p_start_month, 1),
         (make_date(p_start_year + case when p_end_month < p_start_month then 1 else 0 end, p_end_month, 1)
           + interval '1 month - 1 day')::date;
$$;

-- Next occurrence after a completion. Seasonal: done within 3 months before the window (or during/after it)
-- counts for that window, so the next one is next year's; earlier than that it is this year's window.
create function public.next_maintenance_due(
  p_schedule text, p_interval_months int, p_ws int, p_we int, p_from date
) returns table (next_due date, due_until date)
language plpgsql immutable as $$
declare cand date;
begin
  if p_schedule = 'interval' then
    return query select (p_from + make_interval(months => p_interval_months))::date, null::date;
    return;
  end if;
  cand := make_date(extract(year from p_from)::int, p_ws, 1);
  if p_from >= (cand - interval '3 months')::date then cand := (cand + interval '1 year')::date; end if;
  return query select w.window_start, w.window_end
    from public.season_window(p_ws, p_we, extract(year from cand)::int) w;
end;
$$;

-- First occurrence for a freshly seeded seasonal task: the current window if we are inside it, else the next one.
create function public.first_seasonal_due(p_ws int, p_we int, p_today date)
returns table (next_due date, due_until date)
language sql immutable as $$
  with this_year as (select * from public.season_window(p_ws, p_we, extract(year from p_today)::int)),
       prev_year as (select * from public.season_window(p_ws, p_we, extract(year from p_today)::int - 1)),
       next_year as (select * from public.season_window(p_ws, p_we, extract(year from p_today)::int + 1))
  select window_start, window_end from prev_year where p_today <= window_end
  union all
  select window_start, window_end from this_year where p_today <= window_end
    and not exists (select 1 from prev_year where p_today <= window_end)
  union all
  select window_start, window_end from next_year
    where not exists (select 1 from prev_year where p_today <= window_end)
      and not exists (select 1 from this_year where p_today <= window_end)
  limit 1;
$$;

create function public.complete_maintenance(
  p_task_id uuid, p_done_at date default current_date, p_cost numeric default null, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare t public.maintenance_tasks; n record;
begin
  select * into t from public.maintenance_tasks where id = p_task_id;
  if not found or not public.is_member(t.household_id) then raise exception 'not found'; end if;
  insert into public.maintenance_events (task_id, household_id, done_at, cost_nok, note)
    values (t.id, t.household_id, p_done_at, p_cost, nullif(trim(p_note), ''));
  select * into n from public.next_maintenance_due(t.schedule, t.interval_months, t.window_start_month, t.window_end_month, p_done_at);
  update public.maintenance_tasks
    set last_done_at = greatest(coalesce(last_done_at, p_done_at), p_done_at), next_due_at = n.next_due, due_until = n.due_until
    where id = t.id;
end;
$$;

-- Norway-oriented starter template. Timings are a starting point to edit, not professional advice: check local
-- rules (kommune, feiervesen) and product manuals. p_profile flags switch on optional groups.
create function public.seed_house_template(p_household_id uuid, p_profile jsonb default '{}', p_today date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  if not public.is_member(p_household_id) then raise exception 'not a member'; end if;

  with tpl (key, cond, title, notes, zone, schedule, months, ws, we) as (values
    ('gutters_autumn', null, 'Clean gutters and downpipes (takrenner)', 'Before first frost. Clear leaves; check joints and brackets.', 'house', 'seasonal', null::int, 9, 10),
    ('gutters_spring', null, 'Check gutters after winter', 'Ice and snow can bend brackets and loosen joints.', 'house', 'seasonal', null, 4, 5),
    ('drain_taps', null, 'Drain and shut off outdoor taps (utekran)', 'Close the indoor valve, open the outdoor tap so it drains. Do it before the first hard frost.', 'house', 'seasonal', null, 10, 11),
    ('yard_drains', null, 'Clear yard drains and grates (sluk)', 'Leaves and silt in drains cause water against the foundation.', 'house', 'seasonal', null, 9, 10),
    ('snow_prep', null, 'Get snow gear ready; check roof snow guards', 'Shovels, salt/grit, snow guards (snøfangere). Know where the roof access is.', 'house', 'seasonal', null, 10, 11),
    ('roof_moss', null, 'Inspect the roof and remove moss', 'From the ground or with binoculars first. Only go up when safe, or hire someone.', 'house', 'seasonal', null, 4, 5),
    ('windows_seals', null, 'Check window and door seals; oil hinges', 'Draughts, cracked sealant, sticking locks.', 'house', 'seasonal', null, 8, 9),
    ('smoke_detectors', null, 'Test smoke detectors', 'Press the test button; replace batteries when they chirp or yearly. Check local guidance.', 'house', 'interval', 3, null, null),
    ('fire_extinguisher', null, 'Check fire extinguisher and fire blanket', 'Gauge in the green, within date, easy to reach.', 'house', 'interval', 12, null, null),
    ('earth_fault_test', null, 'Test earth-fault breakers (jordfeilbryter)', 'Press the test button on the fuse box; it should trip. Reset afterwards.', 'house', 'interval', 6, null, null),
    ('wet_rooms', null, 'Check silicone and grout in bathroom and laundry', 'Cracks let water into the structure. Redo sealant when it is broken or mouldy.', 'house', 'interval', 12, null, null),
    ('water_heater', null, 'Check water heater and its safety valve', 'Look for leaks or corrosion; operate the safety valve per the manual.', 'house', 'interval', 12, null, null),
    ('chimney', 'has_wood_stove', 'Chimney sweep and fire inspection (feiing)', 'The kommune schedules this; check your interval and that they have access.', 'house', 'interval', 24, null, null),
    ('heat_pump_filters', 'has_heat_pump', 'Clean heat pump filters', 'Rinse indoor unit filters; clear leaves and snow around the outdoor unit.', 'house', 'interval', 3, null, null),
    ('ventilation_filters', 'has_balanced_ventilation', 'Replace ventilation filters', 'Balanced ventilation with heat recovery: check filter type in the manual.', 'house', 'interval', 6, null, null),
    ('basement_damp', 'has_basement', 'Check basement for damp, mould and humidity', 'Look at corners, floor drains and stored boxes. Note humidity readings.', 'house', 'interval', 12, null, null),
    ('facade', 'has_wooden_facade', 'Inspect wooden facade and paint or stain', 'Look for peeling, cracks and rot near the ground. Restain cycles vary widely.', 'house', 'seasonal', null, 5, 6),
    ('septic', 'has_septic', 'Septic tank emptying (slamavskiller)', 'Interval is set by the kommune and the tank type. Confirm yours.', 'house', 'interval', 24, null, null),
    ('well_water', 'has_well', 'Test well water quality', 'Bacteria and nitrate at minimum; more if there are taste or colour changes.', 'house', 'interval', 12, null, null),
    ('mower_service', 'has_garden', 'Service the lawn mower and garden tools', 'Blades, oil, spark plug or battery, before the season.', 'garden', 'seasonal', null, 3, 4),
    ('garden_spring', 'has_garden', 'Spring garden clean-up and lawn care', 'Rake, dethatch, reseed bare patches, first cut.', 'garden', 'seasonal', null, 4, 5),
    ('fence_gates', 'has_garden', 'Check fence, gates and garden structures', 'Posts, hinges, rot; treat or repair.', 'garden', 'seasonal', null, 5, 6),
    ('garden_autumn', 'has_garden', 'Autumn garden: rake leaves, prune, winterise', 'Store hoses, cover tender plants, plant bulbs.', 'garden', 'seasonal', null, 9, 10)
  ), picked as (
    select t.*, row_number() over (order by t.key) as rn
    from tpl t
    where t.cond is null or coalesce((p_profile ->> t.cond)::boolean, false)
  ), ins as (
    insert into public.maintenance_tasks
      (household_id, template_key, title, notes, zone, schedule, interval_months, window_start_month, window_end_month, next_due_at, due_until)
    select p_household_id, p.key, p.title, p.notes, p.zone, p.schedule, p.months, p.ws, p.we,
           case when p.schedule = 'seasonal' then (select f.next_due from public.first_seasonal_due(p.ws, p.we, p_today) f)
                else p_today + (7 + (p.rn % 8) * 7)::int end,
           case when p.schedule = 'seasonal' then (select f.due_until from public.first_seasonal_due(p.ws, p.we, p_today) f) end
    from picked p
    on conflict (household_id, template_key) do nothing
    returning 1
  )
  select count(*) into inserted from ins;
  return inserted;
end;
$$;

alter table public.maintenance_tasks enable row level security;
alter table public.maintenance_events enable row level security;

create policy maintenance_tasks_all on public.maintenance_tasks for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy maintenance_events_select on public.maintenance_events for select using (public.is_member(household_id));

grant select, insert, update, delete on public.maintenance_tasks to authenticated;
grant select on public.maintenance_events to authenticated;
grant execute on function public.complete_maintenance(uuid, date, numeric, text) to authenticated;
grant execute on function public.seed_house_template(uuid, jsonb, date) to authenticated;
