-- House register: appliances with their warranty, tradespeople (contacts) linked to jobs, and a cost log; weather rules get a "hours before" lead and an owner.
-- Safe to run more than once.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  trade text not null default 'other',
  company text,
  phone text,
  email text,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_household_idx on public.contacts (household_id);

create table if not exists public.appliances (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  category text not null default 'other',
  brand text,
  model text,
  serial text,
  room text,
  purchased_on date,
  price_nok numeric(12, 2) check (price_nok is null or price_nok >= 0),
  store text,
  warranty_until date,
  manual_url text,
  contact_id uuid references public.contacts (id) on delete set null,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists appliances_household_idx on public.appliances (household_id, warranty_until);

-- Money spent that is not the cost of finishing a recurring job (that is kept on the job's own history): a plumber's visit, a repair.
create table if not exists public.house_costs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  amount_nok numeric(12, 2) not null check (amount_nok >= 0),
  spent_on date not null default current_date,
  contact_id uuid references public.contacts (id) on delete set null,
  appliance_id uuid references public.appliances (id) on delete set null,
  task_id uuid references public.maintenance_tasks (id) on delete set null,
  item_id uuid references public.condition_items (id) on delete set null,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists house_costs_household_idx on public.house_costs (household_id, spent_on desc);

alter table public.maintenance_tasks add column if not exists contact_id uuid references public.contacts (id) on delete set null;
alter table public.condition_items add column if not exists contact_id uuid references public.contacts (id) on delete set null;

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts for each row execute function public.touch_updated_at();
drop trigger if exists appliances_touch on public.appliances;
create trigger appliances_touch before update on public.appliances for each row execute function public.touch_updated_at();

alter table public.contacts enable row level security;
alter table public.appliances enable row level security;
alter table public.house_costs enable row level security;
do $$
declare t text;
begin
  foreach t in array array['contacts', 'appliances', 'house_costs'] loop
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

-- Weather rules: ring some hours before the weather starts, and for one person only (null = both of you).
alter table public.weather_rules add column if not exists lead_hours integer not null default 2 check (lead_hours between 1 and 12);
alter table public.weather_rules add column if not exists owner_id uuid references auth.users (id) on delete set null;
alter table public.weather_rules drop constraint if exists weather_rules_lead_check;
alter table public.weather_rules add constraint weather_rules_lead_check check (lead in ('evening_before', 'same_morning', 'hours_before'));

notify pgrst, 'reload schema';
