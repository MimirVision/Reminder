-- Weather reminders can add their checklist to the to-do list. `weather_made` remembers which alert already made its to-dos, so that
-- the two of you (and every device) make them once.
-- Safe to run more than once.
alter table public.weather_rules add column if not exists make_todos boolean not null default true;

create table if not exists public.weather_made (
  rule_id uuid not null references public.weather_rules (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  for_date date not null,
  memory_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (rule_id, for_date)
);
create index if not exists weather_made_household_idx on public.weather_made (household_id, for_date);

alter table public.weather_made enable row level security;
drop policy if exists weather_made_select on public.weather_made;
create policy weather_made_select on public.weather_made for select using (public.is_member(household_id));
drop policy if exists weather_made_insert on public.weather_made;
create policy weather_made_insert on public.weather_made for insert with check (public.is_member(household_id));
drop policy if exists weather_made_update on public.weather_made;
create policy weather_made_update on public.weather_made for update using (public.is_member(household_id)) with check (public.is_member(household_id));
drop policy if exists weather_made_delete on public.weather_made;
create policy weather_made_delete on public.weather_made for delete using (public.is_member(household_id));
grant select, insert, update, delete on public.weather_made to authenticated;

notify pgrst, 'reload schema';
