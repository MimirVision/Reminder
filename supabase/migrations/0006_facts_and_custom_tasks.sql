-- House facts: things you need to look up in the shop or in an emergency (paint code, bulb type, measurements,
-- where the water shutoff is). surface_at lists shop categories where the fact should appear on the store list.

create table public.house_facts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  value text not null default '',
  category text not null default 'other' check (category in ('emergency', 'measurement', 'paint', 'appliance', 'other')),
  surface_at text[] not null default '{}',
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index house_facts_household_idx on public.house_facts (household_id, category);
create trigger house_facts_touch before update on public.house_facts
  for each row execute function public.touch_updated_at();

alter table public.house_facts enable row level security;
create policy house_facts_select on public.house_facts for select using (public.is_member(household_id));
create policy house_facts_insert on public.house_facts for insert
  with check (public.is_member(household_id) and created_by = auth.uid());
-- Either partner may edit or delete a shared fact.
create policy house_facts_update on public.house_facts for update
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy house_facts_delete on public.house_facts for delete using (public.is_member(household_id));
grant select, insert, update, delete on public.house_facts to authenticated;

-- Your own recurring task. `p_last_done` (optional) says when it was last done, so the first due date is right.
create function public.add_maintenance_task(
  p_household_id uuid, p_title text, p_notes text, p_schedule text,
  p_interval_months int default null, p_ws int default null, p_we int default null,
  p_last_done date default null, p_today date default current_date
) returns uuid language plpgsql security definer set search_path = public as $$
declare n record; new_id uuid;
begin
  if not public.is_member(p_household_id) then raise exception 'not a member'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'title required'; end if;
  if p_schedule = 'interval' and p_interval_months is null then raise exception 'interval required'; end if;
  if p_schedule = 'seasonal' and (p_ws is null or p_we is null) then raise exception 'season required'; end if;

  if p_last_done is not null then
    select * into n from public.next_maintenance_due(p_schedule, p_interval_months, p_ws, p_we, p_last_done);
  elsif p_schedule = 'seasonal' then
    select * into n from public.first_seasonal_due(p_ws, p_we, p_today);
  else
    select (p_today + make_interval(months => p_interval_months))::date as next_due, null::date as due_until into n;
  end if;

  insert into public.maintenance_tasks
    (household_id, title, notes, zone, schedule, interval_months, window_start_month, window_end_month, next_due_at, due_until, last_done_at)
  values (p_household_id, trim(p_title), nullif(trim(p_notes), ''), 'house', p_schedule, p_interval_months, p_ws, p_we, n.next_due, n.due_until, p_last_done)
  returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.add_maintenance_task(uuid, text, text, text, int, int, int, date, date) to authenticated;
