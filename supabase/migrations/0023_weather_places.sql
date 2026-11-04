-- Where the weather is checked: Home (one per household, set in Settings) and any other places added there. A weather rule uses Home unless it names a place.
-- Safe to run more than once.
create table if not exists public.weather_places (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  address text,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  is_home boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists weather_places_one_home on public.weather_places (household_id) where is_home;
create index if not exists weather_places_household_idx on public.weather_places (household_id);

alter table public.weather_places enable row level security;
drop policy if exists weather_places_select on public.weather_places;
create policy weather_places_select on public.weather_places for select using (public.is_member(household_id));
drop policy if exists weather_places_insert on public.weather_places;
create policy weather_places_insert on public.weather_places for insert with check (public.is_member(household_id));
drop policy if exists weather_places_update on public.weather_places;
create policy weather_places_update on public.weather_places for update using (public.is_member(household_id)) with check (public.is_member(household_id));
drop policy if exists weather_places_delete on public.weather_places;
create policy weather_places_delete on public.weather_places for delete using (public.is_member(household_id));
grant select, insert, update, delete on public.weather_places to authenticated;

alter table public.weather_rules add column if not exists place_id uuid references public.weather_places (id) on delete set null;

notify pgrst, 'reload schema';
