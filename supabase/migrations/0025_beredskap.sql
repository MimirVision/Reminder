-- Beredskap (home preparedness): the household's settings (people, days, reminder lead time, family plan) and what is in stock with its expiry date.
-- Safe to run more than once.
create table if not exists public.prep_settings (
  household_id uuid primary key references public.households (id) on delete cascade,
  adults integer not null default 2 check (adults between 1 and 12),
  children integer not null default 0 check (children between 0 and 12),
  pets integer not null default 0 check (pets between 0 and 20),
  days integer not null default 7 check (days between 1 and 21),
  iodine_people integer not null default 0 check (iodine_people between 0 and 20),
  baby boolean not null default false,
  wood_stove boolean not null default false,
  lead_days integer not null default 30 check (lead_days between 1 and 365),
  overrides jsonb not null default '{}'::jsonb,
  meeting_place text,
  outside_contact text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.prep_stock (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  key text,
  name text not null,
  category text not null default 'other',
  qty numeric(10, 2) not null default 1 check (qty >= 0),
  unit text,
  expires_on date,
  renew_months integer check (renew_months is null or renew_months between 1 and 120),
  location text,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prep_stock_household_idx on public.prep_stock (household_id, expires_on);

drop trigger if exists prep_settings_touch on public.prep_settings;
create trigger prep_settings_touch before update on public.prep_settings for each row execute function public.touch_updated_at();
drop trigger if exists prep_stock_touch on public.prep_stock;
create trigger prep_stock_touch before update on public.prep_stock for each row execute function public.touch_updated_at();

alter table public.prep_settings enable row level security;
alter table public.prep_stock enable row level security;
do $$
declare t text;
begin
  foreach t in array array['prep_settings', 'prep_stock'] loop
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
