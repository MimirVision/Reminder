-- Weather reminders: rules ("when it rains, remind us to take in the pillows") and what has been ticked off for a given day.
-- Shared by the household. Safe to run more than once.
create table if not exists public.weather_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  scenario text not null check (scenario in ('rain', 'snow', 'frost', 'wind', 'heat', 'storm')),
  threshold numeric,
  items jsonb not null default '[]'::jsonb,
  lead text not null default 'evening_before' check (lead in ('evening_before', 'same_morning')),
  at_time text not null default '18:00' check (at_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  frequency text not null default 'spell' check (frequency in ('spell', 'every')),
  dry_gap integer not null default 2 check (dry_gap between 1 and 14),
  quiet_days integer[] not null default '{}',
  paused_until date,
  follow_up boolean not null default true,
  enabled boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists weather_rules_household_idx on public.weather_rules (household_id);
drop trigger if exists weather_rules_touch on public.weather_rules;
create trigger weather_rules_touch before update on public.weather_rules
  for each row execute function public.touch_updated_at();

create table if not exists public.weather_done (
  rule_id uuid not null references public.weather_rules (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  for_date date not null,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (rule_id, for_date)
);
create index if not exists weather_done_household_idx on public.weather_done (household_id, for_date);

alter table public.weather_rules enable row level security;
alter table public.weather_done enable row level security;
do $$
declare t text;
begin
  foreach t in array array['weather_rules', 'weather_done'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (public.is_member(household_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (public.is_member(household_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (public.is_member(household_id)) with check (public.is_member(household_id))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete using (public.is_member(household_id))', t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
